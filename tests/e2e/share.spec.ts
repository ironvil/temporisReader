/**
 * Sharing books made with "Create a book": a .temporis.json file that imports on another phone
 * with the same id, so a later version offers to replace it (keeping the reader's place), and an
 * EPUB for other e-readers.
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { dismissLanguageReminder, importBook, nextPage, settled } from './helpers';

/** Numbered one-line paragraphs, so where the reader is can be told from the text. */
const chapterText = (c: number, n: number) => Array.from({ length: n }, (_, p) => `〔${c}-${p + 1}〕今天早上，阳光从高高的窗户里斜斜地照进来，落在桌子上。`).join('\n');

async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
}

/** Another phone: a fresh browser context with its own storage. */
async function otherPhone(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 412, height: 839 } })).newPage();
  await start(page);
  return page;
}

async function createBook(page: Page, title: string, chapters: [string, string][]) {
  await page.getByRole('button', { name: 'Add book' }).click();
  await page.getByRole('menuitem', { name: 'Create a book' }).click();
  const create = page.getByRole('dialog', { name: 'Create a book' });
  await create.getByLabel('Title').fill(title);
  await create.getByRole('button', { name: 'Create' }).click();
  for (const [chapterTitle, text] of chapters) {
    await page.getByRole('button', { name: 'Add chapter' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add chapter' });
    await dialog.getByLabel('Chapter title').fill(chapterTitle);
    await dialog.getByLabel('Chapter text').fill(text);
    await dialog.getByRole('button', { name: 'Add' }).click();
    await expect(dialog).toBeHidden();
  }
}

/** Editor → Share → the chosen format; returns the downloaded file's name and bytes. */
async function share(page: Page, format: 'Temporis book' | 'EPUB'): Promise<{ name: string; bytes: Buffer }> {
  await page.getByRole('button', { name: 'Share book' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Share book' }).getByRole('button', { name: format }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: await readFile((await download.path())!) };
}

async function importFile(page: Page, name: string, bytes: Buffer | string) {
  await page.getByTestId('import-input').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(bytes) });
}

/** The numbers of the paragraphs on the current page (〔c-p〕). */
function shownParagraphs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const area = document.querySelector('.page-area')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.page-flow p')]
      .filter((p) => {
        const range = document.createRange();
        range.selectNodeContents(p);
        return [...range.getClientRects()].some((r) => r.width > 0 && r.left >= area.left - 1 && r.right <= area.right + 1);
      })
      .map((p) => /〔(\d+-\d+)〕/.exec(p.textContent!)?.[1] ?? '')
      .filter(Boolean);
  });
}

const book = (page: Page, title: string) => page.locator('.book', { hasText: title });

test('a created book is shared and imported on another phone with the same id', async ({ page, browser }) => {
  await start(page);
  await createBook(page, '分享的书', [
    ['第一章', chapterText(1, 3)],
    ['第二章', chapterText(2, 3)],
  ]);
  const file = await share(page, 'Temporis book');
  expect(file.name).toBe('分享的书.temporis.json');
  const shared = JSON.parse(file.bytes.toString('utf8'));
  expect(shared).toMatchObject({ app: 'temporis-reader', kind: 'book', version: 1, title: '分享的书', language: 'zh' });
  expect(shared.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(shared.chapters.map((c: { title: string; text: string }) => [c.title, c.text])).toEqual([
    ['第一章', chapterText(1, 3)],
    ['第二章', chapterText(2, 3)],
  ]);
  // Reading progress is personal: it isn't shared.
  expect(JSON.stringify(shared)).not.toContain('progress');

  const other = await otherPhone(browser);
  await importFile(other, file.name, file.bytes);
  await expect(other.getByText('Imported “分享的书”')).toBeVisible();
  await expect(book(other, '分享的书').locator('.book-details')).toHaveText('Not started · 2 chapters · Chinese');
  // It's an editable book there too, with the same id.
  await book(other, '分享的书').getByRole('button', { name: 'Edit 分享的书' }).click();
  expect(JSON.parse((await share(other, 'Temporis book')).bytes.toString('utf8')).id).toBe(shared.id);
});

test('importing the same book again: unchanged is ignored, a new version replaces it and keeps the place', async ({ page }) => {
  await start(page);
  await createBook(page, '长书', [
    ['第一章', chapterText(1, 40)],
    ['第二章', chapterText(2, 60)],
  ]);
  const original = await share(page, 'Temporis book');

  // Read into chapter 2.
  await page.getByRole('button', { name: 'Read' }).click();
  await dismissLanguageReminder(page);
  let shown: string[] = [];
  for (let i = 0; i < 30 && !shown.some((p) => p.startsWith('2-') && Number(p.slice(2)) > 20); i++) {
    await nextPage(page);
    await settled(page);
    shown = await shownParagraphs(page);
  }
  const reading = shown[0];
  expect(reading).toMatch(/^2-/);
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(book(page, '长书').locator('.book-details')).not.toHaveText(/^Not started/);

  // The same file again: nothing to do.
  await importFile(page, original.name, original.bytes);
  await expect(page.getByText('“长书” is already in your library')).toBeVisible();

  // A new version: renamed, a chapter added in front, paragraphs added before the place (more than a page).
  const shared = JSON.parse(original.bytes.toString('utf8'));
  shared.title = '长书（第二版）';
  shared.modifiedAt = '2030-01-01T00:00:00.000Z';
  shared.chapters[1].text = chapterText(9, 30) + '\n' + shared.chapters[1].text;
  shared.chapters.unshift({ id: 'preface-chapter', title: '序', format: 'txt', fileName: null, split: false, text: '序言。' });
  await importFile(page, '长书.temporis.json', JSON.stringify(shared));
  const ask = page.getByRole('dialog', { name: 'Replace this book?' });
  await expect(ask).toContainText('“长书” is already in your library.');
  await expect(ask.locator('[data-version="yours"]')).toHaveText(/^2 chapters · changed /);
  await expect(ask.locator('dt').nth(1)).toHaveText('This file (newer)');
  await expect(ask.locator('[data-version="file"]')).toHaveText(/^3 chapters · changed /);
  await ask.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByText('Replaced “长书（第二版）”')).toBeVisible();

  // One book, the new version, still at the same paragraph.
  await expect(page.locator('.book')).toHaveCount(1);
  await expect(book(page, '长书（第二版）').locator('.book-details')).toHaveText(/^\d+% · 3 chapters · Chinese$/);
  await book(page, '长书（第二版）').locator('.book-open').click();
  await expect(page.locator('.page-count')).toBeVisible();
  await settled(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 3 of 3');
  expect(await shownParagraphs(page)).toContain(reading);
});

test('keeping both adds the new version as a separate book', async ({ page }) => {
  await start(page);
  await createBook(page, '两本', [['第一章', chapterText(1, 3)]]);
  const shared = JSON.parse((await share(page, 'Temporis book')).bytes.toString('utf8'));
  await page.getByRole('button', { name: 'Close editor' }).click();
  shared.chapters[0].text += '\n新的一段。';
  await importFile(page, '两本.temporis.json', JSON.stringify(shared));
  await page.getByRole('dialog', { name: 'Replace this book?' }).getByRole('button', { name: 'Keep both' }).click();
  await expect(page.getByText('Imported “两本” as a separate book')).toBeVisible();
  await expect(page.locator('.book', { hasText: '两本' })).toHaveCount(2);
  // The copy has its own id: sharing it and importing it again is a new book, not a replace.
  await page.locator('.book').first().getByRole('button', { name: 'Edit 两本' }).click();
  const copy = JSON.parse((await share(page, 'Temporis book')).bytes.toString('utf8'));
  expect(copy.id).not.toBe(shared.id);
});

test('cancelling leaves the library as it was', async ({ page }) => {
  await start(page);
  await createBook(page, '不变', [['第一章', chapterText(1, 3)]]);
  const shared = JSON.parse((await share(page, 'Temporis book')).bytes.toString('utf8'));
  await page.getByRole('button', { name: 'Close editor' }).click();
  shared.title = '变了';
  await importFile(page, 'x.temporis.json', JSON.stringify(shared));
  await page.getByRole('dialog', { name: 'Replace this book?' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.book-name')).toHaveText(['不变']);
});

test('shared as an EPUB, it opens in any reader (here, as an EPUB)', async ({ page, browser }) => {
  await start(page);
  await createBook(page, 'EPUB 书', [
    ['第一章', chapterText(1, 3)],
    ['第二章', chapterText(2, 3)],
  ]);
  const epub = await share(page, 'EPUB');
  expect(epub.name).toBe('EPUB 书.epub');
  expect(epub.bytes.subarray(30, 38).toString()).toBe('mimetype');

  const other = await otherPhone(browser);
  await other.getByTestId('import-input').setInputFiles({ name: epub.name, mimeType: 'application/epub+zip', buffer: epub.bytes });
  await expect(other.getByText('Imported “EPUB 书”')).toBeVisible();
  await expect(book(other, 'EPUB 书').locator('.book-details')).toHaveText('Not started · 2 chapters · Chinese');
});

test('only books made with Create a book have Share', async ({ page }) => {
  await start(page);
  await importBook(page, 'whole.txt', `第一章\n${chapterText(1, 3)}\n第二章\n${chapterText(2, 3)}`);
  await book(page, 'whole').getByRole('button', { name: 'Edit whole' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit book' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share book' })).toBeHidden();
});

test('a file that isn’t a shared book is refused with a reason', async ({ page }) => {
  await start(page);
  await importFile(page, 'other.json', '{"app": "something-else"}');
  await expect(page.getByText('Not a Temporis book file')).toBeVisible();
});
