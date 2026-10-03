/** True on a desktop-like device: no touch input and a fine primary pointer. */
export function isDesktopDevice(): boolean {
  const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const fine = window.matchMedia?.('(pointer: fine)').matches ?? true;
  return !touch && fine;
}

export function hasCameraApi(): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/**
 * Best-effort check for a rear camera without asking for permission. Device labels are only
 * exposed after permission was granted, so an unlabeled camera on a desktop counts as unknown
 * (treated as not usable for capturing a document).
 */
export async function hasRearCamera(): Promise<boolean> {
  if (!navigator.mediaDevices?.enumerateDevices) return false;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'videoinput' && /back|rear|environment/i.test(d.label));
  } catch {
    return false;
  }
}
