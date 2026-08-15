import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { keccak256, toHex } from 'viem';
import { buildNoteManifest } from '@proofnote/hash-utils';
import { getAbi } from '@proofnote/contract-abis';
import { schema, type Db } from '@proofnote/db';
import type { Note, NoteType, TxRequest } from '@proofnote/api-types';
import { AppError } from '../../lib/errors.js';
import { newNoteId, newNoteManifestId } from '../../lib/ids.js';
import { checksum, toMoney } from '../../lib/money.js';
import type { StorageService } from '../../services/storage.js';
import { insertIntent } from '../../services/mock-chain.js';
import { impactViewsByNoteIds, noteValueAggregates } from '../../services/stats.js';
import { encodeFunctionData } from 'viem';

export function newBytes32(): `0x${string}` {
  return keccak256(toHex(randomBytes(32)));
}

/** 校验 mediaIds 全部 READY 且属于当前用户，返回行 */
export async function requireOwnedMedia(db: Db, mediaIds: string[], userId: string) {
  if (mediaIds.length === 0) return [];
  const rows = await db.select().from(schema.media).where(eq(schema.media.id, mediaIds[0]!));
  // 逐个校验（数量小，P0 简化）
  const result = [];
  for (const id of mediaIds) {
    const m = rows.find((r) => r.id === id) ?? (await db.select().from(schema.media).where(eq(schema.media.id, id)).limit(1))[0];
    if (!m) throw new AppError('UPLOAD_NOT_FOUND', `media ${id} not found`);
    if (m.ownerUserId !== userId) throw new AppError('UPLOAD_NOT_FOUND', `media ${id} not owned`);
    if (m.status !== 'READY') throw new AppError('UPLOAD_NOT_FOUND', `media ${id} not READY`);
    result.push(m);
  }
  return result;
}

export interface CreateNoteInput {
  authorUserId: string;
  authorAddress: string;
  type: NoteType;
  title?: string | null;
  body: string;
  mediaIds: string[];
  tipEnabled: boolean;
  streamEnabled: boolean;
  topic?: string | null;
}

/**
 * 创建 Note + canonical manifest + contentHash（后端开发文档 §4.5）。
 * 返回 PENDING_ANCHOR 状态的 note 与 manifest 信息；TxRequest 由调用方按类型构建。
 */
export async function createNoteWithManifest(
  db: Db,
  storage: StorageService,
  input: CreateNoteInput,
): Promise<{ note: typeof schema.notes.$inferSelect; contentHash: string; manifestUri: string }> {
  const mediaRows = await requireOwnedMedia(db, input.mediaIds, input.authorUserId);

  const noteId = newNoteId();
  const noteKey = newBytes32();
  const { manifest, contentHash } = buildNoteManifest({
    noteId,
    creator: input.authorAddress,
    type: input.type,
    title: input.title ?? null,
    body: input.body,
    media: mediaRows.map((m) => ({ mediaId: m.id, sha256: m.sha256, uri: m.url })),
    tipEnabled: input.tipEnabled,
    streamEnabled: input.streamEnabled,
  });

  const manifestKey = `manifests/${noteId}.v1.json`;
  await storage.putObject(manifestKey, 'application/json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  const manifestUri = storage.publicUrl(manifestKey);

  const inserted = await db
    .insert(schema.notes)
    .values({
      id: noteId,
      noteKey,
      authorUserId: input.authorUserId,
      authorAddress: input.authorAddress,
      type: input.type,
      status: 'PENDING_ANCHOR',
      title: input.title ?? null,
      body: input.body,
      contentHash,
      manifestUri,
      tipEnabled: input.tipEnabled,
      streamEnabled: input.streamEnabled,
      topic: input.topic ?? null,
    })
    .returning();

  if (mediaRows.length > 0) {
    await db.insert(schema.noteMedia).values(
      mediaRows.map((m, i) => ({ noteId, mediaId: m.id, position: i })),
    );
  }
  await db.insert(schema.noteManifests).values({
    id: newNoteManifestId(),
    noteId,
    version: 1,
    contentHash,
    manifestUri,
  });

  return { note: inserted[0]!, contentHash, manifestUri };
}

/** anchor TxRequest 构建：真实链 encode registerNote；mock 落意图 */
export async function buildAnchorTx(
  db: Db,
  isMock: boolean,
  registryAddress: string | undefined,
  note: typeof schema.notes.$inferSelect,
  userId: string,
  chainId: number,
): Promise<TxRequest> {
  const description = 'Register ProofNote ownership';
  if (isMock) {
    await insertIntent(db, { userId, kind: 'ANCHOR', entityId: note.id, params: {} });
    return { chainId, to: '0x0000000000000000000000000000000000000000', data: '0x', value: '0', functionName: 'registerNote', description, mock: true };
  }
  if (!registryAddress) throw new AppError('CHAIN_NOT_CONFIGURED', 'NoteRegistry address not configured');
  const data = encodeFunctionData({
    abi: getAbi('noteRegistry'),
    functionName: 'registerNote',
    args: [note.noteKey as `0x${string}`, note.contentHash as `0x${string}`, note.manifestUri ?? ''],
  });
  return { chainId, to: registryAddress as `0x${string}`, data, value: '0', functionName: 'registerNote', description };
}

/** Note 详情组装（author/media/ownership/value/impact） */
export async function assembleNote(db: Db, noteRow: typeof schema.notes.$inferSelect, explorerUrl?: (hash: string) => string): Promise<Note> {
  const authorRow = (
    await db
      .select({ user: schema.users, profile: schema.profiles })
      .from(schema.users)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(eq(schema.users.id, noteRow.authorUserId))
      .limit(1)
  )[0];

  const mediaRows = await db
    .select({ media: schema.media })
    .from(schema.noteMedia)
    .innerJoin(schema.media, eq(schema.media.id, schema.noteMedia.mediaId))
    .where(eq(schema.noteMedia.noteId, noteRow.id))
    .orderBy(schema.noteMedia.position);

  const onchain = (
    await db.select().from(schema.notesOnchain).where(eq(schema.notesOnchain.noteKey, noteRow.noteKey)).limit(1)
  )[0];

  const valueAgg = (await noteValueAggregates(db, [noteRow.noteKey])).get(noteRow.noteKey);
  const impactView = (await impactViewsByNoteIds(db, [noteRow.id])).get(noteRow.id);

  const totalSupportWei =
    BigInt(valueAgg?.tipsCreatorWei ?? '0') + BigInt(valueAgg?.settledStreamWei ?? '0');

  return {
    id: noteRow.id,
    noteKey: noteRow.noteKey as `0x${string}`,
    type: noteRow.type as NoteType,
    status: noteRow.status as Note['status'],
    author: {
      walletAddress: checksum(authorRow!.user.walletAddress),
      handle: authorRow?.profile?.handle ?? null,
      displayName: authorRow?.profile?.displayName ?? null,
      avatarUrl: null,
    },
    title: noteRow.title,
    body: noteRow.body,
    media: mediaRows.map(({ media }) => ({
      id: media.id,
      status: media.status as 'PENDING' | 'READY' | 'FAILED',
      contentType: media.contentType,
      sizeBytes: media.sizeBytes,
      sha256: media.sha256,
      url: media.url,
      storageUri: media.storageUri,
      width: media.width,
      height: media.height,
      durationMs: media.durationMs,
    })),
    contentHash: (noteRow.contentHash ?? null) as `0x${string}` | null,
    manifestUri: noteRow.manifestUri,
    ownership: {
      anchored: noteRow.status === 'PUBLISHED' && Boolean(onchain),
      ownerAddress: checksum(noteRow.authorAddress),
      contentHash: (onchain?.contentHash ?? noteRow.contentHash ?? null) as `0x${string}` | null,
      explorerUrl: onchain && explorerUrl ? explorerUrl(onchain.txHash) : null,
    },
    value: {
      tipEnabled: noteRow.tipEnabled,
      streamEnabled: noteRow.streamEnabled,
      totalSupport: toMoney(totalSupportWei),
      supporterCount: valueAgg?.supporterCount ?? 0,
      activeStreams: valueAgg?.activeStreams ?? 0,
      incomingRateWeiPerSecond: valueAgg?.incomingRateWei ?? '0',
    },
    impact: impactView
      ? {
          id: impactView.impactId,
          claimHash: impactView.claimHash as `0x${string}`,
          verification: {
            level: impactView.verificationLevel as 'L0' | 'L1' | 'L2',
            evidenceCount: impactView.evidenceCount,
            attestationCount: impactView.attestationCount,
            trustedVerifierCount: 0,
            openChallengeCount: 0,
          },
        }
      : null,
    campaignId: noteRow.type === 'CAMPAIGN'
      ? ((
          await db
            .select({ id: schema.campaignMetadata.id })
            .from(schema.campaignMetadata)
            .where(eq(schema.campaignMetadata.noteId, noteRow.id))
            .limit(1)
        )[0]?.id ?? null)
      : null,
    createdAt: noteRow.createdAt.toISOString(),
    publishedAt: noteRow.publishedAt?.toISOString() ?? null,
  };
}

export async function getNoteById(db: Db, noteId: string) {
  return (await db.select().from(schema.notes).where(eq(schema.notes.id, noteId)).limit(1))[0] ?? null;
}

export async function requirePublishedNote(db: Db, noteId: string) {
  const note = await getNoteById(db, noteId);
  if (!note) throw new AppError('NOTE_NOT_FOUND');
  if (note.status !== 'PUBLISHED') throw new AppError('NOTE_NOT_PUBLISHED');
  return note;
}

export async function mediaRowToEvidence(db: Db, impactId: string) {
  return db
    .select({ evidence: schema.impactEvidence, media: schema.media })
    .from(schema.impactEvidence)
    .innerJoin(schema.media, eq(schema.media.id, schema.impactEvidence.mediaId))
    .where(eq(schema.impactEvidence.impactId, impactId))
    .orderBy(schema.impactEvidence.createdAt);
}
