import {
  acceptConsent,
  captureWithCamera,
  createSession,
  expect,
  expectedRedirect,
  getSessionStatus,
  stubIntegrator,
  test,
} from './helpers';

test('captures both sides with the camera, submits and returns to the integrator', async ({
  page,
  request,
  keys,
}) => {
  const session = await createSession(request, keys.apiKey, { locale: 'en' });
  await stubIntegrator(page);

  await page.goto(session.hosted_url);
  await expect(page.getByText('E2E Rentals').first()).toBeVisible();
  await acceptConsent(page);

  await captureWithCamera(page, 'Front of your license');
  await captureWithCamera(page, 'Back of your license');

  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  await expect(page.getByText('Thanks, you can return to E2E Rentals.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to E2E Rentals' })).toBeVisible();
  // The result is never shown to the end user.
  await expect(page.getByText(/approved|rejected|authentic|genuine/i)).toHaveCount(0);

  await page.waitForURL('https://integrator.test/**', { timeout: 10_000 });
  expect(page.url()).toBe(expectedRedirect(session.id));

  expect(await getSessionStatus(request, keys.apiKey, session.id)).toBe('submitted');
});

test('applies the integrator primary color through a CSS custom property', async ({
  page,
  request,
  keys,
}) => {
  const session = await createSession(request, keys.apiKey, { locale: 'en' });
  await page.goto(session.hosted_url);
  await expect(page.getByRole('heading', { name: 'Check your driver license' })).toBeVisible();
  const color = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--color-primary'),
  );
  expect(color).toBe('#0f766e');
});
