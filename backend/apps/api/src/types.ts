import type { FastifyInstance } from 'fastify';
import type { ChainConfig } from '@proofnote/chain-config';
import type { Db } from '@proofnote/db';
import type { ChainService } from './services/chain.js';
import type { StorageService } from './services/storage.js';

/** JWT payload / user 类型（@fastify/jwt 通过 FastifyJWT 接口驱动 request.user 与 jwt.sign 入参） */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; addr: string };
    user: { sub: string; addr: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    cfg: ChainConfig;
    svc: {
      chain: ChainService;
      storage: StorageService;
      db: Db | null;
    };
    authenticate: (request: import('fastify').FastifyRequest) => Promise<void>;
  }

  interface FastifyRequest {
    idempotencyCtx?: { rowId: string };
  }
}

export {};
