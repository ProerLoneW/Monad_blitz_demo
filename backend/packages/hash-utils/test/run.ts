/**
 * hash-utils 固定测试向量 — 锁定 canonical 序列化行为，防依赖升级漂移。
 * 运行：pnpm test（任何断言失败即退出码非 0）
 */
import assert from 'node:assert/strict';
import {
  canonicalJson,
  canonicalKeccak,
  keccakUtf8,
  buildNoteManifest,
  buildClaimManifest,
  buildEvidenceManifest,
  buildExpenseHashes,
  attestationStatementHash,
} from '../src/index.js';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('hash-utils test vectors');

ok('canonicalJson：键排序 + 无空白', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ x: { d: 1, c: [3, { z: 1, y: 2 }] } }), '{"x":{"c":[3,{"y":2,"z":1}],"d":1}}');
});

ok('canonicalJson：NFC 归一化', () => {
  // é (U+0065 U+0301) → é (U+00E9)
  const nfc = 'e\u0301'.normalize('NFC');
  assert.equal(canonicalJson({ s: 'e\u0301' }), `{"s":${JSON.stringify(nfc)}}`);
});

ok('canonicalJson：undefined 剔除 / null 保留', () => {
  assert.equal(canonicalJson({ a: undefined, b: null }), '{"b":null}');
});

ok('canonicalKeccak：可复现（固定向量）', () => {
  const h = canonicalKeccak({ hello: 'world', n: 1 });
  assert.equal(h, canonicalKeccak({ n: 1, hello: 'world' }));
  assert.match(h, /^0x[0-9a-f]{64}$/);
  // 固定期望值：一旦依赖升级导致变化，此处会失败——需重新审视并同步更新所有已锚定内容
  assert.equal(keccakUtf8(''), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
});

ok('keccakUtf8：keccak256(\"\") 经典向量', () => {
  // keccak256 of empty string（注意：与 sha3 不同）
  assert.equal(keccakUtf8(''), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
});

ok('buildNoteManifest：contentHash 稳定', () => {
  const a = buildNoteManifest({
    noteId: 'note_test', creator: '0xabc0000000000000000000000000000000000abc', type: 'MONETIZED',
    body: 'hello', media: [], tipEnabled: true, streamEnabled: false,
  });
  const b = buildNoteManifest({
    noteId: 'note_test', creator: '0xabc0000000000000000000000000000000000abc', type: 'MONETIZED',
    body: 'hello', media: [], tipEnabled: true, streamEnabled: false,
  });
  assert.equal(a.contentHash, b.contentHash);
  assert.equal(a.manifest.schema, 'proofnote.note.v1');
  // body 变化 → hash 变化
  const c = buildNoteManifest({
    noteId: 'note_test', creator: '0xabc0000000000000000000000000000000000abc', type: 'MONETIZED',
    body: 'hello!', media: [], tipEnabled: true, streamEnabled: false,
  });
  assert.notEqual(a.contentHash, c.contentHash);
});

ok('buildClaimManifest：空字段剔除 + 排序无关', () => {
  const a = buildClaimManifest({ impactId: 'impact_1', claimant: '0xa', claim: { action: 'x', where: '', result: undefined as unknown as string } });
  const b = buildClaimManifest({ impactId: 'impact_1', claimant: '0xa', claim: { result: undefined as unknown as string, action: 'x', where: '' } });
  assert.equal(a.claimHash, b.claimHash);
  assert.deepEqual(Object.keys(a.manifest.claim), ['action']);
});

ok('buildEvidenceManifest：version 影响 hash', () => {
  const item = { mediaId: 'm1', sha256: 'aa', type: 'RECEIPT' };
  const v1 = buildEvidenceManifest({ impactId: 'i1', version: 1, items: [item] });
  const v2 = buildEvidenceManifest({ impactId: 'i1', version: 2, items: [item] });
  assert.notEqual(v1.evidenceManifestHash, v2.evidenceManifestHash);
});

ok('buildExpenseHashes：purpose / evidence 分离', () => {
  const { purposeHash, evidenceHash } = buildExpenseHashes({ purpose: 'Purchase 200kg food', evidenceSha256List: ['aa', 'bb'] });
  assert.match(purposeHash, /^0x[0-9a-f]{64}$/);
  assert.match(evidenceHash, /^0x[0-9a-f]{64}$/);
  const other = buildExpenseHashes({ purpose: 'Purchase 200kg food', evidenceSha256List: ['bb', 'aa'] });
  assert.notEqual(evidenceHash, other.evidenceHash); // 顺序敏感（canonical 数组保序）
});

ok('attestationStatementHash：域绑定', () => {
  const h1 = attestationStatementHash({ impactKey: '0xk1', attester: '0xABC', type: 'PARTICIPATED', statement: 'I was there.' });
  const h2 = attestationStatementHash({ impactKey: '0xk1', attester: '0xabc', type: 'PARTICIPATED', statement: 'I was there.' });
  const h3 = attestationStatementHash({ impactKey: '0xk2', attester: '0xabc', type: 'PARTICIPATED', statement: 'I was there.' });
  assert.equal(h1, h2); // 地址归一化
  assert.notEqual(h1, h3); // impact 域绑定
});

console.log(`\n${passed} groups passed ✔`);
