import type { DistributionEntry } from "@/types";

/**
 * DistributionBar（§11.2/§11.4）：单色水平堆叠细条（4px），段落与百分比
 * 全部取 API `bps`；首段 Ink（Creator），其余 hairline。
 */
export function DistributionBar({ entries }: { entries: DistributionEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div>
      <div className="font-mono text-caption text-smoke">Distribution</div>
      <div className="mt-8 flex h-4 overflow-hidden rounded-full bg-hairline">
        {entries.map((e, i) => (
          <div
            key={`${e.role}:${e.address}`}
            className={i === 0 ? "bg-ink" : "bg-hairline"}
            style={{ width: `${e.bps / 100}%` }}
          />
        ))}
      </div>
      <div className="mt-8 font-mono text-caption text-smoke">
        {entries.map((e) => `${e.bps / 100}% to ${e.role.toLowerCase()}`).join(" · ")}
      </div>
    </div>
  );
}
