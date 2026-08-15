"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { parseEther } from "viem";
import type { NoteOwnership, NoteValuePanel } from "@proofnote/api-types";
import { prepareTip } from "@/services/api";
import { useWalletTx } from "@/features/wallet/useWalletTx";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { Modal } from "@/components/ui/Modal";
import { monOf, relativeTime, truncateAddress } from "@/lib/format";
import { cn } from "@/lib/cn";

const PRESETS = ["1", "5", "10"];

function busyLabel(state: string): string | null {
  if (state === "PREPARING") return "Preparing…";
  if (state === "WAITING_WALLET") return "Confirm in wallet…";
  if (state === "SUBMITTED") return "Submitted…";
  return null;
}

/**
 * ValuePanel readonly 简化版（P04 右栏）：Total Support + supporters +
 * [Tip] 主按钮（固定金额 preset 流程，走唯一写路径 useWalletTx + prepareTip）
 * + Ownership 行（地址截断 · Anchored 相对时间 · Verify on Monad ↗）。
 */
export function ValuePanel({
  noteId,
  value,
  supporterCount,
  ownership,
  anchoredAt,
}: {
  noteId: string;
  value: NoteValuePanel;
  supporterCount: number;
  ownership: NoteOwnership;
  anchoredAt: string;
}) {
  const { isConnected } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(PRESETS[0]);

  const tx = useWalletTx({
    kind: "tip",
    entityId: noteId,
    invalidateKeys: [["note-value", noteId], ["impact", noteId]],
  });

  useEffect(() => {
    if (tx.state === "CONFIRMED") setOpen(false);
  }, [tx.state]);

  const busy = busyLabel(tx.state);

  return (
    <Card>
      <p className="font-mono text-title font-medium leading-[1.2] text-ink" data-tnum>
        {monOf(value.totalSupport)} {value.totalSupport.symbol}
        <span className="font-sans text-label font-normal text-graphite"> supported</span>
      </p>
      <p className="mt-4 font-mono text-caption text-smoke" data-tnum>
        {supporterCount} supporters
      </p>

      {value.tip.enabled ? (
        <Button className="mt-16 w-full" onClick={() => setOpen(true)}>
          Tip
        </Button>
      ) : null}

      <div className="mt-16 border-t border-hairline pt-16">
        <p className="font-mono text-caption uppercase text-smoke">Ownership</p>
        <p className="mt-8 font-mono text-caption leading-[1.6] text-graphite">
          {truncateAddress(ownership.ownerAddress)} · Anchored {relativeTime(anchoredAt)} ago
        </p>
        <div className="mt-8">
          <ExplorerLink
            explorerUrl={ownership.explorerUrl}
            path={ownership.explorerUrl ? undefined : `/address/${ownership.ownerAddress}`}
          />
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} width={480}>
        <h2 className="font-serif text-title tracking-[-0.48px] text-ink">Tip this note</h2>

        {isConnected ? (
          <>
            <div className="mt-24 flex gap-8">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={amount === preset}
                  onClick={() => setAmount(preset)}
                  className={cn(
                    "h-11 flex-1 rounded-pill border font-mono text-label transition-colors duration-150",
                    amount === preset
                      ? "border-ink text-ink"
                      : "border-hairline text-graphite hover:border-hairline-strong",
                  )}
                  data-tnum
                >
                  {preset} MON
                </button>
              ))}
            </div>

            <Button
              className="mt-24 w-full"
              disabled={busy !== null}
              onClick={() => {
                tx.run(() => prepareTip(noteId, parseEther(amount).toString())).catch(
                  () => undefined,
                );
              }}
            >
              {busy ?? `Tip ${amount} MON`}
            </Button>

            {tx.state === "FAILED" && tx.error ? (
              <p className="mt-12 font-mono text-caption text-red">{tx.error}</p>
            ) : null}
          </>
        ) : (
          <>
            <p className="mt-16 font-sans text-body leading-[1.6] text-graphite">
              Connect your wallet to support the creator.
            </p>
            <Button
              className="mt-24 w-full"
              disabled={connecting}
              onClick={() => connect({ connector: connectors[0] })}
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </Button>
          </>
        )}
      </Modal>
    </Card>
  );
}
