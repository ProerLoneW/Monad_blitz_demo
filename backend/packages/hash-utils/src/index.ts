import { keccak256, toHex, type Hex } from 'viem';

/**
 * Canonical 序列化 + 哈希规则 — 后端开发文档 §5.1
 *
 * 1. 字符串值先做 Unicode NFC 归一化
 * 2. 对象键按 UTF-16 码位排序；undefined 字段剔除
 * 3. 输出紧凑 JSON（无空白/换行），UTF-8 编码
 * 4. hash = keccak256(utf8Bytes)
 *
 * 本模块是 Ownership 哈希的唯一实现来源，禁止在其他处复制此逻辑。
 */

export function normalizeDeep(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(normalizeDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = normalizeDeep(v);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const v = normalizeDeep(value);
  return stringify(v);
}

function stringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const val = obj[k];
    if (val === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${stringify(val)}`);
  }
  return `{${parts.join(',')}}`;
}

export function keccakUtf8(text: string): Hex {
  const bytes = new TextEncoder().encode(text.normalize('NFC'));
  return keccak256(toHex(bytes));
}

/** canonical JSON 对象 → keccak256 */
export function canonicalKeccak(value: unknown): Hex {
  return keccakUtf8(canonicalJson(value));
}

/** 纯文本（如 expense purpose）→ keccak256 */
export function textKeccak(text: string): Hex {
  return keccakUtf8(text);
}

// ── Manifest 构建器 ─────────────────────────────────────────

/** SPEC §11 — note manifest schema proofnote.note.v1 */
export type NoteManifest = {
  schema: 'proofnote.note.v1';
  noteId: string;
  creator: string;
  type: string;
  title?: string | null;
  body: string;
  media: Array<{ mediaId: string; sha256: string | null; uri: string | null }>;
  monetization?: { tipEnabled: boolean; streamEnabled: boolean };
};

export function buildNoteManifest(input: {
  noteId: string;
  creator: string; // lowercase address
  type: string;
  title?: string | null;
  body: string;
  media: Array<{ mediaId: string; sha256: string | null; uri: string | null }>;
  tipEnabled: boolean;
  streamEnabled: boolean;
}): { manifest: NoteManifest; contentHash: Hex } {
  const manifest: NoteManifest = {
    schema: 'proofnote.note.v1',
    noteId: input.noteId,
    creator: input.creator,
    type: input.type,
    title: input.title ?? undefined,
    body: input.body,
    media: input.media.map((m) => ({
      mediaId: m.mediaId,
      sha256: m.sha256,
      uri: m.uri,
    })),
    monetization: { tipEnabled: input.tipEnabled, streamEnabled: input.streamEnabled },
  };
  return { manifest, contentHash: canonicalKeccak(manifest) };
}

/** Impact claim manifest — proofnote.impact.claim.v1 */
export type ClaimManifest = {
  schema: 'proofnote.impact.claim.v1';
  impactId: string;
  claimant: string;
  claim: Record<string, string | undefined>;
};

export function buildClaimManifest(input: {
  impactId: string;
  claimant: string;
  claim: Record<string, string | undefined>;
}): { manifest: ClaimManifest; claimHash: Hex } {
  const claim: Record<string, string | undefined> = {};
  for (const k of Object.keys(input.claim).sort()) {
    const v = input.claim[k];
    if (v === undefined || v === null || v === '') continue;
    claim[k] = v;
  }
  const manifest: ClaimManifest = {
    schema: 'proofnote.impact.claim.v1',
    impactId: input.impactId,
    claimant: input.claimant,
    claim,
  };
  return { manifest, claimHash: canonicalKeccak(manifest) };
}

/** Evidence manifest — proofnote.impact.evidence.v1（版本化，追加即新 version） */
export type EvidenceManifest = {
  schema: 'proofnote.impact.evidence.v1';
  impactId: string;
  version: number;
  items: Array<{
    mediaId: string;
    sha256: string | null;
    type: string;
    capturedAt?: string | null;
  }>;
};

export function buildEvidenceManifest(input: {
  impactId: string;
  version: number;
  items: Array<{ mediaId: string; sha256: string | null; type: string; capturedAt?: string | null }>;
}): { manifest: EvidenceManifest; evidenceManifestHash: Hex } {
  const manifest: EvidenceManifest = {
    schema: 'proofnote.impact.evidence.v1',
    impactId: input.impactId,
    version: input.version,
    items: input.items.map((i) => ({
      mediaId: i.mediaId,
      sha256: i.sha256,
      type: i.type,
      capturedAt: i.capturedAt ?? undefined,
    })),
  };
  return { manifest, evidenceManifestHash: canonicalKeccak(manifest) };
}

/** Expense manifest — proofnote.campaign.expense.v1（不可变） */
export function buildExpenseHashes(input: {
  purpose: string;
  evidenceSha256List: string[];
}): { purposeHash: Hex; evidenceHash: Hex } {
  const purposeHash = textKeccak(input.purpose);
  const evidenceHash = canonicalKeccak(input.evidenceSha256List);
  return { purposeHash, evidenceHash };
}

/** Attestation statement hash — 域绑定：impact|attester|type|statement */
export function attestationStatementHash(input: {
  impactKey: string;
  attester: string;
  type: string;
  statement: string;
}): Hex {
  return keccakUtf8(`${input.impactKey}|${input.attester.toLowerCase()}|${input.type}|${input.statement}`);
}
