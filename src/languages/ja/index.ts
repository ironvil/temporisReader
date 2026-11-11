import { DictionaryWordSegmenter } from '../../segmentation/dictionary';
import { IntlWordSegmenter } from '../../segmentation/intl';
import { spanAt, type WordSegmenter } from '../../segmentation/types';
import { el } from '../../ui/dom';
import type { LanguageModule, LookupResult } from '../types';
import { getSettings, updateSettings } from '../../settings';
import type { JmdictEntry } from './jmdict-data';
import { toRomaji } from './romaji';
import { JmdictDictionary, type JmdictMatch } from './jmdict';

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const HAN = /\p{Script=Han}/u;
/** Japanese text: kanji, kana, the long-vowel mark, 々 and 〆. */
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー〆]/u;
const JAPANESE_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー〆]+/gu;
/** Bumped when deinflection or segmentation rules change, so cached word counts are rebuilt. */
const RULES_VERSION = 1;

/** Short labels for JMdict's part-of-speech and usage codes. */
const LABELS: Record<string, string> = {
  n: 'noun',
  'n-suf': 'noun suffix',
  'n-pref': 'noun prefix',
  pn: 'pronoun',
  v1: 'ichidan verb',
  'v1-s': 'ichidan verb',
  vk: 'kuru verb',
  vs: 'takes する',
  'vs-i': 'する verb',
  'vs-s': 'する verb',
  'vs-c': 'す verb',
  vz: 'ずる verb',
  vt: 'transitive',
  vi: 'intransitive',
  'adj-i': 'い-adjective',
  'adj-ix': 'い-adjective (いい/よい)',
  'adj-na': 'な-adjective',
  'adj-no': 'takes の',
  'adj-pn': 'pre-noun adjectival',
  'adj-t': 'たる-adjective',
  'adj-f': 'pre-noun',
  adv: 'adverb',
  'adv-to': 'adverb taking と',
  prt: 'particle',
  conj: 'conjunction',
  int: 'interjection',
  exp: 'expression',
  ctr: 'counter',
  suf: 'suffix',
  pref: 'prefix',
  'aux-v': 'auxiliary verb',
  'aux-adj': 'auxiliary adjective',
  aux: 'auxiliary',
  cop: 'copula',
  num: 'numeric',
  unc: 'unclassified',
  uk: 'usually kana',
  pol: 'polite',
  hon: 'honorific',
  hum: 'humble',
  form: 'formal',
  fam: 'familiar',
  col: 'colloquial',
  sl: 'slang',
  vulg: 'vulgar',
  derog: 'derogatory',
  arch: 'archaic',
  obs: 'obsolete',
  rare: 'rare',
  dated: 'dated',
  abbr: 'abbreviation',
  'on-mim': 'onomatopoeia',
  id: 'idiom',
  yoji: 'four-character idiom',
  fem: 'feminine',
  male: 'masculine',
  joc: 'jocular',
  poet: 'poetic',
  chn: 'children’s language',
  euph: 'euphemism',
  proverb: 'proverb',
};
/** A dictionary match for the word as it's written in the book. */
export interface JapaneseLookup extends JmdictMatch {
  written: string;
  /** A set phrase starting with the tapped word (何でも for 何): shown after the word's own entries. */
  phrase?: boolean;
}

/** Longer phrases shown with a word, at most. */
const MAX_PHRASES = 2;

const label = (code: string) => LABELS[code] ?? (/^v5/.test(code) ? 'godan verb' : /^v[24]/.test(code) ? 'classical verb' : code);

export class JapaneseLanguage implements LanguageModule<JapaneseLookup> {
  readonly id = 'ja';
  readonly name = 'Japanese';
  readonly nativeName = '日本語';
  readonly htmlLang = 'ja';
  readonly sampleText = '朝の光が高い窓から差し込んで、机の上を静かに照らしていた。';
  readonly jmdict: JmdictDictionary;
  readonly dictionaries;
  readonly segmenter: WordSegmenter;

  constructor(jmdict = new JmdictDictionary()) {
    this.jmdict = jmdict;
    this.dictionaries = [jmdict];
    // Fewest words over JMdict (conjugated forms count as one word); ICU handles the rest.
    this.segmenter = new DictionaryWordSegmenter(jmdict, JAPANESE_RUN, new IntlWordSegmenter('ja'));
  }

  /** Kana is what tells Japanese from Chinese: without it, this isn't Japanese. */
  detect(sample: string): number {
    const chars = [...sample.replace(/\s/g, '')];
    if (!chars.length) return 0;
    let kana = 0;
    let han = 0;
    for (const c of chars) {
      if (KANA.test(c)) kana++;
      else if (HAN.test(c)) han++;
    }
    // Japanese prose is mostly kana (even dense text is a third or more): a few quoted kana in
    // Chinese text don't make it Japanese.
    if (kana < 0.25 * (kana + han)) return 0;
    return (kana + han) / chars.length;
  }

  ready(): boolean {
    return this.jmdict.isReady();
  }

  segmentationKey(): string | null {
    const key = this.jmdict.dataKey;
    return key && `ja:jmdict:${key}:${RULES_VERSION}`;
  }

  wordKey(word: string): string | null {
    return JAPANESE.test(word) ? this.jmdict.keyOf(word) : null;
  }

  async lookup(paragraph: string, index: number): Promise<LookupResult<JapaneseLookup> | null> {
    if (index > 0 && /[\uDC00-\uDFFF]/.test(paragraph[index])) index--;
    const char = String.fromCodePoint(paragraph.codePointAt(index) ?? 0);
    if (!JAPANESE.test(char)) return null;
    const result = (start: number, end: number, headword: string, matches: JmdictMatch[]): LookupResult<JapaneseLookup> => ({
      start,
      end,
      headword,
      entries: matches.map((m) => ({ ...m, written: paragraph.slice(start, end) })),
      source: this.jmdict.shortName,
    });

    if (!(await this.jmdict.ensureLoaded())) {
      return {
        ...result(index, index + char.length, char, []),
        notice: { kind: 'missing-dictionary', message: `${this.name} isn’t added yet. Add it in Settings → Languages.` },
      };
    }

    // The word the segmenter puts the tapped character in (食べました, whichever kana is tapped).
    const span = spanAt(this.segmenter.segment(paragraph), index);
    if (span) {
      const surface = paragraph.slice(span.start, span.end);
      const matches = this.jmdict.matches(surface);
      if (matches.length) {
        const key = this.wordKey(surface);
        const found = result(span.start, span.end, key ?? surface, matches);
        found.entries.push(...this.phrases(paragraph, span.start, span.end, new Set(matches.map((m) => m.entry.id))));
        return { ...found, untracked: key === null || undefined };
      }
    }
    // A character the segmenter left on its own: the longest entry starting at the tap.
    for (let end = Math.min(paragraph.length, index + this.jmdict.maxLengthFrom(char)); end > index; end--) {
      const surface = paragraph.slice(index, end);
      const matches = this.jmdict.matches(surface);
      if (matches.length) return { ...result(index, end, surface, matches), untracked: true };
    }
    return { ...result(index, index + char.length, char, []), notice: { kind: 'not-found', message: 'No dictionary entry found.' } };
  }

  /**
   * Set phrases that start with the word at start..end and run past it (何でも, 見に行った): text
   * is never split into them, as they'd swallow particles (これは), so they're shown here instead.
   */
  private phrases(paragraph: string, start: number, end: number, shown: Set<number>): JapaneseLookup[] {
    const out: JapaneseLookup[] = [];
    const longest = Math.min(paragraph.length, start + this.jmdict.maxLengthFrom(paragraph[start]));
    for (let to = longest; to > end && out.length < MAX_PHRASES; to--) {
      const written = paragraph.slice(start, to);
      if (!JAPANESE.test(written.at(-1)!)) continue;
      const matches = this.jmdict.matches(written).filter((m) => !shown.has(m.entry.id));
      if (!matches.length) continue;
      for (const m of matches) shown.add(m.entry.id);
      out.push(...matches.map((m) => ({ ...m, written, phrase: true })));
    }
    return out;
  }

  settingsRows(): HTMLElement {
    const select = el(
      'select',
      { 'aria-label': 'Readings' },
      el('option', { value: 'kana', selected: getSettings().japaneseReadings === 'kana' }, 'Kana (ふりがな)'),
      el('option', { value: 'romaji', selected: getSettings().japaneseReadings === 'romaji' }, 'Romaji'),
    );
    select.addEventListener('change', () => void updateSettings({ japaneseReadings: select.value as 'kana' | 'romaji' }));
    return el('div', { class: 'lang-options' }, el('div', { class: 'setting-row' }, el('span', {}, 'Readings in lookups'), select));
  }

  renderEntries(result: LookupResult<JapaneseLookup>): HTMLElement {
    const root = el('div', { class: 'ja-lookup', lang: this.htmlLang });
    let lastForm = '';
    for (const match of result.entries) {
      // "食べました → 食べる  polite, past", once per dictionary form; "Phrase: 何でも" before phrases.
      const form = `${match.written}:${match.base}:${match.reasons.join()}`;
      if ((match.reasons.length || match.phrase) && form !== lastForm) {
        const inflected = match.reasons.length > 0;
        root.append(
          el(
            'div',
            { class: match.phrase ? 'wk-form ja-phrase' : 'wk-form' },
            match.phrase ? el('span', { class: 'ja-phrase-label', lang: 'en' }, 'Phrase') : null,
            el('span', {}, match.written),
            inflected ? el('span', { class: 'wk-arrow', 'aria-label': 'form of' }, '→') : null,
            inflected ? el('strong', {}, match.base) : null,
            inflected ? el('span', { class: 'ja-reasons', lang: 'en' }, match.reasons.join(', ')) : null,
          ),
        );
      }
      lastForm = form;
      root.append(this.renderEntry(match));
    }
    return root;
  }

  private renderEntry({ entry, base }: JmdictMatch): HTMLElement {
    const { word, readings: kana, others } = headOf(entry, base);
    // Romaji for every reading; a word written in kana gets its romaji as its reading.
    const romaji = getSettings().japaneseReadings === 'romaji';
    const readings = romaji ? (kana.length ? kana : [word].filter((w) => !HAN.test(w))).map(toRomaji) : kana;
    let lastPos = '';
    return el(
      'section',
      { class: 'ja-entry' },
      el(
        'div',
        { class: 'ja-head' },
        el('span', { class: 'ja-word' }, word),
        readings.length ? el('span', { class: 'ja-reading', lang: romaji ? 'en' : undefined }, readings.join(romaji ? ', ' : '・')) : null,
        isCommon(entry) ? el('span', { class: 'ja-common', lang: 'en' }, 'common') : null,
      ),
      others.length ? el('div', { class: 'ja-forms' }, others.join('・')) : null,
      el(
        'ol',
        { class: 'defs', lang: 'en' },
        ...entry.senses.map((s) => {
          const pos = s.pos.map(label).join(', ');
          const shownPos = pos !== lastPos ? pos : '';
          lastPos = pos;
          const notes = [...s.misc.map(label), s.info].filter(Boolean).join('; ');
          return el(
            'li',
            {},
            shownPos ? el('span', { class: 'ja-pos' }, shownPos) : null,
            shownPos ? ' ' : null,
            s.glosses.join('; '),
            notes ? el('span', { class: 'ja-note' }, ` (${notes})`) : null,
          );
        }),
      ),
    );
  }
}

const isCommon = (e: JmdictEntry) => e.kanji.some((k) => k.common) || e.readings.some((r) => r.common);

/**
 * How an entry is headed: the spelling that was looked up when it's a kanji form, else the main
 * spelling (or the kana, for words usually written in kana), with the readings that go with it.
 */
export function headOf(entry: JmdictEntry, base: string): { word: string; readings: string[]; others: string[] } {
  const kanji = entry.kanji.filter((k) => !k.hidden);
  const usuallyKana = !!entry.senses[0]?.misc.includes('uk');
  const matchedKanji = kanji.find((k) => k.text === base);
  const head = matchedKanji ?? (usuallyKana || !kanji.length ? undefined : kanji[0]);
  const readings = entry.readings.filter((r) => !r.hidden && (!head || (!r.noKanji && (!r.restrict.length || r.restrict.includes(head.text)))));
  if (!head) {
    const word = readings.find((r) => r.text === base)?.text ?? readings[0]?.text ?? base;
    return { word, readings: [], others: [...readings.filter((r) => r.text !== word).map((r) => r.text), ...kanji.map((k) => k.text)] };
  }
  return { word: head.text, readings: readings.map((r) => r.text), others: kanji.filter((k) => k !== head && !k.rare).map((k) => k.text) };
}
