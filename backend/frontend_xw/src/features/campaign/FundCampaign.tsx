"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { prepareCampaignFund } from "@/services/api";
import { useWalletTx } from "@/features/wallet/useWalletTx";
import { ConnectPrimaryButton } from "@/features/wallet/WalletArea";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { truncateAddress } from "@/lib/format";

/**
 * Fund this campaign（§10.5 CTA）：未连接 = Connect wallet；
 * 点击弹金额 Modal → prepareCampaignFund → useWalletTx 管线
 * （kind: campaign_fund，确认后失效 ['transparency', id] 与 ['campaign', id]）。
 */
export function FundCampaign({
  campaignId,
  treasuryAddress,
}: {
  campaignId: string;
  treasuryAddress: string | null;
}) {
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const tx = useWalletTx({
    kind: "campaign_fund",
    entityId: campaignId,
    invalidateKeys: [
      ["transparency", campaignId],
      ["campaign", campaignId],
    ],
  });

  if (!isConnected) return <ConnectPrimaryButton label="Connect wallet" />;

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!treasuryAddress}>
        Fund this campaign
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} width={440}>
        <FundForm
          campaignId={campaignId}
          treasuryAddress={treasuryAddress}
          tx={tx}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

/** MON 十进制字符串 → wei 字符串（无浮点）；非法或 ≤ 0 返回 null。 */
function monToWei(input: string): string | null {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(input.trim());
  if (!m) return null;
  const wei = BigInt(m[1] + (m[2] ?? "").padEnd(18, "0"));
  return wei > 0n ? wei.toString() : null;
}

function FundForm({
  campaignId,
  treasuryAddress,
  tx,
  onClose,
}: {
  campaignId: string;
  treasuryAddress: string | null;
  tx: ReturnType<typeof useWalletTx>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const wei = monToWei(amount);
  const busy =
    tx.state === "PREPARING" || tx.state === "WAITING_WALLET" || tx.state === "SUBMITTED";

  // 确认后短暂展示 ✓ 再关闭并重置
  useEffect(() => {
    if (tx.state !== "CONFIRMED") return;
    const t = setTimeout(() => {
      onClose();
      setAmount("");
      tx.reset();
    }, 800);
    return () => clearTimeout(t);
  }, [tx.state, onClose, tx]);

  const submit = async () => {
    if (!wei) return;
    setHint(null);
    try {
      await tx.run(() => prepareCampaignFund(campaignId, wei));
    } catch (err) {
      // fund/prepare 在 treasury 回填窗口返回 409 → 转为提示而非错误（§10.5 States）
      const msg = err instanceof Error ? err.message : "";
      if (/treasury|initializ|409/i.test(msg)) {
        setHint("Treasury initializing… try again in a few seconds.");
      }
    }
  };

  const confirmLabel =
    tx.state === "PREPARING"
      ? "Preparing…"
      : tx.state === "WAITING_WALLET"
        ? "Confirm in wallet…"
        : tx.state === "SUBMITTED"
          ? "Submitted…"
          : tx.state === "CONFIRMED"
            ? "Funded ✓"
            : "Confirm fund";

  return (
    <div>
      <h2 className="font-serif text-title tracking-[-0.48px] text-ink">Fund this campaign</h2>
      <p className="mt-8 font-sans text-label leading-[1.6] text-graphite">
        Funds go straight to the on-chain treasury
        {treasuryAddress ? (
          <>
            {" "}
            <span className="font-mono text-caption">{truncateAddress(treasuryAddress)}</span>
          </>
        ) : null}
        . Every movement stays publicly verifiable.
      </p>

      <label
        htmlFor="fund-amount"
        className="mt-24 block font-mono text-caption uppercase text-smoke"
      >
        Amount (MON)
      </label>
      <input
        id="fund-amount"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="mt-8 h-11 w-full rounded-input border border-hairline bg-card px-16 font-mono text-data text-ink outline-none transition-colors duration-150 placeholder:text-smoke focus:border-hairline-strong"
      />
      {amount !== "" && wei === null ? (
        <p className="mt-8 font-mono text-caption text-smoke">
          Enter a valid amount (up to 18 decimals).
        </p>
      ) : null}
      {hint ? <p className="mt-8 font-mono text-caption text-smoke">{hint}</p> : null}
      {tx.state === "FAILED" && tx.error ? (
        <p className="mt-8 font-mono text-caption text-red">{tx.error}</p>
      ) : null}

      <div className="mt-24 flex justify-end gap-12">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!wei || busy || tx.state === "CONFIRMED"}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
