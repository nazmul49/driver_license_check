import { readFileSync } from 'node:fs';
import path from 'node:path';
import { devices, request as playwrightRequest } from '@playwright/test';
import { BASE_URL, fixturesDir } from './env';
import { acceptConsent, createSession, expect, expectedRedirect, test } from './helpers';

test.use({ ...devices['Desktop Chrome'], permissions: ['camera'] });

test('desktop shows a QR code and follows the redirect when the phone finishes', async ({
  page,
  request,
  keys,
}) => {
  const session = await createSession(request, keys.apiKey, { locale: 'en' });
  await page.context().route('https://integrator.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>ok</title>',
    }),
  );

  await page.goto(session.hosted_url);
  await acceptConsent(page);
  await expect(page.getByRole('heading', { name: 'Continue on your phone' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code with the link to this page' })).toBeVisible();

  // The "phone": a separate client that reopens the same link (allow_reopen) and finishes.
  const phone = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const token = new URL(session.hosted_url).pathname.split('/').pop()!;
    expect((await phone.post('/hosted/api/session/open', { data: { token } })).ok()).toBe(true);
    const card = readFileSync(path.join(fixturesDir, 'card.jpg'));
    for (const side of ['front', 'back']) {
      const res = await phone.post(`/hosted/api/session/images/${side}`, {
        multipart: { file: { name: `${side}.jpg`, mimeType: 'image/jpeg', buffer: card } },
      });
      expect(res.ok(), await res.text()).toBe(true);
    }
    expect((await phone.post('/hosted/api/session/submit')).ok()).toBe(true);
  } finally {
    await phone.dispose();
  }

  await page.waitForURL('https://integrator.test/**', { timeout: 15_000 });
  expect(page.url()).toBe(expectedRedirect(session.id));
});

test('desktop can continue on the same device instead', async ({ page, request, keys }) => {
  const session = await createSession(request, keys.apiKey, { locale: 'en' });
  await page.goto(session.hosted_url);
  await acceptConsent(page);
  await page.getByRole('button', { name: 'Continue on this device' }).click();
  await expect(page.getByRole('heading', { name: 'Front of your license' })).toBeVisible();
});
