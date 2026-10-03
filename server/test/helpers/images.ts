import sharp from 'sharp';

/** A plain test image (not a card). Different seeds give visually different images. */
export async function testJpeg(seed = 0, width = 1600, height = 1009): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="rgb(${(seed * 70) % 255},120,${200 - ((seed * 40) % 150)})"/>
    <circle cx="${300 + seed * 200}" cy="400" r="200" fill="white"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}
