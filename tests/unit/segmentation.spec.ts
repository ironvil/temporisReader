import { expect, test } from '@playwright/test';
import { DictionaryWordSegmenter, type WordList } from '../../src/segmentation/dictionary';
import { IntlWordSegmenter } from '../../src/segmentation/intl';
import { charIndexOfWord, spanAt, wordIndexAt, type WordSegmenter } from '../../src/segmentation/types';

function wordList(words: string[]): WordList & { revision: number } {
  const set = new Set(words);
  const max = new Map<string, number>();
  for (const w of words) {
    const first = String.fromCodePoint(w.codePointAt(0)!);
    max.set(first, Math.max(max.get(first) ?? 0, w.length));
  }
  return { revision: 1, has: (w) => set.has(w), maxLengthFrom: (c) => max.get(c) ?? 0 };
}

/** Character-per-word fallback, like Android WebView's ICU for Chinese. */
const charFallback: WordSegmenter = {
  segment: (text) => Array.from(text, (c, i) => ({ start: i, end: i + 1, isWord: /\p{L}|\p{N}/u.test(c) })),
};

const split = (seg: WordSegmenter, text: string) => seg.segment(text).map((s) => text.slice(s.start, s.end));

const WORDS = ['研究', '研究生', '生命', '起源', '头发', '白金', '金色', '猫头鹰', '猫头', '今天', '早上', '阳光', '窗户', '𠀀𠀁'];
const HAN = /\p{Script=Han}+/u;

test('picks the split with the fewest words', () => {
  const seg = new DictionaryWordSegmenter(wordList(WORDS), HAN, charFallback);
  expect(split(seg, '研究生命起源')).toEqual(['研究', '生命', '起源']);
  expect(split(seg, '今天早上，阳光从窗户里')).toEqual(['今天', '早上', '，', '阳光', '从', '窗户', '里']);
  expect(split(seg, '她的头发')).toEqual(['她', '的', '头发']);
  expect(split(seg, '猫头鹰')).toEqual(['猫头鹰']);
});

test('prefers longer words earlier on ties', () => {
  const seg = new DictionaryWordSegmenter(wordList(WORDS), HAN, charFallback);
  expect(split(seg, '白金色')).toEqual(['白金', '色']);
});

test('non-Han text goes to the fallback; spans cover the whole string', () => {
  const seg = new DictionaryWordSegmenter(wordList(WORDS), HAN, new IntlWordSegmenter('en'));
  const text = 'OK，今天 hello world!';
  const spans = seg.segment(text);
  expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['OK', '，', '今天', ' ', 'hello', ' ', 'world', '!']);
  expect(spans.filter((s) => s.isWord).map((s) => text.slice(s.start, s.end))).toEqual(['OK', '今天', 'hello', 'world']);
  for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBe(spans[i - 1].end);
});

test('never splits surrogate pairs', () => {
  const seg = new DictionaryWordSegmenter(wordList(WORDS), HAN, charFallback);
  expect(split(seg, '𠀀𠀁𠀂')).toEqual(['𠀀𠀁', '𠀂']);
});

test('without a dictionary every Han character is a word', () => {
  const seg = new DictionaryWordSegmenter(wordList([]), HAN, charFallback);
  expect(split(seg, '头发')).toEqual(['头', '发']);
});

test('cache is invalidated when the word list changes', () => {
  const list = wordList(['头发']);
  let words = new Set<string>();
  const dynamic: WordList = { get revision() { return list.revision; }, has: (w) => words.has(w), maxLengthFrom: () => 2 };
  const seg = new DictionaryWordSegmenter(dynamic, HAN, charFallback);
  expect(split(seg, '头发')).toEqual(['头', '发']);
  words = new Set(['头发']);
  list.revision++;
  expect(split(seg, '头发')).toEqual(['头发']);
});

test('span and word index helpers', () => {
  const seg = new DictionaryWordSegmenter(wordList(WORDS), HAN, charFallback);
  const text = '今天，阳光';
  expect(spanAt(seg.segment(text), 1)).toEqual({ start: 0, end: 2, isWord: true });
  expect(spanAt(seg.segment(text), 9)).toBeUndefined();
  expect(wordIndexAt(seg, text, 4)).toBe(1);
  expect(charIndexOfWord(seg, text, 1)).toBe(3);
  expect(charIndexOfWord(seg, text, 99)).toBe(3);
});
