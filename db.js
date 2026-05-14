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

const pool = new pg.Pool({
  connectionString,
  ssl: connectionString && !isPrivate ? { rejectUnauthorized: false } : false,
});

pool.on('error', err => console.error('[db] Pool-feil:', err.message));

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
