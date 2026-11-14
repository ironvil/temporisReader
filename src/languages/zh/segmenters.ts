/**
 * The ways Chinese text can be split into words, chosen in Settings → Languages → Chinese.
 * To add one, add an entry to CHINESE_SEGMENTERS: the settings page lists them all, and the
 * language module builds whichever is chosen. Words must be CC-CEDICT words (or single
 * characters) so that every word can be looked up; only the unknown-word joiner makes others.
 */
import { DictionaryWordSegmenter, type WordList } from '../../segmentation/dictionary';
import { FrequencyWordList } from '../../segmentation/frequency';
import { IntlWordSegmenter } from '../../segmentation/intl';
import type { WordSegmenter } from '../../segmentation/types';
import { UnknownWordJoiner } from '../../segmentation/unknown-words';
import { JIEBA_VERSION, type HmmModel, type WordCounts } from './jieba/data';

export const HAN_RUN = /\p{Script=Han}+/gu;

/** The dictionary's words, as the segmenters see them (CC-CEDICT). */
export interface ChineseWords extends WordList {
  /** The simplified spelling of a word written in traditional characters, or null. */
  simplifiedOf(word: string): string | null;
}

export interface ChineseSegmentationData {
  readonly dictionary: ChineseWords;
  /** jieba's word counts and unknown-word model; null when not loaded (or it failed to load). */
  readonly jieba: { readonly words: WordCounts; readonly hmm: HmmModel } | null;
}

export interface ChineseSegmenterOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Identifies what the split depends on besides the dictionary (part of the segmentation key). */
  readonly version: string;
  /** Null when the data it needs isn't there; the first option that can run is used instead. */
  create(data: ChineseSegmentationData, fallback: WordSegmenter): WordSegmenter | null;
}

/** Numerals: a number and its measure word (一年, 万元, 第三) aren't one unknown word. */
const NUMERALS = '〇零一二三四五六七八九十百千万亿两几第';
/** The most common single-character words, which the unknown-word joiner leaves alone. */
const COMMON_SINGLES = 100;

/** Characters the unknown-word joiner never joins: numerals, and the most common single-character words. */
export function keptApart(words: WordCounts): Set<string> {
  const singles = [...words.counts].filter(([w]) => w.length === 1).sort((a, b) => b[1] - a[1]);
  return new Set([...NUMERALS, ...singles.slice(0, COMMON_SINGLES).map(([w]) => w)]);
}

/** CC-CEDICT words weighed by jieba's counts: the lowest total cost is the most likely split. */
function mostLikely({ dictionary, jieba }: ChineseSegmentationData, fallback: WordSegmenter): WordSegmenter | null {
  if (!jieba) return null;
  const weighed = new FrequencyWordList(dictionary, jieba.words, { countAs: (w) => dictionary.simplifiedOf(w) });
  return new DictionaryWordSegmenter(weighed, HAN_RUN, fallback);
}

/**
 * Scored against hand-segmented news text (SIGHAN 2005, F1 on PKU / MSR): fewest words
 * 85.3% / 84.8%, most likely 87.4% / 86.2%, most likely + names 87.8% / 86.8%
 * (scripts/measure-chinese-segmentation.mjs). jieba-wasm, pkuseg and HanLP were tried too and
 * weren't enough better to ship: bigger, slower, and their words often aren't CC-CEDICT's.
 */
export const CHINESE_SEGMENTERS: readonly ChineseSegmenterOption[] = [
  {
    id: 'frequency-names',
    label: 'Most likely words + names',
    description: 'As “Most likely words”, and keeps names the dictionary doesn’t have together (刘德华, not 刘 · 德 · 华). Names aren’t tracked as known words.',
    version: `jieba-${JIEBA_VERSION}`,
    create: (data, fallback) => {
      const base = mostLikely(data, fallback);
      return base && new UnknownWordJoiner(base, data.jieba!.hmm, (w) => data.dictionary.has(w), keptApart(data.jieba!.words));
    },
  },
  {
    id: 'frequency',
    label: 'Most likely words',
    description: 'Picks the most likely split, from how often each word is used: 的 · 确实 · 在理, not 的确 · 实在 · 理.',
    version: `jieba-${JIEBA_VERSION}`,
    create: mostLikely,
  },
  {
    id: 'fewest-words',
    label: 'Fewest words',
    description: 'Splits text into as few dictionary words as possible (how earlier versions split).',
    version: '1',
    create: ({ dictionary }, fallback) => new DictionaryWordSegmenter(dictionary, HAN_RUN, fallback),
  },
];

export const DEFAULT_CHINESE_SEGMENTER = CHINESE_SEGMENTERS[0].id;

/**
 * Builds the chosen segmenter (an id from CHINESE_SEGMENTERS), or the first that can run with
 * this data. `key` identifies how it splits, so cached word counts are rebuilt when it changes.
 */
export function buildChineseSegmenter(id: string, data: ChineseSegmentationData): { segmenter: WordSegmenter; key: string } {
  // ICU handles punctuation and embedded Latin text.
  const fallback = new IntlWordSegmenter('zh');
  const chosen = CHINESE_SEGMENTERS.find((o) => o.id === id);
  for (const option of chosen ? [chosen, ...CHINESE_SEGMENTERS] : CHINESE_SEGMENTERS) {
    const segmenter = option.create(data, fallback);
    if (segmenter) return { segmenter, key: `${option.id}:${option.version}` };
  }
  throw new Error('No Chinese segmenter can run'); // fewest-words always can
}
