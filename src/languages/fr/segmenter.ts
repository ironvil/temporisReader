import { WiktionaryWordSegmenter, type WordLookup } from '../wiktionary/segmenter';

/** Elided words that attach to the next word with an apostrophe: l'homme, qu'il, jusqu'à… */
const ELISION = /^(?:jusqu|lorsqu|puisqu|quoiqu|presqu|qu|[cdjlmnst])['’]/i;

/** Wiktionary spells apostrophes straight; books usually use ’. */
export const normalizeApostrophes = (word: string): string => word.replace(/[’ʼ]/g, "'");

/** French: hyphenated entries kept whole (peut-être), elisions split off (l'été → l' | été). */
export class FrenchWordSegmenter extends WiktionaryWordSegmenter {
  constructor(words: WordLookup) {
    super(words, 'fr', { elision: ELISION, normalize: normalizeApostrophes });
  }
}
