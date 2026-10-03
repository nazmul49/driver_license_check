import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { OEM, PSM, createWorker, type Worker } from 'tesseract.js';
import { OCR_LANGUAGES } from './ocr-languages.js';
import type { OcrEngine, OcrLine, OcrOptions, OcrResult } from './ocr.types.js';

const require = createRequire(import.meta.url);
const TESSERACT_VERSION: string = require('tesseract.js/package.json').version;

/**
 * Fixed pool of tesseract.js workers (SPEC 6.2). Language data is read from the bundled
 * tessdata directory; caching is disabled, so nothing is downloaded or written at runtime.
 * Each recognize call borrows one worker, applies its per-zone parameters and returns it.
 */
export class TesseractPool implements OcrEngine {
  readonly version = `tesseract.js@${TESSERACT_VERSION}`;
  private readonly idle: Worker[] = [];
  private readonly waiters: ((w: Worker) => void)[] = [];
  private all: Worker[] = [];

  private constructor() {}

  static async create(opts: { size: number; tessdataDir: string }): Promise<TesseractPool> {
    for (const lang of OCR_LANGUAGES) {
      const file = path.join(opts.tessdataDir, `${lang}.traineddata`);
      if (!existsSync(file)) throw new Error(`Missing bundled language data: ${file}`);
    }
    const pool = new TesseractPool();
    pool.all = await Promise.all(
      Array.from({ length: Math.max(1, opts.size) }, () =>
        createWorker([...OCR_LANGUAGES], OEM.LSTM_ONLY, {
          langPath: path.resolve(opts.tessdataDir),
          gzip: false,
          cacheMethod: 'none',
          logger: () => undefined,
          errorHandler: () => undefined,
        }),
      ),
    );
    pool.idle.push(...pool.all);
    return pool;
  }

  private acquire(): Promise<Worker> {
    const w = this.idle.pop();
    if (w) return Promise.resolve(w);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(w: Worker): void {
    const next = this.waiters.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  async recognize(image: Buffer, options: OcrOptions = {}): Promise<OcrResult> {
    const worker = await this.acquire();
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: (options.psm ?? '3') as PSM,
        tessedit_char_whitelist: options.whitelist ?? '',
        preserve_interword_spaces: '1',
      });
      const { data } = await worker.recognize(
        image,
        options.rectangle ? { rectangle: options.rectangle } : {},
        { text: true, blocks: true },
      );
      const lines: OcrLine[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            lines.push({
              text: line.text.trim(),
              confidence: line.confidence / 100,
              bbox: line.bbox,
              words: line.words.map((w) => ({
                text: w.text,
                confidence: w.confidence / 100,
                bbox: w.bbox,
              })),
            });
          }
        }
      }
      return {
        text: data.text,
        confidence: data.confidence / 100,
        lines: lines.filter((l) => l.text),
      };
    } finally {
      this.release(worker);
    }
  }

  async terminate(): Promise<void> {
    await Promise.all(this.all.map((w) => w.terminate()));
    this.all = [];
  }
}
