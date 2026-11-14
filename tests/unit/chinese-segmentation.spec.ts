import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { buildCedictIndex, simplifiedOf } from '../../src/languages/zh/cedict-parse';
import { parseHmm, parseWordCounts } from '../../src/languages/zh/jieba/data';
import { buildChineseSegmenter, CHINESE_SEGMENTERS, keptApart, type ChineseSegmentationData } from '../../src/languages/zh/segmenters';
import type { WordSegmenter } from '../../src/segmentation/types';
import { tagCharacters, UnknownWordJoiner, type HmmModel } from '../../src/segmentation/unknown-words';

/** The bundled jieba data, as the app ships it. */
const jiebaFile = (name: string) => gunzipSync(readFileSync(new URL(`../../src/languages/zh/jieba/${name}`, import.meta.url))).toString('utf8');

/** A few CC-CEDICT entries: enough for the classic ambiguous sentences. Names are left out on purpose. */
const CEDICT = [
  '他 他 [ta1] /he/',
  '說 说 [shuo1] /to speak/',
  '的 的 [de5] /of/',
  '的確 的确 [di2 que4] /really/',
  '實在 实在 [shi2 zai4] /really; actually/',
  '確實 确实 [que4 shi2] /indeed/',
  '在理 在理 [zai4 li3] /reasonable/',
  '在 在 [zai4] /at/',
  '理 理 [li3] /reason/',
  '結婚 结婚 [jie2 hun1] /to marry/',
  '和尚 和尚 [he2 shang5] /monk/',
  '尚未 尚未 [shang4 wei4] /not yet/',
  '和 和 [he2] /and/',
  '未 未 [wei4] /not yet/',
  '走 走 [zou3] /to walk/',
  '了 了 [le5] /(completed action)/',
].join('\n');

const index = buildCedictIndex(CEDICT);
const dictionary = {
  revision: 1,
  has: (w: string) => index.lines.has(w),
  maxLengthFrom: (c: string) => index.maxLengthByFirstChar.get(c) ?? 0,
  simplifiedOf: (w: string) => simplifiedOf(index, w),
};
const data: ChineseSegmentationData = {
  dictionary,
  jieba: { words: parseWordCounts(jiebaFile('words.txt.gz'), (w) => index.lines.has(w)), hmm: parseHmm(jiebaFile('hmm.json.gz')) },
};

const split = (seg: WordSegmenter, text: string) => seg.segment(text).map((s) => text.slice(s.start, s.end));
const segmenter = (id: string, d = data) => buildChineseSegmenter(id, d).segmenter;

test('the bundled jieba data loads', () => {
  const all = parseWordCounts(jiebaFile('words.txt.gz'));
  expect(all.counts.size).toBeGreaterThan(300_000);
  expect(all.counts.get('确实')).toBeGreaterThan(1000);
  expect(data.jieba!.words.total).toBe(all.total); // the total counts every word, kept or not
  expect(data.jieba!.words.counts.has('确实')).toBe(true);
  expect(data.jieba!.words.counts.has('猫头鹰')).toBe(false); // not in this dictionary: not kept
  expect(data.jieba!.words.counts.get('张')).toBe(all.counts.get('张')); // single characters always are
  expect(Object.keys(data.jieba!.hmm.emit.S).length).toBeGreaterThan(5000);
});

test('most likely words beats fewest words on ambiguous text', () => {
  expect(split(segmenter('fewest-words'), '他说的确实在理。')).toEqual(['他', '说', '的确', '实在', '理', '。']);
  expect(split(segmenter('frequency'), '他说的确实在理。')).toEqual(['他', '说', '的', '确实', '在', '理', '。']);
  expect(split(segmenter('fewest-words'), '结婚的和尚未结婚的')).toEqual(['结婚', '的', '和尚', '未', '结婚', '的']);
  expect(split(segmenter('frequency'), '结婚的和尚未结婚的')).toEqual(['结婚', '的', '和', '尚未', '结婚', '的']);
});

test('traditional words are weighed by their simplified counts', () => {
  expect(split(segmenter('frequency'), '他說的確實在理。')).toEqual(['他', '說', '的', '確實', '在', '理', '。']);
});

test('recognising names joins characters the dictionary leaves on their own', () => {
  expect(split(segmenter('frequency'), '张伟和刘德华走了。')).toEqual(['张', '伟', '和', '刘', '德', '华', '走', '了', '。']);
  expect(split(segmenter('frequency-names'), '张伟和刘德华走了。')).toEqual(['张伟', '和', '刘德华', '走', '了', '。']);
  // Otherwise it splits like most likely words.
  expect(split(segmenter('frequency-names'), '他说的确实在理。')).toEqual(['他', '说', '的', '确实', '在', '理', '。']);
  // Numerals and the most common single-character words are never joined (一年, 了).
  const kept = keptApart(data.jieba!.words);
  for (const c of ['一', '万', '第', '了', '和']) expect(kept.has(c)).toBe(true);
  expect(kept.has('张')).toBe(false);
});

test('without jieba data, every choice falls back to fewest words', () => {
  const noJieba = { dictionary, jieba: null };
  for (const id of ['frequency-names', 'frequency', 'fewest-words', 'no-such-segmenter']) {
    const built = buildChineseSegmenter(id, noJieba);
    expect(built.key).toBe('fewest-words:1');
    expect(split(built.segmenter, '他说的确实在理。')).toEqual(['他', '说', '的确', '实在', '理', '。']);
  }
});

test('every choice has its own segmentation key (cached word counts are rebuilt on a change)', () => {
  const keys = CHINESE_SEGMENTERS.map((o) => buildChineseSegmenter(o.id, data).key);
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(keys.length);
  expect(buildChineseSegmenter('no-such-segmenter', data).key).toBe(keys[0]); // the default
});

/** A model that pairs characters up (B E B E…), whatever they are. */
const pairs: HmmModel = {
  start: { B: -0.1, M: -9, E: -9, S: -3 },
  trans: { B: { E: -0.1, M: -5 }, M: { E: -0.1, M: -5 }, E: { B: -0.1, S: -3 }, S: { B: -0.1, S: -3 } },
  emit: { B: {}, M: {}, E: {}, S: {} },
};
const charPerWord: WordSegmenter = { segment: (text) => Array.from(text, (_, i) => ({ start: i, end: i + 1, isWord: /\p{L}/u.test(text[i]) })) };

test('the joiner splits around kept-apart characters, leaves dictionary words alone, and tags validly', () => {
  const joiner = (isWord: (w: string) => boolean, keep: string[] = []) => new UnknownWordJoiner(charPerWord, pairs, isWord, new Set(keep));
  expect(split(joiner(() => false), '甲乙丙丁')).toEqual(['甲乙', '丙丁']);
  expect(split(joiner(() => false, ['一']), '甲乙一丙丁')).toEqual(['甲乙', '一', '丙丁']);
  // A run that is a dictionary word as it stands was split on purpose: left as it is.
  expect(split(joiner((w) => w === '甲乙丙丁'), '甲乙丙丁')).toEqual(['甲', '乙', '丙', '丁']);
  // Punctuation ends a run.
  expect(split(joiner(() => false), '甲乙，丙丁')).toEqual(['甲乙', '，', '丙丁']);
  // An odd run still ends on a whole word (E or S).
  expect(tagCharacters(['甲', '乙', '丙'], pairs).at(-1)).toMatch(/[ES]/);
  expect(split(joiner(() => false), '甲乙丙').join('')).toBe('甲乙丙');
});
