import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

/**
 * Primary Pill Button（DESIGN.md）：Ink 填充、Paper 文字、mono 14 500
 * uppercase、9999px、height 44px。每屏至多一个主按钮。
 * Ghost：透明底 + 1px hairline + Ink 文字。
 */
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
  size?: "md" | "sm";
};

export function Button({ variant = "primary", size = "md", className, ...rest }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-8 rounded-pill font-mono font-medium uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-11 px-24 text-label tracking-[-0.28px]" : "h-9 px-16 text-caption",
        variant === "primary"
          ? "bg-ink text-paper hover:bg-ink-hover"
          : "border border-hairline bg-transparent text-ink hover:border-hairline-strong",
        className,
      )}
      {...rest}
    />
  );
}
