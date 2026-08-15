import { ERROR_CODES, type ErrorCode } from '@proofnote/api-types';

/** 业务错误：code 走 SPEC §45 错误码表，HTTP 状态由错误码映射 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    const statusCode = (ERROR_CODES as Record<string, number>)[code] ?? 500;
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function assertCond(cond: unknown, code: ErrorCode, message?: string, details?: unknown): asserts cond {
  if (!cond) throw new AppError(code, message, details);
}
