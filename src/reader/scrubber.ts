/**
 * The book-wide position slider opened from the footer. Dragging only estimates the page from the
 * page size (no pagination); the reader jumps — and paginates that one chapter — once the thumb
 * has been still for SCRUB_SETTLE_MS.
 */
import type { OpenBook } from '../books/library';
import { el } from '../ui/dom';
import { chapterStartOffsets, estimatePage, globalOffset, locateOffset, type Located } from './scrub';

/** The scrubber jumps once the thumb has been still this long (pagination only happens then). */
export const SCRUB_SETTLE_MS = 1_000;

/** Where the reader is now. */
export interface ReaderState {
  book: OpenBook | null;
  chapterIndex: number;
  page: number;
  pageCount: number;
  position: { paragraph: number; char: number };
}

/** What the scrubber needs from the reader. */
export interface ScrubberHost {
  state(): ReaderState;
  /** Characters per page, for estimates while dragging. */
  charsPerPage(): number;
  /** Go to the settled position (renders and paginates the chapter). */
  /** `offset`: the book-wide character offset `target` was found from. */
  jumpTo(target: Located, offset: number): void;
}

export class BookScrubber {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly label: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly ticks: HTMLElement;
  private ticksForBook: OpenBook | null = null;
  private chapterStarts: number[] = [];
  private pending: { target: Located; offset: number } | null = null;
  private timer: number | undefined;

  /** `indicator`: the footer button that toggles the scrubber (kept in sync via aria-expanded). */
  constructor(
    private readonly host: ScrubberHost,
    private readonly indicator: HTMLElement,
  ) {
    this.label = el('div', { class: 'scrub-label' });
    this.detail = el('div', { class: 'scrub-detail' });
    this.ticks = el('div', { class: 'scrub-ticks', 'aria-hidden': 'true' });
    this.input = el('input', { type: 'range', min: '0', step: '1', class: 'scrub-range', 'aria-label': 'Position in book' });
    this.input.addEventListener('input', () => this.onInput());
    this.el = el(
      'div',
      { class: 'scrubber', hidden: true, role: 'group', 'aria-label': 'Book position' },
      el('div', { class: 'scrub-text', 'aria-live': 'polite' }, this.label, this.detail),
      el('div', { class: 'scrub-track' }, this.ticks, this.input),
    );
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.isOpen): void {
    const { book } = this.host.state();
    if (!book) return;
    if (!open) {
      this.commit(); // a pending jump still happens when the scrubber is closed
      this.el.hidden = true;
      this.indicator.setAttribute('aria-expanded', 'false');
      return;
    }
    if (this.ticksForBook !== book) this.renderTicks(book);
    this.el.hidden = false;
    this.indicator.setAttribute('aria-expanded', 'true');
    this.sync();
  }

  /** Closed, nothing pending, ticks rebuilt for the next book. */
  reset(): void {
    this.cancel();
    this.el.hidden = true;
    this.indicator.setAttribute('aria-expanded', 'false');
    this.ticksForBook = null;
  }

  /** Drops a pending jump (the reader moved by other means). */
  cancel(): void {
    clearTimeout(this.timer);
    this.pending = null;
  }

  /** Shows the current (exact) position, unless a jump is pending. */
  sync(): void {
    const { book, chapterIndex, page, pageCount, position } = this.host.state();
    if (!book || !this.isOpen || this.pending) return;
    const offset = globalOffset(book.index, chapterIndex, position.paragraph, position.char);
    this.input.value = String(offset);
    this.setText(book, chapterIndex, `Page ${page + 1} of ${pageCount}`, offset);
  }

  /** Slider range and chapter-break ticks; once per opened book. */
  private renderTicks(book: OpenBook): void {
    const length = Math.max(1, book.content.length);
    this.input.max = String(length);
    this.chapterStarts = chapterStartOffsets(book.index);
    this.ticks.replaceChildren(
      ...this.chapterStarts.slice(1).map((offset) => el('span', { class: 'scrub-tick', style: `left: ${((offset / length) * 100).toFixed(3)}%` })),
    );
    this.ticksForBook = book;
  }

  private setText(book: OpenBook, chapter: number, pageText: string, offset: number): void {
    const chapters = book.index.chapters;
    const percent = Math.round((offset / Math.max(1, book.content.length)) * 100);
    this.label.textContent = chapters.length > 1 ? `Chapter ${chapter + 1} of ${chapters.length} · ${chapters[chapter].title}` : chapters[chapter].title;
    this.detail.textContent = `${pageText} · ${percent}%`;
  }

  /** While dragging: only estimate. The jump (and pagination) waits until the thumb settles. */
  private onInput(): void {
    const { book } = this.host.state();
    if (!book) return;
    const offset = Number(this.input.value);
    const target = locateOffset(book.index, book.content.length, offset);
    const starts = this.chapterStarts;
    const chapterEnd = starts[target.chapter + 1] ?? book.content.length;
    const { page, pages } = estimatePage(offset - starts[target.chapter], chapterEnd - starts[target.chapter], this.host.charsPerPage());
    this.setText(book, target.chapter, `Page ≈${page} of ≈${pages}`, offset);

    this.pending = { target, offset };
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.commit(), SCRUB_SETTLE_MS);
  }

  private commit(): void {
    clearTimeout(this.timer);
    const pending = this.pending;
    this.pending = null;
    if (!pending || !this.host.state().book) return;
    this.host.jumpTo(pending.target, pending.offset);
    this.sync();
  }
}
