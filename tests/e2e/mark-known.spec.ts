/**
 * "Mark unlooked-up words as known" on page turns. Mistakes here silently corrupt the user's
 * known-words list, so these tests check the stored file exactly after every scenario.
 *
 * Fixture dictionary words used: 今天 早上 阳光 镜子 (plus 头/头发/在/了… not present in these books).
 * Time is controlled with Playwright's fake clock.
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addChinese, closeSettings, dismissLanguageReminder, importBook, nextPage, openFirstBook, openLanguageSettings, swipe, tapText } from './helpers';

const TODAY = '2026-11-10';
const MULTI_PAGE = ['第一章', ...Array.from({ length: 40 }, () => '今天早上，阳光很好。'), '她对镜子说。'].join('\n');
const TWO_CHAPTERS = '# 一\n\n今天阳光。\n\n# 二\n\n她对镜子说。\n';

type Words = Record<string, [number, string]>;
const clockInstalled = new WeakSet<Page>();

/** The known-words file as stored by the app (web storage = IndexedDB), or null if never written. */
async function storedKnownWords(page: Page): Promise<{ updated: string; words: Words } | null> {
  const text = await page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open('Disc');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('FileStorage').objectStore('FileStorage').get('/DATA/known-words/zh.json');
          get.onsuccess = () => resolve(get.result?.content ?? null);
          get.onerror = () => reject(get.error);
        };
      }),
  );
  return text === null ? null : JSON.parse(text);
}

const prompt = (page: Page) => page.getByRole('dialog', { name: 'Mark words as known?' });
const chips = (page: Page) => prompt(page).locator('.word-chip');

/** Spend `ms` on the current page. */
const dwell = (page: Page, ms: number) => page.clock.fastForward(ms);

async function setUp(page: Page, book: string, options: { addLanguage?: boolean; known?: Words; name?: string } = {}) {
  if (!clockInstalled.has(page)) {
    // Paused: time only moves when a test calls dwell(), so thresholds are exact.
    await page.clock.install({ time: new Date(`${TODAY}T09:00:00`) });
    await page.clock.pauseAt(new Date(`${TODAY}T09:00:01`));
    clockInstalled.add(page);
  }
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  if (options.addLanguage !== false) await addChinese(page);
  if (options.known) {
    const file = JSON.stringify({ version: 1, updated: '2026-01-01', words: options.known });
    await openLanguageSettings(page, 'zh');
    await page.getByTestId('known-words-import-zh').setInputFiles({ name: 'k.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    await expect(page.getByText(/^Imported:/)).toBeVisible();
    await closeSettings(page);
  }
  await importBook(page, options.name ?? 'book.md', book);
  await openFirstBook(page);
}

/** Turns forward and checks no prompt appears (the page count proves the turn happened). */
async function nextWithoutPrompt(page: Page) {
  const before = await page.locator('.page-count').textContent();
  const chapterBefore = await page.locator('.chapter-count').textContent();
  await nextPage(page);
  await expect
    .poll(async () => `${await page.locator('.page-count').textContent()}|${await page.locator('.chapter-count').textContent()}`)
    .not.toBe(`${before}|${chapterBefore}`);
  await expect(prompt(page)).toHaveCount(0);
}

test('after 10 seconds on a page, turning offers its unlooked-up words and marks them known', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await dwell(page, 10_000); // exactly the threshold counts
  await nextPage(page);
  await expect(prompt(page)).toBeVisible();
  await expect(prompt(page)).toContainText('3 words on the page you just read weren’t looked up');
  await expect(chips(page)).toHaveText(['今天', '早上', '阳光']);
  await expect(page.locator('.page-count')).toHaveText(/^2 \//);

  await prompt(page).getByRole('button', { name: /^Mark \d+ known$/ }).click();
  await expect(prompt(page)).toHaveCount(0);
  await expect(page.getByText('Marked 3 words as known')).toBeVisible();
  await expect.poll(() => storedKnownWords(page)).toEqual({
    version: 1,
    updated: TODAY,
    words: { 今天: [3, TODAY], 早上: [3, TODAY], 阳光: [3, TODAY] },
  });
});

test('under 10 seconds: no prompt and nothing stored', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await dwell(page, 9_999);
  await nextWithoutPrompt(page);
  expect(await storedKnownWords(page)).toBeNull();
});

test('time on each page counts separately', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await dwell(page, 6_000);
  await nextWithoutPrompt(page);
  await dwell(page, 6_000); // 12s in total, but only 6s on this page
  await nextWithoutPrompt(page);
  expect(await storedKnownWords(page)).toBeNull();
});

test('"Not now" changes nothing, and the next page asks again', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await dwell(page, 10_000);
  await nextPage(page);
  await prompt(page).getByRole('button', { name: 'Not now' }).click();
  await expect(prompt(page)).toHaveCount(0);
  expect(await storedKnownWords(page)).toBeNull();

  await dwell(page, 10_000);
  await nextPage(page);
  await expect(chips(page)).toHaveText(['今天', '早上', '阳光']);
});

test('words looked up on the page are not offered', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await tapText(page, '今天');
  await expect(page.locator('.lookup-popup .zh-hanzi')).toHaveText('今天');
  await dwell(page, 10_000);
  await nextPage(page);
  await expect(chips(page)).toHaveText(['早上', '阳光']);
  await prompt(page).getByRole('button', { name: /^Mark \d+ known$/ }).click();
  await expect.poll(async () => (await storedKnownWords(page))?.words).toEqual({ 今天: [1, TODAY], 早上: [3, TODAY], 阳光: [3, TODAY] }); // 今天 was added at 1 by the lookup
});

test('a level set from the popup is kept, not overwritten by the prompt', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await tapText(page, '早上');
  await page.locator('.word-status').getByRole('button', { name: 'Level 1' }).click();
  await expect(page.locator('.word-status [aria-pressed="true"]')).toHaveText('1');
  await dwell(page, 10_000);
  await nextPage(page);
  await expect(chips(page)).toHaveText(['今天', '阳光']);
  await prompt(page).getByRole('button', { name: /^Mark \d+ known$/ }).click();
  await expect.poll(async () => (await storedKnownWords(page))?.words).toEqual({ 早上: [1, TODAY], 今天: [3, TODAY], 阳光: [3, TODAY] });
});

test('known words are skipped and keep their dates; learning words become known', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt', known: { 今天: [3, '2026-01-01'], 早上: [1, '2026-01-01'], 别的: [2, '2026-01-01'] } });
  await dwell(page, 10_000);
  await nextPage(page);
  await expect(chips(page)).toHaveText(['早上', '阳光']);
  await prompt(page).getByRole('button', { name: /^Mark \d+ known$/ }).click();
  await expect.poll(() => storedKnownWords(page)).toEqual({
    version: 1,
    updated: TODAY,
    words: { 今天: [3, '2026-01-01'], 早上: [3, TODAY], 别的: [2, '2026-01-01'], 阳光: [3, TODAY] },
  });
});

test('no prompt when every word on the page is already known', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt', known: { 今天: [3, '2026-01-01'], 早上: [3, '2026-01-01'], 阳光: [3, '2026-01-01'] } });
  await dwell(page, 10_000);
  await nextWithoutPrompt(page);
});

test('lookups are cleared on every page turn', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await tapText(page, '今天'); // looked up on page 1…
  await nextWithoutPrompt(page); // …turned quickly
  await dwell(page, 10_000); // page 2 also contains 今天, not looked up here
  await nextPage(page);
  await expect(chips(page)).toHaveText(['今天', '早上', '阳光']);
});

test('only words from the page being left are offered (crossing into the next chapter)', async ({ page }) => {
  await setUp(page, TWO_CHAPTERS);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 2');
  await dwell(page, 10_000);
  await nextPage(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 2 of 2');
  await expect(chips(page)).toHaveText(['今天', '阳光']); // not 镜子 from chapter 2
  await prompt(page).getByRole('button', { name: /^Mark \d+ known$/ }).click();
  await expect.poll(async () => (await storedKnownWords(page))?.words).toEqual({ 今天: [3, TODAY], 阳光: [3, TODAY] });
});

/** Offset of the first character of page 2 in a book that is one paragraph of 很 (all CJK glyphs are the same width). */
async function firstCharOfPage2(page: Page): Promise<number> {
  await setUp(page, '很'.repeat(800), { name: 'probe.txt' });
  const offset = await page.evaluate(() => {
    const text = document.querySelector('.page-flow [data-block="0"]')!.firstChild as Text;
    const right = document.querySelector('.page-area')!.getBoundingClientRect().right;
    const range = document.createRange();
    for (let i = 0; i < text.length; i++) {
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      if (range.getBoundingClientRect().left >= right) return i;
    }
    return -1;
  });
  expect(offset).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Library' }).click();
  return offset;
}

async function openBookNamed(page: Page, title: string) {
  await page.locator('.book-open', { hasText: title }).click();
  await expect(page.locator('.book-title')).toHaveText(title);
  await dismissLanguageReminder(page);
}

test('a word split by the page break belongs to the earlier page', async ({ page }) => {
  const n = await firstCharOfPage2(page);
  // 镜子 starts on the last character of page 1 and ends on page 2.
  await importBook(page, 'split.txt', '很'.repeat(n - 1) + '镜子' + '很'.repeat(800));
  await openBookNamed(page, 'split');
  await dwell(page, 10_000);
  await nextPage(page);
  await expect(chips(page)).toHaveText(['镜子']);
  await prompt(page).getByRole('button', { name: 'Not now' }).click();
  await dwell(page, 10_000);
  await nextWithoutPrompt(page); // page 2 shows 子 but the word started on page 1
});

test('a word starting on the first character of a page belongs to that page', async ({ page }) => {
  const n = await firstCharOfPage2(page);
  await importBook(page, 'split.txt', '很'.repeat(n) + '镜子' + '很'.repeat(800));
  await openBookNamed(page, 'split');
  await dwell(page, 10_000);
  await nextWithoutPrompt(page);
  await dwell(page, 10_000);
  await nextPage(page);
  await expect(chips(page)).toHaveText(['镜子']);
});

test('going back never prompts', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await nextWithoutPrompt(page);
  await dwell(page, 10_000);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.page-count')).toHaveText(/^1 \//);
  await expect(prompt(page)).toHaveCount(0);
  await swipe(page, 'left'); // forward again, but only just arrived on page 1
  await expect(page.locator('.page-count')).toHaveText(/^2 \//);
  await expect(prompt(page)).toHaveCount(0);
  expect(await storedKnownWords(page)).toBeNull();
});

test('swiping past the end of the book does not prompt', async ({ page }) => {
  await setUp(page, TWO_CHAPTERS);
  await nextWithoutPrompt(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 2 of 2');
  await dwell(page, 10_000);
  await nextPage(page);
  await expect(prompt(page)).toHaveCount(0);
  expect(await storedKnownWords(page)).toBeNull();
});

test('no prompt before the language is added', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt', addLanguage: false });
  await dwell(page, 10_000);
  await nextWithoutPrompt(page);
  expect(await storedKnownWords(page)).toBeNull();
});

test('page turns are blocked while the prompt is open', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await dwell(page, 10_000);
  await nextPage(page);
  await expect(prompt(page)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.page-count')).toHaveText(/^2 \//);
  await expect(chips(page)).toHaveText(['今天', '早上', '阳光']);
  await expect(prompt(page)).toHaveCount(1);
});

test('the exported file after marking matches the known-words format', async ({ page }) => {
  await setUp(page, TWO_CHAPTERS, { known: { 镜子: [1, '2026-01-01'] } });
  await dwell(page, 10_000);
  await nextPage(page);
  await prompt(page).getByRole('button', { name: /^Mark \d+ known$/ }).click();
  await expect(page.getByText('Marked 2 words as known')).toBeVisible();

  await openLanguageSettings(page, 'zh');
  const download = page.waitForEvent('download');
  await page.locator('[data-known-words="zh"]').getByRole('button', { name: 'Export known words' }).click();
  const text = await readFile((await (await download).path())!, 'utf8');
  expect(text).toBe(
    ['{', '  "version": 1,', `  "updated": "${TODAY}",`, '  "words": {', '    "镜子": [1, "2026-01-01"],', `    "今天": [3, "${TODAY}"],`, `    "阳光": [3, "${TODAY}"]`, '  }', '}', ''].join('\n'),
  );
});

test('tapping a word in the prompt leaves it out', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await dwell(page, 10_000);
  await nextPage(page);
  await expect(prompt(page).getByRole('button', { name: 'Mark 3 known' })).toBeEnabled();
  await chips(page).filter({ hasText: '早上' }).click();
  await expect(chips(page).filter({ hasText: '早上' })).toHaveAttribute('aria-pressed', 'false');
  await expect(prompt(page).getByRole('button', { name: 'Mark 2 known' })).toBeEnabled();

  // Toggling back on and off again works.
  await chips(page).filter({ hasText: '阳光' }).click();
  await chips(page).filter({ hasText: '阳光' }).click();
  await expect(prompt(page).getByRole('button', { name: 'Mark 2 known' })).toBeEnabled();

  await prompt(page).getByRole('button', { name: 'Mark 2 known' }).click();
  await expect(page.getByText('Marked 2 words as known')).toBeVisible();
  await expect.poll(() => storedKnownWords(page)).toEqual({ version: 1, updated: TODAY, words: { 今天: [3, TODAY], 阳光: [3, TODAY] } });
});

test('leaving every word out disables marking', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await dwell(page, 10_000);
  await nextPage(page);
  for (const w of ['今天', '早上', '阳光']) await chips(page).filter({ hasText: w }).click();
  await expect(prompt(page).getByRole('button', { name: 'Mark 0 known' })).toBeDisabled();
  await prompt(page).getByRole('button', { name: 'Not now' }).click();
  expect(await storedKnownWords(page)).toBeNull();
});

test('the prompt can be turned off in settings (on by default)', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  await page.getByRole('button', { name: 'Settings' }).click();
  const toggle = page.getByLabel('Offer to mark words I didn’t look up as known');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await closeSettings(page);

  await dwell(page, 30_000);
  await nextWithoutPrompt(page);
  expect(await storedKnownWords(page)).toBeNull();

  // Stays off after a restart…
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await openFirstBook(page);
  await dwell(page, 30_000);
  await nextWithoutPrompt(page);

  // …and turning it back on brings the prompt back.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Offer to mark words I didn’t look up as known').check();
  await closeSettings(page);
  await dwell(page, 10_000);
  await nextPage(page);
  await expect(prompt(page)).toBeVisible();
});

test('no prompt when every word on the page was looked up', async ({ page }) => {
  await setUp(page, MULTI_PAGE, { name: 'book.txt' });
  for (const word of ['今天', '早上', '阳光']) {
    await tapText(page, word);
    await expect(page.locator('.lookup-popup .zh-hanzi')).toHaveText(word);
  }
  await dwell(page, 10_000);
  await nextWithoutPrompt(page);
  // Only the lookups themselves stored anything (new words start at 1).
  expect((await storedKnownWords(page))?.words).toEqual({ 今天: [1, TODAY], 早上: [1, TODAY], 阳光: [1, TODAY] });
});

test('no prompt on a page with no dictionary words', async ({ page }) => {
  await setUp(page, '# 一\n\n她说：“好。”\n\n# 二\n\n今天阳光。\n');
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 2');
  await dwell(page, 10_000);
  await nextWithoutPrompt(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 2 of 2');
  expect(await storedKnownWords(page)).toBeNull();
});

test.describe('looking up a known word moves it back to 2', () => {
  const OLD = '2026-01-01';
  const status = (page: Page) => page.locator('.lookup-popup .word-status');

  test('on by default: ✓ becomes 2 dated today; other levels are left alone', async ({ page }) => {
    await setUp(page, MULTI_PAGE, { name: 'book.txt', known: { 今天: [3, OLD], 早上: [1, OLD], 阳光: [0, OLD] } });
    await tapText(page, '今天');
    await expect(status(page).getByRole('button', { name: 'Level 2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(status(page).getByRole('button', { name: 'Known' })).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await storedKnownWords(page))?.words.今天).toEqual([2, TODAY]);

    // Marking it known again from the popup sticks while the popup is open.
    await status(page).getByRole('button', { name: 'Known' }).click();
    await expect(status(page).getByRole('button', { name: 'Known' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await storedKnownWords(page))?.words.今天).toEqual([3, TODAY]);

    await tapText(page, '早上');
    await expect(status(page).getByRole('button', { name: 'Level 1' })).toHaveAttribute('aria-pressed', 'true');
    await tapText(page, '阳光');
    await expect(status(page).getByRole('button', { name: 'Level 0' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await storedKnownWords(page))?.words).toEqual({ 今天: [3, TODAY], 早上: [1, OLD], 阳光: [0, OLD] });

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByLabel('Looking up a known word moves it back to 2')).toBeChecked();
  });

  test('can be turned off in settings', async ({ page }) => {
    await setUp(page, MULTI_PAGE, { name: 'book.txt', known: { 今天: [3, OLD] } });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Looking up a known word moves it back to 2').uncheck();
    await closeSettings(page);
    await tapText(page, '今天');
    await expect(status(page).getByRole('button', { name: 'Known' })).toHaveAttribute('aria-pressed', 'true');
    expect((await storedKnownWords(page))?.words).toEqual({ 今天: [3, OLD] });

    // Stays off after a restart.
    await page.reload();
    await expect(page.locator('body[data-ready]')).toBeAttached();
    await openFirstBook(page);
    await tapText(page, '今天');
    await expect(status(page).getByRole('button', { name: 'Known' })).toHaveAttribute('aria-pressed', 'true');
    expect((await storedKnownWords(page))?.words).toEqual({ 今天: [3, OLD] });
  });
});

test.describe('looking up a word not in the list sets it to 1', () => {
  const OLD = '2026-01-01';
  const status = (page: Page) => page.locator('.lookup-popup .word-status');

  test('on by default: a new word is added at 1 dated today; words already listed are left alone', async ({ page }) => {
    await setUp(page, MULTI_PAGE, { name: 'book.txt', known: { 早上: [0, OLD], 阳光: [2, OLD] } });
    await tapText(page, '今天');
    await expect(status(page).getByRole('button', { name: 'Level 1' })).toHaveAttribute('aria-pressed', 'true');
    await tapText(page, '早上');
    await expect(status(page).getByRole('button', { name: 'Level 0' })).toHaveAttribute('aria-pressed', 'true');
    await tapText(page, '阳光');
    await expect(status(page).getByRole('button', { name: 'Level 2' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await storedKnownWords(page))?.words).toEqual({ 今天: [1, TODAY], 早上: [0, OLD], 阳光: [2, OLD] });

    // A second lookup doesn't change it again.
    await status(page).getByRole('button', { name: 'Level 0' }).click();
    await tapText(page, '今天');
    await expect(status(page).getByRole('button', { name: 'Level 1' })).toHaveAttribute('aria-pressed', 'true');
    await tapText(page, '阳光');
    await expect(status(page).getByRole('button', { name: 'Level 0' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByLabel('Looking up a new word sets it to 1')).toBeChecked();
  });

  test('can be turned off separately from the ✓ → 2 setting', async ({ page }) => {
    await setUp(page, MULTI_PAGE, { name: 'book.txt', known: { 早上: [3, OLD] } });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Looking up a new word sets it to 1').uncheck();
    await expect(page.getByLabel('Looking up a known word moves it back to 2')).toBeChecked();
    await closeSettings(page);

    await tapText(page, '今天');
    await expect(status(page).locator('[aria-pressed="true"]')).toHaveCount(0);
    await tapText(page, '早上'); // ✓ → 2 still applies
    await expect(status(page).getByRole('button', { name: 'Level 2' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await storedKnownWords(page))?.words).toEqual({ 早上: [2, TODAY] });

    // Stays off after a restart.
    await page.reload();
    await expect(page.locator('body[data-ready]')).toBeAttached();
    await openFirstBook(page);
    await tapText(page, '今天');
    await expect(status(page).locator('[aria-pressed="true"]')).toHaveCount(0);
    expect((await storedKnownWords(page))?.words).toEqual({ 早上: [2, TODAY] });
  });
});
