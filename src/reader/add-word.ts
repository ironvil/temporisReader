/** "Add to my words": selected text becomes a word in the reader's own dictionary for the language. */
import type { LanguageModule } from '../languages/types';
import { field, openDialog } from '../ui/dialog';
import { el, toast } from '../ui/dom';

/** Asks for an optional definition, then adds `word`. Resolves once the dialog closes. */
export function openAddWord(lang: LanguageModule, word: string, onAdded: () => void): void {
  const words = lang.userWords;
  if (!words) return;
  const existing = words.get(word);
  const definition = el('input', { type: 'text', autocomplete: 'off', value: existing?.definition ?? '' }) as HTMLInputElement;
  openDialog({
    title: existing ? 'Change your word' : 'Add to my words',
    content: [
      el('p', { class: 'add-word-word', lang: lang.htmlLang }, word),
      field('Definition (optional)', definition),
      el('p', { class: 'setting-help' }, `Kept apart from the ${lang.name} dictionary. The word is split and looked up as one from now on.`),
    ],
    confirmLabel: existing ? 'Save' : 'Add',
    onConfirm: async () => {
      await words.add(word, definition.value);
      onAdded();
      toast(existing ? `Saved “${word}”` : `Added “${word}” to your words`);
    },
  });
}
