/**
 * Library backup & restore. The round trip restores into a brand-new browser context (empty
 * storage), which is what a reinstall looks like.
 */
import { readFile } from 'node:fs/promises';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { addChinese, chineseBook, importBook, nextPage, openFirstBook } from './helpers';

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  return page;
}

async function download(page: Page, button: string): Promise<{ name: string; text: string }> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const file = await pending;
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, 'utf8') };
}

async function restore(page: Page, text: string, accept = true): Promise<string> {
  await page.getByRole('button', { name: 'Settings' }).click();
  const confirmation = page.waitForEvent('dialog');
  await page.getByTestId('restore-input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  const dialog = await confirmation;
  const message = dialog.message();
  await (accept ? dialog.accept() : dialog.dismiss());
  return message;
}

const KNOWN = ['{', '  "version": 1,', '  "updated": "2026-11-01",', '  "words": {', '    "今天": [3, "2026-11-01"],', '    "阳光": [1, "2026-10-01"]', '  }', '}', ''].join('\n');

/** Builds a library with an imported book (read to page 3), a composed book, known words and settings. */
async function buildLibrary(page: Page): Promise<{ totalPages: number }> {
  await addChinese(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('known-words-import-zh').setInputFiles({ name: 'k.json', mimeType: 'application/json', buffer: Buffer.from(KNOWN) });
  await expect(page.getByText(/^Imported:/)).toBeVisible();
  await page.getByRole('button', { name: 'Larger text' }).click(); // 24px
  await page.getByLabel('Highlight words you don’t know yet').check();
  await page.getByRole('button', { name: 'Close settings' }).click();

  await importBook(page, '猫头鹰.txt', chineseBook());
  await openFirstBook(page);
  const totalPages = Number((await page.locator('.page-count').textContent())!.split(' / ')[1]);
  await nextPage(page, 2);
  await expect(page.locator('.page-count')).toHaveText(`3 / ${totalPages}`);
  await page.getByRole('button', { name: 'Library' }).click();

  await page.getByRole('button', { name: 'Add book' }).click();
  await page.getByRole('menuitem', { name: 'Create a book' }).click();
  await page.getByRole('dialog', { name: 'Create a book' }).getByLabel('Title').fill('短篇');
  await page.getByRole('button', { name: 'Create' }).click();
  for (const [title, text] of [
    ['甲章', '她的**头发**很长。'],
    ['乙章', '镜子。'],
  ]) {
    await page.getByRole('button', { name: 'Add chapter' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add chapter' });
    await dialog.getByLabel('Chapter title').fill(title);
    await dialog.getByLabel('Chapter text').fill(text);
    await dialog.getByLabel('Format').selectOption('md');
    await dialog.getByRole('button', { name: 'Add' }).click();
    await expect(dialog).toBeHidden();
  }
  await page.getByRole('button', { name: 'Move 乙章 up' }).click();
  await page.getByRole('button', { name: 'Close editor' }).click();
  return { totalPages };
}

test('back up a library and restore it on a fresh install', async ({ page, browser }) => {
  const { totalPages } = await buildLibrary(page);
  const libraryBefore = await page.locator('.book').evaluateAll((els) => els.map((e) => e.querySelector('.book-name')!.textContent + '|' + e.querySelector('.book-details')!.textContent));

  await page.getByRole('button', { name: 'Settings' }).click();
  const backup = await download(page, 'Back up library');
  expect(backup.name).toMatch(/^temporis-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const knownBefore = await download(page, 'Export known words');

  // Fresh install.
  const fresh = await freshPage(browser);
  await expect(fresh.getByText('No books yet')).toBeVisible();
  const message = await restore(fresh, backup.text);
  expect(message).toMatch(/^Restore 2 books from the backup made .+\? Your current books, reading progress, known words and settings will be replaced\.$/);
  await fresh.waitForEvent('load');
  await expect(fresh.locator('body[data-ready]')).toBeAttached();

  // Library, progress and order of books.
  await expect
    .poll(() => fresh.locator('.book').evaluateAll((els) => els.map((e) => e.querySelector('.book-name')!.textContent + '|' + e.querySelector('.book-details')!.textContent)))
    .toEqual(libraryBefore);

  // Settings came back (and the same text size gives the same pagination).
  await fresh.getByRole('button', { name: 'Settings' }).click();
  await expect(fresh.locator('.font-size-value')).toHaveText('24px');
  await expect(fresh.getByLabel('Highlight words you don’t know yet')).toBeChecked();
  // Known words are byte-for-byte the same.
  expect((await download(fresh, 'Export known words')).text).toBe(knownBefore.text);
  // Dictionaries aren't in the backup.
  await expect(fresh.locator('[data-language="zh"] .lang-status')).toHaveText(/^Not added/);
  await fresh.getByRole('button', { name: 'Close settings' }).click();

  // Reading position restored.
  await fresh.locator('.book-open', { hasText: '猫头鹰' }).click();
  await expect(fresh.locator('.page-count')).toHaveText(`3 / ${totalPages}`);
  await fresh.getByRole('button', { name: 'Library' }).click();

  // Composed book: chapter order, titles and markdown survived.
  await fresh.getByRole('button', { name: 'Edit 短篇' }).click();
  await expect
    .poll(() => fresh.locator('.chapter-row .chapter-main input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)))
    .toEqual(['乙章', '甲章']);
  await fresh.getByRole('button', { name: 'Read' }).click();
  await expect(fresh.locator('.chapter-title')).toHaveText('乙章');
  await fresh.keyboard.press('ArrowRight');
  await expect(fresh.locator('.page-flow strong')).toHaveText('头发');
  await fresh.context().close();
});

test('restoring replaces what is there', async ({ page, browser }) => {
  await buildLibrary(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const backup = await download(page, 'Back up library');

  const other = await freshPage(browser);
  await importBook(other, 'other.txt', '另一本书。');
  await expect(other.locator('.book-name')).toHaveText('other');
  await restore(other, backup.text);
  await other.waitForEvent('load');
  await expect(other.locator('body[data-ready]')).toBeAttached();
  await expect(other.locator('.book-name')).toHaveText(['短篇', '猫头鹰']);
  await other.context().close();
});

test('cancelling the restore changes nothing', async ({ page }) => {
  await importBook(page, 'keep.txt', '保留。');
  await page.getByRole('button', { name: 'Settings' }).click();
  const backup = await download(page, 'Back up library');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await importBook(page, 'second.txt', '第二本。');
  await restore(page, backup.text, false);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('.book-name')).toHaveText(['second', 'keep']);
});

test('invalid backups are rejected before anything is touched', async ({ page }) => {
  await importBook(page, 'keep.txt', '保留。');
  const cases: [string, string][] = [
    ['not json', 'Restore failed: Not a backup file (not JSON)'],
    ['{"version":1,"words":{}}', 'Restore failed: Not a Temporis Reader backup'],
    ['{"app":"temporis-reader","backupVersion":99,"library":[],"files":{},"knownWords":{}}', 'Restore failed: This backup was made by a newer version of the app'],
    [
      '{"app":"temporis-reader","backupVersion":1,"library":[{"id":"x","title":"缺","sources":[{"path":"sources/a.txt"}]}],"files":{},"knownWords":{}}',
      'Restore failed: The backup is missing text for “缺”',
    ],
  ];
  await page.getByRole('button', { name: 'Settings' }).click();
  let asked = false;
  page.on('dialog', (d) => {
    asked = true;
    void d.dismiss();
  });
  for (const [text, error] of cases) {
    await page.getByTestId('restore-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.getByText(error)).toBeVisible();
  }
  expect(asked).toBe(false);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('.book-name')).toHaveText('keep');
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
});
