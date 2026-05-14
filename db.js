/**
 * JSON-filbasert lagring — ingen native moduler, ingen kompilering.
 * Data lagres i /data/ som investors.json, contacts.json, contact_log.json
 *
 * Skriv-kø: writeAsync() serialiserer skriveoperasjoner per tabell slik at
 * samtidige forespørsler ikke kan overskrive hverandres endringer.
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const FILES = {
  investors:        path.join(DATA_DIR, 'investors.json'),
  contacts:         path.join(DATA_DIR, 'contacts.json'),
  log:              path.join(DATA_DIR, 'contact_log.json'),
  tasks:            path.join(DATA_DIR, 'tasks.json'),
  products:         path.join(DATA_DIR, 'products.json'),
  users:            path.join(DATA_DIR, 'users.json'),
  product_investors: path.join(DATA_DIR, 'product_investors.json'),
};

function read(table) {
  if (!fs.existsSync(FILES[table])) return [];
  try { return JSON.parse(fs.readFileSync(FILES[table], 'utf8')); }
  catch { return []; }
}

function write(table, data) {
  const content = JSON.stringify(data, null, 2);
  const dest = FILES[table];
  const tmp  = dest + '.tmp';
  const bak  = dest + '.bak';

  // Write to temp file
  fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'w' });

  // Verify the temp file parses correctly before replacing the real file
  try {
    const verify = fs.readFileSync(tmp, 'utf8');
    JSON.parse(verify);
  } catch(e) {
    fs.unlinkSync(tmp);
    throw new Error(`write(${table}): verifisering feilet — original fil beholdt. ${e.message}`);
  }

  // Keep a rolling .bak copy of the previous good file
  if (fs.existsSync(dest)) {
    fs.copyFileSync(dest, bak);
  }

  // Atomic replace
  fs.renameSync(tmp, dest);
}

function nextId(table) {
  const rows = read(table);
  if (rows.length === 0) return 1;
  return Math.max(...rows.map(r => r._id || 0)) + 1;
}

// ── Async write queue ─────────────────────────────────────────────────────────
// Serialiserer skriving per tabell — forhindrer at samtidige requests
// overskriver hverandres endringer.
const _queues = {};

function writeAsync(table, data) {
  if (!_queues[table]) _queues[table] = Promise.resolve();
  const result = _queues[table].then(() => write(table, data));
  // Feil stopper ikke køen for neste skriving
  _queues[table] = result.catch(() => {});
  return result;
}

module.exports = { read, write, writeAsync, nextId };
