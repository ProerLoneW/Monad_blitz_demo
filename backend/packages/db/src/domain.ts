import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from './index.js';
import {
  attestations,
  campaignExpenses,
  campaignFunding,
  campaigns,
  creatorValueStats,
  expenseMetadata,
  impactClaims,
  impactEvidence,
  impactStats,
  impactsOnchain,
  notes,
  notesOnchain,
  streamCredits,
  streams,
  tips,
  trackedTransactions,
} from './schema.js';

/**
 * 领域操作：单一事件 → 读模型/状态推进的唯一实现。
 * apps/indexer（真实链事件）与 apps/api 的 mock-chain 模拟器共用本层，
 * 保证两条路径的数据形态完全一致（后端开发文档 §5.5）。
 * 所有更新均带状态前置条件，天然幂等、可并发。
 */

export function nowTs(): Date {
  return new Date();
}

export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── 通用 ────────────────────────────────────────────────────

/** 任何事件被处理后：推进同 hash 的 SUBMITTED 跟踪交易（§5.5.3 catch-all） */
export async function confirmTrackedTx(db: Db, txHash: string, blockNumber?: string): Promise<void> {
  await db
    .update(trackedTransactions)
    .set({ status: 'CONFIRMED', blockNumber: blockNumber ?? null, updatedAt: nowTs() })
    .where(and(eq(trackedTransactions.txHash, txHash), eq(trackedTransactions.status, 'SUBMITTED')));
}

// ── Note / Impact 发布 ─────────────────────────────────────

export async function publishNote(
  db: Db,
  p: { noteKey: string; creator: string; contentHash: string; manifestUri: string; txHash: string; registeredAt: Date; blockNumber?: string },
): Promise<void> {
  await db
    .insert(notesOnchain)
    .values({
      noteKey: p.noteKey,
      creator: p.creator.toLowerCase(),
      contentHash: p.contentHash,
      manifestUri: p.manifestUri,
      registeredAt: p.registeredAt,
      txHash: p.txHash,
    })
    .onConflictDoNothing();
  await db
    .update(notes)
    .set({ status: 'PUBLISHED', publishedAt: p.registeredAt })
    .where(and(eq(notes.noteKey, p.noteKey), eq(notes.status, 'PENDING_ANCHOR')));
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}

export async function publishImpact(
  db: Db,
  p: {
    impactKey: string;
    noteKey: string;
    creator: string;
    claimHash: string;
    evidenceManifestHash: string;
    manifestUri: string;
    txHash: string;
    registeredAt: Date;
    blockNumber?: string;
  },
): Promise<void> {
  await db
    .insert(impactsOnchain)
    .values({
      impactKey: p.impactKey,
      noteKey: p.noteKey,
      creator: p.creator.toLowerCase(),
      claimHash: p.claimHash,
      currentManifestHash: p.evidenceManifestHash,
      currentVersion: 1,
      registeredAt: p.registeredAt,
      txHash: p.txHash,
    })
    .onConflictDoNothing();
  // Impact Note 的 PUBLISHED 由 ImpactRegistered 驱动（SPEC §20.1 anchor 为 ImpactRegistry）
  await db
    .update(notes)
    .set({ status: 'PUBLISHED', publishedAt: p.registeredAt })
    .where(and(eq(notes.noteKey, p.noteKey), eq(notes.status, 'PENDING_ANCHOR')));
  await recomputeImpactLevel(db, p.impactKey);
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}

export async function applyEvidenceManifestUpdate(
  db: Db,
  p: { impactKey: string; version: number; evidenceManifestHash: string; manifestUri: string; txHash: string; blockNumber?: string },
): Promise<void> {
  await db
    .update(impactsOnchain)
    .set({ currentManifestHash: p.evidenceManifestHash, currentVersion: p.version })
    .where(eq(impactsOnchain.impactKey, p.impactKey));
  await recomputeImpactLevel(db, p.impactKey);
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}

// ── Tip ─────────────────────────────────────────────────────

export async function applyTip(
  db: Db,
  p: {
    noteKey: string;
    supporter: string;
    creator: string;
    grossWei: string;
    protocolFeeWei: string;
    creatorAmountWei: string;
    txHash: string;
    blockTime: Date;
    blockNumber?: string;
  },
): Promise<void> {
  const inserted = await db
    .insert(tips)
    .values({
      noteKey: p.noteKey,
      supporter: p.supporter.toLowerCase(),
      creator: p.creator.toLowerCase(),
      grossWei: p.grossWei,
      protocolFeeWei: p.protocolFeeWei,
      creatorAmountWei: p.creatorAmountWei,
      txHash: p.txHash,
      blockTime: p.blockTime,
    })
    .onConflictDoNothing()
    .returning({ id: tips.id });
  if (inserted.length > 0) {
    await db
      .insert(creatorValueStats)
      .values({ creator: p.creator.toLowerCase(), day: toDay(p.blockTime), tipIncomeWei: p.creatorAmountWei })
      .onConflictDoUpdate({
        target: [creatorValueStats.creator, creatorValueStats.day],
        set: {
          tipIncomeWei: sql`(${creatorValueStats.tipIncomeWei}::numeric + excluded.tip_income_wei::numeric)::text`,
        },
      });
  }
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}

// ── Stream ──────────────────────────────────────────────────

export async function applyStreamCreate(
  db: Db,
  p: {
    streamId: string;
    noteKey: string;
    fan: string;
    creator: string;
    rateWeiPerSecond: string;
    budgetWei: string;
    txHash: string;
    blockTime: Date;
    blockNumber?: string;
  },
): Promise<void> {
  await db
    .insert(streams)
    .values({
      streamId: p.streamId,
      noteKey: p.noteKey,
      fan: p.fan.toLowerCase(),
      creator: p.creator.toLowerCase(),
      rateWeiPerSecond: p.rateWeiPerSecond,
      budgetWei: p.budgetWei,
      status: 'ACTIVE',
      accruedStoredWei: '0',
      activeSince: p.blockTime,
      createdAt: p.blockTime,
    })
    .onConflictDoNothing();
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}

export async function applyStreamPause(
  db: Db,
  p: { streamId: string; accruedWei: string; txHash: string; blockTime: Date; blockNumber?: string },
): Promise<void> {
  await db
    .update(streams)
    .set({ status: 'PAUSED', accruedStoredWei: p.accruedWei, activeSince: null })
    .where(and(eq(streams.streamId, p.streamId), eq(streams.status, 'ACTIVE')));
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}

export async function applyStreamResume(
  db: Db,
  p: { streamId: string; txHash: string; blockTime: Date; blockNumber?: string },
): Promise<void> {
  await db
    .update(streams)
    .set({ status: 'ACTIVE', activeSince: p.blockTime })
    .where(and(eq(streams.streamId, p.streamId), eq(streams.status, 'PAUSED')));
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}

export async function applyStreamSettle(
  db: Db,
  p: {
    streamId: string;
    accruedWei: string;
    creatorCreditWei: string;
    fanRefundWei: string;
    protocolFeeWei: string;
    feeRecipient?: string;
    txHash: string;
    blockTime: Date;
    blockNumber?: string;
  },
): Promise<void> {
  const updated = await db
    .update(streams)
    .set({
      status: 'SETTLED',
      settledAccruedWei: p.accruedWei,
      settledCreatorCreditWei: p.creatorCreditWei,
      settledFanRefundWei: p.fanRefundWei,
      settledProtocolFeeWei: p.protocolFeeWei,
      activeSince: null,
      settledAt: p.blockTime,
    })
    .where(and(eq(streams.streamId, p.streamId), ne(streams.status, 'SETTLED')))
    .returning({ creator: streams.creator, fan: streams.fan });

  if (updated.length > 0) {
    const bumpCredit = async (account: string, amountWei: string) => {
      if (BigInt(amountWei) <= 0n) return;
      await db
        .insert(streamCredits)
        .values({ account: account.toLowerCase(), creditWei: amountWei })
        .onConflictDoUpdate({
          target: streamCredits.account,
          set: { creditWei: sql`(${streamCredits.creditWei}::numeric + excluded.credit_wei::numeric)::text` },
        });
    };
    await bumpCredit(updated[0]!.creator, p.creatorCreditWei);
    await bumpCredit(updated[0]!.fan, p.fanRefundWei);
    if (p.feeRecipient) await bumpCredit(p.feeRecipient, p.protocolFeeWei);
    // creator 收入统计（stream 部分按结算日聚合）
    await db
      .insert(creatorValueStats)
      .values({ creator: updated[0]!.creator, day: toDay(p.blockTime), streamIncomeWei: p.creatorCreditWei })
      .onConflictDoUpdate({
        target: [creatorValueStats.creator, creatorValueStats.day],
        set: {
          streamIncomeWei: sql`(${creatorValueStats.streamIncomeWei}::numeric + excluded.stream_income_wei::numeric)::text`,
        },
      });
  }
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}

export async function applyCreditWithdrawn(
  db: Db,
  p: { account: string; amountWei: string; txHash: string },
): Promise<void> {
  await db
    .update(streamCredits)
    .set({ creditWei: sql`greatest(${streamCredits.creditWei}::numeric - ${BigInt(p.amountWei)}::numeric, 0)::text` })
    .where(eq(streamCredits.account, p.account.toLowerCase()));
  await confirmTrackedTx(db, p.txHash);
}

/** 读模型快照 → 任意时刻推导（后端开发文档 §5.6，与 SPEC §18 前端规则同口径） */
export function deriveStreamView(row: {
  status: string;
  accruedStoredWei: string;
  activeSince: Date | null;
  rateWeiPerSecond: string;
  budgetWei: string;
  settledAccruedWei: string | null;
}, now = new Date()): { accruedWei: string; remainingBudgetWei: string; status: 'ACTIVE' | 'PAUSED' | 'DEPLETED' | 'SETTLED' } {
  const budget = BigInt(row.budgetWei);
  const rate = BigInt(row.rateWeiPerSecond);
  if (row.status === 'ACTIVE' && row.activeSince) {
    const elapsed = BigInt(Math.max(0, Math.floor((now.getTime() - row.activeSince.getTime()) / 1000)));
    const accrued = BigInt(row.accruedStoredWei) + elapsed * rate;
    const capped = accrued > budget ? budget : accrued;
    return {
      accruedWei: capped.toString(),
      remainingBudgetWei: (budget - capped).toString(),
      status: capped >= budget ? 'DEPLETED' : 'ACTIVE',
    };
  }
  if (row.status === 'SETTLED') {
    const accrued = BigInt(row.settledAccruedWei ?? row.accruedStoredWei);
    return { accruedWei: accrued.toString(), remainingBudgetWei: '0', status: 'SETTLED' };
  }
  const accrued = BigInt(row.accruedStoredWei);
  return {
    accruedWei: accrued.toString(),
    remainingBudgetWei: (budget - accrued).toString(),
    status: row.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
  };
}

// ── Attestation / Impact level ─────────────────────────────

export async function applyAttestation(
  db: Db,
  p: {
    impactKey: string;
    attester: string;
    attestationType: string; // PARTICIPATED | WITNESSED
    statementHash: string;
    txHash: string;
    blockTime: Date;
    blockNumber?: string;
  },
): Promise<void> {
  const inserted = await db
    .insert(attestations)
    .values({
      impactKey: p.impactKey,
      attester: p.attester.toLowerCase(),
      attestationType: p.attestationType,
      statementHash: p.statementHash,
      txHash: p.txHash,
      blockTime: p.blockTime,
    })
    .onConflictDoNothing()
    .returning({ id: attestations.id });
  if (inserted.length > 0) {
    await db
      .insert(impactStats)
      .values({ impactKey: p.impactKey, evidenceCount: 0, attestationCount: 1, independentAttestationCount: 0 })
      .onConflictDoUpdate({
        target: impactStats.impactKey,
        set: { attestationCount: sql`${impactStats.attestationCount} + 1`, updatedAt: nowTs() },
      });
  }
  await recomputeImpactLevel(db, p.impactKey);
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}

/**
 * SPEC §58：L0=claim；L1=+evidence；L2=+independent attestation（作者自己的不计入）。
 * L3/L4 永不自动授予。
 */
export async function recomputeImpactLevel(db: Db, impactKey: string): Promise<'L0' | 'L1' | 'L2'> {
  const impact = (await db.select().from(impactClaims).where(eq(impactClaims.impactKey, impactKey)).limit(1))[0];
  if (!impact) return 'L0';
  const evidenceRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(impactEvidence)
    .where(eq(impactEvidence.impactId, impact.id));
  const evidenceCount = evidenceRows[0]?.count ?? 0;
  const attRows = await db
    .select({
      total: sql<number>`count(*)::int`,
      independent: sql<number>`count(*) filter (where ${attestations.attester} <> ${impact.authorAddress})::int`,
    })
    .from(attestations)
    .where(eq(attestations.impactKey, impactKey));
  const attestationCount = attRows[0]?.total ?? 0;
  const independentCount = attRows[0]?.independent ?? 0;

  await db
    .insert(impactStats)
    .values({
      impactKey,
      evidenceCount,
      attestationCount,
      independentAttestationCount: independentCount,
      updatedAt: nowTs(),
    })
    .onConflictDoUpdate({
      target: impactStats.impactKey,
      set: { evidenceCount, attestationCount, independentAttestationCount: independentCount, updatedAt: nowTs() },
    });

  let level: 'L0' | 'L1' | 'L2' = 'L0';
  if (evidenceCount >= 1) level = 'L1';
  if (evidenceCount >= 1 && independentCount >= 1) level = 'L2';
  await db.update(impactClaims).set({ verificationLevel: level }).where(eq(impactClaims.id, impact.id));
  return level;
}

// ── Campaign ────────────────────────────────────────────────

export async function applyCampaignCreate(
  db: Db,
  p: { campaignKey: string; impactKey: string; organizer: string; treasuryAddress: string; txHash: string; blockTime: Date; blockNumber?: string },
): Promise<void> {
  await db
    .insert(campaigns)
    .values({
      campaignKey: p.campaignKey,
      impactKey: p.impactKey,
      organizer: p.organizer.toLowerCase(),
      treasuryAddress: p.treasuryAddress.toLowerCase(),
      createdAt: p.blockTime,
    })
    .onConflictDoNothing();
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}

export async function applyCampaignFunded(
  db: Db,
  p: { campaignKey: string; supporter: string; amountWei: string; txHash: string; blockTime: Date; blockNumber?: string },
): Promise<void> {
  const inserted = await db
    .insert(campaignFunding)
    .values({
      campaignKey: p.campaignKey,
      supporter: p.supporter.toLowerCase(),
      amountWei: p.amountWei,
      txHash: p.txHash,
      blockTime: p.blockTime,
    })
    .onConflictDoNothing()
    .returning({ id: campaignFunding.id });
  if (inserted.length > 0) {
    await db
      .update(campaigns)
      .set({ raisedWei: sql`(${campaigns.raisedWei}::numeric + ${BigInt(p.amountWei)}::numeric)::text` })
      .where(eq(campaigns.campaignKey, p.campaignKey));
  }
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}

export async function applyCampaignSpent(
  db: Db,
  p: {
    campaignKey: string;
    recipient: string;
    amountWei: string;
    purposeHash: string;
    evidenceHash: string;
    txHash: string;
    blockTime: Date;
    blockNumber?: string;
  },
): Promise<void> {
  const inserted = await db
    .insert(campaignExpenses)
    .values({
      campaignKey: p.campaignKey,
      recipient: p.recipient.toLowerCase(),
      amountWei: p.amountWei,
      purposeHash: p.purposeHash,
      evidenceHash: p.evidenceHash,
      txHash: p.txHash,
      blockTime: p.blockTime,
    })
    .onConflictDoNothing()
    .returning({ id: campaignExpenses.id });
  if (inserted.length > 0) {
    await db
      .update(campaigns)
      .set({ spentWei: sql`(${campaigns.spentWei}::numeric + ${BigInt(p.amountWei)}::numeric)::text` })
      .where(eq(campaigns.campaignKey, p.campaignKey));
    // 匹配 PENDING 的 expense（api 在 expenses/prepare 写入）并确认
    await db
      .update(expenseMetadata)
      .set({ status: 'CONFIRMED', txHash: p.txHash })
      .where(
        and(
          eq(expenseMetadata.purposeHash, p.purposeHash),
          eq(expenseMetadata.evidenceHash, p.evidenceHash),
          eq(expenseMetadata.status, 'PENDING'),
        ),
      );
  }
  await confirmTrackedTx(db, p.txHash, p.blockNumber);
}
