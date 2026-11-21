import { expect, test } from '@playwright/test';
import { estimateSpeed, formatDuration, MIN_PAGES, parseReadingSpeed, usableSamples, type PageSample } from '../../src/reader/reading-speed';

const NOW = Date.UTC(2026, 10, 21);
const DAY = 24 * 60 * 60_000;

/** `count` pages of 600 characters and 150 words, read at `cpm` characters per minute. */
const pages = (count: number, cpm: number, daysAgo = 0): PageSample[] =>
  Array.from({ length: count }, (_, i) => ({ at: NOW - daysAgo * DAY - i * 60_000, chars: 600, words: 150, ms: (600 / cpm) * 60_000 }));

test('no speed until enough pages have been read', () => {
  expect(estimateSpeed(pages(MIN_PAGES - 1, 600), NOW)).toBeNull();
  const speed = estimateSpeed(pages(MIN_PAGES, 600), NOW)!;
  expect(speed.pages).toBe(MIN_PAGES);
  expect(speed.charsPerMinute).toBeCloseTo(600);
  expect(speed.wordsPerMinute).toBeCloseTo(150);
});

test('skimmed pages and pages left open are left out', () => {
  const steady = pages(20, 600);
  const skimmed = pages(5, 6000); // ten times as fast: turning pages to find a place
  const idle = pages(3, 60); // ten times as slow: left open
  const tooLong = [{ at: NOW, chars: 600, words: 150, ms: 20 * 60_000 }];
  const tooShort = [{ at: NOW, chars: 600, words: 150, ms: 5_000 }];
  const speed = estimateSpeed([...steady, ...skimmed, ...idle, ...tooLong, ...tooShort], NOW)!;
  expect(speed.pages).toBe(20);
  expect(speed.charsPerMinute).toBeCloseTo(600);
});

test('recent pages count more, and old ones not at all', () => {
  const lastMonth = pages(20, 400, 28); // two half-lives ago: a quarter of the weight
  const thisWeek = pages(20, 800, 0);
  // Weighted text over weighted time: 20 × 600 × 1.25 characters in 20 × (1.5 × 0.25 + 0.75) minutes.
  expect(estimateSpeed([...lastMonth, ...thisWeek], NOW)!.charsPerMinute).toBeCloseTo(15000 / 22.5, 0);
  // Equal weights would give 533.

  expect(usableSamples(pages(20, 600, 100), NOW)).toEqual([]);
});

test('speed is total text over total time, so short quick pages don’t skew it', () => {
  // 10 pages of 1000 characters in 2 min each, 10 of 300 in 0.4 min: 13000 characters in 24 min.
  const long = Array.from({ length: 10 }, (_, i) => ({ at: NOW - i, chars: 1000, words: 250, ms: 120_000 }));
  const short = Array.from({ length: 10 }, (_, i) => ({ at: NOW - i, chars: 300, words: 75, ms: 24_000 }));
  expect(estimateSpeed([...long, ...short], NOW)!.charsPerMinute).toBeCloseTo(13000 / 24);
});

test('words per minute come from the pages whose words were counted', () => {
  const counted = pages(10, 600);
  const uncounted = pages(10, 600).map((p) => ({ ...p, words: null }));
  const both = estimateSpeed([...counted, ...uncounted], NOW)!;
  expect(both.charsPerMinute).toBeCloseTo(600);
  expect(both.wordsPerMinute).toBeCloseTo(150);
  expect(estimateSpeed(uncounted, NOW)!.wordsPerMinute).toBeNull();
});

test('durations', () => {
  expect(formatDuration(0.4)).toBe('<1 min');
  expect(formatDuration(12.4)).toBe('12 min');
  expect(formatDuration(60)).toBe('1 h');
  expect(formatDuration(65)).toBe('1 h 5 min');
  expect(formatDuration(320)).toBe('5 h 20 min');
});

test('reading-speed files are checked, dropping damaged pages', () => {
  const good = { at: 1, chars: 600, words: null, ms: 30_000 };
  expect(parseReadingSpeed(JSON.stringify({ version: 1, pages: [good, { at: 'x' }, null] }))).toEqual([good]);
  expect(() => parseReadingSpeed('{"words":{}}')).toThrow();
});
