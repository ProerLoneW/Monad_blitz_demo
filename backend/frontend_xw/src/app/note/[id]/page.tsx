"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { getMyStream, getNote, getNoteValue } from "@/services/api";
import { relativeTime } from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState, Skeleton } from "@/components/ui/States";
import { ValuePanel } from "@/features/value/ValuePanel";
import { TipSheet } from "@/features/value/TipSheet";
import { StreamControl } from "@/features/stream/StreamControl";
import { StreamSheet } from "@/features/stream/StreamSheet";

/**
 * Note Detail（§10.2，P02 Monetized / P03 Stream Active 同一路由变体）：
 * 内容列 760px + 右栏 320px sticky Value Panel；getMyStream 返回进行中的
 * Stream 时面板顶部切换为 StreamControl 控制态。浏览不需要钱包。
 */
function NoteDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const [sheet, setSheet] = useState<"tip" | "stream" | null>(null);
  const asideRef = useRef<HTMLDivElement>(null);

  const noteQuery = useQuery({
    queryKey: ["note", id],
    queryFn: () => getNote(id),
    staleTime: 15_000,
    retry: false,
  });
  const valueQuery = useQuery({
    queryKey: ["value", id],
    queryFn: () => getNoteValue(id),
    staleTime: 15_000,
    retry: false,
  });
  const myStreamQuery = useQuery({
    queryKey: ["stream", id],
    queryFn: () => getMyStream(id),
    staleTime: 15_000,
  });

  const note = noteQuery.data ?? null;
  const value = valueQuery.data ?? null;
  const myStream = myStreamQuery.data ?? null;
  // SETTLED 的结算摘要以链上返回值为准（§12.4），mock 无此数据，仅控制态入面板
  const controlledStream = myStream && myStream.status !== "SETTLED" ? myStream : null;

  // `?panel=value` 深链：滚动到 ValuePanel
  useEffect(() => {
    if (searchParams.get("panel") === "value" && note && asideRef.current) {
      asideRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [searchParams, note]);

  if (noteQuery.isLoading) return <NoteSkeleton />;

  if (!note) {
    return (
      <div className="mx-auto max-w-[1120px] px-24 py-64">
        <EmptyState
          title="Note not found"
          body="This note may have been removed or never existed."
          cta="Back home"
          onCta={() => router.push("/")}
        />
      </div>
    );
  }

  const isOwn = isConnected && address?.toLowerCase() === note.author.walletAddress.toLowerCase();
  const creatorName = note.author.displayName ?? "Creator";
  const creatorLabel = note.author.handle ? `@${note.author.handle}` : creatorName;
  const canTip = !isOwn && !!value?.tip.enabled;
  const canStream = !isOwn && !!value?.stream.enabled;

  const share = () => {
    navigator.clipboard?.writeText(window.location.href);
  };

  const media = note.media[0] ?? null;
  const isVideo = media?.contentType.startsWith("video") ?? false;

  return (
    <div className="mx-auto max-w-[1120px] px-24 py-32">
      <div className="flex flex-col gap-32 lg:flex-row">
        {/* 内容列 760px */}
        <article className="w-full max-w-[760px]">
          {/* Header 行 */}
          <div className="flex items-center justify-between font-mono text-caption text-graphite">
            <button
              onClick={() => router.back()}
              className="transition-colors duration-150 hover:text-ink"
            >
              ← Back
            </button>
            <button onClick={share} className="transition-colors duration-150 hover:text-ink">
              Share
            </button>
          </div>

          {/* Creator Row */}
          <div className="mt-24 flex items-center gap-12">
            <Avatar profile={note.author} size={40} />
            <div className="flex min-w-0 items-baseline gap-8">
              <span className="truncate font-sans text-label font-medium text-ink">
                {note.author.displayName ?? "Anon"}
              </span>
              <span className="truncate font-mono text-caption text-smoke">
                {note.author.handle ? `@${note.author.handle} · ` : ""}
                {relativeTime(note.createdAt)}
              </span>
            </div>
          </div>

          {/* 标题（serif 32px，weight 400 永不加粗） */}
          {note.title ? (
            <h1 className="mt-16 font-serif text-note-title font-normal leading-[1.2] tracking-[-0.64px] text-ink">
              {note.title}
            </h1>
          ) : null}

          {/* 媒体位（无真实媒体源：hairline 占位 + 居中播放钮） */}
          {media ? (
            <div
              className={`mt-24 flex w-full items-center justify-center rounded-media border border-hairline bg-card ${
                isVideo ? "aspect-video" : "aspect-[4/3]"
              }`}
            >
              {media.status === "FAILED" ? (
                <span className="font-mono text-caption text-smoke">Media unavailable</span>
              ) : isVideo ? (
                <span className="flex h-64 w-64 items-center justify-center rounded-full border border-hairline-strong">
                  <svg
                    aria-hidden
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="ml-4 text-ink"
                  >
                    <path d="M6 4.5v11l9-5.5-9-5.5z" />
                  </svg>
                </span>
              ) : (
                <svg
                  aria-hidden
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-smoke"
                >
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <circle cx="9" cy="10" r="2" />
                  <path d="M4 18l5-5 4 4 3-3 4 4" />
                </svg>
              )}
            </div>
          ) : null}

          {/* 正文 */}
          <p className="mt-24 whitespace-pre-wrap font-sans text-body leading-[1.6] text-graphite">
            {note.body}
          </p>

          {/* 互动行（P02：Tip · Stream · Share） */}
          <div className="mt-24 flex items-center gap-16 border-t border-hairline pt-12 font-mono text-caption text-graphite">
            {canTip ? (
              <button
                onClick={() => setSheet("tip")}
                className="transition-colors duration-150 hover:text-ink"
              >
                Tip
              </button>
            ) : null}
            {canStream ? (
              <button
                onClick={() => setSheet("stream")}
                className="transition-colors duration-150 hover:text-ink"
              >
                Stream
              </button>
            ) : null}
            <button onClick={share} className="transition-colors duration-150 hover:text-ink">
              Share
            </button>
          </div>
        </article>

        {/* 右栏 320px sticky Value Panel（Stream Active 时顶部为控制态） */}
        <aside ref={asideRef} className="w-full shrink-0 lg:w-[320px]">
          <div className="lg:sticky lg:top-24">
            <ValuePanel
              note={note}
              value={value}
              isOwn={isOwn}
              onTip={() => setSheet("tip")}
              onStream={() => setSheet("stream")}
              streamSlot={
                controlledStream ? (
                  <StreamControl
                    stream={controlledStream}
                    creatorLabel={creatorLabel}
                    creatorName={creatorName}
                  />
                ) : null
              }
            />
          </div>
        </aside>
      </div>

      <TipSheet note={note} value={value} open={sheet === "tip"} onClose={() => setSheet(null)} />
      <StreamSheet note={note} open={sheet === "stream"} onClose={() => setSheet(null)} />
    </div>
  );
}

/** Loading（§10.2 States）：正文骨架 + Value Panel 骨架。 */
function NoteSkeleton() {
  return (
    <div className="mx-auto max-w-[1120px] px-24 py-32">
      <div className="flex flex-col gap-32 lg:flex-row">
        <div className="w-full max-w-[760px]">
          <Skeleton className="h-16 w-[160px]" />
          <div className="mt-24 flex items-center gap-12">
            <Skeleton className="h-[40px] w-[40px] rounded-full" />
            <Skeleton className="h-16 w-[160px]" />
          </div>
          <Skeleton className="mt-16 h-32 w-3/4" />
          <Skeleton className="mt-24 aspect-video w-full" />
          <Skeleton className="mt-24 h-16 w-full" />
          <Skeleton className="mt-8 h-16 w-2/3" />
        </div>
        <div className="w-full shrink-0 lg:w-[320px]">
          <Skeleton className="h-[320px] w-full" />
        </div>
      </div>
    </div>
  );
}

export default function NotePage() {
  // useSearchParams 需 Suspense 边界（Next 14 预渲染要求）
  return (
    <Suspense fallback={null}>
      <NoteDetail />
    </Suspense>
  );
}
