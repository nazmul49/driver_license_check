import {
  HostedConsentRequestSchema,
  HostedOpenRequestSchema,
  ImageSideParamSchema,
} from '@dlc/shared';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { RateLimiter, rateLimit } from '../../middleware/rate-limit.js';
import type { AuditService } from '../audit/audit.service.js';
import { HOSTED_COOKIE, signHostedCookie, verifyHostedCookie } from './hosted-cookie.js';
import type { HostedService } from './hosted.service.js';

export interface HostedRouterDeps {
  hosted: HostedService;
  audit: AuditService;
  clock: Clock;
  cookieSecret: string;
  cookieSecure: boolean;
  uploadMaxBytes: number;
  rateLimitPerMin: number;
}

export function hostedRouter(d: HostedRouterDeps): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: d.uploadMaxBytes, files: 1, fields: 0, parts: 2 },
  });
  const ipLimiter = new RateLimiter(d.rateLimitPerMin, 60_000, d.clock);
  const sessionLimiter = new RateLimiter(d.rateLimitPerMin, 60_000, d.clock);

  router.use(rateLimit(ipLimiter, (req) => `ip:${req.ip}`));
  router.use(express.json({ limit: '4kb' }));

  const cookieSession = (req: Request) =>
    verifyHostedCookie(d.cookieSecret, req.cookies?.[HOSTED_COOKIE], d.clock.now());

  const requireSession = (req: Request, _res: Response, next: NextFunction) => {
    const id = cookieSession(req);
    if (!id)
      return next(
        new AppError('UNAUTHORIZED', 'Session cookie missing or expired. Open the link again.'),
      );
    req.hostedSessionId = id;
    next();
  };
  const perSession = rateLimit(sessionLimiter, (req) =>
    req.hostedSessionId ? `s:${req.hostedSessionId}` : null,
  );

  const audit = (req: Request, action: string) =>
    d.audit.record({
      actorType: 'end_user',
      action,
      sessionId: req.hostedSessionId ?? null,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      requestId: req.requestId,
    });

  router.post('/session/open', async (req, res) => {
    const { token } = HostedOpenRequestSchema.parse(req.body);
    const { session, info } = await d.hosted.open(token, cookieSession(req));
    req.hostedSessionId = session.id;
    res.cookie(
      HOSTED_COOKIE,
      signHostedCookie(d.cookieSecret, session.id, new Date(session.expires_at)),
      {
        httpOnly: true,
        secure: d.cookieSecure,
        sameSite: 'strict',
        path: '/hosted/api',
        expires: new Date(session.expires_at),
      },
    );
    await audit(req, 'hosted.open');
    res.json(info);
  });

  router.get('/session', requireSession, perSession, async (req, res) => {
    res.json(await d.hosted.info(await d.hosted.load(req.hostedSessionId!)));
  });

  router.post('/session/consent', requireSession, perSession, async (req, res) => {
    const body = HostedConsentRequestSchema.parse(req.body);
    await d.hosted.consent(req.hostedSessionId!, body.consent_version);
    await audit(req, 'hosted.consent');
    res.status(204).end();
  });

  router.post('/session/images/:side', requireSession, perSession, (req, res, next) => {
    if (!req.is('multipart/form-data')) {
      return next(new AppError('UNSUPPORTED_MEDIA_TYPE', 'Expected multipart/form-data.'));
    }
    upload.single('file')(req, res, async (err?: unknown) => {
      try {
        if (err) throw err;
        const { side } = ImageSideParamSchema.parse(req.params);
        if (!req.file)
          throw new AppError('VALIDATION_ERROR', 'A single file field named "file" is required.');
        const uploaded = await d.hosted.upload(req.hostedSessionId!, side, req.file.buffer);
        await audit(req, `hosted.upload.${side}`);
        res.json({ uploaded });
      } catch (e) {
        next(e);
      }
    });
  });

  router.post('/session/submit', requireSession, perSession, async (req, res) => {
    const result = await d.hosted.submit(req.hostedSessionId!);
    await audit(req, 'hosted.submit');
    res.json(result);
  });

  router.get('/session/status', requireSession, perSession, async (req, res) => {
    res.json(await d.hosted.status(req.hostedSessionId!));
  });

  return router;
}
