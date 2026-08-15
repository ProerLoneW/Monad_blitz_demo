"use client";

import { cn } from "@/lib/cn";
import { useTickingAmount, type StreamSnapshot } from "./useTickingAmount";

/**
 * StreamAmount（§12.3）：6 位小数走字金额，mono tabular，永远带 ` MON`。
 * 默认内部用 useTickingAmount 自驱；父组件（StreamControl）已持有走字值时
 * 传 `snapshot={null}` + `display`，避免第二个 rAF 循环。
 */
export function StreamAmount({
  snapshot,
  display,
  className,
}: {
  snapshot: StreamSnapshot | null;
  display?: string;
  className?: string;
}) {
  const ticked = useTickingAmount(snapshot);
  return (
    <span className={cn("font-mono text-title text-ink", className)}>
      {display ?? ticked} MON
    </span>
  );
}
