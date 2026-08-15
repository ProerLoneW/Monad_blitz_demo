import { createPublicClient, decodeEventLog, http, type Log, type PublicClient } from 'viem';
import { loadConfigFromEnvFile } from '@proofnote/chain-config';
import { closeDb, getDb, schema } from '@proofnote/db';
import { eq } from 'drizzle-orm';
import { buildTopicMap } from './events.js';
import { dispatch } from './handlers.js';

/**
 * 轻量 Indexer Worker（后端开发文档 §5.5）：
 * - getLogs 轮询（HTTP，无 WSS 依赖），断点续扫（indexer_checkpoint）
 * - REORG_SAFETY_BLOCKS 重叠窗口 + chainId+txHash+logIndex 唯一键去重
 * - CampaignTreasury 为 Factory 克隆的动态地址：启动时从 campaigns 表加载，收到 CampaignCreated 后动态追加
 */
async function main() {
  const config = loadConfigFromEnvFile();
  if (config.isMock) {
    console.warn('[indexer] MOCK_CHAIN 模式：合约地址未配置，indexer 退出（api 的 mock 模拟器接管状态推进）');
    process.exit(0);
  }
  const db = getDb(config.env.DATABASE_URL);
  const client: PublicClient = createPublicClient({ transport: http(config.env.RPC_URL_HTTP) });

  // 启动链 ID 校验（fail-fast）
  const chainId = await client.getChainId();
  if (chainId !== config.env.CHAIN_ID) {
    throw new Error(`RPC chainId ${chainId} != configured ${config.env.CHAIN_ID}`);
  }

  const topicMap = buildTopicMap();

  // 静态合约 + 动态 Treasury 地址
  const staticAddresses = Object.values(config.contracts).filter(Boolean) as string[];
  const treasuryToCampaign = new Map<string, string>();
  const watchAddresses = new Set(staticAddresses.map((a) => a.toLowerCase()));

  const existing = await db.select().from(schema.campaigns);
  for (const c of existing) {
    if (c.treasuryAddress) {
      treasuryToCampaign.set(c.treasuryAddress.toLowerCase(), c.campaignKey);
      watchAddresses.add(c.treasuryAddress.toLowerCase());
    }
  }

  // checkpoint
  await db
    .insert(schema.indexerCheckpoint)
    .values({ chainId: config.env.CHAIN_ID, lastBlock: '0' })
    .onConflictDoNothing();

  const blockTimeCache = new Map<bigint, Date>();
  const getBlockTime = async (n: bigint): Promise<Date> => {
    const cached = blockTimeCache.get(n);
    if (cached) return cached;
    const block = await client.getBlock({ blockNumber: n });
    const t = new Date(Number(block.timestamp) * 1000);
    if (blockTimeCache.size > 5000) blockTimeCache.clear();
    blockTimeCache.set(n, t);
    return t;
  };

  console.log(`[indexer] watching ${watchAddresses.size} addresses on chain ${chainId}`);

  let running = true;
  const shutdown = () => {
    running = false;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    try {
      await pollOnce();
    } catch (err) {
      console.error('[indexer] poll error:', (err as Error).message);
    }
    await sleep(config.env.INDEXER_POLL_INTERVAL_MS);
  }

  await closeDb();

  async function pollOnce(): Promise<void> {
    const cp = (
      await db.select().from(schema.indexerCheckpoint).where(eq(schema.indexerCheckpoint.chainId, chainId)).limit(1)
    )[0];
    let lastBlock = BigInt(cp?.lastBlock ?? '0');
    const latest = await client.getBlockNumber();

    if (lastBlock === 0n) {
      // 首次启动：不回扫全史（全节点剪枝，历史走 Envio/HyperSync —— 文档 §7.3），从当前高度开始
      await db
        .update(schema.indexerCheckpoint)
        .set({ lastBlock: latest.toString(), updatedAt: new Date() })
        .where(eq(schema.indexerCheckpoint.chainId, chainId));
      console.log(`[indexer] initialized checkpoint at block ${latest}`);
      return;
    }

    const chunk = BigInt(config.env.INDEXER_CHUNK_BLOCKS);
    const safety = BigInt(config.env.REORG_SAFETY_BLOCKS);
    let from = lastBlock > safety ? lastBlock - safety + 1n : 1n;

    while (from <= latest && running) {
      const to = from + chunk - 1n > latest ? latest : from + chunk - 1n;
      const logs = await client.getLogs({
        address: [...watchAddresses] as `0x${string}`[],
        fromBlock: from,
        toBlock: to,
      });
      await processLogs(logs);
      from = to + 1n;
      await db
        .update(schema.indexerCheckpoint)
        .set({ lastBlock: to.toString(), updatedAt: new Date() })
        .where(eq(schema.indexerCheckpoint.chainId, chainId));
    }
  }

  async function processLogs(logs: Log[]): Promise<void> {
    const sorted = [...logs].sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? (a.logIndex ?? 0) - (b.logIndex ?? 0)
        : Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)),
    );
    for (const log of sorted) {
      if (!log.topics?.length) continue;
      const meta = topicMap.get(log.topics[0]!.toLowerCase());
      if (!meta) continue;
      const txHash = log.transactionHash ?? '0x' + '0'.repeat(64);
      const blockNumberStr = String(log.blockNumber ?? 0n);
      const logIndexNum = log.logIndex ?? 0;

      let decoded: { eventName: string; args: Record<string, unknown> };
      try {
        decoded = decodeEventLog({
          abi: meta.abi,
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        }) as unknown as { eventName: string; args: Record<string, unknown> };
      } catch (err) {
        console.warn('[indexer] decode failed:', (err as Error).message);
        continue;
      }
      const args = decoded.args as Record<string, unknown>;

      // Treasury 事件无 campaignKey 字段：由发出地址（treasury）反查
      if (meta.contract === 'campaignTreasury') {
        const treasury = log.address.toLowerCase();
        let campaignKey = treasuryToCampaign.get(treasury);
        if (!campaignKey) {
          const row = (
            await db.select().from(schema.campaigns).where(eq(schema.campaigns.treasuryAddress, treasury)).limit(1)
          )[0];
          if (row) {
            campaignKey = row.campaignKey;
            treasuryToCampaign.set(treasury, campaignKey);
            watchAddresses.add(treasury);
          }
        }
        if (!campaignKey) {
          console.warn(`[indexer] unknown treasury ${treasury}, skipping ${meta.eventName}`);
          continue;
        }
        args.campaignKey = campaignKey;
      }

      // 去重（§5.5.3）：chainId + txHash + logIndex 唯一
      const inserted = await db
        .insert(schema.chainEvents)
        .values({
          chainId,
          txHash,
          logIndex: logIndexNum,
          blockNumber: blockNumberStr,
          eventName: meta.eventName,
          argsJson: serializeArgs(args),
        })
        .onConflictDoNothing()
        .returning({ id: schema.chainEvents.id });
      if (inserted.length === 0) continue; // 重复事件

      const blockTime = await getBlockTime(log.blockNumber ?? 0n);
      try {
        await dispatch(db, {
          eventName: meta.eventName,
          args,
          txHash,
          blockTime,
          blockNumber: blockNumberStr,
          feeRecipient: config.env.PROTOCOL_FEE_RECIPIENT,
        });
        // CampaignCreated 后动态追踪新 Treasury
        if (meta.eventName === 'CampaignCreated') {
          const treasury = String(args.treasury).toLowerCase();
          const campaignKey = String(args.campaignKey);
          treasuryToCampaign.set(treasury, campaignKey);
          watchAddresses.add(treasury);
          console.log(`[indexer] tracking new treasury ${treasury} (campaign ${campaignKey})`);
        }
      } catch (err) {
        console.error(`[indexer] handler ${meta.eventName} failed:`, (err as Error).message);
      }
    }
  }
}

function serializeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'bigint') out[k] = v.toString();
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'bigint' ? x.toString() : x));
    else out[k] = v;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('indexer fatal:', err);
  process.exit(1);
});
