"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getFeed, type FeedTab } from "@/services/api";
import { NoteCard } from "@/features/notes/NoteCard";
import { EmptyState, ErrorCard } from "@/components/ui/States";
import { useUiStore } from "@/stores/ui";
import { FeedTabs } from "./FeedTabs";
import { FeedSkeleton } from "./FeedSkeleton";
import { LiveActivityRail } from "./LiveActivityRail";

function parseTab(param: string | null): FeedTab {
  return param === "impact" || param === "monad" ? param : "for-you";
}

/**
 * HomeFeed（§10.1）：640px 内容列居中 + ≥1280px 右侧 300px 活动栏。
 * Tab 状态入 URL（?tab=for-you|impact|monad，router.replace 不滚动）；
 * 卡片混排顺序完全来自 getFeed 返回，四种形态共用 NoteCard。
 */
export function HomeFeed() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openCreateNote = useUiStore((s) => s.openCreateNote);

  const tab = parseTab(searchParams.get("tab"));
  const setTab = (next: FeedTab) => {
    if (next === tab) return;
    router.replace(`${pathname}?tab=${next}`, { scroll: false });
  };

  const query = useQuery({
    queryKey: ["feed", tab],
    queryFn: () => getFeed(tab),
    staleTime: 30_000,
  });

  return (
    <div className="flex justify-center gap-32 px-12 lg:px-0">
      <div className="w-full max-w-[640px]">
        <FeedTabs value={tab} onChange={setTab} />

        <div className="pb-64 pt-16">
          {query.isPending ? (
            <FeedSkeleton />
          ) : query.isError ? (
            <ErrorCard message="Feed unavailable" onRetry={() => query.refetch()} />
          ) : query.data.length === 0 ? (
            tab === "impact" ? (
              <EmptyState
                title="No impact notes yet."
                body="Impact notes record real-world actions with evidence."
              />
            ) : tab === "monad" ? (
              <EmptyState title="No Monad notes yet." />
            ) : (
              <EmptyState
                title="No notes yet — be the first to create."
                cta="Create Note"
                onCta={openCreateNote}
              />
            )
          ) : (
            <div className="flex flex-col gap-12">
              {query.data.map((item) => (
                <NoteCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>

      <LiveActivityRail />
    </div>
  );
}
