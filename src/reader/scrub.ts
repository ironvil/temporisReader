/**
 * Book-wide positions for the scrubber. Everything is by character offset into content.txt, so
 * no pagination is needed until the reader actually jumps somewhere.
 */
import type { BookIndex } from '../books/library';

export interface Located {
  chapter: number;
  /** Paragraph index within the chapter. */
  paragraph: number;
  /** Character offset within the paragraph. */
  char: number;
}

/** Largest i with sorted[i] <= value (0 if none). */
function floorIndex(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid] <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Offset in content.txt where each chapter starts. */
export function chapterStartOffsets(index: BookIndex): number[] {
  return index.chapters.map((c) => index.paragraphOffsets[c.start]);
}

/** Global character offset → chapter / paragraph-in-chapter / char. */
export function locateOffset(index: BookIndex, contentLength: number, offset: number): Located {
  const offsets = index.paragraphOffsets;
  const target = Math.max(0, Math.min(offset, contentLength));
  const paragraph = floorIndex(offsets, target);
  const chapter = floorIndex(
    index.chapters.map((c) => c.start),
    paragraph,
  );
  const end = paragraph + 1 < offsets.length ? offsets[paragraph + 1] - 1 : contentLength;
  const length = end - offsets[paragraph];
  return {
    chapter,
    paragraph: paragraph - index.chapters[chapter].start,
    char: Math.max(0, Math.min(target - offsets[paragraph], length - 1)),
  };
}

/** Chapter / paragraph-in-chapter / char → global character offset. */
export function globalOffset(index: BookIndex, chapter: number, paragraph: number, char: number): number {
  return index.paragraphOffsets[index.chapters[chapter].start + paragraph] + char;
}

/** Rough characters per page from the page size, for when no chapter has been measured yet. */
export function guessCharsPerPage(width: number, height: number, fontSize: number, lineHeight = 1.65): number {
  const perLine = Math.max(1, Math.floor(width / fontSize));
  const lines = Math.max(1, Math.floor(height / (fontSize * lineHeight)));
  // Paragraph gaps and short last lines waste roughly a fifth of a page.
  return Math.max(1, Math.round(perLine * lines * 0.8));
}

/** Estimated page (1-based) and page count for a position `charsInto` a chapter of `chapterChars`. */
export function estimatePage(charsInto: number, chapterChars: number, charsPerPage: number): { page: number; pages: number } {
  const cpp = Math.max(1, charsPerPage);
  const pages = Math.max(1, Math.ceil(chapterChars / cpp));
  return { page: Math.min(pages, Math.floor(Math.max(0, charsInto) / cpp) + 1), pages };
}
