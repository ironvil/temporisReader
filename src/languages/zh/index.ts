import { spanAt, type WordSegmenter } from '../../segmentation/types';
import { getSettings, updateSettings } from '../../settings';
import { el } from '../../ui/dom';
import type { LanguageModule, LookupResult } from '../types';
import { CedictDictionary } from './cedict';
import type { CedictEntry } from './cedict-parse';
import { loadJieba, type JiebaData } from './jieba/load';
import { formatInlinePinyin, formatPinyin, pinyinSyllables } from './pinyin';
import { buildChineseSegmenter, CHINESE_SEGMENTERS, DEFAULT_CHINESE_SEGMENTER } from './segmenters';

const HAN = /\p{Script=Han}/u;
const ALL_HAN = /^\p{Script=Han}+$/u;

export class ChineseLanguage implements LanguageModule<CedictEntry> {
  readonly id = 'zh';
  readonly name = 'Chinese';
  readonly nativeName = '中文';
  readonly htmlLang = 'zh-Hans';
  readonly sampleText = '今天早上，阳光从高高的窗户里斜斜地照进来。';
  readonly cedict: CedictDictionary;
  readonly dictionaries;
  /** jieba's word counts (for CC-CEDICT's words) and unknown-word model, loaded with CC-CEDICT. */
  private jieba: JiebaData | null = null;
  private built: { id: string; jieba: JiebaData | null; result: { segmenter: WordSegmenter; key: string } } | null = null;

  constructor(cedict = new CedictDictionary()) {
    this.cedict = cedict;
    this.dictionaries = [cedict];
    // jieba's data is bundled, so this only fails if the app is broken: then split by fewest words.
    cedict.onDecode = async (index) => {
      try {
        this.jieba = await loadJieba((word) => index.lines.has(word));
      } catch (err) {
        console.error('Chinese word counts failed to load', err);
        this.jieba = null;
      }
    };
  }

  /** The segmenter chosen in settings (Settings → Languages → Chinese), rebuilt when that changes. */
  get segmenter(): WordSegmenter {
    return this.current().segmenter;
  }

  private current(): { segmenter: WordSegmenter; key: string } {
    const id = getSettings().chineseSegmenter;
    if (this.built?.id !== id || this.built.jieba !== this.jieba) {
      this.built = { id, jieba: this.jieba, result: buildChineseSegmenter(id, { dictionary: this.cedict, jieba: this.jieba }) };
    }
    return this.built!.result;
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

  segmentationKey(): string | null {
    const key = this.cedict.dataKey;
    return key && `zh:cedict:${key}:${this.current().key}`;
  }

  wordKey(word: string): string | null {
    return ALL_HAN.test(word) && this.cedict.has(word) ? word : null;
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
      const word = paragraph.slice(span.start, span.end);
      const entries = this.cedict.lookup(word);
      if (entries.length) return result(span.start, span.end, entries);
      // A name the unknown-word joiner made (德拉科尼娅): not in the dictionary, so show it whole,
      // read out, with its characters. Names aren't tracked.
      const parts = ALL_HAN.test(word) && word.length > 1 ? this.parts(word) : null;
      if (parts) return { ...result(span.start, span.end, parts), untracked: true };
    }

    // Otherwise, the longest dictionary word starting at the tap.
    for (let end = Math.min(paragraph.length, index + this.cedict.maxLengthFrom(char)); end > index; end--) {
      const entries = this.cedict.lookup(paragraph.slice(index, end));
      if (entries.length) return result(index, end, entries);
    }

    return {
      ...result(index, index + char.length, []),
      notice: { kind: 'not-found', message: 'No dictionary entry found.' },
    };
  }

  /** A word that isn't an entry, as the longest dictionary words from the left (each one's first entry); null if one is missing. */
  private parts(word: string): CedictEntry[] | null {
    const parts: CedictEntry[] = [];
    for (let at = 0; at < word.length; ) {
      let end = Math.min(word.length, at + this.cedict.maxLengthFrom(word[at]));
      for (; end > at && !this.cedict.lookup(word.slice(at, end)).length; end--);
      if (end === at) return null;
      parts.push(this.cedict.lookup(word.slice(at, end))[0]);
      at = end;
    }
    return parts;
  }

  settingsRows(): HTMLElement {
    const chosen = CHINESE_SEGMENTERS.find((o) => o.id === getSettings().chineseSegmenter) ?? CHINESE_SEGMENTERS.find((o) => o.id === DEFAULT_CHINESE_SEGMENTER)!;
    const select = el(
      'select',
      { 'aria-label': 'Word splitting' },
      ...CHINESE_SEGMENTERS.map((o) => el('option', { value: o.id, selected: o === chosen }, o.label)),
    );
    const help = el('p', { class: 'setting-help' }, chosen.description);
    select.addEventListener('change', () => {
      help.textContent = CHINESE_SEGMENTERS.find((o) => o.id === select.value)!.description;
      void updateSettings({ chineseSegmenter: select.value });
    });
    return el('div', { class: 'lang-options' }, el('div', { class: 'setting-row' }, el('span', {}, 'Word splitting'), select), help);
  }

  renderEntries(result: LookupResult<CedictEntry>): HTMLElement {
    const root = el('div', { class: 'zh-lookup' });
    if (result.untracked) {
      // A name (see lookup): the whole name read out, then its characters.
      root.append(
        el(
          'section',
          { class: 'zh-entry zh-name' },
          el(
            'div',
            { class: 'zh-head' },
            this.hanzi(result.headword, result.entries.map((e) => e.pinyin).join(' ')),
            el('span', { class: 'zh-pinyin' }, result.entries.map((e) => formatPinyin(e.pinyin)).join(' ')),
          ),
          el('p', { class: 'zh-name-note' }, 'A name, not in the dictionary. Its characters:'),
        ),
      );
    }
    for (const entry of result.entries) {
      // Show the script the book uses first.
      // (For a name's characters, the script the name is written in.)
      const shown = (w: string) => (result.untracked ? result.headword.includes(w) : w === result.headword);
      const tradFirst = shown(entry.traditional) && !shown(entry.simplified);
      const primary = tradFirst ? entry.traditional : entry.simplified;
      const secondary = tradFirst ? entry.simplified : entry.traditional;

      const hanzi = this.hanzi(primary, entry.pinyin);

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
          el('ol', { class: 'defs' }, ...(result.untracked ? entry.definitions.slice(0, 3) : entry.definitions).map((d) => el('li', {}, formatInlinePinyin(d)))),
        ),
      );
    }
    return root;
  }

  /** Characters coloured by tone, when the pinyin has one syllable per character. */
  private hanzi(text: string, pinyin: string): HTMLElement {
    const syllables = pinyinSyllables(pinyin);
    const chars = Array.from(text);
    const hanzi = el('span', { class: 'zh-hanzi', lang: this.htmlLang });
    chars.forEach((c, i) => {
      const tone = syllables.length === chars.length ? syllables[i].tone : 0;
      hanzi.append(el('span', { class: `tone tone-${tone}` }, c));
    });
    return hanzi;
  }
}
