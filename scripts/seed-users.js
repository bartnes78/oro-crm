// Opprett de tre gjenværende teammedlemmene med standard startpassord.
// Kjøres mot Railway-databasen: node scripts/seed-users.js
// Idempotent — hopper over brukernavn som allerede finnes.

require('dotenv').config();
const crypto = require('crypto');
const { query } = require('../db');

function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pass, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const USERS = [
  { username: 'andersbn', displayName: 'Anders Brustad-Nilsen', leadName: 'Anders Brustad-Nilsen', role: 'bruker' },
  { username: 'andersa',  displayName: 'Anders Aasand',          leadName: 'Anders Aasand',          role: 'bruker' },
  { username: 'gunnar',   displayName: 'Gunnar Vestby',           leadName: 'Gunnar Vestby',           role: 'bruker' },
];

async function run() {
  for (const u of USERS) {
    const { rows: existing } = await query('SELECT id FROM users WHERE username=$1', [u.username]);
    if (existing.length) {
      console.log(`[skip] ${u.username} finnes allerede`);
      continue;
    }
    await query(
      `INSERT INTO users (username, display_name, role, password_hash, must_change_password, lead_name)
       VALUES ($1,$2,$3,$4,TRUE,$5)`,
      [u.username, u.displayName, u.role, hashPassword('byttpassord'), u.leadName]
    );
    console.log(`[ok] Opprettet ${u.username} (${u.displayName})`);
  }
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
