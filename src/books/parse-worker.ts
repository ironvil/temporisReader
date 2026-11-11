/**
 * Web Worker: all EPUB parsing happens here, off the main thread, so opening a big book never
 * freezes the UI. One job at a time, in order: a job can first read a few chapters from their own
 * spine documents (readEpubParagraphs, posted as soon as they're ready), then parses the whole book.
 * The file's bytes arrive as a transferred buffer (no copy).
 */
import { EpubError, parseEpub, readEpubParagraphs, type EpubBook, type EpubLayout, type InlineMark } from '@temporis/book-parser';

export interface ParseRequest {
  id: number;
  bytes: Uint8Array;
  title: string;
  /** Paragraph ranges [from, to) to read first, using the layout of an earlier parse. */
  read?: { layout: EpubLayout; ranges: [number, number][] };
}

export type ParseResponse =
  | { ready: true }
  | { id: number; partial: { paragraphs: string[]; marks: Record<number, InlineMark[]> }[] }
  | { id: number; partialError: string }
  | { id: number; book: EpubBook }
  | { id: number; error: { epub: boolean; message: string } };

const post = (message: ParseResponse) => self.postMessage(message);
const queue: ParseRequest[] = [];
let busy = false;

async function run(): Promise<void> {
  busy = true;
  while (queue.length) {
    const { id, bytes, title, read } = queue.shift()!;
    if (read) {
      try {
        const partial = [];
        for (const [from, to] of read.ranges) partial.push(await readEpubParagraphs(bytes, read.layout, from, to));
        post({ id, partial });
      } catch (err) {
        post({ id, partialError: err instanceof Error ? err.message : String(err) });
      }
    }
    try {
      post({ id, book: await parseEpub(bytes, title) });
    } catch (err) {
      post({ id, error: { epub: err instanceof EpubError, message: err instanceof Error ? err.message : String(err) } });
    }
  }
  busy = false;
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  queue.push(event.data);
  if (!busy) void run();
};

// Jobs are only handed over (and their bytes transferred) once the worker has started.
post({ ready: true });
