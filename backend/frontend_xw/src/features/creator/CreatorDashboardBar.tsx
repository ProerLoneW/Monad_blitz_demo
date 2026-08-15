"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getClaimable, getIncomingStreams, prepareStreamWithdraw } from "@/services/api";
import { monFromWei, monOf } from "@/lib/format";
import { useWalletTx } from "@/features/wallet/useWalletTx";
import { useTickingAmount, type StreamSnapshot } from "@/features/stream/useTickingAmount";
import { Button } from "@/components/ui/Button";
import { PulseDot } from "@/components/ui/PulseDot";
import { Skeleton } from "@/components/ui/States";

/**
 * CreatorDashboardBar（§10.6 / §15.2 / DESIGN.md Dashboard Strip）：
 * 仅本人视角渲染（隐私边界 §15.3 —— 访客绝不渲染此条）。
 * 全宽细条，mono：`INCOMING 0.007 MON/S · 7 ACTIVE STREAMS · CLAIMABLE … MON`
 * + 右侧 Withdraw。Iris PulseDot 在速率前；有活跃 stream 时 Claimable 按
 * 聚合速率 6 位小数走字（§11.1 “Stream 走字” 精度规则，表达 value is flowing）。
 * Incoming Rate 为 0 / 无活跃 stream：不显示走字区，仅 Claimable（§10.6 States）。
 */
export function CreatorDashboardBar({ address }: { address: string }) {
  const incomingQuery = useQuery({
    queryKey: ["incoming", address],
    queryFn: () => getIncomingStreams(address),
  });
  const claimableQuery = useQuery({
    queryKey: ["claimable", address],
    queryFn: () => getClaimable(address),
  });
  const tx = useWalletTx({
    kind: "stream_withdraw",
    entityId: address,
    invalidateKeys: [
      ["incoming", address],
      ["claimable", address],
    ],
  });

  const incoming = incomingQuery.data;
  const rateWei = incoming?.aggregateIncomingRateWeiPerSecond ?? "0";
  const streaming = (incoming?.activeStreamCount ?? 0) > 0 && rateWei !== "0";

  // 走字快照：以 claimable 查询返回时刻为基准，按聚合速率本地插值（§24.3）。
  const snapshot = useMemo<StreamSnapshot | null>(() => {
    if (!claimableQuery.data) return null;
    return {
      accruedWei: claimableQuery.data.amountWei,
      snapshotAt: new Date(claimableQuery.dataUpdatedAt).toISOString(),
      rateWeiPerSecond: rateWei,
      active: streaming,
    };
  }, [claimableQuery.data, claimableQuery.dataUpdatedAt, rateWei, streaming]);
  const tickingClaimable = useTickingAmount(snapshot, 6);

  if (incomingQuery.isPending || claimableQuery.isPending) {
    return <Skeleton className="h-11 w-full rounded-card" />;
  }
  // Dashboard 是本人视角的增强条：读取失败不阻塞 Profile 主体（交易错误经 toast 反馈）。
  if (incomingQuery.isError || claimableQuery.isError || !incoming || !claimableQuery.data) {
    return null;
  }

  const claimable = claimableQuery.data;
  const claimableIsZero = claimable.amountWei === "0";
  const busy =
    tx.state === "PREPARING" || tx.state === "WAITING_WALLET" || tx.state === "SUBMITTED";
  const buttonLabel =
    tx.state === "PREPARING"
      ? "Preparing…"
      : tx.state === "WAITING_WALLET"
        ? "Confirm in wallet…"
        : tx.state === "SUBMITTED"
          ? "Withdrawing…"
          : tx.state === "CONFIRMED"
            ? "Withdrawn ✓"
            : "Withdraw";

  return (
    <div className="flex items-center gap-8 rounded-card border border-hairline bg-card px-20 py-12 font-mono text-caption uppercase tracking-[-0.28px] text-ink">
      {streaming ? (
        <>
          <PulseDot size={8} />
          <span className="text-graphite">Incoming</span>
          <span>{monFromWei(rateWei)} MON/s</span>
          <span aria-hidden className="text-smoke">
            ·
          </span>
          <span>
            {incoming.activeStreamCount}{" "}
            {incoming.activeStreamCount === 1 ? "active stream" : "active streams"}
          </span>
          <span aria-hidden className="text-smoke">
            ·
          </span>
        </>
      ) : null}
      <span className="text-graphite">Claimable</span>
      <span>{streaming ? tickingClaimable : monOf(claimable)} MON</span>
      <Button
        size="sm"
        className="ml-auto"
        disabled={claimableIsZero || busy}
        onClick={() => {
          tx.run(prepareStreamWithdraw).catch(() => {});
        }}
      >
        {buttonLabel}
      </Button>
    </div>
  );
}
