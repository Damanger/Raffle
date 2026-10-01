import { animate } from 'motion';
import { onValue, ref, query as databaseQuery, orderByKey, limitToLast } from 'firebase/database';
import { auth } from '../lib/firebase-client';
import { database } from '../lib/firebase-realtime';
import { onAuthStateChanged } from 'firebase/auth';
import { api, buttonBusy, numberLabel, toast } from '../lib/client';
import type { RafflePublic, Entry } from '../lib/model';
import { drawnNumbers, eliminatedNumbers, eligibleNumbers, wheelSegments, winnerNumbers, drawWinnerCount, eliminationCount, nextDrawKind } from '../lib/draw';
import { setupRaffleDeletion } from '../lib/delete-raffle';
import { setupRaffleSettings } from '../lib/raffle-settings';
import { ticketWhatsAppLink } from '../lib/whatsapp';
import { setupRaffleTeam } from '../lib/raffle-team';
import { setupPrizeGallery } from '../lib/prize-gallery';
import { setupWheelFullscreen } from '../lib/wheel-fullscreen';
import { planWheelAnimation } from '../lib/wheel-animation';

const main = document.querySelector<HTMLElement>('[data-raffle-id]');
if (main) {
  const id = main.dataset.raffleId!;
  const owner = main.dataset.admin === 'true';
  const creator = main.dataset.owner === 'true';
  let raffle = JSON.parse(document.getElementById('raffle-data')!.textContent!) as RafflePublic;
  let entries: Record<string, Entry> = {};
  const gallery = setupPrizeGallery();
  let version = 0, saleVersion = 0, editing = false;
  let privateReady = !owner;
  const team = owner ? setupRaffleTeam(id, creator, { onChanged: refreshOwner, onDenied: accessDenied }) : null;
  function accessDenied() { if (removed) return; if (creator) toast('No se pudo consultar la administración compartida. Publica las reglas actualizadas de Firebase y recarga.',true); else { entries = {}; location.assign('/perfil'); } }
  let filter = 'all', query = '', page = 0, selected = 0, saleNumber = 0;
  let selling = false, drawing = false, spinning = false, removed = false, configuring = false;
  let whatsappBuyer = '';
  const pageSize = 96;
  const grid = document.getElementById('ticket-grid')!;
  const detail = document.getElementById('ticket-detail')!;
  const wheel = document.getElementById('raffle-wheel')!;
  const saleModal = document.getElementById('sale-modal') as HTMLDialogElement | null;
  const drawModal = document.getElementById('draw-modal') as HTMLDialogElement | null;
  const drawButton = document.getElementById('draw-button') as HTMLButtonElement | null;
  const eliminationInput = document.getElementById('elimination-count') as HTMLInputElement | null;
  const winnerInput = document.getElementById('winner-count') as HTMLInputElement | null;
  const zoom = document.getElementById('wheel-zoom') as HTMLInputElement;
  const viewport = document.getElementById('roulette-viewport')!;
  const wheelWrap = wheel.parentElement!;
  const wheelPanel = document.getElementById('wheel-panel')!;
  // The confirmation dialog must be inside the fullscreen element to stay visible.
  if (drawModal) wheelPanel.append(drawModal);
  const fullscreen = setupWheelFullscreen(wheelPanel,document.getElementById('wheel-fullscreen') as HTMLButtonElement,applyZoom);
  const deleteButton = document.getElementById('delete-raffle') as HTMLButtonElement | null;
  const deleteRaffle = setupRaffleDeletion(() => { location.assign('/perfil'); });
  deleteButton?.addEventListener('click', () => { if (!drawing && !selling && !configuring) deleteRaffle(id, raffle.title); });
  const settingsButton = document.getElementById('settings-button') as HTMLButtonElement | null;
  if (owner) setupRaffleSettings(id, {
    getRaffle: () => raffle,
    getVersion: () => version,
    isBusy: () => drawing || selling || configuring || removed || !privateReady,
    onBusy: busy => { configuring = busy; updateStats(); },
    onSaved: (value, savedVersion) => { raffle = value; version = savedVersion; updateStats(); renderTickets(); team?.loadHistory(); },
  });
  const soldNumbers = () => Object.keys(raffle.sold || {}).map(Number).sort((a,b)=>a-b);
  const resultBuyer = (number: number) => raffle.winnerNames?.[String(number)] || (owner ? entries[number]?.buyer : '') || '';

  function updateStats() {
    if (removed) return;
    document.querySelector('.raffle-title-row h1')!.textContent = raffle.title;
    gallery.setPrizes(raffle.prizes);
    document.getElementById('wheel-raffle-title')!.textContent = raffle.title;
    document.getElementById('prize-count')!.textContent = `${raffle.prizes.length} premio${raffle.prizes.length === 1 ? '' : 's'}`;
    const cover = document.getElementById('raffle-cover')!;
    const coverImage = document.getElementById('raffle-cover-image') as HTMLImageElement;
    cover.hidden = !raffle.cover;
    if (raffle.cover && coverImage.getAttribute('src') !== raffle.cover) coverImage.src = raffle.cover;
    else if (!raffle.cover) coverImage.removeAttribute('src');
    const sold = soldNumbers().length;
    document.getElementById('sold-count')!.textContent = String(sold);
    document.getElementById('available-count')!.textContent = String(raffle.ticketCount-sold);
    document.getElementById('sold-progress')!.style.width = `${sold/raffle.ticketCount*100}%`;
    document.querySelector('[role=progressbar]')!.setAttribute('aria-valuenow',String(sold));
    if (drawButton) {
      drawButton.disabled = !privateReady || drawing || selling || configuring || !!raffle.result || !sold;
      if (!spinning) drawButton.textContent = raffle.result ? 'Resultado registrado' : raffle.draw ? `Girar ${raffle.draw.round + 1} de ${raffle.draw.totalSpins}` : 'Girar la ruleta';
    }
    if (deleteButton) deleteButton.disabled = drawing || selling || configuring;
    if (settingsButton) {
      settingsButton.disabled = !privateReady || drawing || selling || configuring || !!raffle.draw || !!raffle.result;
      settingsButton.title = raffle.draw || raffle.result ? 'La configuración se cierra al iniciar el sorteo.' : '';
    }
    const badge = document.getElementById('raffle-status')!;
    badge.textContent = raffle.result ? 'Rifa finalizada' : raffle.draw ? 'Sorteo en curso' : 'Rifa activa';
    badge.classList.toggle('closed', !!raffle.result);
    if (!spinning) { showWinner(); renderDrawProgress(); }
  }
  function showWinner() {
    const winners = winnerNumbers(raffle);
    document.getElementById('winner-box')!.hidden = !winners.length;
    document.getElementById('winner-heading')!.textContent = `GANADORES: ${winners.length} DE ${drawWinnerCount(raffle)}`;
    const list = document.getElementById('winner-list')!; list.replaceChildren();
    winners.forEach((number,index)=>{
      const row = document.createElement('li'), label = document.createElement('span'), value = document.createElement('strong');
      label.textContent = `Ganador ${index+1}${drawWinnerCount(raffle) === raffle.prizes.length ? ` · ${raffle.prizes[index]?.name || 'Premio'}` : drawWinnerCount(raffle) === 1 ? ' · Todos los premios' : ''}`;
      value.textContent = `#${numberLabel(number)}`;
      const buyer = document.createElement('span'); buyer.className = 'result-buyer'; buyer.textContent = resultBuyer(number) || 'Nombre no registrado';
      row.append(value,buyer,label);list.append(row);
    });
    document.getElementById('winner-note')!.textContent = `${raffle.draw?.initialCount || raffle.result?.eligibleCount || 0} boletos participaron · ${eliminatedNumbers(raffle).length} eliminados`;
  }
  let renderedPool = '', rotation = 0;
  function applyZoom() {
    wheelWrap.style.setProperty('--wheel-zoom', zoom.value);
    document.getElementById('wheel-zoom-value')!.textContent = `${zoom.value}×`;
    viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    viewport.scrollTop = 0;
  }
  zoom.addEventListener('input', applyZoom);
  function renderWheel(pool = eligibleNumbers(raffle), target?: number) {
    if (removed) return;
    const signature = pool.join(',');
    if (signature !== renderedPool || !wheel.querySelector('text')) {
      renderedPool = signature;
      const svg = wheel.querySelector('svg')!;
      svg.replaceChildren();
      const namespace = 'http://www.w3.org/2000/svg';
      const fragment = document.createDocumentFragment();
      for (const [index, segment] of wheelSegments(pool).entries()) {
        const shape = document.createElementNS(namespace, pool.length === 1 ? 'circle' : 'path');
        if (pool.length === 1) { shape.setAttribute('cx', '160'); shape.setAttribute('cy', '160'); shape.setAttribute('r', '154'); }
        else shape.setAttribute('d', segment.path);
        shape.setAttribute('fill', index % 2 ? '#ed961f' : '#17416b');
        const label = document.createElementNS(namespace, 'text');
        label.textContent = numberLabel(segment.number);
        label.setAttribute('data-wheel-number', String(segment.number));
        label.setAttribute('x', String(segment.x)); label.setAttribute('y', String(segment.y));
        label.setAttribute('transform', `rotate(${segment.angle + 90} ${segment.x} ${segment.y})`);
        label.setAttribute('font-size', String(Math.min(12, 620 / (pool.length * 3))));
        label.setAttribute('fill', index % 2 ? '#163b5c' : '#fff8e7');
        fragment.append(shape, label);
      }
      svg.append(fragment);
      rotation = 0; wheel.style.transform = 'rotate(0deg)';
      zoom.max = String(Math.max(1, Math.ceil(pool.length / 20)));
      zoom.value = String(Math.min(Number(zoom.value), Number(zoom.max))); applyZoom();
    }
    wheelWrap.setAttribute('role', 'img');
    wheelWrap.setAttribute('aria-label', `Ruleta con los ${pool.length} números participantes, un sector por boleto.${target ? ` Número seleccionado: ${target}.` : ''}`);
    if (target && !spinning) {
      const segment = wheelSegments(pool).find(s => s.number === target);
      if (segment) { rotation = segment.rotation; wheel.style.transform = `rotate(${rotation}deg)`; }
    }
  }
  function renderDrawProgress() {
    const eligible = eligibleNumbers(raffle), eliminated = eliminatedNumbers(raffle), history = drawnNumbers(raffle), winners = winnerNumbers(raffle);
    document.getElementById('wheel-caption')!.textContent = `${eligible.length} números ${raffle.result ? 'en el último giro' : 'siguen participando'} · ${eliminated.length} eliminados · ${winners.length} ganadores`;
    document.getElementById('participant-count')!.textContent = `(${eligible.length})`;
    const participants = document.getElementById('participants-list')!; participants.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const number of eligible) {
      const chip = document.createElement('span'); chip.textContent = numberLabel(number);
      chip.className = `participant-number${winners.includes(number) ? ' winner' : ''}`;
      fragment.append(chip);
    }
    participants.append(fragment);
    if (!eligible.length) participants.textContent = 'Registra ventas para agregar participantes.';
    document.getElementById('spin-status')!.textContent = raffle.result ? `Sorteo finalizado · ${winners.length} ganador${winners.length === 1 ? '' : 'es'}` : raffle.draw ? `Giro ${raffle.draw.round} de ${raffle.draw.totalSpins} completado. ${nextDrawKind(raffle) === 'winner' ? `El próximo giro elige al ganador ${winners.length+1} de ${drawWinnerCount(raffle)}.` : 'El próximo giro elimina otro número.'}` : 'El sorteo aún no comienza.';
    const outcome = document.getElementById('spin-outcome')!; outcome.hidden = !raffle.draw || !!raffle.result;
    if (raffle.draw && !raffle.result) {
      document.getElementById('spin-outcome-label')!.textContent = winners.includes(raffle.draw.lastNumber) ? `GANADOR ${winners.length} DE ${drawWinnerCount(raffle)}` : `ELIMINADO EN EL GIRO ${raffle.draw.round}`;
      outcome.classList.toggle('winning',winners.includes(raffle.draw.lastNumber));
      document.getElementById('spin-outcome-number')!.textContent = `#${numberLabel(raffle.draw.lastNumber)}`;
      const buyer = document.getElementById('spin-outcome-buyer')!;
      buyer.textContent = resultBuyer(raffle.draw.lastNumber); buyer.hidden = !buyer.textContent;
    }
    document.getElementById('draw-history-panel')!.hidden = !history.length;
    const list = document.getElementById('draw-history')!; list.replaceChildren();
    history.forEach((number, index) => {
      const item = document.createElement('li');
      const buyer = resultBuyer(number);
      item.textContent = `Giro ${index + 1}: #${numberLabel(number)}${buyer ? ` · ${buyer}` : ''} · ${index >= eliminationCount(raffle) ? `Ganador ${index-eliminationCount(raffle)+1}` : 'Eliminado'}`; list.append(item);
    });
  }
  function renderTickets() {
    if (removed) return;
    const eliminated = new Set(eliminatedNumbers(raffle));
    const winners = new Set(winnerNumbers(raffle));
    const all = Array.from({length:raffle.ticketCount},(_,i)=>i+1).filter(n => {
      const sold = !!raffle.sold?.[String(n)];
      return (filter === 'all' || (filter === 'sold' ? sold : filter === 'eliminated' ? eliminated.has(n) : filter === 'winners' ? winners.has(n) : !sold)) && (!query || (Number(query) === n));
    });
    page = Math.min(page,Math.max(0,Math.ceil(all.length/pageSize)-1));
    const visible = all.slice(page*pageSize,(page+1)*pageSize); grid.replaceChildren();
    for (const n of visible) {
      const sold = !!raffle.sold?.[n]; const button = document.createElement('button'); button.type = 'button';
      button.className = `ticket${sold ? ' sold' : ''}${eliminated.has(n) ? ' eliminated' : ''}${selected === n ? ' selected' : ''}${winners.has(n) ? ' winner' : ''}`;
      button.dataset.number = String(n); button.textContent = numberLabel(n);
      button.setAttribute('aria-label', `Boleto ${n}, ${sold ? 'comprado' : 'disponible'}${eliminated.has(n) ? ', eliminado del sorteo' : ''}${winners.has(n) ? ', ganador' : ''}`); button.setAttribute('aria-pressed',String(selected === n)); grid.append(button);
    }
    document.getElementById('no-tickets')!.hidden = !!all.length;
    document.getElementById('page-label')!.textContent = all.length ? `${page*pageSize+1}–${Math.min((page+1)*pageSize,all.length)} de ${all.length}` : '0 resultados';
    (document.getElementById('prev-page') as HTMLButtonElement).disabled = page === 0;
    (document.getElementById('next-page') as HTMLButtonElement).disabled = (page+1)*pageSize >= all.length;
    if (selected) showDetail(selected);
  }
  function showDetail(n: number) {
    const previousInput = detail.querySelector<HTMLInputElement>('[data-whatsapp-name]');
    const restoreFocus = previousInput === document.activeElement;
    const cursor = previousInput?.selectionStart;
    detail.hidden = false; detail.replaceChildren();
    const heading = document.createElement('strong'); heading.textContent = `Boleto #${numberLabel(n)}`; detail.append(heading);
    const text = document.createElement('span');
    if (raffle.sold?.[n]) {
      text.textContent = eliminatedNumbers(raffle).includes(n) ? 'Este número fue eliminado del sorteo.' : winnerNumbers(raffle).includes(n) ? `Este es el ganador ${winnerNumbers(raffle).indexOf(n)+1} del sorteo.` : 'Este número ya está comprado.'; detail.append(text);
      if (!owner && raffle.winnerNames?.[String(n)]) { const buyer = document.createElement('p'); buyer.textContent = `Ganador: ${raffle.winnerNames[String(n)]}`; detail.append(buyer); }
      if (owner && entries[n]) {
        const buyer = document.createElement('p'); buyer.textContent = `Comprador: ${entries[n].buyer}`; detail.append(buyer);
        if (entries[n].contact) { const contact = document.createElement('p'); contact.textContent = `Contacto: ${entries[n].contact}`; detail.append(contact); }
        if (entries[n].seller) { const seller = document.createElement('p'); seller.textContent = `Vendedor: ${entries[n].seller}`; detail.append(seller); }
        const modified = document.createElement('p'); modified.className = 'field-help'; modified.textContent = entries[n].modifiedBy ? `Última modificación: ${entries[n].modifiedBy!.name} (${entries[n].modifiedBy!.email}) · ${new Date(entries[n].modifiedAt || entries[n].soldAt).toLocaleString('es-MX')}` : 'Importado / sin registro anterior de administrador.'; detail.append(modified);
        if (!raffle.draw && !raffle.result) { const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn btn-outline'; edit.textContent = 'Editar comprador o liberar boleto'; edit.disabled = selling || drawing || configuring; edit.addEventListener('click',()=>openSale(n,true)); detail.append(edit); }
      }
    } else {
      text.textContent = raffle.result || raffle.draw ? 'Este número no participó en el sorteo.' : 'Este número está disponible.'; detail.append(text);
      if (!raffle.result && !raffle.draw && raffle.whatsapp) {
        const form = document.createElement('form'); form.className = 'ticket-contact-form';
        const label = document.createElement('label'); label.className = 'field';
        const caption = document.createElement('span'); caption.className = 'field-label'; caption.textContent = 'Tu nombre para solicitar este boleto';
        const input = document.createElement('input'); input.className = 'input'; input.type = 'text'; input.required = true; input.maxLength = 120; input.autocomplete = 'name'; input.placeholder = 'Nombre del comprador'; input.value = whatsappBuyer; input.dataset.whatsappName = '';
        input.addEventListener('input', () => { whatsappBuyer = input.value; });
        label.append(caption, input);
        const help = document.createElement('p'); help.className = 'field-help'; help.textContent = `Contactarás al vendedor al +${raffle.whatsapp}. El mensaje incluirá tu nombre y el boleto #${numberLabel(n)}. El organizador confirmará la compra y registrará el boleto.`;
        const button = document.createElement('button'); button.type = 'submit'; button.className = 'btn btn-whatsapp'; button.textContent = 'Contactar por WhatsApp';
        const error = document.createElement('p'); error.className = 'form-error'; error.setAttribute('role', 'alert'); error.hidden = true;
        form.addEventListener('submit', event => {
          event.preventDefault(); error.hidden = true;
          try {
            const link = ticketWhatsAppLink(raffle, n, input.value, location.href);
            window.open(link, '_blank', 'noopener,noreferrer');
          } catch (e) { error.textContent = (e as Error).message; error.hidden = false; }
        });
        form.append(label,help,button,error); detail.append(form);
        if (restoreFocus) { input.focus({ preventScroll: true }); if (cursor !== null && cursor !== undefined) input.setSelectionRange(cursor, cursor); }
      } else if (!raffle.draw && !raffle.result && !raffle.whatsapp) {
        const help = document.createElement('p'); help.className = 'field-help'; help.textContent = owner ? 'Agrega el número del vendedor en Editar rifa para recibir solicitudes de este boleto.' : 'Contacta al organizador para solicitar este boleto.'; detail.append(help);
      }
      if (owner && !raffle.result && !raffle.draw) {
        const button = document.createElement('button'); button.className = 'btn btn-primary'; button.textContent = 'Marcar como ocupado';
        button.addEventListener('click', () => {
          if (!selling && !drawing && !configuring) openSale(n);
        }); detail.append(button);
      }
    }
  }
  function openSale(n: number, edit = false) {
    if (!privateReady || selling || drawing || configuring) return;
    editing = edit; saleNumber = n; saleVersion = version;
    (document.getElementById('sale-form') as HTMLFormElement).reset(); document.getElementById('sale-error')!.hidden = true;
    document.getElementById('sale-title')!.textContent = edit ? 'Editar boleto ocupado' : 'Marcar boleto como ocupado';
    document.getElementById('release-field')!.hidden = !edit;
    document.getElementById('sale-submit')!.textContent = edit ? 'Guardar cambios' : 'Guardar boleto ocupado';
    (document.getElementById('buyer-name') as HTMLInputElement).value = edit ? entries[n]?.buyer || '' : whatsappBuyer.trim();
    (document.getElementById('buyer-name') as HTMLInputElement).required = true;
    (document.getElementById('buyer-contact') as HTMLInputElement).value = edit ? entries[n]?.contact || '' : '';
    (document.getElementById('buyer-seller') as HTMLInputElement).value = edit ? entries[n]?.seller || '' : '';
    document.getElementById('sale-number')!.textContent = `Boleto #${numberLabel(n)}`; saleModal!.showModal();
  }
  document.getElementById('release-ticket')?.addEventListener('change',event=>{ (document.getElementById('buyer-name') as HTMLInputElement).required = !(event.target as HTMLInputElement).checked; });
  grid.addEventListener('click', event => { const button = (event.target as Element).closest<HTMLButtonElement>('[data-number]'); if (button) { selected = Number(button.dataset.number); renderTickets(); } });
  document.getElementById('ticket-search')!.addEventListener('input', event => { query = (event.target as HTMLInputElement).value.trim(); page = 0; renderTickets(); });
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter!; page = 0; document.querySelectorAll('[data-filter]').forEach(element=>element.setAttribute('aria-pressed',String(element === button))); renderTickets(); }));
  document.getElementById('prev-page')!.addEventListener('click',()=>{page--;renderTickets();});
  document.getElementById('next-page')!.addEventListener('click',()=>{page++;renderTickets();});
  document.getElementById('share-raffle')!.addEventListener('click',async()=>{
    try { if (navigator.share) await navigator.share({title:raffle.title,url:location.href}); else { await navigator.clipboard.writeText(location.href); toast('Enlace copiado. Compártelo y que comience la suerte.'); } }
    catch(error) { if ((error as Error).name !== 'AbortError') toast(`Comparte este enlace: ${location.href}`); }
  });

  for (const modal of [saleModal,drawModal]) {
    modal?.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>{if (!selling && !drawing) modal.close();}));
    modal?.addEventListener('cancel',event=>{if(selling || drawing)event.preventDefault();});
  }
  document.getElementById('sale-form')?.addEventListener('submit',async event=>{
    event.preventDefault(); if(selling || drawing || configuring)return; selling = true; updateStats();
    const button = document.getElementById('sale-submit') as HTMLButtonElement; buttonBusy(button,true,'Guardando…');
    const error = document.getElementById('sale-error')!; error.hidden = true;
    try {
      const available = editing && (document.getElementById('release-ticket') as HTMLInputElement).checked;
      await api(`/api/rifas/${id}/${editing ? 'editar-boleto' : 'vender'}`,{number:saleNumber,buyer:(document.getElementById('buyer-name') as HTMLInputElement).value,contact:(document.getElementById('buyer-contact') as HTMLInputElement).value,seller:(document.getElementById('buyer-seller') as HTMLInputElement).value,...(editing ? {available, expectedVersion:saleVersion} : {})});
      whatsappBuyer = ''; await refreshOwner(); await team?.loadHistory(); saleModal!.close(); toast(`Boleto #${numberLabel(saleNumber)} ${available ? 'liberado' : editing ? 'actualizado' : 'marcado como ocupado'}. El cambio quedó registrado.`);
    } catch(e) { error.textContent = (e as Error).message; error.hidden = false; await refreshOwner().catch(()=>{}); }
    finally { selling = false; buttonBusy(button,false); updateStats(); }
  });
  function updateDrawNote() {
    if (!eliminationInput) return;
    const next = document.getElementById('draw-next-note')!;
    const button = document.getElementById('confirm-draw')!;
    if (raffle.draw) {
      const winning = nextDrawKind(raffle) === 'winner';
      next.textContent = `Giro ${raffle.draw.round + 1} de ${raffle.draw.totalSpins}: ${winning ? `elegirá al ganador ${winnerNumbers(raffle).length+1} de ${drawWinnerCount(raffle)}.` : 'el número seleccionado quedará eliminado.'}`;
      button.textContent = winning ? 'Girar para elegir ganador' : 'Girar para eliminar un número';
    } else {
      const count = Number(eliminationInput.value);
      const winners = Number(winnerInput!.value);
      eliminationInput.max = String(Math.max(0,eligibleNumbers(raffle).length-winners));
      next.textContent = `${count} giro${count === 1 ? '' : 's'} de eliminación y ${winners} giro${winners === 1 ? '' : 's'} para elegir ${winners} ganador${winners === 1 ? '' : 'es'}. Harás cada giro pulsando el botón.`;
      button.textContent = count ? 'Iniciar primer giro de eliminación' : 'Girar para elegir ganador';
    }
  }
  eliminationInput?.addEventListener('input', updateDrawNote);
  winnerInput?.addEventListener('input', updateDrawNote);
  drawButton?.addEventListener('click', () => {
    document.getElementById('eligible-count')!.textContent = String(eligibleNumbers(raffle).length);
    document.getElementById('draw-error')!.hidden = true;
    document.getElementById('draw-title')!.textContent = raffle.draw ? 'Continuar el sorteo' : 'Configura el sorteo';
    document.getElementById('elimination-field')!.hidden = !!raffle.draw;
    eliminationInput!.disabled = !!raffle.draw;
    document.getElementById('winner-count-field')!.hidden = !!raffle.draw;
    winnerInput!.disabled = !!raffle.draw;
    winnerInput!.max = String(Math.max(1,eligibleNumbers(raffle).length));
    winnerInput!.value = String(Math.min(Number(winnerInput!.value),Number(winnerInput!.max)));
    eliminationInput!.max = String(Math.max(0, eligibleNumbers(raffle).length - Number(winnerInput!.value)));
    eliminationInput!.value = String(Math.min(Number(eliminationInput!.value), Number(eliminationInput!.max)));
    updateDrawNote(); drawModal!.showModal();
  });
  document.getElementById('draw-form')?.addEventListener('submit',async event => {
    event.preventDefault();
    if(drawing || raffle.result)return;
    let pool = eligibleNumbers(raffle);
    const expectedRound = raffle.draw?.round || 0;
    drawing = true; spinning = true; updateStats(); drawButton!.disabled = true;
    const button = document.getElementById('confirm-draw') as HTMLButtonElement; buttonBusy(button,true,'Registrando giro…');
    const error = document.getElementById('draw-error')!; error.hidden = true;
    try {
      const { draw, result, winnerNames: names, version: savedVersion } = await api(`/api/rifas/${id}/sortear`, { expectedRound, ...(!raffle.draw ? { spins: Number(eliminationInput!.value) + Number(winnerInput!.value), winnerCount: Number(winnerInput!.value) } : {}) });
      if (savedVersion >= version) { raffle.draw = draw; raffle.winnerNames = names || {}; if (result) raffle.result = result; }
      version = Math.max(version,savedVersion); team?.loadHistory();
      // Rebuild the committed spin's pool if another admin sold tickets before it began.
      if (!pool.includes(draw.lastNumber) || pool.length !== draw.initialCount - draw.round + 1) {
        await refreshOwner();
        const alreadyDrawn = new Set<number>(draw.history.split(',').slice(0,-1).map(Number));
        pool = soldNumbers().filter(number=>!alreadyDrawn.has(number));
      }
      drawModal!.close(); renderWheel(pool, draw.lastNumber); zoom.value = '1'; applyZoom();
      drawButton!.textContent = 'La suerte está girando…';
      document.getElementById('spin-outcome')!.hidden = true;
      document.getElementById('spin-status')!.textContent = `Girando ${draw.round} de ${draw.totalSpins}…`;
      const segment = wheelSegments(pool).find(s => s.number === draw.lastNumber)!;
      const animation = planWheelAnimation(rotation,segment.rotation);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) await animate(wheel,{rotate:[rotation,animation.rotation]},{duration:animation.duration,ease:[.12,.72,.13,1]});
      else wheel.style.transform = `rotate(${animation.rotation}deg)`;
      rotation = animation.rotation; spinning = false;
      const winnerIndex = winnerNumbers(raffle).indexOf(draw.lastNumber);
      const buyer = resultBuyer(draw.lastNumber);
      toast(winnerIndex >= 0 ? `Ganador ${winnerIndex+1} de ${drawWinnerCount(raffle)}: #${numberLabel(draw.lastNumber)}${buyer ? ` · ${buyer}` : ''}. ¡Felicidades!` : `#${numberLabel(draw.lastNumber)}${buyer ? ` · ${buyer}` : ''} eliminado. Puedes iniciar el siguiente giro.`);
    } catch(e) {
      error.textContent = (e as Error).message; error.hidden = false; toast((e as Error).message,true);
      // A lost response must not let a completed round be repeated.
      await refreshOwner().catch(() => {});
    } finally {
      drawing = false; spinning = false; buttonBusy(button,false); updateStats(); renderTickets(); renderWheel(undefined, raffle.result?.number);
    }
  });
  async function refreshOwner() {
    if (removed) return;
    const data = await api(`/api/rifas/${id}`); raffle = data.public; entries = data.entries || {}; version = data.version || 0; privateReady = true; team?.renderAdmins(data.admins || {}, raffle.organizer); updateStats(); renderTickets(); if(!spinning)renderWheel(undefined, raffle.result?.number);
  }
  let unsubscribe: (()=>void) | undefined;
  let unsubscribeAdmins: (()=>void) | undefined;
  let unsubscribeHistory: (()=>void) | undefined;
  const watch = () => {
    if(unsubscribe)return;
    unsubscribe = onValue(ref(database,`raffles/${id}${owner ? '' : '/public'}`), snapshot=>{
      const value = snapshot.val();
      if (!value) {
        removed = true;
        void fullscreen.close();
        const message = document.createElement('p'); message.className = 'error-panel'; message.textContent = 'Esta rifa fue eliminada y ya no está disponible.';
        const link = document.createElement('a'); link.className = 'btn btn-outline'; link.href = owner ? '/perfil' : '/'; link.textContent = owner ? 'Volver a mi perfil' : 'Volver al inicio';
        main!.replaceChildren(message, link); unsubscribe?.(); return;
      }
      if (owner) { raffle = value.public; entries = value.entries || {}; version = value.version || 0; privateReady = true; }
      else raffle = value;
      updateStats(); renderTickets(); if(!spinning)renderWheel(undefined, raffle.result?.number);
    },()=>{ if (owner) accessDenied(); else toast('No se pudo actualizar la rifa en tiempo real. Recarga para consultar su estado.',true); });
    if (owner) {
      unsubscribeAdmins = onValue(ref(database,`raffleAdmins/${id}`),snapshot=>team?.renderAdmins(snapshot.val() || {},raffle.organizer),accessDenied);
      unsubscribeHistory = onValue(databaseQuery(ref(database,`raffleHistory/${id}`),orderByKey(),limitToLast(1)),()=>{ if(!removed)team?.loadHistory(); },accessDenied);
    }
  };
  if (owner) {
    onAuthStateChanged(auth,user=>{if(user){watch();refreshOwner().catch(e=>toast(e.message,true));}});
    refreshOwner().then(()=>team?.loadHistory()).catch(e=>toast(e.message,true));
  } else watch();
  window.addEventListener('pagehide',()=>{unsubscribe?.();unsubscribeAdmins?.();unsubscribeHistory?.();},{once:true});
  updateStats(); renderTickets(); renderWheel(undefined, raffle.result?.number);
}
