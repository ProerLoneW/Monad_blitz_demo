"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Campaign, CampaignTransparency } from "@proofnote/api-types";
import { getCampaign, getCampaignNote, getCampaignTransparency } from "@/services/api";
import { Badge } from "@/components/ui/Badge";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { TransparencySummary } from "./TransparencySummary";
import { MoneyFlow } from "./MoneyFlow";
import { Ledger } from "./Ledger";
import { FundCampaign } from "./FundCampaign";

/**
 * Campaign Transparency（§10.5 / §14，P05）——单主列 760px 居中，无右栏。
 * 5 秒测试：Raised / Spent / Remaining 三数条为页面绝对焦点；
 * 守恒断言失败（raised ≠ spent + remaining）时降级为列表 + `Data syncing…`，
 * 不渲染摘要条与 Money Flow（§14.1）。
 */
export function CampaignTransparencyPage({ campaignId }: { campaignId: string }) {
  const campaignQ = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => getCampaign(campaignId),
    // Treasury 回填窗口（§10.5 States）：treasuryAddress 为 null 时 2s 轮询直至就绪
    refetchInterval: (q) => (q.state.data?.treasuryAddress ? false : 2000),
  });
  const transparencyQ = useQuery({
    queryKey: ["transparency", campaignId],
    queryFn: () => getCampaignTransparency(campaignId),
  });
  const noteQ = useQuery({
    queryKey: ["campaign-note", campaignId],
    queryFn: () => getCampaignNote(campaignId),
  });

  const campaign = campaignQ.data;
  const transparency = transparencyQ.data;
  const treasuryAddress =
    campaign?.treasuryAddress ?? transparency?.campaign.treasuryAddress ?? null;
  const backHref = campaign ? `/note/${campaign.noteId}` : "/";

  return (
    <div className="mx-auto w-full max-w-[760px] px-24 py-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-16">
        <Link
          href={backHref}
          className="font-mono text-label text-graphite no-underline transition-colors duration-150 hover:text-ink"
        >
          ← Back
        </Link>
        <span className="font-mono text-caption uppercase text-smoke">Transparency</span>
        <ExplorerLink
          path={treasuryAddress ? `/address/${treasuryAddress}` : undefined}
        />
      </div>

      {campaignQ.isLoading || transparencyQ.isLoading ? (
        <PageSkeleton />
      ) : campaignQ.isError || transparencyQ.isError || !campaign || !transparency ? (
        <div className="mt-32">
          <ErrorCard
            message={
              (campaignQ.error ?? transparencyQ.error) instanceof Error
                ? ((campaignQ.error ?? transparencyQ.error) as Error).message
                : undefined
            }
            onRetry={() => {
              void campaignQ.refetch();
              void transparencyQ.refetch();
            }}
          />
        </div>
      ) : (
        <PageBody
          campaignId={campaignId}
          noteTitle={noteQ.data?.title ?? null}
          campaign={campaign}
          transparency={transparency}
          treasuryAddress={treasuryAddress}
        />
      )}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mt-24 flex flex-col gap-32" aria-busy="true">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-[136px] w-full rounded-card" />
      <Skeleton className="h-[212px] w-full rounded-card" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

function PageBody({
  campaignId,
  noteTitle,
  campaign,
  transparency,
  treasuryAddress,
}: {
  campaignId: string;
  noteTitle: string | null;
  campaign: Campaign;
  transparency: CampaignTransparency & { supporterCount: number };
  treasuryAddress: string | null;
}) {
  const { summary } = transparency;

  // 守恒断言（§14.1）：raised = spent + remaining；失败 → 降级列表 + Data syncing…
  let conserved = false;
  try {
    conserved = BigInt(summary.raisedWei) === BigInt(summary.spentWei) + BigInt(summary.remainingWei);
  } catch {
    conserved = false;
  }

  return (
    <>
      {/* 关联 Note + Goal */}
      {noteTitle ? (
        <Link
          href={`/note/${campaign.noteId}`}
          className="mt-24 block font-serif text-title leading-[1.2] tracking-[-0.48px] text-ink no-underline hover:underline"
        >
          {noteTitle}
        </Link>
      ) : null}
      <p className={noteTitle ? "mt-8 font-sans text-label text-graphite" : "mt-24 font-sans text-label text-graphite"}>
        Goal: {campaign.goal}
      </p>

      {!treasuryAddress ? (
        <div className="mt-16 rounded-input border border-hairline bg-card px-16 py-12 font-mono text-caption text-smoke">
          Treasury initializing… the on-chain address is being indexed.
        </div>
      ) : null}

      {/* 第一视觉层：三数摘要条 + 目标进度 */}
      <div className="mt-24">
        {conserved ? (
          <TransparencySummary
            raisedWei={summary.raisedWei}
            spentWei={summary.spentWei}
            remainingWei={summary.remainingWei}
            targetWei={campaign.targetWei}
          />
        ) : (
          <div className="rounded-card border border-hairline bg-card px-24 py-16 font-mono text-caption text-smoke">
            Data syncing…
          </div>
        )}
      </div>

      {/* 第二视觉层：Money Flow */}
      {conserved ? (
        <div className="mt-32">
          <MoneyFlow
            supporterCount={transparency.supporterCount}
            raisedWei={summary.raisedWei}
            treasuryAddress={treasuryAddress}
            expenses={transparency.expenses}
            remainingWei={summary.remainingWei}
          />
        </div>
      ) : null}

      {/* 第三视觉层：双列账本 */}
      <div className="mt-32">
        <Ledger
          expenses={transparency.expenses}
          funding={transparency.funding}
          supporterCount={transparency.supporterCount}
        />
      </div>

      {/* Verification 行 + 主 CTA */}
      <div className="mt-32 flex items-center justify-between gap-16 border-t border-hairline pt-24">
        <p className="font-mono text-caption text-smoke">
          <span className="text-leaf">{transparency.verification.level}</span>
          {` · Evidence ${transparency.verification.evidenceCount} · Attestations ${transparency.verification.attestationCount}`}
        </p>
        {campaign.status === "OPEN" ? (
          <FundCampaign campaignId={campaignId} treasuryAddress={treasuryAddress} />
        ) : campaign.status === "CLOSED" ? (
          <Badge variant="neutral">Funding closed</Badge>
        ) : (
          <Badge variant="impact">Completed</Badge>
        )}
      </div>
    </>
  );
}
