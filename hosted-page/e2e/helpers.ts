import { randomBytes } from 'node:crypto';
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { BASE_URL, readKeys, type E2eKeys } from './env';

export const RETURN_URL = 'https://integrator.test/done?ref=e2e';

export interface CreatedSession {
  id: string;
  hosted_url: string;
  status: string;
}

export async function createSession(
  request: APIRequestContext,
  apiKey: string,
  data: { locale?: 'en' | 'nb' } = {},
): Promise<CreatedSession> {
  const res = await request.post(`${BASE_URL}/v1/sessions`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    data: { return_url: RETURN_URL, ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as CreatedSession;
}

export async function getSessionStatus(
  request: APIRequestContext,
  apiKey: string,
  id: string,
): Promise<string> {
  const res = await request.get(`${BASE_URL}/v1/sessions/${id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { status: string }).status;
}

export function expectedRedirect(sessionId: string): string {
  return `${RETURN_URL}&session_id=${sessionId}&status=submitted`;
}

/** The integrator return page is not reachable in tests; serve a stub for it. */
export async function stubIntegrator(page: Page): Promise<void> {
  await page.context().route('https://integrator.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Integrator</title><h1>Integrator return page</h1>',
    }),
  );
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Records CSP violations on a page: console reports plus securitypolicyviolation events, which
 * are forwarded through an exposed binding so they survive navigations.
 */
export async function watchCsp(page: Page): Promise<() => string[]> {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(msg.text())) {
      violations.push(msg.text());
    }
  });
  await page.exposeFunction('__dlcReportCsp', (entry: string) => {
    violations.push(entry);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const report = (window as unknown as { __dlcReportCsp?: (s: string) => void }).__dlcReportCsp;
      report?.(`${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  return () => [...violations];
}

/**
 * Test with the e2e API keys and an automatic CSP guard: every test fails when the hosted page
 * reports a CSP violation.
 */
export const test = base.extend<{ keys: E2eKeys; cspGuard: void }>({
  // Playwright requires an object pattern for the fixtures argument.
  // eslint-disable-next-line no-empty-pattern
  keys: async ({}, use) => {
    await use(readKeys());
  },
  cspGuard: [
    async ({ page }, use) => {
      const violations = await watchCsp(page);
      await use();
      expect(violations(), 'CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Consent screen: tick the box and continue. */
export async function acceptConsent(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Check your driver license' })).toBeVisible();
  const cont = page.getByRole('button', { name: 'Continue' });
  await expect(cont).toBeDisabled();
  await page
    .getByLabel('I agree that my license images are processed to verify my license')
    .check();
  await cont.click();
}

/** Capture one side with the fake camera and upload it. */
export async function captureWithCamera(page: Page, heading: string): Promise<void> {
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  const take = page.getByRole('button', { name: 'Take photo' });
  await expect(take).toBeEnabled();
  await take.click();
  await expect(page.getByRole('heading', { name: 'Check the photo' })).toBeVisible();
  await expect(
    page.getByRole('img', { name: /Photo of the (front|back) of your license/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Use this photo' }).click();
}
