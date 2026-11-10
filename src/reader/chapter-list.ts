/** The chapter list (table of contents) dialog, with known-word percentages per chapter. */
import type { OpenBook } from '../books/library';
import type { LanguageModule } from '../languages/types';
import { el } from '../ui/dom';
import { iconButton } from '../ui/icons';
import { bookWordCounts, formatShare, knownShare } from '../vocab/book-stats';
import { knownWords } from '../vocab/known-words';

export function openChapterList(book: OpenBook, lang: LanguageModule | null, current: number, onSelect: (chapter: number) => void): void {
  const dialog = el('dialog', { class: 'dialog toc', 'aria-label': 'Chapters' });
  const items = book.index.chapters.map((chapter, i) => {
    const button = el(
      'button',
      { type: 'button', class: 'toc-item', 'aria-current': i === current ? 'true' : undefined },
      el('span', { class: 'toc-number' }, String(i + 1)),
      el('span', { class: 'toc-title' }, chapter.title),
      el('span', { class: 'toc-known', 'data-chapter': String(i) }),
    );
    button.addEventListener('click', () => {
      dialog.close();
      onSelect(i);
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
  items[current]?.scrollIntoView({ block: 'center' });
  if (lang) void fillShares(book, lang, dialog);
}

async function fillShares(book: OpenBook, lang: LanguageModule, dialog: HTMLElement): Promise<void> {
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
