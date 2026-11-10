import './style.css';
import { App } from '@capacitor/app';
import { openBook } from './books/library';
import { Reader } from './reader/reader';
import { loadSettings } from './settings';
import { toast } from './ui/dom';
import { LibraryView } from './ui/library-view';
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
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not open book');
    }
  };
  const showLibrary = async () => {
    await reader.close();
    show('library');
    await library.refresh();
  };
  const openSettings = () => void settings.show();
  const closeSettings = () => {
    settings.hide();
    if (current === 'library') void library.refresh();
  };

  const library = new LibraryView({ onOpen: (id) => void openReader(id), onOpenSettings: openSettings });
  const reader = new Reader({ onExit: () => void showLibrary(), onOpenSettings: openSettings });
  const settings = new SettingsView({ onClose: closeSettings });
  app.append(library.root, reader.root, settings.root);

  void App.addListener('backButton', () => {
    if (settings.isOpen) closeSettings();
    else if (current === 'reader') {
      if (!reader.handleBack()) void showLibrary();
    } else void App.exitApp();
  });
  void App.addListener('pause', () => void reader.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void reader.flush();
  });

  show('library');
  await library.refresh();
  document.body.dataset.ready = 'true';
}

void main();
