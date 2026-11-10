import {
  addChapter,
  addChapterFromFile,
  getBook,
  moveChapter,
  removeChapter,
  renameBook,
  renameChapter,
  titleFromFileName,
  type BookMeta,
  type SourceMeta,
} from '../books/library';
import { formatFromFileName, type BookFormat } from '../books/parse';
import { field, openDialog } from './dialog';
import { el, toast } from './dom';
import { iconButton } from './icons';

export interface BookEditorCallbacks {
  onClose(): void;
  onRead(id: string): void;
}

/** Edit a book: title, and its chapters (add from file or pasted text, rename, reorder, delete). */
export class BookEditorView {
  readonly root: HTMLElement;
  private readonly content: HTMLElement;
  private readonly readButton: HTMLButtonElement;
  private bookId: string | null = null;

  constructor(callbacks: BookEditorCallbacks) {
    this.content = el('main', { class: 'editor-content' });
    this.readButton = el('button', { type: 'button', class: 'text-btn' }, 'Read');
    this.readButton.addEventListener('click', () => this.bookId && callbacks.onRead(this.bookId));
    this.root = el(
      'section',
      { class: 'view editor', hidden: true, role: 'dialog', 'aria-label': 'Edit book' },
      el(
        'header',
        { class: 'bar top' },
        iconButton('back', 'Close editor', () => callbacks.onClose()),
        el('h1', { class: 'bar-heading' }, 'Edit book'),
        this.readButton,
      ),
      this.content,
    );
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  async show(bookId: string): Promise<void> {
    this.bookId = bookId;
    this.root.hidden = false;
    await this.render();
  }

  hide(): void {
    this.root.hidden = true;
    this.bookId = null;
    this.content.replaceChildren();
  }

  private async render(): Promise<void> {
    if (!this.bookId) return;
    const book = await getBook(this.bookId);
    this.readButton.hidden = !book.chapterCount;

    const title = el('input', { type: 'text', value: book.title, autocomplete: 'off', class: 'title-input' });
    title.addEventListener('change', () => this.run(() => renameBook(book.id, title.value)));

    const addButton = el('button', { type: 'button', class: 'button wide' }, 'Add chapter');
    addButton.addEventListener('click', () => this.openAddChapter(book));

    const list = book.sources.length
      ? el('ol', { class: 'chapter-list' }, ...book.sources.map((s, i) => this.chapterRow(book, s, i)))
      : el('p', { class: 'muted empty-chapters' }, 'No chapters yet. Add one from a file or by pasting text.');

    this.content.replaceChildren(
      field('Title', title),
      el('h2', {}, `Chapters (${book.sources.length})`),
      list,
      addButton,
    );
  }

  private chapterRow(book: BookMeta, source: SourceMeta, index: number): HTMLElement {
    const last = index === book.sources.length - 1;
    const title = el('input', { type: 'text', value: source.title, autocomplete: 'off', 'aria-label': `Title of chapter ${index + 1}` });
    title.addEventListener('change', () => this.run(() => renameChapter(book.id, source.id, title.value)));

    const origin = source.fileName ?? 'Pasted text';
    const details = source.split
      ? `${source.chapterCount} ${source.chapterCount === 1 ? 'chapter' : 'chapters'} · ${origin}`
      : `${source.paragraphCount} ${source.paragraphCount === 1 ? 'paragraph' : 'paragraphs'} · ${origin}`;

    const up = iconButton('up', `Move ${source.title} up`, () => this.run(() => moveChapter(book.id, source.id, -1)));
    const down = iconButton('down', `Move ${source.title} down`, () => this.run(() => moveChapter(book.id, source.id, 1)));
    up.disabled = index === 0;
    down.disabled = last;
    const remove = iconButton('trash', `Delete ${source.title}`, () => {
      if (confirm(`Delete “${source.title}” from this book?`)) this.run(() => removeChapter(book.id, source.id));
    });

    return el(
      'li',
      { class: 'chapter-row', 'data-source': source.id },
      el('span', { class: 'chapter-number' }, String(index + 1)),
      el('div', { class: 'chapter-main' }, title, el('span', { class: 'chapter-details' }, details)),
      el('div', { class: 'chapter-actions' }, up, down, remove),
    );
  }

  private openAddChapter(book: BookMeta): void {
    let file: File | null = null;
    const title = el('input', { type: 'text', autocomplete: 'off', placeholder: 'Optional: first heading or file name' });
    const fileInput = el('input', { type: 'file', hidden: true, 'data-testid': 'chapter-file-input' });
    const fileName = el('span', { class: 'muted file-name' }, 'No file chosen');
    const chooseFile = el('button', { type: 'button', class: 'button secondary' }, 'Choose file…');
    const clearFile = el('button', { type: 'button', class: 'button secondary', hidden: true }, 'Remove file');
    const text = el('textarea', { rows: '8', placeholder: 'Paste the chapter text here', 'aria-label': 'Chapter text' });
    const format = el(
      'select',
      { 'aria-label': 'Format' },
      el('option', { value: 'txt' }, 'Plain text'),
      el('option', { value: 'md' }, 'Markdown'),
    );
    const pasteSection = el('div', { class: 'paste-section' }, el('p', { class: 'muted or' }, 'or paste text'), text, field('Format', format));

    chooseFile.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const picked = fileInput.files?.[0];
      fileInput.value = '';
      if (!picked) return;
      if (!formatFromFileName(picked.name)) {
        toast('Only .txt and .md files are supported');
        return;
      }
      file = picked;
      fileName.textContent = picked.name;
      title.placeholder = titleFromFileName(picked.name);
      clearFile.hidden = false;
      pasteSection.hidden = true;
    });
    clearFile.addEventListener('click', () => {
      file = null;
      fileName.textContent = 'No file chosen';
      title.placeholder = 'Optional: first heading or file name';
      clearFile.hidden = true;
      pasteSection.hidden = false;
    });

    openDialog({
      title: 'Add chapter',
      content: [
        field('Chapter title', title),
        el('div', { class: 'file-row' }, chooseFile, clearFile, fileName, fileInput),
        pasteSection,
      ],
      confirmLabel: 'Add',
      onConfirm: async () => {
        if (file) await addChapterFromFile(book.id, file, title.value);
        else if (text.value.trim()) await addChapter(book.id, { title: title.value, text: text.value, format: format.value as BookFormat });
        else throw new Error('Choose a file or paste some text');
        await this.render();
      },
    });
  }

  private run(task: () => Promise<void>): void {
    task()
      .catch((err) => toast(err instanceof Error ? err.message : 'Something went wrong'))
      .finally(() => void this.render());
  }
}
