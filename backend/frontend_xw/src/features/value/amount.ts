import { monFromWei } from "@/lib/format";

/**
 * Value/Stream 表单的金额换算助手（§11.1：wei 一律字符串、BigInt 精确换算；
 * 显示层仍走 monFromWei / API formatted，不自行 formatEther）。
 */

/** Decimal MON 字符串 → wei 字符串。非法输入（含超过 18 位小数）返回 null。 */
export function monToWei(input: string): string | null {
  const v = input.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const [int, frac = ""] = v.split(".");
  if (frac.length > 18) return null;
  const wei = BigInt(int) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
  return wei.toString();
}

/** wei/s → 人类可读的 `MON/min` 主显示（§11.1：0.001 MON/s → "0.06"）。 */
export function ratePerMinuteLabel(rateWeiPerSecond: string): string {
  return monFromWei((BigInt(rateWeiPerSecond) * 60n).toString());
}

/** 数字 → 去掉多余尾零的 MON 字符串（0.20 → "0.2"）。仅用于表单回显。 */
export function trimMon(n: number): string {
  return String(parseFloat(n.toFixed(4)));
}

/** 秒 → `3 min 20 s` / `45 s` / `2 h 5 min`（§12.2 时长换算教学点）。 */
export function durationLabel(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0 s";
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 120) return rs > 0 ? `${m} min ${rs} s` : `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h} h ${rm} min` : `${h} h`;
}
