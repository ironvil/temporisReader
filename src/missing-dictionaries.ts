/**
 * After a restore (Android's Auto Backup on a new phone, or Settings → Restore), known words come
 * back but dictionaries don't: they're too big to back up and are downloaded again. Says so once
 * per language, at startup, and offers to go and add them.
 *
 * What was shown is kept in notices.json, which is left out of both kinds of backup (it describes
 * this install), so a restored install shows the notice again.
 */
import { languages } from './languages';
import type { LanguageModule } from './languages/types';
import { readJson, writeJson } from './storage';
import { openDialog } from './ui/dialog';
import { el } from './ui/dom';
import { knownWords } from './vocab/known-words';

const FILE = 'notices.json';

interface Notices {
  /** Languages whose "dictionary missing" notice has been shown. */
  missingDictionary?: string[];
}

/** Languages with known words but no dictionary, not mentioned before. */
async function languagesToMention(shown: string[]): Promise<LanguageModule[]> {
  const missing: LanguageModule[] = [];
  for (const lang of languages) {
    if (shown.includes(lang.id)) continue;
    const store = knownWords(lang.id);
    await store.load();
    if (!store.size) continue;
    const states = await Promise.all(lang.dictionaries.map((d) => d.state()));
    if (!states.every((s) => s.installed)) missing.push(lang);
  }
  return missing;
}

export async function mentionMissingDictionaries(openSettings: (language?: string) => void): Promise<void> {
  const notices = (await readJson<Notices>(FILE)) ?? {};
  const shown = notices.missingDictionary ?? [];
  const missing = await languagesToMention(shown);
  if (!missing.length) return;
  await writeJson(FILE, { ...notices, missingDictionary: [...shown, ...missing.map((l) => l.id)] });

  const names = missing.map((l) => l.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const them = missing.length === 1 ? 'its dictionary isn’t' : 'their dictionaries aren’t';
  openDialog({
    title: missing.length === 1 ? `Add ${list} again?` : 'Add your languages again?',
    content: [
      el(
        'p',
        {},
        `Your known words for ${list} are here, but ${them}: dictionaries aren’t kept in backups. Add ${missing.length === 1 ? 'it' : 'them'} again in Settings → Languages for lookups, highlighting and known-word stats.`,
      ),
    ],
    cancelLabel: 'Not now',
    confirmLabel: 'Open settings',
    onConfirm: () => openSettings(missing.length === 1 ? missing[0].id : undefined),
  });
}
