import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@proofnote/db';
import { schema } from '@proofnote/db';

/**
 * 聚合查询服务——全部走读模型/业务表的 SQL 聚合（demo 规模足够；规模化后由统计表直读）。
 */

export interface NoteValueAgg {
  tipsGrossWei: string;
  tipsCreatorWei: string;
  settledStreamWei: string;
  activeStreams: number;
  incomingRateWei: string;
  supporterCount: number;
}

export async function noteValueAggregates(db: Db, noteKeys: string[]): Promise<Map<string, NoteValueAgg>> {
  const result = new Map<string, NoteValueAgg>();
  if (noteKeys.length === 0) return result;
  for (const k of noteKeys) {
    result.set(k, {
      tipsGrossWei: '0',
      tipsCreatorWei: '0',
      settledStreamWei: '0',
      activeStreams: 0,
      incomingRateWei: '0',
      supporterCount: 0,
    });
  }

  const tipRows = await db
    .select({
      noteKey: schema.tips.noteKey,
      gross: sql<string>`coalesce(sum(${schema.tips.grossWei}::numeric), 0)::text`,
      creator: sql<string>`coalesce(sum(${schema.tips.creatorAmountWei}::numeric), 0)::text`,
      supporters: sql<number>`count(distinct ${schema.tips.supporter})::int`,
    })
    .from(schema.tips)
    .where(inArray(schema.tips.noteKey, noteKeys))
    .groupBy(schema.tips.noteKey);
  for (const r of tipRows) {
    const agg = result.get(r.noteKey);
    if (agg) {
      agg.tipsGrossWei = r.gross;
      agg.tipsCreatorWei = r.creator;
      agg.supporterCount = r.supporters;
    }
  }

  const settledRows = await db
    .select({
      noteKey: schema.streams.noteKey,
      settled: sql<string>`coalesce(sum(${schema.streams.settledCreatorCreditWei}::numeric), 0)::text`,
    })
    .from(schema.streams)
    .where(and(inArray(schema.streams.noteKey, noteKeys), eq(schema.streams.status, 'SETTLED')))
    .groupBy(schema.streams.noteKey);
  for (const r of settledRows) {
    const agg = result.get(r.noteKey);
    if (agg) agg.settledStreamWei = r.settled;
  }

  const activeRows = await db
    .select({
      noteKey: schema.streams.noteKey,
      count: sql<number>`count(*)::int`,
      rate: sql<string>`coalesce(sum(${schema.streams.rateWeiPerSecond}::numeric), 0)::text`,
    })
    .from(schema.streams)
    .where(and(inArray(schema.streams.noteKey, noteKeys), eq(schema.streams.status, 'ACTIVE')))
    .groupBy(schema.streams.noteKey);
  for (const r of activeRows) {
    const agg = result.get(r.noteKey);
    if (agg) {
      agg.activeStreams = r.count;
      agg.incomingRateWei = r.rate;
    }
  }
  return result;
}

export interface ImpactView {
  impactId: string;
  impactKey: string;
  claimHash: string;
  verificationLevel: string;
  evidenceCount: number;
  attestationCount: number;
}

/** noteIds → impact 摘要（Feed badge / Note detail 用） */
export async function impactViewsByNoteIds(db: Db, noteIds: string[]): Promise<Map<string, ImpactView>> {
  const map = new Map<string, ImpactView>();
  if (noteIds.length === 0) return map;
  const rows = await db
    .select({
      noteId: schema.impactClaims.noteId,
      impactId: schema.impactClaims.id,
      impactKey: schema.impactClaims.impactKey,
      claimHash: schema.impactClaims.claimHash,
      level: schema.impactClaims.verificationLevel,
      evidenceCount: schema.impactStats.evidenceCount,
      attestationCount: schema.impactStats.attestationCount,
    })
    .from(schema.impactClaims)
    .leftJoin(schema.impactStats, eq(schema.impactStats.impactKey, schema.impactClaims.impactKey))
    .where(inArray(schema.impactClaims.noteId, noteIds));
  for (const r of rows) {
    map.set(r.noteId, {
      impactId: r.impactId,
      impactKey: r.impactKey,
      claimHash: r.claimHash,
      verificationLevel: r.level,
      evidenceCount: r.evidenceCount ?? 0,
      attestationCount: r.attestationCount ?? 0,
    });
  }
  return map;
}

export interface ProfileStatsView {
  notes: number;
  monetizedNotes: number;
  creatorRevenueWei: string;
  impactNotes: number;
  attestationsReceived: number;
}

export async function profileStats(db: Db, address: string): Promise<ProfileStatsView> {
  const noteAgg = (
    await db
      .select({
        notes: sql<number>`count(*) filter (where ${schema.notes.type} in ('STANDARD','MONETIZED'))::int`,
        monetized: sql<number>`count(*) filter (where ${schema.notes.type} = 'MONETIZED')::int`,
        impact: sql<number>`count(*) filter (where ${schema.notes.type} in ('IMPACT','CAMPAIGN'))::int`,
      })
      .from(schema.notes)
      .where(and(eq(schema.notes.authorAddress, address), eq(schema.notes.status, 'PUBLISHED')))
  )[0];

  const revenue = (
    await db
      .select({
        tip: sql<string>`coalesce(sum(${schema.creatorValueStats.tipIncomeWei}::numeric), 0)::text`,
        stream: sql<string>`coalesce(sum(${schema.creatorValueStats.streamIncomeWei}::numeric), 0)::text`,
      })
      .from(schema.creatorValueStats)
      .where(eq(schema.creatorValueStats.creator, address))
  )[0];

  const attRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.attestations)
    .innerJoin(schema.impactClaims, eq(schema.impactClaims.impactKey, schema.attestations.impactKey))
    .where(eq(schema.impactClaims.authorAddress, address));

  return {
    notes: noteAgg?.notes ?? 0,
    monetizedNotes: noteAgg?.monetized ?? 0,
    creatorRevenueWei: (BigInt(revenue?.tip ?? '0') + BigInt(revenue?.stream ?? '0')).toString(),
    impactNotes: noteAgg?.impact ?? 0,
    attestationsReceived: attRows[0]?.count ?? 0,
  };
}
