import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '@proofnote/api-types';

export function publicConfig(cfg: {
  isMock: boolean;
  env: {
    NODE_ENV: string;
    CHAIN_NAME: string;
    CHAIN_ID: number;
    NATIVE_CURRENCY_SYMBOL: string;
    NATIVE_CURRENCY_DECIMALS: number;
    RPC_URL_PUBLIC: string;
    EXPLORER_BASE_URL: string;
  };
  contracts: {
    noteRegistry?: string;
    supportRouter?: string;
    streamSupport?: string;
    impactRegistry?: string;
    attestationRegistry?: string;
    campaignTreasuryFactory?: string;
  };
}): AppConfig {
  const c = cfg.contracts;
  const feature = (addr?: string) => cfg.isMock || Boolean(addr);
  return {
    environment: cfg.env.NODE_ENV === 'production' ? 'production' : 'development',
    mockChain: cfg.isMock,
    chain: {
      name: cfg.env.CHAIN_NAME,
      chainId: cfg.env.CHAIN_ID,
      nativeCurrency: {
        name: cfg.env.NATIVE_CURRENCY_SYMBOL,
        symbol: cfg.env.NATIVE_CURRENCY_SYMBOL,
        decimals: cfg.env.NATIVE_CURRENCY_DECIMALS,
      },
      rpcUrl: cfg.env.RPC_URL_PUBLIC,
      explorerBaseUrl: cfg.env.EXPLORER_BASE_URL,
    },
    contracts: {
      noteRegistry: c.noteRegistry ?? null,
      supportRouter: c.supportRouter ?? null,
      streamSupport: c.streamSupport ?? null,
      impactRegistry: c.impactRegistry ?? null,
      attestationRegistry: c.attestationRegistry ?? null,
      campaignTreasuryFactory: c.campaignTreasuryFactory ?? null,
    },
    features: {
      directTip: feature(c.supportRouter),
      streamSupport: feature(c.streamSupport),
      impact: feature(c.impactRegistry),
      campaign: feature(c.campaignTreasuryFactory),
      attestation: feature(c.attestationRegistry),
    },
  };
}

export default async function configRoutes(app: FastifyInstance) {
  app.get('/config', async () => ({ data: publicConfig(app.cfg) }));
}
