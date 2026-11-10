/**
 * Known-word tracking, one list per language. Each word has a level (0–2 learning, 3 known) and
 * the date it was last marked. Stored and exported in the same format:
 *
 *   { "version": 1, "updated": "2026-11-10", "words": { "的": [3, "2026-11-10"], … } }
 */
import { readText, writeText } from '../storage';

export const KNOWN = 3;
export const LEVELS = [0, 1, 2, KNOWN] as const;
export type Level = (typeof LEVELS)[number];

export interface KnownWordsFile {
  version: 1;
  /** Date of the last change, YYYY-MM-DD. */
  updated: string;
  /** word → [level, last marked date YYYY-MM-DD] */
  words: Record<string, [Level, string]>;
}

/** Local calendar date as YYYY-MM-DD. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Serialises with one word per line, matching the hand-editable export format. */
export function serializeKnownWords(file: KnownWordsFile): string {
  const entries = Object.entries(file.words).map(([word, value]) => `    ${JSON.stringify(word)}: ${JSON.stringify(value).replace(',', ', ')}`);
  return [
    '{',
    `  "version": ${file.version},`,
    `  "updated": ${JSON.stringify(file.updated)},`,
    entries.length ? `  "words": {\n${entries.join(',\n')}\n  }` : '  "words": {}',
    '}',
    '',
  ].join('\n');
}

/** Parses a known-words file, dropping malformed entries. Throws if it isn't one. */
export function parseKnownWords(text: string): KnownWordsFile {
  const data = JSON.parse(text) as Partial<KnownWordsFile>;
  if (!data || typeof data !== 'object' || typeof data.words !== 'object' || data.words === null) {
    throw new Error('Not a known-words file');
  }
  const words: KnownWordsFile['words'] = {};
  for (const [word, value] of Object.entries(data.words)) {
    if (Array.isArray(value) && LEVELS.includes(value[0] as Level) && typeof value[1] === 'string') {
      words[word] = [value[0] as Level, value[1]];
    }
  }
  return { version: 1, updated: typeof data.updated === 'string' ? data.updated : today(), words };
}

export interface MergeResult {
  added: number;
  updated: number;
  unchanged: number;
}

/**
 * Merges `incoming` into `target` (mutating it). For words in both, the entry with the newer
 * date wins; on the same date the incoming entry wins.
 */
export function mergeKnownWords(target: KnownWordsFile, incoming: KnownWordsFile, date = today()): MergeResult {
  const result: MergeResult = { added: 0, updated: 0, unchanged: 0 };
  for (const [word, entry] of Object.entries(incoming.words)) {
    const existing = target.words[word];
    if (!existing) {
      target.words[word] = [entry[0], entry[1]];
      result.added++;
    } else if (entry[1] >= existing[1] && (entry[0] !== existing[0] || entry[1] !== existing[1])) {
      target.words[word] = [entry[0], entry[1]];
      result.updated++;
    } else result.unchanged++;
  }
  if (result.added || result.updated) target.updated = date;
  return result;
}

/** Sets `words` to `level` with `date` (mutating `file`). */
export function markWords(file: KnownWordsFile, words: readonly string[], level: Level, date = today()): void {
  for (const word of words) file.words[word] = [level, date];
  if (words.length) file.updated = date;
}

/**
 * Words to offer as known after reading a page: words on the page (in order, de-duplicated) that
 * are trackable (have a dictionary entry), weren't looked up, and aren't already known.
 */
export function wordsToMarkKnown(
  pageWords: Iterable<string>,
  lookedUp: ReadonlySet<string>,
  levelOf: (word: string) => Level | undefined,
  isTrackable: (word: string) => boolean,
): string[] {
  const out = new Set<string>();
  for (const word of pageWords) {
    if (out.has(word) || lookedUp.has(word) || levelOf(word) === KNOWN || !isTrackable(word)) continue;
    out.add(word);
  }
  return [...out];
}

export class KnownWords {
  private file: KnownWordsFile = { version: 1, updated: today(), words: {} };
  private loading: Promise<void> | null = null;
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(readonly language: string) {}

  /** Called after any change (marking, import, replace). Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private get path() {
    return `known-words/${this.language}.json`;
  }

  load(): Promise<void> {
    this.loading ??= readText(this.path).then((text) => {
      this.loaded = true;
      if (text !== null) {
        try {
          this.file = parseKnownWords(text);
        } catch (err) {
          console.error(`Known words for ${this.language} are unreadable`, err);
        }
      }
      this.listeners.forEach((l) => l());
    });
    return this.loading;
  }

  /** False until the stored list has been read; levels aren't trustworthy before then. */
  get isLoaded(): boolean {
    return this.loaded;
  }

  /** Sets several words at once (one save). */
  async setMany(words: readonly string[], level: Level): Promise<void> {
    await this.load();
    markWords(this.file, words, level);
    if (words.length) await this.save();
  }

  get(word: string): [Level, string] | undefined {
    return this.file.words[word];
  }

  level(word: string): Level | undefined {
    return this.file.words[word]?.[0];
  }

  /** Sets a word's level (adding it if missing) and stamps today's date. */
  async set(word: string, level: Level): Promise<void> {
    await this.load();
    markWords(this.file, [word], level);
    await this.save();
  }

  /** Number of words at each level. */
  counts(): Record<Level, number> {
    const counts: Record<Level, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const [level] of Object.values(this.file.words)) counts[level]++;
    return counts;
  }

  get size(): number {
    return Object.keys(this.file.words).length;
  }

  export(): string {
    return serializeKnownWords(this.file);
  }

  /** Imports a known-words file (same format as export), merging it into this list. */
  async import(text: string): Promise<MergeResult> {
    const incoming = parseKnownWords(text);
    await this.load();
    const result = mergeKnownWords(this.file, incoming);
    if (result.added || result.updated) await this.save();
    return result;
  }

  /** Replaces the whole list with an already-parsed known-words file (an exact copy, dates included). */
  async replace(incoming: KnownWordsFile): Promise<void> {
    await this.load();
    this.file = { version: 1, updated: incoming.updated, words: { ...incoming.words } };
    await this.save();
  }

  private save(): Promise<void> {
    this.listeners.forEach((l) => l());
    const text = serializeKnownWords(this.file);
    this.writeChain = this.writeChain.then(() => writeText(this.path, text)).catch((err) => console.error('Saving known words failed', err));
    return this.writeChain;
  }
}

const stores = new Map<string, KnownWords>();

export function knownWords(language: string): KnownWords {
  let store = stores.get(language);
  if (!store) {
    store = new KnownWords(language);
    stores.set(language, store);
  }
  return store;
}
