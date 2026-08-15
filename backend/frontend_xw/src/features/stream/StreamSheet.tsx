"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { Note } from "@/types";
import { prepareStreamStart } from "@/services/api";
import { useWalletTx } from "@/features/wallet/useWalletTx";
import { ConnectPrimaryButton } from "@/features/wallet/WalletArea";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/features/value/Sheet";
import { durationLabel, monToWei, trimMon } from "@/features/value/amount";

/** §12.2 预设三档（= 0.0005 / 0.001 / 0.0025 MON/s）。 */
const RATES = ["0.03", "0.06", "0.15"];

/**
 * Stream Sheet（§12.2 / §10.8 B）：Rate 三档 + Custom → Max budget 滑杆
 * （0.05–2 MON，时长换算实时跟随）→ 托管/退回文案 → useWalletTx 确认。
 */
export function StreamSheet({
  note,
  open,
  onClose,
}: {
  note: Note;
  open: boolean;
  onClose: () => void;
}) {
  const { isConnected } = useAccount();
  const {
    state: txState,
    error: txError,
    run,
    reset,
  } = useWalletTx({
    kind: "stream",
    entityId: note.id,
    invalidateKeys: [["stream"], ["note", note.id], ["value", note.id]],
  });

  const [rateChip, setRateChip] = useState<string>("0.06");
  const [customRate, setCustomRate] = useState("");
  const [budget, setBudget] = useState(0.2);

  const rateMin = customRate.trim() !== "" ? customRate.trim() : rateChip;
  const rateMinWei = rateMin ? monToWei(rateMin) : null;
  // rate ≥ 60 wei/min 才能保证 wei/s ≥ 1
  const valid = rateMinWei !== null && BigInt(rateMinWei) >= 60n;
  const rateWeiPerSecond = valid ? (BigInt(rateMinWei) / 60n).toString() : null;
  const budgetWei = monToWei(trimMon(budget));
  const durationSec = valid ? (budget / Number(rateMin)) * 60 : 0;

  const busy = txState === "PREPARING" || txState === "WAITING_WALLET" || txState === "SUBMITTED";

  // 成功后停留 800ms 再收起，invalidate 后 ValuePanel 顶部进入 Stream 控制态
  useEffect(() => {
    if (txState !== "CONFIRMED") return;
    const t = setTimeout(() => {
      reset();
      onClose();
    }, 800);
    return () => clearTimeout(t);
  }, [txState, reset, onClose]);

  const close = () => {
    reset();
    onClose();
  };

  const confirm = async () => {
    if (!rateWeiPerSecond || !budgetWei) return;
    try {
      await run(() => prepareStreamStart(note.id, rateWeiPerSecond, budgetWei));
    } catch {
      /* FAILED 态在确认段内展示，Toast 已通知 */
    }
  };

  const ctaLabel =
    txState === "PREPARING"
      ? "Preparing…"
      : txState === "WAITING_WALLET"
        ? "Confirm in wallet…"
        : txState === "SUBMITTED"
          ? "Submitted…"
          : txState === "CONFIRMED"
            ? "Confirmed ✓"
            : `Start Supporting — ${trimMon(budget)} MON`;

  return (
    <Sheet open={open} onClose={close} title="Stream Support">
      <p className="font-sans text-label text-graphite">Watch more, support more.</p>

      {/* ① 参数段：Rate */}
      <div>
        <div className="font-mono text-caption text-smoke">Rate</div>
        <div className="mt-8 flex items-center gap-8">
          {RATES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={rateChip === r && customRate === "" ? "primary" : "ghost"}
              onClick={() => {
                setRateChip(r);
                setCustomRate("");
              }}
            >
              {r}
            </Button>
          ))}
          <span className="font-mono text-caption text-smoke">MON/min</span>
        </div>
        <div className="mt-8 flex items-center gap-8">
          <span className="font-mono text-caption text-smoke">Custom</span>
          <div className="relative flex-1">
            <input
              value={customRate}
              onChange={(e) => {
                if (/^\d*\.?\d*$/.test(e.target.value)) setCustomRate(e.target.value);
              }}
              placeholder="0.06"
              inputMode="decimal"
              className="h-11 w-full rounded-input border border-hairline bg-card px-12 pr-64 font-mono text-label text-ink outline-none transition-colors duration-150 placeholder:text-smoke focus:border-hairline-strong"
            />
            <span className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 font-mono text-caption text-smoke">
              MON/min
            </span>
          </div>
        </div>
      </div>

      {/* ① 参数段：Max budget */}
      <div className="border-t border-hairline pt-16">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-caption text-smoke">Max budget</span>
          <span className="font-mono text-label text-ink">{trimMon(budget)} MON</span>
        </div>
        <input
          type="range"
          min={0.05}
          max={2}
          step={0.05}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          className="mt-12 w-full accent-ink"
        />
        <div className="mt-8 font-mono text-caption text-smoke">
          ≈ {durationLabel(durationSec)} of support
        </div>
      </div>

      <p className="border-t border-hairline pt-16 text-caption leading-[1.5] text-graphite">
        You&apos;ll deposit {trimMon(budget)} MON. Unused budget is refunded when you stop.
      </p>

      {/* ③ 确认段 */}
      <div className="mt-auto flex flex-col gap-8 border-t border-hairline pt-16">
        {txState === "FAILED" ? (
          <p className="font-mono text-caption text-red">{txError ?? "Transaction failed"}</p>
        ) : null}
        {!isConnected ? (
          <>
            <p className="text-caption text-graphite">
              Connect to support creators and verify ownership.
            </p>
            <ConnectPrimaryButton />
          </>
        ) : (
          <Button className="w-full" disabled={!valid || busy} onClick={confirm}>
            {ctaLabel}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
