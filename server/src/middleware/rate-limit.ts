import type { NextFunction, Request, Response } from 'express';
import type { Clock } from '../lib/clock.js';
import { AppError } from '../lib/errors.js';

/**
 * Fixed-window in-memory rate limiter. State is per process, so with N API instances the
 * effective limit is up to N times the configured one. Good enough for v1 abuse protection;
 * move to a shared store if exact limits across instances are needed.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  /** Returns 0 when allowed, otherwise seconds until the window resets. */
  hit(key: string): number {
    const now = this.clock.now().getTime();
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
      if (this.windows.size > 50_000) this.sweep(now);
    }
    w.count++;
    if (w.count > this.limit) return Math.max(1, Math.ceil((w.start + this.windowMs - now) / 1000));
    return 0;
  }

  private sweep(now: number) {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }
}

export function rateLimit(limiter: RateLimiter, keyOf: (req: Request) => string | null) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = keyOf(req);
    if (!key) return next();
    const retryAfter = limiter.hit(key);
    if (retryAfter > 0) {
      return next(
        new AppError('RATE_LIMITED', 'Too many requests.', undefined, {
          'Retry-After': String(retryAfter),
        }),
      );
    }
    next();
  };
}
