import { readJson, writeJson } from './storage';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  fontSize: number;
  theme: Theme;
  /** User tapped "Not now" on the first-run dictionary prompt. */
  dictionaryPromptDismissed: boolean;
}

export const FONT_SIZES = { min: 14, max: 40, step: 2 };

const DEFAULTS: Settings = { fontSize: 22, theme: 'system', dictionaryPromptDismissed: false };
const FILE = 'settings.json';

let current: Settings = { ...DEFAULTS };
const listeners = new Set<(s: Settings, changed: Partial<Settings>) => void>();

export async function loadSettings(): Promise<Settings> {
  current = { ...DEFAULTS, ...((await readJson<Partial<Settings>>(FILE)) ?? {}) };
  apply();
  return current;
}

export function getSettings(): Settings {
  return current;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  current = { ...current, ...patch };
  apply();
  listeners.forEach((l) => l(current, patch));
  await writeJson(FILE, current);
}

export function onSettingsChange(listener: (s: Settings, changed: Partial<Settings>) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apply() {
  const root = document.documentElement;
  root.style.setProperty('--reader-font-size', `${current.fontSize}px`);
  if (current.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = current.theme;
}
