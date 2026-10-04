// Child process body for the network-block test: runs the full image + OCR pipeline on the
// valid fixture with the network blocked, then prints the license number it read.
import { createContainer, deps, TOKENS } from '../../src/container.js';
import { TesseractPool } from '../../src/modules/ocr/ocr-pool.js';
import { testConfig } from './config.js';
import { SPEC_EXAMPLE_PROFILE } from './documents.js';
import { TESSDATA, loadFixture } from './ocr.js';

const container = createContainer(testConfig(), { countryProfiles: [SPEC_EXAMPLE_PROFILE] });
const pool = await TesseractPool.create({ size: 1, tessdataDir: TESSDATA });
container.rebind(TOKENS.ocrEngine).toConstantValue(pool);
const f = await loadFixture('valid');
const analyzer = deps(container).documentAnalyzer;
const sides = await analyzer.analyzeImages({ front: f.front, back: f.back });
const { doc } = await analyzer.extract(sides, 'NO', '2026-10-03');
await pool.terminate();
process.stdout.write(`RESULT ${doc.fields.license_number.value}\n`);
// The DB pool is lazy and was never used; exit without opening a connection.
process.exit(0);
