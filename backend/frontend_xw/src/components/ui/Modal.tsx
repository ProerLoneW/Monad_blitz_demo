"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Modal（DESIGN.md）：720px Card 面、12px 圆角、32px padding、
 * Ink 40% 压暗背景；全站唯一允许阴影的组件（--shadow-modal）。
 */
export function Modal({
  open,
  onClose,
  children,
  width = 720,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-24"
      onClick={onClose}
    >
      <div
        className={cn("max-h-[85vh] w-full overflow-y-auto rounded-card bg-card p-32 shadow-modal")}
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
