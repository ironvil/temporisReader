/**
 * Turns raw .txt / .md text into a flat list of paragraphs plus chapter boundaries.
 * Pure functions only, so they can be unit tested without a browser.
 */

/** Bump when parsing rules change so stored indexes are rebuilt from the source file. */
export const PARSER_VERSION = 1;

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
  const { paragraphs, headings, title } = format === 'md' ? parseMarkdown(text) : parseTxt(text);
  return {
    title,
    paragraphs,
    headings,
    chapters: buildChapters(paragraphs, headings, title ?? fallbackTitle),
  };
}

interface Blocks {
  paragraphs: string[];
  headings: number[];
  title: string | null;
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
  return { paragraphs, headings, title: null };
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

function isTxtHeading(line: string): boolean {
  return line.length <= MAX_TXT_HEADING_LENGTH && TXT_CHAPTER_LINE.test(line);
}

/** Strips inline markdown syntax, keeping the visible text. */
export function stripInlineMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links
    .replace(/<[^>]+>/g, '') // inline html
    .replace(/`([^`]*)`/g, '$1') // code
    .replace(/(\*\*|__)(.+?)\1/g, '$2') // bold
    .replace(/(^|[^\p{L}\p{N}*_])([*_])(?!\s)(.+?)(?<!\s)\2(?![\p{L}\p{N}])/gu, '$1$3') // italics
    .replace(/~~(.+?)~~/g, '$1') // strikethrough
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1') // escapes
    .trim();
}

function parseMarkdown(text: string): Blocks {
  const paragraphs: string[] = [];
  const headings: number[] = [];
  let title: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const push = (s: string, heading = false) => {
    const clean = stripInlineMarkdown(s);
    if (!clean) return;
    if (heading) headings.push(paragraphs.length);
    paragraphs.push(clean);
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
  return { paragraphs, headings, title };
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
