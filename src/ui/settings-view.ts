import { languages } from '../languages';
import type { Dictionary, DictionaryState, LanguageModule } from '../languages/types';
import { createBackup, parseBackup, restoreBackup } from '../backup';
import { decodeText } from '../books/parse';
import { exportTextFile } from '../export';
import { FONT_SIZES, getSettings, updateSettings, type Theme } from '../settings';
import { knownWords, parseKnownWords, today } from '../vocab/known-words';
import { el, formatBytes, toast } from './dom';
import { iconButton } from './icons';

export class SettingsView {
  readonly root: HTMLElement;
  private readonly content: HTMLElement;
  private cleanups: (() => void)[] = [];

  constructor(private readonly callbacks: { onClose(): void }) {
    this.content = el('main', { class: 'settings-content' });
    this.root = el(
      'section',
      { class: 'view settings', hidden: true, role: 'dialog', 'aria-label': 'Settings' },
      el(
        'header',
        { class: 'bar top' },
        iconButton('back', 'Close settings', () => this.callbacks.onClose()),
        el('h1', { class: 'bar-heading' }, 'Settings'),
      ),
      this.content,
    );
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** `focusLanguage`: scroll to (and briefly highlight) that language's card. */
  async show(focusLanguage?: string): Promise<void> {
    // Render before showing so stale controls from the last visit are never on screen.
    await this.render();
    this.root.hidden = false;
    if (focusLanguage) {
      const card = this.content.querySelector<HTMLElement>(`[data-language="${focusLanguage}"]`);
      card?.scrollIntoView({ block: 'center' });
      card?.classList.add('focus-flash');
      setTimeout(() => card?.classList.remove('focus-flash'), 1600);
    }
  }

  hide(): void {
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
    this.root.hidden = true;
    this.content.replaceChildren();
  }

  private async render(): Promise<void> {
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
    const languageCards = await Promise.all(languages.map((lang) => this.languageCard(lang)));
    this.content.replaceChildren(
      el('h2', {}, 'Reading'),
      this.readingCard(),
      el('h2', {}, 'Languages'),
      ...languageCards,
      el('h2', {}, 'Backup'),
      this.backupCard(),
      el('h2', {}, 'About'),
      el('div', { class: 'card muted' }, `Temporis Reader ${__APP_VERSION__}`),
    );
  }

  private backupCard(): HTMLElement {
    const backupButton = el('button', { type: 'button', class: 'button' }, 'Back up library');
    backupButton.addEventListener('click', async () => {
      backupButton.disabled = true;
      try {
        const backup = await createBackup();
        await exportTextFile(`temporis-backup-${today()}.json`, JSON.stringify(backup));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/cancel/i.test(message)) toast(`Backup failed: ${message}`);
      } finally {
        backupButton.disabled = false;
      }
    });

    const fileInput = el('input', { type: 'file', hidden: true, 'data-testid': 'restore-input' });
    const restoreButton = el('button', { type: 'button', class: 'button secondary' }, 'Restore from backup');
    restoreButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const backup = parseBackup(decodeText(new Uint8Array(await file.arrayBuffer())));
        const books = backup.library.length;
        const made = new Date(backup.createdAt).toLocaleString();
        if (!confirm(`Restore ${books} ${books === 1 ? 'book' : 'books'} from the backup made ${made}? Your current books, reading progress, known words and settings will be replaced.`)) return;
        await restoreBackup(backup);
        toast('Restored. Reloading…');
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        toast(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    return el(
      'div',
      { class: 'card', 'data-backup': '' },
      el('p', { class: 'muted' }, 'One file with your books, chapters, reading progress, known words and settings. Dictionaries aren’t included: add your languages again after restoring on a new install.'),
      el('div', { class: 'actions' }, backupButton, restoreButton, fileInput),
    );
  }

  private readingCard(): HTMLElement {
    const settings = getSettings();
    const size = el('output', { class: 'font-size-value', 'aria-live': 'polite' }, `${settings.fontSize}px`);
    const preview = el('p', { class: 'font-preview', lang: 'zh-Hans' }, '今天早上，阳光从高高的窗户里斜斜地照进来。');
    const change = (delta: number) => {
      const fontSize = Math.max(FONT_SIZES.min, Math.min(FONT_SIZES.max, getSettings().fontSize + delta));
      size.textContent = `${fontSize}px`;
      void updateSettings({ fontSize });
    };
    const smaller = el('button', { type: 'button', class: 'button secondary', 'aria-label': 'Smaller text' }, 'A−');
    const larger = el('button', { type: 'button', class: 'button secondary', 'aria-label': 'Larger text' }, 'A+');
    smaller.addEventListener('click', () => change(-FONT_SIZES.step));
    larger.addEventListener('click', () => change(FONT_SIZES.step));

    const theme = el(
      'select',
      { 'aria-label': 'Theme' },
      ...(['system', 'light', 'dark'] as Theme[]).map((t) =>
        el('option', { value: t, selected: settings.theme === t }, t[0].toUpperCase() + t.slice(1)),
      ),
    );
    theme.addEventListener('change', () => void updateSettings({ theme: theme.value as Theme }));

    const prompt = el('input', { type: 'checkbox', checked: settings.markKnownPrompt });
    prompt.addEventListener('change', () => void updateSettings({ markKnownPrompt: prompt.checked }));
    const downgrade = el('input', { type: 'checkbox', checked: settings.downgradeOnLookup });
    downgrade.addEventListener('change', () => void updateSettings({ downgradeOnLookup: downgrade.checked }));
    const track = el('input', { type: 'checkbox', checked: settings.trackOnLookup });
    track.addEventListener('change', () => void updateSettings({ trackOnLookup: track.checked }));
    const highlight = el('input', { type: 'checkbox', checked: settings.highlightWords });
    highlight.addEventListener('change', () => void updateSettings({ highlightWords: highlight.checked }));

    return el(
      'div',
      { class: 'card' },
      el('div', { class: 'setting-row' }, el('span', {}, 'Text size'), el('div', { class: 'stepper' }, smaller, size, larger)),
      preview,
      el('div', { class: 'setting-row' }, el('span', {}, 'Theme'), theme),
      el('label', { class: 'checkbox' }, prompt, el('span', {}, 'Offer to mark words I didn’t look up as known')),
      el('p', { class: 'setting-help' }, 'Asked when turning forward after at least 10 seconds on a page.'),
      el('label', { class: 'checkbox' }, downgrade, el('span', {}, 'Looking up a known word moves it back to 2')),
      el('p', { class: 'setting-help' }, 'If you needed to look it up, you don’t quite know it yet.'),
      el('label', { class: 'checkbox' }, track, el('span', {}, 'Looking up a new word sets it to 1')),
      el('p', { class: 'setting-help' }, 'For words not in your known-words list yet.'),
      el('label', { class: 'checkbox' }, highlight, el('span', {}, 'Highlight words you don’t know yet')),
      el(
        'p',
        { class: 'setting-help' },
        el('span', { class: 'legend new' }, 'new'),
        ' never marked · ',
        el('span', { class: 'legend learning' }, 'learning'),
        ' levels 0–2',
      ),
    );
  }

  /** A language is "added" when all of its dictionaries are downloaded. */
  private async languageCard(lang: LanguageModule): Promise<HTMLElement> {
    const status = el('p', { class: 'lang-status', 'aria-live': 'polite' });
    const action = el('div', {});
    const bar = el('progress', { max: '1', hidden: true });
    const dictionaryRows = el('div', {});
    let lastError: string | null = null;

    const installAll = async () => {
      lastError = null;
      for (const d of lang.dictionaries) {
        try {
          await d.install();
        } catch {
          return; // reported through onProgress
        }
      }
    };

    const refresh = async () => {
      const states = await Promise.all(lang.dictionaries.map((d) => d.state()));
      const active = lang.dictionaries.find((d) => {
        const p = d.installProgress();
        return p && (p.phase === 'downloading' || p.phase === 'processing');
      });
      const added = states.every((s) => s.installed);

      action.replaceChildren();
      if (active) {
        const p = active.installProgress()!;
        bar.hidden = false;
        if (p.phase === 'downloading') {
          status.textContent = `Downloading ${active.name}… ${formatBytes(p.bytes ?? 0)}${p.total ? ` of ${formatBytes(p.total)}` : ''}`;
          if (p.total) bar.value = (p.bytes ?? 0) / p.total;
          else bar.removeAttribute('value');
        } else {
          status.textContent = `Preparing ${active.name}…`;
          bar.removeAttribute('value');
        }
      } else {
        bar.hidden = true;
        const size = lang.dictionaries.map((d) => d.downloadSize).join(' + ');
        status.textContent = added ? 'Added' : `Not added · ${size} download`;
        if (lastError) status.textContent += ` · Download failed: ${lastError}`;

        const button = el('button', { type: 'button', class: added ? 'button secondary' : 'button' }, added ? 'Remove' : 'Add');
        button.addEventListener('click', async () => {
          if (!added) return void installAll();
          if (!confirm(`Remove ${lang.name}? Its dictionaries will be deleted and word lookup won’t work until you add it again.`)) return;
          for (const d of lang.dictionaries) await d.uninstall();
          await refresh();
        });
        action.append(button);
      }
      dictionaryRows.replaceChildren(...lang.dictionaries.map((d, i) => this.dictionaryRow(d, states[i], !active)));
    };

    for (const d of lang.dictionaries) {
      this.cleanups.push(
        d.onProgress((p) => {
          if (p.phase === 'error') {
            lastError = p.error ?? 'Unknown error';
            toast(`${lang.name}: download failed`);
          }
          if (p.phase === 'done') toast(`${d.name} installed`);
          void refresh();
        }),
      );
    }
    await refresh();

    return el(
      'div',
      { class: 'card', 'data-language': lang.id },
      el(
        'div',
        { class: 'lang-head' },
        el('div', {}, el('div', { class: 'lang-name' }, `${lang.name} · ${lang.nativeName}`), status),
        action,
      ),
      bar,
      dictionaryRows,
      await this.knownWordsRow(lang),
    );
  }

  private async knownWordsRow(lang: LanguageModule): Promise<HTMLElement> {
    const store = knownWords(lang.id);
    await store.load();
    const exportButton = el('button', { type: 'button', class: 'button secondary' }, 'Export known words');
    exportButton.addEventListener('click', async () => {
      try {
        await exportTextFile(`known-words-${lang.id}-${today()}.json`, store.export());
      } catch (err) {
        // Dismissing the share sheet rejects too; only report real failures.
        const message = err instanceof Error ? err.message : String(err);
        if (!/cancel/i.test(message)) toast(`Export failed: ${message}`);
      }
    });
    const summary = el('div', { class: 'muted known-summary' });
    const updateSummary = () => {
      const counts = store.counts();
      summary.textContent = store.size ? `${store.size.toLocaleString()} words · ${counts[3].toLocaleString()} known` : 'None marked yet';
    };
    updateSummary();

    const fileInput = el('input', { type: 'file', hidden: true, 'data-testid': `known-words-import-${lang.id}` });
    const replace = el('input', { type: 'checkbox' });
    const importButton = el('button', { type: 'button', class: 'button secondary' }, 'Import known words');
    importButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const text = decodeText(new Uint8Array(await file.arrayBuffer()));
        if (replace.checked) {
          const incoming = parseKnownWords(text); // validate before clearing anything
          const count = Object.keys(incoming.words).length;
          if (store.size && !confirm(`Replace your ${store.size.toLocaleString()} known words with the ${count.toLocaleString()} in ${file.name}? The current list will be cleared.`)) return;
          await store.replace(incoming);
          updateSummary();
          toast(`Replaced: ${count.toLocaleString()} words`);
          return;
        }
        const { added, updated } = await store.import(text);
        updateSummary();
        toast(`Imported: ${added.toLocaleString()} new, ${updated.toLocaleString()} updated`);
      } catch (err) {
        toast(`Import failed: ${err instanceof SyntaxError ? 'not a JSON file' : err instanceof Error ? err.message : String(err)}`);
      }
    });

    return el(
      'div',
      { class: 'dict-row', 'data-known-words': lang.id },
      el('div', {}, el('strong', {}, 'Known words')),
      summary,
      el('div', { class: 'actions' }, importButton, exportButton, fileInput),
      el('label', { class: 'checkbox replace-option' }, replace, el('span', {}, 'Replace current list instead of merging')),
    );
  }

  private dictionaryRow(dictionary: Dictionary, state: DictionaryState, idle: boolean): HTMLElement {
    const details = state.installed
      ? `${state.entryCount.toLocaleString()} entries${state.version ? ` · ${state.version.slice(0, 10)}` : ''}`
      : dictionary.downloadSize;
    const update = state.installed && idle ? el('button', { type: 'button', class: 'button secondary' }, 'Update dictionary') : null;
    update?.addEventListener('click', () => dictionary.install().catch(() => undefined));
    return el(
      'div',
      { class: 'dict-row', 'data-dictionary': dictionary.id },
      el('div', {}, el('strong', {}, dictionary.name), ` · ${dictionary.description}`),
      el('div', { class: 'muted dict-status' }, details),
      update ? el('div', { class: 'actions' }, update) : null,
      el('div', { class: 'license' }, 'License: ', el('a', { href: dictionary.homepage, target: '_blank', rel: 'noopener' }, dictionary.license)),
    );
  }
}
