"use client";

import { useConfig } from "@/hooks/useConfig";
import { cn } from "@/lib/cn";

/**
 * ExplorerLink — 唯一外链核验组件（§20.1）：固定 ↗、新标签、Iris。
 * URL 来自 /config 的 explorerBaseUrl 或 API 返回的 explorerUrl，前端不拼 host。
 */
export function ExplorerLink({
  explorerUrl,
  path,
  children = "Verify on Monad ↗",
  className,
}: {
  explorerUrl?: string | null;
  /** 相对 explorerBaseUrl 的路径（如 /tx/0x…），仅当没有完整 explorerUrl 时使用 */
  path?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { data: config } = useConfig();
  const href = explorerUrl ?? (path && config ? `${config.chain.explorerBaseUrl}${path}` : null);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "font-mono text-caption text-iris no-underline transition-colors duration-150 hover:underline",
        className,
      )}
    >
      {children}
    </a>
  );
}
