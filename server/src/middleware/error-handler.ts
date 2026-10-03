import type { ErrorBody } from '@dlc/shared';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

function send(res: Response, req: Request, err: AppError) {
  if (err.headers) for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
  const body: ErrorBody = {
    error: {
      code: err.code,
      message: err.message,
      request_id: req.requestId,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  };
  res.status(err.status).json(body);
}

export function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(
      'VALIDATION_ERROR',
      'Request validation failed.',
      err.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
    );
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE')
      return new AppError('PAYLOAD_TOO_LARGE', 'File is too large.');
    return new AppError('VALIDATION_ERROR', 'Invalid upload.', [{ message: err.code }]);
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.too.large')
    return new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large.');
  if (e?.type === 'entity.parse.failed')
    return new AppError('VALIDATION_ERROR', 'Malformed JSON body.');
  if (e?.type === 'encoding.unsupported' || e?.status === 415) {
    return new AppError('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.');
  }
  return null;
}

export function errorHandler(logger: Logger) {
  // Express identifies error middleware by arity, so all four parameters stay.
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const appErr = toAppError(err);
    if (appErr) return send(res, req, appErr);
    // Only the error class and message are logged; request bodies never are.
    logger.error(
      {
        request_id: req.requestId,
        err: {
          type: (err as Error)?.name,
          message: (err as Error)?.message,
          stack: (err as Error)?.stack,
        },
      },
      'unhandled error',
    );
    send(res, req, new AppError('INTERNAL_ERROR', 'Internal server error.'));
  };
}

export function notFoundHandler(req: Request, res: Response) {
  send(res, req, new AppError('NOT_FOUND', 'Route not found.'));
}
