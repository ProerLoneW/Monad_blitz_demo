import { Suspense } from "react";
import { HomeFeed } from "@/features/feed/HomeFeed";
import { FeedSkeleton } from "@/features/feed/FeedSkeleton";

/** Home Feed（§10.1）：tab 经 ?tab= 深链，useSearchParams 需 Suspense 边界。 */
export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-[640px] px-12 pb-64 pt-24 lg:px-0">
          <FeedSkeleton />
        </div>
      }
    >
      <HomeFeed />
    </Suspense>
  );
}
