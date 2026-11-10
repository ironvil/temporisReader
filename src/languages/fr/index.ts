import type { WordSegmenter } from '../../segmentation/types';
import { WiktionaryDictionary } from '../wiktionary/dictionary';
import { WiktionaryLanguage } from '../wiktionary/language';
import { FrenchWordSegmenter, normalizeApostrophes } from './segmenter';

const LETTER = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;
/** Common French words that are rare in other Latin-script languages (no "a", "on", "en"…). */
const FRENCH_WORDS = new Set(
  'le la les des du et est une un que qui dans pour pas il elle ils elles je vous nous ne au aux sur ce cette avec se son sa ses mais ou où été être avoir fait sont très plus comme leur leurs lui même aussi bien tout tous toute était avait'.split(' '),
);

export const frenchWiktionary = () => new WiktionaryDictionary({ code: 'fr', language: 'French', downloadSize: '60 MB', coverage: 'about 400,000 words and forms' });

/** French: Wiktionary lookups, plus elision/hyphen-aware segmentation and ’ → ' normalisation. */
export class FrenchLanguage extends WiktionaryLanguage {
  readonly id = 'fr';
  readonly name = 'French';
  readonly nativeName = 'Français';
  readonly htmlLang = 'fr';
  readonly segmenter: WordSegmenter;

  constructor(wiktionary = frenchWiktionary()) {
    super(wiktionary);
    this.segmenter = new FrenchWordSegmenter(wiktionary);
  }

  protected normalize(word: string): string {
    return normalizeApostrophes(word);
  }

  detect(sample: string): number {
    const letters = [...sample].filter((c) => LETTER.test(c));
    if (!letters.length || letters.filter((c) => LATIN.test(c)).length / letters.length < 0.8) return 0;
    const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
    if (!words.length) return 0;
    const french = words.filter((w) => FRENCH_WORDS.has(w)).length;
    // Function words are roughly a quarter of running French text; scale so that reads as ~1.
    return Math.min(1, (french / words.length) * 4);
  }
}
