import sharp from 'sharp';

/**
 * Pixel statistics used by the image quality checks (SPEC 7.1). All values are computed on a
 * downscaled grayscale copy so cost does not depend on the camera resolution.
 */
export interface PixelStats {
  blurVariance: number;
  glareRatio: number;
  meanLuminance: number;
}

const ANALYSIS_LONG_EDGE = 1000;
const GLARE_LEVEL = 250;

export async function grayscaleRaw(input: Buffer, longEdge = ANALYSIS_LONG_EDGE) {
  const { data, info } = await sharp(input)
    .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Variance of the 4-neighbour Laplacian: low values mean a blurry image. */
export function laplacianVariance(data: Buffer, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = data[i - width]! + data[i + width]! + data[i - 1]! + data[i + 1]! - 4 * data[i]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export async function pixelStats(input: Buffer): Promise<PixelStats> {
  const { data, width, height } = await grayscaleRaw(input);
  let total = 0;
  let glare = 0;
  for (let i = 0; i < data.length; i++) {
    total += data[i]!;
    if (data[i]! >= GLARE_LEVEL) glare++;
  }
  return {
    blurVariance: laplacianVariance(data, width, height),
    glareRatio: data.length ? glare / data.length : 0,
    meanLuminance: data.length ? total / data.length : 0,
  };
}

/** 64-bit DCT perceptual hash as 16 hex chars. */
export async function perceptualHash(input: Buffer): Promise<string> {
  const N = 32;
  const { data } = await sharp(input)
    .grayscale()
    .resize(N, N, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cos: number[][] = [];
  for (let k = 0; k < 8; k++) {
    cos.push(Array.from({ length: N }, (_, n) => Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N))));
  }
  const coeffs: number[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) s += data[y * N + x]! * cos[u]![y]! * cos[v]![x]!;
      }
      coeffs.push(s);
    }
  }
  // Skip the DC term when computing the median.
  const median = [...coeffs.slice(1)].sort((a, b) => a - b)[Math.floor((coeffs.length - 1) / 2)]!;
  let hash = 0n;
  for (const c of coeffs) hash = (hash << 1n) | (c > median ? 1n : 0n);
  return hash.toString(16).padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
