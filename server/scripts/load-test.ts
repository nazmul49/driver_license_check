import os from 'node:os';
import { readdir } from 'node:fs/promises';
import { createContainer, deps, disposeContainer, TOKENS } from '../src/container.js';
import { TesseractPool } from '../src/modules/ocr/ocr-pool.js';
import { testConfig } from '../test/helpers/config.js';
import { SPEC_EXAMPLE_PROFILE } from '../test/helpers/documents.js';
import { FIXTURES, TESSDATA, loadFixture } from '../test/helpers/ocr.js';

/**
 * Pipeline load test (SPEC 16 M7): runs the image + OCR pipeline (the CPU-bound part of
 * processing) over the fixture set with N sessions in flight and reports latency percentiles.
 * Usage: npm run loadtest -w server -- [sessions=60] [concurrency=10] [poolSize=cpus-1]
 */
const [sessions = 60, concurrency = 10, poolSize = Math.max(1, os.cpus().length - 1)] = process.argv
  .slice(2)
  .map(Number);

const container = createContainer(testConfig(), { countryProfiles: [SPEC_EXAMPLE_PROFILE] });
const pool = await TesseractPool.create({ size: poolSize, tessdataDir: TESSDATA });
container.rebind(TOKENS.ocrEngine).toConstantValue(pool);
const analyzer = deps(container).documentAnalyzer;

const names = (await readdir(FIXTURES)).sort();
const fixtures = await Promise.all(names.map((n) => loadFixture(n)));

const durations: number[] = [];
let next = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < sessions) {
      const f = fixtures[next++ % fixtures.length]!;
      const t0 = performance.now();
      const sides = await analyzer.analyzeImages({ front: f.front, back: f.back });
      await analyzer.extract(sides, 'NO', '2026-10-03');
      durations.push(performance.now() - t0);
    }
  }),
);
const wall = (performance.now() - started) / 1000;
durations.sort((a, b) => a - b);
const pct = (p: number) =>
  (
    durations[Math.min(durations.length - 1, Math.ceil((p / 100) * durations.length) - 1)]! / 1000
  ).toFixed(2);
console.log(
  JSON.stringify(
    {
      sessions,
      concurrency,
      ocr_pool_size: poolSize,
      cpus: os.cpus().length,
      cpu_model: os.cpus()[0]?.model,
      wall_seconds: Number(wall.toFixed(1)),
      throughput_per_min: Number(((sessions / wall) * 60).toFixed(1)),
      p50_s: Number(pct(50)),
      p95_s: Number(pct(95)),
      max_s: Number(pct(100)),
    },
    null,
    2,
  ),
);
await pool.terminate();
await disposeContainer(container);
