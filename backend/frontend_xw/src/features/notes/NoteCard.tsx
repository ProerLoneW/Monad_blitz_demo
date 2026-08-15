"use client";

import { useRouter } from "next/navigation";
import type { FeedItemView } from "@/types";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { PulseDot } from "@/components/ui/PulseDot";

/**
 * NoteCard（§9）：四种 Note 类型共享同一副骨架，差异只在增强区域。
 * 白底 / 1px hairline / 12px 圆角 / 无阴影；右上角至多 1 个 Badge；
 * 整卡点击进详情（增强区域与按钮 stopPropagation）。
 */
export function NoteCard({ item, className }: { item: FeedItemView; className?: string }) {
  const router = useRouter();

  const href =
    item.type === "CAMPAIGN"
      ? `/campaign/${item.id}`
      : item.type === "IMPACT"
        ? `/impact/${item.id}`
        : `/note/${item.id}`;

  const badge =
    item.badges.includes("FUNDING") ? (
      <Badge variant="funding">Funding</Badge>
    ) : item.badges.includes("IMPACT") ? (
      <Badge variant="impact">Impact</Badge>
    ) : null;

  return (
    <article
      onClick={() => router.push(href)}
      className={cn(
        "cursor-pointer rounded-card border border-hairline bg-card p-24 transition-colors duration-150 hover:border-hairline-strong",
        className,
      )}
    >
      {/* Creator Row */}
      <div className="flex items-center gap-12">
        <Avatar profile={item.author} size={32} />
        <div className="flex min-w-0 flex-1 items-baseline gap-8">
          <span className="truncate font-sans text-label font-medium text-ink">
            {item.author.displayName ?? "Anon"}
          </span>
          <span className="truncate font-mono text-caption text-smoke">
            @{item.author.handle} · {relativeTime(item.createdAt)}
          </span>
        </div>
        {badge}
      </div>

      {/* Content */}
      {item.title ? (
        <h3 className="mt-16 font-serif text-title leading-[1.2] tracking-[-0.48px] text-ink">
          {item.title}
        </h3>
      ) : null}
      <p className="mt-8 line-clamp-2 font-sans text-body leading-[1.6] text-graphite">
        {item.bodyPreview}
      </p>

      {/* Enhancement Zone（至多一个） */}
      {item.type === "MONETIZED" && item.value ? (
        <div className="mt-16 flex items-center gap-8 border-t border-hairline pt-12 font-mono text-caption text-ink">
          <span>
            {item.value.totalSupportFormatted} {item.value.symbol} supported
          </span>
          <span className="text-smoke">· {item.value.supporterCount} supporters</span>
          {item.value.activeStreams > 0 && (
            <span className="flex items-center gap-4 text-smoke">
              · <PulseDot size={6} /> {item.value.activeStreams} streaming
            </span>
          )}
        </div>
      ) : null}

      {item.type === "IMPACT" && item.impact ? (
        <div className="mt-16 flex items-center gap-8 border-t border-hairline pt-12 font-mono text-caption">
          <span className="flex items-center gap-4 text-leaf">
            <span aria-hidden className="inline-block h-8 w-8 rounded-full bg-leaf" />
            Community attested
          </span>
          <span className="text-smoke">
            · {item.impact.evidenceCount} evidence · {item.impact.attestationCount} attestations
          </span>
        </div>
      ) : null}

      {item.type === "CAMPAIGN" && item.funding ? (
        <div className="mt-16 border-t border-hairline pt-12">
          <div className="flex items-center justify-between font-mono text-caption">
            <span className="text-ink">
              {item.funding.raisedFormatted} / {item.funding.targetFormatted} MON raised
            </span>
            <span className="text-smoke">{item.funding.percent}%</span>
          </div>
          <div className="mt-8 h-4 overflow-hidden rounded-full bg-hairline">
            <div
              className="h-full rounded-full bg-leaf"
              style={{ width: `${item.funding.percent}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Interaction Row */}
      <div className="mt-16 flex items-center gap-16 border-t border-hairline pt-12 font-mono text-caption text-graphite">
        {item.type !== "CAMPAIGN" && (
          <button
            className="transition-colors duration-150 hover:text-ink"
            onClick={(e) => {
              e.stopPropagation();
              router.push(href);
            }}
          >
            Tip
          </button>
        )}
        {item.type === "MONETIZED" && (
          <button
            className="transition-colors duration-150 hover:text-ink"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`${href}?panel=value`);
            }}
          >
            Stream
          </button>
        )}
        <button
          className="transition-colors duration-150 hover:text-ink"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard?.writeText(window.location.origin + href);
          }}
        >
          Share
        </button>
      </div>
    </article>
  );
}
