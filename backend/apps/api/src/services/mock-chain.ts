import { and, desc, eq, sql } from 'drizzle-orm';
import type { ChainConfig } from '@proofnote/chain-config';
import { domain, schema, type Db } from '@proofnote/db';
import { keccak256, stringToHex } from 'viem';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import type { ChainService } from './chain.js';

/**
 * MOCK_CHAIN 模拟器（后端开发文档 M1 / §4 模块的 mock 行为）。
 *
 * prepare 端点在 mock 模式下写入 prepare_intents；
 * /transactions/track 消费意图并调用 packages/db 的 domain 层——
 * 与真实 Indexer 共用同一套落库逻辑，保证两种模式数据形态一致。
 */
export async function insertIntent(
  db: Db,
  p: { userId: string; kind: string; entityId?: string | null; params: Record<string, unknown> },
): Promise<void> {
  await db.insert(schema.prepareIntents).values({
    id: newId('intent'),
    userId: p.userId,
    kind: p.kind,
    entityId: p.entityId ?? null,
    paramsJson: p.params,
  });
}

async function consumeIntent(
  db: Db,
  p: { userId: string; kind: string; entityId?: string | null },
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(schema.prepareIntents)
    .where(
      and(
        eq(schema.prepareIntents.userId, p.userId),
        eq(schema.prepareIntents.kind, p.kind),
        eq(schema.prepareIntents.consumed, false),
        p.entityId ? eq(schema.prepareIntents.entityId, p.entityId) : undefined,
      ),
    )
    .orderBy(desc(schema.prepareIntents.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await db.update(schema.prepareIntents).set({ consumed: true }).where(eq(schema.prepareIntents.id, row.id));
  return row.paramsJson as Record<string, unknown>;
}

export async function applyMockTrack(
  db: Db,
  cfg: ChainConfig,
  chain: ChainService,
  p: { userId: string; userAddr: string; kind: string; txHash: string; entityType?: string | null; entityId?: string | null },
): Promise<void> {
  const now = new Date();
  const entityId = p.entityId ?? null;
  const params = await consumeIntent(db, { userId: p.userId, kind: p.kind, entityId });
  const param = (k: string): string => {
    const v = params?.[k];
    if (typeof v !== 'string') throw new AppError('CHAIN_NOT_CONFIGURED', `mock intent missing param: ${k}`);
    return v;
  };
  const optParam = (k: string): string | undefined => (typeof params?.[k] === 'string' ? (params![k] as string) : undefined);

  switch (p.kind) {
    case 'ANCHOR': {
      const note = (await db.select().from(schema.notes).where(eq(schema.notes.id, entityId ?? '')).limit(1))[0];
      if (!note) throw new AppError('NOTE_NOT_FOUND');
      if (note.status !== 'PENDING_ANCHOR') return; // 已发布，幂等
      await domain.publishNote(db, {
        noteKey: note.noteKey,
        creator: note.authorAddress,
        contentHash: note.contentHash ?? '0x' + '0'.repeat(64),
        manifestUri: note.manifestUri ?? '',
        txHash: p.txHash,
        registeredAt: now,
      });
      return;
    }
    case 'IMPACT_ANCHOR': {
      const impact = (await db.select().from(schema.impactClaims).where(eq(schema.impactClaims.id, entityId ?? '')).limit(1))[0];
      if (!impact) throw new AppError('IMPACT_NOT_FOUND');
      const note = (await db.select().from(schema.notes).where(eq(schema.notes.id, impact.noteId)).limit(1))[0];
      if (!note || note.status === 'PUBLISHED') return;
      const manifest = (
        await db
          .select()
          .from(schema.impactManifests)
          .where(eq(schema.impactManifests.impactId, impact.id))
          .orderBy(desc(schema.impactManifests.version))
          .limit(1)
      )[0];
      await domain.publishImpact(db, {
        impactKey: impact.impactKey,
        noteKey: note.noteKey,
        creator: note.authorAddress,
        claimHash: impact.claimHash,
        evidenceManifestHash: manifest?.evidenceManifestHash ?? '0x' + '0'.repeat(64),
        manifestUri: manifest?.manifestUri ?? '',
        txHash: p.txHash,
        registeredAt: now,
      });
      return;
    }
    case 'EVIDENCE_UPDATE': {
      const impactKey = param('impactKey');
      await domain.applyEvidenceManifestUpdate(db, {
        impactKey,
        version: Number(param('version')),
        evidenceManifestHash: param('hash'),
        manifestUri: param('uri'),
        txHash: p.txHash,
      });
      return;
    }
    case 'TIP': {
      const noteKey = param('noteKey');
      const gross = BigInt(param('amountWei'));
      const bps = await chain.getFeeBps();
      const fee = (gross * BigInt(bps)) / 10000n;
      await domain.applyTip(db, {
        noteKey,
        supporter: p.userAddr,
        creator: param('creator'),
        grossWei: gross.toString(),
        protocolFeeWei: fee.toString(),
        creatorAmountWei: (gross - fee).toString(),
        txHash: p.txHash,
        blockTime: now,
      });
      return;
    }
    case 'STREAM_CREATE': {
      const rate = BigInt(param('rateWeiPerSecond'));
      const budget = BigInt(param('budgetWei'));
      const maxId = await db
        .select({ maxId: sql<string | null>`max(${schema.streams.streamId}::numeric)::text` })
        .from(schema.streams);
      const nextId = (BigInt(maxId[0]?.maxId ?? '0') + 1n).toString();
      await domain.applyStreamCreate(db, {
        streamId: nextId,
        noteKey: param('noteKey'),
        fan: p.userAddr,
        creator: param('creator'),
        rateWeiPerSecond: rate.toString(),
        budgetWei: budget.toString(),
        txHash: p.txHash,
        blockTime: now,
      });
      return;
    }
    case 'STREAM_PAUSE':
    case 'STREAM_RESUME':
    case 'STREAM_STOP': {
      const streamId = entityId ?? param('streamId');
      const stream = (await db.select().from(schema.streams).where(eq(schema.streams.streamId, streamId)).limit(1))[0];
      if (!stream) throw new AppError('STREAM_NOT_FOUND');
      const view = domain.deriveStreamView(stream, now);
      if (p.kind === 'STREAM_PAUSE') {
        await domain.applyStreamPause(db, { streamId, accruedWei: view.accruedWei, txHash: p.txHash, blockTime: now });
        return;
      }
      if (p.kind === 'STREAM_RESUME') {
        await domain.applyStreamResume(db, { streamId, txHash: p.txHash, blockTime: now });
        return;
      }
      const bps = await chain.getFeeBps();
      const accrued = BigInt(view.accruedWei);
      const fee = (accrued * BigInt(bps)) / 10000n;
      const refund = BigInt(stream.budgetWei) - accrued;
      await domain.applyStreamSettle(db, {
        streamId,
        accruedWei: accrued.toString(),
        creatorCreditWei: (accrued - fee).toString(),
        fanRefundWei: refund.toString(),
        protocolFeeWei: fee.toString(),
        feeRecipient: cfg.env.PROTOCOL_FEE_RECIPIENT,
        txHash: p.txHash,
        blockTime: now,
      });
      return;
    }
    case 'STREAM_WITHDRAW': {
      const credit = (
        await db.select().from(schema.streamCredits).where(eq(schema.streamCredits.account, p.userAddr)).limit(1)
      )[0];
      if (!credit || BigInt(credit.creditWei) <= 0n) return;
      await domain.applyCreditWithdrawn(db, { account: p.userAddr, amountWei: credit.creditWei, txHash: p.txHash });
      return;
    }
    case 'ATTEST': {
      await domain.applyAttestation(db, {
        impactKey: param('impactKey'),
        attester: p.userAddr,
        attestationType: param('type'),
        statementHash: param('statementHash'),
        txHash: p.txHash,
        blockTime: now,
      });
      return;
    }
    case 'CAMPAIGN_CREATE': {
      const campaign = (
        await db.select().from(schema.campaignMetadata).where(eq(schema.campaignMetadata.id, entityId ?? '')).limit(1)
      )[0];
      if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND');
      await domain.applyCampaignCreate(db, {
        campaignKey: campaign.campaignKey,
        impactKey: optParam('impactKey') ?? (await impactKeyOf(db, campaign.impactId)),
        organizer: campaign.organizerAddress,
        treasuryAddress: mockTreasuryAddress(campaign.campaignKey),
        txHash: p.txHash,
        blockTime: now,
      });
      return;
    }
    case 'CAMPAIGN_FUND': {
      await domain.applyCampaignFunded(db, {
        campaignKey: param('campaignKey'),
        supporter: p.userAddr,
        amountWei: param('amountWei'),
        txHash: p.txHash,
        blockTime: now,
      });
      return;
    }
    case 'CAMPAIGN_SPEND': {
      const expense = (
        await db.select().from(schema.expenseMetadata).where(eq(schema.expenseMetadata.id, entityId ?? '')).limit(1)
      )[0];
      if (!expense) throw new AppError('CAMPAIGN_INVALID_EXPENSE');
      const campaign = (
        await db.select().from(schema.campaignMetadata).where(eq(schema.campaignMetadata.id, expense.campaignId)).limit(1)
      )[0];
      if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND');
      await domain.applyCampaignSpent(db, {
        campaignKey: campaign.campaignKey,
        recipient: expense.recipient,
        amountWei: expense.amountWei,
        purposeHash: expense.purposeHash,
        evidenceHash: expense.evidenceHash,
        txHash: p.txHash,
        blockTime: now,
      });
      return;
    }
    default:
      // 未识别 kind：仅记录交易，无副作用
      return;
  }
}

async function impactKeyOf(db: Db, impactId: string): Promise<string> {
  const impact = (await db.select().from(schema.impactClaims).where(eq(schema.impactClaims.id, impactId)).limit(1))[0];
  if (!impact) throw new AppError('IMPACT_NOT_FOUND');
  return impact.impactKey;
}

/** 确定性伪 treasury 地址（仅 mock 模式使用，形如合法 EVM 地址） */
export function mockTreasuryAddress(seed: string): string {
  const hash = keccak256(stringToHex(seed));
  return '0x' + hash.slice(26);
}
