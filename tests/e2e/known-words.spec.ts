import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addChinese, chineseBook, closeSettings, dismissLanguageReminder, importBook, openFirstBook, openLanguageSettings, tapText } from './helpers';

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
  await expect(pressed(page)).toHaveText('1'); // not tracked yet: looking it up adds it at 1

  await status(page).getByRole('button', { name: 'Level 1' }).click();
  await expect(pressed(page)).toHaveText('1');
  await status(page).getByRole('button', { name: 'Known' }).click();
  await expect(pressed(page)).toHaveText('✓');
  await status(page).getByRole('button', { name: 'Level 2' }).click();
  await expect(pressed(page)).toHaveText('2');

  // Another word is independent; coming back shows the saved level.
  // (Not ✓: looking up a known word moves it back to 2, tested in mark-known.spec.ts.)
  await tapText(page, '阳光');
  await expect(pressed(page)).toHaveText('1');
  await tapText(page, '头发', 1);
  await expect(pressed(page)).toHaveText('2');

  // Survives a restart.
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await openFirstBook(page);
  await tapText(page, '头发');
  await expect(pressed(page)).toHaveText('2');
});

test('status row stays visible when long entries scroll', async ({ page }) => {
  await page.getByRole('button', { name: 'Library' }).click();
  await importBook(page, 'le.txt', '第一章\n她来了。\n');
  await page.locator('.book-open', { hasText: 'le' }).click();
  await expect(page.locator('.book-title')).toHaveText('le');
  await dismissLanguageReminder(page);
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

  await openLanguageSettings(page, 'zh');
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
  await openLanguageSettings(page, 'zh');
  await expect(page.locator('[data-known-words="zh"] .known-summary')).toHaveText('None marked yet');
});

test('import a known-words file to start off with, then look words up', async ({ page }) => {
  const file = ['{', '  "version": 1,', '  "updated": "2026-11-01",', '  "words": {', '    "头发": [3, "2026-11-01"],', '    "阳光": [1, "2026-11-01"]', '  }', '}', ''].join('\n');
  await openLanguageSettings(page, 'zh');
  const row = page.locator('[data-known-words="zh"]');
  await row.getByTestId('known-words-import-zh').setInputFiles({ name: 'known-words.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await expect(page.getByText('Imported: 2 new, 0 updated')).toBeVisible();
  await expect(row.locator('.known-summary')).toHaveText('2 words · 1 known');
  await closeSettings(page);

  // 头发 (✓) isn't looked up here: that would move it back to 2 and change the export below.
  await tapText(page, '阳光');
  await expect(pressed(page)).toHaveText('1');

  // Exporting straight back gives the same entries (dates untouched by import).
  await openLanguageSettings(page, 'zh');
  const downloadPromise = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Export known words' }).click();
  const text = await readFile((await (await downloadPromise).path())!, 'utf8');
  expect(text).toBe(file.replace('"updated": "2026-11-01"', `"updated": "${await todayIn(page)}"`));
});

test('importing something that is not a known-words file is reported', async ({ page }) => {
  await openLanguageSettings(page, 'zh');
  const row = page.locator('[data-known-words="zh"]');
  await row.getByTestId('known-words-import-zh').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
  await expect(page.getByText('Import failed: not a JSON file')).toBeVisible();
  await row.getByTestId('known-words-import-zh').setInputFiles({ name: 'y.json', mimeType: 'application/json', buffer: Buffer.from('[1]') });
  await expect(page.getByText('Import failed: Not a known-words file')).toBeVisible();
  await expect(row.locator('.known-summary')).toHaveText('None marked yet');
});

test.describe('import with "replace" ticked', () => {
  const existing = ['{', '  "version": 1,', '  "updated": "2026-11-01",', '  "words": {', '    "头发": [3, "2026-11-01"],', '    "阳光": [1, "2026-11-01"]', '  }', '}', ''].join('\n');
  const replacement = ['{', '  "version": 1,', '  "updated": "2026-10-01",', '  "words": {', '    "今天": [2, "2026-09-01"],', '    "阳光": [3, "2026-09-01"]', '  }', '}', ''].join('\n');

  async function importFile(page: Page, name: string, text: string) {
    await page.getByTestId('known-words-import-zh').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
  }

  async function exported(page: Page) {
    const download = page.waitForEvent('download');
    await page.locator('[data-known-words="zh"]').getByRole('button', { name: 'Export known words' }).click();
    return readFile((await (await download).path())!, 'utf8');
  }

  test.beforeEach(async ({ page }) => {
    await openLanguageSettings(page, 'zh');
    await importFile(page, 'existing.json', existing);
    await expect(page.locator('[data-known-words="zh"] .known-summary')).toHaveText('2 words · 1 known');
  });

  test('clears the list and loads the file exactly', async ({ page }) => {
    await page.locator('[data-known-words="zh"]').getByLabel('Replace current list instead of merging').check();
    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      void d.accept();
    });
    await importFile(page, 'replacement.json', replacement);
    await expect(page.getByText('Replaced: 2 words')).toBeVisible();
    expect(message).toBe('Replace your 2 known words with the 2 in replacement.json? The current list will be cleared.');
    await expect(page.locator('[data-known-words="zh"] .known-summary')).toHaveText('2 words · 1 known');
    expect(await exported(page)).toBe(replacement); // 头发 gone, dates and "updated" from the file

    await closeSettings(page);
    await tapText(page, '头发');
    await expect(pressed(page)).toHaveCount(0);
    await tapText(page, '今天');
    await expect(pressed(page)).toHaveText('2');
  });

  test('cancelling the confirmation keeps the current list', async ({ page }) => {
    await page.locator('[data-known-words="zh"]').getByLabel('Replace current list instead of merging').check();
    page.once('dialog', (d) => void d.dismiss());
    await importFile(page, 'replacement.json', replacement);
    await expect(page.locator('[data-known-words="zh"] .known-summary')).toHaveText('2 words · 1 known');
    expect(await exported(page)).toBe(existing.replace('"updated": "2026-11-01"', `"updated": "${await todayIn(page)}"`));
  });

  test('an invalid file is rejected before anything is cleared', async ({ page }) => {
    await page.locator('[data-known-words="zh"]').getByLabel('Replace current list instead of merging').check();
    let asked = false;
    page.on('dialog', (d) => {
      asked = true;
      void d.dismiss();
    });
    await importFile(page, 'bad.json', '[1]');
    await expect(page.getByText('Import failed: Not a known-words file')).toBeVisible();
    expect(asked).toBe(false);
    await expect(page.locator('[data-known-words="zh"] .known-summary')).toHaveText('2 words · 1 known');
  });

  test('unticked still merges', async ({ page }) => {
    await expect(page.locator('[data-known-words="zh"]').getByLabel('Replace current list instead of merging')).not.toBeChecked();
    await importFile(page, 'replacement.json', replacement);
    await expect(page.getByText('Imported: 1 new, 0 updated')).toBeVisible(); // 阳光 kept: its date is newer
    await expect(page.locator('[data-known-words="zh"] .known-summary')).toHaveText('3 words · 1 known');
  });
});
