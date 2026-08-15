import { loadConfigFromEnvFile } from '@proofnote/chain-config';
import { closeDb } from '@proofnote/db';
import { buildApp } from './app.js';
import { runReconcile } from './services/reconcile.js';

async function main() {
  const config = loadConfigFromEnvFile();
  const databaseUrl = config.env.DATABASE_URL === 'postgresql://proofnote:proofnote@localhost:5432/proofnote'
    ? process.env.DATABASE_URL ?? config.env.DATABASE_URL
    : config.env.DATABASE_URL;

  const app = await buildApp({ config, databaseUrl });

  // 启动即校验链 ID（fail-fast；mock 模式跳过）
  await app.svc.chain.verifyChainId();

  await app.listen({ port: config.env.PORT, host: '0.0.0.0' });

  // Reconcile 周期任务（"用户关页面"兜底，文档 §5.4）
  const timer = setInterval(() => {
    runReconcile(app).catch((err) => app.log.warn({ err }, 'reconcile failed'));
  }, config.env.RECONCILE_INTERVAL_MS);
  timer.unref?.();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    clearInterval(timer);
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
