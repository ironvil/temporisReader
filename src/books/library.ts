/**
 * Book storage. Layout in the app data directory:
 *   library.json              BookMeta[] (titles, progress…)
 *   books/<id>/source.<ext>   original file text, kept so the index can be rebuilt when parsing improves
 *   books/<id>/content.txt    normalised text, one paragraph per line
 *   books/<id>/index.json     BookIndex: paragraph offsets, headings, chapters
 */
import { detectLanguage } from '../languages';
import { readJson, readText, removeDir, writeJson, writeText } from '../storage';
import { decodeText, formatFromFileName, parseBook, PARSER_VERSION, type BookFormat, type Chapter, type ParsedBook } from './parse';

export interface Progress {
  chapter: number;
  /** Paragraph index within the chapter. */
  paragraph: number;
  /** Word index within the paragraph (word-like segments only). */
  word: number;
  /** Character offset within the paragraph; used for exact restore. */
  char: number;
  /** 0..1 through the whole book. */
  fraction: number;
  updatedAt: number;
}

export interface BookIndex {
  version: number;
  /** Start offset of each paragraph in content.txt. */
  paragraphOffsets: number[];
  headings: number[];
  chapters: Chapter[];
}

export interface BookMeta {
  id: string;
  title: string;
  fileName: string;
  format: BookFormat;
  language: string | null;
  addedAt: number;
  lastOpenedAt: number | null;
  chapterCount: number;
  paragraphCount: number;
  progress: Progress | null;
}

export interface OpenBook {
  meta: BookMeta;
  index: BookIndex;
  content: string;
  paragraph(i: number): string;
  isHeading(i: number): boolean;
}

const LIBRARY_FILE = 'library.json';
const dir = (id: string) => `books/${id}`;

let books: BookMeta[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<BookMeta[]> {
  books ??= (await readJson<BookMeta[]>(LIBRARY_FILE)) ?? [];
  return books;
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(books ?? []);
  writeChain = writeChain.then(() => writeText(LIBRARY_FILE, snapshot)).catch((err) => console.error('Saving library failed', err));
  return writeChain;
}

export async function listBooks(): Promise<BookMeta[]> {
  const all = await load();
  return [...all].sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
}

export function buildIndex(parsed: ParsedBook): { content: string; index: BookIndex } {
  const paragraphOffsets: number[] = [];
  let offset = 0;
  for (const p of parsed.paragraphs) {
    paragraphOffsets.push(offset);
    offset += p.length + 1;
  }
  return {
    content: parsed.paragraphs.join('\n'),
    index: { version: PARSER_VERSION, paragraphOffsets, headings: parsed.headings, chapters: parsed.chapters },
  };
}

function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const titleFromFileName = (name: string) => name.replace(/\.[^.]+$/, '');

export async function importBook(file: File): Promise<BookMeta> {
  const format = formatFromFileName(file.name);
  if (!format) throw new Error('Only .txt and .md files are supported');

  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  const parsed = parseBook(text, format, titleFromFileName(file.name));
  if (!parsed.paragraphs.length) throw new Error('That file has no readable text');

  const id = newId();
  const { content, index } = buildIndex(parsed);
  await writeText(`${dir(id)}/source.${format}`, text);
  await writeText(`${dir(id)}/content.txt`, content);
  await writeJson(`${dir(id)}/index.json`, index);

  const meta: BookMeta = {
    id,
    title: parsed.title ?? titleFromFileName(file.name),
    fileName: file.name,
    format,
    language: detectLanguage(content.slice(0, 5000)),
    addedAt: Date.now(),
    lastOpenedAt: null,
    chapterCount: index.chapters.length,
    paragraphCount: parsed.paragraphs.length,
    progress: null,
  };
  (await load()).push(meta);
  await persist();
  return meta;
}

export async function openBook(id: string): Promise<OpenBook> {
  const meta = (await load()).find((b) => b.id === id);
  if (!meta) throw new Error('Book not found');

  let index = await readJson<BookIndex>(`${dir(id)}/index.json`);
  let content = await readText(`${dir(id)}/content.txt`);

  if (!index || index.version !== PARSER_VERSION || content === null) {
    // Parsing rules changed (or files are damaged): rebuild from the original source.
    const source = await readText(`${dir(id)}/source.${meta.format}`);
    if (source === null) throw new Error('This book’s files are missing');
    const rebuilt = buildIndex(parseBook(source, meta.format, titleFromFileName(meta.fileName)));
    ({ index, content } = rebuilt);
    await writeText(`${dir(id)}/content.txt`, content);
    await writeJson(`${dir(id)}/index.json`, index);
    meta.chapterCount = index.chapters.length;
    meta.paragraphCount = index.paragraphOffsets.length;
  }

  meta.lastOpenedAt = Date.now();
  void persist();

  const { paragraphOffsets } = index;
  const headingSet = new Set(index.headings);
  const text = content;
  return {
    meta,
    index,
    content: text,
    paragraph: (i) => text.slice(paragraphOffsets[i], i + 1 < paragraphOffsets.length ? paragraphOffsets[i + 1] - 1 : text.length),
    isHeading: (i) => headingSet.has(i),
  };
}

export async function saveProgress(id: string, progress: Progress): Promise<void> {
  const meta = (await load()).find((b) => b.id === id);
  if (!meta) return;
  meta.progress = progress;
  await persist();
}

export async function deleteBook(id: string): Promise<void> {
  books = (await load()).filter((b) => b.id !== id);
  await persist();
  await removeDir(dir(id));
}
