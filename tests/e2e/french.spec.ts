/** French: Wiktionary install, detection, lookups by dictionary form, and known words keyed by lemma. */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addFrench, closeSettings, frenchBook, importBook, nextPage, openFirstBook, openLanguageSettings, tapText, WIKTIONARY_FR_URL } from './helpers';

const popup = (page: Page) => page.locator('.lookup-popup');
const pressed = (page: Page) => popup(page).locator('.word-status [aria-pressed="true"]');

async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
}

/** Exports French known words from the reader's Settings. */
async function exportFrench(page: Page): Promise<Record<string, [number, string]>> {
  await openLanguageSettings(page, 'fr');
  const pending = page.waitForEvent('download');
  await page.locator('[data-known-words="fr"]').getByRole('button', { name: 'Export known words' }).click();
  const text = await readFile((await (await pending).path())!, 'utf8');
  await closeSettings(page);
  return JSON.parse(text).words;
}

test('a French book is detected and asks for French to be added', async ({ page }) => {
  await start(page);
  await importBook(page, 'livre.md', frenchBook());
  await expect(page.locator('.book-details')).toHaveText('Not started · 2 chapters · French');
  await page.locator('.book-open').first().click();
  const reminder = page.getByRole('dialog', { name: 'Add French?' });
  await expect(reminder).toBeVisible();
  await reminder.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.locator('[data-language="fr"] .lang-status')).toHaveText('Not added · 60 MB download');
});

test('add French, then tapping an inflected form shows its dictionary form', async ({ page }) => {
  await start(page);
  await addFrench(page);
  await importBook(page, 'livre.md', frenchBook());
  await openFirstBook(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await tapText(page, 'mange ', 2);
  await expect(popup(page).locator('.fr-form')).toHaveText('mange→manger');
  await expect(popup(page).locator('.fr-form-note')).toHaveText('verb first/third-person singular present indicative of manger');
  await expect(popup(page).locator('.fr-word')).toHaveText('manger');
  await expect(popup(page).locator('.fr-ipa')).toHaveText('/mɑ̃.ʒe/');
  await expect(popup(page).locator('.defs li')).toHaveText(['(transitive) to eat']);
  await expect(popup(page).locator('.lookup-badge')).toHaveText('WK');

  // Elision: l’ is its own word, looked up as "le".
  await tapText(page, 'l’homme', 0);
  await expect(popup(page).locator('.fr-form')).toHaveText('l’→le');
  await tapText(page, 'l’homme', 3);
  await expect(popup(page).locator('.fr-word')).toHaveText('homme');
  await expect(popup(page).locator('.fr-form')).toHaveCount(0);

  // Hyphenated entry and gender/plural from the headword line.
  await tapText(page, 'peut-être', 6);
  await expect(popup(page).locator('.fr-word')).toHaveText('peut-être');
  await tapText(page, 'maison', 1);
  await expect(popup(page).locator('.fr-gram')).toHaveText('f (plural maisons)');

  // A word that is also a form of another word shows both.
  await tapText(page, 'livre', 1);
  await expect(popup(page).locator('.fr-word')).toHaveText(['livre', 'livrer']);

  // The tapped form's own pronunciation, when Wiktionary has one.
  await tapText(page, 'belles', 1);
  await expect(popup(page).locator('.fr-form')).toHaveText('belles /bɛl/→beau');
  await expect(popup(page).locator('.fr-form .fr-ipa')).toHaveText(' /bɛl/');

  // Not in the dictionary.
  await tapText(page, 'lumière', 1);
  await expect(popup(page)).toContainText('No dictionary entry found.');
});

test('known words are kept by dictionary form, so every form shares one level', async ({ page }) => {
  await start(page);
  await addFrench(page);
  await importBook(page, 'livre.md', frenchBook());
  await openFirstBook(page);

  await tapText(page, 'mange ');
  await expect(pressed(page)).toHaveText('1'); // new word: added at 1
  await popup(page).getByRole('button', { name: 'Level 2' }).click();
  await tapText(page, 'mangeaient');
  await expect(pressed(page)).toHaveText('2'); // same word
  await tapText(page, 'belles');
  await expect(pressed(page)).toHaveText('1');

  const words = await exportFrench(page);
  expect(Object.keys(words).sort()).toEqual(['beau', 'manger']);
  expect(words.manger[0]).toBe(2);
});

test('the mark-known prompt offers dictionary forms once each, skipping looked-up words in any form', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-10T09:00:00') });
  await page.clock.pauseAt(new Date('2026-11-10T09:00:01'));
  await start(page);
  await addFrench(page);
  await importBook(page, 'livre.md', frenchBook());
  await openFirstBook(page);

  await tapText(page, 'mangeaient'); // key: manger, which also covers "mange" on this page
  await page.clock.fastForward(10_000);
  await nextPage(page);
  const prompt = page.getByRole('dialog', { name: 'Mark words as known?' });
  await expect(prompt).toBeVisible();
  const chips = await prompt.locator('.word-chip').allTextContents();
  expect(chips).toEqual(expect.arrayContaining(['un', "aujourd'hui", 'le', 'homme', 'dans', 'la', 'maison', 'il', 'lire', 'livre', 'peut-être', 'plus', 'beau', 'Paris']));
  expect(chips).not.toContain('manger');
  for (const form of ['mange', 'mangeaient', 'lit', 'belles', 'maisons', 'l’', "l'"]) expect(chips).not.toContain(form);
  expect(new Set(chips).size).toBe(chips.length);

  await prompt.getByRole('button', { name: /^Mark \d+ known$/ }).click();
  const words = await exportFrench(page);
  expect(words.lire).toEqual([3, '2026-11-10']);
  expect(words.manger).toEqual([1, '2026-11-10']);
});

test('a failed French download is reported and nothing is installed', async ({ page }) => {
  await start(page);
  await page.route(WIKTIONARY_FR_URL, (route) => route.fulfill({ status: 200, body: 'not a dictionary', headers: { 'access-control-allow-origin': '*' } }));
  await openLanguageSettings(page, 'fr');
  const card = page.locator('[data-language="fr"]');
  await card.getByRole('button', { name: 'Add' }).click();
  await expect(card.locator('.lang-status')).toContainText('Download failed');
  await expect(card.getByRole('button', { name: 'Add' })).toBeVisible();
});
