import { el } from './dom';

export interface DialogOptions {
  title: string;
  content: (HTMLElement | null)[];
  confirmLabel: string;
  cancelLabel?: string;
  /** Return false (or throw) to keep the dialog open; thrown messages are shown in the dialog. */
  onConfirm: () => Promise<boolean | void> | boolean | void;
  /** A third choice, between cancel and confirm; it behaves like confirm. */
  alternative?: { label: string; onClick: () => Promise<boolean | void> | boolean | void };
}

/** Modal dialog built on <dialog>. Removes itself from the DOM when closed. */
export function openDialog(options: DialogOptions): HTMLDialogElement {
  const error = el('p', { class: 'dialog-error', role: 'alert', hidden: true });
  const cancel = el('button', { type: 'button', class: 'button secondary' }, options.cancelLabel ?? 'Cancel');
  const confirm = el('button', { type: 'submit', class: 'button' }, options.confirmLabel);
  const alternative = options.alternative ? el('button', { type: 'button', class: 'button secondary' }, options.alternative.label) : null;
  const form = el(
    'form',
    { method: 'dialog' },
    el('h2', {}, options.title),
    ...options.content,
    error,
    el('div', { class: 'actions dialog-actions' }, cancel, alternative, confirm),
  );
  const dialog = el('dialog', { class: 'dialog', 'aria-label': options.title }, form);

  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  const run = async (action: () => Promise<boolean | void> | boolean | void) => {
    error.hidden = true;
    const buttons = [cancel, confirm, alternative].filter((b): b is HTMLButtonElement => !!b);
    buttons.forEach((b) => (b.disabled = true));
    try {
      if ((await action()) !== false) dialog.close();
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
      error.hidden = false;
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void run(options.onConfirm);
  });
  alternative?.addEventListener('click', () => void run(options.alternative!.onClick));

  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/** Closes the top-most open dialog (Android back button). Returns true if one was open. */
export function closeTopDialog(): boolean {
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  const top = dialogs[dialogs.length - 1];
  top?.close();
  return !!top;
}

export function field(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), control);
}
