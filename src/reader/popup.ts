import { el } from '../ui/dom';

/** Dictionary popup: full width, placed below the word (or above when there's no room), arrow pointing at it. */
export class LookupPopup {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly arrow: HTMLElement;

  constructor(private readonly container: HTMLElement) {
    this.arrow = el('div', { class: 'lookup-arrow' });
    this.body = el('div', { class: 'lookup-body' });
    this.badge = el('div', { class: 'lookup-badge' });
    this.el = el('div', { class: 'lookup-popup', role: 'dialog', 'aria-label': 'Dictionary', hidden: true }, this.arrow, this.body, this.badge);
    container.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  show(content: Node, anchor: DOMRect, badge?: string): void {
    this.body.replaceChildren(content);
    this.badge.textContent = badge ?? '';
    this.badge.hidden = !badge;
    this.el.hidden = false;
    this.body.scrollTop = 0;
    this.position(anchor);
  }

  hide(): void {
    this.el.hidden = true;
    this.body.replaceChildren();
  }

  private position(anchor: DOMRect): void {
    const box = this.container.getBoundingClientRect();
    const wordTop = anchor.top - box.top;
    const wordBottom = anchor.bottom - box.top;
    const wordCenter = anchor.left + anchor.width / 2 - box.left;

    const gap = 12;
    const margin = 4;
    const height = this.el.offsetHeight;
    const spaceBelow = box.height - wordBottom - gap - margin;
    const spaceAbove = wordTop - gap - margin;
    const below = height <= spaceBelow || spaceBelow >= spaceAbove;

    let top = below ? wordBottom + gap : wordTop - gap - height;
    top = Math.max(margin, Math.min(top, box.height - height - margin));
    this.el.style.top = `${top}px`;
    this.el.dataset.side = below ? 'below' : 'above';

    const arrowX = Math.max(16, Math.min(wordCenter - this.el.offsetLeft, this.el.offsetWidth - 16));
    this.arrow.style.left = `${arrowX}px`;
  }
}
