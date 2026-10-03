import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';
import type { IntegratorService } from '../modules/integrators/integrator.service.js';

/** Integrator API key auth: Authorization: Bearer <api_key> (SPEC 5.1). */
export function apiKeyAuth(integrators: IntegratorService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) return next(new AppError('UNAUTHORIZED', 'Missing or malformed API key.'));
    const auth = await integrators.authenticate(match[1]!);
    if (!auth) return next(new AppError('UNAUTHORIZED', 'Invalid API key.'));
    req.auth = auth;
    next();
  };
}
