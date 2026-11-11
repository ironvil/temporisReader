import './style.css';
import { App } from '@capacitor/app';
import { runAutoBackup } from './auto-backup';
import { BookFileError, openBook } from './books/library';
import { watchOpenedFiles } from './books/linked-files';
import { Reader } from './reader/reader';
import { loadSettings } from './settings';
import { BookEditorView } from './ui/book-editor';
import { closeTopDialog } from './ui/dialog';
import { toast } from './ui/dom';
import { LibraryView } from './ui/library-view';
import { mentionMissingDictionaries } from './missing-dictionaries';
import { showLinkedFileDialog } from './ui/linked-file-dialog';
import { SettingsView } from './ui/settings-view';

async function main() {
  await loadSettings();
  const app = document.getElementById('app')!;

  let current: 'library' | 'reader' = 'library';
  const show = (view: typeof current) => {
    current = view;
    library.root.hidden = view !== 'library';
    reader.root.hidden = view !== 'reader';
  };

  const openReader = async (id: string) => {
    try {
      const book = await openBook(id);
      show('reader');
      reader.open(book);
      if (book.changed.length) toast(`“${book.changed.join('”, “')}” changed since you last read it, so the book was reloaded`);
    } catch (err) {
      if (err instanceof BookFileError) {
        showLinkedFileDialog(err, { onRelinked: () => void openReader(id), onRemoved: () => void library.refresh() });
        return;
      }
      toast(err instanceof Error ? err.message : 'Could not open book');
    }
  };
  const showLibrary = async () => {
    await reader.close();
    show('library');
    await library.refresh();
  };
  const openSettings = (language?: string) => void settings.show(language);
  const closeSettings = () => {
    settings.hide();
    if (current === 'library') void library.refresh();
  };
  const openEditor = (id: string) => void editor.show(id);
  const closeEditor = () => {
    editor.hide();
    void library.refresh();
  };

  const library = new LibraryView({ onOpen: (id) => void openReader(id), onEdit: openEditor, onOpenSettings: openSettings });
  const reader = new Reader({
    onExit: () => void showLibrary(),
    onOpenSettings: openSettings,
    onEditBook: async (id) => {
      await showLibrary();
      openEditor(id);
    },
  });
  const settings = new SettingsView({ onClose: closeSettings });
  const editor = new BookEditorView({
    onClose: closeEditor,
    onRead: (id) => {
      closeEditor();
      void openReader(id);
    },
  });
  app.append(library.root, reader.root, settings.root, editor.root);

  void App.addListener('backButton', () => {
    if (closeTopDialog()) return;
    if (settings.isOpen) {
      if (!settings.handleBack()) closeSettings();
    }
    else if (editor.isOpen) closeEditor();
    else if (current === 'reader') {
      if (!reader.handleBack()) void showLibrary();
    } else void App.exitApp();
  });
  void App.addListener('pause', () => void reader.flush());
  const autoBackup = async () => {
    const result = await runAutoBackup();
    // Shown once when backups start failing; settings shows the problem until one works again.
    if (result.status === 'failed' && result.firstFailure) toast(`Automatic backup failed: ${result.error.message}. See Settings → Backup.`);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void reader.flush();
    else void autoBackup();
  });

  show('library');
  await library.refresh();
  document.body.dataset.ready = 'true';
  void mentionMissingDictionaries(openSettings);
  // Not during startup's own work.
  setTimeout(() => void autoBackup(), 2000);

  // An EPUB opened with the app from elsewhere: back to the library, and import it there.
  void watchOpenedFiles(async (file) => {
    while (closeTopDialog());
    if (settings.isOpen) closeSettings();
    if (editor.isOpen) closeEditor();
    if (current === 'reader') await showLibrary();
    await library.importOpenedFile(file);
  });
}

void main();
