/** Long edge limit and JPEG quality for uploads (SPEC 10.4). */
export const MAX_LONG_EDGE = 3000;
export const JPEG_QUALITY = 0.92;

/** Soft client-side thresholds. The server runs the real checks (SPEC 7.1). */
export const QUALITY = {
  minLongEdge: 1000,
  minBrightness: 50,
  maxBrightness: 225,
  /** Laplacian variance measured on the downscaled analysis canvas. */
  minSharpness: 25,
  analysisLongEdge: 512,
} as const;

export interface CapturedImage {
  blob: Blob;
  width: number;
  height: number;
  url: string;
}

export type QualityWarning = 'low_resolution' | 'too_dark' | 'too_bright' | 'blurry';

export interface QualityReport {
  width: number;
  height: number;
  brightness: number;
  sharpness: number;
  warnings: QualityWarning[];
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context is not available');
  return ctx;
}

/** Draws a source region scaled so the long edge is at most MAX_LONG_EDGE, then encodes JPEG. */
async function encodeRegion(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Promise<CapturedImage> {
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = context2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas);
  return { blob, width: canvas.width, height: canvas.height, url: URL.createObjectURL(blob) };
}

/**
 * Captures the part of the video that sits inside the on-screen frame overlay, so the card fills
 * the image. The video is rendered with object-fit: cover, so the overlay rectangle is mapped
 * back through the cover transform into video pixels.
 */
export function captureFrame(video: HTMLVideoElement, frame: HTMLElement): Promise<CapturedImage> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return Promise.reject(new Error('Camera is not ready'));
  const vr = video.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  const scale = Math.max(vr.width / vw, vr.height / vh);
  const offX = (vr.width - vw * scale) / 2;
  const offY = (vr.height - vh * scale) / 2;
  const x0 = Math.max(0, (fr.left - vr.left - offX) / scale);
  const y0 = Math.max(0, (fr.top - vr.top - offY) / scale);
  const x1 = Math.min(vw, (fr.right - vr.left - offX) / scale);
  const y1 = Math.min(vh, (fr.bottom - vr.top - offY) / scale);
  if (x1 - x0 < 1 || y1 - y0 < 1) return encodeRegion(video, 0, 0, vw, vh);
  return encodeRegion(video, x0, y0, x1 - x0, y1 - y0);
}

/**
 * Normalizes a picked file: decode, cap the long edge, re-encode as JPEG. When the browser cannot
 * decode the file (for example HEIC outside Safari) the original file is returned unchanged and
 * the server validates it.
 */
export async function normalizeFile(file: File): Promise<CapturedImage> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return await encodeRegion(bitmap, 0, 0, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch {
    return { blob: file, width: 0, height: 0, url: URL.createObjectURL(file) };
  }
}

/** Mean luminance and Laplacian variance on a downscaled grayscale copy. */
export async function analyzeImage(image: CapturedImage): Promise<QualityReport | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image.blob);
  } catch {
    return null;
  }
  const width = image.width || bitmap.width;
  const height = image.height || bitmap.height;
  const scale = Math.min(1, QUALITY.analysisLongEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(3, Math.round(bitmap.width * scale));
  const h = Math.max(3, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = context2d(canvas);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    const y = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    gray[p] = y;
    sum += y;
  }
  const brightness = sum / gray.length;

  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const lap = gray[p - w]! + gray[p + w]! + gray[p - 1]! + gray[p + 1]! - 4 * gray[p]!;
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const mean = n ? lapSum / n : 0;
  const sharpness = n ? lapSq / n - mean * mean : 0;

  const warnings: QualityWarning[] = [];
  if (Math.max(width, height) < QUALITY.minLongEdge) warnings.push('low_resolution');
  if (brightness < QUALITY.minBrightness) warnings.push('too_dark');
  if (brightness > QUALITY.maxBrightness) warnings.push('too_bright');
  if (sharpness < QUALITY.minSharpness) warnings.push('blurry');
  return { width, height, brightness, sharpness, warnings };
}
