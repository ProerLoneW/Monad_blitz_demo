import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { verifyMessage } from 'viem';
import { schema, type Db } from '@proofnote/db';
import { AppError } from '../../lib/errors.js';
import { newUserId } from '../../lib/ids.js';
import { checksum } from '../../lib/money.js';
import { addressSchema, parseBody } from '../../lib/validation.js';
import { z } from 'zod';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

export function buildAuthMessage(p: {
  domain: string;
  address: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    `${p.domain} wants you to sign in with your Monad account:`,
    p.address,
    '',
    'By signing you agree to create freely, own your value, and prove your impact.',
    '',
    `URI: ${p.domain}`,
    'Version: 1',
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
  ].join('\n');
}

export default async function authRoutes(app: FastifyInstance) {
  // ── POST /auth/nonce ─────────────────────────────────────
  app.post(
    '/auth/nonce',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const db = requireDb(app);
      const body = parseBody(
        z.object({ address: addressSchema, chainId: z.coerce.number().optional() }),
        request.body,
      );
      if (body.chainId !== undefined && body.chainId !== app.cfg.env.CHAIN_ID) {
        throw new AppError('AUTH_CHAIN_NOT_ALLOWED', `chainId ${body.chainId} not allowed`);
      }
      const nonce = randomBytes(16).toString('hex');
      const issuedAt = new Date().toISOString();
      const message = buildAuthMessage({
        domain: app.cfg.env.API_BASE_URL,
        address: body.address,
        chainId: app.cfg.env.CHAIN_ID,
        nonce,
        issuedAt,
      });
      const expiresAt = new Date(Date.now() + app.cfg.env.AUTH_NONCE_TTL_SECONDS * 1000);
      await db.insert(schema.authNonces).values({
        nonce,
        address: body.address,
        chainId: app.cfg.env.CHAIN_ID,
        message,
        expiresAt,
      });
      return reply.code(200).send({ data: { nonce, message, expiresAt: expiresAt.toISOString() } });
    },
  );

  // ── POST /auth/verify ────────────────────────────────────
  app.post('/auth/verify', async (request, reply) => {
    const db = requireDb(app);
    const body = parseBody(
      z.object({ address: addressSchema, message: z.string().min(1), signature: z.string().min(2) }),
      request.body,
    );

    const nonceMatch = body.message.match(/Nonce: ([0-9a-f]{16,64})/);
    if (!nonceMatch) throw new AppError('AUTH_SIGNATURE_INVALID', 'message format invalid');
    const nonce = nonceMatch[1]!;

    const row = (await db.select().from(schema.authNonces).where(eq(schema.authNonces.nonce, nonce)).limit(1))[0];
    if (!row) throw new AppError('AUTH_SIGNATURE_INVALID', 'unknown nonce');
    if (row.usedAt) throw new AppError('AUTH_NONCE_USED');
    if (row.expiresAt.getTime() < Date.now()) throw new AppError('AUTH_NONCE_EXPIRED');
    if (row.message !== body.message) throw new AppError('AUTH_SIGNATURE_INVALID', 'message mismatch');
    if (row.address !== body.address) throw new AppError('AUTH_ADDRESS_MISMATCH');
    if (row.chainId !== app.cfg.env.CHAIN_ID) throw new AppError('AUTH_CHAIN_NOT_ALLOWED');

    let recoveredOk: boolean;
    try {
      recoveredOk = await verifyMessage({
        message: body.message,
        signature: body.signature as `0x${string}`,
        address: body.address as `0x${string}`,
      });
    } catch {
      // 非法签名格式（长度/恢复位/DER 错误）——统一按无效处理，不抛 500
      recoveredOk = false;
    }
    if (!recoveredOk) throw new AppError('AUTH_SIGNATURE_INVALID');

    // 原子标记 nonce 已用（防重放竞态）
    const marked = await db
      .update(schema.authNonces)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.authNonces.nonce, nonce), isNull(schema.authNonces.usedAt)))
      .returning({ nonce: schema.authNonces.nonce });
    if (marked.length === 0) throw new AppError('AUTH_NONCE_USED');

    // get or create user
    let user = (await db.select().from(schema.users).where(eq(schema.users.walletAddress, body.address)).limit(1))[0];
    if (!user) {
      const id = newUserId();
      const inserted = await db
        .insert(schema.users)
        .values({ id, walletAddress: body.address })
        .onConflictDoNothing()
        .returning();
      user =
        inserted[0] ??
        (await db.select().from(schema.users).where(eq(schema.users.walletAddress, body.address)).limit(1))[0];
    }
    if (!user) throw new AppError('INTERNAL_ERROR', 'user creation failed');

    const accessToken = app.jwt.sign({ sub: user.id, addr: body.address });
    const profile = (
      await db.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.userId, user.id)).limit(1)
    )[0];

    return reply.code(200).send({
      data: {
        accessToken,
        expiresIn: app.cfg.env.ACCESS_TOKEN_TTL_SECONDS,
        user: {
          id: user.id,
          walletAddress: checksum(user.walletAddress),
          profileCompleted: Boolean(profile),
        },
      },
    });
  });

  // ── GET /auth/me ─────────────────────────────────────────
  app.get('/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    const db = requireDb(app);
    const { sub, addr } = request.user;
    const profile = (await db.select().from(schema.profiles).where(eq(schema.profiles.userId, sub)).limit(1))[0];
    return {
      data: {
        id: sub,
        walletAddress: checksum(addr),
        profile: profile
          ? { id: profile.id, handle: profile.handle, displayName: profile.displayName }
          : null,
      },
    };
  });
}
