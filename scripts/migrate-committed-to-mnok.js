// Engangsmigrering: committed_amount på product_investors var lagret i NOK,
// resten av appen antar MNOK. Deler på 1 000 000 for rader med verdi > 1000
// (guard som gjør migreringen idempotent — MNOK-verdier er aldri > 1000).
const { query, pool } = require('../db.js');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: before } = await client.query(`
      SELECT pi.id, pi.investor_id, pi.product_id, pi.committed_amount, i.name AS investor
      FROM product_investors pi
      JOIN investors i ON i.id = pi.investor_id
      WHERE pi.committed_amount IS NOT NULL AND pi.committed_amount > 1000
      ORDER BY pi.id`);

    if (before.length === 0) {
      console.log('Ingen rader å migrere — allerede kjørt?');
      await client.query('ROLLBACK');
      return;
    }

    const { rowCount } = await client.query(`
      UPDATE product_investors
      SET committed_amount = committed_amount / 1000000
      WHERE committed_amount IS NOT NULL AND committed_amount > 1000`);

    for (const r of before) {
      await client.query(
        `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, old_value, new_value, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [null, 'migration', 'update', 'product_investor', String(r.id),
         JSON.stringify({ committed_amount: r.committed_amount }),
         JSON.stringify({ committed_amount: r.committed_amount / 1000000 }),
         `Migrering NOK→MNOK: committed_amount for ${r.investor} (${r.committed_amount} → ${r.committed_amount / 1000000})`]
      );
    }

    await client.query('COMMIT');
    console.log(`Migrerte ${rowCount} rader, skrev ${before.length} audit_log-innslag.`);

    const { rows: after } = await client.query(`
      SELECT pi.id, pi.committed_amount, pi.target_ticket, i.name AS investor
      FROM product_investors pi
      JOIN investors i ON i.id = pi.investor_id
      WHERE pi.committed_amount IS NOT NULL
      ORDER BY pi.id`);
    for (const r of after) {
      const ok = r.target_ticket == null || Math.abs(r.committed_amount - r.target_ticket) < 0.0001 ? '' : '  <-- AVVIK fra target_ticket!';
      console.log(`pi.id=${r.id}  ${r.investor}  committed=${r.committed_amount}  target_ticket=${r.target_ticket}${ok}`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
