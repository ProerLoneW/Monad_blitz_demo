import { decodeEventLog, encodeEventTopics, type Abi, type Hex } from 'viem';
import { getAbi } from '@proofnote/contract-abis';
import { AppError } from '../lib/errors.js';
import type { ChainService } from './chain.js';

/**
 * 交易验证服务（后端开发文档 §5.3）——后端只信 receipt 与事件，不信客户端断言（SPEC §38）。
 */

export type AnchorVerifyResult =
  | { outcome: 'PENDING' }
  | { outcome: 'CONFIRMED' }
  | { outcome: 'REVERTED' }
  | { outcome: 'INVALID'; code: 'NOTE_ANCHOR_TX_INVALID' | 'NOTE_NOT_OWNER' | 'NOTE_HASH_MISMATCH' };

/**
 * 五项验证（SPEC §12.2）：
 * tx 成功 / to == 合约 / event.noteKey 匹配 / creator 匹配 / contentHash 匹配
 */
export async function verifyAnchorTx(
  chain: ChainService,
  p: {
    txHash: string;
    registryAddress: string;
    abiName: 'noteRegistry' | 'impactRegistry';
    eventName: 'NoteRegistered' | 'ImpactRegistered';
    expectedNoteKey: string;
    expectedCreator: string;
    expectedContentHash: string;
    /** impact 锚定额外校验 claimHash */
    expectedClaimHash?: string;
  },
): Promise<AnchorVerifyResult> {
  const receipt = await chain.getReceipt(p.txHash);
  if (!receipt) return { outcome: 'PENDING' };
  if (receipt.status !== 'success') return { outcome: 'REVERTED' };
  if (receipt.to?.toLowerCase() !== p.registryAddress.toLowerCase()) {
    return { outcome: 'INVALID', code: 'NOTE_ANCHOR_TX_INVALID' };
  }
  const abi = getAbi(p.abiName);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== p.registryAddress.toLowerCase()) continue;
    if (log.topics[0] !== eventTopic(abi, p.eventName)) continue;
    let decoded: { eventName: string; args: Record<string, unknown> };
    try {
      decoded = decodeEventLog({ abi, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]] }) as unknown as {
        eventName: string;
        args: Record<string, unknown>;
      };
    } catch {
      continue;
    }
    if (decoded.eventName !== p.eventName) continue;
    const args = decoded.args;
    if (String(args.noteKey).toLowerCase() !== p.expectedNoteKey.toLowerCase()) {
      return { outcome: 'INVALID', code: 'NOTE_ANCHOR_TX_INVALID' };
    }
    if (String(args.creator).toLowerCase() !== p.expectedCreator.toLowerCase()) {
      return { outcome: 'INVALID', code: 'NOTE_NOT_OWNER' };
    }
    const contentHash = p.eventName === 'NoteRegistered' ? args.contentHash : args.claimHash;
    if (String(contentHash).toLowerCase() !== p.expectedContentHash.toLowerCase()) {
      return { outcome: 'INVALID', code: 'NOTE_HASH_MISMATCH' };
    }
    if (p.eventName === 'ImpactRegistered' && p.expectedClaimHash) {
      if (String(args.claimHash).toLowerCase() !== p.expectedClaimHash.toLowerCase()) {
        return { outcome: 'INVALID', code: 'NOTE_HASH_MISMATCH' };
      }
    }
    return { outcome: 'CONFIRMED' };
  }
  return { outcome: 'INVALID', code: 'NOTE_ANCHOR_TX_INVALID' };
}

export function anchorError(code: 'NOTE_ANCHOR_TX_INVALID' | 'NOTE_NOT_OWNER' | 'NOTE_HASH_MISMATCH'): AppError {
  return new AppError(code);
}

const topicCache = new Map<string, string | undefined>();

/** 事件签名 topic0：keccak256("Name(type,...)") */
function eventTopic(abi: Abi, eventName: string): string | undefined {
  if (topicCache.has(eventName)) return topicCache.get(eventName);
  let topic: string | undefined;
  try {
    const topics = encodeEventTopics({ abi, eventName });
    const first = Array.isArray(topics) ? topics[0] : undefined;
    topic = typeof first === 'string' ? first.toLowerCase() : undefined;
  } catch {
    topic = undefined;
  }
  topicCache.set(eventName, topic);
  return topic;
}
