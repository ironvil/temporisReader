/** Settings layout: the main page lists languages; each language has its own page. */
import { expect, test } from '@playwright/test';
import { addChinese, closeSettings, openLanguageSettings } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
});

test('the main page lists each language with its status; a language opens its own page', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('.view.settings');
  await expect(settings.locator('.bar-heading')).toHaveText('Settings');
  await expect(settings.locator('.lang-link')).toHaveText(['Chinese · 中文Not added', 'French · FrançaisNot added']);
  // Language details live on their own pages, not the main page.
  await expect(settings.locator('[data-language]')).toHaveCount(0);
  await expect(settings.getByRole('heading', { name: 'Reading' })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Backup' })).toBeVisible();

  await settings.getByRole('button', { name: 'French' }).click();
  await expect(settings.locator('.bar-heading')).toHaveText('French');
  await expect(settings.locator('[data-language]')).toHaveCount(1);
  await expect(settings.locator('[data-language="fr"] .lang-status')).toHaveText('Not added · 60 MB download');
  await expect(settings.locator('[data-known-words="fr"]')).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Reading' })).toHaveCount(0);

  await settings.getByRole('button', { name: 'Back to settings' }).click();
  await expect(settings.locator('.bar-heading')).toHaveText('Settings');
  await settings.getByRole('button', { name: 'Close settings' }).click();
  await expect(settings).toBeHidden();
});

test('the list shows added languages and known-word counts', async ({ page }) => {
  await addChinese(page);
  await openLanguageSettings(page, 'zh');
  const file = JSON.stringify({ version: 1, updated: '2026-11-01', words: { 今天: [3, '2026-11-01'], 阳光: [1, '2026-11-01'] } });
  await page.getByTestId('known-words-import-zh').setInputFiles({ name: 'k.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await expect(page.getByText(/^Imported:/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to settings' }).click();
  await expect(page.locator('[data-language-link="zh"] .lang-link-status')).toHaveText('Added · 1 known words');
  await expect(page.locator('[data-language-link="fr"] .lang-link-status')).toHaveText('Not added');
});

test('reopening settings starts on the main page', async ({ page }) => {
  await openLanguageSettings(page, 'fr');
  await closeSettings(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.view.settings .bar-heading')).toHaveText('Settings');
});
