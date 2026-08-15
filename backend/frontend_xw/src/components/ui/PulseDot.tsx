import { cn } from "@/lib/cn";

/** Iris 脉冲点（1.6s）— 活跃 stream / live 指示的唯一动效。 */
export function PulseDot({ className, size = 8 }: { className?: string; size?: 6 | 8 }) {
  return (
    <span
      aria-hidden
      className={cn("pulse-dot inline-block shrink-0 rounded-full bg-iris", className)}
      style={{ width: size, height: size }}
    />
  );
}
