/**
 * Turns raw .txt / .md text into a flat list of paragraphs plus chapter boundaries.
 * Pure functions only, so they can be unit tested without a browser.
 */

export type BookFormat = 'txt' | 'md';

export interface Chapter {
  title: string;
  /** First paragraph index (inclusive). */
  start: number;
  /** Last paragraph index (exclusive). */
  end: number;
}

export interface ParsedBook {
  /** Title found inside the file (first markdown H1), if any. */
  title: string | null;
  /** Paragraph texts. Never empty strings, never contain '\n'. */
  paragraphs: string[];
  /** Indices of paragraphs that are headings. */
  headings: number[];
  /** Bold/italic ranges, keyed by paragraph index (only paragraphs that have any). */
  marks: Record<number, InlineMark[]>;
  chapters: Chapter[];
}

/** Lines in a .txt file that look like chapter headings. */
const TXT_CHAPTER_LINE =
  /^(第\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\s*[章回节卷集部篇]|chapter\s+([0-9]+|[ivxlc]+)\b|序章|序言|楔子|引子|尾声|后记|番外)/i;
const MAX_TXT_HEADING_LENGTH = 40;

const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;

/** Decodes file bytes: BOM-aware, UTF-8 first, falling back to GB18030 (common for Chinese .txt). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

export function formatFromFileName(name: string): BookFormat | null {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'txt' || ext === 'text') return 'txt';
  if (ext === 'md' || ext === 'markdown') return 'md';
  return null;
}

export function parseBook(raw: string, format: BookFormat, fallbackTitle: string): ParsedBook {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const { paragraphs, headings, title, marks } = format === 'md' ? parseMarkdown(text) : parseTxt(text);
  return {
    title,
    paragraphs,
    headings,
    marks,
    chapters: buildChapters(paragraphs, headings, title ?? fallbackTitle),
  };
}

interface Blocks {
  paragraphs: string[];
  headings: number[];
  title: string | null;
  marks: Record<number, InlineMark[]>;
}

/** Joins hard-wrapped lines: no space between CJK text, a single space otherwise. */
export function joinLines(lines: string[]): string {
  let out = '';
  for (const line of lines) {
    if (!out) out = line;
    else if (CJK.test(out.at(-1)!) || CJK.test(line[0])) out += line;
    else out += ' ' + line;
  }
  return out;
}

function parseTxt(text: string): Blocks {
  const paragraphs: string[] = [];
  const headings: number[] = [];

  // Two common layouts: one paragraph per line (typical for Chinese novels), or
  // hard-wrapped lines with blank lines between paragraphs (e.g. Project Gutenberg).
  const blocks = text.split(/\n[ \t　]*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean));
  const nonEmpty = blocks.filter((b) => b.length > 0);
  const units = isHardWrapped(nonEmpty)
    ? nonEmpty.flatMap((b) => (b.length === 1 || !isTxtHeading(b[0]) ? [joinLines(b)] : [b[0], joinLines(b.slice(1))]))
    : nonEmpty.flat();

  for (const unit of units) {
    if (isTxtHeading(unit)) headings.push(paragraphs.length);
    paragraphs.push(unit);
  }
  return { paragraphs, headings, title: null, marks: {} };
}

const SENTENCE_END = /[。！？!?.…”」』"'）)：:；;]$/;

/**
 * Hard-wrapped text breaks lines mid-sentence; one-paragraph-per-line text ends lines with
 * punctuation. Look at lines that are followed by another line in the same block.
 */
function isHardWrapped(blocks: string[][]): boolean {
  if (blocks.length < 2) return false;
  let inner = 0;
  let ended = 0;
  for (const block of blocks) {
    for (const line of block.slice(0, -1)) {
      if (isTxtHeading(line)) continue;
      inner++;
      if (SENTENCE_END.test(line)) ended++;
    }
  }
  return inner > 0 && ended / inner < 0.5;
}

/** "Chapter 12", "第十二章", "序章"… — a short line that names a chapter. */
export function isTxtHeading(line: string): boolean {
  return line.length <= MAX_TXT_HEADING_LENGTH && TXT_CHAPTER_LINE.test(line);
}

export type MarkKind = 'b' | 'i';
/** Inline style over [start, end) of a paragraph's plain text. */
export type InlineMark = [start: number, end: number, kind: MarkKind];

export interface InlineText {
  text: string;
  marks: InlineMark[];
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * Parses inline markdown into plain text plus bold/italic ranges. Links keep their text; images,
 * html tags and code/strikethrough markers are dropped. Unmatched `*`/`_` stay as literal text.
 */
export function parseInlineMarkdown(source: string): InlineText {
  const s = source
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '');

  let out = '';
  const marks: InlineMark[] = [];
  const open: { char: string; size: 1 | 2; pos: number }[] = [];

  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === '\\' && /[\\`*_{}[\]()#+\-.!>~|]/.test(s[i + 1] ?? '')) {
      out += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) {
        out += s.slice(i + 1, end);
        i = end + 1;
        continue;
      }
    }
    if (c === '~' && s[i + 1] === '~') {
      i += 2;
      continue;
    }
    if (c === '*' || c === '_') {
      let run = 0;
      while (s[i + run] === c) run++;
      const before = s[i - 1];
      const after = s[i + run];
      i += run;
      if (c === '_' && isWordChar(before) && isWordChar(after)) {
        out += c.repeat(run); // snake_case
        continue;
      }
      let left = run;
      if (!isSpace(before)) {
        // Close matching openers, innermost first (handles ***both***).
        while (left > 0 && open.length && open.at(-1)!.char === c && open.at(-1)!.size <= left) {
          const o = open.pop()!;
          left -= o.size;
          if (out.length > o.pos) marks.push([o.pos, out.length, o.size === 2 ? 'b' : 'i']);
        }
      }
      if (left > 0 && !isSpace(after)) {
        while (left > 0) {
          const size = left >= 2 ? 2 : 1;
          open.push({ char: c, size, pos: out.length });
          left -= size;
        }
      }
      out += c.repeat(left);
      continue;
    }
    out += c;
    i++;
  }

  // Unclosed openers become literal text again.
  for (let k = open.length - 1; k >= 0; k--) {
    const o = open[k];
    out = out.slice(0, o.pos) + o.char.repeat(o.size) + out.slice(o.pos);
    for (const m of marks) {
      if (m[0] >= o.pos) m[0] += o.size;
      if (m[1] > o.pos) m[1] += o.size;
    }
  }

  const lead = out.length - out.trimStart().length;
  const text = out.trim();
  const shifted = marks
    .map(([a, b, k]): InlineMark => [Math.max(0, a - lead), Math.min(text.length, b - lead), k])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  return { text, marks: shifted };
}

/** Inline markdown → visible text only. */
export function stripInlineMarkdown(s: string): string {
  return parseInlineMarkdown(s).text;
}

function parseMarkdown(text: string): Blocks {
  const paragraphs: string[] = [];
  const headings: number[] = [];
  const marks: Record<number, InlineMark[]> = {};
  let title: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const push = (s: string, heading = false) => {
    const inline = parseInlineMarkdown(s);
    if (!inline.text) return;
    if (heading) headings.push(paragraphs.length);
    else if (inline.marks.length) marks[paragraphs.length] = inline.marks;
    paragraphs.push(inline.text);
  };
  const flush = () => {
    if (buffer.length) push(joinLines(buffer));
    buffer = [];
  };

  for (const rawLine of text.split('\n')) {
    let line = rawLine.trim();

    if (/^(```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (line) paragraphs.push(line);
      continue;
    }
    if (!line) {
      flush();
      continue;
    }

    const atx = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (atx) {
      flush();
      if (atx[1].length === 1 && title === null) title = stripInlineMarkdown(atx[2]) || null;
      push(atx[2], true);
      continue;
    }
    // Setext heading underline (=== or ---) directly under text.
    if (/^(=+|-+)$/.test(line) && buffer.length) {
      const headingText = joinLines(buffer);
      buffer = [];
      if (line.startsWith('=') && title === null) title = stripInlineMarkdown(headingText) || null;
      push(headingText, true);
      continue;
    }
    // Thematic break.
    if (/^([-*_]\s*){3,}$/.test(line)) {
      flush();
      continue;
    }

    while (line.startsWith('>')) line = line.slice(1).trimStart();
    const listItem = /^([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      flush();
      line = (/\d/.test(listItem[1]) ? listItem[1] + ' ' : '• ') + listItem[2];
    }
    if (line) buffer.push(line);
  }
  flush();
  return { paragraphs, headings, title, marks };
}

/**
 * Each heading starts a chapter. Runs of consecutive headings (e.g. "# Book" then "## Chapter 1")
 * collapse into one chapter titled by the last heading. Text before the first heading becomes
 * its own chapter.
 */
export function buildChapters(paragraphs: string[], headings: number[], fallbackTitle: string): Chapter[] {
  const n = paragraphs.length;
  if (n === 0) return [];
  if (headings.length === 0) return [{ title: fallbackTitle, start: 0, end: n }];

  const chapters: Chapter[] = [];
  if (headings[0] > 0) chapters.push({ title: fallbackTitle, start: 0, end: headings[0] });

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const prev = chapters.at(-1);
    const continuesHeadingRun = i > 0 && headings[i - 1] === h - 1 && prev !== undefined && prev.start >= headings[0] && isAllHeadings(prev.start, h, headings);
    if (continuesHeadingRun) prev.title = paragraphs[h];
    else chapters.push({ title: paragraphs[h], start: h, end: n });
  }
  for (let i = 0; i < chapters.length; i++) chapters[i].end = chapters[i + 1]?.start ?? n;
  return chapters;
}

function isAllHeadings(from: number, to: number, headings: number[]): boolean {
  for (let p = from; p < to; p++) if (!headings.includes(p)) return false;
  return true;
}
