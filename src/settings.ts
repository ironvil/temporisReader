import { readJson, writeJson } from './storage';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  fontSize: number;
  theme: Theme;
  /** Tint words in the text that aren't known yet (new / learning). Off by default. */
  highlightWords: boolean;
  /** Offer to mark unlooked-up words as known when turning a page. On by default. */
  markKnownPrompt: boolean;
  /** Looking up a known word (✓) moves it back to level 2. On by default. */
  downgradeOnLookup: boolean;
  /** Format last chosen for pasted chapters, preselected next time. */
  chapterFormat: 'txt' | 'md';
}

export const FONT_SIZES = { min: 14, max: 40, step: 2 };

const DEFAULTS: Settings = { fontSize: 22, theme: 'system', highlightWords: false, markKnownPrompt: true, downgradeOnLookup: true, chapterFormat: 'txt' };
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
