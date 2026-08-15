import type { Money } from '@proofnote/api-types';
import { getAddress } from 'viem';

/** wei → 十进制字符串（无多余尾零）。全程 BigInt，禁止 number。 */
export function formatWei(amountWei: bigint | string, decimals = 18): string {
  const value = typeof amountWei === 'bigint' ? amountWei : BigInt(amountWei);
  if (value === 0n) return '0';
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const s = abs.toString().padStart(decimals + 1, '0');
  const intPart = s.slice(0, s.length - decimals) || '0';
  const fracPart = decimals > 0 ? s.slice(-decimals).replace(/0+$/, '') : '';
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return neg ? `-${out}` : out;
}

export function toMoney(
  amountWei: bigint | string,
  symbol = 'MON',
  decimals = 18,
  tokenAddress?: string | null,
): Money {
  return {
    amountWei: amountWei.toString(),
    formatted: formatWei(amountWei, decimals),
    symbol,
    decimals,
    tokenAddress: (tokenAddress ?? null) as Money['tokenAddress'],
  };
}

export function checksum(address: string): string {
  return getAddress(address);
}

export function isHexBytes32(v: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
}

export function isTxHash(v: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
}

/** wei 字符串合法性（非负整数，防注入 numeric cast） */
export function isWeiString(v: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(v);
}

export const MIN_TIP_WEI = 10n ** 14n; // 0.0001 MON
export const MIN_STREAM_DURATION_SECONDS = 10n;
