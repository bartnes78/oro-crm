// Engangsimport: nytt prosjekt "ORO Strømsveien 177-179" (Oro 41 AS, styrevedtak 30.06.2025).
// To kapitalforhøyelser, begge tegnere finnes allerede i basen.
// Idempotent: produkt matches på navn, koblinger via ON CONFLICT, faseendring kun hvis ikke allerede Investor.
const { pool } = require('../db.js');

const PRODUCT = {
  name: 'ORO Strømsveien 177-179',
  type: 'Prosjekt',
  status: 'Aktiv',
  target_size: 50.56, // 4,435 (sak 1) + 46,125 (sak 2) MNOK
  established_date: '2025-06-30',
  description: 'To kapitalforhøyelser for erverv av Strømsveien 179 AS (org.nr 919 003 081) og Strømsveien 177 AS (org.nr 918 944 672). 980 000 A-aksjer totalt (sak 1: 230 000 à kurs 19,28261 = OroEiendom AS; sak 2: 750 000 à kurs 61,50 = Songa Eiendom AS).',
};
// committed i MNOK (aksjeinnskuddsforpliktelse / 1 000 000)
const SUBSCRIBERS = [
  { id: 'INV-700', name: 'OroEiendom AS',     committed: 4.435 },
  { id: 'INV-648', name: 'Songa Eiendom AS',  committed: 46.125, setInvestor: true },
];

async function audit(client, action, entity, id, oldVal, newVal, desc) {
  await client.query(
    `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, old_value, new_value, description)
     VALUES (NULL,'import',$1,$2,$3,$4,$5,$6)`,
    [action, entity, String(id), oldVal ? JSON.stringify(oldVal) : null, JSON.stringify(newVal), desc]
  );
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Produkt (match på navn)
    const { rows: pr } = await client.query('SELECT id FROM products WHERE name = $1', [PRODUCT.name]);
    let productId;
    if (pr.length) {
      productId = pr[0].id;
      console.log(`Produkt finnes allerede: ${PRODUCT.name} (id=${productId})`);
    } else {
      const { rows } = await client.query(
        `INSERT INTO products (name, type, status, target_size, description, established_date)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [PRODUCT.name, PRODUCT.type, PRODUCT.status, PRODUCT.target_size, PRODUCT.description, PRODUCT.established_date]
      );
      productId = rows[0].id;
      await audit(client, 'create', 'product', productId, null,
        { name: PRODUCT.name, status: PRODUCT.status, target_size: PRODUCT.target_size },
        `Importerte prosjekt: ${PRODUCT.name}`);
      console.log(`Opprettet produkt: ${PRODUCT.name} (id=${productId})`);
    }

    // 2) Koblinger + evt. faseendring
    for (const s of SUBSCRIBERS) {
      const { rows: inv } = await client.query('SELECT id, phase FROM investors WHERE id=$1 AND deleted_at IS NULL', [s.id]);
      if (!inv.length) throw new Error(`Investor ${s.id} (${s.name}) finnes ikke`);

      if (s.setInvestor && inv[0].phase !== 'Investor') {
        await client.query("UPDATE investors SET phase='Investor', updated_at=NOW() WHERE id=$1", [s.id]);
        await audit(client, 'update', 'investor', s.id, { phase: inv[0].phase }, { phase: 'Investor' },
          `Fase ${inv[0].phase} → Investor (tegnet i ${PRODUCT.name})`);
        console.log(`  Fase ${s.name} (${s.id}): ${inv[0].phase} → Investor`);
      }

      // Tegnet investor → committed = ticket, sannsynlighet 100 % (samme som Etablert-prosjekter)
      await client.query(
        `INSERT INTO product_investors (product_id, investor_id, committed_amount, target_ticket, probability)
         VALUES ($1,$2,$3,$3,1)
         ON CONFLICT (product_id, investor_id) DO UPDATE
           SET committed_amount = EXCLUDED.committed_amount,
               target_ticket    = EXCLUDED.target_ticket,
               probability      = EXCLUDED.probability`,
        [productId, s.id, s.committed]
      );
      await audit(client, 'update', 'product_investor', `${productId}:${s.id}`, null,
        { committed_amount: s.committed },
        `Tegning ${PRODUCT.name}: ${s.name} = ${s.committed} MNOK`);
      console.log(`  Koblet ${s.name} (${s.id}) → ${s.committed} MNOK`);
    }

    await client.query('COMMIT');

    const { rows: chk } = await client.query(
      `SELECT i.name, i.phase, pi.committed_amount
       FROM product_investors pi JOIN investors i ON i.id = pi.investor_id
       WHERE pi.product_id = $1 ORDER BY pi.committed_amount DESC`, [productId]
    );
    const sum = chk.reduce((a, r) => a + Number(r.committed_amount || 0), 0);
    console.log('\n── Resultat ──');
    chk.forEach(r => console.log(`  ${r.name} [${r.phase}]: ${r.committed_amount} MNOK`));
    console.log(`  SUM: ${sum.toFixed(3)} MNOK (forventet 50.560)`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
