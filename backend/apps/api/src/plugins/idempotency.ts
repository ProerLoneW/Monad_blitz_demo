import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { schema, type Db } from '@proofnote/db';
import { newId } from '../lib/ids.js';

/**
 * 幂等支持（SPEC §4.11）：create note / create impact / upload complete / transaction track。
 * 路由 preHandler 中调用 begin（重复请求直接重放历史响应）；
 * app 级 onSend 钩子持久化首响结果。
 */
export async function beginIdempotency(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || !request.user) return;
  const db: Db | null = request.server.svc.db;
  if (!db) return;

  const route = request.routeOptions.url ?? request.url;
  const requestHash = createHash('sha256').update(JSON.stringify(request.body ?? {})).digest('hex');
  const userId = request.user.sub;

  const inserted = await db
    .insert(schema.idempotencyKeys)
    .values({ id: newId('idem'), userId, route, idemKey: key, requestHash })
    .onConflictDoNothing()
    .returning({ id: schema.idempotencyKeys.id });

  if (inserted.length === 0) {
    const existing = (
      await db
        .select()
        .from(schema.idempotencyKeys)
        .where(
          and(
            eq(schema.idempotencyKeys.userId, userId),
            eq(schema.idempotencyKeys.route, route),
            eq(schema.idempotencyKeys.idemKey, key),
          ),
        )
        .limit(1)
    )[0];
    if (existing?.responseJson) {
      reply.header('x-idempotent-replay', 'true');
      reply.code(existing.statusCode ?? 200);
      await reply.send(JSON.parse(existing.responseJson));
      return;
    }
    if (existing) request.idempotencyCtx = { rowId: existing.id };
    return;
  }
  request.idempotencyCtx = { rowId: inserted[0]!.id };
}

export async function storeIdempotencyResponse(request: FastifyRequest, statusCode: number, payload: string): Promise<void> {
  const ctx = request.idempotencyCtx;
  const db = request.server.svc.db;
  if (!ctx || !db || statusCode < 200 || statusCode >= 400) return;
  await db
    .update(schema.idempotencyKeys)
    .set({ statusCode, responseJson: payload })
    .where(and(eq(schema.idempotencyKeys.id, ctx.rowId), isNull(schema.idempotencyKeys.statusCode)));
}
