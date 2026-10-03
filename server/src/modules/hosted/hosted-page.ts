import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';

/**
 * Serves the built Vue hosted page from the same origin (SPEC 10.4) with a strict nonce-based
 * CSP (SPEC 12). Assets are content hashed and cacheable; the HTML is not.
 */
export function hostedPageRouter(opts: { distDir: string; frameAncestors: string }): Router {
  const router = Router();
  const indexFile = path.join(opts.distDir, 'index.html');
  const available = existsSync(indexFile);
  const template = available ? readFileSync(indexFile, 'utf8') : null;
  const frameAncestors = opts.frameAncestors.trim() || "'none'";

  if (available) {
    router.use(
      '/assets',
      express.static(path.join(opts.distDir, 'assets'), {
        immutable: true,
        maxAge: '365d',
        index: false,
      }),
    );
  }

  router.get(['/s/:token', '/s/:token/{*rest}'], (req, res) => {
    const nonce = randomBytes(16).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        `style-src 'self' 'nonce-${nonce}'`,
        "img-src 'self' blob: data:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        `frame-ancestors ${frameAncestors}`,
      ].join('; '),
    );
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (!template) {
      res
        .status(503)
        .type('text/plain')
        .send('Hosted page not built. Run npm run build -w hosted-page.');
      return;
    }
    res
      .type('html')
      .send(
        template
          .replace(/<(script|link|style)\b/g, `<$1 nonce="${nonce}"`)
          .replaceAll('__CSP_NONCE__', nonce),
      );
  });

  return router;
}
