// Engangsimport: nytt prosjekt "ORO Breivollbyen" (Oro 37 AS, styrevedtak 26.11.2024).
// 10 tegnere, aksjeklasse A, kurs NOK 263,00. committed (MNOK) = antall aksjer * 263 / 1e6.
// Tegnet investor lagres som committed = target_ticket, probability = 1 (samme som Etablert-prosjekter).
// Idempotent: produkt matches på navn, investorer på id/navn/org.nr, koblinger via ON CONFLICT.
const https = require('https');
const { pool } = require('../db.js');

// ── Brreg-hjelpere (speiler routes/brreg.js) ───────────────────────────────────
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
const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
async function brregLookupByName(name) {
  const { body } = await brregGet(`/enheter?navn=${encodeURIComponent(name)}&size=10`);
  const enheter = (body._embedded?.enheter || []).filter(e => !e.slettedato);
  const exactHit = enheter.find(e => norm(e.navn) === norm(name));
  if (!exactHit) return { exact: false, candidates: enheter.slice(0, 5).map(e => `${e.organisasjonsnummer} ${e.navn}`) };
  const orgnr = exactHit.organisasjonsnummer;
  const [{ body: e }, { body: rb }] = await Promise.all([brregGet(`/enheter/${orgnr}`), brregGet(`/enheter/${orgnr}/roller`)]);
  return {
    exact: true, orgnr, navn: e.navn,
    city: e.forretningsadresse?.poststed || e.postadresse?.poststed || null,
    brregData: {
      orgform: e.organisasjonsform?.beskrivelse || null, naeringskode: e.naeringskode1?.beskrivelse || null,
      stiftet: e.stiftelsesdato || null, ansatte: e.antallAnsatte ?? null,
      adresser: parseAdresser(e), roller: parseRoller(rb), synced_at: new Date().toISOString(),
    },
  };
}

// ── Data fra styreprotokoll Oro 37 + Vedlegg 1 ─────────────────────────────────
const KURS = 263.0;
const PRODUCT = {
  name: 'ORO Breivollbyen',
  type: 'Prosjekt',
  status: 'Aktiv',
  target_size: 257.74, // 980 000 * 263 / 1e6
  established_date: '2024-11-26',
  description: 'Kapitalforhøyelse for erverv av Breivollbyen Eiendom AS (org.nr 934 536 851). 980 000 A-aksjer à kurs NOK 263,00 (overkurs 261,00).',
};
// shares -> committed beregnes som shares*263/1e6
const SUBSCRIBERS = [
  { name: 'Annima AS',                     shares: 78044,  existingId: 'INV-640' },
  { name: 'AS Straen',                     shares: 200000, existingId: 'INV-731' },
  { name: 'Havtor Eiendom AS',             shares: 100001, existingId: 'INV-728' },
  { name: 'Industrifinans Eiendomsfond AS', shares: 139734, create: true },
  { name: 'JAG HOLDING AS',                shares: 38022,  existingId: 'INV-616' },
  { name: 'K11 Investor AS',               shares: 115000, existingId: 'INV-317' },
  { name: 'KGJ Real Estate AS',            shares: 200000, existingId: 'INV-319' },
  { name: 'Laho AS',                       shares: 40000,  existingId: 'INV-340' },
  { name: 'Procerta AS',                   shares: 60000,  create: true },
  { name: 'Real Value AS',                 shares: 9199,   existingId: 'INV-727' },
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

    // 1) Produkt
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

    // 2) Tegnere
    for (const s of SUBSCRIBERS) {
      const committed = Math.round(s.shares * KURS) / 1e6; // NOK heltall -> MNOK
      let invId = s.existingId || null;

      if (!invId && s.create) {
        const { rows: ex } = await client.query('SELECT id FROM investors WHERE name ILIKE $1 AND deleted_at IS NULL', [s.name]);
        if (ex.length) { invId = ex[0].id; console.log(`  Tegner finnes allerede: ${s.name} (${invId})`); }
        else {
          let br = null;
          try { br = await brregLookupByName(s.name); } catch (e) { console.log(`  Brreg-feil for ${s.name}: ${e.message}`); }
          if (br && !br.exact) console.log(`  ⚠ Ingen eksakt Brreg-treff for "${s.name}" — opprettes uten org.nr. Kandidater: ${(br.candidates || []).join(' | ') || 'ingen'}`);
          if (br?.orgnr) {
            const { rows: dup } = await client.query('SELECT id, name FROM investors WHERE org_nr=$1', [br.orgnr]);
            if (dup.length) { invId = dup[0].id; console.log(`  Org.nr ${br.orgnr} finnes på ${dup[0].name} (${invId}) — gjenbruker`); }
          }
          if (!invId) {
            const { rows: last } = await client.query(`SELECT id FROM investors WHERE id ~ '^INV-\\d+$' ORDER BY CAST(SUBSTRING(id FROM 5) AS INTEGER) DESC LIMIT 1`);
            const maxNum = last.length ? parseInt(last[0].id.slice(4)) : 0;
            invId = 'INV-' + String(maxNum + 1).padStart(3, '0');
            await client.query(
              `INSERT INTO investors (id, name, country, city, phase, org_nr, brreg_navn, brreg_data, updated_at)
               VALUES ($1,$2,'Norge',$3,'Investor',$4,$5,$6,NOW())`,
              [invId, s.name, br?.exact ? br.city : null, br?.exact ? br.orgnr : null, br?.exact ? br.navn : null, JSON.stringify(br?.exact ? br.brregData : {})]);
            await audit(client, 'create', 'investor', invId, null, { name: s.name, phase: 'Investor', org_nr: br?.exact ? br.orgnr : null },
              `Importerte tegner fra Oro 37-emisjon: ${s.name}${br?.exact ? ' (org.nr ' + br.orgnr + ')' : ' — uten org.nr'}`);
            console.log(`  Opprettet tegner: ${s.name} (${invId})${br?.exact ? ' org.nr ' + br.orgnr : ' — uten org.nr'}`);
          }
        }
      }

      // Fase → Investor hvis ikke allerede
      const { rows: inv } = await client.query('SELECT phase FROM investors WHERE id=$1 AND deleted_at IS NULL', [invId]);
      if (!inv.length) throw new Error(`Investor ${invId} (${s.name}) finnes ikke`);
      if (inv[0].phase !== 'Investor') {
        await client.query("UPDATE investors SET phase='Investor', updated_at=NOW() WHERE id=$1", [invId]);
        await audit(client, 'update', 'investor', invId, { phase: inv[0].phase }, { phase: 'Investor' }, `Fase ${inv[0].phase} → Investor (tegnet i ${PRODUCT.name})`);
        console.log(`  Fase ${s.name} (${invId}): ${inv[0].phase} → Investor`);
      }

      // Kobling: committed = ticket, probability 1
      await client.query(
        `INSERT INTO product_investors (product_id, investor_id, committed_amount, target_ticket, probability)
         VALUES ($1,$2,$3,$3,1)
         ON CONFLICT (product_id, investor_id) DO UPDATE
           SET committed_amount = EXCLUDED.committed_amount, target_ticket = EXCLUDED.target_ticket, probability = EXCLUDED.probability`,
        [productId, invId, committed]);
      await audit(client, 'update', 'product_investor', `${productId}:${invId}`, null, { committed_amount: committed, target_ticket: committed, probability: 1 },
        `Tegning ${PRODUCT.name}: ${s.name} = ${s.shares} aksjer × ${KURS} = ${committed} MNOK`);
      console.log(`  Koblet ${s.name} (${invId}) → ${s.shares} aksjer → ${committed} MNOK`);
    }

    await client.query('COMMIT');

    const { rows: chk } = await client.query(
      `SELECT i.name, i.phase, pi.committed_amount c, pi.target_ticket t, pi.probability p
       FROM product_investors pi JOIN investors i ON i.id = pi.investor_id
       WHERE pi.product_id = $1 ORDER BY pi.committed_amount DESC`, [productId]);
    const sum = chk.reduce((a, r) => a + Number(r.c || 0), 0);
    console.log('\n── Resultat ──');
    chk.forEach(r => console.log(`  ${r.name} [${r.phase}]: committed=${r.c} ticket=${r.t} prob=${r.p}`));
    console.log(`  SUM committed: ${sum.toFixed(2)} MNOK (forventet 257.74)`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
