import { encodeFunctionData } from 'viem';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TxRequest } from '@proofnote/api-types';
import { getAbi } from '@proofnote/contract-abis';
import { buildExpenseHashes } from '@proofnote/hash-utils';
import { schema, type Db } from '@proofnote/db';
import { AppError } from '../../lib/errors.js';
import { newCampaignId, newExpenseId } from '../../lib/ids.js';
import { addressSchema, parseBody, weiStringSchema } from '../../lib/validation.js';
import { insertIntent } from '../../services/mock-chain.js';
import { createImpactInternal } from '../impact/routes.js';
import { newBytes32, requireOwnedMedia } from '../notes/service.js';
import { z } from 'zod';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

function mockTx(app: FastifyInstance, functionName: string, description: string, value = '0'): TxRequest {
  return {
    chainId: app.cfg.env.CHAIN_ID,
    to: '0x0000000000000000000000000000000000000000',
    data: '0x',
    value,
    functionName,
    description,
    ...(app.cfg.isMock ? { mock: true } : {}),
  };
}

export default async function campaignRoutes(app: FastifyInstance) {
  // ── POST /campaigns（SPEC §24.1）─────────────────────────
  app.post(
    '/campaigns',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const db = requireDb(app);
      const body = parseBody(
        z.object({
          title: z.string().min(1).max(200),
          body: z.string().min(1).max(50_000),
          goal: z.string().min(1).max(500),
          targetWei: weiStringSchema.optional(),
          mediaIds: z.array(z.string()).max(9).optional(),
          evidenceMediaIds: z.array(z.string()).max(20).optional(),
        }),
        request.body,
      );

      const r = await createImpactInternal(app, {
        userId: request.user.sub,
        address: request.user.addr,
        title: body.title,
        body: body.body,
        mediaIds: body.mediaIds ?? [],
        claim: { action: body.goal, summary: body.goal },
        evidenceItems: (body.evidenceMediaIds ?? []).map((mediaId) => ({ mediaId, type: 'PHOTO' as const })),
        fundingEnabled: true,
      });

      const campaignId = newCampaignId();
      const campaignKey = newBytes32();
      await db.insert(schema.campaignMetadata).values({
        id: campaignId,
        campaignKey,
        impactId: r.impactId,
        noteId: r.note.id,
        organizerAddress: request.user.addr,
        goal: body.goal,
        targetWei: body.targetWei ?? null,
      });

      let tx: TxRequest;
      if (app.cfg.isMock) {
        await insertIntent(db, {
          userId: request.user.sub,
          kind: 'CAMPAIGN_CREATE',
          entityId: campaignId,
          params: { impactKey: r.impactKey },
        });
        tx = mockTx(app, 'createCampaign', 'Create campaign treasury');
      } else {
        const factory = app.cfg.contracts.campaignTreasuryFactory;
        if (!factory) throw new AppError('CHAIN_NOT_CONFIGURED', 'CampaignTreasuryFactory not configured');
        tx = {
          chainId: app.cfg.env.CHAIN_ID,
          to: factory as `0x${string}`,
          data: encodeFunctionData({
            abi: getAbi('campaignTreasuryFactory'),
            functionName: 'createCampaign',
            args: [campaignKey as `0x${string}`, r.impactKey as `0x${string}`],
          }),
          value: '0',
          functionName: 'createCampaign',
          description: 'Create campaign treasury',
        };
      }

      return reply.code(201).send({
        data: {
          campaign: { id: campaignId, campaignKey, goal: body.goal, targetWei: body.targetWei ?? null },
          note: { id: r.note.id, noteKey: r.note.noteKey, type: r.note.type, status: r.note.status },
          impact: { id: r.impactId, claimHash: r.claimHash },
          treasuryTx: tx,
        },
      });
    },
  );

  // ── GET /campaigns/:campaignId（SPEC §24.2）──────────────
  app.get('/campaigns/:campaignId', async (request) => {
    const db = requireDb(app);
    const { campaignId } = request.params as { campaignId: string };
    const meta = (
      await db.select().from(schema.campaignMetadata).where(eq(schema.campaignMetadata.id, campaignId)).limit(1)
    )[0];
    if (!meta) throw new AppError('CAMPAIGN_NOT_FOUND');

    const onchain = (
      await db.select().from(schema.campaigns).where(eq(schema.campaigns.campaignKey, meta.campaignKey)).limit(1)
    )[0];
    const impact = (
      await db.select().from(schema.impactClaims).where(eq(schema.impactClaims.id, meta.impactId)).limit(1)
    )[0];

    const raisedWei = onchain?.raisedWei ?? '0';
    const spentWei = onchain?.spentWei ?? '0';
    const remainingWei = (BigInt(raisedWei) - BigInt(spentWei)).toString();

    return {
      data: {
        id: meta.id,
        noteId: meta.noteId,
        impactId: meta.impactId,
        organizer: meta.organizerAddress,
        treasuryAddress: onchain?.treasuryAddress ?? null,
        goal: meta.goal,
        targetWei: meta.targetWei,
        raisedWei,
        spentWei,
        committedWei: '0',
        remainingWei,
        status: 'OPEN',
        expenseCount: (
          await db
            .select({ id: schema.campaignExpenses.id })
            .from(schema.campaignExpenses)
            .where(eq(schema.campaignExpenses.campaignKey, meta.campaignKey))
        ).length,
        verification: { level: impact?.verificationLevel ?? 'L0', attestationCount: 0 },
      },
    };
  });

  // ── POST /campaigns/:campaignId/fund/prepare（SPEC §24.3）─
  app.post(
    '/campaigns/:campaignId/fund/prepare',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const db = requireDb(app);
      const { campaignId } = request.params as { campaignId: string };
      const body = parseBody(z.object({ amountWei: weiStringSchema }), request.body);

      const meta = (
        await db.select().from(schema.campaignMetadata).where(eq(schema.campaignMetadata.id, campaignId)).limit(1)
      )[0];
      if (!meta) throw new AppError('CAMPAIGN_NOT_FOUND');
      const onchain = (
        await db.select().from(schema.campaigns).where(eq(schema.campaigns.campaignKey, meta.campaignKey)).limit(1)
      )[0];

      if (app.cfg.isMock) {
        await insertIntent(db, {
          userId: request.user.sub,
          kind: 'CAMPAIGN_FUND',
          entityId: campaignId,
          params: { campaignKey: meta.campaignKey, amountWei: body.amountWei },
        });
        return { data: { tx: mockTx(app, 'fund', 'Fund campaign', body.amountWei) } };
      }

      const treasury = onchain?.treasuryAddress;
      if (!treasury) throw new AppError('CAMPAIGN_NOT_FOUND', 'treasury not deployed yet (indexing)');
      return {
        data: {
          tx: {
            chainId: app.cfg.env.CHAIN_ID,
            to: treasury as `0x${string}`,
            data: encodeFunctionData({ abi: getAbi('campaignTreasury'), functionName: 'fund' }),
            value: body.amountWei,
            functionName: 'fund',
            description: 'Fund campaign',
          },
        },
      };
    },
  );

  // ── POST /campaigns/:campaignId/expenses/prepare（SPEC §24.4）
  app.post(
    '/campaigns/:campaignId/expenses/prepare',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const db = requireDb(app);
      const { campaignId } = request.params as { campaignId: string };
      const body = parseBody(
        z.object({
          recipient: addressSchema,
          amountWei: weiStringSchema,
          purpose: z.string().min(1).max(500),
          evidenceMediaIds: z.array(z.string()).max(10).optional(),
        }),
        request.body,
      );

      const meta = (
        await db.select().from(schema.campaignMetadata).where(eq(schema.campaignMetadata.id, campaignId)).limit(1)
      )[0];
      if (!meta) throw new AppError('CAMPAIGN_NOT_FOUND');
      if (meta.organizerAddress !== request.user.addr) throw new AppError('CAMPAIGN_NOT_ORGANIZER');

      const amount = BigInt(body.amountWei);
      if (amount <= 0n) throw new AppError('CAMPAIGN_INVALID_EXPENSE', 'amount must be positive');

      const onchain = (
        await db.select().from(schema.campaigns).where(eq(schema.campaigns.campaignKey, meta.campaignKey)).limit(1)
      )[0];
      if (onchain) {
        const remaining = BigInt(onchain.raisedWei) - BigInt(onchain.spentWei);
        if (amount > remaining) {
          throw new AppError('CAMPAIGN_INSUFFICIENT_BALANCE', `remaining ${remaining.toString()}`);
        }
      }

      const evidenceMedia = await requireOwnedMedia(db, body.evidenceMediaIds ?? [], request.user.sub);
      const { purposeHash, evidenceHash } = buildExpenseHashes({
        purpose: body.purpose,
        evidenceSha256List: evidenceMedia.map((m) => m.sha256 ?? m.id),
      });

      const expenseId = newExpenseId();
      await db.insert(schema.expenseMetadata).values({
        id: expenseId,
        campaignId,
        recipient: body.recipient,
        amountWei: body.amountWei,
        purpose: body.purpose,
        purposeHash,
        evidenceHash,
        evidenceMediaIds: body.evidenceMediaIds ?? [],
        status: 'PENDING',
      });

      if (app.cfg.isMock) {
        await insertIntent(db, {
          userId: request.user.sub,
          kind: 'CAMPAIGN_SPEND',
          entityId: expenseId,
          params: {},
        });
        return reply.code(201).send({
          data: {
            expense: { id: expenseId, purposeHash, evidenceHash },
            tx: mockTx(app, 'spend', 'Record campaign expense'),
          },
        });
      }

      const treasury = onchain?.treasuryAddress;
      if (!treasury) throw new AppError('CAMPAIGN_NOT_FOUND', 'treasury not deployed yet (indexing)');
      return reply.code(201).send({
        data: {
          expense: { id: expenseId, purposeHash, evidenceHash },
          tx: {
            chainId: app.cfg.env.CHAIN_ID,
            to: treasury as `0x${string}`,
            data: encodeFunctionData({
              abi: getAbi('campaignTreasury'),
              functionName: 'spend',
              args: [body.recipient as `0x${string}`, amount, purposeHash as `0x${string}`, evidenceHash as `0x${string}`],
            }),
            value: '0',
            functionName: 'spend',
            description: 'Record campaign expense',
          },
        },
      });
    },
  );
}
