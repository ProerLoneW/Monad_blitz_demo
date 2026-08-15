import { cn } from "@/lib/cn";
import { Button } from "./Button";

/** 反馈组件（§20.7）：Skeleton / EmptyState / ErrorCard。 */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-input bg-hairline/60", className)} />;
}

export function EmptyState({
  title,
  body,
  cta,
  onCta,
}: {
  title: string;
  body?: string;
  cta?: string;
  onCta?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-16 rounded-card border border-hairline bg-card px-24 py-64 text-center">
      <h2 className="font-serif text-title tracking-[-0.48px] text-ink">{title}</h2>
      {body ? <p className="max-w-md font-sans text-body leading-[1.6] text-graphite">{body}</p> : null}
      {cta ? (
        <Button variant="ghost" onClick={onCta}>
          {cta}
        </Button>
      ) : null}
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-16 rounded-card border border-hairline bg-card px-24 py-64 text-center">
      <h2 className="font-serif text-title tracking-[-0.48px] text-ink">Something went wrong</h2>
      <p className="max-w-md font-mono text-caption text-smoke">{message ?? "Network unavailable — retry"}</p>
      {onRetry ? <Button onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}
