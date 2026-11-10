import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addChinese, chineseBook, importBook, openFirstBook, tapText } from './helpers';

const todayIn = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

const status = (page: Page) => page.locator('.lookup-popup .word-status');
const pressed = (page: Page) => status(page).locator('[aria-pressed="true"]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await addChinese(page);
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
});

test('status buttons under the translation set and remember a word’s level', async ({ page }) => {
  await tapText(page, '头发');
  await expect(status(page).getByRole('button')).toHaveText(['0', '1', '2', '✓']);
  await expect(pressed(page)).toHaveCount(0); // not tracked yet

  await status(page).getByRole('button', { name: 'Level 1' }).click();
  await expect(pressed(page)).toHaveText('1');
  await status(page).getByRole('button', { name: 'Known' }).click();
  await expect(pressed(page)).toHaveText('✓');

  // Another word is independent; coming back shows the saved level.
  await tapText(page, '阳光');
  await expect(pressed(page)).toHaveCount(0);
  await tapText(page, '头发', 1);
  await expect(pressed(page)).toHaveText('✓');

  // Survives a restart.
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await openFirstBook(page);
  await tapText(page, '头发');
  await expect(pressed(page)).toHaveText('✓');
});

test('status row stays visible when long entries scroll', async ({ page }) => {
  await page.getByRole('button', { name: 'Library' }).click();
  await importBook(page, 'le.txt', '第一章\n她来了。\n');
  await page.locator('.book-open', { hasText: 'le' }).click();
  await expect(page.locator('.book-title')).toHaveText('le');
  await tapText(page, '了');
  await expect(page.locator('.defs li')).toHaveCount(30);
  const visible = await page.evaluate(() => {
    const popup = document.querySelector('.lookup-popup')!.getBoundingClientRect();
    const row = document.querySelector('.word-status')!.getBoundingClientRect();
    return row.top >= popup.top && row.bottom <= popup.bottom;
  });
  expect(visible).toBe(true);
});

test('export known words from settings in the known-words format', async ({ page }) => {
  await tapText(page, '头发');
  await status(page).getByRole('button', { name: 'Known' }).click();
  await tapText(page, '阳光');
  await status(page).getByRole('button', { name: 'Level 2' }).click();
  await expect(pressed(page)).toHaveText('2');

  await page.getByRole('button', { name: 'Settings' }).click();
  const row = page.locator('[data-known-words="zh"]');
  await expect(row.locator('.known-summary')).toHaveText('2 words · 1 known');

  const date = await todayIn(page);
  const downloadPromise = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Export known words' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`known-words-zh-${date}.json`);
  const text = await readFile((await download.path())!, 'utf8');
  expect(text).toBe(
    ['{', '  "version": 1,', `  "updated": "${date}",`, '  "words": {', `    "头发": [3, "${date}"],`, `    "阳光": [2, "${date}"]`, '  }', '}', ''].join('\n'),
  );
});

test('settings shows when nothing is marked yet', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('[data-known-words="zh"] .known-summary')).toHaveText('None marked yet');
});
