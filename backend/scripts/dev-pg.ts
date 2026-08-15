/**
 * 本地嵌入式 Postgres（免 Docker）：
 *   pnpm dev:pg —— 在 5432 启动嵌入式 PG（数据落 ./data/embedded-pg），Ctrl-C 停止。
 * 适用于本机无 Docker / 无 Postgres 的开发与冒烟环境。
 */
process.env.LOG_LEVEL ??= 'warn';
import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env.EMBEDDED_PG_PORT ?? 5432);
const dataDir = resolve(process.cwd(), './data/embedded-pg');
mkdirSync(dataDir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'proofnote',
  password: 'proofnote',
  port,
  persistent: true,
});

async function main() {
  // 数据目录已初始化（重复启动）则跳过 initdb，直接启动既有实例
  const alreadyInitialized = existsSync(join(dataDir, 'PG_VERSION'));
  if (!alreadyInitialized) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase('proofnote');
  } catch {
    // database already exists（持久化目录复用）
  }
  console.log(`embedded postgres ready: postgresql://proofnote:proofnote@localhost:${port}/proofnote`);

  const shutdown = async () => {
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  setInterval(() => {}, 60_000); // keep alive
}

main().catch((err) => {
  console.error('embedded postgres failed:', err);
  process.exit(1);
});
