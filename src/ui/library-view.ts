import { deleteBook, importBook, listBooks, type BookMeta } from '../books/library';
import { getLanguage } from '../languages';
import { el, toast } from './dom';
import { icon, iconButton } from './icons';

export interface LibraryCallbacks {
  onOpen(id: string): void;
  onOpenSettings(): void;
}

export class LibraryView {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly fileInput: HTMLInputElement;

  constructor(private readonly callbacks: LibraryCallbacks) {
    // No `accept` filter: Android's picker greys out .md files because they have no reliable MIME type.
    this.fileInput = el('input', { type: 'file', hidden: true, 'data-testid': 'import-input' });
    this.fileInput.addEventListener('change', () => void this.onFilePicked());

    this.list = el('ul', { class: 'book-list' });
    this.root = el(
      'section',
      { class: 'view library' },
      el(
        'header',
        { class: 'bar top' },
        el('h1', { class: 'bar-heading' }, 'Library'),
        iconButton('plus', 'Import book', () => this.fileInput.click()),
        iconButton('settings', 'Settings', () => callbacks.onOpenSettings()),
      ),
      el('main', { class: 'library-content' }, this.list),
      this.fileInput,
    );
  }

  async refresh(): Promise<void> {
    const books = await listBooks();
    this.list.replaceChildren(...books.map((b) => this.bookItem(b)));
    if (!books.length) {
      const importButton = el('button', { type: 'button', class: 'button' }, 'Import a book');
      importButton.addEventListener('click', () => this.fileInput.click());
      this.list.append(
        el('li', { class: 'empty' }, icon('book'), el('p', {}, 'No books yet. Import a .txt or .md file to start reading.'), importButton),
      );
    }
  }

  private bookItem(book: BookMeta): HTMLElement {
    const percent = Math.round((book.progress?.fraction ?? 0) * 100);
    const language = getLanguage(book.language);
    const details = [
      book.progress ? `${percent}%` : 'Not started',
      `${book.chapterCount} ${book.chapterCount === 1 ? 'chapter' : 'chapters'}`,
      language ? language.name : 'Unsupported language',
    ].join(' · ');

    const open = el(
      'button',
      { type: 'button', class: 'book-open' },
      el('span', { class: 'book-name' }, book.title),
      el('span', { class: 'book-details' }, details),
      el('span', { class: 'book-progress', style: `--progress: ${percent}%` }),
    );
    open.addEventListener('click', () => this.callbacks.onOpen(book.id));

    const remove = iconButton('trash', `Delete ${book.title}`, async () => {
      if (!confirm(`Delete “${book.title}” and its reading progress?`)) return;
      await deleteBook(book.id);
      await this.refresh();
    });
    return el('li', { class: 'book' }, open, remove);
  }

  private async onFilePicked(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    try {
      const book = await importBook(file);
      toast(`Imported “${book.title}”`);
      await this.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Import failed');
    }
  }
}
