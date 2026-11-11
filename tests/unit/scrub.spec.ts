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

test.describe('a book with scene breaks', () => {
  // Breaks are marks between paragraphs: the text, its offsets and every position ignore them.
  const md = '# 第一章\n\n一二三\n\n---\n\n四五\n\n* * *\n\n六\n\n# 第二章\n\n七八\n\n＊＊＊\n\n九';
  const { content, index } = assembleBook([{ source, parsed: parseBook(md, 'md', 'B') }]);

  test('the text has no break in it', () => {
    expect(content).toBe('第一章\n一二三\n四五\n六\n第二章\n七八\n九');
    expect(index.breaks).toEqual([2, 3, 6]);
  });

  test('every character maps to a position and back', () => {
    for (let offset = 0; offset < content.length; offset++) {
      if (content[offset] === '\n') continue;
      const { chapter, paragraph, char } = locateOffset(index, content.length, offset);
      expect(globalOffset(index, chapter, paragraph, char)).toBe(offset);
    }
  });

  test('the first character after a break and the last before one', () => {
    // 四 opens a scene: the place is its first character, not the break or the paragraph before.
    expect(locateOffset(index, content.length, content.indexOf('四'))).toEqual({ chapter: 0, paragraph: 2, char: 0 });
    // 三 ends the scene before; the newline after it (where the break is drawn) stays with it.
    expect(locateOffset(index, content.length, content.indexOf('三'))).toEqual({ chapter: 0, paragraph: 1, char: 2 });
    expect(locateOffset(index, content.length, content.indexOf('三') + 1)).toEqual({ chapter: 0, paragraph: 1, char: 2 });
    // The last paragraph of the book, after a break.
    expect(locateOffset(index, content.length, content.length - 1)).toEqual({ chapter: 1, paragraph: 2, char: 0 });
  });

  test('chapter lengths, for page estimates, count only text', () => {
    const starts = chapterStartOffsets(index);
    expect(starts).toEqual([0, content.indexOf('第二章')]);
    const chapterOne = starts[1] - 1;
    expect(chapterOne).toBe('第一章\n一二三\n四五\n六'.length);
    expect(estimatePage(content.indexOf('六'), chapterOne, 5)).toEqual({ page: 3, pages: 3 });
  });
});
