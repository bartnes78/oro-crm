const { query, pool } = require('../db.js');

(async () => {
  const { rows } = await query(`
    SELECT pi.id, pi.investor_id, pi.product_id, pi.committed_amount, pi.target_ticket,
           p.name AS project, p.status, i.name AS investor
    FROM product_investors pi
    JOIN products p ON p.id = pi.product_id
    JOIN investors i ON i.id = pi.investor_id
    WHERE pi.committed_amount IS NOT NULL
    ORDER BY p.name, i.name`);
  console.log('Totalt rader med committed_amount:', rows.length);
  console.log('Rader med verdi > 1000:', rows.filter(r => r.committed_amount > 1000).length);
  console.log('Rader med verdi <= 1000:', rows.filter(r => r.committed_amount <= 1000).length);
  const byProject = {};
  for (const r of rows) {
    const key = `${r.project} (${r.status})`;
    byProject[key] = (byProject[key] || 0) + 1;
  }
  console.log(byProject);
  for (const r of rows) {
    console.log(`pi.id=${r.id}  ${r.investor}  committed=${r.committed_amount}  target_ticket=${r.target_ticket}`);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
