import test from 'node:test';
import assert from 'node:assert/strict';
import type { Auth } from 'firebase/auth';
import { ensureGoogleSession } from '../src/lib/google-session.ts';
import { verifyToken } from '../src/lib/server.ts';
import { AppError } from '../src/lib/model.ts';

const user = { uid: 'signed-in-user' } as NonNullable<Auth['currentUser']>;

test('an active session reaches the profile without opening Google again', async () => {
  let popups = 0;
  let synced = false;
  const auth = { currentUser: user, authStateReady: async () => {} };
  await ensureGoogleSession(auth, async () => { popups++; }, async () => { synced = true; });
  assert.equal(popups, 0);
  assert.equal(synced, true);
});

test('a click during persisted-session restoration waits and reuses the restored user', async () => {
  let restore!: () => void;
  const ready = new Promise<void>(resolve => { restore = resolve; });
  let popups = 0;
  let synced = false;
  const auth = { currentUser: null as Auth['currentUser'], authStateReady: () => ready };
  const continuation = ensureGoogleSession(auth, async () => { popups++; }, async () => { synced = true; });
  await Promise.resolve();
  assert.equal(popups, 0);
  assert.equal(synced, false);
  auth.currentUser = user;
  restore();
  await continuation;
  assert.equal(popups, 0);
  assert.equal(synced, true);
});

test('a visitor without a session signs in before syncing the profile session', async () => {
  const events: string[] = [];
  const auth = { currentUser: null as Auth['currentUser'], authStateReady: async () => {} };
  await ensureGoogleSession(auth, async () => {
    events.push('google');
    auth.currentUser = user;
  }, async () => {
    assert.equal(auth.currentUser, user);
    events.push('session');
  });
  assert.deepEqual(events, ['google', 'session']);
});

test('a session-sync failure does not fall back to another Google login', async () => {
  let popups = 0;
  const auth = { currentUser: user, authStateReady: async () => {} };
  await assert.rejects(ensureGoogleSession(auth, async () => { popups++; }, async () => {
    throw new Error('Session endpoint unavailable');
  }), /Session endpoint unavailable/);
  assert.equal(popups, 0);
});

test('canceling Google login does not create a profile session', async () => {
  let synced = false;
  const auth = { currentUser: null, authStateReady: async () => {} };
  await assert.rejects(ensureGoogleSession(auth, async () => {
    throw new Error('Popup closed');
  }, async () => { synced = true; }), /Popup closed/);
  assert.equal(synced, false);
});

test('Firebase connection failures report server connectivity instead of invalid credentials', async t => {
  // Verification must still fail closed when the server has no network access.
  const previousKey = process.env.PUBLIC_FIREBASE_API_KEY;
  t.after(() => { if (previousKey === undefined) delete process.env.PUBLIC_FIREBASE_API_KEY; else process.env.PUBLIC_FIREBASE_API_KEY = previousKey; });
  process.env.PUBLIC_FIREBASE_API_KEY = 'test-key';
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(verifyToken('test-token'), error => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 503);
    assert.match(error.message, /servidor no pudo conectarse con Firebase Authentication/);
    return true;
  });
});

test('Firebase rejection of an invalid token still denies authentication', async t => {
  const previousKey = process.env.PUBLIC_FIREBASE_API_KEY;
  t.after(() => { if (previousKey === undefined) delete process.env.PUBLIC_FIREBASE_API_KEY; else process.env.PUBLIC_FIREBASE_API_KEY = previousKey; });
  process.env.PUBLIC_FIREBASE_API_KEY = 'test-key';
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'INVALID_ID_TOKEN' } }), { status: 400 }));
  await assert.rejects(verifyToken('invalid-test-token'), error => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 401);
    return true;
  });
});
