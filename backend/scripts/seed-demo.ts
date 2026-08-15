/**
 * 演示钱包接入 + 种子数据：
 *   pnpm seed              # 仅注册 7 个演示身份（users + profiles，幂等）
 *   pnpm seed --content    # 额外注入 PRD §33 演示故事（需 MOCK_CHAIN 模式）
 *
 * 钱包地址来自 .env 的 DEMO_*（缺省用内置名单）；只需地址，不需要也不接受私钥。
 * 已持有对应钱包的用户后续登录时会直接命中已建好的 user/profile。
 */
process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'warn';
import { randomBytes } from 'node:crypto';
import { keccak256, stringToHex } from 'viem';
import { loadEnvFile, loadConfig } from '@proofnote/chain-config';
import { closeDb, domain, getDb, schema } from '@proofnote/db';
import { eq } from 'drizzle-orm';
import { buildApp } from '../apps/api/src/app.js';
import { createNoteWithManifest } from '../apps/api/src/modules/notes/service.js';
import { createImpactInternal } from '../apps/api/src/modules/impact/routes.js';
import { mockTreasuryAddress } from '../apps/api/src/services/mock-chain.js';
import { newUserId, newProfileId, newCampaignId, newExpenseId } from '../apps/api/src/lib/ids.js';

loadEnvFile();

const ROSTER = [
  { key: 'DEMO_ALICE', handle: 'alice', displayName: 'Alice', bio: 'Monad builder & 视频创作者', profile: true },
  { key: 'DEMO_BOB', handle: 'bob', displayName: 'Bob', bio: '常驻支持者', profile: true },
  { key: 'DEMO_CHARLIE', handle: 'charlie', displayName: 'Charlie', bio: '公益行动参与者', profile: true },
  { key: 'DEMO_ORGANIZER', handle: 'organizer', displayName: 'Impact Organizer', bio: '社区公益组织者', profile: true },
  { key: 'DEMO_SUPPLIER', handle: 'supplier', displayName: 'Supplier', bio: '物资供应商（收款方）', profile: true },
  { key: 'DEMO_DAVE', handle: 'dave', displayName: 'Dave', bio: '普通创作者', profile: true },
];

const fakeTx = (name: string) => keccak256(stringToHex(`proofnote-seed:${name}`));

// 1x1 透明 PNG（占位媒体，真实落盘 + 真实 sha256）
const PLACEHOLDER_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
);

async function main() {
  const withContent = process.argv.includes('--content');
  const config = loadConfig();
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required（先 pnpm dev:pg 或接好远端库并 pnpm db:push）');
    process.exit(1);
  }
  const db = getDb(config.env.DATABASE_URL);
  const app = await buildApp({ config, databaseUrl: config.env.DATABASE_URL, logger: false });

  const addressOf = (key: string): string => (process.env[key] ?? '').toLowerCase();

  // ── 1. 身份注册（幂等）──────────────────────────────────
  const userIdByHandle = new Map<string, { userId: string; address: string }>();
  for (const r of ROSTER) {
    const address = addressOf(r.key);
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      console.warn(`  跳过 ${r.handle}：.env 未配置 ${r.key}`);
      continue;
    }
    let user = (await db.select().from(schema.users).where(eq(schema.users.walletAddress, address)).limit(1))[0];
    if (!user) {
      const id = newUserId();
      user =
        (await db.insert(schema.users).values({ id, walletAddress: address }).onConflictDoNothing().returning())[0] ??
        (await db.select().from(schema.users).where(eq(schema.users.walletAddress, address)).limit(1))[0]!;
    }
    const profile = (await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).limit(1))[0];
    if (!profile) {
      // handle 冲突（重复灌种子）→ 沿用现有
      const existingHandle = (await db.select().from(schema.profiles).where(eq(schema.profiles.handle, r.handle)).limit(1))[0];
      if (!existingHandle) {
        await db.insert(schema.profiles).values({
          id: newProfileId(),
          userId: user.id,
          handle: r.handle,
          displayName: r.displayName,
          bio: r.bio,
        });
      }
    }
    userIdByHandle.set(r.handle, { userId: user.id, address });
    console.log(`  ✓ ${r.displayName.padEnd(18)} ${address}`);
  }

  if (!withContent) {
    console.log('\n身份注册完成（如需演示内容：pnpm seed --content）');
    await app.close();
    await closeDb();
    return;
  }

  // ── 2. 演示内容（仅 MOCK_CHAIN；幂等：已有同正文 Note 则跳过）──
  if (!config.isMock) {
    console.error('\n--content 仅支持 MOCK_CHAIN 模式（真实链模式内容由链上事件驱动）');
    process.exit(1);
  }
  const alice = userIdByHandle.get('alice')!;
  const bob = userIdByHandle.get('bob')!;
  const charlie = userIdByHandle.get('charlie')!;
  const organizer = userIdByHandle.get('organizer')!;
  const supplier = userIdByHandle.get('supplier')!;
  const dave = userIdByHandle.get('dave')!;

  const bodyExists = async (body: string) =>
    (await db.select({ id: schema.notes.id }).from(schema.notes).where(eq(schema.notes.body, body)).limit(1)).length > 0;

  const storage = app.svc.storage;
  const uploadPlaceholder = async (owner: { userId: string }, purpose: string, filename: string) => {
    const mediaId = `media_${randomBytes(8).toString('hex')}`;
    const key = `${purpose}/${mediaId}/${filename}`;
    await storage.putObject(key, 'image/png', PLACEHOLDER_PNG);
    const info = await storage.headAndHash(key);
    await db.insert(schema.media).values({
      id: mediaId,
      purpose,
      ownerUserId: owner.userId,
      filename,
      contentType: 'image/png',
      sizeBytes: info!.size,
      sha256: info!.sha256,
      status: 'READY',
      storageKey: key,
      url: storage.publicUrl(key),
      storageUri: `local://${key}`,
    });
    return mediaId;
  };

  const MON = 10n ** 18n;

  // 场景 1：Alice 的 MONETIZED Note（Creation）
  const videoBody = '我做了一条 Monad 生态入门视频：并行执行、亚秒终局性，以及为什么它适合实时创作者经济。';
  if (!(await bodyExists(videoBody))) {
    const { note } = await createNoteWithManifest(db, storage, {
      authorUserId: alice.userId, authorAddress: alice.address, type: 'MONETIZED',
      title: 'Monad 生态入门视频', body: videoBody, mediaIds: [],
      tipEnabled: true, streamEnabled: true, topic: 'monad',
    });
    await domain.publishNote(db, {
      noteKey: note.noteKey, creator: alice.address, contentHash: note.contentHash!,
      manifestUri: note.manifestUri!, txHash: fakeTx('note-video'), registeredAt: new Date(),
    });
    // Bob 直接 Tip 0.5 MON（quote 2%）
    const gross = 5n * MON / 10n;
    const fee = gross * 200n / 10_000n;
    await domain.applyTip(db, {
      noteKey: note.noteKey, supporter: bob.address, creator: alice.address,
      grossWei: gross.toString(), protocolFeeWei: fee.toString(), creatorAmountWei: (gross - fee).toString(),
      txHash: fakeTx('tip-video'), blockTime: new Date(),
    });
    console.log('  ✓ 场景1 Creation：MONETIZED Note + Bob Tip 0.5 MON');
  }

  // 场景 2：Dave 的普通 STANDARD Note（生态多样性）
  const daveBody = '第一次用 ProofNote，发一条日常：今天在杭州逛了西湖，随手拍。';
  if (!(await bodyExists(daveBody))) {
    const { note } = await createNoteWithManifest(db, storage, {
      authorUserId: dave.userId, authorAddress: dave.address, type: 'STANDARD',
      body: daveBody, mediaIds: [], tipEnabled: false, streamEnabled: false, topic: null,
    });
    await domain.publishNote(db, {
      noteKey: note.noteKey, creator: dave.address, contentHash: note.contentHash!,
      manifestUri: note.manifestUri!, txHash: fakeTx('note-dave'), registeredAt: new Date(),
    });
    console.log('  ✓ 场景2 普通创作：Dave STANDARD Note');
  }

  // 场景 3：Alice 的 IMPACT Note + 证据 + Charlie attest → L2（Impact）
  const impactTitle = '社区河岸清理';
  const impactImpact = (await db.select().from(schema.impactClaims).where(eq(schema.impactClaims.authorAddress, alice.address)).limit(1))[0];
  if (!impactImpact) {
    const evidenceMediaId = await uploadPlaceholder(alice, 'IMPACT_EVIDENCE', 'cleanup-site.png');
    const r = await createImpactInternal(app, {
      userId: alice.userId, address: alice.address,
      title: impactTitle, body: '我们 12 个人完成了社区河岸清理。',
      mediaIds: [],
      claim: {
        action: '完成社区河岸清理', when: '2026-08-12', whereText: 'Hangzhou',
        beneficiary: 'Local community', resources: '12 volunteers',
        result: '3.4 km cleaned, 186 kg waste removed',
      },
      evidenceItems: [{ mediaId: evidenceMediaId, type: 'PHOTO', title: '现场照片' }],
      fundingEnabled: false,
    });
    const manifest = (await db.select().from(schema.impactManifests).where(eq(schema.impactManifests.impactId, r.impactId)).limit(1))[0]!;
    await domain.publishImpact(db, {
      impactKey: r.impactKey, noteKey: r.note.noteKey, creator: alice.address,
      claimHash: r.claimHash, evidenceManifestHash: manifest.evidenceManifestHash,
      manifestUri: manifest.manifestUri, txHash: fakeTx('impact-anchor'), registeredAt: new Date(),
    });
    await domain.applyAttestation(db, {
      impactKey: r.impactKey, attester: charlie.address, attestationType: 'PARTICIPATED',
      statementHash: fakeTx('stmt-charlie'), txHash: fakeTx('attest-charlie'), blockTime: new Date(),
    });
    console.log('  ✓ 场景3 Impact：Claim+Evidence 锚定 + Charlie attest（→L2）');
  }

  // 场景 4：Organizer 的 CAMPAIGN + Bob 出资 + Organizer 支出（Transparency）
  const campaignGoal = '500kg food for one week';
  const existingCampaign = (await db.select().from(schema.campaignMetadata).where(eq(schema.campaignMetadata.organizerAddress, organizer.address)).limit(1))[0];
  if (!existingCampaign) {
    const invoiceMediaId = await uploadPlaceholder(organizer, 'IMPACT_EVIDENCE', 'supplier-invoice.png');
    const r = await createImpactInternal(app, {
      userId: organizer.userId, address: organizer.address,
      title: '为动物救助站购买食物', body: '目标一周 500kg 猫粮，支出全部上链可查。',
      mediaIds: [],
      claim: { action: campaignGoal, summary: campaignGoal },
      evidenceItems: [{ mediaId: invoiceMediaId, type: 'INVOICE', title: '首笔采购发票' }],
      fundingEnabled: true,
    });
    const campaignId = newCampaignId();
    const campaignKey = keccak256(stringToHex(`proofnote-seed:campaign:${organizer.address}`));
    await db.insert(schema.campaignMetadata).values({
      id: campaignId, campaignKey: campaignKey as string, impactId: r.impactId, noteId: r.note.id,
      organizerAddress: organizer.address, goal: campaignGoal, targetWei: (100n * MON).toString(),
    });
    await domain.publishImpact(db, {
      impactKey: r.impactKey, noteKey: r.note.noteKey, creator: organizer.address,
      claimHash: r.claimHash,
      evidenceManifestHash: (await db.select().from(schema.impactManifests).where(eq(schema.impactManifests.impactId, r.impactId)).limit(1))[0]!.evidenceManifestHash,
      manifestUri: (await db.select().from(schema.impactManifests).where(eq(schema.impactManifests.impactId, r.impactId)).limit(1))[0]!.manifestUri,
      txHash: fakeTx('impact-campaign'), registeredAt: new Date(),
    });
    await domain.applyCampaignCreate(db, {
      campaignKey: campaignKey as string, impactKey: r.impactKey, organizer: organizer.address,
      treasuryAddress: mockTreasuryAddress(campaignKey as string),
      txHash: fakeTx('campaign-create'), blockTime: new Date(),
    });
    await domain.applyCampaignFunded(db, {
      campaignKey: campaignKey as string, supporter: bob.address, amountWei: (5n * MON).toString(),
      txHash: fakeTx('campaign-fund'), blockTime: new Date(),
    });
    const { buildExpenseHashes } = await import('@proofnote/hash-utils');
    const { purposeHash, evidenceHash } = buildExpenseHashes({
      purpose: 'Purchase 200kg animal food',
      evidenceSha256List: [(await db.select().from(schema.media).where(eq(schema.media.id, invoiceMediaId)).limit(1))[0]!.sha256!],
    });
    const expenseId = newExpenseId();
    await db.insert(schema.expenseMetadata).values({
      id: expenseId, campaignId, recipient: supplier.address, amountWei: (2n * MON).toString(),
      purpose: 'Purchase 200kg animal food', purposeHash, evidenceHash,
      evidenceMediaIds: [invoiceMediaId], status: 'PENDING',
    });
    await domain.applyCampaignSpent(db, {
      campaignKey: campaignKey as string, recipient: supplier.address, amountWei: (2n * MON).toString(),
      purposeHash, evidenceHash, txHash: fakeTx('campaign-spend'), blockTime: new Date(),
    });
    console.log('  ✓ 场景4 Campaign：募资5 MON / 支出2 MON（含发票证据，透明页可查）');
  }

  // ── 3. Feed 预览 ────────────────────────────────────────
  const feed = await app.inject({ method: 'GET', url: '/api/v1/feed?limit=10' });
  const items = (feed.json() as { data: { items: Array<{ title: string | null; badges: string[] }> } }).data.items;
  console.log(`\n种子完成。当前 Feed ${items.length} 条：`);
  for (const it of items) console.log(`  · [${it.badges.join(',') || 'STANDARD'}] ${it.title ?? '(无标题)'}`);

  await app.close();
  await closeDb();
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
