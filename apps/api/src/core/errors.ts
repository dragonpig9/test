import type { ErrorCode } from '@commonhours/shared';

const STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  DEMO_DISABLED: 404,
  INTERNAL_ERROR: 500,
};

/**
 * Domain error with a stable code and the module that raised it.
 * Rule violations (credit floor, invalid transitions...) default to 409/422 so the
 * frontend can display the explanation instead of a generic failure.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly module: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, module: string, details?: Record<string, unknown>, status?: number) {
    super(message);
    this.code = code;
    this.module = module;
    this.details = details;
    this.status = status ?? STATUS[code] ?? 422;
  }
}

export const notFound = (module: string, what: string) => new AppError('NOT_FOUND', `${what} was not found.`, module);
export const forbidden = (module: string, message: string) => new AppError('FORBIDDEN', message, module);
