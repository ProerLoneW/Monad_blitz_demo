/**
 * solc-js 编译（无 forge 环境的编译验证路径）：
 *   pnpm --filter @proofnote/contracts compile
 * 编译 src/*.sol → artifacts/{Contract}.json（abi + bytecode）
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'artifacts');

const files = readdirSync(srcDir).filter((f) => f.endsWith('.sol'));
if (files.length === 0) throw new Error('no sol files found');
const sources: Record<string, { content: string }> = {};
for (const f of files) sources[f] = { content: readFileSync(join(srcDir, f), 'utf8') };

const input = {
  language: 'Solidity' as const,
  sources,
  settings: {
    evmVersion: 'prague',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
    },
  },
};

const importCallback = (path: string) => {
  // 同目录相对导入（./ReentrancyGuard.sol 等）
  const clean = path.replace(/^\.\//, '');
  const local = join(srcDir, clean);
  if (existsSync(local)) return { contents: readFileSync(local, 'utf8') };
  return { error: `import not found: ${path}` };
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: importCallback as never }));
if (output.errors) {
  const hasError = output.errors.some((e: { severity: string }) => e.severity === 'error');
  for (const e of output.errors) console.log(`[${e.severity}] ${e.formatted?.trim() ?? e.message}`);
  if (hasError) process.exit(1);
}

mkdirSync(outDir, { recursive: true });
let count = 0;
for (const [file, contracts] of Object.entries(output.contracts as Record<string, Record<string, never>>)) {
  for (const [name, c] of Object.entries(contracts)) {
    const artifact = {
      contractName: name,
      sourceFile: file,
      abi: (c as { abi: unknown }).abi,
      bytecode: '0x' + (c as { evm: { bytecode: { object: string } } }).evm.bytecode.object,
    };
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(artifact, null, 2));
    console.log(`  ✓ ${name} (${file})`);
    count++;
  }
}
console.log(`compiled ${count} contracts → contracts/artifacts/`);
