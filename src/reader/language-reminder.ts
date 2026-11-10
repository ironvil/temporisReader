/** Shown every time a book opens whose language can't be looked up yet. */
import type { OpenBook } from '../books/library';
import type { LanguageModule } from '../languages/types';
import { openDialog } from '../ui/dialog';
import { el } from '../ui/dom';

export interface ReminderActions {
  onEditBook(id: string): void;
  onOpenSettings(language: string): void;
  /** False once the reader has moved on to another book (the reminder is then skipped). */
  stillOpen(): boolean;
}

/**
 * If the book's language isn't added, offers to add it; if the language isn't supported (or
 * wasn't detected), says lookups aren't available and offers to change the language.
 */
export async function remindAboutLanguage(book: OpenBook, lang: LanguageModule | null, actions: ReminderActions): Promise<void> {
  if (!lang) {
    openDialog({
      title: 'Lookups aren’t available',
      content: [
        el(
          'p',
          {},
          'This book’s language isn’t supported or couldn’t be detected, so words can’t be looked up. If it is in a supported language, set it in the book editor.',
        ),
      ],
      cancelLabel: 'Not now',
      confirmLabel: 'Change language',
      onConfirm: () => actions.onEditBook(book.meta.id),
    });
    return;
  }
  const states = await Promise.all(lang.dictionaries.map((d) => d.state()));
  if (states.every((s) => s.installed) || !actions.stillOpen()) return;
  openDialog({
    title: `Add ${lang.name}?`,
    content: [
      el(
        'p',
        {},
        `This book is in ${lang.name}, but ${lang.name} hasn’t been added yet. Word lookup, highlighting and known-word stats need its dictionary. Add it in Settings → Languages.`,
      ),
    ],
    cancelLabel: 'Not now',
    confirmLabel: 'Open settings',
    onConfirm: () => actions.onOpenSettings(lang.id),
  });
}
