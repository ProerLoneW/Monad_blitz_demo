"use client";

import { useMemo, useState } from "react";
import type { Stream } from "@/types";
import { prepareStreamControl } from "@/services/api";
import { monFromWei } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ratePerMinuteLabel } from "@/features/value/amount";
import { useWalletTx } from "@/features/wallet/useWalletTx";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PulseDot } from "@/components/ui/PulseDot";
import { StreamAmount } from "./StreamAmount";
import { useTickingAmount, type StreamSnapshot } from "./useTickingAmount";

/**
 * StreamControl（§12.1/§12.4，P03 面板顶部控制态）：
 * ACTIVE = 走字 + Iris 脉冲 + Pause/Stop；PAUSED = 静止 + Resume/Stop；
 * DEPLETED = 停在 budget + Settle。显示值 = min(快照 + 流逝 × rate, budget)，
 * 校准靠 invalidate ["stream"] 后的新快照（§12.3）。
 */
export function StreamControl({
  stream,
  creatorLabel,
  creatorName,
}: {
  stream: Stream;
  /** `@alice` 形态 */
  creatorLabel: string;
  /** `Alice` 形态（Stop 确认 Modal 用） */
  creatorName: string;
}) {
  const status = stream.status;
  const active = status === "ACTIVE";

  const snapshot = useMemo<StreamSnapshot>(
    () => ({
      accruedWei: stream.accruedWei,
      snapshotAt: stream.snapshotAt,
      rateWeiPerSecond: stream.rateWeiPerSecond,
      active,
    }),
    [stream, active],
  );
  const ticked = useTickingAmount(snapshot);
  const budget = Number(stream.budgetWei) / 1e18;
  const shown = Math.min(Number(ticked), budget);
  const ratePerSec = Number(stream.rateWeiPerSecond) / 1e18;
  const elapsed = ratePerSec > 0 ? Math.floor(shown / ratePerSec) : 0;
  const pct = budget > 0 ? Math.min(100, (shown / budget) * 100) : 0;

  const {
    state: txState,
    error: txError,
    run,
  } = useWalletTx({
    kind: "stream-control",
    entityId: stream.streamId,
    invalidateKeys: [["stream"]],
  });
  const busy = txState === "PREPARING" || txState === "WAITING_WALLET" || txState === "SUBMITTED";

  const [confirmStop, setConfirmStop] = useState<{ accrued: number } | null>(null);

  const control = async (action: "pause" | "resume" | "stop") => {
    try {
      await run(() => prepareStreamControl(stream.streamId, action));
      return true;
    } catch {
      return false; /* FAILED 态在行内展示，Toast 已通知 */
    }
  };

  const stop = async () => {
    if (await control("stop")) setConfirmStop(null);
  };

  return (
    <section>
      {/* 状态行：● Streaming to @alice */}
      <div className="flex items-center gap-8">
        {active ? (
          <PulseDot />
        ) : (
          <span
            aria-hidden
            className={cn(
              "inline-block h-8 w-8 shrink-0 rounded-full",
              status === "DEPLETED" ? "bg-amber" : "bg-smoke",
            )}
          />
        )}
        <span className="flex-1 font-sans text-label text-ink">Streaming to {creatorLabel}</span>
        {status === "PAUSED" ? <Badge variant="neutral">Paused</Badge> : null}
        {status === "DEPLETED" ? <Badge variant="amber">Budget reached</Badge> : null}
      </div>

      {/* 走字金额（6 位小数，封顶 budget） */}
      <div className="mt-12">
        <StreamAmount snapshot={null} display={shown.toFixed(6)} />
      </div>

      {/* 速率 · 预算 · 已进行 */}
      <div className="mt-8 font-mono text-caption text-smoke">
        {ratePerMinuteLabel(stream.rateWeiPerSecond)} MON/min · Budget{" "}
        {monFromWei(stream.budgetWei)} MON · {elapsed}s
      </div>

      {/* 预算消耗细进度条 */}
      <div className="mt-12 h-4 overflow-hidden rounded-full bg-hairline">
        <div className="h-full rounded-full bg-iris" style={{ width: `${pct}%` }} />
      </div>

      {/* 控制按钮 */}
      <div className="mt-16 flex gap-12">
        {active ? (
          <Button
            variant="ghost"
            className="flex-1"
            disabled={busy}
            onClick={() => control("pause")}
          >
            ⏸ Pause
          </Button>
        ) : null}
        {status === "PAUSED" ? (
          <Button
            variant="ghost"
            className="flex-1"
            disabled={busy}
            onClick={() => control("resume")}
          >
            ▶ Resume
          </Button>
        ) : null}
        {status === "DEPLETED" ? (
          <Button className="flex-1" disabled={busy} onClick={() => control("stop")}>
            Settle
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="flex-1"
            disabled={busy}
            onClick={() => setConfirmStop({ accrued: shown })}
          >
            ■ Stop
          </Button>
        )}
      </div>

      {/* 口径说明（§12.3 诚实核心） */}
      <p className="mt-12 flex items-start gap-4 text-caption text-smoke">
        <span
          aria-hidden
          title="Amount accrues by time and is settled on-chain when paused, stopped or depleted. The ticking number is a live estimate."
          className="cursor-help"
        >
          ⓘ
        </span>
        Accrues by time · settled on-chain when you pause or stop
      </p>

      {busy ? (
        <p className="mt-8 font-mono text-caption text-smoke">
          {txState === "PREPARING"
            ? "Preparing…"
            : txState === "WAITING_WALLET"
              ? "Confirm in wallet…"
              : "Submitted…"}
        </p>
      ) : null}
      {txState === "FAILED" ? (
        <p className="mt-8 font-mono text-caption text-red">
          {txError ?? "Transaction failed — retry"}
        </p>
      ) : null}

      {/* Stop & Settle 确认（§12.4） */}
      <Modal open={confirmStop !== null} onClose={() => setConfirmStop(null)} width={420}>
        <h3 className="font-serif text-title tracking-[-0.48px] text-ink">Stop and settle?</h3>
        <p className="mt-16 font-sans text-body leading-[1.6] text-graphite">
          <span className="font-mono">{confirmStop?.accrued.toFixed(4)} MON</span> goes to{" "}
          {creatorName}, unused{" "}
          <span className="font-mono">
            {confirmStop ? (budget - confirmStop.accrued).toFixed(4) : "0"} MON
          </span>{" "}
          returns to you.
        </p>
        <div className="mt-24 flex gap-12">
          <Button
            variant="ghost"
            className="flex-1"
            disabled={busy}
            onClick={() => setConfirmStop(null)}
          >
            Cancel
          </Button>
          <button
            onClick={stop}
            disabled={busy}
            className="h-11 flex-1 rounded-pill border border-red/60 px-24 font-mono text-label uppercase tracking-[-0.28px] text-red transition-colors duration-150 hover:bg-red/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Settling…" : "Stop & Settle"}
          </button>
        </div>
      </Modal>
    </section>
  );
}
