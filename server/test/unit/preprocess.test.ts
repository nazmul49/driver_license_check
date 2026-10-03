import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  analyzeSide,
  detectCard,
  hammingDistance,
  laplacianVariance,
  normalizeImage,
  perceptualHash,
  pixelStats,
} from '../../src/modules/preprocess/index.js';
import { loadFixture } from '../helpers/ocr.js';

describe('preprocessing', () => {
  it('detects the card on a uniform background and measures quality', async () => {
    const { front } = await loadFixture('valid');
    const n = await normalizeImage(front);
    expect(Math.max(n.width, n.height)).toBeLessThanOrEqual(2000);
    const a = await analyzeSide(n.data, 0.05);
    expect(a.metrics.detected).toBe(true);
    expect(a.metrics.aspectRatio).toBeCloseTo(1.586, 1);
    expect(a.metrics.blurVariance).toBeGreaterThan(200);
  });

  it('blurred and dark fixtures score low', async () => {
    const blurred = await analyzeSide(
      (await normalizeImage((await loadFixture('blurred')).front)).data,
      0.05,
    );
    expect(blurred.metrics.blurVariance).toBeLessThan(60);
    const dark = await pixelStats((await loadFixture('too-dark')).front);
    expect(dark.meanLuminance).toBeLessThan(50);
  });

  it('rotates portrait cards to landscape', async () => {
    const { front } = await loadFixture('valid');
    const portrait = await sharp(front).rotate(90).jpeg().toBuffer();
    const card = await detectCard(portrait, 0.05);
    expect(card.detected).toBe(true);
    expect(card.width).toBeGreaterThan(card.height);
  });

  it('reports no card for images with the wrong shape', async () => {
    const square = await sharp({
      create: { width: 800, height: 800, channels: 3, background: '#888' },
    })
      .jpeg()
      .toBuffer();
    expect((await detectCard(square, 0.05)).detected).toBe(false);
  });

  it('perceptual hash: same image close, different images far', async () => {
    const a = await loadFixture('valid');
    const h1 = await perceptualHash(a.front);
    const h2 = await perceptualHash(await sharp(a.front).jpeg({ quality: 60 }).toBuffer());
    const h3 = await perceptualHash(a.back);
    expect(hammingDistance(h1, h2)).toBeLessThanOrEqual(4);
    expect(hammingDistance(h1, h3)).toBeGreaterThan(10);
    expect(hammingDistance('ff', 'ff')).toBe(0);
  });

  it('laplacian variance of a flat image is 0', () => {
    expect(laplacianVariance(Buffer.alloc(100, 128), 10, 10)).toBe(0);
    expect(laplacianVariance(Buffer.alloc(1), 1, 1)).toBe(0);
  });
});
