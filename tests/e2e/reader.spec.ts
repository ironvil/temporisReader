import { expect, test } from '@playwright/test';
import { chineseBook, importBook, openFirstBook, pageIndicator, settled, swipe } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
});

test('empty library offers import and the dictionary download', async ({ page }) => {
  await expect(page.getByText('No books yet')).toBeVisible();
  await expect(page.getByText('Download the Chinese dictionary?')).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('Download the Chinese dictionary?')).toBeHidden();
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await expect(page.getByText('Download the Chinese dictionary?')).toBeHidden();
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

test('rejects unsupported files', async ({ page }) => {
  await page.getByTestId('import-input').setInputFiles({ name: 'book.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('x') });
  await expect(page.getByText('Only .txt and .md files are supported')).toBeVisible();
});

test('paginates, turns pages by button and swipe, and crosses chapters', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);

  const start = await pageIndicator(page);
  expect(start).toEqual({ page: 1, total: expect.any(Number) });
  expect(start.total).toBeGreaterThan(2);
  await expect(page.locator('.chapter-title')).toHaveText('第一章 早上');
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.page-indicator')).toHaveText(`2 / ${start.total}`);

  await swipe(page, 'left');
  await expect(page.locator('.page-indicator')).toHaveText(`3 / ${start.total}`);
  await swipe(page, 'right');
  await expect(page.locator('.page-indicator')).toHaveText(`2 / ${start.total}`);

  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(page.locator('.chapter-title')).toHaveText('第二章 镜子');
  await expect(page.locator('.page-indicator')).toHaveText(/^1 \/ \d+$/);

  // Going back from the first page of a chapter lands on the last page of the previous one.
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.locator('.chapter-title')).toHaveText('第一章 早上');
  await expect(page.locator('.page-indicator')).toHaveText(`${start.total} / ${start.total}`);
});

test('only the current page is visible (no scrolling)', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  const area = page.locator('.page-area');
  expect(await area.evaluate((e) => getComputedStyle(e).overflow)).toBe('hidden');
  await page.mouse.wheel(0, 2000);
  await expect(page.locator('.page-indicator')).toHaveText(/^1 \//);
});

test('remembers the reading position across restarts', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  const { total } = await pageIndicator(page);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.page-indicator')).toHaveText(`4 / ${total}`);

  // Back to the library flushes progress immediately.
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('.book-details')).toHaveText(/^\d+% · 2 chapters · Chinese$/);
  await expect(page.locator('.book-details')).not.toHaveText(/^0%/);

  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await openFirstBook(page);
  await expect(page.locator('.page-indicator')).toHaveText(`4 / ${total}`);
});

test('stores progress as chapter, paragraph and word', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  await page.getByRole('button', { name: 'Next chapter' }).click();
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
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next page' }).click();
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
