const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function expand(hex: string): [number, number, number] {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Applies the integrator primary color through CSS custom properties set with the CSSOM, which
 * the nonce-based CSP allows (no inline style attributes). Only hex colors are accepted; the
 * text color on top of it is picked for the better contrast.
 */
export function applyPrimaryColor(color: string | null | undefined): void {
  const root = document.documentElement;
  if (!color || !HEX.test(color)) {
    root.style.removeProperty('--color-primary');
    root.style.removeProperty('--color-on-primary');
    return;
  }
  const lum = luminance(expand(color));
  const onPrimary = contrast(lum, 1) >= contrast(lum, 0) ? '#ffffff' : '#111827';
  root.style.setProperty('--color-primary', color);
  root.style.setProperty('--color-on-primary', onPrimary);
}
