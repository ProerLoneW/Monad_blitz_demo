"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * 交易 Sheet（§10.8 B）：桌面右侧 400px 滑入，承载单笔交易；
 * Esc / 点击遮罩关闭即中止流程（已提交的交易由 Toast 继续跟踪）。
 * 全站仅 Modal/Sheet 允许 shadow-modal。
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEntered(false);
    const raf = requestAnimationFrame(() => setEntered(true));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal className="fixed inset-0 z-50 bg-ink/40" onClick={onClose}>
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex w-full max-w-[400px] flex-col overflow-y-auto bg-card shadow-modal transition-transform duration-150 ease-out",
          entered ? "translate-x-0" : "translate-x-full",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-24 py-16">
          <h2 className="font-serif text-title tracking-[-0.48px] text-ink">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="font-mono text-label text-smoke transition-colors duration-150 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-16 p-24">{children}</div>
      </div>
    </div>
  );
}
