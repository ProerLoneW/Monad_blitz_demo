/**
 * ABI 冻结件比对：backend/packages/contract-abis（后端消费的冻结接口）⊆ 编译产物。
 * 规则（SPEC §64）：冻结的函数签名与事件签名不得漂移；合约新增接口是允许的（后端忽略未知项）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(base, '..', 'artifacts');
const frozenDir = join(base, '..', '..', 'packages', 'contract-abis', 'src', 'abis');

const MAPPING: Record<string, string> = {
  NoteRegistry: 'NoteRegistry.json',
  SupportRouter: 'SupportRouter.json',
  StreamSupport: 'StreamSupport.json',
  ImpactRegistry: 'ImpactRegistry.json',
  AttestationRegistry: 'AttestationRegistry.json',
  CampaignTreasuryFactory: 'CampaignTreasuryFactory.json',
  CampaignTreasury: 'CampaignTreasury.json',
};

type AbiEntry = {
  type: string;
  name: string;
  stateMutability?: string;
  inputs?: Array<{ name: string; type: string; indexed?: boolean }>;
  outputs?: Array<{ name: string; type: string }>;
};

const sig = (e: AbiEntry) =>
  `${e.type}:${e.name}(${(e.inputs ?? []).map((i) => i.type).join(',')})` +
  (e.type === 'function' ? `→(${(e.outputs ?? []).map((o) => o.type).join(',')})` : '') +
  (e.type === 'function' ? `:${e.stateMutability}` : '') +
  (e.type === 'event' ? `:${(e.inputs ?? []).map((i) => (i.indexed ? 'i' : '') + i.type).join(',')}` : '');

let failures = 0;
let checked = 0;

for (const [contract, frozenFile] of Object.entries(MAPPING)) {
  const artifactPath = join(artifactsDir, `${contract}.json`);
  const frozenPath = join(frozenDir, frozenFile);
  if (!existsSync(artifactPath)) {
    console.error(`✗ ${contract}: artifact 缺失（先 pnpm compile）`);
    failures++;
    continue;
  }
  const compiled = (JSON.parse(readFileSync(artifactPath, 'utf8')) as { abi: AbiEntry[] }).abi;
  const frozen = JSON.parse(readFileSync(frozenPath, 'utf8')) as AbiEntry[];

  const compiledSigs = new Set(compiled.map(sig));
  const missing: string[] = [];
  for (const entry of frozen) {
    checked++;
    if (!compiledSigs.has(sig(entry))) missing.push(sig(entry));
  }
  if (missing.length > 0) {
    console.error(`✗ ${contract} 与冻结 ABI 不一致，缺失/漂移：`);
    for (const m of missing) console.error(`    ${m}`);
    failures++;
  } else {
    const extra = compiled.length - frozen.length;
    console.log(`  ✓ ${contract}: ${frozen.length} 项冻结接口全部匹配${extra > 0 ? `（+${extra} 附加接口）` : ''}`);
  }
}

if (failures > 0) {
  console.error(`\nABI check FAILED (${failures} contract(s) mismatched)`);
  process.exit(1);
}
console.log(`\nABI check 通过：${checked} 项冻结接口与合约实现完全一致 ✔`);
