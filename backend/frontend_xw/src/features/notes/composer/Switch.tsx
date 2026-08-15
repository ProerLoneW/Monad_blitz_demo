import { cn } from "@/lib/cn";

/**
 * 小尺寸 switch（§10.3：开关为小尺寸 switch）。
 * 36×20px 轨道 + 16px 圆钮；开 = iris 轨道，关 = hairline-strong。
 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-pill p-0.5 transition-colors duration-150",
        checked ? "bg-iris" : "bg-hairline-strong",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-16 rounded-full bg-card transition-transform duration-150",
          checked && "translate-x-16",
        )}
      />
    </button>
  );
}
