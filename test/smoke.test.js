// Ikke-muterende røyktester for kjerne-middleware (auth + CSRF + SPA-fallback).
// Skriver INGEN data — verifiserer kun at vernet er på plass og kablet riktig.
// Krever en kjørende dev-DB (DATABASE_URL i .env), siden session-store kobler til den.
//
// Kjør: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { pool } = require('../db');

let srv;
const XRW = { 'X-Requested-With': 'XMLHttpRequest' };

before(async () => { srv = await startServer(); });
after(async () => {
  if (srv) await srv.close();
  await pool.end();  // frigjør DB-poolen så prosessen kan avslutte rent
});

test('GET / svarer 200 med HTML (SPA-fallback)', async () => {
  const res = await fetch(`${srv.baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
});

test('GET /api/me uten sesjon → 401', async () => {
  const res = await fetch(`${srv.baseUrl}/api/me`, { headers: XRW });
  assert.equal(res.status, 401);
});

test('GET /api/investors uten sesjon → 401', async () => {
  const res = await fetch(`${srv.baseUrl}/api/investors`, { headers: XRW });
  assert.equal(res.status, 401);
});

test('POST /api/login uten X-Requested-With → 403 (CSRF-vern)', async () => {
  const res = await fetch(`${srv.baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'x', password: 'y' }),
  });
  assert.equal(res.status, 403);
});

test('POST /api/login med manglende felt → 400', async () => {
  const res = await fetch(`${srv.baseUrl}/api/login`, {
    method: 'POST',
    headers: { ...XRW, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/login med feil passord → 401', async () => {
  const res = await fetch(`${srv.baseUrl}/api/login`, {
    method: 'POST',
    headers: { ...XRW, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'finnes-ikke-test-bruker', password: 'feil' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/contacts uten X-Requested-With → 403 (CSRF før auth)', async () => {
  const res = await fetch(`${srv.baseUrl}/api/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test' }),
  });
  assert.equal(res.status, 403);
});
