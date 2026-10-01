import { api, buttonBusy, toast, numberLabel } from '../lib/client';
import type { Prize, RafflePublic } from '../lib/model';
import { readTicketFiles, type ImportResult } from '../lib/ticket-import';
import { setupRaffleDeletion } from '../lib/delete-raffle';
import { optimizeImage, setupCoverUpload } from '../lib/image-upload';
import { normalizeWhatsApp } from '../lib/whatsapp';

const dialog = document.getElementById('create-modal') as HTMLDialogElement;
const form = document.getElementById('create-form') as HTMLFormElement;
const titleInput = document.getElementById('raffle-title') as HTMLInputElement;
const countInput = document.getElementById('ticket-count') as HTMLInputElement;
const filesInput = document.getElementById('prize-files') as HTMLInputElement;
const previews = document.getElementById('prize-previews')!;
const errorElement = document.getElementById('create-error')!;
const ticketFilesInput = document.getElementById('ticket-files') as HTMLInputElement;
const importPanel = document.getElementById('ticket-import-panel')!;
const importError = document.getElementById('import-error')!;
const importPreview = document.getElementById('ticket-import-preview')!;
const fileList = document.getElementById('ticket-file-list')!;
const sourceRadios = Array.from(form.querySelectorAll<HTMLInputElement>('[name="ticketSource"]'));
let processing = false; let submitting = false; let prizes: Prize[] = [];
let sourceFiles: File[] = [];
let imported: ImportResult | null = null;
let blankTicketCount = '';
let generation = 0;
const importing = () => sourceRadios.some(radio => radio.checked && radio.value === 'files');
const whatsappInput = document.getElementById('create-whatsapp') as HTMLInputElement;
const coverUpload = setupCoverUpload('create', {
  isBusy: () => processing || submitting,
  onBusy: busy => setProcessing(busy, busy ? 'Optimizando portada…' : undefined),
  onError: showError,
});

function openModal() {
  if (processing || submitting) return;
  generation++; prizes = []; form.reset(); previews.replaceChildren(); errorElement.hidden = true;
  coverUpload.setValue('');
  sourceFiles = []; imported = null; blankTicketCount = '';
  importPanel.hidden = true; importError.hidden = true; importPreview.hidden = true; fileList.replaceChildren();
  countInput.min = '1';
  document.getElementById('ticket-count-help')!.textContent = 'Los números se crean automáticamente, comenzando en el 001.';
  document.getElementById('create-description')!.textContent = 'Tú pones los premios. Nosotros ponemos la ruleta.';
  dialog.showModal();
}
document.querySelectorAll('[data-create]').forEach(button => button.addEventListener('click', () => openModal()));
dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => { if (!submitting && !processing) dialog.close(); }));
dialog.addEventListener('cancel', event => { if (submitting || processing) event.preventDefault(); });
dialog.addEventListener('click', event => { if (event.target === dialog && !submitting && !processing) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });

function showError(message: string) { errorElement.textContent = message; errorElement.hidden = false; }
function setProcessing(busy: boolean, label?: string) {
  processing = busy;
  filesInput.disabled = ticketFilesInput.disabled = busy;
  coverUpload.setDisabled(busy); whatsappInput.disabled = busy;
  sourceRadios.forEach(radio => radio.disabled = busy);
  fileList.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = busy);
  countInput.disabled = busy;
  buttonBusy(document.getElementById('create-submit') as HTMLButtonElement,busy,label);
}
function renderImportPreview() {
  importPreview.hidden = !imported;
  if (!imported) return;
  const total = Number(countInput.value);
  const validTotal = Number.isInteger(total) && total >= imported.maxNumber && total <= 5000;
  document.getElementById('import-number-count')!.textContent = String(imported.tickets.length);
  document.getElementById('import-sold-count')!.textContent = String(imported.sold);
  document.getElementById('import-available-count')!.textContent = validTotal ? String(total-imported.sold) : '—';
  document.getElementById('import-summary')!.textContent = `${sourceFiles.length} archivo${sourceFiles.length === 1 ? '' : 's'} · ${imported.sheets.length} tabla${imported.sheets.length === 1 ? '' : 's'} de boletos · número mayor #${numberLabel(imported.maxNumber)}.`;
  const gaps = document.getElementById('import-gaps')!;
  gaps.hidden = !validTotal || total === imported.tickets.length;
  gaps.textContent = `${total-imported.tickets.length} número${total-imported.tickets.length === 1 ? '' : 's'} no aparece${total-imported.tickets.length === 1 ? '' : 'n'} en los archivos y se creará${total-imported.tickets.length === 1 ? '' : 'n'} como disponible${total-imported.tickets.length === 1 ? '' : 's'}. La rifa tendrá los números del 001 al ${numberLabel(total)}.`;
  const skipped = document.getElementById('import-skipped')!;
  skipped.hidden = !imported.skippedSheets.length;
  skipped.textContent = `Hojas sin boletos que se omitieron: ${imported.skippedSheets.join(', ')}.`;
  const rows = document.getElementById('import-preview-rows')!; rows.replaceChildren();
  for (const ticket of imported.tickets.slice(0,8)) {
    const row = document.createElement('tr');
    for (const value of [`#${numberLabel(ticket.number)}`,ticket.buyer || '—',ticket.buyer ? 'Comprado' : 'Disponible']) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    rows.append(row);
  }
}
function renderFileList() {
  fileList.replaceChildren();
  sourceFiles.forEach((file,index) => {
    const item = document.createElement('li');
    const name = document.createElement('span'); name.textContent = file.name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.disabled = processing || submitting;
    remove.setAttribute('aria-label',`Quitar archivo ${file.name}`);
    remove.addEventListener('click',() => { if (!processing && !submitting) { sourceFiles.splice(index,1); processTicketFiles(); } });
    item.append(name,remove); fileList.append(item);
  });
}
async function processTicketFiles() {
  imported = null; importPreview.hidden = true; importError.hidden = true; errorElement.hidden = true;
  renderFileList();
  if (!sourceFiles.length) { countInput.value = ''; countInput.min = '1'; return; }
  const progress = document.getElementById('import-progress')!;
  progress.hidden = false; setProcessing(true,'Revisando boletos…');
  try {
    imported = await readTicketFiles(sourceFiles);
    countInput.value = String(imported.maxNumber); countInput.min = String(imported.maxNumber);
    document.getElementById('ticket-count-help')!.textContent = `Puedes ampliar el total. Debe incluir al menos el boleto #${numberLabel(imported.maxNumber)}. Los números que falten se crearán como disponibles.`;
    renderImportPreview();
  } catch (error) {
    countInput.value = ''; countInput.min = '1';
    importError.textContent = (error as Error).message; importError.hidden = false;
  } finally { progress.hidden = true; setProcessing(false); }
}
sourceRadios.forEach(radio => radio.addEventListener('change',() => {
  importPanel.hidden = !importing(); errorElement.hidden = true;
  if (importing()) {
    blankTicketCount = countInput.value;
    countInput.value = imported ? String(imported.maxNumber) : '';
    countInput.min = imported ? String(imported.maxNumber) : '1';
    document.getElementById('ticket-count-help')!.textContent = 'El total se calcula con el número mayor de tus archivos. Puedes ampliarlo para agregar números disponibles.';
    document.getElementById('create-description')!.textContent = 'Importa tus boletos, revisa el resumen y agrega tus premios.';
    renderImportPreview();
  } else {
    countInput.value = blankTicketCount; countInput.min = '1';
    document.getElementById('ticket-count-help')!.textContent = 'Los números se crean automáticamente, comenzando en el 001.';
    document.getElementById('create-description')!.textContent = 'Tú pones los premios. Nosotros ponemos la ruleta.';
  }
}));
ticketFilesInput.addEventListener('change',() => {
  if (processing || submitting) return;
  const files = Array.from(ticketFilesInput.files || []); ticketFilesInput.value = '';
  if (files.length) { sourceFiles.push(...files); processTicketFiles(); }
});
countInput.addEventListener('input',() => { if(importing()) renderImportPreview(); });

function renderPreviews() {
  previews.replaceChildren();
  prizes.forEach((prize, index) => {
    const card = document.createElement('div'); card.className = 'prize-preview';
    const image = document.createElement('img'); image.src = prize.image; image.alt = `Vista previa del premio ${index + 1}`;
    const input = document.createElement('input'); input.className = 'input'; input.value = prize.name; input.required = true; input.maxLength = 80; input.setAttribute('aria-label', `Nombre del premio ${index + 1}`); input.addEventListener('input', () => prize.name = input.value);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Quitar premio ${index + 1}`); remove.addEventListener('click', () => { if (!processing && !submitting) { prizes.splice(index,1); renderPreviews(); } });
    card.append(image,input,remove); previews.append(card);
  });
}
filesInput.addEventListener('change', async () => {
  if (processing || submitting) return;
  const files = Array.from(filesInput.files || []);
  if (files.length + prizes.length > 6) { showError('Puedes agregar hasta 6 imágenes.'); filesInput.value = ''; return; }
  const current = generation; errorElement.hidden = true;
  setProcessing(true,'Optimizando fotos…');
  try {
    const next = await Promise.all(files.map(async file => ({ name: file.name.replace(/\.[^.]+$/,'').slice(0,80) || 'Premio', image: await optimizeImage(file) })));
    if (current === generation) { prizes.push(...next); renderPreviews(); }
  } catch (error) { showError((error as Error).message); }
  finally { filesInput.value = ''; setProcessing(false); }
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (processing || submitting) return;
  if (importing() && (!imported || !sourceFiles.length)) { showError('Selecciona tus archivos y corrige los errores de importación antes de crear la rifa.'); return; }
  if (!prizes.length) { showError('Agrega al menos una imagen de un premio.'); return; }
  let whatsapp: string;
  try { whatsapp = normalizeWhatsApp(whatsappInput.value.trim()); }
  catch (error) { showError((error as Error).message); whatsappInput.focus(); return; }
  errorElement.hidden = true; submitting = true; form.setAttribute('aria-busy','true');
  const submit = document.getElementById('create-submit') as HTMLButtonElement;
  buttonBusy(submit,true,'Guardando tu rifa…');
  filesInput.disabled = ticketFilesInput.disabled = true;
  coverUpload.setDisabled(true); whatsappInput.disabled = true;
  sourceRadios.forEach(radio => radio.disabled = true);
  fileList.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = true);
  try {
    const { id } = await api('/api/rifas', { title: titleInput.value.trim(), ticketCount: Number(countInput.value), prizes, ...(coverUpload.value ? { cover: coverUpload.value } : {}), ...(whatsapp ? { whatsapp } : {}), ...(importing() && imported ? { importedTickets: imported.tickets } : {}) });
    location.assign(`/rifas/${id}`);
  } catch (error) {
    showError((error as Error).message); submitting = false; buttonBusy(submit,false); form.removeAttribute('aria-busy');
    filesInput.disabled = ticketFilesInput.disabled = false;
    coverUpload.setDisabled(false); whatsappInput.disabled = false;
    sourceRadios.forEach(radio => radio.disabled = false);
    fileList.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = false);
  }
});

const deleteRaffle = setupRaffleDeletion(() => loadRaffles());
async function loadRaffles() {
  const container = document.getElementById('raffle-list')!;
  try {
    const { raffles } = await api('/api/rifas') as { raffles: (RafflePublic & {id:string})[] };
    document.getElementById('stat-raffles')!.textContent = String(raffles.length);
    document.getElementById('stat-sold')!.textContent = String(raffles.reduce((sum,r) => sum + Object.keys(r.sold || {}).length,0));
    document.getElementById('stat-available')!.textContent = String(raffles.reduce((sum,r) => sum + r.ticketCount - Object.keys(r.sold || {}).length,0));
    container.replaceChildren();
    if (!raffles.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state';
      const heading = document.createElement('h3'); heading.textContent = 'Tu primera rifa te está esperando';
      const text = document.createElement('p'); text.textContent = 'Agrega tus premios y convierte una buena idea en una nueva oportunidad.';
      const button = document.createElement('button'); button.className = 'btn btn-primary'; button.textContent = 'Crear mi primera rifa'; button.addEventListener('click', () => openModal());
      empty.append(heading,text,button); container.append(empty); return;
    }
    for (const raffle of raffles) {
      const card = document.createElement('article'); card.className = 'raffle-card';
      const link = document.createElement('a'); link.href = `/rifas/${encodeURIComponent(raffle.id)}`;
      const image = document.createElement('img'); image.src = raffle.cover || raffle.prizes[0].image; image.alt = raffle.cover ? `Portada de ${raffle.title}` : raffle.prizes[0].name; image.loading = 'lazy';
      const copy = document.createElement('div'); copy.className = 'card-copy';
      const badge = document.createElement('span'); badge.className = `status-pill${raffle.result ? ' closed' : ''}`; badge.textContent = raffle.result ? 'Finalizada' : raffle.draw ? 'Sorteo en curso' : 'Activa';
      const title = document.createElement('h3'); title.textContent = raffle.title;
      const text = document.createElement('p'); const sold = Object.keys(raffle.sold || {}).length; text.textContent = `${sold} de ${raffle.ticketCount} boletos vendidos`;
      const bottom = document.createElement('div'); bottom.className = 'card-bottom';
      const label = document.createElement('a'); label.href = link.href; label.textContent = 'Administrar rifa ↗';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-link'; remove.textContent = 'Eliminar'; remove.setAttribute('aria-label', `Eliminar ${raffle.title}`);
      remove.addEventListener('click', () => deleteRaffle(raffle.id, raffle.title)); bottom.append(label);
      if (raffle.ownerId === document.querySelector<HTMLElement>('[data-user-id]')?.dataset.userId) bottom.append(remove);
      else { const shared = document.createElement('span'); shared.className = 'owner-label'; shared.textContent = 'Rifa compartida contigo'; bottom.append(shared); }
      copy.append(badge,title,text); link.append(image,copy); card.append(link,bottom); container.append(card);
    }
  } catch (error) {
    const panel = document.createElement('div'); panel.className = 'error-panel'; panel.style.gridColumn = '1/-1'; panel.textContent = (error as Error).message;
    const retry = document.createElement('button'); retry.className = 'btn btn-outline'; retry.textContent = 'Volver a intentar'; retry.style.marginTop = '15px'; retry.style.display = 'block'; retry.addEventListener('click', () => loadRaffles()); panel.append(retry); container.replaceChildren(panel);
    toast('No se pudieron cargar tus rifas.',true);
  }
}
loadRaffles();
