export interface OcrWord {
  text: string;
  /** 0..1 */
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrLine {
  text: string;
  /** 0..1 */
  confidence: number;
  words: OcrWord[];
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  text: string;
  /** Mean confidence 0..1 */
  confidence: number;
  lines: OcrLine[];
}

export interface OcrOptions {
  /** Tesseract page segmentation mode. */
  psm?: '3' | '4' | '6' | '7' | '11';
  whitelist?: string;
  /** Region in pixels. */
  rectangle?: { left: number; top: number; width: number; height: number };
}

export interface OcrEngine {
  readonly version: string;
  recognize(image: Buffer, options?: OcrOptions): Promise<OcrResult>;
  terminate(): Promise<void>;
}
