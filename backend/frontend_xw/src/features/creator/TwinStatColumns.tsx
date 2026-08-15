import type { ProfileStatsExtended } from "@/types";
import { monOf } from "@/lib/format";

/**
 * Creation / Contribution 双栏（§10.6 第二视觉层 / §15.1）：
 * 等宽、同字号、同排版 —— “创作与贡献等值”的排版表达；中间仅一条竖 hairline，
 * 不是两张卡片。数字 mono 24px semibold tabular + smoke 小标签；金额带 ` MON`。
 * 空值不显示 0 大数字，显示引导文案（§10.6 States / §15.1）。
 * 不合成总分、无排行榜/勋章（PRD §15 防 Goodhart）。
 */

type Row = { figure: string; label: string; empty: string; zero: boolean };

function plural(n: number, noun: string): string {
  return n === 1 ? noun : `${noun}s`;
}

function StatRow({ row }: { row: Row }) {
  if (row.zero) {
    return <p className="font-sans text-label leading-[1.6] text-smoke">{row.empty}</p>;
  }
  return (
    <div>
      <p className="font-mono text-title font-semibold leading-[1.2] text-ink">{row.figure}</p>
      <p className="mt-4 font-sans text-caption text-smoke">{row.label}</p>
    </div>
  );
}

function StatColumn({ heading, rows }: { heading: string; rows: Row[] }) {
  return (
    <section>
      <h2 className="font-mono text-caption uppercase tracking-[-0.28px] text-smoke">
        {heading}
      </h2>
      <div className="mt-20 flex flex-col gap-16">
        {rows.map((row) => (
          <StatRow key={row.label} row={row} />
        ))}
      </div>
    </section>
  );
}

export function TwinStatColumns({ stats }: { stats: ProfileStatsExtended }) {
  const creation: Row[] = [
    {
      figure: String(stats.notes),
      label: plural(stats.notes, "Note"),
      empty: "No notes yet.",
      zero: stats.notes === 0,
    },
    {
      figure: String(stats.monetizedNotes),
      label: "Monetized",
      empty: "No monetized notes yet.",
      zero: stats.monetizedNotes === 0,
    },
    {
      figure: `${monOf(stats.creatorRevenue)} MON`,
      label: "Verified Creator Revenue",
      empty: "No creator revenue yet — share your first monetized note.",
      zero: stats.creatorRevenue.amountWei === "0",
    },
    {
      figure: String(stats.collaborations),
      label: plural(stats.collaborations, "Collaboration"),
      empty: "No collaborations yet.",
      zero: stats.collaborations === 0,
    },
  ];

  const contribution: Row[] = [
    {
      figure: String(stats.impactNotes),
      label: plural(stats.impactNotes, "Impact Note"),
      empty: "No impact notes yet.",
      zero: stats.impactNotes === 0,
    },
    {
      figure: String(stats.verifiedActions),
      label: plural(stats.verifiedActions, "Verified Action"),
      empty: "No verified actions yet.",
      zero: stats.verifiedActions === 0,
    },
    {
      figure: `${monOf(stats.directedToCauses)} MON`,
      label: "Directed to Causes",
      empty: "Nothing directed to causes yet.",
      zero: stats.directedToCauses.amountWei === "0",
    },
    {
      figure: String(stats.attestationsReceived),
      label: `${plural(stats.attestationsReceived, "Attestation")} Received`,
      empty: "No attestations received yet.",
      zero: stats.attestationsReceived === 0,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-32 sm:grid-cols-2 sm:gap-0">
      <div className="sm:pr-32">
        <StatColumn heading="Creation" rows={creation} />
      </div>
      <div className="sm:border-l sm:border-hairline sm:pl-32">
        <StatColumn heading="Contribution" rows={contribution} />
      </div>
    </div>
  );
}
