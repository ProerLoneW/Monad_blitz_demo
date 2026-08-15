import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/**
 * Badge（§9.3 克制原则）：每卡右上角至多 1 个。
 * impact = Leaf 描边小胶囊；funding = Leaf 浅底胶囊；amber = Evidence missing 描边。
 */
export function Badge({
  variant,
  children,
  className,
}: {
  variant: "impact" | "funding" | "amber" | "neutral";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-12 py-4 font-mono text-caption leading-none",
        variant === "impact" && "border border-leaf/40 text-leaf",
        variant === "funding" && "bg-leaf-tint text-leaf",
        variant === "amber" && "border border-amber/50 text-amber",
        variant === "neutral" && "bg-paper text-smoke",
        className,
      )}
    >
      {children}
    </span>
  );
}
