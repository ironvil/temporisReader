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
import { onSettingsChange } from '../settings';
import { el } from '../ui/dom';
import { iconButton } from '../ui/icons';
import { knownWords, LEVELS, type Level } from '../vocab/known-words';
import { LookupPopup } from './popup';

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
  onOpenSettings(): void;
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
  private gesture: Gesture | null = null;
  private layoutSize = '';
  private relayoutTimer: number | undefined;

  constructor(private readonly callbacks: ReaderCallbacks) {
    this.bookTitle = el('div', { class: 'book-title' });
    this.chapterTitle = el('div', { class: 'chapter-title' });
    this.flow = el('div', { class: 'page-flow' });
    this.area = el('div', { class: 'page-area' }, this.flow);
    const pageWrap = el('div', { class: 'page-wrap' }, this.area);
    this.popup = new LookupPopup(pageWrap);
    this.pageCountEl = el('span', { class: 'page-count' });
    this.chapterCountEl = el('span', { class: 'chapter-count' });
    const indicator = el('div', { class: 'page-indicator', 'aria-live': 'polite' }, this.pageCountEl, this.chapterCountEl);

    this.root = el(
      'section',
      { class: 'view reader', hidden: true },
      el(
        'header',
        { class: 'bar top' },
        iconButton('back', 'Library', () => callbacks.onExit()),
        el('div', { class: 'bar-title' }, this.bookTitle, this.chapterTitle),
        iconButton('settings', 'Settings', () => callbacks.onOpenSettings()),
      ),
      pageWrap,
      el('footer', { class: 'bar bottom' }, indicator),
    );

    this.bindGestures();
    new ResizeObserver(() => this.scheduleRelayout()).observe(this.area);
    onSettingsChange((_, changed) => {
      if (changed.fontSize !== undefined) this.relayout();
    });
    document.addEventListener('keydown', (e) => {
      if (this.root.hidden || !this.book) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') this.next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.prev();
      else if (e.key === 'Escape') this.closeLookup();
    });
  }

  /** Call after the reader view is visible so layout can be measured. */
  open(book: OpenBook): void {
    this.book = book;
    this.lang = getLanguage(book.meta.language);
    for (const dictionary of this.lang?.dictionaries ?? []) void dictionary.ensureLoaded();
    if (this.lang) void knownWords(this.lang.id).load();
    this.bookTitle.textContent = book.meta.title;

    const saved = book.meta.progress;
    const chapter = saved && saved.chapter < book.index.chapters.length ? saved.chapter : 0;
    this.renderChapter(chapter);
    if (saved && saved.chapter === chapter) this.goTo(this.positionFromProgress(saved));
    else this.setPage(0);
  }

  async close(): Promise<void> {
    const saved = this.flush();
    this.closeLookup();
    this.book = null;
    this.blocks = [];
    this.flow.replaceChildren();
    await saved;
  }

  /** Handles the Android back button. Returns true if it was consumed. */
  handleBack(): boolean {
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
    if (this.page < this.pageCount - 1) this.setPage(this.page + 1, true);
    else if (this.chapterIndex < this.book.index.chapters.length - 1) {
      this.renderChapter(this.chapterIndex + 1);
      this.setPage(0);
    } else this.applyTransform(true);
  }

  prev(): void {
    if (!this.book) return;
    if (this.page > 0) this.setPage(this.page - 1, true);
    else if (this.chapterIndex > 0) {
      this.renderChapter(this.chapterIndex - 1);
      this.setPage(this.pageCount - 1);
    } else this.applyTransform(true);
  }

  private setPage(page: number, animate = false, keep?: Position): void {
    this.page = Math.max(0, Math.min(page, this.pageCount - 1));
    this.applyTransform(animate);
    this.closeLookup();
    this.position = keep ?? this.firstPositionOnPage(this.page);
    this.updateChrome();
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
    area.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || !this.book) return;
      this.gesture = { x: e.clientX, y: e.clientY, dragging: false };
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
      } else if (Math.hypot(dx, dy) < TAP_SLOP) {
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

    const range = this.charRange(block, result.start, result.end);
    if (!range) return this.closeLookup();
    this.highlight(range);
    const anchor = range.getClientRects()[0] ?? range.getBoundingClientRect();
    if (!result.entries.length) return this.popup.show(this.renderNotice(result), anchor);
    const status = await this.statusButtons(lang.id, result.headword);
    if (seq !== this.lookupSeq) return;
    this.popup.show(lang.renderEntries(result), anchor, result.source, status);
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
    settingsButton?.addEventListener('click', () => this.callbacks.onOpenSettings());
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
    if (registry && HighlightCtor) registry.set('lookup', new HighlightCtor(range));
  }

  private closeLookup(): void {
    this.lookupSeq++;
    this.popup.hide();
    (CSS as unknown as { highlights?: HighlightRegistry }).highlights?.delete('lookup');
  }
}
