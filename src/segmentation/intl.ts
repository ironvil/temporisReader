import type { WordSegmenter, WordSpan } from './types';

/**
 * ICU word segmentation via Intl.Segmenter. Good for space-separated languages (French…).
 * Not used for Chinese: Android WebView ships without ICU's Chinese dictionary and falls back
 * to one character per word.
 */
export class IntlWordSegmenter implements WordSegmenter {
  private readonly impl: Intl.Segmenter;

  constructor(locale?: string) {
    this.impl = new Intl.Segmenter(locale, { granularity: 'word' });
  }

  segment(text: string): WordSpan[] {
    return Array.from(this.impl.segment(text), (s) => ({
      start: s.index,
      end: s.index + s.segment.length,
      isWord: !!s.isWordLike,
    }));
  }
}
