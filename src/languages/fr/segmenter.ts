import { IntlWordSegmenter } from '../../segmentation/intl';
import type { WordSegmenter, WordSpan } from '../../segmentation/types';

/** What the French segmenter needs from the dictionary. */
export interface FrenchWordList {
  readonly revision: number;
  has(word: string): boolean;
}

/** Elided words that attach to the next word with an apostrophe: l'homme, qu'il, jusqu'à… */
const ELISION = /^(?:jusqu|lorsqu|puisqu|quoiqu|presqu|qu|[cdjlmnst])['’]/i;
const HYPHEN = /^[-‐‑]$/;
/** Longest hyphenated word tried as one dictionary entry (c'est-à-dire, arc-en-ciel…). */
const MAX_HYPHEN_PARTS = 4;
const CACHE_SIZE = 500;

/** Wiktionary spells apostrophes straight; books usually use ’. */
export const normalizeApostrophes = (word: string): string => word.replace(/[’ʼ]/g, "'");

/**
 * ICU word breaks, adjusted for French with the dictionary:
 * - hyphenated words the dictionary knows stay together (peut-être, arc-en-ciel), others split
 *   (dis-moi → dis | moi);
 * - elisions split off unless the whole word is an entry (l'été → l' | été, but aujourd'hui).
 */
export class FrenchWordSegmenter implements WordSegmenter {
  private readonly icu = new IntlWordSegmenter('fr');
  private readonly cache = new Map<string, WordSpan[]>();
  private cacheRevision = -1;

  constructor(private readonly words: FrenchWordList) {}

  private known(word: string): boolean {
    const w = normalizeApostrophes(word);
    return this.words.has(w) || this.words.has(w.toLowerCase());
  }

  segment(text: string): WordSpan[] {
    if (this.words.revision !== this.cacheRevision) {
      this.cache.clear();
      this.cacheRevision = this.words.revision;
    }
    const cached = this.cache.get(text);
    if (cached) return cached;
    const spans = this.split(text);
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(text, spans);
    return spans;
  }

  private split(text: string): WordSpan[] {
    const icu = this.icu.segment(text);
    const out: WordSpan[] = [];
    for (let i = 0; i < icu.length; i++) {
      const span = icu[i];
      if (!span.isWord) {
        out.push(span);
        continue;
      }

      // word - word - word…: longest run that is a dictionary entry.
      let merged = false;
      for (let parts = MAX_HYPHEN_PARTS; parts >= 2 && !merged; parts--) {
        const last = i + (parts - 1) * 2;
        if (last >= icu.length) continue;
        let ok = true;
        for (let k = i + 1; k < last && ok; k += 2) {
          ok = HYPHEN.test(text.slice(icu[k].start, icu[k].end)) && icu[k + 1].isWord;
        }
        if (ok && this.known(text.slice(span.start, icu[last].end))) {
          out.push({ start: span.start, end: icu[last].end, isWord: true });
          i = last;
          merged = true;
        }
      }
      if (merged) continue;

      const word = text.slice(span.start, span.end);
      const elision = ELISION.exec(word);
      if (elision && elision[0].length < word.length && !this.known(word)) {
        const cut = span.start + elision[0].length;
        out.push({ start: span.start, end: cut, isWord: true }, { start: cut, end: span.end, isWord: true });
      } else out.push(span);
    }
    return out;
  }
}
