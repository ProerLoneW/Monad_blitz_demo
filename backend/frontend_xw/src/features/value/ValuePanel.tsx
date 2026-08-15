"use client";

import type { ReactNode } from "react";
import type { Note, NoteValuePanel } from "@/types";
import { monFromWei, monOf } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PulseDot } from "@/components/ui/PulseDot";
import { DistributionBar } from "./DistributionBar";
import { OwnershipBlock } from "./OwnershipBlock";

/**
 * ValuePanel（§11.2 / P02 右栏 320px sticky）：Total Support → Supporters →
 * Incoming Rate（无活跃流整行隐藏）→ 双 CTA → Distribution → Ownership。
 * Stream Active 变体（P03）由页面经 `streamSlot` 把 StreamControl 置顶。
 * 数据只读，未连接钱包也可浏览；本人 Note 不显示 Support CTA。
 */
export function ValuePanel({
  note,
  value,
  streamSlot,
  isOwn,
  onTip,
  onStream,
}: {
  note: Note;
  value: NoteValuePanel | null;
  streamSlot?: ReactNode;
  isOwn: boolean;
  onTip: () => void;
  onStream: () => void;
}) {
  const supporters = note.value?.supporterCount ?? null;
  const activeStreams = value?.stream.activeCount ?? 0;
  const hasOwnership = note.ownership.anchored && !!note.ownership.contentHash;
  if (!value && !hasOwnership && !streamSlot) return null;

  const showCtas = !isOwn && !!value && (value.tip.enabled || value.stream.enabled);

  return (
    <Card>
      {streamSlot}
      {streamSlot ? <div aria-hidden className="mt-16 border-t border-hairline" /> : null}

      {value ? (
        <div className={streamSlot ? "mt-16" : ""}>
          <div className="flex items-baseline gap-8">
            <span className="font-mono text-title text-ink">
              {monOf(value.totalSupport)} {value.totalSupport.symbol}
            </span>
            <span className="text-caption text-smoke">supported</span>
          </div>
          {supporters !== null ? (
            <div className="mt-8 font-mono text-caption leading-5 text-graphite">
              {supporters} supporters
            </div>
          ) : null}
          {activeStreams > 0 ? (
            <div className="mt-4 flex items-center gap-8 font-mono text-caption leading-5 text-graphite">
              <PulseDot size={6} />
              {activeStreams} streaming · {monFromWei(value.stream.incomingRateWeiPerSecond)} MON/s
            </div>
          ) : null}
        </div>
      ) : null}

      {showCtas && value ? (
        <div className="mt-16 border-t border-hairline pt-16">
          <div className="flex gap-12">
            {value.tip.enabled ? (
              <Button className="flex-1" onClick={onTip}>
                Tip
              </Button>
            ) : null}
            {value.stream.enabled ? (
              <Button variant="ghost" className="flex-1" onClick={onStream}>
                Stream ▶
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isOwn && value ? (
        <div className="mt-16 border-t border-hairline pt-16 font-mono text-caption text-smoke">
          This is your note
        </div>
      ) : null}

      {value && value.distribution.length > 0 ? (
        <div className="mt-16 border-t border-hairline pt-16">
          <DistributionBar entries={value.distribution} />
        </div>
      ) : null}

      {hasOwnership ? (
        <div className="mt-16 border-t border-hairline pt-16">
          <OwnershipBlock note={note} />
        </div>
      ) : null}
    </Card>
  );
}
