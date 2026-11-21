/**
 * The installable web version (npm run build:web, src/web-app.ts), served from dist-web/. The
 * rest of the app is the same as the test build and is covered by tests/e2e.
 */
import { expect, test } from '@playwright/test';
import { closeSettings, fakeCedict, openLanguageSettings } from '../e2e/helpers';

test('it can be added to the home screen and opens without a connection', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();

  const manifest = await (await page.request.get(await page.locator('link[rel="manifest"]').getAttribute('href').then((h) => new URL(h!, page.url()).href))).json();
  expect(manifest).toMatchObject({ name: 'Temporis Reader', display: 'standalone', start_url: './' });
  for (const icon of [...manifest.icons.map((i: { src: string }) => i.src), 'icons/apple-touch-icon.png']) {
    const res = await page.request.get(icon);
    expect(res.ok(), icon).toBe(true);
    expect(res.headers()['content-type']).toBe('image/png');
  }

  // Once the service worker has everything, the app opens offline.
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated');
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await expect(page.locator('.view.library')).toBeVisible();
});

test('dictionaries come from the web version’s own copies, and those it has none of aren’t offered', async ({ page, context }) => {
  const requested: string[] = [];
  // context.route also sees the service worker's requests.
  await context.route('**/dictionaries/cc-cedict.txt.gz', (route) => {
    requested.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/gzip', body: fakeCedict() });
  });
  await context.route('https://www.mdbg.net/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();

  await openLanguageSettings(page, 'zh');
  const chinese = page.locator('[data-language="zh"]');
  await chinese.getByRole('button', { name: 'Add' }).click();
  await expect(chinese.locator('.lang-status')).toHaveText('Added');
  expect(requested).toEqual(['/dictionaries/cc-cedict.txt.gz']);

  // kaikki.org's Wiktionary extracts can't be downloaded here.
  await openLanguageSettings(page, 'fr');
  const french = page.locator('[data-language="fr"]');
  await expect(french.locator('.lang-status')).toHaveText(/^Not available in the web version yet/);
  await expect(french.getByRole('button', { name: 'Add' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to settings' }).click();
  await expect(page.locator('[data-language-link="fr"]')).toContainText('Not in the web version yet');
  await expect(page.locator('[data-language-link="zh"]')).toContainText('Added');

  // No folder for automatic backups; backups by hand, with a reminder of why.
  const settings = page.locator('.view.settings');
  await expect(settings.locator('[data-backup]')).toContainText('kept in this browser only');
  await expect(settings.locator('[data-auto-backup]')).toHaveCount(0);
  await closeSettings(page);
});
