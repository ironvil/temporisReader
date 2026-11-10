import { DictionaryWordSegmenter } from '../../segmentation/dictionary';
import { IntlWordSegmenter } from '../../segmentation/intl';
import { spanAt, type WordSegmenter } from '../../segmentation/types';
import { el } from '../../ui/dom';
import type { LanguageModule, LookupResult } from '../types';
import { CedictDictionary } from './cedict';
import type { CedictEntry } from './cedict-parse';
import { formatInlinePinyin, formatPinyin, pinyinSyllables } from './pinyin';

const HAN = /\p{Script=Han}/u;
const HAN_RUN = /\p{Script=Han}+/gu;

export class ChineseLanguage implements LanguageModule<CedictEntry> {
  readonly id = 'zh';
  readonly name = 'Chinese';
  readonly nativeName = '中文';
  readonly htmlLang = 'zh-Hans';
  readonly cedict: CedictDictionary;
  readonly dictionaries;
  readonly segmenter: WordSegmenter;

  constructor(cedict = new CedictDictionary()) {
    this.cedict = cedict;
    this.dictionaries = [cedict];
    // Dictionary-driven segmentation of Han text; ICU handles punctuation and embedded Latin text.
    this.segmenter = new DictionaryWordSegmenter(cedict, HAN_RUN, new IntlWordSegmenter('zh'));
  }

  detect(sample: string): number {
    const chars = sample.replace(/\s/g, '');
    if (!chars) return 0;
    let han = 0;
    for (const c of chars) if (HAN.test(c)) han++;
    return han / [...chars].length;
  }

  ready(): boolean {
    return this.cedict.isReady();
  }

  async lookup(paragraph: string, index: number): Promise<LookupResult<CedictEntry> | null> {
    // Step back onto the high surrogate if the tap landed on the second half of a pair.
    if (index > 0 && /[\uDC00-\uDFFF]/.test(paragraph[index])) index--;
    const char = String.fromCodePoint(paragraph.codePointAt(index) ?? 0);
    if (!HAN.test(char)) return null;

    const result = (start: number, end: number, entries: CedictEntry[]): LookupResult<CedictEntry> => ({
      start,
      end,
      headword: paragraph.slice(start, end),
      entries,
      source: this.cedict.shortName,
    });

    if (!(await this.cedict.ensureLoaded())) {
      return {
        ...result(index, index + char.length, []),
        notice: { kind: 'missing-dictionary', message: `${this.name} isn’t added yet. Add it in Settings → Languages.` },
      };
    }

    // The word the segmenter puts the tapped character in (the whole paragraph is segmented,
    // so tapping either character of 头发 gives 头发).
    const span = spanAt(this.segmenter.segment(paragraph), index);
    if (span) {
      const entries = this.cedict.lookup(paragraph.slice(span.start, span.end));
      if (entries.length) return result(span.start, span.end, entries);
    }

    // Shouldn't normally happen (single characters are always segments), but fall back to the
    // longest dictionary word starting at the tap.
    for (let end = Math.min(paragraph.length, index + this.cedict.maxLengthFrom(char)); end > index; end--) {
      const entries = this.cedict.lookup(paragraph.slice(index, end));
      if (entries.length) return result(index, end, entries);
    }

    return {
      ...result(index, index + char.length, []),
      notice: { kind: 'not-found', message: 'No dictionary entry found.' },
    };
  }

  renderEntries(result: LookupResult<CedictEntry>): HTMLElement {
    const root = el('div', { class: 'zh-lookup' });
    for (const entry of result.entries) {
      // Show the script the book uses first.
      const tradFirst = entry.traditional === result.headword && entry.simplified !== result.headword;
      const primary = tradFirst ? entry.traditional : entry.simplified;
      const secondary = tradFirst ? entry.simplified : entry.traditional;

      const syllables = pinyinSyllables(entry.pinyin);
      const chars = Array.from(primary);
      const hanzi = el('span', { class: 'zh-hanzi', lang: this.htmlLang });
      chars.forEach((c, i) => {
        const tone = syllables.length === chars.length ? syllables[i].tone : 0;
        hanzi.append(el('span', { class: `tone tone-${tone}` }, c));
      });

      root.append(
        el(
          'section',
          { class: 'zh-entry' },
          el(
            'div',
            { class: 'zh-head' },
            hanzi,
            secondary !== primary ? el('span', { class: 'zh-alt', lang: this.htmlLang }, `[${secondary}]`) : null,
            el('span', { class: 'zh-pinyin' }, formatPinyin(entry.pinyin)),
          ),
          el('ol', { class: 'defs' }, ...entry.definitions.map((d) => el('li', {}, formatInlinePinyin(d)))),
        ),
      );
    }
    return root;
  }
}
