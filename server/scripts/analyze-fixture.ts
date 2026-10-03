import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { asValue } from 'awilix';
import { createContainer } from '../src/container.js';
import { TesseractPool } from '../src/modules/ocr/ocr-pool.js';
import { testConfig } from '../test/helpers/config.js';
import { SPEC_EXAMPLE_PROFILE } from '../test/helpers/documents.js';

/** Dev tool: run OCR + parsing on synthetic fixtures and print the extraction. Synthetic data only. */
const names = process.argv.slice(2);
const config = testConfig();
const container = createContainer(config, { countryProfiles: [SPEC_EXAMPLE_PROFILE] });
const pool = await TesseractPool.create({ size: 1, tessdataDir: config.TESSDATA_DIR });
container.register({ ocrEngine: asValue(pool) });
const analyzer = container.cradle.documentAnalyzer;
for (const name of names) {
  const dir = path.resolve('test/fixtures/synthetic', name);
  const t0 = performance.now();
  const sides = await analyzer.analyzeImages({
    front: await readFile(path.join(dir, 'front.jpg')),
    back: await readFile(path.join(dir, 'back.jpg')),
  });
  const ex = await analyzer.extract(sides, 'NO', '2026-10-03');
  console.log(
    `== ${name} (${Math.round(performance.now() - t0)} ms) template=${ex.doc.template} score=${ex.templateScore} country=${ex.detectedCountry} conf=${ex.ocrConfidence.toFixed(2)}`,
  );
  console.log(
    JSON.stringify({ metrics: { front: sides.front.metrics, back: sides.back.metrics } }),
  );
  for (const [k, v] of Object.entries(ex.doc.fields)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  console.log(`  categories: ${JSON.stringify(ex.doc.categories)}`);
  if (process.env.RAW) console.log(ex.rawText.front, '\n---\n', ex.rawText.back);
}
await pool.terminate();
await container.dispose();
