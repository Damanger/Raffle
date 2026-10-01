import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_JSON_BYTES, serializeRequest } from '../src/lib/upload-limits.ts';
import { json, readBody, requireSameOrigin } from '../src/lib/server.ts';
import { AppError } from '../src/lib/model.ts';

test('uploads respect the 4 MB limit including UTF-8 bytes before sending', () => {
  assert.equal(serializeRequest('x'.repeat(MAX_JSON_BYTES - 2)).length, MAX_JSON_BYTES);
  assert.throws(() => serializeRequest('x'.repeat(MAX_JSON_BYTES - 1)), /límite de 4 MB/);
  assert.throws(() => serializeRequest('á'.repeat(MAX_JSON_BYTES / 2)), /límite de 4 MB/);
});

test('server rejects oversized streamed uploads without a Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_JSON_BYTES + 1)); },
    cancel() { cancelled = true; },
  });
  const request = new Request('https://rifas-squirrel.vercel.app/api/rifas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
  } as RequestInit);
  await assert.rejects(readBody(request), error => error instanceof AppError && error.status === 413);
  assert.equal(cancelled, true);
});

test('server accepts JSON at the upload limit and rejects excessive Content-Length', async () => {
  const accepted = new Request('https://example.com', { method: 'POST', headers: {'Content-Type':'application/json'}, body: serializeRequest('x'.repeat(MAX_JSON_BYTES - 2)) });
  assert.equal((await readBody(accepted)).length, MAX_JSON_BYTES - 2);
  const rejected = new Request('https://example.com', { method: 'POST', headers: {'Content-Type':'application/json','Content-Length':String(MAX_JSON_BYTES + 1)}, body: '{}' });
  await assert.rejects(readBody(rejected), error => error instanceof AppError && error.status === 413);
});

test('large raffle responses stream valid JSON without changing status or privacy headers', async () => {
  const body = { prizes: ['á🐿️'.repeat(1024 * 1024)], buyer: 'María' };
  const response = json(body, 201);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('content-length'), null);
  assert.deepEqual(await response.json(), body);
});

test('production and preview origins keep same-origin protection', t => {
  const previous = process.env.APP_ORIGIN;
  t.after(() => { if (previous === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previous; });
  process.env.APP_ORIGIN = 'https://rifas-squirrel.vercel.app';
  const request = (url: string, origin: string) => new Request(url, { method: 'POST', headers: { Origin: origin } });
  requireSameOrigin(request('https://rifas-squirrel.vercel.app/api/rifas', process.env.APP_ORIGIN));
  assert.throws(() => requireSameOrigin(request('https://rifas-squirrel.vercel.app/api/rifas', 'https://attacker.example')), error => error instanceof AppError && error.status === 403);
  process.env.APP_ORIGIN = '';
  const preview = 'https://rifas-squirrel-preview.vercel.app';
  requireSameOrigin(request(`${preview}/api/rifas`, preview));
  assert.throws(() => requireSameOrigin(request(`${preview}/api/rifas`, 'https://attacker.example')), error => error instanceof AppError && error.status === 403);
});
