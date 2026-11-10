/**
 * Book storage. A book is an ordered list of sources (imported files or pasted text); the reader
 * reads a combined index built from them. Layout in the app data directory:
 *   library.json                    BookMeta[] (titles, sources, progress…)
 *   books/<id>/sources/<sid>.<ext>  original text of each source
 *   books/<id>/content.txt          combined normalised text, one paragraph per line
 *   books/<id>/index.json           BookIndex: paragraph offsets, headings, marks, chapters
 *
 * A source either becomes exactly one chapter (chapters added in the editor) or is split into
 * chapters at its headings (whole books imported from one file).
 */
import { detectLanguage } from '../languages';
import { readJson, readText, removeDir, removeFile, writeJson, writeText } from '../storage';
import { decodeText, formatFromFileName, parseBook, PARSER_VERSION, type BookFormat, type Chapter, type InlineMark, type ParsedBook } from './parse';

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
  /** Source and chapter-within-source, so progress survives reordering chapters. */
  source?: string;
  sourceChapter?: number;
}

export interface BookChapter extends Chapter {
  /** Source this chapter came from, and its index among that source's chapters. */
  source: string;
  sourceChapter: number;
}

export interface BookIndex {
  version: number;
  /** Start offset of each paragraph in content.txt. */
  paragraphOffsets: number[];
  headings: number[];
  /** Bold/italic ranges for paragraphs that have any. */
  marks: Record<number, InlineMark[]>;
  chapters: BookChapter[];
}

export interface SourceMeta {
  id: string;
  title: string;
  format: BookFormat;
  /** Original file name, or null for pasted text. */
  fileName: string | null;
  /** Split into chapters at headings (imported books) instead of being one chapter. */
  split: boolean;
  /** Path relative to the book directory. */
  path: string;
  /** Filled in when the index is built. */
  chapterCount: number;
  paragraphCount: number;
}

export interface BookMeta {
  id: string;
  title: string;
  language: string | null;
  addedAt: number;
  lastOpenedAt: number | null;
  sources: SourceMeta[];
  chapterCount: number;
  paragraphCount: number;
  progress: Progress | null;
}

export interface OpenBook {
  meta: BookMeta;
  index: BookIndex;
  content: string;
  paragraph(i: number): string;
  marks(i: number): InlineMark[];
  isHeading(i: number): boolean;
}

export interface NewChapter {
  title: string;
  text: string;
  format: BookFormat;
  fileName?: string | null;
  /** Split into chapters at its headings (a whole book in one file) instead of one chapter. */
  split?: boolean;
}

/** Books stored before multi-source support. */
interface LegacyBookMeta extends Omit<BookMeta, 'sources'> {
  sources?: SourceMeta[];
  fileName?: string;
  format?: BookFormat;
}

const LIBRARY_FILE = 'library.json';
const dir = (id: string) => `books/${id}`;

let books: BookMeta[] | null = null;
let writeChain: Promise<void> = Promise.resolve();
const bookQueues = new Map<string, Promise<unknown>>();

async function load(): Promise<BookMeta[]> {
  books ??= ((await readJson<LegacyBookMeta[]>(LIBRARY_FILE)) ?? []).map(migrate);
  return books;
}

function migrate(book: LegacyBookMeta): BookMeta {
  if (book.sources) return book as BookMeta;
  const { fileName, format = 'txt', ...rest } = book;
  return {
    ...rest,
    sources: [
      {
        id: 'source',
        title: book.title,
        format,
        fileName: fileName ?? null,
        split: true,
        path: `source.${format}`,
        chapterCount: book.chapterCount,
        paragraphCount: book.paragraphCount,
      },
    ],
  };
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(books ?? []);
  writeChain = writeChain.then(() => writeText(LIBRARY_FILE, snapshot)).catch((err) => console.error('Saving library failed', err));
  return writeChain;
}

/** Runs edits to one book one at a time (rapid reorder taps must not interleave rebuilds). */
function serial<T>(bookId: string, task: () => Promise<T>): Promise<T> {
  const run = (bookQueues.get(bookId) ?? Promise.resolve()).then(task, task);
  bookQueues.set(bookId, run.catch(() => undefined));
  return run;
}

async function find(id: string): Promise<BookMeta> {
  const meta = (await load()).find((b) => b.id === id);
  if (!meta) throw new Error('Book not found');
  return meta;
}

export async function listBooks(): Promise<BookMeta[]> {
  const all = await load();
  return [...all].sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
}

export async function getBook(id: string): Promise<BookMeta> {
  return find(id);
}

function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const titleFromFileName = (name: string) => name.replace(/\.[^.]+$/, '');

/** Parses each source and concatenates them into one book index. */
export function assembleBook(parts: { source: SourceMeta; parsed: ParsedBook }[]): { content: string; index: BookIndex } {
  const paragraphs: string[] = [];
  const headings: number[] = [];
  const marks: Record<number, InlineMark[]> = {};
  const chapters: BookChapter[] = [];

  for (const { source, parsed } of parts) {
    const base = paragraphs.length;
    const n = parsed.paragraphs.length;
    source.paragraphCount = n;
    if (!n) {
      source.chapterCount = 0;
      continue;
    }
    paragraphs.push(...parsed.paragraphs);
    headings.push(...parsed.headings.map((h) => h + base));
    for (const [p, m] of Object.entries(parsed.marks)) marks[Number(p) + base] = m;

    const own: Chapter[] = source.split ? parsed.chapters : [{ title: source.title, start: 0, end: n }];
    own.forEach((c, i) => chapters.push({ title: c.title, start: c.start + base, end: c.end + base, source: source.id, sourceChapter: i }));
    source.chapterCount = own.length;
  }

  const paragraphOffsets: number[] = [];
  let offset = 0;
  for (const p of paragraphs) {
    paragraphOffsets.push(offset);
    offset += p.length + 1;
  }
  return {
    content: paragraphs.join('\n'),
    index: { version: PARSER_VERSION, paragraphOffsets, headings, marks, chapters },
  };
}

/** Rebuilds content.txt and index.json from the sources, and keeps progress on the same chapter. */
async function rebuild(meta: BookMeta): Promise<{ content: string; index: BookIndex }> {
  const parts = await Promise.all(
    meta.sources.map(async (source) => {
      const text = await readText(`${dir(meta.id)}/${source.path}`);
      if (text === null) throw new Error(`The text for “${source.title}” is missing`);
      return { source, parsed: parseBook(text, source.format, source.title) };
    }),
  );
  const built = assembleBook(parts);
  await writeText(`${dir(meta.id)}/content.txt`, built.content);
  await writeJson(`${dir(meta.id)}/index.json`, built.index);

  meta.chapterCount = built.index.chapters.length;
  meta.paragraphCount = built.index.paragraphOffsets.length;
  meta.language = detectLanguage(built.content.slice(0, 5000));
  meta.progress = remapProgress(meta.progress, built);
  await persist();
  return built;
}

function remapProgress(progress: Progress | null, { content, index }: { content: string; index: BookIndex }): Progress | null {
  if (!progress || !index.chapters.length) return null;
  let chapter = index.chapters.findIndex((c) => c.source === progress.source && c.sourceChapter === progress.sourceChapter);
  let { paragraph, word, char } = progress;
  if (chapter < 0) {
    chapter = Math.min(progress.chapter, index.chapters.length - 1);
    // Progress saved before chapters were tracked by source keeps its place; otherwise the
    // chapter was deleted, so start at the beginning of the chapter now in its position.
    if (progress.source !== undefined) paragraph = word = char = 0;
  }
  const c = index.chapters[chapter];
  paragraph = Math.min(paragraph, c.end - c.start - 1);
  const offset = index.paragraphOffsets[c.start + paragraph] + char;
  return {
    ...progress,
    chapter,
    paragraph,
    word,
    char,
    source: c.source,
    sourceChapter: c.sourceChapter,
    fraction: Math.min(1, offset / Math.max(1, content.length)),
  };
}

export async function readFileText(file: File): Promise<{ text: string; format: BookFormat }> {
  const format = formatFromFileName(file.name);
  if (!format) throw new Error('Only .txt and .md files are supported');
  return { text: decodeText(new Uint8Array(await file.arrayBuffer())), format };
}

async function writeSource(bookId: string, source: Omit<SourceMeta, 'path' | 'chapterCount' | 'paragraphCount'>, text: string): Promise<SourceMeta> {
  const path = `sources/${source.id}.${source.format}`;
  await writeText(`${dir(bookId)}/${path}`, text);
  return { ...source, path, chapterCount: 0, paragraphCount: 0 };
}

/** Imports a whole book from one file; chapters are detected from its headings. */
export async function importBook(file: File): Promise<BookMeta> {
  const { text, format } = await readFileText(file);
  const parsed = parseBook(text, format, titleFromFileName(file.name));
  if (!parsed.paragraphs.length) throw new Error('That file has no readable text');

  const id = newId();
  const title = parsed.title ?? titleFromFileName(file.name);
  const source = await writeSource(id, { id: newId(), title, format, fileName: file.name, split: true }, text);
  const meta: BookMeta = {
    id,
    title,
    language: null,
    addedAt: Date.now(),
    lastOpenedAt: null,
    sources: [source],
    chapterCount: 0,
    paragraphCount: 0,
    progress: null,
  };
  (await load()).push(meta);
  await rebuild(meta);
  return meta;
}

/** Creates an empty book; chapters are added in the editor. */
export async function createBook(title: string): Promise<BookMeta> {
  const meta: BookMeta = {
    id: newId(),
    title: title.trim() || 'Untitled book',
    language: null,
    addedAt: Date.now(),
    lastOpenedAt: null,
    sources: [],
    chapterCount: 0,
    paragraphCount: 0,
    progress: null,
  };
  (await load()).push(meta);
  await rebuild(meta);
  return meta;
}

/** Suggested chapter title: first heading in the text, else the file name. */
export function suggestChapterTitle(text: string, format: BookFormat, fileName?: string | null): string {
  const parsed = parseBook(text, format, '');
  if (parsed.headings.length && parsed.headings[0] === 0) return parsed.paragraphs[0];
  return fileName ? titleFromFileName(fileName) : '';
}

/** How many chapters `text` would add to a book. */
export function countChapters(text: string, format: BookFormat, split: boolean): number {
  const parsed = parseBook(text, format, '');
  if (!parsed.paragraphs.length) return 0;
  return split ? parsed.chapters.length : 1;
}

export function addChapter(bookId: string, chapter: NewChapter): Promise<void> {
  return serial(bookId, async () => {
    const meta = await find(bookId);
    const parsed = parseBook(chapter.text, chapter.format, '');
    if (!parsed.paragraphs.length) throw new Error('The chapter has no text');
    const split = chapter.split ?? false;
    const fromFile = chapter.fileName ? titleFromFileName(chapter.fileName) : '';
    const title =
      chapter.title.trim() ||
      (split ? parsed.title || fromFile || `Part ${meta.sources.length + 1}` : suggestChapterTitle(chapter.text, chapter.format, chapter.fileName) || `Chapter ${meta.chapterCount + 1}`);
    const source = await writeSource(bookId, { id: newId(), title, format: chapter.format, fileName: chapter.fileName ?? null, split }, chapter.text);
    meta.sources.push(source);
    await rebuild(meta);
  });
}

export async function addChapterFromFile(bookId: string, file: File, title = '', split = false): Promise<void> {
  const { text, format } = await readFileText(file);
  await addChapter(bookId, { title, text, format, fileName: file.name, split });
}

export function removeChapter(bookId: string, sourceId: string): Promise<void> {
  return serial(bookId, async () => {
    const meta = await find(bookId);
    const source = meta.sources.find((s) => s.id === sourceId);
    if (!source) return;
    meta.sources = meta.sources.filter((s) => s !== source);
    await rebuild(meta);
    await removeFile(`${dir(bookId)}/${source.path}`);
  });
}

export function moveChapter(bookId: string, sourceId: string, delta: number): Promise<void> {
  return serial(bookId, async () => {
    const meta = await find(bookId);
    const from = meta.sources.findIndex((s) => s.id === sourceId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= meta.sources.length) return;
    const [source] = meta.sources.splice(from, 1);
    meta.sources.splice(to, 0, source);
    await rebuild(meta);
  });
}

export function renameChapter(bookId: string, sourceId: string, title: string): Promise<void> {
  return serial(bookId, async () => {
    const meta = await find(bookId);
    const source = meta.sources.find((s) => s.id === sourceId);
    if (!source || !title.trim() || source.title === title.trim()) return;
    source.title = title.trim();
    await rebuild(meta);
  });
}

export function renameBook(bookId: string, title: string): Promise<void> {
  return serial(bookId, async () => {
    const meta = await find(bookId);
    if (!title.trim()) return;
    meta.title = title.trim();
    await persist();
  });
}

export async function openBook(id: string): Promise<OpenBook> {
  const meta = await find(id);
  let index = await readJson<BookIndex>(`${dir(id)}/index.json`);
  let content = await readText(`${dir(id)}/content.txt`);
  if (!index || index.version !== PARSER_VERSION || content === null) {
    // Parsing rules changed (or files are damaged): rebuild from the original sources.
    ({ index, content } = await serial(id, () => rebuild(meta)));
  }
  if (!index.chapters.length) throw new Error('This book has no chapters yet');

  meta.lastOpenedAt = Date.now();
  void persist();

  const { paragraphOffsets } = index;
  const markMap = index.marks;
  const headingSet = new Set(index.headings);
  const text = content;
  return {
    meta,
    index,
    content: text,
    paragraph: (i) => text.slice(paragraphOffsets[i], i + 1 < paragraphOffsets.length ? paragraphOffsets[i + 1] - 1 : text.length),
    marks: (i) => markMap[i] ?? [],
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
