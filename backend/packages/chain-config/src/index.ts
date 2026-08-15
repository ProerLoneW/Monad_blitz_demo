import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * .env 加载（零依赖）：从 cwd 向上查找 .env，已存在的环境变量不覆盖。
 */
export function loadEnvFile(filename = '.env'): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, 'utf8');
      for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env) || process.env[key] === '') {
          process.env[key] = value;
        }
      }
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const addressSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((s) => s.toLowerCase())
    .optional(),
);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  API_BASE_URL: z.string().default('http://localhost:8080'),
  CORS_ORIGINS: z.string().default('*'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me'),
  AUTH_NONCE_TTL_SECONDS: z.coerce.number().default(600),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(3600),

  CHAIN_ID: z.coerce.number().default(10143),
  CHAIN_NAME: z.string().default('Monad Testnet'),
  RPC_URL_HTTP: z.string().url().default('https://testnet-rpc.monad.xyz'),
  RPC_URL_PUBLIC: z.string().url().default('https://testnet-rpc.monad.xyz'),
  RPC_URL_WS: z.string().default('wss://testnet-rpc.monad.xyz'),
  EXPLORER_BASE_URL: z.string().default('https://testnet.monadscan.com'),
  NATIVE_CURRENCY_SYMBOL: z.string().default('MON'),
  NATIVE_CURRENCY_DECIMALS: z.coerce.number().default(18),

  CONTRACT_NOTE_REGISTRY: addressSchema,
  CONTRACT_SUPPORT_ROUTER: addressSchema,
  CONTRACT_STREAM_SUPPORT: addressSchema,
  CONTRACT_IMPACT_REGISTRY: addressSchema,
  CONTRACT_ATTESTATION_REGISTRY: addressSchema,
  CONTRACT_CAMPAIGN_TREASURY_FACTORY: addressSchema,

  PROTOCOL_FEE_BPS_FALLBACK: z.coerce.number().default(200),
  PROTOCOL_FEE_RECIPIENT: addressSchema,

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./data/storage'),
  MEDIA_PUBLIC_BASE_URL: z.string().default('http://localhost:8080/api/v1/files'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  MAX_AVATAR_MB: z.coerce.number().default(5),
  MAX_IMAGE_MB: z.coerce.number().default(20),
  MAX_VIDEO_MB: z.coerce.number().default(200),
  MAX_EVIDENCE_MB: z.coerce.number().default(50),

  INDEXER_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  INDEXER_CHUNK_BLOCKS: z.coerce.number().default(2000),
  REORG_SAFETY_BLOCKS: z.coerce.number().default(12),

  RECONCILE_INTERVAL_MS: z.coerce.number().default(30000),
});

export type Env = z.infer<typeof envSchema>;

export type ContractAddresses = {
  noteRegistry?: string;
  supportRouter?: string;
  streamSupport?: string;
  impactRegistry?: string;
  attestationRegistry?: string;
  campaignTreasuryFactory?: string;
};

export type ChainConfig = {
  env: Env;
  contracts: ContractAddresses;
  /** 合约地址未配齐 或 显式 MOCK_CHAIN=true → mock 模式（prepare 返回占位 tx，track 模拟链上确认） */
  isMock: boolean;
  explorerUrl(txHash: string): string;
  feeBpsFallback: number;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): ChainConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment config: ${issues}`);
  }
  const env = parsed.data;
  const contracts: ContractAddresses = {
    noteRegistry: env.CONTRACT_NOTE_REGISTRY,
    supportRouter: env.CONTRACT_SUPPORT_ROUTER,
    streamSupport: env.CONTRACT_STREAM_SUPPORT,
    impactRegistry: env.CONTRACT_IMPACT_REGISTRY,
    attestationRegistry: env.CONTRACT_ATTESTATION_REGISTRY,
    campaignTreasuryFactory: env.CONTRACT_CAMPAIGN_TREASURY_FACTORY,
  };
  const required: Array<keyof ContractAddresses> = [
    'noteRegistry',
    'supportRouter',
    'streamSupport',
    'impactRegistry',
    'attestationRegistry',
    'campaignTreasuryFactory',
  ];
  const allPresent = required.every((k) => typeof contracts[k] === 'string');
  const isMock = !allPresent || source.MOCK_CHAIN === 'true';
  return {
    env,
    contracts,
    isMock,
    explorerUrl: (txHash: string) => `${env.EXPLORER_BASE_URL}/tx/${txHash}`,
    feeBpsFallback: env.PROTOCOL_FEE_BPS_FALLBACK,
  };
}

/** 与仓库根的 .env.example 配套：应用入口先调用 loadEnvFile() 再 loadConfig() */
export function loadConfigFromEnvFile(): ChainConfig {
  loadEnvFile();
  return loadConfig();
}
