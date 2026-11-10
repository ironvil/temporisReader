/** Known-word levels from the lookup popup. */
import { getSettings } from '../settings';
import { el } from '../ui/dom';
import { KNOWN, knownWords, LEVELS, type Level } from '../vocab/known-words';

/**
 * Looking a word up says something about it (each part has its own setting, both dated today):
 * a known word isn't really known, so it goes back to 2; a word not in the list yet starts at 1.
 */
export async function updateLevelOnLookup(language: string, word: string): Promise<void> {
  const { downgradeOnLookup, trackOnLookup } = getSettings();
  if (!downgradeOnLookup && !trackOnLookup) return;
  const store = knownWords(language);
  await store.load();
  const level = store.level(word);
  if (level === KNOWN && downgradeOnLookup) await store.set(word, 2);
  else if (level === undefined && trackOnLookup) await store.set(word, 1);
}

/** 0 / 1 / 2 / ✓ buttons; the word's current level is highlighted. Tapping sets it and stamps today. */
export async function statusButtons(language: string, word: string): Promise<HTMLElement> {
  const store = knownWords(language);
  await store.load();
  const row = el('div', { class: 'word-status', role: 'group', 'aria-label': `Status of ${word}` });
  const render = () => {
    const current = store.level(word);
    row.replaceChildren(
      ...LEVELS.map((level: Level) => {
        const known = level === KNOWN;
        const button = el(
          'button',
          {
            type: 'button',
            class: `status-btn${known ? ' known' : ''}`,
            'aria-label': known ? 'Known' : `Level ${level}`,
            'aria-pressed': String(current === level),
          },
          known ? '✓' : String(level),
        );
        button.addEventListener('click', async () => {
          await store.set(word, level);
          render();
        });
        return button;
      }),
    );
  };
  render();
  return row;
}
