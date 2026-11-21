/**
 * Reading speed, per language, from the pages actually read.
 *
 * Each page turned forward after at least 10 seconds of reading is kept as a sample: how much
 * text was on it and how long it was open (while the app was in front). The estimate is worked
 * out from the samples each time, so the rules below can change without losing anything:
 *
 * - Only full pages count: the end of a chapter or a title page says little about speed.
 * - Outliers are dropped: pages read much faster or slower than the median (skimming, or left
 *   open while doing something else), and any page open for more than 15 minutes.
 * - Recent pages count more: weights halve every 14 days, and pages older than 90 days are dropped.
 * - The speed is total text over total time (weighted), not an average of per-page speeds, which
 *   short quick pages would skew upwards.
 *
 * Time is measured in characters, which every language and segmenter agrees on; words per minute
 * is characters per minute times the words per character seen on the same pages, and characters
 * per minute as shown (Chinese, Japanese) count letters only, without punctuation, spaces or line breaks. Time left in a
 * chapter or book then needs only character offsets, not segmenting the rest of the book.
 *
 *   reading-speed/<lang>.json: { "version": 1, "pages": [{ "at": 1795000000000, "chars": 812, "letters": 700, "words": 160, "ms": 41000 }] }
 */
import { readText, removeFile, writeJson } from '../storage';

export interface PageSample {
  /** When the page was left (ms since epoch). */
  at: number;
  /** Characters on the page. */
  chars: number;
  /** Letters and digits on the page: `chars` without punctuation, spaces and line breaks. */
  letters: number;
  /** Words on the page, or null when they couldn't be counted (dictionary not loaded). */
  words: number | null;
  /** How long the page was read, in ms, not counting time with the app in the background. */
  ms: number;
}

interface ReadingSpeedFile {
  version: 1;
  pages: PageSample[];
}

export interface ReadingSpeed {
  charsPerMinute: number;
  /** Null until some pages had their words counted. */
  wordsPerMinute: number | null;
  /** Letters and digits per minute: characters per minute as a reader means it. */
  lettersPerMinute: number;
  /** Pages the estimate is based on (after outliers are dropped). */
  pages: number;
}

/** A page counts once read for this long (as for offering to mark words known). */
export const MIN_SAMPLE_MS = 10_000;
/** Longer than this, the page was left open. */
export const MAX_SAMPLE_MS = 15 * 60_000;
/** Pages needed before a speed is shown. */
export const MIN_PAGES = 10;
/** Pages this much faster or slower than the median are left out. */
const OUTLIER_FACTOR = 2.5;
const HALF_LIFE_DAYS = 14;
const MAX_AGE_DAYS = 90;
/** Kept per language (about two weeks of steady reading). */
const MAX_SAMPLES = 500;
const DAY = 24 * 60 * 60_000;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The pages that count: recent, plausible and not outliers. */
export function usableSamples(samples: PageSample[], now = Date.now()): PageSample[] {
  const recent = samples.filter((s) => now - s.at <= MAX_AGE_DAYS * DAY && s.ms >= MIN_SAMPLE_MS && s.ms <= MAX_SAMPLE_MS && s.chars > 0);
  if (!recent.length) return [];
  const typical = median(recent.map((s) => s.chars / s.ms));
  return recent.filter((s) => {
    const rate = s.chars / s.ms;
    return rate <= typical * OUTLIER_FACTOR && rate >= typical / OUTLIER_FACTOR;
  });
}

export function estimateSpeed(samples: PageSample[], now = Date.now()): ReadingSpeed | null {
  const usable = usableSamples(samples, now);
  if (usable.length < MIN_PAGES) return null;
  let chars = 0;
  let ms = 0;
  let countedChars = 0;
  let countedWords = 0;
  let letters = 0;
  for (const s of usable) {
    const weight = 0.5 ** ((now - s.at) / DAY / HALF_LIFE_DAYS);
    chars += weight * s.chars;
    letters += weight * s.letters;
    ms += weight * s.ms;
    if (s.words !== null) {
      countedChars += weight * s.chars;
      countedWords += weight * s.words;
    }
  }
  const charsPerMinute = (chars / ms) * 60_000;
  return {
    charsPerMinute,
    wordsPerMinute: countedChars > 0 ? charsPerMinute * (countedWords / countedChars) : null,
    lettersPerMinute: charsPerMinute * (letters / chars),
    pages: usable.length,
  };
}

/** "<1 min", "12 min", "1 h 5 min". */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1 min';
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function readingSpeedPath(language: string): string {
  return `reading-speed/${language}.json`;
}

/** Checks a reading-speed file (from storage or a backup). Throws if it isn't one. */
export function parseReadingSpeed(text: string): PageSample[] {
  const data = JSON.parse(text) as Partial<ReadingSpeedFile>;
  if (!data || typeof data !== 'object' || !Array.isArray(data.pages)) throw new Error('Not a reading-speed file');
  return data.pages.filter(
    (p): p is PageSample =>
      !!p &&
      typeof p.at === 'number' &&
      typeof p.chars === 'number' &&
      typeof p.letters === 'number' &&
      typeof p.ms === 'number' &&
      (p.words === null || typeof p.words === 'number'),
  );
}

class ReadingSpeedStore {
  private samples: PageSample[] = [];
  private loading: Promise<void> | null = null;
  private cached: ReadingSpeed | null | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(readonly language: string) {}

  load(): Promise<void> {
    this.loading ??= readText(readingSpeedPath(this.language)).then((text) => {
      try {
        if (text !== null) this.samples = parseReadingSpeed(text);
      } catch (err) {
        console.error(`Reading speed for ${this.language} is unreadable`, err);
      }
      this.changed();
    });
    return this.loading;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The current estimate, or null with too few pages (or before loading). */
  speed(): ReadingSpeed | null {
    this.cached ??= estimateSpeed(this.samples);
    return this.cached;
  }

  /** Pages that count so far (for "4 of 10 pages"). */
  usablePages(): number {
    return usableSamples(this.samples).length;
  }

  async record(sample: PageSample): Promise<void> {
    await this.load();
    this.samples = [...this.samples, sample].slice(-MAX_SAMPLES);
    this.changed();
    await writeJson(readingSpeedPath(this.language), { version: 1, pages: this.samples } satisfies ReadingSpeedFile);
  }

  async reset(): Promise<void> {
    await this.load();
    this.samples = [];
    this.changed();
    await removeFile(readingSpeedPath(this.language));
  }

  private changed(): void {
    this.cached = undefined;
    this.listeners.forEach((l) => l());
  }
}

const stores = new Map<string, ReadingSpeedStore>();

export function readingSpeed(language: string): ReadingSpeedStore {
  let store = stores.get(language);
  if (!store) stores.set(language, (store = new ReadingSpeedStore(language)));
  return store;
}
