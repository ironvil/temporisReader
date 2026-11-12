import { expect, test } from '@playwright/test';
import { assembleBook, parseBook, parseEpub, ZipArchive, type BookFormat } from '@temporis/book-parser';
import { buildEpub, crc32, epubFiles, inlineXhtml } from '../../src/books/epub-export';
import { looksLikeSharedBook, parseSharedBook, shareFileName } from '../../src/books/share';

const shared = (extra: Record<string, unknown> = {}) => ({
  app: 'temporis-reader',
  kind: 'book',
  version: 1,
  id: '0b6a1c1e-8a0e-4b8e-9f6a-2d3c4b5a6978',
  title: '我的书',
  language: 'zh',
  languageChosen: true,
  createdAt: '2026-11-01T10:00:00.000Z',
  modifiedAt: '2026-11-10T10:00:00.000Z',
  appVersion: '0.17.0',
  chapters: [{ id: 'chapter-one-id', title: '第一章', format: 'txt', fileName: null, split: false, text: '她的头发很长。' }],
  ...extra,
});

test.describe('the shared book file', () => {
  test('a valid file is read as it was written', () => {
    const book = parseSharedBook('﻿' + JSON.stringify(shared()));
    expect(book).toMatchObject({ id: '0b6a1c1e-8a0e-4b8e-9f6a-2d3c4b5a6978', title: '我的书', language: 'zh', languageChosen: true, modifiedAt: '2026-11-10T10:00:00.000Z' });
    expect(book.chapters).toEqual([{ id: 'chapter-one-id', title: '第一章', format: 'txt', fileName: null, split: false, text: '她的头发很长。' }]);
  });

  test('other files, newer versions and damaged files are refused with a reason', () => {
    expect(() => parseSharedBook('not json')).toThrow('Not a Temporis book file (not JSON)');
    expect(() => parseSharedBook(JSON.stringify({ app: 'temporis-reader', backupVersion: 1 }))).toThrow('Not a Temporis book file');
    expect(() => parseSharedBook(JSON.stringify(shared({ version: 2 })))).toThrow(/newer version of the app/);
    expect(() => parseSharedBook(JSON.stringify(shared({ chapters: [{ title: 'x', format: 'epub', text: '' }] })))).toThrow('The book file is damaged');
  });

  test('chapter ids that can’t be file names, or repeat, get new ones', () => {
    const book = parseSharedBook(
      JSON.stringify(
        shared({
          chapters: [
            { id: '../../escape', title: 'a', format: 'txt', text: 'a' },
            { id: 'same-id-123', title: 'b', format: 'md', text: 'b' },
            { id: 'same-id-123', title: 'c', format: 'md', text: 'c' },
          ],
        }),
      ),
    );
    const ids = book.chapters.map((c) => c.id);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toBe('same-id-123');
    expect(ids[2]).not.toBe('same-id-123');
  });

  test('recognised by name or by content', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(shared()));
    expect(looksLikeSharedBook('我的书.temporis.json', bytes)).toBe(true);
    expect(looksLikeSharedBook('download', bytes)).toBe(true);
    expect(looksLikeSharedBook('notes.txt', new TextEncoder().encode('{ just braces }'))).toBe(false);
  });

  test('file names are the title, made safe', () => {
    expect(shareFileName('我的书', '.temporis.json')).toBe('我的书.temporis.json');
    expect(shareFileName('a/b: "c"?', '.epub')).toBe('a b c.epub');
    expect(shareFileName('  ', '.epub')).toBe('book.epub');
  });
});

test.describe('the EPUB', () => {
  const chapters: [title: string, format: BookFormat, text: string][] = [
    ['第一章 早上', 'txt', '她的头发很长。\n第二段。'],
    ['Mirror', 'md', '# The mirror\n\nShe said **hello** to the *mirror*.\n\n***\n\nLater & 1 < 2.'],
  ];
  const parts = chapters.map(([title, format, text], i) => ({ source: { id: `s${i}`, title, split: false, chapterCount: 0, paragraphCount: 0 }, parsed: parseBook(text, format, title) }));
  const { content, index } = assembleBook(parts);
  const input = { id: '0b6a1c1e-8a0e-4b8e-9f6a-2d3c4b5a6978', title: 'Book & “title”', language: 'zh', modified: new Date('2026-11-10T10:00:00Z'), content, index };

  test('is a valid ZIP with the mimetype first and stored', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const bytes = buildEpub(input);
    expect(new TextDecoder().decode(bytes.subarray(30, 30 + 'mimetypeapplication/epub+zip'.length))).toBe('mimetypeapplication/epub+zip');
    const zip = new ZipArchive(bytes);
    expect([...zip.entries.keys()]).toEqual(epubFiles(input).map(([name]) => name));
  });

  test('reads back with the same chapters, text, formatting and scene breaks', async () => {
    const book = await parseEpub(buildEpub(input), 'fallback');
    expect(book.title).toBe('Book & “title”');
    expect(book.language).toBe('zh');
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章 早上', 'Mirror']);
    expect(book.paragraphs).toEqual(['第一章 早上', '她的头发很长。', '第二段。', 'The mirror', 'She said hello to the mirror.', 'Later & 1 < 2.']);
    expect(book.marks[4]).toEqual([
      [9, 14, 'b'],
      [22, 28, 'i'],
    ]);
    expect(book.breaks).toEqual([5]);
  });

  test('the book id is its identifier', () => {
    const opf = epubFiles(input).find(([name]) => name.endsWith('.opf'))![1];
    expect(opf).toContain('<dc:identifier id="book-id">urn:uuid:0b6a1c1e-8a0e-4b8e-9f6a-2d3c4b5a6978</dc:identifier>');
    expect(opf).toContain('<meta property="dcterms:modified">2026-11-10T10:00:00Z</meta>');
  });

  test('overlapping bold and italic still nest', () => {
    expect(inlineXhtml('abcdef', [[0, 4, 'b'], [2, 6, 'i']])).toBe('<b>ab</b><i><b>cd</b></i><i>ef</i>');
  });
});
