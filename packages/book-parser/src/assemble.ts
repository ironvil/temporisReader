import { type Chapter, type InlineMark, type ParsedBook } from './parse';
import { PARSER_VERSION } from './version';

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
  /** Paragraphs a scene break comes before. */
  breaks: number[];
  chapters: BookChapter[];
}

/** What assembleBook needs to know about each source of a book. */
export interface AssembleSource {
  id: string;
  title: string;
  /** Split into chapters at headings instead of being one chapter. */
  split: boolean;
  /** Filled in by assembleBook. */
  chapterCount: number;
  paragraphCount: number;
}

/**
 * Concatenates parsed sources into one book index. Sources marked `split` keep the chapters found
 * in them; others are one chapter titled by the source. Fills in each source's counts.
 */
export function assembleBook(parts: { source: AssembleSource; parsed: ParsedBook }[]): { content: string; index: BookIndex } {
  const paragraphs: string[] = [];
  const headings: number[] = [];
  const marks: Record<number, InlineMark[]> = {};
  const breaks: number[] = [];
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
    breaks.push(...parsed.breaks.map((b) => b + base));
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
    index: { version: PARSER_VERSION, paragraphOffsets, headings, marks, breaks, chapters },
  };
}
