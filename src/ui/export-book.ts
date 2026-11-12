import { isEditorBook, loadBook, sharedBookOf, type BookMeta } from '../books/library';
import { buildEpub } from '../books/epub-export';
import { SHARE_EXTENSION, shareFileName } from '../books/share';
import { exportFile } from '../export';
import { openDialog } from './dialog';
import { el } from './dom';

/** Only books made with "Create a book" can be exported (an imported file or EPUB is shared as that file). */
export function canExport(book: BookMeta): boolean {
  return !!book.chapterCount && isEditorBook(book);
}

/** Export as a Temporis book (editable, re-importable: same id) or as an EPUB for other readers. */
export function exportBook(bookId: string): void {
  const send = (epub: boolean) => sendBook(epub).catch((err) => {
    // Closing the share sheet without choosing an app isn't an error.
    if (!/cancel/i.test(err instanceof Error ? err.message : String(err))) throw err;
  });
  const sendBook = async (epub: boolean) => {
    if (epub) {
      const book = await loadBook(bookId);
      const modified = new Date(book.meta.modifiedAt ?? book.meta.addedAt);
      const bytes = buildEpub({ id: book.meta.id, title: book.meta.title, language: book.meta.language, modified, content: book.content, index: book.index });
      await exportFile(shareFileName(book.meta.title, '.epub'), bytes, 'application/epub+zip', 'Share');
    } else {
      const shared = await sharedBookOf(bookId);
      await exportFile(shareFileName(shared.title, SHARE_EXTENSION), JSON.stringify(shared, null, 2), 'application/json', 'Share');
    }
  };
  openDialog({
    title: 'Export book',
    content: [
      el('p', {}, el('strong', {}, 'Temporis book'), ': for Temporis Reader. Chapters stay editable, and sharing a newer version later lets the other person replace theirs, keeping their place.'),
      el('p', {}, el('strong', {}, 'EPUB'), ': for other e-reader apps.'),
    ],
    confirmLabel: 'Temporis book',
    onConfirm: () => send(false),
    alternative: { label: 'EPUB', onClick: () => send(true) },
  });
}
