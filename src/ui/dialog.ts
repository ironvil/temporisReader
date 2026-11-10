import { el } from './dom';

export interface DialogOptions {
  title: string;
  content: (HTMLElement | null)[];
  confirmLabel: string;
  /** Return false (or throw) to keep the dialog open; thrown messages are shown in the dialog. */
  onConfirm: () => Promise<boolean | void> | boolean | void;
}

/** Modal dialog built on <dialog>. Removes itself from the DOM when closed. */
export function openDialog(options: DialogOptions): HTMLDialogElement {
  const error = el('p', { class: 'dialog-error', role: 'alert', hidden: true });
  const cancel = el('button', { type: 'button', class: 'button secondary' }, 'Cancel');
  const confirm = el('button', { type: 'submit', class: 'button' }, options.confirmLabel);
  const form = el(
    'form',
    { method: 'dialog' },
    el('h2', {}, options.title),
    ...options.content,
    error,
    el('div', { class: 'actions dialog-actions' }, cancel, confirm),
  );
  const dialog = el('dialog', { class: 'dialog', 'aria-label': options.title }, form);

  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    confirm.disabled = cancel.disabled = true;
    try {
      if ((await options.onConfirm()) !== false) dialog.close();
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
      error.hidden = false;
    } finally {
      confirm.disabled = cancel.disabled = false;
    }
  });

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
