/**
 * German: Wiktionary lookups, plus two things German needs:
 * - separable verbs: in "Er fängt morgen an", fängt and the clause-final particle an are the verb
 *   anfangen. Both look it up, and it's tracked (and counted) as anfangen;
 * - compounds that aren't entries (Donaudampfschiffskapitän) are shown as their dictionary parts
 *   (Donau + Dampfschiff + Kapitän). They aren't tracked as words.
 */
import type { LookupResult } from '../types';
import type { WordSpan, WordSegmenter } from '../../segmentation/types';
import type { WiktionaryEntry } from '../wiktionary/data';
import { WiktionaryDictionary } from '../wiktionary/dictionary';
import { WiktionaryLanguage, type WiktionaryLookup } from '../wiktionary/language';
import { WiktionaryWordSegmenter } from '../wiktionary/segmenter';

const LETTER = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;
/** Common German words that are rare in other Latin-script languages. */
const GERMAN_WORDS = new Set(
  'der die das und ist nicht ein eine einen einem einer zu den von mit sich auf für im dem auch es als nach wie aber bei oder wird sind noch nur ich er sie wir ihr war hat haben kann wenn dass schon mir mich dir dich ihm ihn uns sehr hier dann doch'.split(' '),
);

/** Separable verb prefixes that stand alone at the end of a clause ("Er kommt morgen zurück"). */
export const SEPARABLE_PARTICLES = new Set(
  'ab an auf aus bei dar durch ein empor entgegen fern fest fort heim her herab heran herauf heraus herbei herein herum herunter hervor hin hinab hinauf hinaus hinein hinzu hoch los mit nach nieder statt teil vor voran voraus vorbei vorüber weg weiter wieder zu zurecht zurück zusammen'.split(' '),
);
/** Punctuation that ends a clause, where a separated particle sits. */
const CLAUSE_END = /[.!?;:,…—–]/;
/** Linking elements between compound parts (Fugenelemente). */
const LINKS = ['', 's', 'es', 'n', 'en', 'e', 'er', 'ens'];
/** Shortest compound part tried, to avoid nonsense splits into tiny words. */
const MIN_PART = 3;
const CACHE_SIZE = 200;

const isFormOnly = (e: WiktionaryEntry) => e.senses.every((s) => s.lemma);

export interface SeparableVerb {
  /** Span index of the verb, and of the particle at the clause end. */
  verb: number;
  particle: number;
  /** The dictionary verb, e.g. anfangen. */
  lemma: string;
}

export const germanWiktionary = () => new WiktionaryDictionary({ code: 'de', language: 'German', downloadSize: '100 MB', coverage: 'about 370,000 words and forms' });

export class GermanLanguage extends WiktionaryLanguage {
  readonly id = 'de';
  readonly name = 'German';
  readonly nativeName = 'Deutsch';
  readonly htmlLang = 'de';
  readonly sampleText = 'Heute Morgen fiel die Sonne durch das hohe Fenster.';
  readonly segmenter: WordSegmenter;
  private readonly separableCache = new Map<string, SeparableVerb[]>();
  private cacheRevision = -1;

  constructor(wiktionary = germanWiktionary()) {
    super(wiktionary);
    this.segmenter = new WiktionaryWordSegmenter(wiktionary, 'de');
  }

  detect(sample: string): number {
    const letters = [...sample].filter((c) => LETTER.test(c));
    if (!letters.length || letters.filter((c) => LATIN.test(c)).length / letters.length < 0.8) return 0;
    const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
    if (!words.length) return 0;
    const german = words.filter((w) => GERMAN_WORDS.has(w)).length;
    return Math.min(1, (german / words.length) * 4);
  }

  // ── Separable verbs ──────────────────────────────────────────────────────

  /** Infinitives a word can be (a form of) as a verb: fängt → fangen. */
  private verbLemmas(word: string): string[] {
    const found = this.find(word);
    if (!found) return [];
    const out = new Set<string>();
    for (const e of found.entries) {
      if (e.pos !== 'verb') continue;
      if (e.senses.some((s) => !s.lemma)) out.add(found.form);
      for (const s of e.senses) if (s.lemma) out.add(s.lemma);
    }
    return [...out];
  }

  private isVerb(word: string): boolean {
    return this.wiktionary.entries(word).some((e) => e.pos === 'verb');
  }

  /**
   * Separated verbs in a paragraph: a clause ending in a particle (an, zurück…) whose earlier
   * word is a form of a verb that, with the particle in front, is itself a verb (fängt … an →
   * anfangen). The first such word in the clause is taken as the verb.
   */
  separableVerbs(text: string, spans: WordSpan[]): SeparableVerb[] {
    if (!this.wiktionary.isReady()) return [];
    if (this.wiktionary.revision !== this.cacheRevision) {
      this.separableCache.clear();
      this.cacheRevision = this.wiktionary.revision;
    }
    const cached = this.separableCache.get(text);
    if (cached) return cached;

    const found: SeparableVerb[] = [];
    let clause: number[] = [];
    const endClause = () => {
      if (clause.length >= 2) {
        const particle = clause[clause.length - 1];
        const prefix = text.slice(spans[particle].start, spans[particle].end).toLowerCase();
        if (SEPARABLE_PARTICLES.has(prefix)) {
          search: for (const i of clause.slice(0, -1)) {
            for (const lemma of this.verbLemmas(text.slice(spans[i].start, spans[i].end))) {
              if (this.isVerb(prefix + lemma)) {
                found.push({ verb: i, particle, lemma: prefix + lemma });
                break search;
              }
            }
          }
        }
      }
      clause = [];
    };
    spans.forEach((s, i) => {
      if (s.isWord) clause.push(i);
      else if (CLAUSE_END.test(text.slice(s.start, s.end))) endClause();
    });
    endClause();

    if (this.separableCache.size >= CACHE_SIZE) this.separableCache.delete(this.separableCache.keys().next().value!);
    this.separableCache.set(text, found);
    return found;
  }

  /** As wordKey, except a separated verb is tracked as the whole verb and its particle isn't tracked. */
  contextKeys(text: string, spans: WordSpan[]): (string | null)[] {
    const keys = super.contextKeys(text, spans);
    for (const { verb, particle, lemma } of this.separableVerbs(text, spans)) {
      keys[verb] = lemma;
      keys[particle] = null;
    }
    return keys;
  }

  // ── Lookups ──────────────────────────────────────────────────────────────

  protected lookupSpan(paragraph: string, spans: WordSpan[], i: number): LookupResult<WiktionaryLookup> {
    const span = spans[i];
    const surface = paragraph.slice(span.start, span.end);

    const separable = this.separableVerbs(paragraph, spans).find((s) => s.verb === i || s.particle === i);
    if (separable) {
      const verbSpan = spans[separable.verb];
      const particleSpan = spans[separable.particle];
      const verbSurface = paragraph.slice(verbSpan.start, verbSpan.end);
      const found = this.find(this.spellingAt(paragraph, spans, separable.verb));
      // The whole verb first, then the verb without its particle (fangen) for reference.
      const lemmas = dedupe([...this.wiktionary.entries(separable.lemma), ...(found ? this.lemmaEntries(found) : [])]);
      const own = found?.entries.filter(isFormOnly) ?? [];
      const display = `${verbSurface} … ${paragraph.slice(particleSpan.start, particleSpan.end)}`;
      return this.result(span, separable.lemma, [{ surface, display, own, lemmas }]);
    }

    const plain = super.lookupSpan(paragraph, spans, i);
    if (plain.entries.length) return plain;

    const parts = this.compoundParts(surface);
    if (!parts) return plain;
    const lemmas = dedupe(
      parts.flatMap((part) => {
        const found = this.find(part)!;
        return [...found.entries.filter((e) => !isFormOnly(e)), ...this.lemmaEntries(found)];
      }),
    );
    return { ...this.result(span, surface, [{ surface, own: [], lemmas, parts }]), untracked: true };
  }

  /**
   * Splits a word that isn't an entry into the fewest dictionary words, allowing linking elements
   * between them (Donaudampfschiffskapitän → Donau + Dampfschiff + Kapitän). Parts are returned as
   * the dictionary spells them (nouns capitalised). Null when there's no split into 2+ parts.
   */
  compoundParts(word: string): string[] | null {
    if (!this.wiktionary.isReady() || word.length < 2 * MIN_PART) return null;
    const n = word.length;
    // best[i]: fewest parts covering word[0, i), with the parts.
    const best: (string[] | null)[] = Array.from({ length: n + 1 }, () => null);
    best[0] = [];
    for (let i = 0; i < n; i++) {
      const before = best[i];
      if (!before) continue;
      for (let j = i + MIN_PART; j <= n; j++) {
        const part = this.matchPart(word.slice(i, j));
        if (!part) continue;
        for (const link of j === n ? [''] : LINKS) {
          if (!word.startsWith(link, j)) continue;
          const end = j + link.length;
          // A linking element joins two parts: never at the end, and leaves room for another part.
          if (end > n || (link && (end === n || n - end < MIN_PART))) continue;
          const candidate = [...before, part];
          if (!best[end] || betterSplit(candidate, best[end]!)) best[end] = candidate;
        }
      }
    }
    const parts = best[n];
    return parts && parts.length >= 2 ? parts : null;
  }

  /**
   * A compound part as the dictionary spells it: capitalised (nouns, most parts), as written or
   * lower-cased; an inflected part (Dampfschiffs) is given as its dictionary form (Dampfschiff).
   */
  private matchPart(piece: string): string | null {
    const capitalised = piece[0].toUpperCase() + piece.slice(1).toLowerCase();
    for (const form of new Set([capitalised, piece, piece.toLowerCase()])) {
      const entries = this.wiktionary.entries(form);
      if (!entries.length) continue;
      return isFormOnly(entries[0]) ? entries[0].senses[0].lemma! : form;
    }
    return null;
  }
}

/** Fewer parts first; then longer parts earlier (Sonnenblume + Feld, not Sonn + Blumenfeld). */
function betterSplit(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return a.length < b.length;
  for (let k = 0; k < a.length; k++) if (a[k].length !== b[k].length) return a[k].length > b[k].length;
  return false;
}

function dedupe(entries: WiktionaryEntry[]): WiktionaryEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const id = `${e.word}\t${e.pos}\t${e.head}\t${e.senses.map((s) => s.gloss).join('|')}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
