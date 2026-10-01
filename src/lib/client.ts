export async function api(path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST') {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'No se pudo completar la solicitud.');
  return body;
}
export function toast(message: string, error = false) {
  const element = document.getElementById('toast')!;
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  window.clearTimeout(Number(element.dataset.timer));
  element.dataset.timer = String(window.setTimeout(() => element.hidden = true, 6000));
}
export const numberLabel = (n: number) => String(n).padStart(3, '0');
export function buttonBusy(button: HTMLButtonElement, busy: boolean, label?: string) {
  if (busy) button.dataset.original = button.textContent || '';
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
  if (label) button.textContent = label;
  else if (!busy && button.dataset.original) button.textContent = button.dataset.original;
}
