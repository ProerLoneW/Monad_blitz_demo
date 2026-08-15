import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 推送 schema 到数据库。
 * 通过 pnpm db:push（scripts/push.ts，自动加载 .env）调用。
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://proofnote:proofnote@localhost:5432/proofnote',
  },
  strict: false,
  verbose: false,
});
