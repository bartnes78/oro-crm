require('dotenv').config();
const pg = require('pg');

// DATE-kolonner returneres som strenger (YYYY-MM-DD), ikke JS Date-objekter
pg.types.setTypeParser(1082, v => v);
// NUMERIC returneres som tall, ikke strenger
pg.types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', err => console.error('[db] Pool-feil:', err.message));

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
