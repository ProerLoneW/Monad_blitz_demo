/**
 * ProofNote 端到端冒烟（后端开发文档 §9.3 / SPEC §65 闭环）。
 *
 * 前置：Postgres 可用且已 `pnpm db:push`。进程内 fastify inject，不发真实网络请求。
 * 运行：pnpm smoke
 *
 * 覆盖：登录 → Profile → 上传 → 发 Note → 锚定 → Feed → Tip → Stream(P/R/S+提现)
 *      → Impact Note → Evidence → 第三方 Attest（L1→L2）→ Campaign（创建/出资/支出）
 *      → Transparency → Profile 双维度统计。
 */
process.env.NODE_ENV ??= 'test';
process.env.STORAGE_DRIVER ??= 'local';
process.env.LOCAL_STORAGE_DIR ??= './data/smoke-storage';
process.env.API_BASE_URL ??= 'http://localhost';
process.env.JWT_SECRET ??= 'smoke-test-secret-0123456789ab';
process.env.LOG_LEVEL ??= 'warn';
process.env.MOCK_CHAIN ??= 'true'; // 冒烟跑 mock 链路；真实链路由 indexer + 测试网覆盖

import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';
import { loadEnvFile, loadConfig } from '@proofnote/chain-config';
import { closeDb } from '@proofnote/db';
import { buildApp } from '../apps/api/src/app.js';

loadEnvFile();
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required (Postgres must be running, schema pushed via `pnpm db:push`)');
  process.exit(1);
}

type Json = Record<string, any>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

let passedSteps = 0;
function ok(name: string) {
  passedSteps++;
  console.log(`  ✓ ${name}`);
}

function fakeTxHash(): string {
  return '0x' + randomBytes(32).toString('hex');
}

async function main() {
  const config = loadConfig();
  assert.equal(config.isMock, true, 'smoke runs in MOCK_CHAIN mode');
  const loggerOpt = process.env.SMOKE_DEBUG === '1' ? ({ level: 'error' } as const) : false;
  const app = await buildApp({
    config,
    databaseUrl: config.env.DATABASE_URL,
    logger: loggerOpt,
  });

  const inject = async (
    method: Method,
    url: string,
    opts: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: Buffer } = {},
  ) => {
    const authHeaders: Record<string, string> = opts.token ? { authorization: `Bearer ${opts.token}` } : {};
    const res =
      opts.raw !== undefined
        ? await app.inject({ method, url, payload: opts.raw, headers: { ...(opts.headers ?? {}), ...authHeaders } })
        : opts.body !== undefined
          ? await app.inject({
              method,
              url,
              payload: JSON.stringify(opts.body),
              headers: { 'content-type': 'application/json', ...authHeaders },
            })
          : await app.inject({ method, url, headers: authHeaders });
    let json: Json = {};
    try {
      json = res.json() as Json;
    } catch {
      json = {};
    }
    return { status: res.statusCode, json, raw: res.rawPayload };
  };
  const should = (name: string, cond: unknown, detail?: unknown) => {
    if (!cond) {
      console.error(`  ✗ FAIL: ${name}`, detail ?? '');
      process.exit(1);
    }
    ok(name);
  };

  // ── 0. 基础 ──────────────────────────────────────────────
  const health = await inject('GET', '/healthz');
  should('healthz', health.status === 200 && health.json.ok === true);

  const cfg = await inject('GET', '/api/v1/config');
  should('config 下发（mock 链 + chainId 10143 + features 全开）',
    cfg.status === 200 &&
    cfg.json.data.mockChain === true &&
    cfg.json.data.chain.chainId === 10143 &&
    cfg.json.data.features.directTip === true,
    cfg.json);

  // ── 钱包工厂 ─────────────────────────────────────────────
  const wallet = () => privateKeyToAccount(generatePrivateKey());
  const alice = wallet();
  const bob = wallet();
  const charlie = wallet();
  const supplier = wallet().address;

  // run 后缀：冒烟可重复执行（数据库持久化，handle 全局唯一）
  const suffix = randomBytes(3).toString('hex');
  const hAlice = `alice_${suffix}`;
  const hBob = `bob_${suffix}`;
  const hCharlie = `charlie_${suffix}`;

  const login = async (acct: typeof alice, handle?: string): Promise<string> => {
    const n = await inject('POST', '/api/v1/auth/nonce', { body: { address: acct.address } });
    if (n.status !== 200) throw new Error(`nonce failed: ${JSON.stringify(n.json)}`);
    const signature = await acct.signMessage({ message: n.json.data.message as string });
    const v = await inject('POST', '/api/v1/auth/verify', {
      body: { address: acct.address, message: n.json.data.message, signature },
    });
    if (v.status !== 200) throw new Error(`verify failed: ${JSON.stringify(v.json)}`);
    if (handle) {
      const p = await inject('PATCH', '/api/v1/profiles/me', {
        token: v.json.data.accessToken,
        body: { handle, displayName: handle.toUpperCase() },
      });
      if (p.status !== 201) throw new Error(`profile failed: ${JSON.stringify(p.json)}`);
    }
    return v.json.data.accessToken as string;
  };

  // ── 1. Auth + Profile ────────────────────────────────────
  const aliceToken = await login(alice, hAlice);
  const bobToken = await login(bob, hBob);
  const charlieToken = await login(charlie, hCharlie);
  ok('三个钱包登录 + Profile 创建（alice/bob/charlie）');

  const replay = await inject('POST', '/api/v1/auth/verify', {
    body: { address: alice.address, message: 'x' },
  });
  should('缺 signature 参数被拒（400 VALIDATION_ERROR）', replay.status === 400 && replay.json.error.code === 'VALIDATION_ERROR', replay.json);

  const badSig = await inject('POST', '/api/v1/auth/nonce', { body: { address: alice.address } });
  const forged = await inject('POST', '/api/v1/auth/verify', {
    body: { address: alice.address, message: badSig.json.data.message, signature: '0x' + 'ab'.repeat(65) },
  });
  should('伪造签名被拒（401 AUTH_SIGNATURE_INVALID）', forged.status === 401 && forged.json.error.code === 'AUTH_SIGNATURE_INVALID', forged.json);

  const me = await inject('GET', '/api/v1/auth/me', { token: aliceToken });
  should('auth/me 返回 profile', me.status === 200 && me.json.data?.profile?.handle === hAlice, me.json);

  const badHandle = await inject('PATCH', '/api/v1/profiles/me', {
    token: aliceToken,
    body: { handle: 'X' },
  });
  should('非法 handle 被拒（VALIDATION_ERROR）', badHandle.status === 400 && badHandle.json.error.code === 'VALIDATION_ERROR');

  // ── 2. Upload（local 驱动 presign → 直传 → complete）──────
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
    'hex',
  );
  const presign = await inject('POST', '/api/v1/uploads/presign', {
    token: aliceToken,
    body: { purpose: 'NOTE_MEDIA', filename: 'cover.png', contentType: 'image/png', sizeBytes: png.length },
  });
  should('presign 返回直传 URL', presign.status === 201 && presign.json.data.uploadUrl.includes('/api/v1/uploads/direct/'));

  const uploadUrl = new URL(presign.json.data.uploadUrl as string).pathname;
  const put = await inject('PUT', uploadUrl, { raw: png, headers: { 'content-type': 'image/png' } });
  should('直传成功', put.status === 200, put.json);

  const complete = await inject('POST', `/api/v1/uploads/${presign.json.data.mediaId}/complete`, {
    token: aliceToken,
    body: {},
  });
  const mediaId = complete.json.data?.id as string | undefined;
  should('complete 校验对象（READY + sha256）', complete.status === 200 && complete.json.data.status === 'READY' && typeof complete.json.data.sha256 === 'string', complete.json);

  const fileGet = await inject('GET', new URL(complete.json.data.url as string).pathname);
  should('文件可公开读取', fileGet.status === 200 && fileGet.raw.length === png.length);

  // ── 3. Note 发布（MVP 闭环第一步）────────────────────────
  const noteRes = await inject('POST', '/api/v1/notes', {
    token: aliceToken,
    body: {
      type: 'MONETIZED',
      title: 'Monad 入门视频',
      body: '今天来介绍一下 Monad 的并行执行。',
      mediaIds: [mediaId],
      monetization: { tipEnabled: true, streamEnabled: true },
    },
  });
  const note = noteRes.json.data.note;
  should('创建 Note 返回 noteKey + contentHash + anchorTx',
    noteRes.status === 201 && /^0x[0-9a-f]{64}$/.test(note.noteKey) && note.status === 'PENDING_ANCHOR',
    noteRes.json);

  const tooEarly = await inject('GET', `/api/v1/notes/${note.id}`);
  should('PENDING_ANCHOR 的 Note 不进公开详情（404）', tooEarly.status === 404 || tooEarly.json.data?.status === 'PENDING_ANCHOR');

  const anchorHash = fakeTxHash();
  const trackAnchor = await inject('POST', '/api/v1/transactions/track', {
    token: aliceToken,
    body: { txHash: anchorHash, kind: 'ANCHOR', entityType: 'NOTE', entityId: note.id },
  });
  const confirm = await inject('POST', `/api/v1/notes/${note.id}/confirm-anchor`, {
    token: aliceToken,
    body: { txHash: anchorHash },
  });
  should('confirm-anchor（mock）→ PUBLISHED',
    confirm.status === 200 && confirm.json.data.status === 'CONFIRMED' && confirm.json.data.noteStatus === 'PUBLISHED',
    confirm.json);

  const noteDetail = await inject('GET', `/api/v1/notes/${note.id}`);
  should('Note 详情：ownership.anchored + value panel',
    noteDetail.status === 200 &&
    noteDetail.json.data.ownership.anchored === true &&
    noteDetail.json.data.value.tipEnabled === true &&
    noteDetail.json.data.media.length === 1,
    noteDetail.json.data?.ownership);

  const feed = await inject('GET', '/api/v1/feed?limit=10');
  should('Feed 包含已发布 Note（MONETIZED badge）',
    feed.status === 200 && feed.json.data.items.some((i: Json) => i.id === note.id && i.badges.includes('MONETIZED')));

  // ── 4. Direct Tip ────────────────────────────────────────
  const tipAmount = '10000000000000000'; // 0.01 MON
  const tipPrep = await inject('POST', `/api/v1/notes/${note.id}/tips/prepare`, {
    token: bobToken,
    body: { amountWei: tipAmount },
  });
  const quote = tipPrep.json.data.quote;
  should('tip quote 守恒：gross = creator + fee',
    tipPrep.status === 200 && BigInt(quote.gross) === BigInt(quote.creatorReceives) + BigInt(quote.protocolFee),
    quote);

  const tipHash = fakeTxHash();
  await inject('POST', '/api/v1/transactions/track', {
    token: bobToken,
    body: { txHash: tipHash, kind: 'TIP', entityType: 'NOTE', entityId: note.id },
  });
  const valuePanel = await inject('GET', `/api/v1/notes/${note.id}/value`);
  should('Value Panel 更新（totalSupport = creator 实收）',
    valuePanel.status === 200 && valuePanel.json.data.totalSupport.amountWei === quote.creatorReceives,
    valuePanel.json.data?.totalSupport);

  // ── 5. Stream Support（Start/Pause/Resume/Stop/Withdraw）──
  const rate = '1000000000000000'; // 0.001 MON/s
  const budget = '20000000000000000'; // 0.02 MON
  const streamPrep = await inject('POST', `/api/v1/notes/${note.id}/streams/prepare`, {
    token: bobToken,
    body: { rateWeiPerSecond: rate, budgetWei: budget },
  });
  should('stream prepare 校验（maxDuration=20s）',
    streamPrep.status === 200 && streamPrep.json.data.preview.maxDurationSeconds === 20,
    streamPrep.json);

  const lowBudget = await inject('POST', `/api/v1/notes/${note.id}/streams/prepare`, {
    token: bobToken,
    body: { rateWeiPerSecond: rate, budgetWei: rate }, // 1 秒即耗尽
  });
  should('budget 不足最小时长被拒（STREAM_BUDGET_TOO_LOW）',
    lowBudget.status === 422 && lowBudget.json.error.code === 'STREAM_BUDGET_TOO_LOW');

  const streamCreateHash = fakeTxHash();
  const streamTrack = await inject('POST', '/api/v1/transactions/track', {
    token: bobToken,
    body: { txHash: streamCreateHash, kind: 'STREAM_CREATE', entityType: 'NOTE', entityId: note.id },
  });
  // 从 Creator Dashboard 动态发现本轮创建的 streamId（数据库持久化，跨 run 不冲突）
  const incoming0 = await inject('GET', `/api/v1/profiles/${alice.address}/streams/incoming`);
  const sid = incoming0.json.data.streams.find((s: Json) => s.supporter.toLowerCase() === bob.address.toLowerCase())?.streamId;
  const streamGet = await inject('GET', `/api/v1/streams/${sid}`);
  should('stream 创建（读模型 ACTIVE）',
    streamTrack.status === 201 && streamGet.status === 200 && streamGet.json.data.status === 'ACTIVE',
    streamGet.json);

  await new Promise((r) => setTimeout(r, 1100)); // 计提 ~1s
  const streamAfter1s = await inject('GET', `/api/v1/streams/${sid}`);
  const accrued1s = BigInt(streamAfter1s.json.data.accruedWei);
  should('accrued 随时间推导增长（≥1s × rate）', accrued1s >= BigInt(rate), streamAfter1s.json.data);

  const pausePrep = await inject('POST', `/api/v1/streams/${sid}/pause/prepare`, { token: bobToken, body: {} });
  should('pause prepare', pausePrep.status === 200);
  await inject('POST', '/api/v1/transactions/track', {
    token: bobToken,
    body: { txHash: fakeTxHash(), kind: 'STREAM_PAUSE', entityType: 'STREAM', entityId: sid },
  });
  const paused = await inject('GET', `/api/v1/streams/${sid}`);
  should('pause 后状态 PAUSED 且计提冻结', paused.json.data.status === 'PAUSED', paused.json.data);

  await inject('POST', `/api/v1/streams/${sid}/resume/prepare`, { token: bobToken, body: {} });
  await inject('POST', '/api/v1/transactions/track', {
    token: bobToken,
    body: { txHash: fakeTxHash(), kind: 'STREAM_RESUME', entityType: 'STREAM', entityId: sid },
  });
  const resumed = await inject('GET', `/api/v1/streams/${sid}`);
  should('resume 后状态 ACTIVE', resumed.json.data.status === 'ACTIVE', resumed.json.data);

  const incoming = await inject('GET', `/api/v1/profiles/${alice.address}/streams/incoming`);
  should('Creator Dashboard：incoming rate 聚合',
    incoming.status === 200 && incoming.json.data.activeStreamCount === 1 && incoming.json.data.aggregateIncomingRateWeiPerSecond === rate,
    incoming.json.data);

  const stopPrep = await inject('POST', `/api/v1/streams/${sid}/stop/prepare`, { token: bobToken, body: {} });
  should('stop prepare', stopPrep.status === 200);
  const stopHash = fakeTxHash();
  await inject('POST', '/api/v1/transactions/track', {
    token: bobToken,
    body: { txHash: stopHash, kind: 'STREAM_STOP', entityType: 'STREAM', entityId: sid },
  });
  const settled = await inject('GET', `/api/v1/streams/${sid}`);
  should('stop & settle（SETTLED）', settled.json.data.status === 'SETTLED', settled.json.data);

  const claimableBefore = await inject('GET', `/api/v1/profiles/${alice.address}/claimable`);
  const claimableWei = BigInt(claimableBefore.json.data.streamSupport.amountWei);
  should('creator claimable > 0', claimableWei > 0n, claimableBefore.json.data);

  await inject('POST', '/api/v1/streams/withdraw/prepare', { token: aliceToken, body: {} });
  await inject('POST', '/api/v1/transactions/track', {
    token: aliceToken,
    body: { txHash: fakeTxHash(), kind: 'STREAM_WITHDRAW' },
  });
  const claimableAfter = await inject('GET', `/api/v1/profiles/${alice.address}/claimable`);
  should('withdraw 后 claimable 归零（mock 读模型口径）',
    BigInt(claimableAfter.json.data.streamSupport.amountWei) === 0n,
    claimableAfter.json.data);

  // ── 6. Impact Note + Evidence + Attestation ──────────────
  const evPresign = await inject('POST', '/api/v1/uploads/presign', {
    token: aliceToken,
    body: { purpose: 'IMPACT_EVIDENCE', filename: 'cleanup.png', contentType: 'image/png', sizeBytes: png.length },
  });
  await inject('PUT', new URL(evPresign.json.data.uploadUrl as string).pathname, {
    raw: png,
    headers: { 'content-type': 'image/png' },
  });
  const evComplete = await inject('POST', `/api/v1/uploads/${evPresign.json.data.mediaId}/complete`, {
    token: aliceToken,
    body: {},
  });
  const evidenceMediaId = evComplete.json.data.id as string;

  const impactRes = await inject('POST', '/api/v1/impact-notes', {
    token: aliceToken,
    body: {
      title: '社区河岸清理',
      body: '我们今天完成了 3.4km 河岸清理。',
      claim: {
        action: '完成社区河岸清理',
        when: '2026-08-12',
        whereText: 'Hangzhou',
        beneficiary: 'Local community',
        resources: '12 volunteers',
        result: '3.4 km cleaned, 186 kg waste removed',
      },
      evidenceItems: [{ mediaId: evidenceMediaId, type: 'PHOTO', title: '现场照片' }],
      fundingEnabled: false,
    },
  });
  const impactData = impactRes.json.data ?? {};
  const impact = impactData.impact;
  should('创建 Impact Note（claimHash + evidence manifest + anchorTx）',
    impactRes.status === 201 && impact && /^0x[0-9a-f]{64}$/.test(impact.claimHash),
    impactRes.json);

  const impactAnchorHash = fakeTxHash();
  await inject('POST', '/api/v1/transactions/track', {
    token: aliceToken,
    body: { txHash: impactAnchorHash, kind: 'IMPACT_ANCHOR', entityType: 'IMPACT', entityId: impact.id },
  });
  const impactGet = await inject('GET', `/api/v1/impact/${impact.id}`);
  should('Impact 锚定后 level L1（有 evidence）',
    impactGet.status === 200 && impactGet.json.data.verification.level === 'L1' && impactGet.json.data.evidence.length === 1,
    impactGet.json.data?.verification);

  const attestPrep = await inject('POST', `/api/v1/impact/${impact.id}/attestations/prepare`, {
    token: charlieToken,
    body: { type: 'PARTICIPATED', statement: 'I participated in this action.' },
  });
  should('attestation prepare（selfRelated=false + statementHash）',
    attestPrep.status === 200 && attestPrep.json.data.selfRelated === false,
    attestPrep.json);
  await inject('POST', '/api/v1/transactions/track', {
    token: charlieToken,
    body: { txHash: fakeTxHash(), kind: 'ATTEST', entityType: 'IMPACT', entityId: impact.id },
  });
  const impactAfterAttest = await inject('GET', `/api/v1/impact/${impact.id}`);
  should('第三方 attest 后 L1 → L2（SPEC §58）',
    impactAfterAttest.json.data.verification.level === 'L2' &&
    impactAfterAttest.json.data.verification.attestationCount === 1,
    impactAfterAttest.json.data?.verification);

  const dupAttest = await inject('POST', `/api/v1/impact/${impact.id}/attestations/prepare`, {
    token: charlieToken,
    body: { type: 'PARTICIPATED', statement: 'again' },
  });
  should('重复 attest 被拒（ATTESTATION_DUPLICATE）',
    dupAttest.status === 409 && dupAttest.json.error.code === 'ATTESTATION_DUPLICATE');

  const attestList = await inject('GET', `/api/v1/impact/${impact.id}/attestations`);
  should('attestation 列表（attester=charlie）',
    attestList.status === 200 && attestList.json.data.items.length === 1);

  // evidence 追加（v2）
  const ev2Presign = await inject('POST', '/api/v1/uploads/presign', {
    token: aliceToken,
    body: { purpose: 'IMPACT_EVIDENCE', filename: 'invoice.png', contentType: 'image/png', sizeBytes: png.length },
  });
  await inject('PUT', new URL(ev2Presign.json.data.uploadUrl as string).pathname, {
    raw: png,
    headers: { 'content-type': 'image/png' },
  });
  const ev2Complete = await inject('POST', `/api/v1/uploads/${ev2Presign.json.data.mediaId}/complete`, {
    token: aliceToken,
    body: {},
  });
  const evidenceAppend = await inject('POST', `/api/v1/impact/${impact.id}/evidence`, {
    token: aliceToken,
    body: { items: [{ mediaId: ev2Complete.json.data.id, type: 'RECEIPT', title: '物资发票' }] },
  });
  should('evidence 追加 → manifest v2（不覆盖 v1）',
    evidenceAppend.status === 201 && evidenceAppend.json.data.manifestVersion === 2,
    evidenceAppend.json);

  // ── 7. Campaign（创建 → 出资 → 支出 → 透明页）────────────
  const campaignRes = await inject('POST', '/api/v1/campaigns', {
    token: aliceToken,
    body: {
      title: '为动物救助站购买食物',
      body: '目标一周 500kg 猫粮。',
      goal: '500kg food for one week',
      targetWei: '100000000000000000000',
    },
  });
  const campaign = campaignRes.json.data.campaign;
  should('创建 Campaign（campaignKey + treasuryTx）',
    campaignRes.status === 201 && /^0x[0-9a-f]{64}$/.test(campaign.campaignKey),
    campaignRes.json);

  const impactOfCampaign = campaignRes.json.data.impact.id as string;
  await inject('POST', '/api/v1/transactions/track', {
    token: aliceToken,
    body: { txHash: fakeTxHash(), kind: 'IMPACT_ANCHOR', entityType: 'IMPACT', entityId: impactOfCampaign },
  });
  await inject('POST', '/api/v1/transactions/track', {
    token: aliceToken,
    body: { txHash: fakeTxHash(), kind: 'CAMPAIGN_CREATE', entityType: 'CAMPAIGN', entityId: campaign.id },
  });
  const campaignGet = await inject('GET', `/api/v1/campaigns/${campaign.id}`);
  should('campaign 读模型：treasury 地址回填',
    campaignGet.status === 200 && /^0x[0-9a-f]{40}$/.test(campaignGet.json.data.treasuryAddress),
    campaignGet.json.data);

  const fundAmount = '5000000000000000000'; // 5 MON
  const fundPrep = await inject('POST', `/api/v1/campaigns/${campaign.id}/fund/prepare`, {
    token: bobToken,
    body: { amountWei: fundAmount },
  });
  should('fund prepare', fundPrep.status === 200);
  await inject('POST', '/api/v1/transactions/track', {
    token: bobToken,
    body: { txHash: fakeTxHash(), kind: 'CAMPAIGN_FUND', entityType: 'CAMPAIGN', entityId: campaign.id },
  });

  // 支出 evidence 上传
  const invPresign = await inject('POST', '/api/v1/uploads/presign', {
    token: aliceToken,
    body: { purpose: 'IMPACT_EVIDENCE', filename: 'supplier-invoice.png', contentType: 'image/png', sizeBytes: png.length },
  });
  await inject('PUT', new URL(invPresign.json.data.uploadUrl as string).pathname, {
    raw: png,
    headers: { 'content-type': 'image/png' },
  });
  const invComplete = await inject('POST', `/api/v1/uploads/${invPresign.json.data.mediaId}/complete`, {
    token: aliceToken,
    body: {},
  });

  const spendAmount = '2000000000000000000'; // 2 MON
  const bobSpend = await inject('POST', `/api/v1/campaigns/${campaign.id}/expenses/prepare`, {
    token: bobToken, // 非 organizer
    body: { recipient: supplier, amountWei: spendAmount, purpose: 'Purchase 200kg animal food' },
  });
  should('非 organizer 不能 spend（CAMPAIGN_NOT_ORGANIZER）',
    bobSpend.status === 403 && bobSpend.json.error.code === 'CAMPAIGN_NOT_ORGANIZER');

  const expensePrep = await inject('POST', `/api/v1/campaigns/${campaign.id}/expenses/prepare`, {
    token: aliceToken,
    body: {
      recipient: supplier,
      amountWei: spendAmount,
      purpose: 'Purchase 200kg animal food',
      evidenceMediaIds: [invComplete.json.data.id],
    },
  });
  should('expense prepare（purposeHash + evidenceHash）',
    expensePrep.status === 201 &&
    /^0x[0-9a-f]{64}$/.test(expensePrep.json.data.expense.purposeHash),
    expensePrep.json);

  const overspend = await inject('POST', `/api/v1/campaigns/${campaign.id}/expenses/prepare`, {
    token: aliceToken,
    body: { recipient: supplier, amountWei: '9900000000000000000', purpose: 'too much' },
  });
  should('超额支出被拒（CAMPAIGN_INSUFFICIENT_BALANCE）',
    overspend.status === 422 && overspend.json.error.code === 'CAMPAIGN_INSUFFICIENT_BALANCE');

  await inject('POST', '/api/v1/transactions/track', {
    token: aliceToken,
    body: {
      txHash: fakeTxHash(),
      kind: 'CAMPAIGN_SPEND',
      entityType: 'EXPENSE',
      entityId: expensePrep.json.data.expense.id,
    },
  });

  const transparency = await inject('GET', `/api/v1/campaigns/${campaign.id}/transparency`);
  const summary = transparency.json.data.summary;
  should('Transparency：raised=5 / spent=2 / remaining=3（SPEC §57 守恒）',
    transparency.status === 200 &&
    summary.raisedWei === fundAmount &&
    summary.spentWei === spendAmount &&
    BigInt(summary.remainingWei) === BigInt(fundAmount) - BigInt(spendAmount) &&
    BigInt(summary.raisedWei) === BigInt(summary.spentWei) + BigInt(summary.remainingWei),
    summary);
  should('Transparency：expense 关联 purpose + evidence + explorer 链接',
    transparency.json.data.expenses.length === 1 &&
    transparency.json.data.expenses[0].purpose === 'Purchase 200kg animal food' &&
    transparency.json.data.expenses[0].evidence.length === 1 &&
    transparency.json.data.expenses[0].explorerUrl.includes('/tx/0x'),
    transparency.json.data.expenses);
  should('Transparency：funding 流水含 bob',
    transparency.json.data.funding.length === 1 && transparency.json.data.funding[0].amountWei === fundAmount);

  // ── 8. Profile 双维度（Creation + Contribution）──────────
  const profile = await inject('GET', `/api/v1/profiles/${hAlice}`);
  const stats = profile.json.data.stats;
  should('Profile：Creation（notes≥1, revenue>0）+ Contribution（impact≥2）',
    profile.status === 200 &&
    stats.notes >= 1 &&
    stats.monetizedNotes >= 1 &&
    BigInt(stats.creatorRevenue.amountWei) > 0n &&
    stats.impactNotes >= 2 &&
    stats.attestationsReceived >= 0,
    stats);

  const notesList = await inject('GET', `/api/v1/profiles/${hAlice}/notes?type=IMPACT`);
  should('Profile notes 过滤（type=IMPACT）', notesList.status === 200 && notesList.json.data.items.length >= 1);

  // ── 9. 交易状态 ──────────────────────────────────────────
  const txStatus = await inject('GET', `/api/v1/transactions/${tipHash}`);
  should('交易查询（CONFIRMED）', txStatus.status === 200 && txStatus.json.data.status === 'CONFIRMED' && txStatus.json.data.kind === 'TIP');

  await app.close();
  await closeDb();

  console.log(`\nSmoke 完成：${passedSteps} 组断言全部通过 ✔`);
}

main().catch((err) => {
  console.error('smoke failed:', err);
  process.exit(1);
});
