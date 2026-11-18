/**
 * Words the reader added themselves (Add to my words, from selected text), one list per
 * language. They sit on top of the downloaded dictionaries, which are never changed: a language
 * splits text with them too (德拉科尼娅 becomes one word), and looks them up.
 *
 *   { "version": 1, "revision": 3, "words": { "德拉科尼娅": { "added": "2026-11-17", "definition": "Draconia" } } }
 *
 * `revision` goes up with every change, so cached word counts made with other words are rebuilt.
 */
import type { WordList } from '../segmentation/dictionary';
import { readText, writeText } from '../storage';
import { today } from './known-words';

export interface UserWord {
  /** Date added (or last changed), YYYY-MM-DD. */
  added: string;
  /** What the reader wrote it means; may be empty. */
  definition?: string;
}

export interface UserDictionaryFile {
  version: 1;
  revision: number;
  words: Record<string, UserWord>;
}

export const MAX_USER_WORD_LENGTH = 20;

/** Parses a user dictionary file, dropping malformed entries. Throws if it isn't one. */
export function parseUserDictionary(text: string): UserDictionaryFile {
  const data = JSON.parse(text) as Partial<UserDictionaryFile>;
  if (!data || typeof data !== 'object' || typeof data.words !== 'object' || data.words === null) throw new Error('Not a user dictionary file');
  const words: UserDictionaryFile['words'] = {};
  for (const [word, value] of Object.entries(data.words)) {
    if (!word || !value || typeof value !== 'object' || typeof value.added !== 'string') continue;
    words[word] = typeof value.definition === 'string' && value.definition ? { added: value.added, definition: value.definition } : { added: value.added };
  }
  return { version: 1, revision: typeof data.revision === 'number' ? data.revision : 0, words };
}

export function userDictionaryPath(language: string): string {
  return `user-dictionary/${language}.json`;
}

export class UserDictionary implements WordList {
  private file: UserDictionaryFile = { version: 1, revision: 0, words: {} };
  private longest = new Map<string, number>();
  private loading: Promise<void> | null = null;
  private changes = 0;
  private readonly listeners = new Set<() => void>();

  constructor(readonly language: string) {}

  /** Called after any change (and once loaded). Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  load(): Promise<void> {
    this.loading ??= readText(userDictionaryPath(this.language)).then((text) => {
      if (text !== null) {
        try {
          this.file = parseUserDictionary(text);
        } catch (err) {
          console.error(`The user dictionary for ${this.language} is unreadable`, err);
        }
      }
      this.changed();
    });
    return this.loading;
  }

  /** Stored revision: identifies the words for caches that outlive the session. */
  get key(): number {
    return this.file.revision;
  }

  // WordList: changes in memory whenever the words do (loaded, added, removed).
  get revision(): number {
    return this.changes;
  }

  has(word: string): boolean {
    return Object.hasOwn(this.file.words, word);
  }

  maxLengthFrom(firstChar: string): number {
    return this.longest.get(firstChar) ?? 0;
  }

  get(word: string): UserWord | undefined {
    return this.has(word) ? this.file.words[word] : undefined;
  }

  get size(): number {
    return Object.keys(this.file.words).length;
  }

  /** Adds a word (or changes its definition). */
  async add(word: string, definition = ''): Promise<void> {
    await this.load();
    this.file.words[word] = definition.trim() ? { added: today(), definition: definition.trim() } : { added: today() };
    await this.save();
  }

  async remove(word: string): Promise<void> {
    await this.load();
    if (!this.has(word)) return;
    delete this.file.words[word];
    await this.save();
  }

  private async save(): Promise<void> {
    this.file.revision++;
    this.changed();
    await writeText(userDictionaryPath(this.language), JSON.stringify(this.file, null, 2) + '\n');
  }

  private changed(): void {
    this.changes++;
    this.longest = new Map();
    for (const word of Object.keys(this.file.words)) {
      const first = String.fromCodePoint(word.codePointAt(0)!);
      this.longest.set(first, Math.max(this.longest.get(first) ?? 0, word.length));
    }
    this.listeners.forEach((l) => l());
  }
}

/** A dictionary's words and the reader's own, as one word list for a segmenter. */
export class WithUserWords implements WordList {
  constructor(
    private readonly base: WordList,
    private readonly user: UserDictionary,
  ) {}

  get revision(): number {
    // Both only ever go up, so the sum changes whenever either does.
    return this.base.revision + this.user.revision;
  }

  has(word: string): boolean {
    return this.user.has(word) || this.base.has(word);
  }

  maxLengthFrom(firstChar: string): number {
    return Math.max(this.base.maxLengthFrom(firstChar), this.user.maxLengthFrom(firstChar));
  }
}
