import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '@proofnote/db';
import type { Profile } from '@proofnote/api-types';
import { AppError } from '../../lib/errors.js';
import { newProfileId } from '../../lib/ids.js';
import { checksum, toMoney } from '../../lib/money.js';
import { decodeCursor, encodeCursor, parseBody } from '../../lib/validation.js';
import { profileStats } from '../../services/stats.js';
import { z } from 'zod';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

const HANDLE_RE = /^[a-z0-9_]{3,30}$/;
const RESERVED_HANDLES = new Set(['me', 'config', 'api', 'admin', 'proofnote', 'root']);

async function getProfileRow(db: Db, addressOrHandle: string) {
  const isAddress = /^0x[0-9a-fA-F]{40}$/.test(addressOrHandle);
  const rows = await db
    .select()
    .from(schema.profiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.profiles.userId))
    .where(
      isAddress
        ? eq(schema.users.walletAddress, addressOrHandle.toLowerCase())
        : eq(schema.profiles.handle, addressOrHandle.toLowerCase()),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function assembleProfile(db: Db, row: { profiles: typeof schema.profiles.$inferSelect; users: typeof schema.users.$inferSelect }, avatarUrl: string | null): Promise<Profile> {
  const stats = await profileStats(db, row.users.walletAddress);
  return {
    id: row.profiles.id,
    walletAddress: checksum(row.users.walletAddress),
    handle: row.profiles.handle,
    displayName: row.profiles.displayName,
    bio: row.profiles.bio,
    avatarUrl,
    createdAt: row.profiles.createdAt.toISOString(),
    stats: {
      notes: stats.notes,
      monetizedNotes: stats.monetizedNotes,
      creatorRevenue: toMoney(stats.creatorRevenueWei),
      impactNotes: stats.impactNotes,
      attestationsReceived: stats.attestationsReceived,
      directedToCauses: toMoney('0'), // P0 无 Multi-Split（SPEC §2.2 预留）
    },
  };
}

export default async function profileRoutes(app: FastifyInstance) {
  // ── GET /profiles/:addressOrHandle ───────────────────────
  app.get('/profiles/:addressOrHandle', async (request) => {
    const db = requireDb(app);
    const { addressOrHandle } = request.params as { addressOrHandle: string };
    const row = await getProfileRow(db, addressOrHandle);
    if (!row) throw new AppError('PROFILE_NOT_FOUND');
    const avatarUrl = row.profiles.avatarMediaId ? await mediaUrl(db, row.profiles.avatarMediaId) : null;
    return { data: await assembleProfile(db, row, avatarUrl) };
  });

  // ── PATCH /profiles/me ───────────────────────────────────
  app.patch('/profiles/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const db = requireDb(app);
    const body = parseBody(
      z.object({
        handle: z.string().regex(HANDLE_RE, 'handle must be 3-30 chars [a-z0-9_]').optional(),
        displayName: z.string().min(1).max(50).optional(),
        bio: z.string().max(300).optional(),
        avatarMediaId: z.string().optional(),
      }),
      request.body,
    );
    if (body.handle && RESERVED_HANDLES.has(body.handle)) {
      throw new AppError('HANDLE_INVALID', 'handle is reserved');
    }
    if (body.avatarMediaId) {
      const m = (
        await db
          .select()
          .from(schema.media)
          .where(and(eq(schema.media.id, body.avatarMediaId), eq(schema.media.status, 'READY')))
          .limit(1)
      )[0];
      if (!m || m.ownerUserId !== request.user.sub) throw new AppError('UPLOAD_NOT_FOUND', 'avatar media not ready');
    }

    const existing = (
      await db.select().from(schema.profiles).where(eq(schema.profiles.userId, request.user.sub)).limit(1)
    )[0];

    if (!existing) {
      // 首次创建 profile（handle 必填）
      const handle = body.handle;
      if (!handle) throw new AppError('HANDLE_INVALID', 'handle required for initial profile');
      try {
        const inserted = await db
          .insert(schema.profiles)
          .values({
            id: newProfileId(),
            userId: request.user.sub,
            handle,
            displayName: body.displayName ?? handle,
            bio: body.bio ?? '',
            avatarMediaId: body.avatarMediaId ?? null,
          })
          .returning();
        return reply.code(201).send({ data: { profile: serializeProfileRow(inserted[0]!) } });
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new AppError('HANDLE_TAKEN');
        throw e;
      }
    }

    try {
      const updated = await db
        .update(schema.profiles)
        .set({
          ...(body.handle ? { handle: body.handle } : {}),
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.bio !== undefined ? { bio: body.bio } : {}),
          ...(body.avatarMediaId !== undefined ? { avatarMediaId: body.avatarMediaId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.profiles.id, existing.id))
        .returning();
      return { data: { profile: serializeProfileRow(updated[0]!) } };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError('HANDLE_TAKEN');
      throw e;
    }
  });

  // ── GET /profiles/:addressOrHandle/notes（SPEC §12.4）─────
  app.get('/profiles/:addressOrHandle/notes', async (request) => {
    const db = requireDb(app);
    const { addressOrHandle } = request.params as { addressOrHandle: string };
    const query = request.query as { type?: string; limit?: string; cursor?: string };
    const row = await getProfileRow(db, addressOrHandle);
    if (!row) throw new AppError('PROFILE_NOT_FOUND');

    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 50);
    const types =
      query.type && query.type !== 'ALL'
        ? [query.type as 'STANDARD' | 'MONETIZED' | 'IMPACT' | 'CAMPAIGN']
        : ['STANDARD', 'MONETIZED', 'IMPACT', 'CAMPAIGN'];

    const cursor = decodeCursor(query.cursor);
    const conditions = [
      eq(schema.notes.authorUserId, row.profiles.userId),
      eq(schema.notes.status, 'PUBLISHED'),
      inArray(schema.notes.type, types),
    ];
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
    const { nextCursor, hasNext } = rows.length > limit
      ? {
          nextCursor: encodeCursor({
            p: page[page.length - 1]!.publishedAt!.toISOString(),
            i: page[page.length - 1]!.id,
          }),
          hasNext: true,
        }
      : { nextCursor: null, hasNext: false };

    return {
      data: {
        items: page.map((n) => ({
          id: n.id,
          noteKey: n.noteKey,
          type: n.type,
          status: n.status,
          title: n.title,
          bodyPreview: n.body.slice(0, 140),
          publishedAt: n.publishedAt?.toISOString() ?? null,
        })),
        pageInfo: { nextCursor, hasNext },
      },
    };
  });
}

function serializeProfileRow(p: typeof schema.profiles.$inferSelect) {
  return { id: p.id, handle: p.handle, displayName: p.displayName, bio: p.bio };
}

export async function mediaUrl(db: Db, mediaId: string): Promise<string | null> {
  const m = (await db.select().from(schema.media).where(eq(schema.media.id, mediaId)).limit(1))[0];
  return m?.url ?? null;
}
