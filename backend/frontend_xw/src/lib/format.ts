import type { Money } from "@proofnote/api-types";

/**
 * Address truncation: `0x12A4…92Bc` — first 6 chars (incl. 0x) + single-char
 * ellipsis + last 4 (FRONTEND_DESIGN §16.2). Checksum casing preserved.
 */
export function truncateAddress(address: string): string {
  if (address.length <= 11) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Format a wei string as a trimmed MON decimal string (no symbol suffix —
 * callers append ` MON` / ` MON/s` per §11.1). Uses the API-provided
 * `formatted` when a Money object is available.
 */
export function monFromWei(amountWei: string, maxDecimals = 6): string {
  const negative = amountWei.startsWith("-");
  const raw = negative ? amountWei.slice(1) : amountWei;
  const padded = raw.padStart(19, "0");
  const intPart = padded.slice(0, -18).replace(/^0+(?=\d)/, "");
  let fracPart = padded.slice(-18).replace(/0+$/, "");
  if (fracPart.length > maxDecimals) fracPart = fracPart.slice(0, maxDecimals);
  const out = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
  return (negative ? "-" : "") + out;
}

/** Money → `12.8` (prefers API formatted field). */
export function monOf(money: Money): string {
  return money.formatted;
}

/** Relative time like `2h` / `3d` (FRONTEND_DESIGN card meta uses `· 2h`). */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

/** Absolute timestamp for detail views, e.g. `Aug 12, 2025 · 14:32`. */
export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${hh}:${mm}`;
}
