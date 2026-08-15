"use client";

import { create } from "zustand";

/**
 * Transaction State（§24.1/§24.2）— 每笔交易一个状态机实例，
 * key = `${kind}:${entityId}`。页面卸载后实例保留，Toast 仍可通知结果。
 */

export type WalletTxUiState =
  | "IDLE"
  | "PREPARING"
  | "WAITING_WALLET"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FAILED";

export type TxInstance = {
  state: WalletTxUiState;
  txHash?: string;
  error?: string;
};

type TxState = {
  instances: Record<string, TxInstance>;
  set: (key: string, patch: Partial<TxInstance>) => void;
  reset: (key: string) => void;
};

export const useTxStore = create<TxState>((set) => ({
  instances: {},
  set: (key, patch) =>
    set((s) => {
      const base: TxInstance = s.instances[key] ?? { state: "IDLE" };
      return {
        instances: { ...s.instances, [key]: { ...base, ...patch } },
      };
    }),
  reset: (key) =>
    set((s) => {
      const next = { ...s.instances };
      delete next[key];
      return { instances: next };
    }),
}));

export function useTxInstance(key: string): TxInstance {
  return useTxStore((s) => s.instances[key]) ?? { state: "IDLE" };
}
