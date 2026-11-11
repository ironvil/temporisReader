import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { assembleBook, parseEpub, PARSER_VERSION } from '@temporis/book-parser';
import { dismissLanguageReminder, nextPage, withStorage } from './helpers';

const MONTE_CRISTO = 'pg17989-images-3.epub';
const FAUST = 'pg2229-images-3.epub';
const CHINESE = 'Ha Li _Bo Te Yu Li Xing Zhi Dao - Eliezer Yudkowsky.epub';
/** Has paragraphs of only `* * *`, which parser version 4 kept as text. */
const KANT = 'pg6343-images-3.epub';
const fixture = (name: string) => readFileSync(new URL(`../test epubs/${name}`, import.meta.url));

async function importEpub(page: Page, name: string, as = name): Promise<void> {
  await page.getByTestId('import-input').setInputFiles({ name: as, mimeType: 'application/epub+zip', buffer: fixture(name) });
}

const deviceFiles = (page: Page) => withStorage(page, async (s) => (await s.keys()).filter((k) => k.startsWith('/DATA/device-files/') && k.endsWith('.epub')), null);

/** Acts out moving the file away: the stand-in device storage no longer has it. */
async function moveFileAway(page: Page): Promise<void> {
  await withStorage(page, async (s) => {
    for (const k of await s.keys()) if (k.startsWith('/DATA/device-files')) await s.remove(k);
  }, null);
}

/** Acts out editing the file: different bytes (so a different checksum), same text. */
async function editFile(page: Page): Promise<void> {
  await withStorage(page, async (s) => {
    const key = (await s.keys()).find((k) => k.startsWith('/DATA/device-files/') && k.endsWith('.epub'))!;
    const entry = await s.get(key);
    const bytes = new Uint8Array(await (entry.content as Blob).arrayBuffer());
    await s.put({ ...entry, content: new Blob([bytes, new Uint8Array([1, 2, 3])]) });
  }, null);
}

async function openBook(page: Page): Promise<void> {
  await page.locator('.book-open').first().click();
  await expect(page.locator('.page-count')).toHaveText(/^\d+ \/ \d+$/);
  await dismissLanguageReminder(page);
}

/** "2 / 35 · Chapter 2 of 32": where the reader is. */
const position = async (page: Page) => `${await page.locator('.page-count').textContent()} · ${await page.locator('.chapter-count').textContent()}`;

/** Turns a few pages into the first real chapter and returns the position reached. */
async function readAWhile(page: Page): Promise<string> {
  await nextPage(page, 3);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 2 of 32');
  await expect(page.locator('.page-count')).toHaveText(/^3 \//);
  return position(page);
}

async function backToLibrary(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('.book-name').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
});

test('an EPUB is imported as metadata only, with its title, author and language', async ({ page }) => {
  await importEpub(page, MONTE_CRISTO);
  await expect(page.getByText('Imported “Le comte de Monte-Cristo, Tome I”')).toBeVisible();
  await expect(page.locator('.book-name')).toHaveText('Le comte de Monte-Cristo, Tome I');
  await expect(page.locator('.book-details')).toHaveText('Alexandre Dumas, Auguste Maquet · Not started · 32 chapters · French');

  const stored = await withStorage(page, async (s) => {
    const [book] = JSON.parse((await s.get('/DATA/library.json')).content);
    const keys = await s.keys();
    const bookFiles = keys.filter((k) => k.startsWith(`/DATA/books/${book.id}/`));
    const derivedFiles = keys.filter((k) => k.startsWith(`/DATA/derived/${book.id}/`));
    const layout = (await s.get(`/DATA/derived/${book.id}/layout.json`))?.content as string | undefined;
    return { source: book.sources[0], bookFiles, derivedFiles: derivedFiles.map((k) => k.split('/').pop()), layout };
  }, null);
  expect(stored.source).toMatchObject({ format: 'epub', fileName: MONTE_CRISTO, path: '', file: { name: MONTE_CRISTO, size: fixture(MONTE_CRISTO).length } });
  expect(stored.source.file.checksum).toMatch(/^[0-9a-f]{64}$/);
  // Nothing of the book's text is stored: no source copy, no content.txt or index.json, only the
  // layout (chapters, offsets, which parts of which files) for opening at one chapter.
  expect(stored.bookFiles).toEqual([]);
  expect(stored.derivedFiles).toEqual(['layout.json']);
  expect(stored.layout).toContain('Marseille');
  expect(stored.layout).not.toContain('la vigie de Notre-Dame de la Garde');

  await openBook(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 32');
  await expect(page.locator('.page-flow')).toContainText('LE COMTE DE MONTE-CRISTO');
});

test('a Chinese EPUB tagged "en" is detected as Chinese and opens at its first chapter', async ({ page }) => {
  await importEpub(page, CHINESE);
  await expect(page.getByText('Imported “哈利·波特与理性之道”')).toBeVisible();
  await expect(page.locator('.book-details')).toHaveText('Eliezer Yudkowsky · Not started · 128 chapters · Chinese');
  await openBook(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 128');
  await expect(page.locator('.page-flow')).toContainText('《哈利·波特与理性之道》');
});

test('importing the same EPUB twice keeps one book', async ({ page }) => {
  await importEpub(page, FAUST);
  await expect(page.getByText(/^Imported/)).toBeVisible();
  await importEpub(page, FAUST, 'copy of faust.epub');
  await expect(page.getByText('“Faust: Der Tragödie erster Teil” is already in your library')).toBeVisible();
  await expect(page.locator('.book')).toHaveCount(1);
  // The unused second copy isn't kept.
  expect(await deviceFiles(page)).toHaveLength(1);
});

test('a changed file is re-indexed and the reading position is kept', async ({ page }) => {
  await importEpub(page, MONTE_CRISTO);
  await openBook(page);
  const place = await readAWhile(page);
  await backToLibrary(page);

  // Unchanged: opens without a notice.
  await openBook(page);
  await expect(page.getByText(/changed since you last read it/)).toHaveCount(0);
  expect(await position(page)).toBe(place);
  await backToLibrary(page);

  const before = await withStorage(page, async (s) => JSON.parse((await s.get('/DATA/library.json')).content)[0].sources[0].file.checksum, null);
  await editFile(page);
  await openBook(page);
  await expect(page.getByText(`“${MONTE_CRISTO}” changed since you last read it, so the book was reloaded`)).toBeVisible();
  await expect(page.locator('.page-count')).toHaveText(/^3 \//);
  expect(await position(page)).toBe(place);
  const after = await withStorage(page, async (s) => JSON.parse((await s.get('/DATA/library.json')).content)[0].sources[0].file.checksum, null);
  expect(after).not.toBe(before);
});

test('a book indexed by an older EPUB parser gets its chapters redone, keeping the place', async ({ page }) => {
  await importEpub(page, MONTE_CRISTO);
  await openBook(page);
  const place = await readAWhile(page);
  await backToLibrary(page);

  // Act out a book imported before the parser changed: no parser version, an old chapter count.
  await withStorage(page, async (s) => {
    const entry = await s.get('/DATA/library.json');
    const books = JSON.parse(entry.content);
    delete books[0].sources[0].file.parser;
    books[0].chapterCount = 99;
    await s.put({ ...entry, content: JSON.stringify(books) });
  }, null);
  await page.reload();
  await expect(page.locator('.book-details')).toContainText('99 chapters');

  await openBook(page);
  expect(await position(page)).toBe(place);
  await expect(page.getByText(/changed since you last read it/)).toHaveCount(0);
  await backToLibrary(page);
  await expect(page.locator('.book-details')).toContainText('32 chapters');
  const parser = await withStorage(page, async (s) => JSON.parse((await s.get('/DATA/library.json')).content)[0].sources[0].file.parser, null);
  expect(parser).toBeGreaterThan(1);
});

test.describe('a book read before scene breaks keeps its exact place', () => {
  // Parser version 4 kept each `* * *` as a paragraph; now they're breaks between paragraphs, so the
  // text is shorter. A place saved then is a fraction of the longer text.
  async function placeSavedByVersion4(page: Page, paragraph: number, char: number): Promise<void> {
    const book = await parseEpub(new Uint8Array(fixture(KANT)), 'x');
    const { index, content } = assembleBook([{ source: { id: 's', title: 'x', split: true, chapterCount: 0, paragraphCount: 0 }, parsed: book }]);
    const before = book.removedBreaks.filter(([p]) => p <= paragraph).reduce((sum, [, length]) => sum + length + 1, 0);
    const all = book.removedBreaks.reduce((sum, [, length]) => sum + length + 1, 0);
    const fraction = (index.paragraphOffsets[paragraph] + char + before) / (content.length + all);
    await withStorage(page, async (s, fraction) => {
      const entry = await s.get('/DATA/library.json');
      const books = JSON.parse(entry.content);
      books[0].sources[0].file.parser = 4;
      // Paragraph and char were counted with the * * * paragraphs in: only the fraction is used.
      books[0].progress = { ...books[0].progress, chapter: 0, paragraph: 0, word: 0, char: 0, fraction, updatedAt: 1 };
      await s.put({ ...entry, content: JSON.stringify(books) });
      const layout = (await s.keys()).find((k) => k.endsWith('/layout.json'))!;
      const saved = await s.get(layout);
      await s.put({ ...saved, content: JSON.stringify({ ...JSON.parse(saved.content), version: 4 }) });
    }, fraction);
    await page.reload();
    await expect(page.locator('body[data-ready]')).toBeAttached();
  }

  async function reopenedAt(page: Page): Promise<{ chapter: number; paragraph: number; char: number }> {
    await openBook(page);
    await backToLibrary(page);
    const { chapter, paragraph, char } = await withStorage(page, async (s) => JSON.parse((await s.get('/DATA/library.json')).content)[0].progress, null);
    return { chapter, paragraph, char };
  }

  test('an EPUB', async ({ page }) => {
    await importEpub(page, KANT);
    await expect(page.getByText(/^Imported/)).toBeVisible();
    // Chapter 47 (paragraphs 362–371) has * * * paragraphs before 367 and 370; three come before 371.
    await placeSavedByVersion4(page, 371, 7);
    expect(await reopenedAt(page)).toEqual({ chapter: 46, paragraph: 9, char: 7 });

    // A place on a * * * itself goes to the start of the paragraph after it.
    await placeSavedByVersion4(page, 370, -3);
    expect(await reopenedAt(page)).toEqual({ chapter: 46, paragraph: 8, char: 0 });

    // The breaks are shown, and the file is now marked as read by this parser.
    await openBook(page);
    const parser = await withStorage(page, async (s) => JSON.parse((await s.get('/DATA/library.json')).content)[0].sources[0].file.parser, null);
    expect(parser).toBe(PARSER_VERSION);
  });
});

test('a big EPUB opens at its saved chapter first; the rest loads in the background', async ({ page }) => {
  await importEpub(page, CHINESE);
  await expect(page.getByText(/^Imported/)).toBeVisible();
  // Saved in chapter 60, as if read there before.
  await withStorage(page, async (s) => {
    const entry = await s.get('/DATA/library.json');
    const books = JSON.parse(entry.content);
    books[0].progress = { chapter: 59, paragraph: 0, word: 0, char: 0, fraction: 0.5, updatedAt: 1 };
    await s.put({ ...entry, content: JSON.stringify(books) });
  }, null);

  // Hold back the whole-book parse's result until the test lets it go.
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.evaluate(() => {
    window.__holdBookParse = new Promise((r) => ((window as unknown as { release: () => void }).release = r));
  });
  const release = () => page.evaluate(() => (window as unknown as { release: () => void }).release());
  await openBook(page);

  // Shown from the chapter's own files while the rest waits; the scrubber can't open yet.
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 60 of 128');
  await expect(page.locator('.reader')).not.toHaveAttribute('data-complete');
  const indicator = page.getByRole('button', { name: /^Book position/ });
  await expect(indicator).toBeDisabled();
  await expect(indicator).toHaveAttribute('aria-busy', 'true');
  await expect(indicator.locator('.spinner')).toBeVisible();
  const fullBook = await parseEpub(new Uint8Array(fixture(CHINESE)), 'x');
  const chapter = fullBook.chapters[59];
  await expect(page.locator('.page-flow')).toContainText(fullBook.paragraphs[chapter.start + 1].slice(0, 20));

  // The next chapter was read too, so turning into it doesn't wait.
  while ((await page.locator('.chapter-count').textContent()) === 'Chapter 60 of 128') await nextPage(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 61 of 128');
  await nextPage(page);
  const turned = await page.locator('.page-count').textContent();

  // Progress saved from the partly loaded book is the whole book's: same offsets as a full parse.
  await backToLibrary(page);
  const progress = await withStorage(page, async (s) => JSON.parse((await s.get('/DATA/library.json')).content)[0].progress, null);
  const { index, content } = assembleBook([
    { source: { id: 's', title: 'x', split: true, chapterCount: 0, paragraphCount: 0 }, parsed: fullBook },
  ]);
  const offset = index.paragraphOffsets[index.chapters[progress.chapter].start + progress.paragraph] + progress.char;
  expect(progress.chapter).toBe(60);
  expect(progress.fraction).toBeCloseTo(offset / content.length, 10);

  // A chapter far away waits for the rest of the book, then opens.
  await openBook(page);
  await expect(page.locator('.page-count')).toHaveText(turned!);
  await page.getByRole('button', { name: 'Chapters' }).click();
  await page.getByRole('dialog', { name: 'Chapters' }).locator('.toc-item').nth(2).click();
  await expect(page.getByText('Loading the rest of the book…')).toBeVisible();
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 61 of 128');
  await release();
  await expect(page.locator('.reader')).toHaveAttribute('data-complete', 'true');
  await expect(indicator).toBeEnabled();
  await expect(indicator.locator('.spinner')).toBeHidden();
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 3 of 128');
  await expect(page.locator('.page-flow')).toContainText(fullBook.paragraphs[fullBook.chapters[2].start + 1].slice(0, 20));
});

test('an EPUB changed since its layout was saved is loaded in full', async ({ page }) => {
  await importEpub(page, MONTE_CRISTO);
  await openBook(page);
  const place = await readAWhile(page);
  await backToLibrary(page);
  await editFile(page);
  await openBook(page);
  await expect(page.getByText(`“${MONTE_CRISTO}” changed since you last read it, so the book was reloaded`)).toBeVisible();
  await expect(page.locator('.reader')).toHaveAttribute('data-complete', 'true');
  expect(await position(page)).toBe(place);
  // The next open is quick again, from the new layout, with no notice.
  await backToLibrary(page);
  // (The notice fades out but stays in the page.)
  await expect(page.locator('#toast')).not.toHaveClass(/visible/, { timeout: 10_000 });
  await openBook(page);
  expect(await position(page)).toBe(place);
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
});

test('a missing file can be found again, keeping the place', async ({ page }) => {
  await importEpub(page, MONTE_CRISTO);
  await openBook(page);
  const place = await readAWhile(page);
  await backToLibrary(page);

  await moveFileAway(page);
  await page.locator('.book-open').click();
  const dialog = page.getByRole('dialog', { name: 'Can’t open “Le comte de Monte-Cristo, Tome I”' });
  await expect(dialog).toContainText(`“${MONTE_CRISTO}” was moved, renamed or deleted.`);

  await dialog.getByTestId('relink-input').setInputFiles({ name: 'moved.epub', mimeType: 'application/epub+zip', buffer: fixture(MONTE_CRISTO) });
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.page-count')).toHaveText(/^3 \//);
  expect(await position(page)).toBe(place);
  await expect(page.getByText(/changed since you last read it/)).toHaveCount(0);

  // The book now points at the new file.
  const file = await withStorage(page, async (s) => JSON.parse((await s.get('/DATA/library.json')).content)[0].sources[0].file, null);
  expect(file.name).toBe('moved.epub');
});

test('finding a different file asks first, then re-indexes it', async ({ page }) => {
  await importEpub(page, MONTE_CRISTO);
  await expect(page.getByText(/^Imported/)).toBeVisible();
  await moveFileAway(page);
  await page.locator('.book-open').click();
  const dialog = page.getByRole('dialog', { name: /^Can’t open/ });

  // Declining keeps the dialog open and doesn't keep the picked file.
  page.once('dialog', (d) => void d.dismiss());
  await dialog.getByTestId('relink-input').setInputFiles({ name: 'faust.epub', mimeType: 'application/epub+zip', buffer: fixture(FAUST) });
  await expect(dialog).toBeVisible();
  await expect.poll(() => deviceFiles(page)).toHaveLength(0);

  page.once('dialog', (d) => {
    expect(d.message()).toContain('isn’t the same file');
    void d.accept();
  });
  await dialog.getByTestId('relink-input').setInputFiles({ name: 'faust.epub', mimeType: 'application/epub+zip', buffer: fixture(FAUST) });
  await expect(page.getByText('“faust.epub” changed since you last read it, so the book was reloaded')).toBeVisible();
  await expect(page.locator('.page-flow')).toContainText('Der Tragödie erster Teil');
});

test('a book whose file is gone can be removed from the library', async ({ page }) => {
  await importEpub(page, FAUST);
  await expect(page.getByText(/^Imported/)).toBeVisible();
  await moveFileAway(page);
  await page.locator('.book-open').click();
  const dialog = page.getByRole('dialog', { name: /^Can’t open/ });
  page.once('dialog', (d) => void d.accept());
  await dialog.getByRole('button', { name: 'Remove from library' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.book')).toHaveCount(0);
});

test('deleting a book lets go of its file; broken EPUBs are refused', async ({ page }) => {
  await importEpub(page, FAUST);
  await expect(page.getByText(/^Imported/)).toBeVisible();
  expect(await deviceFiles(page)).toHaveLength(1);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: /^Delete Faust/ }).click();
  await expect(page.locator('.book')).toHaveCount(0);
  await expect.poll(() => deviceFiles(page)).toHaveLength(0);

  await page.getByTestId('import-input').setInputFiles({ name: 'broken.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('not a zip') });
  await expect(page.getByText('That file isn’t a valid EPUB')).toBeVisible();
  await expect(page.locator('.book')).toHaveCount(0);
  await expect.poll(() => deviceFiles(page)).toHaveLength(0);
});
