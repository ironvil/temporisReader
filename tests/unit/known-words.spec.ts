import { expect, test } from '@playwright/test';
import { markWords, mergeKnownWords, parseKnownWords, serializeKnownWords, today, wordsToMarkKnown, type KnownWordsFile, type Level } from '../../src/vocab/known-words';

const SAMPLE = `{
  "version": 1,
  "updated": "2026-11-10",
  "words": {
    "的": [3, "2026-11-10"],
    "猫头鹰": [3, "2026-11-10"],
    "庄园": [1, "2026-11-09"]
  }
}
`;

test('round-trips the export format byte for byte', () => {
  expect(serializeKnownWords(parseKnownWords(SAMPLE))).toBe(SAMPLE);
});

test('empty list', () => {
  const text = serializeKnownWords({ version: 1, updated: '2026-11-10', words: {} });
  expect(text).toBe('{\n  "version": 1,\n  "updated": "2026-11-10",\n  "words": {}\n}\n');
  expect(parseKnownWords(text).words).toEqual({});
});

test('drops malformed entries and rejects non-files', () => {
  const parsed = parseKnownWords('{"version":1,"updated":"x","words":{"好":[2,"2026-01-01"],"坏":[7,"2026-01-01"],"错":"3"}}');
  expect(parsed.words).toEqual({ 好: [2, '2026-01-01'] });
  expect(() => parseKnownWords('[1,2]')).toThrow('Not a known-words file');
  expect(() => parseKnownWords('not json')).toThrow();
});

test('today is the local calendar date', () => {
  expect(today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
});

test('merge: new words added, newer dates win, ties go to the import', () => {
  const target: KnownWordsFile = {
    version: 1,
    updated: '2026-11-01',
    words: { 旧: [1, '2026-11-05'], 新: [1, '2026-11-01'], 同: [2, '2026-11-03'], 等: [3, '2026-11-03'] },
  };
  const incoming: KnownWordsFile = {
    version: 1,
    updated: '2026-11-04',
    words: { 旧: [3, '2026-11-04'], 新: [3, '2026-11-04'], 同: [3, '2026-11-03'], 等: [3, '2026-11-03'], 加: [0, '2026-11-02'] },
  };
  expect(mergeKnownWords(target, incoming, '2026-11-10')).toEqual({ added: 1, updated: 2, unchanged: 2 });
  expect(target).toEqual({
    version: 1,
    updated: '2026-11-10',
    words: { 旧: [1, '2026-11-05'], 新: [3, '2026-11-04'], 同: [3, '2026-11-03'], 等: [3, '2026-11-03'], 加: [0, '2026-11-02'] },
  });
});

test('merge with nothing new leaves updated alone', () => {
  const target: KnownWordsFile = { version: 1, updated: '2026-11-01', words: { 好: [3, '2026-11-01'] } };
  expect(mergeKnownWords(target, { version: 1, updated: '2026-11-01', words: { 好: [3, '2026-11-01'] } }, '2026-11-10')).toEqual({
    added: 0,
    updated: 0,
    unchanged: 1,
  });
  expect(target.updated).toBe('2026-11-01');
});

test.describe('wordsToMarkKnown', () => {
  const levels: Record<string, Level> = { 已知: 3, 学一: 1, 学零: 0, 学二: 2 };
  const levelOf = (w: string) => levels[w];
  const trackable = (w: string) => (w === '不是词' ? null : w);

  test('keeps page order and removes duplicates', () => {
    expect(wordsToMarkKnown(['乙', '甲', '乙', '丙', '甲'], new Set(), levelOf, trackable)).toEqual(['乙', '甲', '丙']);
  });

  test('excludes looked-up words', () => {
    expect(wordsToMarkKnown(['甲', '乙', '丙'], new Set(['乙']), levelOf, trackable)).toEqual(['甲', '丙']);
  });

  test('excludes known words but includes learning levels 0–2 and untracked words', () => {
    expect(wordsToMarkKnown(['已知', '学零', '学一', '学二', '新'], new Set(), levelOf, trackable)).toEqual(['学零', '学一', '学二', '新']);
  });

  test('excludes words without a dictionary entry', () => {
    expect(wordsToMarkKnown(['甲', '不是词'], new Set(), levelOf, trackable)).toEqual(['甲']);
  });

  test('offers keys: inflected forms share one entry, and a looked-up key covers all its forms', () => {
    const lemma = (w: string) => ({ mange: 'manger', mangeaient: 'manger', belles: 'beau' })[w] ?? null;
    expect(wordsToMarkKnown(['mange', 'belles', 'mangeaient'], new Set(), levelOf, lemma)).toEqual(['manger', 'beau']);
    expect(wordsToMarkKnown(['mange', 'belles', 'mangeaient'], new Set(['manger']), levelOf, lemma)).toEqual(['beau']);
  });

  test('nothing to offer', () => {
    expect(wordsToMarkKnown([], new Set(), levelOf, trackable)).toEqual([]);
    expect(wordsToMarkKnown(['已知', '甲'], new Set(['甲']), levelOf, trackable)).toEqual([]);
  });
});

test.describe('markWords', () => {
  test('sets level and date, adding missing words and overwriting existing ones', () => {
    const file: KnownWordsFile = { version: 1, updated: '2026-01-01', words: { 甲: [1, '2026-01-01'], 乙: [3, '2026-01-01'] } };
    markWords(file, ['甲', '丙'], 3, '2026-11-10');
    expect(file).toEqual({
      version: 1,
      updated: '2026-11-10',
      words: { 甲: [3, '2026-11-10'], 乙: [3, '2026-01-01'], 丙: [3, '2026-11-10'] },
    });
  });

  test('no words leaves the file untouched', () => {
    const file: KnownWordsFile = { version: 1, updated: '2026-01-01', words: { 甲: [1, '2026-01-01'] } };
    markWords(file, [], 3, '2026-11-10');
    expect(file).toEqual({ version: 1, updated: '2026-01-01', words: { 甲: [1, '2026-01-01'] } });
  });
});
