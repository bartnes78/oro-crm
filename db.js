require('dotenv').config();
const pg = require('pg');

// DATE-kolonner returneres som strenger (YYYY-MM-DD), ikke JS Date-objekter
pg.types.setTypeParser(1082, v => v);
// NUMERIC returneres som tall, ikke strenger
pg.types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));

// DATABASE_PRIVATE_URL brukes når appen kjører på Railway (intern nettverking,
// ingen SSL-overhead). DATABASE_URL er public proxy-fallback for lokal utvikling.
const connectionString = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL;
const isPrivate        = !!process.env.DATABASE_PRIVATE_URL;
// Lokal DB (CI-container, lokal Postgres) kjører uten SSL
const isLocal          = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString || '');

// Timeouts: feil raskt og lesbart i stedet for å henge når DB-en er treg/nede
// (kald Railway-DB har gitt 7s+ tilkoblingstid og stille krasj tidligere)
const pool = new pg.Pool({
  connectionString,
  ssl: connectionString && !isPrivate && !isLocal ? { rejectUnauthorized: false } : false,
  max: 10,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  keepAlive: true,
});

pool.on('error', err => console.error('[db] Pool-feil:', err.message));

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
