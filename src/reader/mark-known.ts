/** The "mark words as known?" prompt shown on a forward page turn. */
import { openDialog } from '../ui/dialog';
import { el, toast } from '../ui/dom';
import { KNOWN, knownWords } from '../vocab/known-words';

/** Pages read for less than this are skipped by the "mark unlooked-up words as known" prompt. */
export const MIN_PAGE_DWELL_MS = 10_000;

/** Lists the words as toggles (all selected); only selected words are marked. */
export function offerMarkKnown(language: string, words: string[], htmlLang?: string): void {
  const n = words.length;
  const selected = new Set(words);
  const chips = words.map((w) => {
    const chip = el('button', { type: 'button', class: 'word-chip', 'aria-pressed': 'true' }, w);
    chip.addEventListener('click', () => {
      if (selected.has(w)) selected.delete(w);
      else selected.add(w);
      chip.setAttribute('aria-pressed', String(selected.has(w)));
      updateConfirm();
    });
    return chip;
  });
  const dialog = openDialog({
    title: 'Mark words as known?',
    content: [
      el('p', {}, `${n} ${n === 1 ? 'word' : 'words'} on the page you just read ${n === 1 ? 'wasn’t' : 'weren’t'} looked up. Tap a word to leave it out.`),
      el('div', { class: 'word-chips', lang: htmlLang }, ...chips),
    ],
    cancelLabel: 'Not now',
    confirmLabel: `Mark ${n} known`,
    onConfirm: async () => {
      const chosen = words.filter((w) => selected.has(w));
      if (!chosen.length) return;
      await knownWords(language).setMany(chosen, KNOWN);
      toast(`Marked ${chosen.length} ${chosen.length === 1 ? 'word' : 'words'} as known`);
    },
  });
  const confirm = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const updateConfirm = () => {
    confirm.textContent = `Mark ${selected.size} known`;
    confirm.disabled = selected.size === 0;
  };
}
