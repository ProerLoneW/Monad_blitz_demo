"use client";

import { useEffect, useState } from "react";

/**
 * Stream 本地引擎（§24.3 / API SPEC §18）：输入快照 {accruedWei, snapshotAt,
 * rateWeiPerSecond, active}，rAF 插值走字；校准靠传入新快照（sync）。
 * 显示 6 位小数（StreamAmount 规格），tabular mono。
 */
export type StreamSnapshot = {
  accruedWei: string;
  snapshotAt: string;
  rateWeiPerSecond: string;
  active: boolean;
};

function currentAccrued(s: StreamSnapshot, now: number): number {
  const base = Number(s.accruedWei) / 1e18;
  if (!s.active) return base;
  const elapsedSec = Math.max(0, (now - new Date(s.snapshotAt).getTime()) / 1000);
  return base + (Number(s.rateWeiPerSecond) / 1e18) * elapsedSec;
}

export function useTickingAmount(snapshot: StreamSnapshot | null, decimals = 6): string {
  const [display, setDisplay] = useState(() =>
    snapshot ? currentAccrued(snapshot, Date.now()).toFixed(decimals) : "0.000000",
  );

  useEffect(() => {
    if (!snapshot) return;
    if (!snapshot.active) {
      setDisplay(currentAccrued(snapshot, Date.now()).toFixed(decimals));
      return;
    }
    let raf: number;
    const tick = () => {
      setDisplay(currentAccrued(snapshot, Date.now()).toFixed(decimals));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [snapshot, decimals]);

  return display;
}
