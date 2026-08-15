"use client";

import { cn } from "@/lib/cn";
import type { FeedTab } from "@/services/api";

const TABS: { value: FeedTab; label: string }[] = [
  { value: "for-you", label: "For You" },
  { value: "impact", label: "Impact" },
  { value: "monad", label: "Monad" },
];

/**
 * FeedTabs（§8.4 / §10.1）：Home 置顶 sticky，滚动时为毛玻璃条。
 * active = ink 文字 + 下方 2px Iris 短条；inactive = graphite，hover 150ms。
 * top-[61px] 为窄屏顶栏（AppShell mobile header：36px 内容 + py-12 + 1px 边）
 * 让位；≥lg 无顶栏，贴顶 top-0。
 */
export function FeedTabs({
  value,
  onChange,
}: {
  value: FeedTab;
  onChange: (tab: FeedTab) => void;
}) {
  return (
    <div className="sticky top-[61px] z-30 bg-paper/80 backdrop-blur lg:top-0">
      <div className="flex items-center gap-24 border-b border-hairline">
        {TABS.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange(tab.value)}
              className={cn(
                "relative py-12 font-sans text-label transition-colors duration-150",
                active ? "font-medium text-ink" : "text-graphite hover:text-ink",
              )}
            >
              {tab.label}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-[-1px] mx-auto h-0.5 w-24 rounded-full bg-iris"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
