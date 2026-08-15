import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * 渐进增强手风琴分区（§10.3）：收起态一行摘要，展开态显示 children。
 * disabled 时整行灰置且不可展开（Funding / 未选中 Impact 时的形态）。
 */
export function AccordionSection({
  label,
  summary,
  open,
  onToggle,
  disabled,
  children,
}: {
  label: string;
  /** 收起态摘要行，如 `Record a real-world action with evidence` */
  summary: string;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="border-t border-hairline">
      <button
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-8 py-16 text-left",
          disabled ? "cursor-not-allowed text-smoke" : "text-ink",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "font-sans text-caption transition-transform duration-150",
            open && "rotate-90",
          )}
        >
          ▸
        </span>
        <span
          className={cn(
            "font-sans text-label font-medium",
            disabled ? "text-smoke" : "text-ink",
          )}
        >
          {label}
        </span>
        {!open && summary ? (
          <span className="truncate font-sans text-caption text-smoke">— {summary}</span>
        ) : null}
      </button>
      {open && !disabled ? <div className="pb-20 pl-24">{children}</div> : null}
    </div>
  );
}
