import { defineMiddleware } from 'astro:middleware';
import { verifyToken } from './lib/server';

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;
  context.locals.token = null;
  const path = context.url.pathname;
  const privateRoute = path === '/perfil' || path.startsWith('/perfil/') || path.startsWith('/api/rifas');
  const optionalAuth = path.startsWith('/rifas/');
  if (privateRoute || optionalAuth) {
    const token = context.cookies.get('__session')?.value;
    if (token) {
      try { context.locals.user = await verifyToken(token); context.locals.token = token; }
      catch { context.cookies.delete('__session', { path: '/' }); }
    }
    if (privateRoute && !context.locals.user) {
      if (path.startsWith('/api/')) return new Response(JSON.stringify({ error: 'Inicia sesión para continuar.' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      return context.redirect('/?sesion=requerida');
    }
  }
  const response = await next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  if (privateRoute || optionalAuth) response.headers.set('Cache-Control', 'private, no-store');
  return response;
});
