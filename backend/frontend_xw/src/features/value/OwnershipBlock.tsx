import type { Note } from "@/types";
import { relativeTime, truncateAddress } from "@/lib/format";
import { ExplorerLink } from "@/components/ui/ExplorerLink";

/**
 * OwnershipBlock（§11.2）：所有已锚定 Note 的底层可信入口——
 * contentHash 截断 + Anchored 相对时间 + Explorer 核验链接。
 * 未锚定成功（无 contentHash）不渲染。
 */
export function OwnershipBlock({ note }: { note: Note }) {
  const { ownership } = note;
  if (!ownership.anchored || !ownership.contentHash) return null;
  return (
    <div>
      <div className="font-mono text-caption text-smoke">Ownership</div>
      <div className="mt-8 flex flex-wrap items-baseline gap-4 font-mono text-caption">
        <span className="text-ink">{truncateAddress(ownership.contentHash)}</span>
        <span className="text-smoke">
          · Anchored {relativeTime(note.publishedAt ?? note.createdAt)} ago
          {ownership.explorerUrl ? " ·" : ""}
        </span>
        <ExplorerLink explorerUrl={ownership.explorerUrl} />
      </div>
    </div>
  );
}
