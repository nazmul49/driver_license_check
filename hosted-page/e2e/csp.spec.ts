import { createSession, expect, test, watchCsp } from './helpers';

test('loads under the strict CSP with no violations', async ({ browser, request, keys }) => {
  // A fresh page with its own watcher, so this test asserts explicitly (the auto guard also runs).
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();
  const violations = await watchCsp(page);
  try {
    const session = await createSession(request, keys.apiKey, { locale: 'en' });
    const response = await page.goto(session.hosted_url);
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');

    await expect(page.getByRole('heading', { name: 'Check your driver license' })).toBeVisible();
    await page
      .getByLabel('I agree that my license images are processed to verify my license')
      .check();
    await page.getByRole('button', { name: 'Continue' }).click();
    // Exercise the camera view, the frame overlay and the theme custom properties.
    await expect(page.getByRole('heading', { name: 'Front of your license' })).toBeVisible();
    await page.waitForTimeout(500);

    expect(violations()).toEqual([]);
  } finally {
    await context.close();
  }
});
