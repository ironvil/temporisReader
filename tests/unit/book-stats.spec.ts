import { expect, test } from '@playwright/test';
import { DictionaryWordSegmenter, type WordList } from '../../src/segmentation/dictionary';
import { IntlWordSegmenter } from '../../src/segmentation/intl';
import { countWords, formatShare, knownShare } from '../../src/vocab/book-stats';
import type { Level } from '../../src/vocab/known-words';

const WORDS = ['今天', '阳光', '镜子'];
const list: WordList = {
  revision: 1,
  has: (w) => WORDS.includes(w),
  maxLengthFrom: (c) => (WORDS.some((w) => w.startsWith(c)) ? 2 : 0),
};
const segmenter = new DictionaryWordSegmenter(list, /\p{Script=Han}+/u, new IntlWordSegmenter('en'));
const trackable = (w: string) => WORDS.includes(w);

test('countWords counts occurrences of trackable words only', () => {
  expect(countWords(['今天阳光很好。今天。', '镜子 OK'], segmenter, trackable)).toEqual({ 今天: 2, 阳光: 1, 镜子: 1 });
  expect(countWords([], segmenter, trackable)).toEqual({});
});

test('knownShare weights by occurrences and counts only level 3 as known', () => {
  const levels: Record<string, Level> = { 今天: 3, 阳光: 2 };
  const share = knownShare([{ 今天: 2, 阳光: 1 }, { 镜子: 1 }], (w) => levels[w]);
  expect(share).toEqual({ known: 2, total: 4 });
});

test('formatShare floors, and shows a dash when there is nothing to count', () => {
  expect(formatShare({ known: 2, total: 3 })).toBe('66%');
  expect(formatShare({ known: 999, total: 1000 })).toBe('99%');
  expect(formatShare({ known: 4, total: 4 })).toBe('100%');
  expect(formatShare({ known: 0, total: 0 })).toBe('–');
});
