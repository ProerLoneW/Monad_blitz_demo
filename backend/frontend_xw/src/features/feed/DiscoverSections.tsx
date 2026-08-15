"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getFeed, type FeedTab } from "@/services/api";
import { NoteCard } from "@/features/notes/NoteCard";
import { ErrorCard } from "@/components/ui/States";
import { FeedSkeleton } from "./FeedSkeleton";

/**
 * Discover（§10.7 MVP 弱实现）：三个分区各自复用 GET /feed 不同 tab
 * 的数据渲染 NoteCard 列表；mono 小标题 + hairline，"See all →" 跳
 * Home 对应 Tab；分区级 Loading/Error/Empty 独立降级，不拖垮整页。
 */
const SECTIONS: { title: string; tab: FeedTab; empty: string }[] = [
  { title: "Impact Now", tab: "impact", empty: "No impact notes yet." },
  { title: "On Monad", tab: "monad", empty: "No Monad notes yet." },
  { title: "Newest", tab: "for-you", empty: "No notes yet." },
];

function DiscoverSection({ title, tab, empty }: (typeof SECTIONS)[number]) {
  const query = useQuery({
    queryKey: ["feed", tab],
    queryFn: () => getFeed(tab),
    staleTime: 30_000,
  });

  return (
    <section>
      <div className="flex items-baseline justify-between gap-16 border-b border-hairline pb-8">
        <h2 className="font-mono text-caption uppercase text-smoke">{title}</h2>
        <Link
          href={`/?tab=${tab}`}
          className="font-mono text-caption text-iris transition-colors duration-150 hover:text-iris-strong"
        >
          See all →
        </Link>
      </div>

      <div className="mt-16">
        {query.isPending ? (
          <FeedSkeleton count={2} />
        ) : query.isError ? (
          <ErrorCard message={`${title} unavailable`} onRetry={() => query.refetch()} />
        ) : query.data.length === 0 ? (
          <p className="rounded-card border border-hairline bg-card px-24 py-32 text-center font-mono text-caption text-smoke">
            {empty}
          </p>
        ) : (
          <div className="flex flex-col gap-12">
            {query.data.map((item) => (
              <NoteCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function DiscoverSections() {
  return (
    <div className="mx-auto w-full max-w-[640px] px-12 py-24 lg:px-0">
      <h1 className="font-serif text-title tracking-[-0.48px] text-ink">Discover</h1>
      <div className="mt-24 flex flex-col gap-32 pb-64">
        {SECTIONS.map((section) => (
          <DiscoverSection key={section.tab} {...section} />
        ))}
      </div>
    </div>
  );
}
