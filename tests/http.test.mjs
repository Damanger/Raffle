import test from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.TEST_ORIGIN || 'http://127.0.0.1:4321';

test('landing renders the general rifas-squirrel brand and original squirrel logo in Spanish', async () => {
  const landing = await fetch(base); assert.equal(landing.status,200);
  const html = await landing.text(); assert.match(html, /lang="es"/); assert.match(html,/Continuar con Google/); assert.match(html,/Una buena causa/);
  assert.match(html, /<title>rifas-squirrel/);
  assert.match(html, /aria-label="rifas-squirrel, inicio"/);
  assert.match(html, /La ardilla de rifas-squirrel/);
  assert.doesNotMatch(html, /Mixtecánicos|Racing Team|buffet-mixtecanicos|import-raffle/);
});
test('profile and API deny unauthenticated access in the server',async()=>{
  const profile = await fetch(`${base}/perfil`,{redirect:'manual'});assert.equal(profile.status,302);assert.equal(profile.headers.get('location'),'/?sesion=requerida');
  for(const path of ['/api/rifas','/api/rifas/other','/api/rifas/other/historial']){
    const response = await fetch(`${base}${path}`);assert.equal(response.status,401);assert.match(response.headers.get('cache-control'),/no-store/);
  }
  const sale = await fetch(`${base}/api/rifas/other/vender`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({number:1,buyer:'Intruso'})});assert.equal(sale.status,401);
  const deletion = await fetch(`${base}/api/rifas/other`, { method: 'DELETE', headers: { Origin: base } }); assert.equal(deletion.status, 401);
  for (const action of ['administradores','editar-boleto']) { const response=await fetch(`${base}/api/rifas/other/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:'{}'});assert.equal(response.status,401); }
});
test('session rejects cross-origin requests, invalid JSON and excessive bodies',async()=>{
  const csrf = await fetch(`${base}/api/auth/session`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.example'},body:'{}'});assert.equal(csrf.status,403);
  const invalid = await fetch(`${base}/api/auth/session`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:'not json'});assert.equal(invalid.status,400);
  const tooBig = await fetch(`${base}/api/auth/session`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({idToken:'x'.repeat(7*1024*1024+1)})});assert.equal(tooBig.status,413);
  const logout = await fetch(`${base}/api/auth/session`,{method:'DELETE',headers:{Origin:base}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
});
test('missing pages and assets have correct responses and security headers',async()=>{
  const missing = await fetch(`${base}/not-a-page`);assert.equal(missing.status,404);
  const home = await fetch(base);assert.equal(home.headers.get('x-frame-options'),'DENY');assert.equal(home.headers.get('x-content-type-options'),'nosniff');
  const html = await home.text();
  const faviconPath = html.match(/<link rel="icon" type="image\/png" href="([^"]+)"/)?.[1];assert.ok(faviconPath);
  const icon = await fetch(new URL(faviconPath.replaceAll('&amp;','&'),base));assert.equal(icon.status,200);assert.match(icon.headers.get('content-type'),/image\/png/);
  const template = await fetch(`${base}/plantilla-boletos.csv`);assert.equal(template.status,200);assert.match(await template.text(),/Boleto,Nombre,Telefono,Vendedor/);
});
