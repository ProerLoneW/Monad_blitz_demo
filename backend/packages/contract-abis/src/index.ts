import noteRegistryAbi from './abis/NoteRegistry.json' with { type: 'json' };
import supportRouterAbi from './abis/SupportRouter.json' with { type: 'json' };
import streamSupportAbi from './abis/StreamSupport.json' with { type: 'json' };
import impactRegistryAbi from './abis/ImpactRegistry.json' with { type: 'json' };
import attestationRegistryAbi from './abis/AttestationRegistry.json' with { type: 'json' };
import campaignTreasuryFactoryAbi from './abis/CampaignTreasuryFactory.json' with { type: 'json' };
import campaignTreasuryAbi from './abis/CampaignTreasury.json' with { type: 'json' };
import type { Abi } from 'viem';

/**
 * SPEC §26–§33 冻结的最小 ABI。进入联调阶段后不得手改；
 * 合约侧构建产物（forge inspect ... json）同步替换本目录 JSON。
 */
export const ABIS = {
  noteRegistry: noteRegistryAbi as unknown as Abi,
  supportRouter: supportRouterAbi as unknown as Abi,
  streamSupport: streamSupportAbi as unknown as Abi,
  impactRegistry: impactRegistryAbi as unknown as Abi,
  attestationRegistry: attestationRegistryAbi as unknown as Abi,
  campaignTreasuryFactory: campaignTreasuryFactoryAbi as unknown as Abi,
  campaignTreasury: campaignTreasuryAbi as unknown as Abi,
} as const;

export type AbiName = keyof typeof ABIS;

export function getAbi(name: AbiName): Abi {
  return ABIS[name];
}
