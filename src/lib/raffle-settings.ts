import type { RafflePublic, Prize } from './model';
import { api, buttonBusy, toast } from './client';
import { setupCoverUpload, optimizeImage } from './image-upload';
import { normalizeWhatsApp } from './whatsapp';

export function setupRaffleSettings(id: string, callbacks: {
  getRaffle: () => RafflePublic;
  getVersion: () => number;
  isBusy: () => boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (raffle: RafflePublic, version: number) => void;
}) {
  const dialog = document.getElementById('settings-modal') as HTMLDialogElement | null;
  if (!dialog) return;
  const phone = document.getElementById('settings-whatsapp') as HTMLInputElement;
  const button = document.getElementById('settings-submit') as HTMLButtonElement;
  const error = document.getElementById('settings-error')!;
  const title = document.getElementById('settings-raffle-title') as HTMLInputElement;
  const files = document.getElementById('settings-prize-files') as HTMLInputElement;
  const previews = document.getElementById('settings-prizes')!;
  let prizes: Prize[] = [], expectedVersion = 0;
  function renderPrizes() {
    previews.replaceChildren();
    prizes.forEach((prize,index) => {
      const card = document.createElement('div'); card.className = 'prize-preview';
      const image = document.createElement('img'); image.src = prize.image; image.alt = prize.name;
      const name = document.createElement('input'); name.className = 'input'; name.required = true; name.maxLength = 80; name.value = prize.name; name.setAttribute('aria-label',`Nombre del premio ${index+1}`); name.addEventListener('input',()=>prize.name=name.value);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label',`Quitar premio ${index+1}`); remove.addEventListener('click',()=>{if(!busy){prizes.splice(index,1);renderPrizes();}});
      card.append(image,name,remove); previews.append(card);
    });
  }
  let busy = false;
  function showError(message: string) { error.textContent = message; error.hidden = false; }
  const cover = setupCoverUpload('settings', { isBusy: () => busy || callbacks.isBusy(), onBusy: value => setBusy(value, 'Optimizando portada…'), onError: showError });
  function setBusy(value: boolean, label?: string) {
    busy = value; phone.disabled = title.disabled = files.disabled = value; cover.setDisabled(value); previews.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(el=>el.disabled=value); buttonBusy(button, value, value ? label : undefined); callbacks.onBusy(value);
  }
  document.getElementById('settings-button')?.addEventListener('click', () => {
    const raffle = callbacks.getRaffle();
    if (busy || callbacks.isBusy() || raffle.draw || raffle.result) return;
    cover.setValue(raffle.cover || ''); phone.value = raffle.whatsapp ? `+${raffle.whatsapp}` : ''; error.hidden = true;
    title.value = raffle.title; prizes = raffle.prizes.map(prize=>({...prize})); expectedVersion = callbacks.getVersion(); files.value = ''; renderPrizes();
    dialog.showModal();
  });
  dialog.querySelectorAll('[data-close]').forEach(close => close.addEventListener('click', () => { if (!busy) dialog.close(); }));
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  files.addEventListener('change', async () => {
    if (busy || callbacks.isBusy()) return;
    const selected = Array.from(files.files || []);
    if (selected.length + prizes.length > 6) { showError('Puedes agregar hasta 6 premios.'); files.value = ''; return; }
    setBusy(true,'Optimizando premios…'); error.hidden = true;
    try { prizes.push(...await Promise.all(selected.map(async file=>({name:file.name.replace(/\.[^.]+$/,'').slice(0,80)||'Premio',image:await optimizeImage(file)})))); renderPrizes(); }
    catch (e) { showError((e as Error).message); }
    finally { files.value = ''; setBusy(false); }
  });
  document.getElementById('settings-form')!.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || callbacks.isBusy()) return;
    if (!prizes.length) { showError('Conserva al menos un premio.'); return; }
    let whatsapp: string;
    try { whatsapp = normalizeWhatsApp(phone.value.trim()); }
    catch (e) { showError((e as Error).message); phone.focus(); return; }
    error.hidden = true; setBusy(true, 'Guardando…');
    try {
      const data = await api(`/api/rifas/${encodeURIComponent(id)}/configurar`, { title: title.value, prizes, cover: cover.value, whatsapp, expectedVersion });
      callbacks.onSaved(data.public, data.version); dialog.close(); toast('Rifa actualizada. El cambio quedó registrado.');
    } catch (e) { showError((e as Error).message); }
    finally { setBusy(false); }
  });
}
