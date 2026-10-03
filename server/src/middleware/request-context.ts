import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../lib/logger.js';
import { newRequestId } from '../lib/ids.js';
import type { AuthenticatedKey } from '../modules/integrators/integrator.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthenticatedKey;
      hostedSessionId?: string;
      cspNonce?: string;
    }
  }
}

/** Paths that carry a secret token are logged with the token replaced. */
export function safePath(path: string): string {
  return path.replace(/^\/s\/[^/?#]+/, '/s/:token');
}

export function requestContext(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    req.requestId = newRequestId();
    res.setHeader('X-Request-Id', req.requestId);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info(
        {
          request_id: req.requestId,
          method: req.method,
          path: req.route?.path ? `${req.baseUrl}${req.route.path}` : safePath(req.path),
          status: res.statusCode,
          duration_ms: Math.round(ms),
          integrator_id: req.auth?.integrator.id,
          session_id:
            req.hostedSessionId ?? (typeof req.params?.id === 'string' ? req.params.id : undefined),
        },
        'request',
      );
    });
    next();
  };
}
