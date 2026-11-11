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
 *
 * EPUB sources are linked, not copied: only a reference to the file (uri, name, size, SHA-256) is
 * stored, and books with one are read from the file and indexed in memory each time they open.
 * A different checksum means the file was edited: the book is re-indexed and progress remapped.
 * So does a new parser (PARSER_VERSION), since it may find different chapters.
 */
import { detectLanguage, getLanguage } from '../languages';
import { readJson, readText, removeDir, removeFile, writeJson, writeText } from '../storage';
import { locateOffset } from '../reader/scrub';
import { parseEpubOffThread, type PartialRead } from './parse-off-thread';
import { LinkedFileError, linkWebFile, readLinkedFile, releaseLinkedFile, sha256, type LinkedFile, type PickedFile } from './linked-files';
import { assembleBook, decodeText, EpubError, formatFromFileName, parseBook, PARSER_VERSION, type EpubBook, type EpubLayout, type BookChapter, type BookFormat, type BookIndex, type InlineMark, type ParsedBook } from '@temporis/book-parser';

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

export type { BookChapter, BookIndex } from '@temporis/book-parser';

export type SourceFormat = BookFormat | 'epub';

export interface LinkedSource extends LinkedFile {
  /** SHA-256 (hex) of the file when it was last read; a different one means the file changed. */
  checksum: string;
  /** PARSER_VERSION the book was last indexed with (absent: indexed before versions were recorded). */
  parser?: number;
}

export interface SourceMeta {
  id: string;
  title: string;
  format: SourceFormat;
  /** Original file name, or null for pasted text. */
  fileName: string | null;
  /** Split into chapters at headings (imported books) instead of being one chapter. */
  split: boolean;
  /** Path relative to the book directory ('' for linked files). */
  path: string;
  /** Filled in when the index is built. */
  chapterCount: number;
  paragraphCount: number;
  /** Set for linked files (EPUBs), which are read where they are instead of being stored. */
  file?: LinkedSource;
}

export interface BookMeta {
  id: string;
  title: string;
  /** From the file's metadata (EPUB). */
  author?: string | null;
  language: string | null;
  addedAt: number;
  lastOpenedAt: number | null;
  sources: SourceMeta[];
  chapterCount: number;
  paragraphCount: number;
  progress: Progress | null;
  /** Bumped whenever the book's content index is rebuilt (invalidates derived caches). */
  contentVersion?: number;
  /** True once the user picked the language in the editor; detection then leaves it alone. */
  languageChosen?: boolean;
}

export interface OpenBook {
  meta: BookMeta;
  index: BookIndex;
  content: string;
  paragraph(i: number): string;
  marks(i: number): InlineMark[];
  isHeading(i: number): boolean;
  /** Names of linked files that changed since the book was last read (it was re-indexed). */
  changed: string[];
  /**
   * False while only some chapters are loaded (a big EPUB opens at its saved chapter first; the
   * rest is parsed in the background). Offsets and lengths are the whole book's even then.
   */
  complete: boolean;
  hasChapter(index: number): boolean;
  /**
   * Resolves when the whole book is loaded (this object is then complete): true if the chapters
   * are as expected, false if they turned out different (the book was re-indexed).
   */
  whenComplete: Promise<boolean>;
}

/** A book's linked file can't be read; the reader offers to find it again or remove the book. */
export class BookFileError extends Error {
  constructor(
    readonly bookId: string,
    readonly bookTitle: string,
    readonly source: SourceMeta,
    readonly problem: LinkedFileError['problem'],
    message: string,
  ) {
    super(message);
  }
}

/** The file picked to relink a book differs from the one it was imported from. */
export class DifferentFileError extends Error {
  constructor(readonly fileName: string) {
    super(`“${fileName}” isn’t the same file as the one this book was imported from`);
  }
}

export interface ImportResult {
  book: BookMeta;
  /** The file was already in the library; no new book was added. */
  duplicate: boolean;
  /** False when Android won't keep access to the file (it'll need finding again after a restart). */
  persisted: boolean;
}

export const isLinked = (meta: BookMeta) => meta.sources.some((s) => s.file);
export const isEpubFileName = (name: string) => /\.epub$/i.test(name);
/** ZIP local-file signature: every EPUB starts with it. */
const looksLikeZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

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

type Built = { content: string; index: BookIndex };

interface ReadSource {
  source: SourceMeta;
  parsed: ParsedBook;
  /** Language declared in the file (EPUB metadata), if any. */
  declared: string | null;
  changed: boolean;
  /** Indexed by an older parser: chapters may have moved, though the file is the same. */
  reparsed: boolean;
}

/** A linked file already read (and checksummed) by the caller. */
/** Linked files already read by the caller, with their parse under way (the bytes went to the worker). */
type Preread = Map<string, { checksum: string; size: number; book: Promise<EpubBook> }>;

/** Reads a linked source's file, as a BookFileError if it's gone. */
async function readSourceFile(meta: BookMeta, source: SourceMeta & { file: LinkedSource }): Promise<{ bytes: Uint8Array; checksum: string }> {
  try {
    const bytes = await readLinkedFile(source.file);
    return { bytes, checksum: await sha256(bytes) };
  } catch (err) {
    if (err instanceof LinkedFileError) throw new BookFileError(meta.id, meta.title, source, err.problem, err.message);
    throw err;
  }
}

/** Reads and parses one source: stored text, or a linked file (checked against its checksum). */
async function readSource(meta: BookMeta, source: SourceMeta, preread?: Preread): Promise<ReadSource> {
  if (!source.file) {
    const text = await readText(`${dir(meta.id)}/${source.path}`);
    if (text === null) throw new Error(`The text for “${source.title}” is missing`);
    return { source, parsed: parseBook(text, source.format as BookFormat, source.title), declared: null, changed: false, reparsed: false };
  }
  let file = preread?.get(source.id);
  if (!file) {
    const { bytes, checksum } = await readSourceFile(meta, source as SourceMeta & { file: LinkedSource });
    const size = bytes.length; // before the bytes go to the worker
    file = { checksum, size, book: parseEpubOffThread(bytes, source.title).book };
  }
  const { checksum, size } = file;
  const parsed = await file.book;
  const changed = checksum !== source.file.checksum;
  const reparsed = !changed && source.file.parser !== PARSER_VERSION;
  if (changed || reparsed) source.file = { ...source.file, checksum, size, parser: PARSER_VERSION };
  return { source, parsed, declared: parsed.language, changed, reparsed };
}

/** Supported language id for a declared language tag ("de-DE" → "de"), or null. */
function languageFromTag(tag: string | null): string | null {
  return tag ? (getLanguage(tag.toLowerCase().split(/[-_]/)[0])?.id ?? null) : null;
}

async function build(meta: BookMeta, preread?: Preread): Promise<{ built: Built; parts: ReadSource[] }> {
  const parts = await Promise.all(meta.sources.map((source) => readSource(meta, source, preread)));
  return { built: assembleBook(parts), parts };
}

// ── Layout: opening big linked books at one chapter ────────────────────────────────────────────

/**
 * The shape of a book with a linked file, without its text (books/<id>/layout.json): enough to
 * read just the chapter being read from the file, with the whole book's offsets, while the rest
 * is parsed in the background. Only valid for the same sources, files and parser version.
 */
interface BookLayout {
  version: number;
  sources: { id: string; title: string; split: boolean; checksum: string | null; start: number; epub: EpubLayout | null }[];
  chapters: BookChapter[];
  /** Offset in the content of each chapter's first paragraph. */
  chapterOffsets: number[];
  headings: number[];
  paragraphCount: number;
  contentLength: number;
}

const layoutPath = (id: string) => `${dir(id)}/layout.json`;

async function saveLayout(meta: BookMeta, built: Built, parts: ReadSource[]): Promise<void> {
  let start = 0;
  const layout: BookLayout = {
    version: PARSER_VERSION,
    sources: parts.map(({ source, parsed }) => {
      const entry = {
        id: source.id,
        title: source.title,
        split: source.split,
        checksum: source.file?.checksum ?? null,
        start,
        epub: (parsed as Partial<EpubBook>).layout ?? null,
      };
      start += parsed.paragraphs.length;
      return entry;
    }),
    chapters: built.index.chapters,
    chapterOffsets: built.index.chapters.map((c) => built.index.paragraphOffsets[c.start]),
    headings: built.index.headings,
    paragraphCount: built.index.paragraphOffsets.length,
    contentLength: built.content.length,
  };
  await writeJson(layoutPath(meta.id), layout);
}

function layoutMatches(meta: BookMeta, layout: BookLayout | null): layout is BookLayout {
  return (
    !!layout &&
    layout.version === PARSER_VERSION &&
    layout.sources.length === meta.sources.length &&
    meta.sources.every((s, i) => {
      const l = layout.sources[i];
      return l.id === s.id && l.title === s.title && l.split === s.split && l.checksum === (s.file?.checksum ?? null) && !!l.epub === !!s.file;
    })
  );
}

function toOpenBook(meta: BookMeta, index: BookIndex, content: string, changed: string[]): OpenBook {
  const { paragraphOffsets } = index;
  const markMap = index.marks;
  const headingSet = new Set(index.headings);
  return {
    meta,
    index,
    content,
    paragraph: (i) => content.slice(paragraphOffsets[i], i + 1 < paragraphOffsets.length ? paragraphOffsets[i + 1] - 1 : content.length),
    marks: (i) => markMap[i] ?? [],
    isHeading: (i) => headingSet.has(i),
    changed,
    complete: true,
    hasChapter: () => true,
    whenComplete: Promise.resolve(true),
  };
}

/**
 * Reads only chapters `wanted` of a book whose files are unchanged since its layout was saved,
 * as a book with the whole book's offsets. Null if the layout doesn't fit.
 */
async function readPartial(meta: BookMeta, layout: BookLayout, partials: Map<number, PartialRead>, wanted: number[]): Promise<OpenBook | null> {
  const paragraphs = new Map<number, string>();
  const marks: Record<number, InlineMark[]> = {};
  for (const c of wanted) {
    const chapter = layout.chapters[c];
    const source = layout.sources.find((s) => s.id === chapter.source);
    const meta_ = meta.sources.find((s) => s.id === chapter.source);
    if (!source || !meta_) return null;
    const from = chapter.start - source.start;
    const to = chapter.end - source.start;
    let part: { paragraphs: string[]; marks: Record<number, InlineMark[]> };
    if (source.epub) {
      const read = partials.get(c);
      if (!read) return null;
      part = read;
    } else {
      const text = await readText(`${dir(meta.id)}/${meta_.path}`);
      if (text === null) return null;
      const parsed = parseBook(text, meta_.format as BookFormat, meta_.title);
      part = { paragraphs: parsed.paragraphs.slice(from, to), marks: {} };
      for (let p = from; p < to; p++) if (parsed.marks[p]) part.marks[p] = parsed.marks[p];
    }
    part.paragraphs.forEach((t, i) => paragraphs.set(chapter.start + i, t));
    for (const [p, m] of Object.entries(part.marks)) marks[Number(p) + source.start] = m;
  }

  // The whole book's offsets, with blanks of the right length standing in for chapters not read.
  const offsets = new Array<number>(layout.paragraphCount);
  const segments: string[] = [];
  for (let c = 0; c < layout.chapters.length; c++) {
    const { start, end } = layout.chapters[c];
    const offset = layout.chapterOffsets[c];
    const length = (layout.chapterOffsets[c + 1] ?? layout.contentLength + 1) - offset - 1;
    if (wanted.includes(c)) {
      let at = offset;
      for (let p = start; p < end; p++) {
        offsets[p] = at;
        at += paragraphs.get(p)!.length + 1;
      }
      const text = Array.from({ length: end - start }, (_, i) => paragraphs.get(start + i)!).join('\n');
      if (text.length !== length) return null;
      segments.push(text);
    } else {
      offsets.fill(offset, start, end);
      segments.push(' '.repeat(Math.max(0, length)));
    }
  }
  const content = segments.join('\n');
  if (content.length !== layout.contentLength) return null;
  const index: BookIndex = { version: PARSER_VERSION, paragraphOffsets: offsets, headings: layout.headings, marks, chapters: layout.chapters };
  const book = toOpenBook(meta, index, content, []);
  return { ...book, complete: false, hasChapter: (i) => wanted.includes(i) };
}

/**
 * Records a new index in the book's metadata: counts, language, progress (kept on the same chapter,
 * or with `samePlace`, at the same place in the text: the text is unchanged but chapters moved).
 */
async function applyBuild(meta: BookMeta, built: Built, parts: ReadSource[], samePlace = false): Promise<void> {
  meta.contentVersion = (meta.contentVersion ?? 0) + 1;
  meta.chapterCount = built.index.chapters.length;
  meta.paragraphCount = built.index.paragraphOffsets.length;
  if (!meta.languageChosen) {
    const declared = parts.map((p) => languageFromTag(p.declared)).find(Boolean);
    meta.language = declared ?? detectLanguage(built.content.slice(0, 5000));
  }
  meta.progress = samePlace ? relocateProgress(meta.progress, built) : remapProgress(meta.progress, built);
  await persist();
}

/**
 * Rebuilds the index from the sources, and keeps progress on the same chapter (or, with
 * `samePlace`, at the same place in the text). Books made only of
 * stored text cache it in content.txt and index.json; books with a linked file are never cached.
 */
async function rebuild(meta: BookMeta, samePlace = false): Promise<Built> {
  const { built, parts } = await build(meta);
  if (!isLinked(meta)) {
    await writeText(`${dir(meta.id)}/content.txt`, built.content);
    await writeJson(`${dir(meta.id)}/index.json`, built.index);
  } else {
    await removeFile(`${dir(meta.id)}/content.txt`);
    await removeFile(`${dir(meta.id)}/index.json`);
  }
  await applyBuild(meta, built, parts, samePlace);
  if (isLinked(meta)) await saveLayout(meta, built, parts);
  return built;
}

/** Progress at the same character of the text (from its fraction), in the new chapters. */
function relocateProgress(progress: Progress | null, { content, index }: { content: string; index: BookIndex }): Progress | null {
  if (!progress || !index.chapters.length) return null;
  const located = locateOffset(index, content.length, Math.round(progress.fraction * content.length));
  const c = index.chapters[located.chapter];
  return { ...progress, ...located, source: c.source, sourceChapter: c.sourceChapter };
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
  return importBookText(file.name, text, format);
}

async function importBookText(fileName: string, text: string, format: BookFormat): Promise<BookMeta> {
  const parsed = parseBook(text, format, titleFromFileName(fileName));
  if (!parsed.paragraphs.length) throw new Error('That file has no readable text');

  const id = newId();
  const title = parsed.title ?? titleFromFileName(fileName);
  const source = await writeSource(id, { id: newId(), title, format, fileName, split: true }, text);
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

/** Web: imports a file chosen with <input type=file>. EPUBs are linked, text files copied. */
export async function importWebFile(file: File): Promise<ImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isEpubFileName(file.name) || looksLikeZip(bytes)) return importEpub(await linkWebFile(file), bytes);
  if (!formatFromFileName(file.name)) throw new Error('Only .epub, .txt and .md files are supported');
  return { book: await importBook(file), duplicate: false, persisted: true };
}

/** Android: imports a file from the system picker. EPUBs stay linked; text files are copied and let go. */
export async function importPickedFile(picked: PickedFile): Promise<ImportResult> {
  let bytes: Uint8Array;
  try {
    bytes = await readLinkedFile(picked);
  } catch (err) {
    await releaseIfUnused(picked.uri);
    throw err;
  }
  if (isEpubFileName(picked.name) || looksLikeZip(bytes)) return importEpub(picked, bytes);
  try {
    const format = formatFromFileName(picked.name);
    if (!format) throw new Error('Only .epub, .txt and .md files are supported');
    return { book: await importBookText(picked.name, decodeText(bytes), format), duplicate: false, persisted: true };
  } finally {
    await releaseIfUnused(picked.uri);
  }
}

function findLinked(match: (file: LinkedSource) => boolean): { meta: BookMeta; source: SourceMeta } | null {
  for (const meta of books ?? []) {
    for (const source of meta.sources) if (source.file && match(source.file)) return { meta, source };
  }
  return null;
}

/** Gives up access to a linked file unless a book still uses it. */
async function releaseIfUnused(uri: string): Promise<void> {
  await load();
  if (!findLinked((f) => f.uri === uri)) await releaseLinkedFile(uri);
}

/** Lets go of a picked file that wasn't used (e.g. relinking was cancelled). */
export const forgetPickedFile = (uri: string) => releaseIfUnused(uri);

/**
 * Adds an EPUB as a linked book. Only metadata is stored; the file is read again on every open.
 * A file that is already in the library (same checksum) isn't added twice: if the existing book
 * can no longer find its file, it is pointed at this one instead.
 */
export async function importEpub(picked: PickedFile, bytes: Uint8Array): Promise<ImportResult> {
  const checksum = await sha256(bytes);
  const size = bytes.length;
  await load();
  const existing = findLinked((f) => f.checksum === checksum);
  if (existing) {
    const file = existing.source.file!;
    if (file.uri !== picked.uri && !(await readLinkedFile(file).then(() => true, () => false))) {
      const old = file.uri;
      existing.source.file = { uri: picked.uri, name: picked.name, size: bytes.length, checksum, parser: PARSER_VERSION };
      existing.source.fileName = picked.name;
      await persist();
      await releaseIfUnused(old);
    } else await releaseIfUnused(picked.uri);
    return { book: existing.meta, duplicate: true, persisted: picked.persisted };
  }

  let parsed;
  try {
    // The bytes go to the worker (and aren't usable here after).
    parsed = await parseEpubOffThread(bytes, titleFromFileName(picked.name)).book;
  } catch (err) {
    await releaseIfUnused(picked.uri);
    throw err instanceof EpubError ? err : new Error('That EPUB couldn’t be read');
  }
  const source: SourceMeta = {
    id: newId(),
    title: parsed.title,
    format: 'epub',
    fileName: picked.name,
    split: true,
    path: '',
    chapterCount: 0,
    paragraphCount: 0,
    file: { uri: picked.uri, name: picked.name, size, checksum, parser: PARSER_VERSION },
  };
  const meta: BookMeta = {
    id: newId(),
    title: parsed.title,
    author: parsed.author,
    language: null,
    addedAt: Date.now(),
    lastOpenedAt: null,
    sources: [source],
    chapterCount: 0,
    paragraphCount: 0,
    progress: null,
  };
  const parts = [{ source, parsed, declared: parsed.language, changed: false, reparsed: false }];
  (await load()).push(meta);
  const built = assembleBook(parts);
  await applyBuild(meta, built, parts);
  await saveLayout(meta, built, parts);
  return { book: meta, duplicate: false, persisted: picked.persisted };
}

/**
 * Points a book's linked file at a newly picked one (it was moved, or access was lost). A file with
 * different contents is refused with DifferentFileError unless `allowDifferent`; it is then
 * re-indexed on the next open like any edited file, keeping the reading position by chapter.
 */
export function relinkSource(bookId: string, sourceId: string, picked: PickedFile, allowDifferent = false): Promise<void> {
  return serial(bookId, async () => {
    const meta = await find(bookId);
    const source = meta.sources.find((s) => s.id === sourceId);
    if (!source?.file) throw new Error('Book not found');
    const bytes = await readLinkedFile(picked);
    if (!allowDifferent && (await sha256(bytes)) !== source.file.checksum) throw new DifferentFileError(picked.name);
    try {
      await parseEpubOffThread(bytes, source.title).book;
    } catch (err) {
      throw err instanceof EpubError ? err : new Error('That EPUB couldn’t be read');
    }
    const old = source.file.uri;
    // The old checksum stays, so the next open notices a changed file and re-indexes it.
    source.file = { uri: picked.uri, name: picked.name, size: source.file.size, checksum: source.file.checksum, parser: source.file.parser };
    source.fileName = picked.name;
    await persist();
    if (old !== picked.uri) await releaseIfUnused(old);
  });
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
    if (source.file) await releaseIfUnused(source.file.uri);
    else await removeFile(`${dir(bookId)}/${source.path}`);
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

/** Sets the book's language (null = not supported / none) and stops auto-detection from changing it. */
export function setBookLanguage(bookId: string, language: string | null): Promise<void> {
  return serial(bookId, async () => {
    const meta = await find(bookId);
    meta.language = language;
    meta.languageChosen = true;
    await persist();
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

/** Opens a book for reading (marks it as last opened). */
export async function openBook(id: string): Promise<OpenBook> {
  const meta = await find(id);
  let book: OpenBook | null = null;
  if (isLinked(meta)) {
    const quick = await openQuickly(meta);
    book = quick.book;
    if (!book) {
      const { built, changed } = await loadLinked(meta, quick.preread);
      if (!built.index.chapters.length) throw new Error('This book has no chapters yet');
      book = toOpenBook(meta, built.index, built.content, changed);
    }
  } else book = await loadBook(id);
  book.meta.lastOpenedAt = Date.now();
  void persist();
  return book;
}

/** Reads and indexes a book with a linked file; a changed file is re-indexed and listed in `changed`. */
function loadLinked(meta: BookMeta, preread?: Preread, layoutValid = false): Promise<{ built: Built; changed: string[] }> {
  return serial(meta.id, async () => {
    const { built, parts } = await build(meta, preread);
    const changed = parts.filter((p) => p.changed).map((p) => p.source.file!.name);
    if (changed.length) await applyBuild(meta, built, parts);
    else if (parts.some((p) => p.reparsed)) await applyBuild(meta, built, parts, true);
    if (changed.length || !layoutValid) await saveLayout(meta, built, parts);
    return { built, changed };
  });
}

/**
 * Loads a book's content and index without counting as opening it. Books with a linked file read
 * it again (throwing BookFileError if it's gone); a changed file is re-indexed and listed in `changed`.
 */
export async function loadBook(id: string): Promise<OpenBook> {
  const meta = await find(id);
  let index: BookIndex | null;
  let content: string | null;
  let changed: string[] = [];
  if (isLinked(meta)) {
    const layoutValid = layoutMatches(meta, await readJson<BookLayout>(layoutPath(id)));
    ({ built: { index, content }, changed } = await loadLinked(meta, undefined, layoutValid));
  } else {
    index = await readJson<BookIndex>(`${dir(id)}/index.json`);
    content = await readText(`${dir(id)}/content.txt`);
    if (!index || index.version !== PARSER_VERSION || content === null) {
      // Parsing rules changed (or files are damaged): rebuild from the original sources.
      // A new parser may move chapters, so the place in the text is what's kept.
      const reparsed = !!index && index.version !== PARSER_VERSION;
      ({ index, content } = await serial(id, () => rebuild(meta, reparsed)));
    }
  }
  if (!index.chapters.length) throw new Error('This book has no chapters yet');
  return toOpenBook(meta, index, content, changed);
}

/**
 * A book with a linked file whose layout is still valid opens at its saved chapter (and the ones
 * either side) straight away; the rest is parsed in the background (off the main thread) and
 * filled in to the same object. Null when that isn't possible (no layout, the file changed…).
 */
async function openQuickly(meta: BookMeta): Promise<{ book: OpenBook | null; preread: Preread }> {
  const preread: Preread = new Map();
  const stored = await readJson<BookLayout>(layoutPath(meta.id));
  const layout = layoutMatches(meta, stored) && stored.chapters.length ? stored : null;
  const saved = meta.progress;
  const current = layout && saved && saved.chapter < layout.chapters.length ? saved.chapter : 0;
  const wanted = layout ? [current - 1, current, current + 1].filter((c) => c >= 0 && c < layout.chapters.length) : [];

  // Each linked file is read once and handed to the worker, which reads the wanted chapters from
  // their own documents first (for an unchanged file), then parses the whole book.
  const partials = new Map<number, PartialRead>();
  const reads: Promise<void>[] = [];
  let unchanged = true;
  for (const source of meta.sources) {
    if (!source.file) continue;
    const { bytes, checksum } = await readSourceFile(meta, source as SourceMeta & { file: LinkedSource });
    const fits = !!layout && checksum === source.file.checksum;
    unchanged &&= fits;
    const entry = fits ? layout!.sources.find((s) => s.id === source.id) : undefined;
    const mine = wanted.filter((c) => layout!.chapters[c].source === source.id);
    const read =
      entry?.epub && mine.length
        ? { layout: entry.epub, ranges: mine.map((c): [number, number] => [layout!.chapters[c].start - entry.start, layout!.chapters[c].end - entry.start]) }
        : undefined;
    const job = parseEpubOffThread(bytes, source.title, read);
    preread.set(source.id, { checksum, size: bytes.byteLength, book: job.book });
    if (job.partial) reads.push(job.partial.then((parts) => parts.forEach((part, i) => partials.set(mine[i], part))));
  }
  if (!layout || !unchanged) return { book: null, preread };

  let book: OpenBook | null = null;
  try {
    await Promise.all(reads);
    book = await readPartial(meta, layout, partials, wanted);
  } catch {
    // The file doesn't match its layout after all: wait for the full parse.
  }
  if (!book) return { book: null, preread };

  const partial = book;
  partial.whenComplete = loadLinked(meta, preread, true).then(({ built, changed }) => {
    const same = built.content.length === layout.contentLength && built.index.chapters.length === layout.chapters.length;
    Object.assign(partial, toOpenBook(meta, built.index, built.content, changed), { whenComplete: partial.whenComplete });
    return same;
  });
  // Nobody may wait for it; a failure shows when something does.
  partial.whenComplete.catch(() => undefined);
  return { book: partial, preread };
}

export async function saveProgress(id: string, progress: Progress): Promise<void> {
  const meta = (await load()).find((b) => b.id === id);
  if (!meta) return;
  meta.progress = progress;
  await persist();
}

export async function deleteBook(id: string): Promise<void> {
  const removed = (await load()).find((b) => b.id === id);
  books = (await load()).filter((b) => b.id !== id);
  await persist();
  await removeDir(dir(id));
  for (const source of removed?.sources ?? []) if (source.file) await releaseIfUnused(source.file.uri);
}
