import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TrackedTxKind } from '@proofnote/api-types';
import { schema, type Db } from '@proofnote/db';
import { AppError } from '../../lib/errors.js';
import { newTxId } from '../../lib/ids.js';
import { parseBody, txHashSchema } from '../../lib/validation.js';
import { beginIdempotency } from '../../plugins/idempotency.js';
import { applyMockTrack } from '../../services/mock-chain.js';
import { z } from 'zod';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

const KINDS = [
  'ANCHOR', 'IMPACT_ANCHOR', 'EVIDENCE_UPDATE', 'TIP',
  'STREAM_CREATE', 'STREAM_PAUSE', 'STREAM_RESUME', 'STREAM_STOP', 'STREAM_WITHDRAW',
  'ATTEST', 'CAMPAIGN_CREATE', 'CAMPAIGN_FUND', 'CAMPAIGN_SPEND',
] as const;

export default async function transactionRoutes(app: FastifyInstance) {
  // ── POST /transactions/track（SPEC §14.3）────────────────
  app.post(
    '/transactions/track',
    { preHandler: [app.authenticate, async (request, reply) => beginIdempotency(request, reply)] },
    async (request, reply) => {
      const db = requireDb(app);
      const body = parseBody(
        z.object({
          txHash: txHashSchema,
          kind: z.enum(KINDS),
          entityType: z.string().max(40).optional(),
          entityId: z.string().max(64).optional(),
        }),
        request.body,
      );

      const inserted = await db
        .insert(schema.trackedTransactions)
        .values({
          id: newTxId(),
          txHash: body.txHash,
          kind: body.kind,
          entityType: body.entityType ?? null,
          entityId: body.entityId ?? null,
          userId: request.user.sub,
          status: app.cfg.isMock ? 'CONFIRMED' : 'SUBMITTED',
        })
        .onConflictDoNothing()
        .returning();

      let row = inserted[0];
      if (!row) {
        row = (
          await db
            .select()
            .from(schema.trackedTransactions)
            .where(eq(schema.trackedTransactions.txHash, body.txHash))
            .limit(1)
        )[0]!;
      } else if (app.cfg.isMock) {
        // mock 模拟链上确认：消费 prepare 意图并直接落读模型（与 Indexer 同一 domain 层）
        try {
          await applyMockTrack(db, app.cfg, app.svc.chain, {
            userId: request.user.sub,
            userAddr: request.user.addr,
            kind: body.kind,
            txHash: body.txHash,
            entityType: body.entityType ?? null,
            entityId: body.entityId ?? null,
          });
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw new AppError('INTERNAL_ERROR', `mock track failed: ${(err as Error).message}`);
        }
      }

      return reply.code(201).send({
        data: { id: row.id, status: row.status, txHash: row.txHash },
      });
    },
  );

  // ── GET /transactions/:txHash（SPEC §15.1）───────────────
  app.get('/transactions/:txHash', async (request) => {
    const db = requireDb(app);
    const { txHash } = request.params as { txHash: string };
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new AppError('TX_NOT_FOUND');

    const rows = await db
      .select()
      .from(schema.trackedTransactions)
      .where(eq(schema.trackedTransactions.txHash, txHash))
      .orderBy(desc(schema.trackedTransactions.updatedAt))
      .limit(1);
    const row = rows[0];

    // 实时 receipt 校验（real 模式；mock 模式直接返回存储状态）
    let status = row?.status ?? 'UNKNOWN';
    let blockNumber = row?.blockNumber ?? null;
    if (!app.cfg.isMock) {
      const receipt = await app.svc.chain.getReceipt(txHash);
      if (receipt) {
        status = receipt.status === 'success' ? 'CONFIRMED' : 'REVERTED';
        blockNumber = String(receipt.blockNumber);
        if (row && status !== row.status) {
          await db
            .update(schema.trackedTransactions)
            .set({ status, blockNumber, updatedAt: new Date() })
            .where(eq(schema.trackedTransactions.id, row.id));
        }
      }
    }

    return {
      data: {
        txHash,
        kind: (row?.kind ?? 'UNKNOWN') as TrackedTxKind | 'UNKNOWN',
        status,
        confirmations: status === 'CONFIRMED' ? 1 : 0,
        blockNumber,
        explorerUrl: app.cfg.explorerUrl(txHash),
        error: row?.error ?? null,
      },
    };
  });
}
