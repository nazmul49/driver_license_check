import { existsSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { UnitOfWork } from '../../db/unit-of-work.js';
import { AppError } from '../../lib/errors.js';
import { OCR_LANGUAGES } from '../ocr/ocr-languages.js';

export function tessdataPresent(dir: string): boolean {
  return OCR_LANGUAGES.every((lang) => existsSync(path.join(dir, `${lang}.traineddata`)));
}

export function healthRouter(d: { uow: UnitOfWork; tessdataDir: string }): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  router.get('/ready', async (_req, res) => {
    let db = false;
    try {
      await d.uow.ping();
      db = true;
    } catch {
      db = false;
    }
    const tessdata = tessdataPresent(d.tessdataDir);
    if (!db || !tessdata) {
      throw new AppError('NOT_READY', 'Service not ready.', { db, tessdata });
    }
    res.json({ status: 'ready', checks: { db, tessdata } });
  });
  return router;
}
