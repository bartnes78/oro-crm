// Oppfølger til migrate-committed-to-mnok.js: target_size på de tre Etablert-
// prosjektene var også lagret i NOK. Guard > 100000 (ikke > 1000) fordi andre
// prosjekter har legitime MNOK-mål opp til 5000.
const { query, pool } = require('../db.js');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: before } = await client.query(`
      SELECT id, name, target_size FROM products
      WHERE id IN (6, 7, 8) AND target_size > 100000
      ORDER BY id`);

    if (before.length === 0) {
      console.log('Ingen rader å migrere — allerede kjørt?');
      await client.query('ROLLBACK');
      return;
    }

    await client.query(`
      UPDATE products SET target_size = target_size / 1000000
      WHERE id IN (6, 7, 8) AND target_size > 100000`);

    for (const r of before) {
      await client.query(
        `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, old_value, new_value, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [null, 'migration', 'update', 'product', String(r.id),
         JSON.stringify({ target_size: r.target_size }),
         JSON.stringify({ target_size: r.target_size / 1000000 }),
         `Migrering NOK→MNOK: target_size for ${r.name} (${r.target_size} → ${r.target_size / 1000000})`]
      );
    }

    await client.query('COMMIT');
    console.log(`Migrerte ${before.length} prosjekter.`);

    const { rows: after } = await client.query(
      'SELECT id, name, status, target_size FROM products ORDER BY id');
    for (const r of after) console.log(`id=${r.id}  ${r.name}  ${r.status}  target_size=${r.target_size}`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
