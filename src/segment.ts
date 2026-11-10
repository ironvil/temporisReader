/** Word segmentation via Intl.Segmenter (ICU), used for progress word positions and lookup spans. */

const segmenters = new Map<string, Intl.Segmenter>();

function segmenter(lang: string): Intl.Segmenter {
  let s = segmenters.get(lang);
  if (!s) {
    s = new Intl.Segmenter(lang || undefined, { granularity: 'word' });
    segmenters.set(lang, s);
  }
  return s;
}

/** Index of the word containing (or just before) `char`, counting only word-like segments. */
export function wordIndexAt(text: string, char: number, lang: string): number {
  let index = -1;
  for (const s of segmenter(lang).segment(text)) {
    if (s.index > char) break;
    if (s.isWordLike) index++;
  }
  return Math.max(index, 0);
}

/** Start offset of the `word`th word-like segment (clamped to the last word). */
export function charIndexOfWord(text: string, word: number, lang: string): number {
  let index = -1;
  let last = 0;
  for (const s of segmenter(lang).segment(text)) {
    if (!s.isWordLike) continue;
    index++;
    last = s.index;
    if (index === word) return s.index;
  }
  return last;
}

/** The segment containing `char`. */
export function segmentAt(text: string, char: number, lang: string): { start: number; end: number; isWordLike: boolean } {
  const s = segmenter(lang).segment(text).containing(char);
  if (!s) return { start: char, end: char + 1, isWordLike: false };
  return { start: s.index, end: s.index + s.segment.length, isWordLike: !!s.isWordLike };
}
