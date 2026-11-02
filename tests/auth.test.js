const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const token = 'a'.repeat(64);
const nextToken = 'b'.repeat(64);
const future = () => new Date(Date.now() + 60_000).toISOString();

function createBackend(handler, { saved, configured = true, storageBlocked = false } = {}) {
  const calls = [];
  const events = [];
  const storage = new Map(saved ? [['familiengarage-session-v2', JSON.stringify(saved)]] : []);
  const context = {
    CustomEvent: class { constructor(type) { this.type = type; } },
    window: {
      FAMILY_GARAGE_CONFIG: configured ? {
        SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-test-publishable-key',
      } : {},
      sessionStorage: {
        getItem(key) { if (storageBlocked) throw new Error('Storage blocked'); return storage.get(key) ?? null; },
        setItem(key, value) { if (storageBlocked) throw new Error('Storage blocked'); storage.set(key, value); },
        removeItem(key) { if (storageBlocked) throw new Error('Storage blocked'); storage.delete(key); },
      },
      dispatchEvent(event) { events.push(event.type); },
      supabase: { createClient: () => ({ rpc: async (name, params) => {
        calls.push({ name, params });
        return handler(name, params);
      } }) },
    },
  };
  vm.runInNewContext(readFileSync('supabaseClient.js', 'utf8'), context);
  return { backend: context.window.FAMILY_GARAGE_BACKEND, calls, events, storage };
}

test('does not query or mutate reservations before login', async () => {
  const { backend, calls } = createBackend(() => assert.fail('No request allowed'));
  for (const response of [await backend.listReservations(), await backend.createReservation({}), await backend.deleteReservation('id')]) {
    assert.equal(response.error.code, '42501');
  }
  assert.equal(calls.length, 0);
});

test('stores a session token, never the password, and includes the token on protected requests', async () => {
  const { backend, calls, storage } = createBackend(name => name === 'family_login'
    ? { data: { session_token: token, expires_at: future() } }
    : { data: [] });
  await backend.login('example-test-password');
  await backend.listReservations();
  assert.equal(backend.hasSession(), true);
  assert.equal(calls[1].params.p_session_token, token);
  assert.equal(JSON.stringify([...storage]).includes('example-test-password'), false);
});

test('rejects wrong passwords and malformed or expired session responses', async () => {
  const wrong = createBackend(() => ({ data: { error: 'invalid_password' } }));
  assert.equal((await wrong.backend.login('incorrect')).error, 'invalid_password');
  assert.equal(wrong.backend.hasSession(), false);
  for (const data of [{ session_token: 'invalid', expires_at: future() }, { session_token: token, expires_at: '2000-01-01' }]) {
    const { backend, storage } = createBackend(() => ({ data }));
    await assert.rejects(() => backend.login('example-test-password'));
    assert.equal(backend.hasSession(), false);
    assert.equal(storage.size, 0);
  }
});

test('revokes the server session and removes the local session on logout', async () => {
  const { backend, calls, storage } = createBackend(() => ({ data: null }), { saved: { token, expiresAt: future() } });
  await backend.logout();
  assert.equal(calls[0].name, 'family_logout');
  assert.equal(calls[0].params.p_session_token, token);
  assert.equal(backend.hasSession(), false);
  assert.equal(storage.size, 0);
});

test('a revoked session locks the application and clears session storage', async () => {
  const { backend, storage, events } = createBackend(() => ({ error: { code: '42501' } }), { saved: { token, expiresAt: future() } });
  await backend.listReservations();
  assert.equal(backend.hasSession(), false);
  assert.equal(storage.size, 0);
  assert.ok(events.includes('family-session-expired'));
});

test('a delayed failure from an old session cannot invalidate a newer login', async () => {
  let resolveOldRequest;
  const { backend } = createBackend(name => name === 'family_login'
    ? { data: { session_token: nextToken, expires_at: future() } }
    : new Promise(resolve => { resolveOldRequest = resolve; }), { saved: { token, expiresAt: future() } });
  const oldRequest = backend.listReservations();
  await backend.login('example-test-password');
  resolveOldRequest({ error: { code: '42501' } });
  await oldRequest;
  assert.equal(backend.hasSession(), true);
});

test('works without browser storage and fails closed without backend configuration', async () => {
  const memory = createBackend(() => ({ data: { session_token: token, expires_at: future() } }), { storageBlocked: true });
  await memory.backend.login('example-test-password');
  assert.equal(memory.backend.hasSession(), true);
  const missing = createBackend(() => assert.fail(), { configured: false });
  await assert.rejects(() => missing.backend.login('example-test-password'));
  assert.equal((await missing.backend.listReservations()).error.code, '42501');
});
