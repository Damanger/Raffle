import type { APIRoute } from 'astro';
import { AppError } from '../../../lib/model';
import { json, readBody, requireSameOrigin, verifyToken } from '../../../lib/server';

export const POST: APIRoute = async ({ request, cookies, url }) => {
  try {
    requireSameOrigin(request);
    const body = await readBody(request);
    const idToken = body?.idToken;
    if (typeof idToken !== 'string') throw new AppError('Token inválido.', 401);
    await verifyToken(idToken);
    cookies.set('__session', idToken, { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 3500 });
    return json({ ok: true });
  } catch (error) { return json({ error: error instanceof AppError ? error.message : 'No se pudo verificar la sesión.' }, error instanceof AppError ? error.status : 503); }
};
export const DELETE: APIRoute = async ({ request, cookies }) => {
  try { requireSameOrigin(request); cookies.delete('__session', { path: '/' }); return json({ ok: true }); }
  catch { return json({ error: 'Origen inválido.' }, 403); }
};
