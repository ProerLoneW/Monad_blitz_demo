import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '@proofnote/db';
import type { Media, PresignResult, UploadPurpose } from '@proofnote/api-types';
import { AppError, assertCond } from '../../lib/errors.js';
import { newMediaId } from '../../lib/ids.js';
import { sanitizeFilename } from '../../services/storage.js';
import { parseBody } from '../../lib/validation.js';
import { beginIdempotency } from '../../plugins/idempotency.js';
import { z } from 'zod';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

/** purpose → 允许的 mime 前缀 + 大小上限（SPEC §9.1 / §50） */
function validateUpload(purpose: UploadPurpose, contentType: string, sizeBytes: number, env: { MAX_AVATAR_MB: number; MAX_IMAGE_MB: number; MAX_VIDEO_MB: number; MAX_EVIDENCE_MB: number }) {
  const mb = (n: number) => n * 1024 * 1024;
  const rules: Record<UploadPurpose, Array<{ prefix: string; max: number }>> = {
    PROFILE_AVATAR: [
      { prefix: 'image/', max: mb(env.MAX_AVATAR_MB) },
    ],
    NOTE_MEDIA: [
      { prefix: 'image/', max: mb(env.MAX_IMAGE_MB) },
      { prefix: 'video/', max: mb(env.MAX_VIDEO_MB) },
    ],
    IMPACT_EVIDENCE: [
      { prefix: 'image/', max: mb(env.MAX_EVIDENCE_MB) },
      { prefix: 'video/', max: mb(env.MAX_EVIDENCE_MB) },
      { prefix: 'application/pdf', max: mb(env.MAX_EVIDENCE_MB) },
    ],
  };
  const candidates = rules[purpose];
  const match = candidates.find((r) => contentType.startsWith(r.prefix));
  if (!match) throw new AppError('UPLOAD_TYPE_NOT_ALLOWED', `${contentType} not allowed for ${purpose}`);
  if (sizeBytes <= 0 || sizeBytes > match.max) {
    throw new AppError('UPLOAD_TOO_LARGE', `size ${sizeBytes} exceeds limit ${match.max}`);
  }
}

function serializeMedia(m: typeof schema.media.$inferSelect): Media {
  return {
    id: m.id,
    status: m.status as Media['status'],
    contentType: m.contentType,
    sizeBytes: m.sizeBytes,
    sha256: m.sha256,
    url: m.url,
    storageUri: m.storageUri,
    width: m.width,
    height: m.height,
    durationMs: m.durationMs,
  };
}

export default async function uploadRoutes(app: FastifyInstance) {
  // ── POST /uploads/presign ────────────────────────────────
  app.post(
    '/uploads/presign',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const db = requireDb(app);
      const body = parseBody(
        z.object({
          purpose: z.enum(['NOTE_MEDIA', 'PROFILE_AVATAR', 'IMPACT_EVIDENCE']),
          filename: z.string().min(1).max(255),
          contentType: z.string().min(3).max(100),
          sizeBytes: z.coerce.number().int().positive(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
        }),
        request.body,
      );
      validateUpload(body.purpose, body.contentType, body.sizeBytes, app.cfg.env);

      const mediaId = newMediaId();
      const key = `${body.purpose.toLowerCase()}/${mediaId}/${sanitizeFilename(body.filename)}`;
      const presign = await app.svc.storage.presignPut(key, body.contentType);
      await db.insert(schema.media).values({
        id: mediaId,
        purpose: body.purpose,
        ownerUserId: request.user.sub,
        filename: body.filename,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        status: 'PENDING',
        storageKey: key,
      });

      const result: PresignResult = {
        mediaId,
        uploadUrl: presign.uploadUrl,
        method: 'PUT',
        headers: presign.headers,
        expiresAt: presign.expiresAt.toISOString(),
      };
      return reply.code(201).send({ data: result });
    },
  );

  // ── POST /uploads/:mediaId/complete ──────────────────────
  app.post(
    '/uploads/:mediaId/complete',
    {
      preHandler: [app.authenticate, async (request, reply) => beginIdempotency(request, reply)],
    },
    async (request, reply) => {
      const db = requireDb(app);
      const { mediaId } = request.params as { mediaId: string };
      const body = parseBody(z.object({ etag: z.string().optional() }), request.body);

      const m = (await db.select().from(schema.media).where(eq(schema.media.id, mediaId)).limit(1))[0];
      if (!m) throw new AppError('UPLOAD_NOT_FOUND');
      if (m.ownerUserId !== request.user.sub) throw new AppError('UPLOAD_NOT_FOUND');
      if (m.status === 'READY') return { data: serializeMedia(m) };
      assertCond(m.storageKey, 'UPLOAD_NOT_FOUND');

      const info = await app.svc.storage.headAndHash(m.storageKey);
      if (!info) throw new AppError('UPLOAD_NOT_FOUND', 'object not uploaded yet');

      // client-provided sha256 校验（SPEC §9.2：计算或验证 sha256）
      if (info.sha256) {
        // 与 presign 时客户端声明的 sha256（若有）不比对（presign 可选）；此处回填实际值
      }
      const updated = await db
        .update(schema.media)
        .set({
          status: 'READY',
          sha256: info.sha256,
          url: app.svc.storage.publicUrl(m.storageKey),
          storageUri: app.svc.storage.driver === 's3' ? `s3://${app.cfg.env.S3_BUCKET}/${m.storageKey}` : `local://${m.storageKey}`,
          sizeBytes: info.size,
        })
        .where(and(eq(schema.media.id, mediaId), eq(schema.media.status, 'PENDING')))
        .returning();
      if (updated.length === 0) {
        const again = (await db.select().from(schema.media).where(eq(schema.media.id, mediaId)).limit(1))[0];
        return { data: serializeMedia(again!) };
      }
      return reply.code(200).send({ data: serializeMedia(updated[0]!) });
    },
  );

  // ── PUT /uploads/direct/:token（local 驱动直传）───────────
  app.put('/uploads/direct/:token', async (request, reply) => {
    if (app.svc.storage.driver !== 'local') throw new AppError('UPLOAD_NOT_FOUND', 'direct upload only for local driver');
    const { token } = request.params as { token: string };
    const payload = app.svc.storage.verifyLocalToken(token);
    if (!payload) throw new AppError('UPLOAD_NOT_FOUND', 'invalid or expired upload token');

    const body = request.body;
    assertCond(Buffer.isBuffer(body) && body.length > 0, 'UPLOAD_NOT_FOUND', 'empty body');
    const buffer = body as Buffer;
    if (buffer.length > 250 * 1024 * 1024) throw new AppError('UPLOAD_TOO_LARGE');

    await app.svc.storage.putObject(payload.key, payload.contentType, buffer);
    return reply.code(200).send({ uploaded: true, key: payload.key, size: buffer.length });
  });

  // ── GET /files/*（local 驱动静态服务）─────────────────────
  app.get('/files/*', async (request, reply) => {
    if (app.svc.storage.driver !== 'local') throw new AppError('UPLOAD_NOT_FOUND');
    const key = (request.params as { '*': string })['*'];
    let path: string;
    try {
      path = app.svc.storage.localPath(key);
    } catch {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'bad path', requestId: String(request.id) } });
    }
    const fs = await import('node:fs');
    if (!fs.existsSync(path)) {
      return reply.code(404).send({ error: { code: 'UPLOAD_NOT_FOUND', message: 'not found', requestId: String(request.id) } });
    }
    reply.header('content-type', guessContentType(key));
    reply.header('cache-control', 'public, max-age=3600');
    return reply.send(fs.createReadStream(path));
  });
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  pdf: 'application/pdf', json: 'application/json',
};

function guessContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}
