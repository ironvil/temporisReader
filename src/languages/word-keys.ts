import type { WordSpan } from '../segmentation/types';
import type { LanguageModule } from './types';

export interface KeyedWord extends WordSpan {
  /** Known-words key (see LanguageModule.wordKey), null when the word can't be tracked. */
  key: string | null;
}

/** Word spans of a paragraph with their known-words keys, using context when the language has it. */
export function keyedWords(lang: Pick<LanguageModule, 'segmenter' | 'wordKey' | 'contextKeys'>, text: string): KeyedWord[] {
  const spans = lang.segmenter.segment(text);
  const keys = lang.contextKeys ? lang.contextKeys(text, spans) : spans.map((s) => (s.isWord ? lang.wordKey(text.slice(s.start, s.end)) : null));
  const out: KeyedWord[] = [];
  spans.forEach((s, i) => {
    if (s.isWord) out.push({ ...s, key: keys[i] ?? null });
  });
  return out;
}
