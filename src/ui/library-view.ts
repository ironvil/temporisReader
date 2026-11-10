import { createBook, deleteBook, importBook, listBooks, type BookMeta } from '../books/library';
import { getLanguage } from '../languages';
import { bookWordCounts, formatShare, knownShare } from '../vocab/book-stats';
import { knownWords } from '../vocab/known-words';
import { field, openDialog } from './dialog';
import { el, toast } from './dom';
import { icon, iconButton } from './icons';

export interface LibraryCallbacks {
  onOpen(id: string): void;
  onEdit(id: string): void;
  onOpenSettings(): void;
}

export class LibraryView {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly menu: HTMLElement;
  private readonly addButton: HTMLButtonElement;

  constructor(private readonly callbacks: LibraryCallbacks) {
    // No `accept` filter: Android's picker greys out .md files because they have no reliable MIME type.
    this.fileInput = el('input', { type: 'file', hidden: true, 'data-testid': 'import-input' });
    this.fileInput.addEventListener('change', () => void this.onFilePicked());

    this.menu = el(
      'div',
      { class: 'menu', role: 'menu', hidden: true },
      this.menuItem('Import a file', () => this.fileInput.click()),
      this.menuItem('Create a book', () => this.createBook()),
    );
    this.addButton = iconButton('plus', 'Add book', () => this.toggleMenu());
    this.addButton.setAttribute('aria-haspopup', 'menu');
    document.addEventListener('pointerdown', (e) => {
      const target = e.target as Node;
      if (!this.menu.hidden && !this.menu.contains(target) && !this.addButton.contains(target)) this.toggleMenu(false);
    });

    this.list = el('ul', { class: 'book-list' });
    this.root = el(
      'section',
      { class: 'view library' },
      el(
        'header',
        { class: 'bar top' },
        el('h1', { class: 'bar-heading' }, 'Library'),
        el('div', { class: 'menu-anchor' }, this.addButton, this.menu),
        iconButton('settings', 'Settings', () => callbacks.onOpenSettings()),
      ),
      el('main', { class: 'library-content' }, this.list),
      this.fileInput,
    );
  }

  async refresh(): Promise<void> {
    const books = await listBooks();
    this.list.replaceChildren(...books.map((b) => this.bookItem(b)));
    void this.fillKnownShares(books);
    if (!books.length) {
      const importButton = el('button', { type: 'button', class: 'button' }, 'Import a file');
      const createButton = el('button', { type: 'button', class: 'button secondary' }, 'Create a book');
      importButton.addEventListener('click', () => this.fileInput.click());
      createButton.addEventListener('click', () => this.createBook());
      this.list.append(
        el(
          'li',
          { class: 'empty' },
          icon('book'),
          el('p', {}, 'No books yet. Import a .txt or .md file, or create a book and add chapters to it.'),
          el('div', { class: 'actions' }, importButton, createButton),
        ),
      );
    }
  }

  private menuItem(label: string, onClick: () => void): HTMLButtonElement {
    const item = el('button', { type: 'button', role: 'menuitem', class: 'menu-item' }, label);
    item.addEventListener('click', () => {
      this.toggleMenu(false);
      onClick();
    });
    return item;
  }

  private toggleMenu(open = this.menu.hidden): void {
    this.menu.hidden = !open;
    this.addButton.setAttribute('aria-expanded', String(open));
  }

  private createBook(): void {
    const title = el('input', { type: 'text', name: 'title', required: true, autocomplete: 'off', enterkeyhint: 'done' });
    openDialog({
      title: 'Create a book',
      content: [field('Title', title)],
      confirmLabel: 'Create',
      onConfirm: async () => {
        if (!title.value.trim()) throw new Error('Give the book a title');
        const book = await createBook(title.value);
        await this.refresh();
        this.callbacks.onEdit(book.id);
      },
    });
    title.focus();
  }

  private bookItem(book: BookMeta): HTMLElement {
    const percent = Math.round((book.progress?.fraction ?? 0) * 100);
    const language = getLanguage(book.language);
    const details = !book.chapterCount
      ? 'No chapters yet'
      : [
          book.progress ? `${percent}%` : 'Not started',
          `${book.chapterCount} ${book.chapterCount === 1 ? 'chapter' : 'chapters'}`,
          language ? language.name : 'Unsupported language',
        ].join(' · ');

    const open = el(
      'button',
      { type: 'button', class: 'book-open' },
      el('span', { class: 'book-name' }, book.title),
      el('span', { class: 'book-details' }, details),
      el('span', { class: 'book-known', 'data-book': book.id }),
      el('span', { class: 'book-progress', style: `--progress: ${percent}%` }),
    );
    open.addEventListener('click', () => (book.chapterCount ? this.callbacks.onOpen(book.id) : this.callbacks.onEdit(book.id)));

    const edit = iconButton('edit', `Edit ${book.title}`, () => this.callbacks.onEdit(book.id));
    const remove = iconButton('trash', `Delete ${book.title}`, async () => {
      if (!confirm(`Delete “${book.title}” and its reading progress?`)) return;
      await deleteBook(book.id);
      await this.refresh();
    });
    return el('li', { class: 'book' }, open, edit, remove);
  }

  /** Fills in "N% of words known" per book once dictionaries and known words are loaded. */
  private async fillKnownShares(books: BookMeta[]): Promise<void> {
    for (const book of books) {
      const lang = getLanguage(book.language);
      if (!lang || !book.chapterCount) continue;
      try {
        const ready = (await Promise.all(lang.dictionaries.map((d) => d.ensureLoaded()))).every(Boolean);
        if (!ready) continue;
        const store = knownWords(lang.id);
        await store.load();
        const counts = await bookWordCounts(book.id, lang);
        const target = this.list.querySelector<HTMLElement>(`.book-known[data-book="${book.id}"]`);
        if (counts && target) target.textContent = `${formatShare(knownShare(counts, (w) => store.level(w)))} of words known`;
      } catch (err) {
        console.error('Known share failed', err);
      }
    }
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
