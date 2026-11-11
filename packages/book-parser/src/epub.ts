/**
 * EPUB (2 and 3) → the same flat paragraph model as .txt/.md (see parse.ts). Pure apart from
 * DecompressionStream/TextDecoder, so it runs in Node unit tests.
 *
 * - Text comes from the spine's XHTML documents in reading order; non-linear items are skipped.
 *   Project Gutenberg's English header and licence are cut at their "*** START/END OF THE PROJECT
 *   GUTENBERG EBOOK" lines (in EPUBs made from .txt, the header file also holds the book's opening).
 * - Block elements and <br> end paragraphs; h1–h6 are headings; i/em/cite and b/strong (and
 *   Calibre's class="italic"/"bold" spans) become marks. Blank paragraphs (&nbsp; spacers) are dropped.
 * - Contents lists in the text (3+ paragraphs in a row that are only links into the book, with a
 *   "Contents" heading before them) are left out: the chapter list covers them.
 * - Chapters follow the table of contents (EPUB 3 nav, else EPUB 2 NCX). Entries that land on the
 *   same place, or only have headings between them ("I" then "Marseille.—L'arrivée."), become one
 *   chapter with both titles. A chapter's opening paragraph that matches its TOC title is a heading
 *   even when the book styles it as a plain <p>.
 * - Without a usable TOC, chapters come from h1–h6 headings. Books with neither (Project Gutenberg
 *   EPUBs made from a .txt file) get headings from short paragraphs set off with a large top margin
 *   (Ebookmaker's mark for a heading after blank lines) or that read like one ("Chapter 12", "第十二章").
 *   Consecutive heading lines make one chapter title: "Erster Teil · Von dem Raume".
 */
import { decodeText, isTxtHeading, type InlineMark, type MarkKind, type ParsedBook } from './parse';
import { attr, tokenize } from './xml';
import { ZipArchive, ZipError } from './zip';

export class EpubError extends Error {}

/**
 * Where each paragraph of a parsed EPUB came from, so a chapter can be read again from just its
 * own spine documents (readEpubParagraphs) without parsing the whole book. Holds no text.
 */
export interface EpubLayout {
  /** Spine documents that kept paragraphs, in reading order. */
  docs: {
    path: string;
    /** Index of the document's first paragraph in the book. */
    start: number;
    /** Ranges [from, to) of the document's candidate paragraphs that were kept. */
    kept: [number, number][];
  }[];
  headings: number[];
  paragraphCount: number;
}

export interface EpubBook extends ParsedBook {
  title: string;
  author: string | null;
  layout: EpubLayout;
  /** dc:language as written (e.g. "fr", "de-DE"), if any. */
  language: string | null;
}

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
}

/** Project Gutenberg's boilerplate (English header and licence) ends and starts at these lines. */
const GUTENBERG_START = /^\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG E-?BOOK/i;
const GUTENBERG_END = /^\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG E-?BOOK/i;

/** A contents list in the text: at least this many link-only paragraphs in a row… */
const MIN_CONTENTS_LINKS = 3;
/** …and the heading in front of it, which goes with it. */
const CONTENTS_HEADING = /^(table of contents|contents|inhalt|inhaltsverzeichnis|table des matières|table|sommaire|índice|indice|目\s*[录錄次])\.?$/iu;

interface Frame {
  name: string;
  kinds: MarkKind[];
  link: boolean;
  spaced: boolean;
}

const SKIP = new Set(['head', 'script', 'style', 'rt', 'rp', 'svg', 'math', 'noscript', 'template']);
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'blockquote', 'pre', 'ul', 'ol', 'li', 'dl', 'dt',
  'dd', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'caption', 'figure', 'figcaption', 'hr', 'body', 'address', 'center', 'hgroup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);
const HEADING = /^h[1-6]$/;
const STYLE: Record<string, MarkKind> = { i: 'i', em: 'i', cite: 'i', dfn: 'i', var: 'i', b: 'b', strong: 'b' };
/** Classes that mean bold/italic (Calibre conversions use these instead of <i>/<b>). */
const CLASS_STYLE: Record<string, MarkKind> = { italic: 'i', italics: 'i', bold: 'b' };

function stylesOf(name: string, attrs: Record<string, string>): MarkKind[] {
  const kinds: MarkKind[] = [];
  if (STYLE[name]) kinds.push(STYLE[name]);
  for (const c of (attrs.class ?? '').toLowerCase().split(/\s+/)) {
    const kind = CLASS_STYLE[c];
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/** `margin-top` of 2em or more (Ebookmaker puts 3em/4em on headings converted from .txt). */
function largeTopMargin(style: string | undefined): boolean {
  const m = style && /margin-top\s*:\s*([\d.]+)\s*(em|rem)/i.exec(style);
  return !!m && parseFloat(m[1]) >= 2;
}

/** A link to another place in the book (not a web address). */
const isInternalLink = (href: string | undefined) => !!href && !/^[a-z][a-z0-9+.-]*:/i.test(href);

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;
const XML_SPACE = /[ \t\r\n\f]/;

const utf8 = (bytes: Uint8Array) => decodeText(bytes);

function openArchive(bytes: Uint8Array): { zip: ZipArchive; read: (path: string) => Promise<string> } {
  let zip: ZipArchive;
  try {
    zip = new ZipArchive(bytes);
  } catch {
    throw new EpubError('That file isn’t a valid EPUB');
  }
  const read = async (path: string) => {
    try {
      return utf8(await zip.read(path));
    } catch (err) {
      throw new EpubError(err instanceof ZipError ? `The EPUB is damaged (${err.message})` : 'The EPUB is damaged');
    }
  };
  return { zip, read };
}

export async function parseEpub(bytes: Uint8Array, fallbackTitle: string): Promise<EpubBook> {
  const { zip, read } = openArchive(bytes);

  if (zip.has('META-INF/rights.xml')) throw new EpubError('This EPUB is DRM-protected and can’t be opened');
  const encrypted = zip.has('META-INF/encryption.xml') ? encryptedPaths(await read('META-INF/encryption.xml')) : new Set<string>();

  const opfPath = zip.has('META-INF/container.xml') ? rootFile(await read('META-INF/container.xml')) : null;
  const packagePath = opfPath && zip.has(opfPath) ? opfPath : [...zip.entries.keys()].find((n) => n.toLowerCase().endsWith('.opf'));
  if (!packagePath) throw new EpubError('That file isn’t a valid EPUB (no package document)');
  const pkg = parsePackage(await read(packagePath), dirOf(packagePath));

  const builder = new ParagraphBuilder();
  const docPaths: string[] = [];
  for (const ref of pkg.spine) {
    if (!ref.linear) continue;
    const item = pkg.manifest.get(ref.idref);
    if (!item || !isHtml(item)) continue;
    if (encrypted.has(item.path)) throw new EpubError('This EPUB is DRM-protected and can’t be opened');
    if (!zip.has(item.path)) continue; // A broken reference shouldn't make the whole book unreadable.
    builder.document(await read(item.path), item.path);
    docPaths.push(item.path);
  }
  const { paragraphs, headings, spaced, spacedGroup, docStarts, removed, marks, anchors, docOf, ordinals } = builder.finish();
  if (!docPaths.length || !paragraphs.length) throw new EpubError('That EPUB has no readable text');

  const title = pkg.title || fallbackTitle;
  const toc = await readToc(pkg, zip, read);
  const fromToc = chaptersFromToc(toc, anchors, paragraphs, headings, docStarts, removed);

  // A TOC with one entry (or none that points into the text) says less than the book's own headings.
  let added: number[] = [];
  let chapters: ParsedBook['chapters'];
  const inferred = headings.length ? [] : inferHeadings(paragraphs, spaced);
  const fromHeadings = headings.length
    ? chaptersFromHeadings(paragraphs, headings, title, (a, b) => !crossesDocument(docStarts, a, b))
    : // Inferred headings only run together when they are lines of one paragraph.
      chaptersFromHeadings(paragraphs, inferred, title, (a, b) => spacedGroup.has(a) && spacedGroup.get(a) === spacedGroup.get(b));
  if (fromToc && (fromToc.chapters.length > 1 || fromHeadings.length <= 1)) {
    chapters = fromToc.chapters;
    added = fromToc.promoted;
  } else {
    chapters = fromHeadings;
    added = inferred;
  }
  for (const p of added) delete marks[p];
  const allHeadings = added.length ? [...new Set([...headings, ...added])].sort((a, b) => a - b) : headings;

  const layout: EpubLayout = { docs: [], headings: allHeadings, paragraphCount: paragraphs.length };
  docOf.forEach((doc, p) => {
    const last = layout.docs.at(-1);
    if (p === 0 || doc !== docOf[p - 1]) {
      layout.docs.push({ path: docPaths[doc], start: p, kept: [[ordinals[p], ordinals[p] + 1]] });
      return;
    }
    const range = last!.kept.at(-1)!;
    if (range[1] === ordinals[p]) range[1]++;
    else last!.kept.push([ordinals[p], ordinals[p] + 1]);
  });

  return { title, author: pkg.authors.join(', ') || null, language: pkg.language, paragraphs, headings: allHeadings, marks, chapters, layout };
}

/**
 * Paragraphs [from, to) of a parsed EPUB (and their marks, keyed by paragraph index), read from
 * only the spine documents they come from: the same text a full parseEpub gives, much faster for
 * one chapter of a big book. Throws EpubError if the file doesn't match the layout.
 */
export async function readEpubParagraphs(
  bytes: Uint8Array,
  layout: EpubLayout,
  from: number,
  to: number,
): Promise<{ paragraphs: string[]; marks: Record<number, InlineMark[]> }> {
  const { zip, read } = openArchive(bytes);
  const headings = new Set(layout.headings);
  const paragraphs: string[] = [];
  const marks: Record<number, InlineMark[]> = {};
  for (let d = 0; d < layout.docs.length; d++) {
    const doc = layout.docs[d];
    const end = layout.docs[d + 1]?.start ?? layout.paragraphCount;
    if (end <= from || doc.start >= to) continue;
    if (!zip.has(doc.path)) throw new EpubError('The EPUB doesn’t match what was read before');
    const builder = new ParagraphBuilder(true);
    builder.document(await read(doc.path), doc.path);
    const raw = builder.finish();
    let p = doc.start;
    for (const [a, b] of doc.kept) {
      for (let k = a; k < b; k++, p++) {
        if (p < from || p >= to) continue;
        if (k >= raw.paragraphs.length) throw new EpubError('The EPUB doesn’t match what was read before');
        paragraphs[p - from] = raw.paragraphs[k];
        // Headings carry no marks (those found from the TOC or spacing had theirs dropped).
        if (raw.marks[k] && !headings.has(p)) marks[p] = raw.marks[k];
      }
    }
  }
  if (paragraphs.length !== to - from || paragraphs.includes(undefined as unknown as string)) {
    throw new EpubError('The EPUB doesn’t match what was read before');
  }
  return { paragraphs, marks };
}

// ---------------------------------------------------------------------------------------------
// Paths

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/** Resolves an href against a directory inside the archive; keeps any #fragment. */
export function resolveHref(dir: string, href: string): string {
  const hash = href.indexOf('#');
  let path = hash < 0 ? href : href.slice(0, hash);
  const fragment = hash < 0 ? '' : href.slice(hash);
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep it as written.
  }
  if (!path) return fragment;
  const parts: string[] = [];
  for (const seg of (path.startsWith('/') ? path.slice(1) : dir + path).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/') + fragment;
}

const isHtml = (item: ManifestItem) => /html/.test(item.mediaType) || /\.x?html?$/i.test(item.path);

// ---------------------------------------------------------------------------------------------
// container.xml, encryption.xml, content.opf

function rootFile(xml: string): string | null {
  for (const t of tokenize(xml)) {
    if (t.type === 'open' && t.name === 'rootfile') {
      const path = attr(t.attrs, 'full-path');
      if (path) return resolveHref('', path);
    }
  }
  return null;
}

/** Content documents listed in encryption.xml (font obfuscation is fine; encrypted text is DRM). */
function encryptedPaths(xml: string): Set<string> {
  const paths = new Set<string>();
  for (const t of tokenize(xml)) {
    if (t.type === 'open' && t.name === 'cipherreference') {
      const uri = attr(t.attrs, 'URI');
      if (uri) paths.add(resolveHref('', uri));
    }
  }
  return paths;
}

interface Package {
  title: string;
  authors: string[];
  language: string | null;
  manifest: Map<string, ManifestItem>;
  spine: { idref: string; linear: boolean }[];
  /** Manifest id of the NCX, from <spine toc="…">. */
  ncxId: string | null;
}

function parsePackage(xml: string, dir: string): Package {
  const pkg: Package = { title: '', authors: [], language: null, manifest: new Map(), spine: [], ncxId: null };
  let packageLang: string | null = null;
  let field: 'title' | 'creator' | 'language' | null = null;
  let text = '';
  let inMetadata = false;

  for (const t of tokenize(xml)) {
    if (t.type === 'open') {
      if (t.name === 'package') packageLang = attr(t.attrs, 'lang') ?? null;
      else if (t.name === 'metadata') inMetadata = true;
      else if (inMetadata && (t.name === 'title' || t.name === 'creator' || t.name === 'language') && !t.selfClosing) {
        field = t.name;
        text = '';
      } else if (t.name === 'item') {
        const id = attr(t.attrs, 'id');
        const href = attr(t.attrs, 'href');
        if (id && href) {
          pkg.manifest.set(id, {
            id,
            path: resolveHref(dir, href),
            mediaType: (attr(t.attrs, 'media-type') ?? '').toLowerCase(),
            properties: (attr(t.attrs, 'properties') ?? '').split(/\s+/).filter(Boolean),
          });
        }
      } else if (t.name === 'spine') pkg.ncxId = attr(t.attrs, 'toc') ?? null;
      else if (t.name === 'itemref') {
        const idref = attr(t.attrs, 'idref');
        if (idref) pkg.spine.push({ idref, linear: attr(t.attrs, 'linear') !== 'no' });
      }
    } else if (t.type === 'text') {
      if (field) text += t.text;
    } else if (t.name === 'metadata') inMetadata = false;
    else if (field && t.name === field) {
      const value = text.replace(/\s+/g, ' ').trim();
      if (value) {
        if (field === 'title') pkg.title ||= value;
        else if (field === 'creator') pkg.authors.push(value);
        else pkg.language ??= value;
      }
      field = null;
    }
  }
  pkg.language ??= packageLang;
  return pkg;
}

// ---------------------------------------------------------------------------------------------
// Table of contents

interface TocEntry {
  /** Archive path, with #fragment if any. */
  href: string;
  title: string;
  /** Nesting level: 1 for top-level entries. */
  depth: number;
}

async function readToc(pkg: Package, zip: ZipArchive, read: (path: string) => Promise<string>): Promise<TocEntry[]> {
  const nav = [...pkg.manifest.values()].find((i) => i.properties.includes('nav'));
  if (nav && zip.has(nav.path)) {
    const entries = parseNav(await read(nav.path), dirOf(nav.path));
    if (entries.length) return entries;
  }
  const ncx = (pkg.ncxId ? pkg.manifest.get(pkg.ncxId) : undefined) ?? [...pkg.manifest.values()].find((i) => i.mediaType === 'application/x-dtbncx+xml');
  if (ncx && zip.has(ncx.path)) return parseNcx(await read(ncx.path), dirOf(ncx.path));
  return [];
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** EPUB 3 navigation document: the links in <nav epub:type="toc"> (or the first <nav>). */
export function parseNav(xml: string, dir: string): TocEntry[] {
  const navs: { isToc: boolean; entries: TocEntry[] }[] = [];
  let current: { isToc: boolean; entries: TocEntry[] } | null = null;
  let depth = 0;
  let lists = 0;
  let link: { href: string; text: string } | null = null;

  for (const t of tokenize(xml)) {
    if (t.type === 'open') {
      if (t.name === 'nav' && !t.selfClosing) {
        if (!current) {
          current = { isToc: (attr(t.attrs, 'type') ?? '').split(/\s+/).includes('toc'), entries: [] };
          depth = 0;
          lists = 0;
        }
        depth++;
      } else if (current && t.name === 'ol' && !t.selfClosing) {
        lists++;
      } else if (current && t.name === 'a' && !t.selfClosing) {
        const href = attr(t.attrs, 'href');
        link = href ? { href, text: '' } : null;
      }
    } else if (t.type === 'text') {
      if (link) link.text += t.text;
    } else if (t.name === 'a' && link && current) {
      const title = clean(link.text);
      if (title) current.entries.push({ href: resolveHref(dir, link.href), title, depth: Math.max(1, lists) });
      link = null;
    } else if (t.name === 'ol' && current) {
      lists--;
    } else if (t.name === 'nav' && current && --depth === 0) {
      navs.push(current);
      current = null;
    }
  }
  return (navs.find((n) => n.isToc) ?? navs[0])?.entries ?? [];
}

/** EPUB 2 NCX: navPoints in document order (nested ones flattened). */
export function parseNcx(xml: string, dir: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const stack: { title: string; src: string | null; emitted: boolean; depth: number }[] = [];
  let inLabel = false;
  let label = '';

  const emit = (point: (typeof stack)[number]) => {
    if (point.emitted || !point.src) return;
    point.emitted = true;
    const title = clean(point.title);
    if (title) entries.push({ href: resolveHref(dir, point.src), title, depth: point.depth });
  };

  for (const t of tokenize(xml)) {
    if (t.type === 'open') {
      if (t.name === 'navpoint' && !t.selfClosing) {
        // A parent is emitted before its children.
        const parent = stack.at(-1);
        if (parent) emit(parent);
        stack.push({ title: '', src: null, emitted: false, depth: stack.length + 1 });
      } else if (t.name === 'navlabel' && stack.length) {
        inLabel = true;
        label = '';
      } else if (t.name === 'content' && stack.length) stack.at(-1)!.src ??= attr(t.attrs, 'src') ?? null;
    } else if (t.type === 'text') {
      if (inLabel) label += t.text;
    } else if (t.name === 'navlabel' && inLabel) {
      inLabel = false;
      const point = stack.at(-1);
      if (point && !point.title) point.title = label;
    } else if (t.name === 'navpoint') {
      const point = stack.pop();
      if (point) emit(point);
    }
  }
  return entries;
}

const normalise = (s: string) => s.replace(/\s+/g, '');

/**
 * The deepest TOC level that holds chapters, or 0 if every level may. Books are usually split into
 * one file per chapter, so it's the deepest level whose entries mostly start a new file; deeper
 * entries point into their chapter's file and are sections of it ("Aftermath", "Act 2") or its
 * subtitle. Books in one file (or split by size) have no such level.
 */
export function chapterLevel(toc: TocEntry[]): number {
  const levels = new Map<number, { entries: number; newFile: number }>();
  toc.forEach((e, i) => {
    const level = levels.get(e.depth) ?? { entries: 0, newFile: 0 };
    level.entries++;
    if (i > 0 && e.href.split('#')[0] !== toc[i - 1].href.split('#')[0]) level.newFile++;
    levels.set(e.depth, level);
  });
  return Math.max(0, ...[...levels].filter(([, l]) => l.newFile >= 3 && l.newFile * 2 >= l.entries).map(([d]) => d));
}

/** True if a spine document starts after paragraph `a` and at or before `b`. */
const crossesDocument = (docStarts: number[], a: number, b: number) => docStarts.some((d) => d > a && d <= b);

/** Longest paragraph that can be taken for a heading by its spacing alone. */
const MAX_INFERRED_HEADING = 200;

/** Headings for books without h1–h6: short paragraphs set off by a large top margin, or "Chapter 12"-like lines. */
function inferHeadings(paragraphs: string[], spaced: number[]): number[] {
  const found = new Set(spaced.filter((p) => paragraphs[p].length <= MAX_INFERRED_HEADING));
  paragraphs.forEach((t, p) => isTxtHeading(t) && found.add(p));
  return [...found].sort((a, b) => a - b);
}

/**
 * One chapter per heading; consecutive heading lines are one chapter titled by all of them
 * ("Der transzendentalen Ästhetik · Erster Abschnitt · Von dem Raume"). Text before the first
 * heading is a chapter titled `fallbackTitle`.
 */
export function chaptersFromHeadings(
  paragraphs: string[],
  headings: number[],
  fallbackTitle: string,
  canJoin: (previous: number, next: number) => boolean = () => true,
): ParsedBook['chapters'] {
  const n = paragraphs.length;
  if (!headings.length) return n ? [{ title: fallbackTitle, start: 0, end: n }] : [];
  const chapters: ParsedBook['chapters'] = [];
  if (headings[0] > 0) chapters.push({ title: fallbackTitle, start: 0, end: headings[0] });
  let previous = -2;
  for (const h of headings) {
    const prev = chapters.at(-1);
    // The heading right before this one started `prev`, so this line continues its title.
    if (prev && h === previous + 1 && canJoin(previous, h)) prev.title += ` · ${paragraphs[h]}`;
    else chapters.push({ title: paragraphs[h], start: h, end: n });
    previous = h;
  }
  for (let i = 0; i < chapters.length; i++) chapters[i].end = chapters[i + 1]?.start ?? n;
  return chapters;
}

/**
 * Chapters starting at each resolvable TOC entry, or null if the TOC doesn't point into the text.
 * `promoted`: paragraphs that open a chapter with its TOC title but weren't marked up as headings.
 */
export function chaptersFromToc(
  toc: TocEntry[],
  anchors: Map<string, number>,
  paragraphs: string[],
  headings: number[],
  docStarts: number[] = [],
  removed: Set<string> = new Set(),
): { chapters: ParsedBook['chapters']; promoted: number[] } | null {
  const n = paragraphs.length;
  const headingSet = new Set(headings);
  const starts: { start: number; titles: string[] }[] = [];

  const level = chapterLevel(toc);
  const resolved = toc
    // Entries for text that was left out (a contents list, Gutenberg boilerplate) go too.
    .filter((e) => !removed.has(e.href))
    .map((e) => {
      const file = e.href.split('#')[0];
      return { title: e.title, start: anchors.get(e.href) ?? anchors.get(file), section: level > 0 && e.depth > level };
    })
    .filter((e): e is { title: string; start: number; section: boolean } => e.start !== undefined && e.start < n)
    // Stable sort: entries out of reading order are placed where their text is.
    .sort((a, b) => a.start - b.start);

  for (const { title, start, section } of resolved) {
    const prev = starts.at(-1);
    // Entries run together only within one spine document, with nothing but headings between them.
    let onlyHeadingsBetween = prev !== undefined && !crossesDocument(docStarts, prev.start, start);
    for (let p = prev?.start ?? 0; prev && p < start; p++) if (!headingSet.has(p)) onlyHeadingsBetween = false;
    if (prev && onlyHeadingsBetween) {
      if (!prev.titles.includes(title)) prev.titles.push(title);
    } else if (!section) starts.push({ start, titles: [title] });
    // A section entry only adds to the title of the chapter it opens (a subtitle).
  }
  if (!starts.length) return null;

  const chapters = starts.map((s, i) => ({ title: s.titles.join(' · '), start: s.start, end: starts[i + 1]?.start ?? n }));

  const promoted: number[] = [];
  starts.forEach((s, i) => {
    const titles = new Set(s.titles.map(normalise));
    for (let p = s.start; p < chapters[i].end && p < s.start + s.titles.length + 1; p++) {
      if (headingSet.has(p)) continue;
      if (!titles.has(normalise(paragraphs[p]))) break;
      promoted.push(p);
    }
  });

  // Text before the first TOC entry (a title page, a preface the TOC leaves out) gets its own chapter.
  if (chapters[0].start > 0) chapters.unshift({ title: paragraphs[0], start: 0, end: chapters[0].start });
  return { chapters, promoted };
}

// ---------------------------------------------------------------------------------------------
// XHTML → paragraphs

class ParagraphBuilder {
  /**
   * `raw`: nothing is left out once kept (no Gutenberg header, no contents lists), so paragraph i
   * of a document is its i-th candidate paragraph, as numbered in `ordinals` by a full parse.
   */
  constructor(private readonly raw = false) {}

  readonly paragraphs: string[] = [];
  /** For each paragraph: which spine document it came from, and its candidate number there. */
  readonly docOf: number[] = [];
  readonly ordinals: number[] = [];
  private ordinal = 0;
  readonly headings: number[] = [];
  readonly marks: Record<number, InlineMark[]> = {};
  /** "path" and "path#id" → index of the paragraph they point at. */
  readonly anchors = new Map<string, number>();

  private buf = '';
  private bufMarks: InlineMark[] = [];
  private openMarks: { kind: MarkKind; start: number }[] = [];
  private heading = 0;
  /** Inside a block set off by a large top margin. */
  private spacedBlock = 0;
  readonly spaced: number[] = [];
  /** Spaced paragraph → which block it came from (lines of one block split by <br>). */
  readonly spacedGroup = new Map<number, number>();
  private spacedIds: number[] = [];
  private nextSpacedId = 0;
  /** First paragraph of each spine document. */
  readonly docStarts: number[] = [];
  /** Anchors ("path#id") whose text was left out. */
  readonly removed = new Set<string>();
  private pre = 0;
  private pendingAnchors: string[] = [];
  /** Visible characters in the current paragraph, and how many are inside links into the book. */
  private paraChars = 0;
  private paraLinkChars = 0;
  private inLink = 0;
  /** First paragraph of the current run of link-only paragraphs (a contents list), if any. */
  private linkRun: number | null = null;
  /** After Project Gutenberg's "*** END OF …" line: everything else is the licence. */
  private ended = false;

  document(xml: string, path: string): void {
    this.flush();
    this.endLinkRun();
    this.ordinal = 0;
    this.docStarts.push(this.paragraphs.length);
    this.anchor(path);
    this.inLink = 0;
    const stack: Frame[] = [];
    let skip = 0;

    const open = (name: string, attrs: Record<string, string>): Frame => {
      const frame: Frame = { name, kinds: [], link: false, spaced: false };
      if (skip || SKIP.has(name)) {
        skip++;
        return frame;
      }
      const id = attr(attrs, 'id') ?? (name === 'a' ? attrs.name : undefined);
      if (BLOCK.has(name)) this.flush();
      if (id) this.anchor(`${path}#${id}`);
      if (HEADING.test(name)) this.heading++;
      if (name === 'pre') this.pre++;
      if (BLOCK.has(name) && largeTopMargin(attr(attrs, 'style'))) {
        frame.spaced = true;
        this.spacedBlock++;
        this.spacedIds.push(this.nextSpacedId++);
      }
      if (name === 'a' && isInternalLink(attr(attrs, 'href'))) {
        frame.link = true;
        this.inLink++;
      }
      frame.kinds = stylesOf(name, attrs);
      for (const kind of frame.kinds) this.openMarks.push({ kind, start: this.buf.length });
      return frame;
    };
    const close = ({ name, kinds, link, spaced }: Frame) => {
      if (skip) {
        skip--;
        return;
      }
      for (const kind of kinds) {
        const i = this.openMarks.findLastIndex((m) => m.kind === kind);
        if (i >= 0) {
          const [m] = this.openMarks.splice(i, 1);
          if (this.buf.length > m.start) this.bufMarks.push([m.start, this.buf.length, kind]);
        }
      }
      if (link) this.inLink--;
      if (BLOCK.has(name)) this.flush();
      if (spaced) {
        this.spacedBlock--;
        this.spacedIds.pop();
      }
      if (HEADING.test(name)) this.heading = Math.max(0, this.heading - 1);
      if (name === 'pre') this.pre = Math.max(0, this.pre - 1);
    };

    for (const t of tokenize(xml)) {
      if (t.type === 'text') {
        if (!skip) this.text(t.text);
      } else if (t.type === 'open') {
        if (t.name === 'br') {
          if (!skip) this.flush();
          continue;
        }
        if (t.name === 'img' || t.name === 'hr') {
          if (!skip && t.name === 'hr') this.flush();
          continue;
        }
        const frame = open(t.name, t.attrs);
        if (t.selfClosing) close(frame);
        else stack.push(frame);
      } else {
        // Close everything up to the matching open tag (tolerates unclosed inline tags).
        const at = stack.findLastIndex((f) => f.name === t.name);
        if (at < 0) continue;
        while (stack.length > at) close(stack.pop()!);
      }
    }
    while (stack.length) close(stack.pop()!);
    this.flush();
    this.openMarks = [];
    this.inLink = 0;
  }

  /**
   * Drops the paragraphs from `start` on. Links to places in them go too (a TOC entry for a removed
   * contents list mustn't land on the next chapter); a link to a whole document moves on to the
   * next paragraph that is kept.
   */
  private rollBack(start: number): void {
    if (this.raw) return;
    this.paragraphs.length = start;
    this.docOf.length = start;
    this.ordinals.length = start;
    while (this.headings.length && this.headings.at(-1)! >= start) this.headings.pop();
    while (this.spaced.length && this.spaced.at(-1)! >= start) this.spacedGroup.delete(this.spaced.pop()!);
    for (const key of Object.keys(this.marks)) if (Number(key) >= start) delete this.marks[Number(key)];
    for (const [key, index] of this.anchors) {
      if (index < start) continue;
      this.anchors.delete(key);
      if (key.includes('#')) this.removed.add(key);
      else this.pendingAnchors.push(key);
    }
  }

  /** Ends a run of link-only paragraphs: three or more (with a "Contents" heading before them) are a contents list. */
  private endLinkRun(): void {
    const run = this.linkRun;
    this.linkRun = null;
    if (run === null || this.paragraphs.length - run < MIN_CONTENTS_LINKS) return;
    const from = run > 0 && CONTENTS_HEADING.test(this.paragraphs[run - 1]) ? run - 1 : run;
    this.rollBack(from);
  }

  private anchor(key: string): void {
    if (this.ended || this.anchors.has(key)) return;
    // Inside a paragraph that already has text → that paragraph; otherwise the next one.
    if (this.buf.trim()) this.anchors.set(key, this.paragraphs.length);
    else this.pendingAnchors.push(key);
  }

  private text(raw: string): void {
    if (this.pre) {
      const lines = raw.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) this.flush();
        this.append(line.replace(/[ \t\r\f]+/g, ' '));
      });
      return;
    }
    // A line break between two CJK characters is not a space; any other whitespace run is one space.
    const prev = this.buf.at(-1);
    const s = raw.replace(/[ \t\r\n\f]+/g, (run, offset: number, all: string) => {
      if (!run.includes('\n')) return ' ';
      const before = offset > 0 ? all[offset - 1] : prev;
      const after = all[offset + run.length];
      return before && after && CJK.test(before) && CJK.test(after) ? '' : ' ';
    });
    this.append(s);
  }

  private append(s: string): void {
    if (!s) return;
    if (!this.buf || XML_SPACE.test(this.buf.at(-1)!)) s = s.replace(/^ +/, '');
    // Soft hyphens only mark possible breaks.
    s = s.replace(/\u00ad/g, '');
    const visible = s.replace(/\s+/g, '').length;
    this.paraChars += visible;
    if (this.inLink) this.paraLinkChars += visible;
    this.buf += s;
  }

  private flush(): void {
    // trim() also removes &nbsp; and ideographic spaces (paragraph indents in Chinese books).
    const lead = this.buf.length - this.buf.trimStart().length;
    const text = this.ended ? '' : this.buf.trim();
    // Headings often link back to the contents ("<h2><a href=…#toc>I</a></h2>"): never part of a list.
    const linkOnly = !this.heading && this.paraChars > 0 && this.paraLinkChars >= this.paraChars * 0.8;
    this.paraChars = this.paraLinkChars = 0;

    if (text && text.length <= 200 && GUTENBERG_START.test(text)) {
      // Everything so far is Project Gutenberg's English header.
      this.linkRun = null;
      this.rollBack(0);
      this.reset();
      return;
    }
    if (text && text.length <= 200 && GUTENBERG_END.test(text)) {
      this.endLinkRun();
      this.ended = true;
      this.reset();
      return;
    }
    if (text) {
      if (!linkOnly) this.endLinkRun();
      const index = this.paragraphs.length;
      if (linkOnly) this.linkRun ??= index;
      this.paragraphs.push(text);
      this.docOf.push(this.docStarts.length - 1);
      this.ordinals.push(this.ordinal++);
      if (this.heading) this.headings.push(index);
      else {
        if (this.spacedBlock) {
          this.spaced.push(index);
          this.spacedGroup.set(index, this.spacedIds.at(-1)!);
        }
        const marks = [...this.bufMarks, ...this.openMarks.map((m): InlineMark => [m.start, this.buf.length, m.kind])]
          .map(([a, b, k]): InlineMark => [Math.max(0, a - lead), Math.min(b - lead, text.length), k])
          .filter(([a, b]) => b > a)
          .sort((x, y) => x[0] - y[0]);
        if (marks.length) this.marks[index] = marks;
      }
      for (const key of this.pendingAnchors) this.anchors.set(key, index);
      this.pendingAnchors = [];
    }
    this.reset();
  }

  private reset(): void {
    this.buf = '';
    this.bufMarks = [];
    // Styles still open continue into the next paragraph.
    this.openMarks = this.openMarks.map((m) => ({ ...m, start: 0 }));
  }

  finish() {
    this.flush();
    this.endLinkRun();
    for (const key of this.pendingAnchors) this.anchors.set(key, this.paragraphs.length);
    this.pendingAnchors = [];
    this.spacedBlock = 0;
    return {
      paragraphs: this.paragraphs,
      headings: this.headings,
      spaced: this.spaced,
      spacedGroup: this.spacedGroup,
      docStarts: this.docStarts,
      removed: this.removed,
      marks: this.marks,
      anchors: this.anchors,
      docOf: this.docOf,
      ordinals: this.ordinals,
    };
  }
}
