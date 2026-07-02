// Initialiserer skjemaet i en tom test-DB (brukes av CI før npm test).
// Kjør: node scripts/init-test-db.js  (DATABASE_URL må peke på en engangs-DB)
const fs   = require('fs');
const path = require('path');
const { query, pool } = require('../db');

(async () => {
  await query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  console.log('[init-test-db] Skjema klart');
  await pool.end();
})().catch(e => {
  console.error('[init-test-db] Feilet:', e.message);
  process.exit(1);
});
