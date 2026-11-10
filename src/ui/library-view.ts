import { deleteBook, importBook, listBooks, type BookMeta } from '../books/library';
import { chinese, getLanguage } from '../languages';
import { getSettings, updateSettings } from '../settings';
import { el, toast } from './dom';
import { icon, iconButton } from './icons';

export interface LibraryCallbacks {
  onOpen(id: string): void;
  onOpenSettings(): void;
}

export class LibraryView {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly fileInput: HTMLInputElement;

  constructor(private readonly callbacks: LibraryCallbacks) {
    // No `accept` filter: Android's picker greys out .md files because they have no reliable MIME type.
    this.fileInput = el('input', { type: 'file', hidden: true, 'data-testid': 'import-input' });
    this.fileInput.addEventListener('change', () => void this.onFilePicked());

    this.banner = el('div', { class: 'banner-slot' });
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
      el('main', { class: 'library-content' }, this.banner, this.list),
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
    await this.renderBanner();
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

  private async renderBanner(): Promise<void> {
    const dictionary = chinese.cedict;
    const state = await dictionary.state();
    if (state.installed || getSettings().dictionaryPromptDismissed || dictionary.installProgress()) {
      this.banner.replaceChildren();
      return;
    }
    const download = el('button', { type: 'button', class: 'button' }, 'Download');
    const dismiss = el('button', { type: 'button', class: 'button secondary' }, 'Not now');
    download.addEventListener('click', () => {
      dictionary.install().catch(() => undefined); // errors are shown in settings
      this.banner.replaceChildren();
      this.callbacks.onOpenSettings();
    });
    dismiss.addEventListener('click', async () => {
      await updateSettings({ dictionaryPromptDismissed: true });
      this.banner.replaceChildren();
    });
    this.banner.replaceChildren(
      el(
        'div',
        { class: 'banner' },
        el('strong', {}, 'Download the Chinese dictionary?'),
        el('p', {}, `${dictionary.name} (${dictionary.downloadSize}) is needed to look up words. You can also do this later in Settings.`),
        el('div', { class: 'actions' }, download, dismiss),
      ),
    );
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
