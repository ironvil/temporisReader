import { expect, test } from '@playwright/test';
import { buildCedictIndex, lookupCedict, parseCedictLine } from '../../src/languages/zh/cedict-parse';
import { formatInlinePinyin, formatPinyin, parseSyllable } from '../../src/languages/zh/pinyin';

test('tone marks go on the right vowel', () => {
  expect(formatPinyin('zai4')).toBe('zài');
  expect(formatPinyin('tou2 fa5')).toBe('tóufa');
  expect(formatPinyin('gui4')).toBe('guì');
  expect(formatPinyin('liu2')).toBe('liú');
  expect(formatPinyin('lu:4')).toBe('lǜ');
  expect(formatPinyin('Lu:3')).toBe('Lǚ');
  expect(formatPinyin('xiong2')).toBe('xióng');
  expect(formatPinyin('Bei3 jing1')).toBe('Běijīng');
  expect(formatPinyin('er4')).toBe('èr');
});

test("apostrophe before a/e/o syllables, spaces around non-syllables", () => {
  expect(formatPinyin('Xi1 an1')).toBe("Xī'ān");
  expect(formatPinyin('ke3 ai4')).toBe("kě'ài");
  expect(formatPinyin('A1 la1 bo2 · Ka3 la1')).toBe('Ālābó · Kǎlā');
});

test('syllable tones and non-syllables', () => {
  expect(parseSyllable('ma5')).toEqual({ text: 'ma', tone: 5 });
  expect(parseSyllable('，')).toEqual({ text: '，', tone: 0 });
  expect(parseSyllable('m2')).toEqual({ text: 'm', tone: 2 });
});

test('inline pinyin in definitions', () => {
  expect(formatInlinePinyin('variant of 著[zhuo2]')).toBe('variant of 著[zhuó]');
  expect(formatInlinePinyin('CL:個|个[ge4],位[wei4]')).toBe('CL:個|个[gè],位[wèi]');
});

const SAMPLE = [
  '# CC-CEDICT',
  '#! date=2026-11-01T00:00:00Z',
  '在 在 [zai4] /to exist; to be alive/(of sb or sth) to be (located) at/',
  '頭髮 头发 [tou2 fa5] /hair (on the head)/',
  '了 了 [le5] /(completed action marker)/',
  '了 了 [liao3] /to finish/',
  '瞭 了 [liao3] /(of eyes) bright/',
  '乾 干 [gan1] /dry/',
  '幹 干 [gan4] /to do/',
  '干 干 [Gan1] /surname Gan/',
].join('\r\n');

test('parses CC-CEDICT lines', () => {
  expect(parseCedictLine('頭髮 头发 [tou2 fa5] /hair (on the head)/')).toEqual({
    traditional: '頭髮',
    simplified: '头发',
    pinyin: 'tou2 fa5',
    definitions: ['hair (on the head)'],
  });
  expect(parseCedictLine('# comment')).toBeNull();
});

test('indexes simplified and traditional headwords', () => {
  const index = buildCedictIndex(SAMPLE);
  expect(index.entryCount).toBe(8);
  expect(index.date).toBe('2026-11-01T00:00:00Z');
  expect(index.maxLength).toBe(2);
  expect(lookupCedict(index, '头发')[0].definitions).toEqual(['hair (on the head)']);
  expect(lookupCedict(index, '頭髮')[0].simplified).toBe('头发');
  expect(lookupCedict(index, '了').map((e) => e.pinyin)).toEqual(['le5', 'liao3', 'liao3']);
  expect(lookupCedict(index, 'nope')).toEqual([]);
});

test('proper nouns sort after common words', () => {
  const index = buildCedictIndex(SAMPLE);
  expect(lookupCedict(index, '干').map((e) => e.pinyin)).toEqual(['gan1', 'gan4', 'Gan1']);
});
