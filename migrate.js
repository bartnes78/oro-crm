/**
 * Engangs-migrering fra JSON-filer til PostgreSQL.
 * Kjør: node migrate.js
 * Krever DATABASE_URL i miljøet (eller .env).
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

const DATA_DIR = path.join(__dirname, 'data');

function readJson(name) {
  const f = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(f)) { console.log(`  Ingen fil: ${name}.json`); return []; }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

async function resetSeq(client, table, col = 'id') {
  await client.query(`SELECT setval(pg_get_serial_sequence('${table}', '${col}'), COALESCE((SELECT MAX(${col}) FROM ${table}), 0) + 1, false)`);
}

async function run() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Opprett tabeller
    await client.query(schema);
    console.log('Skjema OK');

    // Tøm i riktig rekkefølge
    await client.query('TRUNCATE product_investors, contact_log, tasks, products, users RESTART IDENTITY CASCADE');
    await client.query('DELETE FROM contacts');
    await client.query('DELETE FROM investors');
    console.log('Tabeller tømt');

    // ── Investorer ────────────────────────────────────────────────────────────
    const investors = readJson('investors');
    for (const inv of investors) {
      await client.query(`
        INSERT INTO investors
          (id, name, country, city, investor_type, fund_vehicle, product_interests,
           phase, lead, advisor, target_ticket, probability, first_close, source,
           next_steps, last_contact, doc_shared, meeting_date, comments, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (id) DO NOTHING
      `, [
        inv.id, inv.name, inv.country || 'Norge', inv.city || null,
        inv.investor_type || null, inv.fund_vehicle || null,
        JSON.stringify(Array.isArray(inv.product_interests) ? inv.product_interests : []),
        inv.phase || 'Prospekt', inv.lead || null, inv.advisor || null,
        inv.target_ticket ?? null, inv.probability ?? null,
        inv.first_close || 0, inv.source || null, inv.next_steps || null,
        inv.last_contact || null, inv.doc_shared || null, inv.meeting_date || null,
        inv.comments || null, inv.updated_at || new Date().toISOString(),
      ]);
    }
    console.log(`Investorer: ${investors.length}`);

    // ── Kontakter ─────────────────────────────────────────────────────────────
    const contacts = readJson('contacts');
    for (const c of contacts) {
      await client.query(`
        INSERT INTO contacts (id, investor_id, name, title, email, phone, is_primary, notes)
        OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [c._id, c.investor_id, c.name, c.title || null, c.email || null,
          c.phone || null, c.is_primary || 0, c.notes || null]);
    }
    await resetSeq(client, 'contacts');
    console.log(`Kontakter: ${contacts.length}`);

    // ── Kontaktlogg ───────────────────────────────────────────────────────────
    const log = readJson('contact_log');
    for (const l of log) {
      await client.query(`
        INSERT INTO contact_log
          (id, investor_id, investor_name, date, log_type, contact_person,
           responsible, subject, outcome, notes, created_at)
        OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [l._id, l.investor_id, l.investor_name || null, l.date,
          l.log_type || null, l.contact_person || null, l.responsible || null,
          l.subject || null, l.outcome || null, l.notes || null,
          l.created_at || new Date().toISOString()]);
    }
    await resetSeq(client, 'contact_log');
    console.log(`Kontaktlogg: ${log.length}`);

    // ── Oppgaver ──────────────────────────────────────────────────────────────
    const tasks = readJson('tasks');
    for (const t of tasks) {
      await client.query(`
        INSERT INTO tasks (id, investor_id, investor_name, label, due_date, done, created_at)
        OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [t._id, t.investor_id || null, t.investor_name || null,
          t.label, t.due_date, t.done || 0,
          t.created_at || new Date().toISOString().slice(0, 10)]);
    }
    await resetSeq(client, 'tasks');
    console.log(`Oppgaver: ${tasks.length}`);

    // ── Produkter ─────────────────────────────────────────────────────────────
    const products = readJson('products');
    for (const p of products) {
      await client.query(`
        INSERT INTO products (id, name, type, status, target_size, description)
        OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6)
      `, [p._id, p.name, p.type || null, p.status || null,
          p.target_size || null, p.description || null]);
    }
    await resetSeq(client, 'products');
    console.log(`Produkter: ${products.length}`);

    // ── Produkt-investorer ────────────────────────────────────────────────────
    const pi = readJson('product_investors');
    for (const p of pi) {
      await client.query(`
        INSERT INTO product_investors
          (id, product_id, investor_id, target_ticket, probability, decline_reason)
        OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (product_id, investor_id) DO UPDATE SET
          target_ticket  = EXCLUDED.target_ticket,
          probability    = EXCLUDED.probability,
          decline_reason = EXCLUDED.decline_reason
      `, [p._id, parseInt(p.product_id), p.investor_id,
          p.target_ticket ?? null, p.probability ?? null, p.decline_reason || null]);
    }
    await resetSeq(client, 'product_investors');
    console.log(`Produkt-investorer: ${pi.length}`);

    // ── Brukere ───────────────────────────────────────────────────────────────
    const users = readJson('users');
    for (const u of users) {
      await client.query(`
        INSERT INTO users (id, username, display_name, role, password_hash)
        OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (username) DO NOTHING
      `, [u._id, u.username, u.displayName || u.username,
          u.role || 'bruker', u.passwordHash]);
    }
    await resetSeq(client, 'users');
    console.log(`Brukere: ${users.length}`);

    await client.query('COMMIT');
    console.log('\nMigrering fullført ✓');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nMigrering feilet:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
