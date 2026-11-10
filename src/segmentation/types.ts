/**
 * Word segmentation contract. Each language picks an implementation (dictionary-based for
 * Chinese, Intl/ICU for space-separated languages); the reader only uses this interface.
 */

export interface WordSpan {
  /** UTF-16 offsets into the segmented text, end exclusive. */
  start: number;
  end: number;
  /** False for punctuation and whitespace. */
  isWord: boolean;
}

export interface WordSegmenter {
  /** Splits text into contiguous spans covering the whole string. */
  segment(text: string): WordSpan[];
}

/** The span containing `index`. */
export function spanAt(spans: WordSpan[], index: number): WordSpan | undefined {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = spans[mid];
    if (index < s.start) hi = mid - 1;
    else if (index >= s.end) lo = mid + 1;
    else return s;
  }
  return undefined;
}

/** Index of the word containing (or just before) `char`, counting words only. */
export function wordIndexAt(segmenter: WordSegmenter, text: string, char: number): number {
  let index = -1;
  for (const s of segmenter.segment(text)) {
    if (s.start > char) break;
    if (s.isWord) index++;
  }
  return Math.max(index, 0);
}

/** Start offset of the `word`th word (clamped to the last word). */
export function charIndexOfWord(segmenter: WordSegmenter, text: string, word: number): number {
  let index = -1;
  let last = 0;
  for (const s of segmenter.segment(text)) {
    if (!s.isWord) continue;
    index++;
    last = s.start;
    if (index === word) return s.start;
  }
  return last;
}
