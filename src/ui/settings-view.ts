import { languages } from '../languages';
import type { Dictionary, DictionaryState, LanguageModule } from '../languages/types';
import { createBackup, parseBackup, restoreBackup } from '../backup';
import {
  autoBackupState,
  chooseBackupFolder,
  KEEP_BACKUPS,
  runAutoBackup,
  setBackupFrequency,
  turnOffAutoBackup,
  type AutoBackupState,
  type Frequency,
} from '../auto-backup';
import { decodeText } from '@temporis/book-parser';
import { exportTextFile } from '../export';
import { FONT_SIZES, getSettings, updateSettings, type Theme } from '../settings';
import { knownWords, parseKnownWords, today } from '../vocab/known-words';
import { el, formatBytes, toast } from './dom';
import { icon, iconButton } from './icons';

/**
 * Settings, as two levels: the main page (reading options, a list of languages, backup) and one
 * page per language (dictionaries, add/remove, known words). Back on a language page returns to
 * the main page; back on the main page closes settings.
 */
export class SettingsView {
  readonly root: HTMLElement;
  private readonly content: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private cleanups: (() => void)[] = [];
  /** The language whose page is showing, or null on the main page. */
  private language: string | null = null;

  constructor(private readonly callbacks: { onClose(): void }) {
    this.content = el('main', { class: 'settings-content' });
    this.heading = el('h1', { class: 'bar-heading' }, 'Settings');
    this.backButton = iconButton('back', 'Close settings', () => {
      if (!this.handleBack()) this.callbacks.onClose();
    });
    this.root = el(
      'section',
      { class: 'view settings', hidden: true, role: 'dialog', 'aria-label': 'Settings' },
      el('header', { class: 'bar top' }, this.backButton, this.heading),
      this.content,
    );
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Opens the main page, or `language`'s page directly. */
  async show(language?: string): Promise<void> {
    // Render before showing so stale controls from the last visit are never on screen.
    await this.render(language ?? null);
    this.root.hidden = false;
  }

  /** Back from a language page to the main page. Returns false on the main page (caller closes). */
  handleBack(): boolean {
    if (this.language === null) return false;
    void this.render(null);
    return true;
  }

  hide(): void {
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
    this.root.hidden = true;
    this.language = null;
    this.content.replaceChildren();
  }

  private async render(language: string | null): Promise<void> {
    const lang = languages.find((l) => l.id === language) ?? null;
    const children = lang ? [await this.languageCard(lang)] : await this.mainPage();
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
    this.language = lang?.id ?? null;
    this.heading.textContent = lang ? lang.name : 'Settings';
    this.backButton.setAttribute('aria-label', lang ? 'Back to settings' : 'Close settings');
    this.backButton.title = this.backButton.getAttribute('aria-label')!;
    this.content.replaceChildren(...children);
    this.content.scrollTop = 0;
    this.cleanups.push(...this.pendingCleanups.splice(0));
  }

  /** Listeners registered while building a page, adopted once it's shown. */
  private pendingCleanups: (() => void)[] = [];

  private async mainPage(): Promise<HTMLElement[]> {
    const rows = await Promise.all(languages.map((lang) => this.languageLink(lang)));
    // Preview the text size in each language that's been added (or the first, before any are).
    const added = [];
    for (const lang of languages) {
      if ((await Promise.all(lang.dictionaries.map((d) => d.state()))).every((s) => s.installed)) added.push(lang);
    }
    return [
      el('h2', {}, 'Reading'),
      this.readingCard(added.length ? added : languages.slice(0, 1)),
      el('h2', {}, 'Languages'),
      el('div', { class: 'card lang-list' }, ...rows),
      el('h2', {}, 'Backup'),
      this.backupCard(),
      await this.autoBackupCard(),
      el('h2', {}, 'About'),
      el('div', { class: 'card muted' }, `Temporis Reader ${__APP_VERSION__}`),
    ];
  }

  /** A row on the main page that opens the language's page, with its status. */
  private async languageLink(lang: LanguageModule): Promise<HTMLElement> {
    const status = el('span', { class: 'lang-link-status' });
    const store = knownWords(lang.id);
    await store.load();
    const refresh = async () => {
      const busy = lang.dictionaries.some((d) => {
        const p = d.installProgress();
        return p && (p.phase === 'downloading' || p.phase === 'processing');
      });
      const added = (await Promise.all(lang.dictionaries.map((d) => d.state()))).every((s) => s.installed);
      const known = store.size ? ` · ${store.counts()[3].toLocaleString()} known words` : '';
      status.textContent = busy ? 'Adding…' : added ? `Added${known}` : `Not added${known}`;
    };
    await refresh();
    // An install keeps going after leaving the language's page; report how it ends from here too.
    for (const d of lang.dictionaries) {
      this.pendingCleanups.push(
        d.onProgress((p) => {
          if (p.phase === 'error') toast(`${lang.name}: download failed`);
          if (p.phase === 'done') toast(`${d.name} installed`);
          void refresh();
        }),
      );
    }

    const button = el(
      'button',
      { type: 'button', class: 'lang-link', 'data-language-link': lang.id, 'aria-label': lang.name },
      el('span', { class: 'lang-link-text' }, el('span', { class: 'lang-name' }, `${lang.name} · ${lang.nativeName}`), status),
      icon('forward'),
    );
    button.addEventListener('click', () => void this.render(lang.id));
    return button;
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

  /** Automatic backups to a chosen folder (src/auto-backup.ts). */
  private async autoBackupCard(): Promise<HTMLElement> {
    const card = el('div', { class: 'card auto-backup', 'data-auto-backup': '' });
    const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

    const draw = (state: AutoBackupState) => {
      const title = el('p', { class: 'card-title' }, 'Automatic backups');
      if (!state.folder) {
        const choose = el('button', { type: 'button', class: 'button' }, 'Choose a folder');
        choose.addEventListener('click', () => void act(choose, async () => (await chooseBackupFolder()) && (await runAutoBackup({ now: true }))));
        card.replaceChildren(
          title,
          el('p', { class: 'muted' }, `Off. Choose a folder, on this phone or in the cloud (Google Drive, Dropbox…), and the same backup file is saved there automatically, keeping the last ${KEEP_BACKUPS}.`),
          el('div', { class: 'actions' }, choose),
        );
        return;
      }

      const frequency = el(
        'select',
        { 'aria-label': 'How often' },
        ...(['daily', 'weekly'] as Frequency[]).map((f) => el('option', { value: f, selected: state.frequency === f }, f === 'daily' ? 'Daily' : 'Weekly')),
      );
      frequency.addEventListener('change', () => void setBackupFrequency(frequency.value as Frequency));
      const last = state.last
        ? `Last backup: ${when(state.last.at)} (${state.last.file})`
        : 'No backup yet.';
      const problem = state.error
        ? el(
            'p',
            { class: 'auto-backup-error', role: 'alert' },
            state.error.problem === 'failed'
              ? `The last backup failed: ${state.error.message}`
              : `${state.error.message}. Choose the folder again to keep backing up.`,
          )
        : null;

      const now = el('button', { type: 'button', class: 'button' }, 'Back up now');
      now.addEventListener('click', () => void act(now, () => runAutoBackup({ now: true })));
      const change = el('button', { type: 'button', class: 'button secondary' }, 'Change folder');
      change.addEventListener('click', () => void act(change, async () => (await chooseBackupFolder()) && (await runAutoBackup({ now: true }))));
      const off = el('button', { type: 'button', class: 'button secondary' }, 'Turn off');
      off.addEventListener('click', () => void act(off, turnOffAutoBackup));

      card.replaceChildren(
        title,
        el('p', {}, 'Saving to ', el('strong', { 'data-backup-folder': '' }, state.folder.name), `, keeping the last ${KEEP_BACKUPS}. Made when the app opens, if one is due and anything changed.`),
        el('div', { class: 'setting-row' }, el('span', {}, 'How often'), frequency),
        el('p', { class: 'muted', 'data-last-backup': '' }, last),
        ...(problem ? [problem] : []),
        el('div', { class: 'actions' }, now, change, off),
      );
    };

    /** Runs a button's action with the button disabled, reports failures, and redraws. */
    const act = async (button: HTMLButtonElement, action: () => Promise<unknown>) => {
      button.disabled = true;
      try {
        const result = await action();
        if (result && typeof result === 'object' && 'status' in result && result.status === 'written') toast('Backup saved');
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err));
      } finally {
        button.disabled = false;
        if (card.isConnected) draw(await autoBackupState());
      }
    };

    draw(await autoBackupState());
    return card;
  }

  private readingCard(previewLanguages: LanguageModule[]): HTMLElement {
    const settings = getSettings();
    const size = el('output', { class: 'font-size-value', 'aria-live': 'polite' }, `${settings.fontSize}px`);
    const preview = el(
      'div',
      { class: 'font-previews' },
      ...previewLanguages.map((lang) => el('p', { class: 'font-preview', lang: lang.htmlLang, 'data-language-preview': lang.id }, lang.sampleText)),
    );
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
        } else if (p.total) {
          // Big dictionaries are processed after downloading (French: ~600 MB of JSON).
          status.textContent = `Preparing ${active.name}… ${Math.floor(((p.bytes ?? 0) / p.total) * 100)}%`;
          bar.value = (p.bytes ?? 0) / p.total;
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
      this.pendingCleanups.push(
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
