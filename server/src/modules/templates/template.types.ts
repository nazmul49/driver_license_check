import type { ExtractedDocument } from '../checks/types.js';
import type { CountryProfile } from '../countries/country-profile.js';
import type { OcrOptions, OcrResult } from '../ocr/ocr.types.js';

export interface ParseContext {
  profile: CountryProfile | null;
  minConfidence: number;
  /** Today as YYYY-MM-DD, used only to resolve two-digit years. */
  today: string;
}

/** Region OCR'd separately with tuned parameters (SPEC 6.1 step 6). Coordinates are 0..1. */
export interface TemplateZone {
  field: 'date_of_birth' | 'issue_date' | 'expiry_date' | 'license_number';
  side: 'front' | 'back';
  rect: { x: number; y: number; w: number; h: number };
  ocr: Omit<OcrOptions, 'rectangle'>;
}

export interface DocumentTemplate {
  id: string;
  version: string;
  /** 0..1 likelihood that the OCR'd front matches this layout. */
  score(front: OcrResult): number;
  /** Minimum score to accept the template. */
  threshold: number;
  zones: TemplateZone[];
  parse(front: OcrResult, back: OcrResult, ctx: ParseContext): Omit<ExtractedDocument, 'country'>;
}
