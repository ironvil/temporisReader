/** German: separable verbs, compounds and sentence-initial capitals, through the real UI. */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addGerman, closeSettings, germanBook, importBook, nextPage, openFirstBook, openLanguageSettings, tapText } from './helpers';

const popup = (page: Page) => page.locator('.lookup-popup');
const pressed = (page: Page) => popup(page).locator('.word-status [aria-pressed="true"]');

async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
}

async function exportGerman(page: Page): Promise<Record<string, [number, string]>> {
  await openLanguageSettings(page, 'de');
  const pending = page.waitForEvent('download');
  await page.locator('[data-known-words="de"]').getByRole('button', { name: 'Export known words' }).click();
  const text = await readFile((await (await pending).path())!, 'utf8');
  await closeSettings(page);
  return JSON.parse(text).words;
}

test('a German book is detected and asks for German to be added', async ({ page }) => {
  await start(page);
  await importBook(page, 'buch.md', germanBook());
  await expect(page.locator('.book-details')).toHaveText('Not started · 2 chapters · German');
  await page.locator('.book-open').first().click();
  await expect(page.getByRole('dialog', { name: 'Add German?' })).toBeVisible();
});

test('separable verbs: tapping the verb or its particle shows the whole verb, tracked once', async ({ page }) => {
  await start(page);
  await addGerman(page);
  await importBook(page, 'buch.md', germanBook());
  await openFirstBook(page);

  await tapText(page, 'fängt morgen', 1);
  await expect(popup(page).locator('.wk-form')).toHaveText('fängt … an→anfangen');
  await expect(popup(page).locator('.wk-word')).toHaveText(['anfangen', 'fangen']);
  await expect(popup(page).locator('.wk-entry').first().locator('.defs li')).toHaveText(['to begin, to start']);
  await expect(pressed(page)).toHaveText('1'); // added at 1, as anfangen

  // The particle at the end of the clause leads to the same verb and level.
  await tapText(page, 'morgen an', 'morgen '.length);
  await expect(popup(page).locator('.wk-form')).toHaveText('fängt … an→anfangen');
  await expect(pressed(page)).toHaveText('1');

  // "denkt an dich": an isn't at the clause end, so it's just the preposition.
  await tapText(page, 'an dich');
  await expect(popup(page).locator('.wk-word')).toHaveText('an');

  const words = await exportGerman(page);
  expect(Object.keys(words).sort()).toEqual(['an', 'anfangen']);
});

test('compounds show their parts and have no level buttons', async ({ page }) => {
  await start(page);
  await addGerman(page);
  await importBook(page, 'buch.md', germanBook());
  await openFirstBook(page);

  await tapText(page, 'Donaudampfschiffskapitän', 5);
  await expect(popup(page).locator('.wk-compound')).toHaveText('Donaudampfschiffskapitän=Donau + Dampfschiff + Kapitän');
  await expect(popup(page).locator('.wk-word')).toHaveText(['Donau', 'Dampfschiff', 'Kapitän']);
  await expect(popup(page).locator('.word-status')).toHaveCount(0);
  expect(await exportGerman(page)).toEqual({});
});

test('the mark-known prompt offers whole separable verbs and sentence-initial words in lower case', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-10T09:00:00') });
  await page.clock.pauseAt(new Date('2026-11-10T09:00:01'));
  await start(page);
  await addGerman(page);
  await importBook(page, 'buch.md', germanBook());
  await openFirstBook(page);

  await page.clock.fastForward(10_000);
  await nextPage(page);
  const prompt = page.getByRole('dialog', { name: 'Mark words as known?' });
  const chips = await prompt.locator('.word-chip').allTextContents();
  expect(chips).toEqual(expect.arrayContaining(['er', 'anfangen', 'morgen', 'sie', 'zurückkommen', 'denken', 'an', 'du', 'ich', 'der', 'Haus', 'sein', 'alt']));
  for (const word of ['fangen', 'kommen', 'Ich', 'fängt', 'Häuser', 'Donaudampfschiffskapitän', 'zurück']) expect(chips).not.toContain(word);
});

test('known % counts a separable verb once, under the whole verb', async ({ page }) => {
  await start(page);
  await addGerman(page);
  await openLanguageSettings(page, 'de');
  const file = JSON.stringify({ version: 1, updated: '2026-01-01', words: { anfangen: [3, '2026-01-01'] } });
  await page.getByTestId('known-words-import-de').setInputFiles({ name: 'k.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await expect(page.getByText(/^Imported:/)).toBeVisible();
  await closeSettings(page);
  // Trackable: er, anfangen (fängt … an), morgen → 1 of 3 known.
  await importBook(page, 'kurz.md', '# Eins\n\nEr fängt morgen an.\n');
  await expect(page.locator('.book-known')).toHaveText('33% of words known');
});
