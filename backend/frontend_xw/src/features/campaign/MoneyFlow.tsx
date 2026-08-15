"use client";

import { useEffect, useState } from "react";
import type { CampaignExpense } from "@proofnote/api-types";
import { cn } from "@/lib/cn";
import { monFromWei, truncateAddress } from "@/lib/format";
import { ExplorerLink } from "@/components/ui/ExplorerLink";

/**
 * MoneyFlow（§14.2 “钱的地图”）：Supporters → Treasury → 各支出节点 +
 * Remaining 虚线节点。hairline 单色连线（ink/30），线粗 ∝ 金额；
 * 白卡 hairline 节点，无图表库。桌面横向；窄屏横向滚动。
 */

// 支出节点几何：h-11（44px）+ gap-12 → 行距 56px，用于连线定位。
const NODE_HEIGHT = 44;
const NODE_GAP = 12;
const PITCH = NODE_HEIGHT + NODE_GAP;

export function MoneyFlow({
  supporterCount,
  raisedWei,
  treasuryAddress,
  expenses,
  remainingWei,
}: {
  supporterCount: number;
  raisedWei: string;
  treasuryAddress: string | null;
  expenses: CampaignExpense[];
  remainingWei: string;
}) {
  const maxOut = expenses.reduce<bigint>(
    (max, e) => (BigInt(e.amountWei) > max ? BigInt(e.amountWei) : max),
    0n,
  );
  const destinations = expenses.length + 1; // + Remaining
  const halfSpan = ((destinations - 1) / 2) * PITCH;

  return (
    <section>
      <h2 className="font-mono text-caption uppercase text-smoke">Money flow</h2>
      <div className="mt-16 overflow-x-auto">
        <div className="flex w-max items-stretch">
          {/* Supporters */}
          <div className="flex items-center">
            <div className="flex flex-col gap-4 whitespace-nowrap rounded-card border border-hairline bg-card px-16 py-12">
              <span className="font-mono text-caption uppercase text-smoke">Supporters</span>
              <span className="font-sans text-label text-ink">{supporterCount} wallets</span>
              <span className="font-mono text-caption text-graphite">
                {monFromWei(raisedWei)} MON in
              </span>
            </div>
          </div>

          {/* 流入主线（全额 23 MON → 最粗） */}
          <span aria-hidden className="h-[2px] w-24 self-center bg-ink/30" />

          {/* Treasury */}
          <div className="flex items-center">
            <div className="flex flex-col gap-4 whitespace-nowrap rounded-card border border-hairline bg-card px-16 py-12">
              <span className="font-mono text-caption uppercase text-smoke">Treasury</span>
              <span className="font-mono text-data font-medium text-ink">
                {monFromWei(raisedWei)} MON
              </span>
              {treasuryAddress ? (
                <span className="flex items-center gap-8 font-mono text-caption text-smoke">
                  {truncateAddress(treasuryAddress)}
                  <CopyValue value={treasuryAddress} />
                  <ExplorerLink path={`/address/${treasuryAddress}`}>↗</ExplorerLink>
                </span>
              ) : (
                <span className="font-mono text-caption text-smoke">Treasury initializing…</span>
              )}
            </div>
          </div>

          {/* 分支连线区：Treasury → 竖轨 → 各支出/Remaining */}
          <div aria-hidden className="relative w-24 self-stretch">
            <span className="absolute left-0 top-1/2 h-[2px] w-12 -translate-y-1/2 bg-ink/30" />
            {destinations > 1 ? (
              <span
                className="absolute left-12 w-px bg-ink/30"
                style={{
                  top: `calc(50% - ${halfSpan}px)`,
                  height: `${halfSpan * 2}px`,
                }}
              />
            ) : null}
            {expenses.map((e, i) => (
              <span
                key={e.id}
                className={cn(
                  "absolute left-12 w-12 -translate-y-1/2 bg-ink/30",
                  BigInt(e.amountWei) >= maxOut ? "h-[2px]" : "h-px",
                )}
                style={{ top: `calc(50% + ${(i - (destinations - 1) / 2) * PITCH}px)` }}
              />
            ))}
            <span
              className="absolute left-12 h-0 w-12 -translate-y-1/2 border-t border-dashed border-ink/30"
              style={{ top: `calc(50% + ${halfSpan}px)` }}
            />
          </div>

          {/* 支出节点 + Remaining（虚线 = 未花出） */}
          <div className="flex flex-col justify-center gap-12 self-stretch">
            {expenses.map((e) => (
              <div
                key={e.id}
                className="flex h-11 w-56 items-center justify-between gap-12 whitespace-nowrap rounded-card border border-hairline bg-card px-16"
              >
                <span className="truncate font-sans text-label text-ink">{e.recipient}</span>
                <span className="font-mono text-label text-graphite">
                  {monFromWei(e.amountWei)} MON
                </span>
              </div>
            ))}
            <div className="flex h-11 w-56 items-center justify-between gap-12 whitespace-nowrap rounded-card border border-dashed border-hairline-strong bg-card px-16">
              <span className="font-sans text-label text-graphite">Remaining</span>
              <span className="font-mono text-label text-leaf">{monFromWei(remainingWei)} MON</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** ⧉ 复制按钮：复制后短暂显示 ✓。 */
function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      title="Copy treasury address"
      aria-label="Copy treasury address"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
      }}
      className="font-mono text-caption text-smoke transition-colors duration-150 hover:text-ink"
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}
