/**
 * Paginated reader. One chapter is rendered at a time into a CSS multi-column flow whose
 * columns are exactly one page wide; turning a page translates the flow by one page width.
 * Paragraphs are text nodes plus <strong>/<em> for markdown styling; offsets are always into the
 * paragraph's plain text (its textContent).
 */
import { saveProgress, type OpenBook, type Progress } from '../books/library';
import { getLanguage } from '../languages';
import { keyedWords } from '../languages/word-keys';
import type { LanguageModule, LookupResult } from '../languages/types';
import { IntlWordSegmenter } from '../segmentation/intl';
import { charIndexOfWord, wordIndexAt, type WordSegmenter } from '../segmentation/types';
import { getSettings, onSettingsChange } from '../settings';
import { el, toast } from '../ui/dom';
import { icon, iconButton } from '../ui/icons';
import { KNOWN, knownWords, wordsToMarkKnown } from '../vocab/known-words';
import { openChapterList } from './chapter-list';
import { blockOffset, charRange, clearHighlight, highlightsSupported, renderInline, setHighlight } from './dom-text';
import { remindAboutLanguage } from './language-reminder';
import { MIN_PAGE_DWELL_MS, offerMarkKnown } from './mark-known';
import { LookupPopup } from './popup';
import { globalOffset, guessCharsPerPage, locateOffset, type Located } from './scrub';
import { BookScrubber } from './scrubber';
import { statusButtons, updateLevelOnLookup } from './word-status';

const MARGIN_X = 20;
const MARGIN_Y = 16;
const TAP_SLOP = 10;
const SWIPE_THRESHOLD = 50;
const SAVE_DELAY = 400;

/** A place in the current chapter. */
interface Position {
  paragraph: number;
  char: number;
}

interface Gesture {
  x: number;
  y: number;
  dragging: boolean;
  /** The pointer went down while the lookup popup was open: a tap only closes it. */
  dismissing: boolean;
}

interface CaretDocument {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

const fallbackSegmenter = new IntlWordSegmenter();

export interface ReaderCallbacks {
  onExit(): void;
  /** `language`: open that language's page in Settings. */
  onOpenSettings(language?: string): void;
  onEditBook(id: string): void;
}

export class Reader {
  readonly root: HTMLElement;
  private readonly area: HTMLElement;
  private readonly flow: HTMLElement;
  private readonly pageCountEl: HTMLElement;
  private readonly chapterCountEl: HTMLElement;
  private readonly bookTitle: HTMLElement;
  private readonly chapterTitle: HTMLElement;
  private readonly popup: LookupPopup;

  private book: OpenBook | null = null;
  private lang: LanguageModule | null = null;
  private chapterIndex = 0;
  private page = 0;
  private pageCount = 1;
  private stride = 1;
  private blocks: HTMLElement[] = [];
  private position: Position = { paragraph: 0, char: 0 };
  private pendingSave: Progress | null = null;
  private saveTimer: number | undefined;
  private lookupSeq = 0;
  /** When the current page was turned to, and the words looked up on it since. */
  private pageShownAt = Date.now();
  private readonly pageLookups = new Set<string>();
  private gesture: Gesture | null = null;
  private layoutSize = '';
  private relayoutTimer: number | undefined;
  private readonly scrubber: BookScrubber;
  /** The page indicator, which opens the scrubber. */
  private readonly indicator: HTMLButtonElement;
  /** Cached per layout (chapter + page size + text size). */
  private cachedCharsPerPage: number | null = null;
  private unsubscribeKnown: (() => void) | null = null;
  /** A move to a chapter that is still loading (big books load in the background), done when it arrives. */
  private waitingFor: (() => void) | null = null;

  constructor(private readonly callbacks: ReaderCallbacks) {
    this.bookTitle = el('div', { class: 'book-title' });
    this.chapterTitle = el('div', { class: 'chapter-title' });
    this.flow = el('div', { class: 'page-flow' });
    this.area = el('div', { class: 'page-area' }, this.flow);
    const pageWrap = el('div', { class: 'page-wrap' }, this.area);
    this.popup = new LookupPopup(pageWrap);
    this.pageCountEl = el('span', { class: 'page-count' });
    this.chapterCountEl = el('span', { class: 'chapter-count' });
    const indicator = el(
      'button',
      { type: 'button', class: 'page-indicator', 'aria-expanded': 'false', 'aria-label': 'Book position' },
      // A pill with a chevron, so it reads as a control that opens the book scrubber. While the
      // rest of a big book loads, a spinner takes the chevron's place and the button is disabled.
      el(
        'span',
        { class: 'indicator-pill' },
        el('span', { class: 'indicator-text' }, this.pageCountEl, this.chapterCountEl),
        icon('up'),
        el('span', { class: 'spinner', 'aria-hidden': 'true' }),
      ),
    ) as HTMLButtonElement;
    this.indicator = indicator;
    indicator.addEventListener('click', () => this.scrubber.toggle());
    this.scrubber = new BookScrubber(
      {
        state: () => ({ book: this.book, chapterIndex: this.chapterIndex, page: this.page, pageCount: this.pageCount, position: this.position }),
        charsPerPage: () => this.charsPerPage(),
        jumpTo: (target, offset) => this.jumpTo(target, offset),
      },
      indicator,
    );
    pageWrap.append(this.scrubber.el);

    this.root = el(
      'section',
      { class: 'view reader', hidden: true },
      el(
        'header',
        { class: 'bar top' },
        iconButton('back', 'Library', () => callbacks.onExit()),
        el('div', { class: 'bar-title' }, this.bookTitle, this.chapterTitle),
        iconButton('list', 'Chapters', () => {
          if (this.book) openChapterList(this.book, this.lang, this.chapterIndex, (i) => this.jumpToChapter(i));
        }),
        iconButton('settings', 'Settings', () => callbacks.onOpenSettings()),
      ),
      pageWrap,
      el('footer', { class: 'bar bottom' }, indicator),
    );

    this.bindGestures();
    new ResizeObserver(() => this.scheduleRelayout()).observe(this.area);
    onSettingsChange((_, changed) => {
      if (changed.fontSize !== undefined) this.relayout();
      if (changed.highlightWords !== undefined) this.refreshWordHighlights();
    });
    document.addEventListener('keydown', (e) => {
      if (this.root.hidden || !this.book || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') {
        if (this.scrubber.isOpen) this.scrubber.toggle(false);
        else this.closeLookup();
        return;
      }
      if (e.target instanceof HTMLInputElement) return; // arrow keys move the scrubber
      if (e.key === 'ArrowRight' || e.key === 'PageDown') this.next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.prev();
    });
  }

  /** Call after the reader view is visible so layout can be measured. */
  open(book: OpenBook): void {
    this.book = book;
    this.lang = getLanguage(book.meta.language);
    for (const dictionary of this.lang?.dictionaries ?? []) void dictionary.ensureLoaded().then(() => this.refreshWordHighlights());
    if (this.lang) {
      const store = knownWords(this.lang.id);
      this.unsubscribeKnown = store.onChange(() => this.refreshWordHighlights());
      void store.load();
    }
    this.bookTitle.textContent = book.meta.title;

    const saved = book.meta.progress;
    const chapter = saved && saved.chapter < book.index.chapters.length ? saved.chapter : 0;
    this.renderChapter(chapter);
    if (saved && saved.chapter === chapter) this.goTo(this.positionFromProgress(saved));
    else this.setPage(0);
    this.startPageVisit();
    void this.checkLanguage(book);
    this.setLoading(!book.complete);
    if (!book.complete) {
      book.whenComplete.then(
        (same) => {
          if (this.book !== book) return;
          this.setLoading(false);
          this.root.dataset.complete = 'true';
          // The book turned out different from what was shown: start again from its saved place.
          if (!same) this.showSavedPlace(book);
        },
        () => {
          if (this.book !== book) return;
          this.setLoading(false);
          toast('The rest of the book couldn’t be loaded');
        },
      );
    } else this.root.dataset.complete = 'true';
  }

  /** While the rest of a big book loads, the scrubber can't be opened (its button shows a spinner). */
  private setLoading(loading: boolean): void {
    this.indicator.disabled = loading;
    this.indicator.classList.toggle('loading', loading);
    this.indicator.setAttribute('aria-busy', String(loading));
    this.indicator.setAttribute('aria-label', loading ? 'Book position (loading the rest of the book)' : 'Book position');
    if (loading) this.scrubber.toggle(false);
  }

  private showSavedPlace(book: OpenBook): void {
    const saved = book.meta.progress;
    const chapter = saved && saved.chapter < book.index.chapters.length ? saved.chapter : 0;
    this.renderChapter(chapter);
    if (saved && saved.chapter === chapter) this.goTo(this.positionFromProgress(saved));
    else this.setPage(0);
  }

  /**
   * True if chapter `index` can be shown now. Otherwise (a big book still loading) `retry` runs once
   * the whole book is loaded, unless another move replaced it.
   */
  private chapterReady(index: number, retry: () => void): boolean {
    const book = this.book!;
    if (book.hasChapter(index)) return true;
    this.waitingFor = retry;
    toast('Loading the rest of the book…');
    void book.whenComplete.then(() => {
      if (this.book !== book || this.waitingFor !== retry) return;
      this.waitingFor = null;
      retry();
    });
    return false;
  }

  /** Reminds about a missing or unsupported language; data-language-check lets tests wait for it. */
  private async checkLanguage(book: OpenBook): Promise<void> {
    this.root.dataset.languageCheck = 'pending';
    try {
      await remindAboutLanguage(book, this.lang, {
        onEditBook: (id) => this.callbacks.onEditBook(id),
        onOpenSettings: (language) => this.callbacks.onOpenSettings(language),
        stillOpen: () => this.book === book,
      });
    } finally {
      this.root.dataset.languageCheck = 'done';
    }
  }

  async close(): Promise<void> {
    delete this.root.dataset.languageCheck;
    delete this.root.dataset.complete;
    this.waitingFor = null;
    this.setLoading(false);
    this.unsubscribeKnown?.();
    this.unsubscribeKnown = null;
    this.clearWordHighlights();
    this.scrubber.reset();
    const saved = this.flush();
    this.closeLookup();
    this.book = null;
    this.blocks = [];
    this.flow.replaceChildren();
    await saved;
  }

  /** Handles the Android back button. Returns true if it was consumed. */
  handleBack(): boolean {
    if (this.scrubber.isOpen) {
      this.scrubber.toggle(false);
      return true;
    }
    if (this.popup.isOpen) {
      this.closeLookup();
      return true;
    }
    return false;
  }

  /** Writes pending progress now. Resolves once it is on disk. */
  flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    const pending = this.pendingSave;
    this.pendingSave = null;
    return this.book && pending ? saveProgress(this.book.meta.id, pending) : Promise.resolve();
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  next(): void {
    if (!this.book) return;
    this.scrubber.cancel();
    const atEnd = this.page === this.pageCount - 1 && this.chapterIndex === this.book.index.chapters.length - 1;
    if (atEnd) return this.applyTransform(true);
    if (this.page === this.pageCount - 1 && !this.chapterReady(this.chapterIndex + 1, () => this.next())) return;
    // Collect before the page changes (the next chapter replaces the DOM).
    const unlooked = this.unlookedWordsOnLeavingPage();
    if (this.page < this.pageCount - 1) this.setPage(this.page + 1, true);
    else {
      this.renderChapter(this.chapterIndex + 1);
      this.setPage(0);
    }
    this.startPageVisit();
    if (unlooked) offerMarkKnown(unlooked.language, unlooked.words, this.lang?.htmlLang);
  }

  prev(): void {
    if (!this.book) return;
    this.scrubber.cancel();
    if (this.page === 0 && this.chapterIndex > 0 && !this.chapterReady(this.chapterIndex - 1, () => this.prev())) return;
    if (this.page > 0) this.setPage(this.page - 1, true);
    else if (this.chapterIndex > 0) {
      this.renderChapter(this.chapterIndex - 1);
      this.setPage(this.pageCount - 1);
    } else return this.applyTransform(true);
    this.startPageVisit();
  }

  // ── Jumps (scrubber, chapter list) ───────────────────────────────────────

  /** A jump is not a page turn: no mark-known prompt, and a fresh page visit. */
  private jumpTo(target: Located, offset?: number): void {
    // A chapter still loading had no paragraph offsets: find the place again once it's there.
    const book = this.book!;
    const retry = () => this.jumpTo(offset === undefined ? target : locateOffset(book.index, book.content.length, offset));
    if (!this.chapterReady(target.chapter, retry)) return;
    if (target.chapter !== this.chapterIndex) this.renderChapter(target.chapter);
    this.goTo({ paragraph: target.paragraph, char: target.char });
    this.startPageVisit();
  }

  private jumpToChapter(index: number): void {
    if (!this.book) return;
    this.scrubber.cancel();
    if (!this.chapterReady(index, () => this.jumpToChapter(index))) return;
    this.renderChapter(index);
    this.setPage(0);
    this.startPageVisit();
  }

  /** Characters per page: measured from the current chapter when it spans pages, else guessed from the page size. */
  private charsPerPage(): number {
    this.cachedCharsPerPage ??= this.measureCharsPerPage();
    return this.cachedCharsPerPage;
  }

  private measureCharsPerPage(): number {
    const book = this.book!;
    if (this.pageCount >= 2) {
      const lastPage = this.firstPositionOnPage(this.pageCount - 1);
      const chapterStart = globalOffset(book.index, this.chapterIndex, 0, 0);
      const measured = (globalOffset(book.index, this.chapterIndex, lastPage.paragraph, lastPage.char) - chapterStart) / (this.pageCount - 1);
      if (measured > 0) return measured;
    }
    const fontSize = parseFloat(getComputedStyle(this.flow).fontSize) || 22;
    return guessCharsPerPage(this.area.clientWidth - 2 * MARGIN_X, this.area.clientHeight - 2 * MARGIN_Y, fontSize);
  }

  // ── Mark unlooked-up words as known ──────────────────────────────────────

  private startPageVisit(): void {
    this.pageShownAt = Date.now();
    this.pageLookups.clear();
  }

  /**
   * Words on the page being left that weren't looked up and aren't known yet — or null when the
   * page was read for under MIN_PAGE_DWELL_MS, or when dictionary/known-words data isn't loaded
   * (levels would be unreliable and known words could get their dates reset).
   */
  private unlookedWordsOnLeavingPage(): { language: string; words: string[] } | null {
    const lang = this.lang;
    if (!lang || !getSettings().markKnownPrompt || Date.now() - this.pageShownAt < MIN_PAGE_DWELL_MS) return null;
    const store = knownWords(lang.id);
    if (!store.isLoaded || !lang.ready()) return null;
    const keys = this.wordsOnPage(this.page, lang).flatMap((w) => (w.key === null ? [] : [w.key]));
    const words = wordsToMarkKnown(keys, this.pageLookups, (w) => store.level(w), (key) => key);
    return words.length ? { language: lang.id, words } : null;
  }

  /**
   * Words that start on `page`, in reading order, with their known-words keys (a word split by
   * the page break belongs to the earlier page). Keys use the whole paragraph as context.
   */
  private wordsOnPage(page: number, lang: LanguageModule): { block: HTMLElement; start: number; end: number; key: string | null }[] {
    const words: { block: HTMLElement; start: number; end: number; key: string | null }[] = [];
    const start = this.firstPositionOnPage(page);
    for (let b = start.paragraph; b < this.blocks.length; b++) {
      const block = this.blocks[b];
      if (this.pageOfOffset(block, 0) > page) break;
      for (const word of keyedWords(lang, block.textContent ?? '')) {
        if (b === start.paragraph && word.start < start.char) continue;
        const p = this.pageOfOffset(block, word.start);
        if (p < page) continue;
        if (p > page) break;
        words.push({ block, start: word.start, end: word.end, key: word.key });
      }
    }
    return words;
  }

  // ── Highlighting words that aren't known yet ──────────────────────────────

  /** Tints new (untracked) and learning (0–2) words on the current page, when enabled in settings. */
  private refreshWordHighlights(): void {
    this.clearWordHighlights();
    const lang = this.lang;
    if (!highlightsSupported() || !lang || !this.book || this.root.hidden || !getSettings().highlightWords) return;
    const store = knownWords(lang.id);
    if (!lang.ready() || !store.isLoaded) return;

    const fresh: Range[] = [];
    const learning: Range[] = [];
    for (const word of this.wordsOnPage(this.page, lang)) {
      if (word.key === null) continue;
      const level = store.level(word.key);
      if (level === KNOWN) continue;
      const range = charRange(word.block, word.start, word.end);
      if (range) (level === undefined ? fresh : learning).push(range);
    }
    setHighlight('word-new', fresh);
    setHighlight('word-learning', learning);
  }

  private clearWordHighlights(): void {
    clearHighlight('word-new', 'word-learning');
  }

  // ── Pages ────────────────────────────────────────────────────────────────

  private setPage(page: number, animate = false, keep?: Position): void {
    this.page = Math.max(0, Math.min(page, this.pageCount - 1));
    this.applyTransform(animate);
    this.closeLookup();
    this.position = keep ?? this.firstPositionOnPage(this.page);
    this.updateChrome();
    this.scrubber.sync();
    this.refreshWordHighlights();
    this.scheduleSave();
  }

  private goTo(position: Position): void {
    const block = this.blocks[position.paragraph];
    if (!block) return this.setPage(0);
    this.setPage(this.pageOfOffset(block, position.char), false, position);
  }

  private applyTransform(animate: boolean, dragOffset = 0): void {
    this.flow.style.transition = animate ? 'transform 220ms ease-out' : 'none';
    this.flow.style.transform = `translate3d(${-this.page * this.stride + dragOffset}px, 0, 0)`;
  }

  private updateChrome(): void {
    if (!this.book) return;
    const chapters = this.book.index.chapters;
    this.pageCountEl.textContent = `${this.page + 1} / ${this.pageCount}`;
    this.chapterCountEl.textContent = chapters.length > 1 ? `Chapter ${this.chapterIndex + 1} of ${chapters.length}` : '';
    this.chapterTitle.textContent = chapters.length > 1 ? chapters[this.chapterIndex].title : '';
  }

  // ── Rendering & pagination ───────────────────────────────────────────────

  private renderChapter(index: number): void {
    const book = this.book!;
    const chapter = book.index.chapters[index];
    this.chapterIndex = index;
    this.blocks = [];
    for (let p = chapter.start; p < chapter.end; p++) {
      const block = el(book.isHeading(p) ? 'h2' : 'p', { 'data-block': String(p - chapter.start) });
      // The break's * * * is drawn by CSS: it isn't text (no lookups, not counted).
      if (book.opensScene(p)) block.classList.add('new-scene');
      block.append(...renderInline(book.paragraph(p), book.marks(p)));
      this.blocks.push(block);
    }
    this.flow.lang = this.lang?.htmlLang ?? '';
    this.flow.replaceChildren(...this.blocks);
    this.layout();
  }

  private layout(): void {
    const width = this.area.clientWidth;
    const height = this.area.clientHeight;
    if (!width || !height) return;
    const columnWidth = width - 2 * MARGIN_X;
    Object.assign(this.flow.style, {
      left: `${MARGIN_X}px`,
      top: `${MARGIN_Y}px`,
      width: `${columnWidth}px`,
      height: `${height - 2 * MARGIN_Y}px`,
      columnWidth: `${columnWidth}px`,
      columnGap: `${2 * MARGIN_X}px`,
    });
    this.stride = width;
    this.cachedCharsPerPage = null;
    this.layoutSize = `${width}x${height}`;
    this.pageCount = this.computePageCount();
  }

  private computePageCount(): number {
    const last = this.blocks.at(-1);
    if (!last) return 1;
    const rects = last.getClientRects();
    if (!rects.length) return 1;
    return this.pageOfX(rects[rects.length - 1].left) + 1;
  }

  /** Re-paginates (rotation, font size…) keeping the current reading position on screen. */
  private relayout(): void {
    if (!this.book || this.root.hidden) return;
    const position = this.position;
    this.layout();
    this.goTo(position);
  }

  private scheduleRelayout(): void {
    clearTimeout(this.relayoutTimer);
    this.relayoutTimer = window.setTimeout(() => {
      const size = `${this.area.clientWidth}x${this.area.clientHeight}`;
      if (size !== this.layoutSize) this.relayout();
    }, 100);
  }

  private pageOfX(x: number): number {
    const flowLeft = this.flow.getBoundingClientRect().left;
    return Math.max(0, Math.floor((x - flowLeft + MARGIN_X) / this.stride));
  }

  private get segmenter(): WordSegmenter {
    return this.lang?.segmenter ?? fallbackSegmenter;
  }

  private pageOfOffset(block: HTMLElement, offset: number): number {
    const length = block.textContent?.length ?? 0;
    for (let o = Math.max(0, Math.min(offset, length - 1)); o < length; o++) {
      const rect = charRange(block, o)?.getClientRects()[0];
      if (rect) return this.pageOfX(rect.left);
    }
    const rect = block.getClientRects()[0];
    return rect ? this.pageOfX(rect.left) : 0;
  }

  /** First character shown on `page`, found by binary search over blocks then characters. */
  private firstPositionOnPage(page: number): Position {
    const blocks = this.blocks;
    if (!blocks.length) return { paragraph: 0, char: 0 };

    let lo = 0;
    let hi = blocks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pageOfOffset(blocks[mid], 0) >= page) hi = mid;
      else lo = mid + 1;
    }

    // The block before may continue onto this page.
    if (lo > 0) {
      const block = blocks[lo - 1];
      const length = block.textContent?.length ?? 0;
      if (length && this.pageOfOffset(block, length - 1) >= page) {
        let a = 0;
        let b = length - 1;
        while (a < b) {
          const mid = (a + b) >> 1;
          if (this.pageOfOffset(block, mid) >= page) b = mid;
          else a = mid + 1;
        }
        return { paragraph: lo - 1, char: a };
      }
    }
    return { paragraph: Math.min(lo, blocks.length - 1), char: 0 };
  }

  // ── Progress ─────────────────────────────────────────────────────────────

  private positionFromProgress(progress: Progress): Position {
    const paragraph = Math.max(0, Math.min(progress.paragraph, this.blocks.length - 1));
    const text = this.blocks[paragraph]?.textContent ?? '';
    const char = progress.char <= text.length ? progress.char : charIndexOfWord(this.segmenter, text, progress.word);
    return { paragraph, char };
  }

  private scheduleSave(): void {
    const book = this.book;
    if (!book) return;
    const { paragraph, char } = this.position;
    const text = this.blocks[paragraph]?.textContent ?? '';
    const chapter = book.index.chapters[this.chapterIndex];
    const global = chapter.start + paragraph;
    const progress: Progress = {
      chapter: this.chapterIndex,
      source: chapter.source,
      sourceChapter: chapter.sourceChapter,
      paragraph,
      word: wordIndexAt(this.segmenter, text, char),
      char,
      fraction: Math.min(1, (book.index.paragraphOffsets[global] + char) / Math.max(1, book.content.length)),
      updatedAt: Date.now(),
    };
    book.meta.progress = progress;
    this.pendingSave = progress;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), SAVE_DELAY);
  }

  // ── Gestures ─────────────────────────────────────────────────────────────

  private bindGestures(): void {
    const area = this.area;
    // Any press outside the open popup closes it (header, footer and text alike). Runs before the
    // page area's own handler, which then treats the press as a dismissal rather than a new lookup.
    let dismissing = false;
    this.root.addEventListener(
      'pointerdown',
      (e) => {
        dismissing = this.popup.isOpen && !this.popup.el.contains(e.target as Node);
        if (dismissing) this.closeLookup();
      },
      { capture: true },
    );
    area.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || !this.book) return;
      this.gesture = { x: e.clientX, y: e.clientY, dragging: false, dismissing };
    });
    area.addEventListener('pointermove', (e) => {
      const g = this.gesture;
      if (!g) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (!g.dragging && Math.abs(dx) > TAP_SLOP && Math.abs(dx) > Math.abs(dy)) {
        g.dragging = true;
        this.closeLookup();
      }
      if (g.dragging) this.applyTransform(false, dx);
    });
    area.addEventListener('pointerup', (e) => {
      const g = this.gesture;
      this.gesture = null;
      if (!g) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (g.dragging) {
        if (Math.abs(dx) > SWIPE_THRESHOLD) {
          if (dx < 0) this.next();
          else this.prev();
        } else this.applyTransform(true);
      } else if (Math.hypot(dx, dy) < TAP_SLOP && !g.dismissing) {
        void this.onTap(e.clientX, e.clientY);
      }
    });
    area.addEventListener('pointercancel', () => {
      if (this.gesture?.dragging) this.applyTransform(true);
      this.gesture = null;
    });
  }

  // ── Lookup ───────────────────────────────────────────────────────────────

  private hitTest(x: number, y: number): { block: number; offset: number } | null {
    const doc = document as unknown as CaretDocument;
    let node: Node | null = null;
    let offset = 0;
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y);
      node = pos?.offsetNode ?? null;
      offset = pos?.offset ?? 0;
    } else if (doc.caretRangeFromPoint) {
      const range = doc.caretRangeFromPoint(x, y);
      node = range?.startContainer ?? null;
      offset = range?.startOffset ?? 0;
    }
    if (!(node instanceof Text) || !this.flow.contains(node)) return null;
    const block = node.parentElement?.closest<HTMLElement>('[data-block]');
    const index = Number(block?.dataset.block);
    if (!block || Number.isNaN(index)) return null;
    const at = blockOffset(block, node, offset);

    // The caret may sit before or after the tapped character; pick the one under the finger.
    for (const o of [at, at - 1]) {
      if (o < 0) continue;
      const r = charRange(block, o)?.getBoundingClientRect();
      if (r && x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 4 && y <= r.bottom + 4) return { block: index, offset: o };
    }
    return null;
  }

  private async onTap(x: number, y: number): Promise<void> {
    const hit = this.hitTest(x, y);
    const lang = this.lang;
    if (!hit || !lang) return this.closeLookup();

    const block = this.blocks[hit.block];
    const text = block.textContent ?? '';
    const seq = ++this.lookupSeq;

    if (!lang.ready()) {
      const anchor = charRange(block, hit.offset)?.getBoundingClientRect();
      if (anchor) this.popup.show(el('p', { class: 'lookup-notice' }, 'Loading dictionary…'), anchor);
    }

    let result: LookupResult | null;
    try {
      result = await lang.lookup(text, hit.offset);
    } catch (err) {
      console.error('Lookup failed', err);
      result = null;
    }
    if (seq !== this.lookupSeq) return; // superseded by another tap or a page turn
    if (!result) return this.closeLookup();
    this.pageLookups.add(result.headword);

    const range = charRange(block, result.start, result.end);
    if (!range) return this.closeLookup();
    setHighlight('lookup', [range], 1); // above the new/learning tints
    const anchor = range.getClientRects()[0] ?? range.getBoundingClientRect();
    if (!result.entries.length) return this.popup.show(this.renderNotice(result), anchor);
    if (result.untracked) return this.popup.show(lang.renderEntries(result), anchor, result.source);
    await updateLevelOnLookup(lang.id, result.headword);
    if (seq !== this.lookupSeq) return;
    const status = await statusButtons(lang.id, result.headword);
    if (seq !== this.lookupSeq) return;
    this.popup.show(lang.renderEntries(result), anchor, result.source, status);
  }

  private renderNotice(result: LookupResult): HTMLElement {
    const missing = result.notice?.kind === 'missing-dictionary';
    const settingsButton = missing ? el('button', { type: 'button', class: 'button' }, 'Open settings') : null;
    settingsButton?.addEventListener('click', () => this.callbacks.onOpenSettings(this.lang?.id));
    return el(
      'div',
      { class: 'lookup-notice' },
      el('div', { class: 'notice-word', lang: this.lang?.htmlLang }, result.headword),
      el('p', {}, result.notice?.message ?? 'No dictionary entry found.'),
      settingsButton,
    );
  }

  private closeLookup(): void {
    this.lookupSeq++;
    this.popup.hide();
    clearHighlight('lookup');
  }
}
