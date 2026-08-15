import { createPublicClient, http, type PublicClient } from 'viem';
import type { ChainConfig } from '@proofnote/chain-config';
import { getAbi } from '@proofnote/contract-abis';

/**
 * 链交互封装（后端开发文档 §4.1/§4.7/§4.8/§4.10）。
 * mock 模式下 client 为 null——所有链读返回 null，由调用方回退。
 * 注意：Monad 全节点不提供历史状态（§7.3），本服务只做当前状态读与 receipt 查询。
 */
export class ChainService {
  private client: PublicClient | null = null;
  private feeBpsCache: { value: number; at: number } | null = null;
  private static FEE_CACHE_MS = 60_000;

  constructor(private cfg: ChainConfig) {}

  get isMock(): boolean {
    return this.cfg.isMock;
  }

  getClient(): PublicClient | null {
    if (this.cfg.isMock) return null;
    if (!this.client) {
      this.client = createPublicClient({ transport: http(this.cfg.env.RPC_URL_HTTP) });
    }
    return this.client;
  }

  /** 启动时校验链 ID（fail-fast，防连错网络） */
  async verifyChainId(): Promise<void> {
    const client = this.getClient();
    if (!client) return;
    const chainId = await client.getChainId();
    if (chainId !== this.cfg.env.CHAIN_ID) {
      throw new Error(`RPC chainId ${chainId} != configured CHAIN_ID ${this.cfg.env.CHAIN_ID}`);
    }
  }

  /** protocol fee bps：优先链上实读（60s 缓存），失败回退配置值——禁止硬编码（SPEC §14.1） */
  async getFeeBps(): Promise<number> {
    if (this.feeBpsCache && Date.now() - this.feeBpsCache.at < ChainService.FEE_CACHE_MS) {
      return this.feeBpsCache.value;
    }
    const client = this.getClient();
    const router = this.cfg.contracts.supportRouter;
    if (client && router) {
      try {
        const bps = (await client.readContract({
          address: router as `0x${string}`,
          abi: getAbi('supportRouter'),
          functionName: 'feeBps',
        })) as number;
        if (typeof bps === 'number') {
          this.feeBpsCache = { value: bps, at: Date.now() };
          return bps;
        }
      } catch (err) {
        console.warn('[chain] feeBps() read failed, using fallback:', (err as Error).message);
      }
    }
    return this.cfg.feeBpsFallback;
  }

  async previewTip(grossWei: bigint): Promise<{ creatorAmount: bigint; protocolFee: bigint } | null> {
    const client = this.getClient();
    const router = this.cfg.contracts.supportRouter;
    if (!client || !router) return null;
    try {
      const [creatorAmount, protocolFee] = (await client.readContract({
        address: router as `0x${string}`,
        abi: getAbi('supportRouter'),
        functionName: 'previewTip',
        args: [grossWei],
      })) as [bigint, bigint];
      return { creatorAmount, protocolFee };
    } catch {
      return null;
    }
  }

  async getClaimable(account: string): Promise<bigint | null> {
    const client = this.getClient();
    const ss = this.cfg.contracts.streamSupport;
    if (!client || !ss) return null;
    try {
      return (await client.readContract({
        address: ss as `0x${string}`,
        abi: getAbi('streamSupport'),
        functionName: 'claimable',
        args: [account],
      })) as bigint;
    } catch {
      return null;
    }
  }

  async hasAttested(impactKey: string, attester: string, attestationType: number): Promise<boolean | null> {
    const client = this.getClient();
    const ar = this.cfg.contracts.attestationRegistry;
    if (!client || !ar) return null;
    try {
      return (await client.readContract({
        address: ar as `0x${string}`,
        abi: getAbi('attestationRegistry'),
        functionName: 'hasAttested',
        args: [impactKey as `0x${string}`, attester, BigInt(attestationType)],
      })) as boolean;
    } catch {
      return null;
    }
  }

  async getReceipt(txHash: string) {
    const client = this.getClient();
    if (!client) return null;
    try {
      return await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    } catch {
      return null; // not found yet / RPC error —— 统一按未确认处理，由 reconcile 兜底
    }
  }
}
