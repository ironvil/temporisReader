/**
 * Base for languages looked up in Wiktionary (French now; German, Spanish… later). It handles
 * everything that's the same for any Wiktionary language: finding entries (as written, then
 * lower-cased), following inflected forms to their dictionary form, tracking known words by
 * that form, and the popup. A language adds its segmenter, detection and spelling normalisation.
 */
import { spanAt, type WordSegmenter } from '../../segmentation/types';
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
  private find(word: string): { form: string; entries: WiktionaryEntry[] } | null {
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

  private computeKey(word: string): string | null {
    if (!this.wiktionary.isReady() || !LETTER.test(word)) return null;
    const found = this.find(word);
    if (!found) return null;
    // A word with its own meanings (livre "book", not only a form of livrer) is its own key.
    if (!found.entries.every(isFormOnly)) return found.form;
    return found.entries[0].senses[0].lemma ?? found.form;
  }

  async lookup(paragraph: string, index: number): Promise<LookupResult<WiktionaryLookup> | null> {
    const span = spanAt(this.segmenter.segment(paragraph), index);
    if (!span?.isWord) return null;
    const surface = paragraph.slice(span.start, span.end);
    if (!LETTER.test(surface)) return null;

    const result = (headword: string, entries: WiktionaryLookup[]): LookupResult<WiktionaryLookup> => ({
      start: span.start,
      end: span.end,
      headword,
      entries,
      source: this.wiktionary.shortName,
    });

    if (!(await this.wiktionary.ensureLoaded())) {
      return { ...result(surface, []), notice: { kind: 'missing-dictionary', message: `${this.name} isn’t added yet. Add it in Settings → Languages.` } };
    }
    // Loading may have changed segmentation (hyphenated entries): look again.
    const settled = spanAt(this.segmenter.segment(paragraph), index);
    if (settled && (settled.start !== span.start || settled.end !== span.end)) return this.lookup(paragraph, index);

    const found = this.find(surface);
    const key = this.wordKey(surface);
    if (!found || !key) return { ...result(surface, []), notice: { kind: 'not-found', message: 'No dictionary entry found.' } };

    const lemmaWords = new Set<string>();
    for (const e of found.entries) for (const s of e.senses) if (s.lemma && s.lemma !== found.form) lemmaWords.add(s.lemma);
    const lemmas = [...lemmaWords].flatMap((w) => this.wiktionary.entries(w));
    return result(key, [{ surface, own: found.entries, lemmas }]);
  }

  renderEntries(result: LookupResult<WiktionaryLookup>): HTMLElement {
    const root = el('div', { class: 'wk-lookup', lang: this.htmlLang });
    for (const { surface, own, lemmas } of result.entries) {
      if (this.normalize(surface).toLowerCase() !== result.headword.toLowerCase()) {
        // The form's own pronunciation, when Wiktionary has one (many inflected forms don't).
        const ipa = own.find((e) => e.ipa)?.ipa;
        root.append(
          el(
            'div',
            { class: 'wk-form' },
            el('span', {}, surface),
            ipa ? el('span', { class: 'wk-ipa' }, ` ${ipa}`) : null,
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
