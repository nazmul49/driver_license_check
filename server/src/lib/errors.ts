import { ERROR_CODES, type ErrorCode } from '@dlc/shared';

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.status = ERROR_CODES[code];
  }
}

export const notFound = () => new AppError('SESSION_NOT_FOUND', 'Session not found.');
export const invalidState = (message = 'Operation not allowed in the current session state.') =>
  new AppError('INVALID_STATE', message);
