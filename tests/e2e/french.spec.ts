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

test('French stays added after a restart (the saved data loads), and can be removed', async ({ page }) => {
  await start(page);
  await addFrench(page);
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();

  await importBook(page, 'livre.md', frenchBook());
  await openFirstBook(page);
  await expect(page.getByRole('dialog')).toHaveCount(0); // no "Add French?" reminder
  await tapText(page, 'mangeaient');
  await expect(popup(page).locator('.fr-form')).toHaveText('mangeaient→manger');

  await openLanguageSettings(page, 'fr');
  const card = page.locator('[data-language="fr"]');
  await expect(card.locator('[data-dictionary="wiktionary-fr"] .dict-status')).toHaveText('1,123 entries');
  page.once('dialog', (d) => d.accept());
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(card.locator('.lang-status')).toHaveText('Not added · 60 MB download');
  await closeSettings(page);

  // Without the dictionary, lookups point back to settings and nothing is tracked.
  await tapText(page, 'maison');
  await expect(popup(page)).toContainText('French isn’t added yet');
});

test.describe('percentages and highlighting count every form under its dictionary form', () => {
  // Trackable: il ×1, manger ×2 (mange, mangeaient) in chapter 1; la ×1, maison ×1 in chapter 2.
  // "Ils" and the headings aren't in the fixture dictionary.
  const BOOK = '# Premier\n\nIl mange. Ils mangeaient.\n\n# Second\n\nLa maison.\n';

  async function importKnown(page: Page, words: Record<string, [number, string]>) {
    await openLanguageSettings(page, 'fr');
    const file = JSON.stringify({ version: 1, updated: '2026-01-01', words });
    await page.getByTestId('known-words-import-fr').setInputFiles({ name: 'k.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    await expect(page.getByText(/^Imported:/)).toBeVisible();
    await closeSettings(page);
  }

  test('known % in the library and chapter list', async ({ page }) => {
    await start(page);
    await addFrench(page);
    await importKnown(page, { manger: [3, '2026-01-01'] });
    await importBook(page, 'court.md', BOOK);
    await expect(page.locator('.book-known')).toHaveText('40% of words known'); // 2 of 5

    await openFirstBook(page);
    await page.getByRole('button', { name: 'Chapters' }).click();
    await expect(page.locator('.toc .toc-known')).toHaveText(['66% known', '0% known']); // 2 of 3, 0 of 2
  });

  test('highlighting tints every form by its dictionary form’s level', async ({ page }) => {
    await start(page);
    await addFrench(page);
    await importKnown(page, { manger: [1, '2026-01-01'], la: [3, '2026-01-01'] });
    await importBook(page, 'court.md', BOOK);
    await openFirstBook(page);
    await page.locator('.reader').getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Highlight words you don’t know yet').check();
    await closeSettings(page);

    const highlighted = (name: string) =>
      page.evaluate((name) => {
        const h = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(name);
        return h ? [...h].map((r) => r.toString()).sort() : null;
      }, name);
    await expect.poll(() => highlighted('word-learning')).toEqual(['mange', 'mangeaient']);
    expect(await highlighted('word-new')).toEqual(['Il']);
  });
});
