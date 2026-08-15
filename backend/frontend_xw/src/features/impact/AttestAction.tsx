"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import type { Attestation, AttestationType } from "@proofnote/api-types";
import { prepareAttest } from "@/services/api";
import { useWalletTx } from "@/features/wallet/useWalletTx";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";

const OPTIONS: Array<{ type: AttestationType; label: string; hint: string }> = [
  { type: "PARTICIPATED", label: "I participated", hint: "I took part in this action" },
  { type: "WITNESSED", label: "I witnessed this", hint: "I saw this action happen" },
];

function busyLabel(state: string): string | null {
  if (state === "PREPARING") return "Preparing…";
  if (state === "WAITING_WALLET") return "Confirm in wallet…";
  if (state === "SUBMITTED") return "Submitted…";
  return null;
}

/**
 * AttestAction（§10.4 CTA）：全宽描边按钮 "I participated / witnessed this"。
 * 未连接 → Connect wallet；已背书 → `Attested ✓` 禁用态 + 类型副文案；
 * 点击打开类型二选一 Sheet（statement 预览 + 确认），确认走唯一写路径
 * useWalletTx({ kind: "attest" }) + prepareAttest。
 */
export function AttestAction({
  impactId,
  noteId,
  claimText,
  attestations,
}: {
  impactId: string;
  noteId: string;
  claimText: string;
  attestations: Attestation[];
}) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AttestationType>("PARTICIPATED");

  const tx = useWalletTx({
    kind: "attest",
    entityId: impactId,
    invalidateKeys: [["impact", noteId]],
  });

  const mine = address
    ? attestations.find(
        (a) => a.attester.address.toLowerCase() === address.toLowerCase(),
      )
    : undefined;

  useEffect(() => {
    if (tx.state === "CONFIRMED") setOpen(false);
  }, [tx.state]);

  if (!isConnected) {
    return (
      <Button
        variant="ghost"
        className="w-full"
        disabled={connecting}
        onClick={() => connect({ connector: connectors[0] })}
      >
        {connecting ? "Connecting…" : "Connect wallet"}
      </Button>
    );
  }

  if (mine) {
    return (
      <div>
        <Button variant="ghost" className="w-full" disabled>
          Attested ✓
        </Button>
        <p className="mt-8 text-center font-mono text-caption text-smoke">
          You {mine.type === "PARTICIPATED" ? "participated" : "witnessed this"}
        </p>
      </div>
    );
  }

  const busy = busyLabel(tx.state);

  return (
    <>
      <Button variant="ghost" className="w-full" onClick={() => setOpen(true)}>
        I participated / witnessed this
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} width={480}>
        <h2 className="font-serif text-title tracking-[-0.48px] text-ink">Attest this action</h2>

        <div className="mt-24 flex flex-col gap-12">
          {OPTIONS.map((opt) => (
            <button
              key={opt.type}
              type="button"
              aria-pressed={type === opt.type}
              onClick={() => setType(opt.type)}
              className={cn(
                "rounded-card border bg-card p-16 text-left transition-colors duration-150",
                type === opt.type
                  ? "border-ink"
                  : "border-hairline hover:border-hairline-strong",
              )}
            >
              <span className="font-sans text-label font-medium text-ink">{opt.label}</span>
              <span className="mt-4 block font-sans text-caption text-smoke">{opt.hint}</span>
            </button>
          ))}
        </div>

        <div className="mt-24">
          <p className="font-mono text-caption uppercase text-smoke">Statement</p>
          <p className="mt-8 rounded-input border border-hairline bg-paper p-16 font-sans text-caption leading-[1.6] text-graphite">
            {claimText}
          </p>
        </div>

        <Button
          className="mt-24 w-full"
          disabled={busy !== null}
          onClick={() => {
            tx.run(() => prepareAttest(impactId, type)).catch(() => undefined);
          }}
        >
          {busy ?? "Confirm"}
        </Button>

        {tx.state === "FAILED" && tx.error ? (
          <p className="mt-12 font-mono text-caption text-red">{tx.error}</p>
        ) : null}

        <p className="mt-16 font-mono text-caption leading-[1.6] text-smoke">
          One attestation per wallet per type. Recorded on Monad.
        </p>
      </Modal>
    </>
  );
}
