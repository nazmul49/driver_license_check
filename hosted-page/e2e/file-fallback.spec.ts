import path from 'node:path';
import { fixturesDir } from './env';
import {
  acceptConsent,
  createSession,
  expect,
  expectedRedirect,
  getSessionStatus,
  stubIntegrator,
  test,
} from './helpers';

const CARD = path.join(fixturesDir, 'card.jpg');

test.beforeEach(async ({ page }) => {
  // Simulate the user denying camera access.
  await page.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
});

test('falls back to a file picker when the camera is denied', async ({ page, request, keys }) => {
  const session = await createSession(request, keys.apiKey, { locale: 'en' });
  await stubIntegrator(page);
  await page.goto(session.hosted_url);
  await acceptConsent(page);

  for (const heading of ['Front of your license', 'Back of your license']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Camera not available' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Take photo' })).toHaveCount(0);
    await page.getByLabel('Choose or take a photo').setInputFiles(CARD);
    await expect(page.getByRole('heading', { name: 'Check the photo' })).toBeVisible();
    await expect(page.getByText('The photo looks clear.')).toBeVisible();
    await page.getByRole('button', { name: 'Use this photo' }).click();
  }

  await page.waitForURL('https://integrator.test/**', { timeout: 10_000 });
  expect(page.url()).toBe(expectedRedirect(session.id));
  expect(await getSessionStatus(request, keys.apiKey, session.id)).toBe('submitted');
});
