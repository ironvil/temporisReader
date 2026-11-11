/** Japanese: JMdict, conjugated words, set phrases and known words, through the real UI. */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addJapanese, closeSettings, importBook, japaneseBook, openFirstBook, openLanguageSettings, tapText } from './helpers';

const popup = (page: Page) => page.locator('.lookup-popup');
const pressed = (page: Page) => popup(page).locator('.word-status [aria-pressed="true"]');

async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
}

async function exportJapanese(page: Page): Promise<Record<string, [number, string]>> {
  await openLanguageSettings(page, 'ja');
  const pending = page.waitForEvent('download');
  await page.locator('[data-known-words="ja"]').getByRole('button', { name: 'Export known words' }).click();
  const text = await readFile((await (await pending).path())!, 'utf8');
  await closeSettings(page);
  return JSON.parse(text).words;
}

test('a Japanese book is detected and asks for Japanese to be added', async ({ page }) => {
  await start(page);
  await importBook(page, '本.md', japaneseBook());
  await expect(page.locator('.book-details')).toHaveText('Not started · 2 chapters · Japanese');
  await page.locator('.book-open').first().click();
  await expect(page.getByRole('dialog', { name: 'Add Japanese?' })).toBeVisible();
});

test('adding Japanese downloads JMdict and shows its size and date', async ({ page }) => {
  await start(page);
  await addJapanese(page);
  await openLanguageSettings(page, 'ja');
  await expect(page.locator('[data-language="ja"] [data-dictionary="jmdict"] .dict-status')).toHaveText('1,154 entries · 2026-11-01');
});

test('a conjugated word is looked up and tracked as its dictionary form', async ({ page }) => {
  await start(page);
  await addJapanese(page);
  await importBook(page, '本.md', japaneseBook());
  await openFirstBook(page);

  // Any character of 食べました: the whole word, as 食べる.
  await tapText(page, '食べました', 2);
  await expect(popup(page).locator('.wk-form')).toHaveText('食べました→食べるpolite, past');
  await expect(popup(page).locator('.ja-word')).toHaveText('食べる');
  await expect(popup(page).locator('.ja-reading')).toHaveText('たべる');
  // The search-only spelling 喰べる isn't shown.
  await expect(popup(page).locator('.ja-forms')).toHaveCount(0);
  await expect(popup(page).locator('.defs li')).toHaveText(['ichidan verb, transitive to eat', 'to live on (e.g. a salary)']);
  await expect(pressed(page)).toHaveText('1');

  // Another form of the same verb shares its level.
  await popup(page).locator('.word-status').getByRole('button', { name: '2' }).click();
  await tapText(page, '読んでいる', 3);
  await expect(popup(page).locator('.wk-form')).toHaveText('読んでいる→読むte-form, progressive');

  const words = await exportJapanese(page);
  expect(Object.keys(words).sort()).toEqual(['読む', '食べる']);
  expect(words['食べる'][0]).toBe(2);
});

test('a set phrase starting at the tapped word is shown after it', async ({ page }) => {
  await start(page);
  await addJapanese(page);
  await importBook(page, '本.md', japaneseBook());
  await openFirstBook(page);
  await tapText(page, '見に行った');
  await expect(popup(page).locator('.ja-word')).toHaveText(['見る', '見に行く']);
  await expect(popup(page).locator('.ja-phrase')).toHaveText('Phrase見に行った→見に行くpast');
});

test('known % counts conjugated words under their dictionary form', async ({ page }) => {
  await start(page);
  await addJapanese(page);
  await openLanguageSettings(page, 'ja');
  const file = JSON.stringify({ version: 1, updated: '2026-01-01', words: { 食べる: [3, '2026-01-01'], 私: [3, '2026-01-01'] } });
  await page.getByTestId('known-words-import-ja').setInputFiles({ name: 'k.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await expect(page.getByText(/^Imported:/)).toBeVisible();
  await closeSettings(page);
  // 私 | は | りんご | を | 食べました: 2 of 5 known.
  await importBook(page, '短い.md', '# 一\n\n私はりんごを食べました。\n');
  await expect(page.locator('.book-known')).toHaveText('40% of words known');
});

test('readings can be shown in romaji instead of kana', async ({ page }) => {
  await start(page);
  await addJapanese(page);
  await openLanguageSettings(page, 'ja');
  const readings = page.locator('[data-language="ja"]').getByLabel('Readings');
  await expect(readings).toHaveValue('kana');
  await readings.selectOption('romaji');
  await closeSettings(page);
  await importBook(page, '本.md', japaneseBook());
  await openFirstBook(page);
  await tapText(page, '食べました', 1);
  await expect(popup(page).locator('.ja-reading')).toHaveText('taberu');
  // A word written in kana gets its romaji too.
  await tapText(page, 'りんご', 1);
  await expect(popup(page).locator('.ja-word').first()).toHaveText('りんご');
  await expect(popup(page).locator('.ja-reading').first()).toHaveText('ringo');

  // Kept after a reload.
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await openLanguageSettings(page, 'ja');
  await expect(page.locator('[data-language="ja"]').getByLabel('Readings')).toHaveValue('romaji');
});
