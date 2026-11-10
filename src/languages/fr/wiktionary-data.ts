/**
 * French → English data from English Wiktionary, via kaikki.org's Wiktextract dump.
 *
 * The dump is ~600 MB of JSON lines (one per word + part of speech). Installing trims every entry
 * to one compact line and sorts them, so the stored file is small and lookups are a binary search
 * over one string (no per-word objects kept in memory).
 *
 * Compact line (tab-separated, sorted by word in UTF-16 code-unit order):
 *   word  pos  head  ipa  senses
 * senses are separated by U+001F; a sense is "gloss" or "gloss U+001E lemma" for inflected forms
 * ("third-person plural imperfect indicative of manger" → manger).
 *
 * No imports: scripts/measure-wiktionary.mjs runs this file directly under Node.
 */

export interface WiktionarySense {
  gloss: string;
  /** Set for inflected forms: the dictionary form this is a form of. */
  lemma?: string;
}

export interface WiktionaryEntry {
  word: string;
  pos: string;
  /** Headword line, e.g. "maison f (plural maisons)". Empty when it adds nothing. */
  head: string;
  ipa: string;
  senses: WiktionarySense[];
}

const SENSE_SEP = '\u001f';
const LEMMA_SEP = '\u001e';
/** Keeps a few huge entries (faire, prendre…) from dominating the file; the popup scrolls anyway. */
const MAX_SENSES = 20;
const MAX_GLOSS = 300;

const clean = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/[\t\n\r\u001e\u001f]+/g, ' ').trim() : '';

interface RawSense {
  glosses?: unknown[];
  raw_glosses?: unknown[];
  form_of?: { word?: unknown }[];
  alt_of?: { word?: unknown }[];
  tags?: unknown[];
}

interface RawEntry {
  word?: unknown;
  pos?: unknown;
  lang_code?: unknown;
  head_templates?: { expansion?: unknown }[];
  sounds?: { ipa?: unknown }[];
  senses?: RawSense[];
}

/** One kaikki.org JSON object → a compact line, or null when there's nothing useful to keep. */
export function trimEntry(raw: RawEntry): string | null {
  const word = clean(raw.word);
  const pos = clean(raw.pos);
  if (!word || (raw.lang_code !== undefined && raw.lang_code !== 'fr')) return null;

  const senses: string[] = [];
  for (const s of raw.senses ?? []) {
    if (senses.length >= MAX_SENSES) break;
    // raw_glosses keep labels like "(transitive)"; nested senses list the parent gloss first.
    const glosses = (s.raw_glosses?.length ? s.raw_glosses : s.glosses) ?? [];
    let gloss = clean(glosses[glosses.length - 1]);
    if (!gloss) continue;
    if (gloss.length > MAX_GLOSS) gloss = gloss.slice(0, MAX_GLOSS - 1) + '…';
    const lemma = clean(s.form_of?.[0]?.word) || clean(s.alt_of?.[0]?.word);
    senses.push(lemma && lemma !== word ? gloss + LEMMA_SEP + lemma : gloss);
  }
  if (!senses.length) return null;

  let head = clean(raw.head_templates?.[0]?.expansion);
  if (head === word) head = '';
  const ipa = clean(raw.sounds?.find((s) => typeof s.ipa === 'string')?.ipa);
  return [word, pos, head, ipa, senses.join(SENSE_SEP)].join('\t');
}

/** Sort key of a compact line: its word. */
const wordOf = (line: string): string => line.slice(0, line.indexOf('\t'));

/** Code-point order, which is also UTF-8 byte order (what WiktionaryIndex searches by). */
export function compareWords(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    if (x !== y) return x - y;
    if (x > 0xffff) i++;
  }
  return a.length - b.length;
}

/** Sorts compact lines by word (stable, so a word's entries keep Wiktionary's order). */
export function sortLines(lines: string[]): string[] {
  return lines
    .map((line, i) => ({ line, word: wordOf(line), i }))
    .sort((a, b) => compareWords(a.word, b.word) || a.i - b.i)
    .map((x) => x.line);
}

export function parseLine(line: string): WiktionaryEntry {
  const [word, pos, head, ipa, senses] = line.split('\t');
  return {
    word,
    pos,
    head,
    ipa,
    senses: (senses ?? '').split(SENSE_SEP).map((s) => {
      const [gloss, lemma] = s.split(LEMMA_SEP);
      return lemma ? { gloss, lemma } : { gloss };
    }),
  };
}

const TAB = 0x09;
const NEWLINE = 0x0a;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The installed data, kept as UTF-8 bytes (half the memory of a JS string here: the IPA would make
 * it a two-byte string) and indexed by line starts. Only the lines a lookup needs are decoded.
 */
export class WiktionaryIndex {
  private readonly bytes: Uint8Array;
  private readonly starts: Int32Array;
  readonly entryCount: number;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    let count = 0;
    for (let i = bytes.indexOf(NEWLINE); i !== -1; i = bytes.indexOf(NEWLINE, i + 1)) count++;
    if (bytes.length && bytes[bytes.length - 1] !== NEWLINE) count++;
    const starts = new Int32Array(count + 1);
    let n = 0;
    let pos = 0;
    while (pos < bytes.length) {
      starts[n++] = pos;
      const nl = bytes.indexOf(NEWLINE, pos);
      pos = nl === -1 ? bytes.length : nl + 1;
    }
    starts[n] = bytes.length;
    this.starts = starts;
    this.entryCount = n;
  }

  /** Compares line i's word with `key` (UTF-8) by bytes. */
  private compare(i: number, key: Uint8Array): number {
    const b = this.bytes;
    let p = this.starts[i];
    for (let k = 0; ; k++, p++) {
      const atEnd = b[p] === TAB || b[p] === NEWLINE || p >= b.length;
      if (k === key.length) return atEnd ? 0 : 1;
      if (atEnd) return -1;
      if (b[p] !== key[k]) return b[p] - key[k];
    }
  }

  private line(i: number): string {
    let end = this.starts[i + 1];
    if (this.bytes[end - 1] === NEWLINE) end--;
    return decoder.decode(this.bytes.subarray(this.starts[i], end));
  }

  /** Compact lines for exactly `word`, in file order. */
  lines(word: string): string[] {
    const key = encoder.encode(word);
    let lo = 0;
    let hi = this.entryCount;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.compare(mid, key) < 0) lo = mid + 1;
      else hi = mid;
    }
    const out: string[] = [];
    for (let i = lo; i < this.entryCount && this.compare(i, key) === 0; i++) out.push(this.line(i));
    return out;
  }

  has(word: string): boolean {
    const key = encoder.encode(word);
    let lo = 0;
    let hi = this.entryCount;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.compare(mid, key) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo < this.entryCount && this.compare(lo, key) === 0;
  }

  entries(word: string): WiktionaryEntry[] {
    return this.lines(word).map(parseLine);
  }
}
