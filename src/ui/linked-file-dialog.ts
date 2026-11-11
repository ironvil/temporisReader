import { BookFileError, deleteBook, DifferentFileError, forgetPickedFile, relinkSource } from '../books/library';
import { linkWebFile, nativePicker, pickFile, type PickedFile } from '../books/linked-files';
import { openDialog } from './dialog';
import { el } from './dom';

export interface LinkedFileDialogCallbacks {
  /** The file was found again: open the book. */
  onRelinked(): void;
  /** The book was removed from the library. */
  onRemoved(): void;
}

/**
 * Shown when a book's linked file (EPUB) can't be read: it was moved, renamed, deleted, or the app
 * lost access (e.g. after restoring a backup on another phone). Offers to find it again, which
 * keeps the reading position, or to remove the book.
 */
export function showLinkedFileDialog(error: BookFileError, callbacks: LinkedFileDialogCallbacks): void {
  const fileName = error.source.file?.name ?? error.source.fileName ?? 'the file';
  const explanation =
    error.problem === 'denied'
      ? `The app no longer has access to “${fileName}”.`
      : error.problem === 'missing'
        ? `“${fileName}” was moved, renamed or deleted.`
        : `“${fileName}” couldn’t be read.`;

  const fileInput = el('input', { type: 'file', hidden: true, 'data-testid': 'relink-input' });
  const remove = el('button', { type: 'button', class: 'button secondary wide' }, 'Remove from library');

  const relink = async (picked: PickedFile) => {
    try {
      await relinkSource(error.bookId, error.source.id, picked);
    } catch (err) {
      if (!(err instanceof DifferentFileError)) {
        await forgetPickedFile(picked.uri);
        throw err;
      }
      const ok = confirm(`${err.message}: it may be a different edition or an edited copy. Use it anyway? Your place is kept by chapter.`);
      if (!ok) {
        await forgetPickedFile(picked.uri);
        return false;
      }
      await relinkSource(error.bookId, error.source.id, picked, true);
    }
    dialog.close();
    callbacks.onRelinked();
    return true;
  };

  const dialog = openDialog({
    title: `Can’t open “${error.bookTitle}”`,
    content: [
      el('p', {}, explanation),
      el('p', { class: 'muted' }, 'Find the file again to keep reading from where you were. Books from EPUB files are read where they are stored, not copied into the app.'),
      remove,
      fileInput,
    ],
    confirmLabel: 'Find file…',
    onConfirm: async () => {
      if (!nativePicker()) {
        // Web: the input's change handler finishes the job.
        fileInput.click();
        return false;
      }
      const picked = await pickFile();
      if (!picked) return false;
      await relink(picked);
      return false;
    },
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const error = dialog.querySelector<HTMLElement>('.dialog-error')!;
    error.hidden = true;
    try {
      await relink(await linkWebFile(file));
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
      error.hidden = false;
    }
  });

  remove.addEventListener('click', async () => {
    if (!confirm(`Remove “${error.bookTitle}” and its reading progress from the library? The file itself is not deleted.`)) return;
    await deleteBook(error.bookId);
    dialog.close();
    callbacks.onRemoved();
  });
}
