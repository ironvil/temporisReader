import { expect, test } from '@playwright/test';
import { chineseBook, importBook, nextPage, openFirstBook, pageIndicator, settled, swipe } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
});

test('empty library offers import and does not prompt for downloads', async ({ page }) => {
  await expect(page.getByText('No books yet')).toBeVisible();
  await expect(page.getByText(/download/i)).toHaveCount(0);
});

test('imports a txt book and detects chapters', async ({ page }) => {
  await importBook(page, '猫头鹰.txt', chineseBook());
  await expect(page.locator('.book-name')).toHaveText('猫头鹰');
  await expect(page.locator('.book-details')).toHaveText('Not started · 2 chapters · Chinese');
});

test('imports markdown using its H1 as the title', async ({ page }) => {
  await importBook(page, 'notes.md', '# 我的书\n\n## 第一章\n\n**你好**，世界。\n');
  await expect(page.locator('.book-name')).toHaveText('我的书');
});

test('renders markdown bold and italics', async ({ page }) => {
  await importBook(page, 'styled.md', '# 书\n\n她的**头发**是*白金色*的，***非常***长。\n');
  await openFirstBook(page);
  await expect(page.locator('.page-flow strong').first()).toHaveText('头发');
  await expect(page.locator('.page-flow em').first()).toHaveText('白金色');
  await expect(page.locator('.page-flow strong em')).toHaveText('非常');
  await expect(page.locator('.page-flow p')).toHaveText('她的头发是白金色的，非常长。');
});

test('single-chapter books hide the chapter number', async ({ page }) => {
  await importBook(page, 'short.txt', '一。\n二。\n');
  await openFirstBook(page);
  await expect(page.locator('.chapter-count')).toBeHidden();
});

test('rejects unsupported files', async ({ page }) => {
  await page.getByTestId('import-input').setInputFiles({ name: 'book.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
  await expect(page.getByText('Only .epub, .txt and .md files are supported')).toBeVisible();
});

test('paginates, turns pages by swipe and keyboard, and crosses chapters', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);

  const start = await pageIndicator(page);
  expect(start).toEqual({ page: 1, total: expect.any(Number) });
  expect(start.total).toBeGreaterThan(2);
  await expect(page.locator('.chapter-title')).toHaveText('第一章 早上');
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 2');
  // No page buttons: the bottom bar only shows where you are (and opens the scrubber).
  await expect(page.locator('.bar.bottom button')).toHaveCount(1);
  await expect(page.locator('.bar.bottom button')).toHaveAccessibleName('Book position');

  // Swiping back on the first page of the book stays put.
  await swipe(page, 'right');
  await expect(page.locator('.page-count')).toHaveText(`1 / ${start.total}`);

  await nextPage(page);
  await expect(page.locator('.page-count')).toHaveText(`2 / ${start.total}`);

  await swipe(page, 'left');
  await expect(page.locator('.page-count')).toHaveText(`3 / ${start.total}`);
  await swipe(page, 'right');
  await expect(page.locator('.page-count')).toHaveText(`2 / ${start.total}`);

  // Swiping past the last page of a chapter opens the next chapter.
  await nextPage(page, start.total - 2);
  await expect(page.locator('.page-count')).toHaveText(`${start.total} / ${start.total}`);
  await swipe(page, 'left');
  await expect(page.locator('.chapter-title')).toHaveText('第二章 镜子');
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 2 of 2');
  await expect(page.locator('.page-count')).toHaveText(/^1 \/ \d+$/);

  // Going back from the first page of a chapter lands on the last page of the previous one.
  await swipe(page, 'right');
  await expect(page.locator('.chapter-title')).toHaveText('第一章 早上');
  await expect(page.locator('.page-count')).toHaveText(`${start.total} / ${start.total}`);
});

test('only the current page is visible (no scrolling)', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  const area = page.locator('.page-area');
  expect(await area.evaluate((e) => getComputedStyle(e).overflow)).toBe('hidden');
  await page.mouse.wheel(0, 2000);
  await expect(page.locator('.page-count')).toHaveText(/^1 \//);
});

test('remembers the reading position across restarts', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  const { total } = await pageIndicator(page);
  await nextPage(page, 3);
  await expect(page.locator('.page-count')).toHaveText(`4 / ${total}`);

  // Back to the library flushes progress immediately.
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('.book-details')).toHaveText(/^\d+% · 2 chapters · Chinese$/);
  await expect(page.locator('.book-details')).not.toHaveText(/^0%/);

  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await openFirstBook(page);
  await expect(page.locator('.page-count')).toHaveText(`4 / ${total}`);
});

test('stores progress as chapter, paragraph and word', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  const { total } = await pageIndicator(page);
  await nextPage(page, total); // last page of chapter 1, then onto chapter 2
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 2 of 2');
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('.book-name')).toBeVisible(); // shown only after progress is saved

  // On web, @capacitor/filesystem keeps files in IndexedDB ("Disc" → "FileStorage", keyed by path).
  const progress = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('Disc');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('FileStorage').objectStore('FileStorage').get('/DATA/library.json');
          get.onsuccess = () => resolve(JSON.parse(get.result.content)[0].progress);
          get.onerror = () => reject(get.error);
        };
      }),
  );
  expect(progress).toMatchObject({ chapter: 1, paragraph: 0, word: 0, char: 0 });
});

test('changing text size re-paginates and keeps the place', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  await nextPage(page, 4);
  await settled(page);
  const before = await pageIndicator(page);
  // The paragraph at the top of the page (it may have started on the previous page).
  const firstVisible = await page.evaluate(() => {
    const area = document.querySelector('.page-area')!.getBoundingClientRect();
    return [...document.querySelectorAll('.page-flow [data-block]')]
      .find((b) => [...b.getClientRects()].some((r) => r.left >= area.left && r.left < area.right))
      ?.getAttribute('data-block');
  });

  await page.getByRole('button', { name: 'Settings' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Larger text' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();

  const after = await pageIndicator(page);
  expect(after.total).toBeGreaterThan(before.total);
  expect(after.page).toBeGreaterThan(before.page);
  // The paragraph that was at the top of the page is still on screen.
  const stillVisible = await page.evaluate((block) => {
    const area = document.querySelector('.page-area')!.getBoundingClientRect();
    const el = document.querySelector(`.page-flow [data-block="${block}"]`)!;
    return [...el.getClientRects()].some((r) => r.left >= area.left && r.left < area.right);
  }, firstVisible);
  expect(stillVisible).toBe(true);
});

test('deletes a book', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete book' }).click();
  await expect(page.getByText('No books yet')).toBeVisible();
});
