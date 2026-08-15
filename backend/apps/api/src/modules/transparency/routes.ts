import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { CampaignExpense } from '@proofnote/api-types';
import { schema, type Db } from '@proofnote/db';
import { AppError } from '../../lib/errors.js';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

/** 守恒校验：raised == spent + remaining（SPEC §57；异常告警不阻塞） */
function assertConservation(raisedWei: string, spentWei: string, remainingWei: string) {
  if (BigInt(raisedWei) !== BigInt(spentWei) + BigInt(remainingWei)) {
    console.warn('[transparency] conservation invariant violated:', { raisedWei, spentWei, remainingWei });
  }
}

export default async function transparencyRoutes(app: FastifyInstance) {
  // ── GET /campaigns/:campaignId/transparency（SPEC §25.1）──
  app.get('/campaigns/:campaignId/transparency', async (request) => {
    const db = requireDb(app);
    const { campaignId } = request.params as { campaignId: string };

    const meta = (
      await db.select().from(schema.campaignMetadata).where(eq(schema.campaignMetadata.id, campaignId)).limit(1)
    )[0];
    if (!meta) throw new AppError('CAMPAIGN_NOT_FOUND');

    const onchain = (
      await db.select().from(schema.campaigns).where(eq(schema.campaigns.campaignKey, meta.campaignKey)).limit(1)
    )[0];
    const raisedWei = onchain?.raisedWei ?? '0';
    const spentWei = onchain?.spentWei ?? '0';
    const remainingWei = (BigInt(raisedWei) - BigInt(spentWei)).toString();
    assertConservation(raisedWei, spentWei, remainingWei);

    const funding = await db
      .select()
      .from(schema.campaignFunding)
      .where(eq(schema.campaignFunding.campaignKey, meta.campaignKey))
      .orderBy(desc(schema.campaignFunding.blockTime))
      .limit(50);

    const expenseOnchain = await db
      .select()
      .from(schema.campaignExpenses)
      .where(eq(schema.campaignExpenses.campaignKey, meta.campaignKey))
      .orderBy(desc(schema.campaignExpenses.blockTime))
      .limit(50);

    // evidence 明细（链上 expense → 业务元数据匹配）
    const expenseMeta = expenseOnchain.length
      ? await db
          .select()
          .from(schema.expenseMetadata)
          .where(
            inArray(
              schema.expenseMetadata.id,
              (
                await db
                  .select({ id: schema.expenseMetadata.id })
                  .from(schema.expenseMetadata)
                  .where(eq(schema.expenseMetadata.campaignId, meta.id))
              ).map((r) => r.id),
            ),
          )
      : [];
    const mediaIds = expenseMeta.flatMap((e) => (e.evidenceMediaIds as string[]) ?? []);
    const evidenceMedia = mediaIds.length
      ? await db.select().from(schema.media).where(inArray(schema.media.id, mediaIds))
      : [];

    const expenses: CampaignExpense[] = expenseOnchain.map((e) => {
      const m = expenseMeta.find((x) => x.purposeHash === e.purposeHash && x.evidenceHash === e.evidenceHash);
      const evIds = (m?.evidenceMediaIds as string[]) ?? [];
      return {
        id: m?.id ?? `exp_${e.id}`,
        recipient: e.recipient,
        amountWei: e.amountWei,
        purpose: m?.purpose ?? '',
        evidence: evIds
          .map((id) => evidenceMedia.find((mm) => mm.id === id))
          .filter((mm): mm is (typeof evidenceMedia)[number] => Boolean(mm))
          .map((mm) => ({ mediaId: mm.id, type: mm.contentType, sha256: mm.sha256, url: mm.url })),
        txHash: e.txHash,
        explorerUrl: app.cfg.explorerUrl(e.txHash),
      };
    });

    const impact = (
      await db.select().from(schema.impactClaims).where(eq(schema.impactClaims.id, meta.impactId)).limit(1)
    )[0];
    const impactStats = impact
      ? (await db.select().from(schema.impactStats).where(eq(schema.impactStats.impactKey, impact.impactKey)).limit(1))[0]
      : undefined;

    return {
      data: {
        campaign: {
          id: meta.id,
          goal: meta.goal,
          treasuryAddress: onchain?.treasuryAddress ?? null,
        },
        summary: { raisedWei, spentWei, committedWei: '0', remainingWei },
        funding: funding.map((f) => ({
          from: f.supporter,
          amountWei: f.amountWei,
          txHash: f.txHash,
          createdAt: f.blockTime.toISOString(),
          explorerUrl: app.cfg.explorerUrl(f.txHash),
        })),
        expenses,
        verification: {
          level: impact?.verificationLevel ?? 'L0',
          evidenceCount: impactStats?.evidenceCount ?? 0,
          attestationCount: impactStats?.attestationCount ?? 0,
        },
      },
    };
  });
}
