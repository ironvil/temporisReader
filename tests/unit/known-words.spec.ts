import { expect, test } from '@playwright/test';
import { parseKnownWords, serializeKnownWords, today } from '../../src/vocab/known-words';

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
