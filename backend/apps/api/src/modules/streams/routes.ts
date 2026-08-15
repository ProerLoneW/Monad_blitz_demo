import { encodeFunctionData } from 'viem';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Stream, TxRequest } from '@proofnote/api-types';
import { getAbi } from '@proofnote/contract-abis';
import { domain, schema, type Db } from '@proofnote/db';
import { AppError } from '../../lib/errors.js';
import { MIN_STREAM_DURATION_SECONDS, checksum, toMoney } from '../../lib/money.js';
import { parseBody, weiStringSchema } from '../../lib/validation.js';
import { insertIntent } from '../../services/mock-chain.js';
import { requirePublishedNote } from '../notes/service.js';
import { z } from 'zod';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

const ZERO_TX: `0x${string}` = '0x0000000000000000000000000000000000000000';

function streamTx(app: FastifyInstance, functionName: string, description: string, value = '0'): TxRequest {
  return {
    chainId: app.cfg.env.CHAIN_ID,
    to: app.cfg.isMock ? ZERO_TX : (app.cfg.contracts.streamSupport as `0x${string}`),
    data: '0x',
    value,
    functionName,
    description,
    ...(app.cfg.isMock ? { mock: true } : {}),
  };
}

async function encodeStreamTx(app: FastifyInstance, functionName: string, args: unknown[], description: string, value = '0'): Promise<TxRequest> {
  if (app.cfg.isMock) return streamTx(app, functionName, description, value);
  const addr = app.cfg.contracts.streamSupport;
  if (!addr) throw new AppError('CHAIN_NOT_CONFIGURED', 'StreamSupport not configured');
  return {
    chainId: app.cfg.env.CHAIN_ID,
    to: addr as `0x${string}`,
    data: encodeFunctionData({ abi: getAbi('streamSupport'), functionName, args: args as never }),
    value,
    functionName,
    description,
  };
}

export default async function streamRoutes(app: FastifyInstance) {
  // ── POST /notes/:noteId/streams/prepare（SPEC §17.1）──────
  app.post(
    '/notes/:noteId/streams/prepare',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const db = requireDb(app);
      const { noteId } = request.params as { noteId: string };
      const body = parseBody(
        z.object({ rateWeiPerSecond: weiStringSchema, budgetWei: weiStringSchema }),
        request.body,
      );

      const note = await requirePublishedNote(db, noteId);
      if (!note.streamEnabled) throw new AppError('STREAM_DISABLED');

      const rate = BigInt(body.rateWeiPerSecond);
      const budget = BigInt(body.budgetWei);
      if (rate <= 0n) throw new AppError('STREAM_INVALID_RATE');
      if (budget <= 0n) throw new AppError('STREAM_INVALID_BUDGET');
      if (budget < rate * MIN_STREAM_DURATION_SECONDS) {
        throw new AppError('STREAM_BUDGET_TOO_LOW', 'budget must cover at least 10 seconds');
      }

      let tx: TxRequest;
      if (app.cfg.isMock) {
        await insertIntent(db, {
          userId: request.user.sub,
          kind: 'STREAM_CREATE',
          entityId: note.id,
          params: { noteKey: note.noteKey, creator: note.authorAddress, rateWeiPerSecond: body.rateWeiPerSecond, budgetWei: body.budgetWei },
        });
        tx = streamTx(app, 'createStream', 'Start streaming support', body.budgetWei);
      } else {
        const addr = app.cfg.contracts.streamSupport;
        if (!addr) throw new AppError('CHAIN_NOT_CONFIGURED', 'StreamSupport not configured');
        tx = {
          chainId: app.cfg.env.CHAIN_ID,
          to: addr as `0x${string}`,
          data: encodeFunctionData({
            abi: getAbi('streamSupport'),
            functionName: 'createStream',
            args: [note.noteKey as `0x${string}`, note.authorAddress as `0x${string}`, rate],
          }),
          value: body.budgetWei,
          functionName: 'createStream',
          description: 'Start streaming support',
        };
      }

      return {
        data: {
          preview: {
            maxDurationSeconds: Number(budget / rate),
            rateWeiPerSecond: body.rateWeiPerSecond,
            budgetWei: body.budgetWei,
          },
          tx,
        },
      };
    },
  );

  // ── GET /streams/:streamId（SPEC §17.2）──────────────────
  app.get('/streams/:streamId', async (request) => {
    const db = requireDb(app);
    const { streamId } = request.params as { streamId: string };
    const row = (await db.select().from(schema.streams).where(eq(schema.streams.streamId, streamId)).limit(1))[0];
    if (!row) throw new AppError('STREAM_NOT_FOUND');

    const view = domain.deriveStreamView(row, new Date());
    const note = (await db.select().from(schema.notes).where(eq(schema.notes.noteKey, row.noteKey)).limit(1))[0];
    const estimatedEndAt =
      row.status === 'ACTIVE' && row.activeSince
        ? new Date(row.activeSince.getTime() + Number((BigInt(row.budgetWei) - BigInt(row.accruedStoredWei)) / BigInt(row.rateWeiPerSecond)) * 1000)
        : null;

    const stream: Stream = {
      streamId: row.streamId,
      noteId: note?.id ?? null,
      supporter: checksum(row.fan),
      creator: checksum(row.creator),
      rateWeiPerSecond: row.rateWeiPerSecond,
      budgetWei: row.budgetWei,
      accruedWei: view.accruedWei,
      remainingBudgetWei: view.remainingBudgetWei,
      status: view.status,
      snapshotAt: new Date().toISOString(),
      estimatedEndAt: estimatedEndAt?.toISOString() ?? null,
      chain: { chainId: app.cfg.env.CHAIN_ID },
    };
    return { data: stream };
  });

  // ── pause / resume / stop prepare（SPEC §17.3–17.5）───────
  const stateChange = (kind: 'STREAM_PAUSE' | 'STREAM_RESUME' | 'STREAM_STOP', functionName: 'pauseStream' | 'resumeStream' | 'stopAndSettle', description: string) =>
    app.post(
      `/streams/:streamId/${kind.split('_')[1]!.toLowerCase()}/prepare`,
      { preHandler: [app.authenticate] },
      async (request) => {
        const db = requireDb(app);
        const { streamId } = request.params as { streamId: string };
        const row = (await db.select().from(schema.streams).where(eq(schema.streams.streamId, streamId)).limit(1))[0];
        if (!row) throw new AppError('STREAM_NOT_FOUND');
        if (row.fan !== request.user.addr) throw new AppError('STREAM_NOT_OWNER');
        if (row.status === 'SETTLED') throw new AppError('STREAM_ALREADY_SETTLED');
        if (kind === 'STREAM_PAUSE' && row.status !== 'ACTIVE') throw new AppError('STREAM_INVALID_STATE', 'stream not active');
        if (kind === 'STREAM_RESUME' && row.status !== 'PAUSED') throw new AppError('STREAM_INVALID_STATE', 'stream not paused');

        if (app.cfg.isMock) {
          await insertIntent(db, { userId: request.user.sub, kind, entityId: streamId, params: { streamId } });
          return { data: { tx: streamTx(app, functionName, description) } };
        }
        const tx = await encodeStreamTx(app, functionName, [BigInt(streamId)], description);
        return { data: { tx } };
      },
    );
  stateChange('STREAM_PAUSE', 'pauseStream', 'Pause streaming support');
  stateChange('STREAM_RESUME', 'resumeStream', 'Resume streaming support');
  stateChange('STREAM_STOP', 'stopAndSettle', 'Stop and settle stream');

  // ── POST /streams/withdraw/prepare（SPEC §17.8）───────────
  app.post('/streams/withdraw/prepare', { preHandler: [app.authenticate] }, async (request) => {
    const db = requireDb(app);
    if (app.cfg.isMock) {
      await insertIntent(db, { userId: request.user.sub, kind: 'STREAM_WITHDRAW', params: {} });
      return { data: { tx: streamTx(app, 'withdraw', 'Withdraw claimable credit') } };
    }
    const tx = await encodeStreamTx(app, 'withdraw', [], 'Withdraw claimable credit');
    return { data: { tx } };
  });

  // ── GET /profiles/:address/streams/incoming（SPEC §17.6）──
  app.get('/profiles/:address/streams/incoming', async (request) => {
    const db = requireDb(app);
    const { address } = request.params as { address: string };
    const creator = address.toLowerCase();
    const active = await db
      .select()
      .from(schema.streams)
      .where(and(eq(schema.streams.creator, creator), eq(schema.streams.status, 'ACTIVE')));

    const now = new Date();
    let aggregateRate = 0n;
    let unsettled = 0n;
    for (const row of active) {
      aggregateRate += BigInt(row.rateWeiPerSecond);
      unsettled += BigInt(domain.deriveStreamView(row, now).accruedWei);
    }

    const streamsList: Stream[] = active.slice(0, 50).map((row) => {
      const view = domain.deriveStreamView(row, now);
      return {
        streamId: row.streamId,
        noteId: null,
        supporter: checksum(row.fan),
        creator: checksum(row.creator),
        rateWeiPerSecond: row.rateWeiPerSecond,
        budgetWei: row.budgetWei,
        accruedWei: view.accruedWei,
        remainingBudgetWei: view.remainingBudgetWei,
        status: view.status,
        snapshotAt: now.toISOString(),
      };
    });

    return {
      data: {
        aggregateIncomingRateWeiPerSecond: aggregateRate.toString(),
        activeStreamCount: active.length,
        estimatedUnsettledIncomeWei: unsettled.toString(),
        streams: streamsList,
      },
    };
  });

  // ── GET /profiles/:address/claimable（SPEC §17.7）────────
  app.get('/profiles/:address/claimable', async (request) => {
    const db = requireDb(app);
    const { address } = request.params as { address: string };
    const account = address.toLowerCase();

    // 优先链上 claimable()（强一致），mock / RPC 失败回退读模型
    const onchain = await app.svc.chain.getClaimable(account);
    let amountWei: string;
    if (onchain !== null) {
      amountWei = onchain.toString();
    } else {
      const credit = (
        await db.select().from(schema.streamCredits).where(eq(schema.streamCredits.account, account)).limit(1)
      )[0];
      amountWei = credit?.creditWei ?? '0';
    }
    return {
      data: {
        streamSupport: toMoney(amountWei, app.cfg.env.NATIVE_CURRENCY_SYMBOL, app.cfg.env.NATIVE_CURRENCY_DECIMALS),
      },
    };
  });
}
