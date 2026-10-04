import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { deps, type Container } from './container.js';
import { safeEqual } from './lib/crypto.js';
import { AppError } from './lib/errors.js';
import { apiKeyAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { RateLimiter, rateLimit } from './middleware/rate-limit.js';
import { requestContext } from './middleware/request-context.js';
import { noStore, securityHeaders } from './middleware/security-headers.js';
import { healthRouter } from './modules/health/health.routes.js';
import { hostedPageRouter } from './modules/hosted/hosted-page.js';
import { hostedRouter } from './modules/hosted/hosted.routes.js';
import { createApiMetrics } from './modules/metrics/metrics.js';
import { sessionRouter } from './modules/sessions/session.routes.js';

/** Express app factory without listen(), so tests can drive it with supertest. */
export function createApp(container: Container): Express {
  const c = deps(container);
  const { config } = c;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use(requestContext(c.logger));
  app.use(securityHeaders({ hsts: config.HSTS }));

  const metrics = createApiMetrics({
    sessions: c.sessionRepository,
    results: c.resultRepository,
    jobs: c.jobRepository,
  });
  app.get('/metrics', async (req, res) => {
    if (
      config.METRICS_TOKEN &&
      !safeEqual(req.get('authorization') ?? '', `Bearer ${config.METRICS_TOKEN}`)
    ) {
      throw new AppError('UNAUTHORIZED', 'Metrics token required.');
    }
    res.setHeader('Content-Type', metrics.contentType);
    res.send(await metrics.metrics());
  });

  const v1 = express.Router();
  v1.use(noStore);
  v1.use(healthRouter({ uow: c.uow, tessdataDir: config.TESSDATA_DIR }));
  const keyLimiter = new RateLimiter(config.RATE_LIMIT_PER_MIN, 60_000, c.clock);
  v1.use(
    '/sessions',
    apiKeyAuth(c.integratorService),
    rateLimit(keyLimiter, (req) => req.auth?.keyId ?? null),
    sessionRouter({ sessions: c.sessionService, images: c.imageService, audit: c.auditService }),
  );
  app.use('/v1', v1);

  app.use(
    '/hosted/api',
    noStore,
    cookieParser(),
    hostedRouter({
      hosted: c.hostedService,
      audit: c.auditService,
      clock: c.clock,
      cookieSecret: config.COOKIE_SECRET,
      cookieSecure: config.COOKIE_SECURE,
      uploadMaxBytes: config.UPLOAD_MAX_BYTES,
      rateLimitPerMin: config.HOSTED_RATE_LIMIT_PER_MIN,
    }),
  );

  app.use(
    hostedPageRouter({ distDir: config.HOSTED_PAGE_DIST, frameAncestors: config.FRAME_ANCESTORS }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler(c.logger));
  return app;
}
