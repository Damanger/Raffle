import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { AppError, createRaffle, configureRaffle, sellTicket, editTicket, drawRaffle, type Raffle } from '../../../lib/model';
import { db, json, readBody, requireSameOrigin } from '../../../lib/server';
import { canManage, emailKey, normalizeEmail, type Actor, type Admins } from '../../../lib/access';
import { auditEvent, auditedUpdate } from '../../../lib/audit';
import { winnerNumbers } from '../../../lib/draw';

export const ALL: APIRoute = async ({ request, params, locals, url }) => {
  try {
    const user = locals.user;
    if (!user || !locals.token) throw new AppError('Inicia sesión para continuar.', 401);
    const token = locals.token;
    const actor: Actor = { uid: user.uid, name: user.name, email: user.email };
    const parts = (params.path || '').split('/').filter(Boolean);
    if (request.method === 'GET' && !parts.length) {
      const indexes = await Promise.all([db(`users/${user.uid}/raffles`, token), user.emailVerified && user.email ? db(`sharedRaffles/${emailKey(user.email)}`, token) : Promise.resolve({ data: null })]);
      const ids = [...new Set(indexes.flatMap(index => Object.keys(index.data || {})))];
      const raffles = await Promise.all(ids.map(async id => ({ id, ...(await db(`raffles/${id}/public`, token)).data })));
      return json({ raffles: raffles.filter(r => r.title).sort((a,b) => b.createdAt - a.createdAt) });
    }
    if (!parts.length && request.method === 'POST') {
      requireSameOrigin(request);
      const raffle = createRaffle(await readBody(request), user.uid, user.name);
      for (const entry of Object.values(raffle.entries || {})) { entry.modifiedBy = actor; entry.modifiedAt = raffle.public.createdAt; }
      const id = randomUUID(), audit = auditEvent(actor, 'raffle.created', `Creó la rifa con ${Object.keys(raffle.entries || {}).length} boletos ocupados.`);
      await db('', token, { method: 'PATCH', body: JSON.stringify({ ...auditedUpdate(id, raffle, audit.id, audit.event), [`users/${user.uid}/raffles/${id}`]: true }) });
      return json({ id }, 201);
    }
    const [id, action] = parts;
    if (!id || !/^[\w-]{1,80}$/.test(id) || parts.length > 2) throw new AppError('Ruta no disponible.', 404);
    const publicData = (await db(`raffles/${id}/public`, token)).data;
    if (!publicData) throw new AppError('Rifa no disponible.', 404);
    const owner = publicData.ownerId === user.uid;
    if (request.method === 'DELETE' && !action && !owner) throw new AppError('Solo el creador puede eliminar la rifa.', 403);
    if (!owner && (!user.emailVerified || !user.email || !(await db(`raffleAdmins/${id}/${emailKey(user.email)}`, token)).data)) throw new AppError('No tienes acceso a esta rifa.', 403);
    const admins: Admins = (await db(`raffleAdmins/${id}`, token)).data || {};
    if (!canManage(publicData, user, admins)) throw new AppError('No tienes acceso a esta rifa.', 403);
    if (request.method === 'GET' && !action) return json({ ...(await db(`raffles/${id}`, token)).data, admins });
    if (request.method === 'GET' && action === 'historial') {
      const cursor = url?.searchParams.get('before');
      if (cursor && !/^\d+_[\w-]{1,80}$/.test(cursor)) throw new AppError('Página de historial inválida.');
      const query = { orderBy: '"$key"', limitToLast: cursor ? '102' : '101', ...(cursor ? { endAt: JSON.stringify(cursor) } : {}) };
      const events = Object.entries((await db(`raffleHistory/${id}`, token, {}, query)).data || {}).filter(([key]) => key !== cursor).sort(([a],[b]) => b.localeCompare(a));
      return json({ events: events.slice(0,100).map(([key,event]) => ({ id: key, ...(event as object) })), more: events.length > 100 });
    }
    requireSameOrigin(request);
    if (request.method === 'DELETE' && !action) {
      const deletion: Record<string,null> = { [`raffles/${id}`]: null, [`users/${user.uid}/raffles/${id}`]: null, [`raffleAdmins/${id}`]: null, [`raffleHistory/${id}`]: null };
      for (const key of Object.keys(admins)) deletion[`sharedRaffles/${key}/${id}`] = null;
      await db('', token, { method: 'PATCH', body: JSON.stringify(deletion) });
      return json({ ok: true });
    }
    if (request.method !== 'POST' || !action) throw new AppError('Ruta no disponible.', 404);
    const body = await readBody(request);
    if (action === 'administradores') {
      if (!owner) throw new AppError('Solo el creador puede cambiar los administradores.', 403);
      let email: string;
      try { email = normalizeEmail(body?.email); } catch (error) { throw new AppError((error as Error).message); }
      if (email === user.email.toLowerCase()) throw new AppError('Ya eres el creador de esta rifa.');
      const key = emailKey(email), remove = body?.remove === true;
      if (!remove && admins[key]) throw new AppError('Este correo ya administra la rifa.', 409);
      if (remove && !admins[key]) throw new AppError('Este administrador ya fue retirado.', 409);
      const audit = auditEvent(actor, remove ? 'admin.removed' : 'admin.added', `${remove ? 'Retiró' : 'Agregó'} al administrador ${email}.`);
      await db('', token, { method: 'PATCH', body: JSON.stringify({ [`raffleAdmins/${id}/${key}`]: remove ? null : { email, invitedBy: user.uid, invitedAt: Date.now() }, [`sharedRaffles/${key}/${id}`]: remove ? null : true, [`raffleHistory/${id}/${audit.id}`]: audit.event }) });
      return json({ ok: true });
    }
    if (!['vender','editar-boleto','sortear','configurar'].includes(action)) throw new AppError('Ruta no disponible.', 404);
    const raffle = (await db(`raffles/${id}`, token)).data as Raffle;
    const version = raffle.version || 0;
    if (['editar-boleto','configurar'].includes(action) && body?.expectedVersion !== version) throw new AppError('Otro administrador modificó la rifa. Actualiza antes de guardar.', 409);
    const before = raffle.entries?.[String(body?.number)] ? structuredClone(raffle.entries[String(body.number)]) : undefined;
    const previousPublic = action === 'configurar' ? structuredClone(raffle.public) : null;
    if (action === 'vender') sellTicket(raffle, body, actor);
    else if (action === 'editar-boleto') editTicket(raffle, body, actor);
    else if (action === 'configurar') configureRaffle(raffle, body);
    else { if (!Number.isInteger(body?.expectedRound)) throw new AppError('Actualiza la rifa antes de girar la ruleta.'); drawRaffle(raffle, body); }
    const after = raffle.entries?.[String(body?.number)];
    const description = action === 'configurar' ? 'Actualizó el título, premios, portada o WhatsApp de la rifa.' : action === 'sortear' ? `Registró el giro ${raffle.public.draw!.round}: #${raffle.public.draw!.lastNumber} ${winnerNumbers(raffle.public).includes(raffle.public.draw!.lastNumber) ? `ganador ${winnerNumbers(raffle.public).length}` : 'eliminado'}.` : `${action === 'vender' ? 'Ocupó' : after ? 'Corrigió' : 'Liberó'} el boleto #${body.number}.`;
    const changes: { field: string; before: string; after: string }[] = [];
    if (previousPublic) {
      for (const [field,label] of [['title','Título'],['whatsapp','WhatsApp']] as const) {
        if (previousPublic[field] !== raffle.public[field]) changes.push({field:label,before:previousPublic[field] || 'Sin datos',after:raffle.public[field] || 'Sin datos'});
      }
      if (previousPublic.cover !== raffle.public.cover) changes.push({field:'Portada',before:previousPublic.cover ? 'Con imagen' : 'Sin imagen',after:raffle.public.cover ? 'Imagen actualizada' : 'Sin imagen'});
      if (JSON.stringify(previousPublic.prizes) !== JSON.stringify(raffle.public.prizes)) changes.push({field:'Premios',before:previousPublic.prizes.map(p=>p.name).join(', '),after:`${raffle.public.prizes.map(p=>p.name).join(', ')} (nombres o imágenes actualizados)`});
    }
    const audit = auditEvent(actor, action === 'vender' ? 'ticket.sold' : action === 'editar-boleto' ? (after ? 'ticket.edited' : 'ticket.released') : action === 'sortear' ? 'raffle.drawn' : 'raffle.updated', description, { ...(changes.length ? { changes } : {}), ...(['vender','editar-boleto'].includes(action) ? { number: body.number, ...(before ? { before } : {}), ...(after ? { after } : {}) } : {}) });
    try { await db('', token, { method: 'PATCH', body: JSON.stringify(auditedUpdate(id, raffle, audit.id, audit.event)) }); }
    catch (error) {
      const current = (await db(`raffles/${id}`, token)).data;
      if (!current || (current.version || 0) !== version) throw new AppError('Otro administrador guardó un cambio. Actualiza la rifa e intenta nuevamente.', 409);
      throw error;
    }
    return json(action === 'sortear' ? { draw: raffle.public.draw, result: raffle.public.result || null, winnerNames: raffle.public.winnerNames || {}, version: raffle.version } : action === 'configurar' ? { public: raffle.public, version: raffle.version } : { ok: true, version: raffle.version });
  } catch (error) { return json({ error: error instanceof AppError ? error.message : 'Ocurrió un problema al guardar. Intenta otra vez.' }, error instanceof AppError ? error.status : 503); }
};
