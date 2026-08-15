import { encodeEventTopics, type Abi } from 'viem';
import { getAbi } from '@proofnote/contract-abis';

/**
 * topic0 → 事件元数据映射（SPEC §34 订阅清单）。
 * Treasury 事件（CampaignFunded/CampaignSpent）来自 Factory 克隆的动态地址，
 * 由 main.ts 动态维护地址列表。
 */
export interface EventMeta {
  contract: string;
  abi: Abi;
  eventName: string;
}

export function buildTopicMap(): Map<string, EventMeta> {
  const entries: Array<{ contract: string; eventName: string }> = [
    { contract: 'noteRegistry', eventName: 'NoteRegistered' },
    { contract: 'supportRouter', eventName: 'TipSent' },
    { contract: 'streamSupport', eventName: 'StreamCreated' },
    { contract: 'streamSupport', eventName: 'StreamPaused' },
    { contract: 'streamSupport', eventName: 'StreamResumed' },
    { contract: 'streamSupport', eventName: 'StreamSettled' },
    { contract: 'streamSupport', eventName: 'CreditWithdrawn' },
    { contract: 'impactRegistry', eventName: 'ImpactRegistered' },
    { contract: 'impactRegistry', eventName: 'EvidenceManifestUpdated' },
    { contract: 'attestationRegistry', eventName: 'Attested' },
    { contract: 'campaignTreasuryFactory', eventName: 'CampaignCreated' },
    { contract: 'campaignTreasury', eventName: 'CampaignFunded' },
    { contract: 'campaignTreasury', eventName: 'CampaignSpent' },
  ];
  const map = new Map<string, EventMeta>();
  for (const e of entries) {
    const abi = getAbi(e.contract as Parameters<typeof getAbi>[0]);
    const topics = encodeEventTopics({ abi, eventName: e.eventName });
    const first = Array.isArray(topics) ? topics[0] : undefined;
    if (typeof first === 'string') {
      map.set(first.toLowerCase(), { contract: e.contract, abi, eventName: e.eventName });
    } else {
      throw new Error(`failed to encode topic for ${e.eventName}`);
    }
  }
  return map;
}
