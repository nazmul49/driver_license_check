import sharp from 'sharp';

/**
 * Renders synthetic EU-format licence cards with known values (SPEC 16 M5). These are not
 * replicas of any real document: plain layout, no security features, a grey box for the photo,
 * and the word SPECIMEN across the card. They exist to measure OCR and parsing accuracy.
 */
export interface CardData {
  surname: string;
  givenNames: string;
  dob: string; // DD.MM.YYYY as printed
  placeOfBirth: string;
  issueDate: string;
  expiryDate: string;
  authority: string;
  licenseNumber: string;
  categories: { code: string; issue: string; expiry: string; restrictions?: string }[];
  /** Categories printed on the back without dates (not held). */
  notHeld?: string[];
  title?: string;
  sign?: string;
}

export interface Variant {
  blur?: number;
  glare?: boolean;
  rotate?: 0 | 90 | 180 | 270;
  dark?: boolean;
  /** Card width in px inside the photo. */
  cardWidth?: number;
}

const W = 1712; // 85.6 mm at 20 px/mm
const H = 1080; // 54.0 mm
const FONT = 'DejaVu Sans, Arial, Helvetica, sans-serif';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function frontSvg(d: CardData): string {
  const x = 620;
  const line = (y: number, label: string, value: string) =>
    `<text x="${x}" y="${y}" font-family="${FONT}" font-size="54" fill="#111">${esc(label)} ${esc(value)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" rx="40" fill="#f2e6ec"/>
  <rect x="0" y="0" width="170" height="${H}" rx="40" fill="#1f3f9a"/>
  <text x="85" y="${H - 90}" text-anchor="middle" font-family="${FONT}" font-size="90" font-weight="bold" fill="#fff">${esc(d.sign ?? 'N')}</text>
  <text x="230" y="120" font-family="${FONT}" font-size="64" font-weight="bold" fill="#222">${esc(d.title ?? 'FØRERKORT NORGE')}</text>
  <rect x="220" y="230" width="340" height="440" fill="#b8b8b8"/>
  ${line(260, '1.', d.surname)}
  ${line(345, '2.', d.givenNames)}
  ${line(450, '3.', `${d.dob} ${d.placeOfBirth}`)}
  ${line(560, '4a.', d.issueDate)}
  ${line(665, '4b.', d.expiryDate)}
  ${line(770, '4c.', d.authority)}
  ${line(875, '5.', d.licenseNumber)}
  ${line(980, '9.', d.categories.map((c) => c.code).join(' '))}
  <text x="${W / 2}" y="${H / 2 + 60}" text-anchor="middle" font-family="${FONT}" font-size="150" fill="#d33" fill-opacity="0.12" transform="rotate(-18 ${W / 2} ${H / 2})">SPECIMEN</text>
</svg>`;
}

function backSvg(d: CardData): string {
  const rows = [
    ...d.categories.map((c) => [c.code, c.issue, c.expiry, c.restrictions ?? '']),
    ...(d.notHeld ?? []).map((c) => [c, '', '', '']),
  ];
  const cols = [80, 330, 760, 1190];
  const header = ['9.', '10.', '11.', '12.']
    .map(
      (h, i) =>
        `<text x="${cols[i]}" y="110" font-family="${FONT}" font-size="50" fill="#333">${h}</text>`,
    )
    .join('');
  const body = rows
    .map(
      (r, ri) =>
        `<line x1="60" x2="${W - 60}" y1="${140 + ri * 100}" y2="${140 + ri * 100}" stroke="#999" stroke-width="2"/>` +
        r
          .map((cell, ci) =>
            cell
              ? `<text x="${cols[ci]}" y="${210 + ri * 100}" font-family="${FONT}" font-size="54" fill="#111">${esc(cell)}</text>`
              : '',
          )
          .join(''),
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" rx="40" fill="#f2e6ec"/>
  ${header}${body}
  <text x="${W / 2}" y="${H - 60}" text-anchor="middle" font-family="${FONT}" font-size="40" fill="#555">SPECIMEN - SYNTHETIC TEST CARD</text>
</svg>`;
}

/** Card composited onto a uniform background, like a photo taken inside the framing guide. */
async function photograph(cardSvg: string, v: Variant): Promise<Buffer> {
  const cardWidth = v.cardWidth ?? 1500;
  const cardHeight = Math.round((cardWidth * H) / W);
  let card = sharp(Buffer.from(cardSvg)).resize(cardWidth, cardHeight);
  if (v.glare) {
    const glare = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cardWidth}" height="${cardHeight}">
        <ellipse cx="${cardWidth * 0.7}" cy="${cardHeight * 0.3}" rx="${cardWidth * 0.22}" ry="${cardHeight * 0.18}" fill="#fff"/>
      </svg>`,
    );
    card = sharp(await card.png().toBuffer()).composite([{ input: glare }]);
  }
  const margin = Math.round(cardWidth * 0.08);
  let photo = sharp(await card.png().toBuffer())
    .extend({
      top: margin,
      bottom: margin,
      left: margin,
      right: margin,
      background: { r: 38, g: 40, b: 44, alpha: 1 },
    })
    .flatten({ background: { r: 38, g: 40, b: 44 } });
  if (v.dark) photo = photo.linear(0.15, 0);
  let buf = await photo.png().toBuffer();
  if (v.blur) buf = await sharp(buf).blur(v.blur).png().toBuffer();
  if (v.rotate) buf = await sharp(buf).rotate(v.rotate).png().toBuffer();
  return sharp(buf).jpeg({ quality: 92 }).toBuffer();
}

export async function renderCard(d: CardData, v: Variant = {}, backVariant: Variant = v) {
  return {
    front: await photograph(frontSvg(d), v),
    back: await photograph(backSvg(d), backVariant),
  };
}

export const BASE_CARD: CardData = {
  surname: 'NORDMANN',
  givenNames: 'OLA',
  dob: '12.04.1990',
  placeOfBirth: 'OSLO',
  issueDate: '01.06.2021',
  expiryDate: '01.06.2036',
  authority: 'STATENS VEGVESEN',
  licenseNumber: '12345678901',
  categories: [{ code: 'B', issue: '10.05.2008', expiry: '01.06.2036' }],
  notHeld: ['AM', 'A1', 'C1'],
};

/** "DD.MM.YYYY" to "YYYY-MM-DD". */
export const iso = (d: string) => `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
