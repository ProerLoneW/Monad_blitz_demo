"use client";

import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/cn";

/** Transaction Toast（§16.3 / §20.1）：submitted(spinner) / confirmed(✓ Leaf) / failed。 */
export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-24 right-24 z-[60] flex w-80 flex-col gap-8">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-12 rounded-card border border-hairline bg-card px-16 py-12 shadow-modal"
        >
          <span
            aria-hidden
            className={cn(
              "inline-block h-8 w-8 shrink-0 rounded-full",
              t.kind === "submitted" && "animate-spin border border-hairline-strong border-t-iris",
              t.kind === "confirmed" && "bg-leaf",
              t.kind === "failed" && "bg-red",
            )}
          />
          <span className="flex-1 font-mono text-caption text-ink">
            {t.explorerUrl ? (
              <a href={t.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-iris hover:underline">
                {t.message}
              </a>
            ) : (
              t.message
            )}
          </span>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="font-mono text-caption text-smoke hover:text-ink"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
