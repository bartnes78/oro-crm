// Engangsimport: nytt prosjekt "ORO Stokkamyr" (Oro 28 AS, kapitalforhøyelse II, styrevedtak 14.03.2022).
// 8 tegnere, aksjeklasse A, kurs NOK 130,50. Vedlegg 1 oppgir org.nr direkte → nye investorer
// opprettes via Brreg-oppslag PÅ org.nr (pålitelig, ingen navnegjetting).
// Tegnet investor: committed = target_ticket, probability = 1. Idempotent.
const https = require('https');
const { pool } = require('../db.js');

function brregGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://data.brreg.no/enhetsregisteret/api${path}`, { headers: { Accept: 'application/json' } }, res => {
      let data = ''; res.on('data', d => (data += d));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: {} }); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Brreg timeout')); });
  });
}
const SKIP_ROLLER = new Set(['REVI', 'REGN']);
function parseAdresser(e) {
  const a = [];
  if (e.forretningsadresse) a.push({ type: 'Forretningsadresse', ...e.forretningsadresse });
  if (e.postadresse && e.postadresse.poststed !== e.forretningsadresse?.poststed) a.push({ type: 'Postadresse', ...e.postadresse });
  if (e.beliggenhetsadresse && e.beliggenhetsadresse.poststed !== e.forretningsadresse?.poststed) a.push({ type: 'Beliggenhetsadresse', ...e.beliggenhetsadresse });
  return a;
}
function parseRoller(rb) {
  const roller = [];
  for (const rg of (rb.rollegrupper || [])) {
    if (SKIP_ROLLER.has(rg.type?.kode)) continue;
    for (const rolle of (rg.roller || [])) {
      if (rolle.fratredelsesdato) continue;
      const p = rolle.person || rolle.enhet; if (!p) continue;
      const navn = p.navn ? `${p.navn.fornavn || ''} ${p.navn.mellomnavn ? p.navn.mellomnavn + ' ' : ''}${p.navn.etternavn || ''}`.trim() : null;
      if (!navn) continue;
      roller.push({ gruppe: rg.type?.beskrivelse || rg.type?.kode || '', type: rolle.type?.beskrivelse || rg.type?.beskrivelse || '', navn });
    }
  }
  return roller;
}
async function brregByOrgnr(orgnr) {
  const [{ status, body: e }, { body: rb }] = await Promise.all([brregGet(`/enheter/${orgnr}`), brregGet(`/enheter/${orgnr}/roller`)]);
  if (status === 404) return null;
  return {
    orgnr, navn: e.navn,
    city: e.forretningsadresse?.poststed || e.postadresse?.poststed || null,
    brregData: {
      orgform: e.organisasjonsform?.beskrivelse || null, naeringskode: e.naeringskode1?.beskrivelse || null,
      stiftet: e.stiftelsesdato || null, ansatte: e.antallAnsatte ?? null,
      adresser: parseAdresser(e), roller: parseRoller(rb), synced_at: new Date().toISOString(),
    },
  };
}

const PRODUCT = {
  name: 'ORO Stokkamyr',
  type: 'Prosjekt',
  status: 'Aktiv',
  target_size: 85.4775, // 655 000 aksjer * 130,50 / 1e6 (kapitalforhøyelse II)
  established_date: '2022-03-14',
  description: 'Kapitalforhøyelse II for erverv av Stokkamyr Eiendom AS (org.nr 917 634 610). 655 000 A-aksjer à kurs NOK 130,50 (overkurs 128,50).',
};
// committed (MNOK) = innskuddsforpliktelse fra Vedlegg 1 / 1e6
const SUBSCRIBERS = [
  { name: 'OROEIENDOM AS',        orgnr: '926109936', existingId: 'INV-700', committed: 3.915 },
  { name: 'Vestsiden Holding AS', orgnr: '889116382', existingId: 'INV-702', committed: 1.4355 },
  { name: 'Real Value AS',        orgnr: '977370817', existingId: 'INV-727', committed: 1.63125 },
  { name: 'Aubert Vekst AS',      orgnr: '979523335', existingId: 'INV-724', committed: 3.45825 },
  { name: 'ESF Capital AS',       orgnr: '917949735', create: true,         committed: 1.305 },
  { name: 'Pesiba AS',            orgnr: '996200671', create: true,         committed: 1.305 },
  { name: 'AG Eiendomsinvest AS', orgnr: '990494878', existingId: 'INV-621', committed: 41.1075 },
  { name: 'Sjøinvest AS',         orgnr: '938999465', existingId: 'INV-639', committed: 31.32 },
];

async function audit(client, action, entity, id, oldVal, newVal, desc) {
  await client.query(
    `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, old_value, new_value, description)
     VALUES (NULL,'import',$1,$2,$3,$4,$5,$6)`,
    [action, entity, String(id), oldVal ? JSON.stringify(oldVal) : null, JSON.stringify(newVal), desc]);
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: pr } = await client.query('SELECT id FROM products WHERE name = $1', [PRODUCT.name]);
    let productId;
    if (pr.length) { productId = pr[0].id; console.log(`Produkt finnes allerede: ${PRODUCT.name} (id=${productId})`); }
    else {
      const { rows } = await client.query(
        `INSERT INTO products (name, type, status, target_size, description, established_date)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [PRODUCT.name, PRODUCT.type, PRODUCT.status, PRODUCT.target_size, PRODUCT.description, PRODUCT.established_date]);
      productId = rows[0].id;
      await audit(client, 'create', 'product', productId, null, { name: PRODUCT.name, target_size: PRODUCT.target_size }, `Importerte prosjekt: ${PRODUCT.name}`);
      console.log(`Opprettet produkt: ${PRODUCT.name} (id=${productId})`);
    }

    for (const s of SUBSCRIBERS) {
      let invId = s.existingId || null;

      if (!invId && s.create) {
        // Match først på org.nr (mest pålitelig), så navn
        const { rows: byOrg } = await client.query('SELECT id FROM investors WHERE org_nr=$1 AND deleted_at IS NULL', [s.orgnr]);
        if (byOrg.length) { invId = byOrg[0].id; console.log(`  Org.nr ${s.orgnr} finnes (${invId}) — gjenbruker`); }
        else {
          const { rows: byName } = await client.query('SELECT id FROM investors WHERE name ILIKE $1 AND deleted_at IS NULL', [s.name]);
          if (byName.length) { invId = byName[0].id; console.log(`  Tegner finnes på navn: ${s.name} (${invId})`); }
        }
        if (!invId) {
          let br = null;
          try { br = await brregByOrgnr(s.orgnr); } catch (e) { console.log(`  Brreg-feil for ${s.name} (${s.orgnr}): ${e.message}`); }
          const { rows: last } = await client.query(`SELECT id FROM investors WHERE id ~ '^INV-\\d+$' ORDER BY CAST(SUBSTRING(id FROM 5) AS INTEGER) DESC LIMIT 1`);
          const maxNum = last.length ? parseInt(last[0].id.slice(4)) : 0;
          invId = 'INV-' + String(maxNum + 1).padStart(3, '0');
          await client.query(
            `INSERT INTO investors (id, name, country, city, phase, org_nr, brreg_navn, brreg_data, updated_at)
             VALUES ($1,$2,'Norge',$3,'Investor',$4,$5,$6,NOW())`,
            [invId, br?.navn || s.name, br?.city || null, s.orgnr, br?.navn || null, JSON.stringify(br?.brregData || {})]);
          await audit(client, 'create', 'investor', invId, null, { name: br?.navn || s.name, phase: 'Investor', org_nr: s.orgnr },
            `Importerte tegner fra Oro 28-emisjon: ${br?.navn || s.name} (org.nr ${s.orgnr})`);
          console.log(`  Opprettet tegner: ${br?.navn || s.name} (${invId}) org.nr ${s.orgnr}`);
        }
      }

      const { rows: inv } = await client.query('SELECT phase FROM investors WHERE id=$1 AND deleted_at IS NULL', [invId]);
      if (!inv.length) throw new Error(`Investor ${invId} (${s.name}) finnes ikke`);
      if (inv[0].phase !== 'Investor') {
        await client.query("UPDATE investors SET phase='Investor', updated_at=NOW() WHERE id=$1", [invId]);
        await audit(client, 'update', 'investor', invId, { phase: inv[0].phase }, { phase: 'Investor' }, `Fase ${inv[0].phase} → Investor (tegnet i ${PRODUCT.name})`);
        console.log(`  Fase ${s.name} (${invId}): ${inv[0].phase} → Investor`);
      }

      await client.query(
        `INSERT INTO product_investors (product_id, investor_id, committed_amount, target_ticket, probability)
         VALUES ($1,$2,$3,$3,1)
         ON CONFLICT (product_id, investor_id) DO UPDATE
           SET committed_amount = EXCLUDED.committed_amount, target_ticket = EXCLUDED.target_ticket, probability = EXCLUDED.probability`,
        [productId, invId, s.committed]);
      await audit(client, 'update', 'product_investor', `${productId}:${invId}`, null, { committed_amount: s.committed, target_ticket: s.committed, probability: 1 },
        `Tegning ${PRODUCT.name}: ${s.name} = ${s.committed} MNOK`);
      console.log(`  Koblet ${s.name} (${invId}) → ${s.committed} MNOK`);
    }

    await client.query('COMMIT');

    const { rows: chk } = await client.query(
      `SELECT i.name, i.phase, pi.committed_amount c, pi.target_ticket t, pi.probability p
       FROM product_investors pi JOIN investors i ON i.id = pi.investor_id
       WHERE pi.product_id = $1 ORDER BY pi.committed_amount DESC`, [productId]);
    const sum = chk.reduce((a, r) => a + Number(r.c || 0), 0);
    console.log('\n── Resultat ──');
    chk.forEach(r => console.log(`  ${r.name} [${r.phase}]: committed=${r.c} ticket=${r.t} prob=${r.p}`));
    console.log(`  SUM committed: ${sum.toFixed(4)} MNOK (forventet 85.4775)`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
