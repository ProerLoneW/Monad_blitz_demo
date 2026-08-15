"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getImpactByNoteId, getNoteValue } from "@/services/api";
import { relativeTime } from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { ImpactClaimBlock } from "@/features/impact/ImpactClaimBlock";
import { VerificationState } from "@/features/impact/VerificationState";
import { EvidencePreview } from "@/features/impact/EvidencePreview";
import { AttestationList } from "@/features/impact/AttestationList";
import { AttestAction } from "@/features/impact/AttestAction";
import { ValuePanel } from "@/features/impact/ValuePanel";

/**
 * P04 Impact Note Detail（§10.4 / PROTOTYPE_PROMPTS P04）：先是一篇可读的
 * 社区内容，其次才是可核验的行动记录 —— Impact Layer 在正文后按层展开。
 * 桌面：内容列 760 + 右栏 ValuePanel 320（sticky）；移动：单栏顺序流。
 */
export default function ImpactPage() {
  const params = useParams();
  const router = useRouter();
  const noteId = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";

  const impactQuery = useQuery({
    queryKey: ["impact", noteId],
    queryFn: () => getImpactByNoteId(noteId),
    enabled: Boolean(noteId),
  });
  const valueQuery = useQuery({
    queryKey: ["note-value", noteId],
    queryFn: () => getNoteValue(noteId),
    enabled: Boolean(noteId),
  });

  if (impactQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-[var(--layout-content-max)] flex-col gap-32 px-16 py-24 lg:flex-row lg:justify-center">
        <div className="w-full lg:max-w-[var(--layout-detail-content)]">
          <Skeleton className="h-[20px] w-[160px]" />
          <Skeleton className="mt-24 h-[40px] w-[40px] rounded-full" />
          <Skeleton className="mt-20 h-[32px] w-2/3" />
          <Skeleton className="mt-20 aspect-[4/3] w-full" />
          <Skeleton className="mt-20 h-[80px] w-full" />
          <Skeleton className="mt-32 h-[96px] w-full" />
        </div>
        <div className="w-full shrink-0 lg:w-[var(--layout-detail-aside)]">
          <Skeleton className="h-[220px] w-full" />
        </div>
      </div>
    );
  }

  if (impactQuery.isError || !impactQuery.data) {
    return (
      <div className="mx-auto w-full max-w-[var(--layout-detail-content)] px-16 py-64">
        <ErrorCard
          message={
            impactQuery.error instanceof Error ? impactQuery.error.message : undefined
          }
          onRetry={() => impactQuery.refetch()}
        />
      </div>
    );
  }

  const { note, extras, evidence, attestations } = impactQuery.data;
  const value = valueQuery.data;
  const cover = note.media[0];
  const publishedAt = note.publishedAt ?? note.createdAt;

  return (
    <div className="mx-auto flex w-full max-w-[var(--layout-content-max)] flex-col gap-32 px-16 py-24 lg:flex-row lg:justify-center">
      {/* 内容列 760 */}
      <article className="w-full lg:max-w-[var(--layout-detail-content)]">
        {/* Header：← Back + Share */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.back()}
            className="font-mono text-caption text-graphite transition-colors duration-150 hover:text-ink"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(window.location.href)}
            className="font-mono text-caption text-graphite transition-colors duration-150 hover:text-ink"
          >
            Share
          </button>
        </div>

        {/* Creator Row + 页面唯一 Badge */}
        <div className="mt-24 flex items-center gap-12">
          <Avatar profile={note.author} size={40} />
          <div className="flex min-w-0 flex-1 items-baseline gap-8">
            <span className="truncate font-sans text-label font-medium text-ink">
              {note.author.displayName ?? "Anon"}
            </span>
            <span className="truncate font-mono text-caption text-smoke">
              @{note.author.handle} · {relativeTime(publishedAt)}
            </span>
          </div>
          <Badge variant="impact">Impact</Badge>
        </div>

        {/* 标题 / 媒体 / 正文 —— 第一视觉层，与普通 Note 一致 */}
        {note.title ? (
          <h1 className="mt-20 font-serif text-note-title leading-[1.2] tracking-[-0.64px] text-ink">
            {note.title}
          </h1>
        ) : null}

        {cover ? (
          <div
            aria-hidden
            className="mt-20 flex aspect-[4/3] w-full items-center justify-center rounded-media border border-hairline bg-paper"
          >
            <span className="font-mono text-caption text-smoke">
              Photo{cover.width && cover.height ? ` · ${cover.width} × ${cover.height}` : ""}
            </span>
          </div>
        ) : null}

        <p className="mt-20 font-sans text-body leading-[1.6] text-graphite">{note.body}</p>

        {/* Impact Layer —— 第二/第三视觉层，渐进披露 */}
        <div className="mt-32">
          <ImpactClaimBlock
            claim={extras.claim}
            claimText={extras.claimText}
            claimHash={note.impact?.claimHash ?? "0x0"}
          />
        </div>

        {note.impact ? (
          <section className="mt-32 border-t border-hairline pt-24">
            <h2 className="font-mono text-caption uppercase text-smoke">Verification</h2>
            <div className="mt-12">
              <VerificationState verification={note.impact.verification} />
            </div>
          </section>
        ) : null}

        <section className="mt-24 border-t border-hairline pt-24">
          <h2 className="font-mono text-caption uppercase text-smoke">Evidence</h2>
          <div className="mt-12">
            <EvidencePreview evidence={evidence} />
          </div>
        </section>

        <section className="mt-24 border-t border-hairline pt-24">
          <h2 className="font-mono text-caption uppercase text-smoke">Attestations</h2>
          <div className="mt-12">
            <AttestationList
              attestations={attestations}
              authorAddress={note.author.walletAddress}
            />
          </div>
        </section>

        <div className="mt-24">
          <AttestAction
            impactId={note.impact?.id ?? noteId}
            noteId={noteId}
            claimText={extras.claimText}
            attestations={attestations}
          />
        </div>
      </article>

      {/* 右栏 320 —— ValuePanel readonly（§10.4：Value 在上） */}
      {value ? (
        <aside className="w-full shrink-0 lg:w-[var(--layout-detail-aside)]">
          <div className="lg:sticky lg:top-24">
            <ValuePanel
              noteId={noteId}
              value={value}
              supporterCount={note.value?.supporterCount ?? 0}
              ownership={note.ownership}
              anchoredAt={publishedAt}
            />
          </div>
        </aside>
      ) : null}
    </div>
  );
}
