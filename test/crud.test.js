// Muterende API-tester: autentisert investor-CRUD + merge (inkl. regresjon for
// declined_offers-flytting). Skriver til databasen — kjøres KUN mot en engangs-DB
// (CI-container), aldri mot dev/prod. Gates på RUN_MUTATING_TESTS=1.
//
// Kjør: RUN_MUTATING_TESTS=1 npm test  (med DATABASE_URL mot tom test-DB)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const RUN = process.env.RUN_MUTATING_TESTS === '1';
const dbUrl = process.env.DATABASE_URL || '';
if (RUN && /railway|rlwy/i.test(dbUrl))
  throw new Error('RUN_MUTATING_TESTS=1 mot en Railway-database — avbryter for å beskytte ekte data');

const opts = { skip: !RUN && 'krever RUN_MUTATING_TESTS=1 og engangs-DB' };

let srv, cookie, productId, keepId, dropId;

function hdrs(extra = {}) {
  return {
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  };
}

async function call(method, path, body) {
  const res = await fetch(`${srv.baseUrl}/api${path}`, {
    method,
    headers: hdrs(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

before(async () => {
  if (!RUN) return;
  const { startServer } = require('./helpers');
  const { query } = require('../db');
  const { hashPassword } = require('../lib/helpers');
  srv = await startServer();
  await query(
    `INSERT INTO users (username, display_name, role, password_hash, must_change_password)
     VALUES ('testadmin', 'Test Admin', 'admin', $1, FALSE)
     ON CONFLICT (username) DO NOTHING`,
    [hashPassword('test-passord-123')]
  );
  const res = await fetch(`${srv.baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testadmin', password: 'test-passord-123' }),
  });
  assert.equal(res.status, 200, 'innlogging med testbruker må lykkes');
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('oro.sid='), 'session-cookie må settes');
});

after(async () => {
  if (srv) await srv.close();
  const { pool } = require('../db');
  await pool.end();
});

test('POST /api/investors oppretter investor med generert INV-id', opts, async () => {
  const res = await call('POST', '/investors', { name: 'Keep Testinvestor AS', phase: 'Prospekt' });
  assert.equal(res.status, 200);
  const inv = await res.json();
  assert.match(inv.id, /^INV-\d+$/);
  keepId = inv.id;
});

test('PUT /api/investors avviser ugyldig fase med 400', opts, async () => {
  const res = await call('PUT', `/investors/${keepId}`, { phase: 'Tullefase' });
  assert.equal(res.status, 400);
});

test('PUT /api/investors oppdaterer gyldige felter', opts, async () => {
  const res = await call('PUT', `/investors/${keepId}`, { phase: 'Aktiv dialog', city: 'Oslo' });
  assert.equal(res.status, 200);
  const inv = await res.json();
  assert.equal(inv.phase, 'Aktiv dialog');
  assert.equal(inv.city, 'Oslo');
});

test('merge flytter declined_offers og produktkoblinger fra drop til keep', opts, async () => {
  // Opprett drop-investor, produkt, produktkobling og avslag på drop
  let res = await call('POST', '/investors', { name: 'Drop Testinvestor AS' });
  assert.equal(res.status, 200);
  dropId = (await res.json()).id;

  res = await call('POST', '/products', { name: 'Testprosjekt Merge', status: 'Fundraising' });
  assert.equal(res.status, 200);
  productId = (await res.json())._id;

  res = await call('PUT', '/product-investors', {
    product_id: productId, investor_id: dropId, target_ticket: 25, probability: 0.5,
  });
  assert.equal(res.status, 200);

  res = await call('POST', '/declined-offers', {
    product_id: productId, investor_id: dropId, decline_reason: 'Testavslag', declined_at: '2026-07-01',
  });
  assert.equal(res.status, 200);

  // Merge: behold keep, slett drop
  res = await call('POST', '/merge', { keep_id: keepId, drop_id: dropId });
  assert.equal(res.status, 200);
  const { merged } = await res.json();
  assert.ok(merged.product_interests.includes(productId), 'produktkobling må følge med til keep');

  // Regresjon: avslaget må ha flyttet til keep (ble tidligere CASCADE-slettet med drop)
  res = await call('GET', `/declined-offers?productId=${productId}`);
  const offers = await res.json();
  const moved = offers.find(o => o.investor_id === keepId);
  assert.ok(moved, 'declined_offer må være flyttet til keep-investoren');
  assert.equal(moved.decline_reason, 'Testavslag');

  // Drop-investoren skal være borte
  res = await call('GET', `/investors/${dropId}`);
  assert.equal(res.status, 404);
});

test('DELETE /api/investors soft-deleter, restore gjenoppretter', opts, async () => {
  let res = await call('DELETE', `/investors/${keepId}`);
  assert.equal(res.status, 200);

  res = await call('GET', `/investors/${keepId}`);
  assert.equal(res.status, 404, 'soft-deletet investor skal gi 404');

  res = await call('POST', `/investors/${keepId}/restore`);
  assert.equal(res.status, 200);

  res = await call('GET', `/investors/${keepId}`);
  assert.equal(res.status, 200, 'gjenopprettet investor skal være tilgjengelig');
});
