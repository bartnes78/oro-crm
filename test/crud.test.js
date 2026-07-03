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

// ── Produkt-CRUD ──────────────────────────────────────────────────────────────
test('POST /api/products avviser manglende navn med 400', opts, async () => {
  const res = await call('POST', '/products', { status: 'Fundraising' });
  assert.equal(res.status, 400);
});

test('produkt-CRUD er admin-only — ikke-admin får 403', opts, async () => {
  const { query } = require('../db');
  const { hashPassword } = require('../lib/helpers');
  await query(
    `INSERT INTO users (username, display_name, role, password_hash, must_change_password)
     VALUES ('testbruker', 'Test Bruker', 'user', $1, FALSE)
     ON CONFLICT (username) DO NOTHING`,
    [hashPassword('test-passord-123')]
  );
  const login = await fetch(`${srv.baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testbruker', password: 'test-passord-123' }),
  });
  assert.equal(login.status, 200);
  const userCookie = (login.headers.get('set-cookie') || '').split(';')[0];

  const res = await fetch(`${srv.baseUrl}/api/products`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', Cookie: userCookie },
    body: JSON.stringify({ name: 'Skal avvises' }),
  });
  assert.equal(res.status, 403, 'ikke-admin skal ikke få opprette produkt');
});

test('produkt-livssyklus: opprett → rediger → tegning → avlys flytter til avslått', opts, async () => {
  // Egen investor for denne testen (uavhengig av merge-testens tilstand)
  let res = await call('POST', '/investors', { name: 'Produkt Testinvestor AS', phase: 'Investor' });
  assert.equal(res.status, 200);
  const invId = (await res.json()).id;

  // Opprett prosjekt
  res = await call('POST', '/products', { name: 'Livssyklus Testprosjekt', status: 'Fundraising', target_size: 100 });
  assert.equal(res.status, 200);
  const pid = (await res.json())._id;

  // Rediger
  res = await call('PUT', `/products/${pid}`, { name: 'Livssyklus Testprosjekt (endret)', target_size: 150 });
  assert.equal(res.status, 200);
  let prod = await res.json();
  assert.equal(prod.name, 'Livssyklus Testprosjekt (endret)');
  assert.equal(prod.target_size, 150);

  // Validering: negativ ticket avvises
  res = await call('PUT', '/product-investors', { product_id: pid, investor_id: invId, target_ticket: -5 });
  assert.equal(res.status, 400);

  // Registrer tegning
  res = await call('PUT', '/product-investors', { product_id: pid, investor_id: invId, committed_amount: 10 });
  assert.equal(res.status, 200);

  // Avlys → tegnet investor flyttes til avslått, committed_amount nulles
  res = await call('POST', `/products/${pid}/cancel`, { reason: 'Testavlysning' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).committed_moved, 1, 'tegnet investor skal flyttes til avslått');

  res = await call('GET', `/declined-offers?productId=${pid}`);
  const offers = await res.json();
  const declined = offers.find(o => o.investor_id === invId);
  assert.ok(declined, 'investor skal ligge i avslåtte tilbud etter avlysning');
  assert.equal(declined.decline_reason, 'Testavlysning');

  res = await call('GET', `/product-investors?investorId=${invId}`);
  const pis = await res.json();
  const row = pis.find(r => r.product_id === pid);
  assert.equal(row.committed_amount, null, 'committed_amount skal nulles ved avlysning');
});

test('POST /api/products/:id/complete setter status Fullført', opts, async () => {
  let res = await call('POST', '/products', { name: 'Fullfør Testprosjekt', status: 'Fundraising' });
  assert.equal(res.status, 200);
  const pid = (await res.json())._id;

  res = await call('POST', `/products/${pid}/complete`);
  assert.equal(res.status, 200);

  res = await call('GET', '/products');
  const prod = (await res.json()).find(p => p._id === pid);
  assert.equal(prod.status, 'Fullført');
});

test('DELETE /api/products/:id fjerner produktet', opts, async () => {
  let res = await call('POST', '/products', { name: 'Slett Testprosjekt', status: 'Pipeline' });
  assert.equal(res.status, 200);
  const pid = (await res.json())._id;

  res = await call('DELETE', `/products/${pid}`);
  assert.equal(res.status, 200);

  res = await call('GET', '/products');
  const prod = (await res.json()).find(p => p._id === pid);
  assert.equal(prod, undefined, 'slettet produkt skal ikke lenger finnes');
});
