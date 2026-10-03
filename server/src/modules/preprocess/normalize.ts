import sharp from 'sharp';

export const NORMALIZED_LONG_EDGE = 2000;

/**
 * Apply EXIF orientation, drop metadata, cap the long edge (SPEC 6.1 step 2). Uploads were
 * already re-encoded at upload time; this is the processing-time normalization.
 */
export async function normalizeImage(
  input: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({
      width: NORMALIZED_LONG_EDGE,
      height: NORMALIZED_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Grayscale + contrast stretch, tuned for OCR. */
export async function prepareForOcr(input: Buffer, rotate = 0): Promise<Buffer> {
  return sharp(input).rotate(rotate).grayscale().normalise().png().toBuffer();
}
