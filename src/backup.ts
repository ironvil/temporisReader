/**
 * Whole-library backup: one JSON file with the library list (titles, chapters' sources, reading
 * progress), every book's source texts, known-word lists and settings. Derived files (content
 * indexes, word counts) are rebuilt on demand; dictionaries are re-downloaded.
 *
 * Linked files (EPUBs) aren't in the backup, only their reference and checksum: after restoring on
 * another phone, the reader asks for each one to be found again.
 */
import { listBooks, type BookMeta } from './books/library';
import { languages } from './languages';
import { getSettings, type Settings } from './settings';
import { readText, removeDir, writeJson, writeText } from './storage';
import { parseKnownWords } from './vocab/known-words';

export const BACKUP_APP = 'temporis-reader';
export const BACKUP_VERSION = 1;

export interface Backup {
  app: typeof BACKUP_APP;
  backupVersion: number;
  createdAt: string;
  appVersion: string;
  settings: Partial<Settings>;
  library: BookMeta[];
  /** Path in app storage → text, for every book source. */
  files: Record<string, string>;
  /** Language id → known-words file text. */
  knownWords: Record<string, string>;
}

export async function createBackup(): Promise<Backup> {
  const library = await listBooks();
  const files: Record<string, string> = {};
  for (const book of library) {
    for (const source of book.sources) {
      if (source.file) continue;
      const path = `books/${book.id}/${source.path}`;
      const text = await readText(path);
      if (text === null) throw new Error(`The text of “${source.title}” in “${book.title}” is missing`);
      files[path] = text;
    }
  }
  const knownWords: Record<string, string> = {};
  for (const lang of languages) {
    const text = await readText(`known-words/${lang.id}.json`);
    if (text !== null) knownWords[lang.id] = text;
  }
  return {
    app: BACKUP_APP,
    backupVersion: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    settings: getSettings(),
    library,
    files,
    knownWords,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parses and checks a backup file. Throws a readable error if it isn't a usable backup. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a backup file (not JSON)');
  }
  if (!isObject(data) || data.app !== BACKUP_APP) throw new Error('Not a Temporis Reader backup');
  if (typeof data.backupVersion !== 'number' || data.backupVersion > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app');
  }
  if (!Array.isArray(data.library) || !isObject(data.files) || !isObject(data.knownWords)) throw new Error('The backup is incomplete');

  const files = data.files as Record<string, unknown>;
  for (const book of data.library as unknown[]) {
    if (!isObject(book) || typeof book.id !== 'string' || !Array.isArray(book.sources)) throw new Error('The backup’s library is damaged');
    for (const source of book.sources as unknown[]) {
      if (!isObject(source) || typeof source.path !== 'string') throw new Error('The backup’s library is damaged');
      if (isObject(source.file)) continue; // Linked file: only its reference is backed up.
      if (typeof files[`books/${book.id}/${source.path}`] !== 'string') throw new Error(`The backup is missing text for “${String(book.title)}”`);
    }
  }
  for (const text of Object.values(data.knownWords)) {
    if (typeof text !== 'string') throw new Error('The backup’s known words are damaged');
    parseKnownWords(text);
  }
  return data as unknown as Backup;
}

/** Replaces all books, progress, known words and settings with the backup's. Reload the app afterwards. */
export async function restoreBackup(backup: Backup): Promise<void> {
  await removeDir('books');
  await removeDir('derived');
  for (const [path, text] of Object.entries(backup.files)) {
    if (!path.startsWith('books/') || path.includes('..')) continue;
    await writeText(path, text);
  }
  // Force each book's content index to be rebuilt from its sources.
  await writeJson('library.json', backup.library.map((b) => ({ ...b, contentVersion: (b.contentVersion ?? 0) + 1 })));
  await removeDir('known-words');
  for (const [lang, text] of Object.entries(backup.knownWords)) await writeText(`known-words/${lang}.json`, text);
  await writeJson('settings.json', backup.settings ?? {});
}
