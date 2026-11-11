import type { WordSegmenter, WordSpan } from './types';

/** What the dictionary segmenter needs from a dictionary. */
export interface WordList {
  /** Changes whenever the word list changes (loaded, updated, removed); invalidates caches. */
  readonly revision: number;
  has(word: string): boolean;
  /** Length (UTF-16 units) of the longest word starting with `firstChar`, 0 if none. */
  maxLengthFrom(firstChar: string): number;
  /**
   * Optional: what taking `word` as one word costs, or null when it isn't one (`has` is then not
   * used). Splits with the lowest total win. Without it every word costs the same, so the fewest
   * words win. A single character always splits off: at `cost(char) ?? SINGLE_COST`.
   */
  cost?(word: string): number | null;
}

/** Cost of one word when the word list doesn't weigh them, and of an unknown single character. */
export const WORD_COST = 10;
export const SINGLE_COST = 10;

const CACHE_SIZE = 500;

/**
 * Segments text written without spaces (Chinese, Japanese) using a word list.
 * Within each run matched by `script`, it picks the split with the fewest words (or the lowest
 * cost, when the list weighs words), then the fewest single-character words, then longer words
 * earlier (研究生命 → 研究 | 生命, not 研究生 | 命).
 * Anything outside those runs (punctuation, Latin text) goes to `fallback`.
 */
export class DictionaryWordSegmenter implements WordSegmenter {
  private readonly cache = new Map<string, WordSpan[]>();
  private cacheRevision = -1;
  private readonly script: RegExp;

  constructor(
    private readonly words: WordList,
    script: RegExp,
    private readonly fallback: WordSegmenter,
  ) {
    this.script = new RegExp(script.source, script.flags.includes('g') ? script.flags : script.flags + 'g');
  }

  segment(text: string): WordSpan[] {
    if (this.words.revision !== this.cacheRevision) {
      this.cache.clear();
      this.cacheRevision = this.words.revision;
    }
    const cached = this.cache.get(text);
    if (cached) return cached;

    const spans: WordSpan[] = [];
    const addFallback = (from: number, to: number) => {
      for (const s of this.fallback.segment(text.slice(from, to))) spans.push({ start: s.start + from, end: s.end + from, isWord: s.isWord });
    };
    let last = 0;
    for (const m of text.matchAll(this.script)) {
      if (m.index > last) addFallback(last, m.index);
      this.segmentRun(m[0], m.index, spans);
      last = m.index + m[0].length;
    }
    if (last < text.length) addFallback(last, text.length);

    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(text, spans);
    return spans;
  }

  private segmentRun(run: string, offset: number, out: WordSpan[]): void {
    // Code point boundaries, so characters outside the BMP are never split.
    const points: number[] = [];
    for (let i = 0; i < run.length; i += run.codePointAt(i)! > 0xffff ? 2 : 1) points.push(i);
    points.push(run.length);
    const n = points.length - 1;

    const words = new Array<number>(n + 1).fill(Infinity);
    const singles = new Array<number>(n + 1).fill(Infinity);
    const back = new Array<number>(n + 1).fill(0);
    words[0] = 0;
    singles[0] = 0;

    const weigh = this.words.cost?.bind(this.words);
    for (let i = 0; i < n; i++) {
      const maxLength = this.words.maxLengthFrom(run.slice(points[i], points[i + 1]));
      for (let j = i + 1; j <= n; j++) {
        const single = j === i + 1;
        let cost = WORD_COST;
        if (!single) {
          if (points[j] - points[i] > maxLength) break;
          if (weigh) {
            const c = weigh(run.slice(points[i], points[j]));
            if (c === null) continue;
            cost = c;
          } else if (!this.words.has(run.slice(points[i], points[j]))) continue;
        } else if (weigh) cost = weigh(run.slice(points[i], points[j])) ?? SINGLE_COST;
        const w = words[i] + cost;
        const s = singles[i] + (single ? 1 : 0);
        // On a tie, the later start wins: the last word is shorter, so earlier words are longer.
        if (w < words[j] || (w === words[j] && s <= singles[j])) {
          words[j] = w;
          singles[j] = s;
          back[j] = i;
        }
      }
    }

    const spans: WordSpan[] = [];
    for (let j = n; j > 0; j = back[j]) spans.push({ start: offset + points[back[j]], end: offset + points[j], isWord: true });
    for (let k = spans.length - 1; k >= 0; k--) out.push(spans[k]);
  }
}
