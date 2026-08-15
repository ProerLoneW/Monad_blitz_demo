import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

/** Card：#FFFFFF、1px hairline、12px 圆角、无阴影、24px padding。 */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card border border-hairline bg-card p-24", className)}
      {...rest}
    />
  );
}
