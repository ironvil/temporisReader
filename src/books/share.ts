/**
 * Sharing books made in the editor ("Create a book"): a `.temporis.json` file with the book's id,
 * title, language, dates and every chapter's own text (as written: .txt or .md). Importing it
 * on another phone keeps the id, so importing a newer version later offers to replace that book.
 * Reading progress isn't shared.
 */
import type { BookFormat } from '@temporis/book-parser';

export const SHARE_APP = 'temporis-reader';
export const SHARE_KIND = 'book';
export const SHARE_VERSION = 1;
export const SHARE_EXTENSION = '.temporis.json';

export interface SharedChapter {
  /** The chapter's id in the book: progress follows it when chapters are reordered or edited. */
  id: string;
  title: string;
  format: BookFormat;
  /** File the chapter was added from, or null for pasted text. */
  fileName: string | null;
  /** Split into chapters at its headings (added as a whole file) instead of being one chapter. */
  split: boolean;
  text: string;
}

export interface SharedBook {
  app: typeof SHARE_APP;
  kind: typeof SHARE_KIND;
  version: number;
  /** The book's id: the same on every phone it's shared to. */
  id: string;
  title: string;
  language: string | null;
  /** The language was picked by hand (not detected). */
  languageChosen: boolean;
  /** ISO dates. */
  createdAt: string;
  modifiedAt: string;
  appVersion: string;
  chapters: SharedChapter[];
}

/** Ids name folders in app storage: anything else gets a new one on import. */
export const isSafeId = (id: string) => /^[A-Za-z0-9_-]{8,80}$/.test(id);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Cheap check before parsing: does this file claim to be a shared book? */
export function looksLikeSharedBook(name: string, bytes: Uint8Array): boolean {
  if (name.toLowerCase().endsWith('.json')) return true;
  const head = new TextDecoder().decode(bytes.subarray(0, 200)).replace(/^﻿/, '').trimStart();
  return head.startsWith('{') && head.includes(SHARE_APP);
}

/** Parses and checks a shared book. Throws a readable error if it isn't one the app can import. */
export function parseSharedBook(text: string): SharedBook {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('Not a Temporis book file (not JSON)');
  }
  if (!isObject(data) || data.app !== SHARE_APP || data.kind !== SHARE_KIND) throw new Error('Not a Temporis book file');
  if (typeof data.version !== 'number' || data.version > SHARE_VERSION) throw new Error('This book was shared from a newer version of the app: update the app to import it');
  if (typeof data.id !== 'string' || typeof data.title !== 'string' || !Array.isArray(data.chapters)) throw new Error('The book file is damaged');
  const chapters: SharedChapter[] = [];
  const ids = new Set<string>();
  for (const c of data.chapters as unknown[]) {
    if (!isObject(c) || typeof c.title !== 'string' || typeof c.text !== 'string' || (c.format !== 'txt' && c.format !== 'md')) throw new Error('The book file is damaged');
    // Chapter ids name files: a missing, unsafe or repeated one gets a new id.
    let id = typeof c.id === 'string' && isSafeId(c.id) && !ids.has(c.id) ? c.id : '';
    if (!id) id = crypto.randomUUID();
    ids.add(id);
    chapters.push({ id, title: c.title, format: c.format, fileName: typeof c.fileName === 'string' ? c.fileName : null, split: c.split === true, text: c.text });
  }
  const date = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : new Date(0).toISOString());
  return {
    app: SHARE_APP,
    kind: SHARE_KIND,
    version: data.version,
    id: data.id,
    title: data.title.trim() || 'Untitled book',
    language: typeof data.language === 'string' ? data.language : null,
    languageChosen: data.languageChosen === true,
    createdAt: date(data.createdAt),
    modifiedAt: date(data.modifiedAt),
    appVersion: typeof data.appVersion === 'string' ? data.appVersion : '',
    chapters,
  };
}

/** A file name for the book: its title, made safe for file systems. */
export function shareFileName(title: string, extension: string): string {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'book';
  return safe + extension;
}
