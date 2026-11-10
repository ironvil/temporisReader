/**
 * How much of a book (and each chapter) is made of known words.
 *
 * Counting segments the whole book once, so the per-chapter word counts are cached in memory and
 * in books/<id>/words.json, keyed by the book's content version and the language's segmentation
 * key (dictionary version). Percentages are then cheap to recompute whenever known words change.
 */
import { loadBook, type OpenBook } from '../books/library';
import type { LanguageModule } from '../languages/types';
import { readJson, writeJson } from '../storage';
import type { WordSegmenter } from '../segmentation/types';
import { KNOWN, type Level } from './known-words';

/** Trackable word → number of occurrences. */
export type WordCounts = Record<string, number>;

interface StoredCounts {
  key: string;
  chapters: WordCounts[];
}

export interface KnownShare {
  /** Occurrences of known words. */
  known: number;
  /** Occurrences of all trackable words. */
  total: number;
}

/** Counts trackable word occurrences in one chapter's paragraphs. */
export function countWords(paragraphs: Iterable<string>, segmenter: WordSegmenter, isTrackable: (word: string) => boolean): WordCounts {
  const counts: WordCounts = {};
  for (const text of paragraphs) {
    for (const span of segmenter.segment(text)) {
      if (!span.isWord) continue;
      const word = text.slice(span.start, span.end);
      if (isTrackable(word)) counts[word] = (counts[word] ?? 0) + 1;
    }
  }
  return counts;
}

/** Share of word occurrences that are known (level 3). */
export function knownShare(counts: Iterable<WordCounts>, levelOf: (word: string) => Level | undefined): KnownShare {
  let known = 0;
  let total = 0;
  for (const chapter of counts) {
    for (const [word, n] of Object.entries(chapter)) {
      total += n;
      if (levelOf(word) === KNOWN) known += n;
    }
  }
  return { known, total };
}

/** "92%" — floored, so 100% only when everything is known; "–" when there is nothing to count. */
export function formatShare({ known, total }: KnownShare): string {
  if (!total) return '–';
  return `${Math.floor((known / total) * 100)}%`;
}

const memory = new Map<string, StoredCounts>();
const pending = new Map<string, Promise<WordCounts[] | null>>();
const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Per-chapter word counts for a book, or null when the language's data isn't loaded.
 * Computed in chunks (yielding between chapters) the first time, then served from cache.
 */
export function bookWordCounts(bookId: string, lang: LanguageModule, book?: OpenBook): Promise<WordCounts[] | null> {
  const run = async (): Promise<WordCounts[] | null> => {
    const segKey = lang.segmentationKey();
    if (!segKey) return null;
    const source = book ?? (await loadBook(bookId));
    const key = `${source.meta.contentVersion ?? 0}|${segKey}`;

    const cached = memory.get(bookId);
    if (cached?.key === key) return cached.chapters;
    const path = `books/${bookId}/words.json`;
    const stored = await readJson<StoredCounts>(path);
    if (stored?.key === key) {
      memory.set(bookId, stored);
      return stored.chapters;
    }

    const chapters: WordCounts[] = [];
    for (const chapter of source.index.chapters) {
      const paragraphs = Array.from({ length: chapter.end - chapter.start }, (_, i) => source.paragraph(chapter.start + i));
      chapters.push(countWords(paragraphs, lang.segmenter, (w) => lang.isTrackable(w)));
      await yieldToUi();
    }
    const result = { key, chapters };
    memory.set(bookId, result);
    await writeJson(path, result);
    return chapters;
  };

  // One computation per book at a time.
  let promise = pending.get(bookId);
  if (!promise) {
    promise = run().finally(() => pending.delete(bookId));
    pending.set(bookId, promise);
  }
  return promise;
}
