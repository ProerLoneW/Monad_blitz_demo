import { cn } from "@/lib/cn";
import type { NoteType } from "./schema";

/**
 * Note 类型 pill radio 卡（§10.3 / DESIGN.md Modal 规格）：
 * 选中 = iris-tint 底 + iris 1px 边；未选 = hairline 边。
 */
const OPTIONS: { value: NoteType; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "monetized", label: "Monetized" },
  { value: "impact", label: "Impact" },
];

export function NoteTypePicker({
  value,
  onChange,
}: {
  value: NoteType;
  onChange: (next: NoteType) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Note type" className="flex gap-8">
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-9 rounded-pill border px-16 font-sans text-label transition-colors duration-150",
              selected
                ? "border-iris bg-iris-tint text-ink"
                : "border-hairline bg-transparent text-graphite hover:border-hairline-strong hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
