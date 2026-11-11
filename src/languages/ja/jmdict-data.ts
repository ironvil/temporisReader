/**
 * JMdict (EDRDG's Japanese → English dictionary), trimmed for the phone.
 *
 * The download is JMdict_e.gz: ~10 MB gzipped, ~60 MB of XML with one tag per line. Installing
 * streams through it once (`JmdictParser`, fed line by line) and keeps one compact line per entry,
 * plus a sorted key list (every spelling and reading → its entries) for binary search. Everything
 * stays as UTF-8 bytes (`JmdictIndex`); only the lines a lookup needs are decoded.
 *
 * Stored text, one record per line:
 *   line 0      jmdict  1  <entry count>  <key count>  <created date>
 *   line 1      longest segmentable key (UTF-16 units) per first character: c FIELD n LIST c FIELD n…
 *   entries     kanji  readings  senses                       (tab-separated, see `encodeEntry`)
 *   keys        key  use  entry numbers (comma-separated, best first)               (sorted)
 *
 * A key's `use` says whether the segmenter may take it as a word: 0 no (a kanji word's bare
 * reading, or only a set expression like 吾輩は猫である), 1 yes, 2 yes and it's a common spelling.
 *
 * No imports: kept self-contained like the Wiktionary data module.
 */

export interface JmdictKanji {
  text: string;
  /** In news1/ichi1/spec1/spec2/gai1: JMdict's "common word" marks. */
  common: boolean;
  /** Rare, irregular or outdated (shown dimmed). */
  rare: boolean;
  /** Search-only spellings: found by lookups, never shown. */
  hidden: boolean;
}

export interface JmdictReading extends JmdictKanji {
  /** Not a true reading of the kanji forms (e.g. some katakana renderings). */
  noKanji: boolean;
  /** Only applies to these kanji forms (empty: all). */
  restrict: string[];
}

export interface JmdictSense {
  /** JMdict part-of-speech codes, e.g. v1, v5k, adj-i, n (a sense without its own repeats the previous). */
  pos: string[];
  /** Misc codes, e.g. uk ("usually written using kana alone"), pol, sl. */
  misc: string[];
  glosses: string[];
  /** Extra information, e.g. "usu. in the negative". */
  info: string;
}

export interface JmdictEntry {
  /** Position in the stored file: identifies the entry. */
  id: number;
  kanji: JmdictKanji[];
  readings: JmdictReading[];
  senses: JmdictSense[];
}

const ITEM = '\u001d';
const FIELD = '\u001e';
const LIST = '\u001f';
const MAX_SENSES = 16;
const MAX_GLOSSES = 8;
const MAX_GLOSS = 200;
const COMMON = new Set(['news1', 'ichi1', 'spec1', 'spec2', 'gai1']);
const RARE = new Set(['rK', 'iK', 'oK', 'ik', 'ok', 'rk']);
const HIDDEN = new Set(['sK', 'sk']);

const clean = (s: string) => s.replace(/[\t\n\r\u001d-\u001f]+/g, ' ').trim();

function unescape(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]!);
}

/** The text of a one-line element, with an entity reference (&v1;) given as its name. */
function value(line: string): string {
  const inner = line.replace(/^\s*<[^>]*>/, '').replace(/<\/[^>]*>\s*$/, '');
  const entity = /^&([\w-]+);$/.exec(inner);
  return entity ? entity[1] : clean(unescape(inner));
}

const flags = (k: JmdictKanji) => (k.common ? 'c' : '') + (k.rare ? 'r' : '') + (k.hidden ? 's' : '');

export function encodeEntry(e: Omit<JmdictEntry, 'id'>): string {
  const kanji = e.kanji.map((k) => [k.text, flags(k)].join(FIELD)).join(ITEM);
  const readings = e.readings.map((r) => [r.text, flags(r) + (r.noKanji ? 'n' : ''), r.restrict.join(LIST)].join(FIELD)).join(ITEM);
  const senses = e.senses.map((s) => [s.pos.join(LIST), s.misc.join(LIST), s.glosses.join(LIST), s.info].join(FIELD)).join(ITEM);
  return [kanji, readings, senses].join('\t');
}

export function decodeEntry(id: number, line: string): JmdictEntry {
  const [kanji, readings, senses] = line.split('\t');
  const items = (s: string) => (s ? s.split(ITEM) : []);
  const list = (s: string | undefined) => (s ? s.split(LIST) : []);
  const marks = (f = '') => ({ common: f.includes('c'), rare: f.includes('r'), hidden: f.includes('s') });
  return {
    id,
    kanji: items(kanji).map((k) => {
      const [text, f] = k.split(FIELD);
      return { text, ...marks(f) };
    }),
    readings: items(readings).map((r) => {
      const [text, f, restrict] = r.split(FIELD);
      return { text, ...marks(f), noKanji: (f ?? '').includes('n'), restrict: list(restrict) };
    }),
    senses: items(senses).map((s) => {
      const [pos, misc, glosses, info] = s.split(FIELD);
      return { pos: list(pos), misc: list(misc), glosses: list(glosses), info: info ?? '' };
    }),
  };
}

/**
 * True when a reading is how the word is written: there's no kanji form to show, or its main
 * meaning is usually written in kana (浜 has a minor "Yokohama" sense in kana: はま isn't 浜).
 */
export function kanaIsWritten(e: Omit<JmdictEntry, 'id'>, reading: JmdictReading): boolean {
  return reading.noKanji || e.kanji.every((k) => k.hidden) || !!e.senses[0]?.misc.includes('uk');
}

const SEGMENTABLE = 1;
const COMMON_SPELLING = 2;
const COMMON_ENTRY = 4;

const isCommon = (e: Omit<JmdictEntry, 'id'>) => e.kanji.some((k) => k.common) || e.readings.some((r) => r.common);

/** Builds entries from JMdict XML, fed one line at a time. */
export class JmdictParser {
  /** "2026-11-11", from the file's "JMdict created" comment. */
  created = '';
  private readonly entries: string[] = [];
  /**
   * key → its entries, each packed into one number (entry number × 8 + the flags below): a few
   * hundred thousand keys, so no per-entry arrays, to keep memory down while installing on a phone.
   */
  private readonly keys = new Map<string, number[]>();
  private entry: Omit<JmdictEntry, 'id'> | null = null;
  private sense: JmdictSense | null = null;
  private lastPos: string[] = [];

  get entryCount(): number {
    return this.entries.length;
  }

  line(line: string): void {
    const tag = /^\s*<(\/?[\w_]+)/.exec(line)?.[1];
    if (!tag) {
      const created = /<!-- JMdict created: (\S+) -->/.exec(line);
      if (created) this.created = created[1];
      return;
    }
    if (tag === 'entry') {
      this.entry = { kanji: [], readings: [], senses: [] };
      this.lastPos = [];
      return;
    }
    const e = this.entry;
    if (!e) return;
    const kanji = e.kanji.at(-1);
    const reading = e.readings.at(-1);
    switch (tag) {
      case 'keb':
        e.kanji.push({ text: value(line), common: false, rare: false, hidden: false });
        break;
      case 'ke_inf':
      case 're_inf': {
        const target = tag === 'ke_inf' ? kanji : reading;
        const v = value(line);
        if (target && RARE.has(v)) target.rare = true;
        if (target && HIDDEN.has(v)) target.hidden = true;
        break;
      }
      case 'ke_pri':
      case 're_pri': {
        const target = tag === 'ke_pri' ? kanji : reading;
        if (target && COMMON.has(value(line))) target.common = true;
        break;
      }
      case 'reb':
        e.readings.push({ text: value(line), common: false, rare: false, hidden: false, noKanji: false, restrict: [] });
        break;
      case 're_nokanji':
        if (reading) reading.noKanji = true;
        break;
      case 're_restr':
        reading?.restrict.push(value(line));
        break;
      case 'sense':
        this.sense = { pos: [], misc: [], glosses: [], info: '' };
        break;
      case 'pos':
        this.sense?.pos.push(value(line));
        break;
      case 'misc':
        this.sense?.misc.push(value(line));
        break;
      case 'gloss': {
        const s = this.sense;
        if (s && s.glosses.length < MAX_GLOSSES) {
          let g = value(line);
          if (g.length > MAX_GLOSS) g = g.slice(0, MAX_GLOSS - 1) + '…';
          if (g) s.glosses.push(g);
        }
        break;
      }
      case 's_inf':
        if (this.sense) this.sense.info = value(line);
        break;
      case '/sense': {
        const s = this.sense;
        this.sense = null;
        if (!s) break;
        // JMdict: a sense's parts of speech carry on to later senses that don't list their own.
        if (s.pos.length) this.lastPos = s.pos;
        else s.pos = this.lastPos;
        if (s.glosses.length && e.senses.length < MAX_SENSES) e.senses.push(s);
        break;
      }
      case '/entry':
        this.finishEntry(e);
        this.entry = null;
        break;
    }
  }

  private finishEntry(e: Omit<JmdictEntry, 'id'>): void {
    if (!e.senses.length || !e.readings.length) return;
    const id = this.entries.length;
    this.entries.push(encodeEntry(e));
    const common = isCommon(e);
    // Set expressions (これは, 雨が降る) and titles (吾輩は猫である) would swallow the particles
    // around them: they can be looked up, but text is never split into them.
    const word = !e.senses.some((s) => s.pos.includes('exp') || s.misc.includes('work'));
    const add = (key: string, segmentable: boolean, commonSpelling: boolean) => {
      const flags = (segmentable ? SEGMENTABLE : 0) | (commonSpelling ? COMMON_SPELLING : 0) | (common ? COMMON_ENTRY : 0);
      let list = this.keys.get(key);
      if (!list) this.keys.set(key, (list = []));
      const at = list.findIndex((x) => Math.floor(x / 8) === id);
      if (at >= 0) list[at] |= flags;
      else list.push(id * 8 + flags);
    };
    // Search-only spellings (喰べる, 行る) are found when looked up, but text isn't split into them.
    for (const k of e.kanji) add(k.text, word && !k.hidden, word && k.common);
    for (const r of e.readings) {
      const written = word && kanaIsWritten(e, r);
      add(r.text, written, written && r.common);
    }
  }

  /** The stored file's text, as lines (see the module comment). */
  *lines(): Generator<string> {
    const keys = [...this.keys.keys()].sort(compareKeys);
    const longest = new Map<string, number>();
    for (const [key, list] of this.keys) {
      if (!list.some((x) => x & SEGMENTABLE)) continue;
      const first = String.fromCodePoint(key.codePointAt(0)!);
      longest.set(first, Math.max(longest.get(first) ?? 0, key.length));
    }
    yield ['jmdict', '1', this.entries.length, keys.length, this.created].join('\t');
    yield [...longest].map(([c, n]) => c + FIELD + n).join(LIST);
    yield* this.entries;
    for (const key of keys) {
      const list = this.keys.get(key)!;
      // Entries written this way first (は the particle before 歯), then common ones, then JMdict's order.
      const has = (x: number, flag: number) => (x & flag ? 1 : 0);
      const ordered = [...list].sort((a, b) => has(b, SEGMENTABLE) - has(a, SEGMENTABLE) || has(b, COMMON_ENTRY) - has(a, COMMON_ENTRY) || a - b);
      const use = list.some((x) => x & SEGMENTABLE && x & COMMON_SPELLING) ? '2' : list.some((x) => x & SEGMENTABLE) ? '1' : '0';
      yield [key, use, ordered.map((x) => Math.floor(x / 8)).join(',')].join('\t');
    }
  }
}

/** Code-point order, which is also UTF-8 byte order (what JmdictIndex searches by). */
export function compareKeys(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    if (x !== y) return x - y;
    if (x > 0xffff) i++;
  }
  return a.length - b.length;
}

const TAB = 0x09;
const NEWLINE = 0x0a;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** What a key lookup finds. */
export interface JmdictKey {
  /** Usable as a word when segmenting: a spelling, or a reading the word is written in. */
  segmentable: boolean;
  /** A common spelling (JMdict's priority marks), preferred when splitting text. */
  common: boolean;
  entries: number[];
}

/** The installed data as UTF-8 bytes, indexed by line starts. */
export class JmdictIndex {
  private readonly starts: Int32Array;
  readonly entryCount: number;
  readonly keyCount: number;
  readonly created: string;
  private readonly longest = new Map<string, number>();
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    let count = 0;
    for (let i = bytes.indexOf(NEWLINE); i !== -1; i = bytes.indexOf(NEWLINE, i + 1)) count++;
    if (bytes.length && bytes[bytes.length - 1] !== NEWLINE) count++;
    const starts = new Int32Array(count + 1);
    let n = 0;
    for (let pos = 0; pos < bytes.length; ) {
      starts[n++] = pos;
      const nl = bytes.indexOf(NEWLINE, pos);
      pos = nl === -1 ? bytes.length : nl + 1;
    }
    starts[n] = bytes.length;
    this.starts = starts;

    const [magic, , entries, keys, created] = this.line(0).split('\t');
    if (magic !== 'jmdict' || n !== 2 + Number(entries) + Number(keys)) throw new Error('Not JMdict data');
    this.entryCount = Number(entries);
    this.keyCount = Number(keys);
    this.created = created ?? '';
    for (const pair of this.line(1).split(LIST)) {
      const [c, len] = pair.split(FIELD);
      if (c) this.longest.set(c, Number(len));
    }
  }

  private line(i: number): string {
    let end = this.starts[i + 1];
    if (this.bytes[end - 1] === NEWLINE) end--;
    return decoder.decode(this.bytes.subarray(this.starts[i], end));
  }

  /** Compares key line i's key with `key` (UTF-8) by bytes. */
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

  find(key: string): JmdictKey | null {
    const k = encoder.encode(key);
    let lo = 2 + this.entryCount;
    let hi = lo + this.keyCount;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.compare(mid, k) < 0) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= 2 + this.entryCount + this.keyCount || this.compare(lo, k) !== 0) return null;
    const [, use, ids] = this.line(lo).split('\t');
    return { segmentable: use !== '0', common: use === '2', entries: ids.split(',').map(Number) };
  }

  entry(id: number): JmdictEntry {
    return decodeEntry(id, this.line(2 + id));
  }

  /** Length (UTF-16) of the longest segmentable key starting with `char`. */
  longestFrom(char: string): number {
    return this.longest.get(char) ?? 0;
  }
}
