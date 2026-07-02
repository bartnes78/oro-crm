// Engangsimport: nytt prosjekt "ORO Valstadsvingen 2" (Oro 43 AS, styrevedtak 23.06.2025).
// Oppretter produktet, de to manglende tegnerne (med Brreg-oppslag) og alle 6
// product_investors-koblingene med committed_amount i MNOK.
// Idempotent: produkt matches på navn, investorer på org.nr/navn, koblinger via ON CONFLICT.
const https = require('https');
const { pool } = require('../db.js');

// ── Brreg-hjelpere (speiler routes/brreg.js) ───────────────────────────────────
function brregGet(path) {
  return new Promise((resolve, reject) => {
    const url = `https://data.brreg.no/enhetsregisteret/api${path}`;
    const req = https.get(url, { headers: { Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Brreg timeout')); });
  });
}
const SKIP_ROLLER = new Set(['REVI', 'REGN']);
function parseAdresser(e) {
  const adresser = [];
  if (e.forretningsadresse) adresser.push({ type: 'Forretningsadresse', ...e.forretningsadresse });
  if (e.postadresse && e.postadresse.poststed !== e.forretningsadresse?.poststed)
    adresser.push({ type: 'Postadresse', ...e.postadresse });
  if (e.beliggenhetsadresse && e.beliggenhetsadresse.poststed !== e.forretningsadresse?.poststed)
    adresser.push({ type: 'Beliggenhetsadresse', ...e.beliggenhetsadresse });
  return adresser;
}
function parseRoller(rollerBody) {
  const roller = [];
  for (const rg of (rollerBody.rollegrupper || [])) {
    if (SKIP_ROLLER.has(rg.type?.kode)) continue;
    for (const rolle of (rg.roller || [])) {
      if (rolle.fratredelsesdato) continue;
      const p = rolle.person || rolle.enhet;
      if (!p) continue;
      const navn = p.navn
        ? `${p.navn.fornavn || ''} ${p.navn.mellomnavn ? p.navn.mellomnavn + ' ' : ''}${p.navn.etternavn || ''}`.trim()
        : null;
      if (!navn) continue;
      roller.push({ gruppe: rg.type?.beskrivelse || rg.type?.kode || '', type: rolle.type?.beskrivelse || rg.type?.beskrivelse || '', navn });
    }
  }
  return roller;
}
async function brregLookupByName(name) {
  const { body } = await brregGet(`/enheter?navn=${encodeURIComponent(name)}&size=10`);
  const enheter = (body._embedded?.enheter || []).filter(e => !e.slettedato);
  const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const hit = enheter.find(e => norm(e.navn) === norm(name)) || enheter[0];
  if (!hit) return null;
  const orgnr = hit.organisasjonsnummer;
  const [{ body: e }, { body: rollerBody }] = await Promise.all([
    brregGet(`/enheter/${orgnr}`), brregGet(`/enheter/${orgnr}/roller`),
  ]);
  return {
    orgnr,
    navn: e.navn,
    city: e.forretningsadresse?.poststed || e.postadresse?.poststed || null,
    exact: norm(hit.navn) === norm(name),
    brregData: {
      orgform: e.organisasjonsform?.beskrivelse || null,
      naeringskode: e.naeringskode1?.beskrivelse || null,
      stiftet: e.stiftelsesdato || null,
      ansatte: e.antallAnsatte ?? null,
      adresser: parseAdresser(e),
      roller: parseRoller(rollerBody),
      synced_at: new Date().toISOString(),
    },
  };
}

// ── Data fra styreprotokoll + Vedlegg 1 ────────────────────────────────────────
const PRODUCT = {
  name: 'ORO Valstadsvingen 2',
  type: 'Prosjekt',
  status: 'Aktiv',
  target_size: 22.05,
  established_date: '2025-06-23',
  description: 'A-aksjeemisjon for erverv av Valstadsvingen 2 AS (org.nr 920 543 006). 980 000 A-aksjer à kurs 22,50 (overkurs 20,50). To aksjeklasser (A: 1 stemme/aksje, B: 2 aksjer/stemme).',
};
// committed i MNOK (aksjeinnskudd / 1 000 000)
const SUBSCRIBERS = [
  { name: 'OROEiendom AS',         existingId: 'INV-700', committed: 4.05 },
  { name: 'Annima AS',             existingId: 'INV-640', committed: 4.95 },
  { name: 'Romson Invest AS',      existingId: 'INV-617', committed: 1.80 },
  { name: 'Arvarius AS',           existingId: 'INV-637', committed: 2.25 },
  { name: 'NG Eiendom Øst AS',     create: true,          committed: 4.50 },
  { name: 'Johs Hansen Rederi AS', create: true,          committed: 4.50 },
];

async function audit(client, action, entity, id, newVal, desc) {
  await client.query(
    `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, old_value, new_value, description)
     VALUES (NULL,'import',$1,$2,$3,NULL,$4,$5)`,
    [action, entity, String(id), JSON.stringify(newVal), desc]
  );
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Produkt (match på navn)
    let { rows: pr } = await client.query('SELECT id FROM products WHERE name = $1', [PRODUCT.name]);
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
      await audit(client, 'create', 'product', productId, { name: PRODUCT.name, status: PRODUCT.status, target_size: PRODUCT.target_size }, `Importerte prosjekt: ${PRODUCT.name}`);
      console.log(`Opprettet produkt: ${PRODUCT.name} (id=${productId})`);
    }

    // 2) Investorer + 3) koblinger
    for (const s of SUBSCRIBERS) {
      let invId = s.existingId || null;

      if (!invId && s.create) {
        // Finnes den allerede (re-kjøring)?
        const { rows: ex } = await client.query(
          'SELECT id FROM investors WHERE name ILIKE $1 AND deleted_at IS NULL', [s.name]
        );
        if (ex.length) {
          invId = ex[0].id;
          console.log(`  Tegner finnes allerede: ${s.name} (${invId})`);
        } else {
          let br = null;
          try { br = await brregLookupByName(s.name); }
          catch (e) { console.log(`  Brreg-oppslag feilet for ${s.name}: ${e.message}`); }
          if (br && !br.exact) console.log(`  ⚠ Brreg: ingen eksakt navnetreff for "${s.name}" — bruker "${br.navn}" (${br.orgnr})`);

          // Org.nr ikke allerede i bruk?
          if (br?.orgnr) {
            const { rows: dup } = await client.query('SELECT id, name FROM investors WHERE org_nr = $1', [br.orgnr]);
            if (dup.length) {
              invId = dup[0].id;
              console.log(`  Org.nr ${br.orgnr} finnes på ${dup[0].name} (${invId}) — gjenbruker`);
            }
          }

          if (!invId) {
            const { rows: last } = await client.query(
              `SELECT id FROM investors WHERE id ~ '^INV-\\d+$' ORDER BY CAST(SUBSTRING(id FROM 5) AS INTEGER) DESC LIMIT 1`
            );
            const maxNum = last.length ? parseInt(last[0].id.slice(4)) : 0;
            invId = 'INV-' + String(maxNum + 1).padStart(3, '0');
            await client.query(
              `INSERT INTO investors (id, name, country, city, phase, org_nr, brreg_navn, brreg_data, updated_at)
               VALUES ($1,$2,'Norge',$3,'Investor',$4,$5,$6,NOW())`,
              [invId, s.name, br?.city || null, br?.orgnr || null, br?.navn || null,
               JSON.stringify(br?.brregData || {})]
            );
            await audit(client, 'create', 'investor', invId,
              { name: s.name, phase: 'Investor', org_nr: br?.orgnr || null },
              `Importerte tegner fra Oro 43-emisjon: ${s.name}${br?.orgnr ? ' (org.nr ' + br.orgnr + ')' : ''}`);
            console.log(`  Opprettet tegner: ${s.name} (${invId})${br?.orgnr ? ' org.nr ' + br.orgnr : ' — uten org.nr'}`);
          }
        }
      }

      // Kobling: tegnet investor → committed = ticket, sannsynlighet 100 % (samme som Etablert-prosjekter)
      await client.query(
        `INSERT INTO product_investors (product_id, investor_id, committed_amount, target_ticket, probability)
         VALUES ($1,$2,$3,$3,1)
         ON CONFLICT (product_id, investor_id) DO UPDATE
           SET committed_amount = EXCLUDED.committed_amount,
               target_ticket    = EXCLUDED.target_ticket,
               probability      = EXCLUDED.probability`,
        [productId, invId, s.committed]
      );
      await audit(client, 'update', 'product_investor', `${productId}:${invId}`,
        { committed_amount: s.committed },
        `Tegning ${PRODUCT.name}: ${s.name} = ${s.committed} MNOK`);
      console.log(`  Koblet ${s.name} (${invId}) → ${s.committed} MNOK`);
    }

    await client.query('COMMIT');

    // Verifisering
    const { rows: chk } = await client.query(
      `SELECT i.name, pi.committed_amount
       FROM product_investors pi JOIN investors i ON i.id = pi.investor_id
       WHERE pi.product_id = $1 ORDER BY i.name`, [productId]
    );
    const sum = chk.reduce((a, r) => a + Number(r.committed_amount || 0), 0);
    console.log('\n── Resultat ──');
    chk.forEach(r => console.log(`  ${r.name}: ${r.committed_amount} MNOK`));
    console.log(`  SUM: ${sum.toFixed(2)} MNOK (forventet 22.05)`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
