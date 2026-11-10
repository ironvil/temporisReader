import { languages } from '../languages';
import type { Dictionary } from '../languages/types';
import { FONT_SIZES, getSettings, updateSettings, type Theme } from '../settings';
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

    const dictionarySections = await Promise.all(
      languages.map(async (lang) =>
        el(
          'div',
          { class: 'group' },
          el('h3', {}, `${lang.name} · ${lang.nativeName}`),
          ...(await Promise.all(lang.dictionaries.map((d) => this.dictionaryCard(d)))),
        ),
      ),
    );

    this.content.replaceChildren(
      el('h2', {}, 'Reading'),
      this.readingCard(),
      el('h2', {}, 'Dictionaries'),
      ...dictionarySections,
      el('h2', {}, 'About'),
      el('div', { class: 'card muted' }, `Temporis Reader ${__APP_VERSION__}`),
    );
  }

  private readingCard(): HTMLElement {
    const settings = getSettings();
    const size = el('output', { class: 'font-size-value', 'aria-live': 'polite' }, `${settings.fontSize}px`);
    const preview = el('p', { class: 'font-preview', lang: 'zh' }, '今天早上，阳光从高高的窗户里斜斜地照进来。');
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

  private async dictionaryCard(dictionary: Dictionary): Promise<HTMLElement> {
    const status = el('p', { class: 'dict-status', 'aria-live': 'polite' });
    const bar = el('progress', { max: '1', hidden: true });
    const actions = el('div', { class: 'actions' });
    let lastError: string | null = null;

    const refresh = async () => {
      const progress = dictionary.installProgress();
      actions.replaceChildren();
      if (progress && (progress.phase === 'downloading' || progress.phase === 'processing')) {
        bar.hidden = false;
        if (progress.phase === 'downloading') {
          const total = progress.total ? ` of ${formatBytes(progress.total)}` : '';
          status.textContent = `Downloading… ${formatBytes(progress.bytes ?? 0)}${total}`;
          if (progress.total) bar.value = (progress.bytes ?? 0) / progress.total;
          else bar.removeAttribute('value');
        } else {
          status.textContent = 'Preparing dictionary…';
          bar.removeAttribute('value');
        }
        return;
      }
      bar.hidden = true;
      const state = await dictionary.state();
      status.textContent = state.installed
        ? `Installed · ${state.entryCount.toLocaleString()} entries${state.version ? ` · ${state.version}` : ''}`
        : `Not downloaded · ${dictionary.downloadSize}`;
      if (lastError) status.textContent += ` · Last attempt failed: ${lastError}`;

      const install = el('button', { type: 'button', class: 'button' }, state.installed ? 'Update' : 'Download');
      install.addEventListener('click', () => {
        lastError = null;
        dictionary.install().catch(() => undefined); // reported through onProgress
      });
      actions.append(install);
      if (state.installed) {
        const remove = el('button', { type: 'button', class: 'button secondary' }, 'Delete');
        remove.addEventListener('click', async () => {
          if (!confirm(`Delete ${dictionary.name}? Word lookup won’t work until you download it again.`)) return;
          await dictionary.uninstall();
          await refresh();
        });
        actions.append(remove);
      }
    };

    this.cleanups.push(
      dictionary.onProgress((p) => {
        if (p.phase === 'error') {
          lastError = p.error ?? 'Unknown error';
          toast(`${dictionary.name} download failed`);
        }
        if (p.phase === 'done') toast(`${dictionary.name} installed`);
        void refresh();
      }),
    );
    await refresh();

    const link = el('a', { href: dictionary.homepage, target: '_blank', rel: 'noopener' }, dictionary.license);
    return el(
      'div',
      { class: 'card', 'data-dictionary': dictionary.id },
      el('div', { class: 'card-title' }, dictionary.name),
      el('p', { class: 'muted' }, dictionary.description),
      status,
      bar,
      actions,
      el('p', { class: 'license' }, 'License: ', link),
    );
  }
}
