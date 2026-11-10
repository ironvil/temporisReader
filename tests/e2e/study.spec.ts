/**
 * Highlighting unknown words, known-word percentages, and the chapter list.
 * Fixture dictionary words in these books: 今天 早上 阳光 镜子.
 */
import { expect, test, type Page } from '@playwright/test';
import { addChinese, importBook, nextPage, openFirstBook, tapText } from './helpers';

const MULTI_PAGE = ['第一章', ...Array.from({ length: 40 }, () => '今天早上，阳光很好。')].join('\n');
// Chapter 1: 今天 ×2, 阳光 ×1 (3 occurrences). Chapter 2: 镜子 ×1.
const TWO_CHAPTERS = '# 一\n\n今天阳光。今天。\n\n# 二\n\n镜子。\n';

async function start(page: Page, options: { language?: boolean; known?: Record<string, [number, string]> } = {}) {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  if (options.language !== false) await addChinese(page);
  if (options.known) {
    await page.getByRole('button', { name: 'Settings' }).click();
    const file = JSON.stringify({ version: 1, updated: '2026-01-01', words: options.known });
    await page.getByTestId('known-words-import-zh').setInputFiles({ name: 'k.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    await expect(page.getByText(/^Imported:/)).toBeVisible();
    await page.getByRole('button', { name: 'Close settings' }).click();
  }
}

/** Unique texts of the ranges in a CSS highlight, or null if it isn't registered. */
const highlighted = (page: Page, name: string) =>
  page.evaluate((name) => {
    const h = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(name);
    return h ? [...new Set([...h].map((r) => r.toString()))].sort() : null;
  }, name);

async function setHighlighting(page: Page, on: boolean) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const box = page.getByLabel('Highlight words you don’t know yet');
  if (on) await box.check();
  else await box.uncheck();
  await page.getByRole('button', { name: 'Close settings' }).click();
}

test.describe('highlighting words that aren’t known', () => {
  test('is off by default', async ({ page }) => {
    await start(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByLabel('Highlight words you don’t know yet')).not.toBeChecked();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await importBook(page, 'book.txt', MULTI_PAGE);
    await openFirstBook(page);
    expect(await highlighted(page, 'word-new')).toBeNull();
    expect(await highlighted(page, 'word-learning')).toBeNull();
  });

  test('tints new and learning words, and follows status changes and page turns', async ({ page }) => {
    await start(page, { known: { 阳光: [3, '2026-01-01'] } });
    await importBook(page, 'book.txt', MULTI_PAGE);
    await openFirstBook(page);
    await setHighlighting(page, true);

    await expect.poll(() => highlighted(page, 'word-new')).toEqual(['今天', '早上']); // 阳光 is known
    expect(await highlighted(page, 'word-learning')).toEqual([]);

    // Marking from the popup updates immediately.
    await tapText(page, '早上');
    await page.locator('.word-status').getByRole('button', { name: 'Level 1' }).click();
    await expect.poll(() => highlighted(page, 'word-learning')).toEqual(['早上']);
    expect(await highlighted(page, 'word-new')).toEqual(['今天']);
    await page.locator('.word-status').getByRole('button', { name: 'Known' }).click();
    await expect.poll(() => highlighted(page, 'word-learning')).toEqual([]);

    // Ranges are for the visible page only, and are rebuilt on page turns.
    const countOnPage = () =>
      page.evaluate(() => (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('word-new')!.size);
    const onPage1 = await countOnPage();
    await page.keyboard.press('Escape');
    await nextPage(page);
    await expect(page.locator('.page-count')).toHaveText(/^2 \//);
    await expect.poll(() => highlighted(page, 'word-new')).toEqual(['今天']);
    expect(Math.abs((await countOnPage()) - onPage1)).toBeLessThanOrEqual(3);
  });

  test('turning it off clears the tints', async ({ page }) => {
    await start(page);
    await importBook(page, 'book.txt', MULTI_PAGE);
    await openFirstBook(page);
    await setHighlighting(page, true);
    await expect.poll(() => highlighted(page, 'word-new')).toEqual(['今天', '早上', '阳光']);
    await setHighlighting(page, false);
    expect(await highlighted(page, 'word-new')).toBeNull();
  });

  test('nothing is highlighted before the language is added', async ({ page }) => {
    await start(page, { language: false });
    await importBook(page, 'book.txt', MULTI_PAGE);
    await openFirstBook(page);
    await setHighlighting(page, true);
    expect(await highlighted(page, 'word-new')).toBeNull();
  });
});

test.describe('known-word percentage', () => {
  test('per book in the library, updating as words are marked', async ({ page }) => {
    await start(page, { known: { 今天: [3, '2026-01-01'], 阳光: [1, '2026-01-01'] } });
    await importBook(page, 'two.md', TWO_CHAPTERS);
    await expect(page.locator('.book-known')).toHaveText('50% of words known'); // 今天 ×2 of 4

    await openFirstBook(page);
    await page.keyboard.press('ArrowRight'); // to chapter 2
    await tapText(page, '镜子');
    await page.locator('.word-status').getByRole('button', { name: 'Known' }).click();
    await expect(page.locator('.word-status [aria-pressed="true"]')).toHaveText('✓');
    await page.getByRole('button', { name: 'Library' }).click();
    await expect(page.locator('.book-known')).toHaveText('75% of words known');
  });

  test('recalculated after the book is edited', async ({ page }) => {
    await start(page, { known: { 今天: [3, '2026-01-01'] } });
    await importBook(page, 'two.md', TWO_CHAPTERS);
    await expect(page.locator('.book-known')).toHaveText('50% of words known');
    await page.getByRole('button', { name: 'Edit 一' }).click();
    await page.getByRole('button', { name: 'Add chapter' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add chapter' });
    await dialog.getByLabel('Chapter text').fill('今天今天今天今天。');
    await dialog.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('button', { name: 'Close editor' }).click();
    await expect(page.locator('.book-known')).toHaveText('75% of words known'); // 6 of 8
  });

  test('not shown before the language is added', async ({ page }) => {
    await start(page, { language: false });
    await importBook(page, 'two.md', TWO_CHAPTERS);
    await expect(page.locator('.book-name')).toHaveText('一');
    await page.waitForTimeout(300);
    await expect(page.locator('.book-known')).toBeHidden();
  });
});

test.describe('chapter list', () => {
  const list = (page: Page) => page.getByRole('dialog', { name: 'Chapters' });

  test('lists chapters with the current one marked and per-chapter percentages', async ({ page }) => {
    await start(page, { known: { 今天: [3, '2026-01-01'] } });
    await importBook(page, 'two.md', TWO_CHAPTERS);
    await openFirstBook(page);
    await page.getByRole('button', { name: 'Chapters' }).click();
    await expect(list(page).locator('.toc-title')).toHaveText(['一', '二']);
    await expect(list(page).locator('.toc-item[aria-current="true"] .toc-title')).toHaveText('一');
    await expect(list(page).locator('.toc-known')).toHaveText(['66% known', '0% known']);
    await expect(list(page).locator('.toc-book-known')).toHaveText('Whole book: 50% of words known');
  });

  test('tapping a chapter jumps to its first page', async ({ page }) => {
    await start(page);
    const book = ['# 一', ...Array.from({ length: 30 }, () => '今天早上，阳光很好。'), '# 二', '镜子在这里。', '# 三', '最后。'].join('\n\n');
    await importBook(page, 'three.md', book);
    await openFirstBook(page);
    await nextPage(page, 2);
    await page.getByRole('button', { name: 'Chapters' }).click();
    await list(page).getByRole('button', { name: /三/ }).click();
    await expect(list(page)).toHaveCount(0);
    await expect(page.locator('.chapter-count')).toHaveText('Chapter 3 of 3');
    await expect(page.locator('.page-count')).toHaveText('1 / 1');

    await page.getByRole('button', { name: 'Chapters' }).click();
    await expect(list(page).locator('.toc-item[aria-current="true"] .toc-title')).toHaveText('三');
    await list(page).getByRole('button', { name: /一/ }).click();
    await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 3');
    await expect(page.locator('.page-count')).toHaveText(/^1 \//);
  });

  test('closes with its button or Escape without moving', async ({ page }) => {
    await start(page, { language: false });
    await importBook(page, 'two.md', TWO_CHAPTERS);
    await openFirstBook(page);
    await page.getByRole('button', { name: 'Chapters' }).click();
    await list(page).getByRole('button', { name: 'Close chapters' }).click();
    await expect(list(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Chapters' }).click();
    await page.keyboard.press('Escape');
    await expect(list(page)).toHaveCount(0);
    await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 2');
  });

  test('a chapter jump is not a page turn: no mark-known prompt, and lookups reset', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-10T09:00:00') });
    await page.clock.pauseAt(new Date('2026-11-10T09:00:01'));
    await start(page);
    const book = ['# 一', '今天早上。', '# 二', '今天阳光。'].join('\n\n');
    await importBook(page, 'two.md', book);
    await openFirstBook(page);
    await tapText(page, '今天');
    await page.keyboard.press('Escape');
    await page.clock.fastForward(15_000);
    await page.getByRole('button', { name: 'Chapters' }).click();
    await list(page).getByRole('button', { name: /二/ }).click();
    await expect(page.locator('.chapter-count')).toHaveText('Chapter 2 of 2');
    await expect(page.getByRole('dialog', { name: 'Mark words as known?' })).toHaveCount(0);

    // Back to chapter 1 via the list, read for 10s, then turn: 今天 is offered again (lookups were reset).
    await page.getByRole('button', { name: 'Chapters' }).click();
    await list(page).getByRole('button', { name: /一/ }).click();
    await page.clock.fastForward(10_000);
    await nextPage(page);
    await expect(page.getByRole('dialog', { name: 'Mark words as known?' }).locator('.word-chip')).toHaveText(['今天', '早上']);
  });
});
