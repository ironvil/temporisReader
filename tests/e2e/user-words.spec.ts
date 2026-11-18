/**
 * The reader's own words: selected text is added from the button that takes the page indicator's
 * place, kept apart from CC-CEDICT, and from then on split and looked up as one word.
 */
import { readFile } from 'node:fs/promises';
import { devices, expect, test, type Page } from '@playwright/test';
import { addChinese, closeSettings, importBook, openFirstBook, openLanguageSettings, tapText, withStorage } from './helpers';

const BOOK = '德拉科尼娅在早上看了头发。\n'.repeat(3);

/** Selects `needle` in the first paragraph that has it, as a long press and drag would. */
async function select(page: Page, needle: string): Promise<void> {
  await page.evaluate((needle) => {
    const block = [...document.querySelectorAll<HTMLElement>('.page-flow [data-block]')].find((b) => b.textContent!.includes(needle))!;
    const text = block.firstChild as Text;
    const at = text.data.indexOf(needle);
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + needle.length);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
  }, needle);
}

const unselect = (page: Page) => page.evaluate(() => document.getSelection()!.removeAllRanges());

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await addChinese(page);
  await importBook(page, 'name.txt', BOOK);
  await openFirstBook(page);
}

const storedWords = (page: Page) =>
  withStorage(page, async (s) => {
    const entry = await s.get('/DATA/user-dictionary/zh.json');
    return entry ? Object.keys(JSON.parse(entry.content).words) : null;
  }, null);

const addButton = (page: Page) => page.locator('.reader footer .add-word');
const indicator = (page: Page) => page.getByRole('button', { name: 'Book position' });
const popup = (page: Page) => page.locator('.lookup-popup');

test('selected text is added to my words, then split and looked up as one word', async ({ page }) => {
  await start(page);

  // Before: the name is single characters.
  await tapText(page, '拉');
  await expect(popup(page).locator('.zh-hanzi')).toHaveText('拉');

  // Selecting it swaps the page indicator for the button.
  await select(page, '德拉科尼娅');
  await expect(addButton(page)).toHaveText('Add “德拉科尼娅” to my words');
  await expect(indicator(page)).toBeHidden();
  await addButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'Add to my words' });
  await expect(dialog.locator('.add-word-word')).toHaveText('德拉科尼娅');
  await dialog.getByLabel('Definition (optional)').fill('Draconia (a name)');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Added “德拉科尼娅” to your words')).toBeVisible();
  await expect(addButton(page)).toBeHidden();
  await expect(indicator(page)).toBeVisible();
  expect(await page.evaluate(() => document.getSelection()!.toString())).toBe('');
  expect(await storedWords(page)).toEqual(['德拉科尼娅']);

  // Looked up whole, read out from its characters, with the definition; tracked like any word.
  await tapText(page, '拉');
  await expect(popup(page).locator('.zh-hanzi')).toHaveText('德拉科尼娅');
  await expect(popup(page).locator('.zh-pinyin')).toHaveText('délākēníyà');
  await expect(popup(page).locator('.defs li')).toHaveText(['Draconia (a name)']);
  await expect(popup(page).locator('.user-word-note')).toContainText('Added by you');
  await expect(popup(page).locator('.lookup-badge')).toHaveText('Mine');
  await expect(popup(page).locator('.word-status')).toBeVisible();

  // Every way of splitting uses it, and it's kept after a restart.
  await openLanguageSettings(page, 'zh');
  await page.locator('[data-language="zh"]').getByLabel('Word splitting').selectOption({ label: 'Fewest words' });
  await closeSettings(page);
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await openFirstBook(page);
  await tapText(page, '尼');
  await expect(popup(page).locator('.zh-hanzi')).toHaveText('德拉科尼娅');

  // Selecting it again offers to change its definition.
  await page.locator('.reader .bar-title').click();
  await select(page, '德拉科尼娅');
  await expect(addButton(page)).toHaveText('Change “德拉科尼娅”');
  await unselect(page);

  // Removed from the popup: single characters again.
  await tapText(page, '拉');
  await popup(page).getByRole('button', { name: 'Remove' }).click();
  await expect(popup(page).locator('.user-word-note')).toHaveText('Removed from your words');
  await tapText(page, '拉');
  await expect(popup(page).locator('.zh-hanzi')).toHaveText('拉');
  expect(await storedWords(page)).toEqual([]);
});

test('only text that can be a word offers the button', async ({ page }) => {
  await start(page);
  // One character, or text running into punctuation: not a word.
  for (const text of ['德', '头发。']) {
    await select(page, text);
    await expect(addButton(page)).toBeHidden();
    await expect(indicator(page)).toBeVisible();
  }
  await select(page, '早上看');
  await expect(addButton(page)).toHaveText('Add “早上看” to my words');
  await unselect(page);
  await expect(addButton(page)).toBeHidden();
  await expect(indicator(page)).toBeVisible();
});

test('my words are in the backup and come back with it', async ({ page, browser }) => {
  await start(page);
  await select(page, '德拉科尼娅');
  await addButton(page).click();
  await page.getByRole('dialog', { name: 'Add to my words' }).getByRole('button', { name: 'Add' }).click();
  await expect(addButton(page)).toBeHidden();
  await page.getByRole('button', { name: 'Library' }).click();

  await expect(page.locator('.view.library')).toBeVisible();
  await page.locator('.view.library').getByRole('button', { name: 'Settings', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up library' }).click();
  const text = await readFile((await (await pending).path())!, 'utf8');
  expect(Object.keys(JSON.parse(JSON.parse(text).userWords.zh).words)).toEqual(['德拉科尼娅']);

  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: test.info().project.use.baseURL });
  const fresh = await context.newPage();
  await fresh.goto('/');
  await expect(fresh.locator('body[data-ready]')).toBeAttached();
  await fresh.getByRole('button', { name: 'Settings' }).click();
  const confirmation = fresh.waitForEvent('dialog');
  await fresh.getByTestId('restore-input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await (await confirmation).accept();
  await fresh.waitForEvent('load');
  await expect(fresh.locator('body[data-ready]')).toBeAttached();
  expect(await storedWords(fresh)).toEqual(['德拉科尼娅']);
  await context.close();
});
