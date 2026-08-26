// Initialiserer skjemaet i en tom test-DB (brukes av CI før npm test).
// Kjør: node scripts/init-test-db.js  (DATABASE_URL må peke på en engangs-DB)
const fs   = require('fs');
const path = require('path');
const { query, pool } = require('../db');

(async () => {
  await query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));

  // connect-pg-simple oppretter user_sessions lazily (createTableIfMissing). I CI
  // kjører smoke- og crud-testene som parallelle prosesser mot samme DB, og to
  // samtidige CREATE TABLE IF NOT EXISTS kan race og krasje én prosess (flaky rødt).
  // Opprett tabellen her på forhånd så runtime-opprettelsen aldri trengs.
  await query(`
    CREATE TABLE IF NOT EXISTS "user_sessions" (
      "sid"    varchar NOT NULL,
      "sess"   json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire" ON "user_sessions" ("expire");`);

  console.log('[init-test-db] Skjema klart');
  await pool.end();
})().catch(e => {
  console.error('[init-test-db] Feilet:', e.message);
  process.exit(1);
});
