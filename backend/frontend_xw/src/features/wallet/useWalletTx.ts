"use client";

import { useCallback } from "react";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { TxRequest } from "@proofnote/api-types";
import { trackTransaction } from "@/services/api";
import { useConfig } from "@/hooks/useConfig";
import { truncateAddress } from "@/lib/format";
import { useTxStore, type WalletTxUiState } from "@/stores/tx";
import { useUiStore } from "@/stores/ui";

/**
 * useWalletTx — 全局唯一写路径（FRONTEND_DESIGN §23.2 交易管线）：
 * prepare → chainId 校验 → wagmi sendTransaction → track → CONFIRMED。
 * mock 模式（TxRequest.mock=true）下模拟 SUBMITTED→CONFIRMED 成功态，
 * 接入真实后端后同一函数走钱包真实发送，组件不感知。
 */
export function useWalletTx(opts: {
  kind: string;
  entityId: string;
  invalidateKeys?: string[][];
}) {
  const key = `${opts.kind}:${opts.entityId}`;
  const instance = useTxStore((s) => s.instances[key]) ?? { state: "IDLE" as WalletTxUiState };
  const set = useTxStore((s) => s.set);
  const resetStore = useTxStore((s) => s.reset);
  const { pushToast, updateToast } = useUiStore();
  const queryClient = useQueryClient();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { data: config } = useConfig();

  const run = useCallback(
    async (prepare: () => Promise<TxRequest>) => {
      set(key, { state: "PREPARING", error: undefined, txHash: undefined });
      try {
        const tx = await prepare();

        // chainId 校验（§16.5）：不符则一键切换后恢复流程
        const expected = config?.chain.chainId ?? tx.chainId;
        if (chainId !== expected) {
          await switchChainAsync({ chainId: expected });
        }

        set(key, { state: "WAITING_WALLET" });

        let txHash: `0x${string}`;
        if (tx.mock) {
          // mock 成功态：模拟钱包确认与出块
          await new Promise((r) => setTimeout(r, 900));
          txHash = `0xmock${Date.now().toString(16)}${"0".repeat(40)}`.slice(0, 66) as `0x${string}`;
        } else {
          txHash = await sendTransactionAsync({
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
            chainId: tx.chainId,
          });
        }

        set(key, { state: "SUBMITTED", txHash });
        const toastId = pushToast({
          kind: "submitted",
          message: `Submitted ${truncateAddress(txHash)} ↗`,
          explorerUrl: config
            ? `${config.chain.explorerBaseUrl}/tx/${txHash}`
            : null,
        });

        if (tx.mock) {
          await new Promise((r) => setTimeout(r, 900));
        } else {
          // 轮询后端 track（1s，上限 30s 转 "taking longer"，§16.3）
          const deadline = Date.now() + 30_000;
          for (;;) {
            const tracked = await trackTransaction(txHash);
            if (tracked.status === "CONFIRMED") break;
            if (tracked.status === "REVERTED" || tracked.status === "DROPPED") {
              throw new Error(tracked.error ?? "Transaction failed");
            }
            if (Date.now() > deadline) break; // taking longer — 不判死
            await new Promise((r) => setTimeout(r, 1000));
          }
        }

        set(key, { state: "CONFIRMED" });
        updateToast(toastId, { kind: "confirmed", message: "Confirmed ✓" });
        setTimeout(() => useUiStore.getState().dismissToast(toastId), 2000);
        for (const qk of opts.invalidateKeys ?? []) {
          queryClient.invalidateQueries({ queryKey: qk });
        }
        return txHash;
      } catch (err) {
        const message =
          err instanceof Error && /reject|denied/i.test(err.message)
            ? "User rejected the request — nothing was sent."
            : err instanceof Error
              ? err.message
              : "Network unavailable — retry";
        set(key, { state: "FAILED", error: message });
        const toastId = pushToast({ kind: "failed", message: "Failed" });
        setTimeout(() => useUiStore.getState().dismissToast(toastId), 5000);
        throw err;
      }
    },
    [key, chainId, config, sendTransactionAsync, switchChainAsync, pushToast, updateToast, queryClient, opts.invalidateKeys, set],
  );

  const reset = useCallback(() => resetStore(key), [key, resetStore]);

  return { ...instance, run, reset };
}
