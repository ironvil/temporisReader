/**
 * Base for languages looked up in Wiktionary (French now; German, Spanish… later). It handles
 * everything that's the same for any Wiktionary language: finding entries (as written, then
 * lower-cased), following inflected forms to their dictionary form, tracking known words by
 * that form, and the popup. A language adds its segmenter, detection and spelling normalisation.
 */
import { spanAt, type WordSegmenter, type WordSpan } from '../../segmentation/types';
import { el } from '../../ui/dom';
import type { LanguageModule, LookupResult } from '../types';
import type { WiktionaryEntry } from './data';
import { WiktionaryDictionary } from './dictionary';

/** What a lookup shows: the tapped form, its own entries, and the entries of its dictionary forms. */
export interface WiktionaryLookup {
  /** As written in the book. */
  surface: string;
  /** Entries for the tapped form (an inflected form's are just "plural of …" notes). */
  own: WiktionaryEntry[];
  /** Entries for the dictionary forms the tapped form is an inflection of. */
  lemmas: WiktionaryEntry[];
  /** Shown instead of `surface` on the "form → dictionary form" line (German "fängt … an"). */
  display?: string;
  /** For a compound shown as its parts (German): the parts, whose entries are in `lemmas`. */
  parts?: string[];
}

const LETTER = /\p{L}/u;
const isFormOnly = (e: WiktionaryEntry) => e.senses.every((s) => s.lemma);

export abstract class WiktionaryLanguage implements LanguageModule<WiktionaryLookup> {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly nativeName: string;
  abstract readonly htmlLang: string;
  abstract readonly sampleText: string;
  abstract readonly segmenter: WordSegmenter;
  readonly dictionaries: WiktionaryDictionary[];
  private readonly keys = new Map<string, string | null>();
  private keysRevision = -1;

  constructor(readonly wiktionary: WiktionaryDictionary) {
    this.dictionaries = [wiktionary];
  }

  abstract detect(sample: string): number;

  /** Spelling differences between books and Wiktionary (e.g. French ’ vs '). Identity by default. */
  protected normalize(word: string): string {
    return word;
  }

  ready(): boolean {
    return this.wiktionary.isReady();
  }

  segmentationKey(): string | null {
    const key = this.wiktionary.dataKey;
    return key && `${this.id}:wiktionary:${key}`;
  }

  /** The spelling the dictionary has (as written, else lower-cased) and its entries. */
  protected find(word: string): { form: string; entries: WiktionaryEntry[] } | null {
    const normalized = this.normalize(word);
    for (const form of new Set([normalized, normalized.toLowerCase()])) {
      const entries = this.wiktionary.entries(form);
      if (entries.length) return { form, entries };
    }
    return null;
  }

  /** Known words are tracked by dictionary form: a word that is only an inflection maps to its lemma. */
  wordKey(word: string): string | null {
    if (this.wiktionary.revision !== this.keysRevision) {
      this.keys.clear();
      this.keysRevision = this.wiktionary.revision;
    }
    let key = this.keys.get(word);
    if (key === undefined) {
      key = this.computeKey(word);
      this.keys.set(word, key);
    }
    return key;
  }

  protected computeKey(word: string): string | null {
    if (!this.wiktionary.isReady() || !LETTER.test(word)) return null;
    const found = this.find(word);
    if (!found) return null;
    // Wiktionary lists a page's main meaning first: livre is "book" (its own key) before it's a
    // form of livrer; schönen is a form of schön before it's the rare verb schönen.
    const first = found.entries[0];
    return isFormOnly(first) ? first.senses[0].lemma! : found.form;
  }

  /**
   * At the start of a sentence a capital tells nothing, so the lower-case word wins when it exists
   * (German "Ich komme": ich, not the noun das Ich).
   */
  protected spellingAt(text: string, spans: WordSpan[], i: number): string {
    const word = text.slice(spans[i].start, spans[i].end);
    const lower = word.toLowerCase();
    if (lower === word || !this.isSentenceStart(text, spans, i) || !this.find(lower)) return word;
    return lower;
  }

  protected isSentenceStart(text: string, spans: WordSpan[], i: number): boolean {
    for (let k = i - 1; k >= 0; k--) {
      if (spans[k].isWord) return false;
      if (/[.!?:…]/.test(text.slice(spans[k].start, spans[k].end))) return true;
    }
    return true;
  }

  contextKeys(text: string, spans: WordSpan[]): (string | null)[] {
    return spans.map((s, i) => (s.isWord ? this.wordKey(this.spellingAt(text, spans, i)) : null));
  }

  async lookup(paragraph: string, index: number): Promise<LookupResult<WiktionaryLookup> | null> {
    let spans = this.segmenter.segment(paragraph);
    const span = spanAt(spans, index);
    if (!span?.isWord || !LETTER.test(paragraph.slice(span.start, span.end))) return null;

    if (!(await this.wiktionary.ensureLoaded())) {
      return {
        ...this.result(span, paragraph.slice(span.start, span.end), []),
        notice: { kind: 'missing-dictionary', message: `${this.name} isn’t added yet. Add it in Settings → Languages.` },
      };
    }
    // Loading may have changed segmentation (hyphenated entries): segment again.
    spans = this.segmenter.segment(paragraph);
    const settled = spanAt(spans, index);
    if (!settled?.isWord) return null;
    return this.lookupSpan(paragraph, spans, spans.indexOf(settled));
  }

  /** Looks up the word at spans[i] (dictionary loaded). Languages override to use context. */
  protected lookupSpan(paragraph: string, spans: WordSpan[], i: number): LookupResult<WiktionaryLookup> {
    const span = spans[i];
    const surface = paragraph.slice(span.start, span.end);
    const spelling = this.spellingAt(paragraph, spans, i);
    const found = this.find(spelling);
    const key = this.wordKey(spelling);
    if (!found || !key) return this.notFound(span, surface);
    // At a sentence start, also show the capitalised word if it's an entry too (Essen: essen, das Essen).
    const alsoCapitalised = spelling !== surface ? (this.wiktionary.entries(surface).filter((e) => !isFormOnly(e))) : [];
    return this.result(span, key, [{ surface, own: found.entries, lemmas: [...this.lemmaEntries(found), ...alsoCapitalised] }]);
  }

  protected result(span: WordSpan, headword: string, entries: WiktionaryLookup[]): LookupResult<WiktionaryLookup> {
    return { start: span.start, end: span.end, headword, entries, source: this.wiktionary.shortName };
  }

  protected notFound(span: WordSpan, surface: string): LookupResult<WiktionaryLookup> {
    return { ...this.result(span, surface, []), notice: { kind: 'not-found', message: 'No dictionary entry found.' } };
  }

  /** Entries of the dictionary forms that a found word's inflected senses point to. */
  protected lemmaEntries(found: { form: string; entries: WiktionaryEntry[] }): WiktionaryEntry[] {
    const words = new Set<string>();
    for (const e of found.entries) for (const s of e.senses) if (s.lemma && s.lemma !== found.form) words.add(s.lemma);
    return [...words].flatMap((w) => this.wiktionary.entries(w));
  }

  renderEntries(result: LookupResult<WiktionaryLookup>): HTMLElement {
    const root = el('div', { class: 'wk-lookup', lang: this.htmlLang });
    for (const { surface, own, lemmas, display, parts } of result.entries) {
      if (parts) {
        // A compound that isn't an entry itself: "Haustürschlüssel = Haus + Tür + Schlüssel".
        root.append(el('div', { class: 'wk-form wk-compound' }, el('span', {}, surface), el('span', { class: 'wk-arrow' }, '='), el('strong', {}, parts.join(' + '))));
        for (const entry of lemmas) root.append(this.renderEntry(entry));
        continue;
      }
      if (display || this.normalize(surface).toLowerCase() !== result.headword.toLowerCase()) {
        // The form's own pronunciation, when Wiktionary has one (many inflected forms don't).
        const ipa = own.find((e) => e.ipa)?.ipa;
        root.append(
          el(
            'div',
            { class: 'wk-form' },
            el('span', {}, display ?? surface),
            ipa && !display ? el('span', { class: 'wk-ipa' }, ` ${ipa}`) : null,
            el('span', { class: 'wk-arrow', 'aria-label': 'form of' }, '→'),
            el('strong', {}, result.headword),
          ),
        );
      }
      // Inflection notes first ("third-person plural imperfect indicative of manger"), then full entries.
      for (const entry of own) {
        for (const sense of entry.senses) {
          if (sense.lemma) root.append(el('p', { class: 'wk-form-note' }, el('span', { class: 'wk-pos' }, entry.pos), ' ', sense.gloss));
        }
      }
      for (const entry of [...own.filter((e) => !isFormOnly(e)), ...lemmas]) root.append(this.renderEntry(entry));
    }
    return root;
  }

  private renderEntry(entry: WiktionaryEntry): HTMLElement {
    // "maison f (plural maisons)" → gender and plural after the word.
    const gram = entry.head.startsWith(entry.word) ? entry.head.slice(entry.word.length).trim() : entry.head;
    const defs = entry.senses.filter((s) => !s.lemma);
    return el(
      'section',
      { class: 'wk-entry' },
      el(
        'div',
        { class: 'wk-head' },
        el('span', { class: 'wk-word' }, entry.word),
        gram ? el('span', { class: 'wk-gram' }, gram) : null,
        entry.ipa ? el('span', { class: 'wk-ipa' }, entry.ipa) : null,
        el('span', { class: 'wk-pos' }, entry.pos),
      ),
      el('ol', { class: 'defs', lang: 'en' }, ...defs.map((s) => el('li', {}, s.gloss))),
    );
  }
}
