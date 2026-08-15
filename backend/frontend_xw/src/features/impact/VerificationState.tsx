"use client";

import { useState } from "react";
import type { ImpactSummary } from "@proofnote/api-types";
import { cn } from "@/lib/cn";

type Verification = ImpactSummary["verification"];

const LEVEL_LABEL: Record<string, string> = {
  L0: "Self-claimed",
  L1: "Evidence attached",
  L2: "Community attested",
};

const LEVEL_FILLED: Record<string, number> = { L0: 0, L1: 1, L2: 2 };

/**
 * VerificationState（§13.3）：三点等级（L0 灰 / L1 蓝灰 / L2 Leaf）+
 * 等级文案 + 可展开 "Why?"（构成明细 + 固定免责声明）。
 * L3/L4 数据若存在仍显示为 L2（不自动授予高等级）。
 * 禁用语黑名单：100% True / Certified / Guaranteed / Officially verified。
 */
export function VerificationState({ verification }: { verification: Verification }) {
  const [open, setOpen] = useState(false);

  const level = verification.level === "L0" || verification.level === "L1" ? verification.level : "L2";
  const filled = LEVEL_FILLED[level];
  const isLeaf = level === "L2";

  return (
    <div>
      <div className="flex items-center justify-between gap-16">
        <div className="flex items-center gap-12">
          <span aria-hidden className="flex items-center gap-4">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "inline-block h-8 w-8 rounded-full",
                  i < filled
                    ? isLeaf
                      ? "bg-leaf"
                      : "bg-graphite"
                    : "border border-hairline bg-transparent",
                )}
              />
            ))}
          </span>
          <span
            className={cn(
              "font-mono text-caption",
              isLeaf ? "text-leaf" : "text-graphite",
            )}
          >
            {LEVEL_LABEL[level]}
          </span>
        </div>

        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="font-mono text-caption text-smoke transition-colors duration-150 hover:text-ink"
        >
          Why? {open ? "▴" : "▾"}
        </button>
      </div>

      {open ? (
        <div className="mt-12">
          <p className="font-mono text-caption leading-[1.6] text-graphite">
            Claim <span className="text-leaf">✓</span> · Evidence {verification.evidenceCount} ·
            Attestations {verification.attestationCount} · Challenges{" "}
            <span className={verification.openChallengeCount > 0 ? "text-amber" : undefined}>
              {verification.openChallengeCount}
            </span>
          </p>
          <p className="mt-8 font-mono text-caption leading-[1.6] text-smoke">
            Verification reflects on-chain evidence structure, not a guarantee of truth.
          </p>
        </div>
      ) : null}
    </div>
  );
}
