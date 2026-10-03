import { createSession, expect, test } from './helpers';

test('renders Norwegian when the session locale is nb', async ({ page, request, keys }) => {
  const session = await createSession(request, keys.apiKey, { locale: 'nb' });
  await page.goto(session.hosted_url);

  await expect(page.getByRole('heading', { name: 'Sjekk førerkortet ditt' })).toBeVisible();
  await expect(
    page.getByLabel(
      'Jeg samtykker i at bildene av førerkortet mitt behandles for å verifisere førerkortet',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fortsett' })).toBeDisabled();
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
});

test.describe('without a session locale', () => {
  test.use({ locale: 'nn-NO' });

  test('falls back to the browser language and maps nn to nb', async ({ page, request, keys }) => {
    const session = await createSession(request, keys.apiKey);
    await page.goto(session.hosted_url);
    await expect(page.getByRole('heading', { name: 'Sjekk førerkortet ditt' })).toBeVisible();
  });
});
