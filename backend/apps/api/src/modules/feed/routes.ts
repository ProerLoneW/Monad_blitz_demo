import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FeedItem, NoteType } from '@proofnote/api-types';
import { schema, type Db } from '@proofnote/db';
import { AppError } from '../../lib/errors.js';
import { formatWei } from '../../lib/money.js';
import { decodeCursor, encodeCursor } from '../../lib/validation.js';
import { impactViewsByNoteIds, noteValueAggregates } from '../../services/stats.js';
import { checksum } from '../../lib/money.js';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

export default async function feedRoutes(app: FastifyInstance) {
  // ── GET /feed（SPEC §13.1）───────────────────────────────
  app.get('/feed', async (request) => {
    const db = requireDb(app);
    const query = request.query as { tab?: string; limit?: string; cursor?: string };
    const tab = query.tab ?? 'FOR_YOU';
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 50);

    const conditions = [eq(schema.notes.status, 'PUBLISHED')];
    if (tab === 'IMPACT') conditions.push(inArray(schema.notes.type, ['IMPACT', 'CAMPAIGN']));
    else if (tab === 'MONAD') conditions.push(eq(schema.notes.topic, 'monad'));

    const cursor = decodeCursor(query.cursor);
    if (cursor?.p && cursor?.i) {
      conditions.push(
        or(
          lt(schema.notes.publishedAt, new Date(cursor.p)),
          and(eq(schema.notes.publishedAt, new Date(cursor.p)), lt(schema.notes.id, cursor.i)),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(schema.notes)
      .where(and(...conditions))
      .orderBy(desc(schema.notes.publishedAt), desc(schema.notes.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const hasNext = rows.length > limit;
    const last = page[page.length - 1];
    const nextCursor = hasNext && last?.publishedAt
      ? encodeCursor({ p: last.publishedAt.toISOString(), i: last.id })
      : null;

    // 批量补充 author / value / impact
    const authorIds = [...new Set(page.map((n) => n.authorUserId))];
    const authors = new Map(
      authorIds.length
        ? (
            await db
              .select({ userId: schema.users.id, address: schema.users.walletAddress, handle: schema.profiles.handle, displayName: schema.profiles.displayName })
              .from(schema.users)
              .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
              .where(inArray(schema.users.id, authorIds))
          ).map((a) => [a.userId, a])
        : [],
    );
    const valueAggs = await noteValueAggregates(db, page.map((n) => n.noteKey));
    const impactViews = await impactViewsByNoteIds(db, page.map((n) => n.id));

    const items: FeedItem[] = page.map((n) => {
      const author = authors.get(n.authorUserId);
      const agg = valueAggs.get(n.noteKey);
      const impact = impactViews.get(n.id);
      const badges: string[] = [];
      if (n.type === 'MONETIZED') badges.push('MONETIZED');
      if (n.type === 'IMPACT' || n.type === 'CAMPAIGN') {
        badges.push('IMPACT');
        if ((impact?.attestationCount ?? 0) > 0) badges.push('ATTESTED');
        if (n.type === 'CAMPAIGN') badges.push('FUNDING');
      }
      const totalSupportWei = BigInt(agg?.tipsCreatorWei ?? '0') + BigInt(agg?.settledStreamWei ?? '0');
      return {
        id: n.id,
        type: n.type as NoteType,
        author: {
          walletAddress: checksum(author?.address ?? n.authorAddress),
          handle: author?.handle ?? null,
          displayName: author?.displayName ?? null,
          avatarUrl: null,
        },
        title: n.title,
        bodyPreview: n.body.slice(0, 140),
        coverUrl: null,
        badges,
        value:
          n.type === 'MONETIZED'
            ? { totalSupportFormatted: formatWei(totalSupportWei), symbol: app.cfg.env.NATIVE_CURRENCY_SYMBOL }
            : undefined,
        impact:
          n.type === 'IMPACT' || n.type === 'CAMPAIGN'
            ? {
                verificationLevel: impact?.verificationLevel ?? 'L0',
                evidenceCount: impact?.evidenceCount ?? 0,
                attestationCount: impact?.attestationCount ?? 0,
              }
            : null,
        createdAt: n.publishedAt?.toISOString() ?? n.createdAt.toISOString(),
      };
    });

    return { data: { items, pageInfo: { nextCursor, hasNext } } };
  });
}
