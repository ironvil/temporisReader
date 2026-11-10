/**
 * Paginated reader. One chapter is rendered at a time into a CSS multi-column flow whose
 * columns are exactly one page wide; turning a page translates the flow by one page width.
 * Paragraphs are text nodes plus <strong>/<em> for markdown styling; offsets are always into the
 * paragraph's plain text (its textContent).
 */
import { saveProgress, type OpenBook, type Progress } from '../books/library';
import type { InlineMark } from '../books/parse';
import { getLanguage } from '../languages';
import type { LanguageModule, LookupResult } from '../languages/types';
import { IntlWordSegmenter } from '../segmentation/intl';
import { charIndexOfWord, wordIndexAt, type WordSegmenter } from '../segmentation/types';
import { getSettings, onSettingsChange } from '../settings';
import { el } from '../ui/dom';
import { iconButton } from '../ui/icons';
import { openDialog } from '../ui/dialog';
import { toast } from '../ui/dom';
import { bookWordCounts, formatShare, knownShare } from '../vocab/book-stats';
import { KNOWN, knownWords, LEVELS, wordsToMarkKnown, type Level } from '../vocab/known-words';
import { LookupPopup } from './popup';
import { chapterStartOffsets, estimatePage, globalOffset, guessCharsPerPage, locateOffset, type Located } from './scrub';

const MARGIN_X = 20;
const MARGIN_Y = 16;
const TAP_SLOP = 10;
const SWIPE_THRESHOLD = 50;
const SAVE_DELAY = 400;
/** Pages read for less than this are skipped by the "mark unlooked-up words as known" prompt. */
export const MIN_PAGE_DWELL_MS = 10_000;
/** The scrubber jumps once the thumb has been still this long (pagination only happens then). */
export const SCRUB_SETTLE_MS = 1_000;

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

interface HighlightRegistry {
  set(name: string, value: unknown): void;
  delete(name: string): void;
}

/** Paragraph plain text + bold/italic ranges → DOM nodes. */
export function renderInline(text: string, marks: InlineMark[]): Node[] {
  if (!marks.length) return [document.createTextNode(text)];
  const cuts = [...new Set([0, text.length, ...marks.flatMap(([a, b]) => [a, b])])].sort((a, b) => a - b);
  const nodes: Node[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const [a, b] = [cuts[k], cuts[k + 1]];
    let node: Node = document.createTextNode(text.slice(a, b));
    const active = new Set(marks.filter(([s, e]) => s <= a && e >= b).map(([, , kind]) => kind));
    if (active.has('i')) node = el('em', {}, node);
    if (active.has('b')) node = el('strong', {}, node);
    nodes.push(node);
  }
  return nodes;
}

/** Text node and local offset for a paragraph-level offset. */
function domPosition(block: HTMLElement, offset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (offset < node.length) return { node, offset };
    offset -= node.length;
    last = node;
  }
  return last ? { node: last, offset: last.length } : null;
}

/** Paragraph-level offset for a position inside one of the block's text nodes. */
function blockOffset(block: HTMLElement, target: Text, offset: number): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node === target) return total + offset;
    total += node.length;
  }
  return total;
}

const fallbackSegmenter = new IntlWordSegmenter();

export interface ReaderCallbacks {
  onExit(): void;
  /** `language`: scroll Settings to that language's card. */
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
  private readonly indicator: HTMLButtonElement;
  private readonly scrubber: HTMLElement;
  private readonly scrubInput: HTMLInputElement;
  private readonly scrubLabel: HTMLElement;
  private readonly scrubDetail: HTMLElement;
  private readonly scrubTicks: HTMLElement;
  private ticksForBook: OpenBook | null = null;
  private chapterStarts: number[] = [];
  /** Cached per layout (chapter + page size + text size). */
  private cachedCharsPerPage: number | null = null;
  private pendingScrub: Located | null = null;
  private scrubTimer: number | undefined;
  private unsubscribeKnown: (() => void) | null = null;

  constructor(private readonly callbacks: ReaderCallbacks) {
    this.bookTitle = el('div', { class: 'book-title' });
    this.chapterTitle = el('div', { class: 'chapter-title' });
    this.flow = el('div', { class: 'page-flow' });
    this.area = el('div', { class: 'page-area' }, this.flow);
    const pageWrap = el('div', { class: 'page-wrap' }, this.area);
    this.popup = new LookupPopup(pageWrap);
    this.pageCountEl = el('span', { class: 'page-count' });
    this.chapterCountEl = el('span', { class: 'chapter-count' });
    this.indicator = el(
      'button',
      { type: 'button', class: 'page-indicator', 'aria-expanded': 'false', 'aria-label': 'Book position' },
      this.pageCountEl,
      this.chapterCountEl,
    );
    this.indicator.addEventListener('click', () => this.toggleScrubber());
    const indicator = this.indicator;

    this.scrubLabel = el('div', { class: 'scrub-label' });
    this.scrubDetail = el('div', { class: 'scrub-detail' });
    this.scrubTicks = el('div', { class: 'scrub-ticks', 'aria-hidden': 'true' });
    this.scrubInput = el('input', { type: 'range', min: '0', step: '1', class: 'scrub-range', 'aria-label': 'Position in book' });
    this.scrubInput.addEventListener('input', () => this.onScrub());
    this.scrubber = el(
      'div',
      { class: 'scrubber', hidden: true, role: 'group', 'aria-label': 'Book position' },
      el('div', { class: 'scrub-text', 'aria-live': 'polite' }, this.scrubLabel, this.scrubDetail),
      el('div', { class: 'scrub-track' }, this.scrubTicks, this.scrubInput),
    );
    pageWrap.append(this.scrubber);

    this.root = el(
      'section',
      { class: 'view reader', hidden: true },
      el(
        'header',
        { class: 'bar top' },
        iconButton('back', 'Library', () => callbacks.onExit()),
        el('div', { class: 'bar-title' }, this.bookTitle, this.chapterTitle),
        iconButton('list', 'Chapters', () => this.openChapterList()),
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
        if (!this.scrubber.hidden) this.toggleScrubber(false);
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
    void this.remindAboutLanguage(book);
  }

  /**
   * Every time a book opens: if its language's dictionaries aren't installed, remind the user to
   * add the language; if its language isn't supported (or wasn't detected), say lookups aren't
   * available and offer to change the language.
   */
  private async remindAboutLanguage(book: OpenBook): Promise<void> {
    this.root.dataset.languageCheck = 'pending';
    try {
      const lang = this.lang;
      if (!lang) {
        openDialog({
          title: 'Lookups aren’t available',
          content: [
            el(
              'p',
              {},
              'This book’s language isn’t supported or couldn’t be detected, so words can’t be looked up. If it is in a supported language, set it in the book editor.',
            ),
          ],
          cancelLabel: 'Not now',
          confirmLabel: 'Change language',
          onConfirm: () => this.callbacks.onEditBook(book.meta.id),
        });
        return;
      }
      const states = await Promise.all(lang.dictionaries.map((d) => d.state()));
      if (states.every((s) => s.installed) || this.book !== book) return;
      openDialog({
        title: `Add ${lang.name}?`,
        content: [
          el(
            'p',
            {},
            `This book is in ${lang.name}, but ${lang.name} hasn’t been added yet. Word lookup, highlighting and known-word stats need its dictionary. Add it in Settings → Languages.`,
          ),
        ],
        cancelLabel: 'Not now',
        confirmLabel: 'Open settings',
        onConfirm: () => this.callbacks.onOpenSettings(lang.id),
      });
    } finally {
      this.root.dataset.languageCheck = 'done';
    }
  }

  async close(): Promise<void> {
    delete this.root.dataset.languageCheck;
    this.unsubscribeKnown?.();
    this.unsubscribeKnown = null;
    this.clearWordHighlights();
    this.cancelScrub();
    this.scrubber.hidden = true;
    this.indicator.setAttribute('aria-expanded', 'false');
    this.ticksForBook = null;
    const saved = this.flush();
    this.closeLookup();
    this.book = null;
    this.blocks = [];
    this.flow.replaceChildren();
    await saved;
  }

  /** Handles the Android back button. Returns true if it was consumed. */
  handleBack(): boolean {
    if (!this.scrubber.hidden) {
      this.toggleScrubber(false);
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
    this.cancelScrub();
    const atEnd = this.page === this.pageCount - 1 && this.chapterIndex === this.book.index.chapters.length - 1;
    if (atEnd) return this.applyTransform(true);
    // Collect before the page changes (the next chapter replaces the DOM).
    const unlooked = this.unlookedWordsOnLeavingPage();
    if (this.page < this.pageCount - 1) this.setPage(this.page + 1, true);
    else {
      this.renderChapter(this.chapterIndex + 1);
      this.setPage(0);
    }
    this.startPageVisit();
    if (unlooked) this.offerMarkKnown(unlooked.language, unlooked.words);
  }

  prev(): void {
    if (!this.book) return;
    this.cancelScrub();
    if (this.page > 0) this.setPage(this.page - 1, true);
    else if (this.chapterIndex > 0) {
      this.renderChapter(this.chapterIndex - 1);
      this.setPage(this.pageCount - 1);
    } else return this.applyTransform(true);
    this.startPageVisit();
  }

  // ── Book scrubber ────────────────────────────────────────────────────────

  private toggleScrubber(open = this.scrubber.hidden): void {
    if (!this.book) return;
    if (!open) {
      this.commitScrub(); // a pending jump still happens when the scrubber is closed
      this.scrubber.hidden = true;
      this.indicator.setAttribute('aria-expanded', 'false');
      return;
    }
    if (this.ticksForBook !== this.book) this.renderScrubber(this.book);
    this.scrubber.hidden = false;
    this.indicator.setAttribute('aria-expanded', 'true');
    this.syncScrubber();
  }

  /** Slider range and chapter-break ticks; once per opened book. */
  private renderScrubber(book: OpenBook): void {
    const length = Math.max(1, book.content.length);
    this.scrubInput.max = String(length);
    this.chapterStarts = chapterStartOffsets(book.index);
    this.scrubTicks.replaceChildren(
      ...this.chapterStarts
        .slice(1)
        .map((offset) => el('span', { class: 'scrub-tick', style: `left: ${((offset / length) * 100).toFixed(3)}%` })),
    );
    this.ticksForBook = book;
  }

  /** Shows the current (exact) position, unless a jump is pending. */
  private syncScrubber(): void {
    const book = this.book;
    if (!book || this.scrubber.hidden || this.pendingScrub) return;
    const { paragraph, char } = this.position;
    const offset = globalOffset(book.index, this.chapterIndex, paragraph, char);
    this.scrubInput.value = String(offset);
    this.setScrubText(this.chapterIndex, `Page ${this.page + 1} of ${this.pageCount}`, offset);
  }

  private setScrubText(chapter: number, pageText: string, offset: number): void {
    const book = this.book!;
    const chapters = book.index.chapters;
    const percent = Math.round((offset / Math.max(1, book.content.length)) * 100);
    this.scrubLabel.textContent = chapters.length > 1 ? `Chapter ${chapter + 1} of ${chapters.length} · ${chapters[chapter].title}` : chapters[chapter].title;
    this.scrubDetail.textContent = `${pageText} · ${percent}%`;
  }

  /** While dragging: only estimate. The jump (and pagination) waits until the thumb settles. */
  private onScrub(): void {
    const book = this.book;
    if (!book) return;
    const offset = Number(this.scrubInput.value);
    const target = locateOffset(book.index, book.content.length, offset);
    const starts = this.chapterStarts;
    const chapterEnd = starts[target.chapter + 1] ?? book.content.length;
    const { page, pages } = estimatePage(offset - starts[target.chapter], chapterEnd - starts[target.chapter], this.charsPerPage());
    this.setScrubText(target.chapter, `Page ≈${page} of ≈${pages}`, offset);

    this.pendingScrub = target;
    clearTimeout(this.scrubTimer);
    this.scrubTimer = window.setTimeout(() => this.commitScrub(), SCRUB_SETTLE_MS);
  }

  private commitScrub(): void {
    clearTimeout(this.scrubTimer);
    const target = this.pendingScrub;
    this.pendingScrub = null;
    if (!target || !this.book) return;
    if (target.chapter !== this.chapterIndex) this.renderChapter(target.chapter);
    this.goTo({ paragraph: target.paragraph, char: target.char });
    this.startPageVisit(); // a jump is not a page turn: no mark-known prompt, fresh timer
    this.syncScrubber();
  }

  private cancelScrub(): void {
    clearTimeout(this.scrubTimer);
    this.pendingScrub = null;
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
    const words = wordsToMarkKnown(this.wordsOnPage(this.page), this.pageLookups, (w) => store.level(w), (w) => lang.isTrackable(w));
    return words.length ? { language: lang.id, words } : null;
  }

  /** Words that start on `page`, in reading order (a word split by the page break belongs to the earlier page). */
  private wordsOnPage(page: number): string[] {
    return this.wordSpansOnPage(page).map((w) => w.text);
  }

  private wordSpansOnPage(page: number): { block: HTMLElement; start: number; end: number; text: string }[] {
    const words: { block: HTMLElement; start: number; end: number; text: string }[] = [];
    const start = this.firstPositionOnPage(page);
    for (let b = start.paragraph; b < this.blocks.length; b++) {
      const block = this.blocks[b];
      if (this.pageOfOffset(block, 0) > page) break;
      const text = block.textContent ?? '';
      for (const span of this.segmenter.segment(text)) {
        if (!span.isWord || (b === start.paragraph && span.start < start.char)) continue;
        const p = this.pageOfOffset(block, span.start);
        if (p < page) continue;
        if (p > page) break;
        words.push({ block, start: span.start, end: span.end, text: text.slice(span.start, span.end) });
      }
    }
    return words;
  }

  /** Lists the words as toggles (all selected); only selected words are marked. */
  private offerMarkKnown(language: string, words: string[]): void {
    const n = words.length;
    const selected = new Set(words);
    const chips = words.map((w) => {
      const chip = el('button', { type: 'button', class: 'word-chip', 'aria-pressed': 'true' }, w);
      chip.addEventListener('click', () => {
        if (selected.has(w)) selected.delete(w);
        else selected.add(w);
        chip.setAttribute('aria-pressed', String(selected.has(w)));
        updateConfirm();
      });
      return chip;
    });
    const dialog = openDialog({
      title: 'Mark words as known?',
      content: [
        el('p', {}, `${n} ${n === 1 ? 'word' : 'words'} on the page you just read ${n === 1 ? 'wasn’t' : 'weren’t'} looked up. Tap a word to leave it out.`),
        el('div', { class: 'word-chips', lang: this.lang?.htmlLang }, ...chips),
      ],
      cancelLabel: 'Not now',
      confirmLabel: `Mark ${n} known`,
      onConfirm: async () => {
        const chosen = words.filter((w) => selected.has(w));
        if (!chosen.length) return;
        await knownWords(language).setMany(chosen, KNOWN);
        toast(`Marked ${chosen.length} ${chosen.length === 1 ? 'word' : 'words'} as known`);
      },
    });
    const confirm = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const updateConfirm = () => {
      confirm.textContent = `Mark ${selected.size} known`;
      confirm.disabled = selected.size === 0;
    };
  }

  // ── Highlighting words that aren't known yet ──────────────────────────────

  /** Tints new (untracked) and learning (0–2) words on the current page, when enabled in settings. */
  private refreshWordHighlights(): void {
    this.clearWordHighlights();
    const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const lang = this.lang;
    if (!registry || !HighlightCtor || !lang || !this.book || this.root.hidden || !getSettings().highlightWords) return;
    const store = knownWords(lang.id);
    if (!lang.ready() || !store.isLoaded) return;

    const fresh: Range[] = [];
    const learning: Range[] = [];
    for (const word of this.wordSpansOnPage(this.page)) {
      if (!lang.isTrackable(word.text)) continue;
      const level = store.level(word.text);
      if (level === KNOWN) continue;
      const range = this.charRange(word.block, word.start, word.end);
      if (range) (level === undefined ? fresh : learning).push(range);
    }
    registry.set('word-new', new HighlightCtor(...fresh));
    registry.set('word-learning', new HighlightCtor(...learning));
  }

  private clearWordHighlights(): void {
    const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
    registry?.delete('word-new');
    registry?.delete('word-learning');
  }

  // ── Chapter list ─────────────────────────────────────────────────────────

  private openChapterList(): void {
    const book = this.book;
    if (!book) return;
    const dialog = el('dialog', { class: 'dialog toc', 'aria-label': 'Chapters' });
    const items = book.index.chapters.map((chapter, i) => {
      const button = el(
        'button',
        { type: 'button', class: 'toc-item', 'aria-current': i === this.chapterIndex ? 'true' : undefined },
        el('span', { class: 'toc-number' }, String(i + 1)),
        el('span', { class: 'toc-title' }, chapter.title),
        el('span', { class: 'toc-known', 'data-chapter': String(i) }),
      );
      button.addEventListener('click', () => {
        dialog.close();
        this.jumpToChapter(i);
      });
      return el('li', {}, button);
    });
    const close = iconButton('close', 'Close chapters', () => dialog.close());
    dialog.append(
      el('div', { class: 'toc-head' }, el('div', {}, el('h2', {}, 'Chapters'), el('div', { class: 'toc-book-known' })), close),
      el('ol', { class: 'toc-list' }, ...items),
    );
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    items[this.chapterIndex]?.scrollIntoView({ block: 'center' });
    void this.fillChapterShares(book, dialog);
  }

  private async fillChapterShares(book: OpenBook, dialog: HTMLElement): Promise<void> {
    const lang = this.lang;
    if (!lang) return;
    const store = knownWords(lang.id);
    await store.load();
    const counts = await bookWordCounts(book.meta.id, lang, book);
    if (!counts) return;
    const whole = dialog.querySelector('.toc-book-known');
    if (whole) whole.textContent = `Whole book: ${formatShare(knownShare(counts, (w) => store.level(w)))} of words known`;
    counts.forEach((chapter, i) => {
      const target = dialog.querySelector(`.toc-known[data-chapter="${i}"]`);
      if (target) target.textContent = `${formatShare(knownShare([chapter], (w) => store.level(w)))} known`;
    });
  }

  private jumpToChapter(index: number): void {
    if (!this.book) return;
    this.cancelScrub();
    this.renderChapter(index);
    this.setPage(0);
    this.startPageVisit(); // not a page turn: no mark-known prompt
  }

  private setPage(page: number, animate = false, keep?: Position): void {
    this.page = Math.max(0, Math.min(page, this.pageCount - 1));
    this.applyTransform(animate);
    this.closeLookup();
    this.position = keep ?? this.firstPositionOnPage(this.page);
    this.updateChrome();
    this.syncScrubber();
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

  private charRange(block: HTMLElement, offset: number, end = offset + 1): Range | null {
    const text = block.textContent ?? '';
    if (offset < 0 || offset >= text.length) return null;
    // Don't split surrogate pairs.
    if (end - offset === 1 && /[\uD800-\uDBFF]/.test(text[offset]) && end < text.length) end++;
    const from = domPosition(block, offset);
    const to = domPosition(block, Math.min(end, text.length));
    if (!from || !to) return null;
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  }

  private get segmenter(): WordSegmenter {
    return this.lang?.segmenter ?? fallbackSegmenter;
  }

  private pageOfOffset(block: HTMLElement, offset: number): number {
    const length = block.textContent?.length ?? 0;
    for (let o = Math.max(0, Math.min(offset, length - 1)); o < length; o++) {
      const rect = this.charRange(block, o)?.getClientRects()[0];
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
      const r = this.charRange(block, o)?.getBoundingClientRect();
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
      const anchor = this.charRange(block, hit.offset)?.getBoundingClientRect();
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

    const range = this.charRange(block, result.start, result.end);
    if (!range) return this.closeLookup();
    this.highlight(range);
    const anchor = range.getClientRects()[0] ?? range.getBoundingClientRect();
    if (!result.entries.length) return this.popup.show(this.renderNotice(result), anchor);
    if (getSettings().downgradeOnLookup) await this.downgradeKnown(lang.id, result.headword);
    if (seq !== this.lookupSeq) return;
    const status = await this.statusButtons(lang.id, result.headword);
    if (seq !== this.lookupSeq) return;
    this.popup.show(lang.renderEntries(result), anchor, result.source, status);
  }

  /** A known word that had to be looked up isn't really known: back to 2 (dated today). */
  private async downgradeKnown(language: string, word: string): Promise<void> {
    const store = knownWords(language);
    await store.load();
    if (store.level(word) === KNOWN) await store.set(word, 2);
  }

  /** 0 / 1 / 2 / ✓ buttons; the word's current level is highlighted. Tapping sets it and stamps today. */
  private async statusButtons(language: string, word: string): Promise<HTMLElement> {
    const store = knownWords(language);
    await store.load();
    const row = el('div', { class: 'word-status', role: 'group', 'aria-label': `Status of ${word}` });
    const render = () => {
      const current = store.level(word);
      row.replaceChildren(
        ...LEVELS.map((level: Level) => {
          const known = level === 3;
          const button = el(
            'button',
            {
              type: 'button',
              class: `status-btn${known ? ' known' : ''}`,
              'aria-label': known ? 'Known' : `Level ${level}`,
              'aria-pressed': String(current === level),
            },
            known ? '✓' : String(level),
          );
          button.addEventListener('click', async () => {
            await store.set(word, level);
            render();
          });
          return button;
        }),
      );
    };
    render();
    return row;
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

  private highlight(range: Range): void {
    const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!registry || !HighlightCtor) return;
    const highlight = new HighlightCtor(range) as { priority: number };
    highlight.priority = 1; // above the new/learning tints
    registry.set('lookup', highlight);
  }

  private closeLookup(): void {
    this.lookupSeq++;
    this.popup.hide();
    (CSS as unknown as { highlights?: HighlightRegistry }).highlights?.delete('lookup');
  }
}
