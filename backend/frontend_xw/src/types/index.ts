/**
 * Shared API types are re-exported from the workspace package
 * `@proofnote/api-types` (frozen from the MVP API SPEC). Display-only
 * extension fields that the frozen package does not carry are declared here.
 */
export * from "@proofnote/api-types";

import type {
  CampaignTransparency,
  FeedItem,
  ImpactClaim,
  ImpactVerificationLevel,
  Money,
  ProfileStats,
} from "@proofnote/api-types";

/** Feed 卡片的展示视图：FeedItem + Value/Funding 增强行所需的聚合字段
 * （HTTP 模式下由 /feed 响应或 data-access 层聚合填充）。 */
export type FeedItemView = Omit<FeedItem, "value"> & {
  value?: {
    totalSupportFormatted: string;
    symbol: string;
    supporterCount: number;
    activeStreams: number;
    incomingRateWeiPerSecond: string;
  };
  funding?: { raisedFormatted: string; targetFormatted: string; percent: number };
};

/** Profile stats shown on the Creation panel that the frozen ProfileStats
 * does not include (FRONTEND_DESIGN §10.6 / PROTOTYPE §6.6). */
export type ProfileStatsExtended = ProfileStats & {
  collaborations: number;
  verifiedActions: number;
};

/** Impact detail payload = note + claim + evidence + attestations. */
export type ImpactDetailExtras = {
  claim: ImpactClaim;
  claimText: string;
  distanceKm: string;
  wasteKg: string;
  level: ImpactVerificationLevel;
};

/** Campaign summary strip numbers, formatted for display. */
export type CampaignSummaryDisplay = {
  target: Money;
  raised: Money;
  spent: Money;
  remaining: Money;
  supporterCount: number;
};

export type TransparencyView = CampaignTransparency & {
  display: CampaignSummaryDisplay;
};
