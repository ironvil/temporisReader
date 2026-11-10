import { expect, test, type Page } from '@playwright/test';
import { chineseBook, importBook, nextPage, openFirstBook, pageIndicator } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
});

async function createBook(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add book' }).click();
  await page.getByRole('menuitem', { name: 'Create a book' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a book' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit book' })).toBeVisible();
}

async function pasteChapter(page: Page, text: string, options: { title?: string; markdown?: boolean } = {}) {
  await page.getByRole('button', { name: 'Add chapter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add chapter' });
  if (options.title) await dialog.getByLabel('Chapter title').fill(options.title);
  await dialog.getByLabel('Chapter text').fill(text);
  if (options.markdown) await dialog.getByLabel('Format').selectOption('md');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toBeHidden();
}

async function fileChapter(page: Page, name: string, text: string, title = '') {
  await page.getByRole('button', { name: 'Add chapter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add chapter' });
  if (title) await dialog.getByLabel('Chapter title').fill(title);
  await dialog.getByTestId('chapter-file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(dialog.getByText(name)).toBeVisible();
  await expect(dialog.getByLabel('Chapter text')).toBeHidden();
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toBeHidden();
}

async function expectChapters(page: Page, titles: string[]) {
  await expect
    .poll(() => page.locator('.chapter-row .chapter-main input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)))
    .toEqual(titles);
}

async function read(page: Page) {
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.page-count')).toHaveText(/^\d+ \/ \d+$/);
}

const longChapter = (word: string) => Array.from({ length: 30 }, () => `${word}今天早上，阳光从高高的窗户里斜斜地照进来，落在桌子上。`).join('\n');

test('create a book and build it from pasted text and files', async ({ page }) => {
  await createBook(page, '我的书');
  await expect(page.getByText('No chapters yet. Add one')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read' })).toBeHidden();

  await pasteChapter(page, '她的头发很长。\n第二段。', { title: '第一章 头发' });
  await fileChapter(page, 'mirror.md', '# 第二章 镜子\n\n她对**镜子**说。');
  await pasteChapter(page, '没有标题的文字。');
  await expectChapters(page, ['第一章 头发', '第二章 镜子', 'Chapter 3']);
  await expect(page.locator('.chapter-details')).toHaveText([
    '2 paragraphs · Pasted text',
    '2 paragraphs · mirror.md',
    '1 paragraph · Pasted text',
  ]);

  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.locator('.book-name')).toHaveText('我的书');
  await expect(page.locator('.book-details')).toHaveText('Not started · 3 chapters · Chinese');

  await openFirstBook(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 3');
  await expect(page.locator('.chapter-title')).toHaveText('第一章 头发');
  await nextPage(page);
  await expect(page.locator('.chapter-title')).toHaveText('第二章 镜子');
  await expect(page.locator('.page-flow strong')).toHaveText('镜子');
  await nextPage(page);
  await expect(page.locator('.chapter-title')).toHaveText('Chapter 3');
});

test('reorder, rename and delete chapters', async ({ page }) => {
  await createBook(page, 'Book');
  await pasteChapter(page, '甲。', { title: 'A' });
  await pasteChapter(page, '乙。', { title: 'B' });
  await pasteChapter(page, '丙。', { title: 'C' });

  await expect(page.getByRole('button', { name: 'Move A up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move C down' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move C up' }).click();
  await expectChapters(page, ['A', 'C', 'B']);
  await page.getByRole('button', { name: 'Move A down' }).click();
  await expectChapters(page, ['C', 'A', 'B']);

  await page.getByLabel('Title of chapter 2').fill('A renamed');
  await page.getByLabel('Title of chapter 2').press('Enter');
  await expectChapters(page, ['C', 'A renamed', 'B']);

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete C', exact: true }).click();
  await expectChapters(page, ['A renamed', 'B']);

  await page.getByLabel('Title', { exact: true }).fill('Renamed book');
  await page.getByLabel('Title', { exact: true }).press('Enter');
  await read(page);
  await expect(page.locator('.book-title')).toHaveText('Renamed book');
  await expect(page.locator('.chapter-title')).toHaveText('A renamed');
  await expect(page.locator('.page-flow')).toHaveText('甲。');
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 2');
});

test('reading position follows its chapter when chapters are reordered', async ({ page }) => {
  await createBook(page, 'Book');
  await pasteChapter(page, longChapter('一'), { title: 'One' });
  await pasteChapter(page, longChapter('二'), { title: 'Two' });
  await read(page);

  const { total } = await pageIndicator(page);
  await nextPage(page, total + 1); // second page of "Two"
  await expect(page.locator('.chapter-title')).toHaveText('Two');
  const before = await pageIndicator(page);
  expect(before.page).toBe(2);

  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Edit Book' }).click();
  await page.getByRole('button', { name: 'Move Two up' }).click();
  await expectChapters(page, ['Two', 'One']);
  await read(page);

  await expect(page.locator('.chapter-title')).toHaveText('Two');
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 2');
  await expect(page.locator('.page-count')).toHaveText(`2 / ${before.total}`);
});

test('deleting the chapter being read moves to the chapter in its place', async ({ page }) => {
  await createBook(page, 'Book');
  await pasteChapter(page, '甲。', { title: 'A' });
  await pasteChapter(page, '乙。', { title: 'B' });
  await pasteChapter(page, '丙。', { title: 'C' });
  await read(page);
  await nextPage(page);
  await expect(page.locator('.chapter-title')).toHaveText('B');

  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Edit Book' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete B', exact: true }).click();
  await expectChapters(page, ['A', 'C']);
  await read(page);
  await expect(page.locator('.chapter-title')).toHaveText('C');
});

test('imported books can be extended with chapters', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  await page.getByRole('button', { name: 'Edit book' }).click();
  await expectChapters(page, ['book']);
  await expect(page.locator('.chapter-details')).toHaveText('2 chapters · book.txt');

  await pasteChapter(page, '附录的内容。', { title: '附录' });
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.locator('.book-details')).toHaveText('Not started · 3 chapters · Chinese');
  await openFirstBook(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 3');
});

test('add chapter validates input and rejects unsupported files', async ({ page }) => {
  await createBook(page, 'Book');
  await page.getByRole('button', { name: 'Add chapter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add chapter' });
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose a file or paste some text');

  await dialog.getByTestId('chapter-file-input').setInputFiles({ name: 'x.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('x') });
  await expect(page.getByText('Only .txt and .md files are supported')).toBeVisible();
  await expect(dialog.getByLabel('Chapter text')).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('No chapters yet. Add one')).toBeVisible();
});

test('tapping a book with no chapters opens the editor', async ({ page }) => {
  await createBook(page, 'Empty');
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.locator('.book-details')).toHaveText('No chapters yet');
  await page.locator('.book-open').click();
  await expect(page.getByRole('dialog', { name: 'Edit book' })).toBeVisible();
});

test('books stored by older versions are migrated', async ({ page }) => {
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  await nextPage(page, 2);
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('.book-name')).toBeVisible();

  // Rewrite storage into the 0.3 layout: no sources, single source.txt, old index version,
  // progress without source tracking.
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const o = indexedDB.open('Disc');
      o.onsuccess = () => res(o.result);
      o.onerror = () => rej(o.error);
    });
    const store = () => db.transaction('FileStorage', 'readwrite').objectStore('FileStorage');
    const get = (key: string) => new Promise<any>((res) => (store().get(key).onsuccess = (e) => res((e.target as IDBRequest).result)));
    const put = (value: unknown) => new Promise((res) => (store().put(value).onsuccess = res));

    const libraryEntry = await get('/DATA/library.json');
    const [book] = JSON.parse(libraryEntry.content);
    const sourceEntry = await get(`/DATA/books/${book.id}/${book.sources[0].path}`);
    await put({ ...sourceEntry, path: `/DATA/books/${book.id}/source.txt`, folder: `/DATA/books/${book.id}` });

    const indexEntry = await get(`/DATA/books/${book.id}/index.json`);
    await put({ ...indexEntry, content: JSON.stringify({ ...JSON.parse(indexEntry.content), version: 2 }) });

    const { sources, ...legacy } = book;
    delete legacy.progress.source;
    delete legacy.progress.sourceChapter;
    await put({ ...libraryEntry, content: JSON.stringify([{ ...legacy, fileName: 'book.txt', format: 'txt' }]) });
    void sources;
  });

  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await openFirstBook(page);
  await expect(page.locator('.page-count')).toHaveText(/^3 \//);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 2');

  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Edit book' }).click();
  await expect(page.locator('.chapter-details')).toHaveText('2 chapters · book.txt');
});

test('add a whole-book file split into chapters at its headings', async ({ page }) => {
  await createBook(page, 'Collection');
  await pasteChapter(page, '序言的内容。', { title: '序言' });

  await page.getByRole('button', { name: 'Add chapter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add chapter' });
  await dialog.getByTestId('chapter-file-input').setInputFiles({ name: 'owl.txt', mimeType: 'text/plain', buffer: Buffer.from(chineseBook()) });
  await expect(dialog.locator('.split-preview')).toHaveText('Adds 1 chapter');
  await dialog.getByText('Split into chapters at headings').click();
  await expect(dialog.locator('.split-preview')).toHaveText('Adds 2 chapters');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toBeHidden();

  await expectChapters(page, ['序言', 'owl']);
  await expect(page.locator('.chapter-details').nth(1)).toHaveText('2 chapters · owl.txt');

  await read(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 3');
  await nextPage(page);
  await expect(page.locator('.chapter-title')).toHaveText('第一章 早上');
});

test('pasted markdown can be split too', async ({ page }) => {
  await createBook(page, 'Notes');
  await page.getByRole('button', { name: 'Add chapter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add chapter' });
  await dialog.getByLabel('Chapter text').fill('# 书名\n\n## 一\n\n甲。\n\n## 二\n\n乙。\n\n## 三\n\n丙。');
  await dialog.getByLabel('Format').selectOption('md');
  await dialog.getByText('Split into chapters at headings').click();
  await expect(dialog.locator('.split-preview')).toHaveText('Adds 3 chapters');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expectChapters(page, ['书名']);
  await expect(page.locator('.chapter-details')).toHaveText('3 chapters · Pasted text');
});

test('the add-chapter format remembers the last choice, across restarts', async ({ page }) => {
  await createBook(page, 'Book');
  await page.getByRole('button', { name: 'Add chapter' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add chapter' });
  await expect(dialog.getByLabel('Format')).toHaveValue('txt'); // default
  await dialog.getByLabel('Format').selectOption('md');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Add chapter' }).click();
  dialog = page.getByRole('dialog', { name: 'Add chapter' });
  await expect(dialog.getByLabel('Format')).toHaveValue('md');
  await dialog.getByLabel('Chapter text').fill('**粗体**');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.getByRole('button', { name: 'Edit Book' }).click();
  await page.getByRole('button', { name: 'Add chapter' }).click();
  await expect(page.getByRole('dialog', { name: 'Add chapter' }).getByLabel('Format')).toHaveValue('md');
  await page.getByRole('dialog', { name: 'Add chapter' }).getByLabel('Format').selectOption('txt');
  await page.getByRole('dialog', { name: 'Add chapter' }).getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Add chapter' }).click();
  await expect(page.getByRole('dialog', { name: 'Add chapter' }).getByLabel('Format')).toHaveValue('txt');
});
