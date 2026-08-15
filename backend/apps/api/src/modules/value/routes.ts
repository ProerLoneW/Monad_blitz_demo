import { encodeFunctionData } from 'viem';
import type { FastifyInstance } from 'fastify';
import type { TxRequest } from '@proofnote/api-types';
import { getAbi } from '@proofnote/contract-abis';
import type { Db } from '@proofnote/db';
import { AppError } from '../../lib/errors.js';
import { MIN_TIP_WEI } from '../../lib/money.js';
import { parseBody, weiStringSchema } from '../../lib/validation.js';
import { insertIntent } from '../../services/mock-chain.js';
import { noteValueAggregates } from '../../services/stats.js';
import { requirePublishedNote } from '../notes/service.js';
import { z } from 'zod';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

export default async function valueRoutes(app: FastifyInstance) {
  // ── GET /notes/:noteId/value（SPEC §14.1）─────────────────
  app.get('/notes/:noteId/value', async (request) => {
    const db = requireDb(app);
    const { noteId } = request.params as { noteId: string };
    const note = await requirePublishedNote(db, noteId);
    if (!note.tipEnabled && !note.streamEnabled) throw new AppError('TIP_DISABLED', 'note not monetized');

    const agg = (await noteValueAggregates(db, [note.noteKey])).get(note.noteKey);
    const feeBps = await app.svc.chain.getFeeBps();
    const totalSupportWei = BigInt(agg?.tipsCreatorWei ?? '0') + BigInt(agg?.settledStreamWei ?? '0');

    return {
      data: {
        tip: { enabled: note.tipEnabled },
        stream: {
          enabled: note.streamEnabled,
          activeCount: agg?.activeStreams ?? 0,
          incomingRateWeiPerSecond: agg?.incomingRateWei ?? '0',
        },
        totalSupport: {
          amountWei: totalSupportWei.toString(),
          formatted: format(totalSupportWei),
          symbol: app.cfg.env.NATIVE_CURRENCY_SYMBOL,
          decimals: app.cfg.env.NATIVE_CURRENCY_DECIMALS,
        },
        distribution: [
          { role: 'CREATOR', address: note.authorAddress, bps: 10_000 - feeBps },
          { role: 'PROTOCOL', address: app.cfg.env.PROTOCOL_FEE_RECIPIENT ?? '0x0000000000000000000000000000000000000000', bps: feeBps },
        ],
      },
    };
  });

  // ── POST /notes/:noteId/tips/prepare（SPEC §14.2）─────────
  app.post(
    '/notes/:noteId/tips/prepare',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const db = requireDb(app);
      const { noteId } = request.params as { noteId: string };
      const body = parseBody(z.object({ amountWei: weiStringSchema }), request.body);

      const note = await requirePublishedNote(db, noteId);
      if (!note.tipEnabled) throw new AppError('TIP_DISABLED');
      const gross = BigInt(body.amountWei);
      if (gross <= 0n) throw new AppError('TIP_INVALID_AMOUNT');
      if (gross < MIN_TIP_WEI) throw new AppError('TIP_AMOUNT_TOO_SMALL');

      // quote：优先链上 previewTip，失败按 feeBps 本地计算（同一公式，SPEC §28.2 gross = creator + fee）
      const chainQuote = await app.svc.chain.previewTip(gross);
      let creatorReceives: bigint;
      let protocolFee: bigint;
      if (chainQuote) {
        creatorReceives = chainQuote.creatorAmount;
        protocolFee = chainQuote.protocolFee;
      } else {
        const bps = await app.svc.chain.getFeeBps();
        protocolFee = (gross * BigInt(bps)) / 10000n;
        creatorReceives = gross - protocolFee;
      }

      let tx: TxRequest;
      if (app.cfg.isMock) {
        await insertIntent(db, {
          userId: request.user.sub,
          kind: 'TIP',
          entityId: note.id,
          params: { noteKey: note.noteKey, creator: note.authorAddress, amountWei: body.amountWei },
        });
        tx = {
          chainId: app.cfg.env.CHAIN_ID,
          to: '0x0000000000000000000000000000000000000000',
          data: '0x',
          value: body.amountWei,
          functionName: 'tipNative',
          description: `Support ${note.authorAddress}`,
          mock: true,
        };
      } else {
        const router = app.cfg.contracts.supportRouter;
        if (!router) throw new AppError('CHAIN_NOT_CONFIGURED', 'SupportRouter not configured');
        tx = {
          chainId: app.cfg.env.CHAIN_ID,
          to: router as `0x${string}`,
          data: encodeFunctionData({
            abi: getAbi('supportRouter'),
            functionName: 'tipNative',
            args: [note.noteKey as `0x${string}`, note.authorAddress as `0x${string}`],
          }),
          value: body.amountWei,
          functionName: 'tipNative',
          description: `Support ${note.authorAddress}`,
        };
      }

      return {
        data: {
          quote: {
            gross: gross.toString(),
            creatorReceives: creatorReceives.toString(),
            protocolFee: protocolFee.toString(),
          },
          tx,
        },
      };
    },
  );
}

function format(wei: bigint): string {
  const s = wei.toString().padStart(19, '0');
  const int = s.slice(0, -18) || '0';
  const frac = s.slice(-18).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}
