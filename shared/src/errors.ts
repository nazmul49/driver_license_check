export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  SESSION_NOT_FOUND: 404,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  LINK_ALREADY_USED: 409,
  SESSION_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  NOT_READY: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
    details?: unknown;
  };
}
