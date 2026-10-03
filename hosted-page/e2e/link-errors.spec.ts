import { BASE_URL } from './env';
import { createSession, expect, randomToken, test } from './helpers';

test('an unknown link shows the invalid link screen', async ({ page }) => {
  await page.goto(`${BASE_URL}/s/${randomToken()}`);
  await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('This link is not valid.');
});

test('a cancelled link shows the expired screen', async ({ page, request, keys }) => {
  const session = await createSession(request, keys.apiKey, { locale: 'en' });
  const res = await request.delete(`${BASE_URL}/v1/sessions/${session.id}`, {
    headers: { Authorization: `Bearer ${keys.apiKey}` },
  });
  expect(res.status()).toBe(204);

  await page.goto(session.hosted_url);
  await expect(page.getByRole('heading', { name: 'Link expired' })).toBeVisible();
});

test('a link reopened from another device shows the already used screen', async ({
  page,
  browser,
  request,
  keys,
}) => {
  // This integrator does not allow reopen, so the token is single use.
  const session = await createSession(request, keys.apiKeyNoReopen, { locale: 'en' });
  await page.goto(session.hosted_url);
  await expect(page.getByRole('heading', { name: 'Check your driver license' })).toBeVisible();

  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await otherPage.goto(session.hosted_url);
    await expect(otherPage.getByRole('heading', { name: 'Link already used' })).toBeVisible();
  } finally {
    await other.close();
  }

  // The first device keeps working through its session cookie.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Check your driver license' })).toBeVisible();
});
