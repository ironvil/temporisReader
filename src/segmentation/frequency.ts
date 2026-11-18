import type { WordList } from './dictionary';

/** How often words occur in some corpus; `total` is the corpus size in words. */
export interface WordFrequencies {
  readonly counts: ReadonlyMap<string, number>;
  readonly total: number;
}

export interface FrequencyOptions {
  /** Another spelling to count a word under when it has no count itself (traditional → simplified). */
  countAs?(word: string): string | null;
  /** Count for a dictionary word or character the corpus never saw (jieba uses 1). */
  unseen?: number;
  /** Words to prefer whatever the corpus says (ones the reader added): they cost as little as a very common word. */
  preferred?(word: string): boolean;
}

/** A preferred word's probability: about that of 是 or 在 in jieba's counts. */
const PREFERRED_SHARE = 1 / 100;

/**
 * Weighs a word list's words by how often they occur, for DictionaryWordSegmenter: a word costs
 * −log(its probability), so the split with the lowest total is the most likely one (as in jieba),
 * instead of the one with the fewest words. Only the word list's words are words; any single
 * character is one too.
 */
export class FrequencyWordList implements WordList {
  private readonly logTotal: number;
  private readonly unseen: number;

  constructor(
    private readonly words: WordList,
    private readonly frequencies: WordFrequencies,
    private readonly options: FrequencyOptions = {},
  ) {
    this.logTotal = Math.log(frequencies.total);
    this.unseen = options.unseen ?? 1;
  }

  get revision(): number {
    return this.words.revision;
  }

  has(word: string): boolean {
    return this.words.has(word);
  }

  maxLengthFrom(firstChar: string): number {
    return this.words.maxLengthFrom(firstChar);
  }

  cost(word: string): number | null {
    const single = word.length === 1 || (word.length === 2 && word.codePointAt(0)! > 0xffff);
    if (!single && !this.words.has(word)) return null;
    if (this.options.preferred?.(word)) return -Math.log(PREFERRED_SHARE);
    const { counts } = this.frequencies;
    let count = counts.get(word);
    if (count === undefined && this.options.countAs) {
      const other = this.options.countAs(word);
      if (other) count = counts.get(other);
    }
    return this.logTotal - Math.log(count || this.unseen);
  }
}
