"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useBalance } from "wagmi";
import type { Note, NoteValuePanel } from "@/types";
import { prepareTip } from "@/services/api";
import { monFromWei } from "@/lib/format";
import { useWalletTx } from "@/features/wallet/useWalletTx";
import { ConnectPrimaryButton } from "@/features/wallet/WalletArea";
import { Button } from "@/components/ui/Button";
import { Sheet } from "./Sheet";
import { monToWei } from "./amount";

const CHIPS = ["1", "5", "10"];

/**
 * Tip Sheet（§11.3 / §10.8 B 三段式）：预设 chips + Custom 输入 →
 * Quote（Creator receives / Protocol fee 由 API distribution bps 推导，不硬编码费率）→
 * useWalletTx 确认。CONFIRMED 后停留 800ms 自动收起。
 */
export function TipSheet({
  note,
  value,
  open,
  onClose,
}: {
  note: Note;
  value: NoteValuePanel | null;
  open: boolean;
  onClose: () => void;
}) {
  const { address, isConnected } = useAccount();
  const {
    state: txState,
    error: txError,
    run,
    reset,
  } = useWalletTx({
    kind: "tip",
    entityId: note.id,
    invalidateKeys: [
      ["note", note.id],
      ["value", note.id],
    ],
  });

  const [chip, setChip] = useState<string>("5");
  const [custom, setCustom] = useState("");

  const amount = custom.trim() !== "" ? custom.trim() : chip;
  const grossWei = amount ? monToWei(amount) : null;
  const valid = grossWei !== null && BigInt(grossWei) > 0n;

  const creatorBps = value?.distribution.find((d) => d.role === "CREATOR")?.bps ?? null;
  const quote = useMemo(() => {
    if (!valid || grossWei === null || creatorBps === null) return null;
    const gross = BigInt(grossWei);
    const creator = (gross * BigInt(creatorBps)) / 10000n;
    return { creator: monFromWei(creator.toString()), fee: monFromWei((gross - creator).toString()) };
  }, [valid, grossWei, creatorBps]);

  const { data: balance } = useBalance({ address, query: { enabled: isConnected && open } });
  const insufficient = valid && grossWei !== null && !!balance && BigInt(grossWei) > balance.value;

  const busy = txState === "PREPARING" || txState === "WAITING_WALLET" || txState === "SUBMITTED";

  // 成功后停留 800ms 让用户看到 Confirmed ✓，再收起（§11.3）
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
    if (!valid || grossWei === null) return;
    try {
      await run(() => prepareTip(note.id, grossWei));
    } catch {
      /* FAILED 态在确认段内展示，Toast 已通知 */
    }
  };

  const creatorLabel = note.author.handle
    ? `@${note.author.handle}`
    : note.author.displayName ?? "creator";

  const ctaLabel =
    txState === "PREPARING"
      ? "Preparing…"
      : txState === "WAITING_WALLET"
        ? "Confirm in wallet…"
        : txState === "SUBMITTED"
          ? "Submitted…"
          : txState === "CONFIRMED"
            ? "Confirmed ✓"
            : `Confirm Tip — ${amount} MON`;

  return (
    <Sheet open={open} onClose={close} title={`Tip ${creatorLabel}`}>
      {/* ① 参数段 */}
      <div className="flex gap-8">
        {CHIPS.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={chip === c && custom === "" ? "primary" : "ghost"}
            onClick={() => {
              setChip(c);
              setCustom("");
            }}
          >
            {c} MON
          </Button>
        ))}
      </div>
      <div>
        <div className="font-mono text-caption text-smoke">Custom</div>
        <div className="relative mt-8">
          <input
            value={custom}
            onChange={(e) => {
              if (/^\d*\.?\d*$/.test(e.target.value)) setCustom(e.target.value);
            }}
            placeholder="0.5"
            inputMode="decimal"
            className="h-11 w-full rounded-input border border-hairline bg-card px-12 pr-64 font-mono text-label text-ink outline-none transition-colors duration-150 placeholder:text-smoke focus:border-hairline-strong"
          />
          <span className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 font-mono text-caption text-smoke">
            MON
          </span>
        </div>
      </div>

      {/* ② Quote 段 */}
      {valid && quote ? (
        <div className="flex flex-col gap-8 border-t border-hairline pt-16">
          <div className="flex items-baseline justify-between font-mono text-caption">
            <span className="text-smoke">Support amount</span>
            <span className="text-ink">{amount} MON</span>
          </div>
          <div className="flex items-baseline justify-between font-mono text-caption">
            <span className="text-smoke">{note.author.displayName ?? "Creator"} receives</span>
            <span className="text-ink">{quote.creator} MON</span>
          </div>
          <div className="flex items-baseline justify-between font-mono text-caption">
            <span className="text-smoke">Protocol fee</span>
            <span className="text-ink">{quote.fee} MON</span>
          </div>
        </div>
      ) : null}

      {/* ③ 确认段 */}
      <div className="mt-auto flex flex-col gap-8 border-t border-hairline pt-16">
        {insufficient ? (
          <p className="font-mono text-caption text-red">Insufficient balance</p>
        ) : null}
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
          <Button className="w-full" disabled={!valid || busy || insufficient} onClick={confirm}>
            {ctaLabel}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
