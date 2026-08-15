/**
 * ProofNote 前后端共享类型 — 冻结自 ProofNote MVP API SPEC V1.0
 * 命名与字段不得随意改动（SPEC §64 接口冻结原则）。
 */

// ── 基础类型 ────────────────────────────────────────────────

/** 金额：wei 一律字符串，禁止 number（SPEC §4.5） */
export type Money = {
  amountWei: string;
  formatted: string;
  symbol: string;
  decimals: number;
  tokenAddress?: `0x${string}` | null;
};

export type ChainRef = {
  chainId: number;
  txHash?: `0x${string}`;
  blockNumber?: string;
  explorerUrl?: string;
};

/** 后端 prepare 统一返回的交易请求（前端钱包执行） */
export type TxRequest = {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string; // wei string
  functionName: string;
  description: string;
  /** mock 模式标记：无真实链，前端可用于联调 */
  mock?: boolean;
};

export type PageInfo = {
  nextCursor: string | null;
  hasNext: boolean;
};

export type ApiListResponse<T> = {
  data: { items: T[]; pageInfo: PageInfo };
};

export type ApiItemResponse<T> = {
  data: T;
};

export type ApiErrorEnvelope = {
  error: { code: string; message: string; requestId: string };
};

// ── Profile / User ─────────────────────────────────────────

export type ProfileSummary = {
  walletAddress: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type ProfileStats = {
  notes: number;
  monetizedNotes: number;
  creatorRevenue: Money;
  impactNotes: number;
  attestationsReceived: number;
  directedToCauses: Money;
};

export type Profile = {
  id: string;
  walletAddress: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  createdAt: string;
  stats: ProfileStats;
};

// ── Media / Upload ─────────────────────────────────────────

export type UploadPurpose = 'NOTE_MEDIA' | 'PROFILE_AVATAR' | 'IMPACT_EVIDENCE';

export type MediaStatus = 'PENDING' | 'READY' | 'FAILED';

export type Media = {
  id: string;
  status: MediaStatus;
  contentType: string;
  sizeBytes: number;
  sha256: string | null;
  url: string | null;
  storageUri: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

export type PresignResult = {
  mediaId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
};

// ── Note ───────────────────────────────────────────────────

export type NoteType = 'STANDARD' | 'MONETIZED' | 'IMPACT' | 'CAMPAIGN';

export type NoteStatus = 'DRAFT' | 'PENDING_ANCHOR' | 'PUBLISHED' | 'HIDDEN';

export type NoteOwnership = {
  anchored: boolean;
  ownerAddress: string;
  contentHash?: `0x${string}` | null;
  explorerUrl?: string | null;
};

export type NoteValueSummary = {
  tipEnabled: boolean;
  streamEnabled: boolean;
  totalSupport: Money;
  supporterCount: number;
  activeStreams: number;
  incomingRateWeiPerSecond: string;
};

export type Note = {
  id: string;
  noteKey: `0x${string}`;
  type: NoteType;
  status: NoteStatus;
  author: ProfileSummary;
  title?: string | null;
  body: string;
  media: Media[];
  contentHash: `0x${string}` | null;
  manifestUri: string | null;
  ownership: NoteOwnership;
  value?: NoteValueSummary;
  impact?: ImpactSummary | null;
  createdAt: string;
  publishedAt?: string | null;
};

export type FeedItem = {
  id: string;
  type: NoteType;
  author: ProfileSummary;
  title?: string | null;
  bodyPreview: string;
  coverUrl?: string | null;
  badges: string[];
  value?: { totalSupportFormatted: string; symbol: string };
  impact?: {
    verificationLevel: string;
    evidenceCount: number;
    attestationCount: number;
  } | null;
  createdAt: string;
};

// ── Value / Tip ────────────────────────────────────────────

export type DistributionEntry = {
  role: 'CREATOR' | 'PROTOCOL';
  address: string;
  bps: number;
};

export type NoteValuePanel = {
  tip: { enabled: boolean };
  stream: {
    enabled: boolean;
    activeCount: number;
    incomingRateWeiPerSecond: string;
  };
  totalSupport: Money;
  distribution: DistributionEntry[];
};

export type TipQuote = {
  gross: string;
  creatorReceives: string;
  protocolFee: string;
};

// ── Stream ─────────────────────────────────────────────────

export type StreamStatus = 'ACTIVE' | 'PAUSED' | 'DEPLETED' | 'SETTLED';

export type Stream = {
  streamId: string;
  noteId: string | null;
  supporter: string;
  creator: string;
  rateWeiPerSecond: string;
  budgetWei: string;
  accruedWei: string;
  remainingBudgetWei: string;
  status: StreamStatus;
  snapshotAt: string;
  estimatedEndAt?: string | null;
  chain?: { chainId: number };
};

export type IncomingStreamsSummary = {
  aggregateIncomingRateWeiPerSecond: string;
  activeStreamCount: number;
  estimatedUnsettledIncomeWei: string;
  streams: Stream[];
};

// ── Impact / Attestation ───────────────────────────────────

export type ImpactVerificationLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export type ImpactClaim = {
  summary?: string;
  who?: string;
  action: string;
  when?: string;
  whereText?: string;
  beneficiary?: string;
  resources?: string;
  result?: string;
};

export type EvidenceItem = {
  id: string;
  mediaId: string;
  type: string;
  title?: string | null;
  description?: string | null;
  capturedAt?: string | null;
  sha256: string | null;
  url: string | null;
};

export type ImpactSummary = {
  id: string;
  claimHash: `0x${string}`;
  verification: {
    level: ImpactVerificationLevel;
    evidenceCount: number;
    attestationCount: number;
    trustedVerifierCount: number;
    openChallengeCount: number;
  };
};

export type AttestationType = 'PARTICIPATED' | 'WITNESSED';

export type Attestation = {
  id: string;
  attester: { address: string; profile?: { handle: string | null; displayName: string | null } | null };
  type: AttestationType;
  statementHash: `0x${string}`;
  createdAt: string;
  explorerUrl?: string | null;
};

// ── Campaign ───────────────────────────────────────────────

export type CampaignStatus = 'OPEN' | 'CLOSED' | 'COMPLETED';

export type Campaign = {
  id: string;
  noteId: string;
  impactId: string;
  organizer: string;
  treasuryAddress: string | null;
  goal: string;
  targetWei: string | null;
  raisedWei: string;
  spentWei: string;
  committedWei: string;
  remainingWei: string;
  status: CampaignStatus;
  expenseCount: number;
};

export type CampaignFundingEntry = {
  from: string;
  amountWei: string;
  txHash: string;
  createdAt: string;
  explorerUrl?: string | null;
};

export type CampaignExpenseEvidence = {
  mediaId: string;
  type: string;
  sha256: string | null;
  url: string | null;
};

export type CampaignExpense = {
  id: string;
  recipient: string;
  amountWei: string;
  purpose: string;
  evidence: CampaignExpenseEvidence[];
  txHash: string | null;
  explorerUrl?: string | null;
};

export type CampaignTransparency = {
  campaign: { id: string; goal: string; treasuryAddress: string | null };
  summary: {
    raisedWei: string;
    spentWei: string;
    committedWei: string;
    remainingWei: string;
  };
  funding: CampaignFundingEntry[];
  expenses: CampaignExpense[];
  verification: {
    level: ImpactVerificationLevel;
    evidenceCount: number;
    attestationCount: number;
  };
};

// ── Transaction ────────────────────────────────────────────

export type TrackedTxStatus = 'SUBMITTED' | 'CONFIRMED' | 'REVERTED' | 'DROPPED' | 'UNKNOWN';

export type TrackedTxKind =
  | 'ANCHOR'
  | 'IMPACT_ANCHOR'
  | 'EVIDENCE_UPDATE'
  | 'TIP'
  | 'STREAM_CREATE'
  | 'STREAM_PAUSE'
  | 'STREAM_RESUME'
  | 'STREAM_STOP'
  | 'STREAM_WITHDRAW'
  | 'ATTEST'
  | 'CAMPAIGN_CREATE'
  | 'CAMPAIGN_FUND'
  | 'CAMPAIGN_SPEND';

export type TrackedTransaction = {
  txHash: string;
  kind: TrackedTxKind;
  status: TrackedTxStatus;
  confirmations: number | null;
  blockNumber: string | null;
  explorerUrl: string | null;
  error: string | null;
};

// ── Config ─────────────────────────────────────────────────

export type AppConfig = {
  environment: 'development' | 'production';
  mockChain: boolean;
  chain: {
    name: string;
    chainId: number;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrl: string;
    explorerBaseUrl: string;
  };
  contracts: {
    noteRegistry: string | null;
    supportRouter: string | null;
    streamSupport: string | null;
    impactRegistry: string | null;
    attestationRegistry: string | null;
    campaignTreasuryFactory: string | null;
  };
  features: {
    directTip: boolean;
    streamSupport: boolean;
    impact: boolean;
    campaign: boolean;
    attestation: boolean;
  };
};

// ── 错误码（SPEC §45）───────────────────────────────────────

export const ERROR_CODES = {
  // Auth
  AUTH_NONCE_EXPIRED: 401,
  AUTH_NONCE_USED: 401,
  AUTH_SIGNATURE_INVALID: 401,
  AUTH_ADDRESS_MISMATCH: 401,
  AUTH_CHAIN_NOT_ALLOWED: 401,
  AUTH_REQUIRED: 401,
  // Profile
  PROFILE_NOT_FOUND: 404,
  HANDLE_INVALID: 422,
  HANDLE_TAKEN: 409,
  // Upload
  UPLOAD_TOO_LARGE: 422,
  UPLOAD_TYPE_NOT_ALLOWED: 422,
  UPLOAD_NOT_FOUND: 404,
  UPLOAD_NOT_COMPLETE: 422,
  UPLOAD_HASH_MISMATCH: 422,
  // Note
  NOTE_NOT_FOUND: 404,
  NOTE_NOT_OWNER: 403,
  NOTE_NOT_PUBLISHED: 422,
  NOTE_ALREADY_ANCHORED: 409,
  NOTE_HASH_MISMATCH: 422,
  NOTE_ANCHOR_TX_INVALID: 422,
  // Chain
  CHAIN_WRONG_NETWORK: 502,
  CHAIN_RPC_UNAVAILABLE: 502,
  TX_NOT_FOUND: 404,
  TX_REVERTED: 422,
  TX_EVENT_MISMATCH: 422,
  // Tip
  TIP_DISABLED: 422,
  TIP_AMOUNT_TOO_SMALL: 422,
  TIP_INVALID_AMOUNT: 400,
  // Stream
  STREAM_DISABLED: 422,
  STREAM_NOT_FOUND: 404,
  STREAM_NOT_OWNER: 403,
  STREAM_INVALID_STATE: 422,
  STREAM_INVALID_RATE: 400,
  STREAM_INVALID_BUDGET: 400,
  STREAM_BUDGET_TOO_LOW: 422,
  STREAM_ALREADY_SETTLED: 422,
  // Impact
  IMPACT_NOT_FOUND: 404,
  IMPACT_NOT_OWNER: 403,
  IMPACT_CLAIM_INVALID: 422,
  EVIDENCE_NOT_READY: 422,
  EVIDENCE_MANIFEST_VERSION_CONFLICT: 409,
  ATTESTATION_DUPLICATE: 409,
  ATTESTATION_TYPE_INVALID: 400,
  // Campaign
  CAMPAIGN_NOT_FOUND: 404,
  CAMPAIGN_CLOSED: 422,
  CAMPAIGN_NOT_ORGANIZER: 403,
  CAMPAIGN_INSUFFICIENT_BALANCE: 422,
  CAMPAIGN_INVALID_RECIPIENT: 400,
  CAMPAIGN_INVALID_EXPENSE: 422,
  // 通用
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  CHAIN_NOT_CONFIGURED: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
