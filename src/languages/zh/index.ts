import { spanAt, type WordSegmenter } from '../../segmentation/types';
import { getSettings, updateSettings } from '../../settings';
import { MAX_USER_WORD_LENGTH, UserDictionary, WithUserWords } from '../../vocab/user-dictionary';
import { el } from '../../ui/dom';
import type { LanguageModule, LookupResult } from '../types';
import { CedictDictionary } from './cedict';
import type { CedictEntry } from './cedict-parse';
import { loadJieba, type JiebaData } from './jieba/load';
import { formatInlinePinyin, formatPinyin, pinyinSyllables } from './pinyin';
import { buildChineseSegmenter, CHINESE_SEGMENTERS, DEFAULT_CHINESE_SEGMENTER, type ChineseWords } from './segmenters';

/** A CC-CEDICT entry, or one for a word the reader added (`user`). */
export type ChineseEntry = CedictEntry & { user?: true };

const HAN = /\p{Script=Han}/u;
const ALL_HAN = /^\p{Script=Han}+$/u;

export class ChineseLanguage implements LanguageModule<ChineseEntry> {
  readonly id = 'zh';
  readonly name = 'Chinese';
  readonly nativeName = '中文';
  readonly htmlLang = 'zh-Hans';
  readonly charactersPerMinute = true;
  readonly sampleText = '今天早上，阳光从高高的窗户里斜斜地照进来。';
  readonly cedict: CedictDictionary;
  readonly dictionaries;
  /** Words the reader added; CC-CEDICT itself is never changed. */
  readonly userWords = new UserDictionary('zh');
  /** CC-CEDICT's words and the reader's, as the segmenters see them. */
  private readonly words: ChineseWords;
  /** jieba's word counts (for CC-CEDICT's words) and unknown-word model, loaded with CC-CEDICT. */
  private jieba: JiebaData | null = null;
  private built: { id: string; jieba: JiebaData | null; result: { segmenter: WordSegmenter; key: string } } | null = null;

  constructor(cedict = new CedictDictionary()) {
    this.cedict = cedict;
    this.dictionaries = [cedict];
    const words = new WithUserWords(cedict, this.userWords);
    this.words = {
      get revision() {
        return words.revision;
      },
      has: (w) => words.has(w),
      maxLengthFrom: (c) => words.maxLengthFrom(c),
      simplifiedOf: (w) => cedict.simplifiedOf(w),
    };
    // jieba's data is bundled, so this only fails if the app is broken: then split by fewest words.
    cedict.onDecode = async (index) => {
      await this.userWords.load();
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
      const data = { dictionary: this.words, jieba: this.jieba, isUserWord: (w: string) => this.userWords.has(w) };
      this.built = { id, jieba: this.jieba, result: buildChineseSegmenter(id, data) };
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
    const user = this.userWords.key ? `:user-${this.userWords.key}` : '';
    return key && `zh:cedict:${key}:${this.current().key}${user}`;
  }

  wordKey(word: string): string | null {
    return ALL_HAN.test(word) && (this.cedict.has(word) || this.userWords.has(word)) ? word : null;
  }

  /** Selected text as a word to add: 2–20 Chinese characters (spaces and line breaks dropped). */
  userWordFrom(text: string): string | null {
    const word = text.replace(/\s+/g, '');
    return ALL_HAN.test(word) && word.length >= 2 && word.length <= MAX_USER_WORD_LENGTH ? word : null;
  }

  async lookup(paragraph: string, index: number): Promise<LookupResult<ChineseEntry> | null> {
    // Step back onto the high surrogate if the tap landed on the second half of a pair.
    if (index > 0 && /[\uDC00-\uDFFF]/.test(paragraph[index])) index--;
    const char = String.fromCodePoint(paragraph.codePointAt(index) ?? 0);
    if (!HAN.test(char)) return null;

    const result = (start: number, end: number, entries: ChineseEntry[]): LookupResult<ChineseEntry> => ({
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
      const entries: ChineseEntry[] = this.cedict.lookup(word);
      const own = this.userWords.get(word);
      // The reader's own entry first; CC-CEDICT's too when it has the word.
      if (own) return { ...result(span.start, span.end, [this.userEntry(word, own.definition), ...entries]), source: entries.length ? this.cedict.shortName : 'Mine' };
      if (entries.length) return result(span.start, span.end, entries);
    }

    // A word the unknown-word joiner made (a name) isn't in the dictionary: fall back to the
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

  /** An entry for a word the reader added, read out from its characters' first CC-CEDICT readings. */
  private userEntry(word: string, definition: string | undefined): ChineseEntry {
    const pinyin = Array.from(word, (c) => this.cedict.lookup(c)[0]?.pinyin.split(' ')[0] ?? '').join(' ');
    return { traditional: word, simplified: word, pinyin, definitions: definition ? [definition] : [], user: true };
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

  renderEntries(result: LookupResult<ChineseEntry>): HTMLElement {
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
          entry.user ? this.userNote(entry.simplified) : null,
          entry.definitions.length ? el('ol', { class: 'defs' }, ...entry.definitions.map((d) => el('li', {}, formatInlinePinyin(d)))) : null,
        ),
      );
    }
    return root;
  }

  /** "Added by you", with a way to take the word out again. */
  private userNote(word: string): HTMLElement {
    const remove = el('button', { type: 'button', class: 'link-button' }, 'Remove');
    const note = el('p', { class: 'user-word-note' }, el('span', {}, 'Added by you'), remove);
    remove.addEventListener('click', () => {
      void this.userWords.remove(word).then(() => note.replaceChildren(el('span', {}, 'Removed from your words')));
    });
    return note;
  }
}
