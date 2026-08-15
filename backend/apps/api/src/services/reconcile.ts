import { and, eq, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { domain, schema } from '@proofnote/db';
import { verifyAnchorTx } from './tx-verify.js';

/**
 * 后台 Reconciliation（后端开发文档 §5.4）——"用户关了页面"也要推进状态。
 * 仅 real 链模式有意义（mock 模式 track 即时确认）。
 * server.ts 以 RECONCILE_INTERVAL_MS 周期调用。
 */
export async function runReconcile(app: FastifyInstance): Promise<void> {
  const db = app.svc.db;
  if (!db || app.cfg.isMock) return;

  const cutoff = new Date(Date.now() - 60_000);

  // 1) 超时仍 SUBMITTED 的跟踪交易 → 查 receipt 推进
  const stale = await db
    .select()
    .from(schema.trackedTransactions)
    .where(and(eq(schema.trackedTransactions.status, 'SUBMITTED'), lt(schema.trackedTransactions.createdAt, cutoff)))
    .limit(50);

  for (const tx of stale) {
    const receipt = await app.svc.chain.getReceipt(tx.txHash);
    if (!receipt) {
      // 超过 10 分钟仍查无此交易 → DROPPED（Monad 无全局 mempool，不能依赖 pending 查询）
      if (Date.now() - tx.createdAt.getTime() > 10 * 60_000) {
        await db
          .update(schema.trackedTransactions)
          .set({ status: 'DROPPED', error: 'no receipt after 10min', updatedAt: new Date() })
          .where(and(eq(schema.trackedTransactions.id, tx.id), eq(schema.trackedTransactions.status, 'SUBMITTED')));
      }
      continue;
    }
    const status = receipt.status === 'success' ? 'CONFIRMED' : 'REVERTED';
    await db
      .update(schema.trackedTransactions)
      .set({ status, blockNumber: String(receipt.blockNumber), updatedAt: new Date() })
      .where(and(eq(schema.trackedTransactions.id, tx.id), eq(schema.trackedTransactions.status, 'SUBMITTED')));
  }

  // 2) PENDING_ANCHOR 的 note：独立核验 anchor 交易并发布（不依赖浏览器回调）
  const pendingNotes = await db
    .select()
    .from(schema.notes)
    .where(and(eq(schema.notes.status, 'PENDING_ANCHOR'), lt(schema.notes.createdAt, cutoff)))
    .limit(20);

  for (const note of pendingNotes) {
    const tracked = (
      await db
        .select()
        .from(schema.trackedTransactions)
        .where(and(eq(schema.trackedTransactions.entityId, note.id)))
        .limit(1)
    )[0];
    if (!tracked?.txHash) continue;

    if (note.type === 'IMPACT' || note.type === 'CAMPAIGN') {
      const impact = (
        await db.select().from(schema.impactClaims).where(eq(schema.impactClaims.noteId, note.id)).limit(1)
      )[0];
      if (!impact) continue;
      const result = await verifyAnchorTx(app.svc.chain, {
        txHash: tracked.txHash,
        registryAddress: app.cfg.contracts.impactRegistry!,
        abiName: 'impactRegistry',
        eventName: 'ImpactRegistered',
        expectedNoteKey: note.noteKey,
        expectedCreator: note.authorAddress,
        expectedContentHash: impact.claimHash,
      });
      if (result.outcome === 'CONFIRMED') {
        const manifest = (
          await db.select().from(schema.impactManifests).where(eq(schema.impactManifests.impactId, impact.id)).limit(1)
        )[0];
        await domain.publishImpact(db, {
          impactKey: impact.impactKey,
          noteKey: note.noteKey,
          creator: note.authorAddress,
          claimHash: impact.claimHash,
          evidenceManifestHash: manifest?.evidenceManifestHash ?? '0x' + '0'.repeat(64),
          manifestUri: manifest?.manifestUri ?? '',
          txHash: tracked.txHash,
          registeredAt: new Date(),
        });
      }
      continue;
    }

    const result = await verifyAnchorTx(app.svc.chain, {
      txHash: tracked.txHash,
      registryAddress: app.cfg.contracts.noteRegistry!,
      abiName: 'noteRegistry',
      eventName: 'NoteRegistered',
      expectedNoteKey: note.noteKey,
      expectedCreator: note.authorAddress,
      expectedContentHash: note.contentHash ?? '',
    });
    if (result.outcome === 'CONFIRMED') {
      await domain.publishNote(db, {
        noteKey: note.noteKey,
        creator: note.authorAddress,
        contentHash: note.contentHash!,
        manifestUri: note.manifestUri ?? '',
        txHash: tracked.txHash,
        registeredAt: new Date(),
      });
    }
  }
}
