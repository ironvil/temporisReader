import { expect, test } from '@playwright/test';
import { assembleBook, parseBook } from '@temporis/book-parser';
import { type SourceMeta } from '../../src/books/library';
import { chapterStartOffsets, estimatePage, globalOffset, guessCharsPerPage, locateOffset } from '../../src/reader/scrub';

const source: SourceMeta = { id: 's', title: 'B', format: 'txt', fileName: null, split: true, path: 's.txt', chapterCount: 0, paragraphCount: 0 };
// content: "第一章\n一二三\n四五\n第二章\n六七八九" → offsets 0, 4, 8, 11, 15
const { content, index } = assembleBook([{ source, parsed: parseBook('第一章\n一二三\n四五\n第二章\n六七八九', 'txt', 'B') }]);

test('fixture layout', () => {
  expect(content).toBe('第一章\n一二三\n四五\n第二章\n六七八九');
  expect(index.paragraphOffsets).toEqual([0, 4, 8, 11, 15]);
  expect(index.chapters.map((c) => [c.start, c.end])).toEqual([
    [0, 3],
    [3, 5],
  ]);
});

test('chapterStartOffsets', () => {
  expect(chapterStartOffsets(index)).toEqual([0, 11]);
});

test('locateOffset maps global offsets to chapter, paragraph and char', () => {
  expect(locateOffset(index, content.length, 0)).toEqual({ chapter: 0, paragraph: 0, char: 0 });
  expect(locateOffset(index, content.length, 5)).toEqual({ chapter: 0, paragraph: 1, char: 1 }); // 二
  expect(locateOffset(index, content.length, 8)).toEqual({ chapter: 0, paragraph: 2, char: 0 }); // 四
  expect(locateOffset(index, content.length, 11)).toEqual({ chapter: 1, paragraph: 0, char: 0 }); // 第二章
  expect(locateOffset(index, content.length, 17)).toEqual({ chapter: 1, paragraph: 1, char: 2 }); // 八
});

test('locateOffset clamps the newline separator and out-of-range values', () => {
  expect(locateOffset(index, content.length, 7)).toEqual({ chapter: 0, paragraph: 1, char: 2 }); // "\n" after 三 → 三
  expect(locateOffset(index, content.length, -5)).toEqual({ chapter: 0, paragraph: 0, char: 0 });
  expect(locateOffset(index, content.length, 999)).toEqual({ chapter: 1, paragraph: 1, char: 3 }); // last char 九
});

test('globalOffset is the inverse of locateOffset for every character', () => {
  for (let offset = 0; offset < content.length; offset++) {
    if (content[offset] === '\n') continue;
    const { chapter, paragraph, char } = locateOffset(index, content.length, offset);
    expect(globalOffset(index, chapter, paragraph, char)).toBe(offset);
  }
});

test('estimatePage', () => {
  expect(estimatePage(0, 1000, 300)).toEqual({ page: 1, pages: 4 });
  expect(estimatePage(299, 1000, 300)).toEqual({ page: 1, pages: 4 });
  expect(estimatePage(300, 1000, 300)).toEqual({ page: 2, pages: 4 });
  expect(estimatePage(999, 1000, 300)).toEqual({ page: 4, pages: 4 });
  expect(estimatePage(5000, 1000, 300)).toEqual({ page: 4, pages: 4 }); // clamped
  expect(estimatePage(10, 50, 300)).toEqual({ page: 1, pages: 1 });
  expect(estimatePage(10, 50, 0)).toEqual({ page: 11, pages: 50 }); // never divides by zero
});

test('guessCharsPerPage', () => {
  // 372px wide / 22px = 16 per line; 650px / (22 * 1.65) = 17 lines; ×0.8
  expect(guessCharsPerPage(372, 650, 22)).toBe(Math.round(16 * 17 * 0.8));
  expect(guessCharsPerPage(0, 0, 22)).toBe(1);
});
