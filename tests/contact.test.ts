import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaffle, configureRaffle, sellTicket, drawRaffle, AppError } from '../src/lib/model.ts';
import { normalizeWhatsApp, ticketWhatsAppLink } from '../src/lib/whatsapp.ts';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP5sAAAAASUVORK5CYII=';
const config = () => ({ title: 'Rifa café & cena', ticketCount: 10, prizes: [{ name: 'Cena', image: png }] });
const raffle = () => createRaffle({ ...config(), cover: png, whatsapp: '+52 (951) 123-4567' }, 'ana', 'Ana');

test('cover and seller WhatsApp are independent of prizes and optional for older raffles', () => {
  const r = raffle();
  assert.equal(r.public.cover, png); assert.equal(r.public.whatsapp, '529511234567'); assert.equal(r.public.prizes.length, 1);
  const legacy = createRaffle(config(), 'ana', 'Ana');
  assert.equal(legacy.public.cover, undefined); assert.equal(legacy.public.whatsapp, undefined);
  for (const cover of ['https://example.com/image.png', 'data:image/png;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=', null, 42]) {
    assert.throws(() => createRaffle({ ...config(), cover }, 'ana', 'Ana'), AppError);
  }
});

test('WhatsApp numbers normalize formatting and reject malformed destinations', () => {
  assert.equal(normalizeWhatsApp('+52 (951) 123-4567'), '529511234567');
  assert.equal(normalizeWhatsApp('+1 212 555 1234'), '12125551234');
  assert.equal(normalizeWhatsApp(''), ''); assert.equal(normalizeWhatsApp(undefined), '');
  for (const number of ['+00 52 9511234567', '951', '52x9511234567', '529511234567?text=fraude', 'https://wa.me/529511234567', '1234567890123456', null, 529511234567]) assert.throws(() => normalizeWhatsApp(number));
});

test('WhatsApp message contains the exact buyer name, selected ticket, raffle title and link without exposing other buyers', () => {
  const r = raffle(); sellTicket(r, { number: 2, buyer: 'Comprador privado', contact: '555privado' });
  const before = JSON.stringify(r);
  const link = new URL(ticketWhatsAppLink(r.public, 7, ' María & José + 🎟️ ', 'http://localhost:4321/rifas/example'));
  assert.equal(link.origin, 'https://wa.me'); assert.equal(link.pathname, '/529511234567');
  const message = link.searchParams.get('text')!;
  assert.match(message, /María & José \+ 🎟️/); assert.match(message, /#007/); assert.match(message, /Rifa café & cena/); assert.match(message, /http:\/\/localhost:4321\/rifas\/example/);
  assert.doesNotMatch(message, /Comprador privado|555privado/);
  assert.equal(JSON.stringify(r), before); assert.equal(r.public.sold['7'], undefined);
});

test('sold tickets, closed sales, absent phone and invalid buyer names cannot create contact requests', () => {
  const r = raffle(); sellTicket(r, { number: 1, buyer: 'Ana' });
  const request = (number = 3, name = 'María') => ticketWhatsAppLink(r.public, number, name, 'https://example.com/rifas/test');
  assert.throws(() => request(1), /no está disponible/);
  for (const n of [0, 11, 1.5]) assert.throws(() => request(n));
  for (const name of [' ', 'x'.repeat(121)]) assert.throws(() => request(3, name), /nombre/);
  const old = createRaffle(config(), 'ana', 'Ana');
  assert.throws(() => ticketWhatsAppLink(old.public, 3, 'María', 'https://example.com'), /número de WhatsApp/);
  drawRaffle(r); assert.throws(() => request(), /ventas.*cerradas/);
});

test('administrator can configure old raffles and mark requested tickets occupied while buyer records stay private', () => {
  const r = createRaffle(config(), 'ana', 'Ana');
  configureRaffle(r, { cover: png, whatsapp: '+52 951 123 4567', sold: { '7': 7 }, ownerId: 'intruso' });
  assert.equal(r.public.cover, png); assert.equal(r.public.whatsapp, '529511234567'); assert.equal(r.public.ownerId, 'ana'); assert.deepEqual(r.public.sold, {});
  sellTicket(r, { number: 7, buyer: 'María', contact: '+52 951 000 1111' });
  assert.equal(r.public.sold['7'], 7); assert.equal(r.entries?.['7'].buyer, 'María');
  assert.doesNotMatch(JSON.stringify(r.public), /María|000 1111/);
  const saved = JSON.stringify(r);
  assert.throws(() => configureRaffle(r, { cover: png, whatsapp: 'no-es-numero' }), AppError);
  assert.equal(JSON.stringify(r), saved);
  configureRaffle(r, { cover: '', whatsapp: '' });
  assert.equal(r.public.cover, undefined); assert.equal(r.public.whatsapp, undefined);
  assert.equal(r.entries?.['7'].buyer, 'María'); assert.equal(r.public.prizes.length, 1);
  drawRaffle(r); assert.throws(() => configureRaffle(r, { cover: png, whatsapp: '529511234567' }), /configuración.*cerrada/);
});
