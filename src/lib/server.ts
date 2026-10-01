import { AppError } from './model';
import { MAX_JSON_BYTES, UPLOAD_LIMIT_MESSAGE } from './upload-limits';

export const env = (name: string): string => process.env[name] || (import.meta.env?.[name] as string) || '';
export async function verifyToken(token: string) {
  if (!token || token.length > 16000) throw new AppError('Inicia sesión para continuar.', 401);
  let response: Response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env('PUBLIC_FIREBASE_API_KEY'))}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AppError('El servidor no pudo conectarse con Firebase Authentication. Comprueba la conexión a Internet del servidor e intenta otra vez.', 503);
  }
  const body = await response.json();
  const user = body.users?.[0];
  if (!response.ok || !user || user.disabled) throw new AppError('Tu sesión expiró. Inicia sesión otra vez.', 401);
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  if (claims.aud !== env('PUBLIC_FIREBASE_PROJECT_ID') || claims.exp * 1000 <= Date.now() || claims.firebase?.sign_in_provider !== 'google.com') throw new AppError('Se requiere una sesión de Google válida.', 401);
  return { uid: user.localId as string, name: (user.displayName || 'Organizador') as string, email: (claims.email || user.email || '') as string, photo: (user.photoUrl || '') as string, emailVerified: claims.email_verified === true };
}

export async function db(path: string, token?: string | null, init: RequestInit = {}, query: Record<string, string> = {}) {
  const url = new URL(`${env('PUBLIC_FIREBASE_DATABASE_URL').replace(/\/$/, '')}/${path}.json`);
  if (token) url.searchParams.set('auth', token);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', ...init.headers }, cache: 'no-store' });
  if (response.status === 412) throw new AppError('La rifa cambió mientras trabajabas. Actualiza e intenta otra vez.', 409);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new AppError('Firebase rechazó el acceso. Revisa las reglas de Realtime Database y tu sesión.', 503);
    throw new AppError('No se pudo conectar con la base de datos. Intenta otra vez.', 503);
  }
  return { data: await response.json(), etag: response.headers.get('etag') };
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = env('APP_ORIGIN') || new URL(request.url).origin;
  if (!origin || origin !== expected) throw new AppError('Origen de solicitud inválido.', 403);
}
export function json(body: unknown, status = 200) {
  // Stream large profiles and existing raffles with base64 images on Vercel.
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.subarray(offset, offset + 64 * 1024));
      offset += 64 * 1024;
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
export async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Se requiere JSON.', 415);
  if (Number(request.headers.get('content-length')) > MAX_JSON_BYTES) throw new AppError(UPLOAD_LIMIT_MESSAGE, 413);
  // Stream limit also protects against requests without a Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('Formulario vacío.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.length;
    if (size > MAX_JSON_BYTES) { await reader.cancel(); throw new AppError(UPLOAD_LIMIT_MESSAGE, 413); }
    chunks.push(part.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('JSON inválido.'); }
}
