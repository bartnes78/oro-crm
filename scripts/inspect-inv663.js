// READ-ONLY: inspiserer INV-663 (Laho AS/Procerta AS) og målselskapene INV-340/INV-742.
// Ingen skriving. Brukes for å vurdere opprydding før migrering/sletting.
const { pool } = require('../db.js');

const IDS = ['INV-663', 'INV-340', 'INV-742'];

async function main() {
  const client = await pool.connect();
  try {
    console.log('=== INVESTORER ===');
    const { rows: invs } = await client.query(
      `SELECT id, name, org_nr, phase, investor_type, lead, city, brreg_navn,
              last_contact, updated_at, deleted_at
       FROM investors WHERE id = ANY($1) ORDER BY id`, [IDS]);
    invs.forEach(r => console.log(JSON.stringify(r)));

    for (const id of IDS) {
      console.log(`\n========== ${id} ==========`);

      const { rows: contacts } = await client.query(
        'SELECT id, name, title, email, phone, phone2, is_primary, active, source, notes FROM contacts WHERE investor_id=$1 ORDER BY id', [id]);
      console.log(`-- contacts (${contacts.length}) --`);
      contacts.forEach(r => console.log(JSON.stringify(r)));

      const { rows: log } = await client.query(
        'SELECT id, date, log_type, contact_person, responsible, subject, status, created_at FROM contact_log WHERE investor_id=$1 ORDER BY date', [id]);
      console.log(`-- contact_log (${log.length}) --`);
      log.forEach(r => console.log(JSON.stringify(r)));

      const { rows: tasks } = await client.query(
        'SELECT id, label, due_date, done, created_at FROM tasks WHERE investor_id=$1 ORDER BY due_date', [id]);
      console.log(`-- tasks (${tasks.length}) --`);
      tasks.forEach(r => console.log(JSON.stringify(r)));

      const { rows: pi } = await client.query(
        `SELECT pi.id, pi.product_id, p.name AS product_name, pi.committed_amount, pi.target_ticket, pi.probability, pi.decline_reason
         FROM product_investors pi JOIN products p ON p.id=pi.product_id
         WHERE pi.investor_id=$1 ORDER BY pi.product_id`, [id]);
      console.log(`-- product_investors (${pi.length}) --`);
      pi.forEach(r => console.log(JSON.stringify(r)));

      const { rows: declined } = await client.query(
        `SELECT d.id, d.product_id, p.name AS product_name, d.decline_reason, d.declined_at
         FROM declined_offers d JOIN products p ON p.id=d.product_id
         WHERE d.investor_id=$1 ORDER BY d.product_id`, [id]);
      console.log(`-- declined_offers (${declined.length}) --`);
      declined.forEach(r => console.log(JSON.stringify(r)));
    }

    // contact_log kan ha foreldreløse rader via investor_name selv om investor_id er satt — sjekk begge
    console.log('\n=== contact_log via investor_name LIKE (Laho/Procerta) ===');
    const { rows: nameLog } = await client.query(
      `SELECT id, investor_id, investor_name, date, log_type, subject FROM contact_log
       WHERE investor_name ILIKE '%laho%' OR investor_name ILIKE '%procerta%' ORDER BY investor_name, date`);
    nameLog.forEach(r => console.log(JSON.stringify(r)));

    console.log('\n=== tasks via investor_name LIKE (Laho/Procerta) ===');
    const { rows: nameTasks } = await client.query(
      `SELECT id, investor_id, investor_name, label, due_date FROM tasks
       WHERE investor_name ILIKE '%laho%' OR investor_name ILIKE '%procerta%' ORDER BY investor_name`);
    nameTasks.forEach(r => console.log(JSON.stringify(r)));

    console.log('\n=== audit_log for INV-663 ===');
    const { rows: audit } = await client.query(
      `SELECT id, action, username, description, created_at FROM audit_log
       WHERE entity_type='investor' AND entity_id='INV-663' ORDER BY created_at`);
    audit.forEach(r => console.log(JSON.stringify(r)));
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
