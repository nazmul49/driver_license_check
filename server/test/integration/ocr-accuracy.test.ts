import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createContainer, deps, disposeContainer, TOKENS } from '../../src/container.js';
import { testConfig } from '../helpers/config.js';
import { SPEC_EXAMPLE_PROFILE } from '../helpers/documents.js';
import { FIXTURES, closeSharedPool, loadFixture, sharedPool } from '../helpers/ocr.js';

const FIELDS = [
  'surname',
  'given_names',
  'date_of_birth',
  'place_of_birth',
  'issue_date',
  'expiry_date',
  'issuing_authority',
  'license_number',
] as const;

afterAll(async () => {
  await closeSharedPool();
});

/**
 * Field-level OCR accuracy on the synthetic fixture set (SPEC 16 M5). Every fixture marked
 * `accuracy: true` counts 8 fields plus one entry per category row (code and both dates).
 */
describe('OCR field accuracy', () => {
  it('stays at or above the baseline', async () => {
    const baseline = JSON.parse(
      await readFile(path.resolve(FIXTURES, '../ocr-baseline.json'), 'utf8'),
    ) as {
      min_field_accuracy: number;
    };
    const container = createContainer(testConfig(), { countryProfiles: [SPEC_EXAMPLE_PROFILE] });
    container.rebind(TOKENS.ocrEngine).toConstantValue(await sharedPool());
    const analyzer = deps(container).documentAnalyzer;

    let total = 0;
    let correct = 0;
    const misses: string[] = [];
    for (const name of (await readdir(FIXTURES)).sort()) {
      const f = await loadFixture(name);
      if (!f.expected.accuracy) continue;
      const sides = await analyzer.analyzeImages({ front: f.front, back: f.back });
      const { doc } = await analyzer.extract(sides, 'NO', '2026-10-03');
      for (const field of FIELDS) {
        total++;
        if (doc.fields[field].value === f.expected.fields[field]) correct++;
        else misses.push(`${name}.${field}`);
      }
      for (const cat of f.expected.fields.categories) {
        total++;
        const got = doc.categories.find((c) => c.code === cat.code);
        if (got && got.issue_date === cat.issue_date && got.expiry_date === cat.expiry_date)
          correct++;
        else misses.push(`${name}.category.${cat.code}`);
      }
    }
    await disposeContainer(container);
    const accuracy = correct / total;
    process.stderr.write(
      `OCR field accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${total})${misses.length ? `, misses: ${misses.join(', ')}` : ''}\n`,
    );
    expect(total).toBeGreaterThan(50);
    expect(accuracy).toBeGreaterThanOrEqual(baseline.min_field_accuracy);
  }, 180_000);
});
