import { api, buttonBusy, toast } from './client';
import type { Admins } from './access';
import type { AuditEvent } from './audit';
import type { Entry } from './model';

export function setupRaffleTeam(id: string, owner: boolean, callbacks: { onChanged: () => Promise<void>; onDenied: () => void }) {
  const list = document.getElementById('admin-list')!;
  const history = document.getElementById('audit-list')!;
  const more = document.getElementById('audit-more') as HTMLButtonElement;
  const error = document.getElementById('admin-error');
  let busy = false, loading = false;
  let pendingRefresh = false;
  let events: (AuditEvent & { id: string })[] = [];
  function showError(message: string) { if (error) { error.textContent = message; error.hidden = false; } else toast(message, true); }
  async function change(email: string, remove = false) {
    if (busy) return;
    busy = true; if (error) error.hidden = true;
    const submit = document.getElementById('admin-submit') as HTMLButtonElement;
    buttonBusy(submit, true, 'Guardando…'); list.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = true);
    try {
      await api(`/api/rifas/${id}/administradores`, { email, remove });
      (document.getElementById('admin-email') as HTMLInputElement).value = '';
      await callbacks.onChanged(); await loadHistory(); toast(remove ? 'Acceso retirado.' : 'Administrador agregado. Verá esta rifa al iniciar sesión con ese correo.');
    } catch (e) { showError((e as Error).message); }
    finally { busy = false; buttonBusy(submit, false); list.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = false); }
  }
  document.getElementById('admin-form')?.addEventListener('submit', event => { event.preventDefault(); change((document.getElementById('admin-email') as HTMLInputElement).value); });
  function renderAdmins(admins: Admins, organizer: string) {
    list.replaceChildren();
    const creator = document.createElement('li'); creator.textContent = `${organizer} · Creador`; list.append(creator);
    for (const admin of Object.values(admins)) {
      const row = document.createElement('li'), email = document.createElement('span'); email.textContent = admin.email; row.append(email);
      if (owner) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-link'; remove.textContent = 'Retirar acceso'; remove.disabled = busy;
        remove.addEventListener('click', () => { if (window.confirm(`¿Retirar el acceso de ${admin.email} a esta rifa? Su historial se conservará.`)) change(admin.email, true); }); row.append(remove);
      }
      list.append(row);
    }
  }
  function entryText(entry: Entry | undefined) { return entry ? `${entry.buyer} · contacto: ${entry.contact || 'sin contacto'} · vendedor: ${entry.seller || 'sin vendedor'}` : 'Disponible'; }
  function renderHistory() {
    history.replaceChildren();
    for (const event of events) {
      const item = document.createElement('li'), title = document.createElement('strong'), actor = document.createElement('p');
      title.textContent = event.description;
      actor.className = 'audit-actor'; actor.textContent = `${event.actor.name} (${event.actor.email}) · ${new Date(event.at).toLocaleString('es-MX')}`;
      item.append(title,actor);
      for (const change of event.changes || []) { const text = document.createElement('p'); text.className = 'field-help'; text.textContent = `${change.field}: ${change.before} → ${change.after}`; item.append(text); }
      if (event.before || event.after) {
        const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Ver datos del cambio';
        const before = document.createElement('p'), after = document.createElement('p'); before.textContent = `Antes: ${entryText(event.before)}`; after.textContent = `Después: ${entryText(event.after)}`; details.append(summary,before,after); item.append(details);
      }
      history.append(item);
    }
    if (!events.length) { const empty = document.createElement('li'); empty.textContent = 'Todavía no hay cambios registrados. Los cambios anteriores a esta función no tienen historial.'; history.append(empty); }
  }
  async function loadHistory(append = false) {
    if (loading) { if (!append) pendingRefresh = true; return; }
    loading = true; more.disabled = true;
    try {
      const cursor = append && events.length ? `?before=${encodeURIComponent(events[events.length-1].id)}` : '';
      const data = await api(`/api/rifas/${id}/historial${cursor}`);
      events = append ? [...events, ...data.events] : data.events; more.hidden = !data.more; renderHistory();
    } catch (e) { toast((e as Error).message, true); if (/acceso|sesión/i.test((e as Error).message)) callbacks.onDenied(); }
    finally { loading = false; more.disabled = false; if (pendingRefresh) { pendingRefresh = false; void loadHistory(); } }
  }
  more.addEventListener('click', () => loadHistory(true));
  document.getElementById('audit-refresh')!.addEventListener('click', () => loadHistory());
  return { renderAdmins, loadHistory };
}
