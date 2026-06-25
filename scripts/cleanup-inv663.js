// Engangsopprydding: INV-663 "Laho AS/Procerta AS" var en feilaktig kombinert rad.
// Laho AS finnes som INV-340 (org 989085344), Procerta AS som INV-742 (org 984807880).
// Beslutning (bruker 25.06.2026):
//   - Kontakten Benedicte Bakke Agerup er kontakt for BEGGE selskaper.
//     INV-340 har henne allerede → legg henne til på INV-742.
//   - BEGGE skal ha prospekt-kobling til "ORO Høvik og Herstrøm" (produkt 4),
//     med samme parametre som INV-663 hadde: target_ticket=5, probability=0.01, ikke tegnet.
//   - INV-663 soft-slettes (deleted_at=NOW()) → papirkurv, som i appens DELETE-rute.
// Idempotent: kontakt matches på e-post, koblinger via ON CONFLICT, sletting kun hvis aktiv.
const { pool } = require('../db.js');

const SOURCE = 'INV-663';
const TARGETS = ['INV-340', 'INV-742']; // Laho, Procerta
const HOVIK_PRODUCT_ID = 4;

async function audit(client, action, entity, id, oldVal, newVal, desc) {
  await client.query(
    `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, old_value, new_value, description)
     VALUES (NULL,'cleanup',$1,$2,$3,$4,$5,$6)`,
    [action, entity, String(id), oldVal ? JSON.stringify(oldVal) : null, newVal ? JSON.stringify(newVal) : null, desc]);
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Hent INV-663-radens prospektparametre og kontakt som fasit
    const { rows: src } = await client.query(
      'SELECT id, name, deleted_at FROM investors WHERE id=$1', [SOURCE]);
    if (!src.length) throw new Error(`${SOURCE} finnes ikke`);

    const { rows: srcPi } = await client.query(
      'SELECT product_id, committed_amount, target_ticket, probability, decline_reason FROM product_investors WHERE investor_id=$1 AND product_id=$2',
      [SOURCE, HOVIK_PRODUCT_ID]);
    if (!srcPi.length) throw new Error(`${SOURCE} mangler kobling til produkt ${HOVIK_PRODUCT_ID}`);
    const pi = srcPi[0];

    const { rows: srcContact } = await client.query(
      'SELECT name, title, email, phone, phone2, is_primary, active, source, notes FROM contacts WHERE investor_id=$1 ORDER BY id LIMIT 1',
      [SOURCE]);
    const c = srcContact[0]; // Benedicte Bakke Agerup

    // 1) Kontakt på begge selskaper (Laho har den allerede; sjekk på e-post)
    for (const t of TARGETS) {
      const { rows: ex } = await client.query(
        'SELECT id FROM contacts WHERE investor_id=$1 AND lower(email)=lower($2)', [t, c.email]);
      if (ex.length) { console.log(`Kontakt ${c.email} finnes allerede på ${t} (id=${ex[0].id})`); continue; }
      const isPrimary = c.is_primary ? 1 : 0;
      const { rows: ins } = await client.query(
        `INSERT INTO contacts (investor_id, name, title, email, phone, phone2, is_primary, active, source, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [t, c.name, c.title, c.email, c.phone, c.phone2, isPrimary, c.active ?? 1, c.source, c.notes]);
      await audit(client, 'create', 'contact', ins.rows?.[0]?.id ?? ins[0].id, null,
        { investor_id: t, name: c.name, email: c.email },
        `Kopierte kontakt ${c.name} fra ${SOURCE} til ${t} (felles kontakt Laho/Procerta)`);
      console.log(`La til kontakt ${c.name} på ${t} (id=${ins[0].id})`);
    }

    // 2) Prospekt-kobling til Høvik på begge selskaper
    for (const t of TARGETS) {
      const r = await client.query(
        `INSERT INTO product_investors (product_id, investor_id, committed_amount, target_ticket, probability, decline_reason)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (product_id, investor_id) DO NOTHING`,
        [HOVIK_PRODUCT_ID, t, pi.committed_amount, pi.target_ticket, pi.probability, pi.decline_reason]);
      if (r.rowCount === 0) { console.log(`Kobling produkt ${HOVIK_PRODUCT_ID} ↔ ${t} finnes allerede`); continue; }
      await audit(client, 'create', 'product_investor', `${HOVIK_PRODUCT_ID}:${t}`, null,
        { target_ticket: pi.target_ticket, probability: pi.probability },
        `Migrerte prospekt-kobling ORO Høvik og Herstrøm fra ${SOURCE} til ${t} (target ${pi.target_ticket} MNOK @ ${pi.probability})`);
      console.log(`Koblet ${t} → produkt ${HOVIK_PRODUCT_ID} (target ${pi.target_ticket}, prob ${pi.probability})`);
    }

    // 3) Soft-slett INV-663 (papirkurv), som appens DELETE /api/investors/:id
    if (src[0].deleted_at) {
      console.log(`${SOURCE} er allerede i papirkurven (deleted_at=${src[0].deleted_at}) — hopper over`);
    } else {
      const { rows: full } = await client.query('SELECT name, phase, lead FROM investors WHERE id=$1', [SOURCE]);
      await client.query('UPDATE investors SET deleted_at = NOW() WHERE id=$1', [SOURCE]);
      await audit(client, 'delete', 'investor', SOURCE,
        { name: full[0].name, phase: full[0].phase, lead: full[0].lead }, null,
        `Flyttet til papirkurv: ${full[0].name} — feilaktig kombinert rad, ryddet til INV-340 (Laho) og INV-742 (Procerta)`);
      console.log(`Soft-slettet ${SOURCE} (→ papirkurv)`);
    }

    await client.query('COMMIT');

    // Verifikasjon
    console.log('\n── Verifikasjon ──');
    for (const t of [...TARGETS, SOURCE]) {
      const { rows: inv } = await client.query('SELECT id, name, phase, deleted_at FROM investors WHERE id=$1', [t]);
      const { rows: cs } = await client.query('SELECT name, email FROM contacts WHERE investor_id=$1 ORDER BY id', [t]);
      const { rows: ps } = await client.query(
        `SELECT p.name, pi.target_ticket, pi.probability, pi.committed_amount
         FROM product_investors pi JOIN products p ON p.id=pi.product_id WHERE pi.investor_id=$1 ORDER BY p.id`, [t]);
      console.log(`${inv[0].id} ${inv[0].name} [${inv[0].phase}]${inv[0].deleted_at ? ' DELETED ' + inv[0].deleted_at : ''}`);
      cs.forEach(x => console.log(`    kontakt: ${x.name} <${x.email}>`));
      ps.forEach(x => console.log(`    produkt: ${x.name} (target ${x.target_ticket}, prob ${x.probability}, committed ${x.committed_amount})`));
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
