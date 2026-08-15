import { Skeleton } from "@/components/ui/States";

/**
 * FeedSkeleton（§10.1 Loading）：首屏 5 张骨架卡，与 NoteCard（§9.1）
 * 同构——Creator Row / 标题与正文行 / 互动行，灰阶呼吸。
 * 纯静态（无 hooks），可同时用于 useQuery pending 与 Suspense fallback。
 */
function SkeletonCard() {
  return (
    <div className="rounded-card border border-hairline bg-card p-24">
      {/* Creator Row */}
      <div className="flex items-center gap-12">
        <Skeleton className="h-32 w-32 rounded-full" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      {/* Content */}
      <Skeleton className="mt-16 h-5 w-2/3" />
      <Skeleton className="mt-8 h-3 w-full" />
      <Skeleton className="mt-8 h-3 w-5/6" />
      {/* Interaction Row */}
      <div className="mt-16 border-t border-hairline pt-12">
        <Skeleton className="h-2.5 w-1/4" />
      </div>
    </div>
  );
}

export function FeedSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-12">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
