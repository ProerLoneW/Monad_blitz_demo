"use client";

import { cn } from "@/lib/cn";
import { monFromWei } from "@/lib/format";

/**
 * TransparencySummary（§10.5 第一视觉层 / §14.1 五秒测试）：
 * Raised · Spent · Remaining 三数等大等权重并排 + 4px Leaf 目标进度条。
 * committedWei MVP 恒 0，不渲染第四列。守恒断言由调用方负责（不一致时不渲染本组件）。
 */
export function TransparencySummary({
  raisedWei,
  spentWei,
  remainingWei,
  targetWei,
}: {
  raisedWei: string;
  spentWei: string;
  remainingWei: string;
  targetWei: string | null;
}) {
  const target = targetWei !== null && targetWei !== "" ? BigInt(targetWei) : null;
  const percent =
    target !== null && target > 0n
      ? Number((BigInt(raisedWei) * 100n) / target)
      : null;

  return (
    <div className="rounded-card border border-hairline bg-card">
      <div className="grid grid-cols-3 divide-x divide-hairline">
        <Figure label="Raised" value={raisedWei} />
        <Figure label="Spent" value={spentWei} />
        <Figure label="Remaining" value={remainingWei} tone="leaf" />
      </div>
      {percent !== null && target !== null ? (
        <div className="border-t border-hairline px-24 py-16">
          <div className="h-4 overflow-hidden rounded-full bg-hairline">
            <div
              className="h-full rounded-full bg-leaf"
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
          <p className="mt-8 font-mono text-caption text-smoke">
            {percent}% of {monFromWei(target.toString())} MON target
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Figure({ label, value, tone = "ink" }: { label: string; value: string; tone?: "ink" | "leaf" }) {
  return (
    <div className="p-24">
      <div className="font-mono text-caption uppercase text-smoke">{label}</div>
      <div
        className={cn(
          "mt-8 font-mono text-note-title font-semibold",
          tone === "leaf" ? "text-leaf" : "text-ink",
        )}
      >
        {monFromWei(value)}
        <span className="ml-4 font-mono text-data font-medium text-smoke">MON</span>
      </div>
    </div>
  );
}
