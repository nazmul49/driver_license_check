import type { ImageMetrics } from '../checks/types.js';
import { detectCard, type DetectedCard } from './card-detection.js';
import { perceptualHash, pixelStats } from './image-metrics.js';

export * from './card-detection.js';
export * from './image-metrics.js';
export * from './normalize.js';

export interface AnalyzedSide {
  card: DetectedCard;
  metrics: ImageMetrics;
}

/** Card detection plus quality metrics for one side. */
export async function analyzeSide(
  normalized: Buffer,
  aspectTolerance: number,
): Promise<AnalyzedSide> {
  const card = await detectCard(normalized, aspectTolerance);
  const [stats, phash] = await Promise.all([pixelStats(card.image), perceptualHash(card.image)]);
  return {
    card,
    metrics: {
      detected: card.detected,
      width: card.width,
      height: card.height,
      aspectRatio: card.aspectRatio,
      ...stats,
      phash,
    },
  };
}
