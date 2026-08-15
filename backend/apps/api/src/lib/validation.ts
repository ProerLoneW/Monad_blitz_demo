import { z } from 'zod';
import { AppError } from './errors.js';

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    );
  }
  return parsed.data;
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

export const weiStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'must be a non-negative integer wei string');

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be an EVM address')
  .transform((s) => s.toLowerCase());

export const bytes32Schema = z.string().regex(HEX32, 'must be 0x-prefixed bytes32');

export const txHashSchema = z.string().regex(HEX32, 'must be 0x-prefixed 32-byte tx hash');

export function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values);
}

// ── Cursor 分页（SPEC §4.8）────────────────────────────────

export type Cursor = { p?: string; i?: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object') return parsed as Cursor;
    return null;
  } catch {
    return null;
  }
}

export function pageInfo(items: unknown[], limit: number, cursorOf: (item: never) => Cursor) {
  if (items.length < limit) return { nextCursor: null, hasNext: false };
  const last = items[items.length - 1] as never;
  return { nextCursor: encodeCursor(cursorOf(last)), hasNext: true };
}
