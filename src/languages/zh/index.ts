import { segmentAt } from '../../segment';
import { el } from '../../ui/dom';
import type { LanguageModule, LookupResult } from '../types';
import { CedictDictionary } from './cedict';
import type { CedictEntry } from './cedict-parse';
import { formatInlinePinyin, formatPinyin, pinyinSyllables } from './pinyin';

const HAN = /\p{Script=Han}/u;
const ALL_HAN = /^\p{Script=Han}+$/u;

export class ChineseLanguage implements LanguageModule<CedictEntry> {
  readonly id = 'zh';
  readonly name = 'Chinese';
  readonly nativeName = '中文';
  readonly htmlLang = 'zh';
  readonly cedict: CedictDictionary;
  readonly dictionaries;

  constructor(cedict = new CedictDictionary()) {
    this.cedict = cedict;
    this.dictionaries = [cedict];
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

    const segment = segmentAt(paragraph, index, 'zh');
    const span = (start: number, end: number, entries: CedictEntry[]): LookupResult<CedictEntry> => ({
      start,
      end,
      headword: paragraph.slice(start, end),
      entries,
      source: this.cedict.shortName,
    });

    if (!(await this.cedict.ensureLoaded())) {
      return {
        ...span(segment.start, segment.end, []),
        notice: { kind: 'missing-dictionary', message: 'The Chinese dictionary isn’t downloaded yet.' },
      };
    }

    // 1. The word ICU's segmenter puts the tapped character in.
    const word = paragraph.slice(segment.start, segment.end);
    if (ALL_HAN.test(word)) {
      const entries = this.cedict.lookup(word);
      if (entries.length) return span(segment.start, segment.end, entries);
    }

    // 2. Longest dictionary word starting at the tapped character.
    for (let len = Math.min(this.cedict.maxWordLength, paragraph.length - index); len >= 1; len--) {
      const candidate = paragraph.slice(index, index + len);
      if (!ALL_HAN.test(candidate)) continue;
      const entries = this.cedict.lookup(candidate);
      if (entries.length) return span(index, index + len, entries);
    }

    return {
      ...span(index, index + char.length, []),
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
      const hanzi = el('span', { class: 'zh-hanzi', lang: 'zh' });
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
            secondary !== primary ? el('span', { class: 'zh-alt', lang: 'zh' }, `[${secondary}]`) : null,
            el('span', { class: 'zh-pinyin' }, formatPinyin(entry.pinyin)),
          ),
          el('ol', { class: 'defs' }, ...entry.definitions.map((d) => el('li', {}, formatInlinePinyin(d)))),
        ),
      );
    }
    return root;
  }
}
