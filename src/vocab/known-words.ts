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

export class KnownWords {
  private file: KnownWordsFile = { version: 1, updated: today(), words: {} };
  private loading: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(readonly language: string) {}

  private get path() {
    return `known-words/${this.language}.json`;
  }

  load(): Promise<void> {
    this.loading ??= readText(this.path).then((text) => {
      if (text === null) return;
      try {
        this.file = parseKnownWords(text);
      } catch (err) {
        console.error(`Known words for ${this.language} are unreadable`, err);
      }
    });
    return this.loading;
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
    const date = today();
    this.file.words[word] = [level, date];
    this.file.updated = date;
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

  private save(): Promise<void> {
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
