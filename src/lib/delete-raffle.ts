import { api, buttonBusy, toast } from './client';

export function setupRaffleDeletion(onDeleted: () => void | Promise<void>) {
  const dialog = document.getElementById('delete-modal') as HTMLDialogElement | null;
  if (!dialog) return () => {};
  let selectedId = '', deleting = false;
  const button = document.getElementById('confirm-delete') as HTMLButtonElement;
  const error = document.getElementById('delete-error')!;
  dialog.querySelectorAll('[data-close]').forEach(close => close.addEventListener('click', () => { if (!deleting) dialog.close(); }));
  dialog.addEventListener('cancel', event => { if (deleting) event.preventDefault(); });
  button.addEventListener('click', async () => {
    if (deleting || !selectedId) return;
    deleting = true; buttonBusy(button, true, 'Eliminando…'); error.hidden = true;
    try {
      await api(`/api/rifas/${encodeURIComponent(selectedId)}`, undefined, 'DELETE');
      dialog.close(); toast('Rifa eliminada.'); await onDeleted();
    } catch (e) { error.textContent = (e as Error).message; error.hidden = false; }
    finally { deleting = false; buttonBusy(button, false); }
  });
  return (id: string, title: string) => {
    if (deleting) return;
    selectedId = id; error.hidden = true;
    document.getElementById('delete-raffle-title')!.textContent = title;
    dialog.showModal();
  };
}
