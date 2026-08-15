import { loadEnvFile } from '@proofnote/chain-config';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// pnpm db:push 入口：加载 .env 后执行 drizzle-kit push（cwd = packages/db，读取 drizzle.config.ts）
const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(scriptDir, '..');
loadEnvFile(join(pkgRoot, '..', '..', '.env'));
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (check backend/.env)');
  process.exit(1);
}
const bin = join(pkgRoot, 'node_modules', '.bin', 'drizzle-kit');
execFileSync(bin, ['push', '--force'], { stdio: 'inherit', cwd: pkgRoot, env: process.env });
