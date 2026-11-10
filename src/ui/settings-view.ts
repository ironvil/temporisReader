import { languages } from '../languages';
import type { Dictionary, DictionaryState, LanguageModule } from '../languages/types';
import { exportTextFile } from '../export';
import { FONT_SIZES, getSettings, updateSettings, type Theme } from '../settings';
import { knownWords, today } from '../vocab/known-words';
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

  async show(): Promise<void> {
    this.root.hidden = false;
    await this.render();
  }

  hide(): void {
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
    this.root.hidden = true;
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
      el('h2', {}, 'About'),
      el('div', { class: 'card muted' }, `Temporis Reader ${__APP_VERSION__}`),
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

    return el(
      'div',
      { class: 'card' },
      el('div', { class: 'setting-row' }, el('span', {}, 'Text size'), el('div', { class: 'stepper' }, smaller, size, larger)),
      preview,
      el('div', { class: 'setting-row' }, el('span', {}, 'Theme'), theme),
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
    const counts = store.counts();
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
    return el(
      'div',
      { class: 'dict-row', 'data-known-words': lang.id },
      el('div', {}, el('strong', {}, 'Known words')),
      el(
        'div',
        { class: 'muted known-summary' },
        store.size ? `${store.size.toLocaleString()} words · ${counts[3].toLocaleString()} known` : 'None marked yet',
      ),
      el('div', { class: 'actions' }, exportButton),
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
