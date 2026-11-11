/**
 * Mapping between paragraph-level text offsets and the DOM. A paragraph's plain text is its
 * textContent; markdown styling only adds <strong>/<em> around parts of it.
 */
import type { InlineMark } from '@temporis/book-parser';
import { el } from '../ui/dom';

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
export function domPosition(block: HTMLElement, offset: number): { node: Text; offset: number } | null {
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
export function blockOffset(block: HTMLElement, target: Text, offset: number): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node === target) return total + offset;
    total += node.length;
  }
  return total;
}

/** A DOM range over paragraph offsets [offset, end); one character by default (never half a surrogate pair). */
export function charRange(block: HTMLElement, offset: number, end = offset + 1): Range | null {
  const text = block.textContent ?? '';
  if (offset < 0 || offset >= text.length) return null;
  if (end - offset === 1 && /[\uD800-\uDBFF]/.test(text[offset]) && end < text.length) end++;
  const from = domPosition(block, offset);
  const to = domPosition(block, Math.min(end, text.length));
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

// ── CSS Custom Highlight API (styled with ::highlight(name) in style.css) ──

interface HighlightRegistry {
  set(name: string, value: unknown): void;
  delete(name: string): void;
}

const registry = () => (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
const HighlightCtor = () => (window as unknown as { Highlight?: new (...ranges: Range[]) => { priority: number } }).Highlight;

/** True where the browser supports CSS highlights. */
export const highlightsSupported = (): boolean => !!registry() && !!HighlightCtor();

export function setHighlight(name: string, ranges: Range[], priority = 0): void {
  const Ctor = HighlightCtor();
  const reg = registry();
  if (!Ctor || !reg) return;
  const highlight = new Ctor(...ranges);
  highlight.priority = priority;
  reg.set(name, highlight);
}

export function clearHighlight(...names: string[]): void {
  for (const name of names) registry()?.delete(name);
}
