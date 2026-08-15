import { cn } from "@/lib/cn";

/**
 * NoteTypeChips（§10.6 第四视觉层）：All / Standard / Monetized / Impact / Campaign。
 * 选中态 = iris-tint 底 + iris 1px 边 + iris 文字；未选 = hairline 边 + graphite。
 * 圆角 6px 取自 FRONTEND_DESIGN §18.6（--r-chip），globals @theme 已导出 rounded-chip。
 */
export const NOTE_TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "standard", label: "Standard" },
  { value: "monetized", label: "Monetized" },
  { value: "impact", label: "Impact" },
  { value: "campaign", label: "Campaign" },
] as const;

export type ProfileNoteTab = (typeof NOTE_TYPE_TABS)[number]["value"];

export function NoteTypeChips({
  value,
  onChange,
}: {
  value: ProfileNoteTab;
  onChange: (tab: ProfileNoteTab) => void;
}) {
  return (
    <div className="flex flex-wrap gap-8" role="group" aria-label="Filter notes by type">
      {NOTE_TYPE_TABS.map((tab) => (
        <button
          key={tab.value}
          aria-pressed={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            "rounded-chip border px-12 py-4 font-mono text-caption transition-colors duration-150",
            value === tab.value
              ? "border-iris bg-iris-tint text-iris"
              : "border-hairline text-graphite hover:border-hairline-strong hover:text-ink",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
