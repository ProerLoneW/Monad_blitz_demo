import { cn } from "@/lib/cn";
import type { ProfileSummary } from "@proofnote/api-types";
import { truncateAddress } from "@/lib/format";

/**
 * 扁平圆形头像（无真人照片）。无 avatarUrl 时用 tinted 底 + 首字母；
 * 无 Profile 的地址退化为几何占位（hairline 底 + 地址片段，jazzicon 风格简化）。
 * 色调取自 token：alice→iris-tint / bob→hairline / carol→leaf-tint。
 */
const TINTS = ["bg-iris-tint text-iris", "bg-hairline text-graphite", "bg-leaf-tint text-leaf"];

function tintFor(key: string): string {
  const known: Record<string, number> = { alice: 0, bob: 1, carol: 2 };
  const idx = known[key.toLowerCase()] ?? [...key].reduce((a, c) => a + c.charCodeAt(0), 0) % 3;
  return TINTS[idx];
}

export function Avatar({
  profile,
  size = 32,
  className,
}: {
  profile: Pick<ProfileSummary, "walletAddress" | "handle" | "displayName"> | { address: string };
  size?: 20 | 32 | 40 | 80;
  className?: string;
}) {
  const name =
    "displayName" in profile ? profile.displayName || profile.handle : undefined;
  const label = name ?? truncateAddress("walletAddress" in profile ? profile.walletAddress : profile.address);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-mono",
        tintFor(name ?? label),
        size === 80 && "text-title",
        size === 40 && "text-data",
        size === 32 && "text-label",
        size === 20 && "text-caption",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}
