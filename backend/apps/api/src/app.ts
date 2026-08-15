import Fastify, { type FastifyInstance, type FastifyLoggerOptions } from 'fastify';
import cors from '@fastify/cors';
import fjwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { ChainConfig } from '@proofnote/chain-config';
import { getDb, type Db } from '@proofnote/db';
import { AppError } from './lib/errors.js';
import { newRequestId } from './lib/ids.js';
import { ChainService } from './services/chain.js';
import { StorageService } from './services/storage.js';
import { storeIdempotencyResponse } from './plugins/idempotency.js';
import './types.js';

import configRoutes from './modules/config/routes.js';
import authRoutes from './modules/auth/routes.js';
import profileRoutes from './modules/profiles/routes.js';
import uploadRoutes from './modules/uploads/routes.js';
import noteRoutes from './modules/notes/routes.js';
import feedRoutes from './modules/feed/routes.js';
import valueRoutes from './modules/value/routes.js';
import streamRoutes from './modules/streams/routes.js';
import impactRoutes from './modules/impact/routes.js';
import attestationRoutes from './modules/attestations/routes.js';
import campaignRoutes from './modules/campaigns/routes.js';
import campaignReadRoutes from './modules/transparency/routes.js';
import transactionRoutes from './modules/transactions/routes.js';

export interface BuildAppOptions {
  config: ChainConfig;
  databaseUrl?: string | null;
  logger?: boolean | FastifyLoggerOptions;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
    genReqId: () => newRequestId(),
    bodyLimit: 2 * 1024 * 1024,
    routerOptions: { maxParamLength: 500 }, // 本地存储直传 token（HMAC 签名）较长
  });

  // 直传上传等非 JSON content-type 一律按 buffer 解析（PUT /uploads/direct/*）
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 250 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  const chain = new ChainService(opts.config);
  const storage = new StorageService(opts.config.env);
  const db: Db | null = opts.databaseUrl ? getDb(opts.databaseUrl) : null;

  app.decorate('cfg', opts.config);
  app.decorate('svc', { chain, storage, db });

  // ── 插件 ──────────────────────────────────────────────────
  const origins = opts.config.env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: origins.includes('*') ? true : origins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: 'req_unknown' },
    }),
  });

  await app.register(fjwt, {
    secret: opts.config.env.JWT_SECRET,
    sign: { expiresIn: opts.config.env.ACCESS_TOKEN_TTL_SECONDS },
  });

  app.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError('AUTH_REQUIRED', 'Authentication required (Bearer token)');
    }
  });

  // ── 错误信封（SPEC §4.10）──────────────────────────────────
  app.setErrorHandler((err, request, reply) => {
    const requestId = String(request.id);
    reply.header('x-request-id', requestId);
    if (err instanceof AppError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message, requestId } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          requestId,
        },
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId },
      });
    }
    if (status === 400 || (err as { validation?: unknown }).validation) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: (err as Error).message, requestId },
      });
    }
    request.log.error(err);
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found', requestId: String(request.id) },
    });
  });

  // ── 幂等响应持久化（onSend，见 plugins/idempotency.ts）─────
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.idempotencyCtx && typeof payload === 'string') {
      try {
        await storeIdempotencyResponse(request, reply.statusCode, payload);
      } catch (e) {
        request.log.warn({ err: e }, 'idempotency store failed');
      }
    }
    return payload;
  });

  app.get('/healthz', async () => ({ ok: true, time: new Date().toISOString() }));

  // ── 业务路由（prefix /api/v1）──────────────────────────────
  await app.register(
    async (api) => {
      await api.register(configRoutes);
      await api.register(authRoutes);
      await api.register(profileRoutes);
      await api.register(uploadRoutes);
      await api.register(noteRoutes);
      await api.register(feedRoutes);
      await api.register(valueRoutes);
      await api.register(streamRoutes);
      await api.register(impactRoutes);
      await api.register(attestationRoutes);
      await api.register(campaignRoutes);
      await api.register(campaignReadRoutes);
      await api.register(transactionRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
