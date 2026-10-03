import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '../..');

/**
 * SPEC 6.2 / 17: no outbound network connection during processing. The OCR pipeline runs in a
 * child process where sockets, DNS, http(s) and fetch throw, in the main thread and in the
 * tesseract worker threads.
 */
describe('processing makes no network calls', () => {
  it('reads the card with networking blocked', () => {
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        path.join(here, '../helpers/block-network.mjs'),
        path.join(here, '../helpers/offline-ocr-run.ts'),
      ],
      { cwd: serverRoot, encoding: 'utf8', timeout: 120_000, env: { ...process.env, TZ: 'UTC' } },
    );
    expect(run.stderr).not.toContain('NETWORK_ATTEMPT');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('RESULT 12345678901');
  }, 130_000);

  it('the blocker really blocks (sanity check)', () => {
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        path.join(here, '../helpers/block-network.mjs'),
        '-e',
        "fetch('https://example.com').catch(() => process.exit(3))",
      ],
      { encoding: 'utf8', timeout: 20_000 },
    );
    expect(run.stderr).toContain('NETWORK_ATTEMPT fetch https://example.com');
    expect(run.status).toBe(3);
  });
});
