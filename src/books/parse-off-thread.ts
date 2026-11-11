/**
 * Client for the parse worker (src/books/parse-worker.ts). The bytes are transferred to the worker,
 * not copied, so the caller must not use them afterwards. Until the worker reports it has started,
 * jobs wait here; if it can't start (no Worker support, a script error), they run on the main
 * thread instead, with their bytes still intact.
 */
import { EpubError, parseEpub, readEpubParagraphs, type EpubBook, type EpubLayout, type InlineMark } from '@temporis/book-parser';
import type { ParseRequest, ParseResponse } from './parse-worker';

export type PartialRead = { paragraphs: string[]; marks: Record<number, InlineMark[]> };

export interface ParseJob {
  /** The ranges asked for in `read`, in order (rejects if they couldn't be read). */
  partial: Promise<PartialRead[]> | null;
  book: Promise<EpubBook>;
}

interface Job {
  request: ParseRequest;
  partial?: { resolve: (parts: PartialRead[]) => void; reject: (err: Error) => void };
  book: { resolve: (book: EpubBook) => void; reject: (err: Error) => void };
}

let worker: Worker | null = null;
let state: 'starting' | 'ready' | 'broken' = typeof Worker === 'undefined' ? 'broken' : 'starting';
let nextId = 0;
const waiting: Job[] = [];
const running = new Map<number, Job>();

/**
 * E2E tests set this to a promise to hold back whole-book results (not the first chapters), so the
 * partly loaded state can be checked. Unused otherwise.
 */
declare global {
  interface Window {
    __holdBookParse?: Promise<void>;
  }
}
const held = <T>(value: T): Promise<T> => (globalThis.window?.__holdBookParse ?? Promise.resolve()).then(() => value);

const toError = ({ epub, message }: { epub: boolean; message: string }) => (epub ? new EpubError(message) : new Error(message));

function startWorker(): void {
  if (worker || state === 'broken') return;
  try {
    worker = new Worker(new URL('./parse-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    giveUp();
    return;
  }
  worker.onmessage = (event: MessageEvent<ParseResponse>) => {
    const message = event.data;
    if ('ready' in message) {
      state = 'ready';
      for (const job of waiting.splice(0)) send(job);
      return;
    }
    const job = running.get(message.id);
    if (!job) return;
    if ('partial' in message) job.partial?.resolve(message.partial);
    else if ('partialError' in message) job.partial?.reject(new EpubError(message.partialError));
    else {
      running.delete(message.id);
      if ('book' in message) void held(message.book).then(job.book.resolve);
      else job.book.reject(toError(message.error));
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    if (state === 'starting') return giveUp();
    // Crashed mid-job: the bytes are gone with it, so those jobs fail (opening again retries).
    for (const job of running.values()) {
      job.partial?.reject(new Error('The EPUB couldn’t be read'));
      job.book.reject(new Error('The EPUB couldn’t be read'));
    }
    running.clear();
    worker?.terminate();
    worker = null;
    state = 'starting';
  };
}

/** No worker: what was waiting (bytes untouched) runs here. */
function giveUp(): void {
  state = 'broken';
  worker?.terminate();
  worker = null;
  for (const job of waiting.splice(0)) runHere(job);
}

function send(job: Job): void {
  running.set(job.request.id, job);
  const { bytes } = job.request;
  // Transfer the buffer; a view onto part of a bigger one is copied out first.
  const owned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  worker!.postMessage({ ...job.request, bytes: owned }, [owned.buffer]);
}

async function runHere({ request: { bytes, title, read }, partial, book }: Job): Promise<void> {
  if (read && partial) {
    try {
      const parts = [];
      for (const [from, to] of read.ranges) parts.push(await readEpubParagraphs(bytes, read.layout, from, to));
      partial.resolve(parts);
    } catch (err) {
      partial.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
  parseEpub(bytes, title).then(held).then(book.resolve, book.reject);
}

/**
 * Parses an EPUB off the main thread; with `read`, those paragraph ranges come back first (from the
 * spine documents they're in), then the whole book. Takes ownership of `bytes`.
 */
export function parseEpubOffThread(bytes: Uint8Array, title: string, read?: ParseRequest['read']): ParseJob {
  let job!: Job;
  const book = new Promise<EpubBook>((resolve, reject) => {
    job = { request: { id: nextId++, bytes, title, read }, book: { resolve, reject } };
  });
  const partial = read ? new Promise<PartialRead[]>((resolve, reject) => (job.partial = { resolve, reject })) : null;
  // Callers that only want the book shouldn't see an unhandled rejection from the partial read.
  partial?.catch(() => undefined);

  startWorker();
  if (state === 'broken') void runHere(job);
  else if (state === 'ready') send(job);
  else waiting.push(job);
  return { partial, book };
}

export type { EpubLayout };
