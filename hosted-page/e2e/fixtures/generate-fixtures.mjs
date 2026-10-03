/**
 * Generates the synthetic camera fixtures for the hosted page e2e suite. Run from the repo root:
 *   node hosted-page/e2e/fixtures/generate-fixtures.mjs
 * Outputs (committed): card.mjpeg (fake camera feed for Chromium) and card.jpg (file fallback).
 * The card is synthetic and holds no real personal data.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = path.dirname(fileURLToPath(import.meta.url));

function cardSvg(width, height) {
  const lines = [
    ['1.', 'SPECIMEN'],
    ['2.', 'TEST CARD'],
    ['3.', '01.01.1990 OSLO'],
    ['4a.', '01.01.2020'],
    ['4b.', '01.01.2035'],
    ['4c.', 'STATENS VEGVESEN'],
    ['5.', '00000000000'],
    ['9.', 'B'],
  ];
  const text = lines
    .map(
      ([label, value], i) =>
        `<text x="${width * 0.36}" y="${height * 0.2 + i * height * 0.085}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(height * 0.055)}" fill="#1f2937"><tspan font-weight="bold">${label}</tspan> ${value}</text>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" rx="${height * 0.06}" fill="#f3e8d2"/>
  <rect x="0" y="0" width="100%" height="${height * 0.11}" fill="#c2410c"/>
  <text x="${width * 0.04}" y="${height * 0.08}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(height * 0.06)}" font-weight="bold" fill="#ffffff">FORERKORT  DRIVING LICENCE  N</text>
  <rect x="${width * 0.05}" y="${height * 0.2}" width="${width * 0.26}" height="${height * 0.6}" fill="#9ca3af"/>
  <circle cx="${width * 0.18}" cy="${height * 0.4}" r="${height * 0.12}" fill="#6b7280"/>
  ${text}
</svg>`;
}

async function cardPng(width, height) {
  return sharp(Buffer.from(cardSvg(width, height)))
    .png()
    .toBuffer();
}

// Camera frame: dark desk background with the card filling most of a 1920x1080 frame.
const frameW = 1920;
const frameH = 1080;
const cardH = 860;
const cardW = Math.round(cardH * (85.6 / 53.98));
const frame = await sharp({
  create: { width: frameW, height: frameH, channels: 3, background: '#3f3f46' },
})
  .composite([
    {
      input: await cardPng(cardW, cardH),
      left: Math.round((frameW - cardW) / 2),
      top: Math.round((frameH - cardH) / 2),
    },
  ])
  .jpeg({ quality: 90 })
  .toBuffer();

// An MJPEG file for Chromium's fake capture device is concatenated JPEG frames.
writeFileSync(path.join(dir, 'card.mjpeg'), Buffer.concat([frame, frame]));

// File fallback upload: the card alone, landscape.
const still = await sharp(await cardPng(1600, Math.round(1600 * (53.98 / 85.6))))
  .flatten({ background: '#ffffff' })
  .jpeg({ quality: 92 })
  .toBuffer();
writeFileSync(path.join(dir, 'card.jpg'), still);

console.log('Wrote card.mjpeg and card.jpg');
