import type { ImageSide } from '@dlc/shared';
import sharp from 'sharp';
import type { Cradle } from '../../container.js';
import { emptyDocument, type ExtractedDocument, type ExtractedField } from '../checks/index.js';
import type { CountryProfile } from '../countries/country-profile.js';
import { detectCountry } from '../countries/detect-country.js';
import type { OcrEngine, OcrResult } from '../ocr/ocr.types.js';
import {
  analyzeSide,
  normalizeImage,
  prepareForOcr,
  type AnalyzedSide,
} from '../preprocess/index.js';
import {
  detectTemplate,
  parseZoneValue,
  type DocumentTemplate,
  type ParseContext,
} from '../templates/index.js';

/**
 * Below this mean OCR confidence the 180 degree rotation is also tried (SPEC 6.1 step 5).
 * Upside-down text can still score around 0.8, so the bar is high.
 */
const ORIENTATION_RETRY_CONFIDENCE = 0.88;
/** Page segmentation: automatic for the front, single column for the back category table. */
const PSM_FRONT = '3';
const PSM_BACK = '4';

interface OrientedOcr {
  ocr: OcrResult;
  image: Buffer;
  width: number;
  height: number;
}

export interface Extraction {
  doc: ExtractedDocument;
  detectedCountry: string | null;
  profile: CountryProfile | null;
  templateScore: number;
  ocrConfidence: number;
  rawText: { front: string; back: string };
}

export type StepTimer = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
const untimed: StepTimer = (_name, fn) => fn();

/**
 * The image and OCR part of the pipeline (SPEC 6.1 steps 2 to 10) with no database access, so
 * it can be measured on the fixture set and run under a network block in tests.
 */
export class DocumentAnalyzer {
  private readonly ocr: () => OcrEngine;
  private readonly profiles: CountryProfile[];
  private readonly minConfidence: number;
  private readonly aspectTolerance: number;

  constructor(c: Pick<Cradle, 'ocrEngine' | 'countryProfiles' | 'config'>) {
    // Resolved lazily: the API process never touches OCR.
    this.ocr = () => c.ocrEngine;
    this.profiles = c.countryProfiles;
    this.minConfidence = c.config.FIELD_MIN_CONFIDENCE;
    this.aspectTolerance = c.config.QUALITY_ASPECT_TOLERANCE;
  }

  /** Steps 2 to 4: normalize, card detection, quality metrics. */
  async analyzeImages(originals: Record<ImageSide, Buffer>, time: StepTimer = untimed) {
    return time('preprocess', async () => {
      const out = {} as Record<ImageSide, AnalyzedSide>;
      for (const side of ['front', 'back'] as const) {
        const normalized = await normalizeImage(originals[side]);
        out[side] = await analyzeSide(normalized.data, this.aspectTolerance);
      }
      return out;
    });
  }

  /** Steps 5 to 10: orientation, OCR, template, country, field parsing. */
  async extract(
    sides: Record<ImageSide, AnalyzedSide>,
    countryHint: string | null,
    today: string,
    time: StepTimer = untimed,
  ): Promise<Extraction> {
    const front = await time('ocr_front', () =>
      this.orientedOcr(sides.front.card.image, PSM_FRONT),
    );
    const back = await time('ocr_back', () => this.orientedOcr(sides.back.card.image, PSM_BACK));
    const { template, score } = detectTemplate(front.ocr);
    const country = detectCountry(front.ocr, back.ocr, countryHint, this.profiles);
    const profile = this.profiles.find((p) => p.code === country.applied) ?? null;
    const ctx: ParseContext = { profile, minConfidence: this.minConfidence, today };

    let doc: ExtractedDocument;
    if (template) {
      doc = { ...template.parse(front.ocr, back.ocr, ctx), country: country.applied };
      await time('zone_ocr', () => this.refineWithZones(template, doc, front, ctx));
    } else {
      doc = { ...emptyDocument(), country: country.applied };
    }
    return {
      doc,
      detectedCountry: country.detected,
      profile,
      templateScore: Math.round(score * 100) / 100,
      ocrConfidence: (front.ocr.confidence + back.ocr.confidence) / 2,
      rawText: { front: front.ocr.text, back: back.ocr.text },
    };
  }

  get engineVersion(): string {
    return this.ocr().version;
  }

  private async orientedOcr(card: Buffer, psm: '3' | '4'): Promise<OrientedOcr> {
    const engine = this.ocr();
    const meta = await sharp(card).metadata();
    let best: OrientedOcr | null = null;
    for (const rotation of [0, 180]) {
      const image = await prepareForOcr(card, rotation);
      const ocr = await engine.recognize(image, { psm });
      if (!best || ocr.confidence > best.ocr.confidence) {
        best = { ocr, image, width: meta.width ?? 0, height: meta.height ?? 0 };
      }
      if (ocr.confidence >= ORIENTATION_RETRY_CONFIDENCE) break;
    }
    return best!;
  }

  /** Re-read missing or low-confidence fields from their template zone (SPEC 6.1 step 6). */
  private async refineWithZones(
    template: DocumentTemplate,
    doc: ExtractedDocument,
    front: OrientedOcr,
    ctx: ParseContext,
  ): Promise<void> {
    const engine = this.ocr();
    for (const zone of template.zones) {
      if (zone.side !== 'front') continue;
      const current: ExtractedField = doc.fields[zone.field];
      if (current.value !== null || current.invalid) continue;
      const rectangle = {
        left: Math.round(zone.rect.x * front.width),
        top: Math.round(zone.rect.y * front.height),
        width: Math.round(zone.rect.w * front.width),
        height: Math.round(zone.rect.h * front.height),
      };
      const result = await engine.recognize(front.image, { ...zone.ocr, rectangle });
      const refined = parseZoneValue(zone.field, result, ctx);
      if (refined.value !== null && refined.confidence >= current.confidence)
        doc.fields[zone.field] = refined;
    }
  }
}
