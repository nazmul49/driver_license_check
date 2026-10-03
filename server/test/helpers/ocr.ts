import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TesseractPool } from '../../src/modules/ocr/ocr-pool.js';

export const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/synthetic',
);
export const TESSDATA = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tessdata',
);

let shared: Promise<TesseractPool> | null = null;

/** One OCR pool per test file (workers take a second or two to start). */
export function sharedPool(): Promise<TesseractPool> {
  shared ??= TesseractPool.create({ size: 2, tessdataDir: TESSDATA });
  return shared;
}

export async function closeSharedPool(): Promise<void> {
  if (shared) await (await shared).terminate();
  shared = null;
}

export interface FixtureExpected {
  name: string;
  accuracy: boolean;
  fields: Record<string, string> & {
    categories: { code: string; issue_date: string; expiry_date: string }[];
  };
  expect_fail: string[];
  expect_warn: string[];
  expect_decision: 'approved' | 'review' | 'rejected' | null;
}

export async function loadFixture(name: string) {
  const dir = path.join(FIXTURES, name);
  return {
    front: await readFile(path.join(dir, 'front.jpg')),
    back: await readFile(path.join(dir, 'back.jpg')),
    expected: JSON.parse(
      await readFile(path.join(dir, 'expected.json'), 'utf8'),
    ) as FixtureExpected,
  };
}
