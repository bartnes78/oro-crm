const https    = require('https');
const cron     = require('node-cron');
const express  = require('express');
const { query, pool } = require('../db');
const { auditLog, validationError } = require('../lib/helpers');

const router = express.Router();

// ── Hjelpefunksjoner ──────────────────────────────────────────────────────────

function brregGet(path) {
  return new Promise((resolve, reject) => {
    const url = `https://data.brreg.no/enhetsregisteret/api${path}`;
    const req = https.get(url, { headers: { Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Brreg timeout')); });
  });
}

// Regnskapsregisteret ligger på egen base og gir tomt/404 for ikke-regnskapspliktige
// enheter — derfor egen henter som alltid resolver (aldri reject) med en array.
function brregRegnskapGet(orgnr) {
  return new Promise(resolve => {
    const url = `https://data.brreg.no/regnskapsregisteret/regnskap/${orgnr}`;
    const req = https.get(url, { headers: { Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: Array.isArray(parsed) ? parsed : [] });
        } catch { resolve({ status: res.statusCode, body: [] }); }
      });
    });
    req.on('error', () => resolve({ status: 0, body: [] }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, body: [] }); });
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

function parseRoller(rollerBody, skipSet = SKIP_ROLLER) {
  const roller = [];
  for (const rg of (rollerBody.rollegrupper || [])) {
    if (skipSet.has(rg.type?.kode)) continue;
    for (const rolle of (rg.roller || [])) {
      if (rolle.fratredelsesdato) continue;
      const p = rolle.person || rolle.enhet;
      if (!p) continue;
      const navn = p.navn
        ? `${p.navn.fornavn || ''} ${p.navn.mellomnavn ? p.navn.mellomnavn + ' ' : ''}${p.navn.etternavn || ''}`.trim()
        : null;
      if (!navn) continue;
      roller.push({
        gruppe: rg.type?.beskrivelse || rg.type?.kode || '',
        type:   rolle.type?.beskrivelse || rg.type?.beskrivelse || '',
        navn,
      });
    }
  }
  return roller;
}

function parseRegnskap(body) {
  if (!Array.isArray(body) || body.length === 0) return null;
  const aar = body.map(r => ({
    aar:          (r.regnskapsperiode?.tilDato || '').slice(0, 4),
    valuta:       r.valuta || 'NOK',
    aarsresultat: r.resultatregnskapResultat?.aarsresultat        ?? null,
    egenkapital:  r.egenkapitalGjeld?.egenkapital?.sumEgenkapital  ?? null,
    sumEiendeler: r.eiendeler?.sumEiendeler                        ?? null,
    sumGjeld:     r.egenkapitalGjeld?.gjeldOversikt?.sumGjeld      ?? null,
  }))
    .filter(y => y.aar)
    .sort((a, b) => b.aar.localeCompare(a.aar))
    .slice(0, 5);
  if (aar.length === 0) return null;
  return { valuta: aar[0].valuta, aar };
}

// ── Ruter ─────────────────────────────────────────────────────────────────────

router.get('/api/brreg/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const { body } = await brregGet(`/enheter?navn=${encodeURIComponent(q)}&size=10`);
    const enheter = body._embedded?.enheter || [];
    res.json(enheter.map(e => ({
      orgnr:    e.organisasjonsnummer,
      navn:     e.navn,
      orgform:  e.organisasjonsform?.beskrivelse || null,
      poststed: e.forretningsadresse?.poststed   || e.postadresse?.poststed || null,
      slettet:  !!e.slettedato,
    })));
  } catch (e) {
    res.status(502).json({ error: 'Brreg utilgjengelig: ' + e.message });
  }
});

router.get('/api/brreg/enhet/:orgnr', async (req, res) => {
  const orgnr = req.params.orgnr.replace(/\s/g, '');
  if (!/^\d{9}$/.test(orgnr)) return res.status(400).json({ error: 'Ugyldig org.nr (må være 9 siffer)' });
  try {
    const [{ status, body: e }, { body: rollerBody }] = await Promise.all([
      brregGet(`/enheter/${orgnr}`),
      brregGet(`/enheter/${orgnr}/roller`),
    ]);
    if (status === 404) return res.status(404).json({ error: 'Fant ikke org.nr i Brreg' });

    res.json({
      orgnr,
      navn:         e.navn,
      orgform:      e.organisasjonsform?.beskrivelse || null,
      naeringskode: e.naeringskode1?.beskrivelse     || null,
      stiftet:      e.stiftelsesdato                 || null,
      ansatte:      e.antallAnsatte                  ?? null,
      adresser:     parseAdresser(e),
      roller:       parseRoller(rollerBody),
    });
  } catch (e) {
    res.status(502).json({ error: 'Brreg utilgjengelig: ' + e.message });
  }
});

router.post('/api/investors/:id/brreg-sync', async (req, res) => {
  const { org_nr, city } = req.body;
  const orgnr = (org_nr || '').replace(/\s/g, '');
  if (!/^\d{9}$/.test(orgnr)) return validationError(res, ['Ugyldig org.nr (må være 9 siffer)']);

  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM investors WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Investor ikke funnet' });

    const { rows: existing } = await client.query('SELECT id FROM investors WHERE org_nr=$1 AND id<>$2', [orgnr, req.params.id]);
    if (existing.length) return validationError(res, [`Org.nr ${orgnr} er allerede koblet til investor ${existing[0].id}`]);

    const [{ status, body: e }, { body: rollerBody }, { body: regnskapBody }] = await Promise.all([
      brregGet(`/enheter/${orgnr}`),
      brregGet(`/enheter/${orgnr}/roller`),
      brregRegnskapGet(orgnr),
    ]);
    if (status === 404) return res.status(404).json({ error: 'Fant ikke org.nr i Brreg' });

    const adresser = parseAdresser(e);
    const roller   = parseRoller(rollerBody);

    const brregData = {
      orgform:      e.organisasjonsform?.beskrivelse || null,
      naeringskode: e.naeringskode1?.beskrivelse     || null,
      stiftet:      e.stiftelsesdato                 || null,
      ansatte:      e.antallAnsatte                  ?? null,
      adresser,
      roller,
      regnskap:     parseRegnskap(regnskapBody),
      synced_at:    new Date().toISOString(),
    };

    await client.query('BEGIN');
    await client.query(
      `UPDATE investors SET org_nr=$2, brreg_navn=$3, brreg_data=$4, city=COALESCE($5, city), updated_at=NOW() WHERE id=$1`,
      [req.params.id, orgnr, e.navn, JSON.stringify(brregData), city || null]
    );
    await client.query('COMMIT');

    await auditLog(req.currentUser._id, req.currentUser.username, 'update', 'investor', req.params.id,
      { org_nr: null }, { org_nr: orgnr, brreg_navn: e.navn },
      `Koblet Brreg org.nr ${orgnr} til investor`);

    res.json({ ok: true, brreg_navn: e.navn, adresser, roller });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /investors/:id/brreg-sync]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.delete('/api/investors/:id/brreg-sync', async (req, res) => {
  try {
    const { rows } = await query('SELECT org_nr FROM investors WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Investor ikke funnet' });
    const oldOrgNr = rows[0].org_nr;

    await query(
      `UPDATE investors SET org_nr=NULL, brreg_navn=NULL, brreg_data='{}', updated_at=NOW() WHERE id=$1`,
      [req.params.id]
    );

    await auditLog(req.currentUser._id, req.currentUser.username, 'update', 'investor', req.params.id,
      { org_nr: oldOrgNr }, { org_nr: null },
      `Fjernet Brreg-kobling (org.nr ${oldOrgNr})`);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Ukentlig synkronisering ───────────────────────────────────────────────────

async function brregSyncAll(opts = {}) {
  const where = opts.onlyMissingRegnskap
    ? `org_nr IS NOT NULL AND deleted_at IS NULL AND NOT (brreg_data ? 'regnskap')`
    : `org_nr IS NOT NULL AND deleted_at IS NULL`;
  const { rows: investors } = await query(`SELECT id FROM investors WHERE ${where}`);
  if (investors.length === 0) return;

  console.log(`[brreg-sync] Starter ukentlig synk for ${investors.length} investorer`);
  let oppdatert = 0, feilet = 0;

  for (const { id } of investors) {
    try {
      const { rows } = await query('SELECT org_nr FROM investors WHERE id=$1', [id]);
      const orgnr = rows[0]?.org_nr;
      if (!orgnr) continue;

      const [{ status, body: e }, { body: rollerBody }, { body: regnskapBody }] = await Promise.all([
        brregGet(`/enheter/${orgnr}`),
        brregGet(`/enheter/${orgnr}/roller`),
        brregRegnskapGet(orgnr),
      ]);
      if (status !== 200) { feilet++; continue; }

      const brregData = {
        orgform:      e.organisasjonsform?.beskrivelse || null,
        naeringskode: e.naeringskode1?.beskrivelse     || null,
        stiftet:      e.stiftelsesdato                 || null,
        ansatte:      e.antallAnsatte                  ?? null,
        adresser:     parseAdresser(e),
        roller:       parseRoller(rollerBody),
        regnskap:     parseRegnskap(regnskapBody),
        synced_at:    new Date().toISOString(),
      };

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE investors SET brreg_navn=$2, brreg_data=$3, updated_at=NOW() WHERE id=$1`,
          [id, e.navn, JSON.stringify(brregData)]
        );
        await client.query('COMMIT');
        oppdatert++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[brreg-sync] Feil ved ${id}:`, err.message);
        feilet++;
      } finally {
        client.release();
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[brreg-sync] Feil ved ${id}:`, err.message);
      feilet++;
    }
  }

  console.log(`[brreg-sync] Ferdig — ${oppdatert} oppdatert, ${feilet} feilet`);
}

cron.schedule('0 3 * * 1', () => {
  brregSyncAll().catch(e => console.error('[brreg-sync] Uventet feil:', e.message));
}, { timezone: 'Europe/Oslo' });

router.brregSyncAll = brregSyncAll;
module.exports = router;
