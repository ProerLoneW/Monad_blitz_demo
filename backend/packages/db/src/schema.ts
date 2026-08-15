import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  bigserial,
  date,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

/**
 * 后端开发文档 §6 全部表。
 * 写入分工：业务表主要由 apps/api 写；读模型表与 chain_events 由 apps/indexer 写。
 * 金额一律 TEXT（wei 字符串），应用层用 bigint 解析——禁止 number。
 * 地址一律 lowercase 存储。
 */

// ── 业务表 ──────────────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(), // usr_<ulid>
  walletAddress: text('wallet_address').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authNonces = pgTable('auth_nonces', {
  nonce: text('nonce').primaryKey(),
  address: text('address').notNull(),
  chainId: integer('chain_id').notNull(),
  message: text('message').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

export const profiles = pgTable('profiles', {
  id: text('id').primaryKey(), // profile_<ulid>
  userId: text('user_id').notNull().unique().references(() => users.id),
  handle: text('handle').notNull().unique(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  avatarMediaId: text('avatar_media_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const media = pgTable('media', {
  id: text('id').primaryKey(), // media_<ulid>
  purpose: text('purpose').notNull(), // NOTE_MEDIA | PROFILE_AVATAR | IMPACT_EVIDENCE
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256'),
  status: text('status').notNull().default('PENDING'), // PENDING | READY | FAILED
  storageKey: text('storage_key'),
  storageUri: text('storage_uri'),
  url: text('url'),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notes = pgTable(
  'notes',
  {
    id: text('id').primaryKey(), // note_<ulid>
    noteKey: text('note_key').notNull().unique(), // 0x bytes32 服务端生成
    authorUserId: text('author_user_id').notNull().references(() => users.id),
    authorAddress: text('author_address').notNull(), // 冗余，indexer 匹配用
    type: text('type').notNull(), // STANDARD | MONETIZED | IMPACT | CAMPAIGN
    status: text('status').notNull().default('DRAFT'), // DRAFT | PENDING_ANCHOR | PUBLISHED | HIDDEN
    title: text('title'),
    body: text('body').notNull(),
    contentHash: text('content_hash'),
    manifestUri: text('manifest_uri'),
    tipEnabled: boolean('tip_enabled').notNull().default(false),
    streamEnabled: boolean('stream_enabled').notNull().default(false),
    topic: text('topic'),
    pinned: boolean('pinned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    index('notes_status_published_idx').on(t.status, t.publishedAt),
    index('notes_author_idx').on(t.authorUserId),
    index('notes_type_idx').on(t.type),
  ],
);

export const noteMedia = pgTable(
  'note_media',
  {
    noteId: text('note_id').notNull().references(() => notes.id),
    mediaId: text('media_id').notNull().references(() => media.id),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.mediaId] })],
);

export const noteManifests = pgTable(
  'note_manifests',
  {
    id: text('id').primaryKey(),
    noteId: text('note_id').notNull().references(() => notes.id),
    version: integer('version').notNull().default(1),
    contentHash: text('content_hash').notNull(),
    manifestUri: text('manifest_uri').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('note_manifests_version_uq').on(t.noteId, t.version)],
);

export const impactClaims = pgTable(
  'impact_claims',
  {
    id: text('id').primaryKey(), // impact_<ulid>
    impactKey: text('impact_key').notNull().unique(), // 0x bytes32
    noteId: text('note_id').notNull().references(() => notes.id),
    authorAddress: text('author_address').notNull(),
    claimJson: jsonb('claim_json').notNull(),
    claimHash: text('claim_hash').notNull(),
    verificationLevel: text('verification_level').notNull().default('L0'),
    fundingEnabled: boolean('funding_enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('impact_claims_note_idx').on(t.noteId)],
);

export const impactEvidence = pgTable(
  'impact_evidence',
  {
    id: text('id').primaryKey(), // evidence_<ulid>
    impactId: text('impact_id').notNull().references(() => impactClaims.id),
    mediaId: text('media_id').notNull().references(() => media.id),
    type: text('type').notNull(), // PHOTO | VIDEO | RECEIPT | INVOICE | DOCUMENT
    title: text('title'),
    description: text('description'),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('impact_evidence_impact_idx').on(t.impactId)],
);

export const impactManifests = pgTable(
  'impact_manifests',
  {
    impactId: text('impact_id').notNull().references(() => impactClaims.id),
    version: integer('version').notNull(),
    evidenceManifestHash: text('evidence_manifest_hash').notNull(),
    manifestUri: text('manifest_uri').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.impactId, t.version] })],
);

export const campaignMetadata = pgTable('campaign_metadata', {
  id: text('id').primaryKey(), // campaign_<ulid>
  campaignKey: text('campaign_key').notNull().unique(), // 0x bytes32
  impactId: text('impact_id').notNull().references(() => impactClaims.id),
  noteId: text('note_id').notNull().references(() => notes.id),
  organizerAddress: text('organizer_address').notNull(),
  goal: text('goal').notNull(),
  targetWei: text('target_wei'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const expenseMetadata = pgTable(
  'expense_metadata',
  {
    id: text('id').primaryKey(), // expense_<ulid>
    campaignId: text('campaign_id').notNull().references(() => campaignMetadata.id),
    recipient: text('recipient').notNull(),
    amountWei: text('amount_wei').notNull(),
    purpose: text('purpose').notNull(),
    purposeHash: text('purpose_hash').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    evidenceMediaIds: jsonb('evidence_media_ids').notNull(), // string[]
    status: text('status').notNull().default('PENDING'), // PENDING | CONFIRMED
    txHash: text('tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('expense_campaign_idx').on(t.campaignId)],
);

export const trackedTransactions = pgTable(
  'tracked_transactions',
  {
    id: text('id').primaryKey(), // tx_<ulid>
    txHash: text('tx_hash').notNull(),
    kind: text('kind').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    userId: text('user_id').references(() => users.id),
    status: text('status').notNull().default('SUBMITTED'), // SUBMITTED | CONFIRMED | REVERTED | DROPPED
    blockNumber: text('block_number'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tracked_tx_uq').on(t.txHash, t.kind), index('tracked_tx_status_idx').on(t.status)],
);

// ── 读模型表（indexer 写；mock-chain 模式下由 api 的模拟器写）──────────

export const chainEvents = pgTable(
  'chain_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    chainId: integer('chain_id').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: text('block_number').notNull(),
    eventName: text('event_name').notNull(),
    argsJson: jsonb('args_json').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('chain_events_uq').on(t.chainId, t.txHash, t.logIndex)],
);

export const notesOnchain = pgTable('notes_onchain', {
  noteKey: text('note_key').primaryKey(),
  creator: text('creator').notNull(),
  contentHash: text('content_hash').notNull(),
  manifestUri: text('manifest_uri').notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
  txHash: text('tx_hash').notNull(),
});

export const tips = pgTable(
  'tips',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    noteKey: text('note_key').notNull(),
    supporter: text('supporter').notNull(),
    creator: text('creator').notNull(),
    grossWei: text('gross_wei').notNull(),
    protocolFeeWei: text('protocol_fee_wei').notNull(),
    creatorAmountWei: text('creator_amount_wei').notNull(),
    txHash: text('tx_hash').notNull().unique(),
    blockTime: timestamp('block_time', { withTimezone: true }).notNull(),
  },
  (t) => [index('tips_note_idx').on(t.noteKey), index('tips_creator_idx').on(t.creator)],
);

export const streams = pgTable(
  'streams',
  {
    streamId: text('stream_id').primaryKey(), // 链上 uint → string
    noteKey: text('note_key').notNull(),
    fan: text('fan').notNull(),
    creator: text('creator').notNull(),
    rateWeiPerSecond: text('rate_wei_per_second').notNull(),
    budgetWei: text('budget_wei').notNull(),
    accruedStoredWei: text('accrued_stored_wei').notNull().default('0'),
    activeSince: timestamp('active_since', { withTimezone: true }),
    status: text('status').notNull(), // ACTIVE | PAUSED | SETTLED
    settledAccruedWei: text('settled_accrued_wei'),
    settledCreatorCreditWei: text('settled_creator_credit_wei'),
    settledFanRefundWei: text('settled_fan_refund_wei'),
    settledProtocolFeeWei: text('settled_protocol_fee_wei'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    index('streams_note_idx').on(t.noteKey),
    index('streams_creator_status_idx').on(t.creator, t.status),
    index('streams_fan_idx').on(t.fan),
  ],
);

export const streamCredits = pgTable('stream_credits', {
  account: text('account').primaryKey(),
  creditWei: text('credit_wei').notNull().default('0'),
});

export const impactsOnchain = pgTable('impacts_onchain', {
  impactKey: text('impact_key').primaryKey(),
  noteKey: text('note_key').notNull(),
  creator: text('creator').notNull(),
  claimHash: text('claim_hash').notNull(),
  currentManifestHash: text('current_manifest_hash').notNull(),
  currentVersion: integer('current_version').notNull().default(1),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
  txHash: text('tx_hash').notNull(),
});

export const attestations = pgTable(
  'attestations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    impactKey: text('impact_key').notNull(),
    attester: text('attester').notNull(),
    attestationType: text('attestation_type').notNull(), // PARTICIPATED | WITNESSED
    statementHash: text('statement_hash').notNull(),
    txHash: text('tx_hash').notNull(),
    blockTime: timestamp('block_time', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('attestations_uq').on(t.impactKey, t.attester, t.attestationType),
    index('attestations_impact_idx').on(t.impactKey),
  ],
);

export const campaigns = pgTable('campaigns', {
  campaignKey: text('campaign_key').primaryKey(),
  impactKey: text('impact_key').notNull(),
  organizer: text('organizer').notNull(),
  treasuryAddress: text('treasury_address').unique(),
  raisedWei: text('raised_wei').notNull().default('0'),
  spentWei: text('spent_wei').notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const campaignFunding = pgTable(
  'campaign_funding',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    campaignKey: text('campaign_key').notNull(),
    supporter: text('supporter').notNull(),
    amountWei: text('amount_wei').notNull(),
    txHash: text('tx_hash').notNull().unique(),
    blockTime: timestamp('block_time', { withTimezone: true }).notNull(),
  },
  (t) => [index('campaign_funding_campaign_idx').on(t.campaignKey)],
);

export const campaignExpenses = pgTable(
  'campaign_expenses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    campaignKey: text('campaign_key').notNull(),
    recipient: text('recipient').notNull(),
    amountWei: text('amount_wei').notNull(),
    purposeHash: text('purpose_hash').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    txHash: text('tx_hash').notNull().unique(),
    blockTime: timestamp('block_time', { withTimezone: true }).notNull(),
  },
  (t) => [index('campaign_expenses_campaign_idx').on(t.campaignKey)],
);

export const creatorValueStats = pgTable(
  'creator_value_stats',
  {
    creator: text('creator').notNull(),
    day: date('day').notNull(),
    tipIncomeWei: text('tip_income_wei').notNull().default('0'),
    streamIncomeWei: text('stream_income_wei').notNull().default('0'),
  },
  (t) => [primaryKey({ columns: [t.creator, t.day] })],
);

export const impactStats = pgTable('impact_stats', {
  impactKey: text('impact_key').primaryKey(),
  evidenceCount: integer('evidence_count').notNull().default(0),
  attestationCount: integer('attestation_count').notNull().default(0),
  independentAttestationCount: integer('independent_attestation_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── 辅助表 ──────────────────────────────────────────────────

/** Indexer 断点：per chain 记录最后已处理区块 */
export const indexerCheckpoint = pgTable('indexer_checkpoint', {
  chainId: integer('chain_id').primaryKey(),
  lastBlock: text('last_block').notNull().default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 幂等键（SPEC §4.11：create note / create impact / upload complete / transaction track） */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    route: text('route').notNull(),
    idemKey: text('idem_key').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code'),
    responseJson: text('response_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('idempotency_uq').on(t.userId, t.route, t.idemKey)],
);

/** Mock chain 模式：prepare 阶段落意图，track 阶段消费并模拟链上效果 */
export const prepareIntents = pgTable(
  'prepare_intents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    entityId: text('entity_id'),
    paramsJson: jsonb('params_json').notNull(),
    consumed: boolean('consumed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('prepare_intents_user_kind_idx').on(t.userId, t.kind, t.consumed)],
);
