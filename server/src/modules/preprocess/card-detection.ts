import sharp from 'sharp';

export const ID1_RATIO = 85.6 / 53.98;

export interface DetectedCard {
  /** Cropped, landscape-oriented card image (JPEG). Whole image when not detected. */
  image: Buffer;
  detected: boolean;
  width: number;
  height: number;
  aspectRatio: number;
}

/**
 * v1 card detection (SPEC 4 default): the hosted page crops captures to an ID-1 framing guide,
 * and the server trims a uniform background with sharp. The result counts as a card when its
 * aspect ratio is ID-1 within the tolerance. Portrait results are rotated to landscape; the
 * 0/180 ambiguity is resolved later by OCR confidence. OpenCV contour detection with
 * perspective correction is the planned upgrade for photos with busy backgrounds.
 */
export async function detectCard(input: Buffer, tolerance: number): Promise<DetectedCard> {
  const within = (r: number) => Math.abs(r - ID1_RATIO) / ID1_RATIO <= tolerance;
  const candidates: Buffer[] = [];
  try {
    candidates.push(await sharp(input).trim({ threshold: 40 }).jpeg({ quality: 95 }).toBuffer());
  } catch {
    // trim throws when the whole image is one colour; fall through to the full image
  }
  candidates.push(input);

  let fallback: DetectedCard | null = null;
  for (const candidate of candidates) {
    const meta = await sharp(candidate).metadata();
    let w = meta.width ?? 0;
    let h = meta.height ?? 0;
    let image = candidate;
    if (h > w) {
      image = await sharp(candidate).rotate(90).jpeg({ quality: 95 }).toBuffer();
      [w, h] = [h, w];
    }
    const ratio = h ? w / h : 0;
    const card = { image, detected: within(ratio), width: w, height: h, aspectRatio: ratio };
    if (card.detected) return card;
    fallback ??= card;
  }
  return fallback!;
}
