"use client";

import { useQuery } from "@tanstack/react-query";
import { getLiveActivity } from "@/services/api";
import { Skeleton } from "@/components/ui/States";

/**
 * LiveActivityRail（§10.1 右栏）："On Monad now" 最多 3 行实时事件，
 * mono 12px 静止排版（不滚动不闪烁）。仅 ≥1280px（xl）渲染。
 */
export function LiveActivityRail() {
  const query = useQuery({
    queryKey: ["live-activity"],
    queryFn: getLiveActivity,
    staleTime: 30_000,
  });

  return (
    <aside className="hidden w-[300px] shrink-0 xl:block">
      <div className="sticky top-24 pt-12">
        <h2 className="font-mono text-caption uppercase text-smoke">On Monad now</h2>
        <div className="mt-16 flex flex-col gap-12 border-t border-hairline pt-16">
          {query.isPending ? (
            <>
              <Skeleton className="h-2.5 w-full" />
              <Skeleton className="h-2.5 w-5/6" />
              <Skeleton className="h-2.5 w-4/6" />
            </>
          ) : query.isError ? (
            <p className="font-mono text-caption text-smoke">Activity unavailable</p>
          ) : query.data.length === 0 ? (
            <p className="font-mono text-caption text-smoke">No recent activity</p>
          ) : (
            query.data.slice(0, 3).map((row, i) => (
              <p key={i} className="font-mono text-caption leading-[1.6] text-graphite">
                {row.text} · {row.ago}
              </p>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
