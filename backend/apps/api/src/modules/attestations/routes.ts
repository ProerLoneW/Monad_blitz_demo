import { encodeFunctionData } from 'viem';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Attestation } from '@proofnote/api-types';
import { getAbi } from '@proofnote/contract-abis';
import { attestationStatementHash } from '@proofnote/hash-utils';
import { schema, type Db } from '@proofnote/db';
import { AppError } from '../../lib/errors.js';
import { checksum } from '../../lib/money.js';
import { parseBody } from '../../lib/validation.js';
import { insertIntent } from '../../services/mock-chain.js';
import { z } from 'zod';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

const ATTESTATION_TYPE_CODE: Record<'PARTICIPATED' | 'WITNESSED', number> = { PARTICIPATED: 0, WITNESSED: 1 };

export default async function attestationRoutes(app: FastifyInstance) {
  // ── POST /impact/:impactId/attestations/prepare（SPEC §22.1）
  app.post(
    '/impact/:impactId/attestations/prepare',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const db = requireDb(app);
      const { impactId } = request.params as { impactId: string };
      const body = parseBody(
        z.object({
          type: z.enum(['PARTICIPATED', 'WITNESSED']),
          statement: z.string().min(1).max(1000),
        }),
        request.body,
      );

      const impact = (
        await db.select().from(schema.impactClaims).where(eq(schema.impactClaims.id, impactId)).limit(1)
      )[0];
      if (!impact) throw new AppError('IMPACT_NOT_FOUND');

      // 读模型查重 + 链上 hasAttested 双保险（读模型可能落后）
      const dup = (
        await db
          .select({ id: schema.attestations.id })
          .from(schema.attestations)
          .where(
            and(
              eq(schema.attestations.impactKey, impact.impactKey),
              eq(schema.attestations.attester, request.user.addr),
              eq(schema.attestations.attestationType, body.type),
            ),
          )
          .limit(1)
      )[0];
      if (dup) throw new AppError('ATTESTATION_DUPLICATE');
      const onchainHas = await app.svc.chain.hasAttested(
        impact.impactKey,
        request.user.addr,
        ATTESTATION_TYPE_CODE[body.type],
      );
      if (onchainHas === true) throw new AppError('ATTESTATION_DUPLICATE', 'already attested onchain');

      const statementHash = attestationStatementHash({
        impactKey: impact.impactKey,
        attester: request.user.addr,
        type: body.type,
        statement: body.statement,
      });

      let tx;
      if (app.cfg.isMock) {
        await insertIntent(db, {
          userId: request.user.sub,
          kind: 'ATTEST',
          entityId: impactId,
          params: { impactKey: impact.impactKey, type: body.type, statementHash },
        });
        tx = {
          chainId: app.cfg.env.CHAIN_ID,
          to: '0x0000000000000000000000000000000000000000',
          data: '0x',
          value: '0',
          functionName: 'attest',
          description: 'Attest to impact activity',
          mock: true,
        };
      } else {
        const registry = app.cfg.contracts.attestationRegistry;
        if (!registry) throw new AppError('CHAIN_NOT_CONFIGURED', 'AttestationRegistry not configured');
        tx = {
          chainId: app.cfg.env.CHAIN_ID,
          to: registry as `0x${string}`,
          data: encodeFunctionData({
            abi: getAbi('attestationRegistry'),
            functionName: 'attest',
            args: [impact.impactKey as `0x${string}`, BigInt(ATTESTATION_TYPE_CODE[body.type]), statementHash],
          }),
          value: '0',
          functionName: 'attest',
          description: 'Attest to impact activity',
        };
      }

      return {
        data: {
          statementHash,
          selfRelated: impact.authorAddress === request.user.addr,
          tx,
        },
      };
    },
  );

  // ── GET /impact/:impactId/attestations（SPEC §22.2）───────
  app.get('/impact/:impactId/attestations', async (request) => {
    const db = requireDb(app);
    const { impactId } = request.params as { impactId: string };
    const impact = (
      await db.select().from(schema.impactClaims).where(eq(schema.impactClaims.id, impactId)).limit(1)
    )[0];
    if (!impact) throw new AppError('IMPACT_NOT_FOUND');

    const rows = await db
      .select({
        att: schema.attestations,
        user: schema.users,
        profile: schema.profiles,
      })
      .from(schema.attestations)
      .innerJoin(schema.users, eq(schema.users.walletAddress, schema.attestations.attester))
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(eq(schema.attestations.impactKey, impact.impactKey))
      .orderBy(desc(schema.attestations.blockTime))
      .limit(100);

    const items: Attestation[] = rows.map(({ att, profile }) => ({
      id: `att_${att.id}`,
      attester: {
        address: checksum(att.attester),
        profile: profile ? { handle: profile.handle, displayName: profile.displayName } : null,
      },
      type: att.attestationType as 'PARTICIPATED' | 'WITNESSED',
      statementHash: att.statementHash as `0x${string}`,
      createdAt: att.blockTime.toISOString(),
      explorerUrl: app.cfg.explorerUrl(att.txHash),
    }));
    return { data: { items } };
  });
}
