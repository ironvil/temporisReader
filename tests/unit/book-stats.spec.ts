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
const chinese = { segmenter, wordKey: (w: string) => (WORDS.includes(w) ? w : null) };

test('countWords counts occurrences of trackable words only', () => {
  expect(countWords(['今天阳光很好。今天。', '镜子 OK'], chinese)).toEqual({ 今天: 2, 阳光: 1, 镜子: 1 });
  expect(countWords([], chinese)).toEqual({});
});

test('countWords counts by key, so inflected forms add up under their dictionary form', () => {
  const wordKey = (w: string) => ({ mange: 'manger', mangeaient: 'manger', maison: 'maison' })[w] ?? null;
  expect(countWords(['Il mange.', 'Ils mangeaient à la maison.'], { segmenter: new IntlWordSegmenter('fr'), wordKey })).toEqual({ manger: 2, maison: 1 });
});

test('countWords uses context keys when the language has them', () => {
  // As German does for separable verbs: "fängt … an" counts once, as anfangen.
  const lang = {
    segmenter: new IntlWordSegmenter('de'),
    wordKey: (w: string) => w.toLowerCase(),
    contextKeys: (text: string, spans: { start: number; end: number; isWord: boolean }[]) =>
      spans.map((s) => {
        const w = text.slice(s.start, s.end);
        return !s.isWord ? null : w === 'fängt' ? 'anfangen' : w === 'an' ? null : w.toLowerCase();
      }),
  };
  expect(countWords(['Er fängt an.'], lang)).toEqual({ er: 1, anfangen: 1 });
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
