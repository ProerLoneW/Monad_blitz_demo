/**
 * DEMO_UNIVERSE — 唯一演示数据源。
 * 所有人物、数字、文案逐字取自 PROTOTYPE_PROMPTS.md §6（及 P01–P07 的
 * "Exact Visible UI Elements"），不允许新造名字 / 金额 / 地址。
 * 截断展示的地址/哈希（0x12A4…92Bc、0x4a…9F、0x99…c4、0x7f…e2）在此
 * 补全为确定性的完整 mock 值，首末字符与文档一致；UI 一律经
 * truncateAddress() 按 §16.2 规则展示。
 */
import type {
  AppConfig,
  Attestation,
  Campaign,
  CampaignTransparency,
  EvidenceItem,
  ImpactSummary,
  IncomingStreamsSummary,
  Money,
  Note,
  NoteValuePanel,
  Profile,
  Stream,
} from "@proofnote/api-types";
import type { ImpactDetailExtras, ProfileStatsExtended, FeedItemView } from "@/types";

// ── helpers ────────────────────────────────────────────────

export function mon(amount: string): Money {
  // amount: decimal MON string, e.g. "12.8" → wei string
  const [int, frac = ""] = amount.split(".");
  const wei = (int.replace(/^0+(?=\d)/, "") || "0") + (frac + "0".repeat(18)).slice(0, 18);
  return {
    amountWei: wei.replace(/^0+(?=\d)/, ""),
    formatted: amount,
    symbol: "MON",
    decimals: 18,
    tokenAddress: null,
  };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// ── addresses ──────────────────────────────────────────────

export const ADDR = {
  alice: "0x12A40000000000000000000000000000000092Bc",
  bob: "0x8F30000000000000000000000000000000000c21",
  carol: "0xCA50000000000000000000000000000000000CA5",
  treasury: "0x4a0000000000000000000000000000000000009F",
  protocol: "0x00000000000000000000000000000000000000FE",
} as const;

export const HASH = {
  tutorialContent:
    "0x99000000000000000000000000000000000000000000000000000000000000c4",
  riverClaim:
    "0x7f000000000000000000000000000000000000000000000000000000000000e2",
} as const;

const EXPLORER = "https://testnet.monadexplorer.com";

// ── config (mock of GET /config) ───────────────────────────

export const mockConfig: AppConfig = {
  environment: "development",
  mockChain: true,
  chain: {
    name: "Monad Testnet",
    chainId: 10143,
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrl: "https://testnet-rpc.monad.xyz",
    explorerBaseUrl: EXPLORER,
  },
  contracts: {
    noteRegistry: null,
    supportRouter: null,
    streamSupport: null,
    impactRegistry: null,
    attestationRegistry: null,
    campaignTreasuryFactory: null,
  },
  features: {
    directTip: true,
    streamSupport: true,
    impact: true,
    campaign: true,
    attestation: true,
  },
};

// ── profiles ───────────────────────────────────────────────

export const aliceSummary = {
  walletAddress: ADDR.alice,
  handle: "alice",
  displayName: "Alice",
  avatarUrl: null,
};
export const bobSummary = {
  walletAddress: ADDR.bob,
  handle: "bob",
  displayName: "Bob",
  avatarUrl: null,
};
export const carolSummary = {
  walletAddress: ADDR.carol,
  handle: "carol",
  displayName: "Carol",
  avatarUrl: null,
};

export const aliceProfile: Profile & { stats: ProfileStatsExtended } = {
  id: "prof_alice",
  walletAddress: ADDR.alice,
  handle: "alice",
  displayName: "Alice",
  bio: "Creator & Monad builder",
  avatarUrl: null,
  createdAt: hoursAgo(24 * 90),
  stats: {
    notes: 14,
    monetizedNotes: 4,
    creatorRevenue: mon("328"),
    collaborations: 21,
    impactNotes: 2,
    verifiedActions: 1,
    directedToCauses: mon("32.8"),
    attestationsReceived: 6,
  },
};

// ── notes ──────────────────────────────────────────────────

export const NOTE_PHOTO = "note_photo-night-city";
export const NOTE_TUTORIAL = "note_monad-parallel-execution";
export const NOTE_RIVER = "note_river-cleanup-3";
export const NOTE_SHELTER = "note_animal-shelter-food";
export const IMPACT_RIVER = "imp_river-cleanup-3";
export const CAMPAIGN_SHELTER = "camp_animal-shelter-food";
export const STREAM_BOB_TUTORIAL = "stream_bob-tutorial";

const tutorialValue = {
  tipEnabled: true,
  streamEnabled: true,
  totalSupport: mon("12.8"),
  supporterCount: 42,
  activeStreams: 3,
  incomingRateWeiPerSecond: "1200000000000000", // 0.0012 MON/s
};

const riverImpactSummary: ImpactSummary = {
  id: IMPACT_RIVER,
  claimHash: HASH.riverClaim,
  verification: {
    level: "L2",
    evidenceCount: 5,
    attestationCount: 5,
    trustedVerifierCount: 0,
    openChallengeCount: 0,
  },
};

export const notes: Record<string, Note> = {
  [NOTE_PHOTO]: {
    id: NOTE_PHOTO,
    noteKey: "0x00000000000000000000000000000000000000000000000000000000000000a1",
    type: "STANDARD",
    status: "PUBLISHED",
    author: aliceSummary,
    title: "Night City, Quiet Neon",
    body: "Shot on a rainy walk home — the city reads completely differently once the signs are the only light left. No edits beyond a crop.",
    media: [
      {
        id: "media_photo-night",
        status: "READY",
        contentType: "image/jpeg",
        sizeBytes: 0,
        sha256: null,
        url: null,
        storageUri: null,
        width: 1200,
        height: 900,
        durationMs: null,
      },
    ],
    contentHash: null,
    manifestUri: null,
    ownership: { anchored: true, ownerAddress: ADDR.alice, contentHash: null, explorerUrl: null },
    createdAt: hoursAgo(5),
    publishedAt: hoursAgo(5),
  },
  [NOTE_TUTORIAL]: {
    id: NOTE_TUTORIAL,
    noteKey: "0x00000000000000000000000000000000000000000000000000000000000000a2",
    type: "MONETIZED",
    status: "PUBLISHED",
    author: aliceSummary,
    title: "Understanding Monad Parallel Execution",
    body: "Parallel execution sounds scary. It isn't. Here's how Monad actually orders 10,000 transactions…",
    media: [
      {
        id: "media_tutorial-video",
        status: "READY",
        contentType: "video/mp4",
        sizeBytes: 0,
        sha256: null,
        url: null,
        storageUri: null,
        width: 1280,
        height: 720,
        durationMs: null,
      },
    ],
    contentHash: HASH.tutorialContent,
    manifestUri: null,
    ownership: {
      anchored: true,
      ownerAddress: ADDR.alice,
      contentHash: HASH.tutorialContent,
      explorerUrl: `${EXPLORER}/tx/${HASH.tutorialContent}`,
    },
    value: tutorialValue,
    createdAt: hoursAgo(2),
    publishedAt: hoursAgo(2),
  },
  [NOTE_RIVER]: {
    id: NOTE_RIVER,
    noteKey: "0x00000000000000000000000000000000000000000000000000000000000000a3",
    type: "IMPACT",
    status: "PUBLISHED",
    author: aliceSummary,
    title: "River Cleanup — Session 3",
    body: "Third session at Riverside Park. The bank below the footbridge is finally clear — full claim and evidence below.",
    media: [
      {
        id: "media_river-group",
        status: "READY",
        contentType: "image/jpeg",
        sizeBytes: 0,
        sha256: null,
        url: null,
        storageUri: null,
        width: 1200,
        height: 900,
        durationMs: null,
      },
    ],
    contentHash: null,
    manifestUri: null,
    ownership: { anchored: true, ownerAddress: ADDR.alice, contentHash: null, explorerUrl: null },
    value: {
      tipEnabled: true,
      streamEnabled: false,
      totalSupport: mon("3.2"),
      supporterCount: 18,
      activeStreams: 0,
      incomingRateWeiPerSecond: "0",
    },
    impact: riverImpactSummary,
    createdAt: hoursAgo(3),
    publishedAt: hoursAgo(3),
  },
  [NOTE_SHELTER]: {
    id: NOTE_SHELTER,
    noteKey: "0x00000000000000000000000000000000000000000000000000000000000000a4",
    type: "CAMPAIGN",
    status: "PUBLISHED",
    author: aliceSummary,
    title: "Local Animal Shelter — 500 kg of food for one week",
    body: "Our neighborhood shelter runs out of kibble every month. One week of food is 500 kg — fund it here, watch every MON move on the transparency page.",
    media: [],
    contentHash: null,
    manifestUri: null,
    ownership: { anchored: true, ownerAddress: ADDR.alice, contentHash: null, explorerUrl: null },
    createdAt: hoursAgo(30),
    publishedAt: hoursAgo(30),
  },
};

/** Feed 混排顺序逐字取自 §6.7：摄影 → 教程 → 清理 → 猫粮。 */
export const feedItems: FeedItemView[] = [
  {
    id: NOTE_PHOTO,
    type: "STANDARD",
    author: aliceSummary,
    title: notes[NOTE_PHOTO].title,
    bodyPreview: notes[NOTE_PHOTO].body,
    coverUrl: null,
    badges: [],
    createdAt: notes[NOTE_PHOTO].createdAt,
  },
  {
    id: NOTE_TUTORIAL,
    type: "MONETIZED",
    author: aliceSummary,
    title: notes[NOTE_TUTORIAL].title,
    bodyPreview: notes[NOTE_TUTORIAL].body,
    coverUrl: null,
    badges: [],
    value: {
      totalSupportFormatted: "12.8",
      symbol: "MON",
      supporterCount: 42,
      activeStreams: 3,
      incomingRateWeiPerSecond: "1200000000000000",
    },
    createdAt: notes[NOTE_TUTORIAL].createdAt,
  },
  {
    id: NOTE_RIVER,
    type: "IMPACT",
    author: aliceSummary,
    title: notes[NOTE_RIVER].title,
    bodyPreview: notes[NOTE_RIVER].body,
    coverUrl: null,
    badges: ["IMPACT"],
    impact: { verificationLevel: "L2", evidenceCount: 5, attestationCount: 5 },
    createdAt: notes[NOTE_RIVER].createdAt,
  },
  {
    id: NOTE_SHELTER,
    type: "CAMPAIGN",
    author: aliceSummary,
    title: notes[NOTE_SHELTER].title,
    bodyPreview: notes[NOTE_SHELTER].body,
    coverUrl: null,
    badges: ["FUNDING"],
    funding: { raisedFormatted: "23", targetFormatted: "100", percent: 23 },
    createdAt: notes[NOTE_SHELTER].createdAt,
  },
];

/** Home 右栏 "On Monad now"（P01：三行实时活动，首行逐字取自 P01 §7）。 */
export const liveActivity = [
  { text: "0x12A4…92Bc tipped 5 MON", ago: "12s ago" },
  { text: "@carol witnessed River Cleanup — Session 3", ago: "1h ago" },
  { text: "Treasury 0x4a…9F paid 5 MON · Food Supplier", ago: "2d ago" },
];

// ── value panel ────────────────────────────────────────────

export const noteValuePanels: Record<string, NoteValuePanel> = {
  [NOTE_TUTORIAL]: {
    tip: { enabled: true },
    stream: { enabled: true, activeCount: 3, incomingRateWeiPerSecond: "1200000000000000" },
    totalSupport: mon("12.8"),
    distribution: [
      { role: "CREATOR", address: ADDR.alice, bps: 9800 },
      { role: "PROTOCOL", address: ADDR.protocol, bps: 200 },
    ],
  },
  [NOTE_RIVER]: {
    tip: { enabled: true },
    stream: { enabled: false, activeCount: 0, incomingRateWeiPerSecond: "0" },
    totalSupport: mon("3.2"),
    distribution: [
      { role: "CREATOR", address: ADDR.alice, bps: 9800 },
      { role: "PROTOCOL", address: ADDR.protocol, bps: 200 },
    ],
  },
};

/** River Note 的 supporter 数（P04 §7：3.2 MON supported · 18 supporters）。 */
export const riverSupporterCount = 18;
export const tutorialSupporterCount = 42;

// ── stream（P03 §8：Bob 的 Stream）─────────────────────────

export const bobStream: Stream = {
  streamId: STREAM_BOB_TUTORIAL,
  noteId: NOTE_TUTORIAL,
  supporter: ADDR.bob,
  creator: ADDR.alice,
  rateWeiPerSecond: "1000000000000000", // 0.001 MON/s（显示为 0.06 MON/min）
  budgetWei: mon("0.2").amountWei,
  accruedWei: "43171000000000000", // 0.043171 MON
  remainingBudgetWei: "156829000000000000", // 0.2 − 0.043171
  status: "ACTIVE",
  snapshotAt: new Date().toISOString(),
  estimatedEndAt: null,
  chain: { chainId: 10143 },
};

/** Alice 本人 Profile 的 Dashboard 条（§6.6）。 */
export const aliceIncoming: IncomingStreamsSummary = {
  aggregateIncomingRateWeiPerSecond: "7000000000000000", // 0.007 MON/s
  activeStreamCount: 7,
  estimatedUnsettledIncomeWei: mon("0.123").amountWei,
  streams: [bobStream],
};

// ── impact（§6.4 / P04 §7）─────────────────────────────────

export const riverImpactExtras: ImpactDetailExtras = {
  claim: {
    who: "12 volunteers",
    action: "cleaned 3.4 km of riverbank and removed ~186 kg of waste",
    when: "Aug 12",
    whereText: "Riverside Park",
  },
  claimText: "On Aug 12, 12 volunteers cleaned 3.4 km of riverbank and removed ~186 kg of waste.",
  distanceKm: "3.4",
  wasteKg: "186",
  level: "L2",
};

export const riverEvidence: EvidenceItem[] = [
  { id: "ev_group", mediaId: "media_ev_group", type: "PHOTO", title: "Group photo", description: null, capturedAt: "2025-08-12T09:00:00.000Z", sha256: null, url: null },
  { id: "ev_before_after", mediaId: "media_ev_before_after", type: "PHOTO", title: "Before / after", description: null, capturedAt: "2025-08-12T10:00:00.000Z", sha256: null, url: null },
  { id: "ev_weigh_in", mediaId: "media_ev_weigh_in", type: "PHOTO", title: "Weigh-in photo", description: null, capturedAt: "2025-08-12T11:00:00.000Z", sha256: null, url: null },
  { id: "ev_receipt", mediaId: "media_ev_receipt", type: "DOCUMENT", title: "Receipt PDF", description: null, capturedAt: "2025-08-12T12:00:00.000Z", sha256: null, url: null },
  { id: "ev_transfer", mediaId: "media_ev_transfer", type: "DOCUMENT", title: "Waste transfer manifest", description: null, capturedAt: "2025-08-12T12:30:00.000Z", sha256: null, url: null },
];

/** 5 条背书：Bob participated · Carol witnessed，另 3 条为无 Profile 的地址
 * （§6.4 给出 "…" 但未命名 —— 不得新造名字，退化为截断地址身份）。 */
export const riverAttestations: Attestation[] = [
  {
    id: "att_bob",
    attester: { address: ADDR.bob, profile: { handle: "bob", displayName: "Bob" } },
    type: "PARTICIPATED",
    statementHash: HASH.riverClaim,
    createdAt: hoursAgo(2),
    explorerUrl: `${EXPLORER}/tx/${HASH.riverClaim}`,
  },
  {
    id: "att_carol",
    attester: { address: ADDR.carol, profile: { handle: "carol", displayName: "Carol" } },
    type: "WITNESSED",
    statementHash: HASH.riverClaim,
    createdAt: hoursAgo(1),
    explorerUrl: `${EXPLORER}/tx/${HASH.riverClaim}`,
  },
  ...[1, 2, 3].map((n): Attestation => {
    const addr = `0x${String(n).padStart(4, "0")}${"0".repeat(32)}aTT${n}`.slice(0, 42) as `0x${string}`;
    return {
      id: `att_anon_${n}`,
      attester: { address: addr, profile: null },
      type: "WITNESSED",
      statementHash: HASH.riverClaim,
      createdAt: hoursAgo(n * 5),
      explorerUrl: null,
    };
  }),
];

// ── campaign（§6.5 / P05 §7；23 = 8 + 15 守恒）──────────────

export const shelterCampaign: Campaign = {
  id: CAMPAIGN_SHELTER,
  noteId: NOTE_SHELTER,
  impactId: "imp_animal-shelter",
  organizer: ADDR.alice,
  treasuryAddress: ADDR.treasury,
  goal: "500kg food for one week",
  targetWei: mon("100").amountWei,
  raisedWei: mon("23").amountWei,
  spentWei: mon("8").amountWei,
  committedWei: "0",
  remainingWei: mon("15").amountWei,
  status: "OPEN",
  expenseCount: 3,
};

export const shelterTransparency: CampaignTransparency = {
  campaign: {
    id: CAMPAIGN_SHELTER,
    goal: "500kg food for one week",
    treasuryAddress: ADDR.treasury,
  },
  summary: {
    raisedWei: mon("23").amountWei,
    spentWei: mon("8").amountWei,
    committedWei: "0",
    remainingWei: mon("15").amountWei,
  },
  funding: [
    { from: ADDR.alice, amountWei: mon("5").amountWei, txHash: HASH.riverClaim, createdAt: hoursAgo(3), explorerUrl: `${EXPLORER}/tx/${HASH.riverClaim}` },
    { from: ADDR.bob, amountWei: mon("8").amountWei, txHash: HASH.riverClaim, createdAt: hoursAgo(8), explorerUrl: `${EXPLORER}/tx/${HASH.riverClaim}` },
    { from: ADDR.carol, amountWei: mon("4").amountWei, txHash: HASH.riverClaim, createdAt: hoursAgo(20), explorerUrl: `${EXPLORER}/tx/${HASH.riverClaim}` },
    { from: "0x0001000000000000000000000000000000000F01", amountWei: mon("3.5").amountWei, txHash: HASH.riverClaim, createdAt: hoursAgo(26), explorerUrl: null },
    { from: "0x0002000000000000000000000000000000000F02", amountWei: mon("2.5").amountWei, txHash: HASH.riverClaim, createdAt: hoursAgo(28), explorerUrl: null },
  ],
  expenses: [
    {
      id: "exp_food",
      recipient: "Food Supplier",
      amountWei: mon("5").amountWei,
      purpose: "Purchase 200kg animal food",
      evidence: [{ mediaId: "media_exp_food", type: "DOCUMENT", sha256: null, url: null }],
      txHash: HASH.riverClaim,
      explorerUrl: `${EXPLORER}/tx/${HASH.riverClaim}`,
    },
    {
      id: "exp_logistics",
      recipient: "Logistics",
      amountWei: mon("2").amountWei,
      purpose: "Transport",
      evidence: [{ mediaId: "media_exp_logistics", type: "DOCUMENT", sha256: null, url: null }],
      txHash: HASH.riverClaim,
      explorerUrl: `${EXPLORER}/tx/${HASH.riverClaim}`,
    },
    {
      id: "exp_venue",
      recipient: "Venue",
      amountWei: mon("1").amountWei,
      purpose: "Venue deposit",
      evidence: [],
      txHash: HASH.riverClaim,
      explorerUrl: `${EXPLORER}/tx/${HASH.riverClaim}`,
    },
  ],
  verification: { level: "L2", evidenceCount: 4, attestationCount: 3 },
};

/** Funding 列表的 supporter 总数（§6.5：12 supporters）。 */
export const shelterSupporterCount = 12;
