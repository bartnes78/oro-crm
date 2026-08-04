// Importer rå leads fra en renset CSV til investors som staging (is_lead=TRUE,
// phase='Prospekt'). Leads skjules fra operative visninger til de promoteres
// (PUT med is_lead:false).
//
// Bruk:
//   node scripts/import-leads.js data/leads/finansavisen-2026-07-25.clean.csv           (dry-run)
//   node scripts/import-leads.js data/leads/finansavisen-2026-07-25.clean.csv --commit   (skriver)
//
// Dry-run (default): parser CSV, kjører dedup-forhåndssjekk mot eksisterende
// investorer (samme normalizeName/jaccard som /api/duplicates) og skriver ut
// nøyaktig hva som VILLE blitt satt inn. Ingen skriv uten --commit.
//
// Rader med et duplikattreff >= DUP_THRESHOLD settes ikke inn — de rapporteres
// for manuell vurdering (merge finnes allerede i UI-et).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../db');
const { normalizeName, jaccard } = require('../lib/helpers');

const DUP_THRESHOLD = 0.6;               // samme terskel som duplikat-sveipet i UI
const BATCH = 'finansavisen-2026-07-25';
const KILDE_DATO = '2026-07-25';
const INNTEKTSAAR = 2025;

// Minimal, sitattbevisst CSV-parser (håndterer "felt, med komma" og "" -> ").
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow   = () => { if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') { pushField(); pushRow(); }
    else if (c === '\r') { /* ignore */ }
    else field += c;
  }
  if (field !== '' || row.length) { pushField(); pushRow(); }
  return rows;
}

function toObjects(rows) {
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(cols => {
    const o = {};
    header.forEach((h, i) => { o[h] = (cols[i] ?? '').trim(); });
    return o;
  });
}

function blankToNull(s) { return s && s.length ? s : null; }

function buildComments(profil, redFlags) {
  const parts = [];
  if (profil)   parts.push(profil);
  if (redFlags) parts.push('⚑ ' + redFlags);
  return parts.length ? parts.join('\n') : null;
}

async function run() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('Mangler CSV-sti.'); process.exit(1); }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) { console.error(`Fant ikke fil: ${abs}`); process.exit(1); }

  const leads = toObjects(parseCsv(fs.readFileSync(abs, 'utf8')));
  console.log(`\nLest ${leads.length} leads fra ${path.relative(process.cwd(), abs)}`);
  console.log(commit ? 'MODUS: --commit (skriver til databasen)\n' : 'MODUS: dry-run (ingen skriv — bruk --commit for å skrive)\n');

  // Eksisterende, kvalifiserte investorer for dedup-forhåndssjekk.
  const { rows: existing } = await query(
    'SELECT id, name FROM investors WHERE deleted_at IS NULL AND is_lead IS NOT TRUE'
  );
  const existingNorm = existing.map(e => ({ ...e, norm: normalizeName(e.name) }));

  function topDuplicate(name) {
    const norm = normalizeName(name);
    let best = null;
    for (const e of existingNorm) {
      const score = jaccard(norm, e.norm);
      if (!best || score > best.score) best = { id: e.id, name: e.name, score };
    }
    return best && best.score > 0 ? best : null;
  }

  // Neste ledige INV-id (samme mønster som POST /api/investors).
  const { rows: last } = await query(
    `SELECT id FROM investors WHERE id ~ '^INV-\\d+$' ORDER BY CAST(SUBSTRING(id FROM 5) AS INTEGER) DESC LIMIT 1`
  );
  let nextNum = last.length ? parseInt(last[0].id.slice(4)) + 1 : 1;

  const toInsert = [];
  const skipped = [];
  for (const l of leads) {
    const name = (l.investor_name || '').trim();
    if (!name) continue;
    const dup = topDuplicate(name);
    if (dup && dup.score >= DUP_THRESHOLD) {
      skipped.push({ name, dup });
      continue;
    }
    const contacts = (l.contact_persons || '').split(';').map(s => s.trim()).filter(Boolean);
    toInsert.push({
      id: 'INV-' + String(nextNum++).padStart(3, '0'),
      name,
      city:              blankToNull(l.lokasjon),
      finansinntekt:     l.finansinntekt_mnok ? parseFloat(l.finansinntekt_mnok) : null,
      kapitalkilde:      blankToNull(l.kapitalkilde),
      relevans:          blankToNull(l.relevans),
      next_steps:        blankToNull(l.neste_steg),
      comments:          buildComments(blankToNull(l.profil), blankToNull(l.red_flags)),
      source:            blankToNull(l.kilde),
      provenance:        { kilde: l.kilde || null, dato: KILDE_DATO, inntektsaar_finansinntekt: INNTEKTSAAR, batch: BATCH, importert_dato: new Date().toISOString().slice(0, 10) },
      contacts,
      dupNote:           dup ? `${dup.name} (${Math.round(dup.score * 100)}%)` : null,
    });
  }

  // Rapport
  for (const r of toInsert) {
    const inntekt = r.finansinntekt != null ? `${r.finansinntekt} mNOK` : '—';
    console.log(`  ${r.id}  ${r.name.padEnd(22)} inntekt=${inntekt.padEnd(11)} kontakter=${r.contacts.length}` +
      (r.dupNote ? `  ~ligner: ${r.dupNote}` : ''));
    r.contacts.forEach(c => console.log(`         · ${c}`));
  }
  if (skipped.length) {
    console.log(`\n${skipped.length} rad(er) HOPPET OVER (duplikat >= ${Math.round(DUP_THRESHOLD * 100)}% mot eksisterende investor):`);
    skipped.forEach(s => console.log(`  ✗ ${s.name}  →  ${s.dup.name} (${Math.round(s.dup.score * 100)}%)  [vurder merge manuelt]`));
  }
  console.log(`\nOppsummering: ${toInsert.length} settes inn, ${skipped.length} hoppes over.`);

  if (!commit) {
    console.log('\nDry-run ferdig. Kjør på nytt med --commit for å skrive.\n');
    process.exit(0);
  }

  // Skriv alt i én transaksjon.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of toInsert) {
      await client.query(`
        INSERT INTO investors
          (id, name, country, city, phase, is_lead,
           finansinntekt_mnok, kapitalkilde, relevans_indikativ,
           next_steps, comments, source, provenance, updated_at)
        VALUES ($1,$2,'Norge',$3,'Prospekt',TRUE,$4,$5,$6,$7,$8,$9,$10,NOW())
      `, [r.id, r.name, r.city, r.finansinntekt, r.kapitalkilde, r.relevans,
          r.next_steps, r.comments, r.source, JSON.stringify(r.provenance)]);
      for (let i = 0; i < r.contacts.length; i++) {
        await client.query(
          `INSERT INTO contacts (investor_id, name, is_primary, source) VALUES ($1,$2,$3,'lead-import')`,
          [r.id, r.contacts[i], i === 0 ? 1 : 0]
        );
      }
    }
    await client.query('COMMIT');
    console.log(`\n[ok] Satt inn ${toInsert.length} leads (is_lead=TRUE, phase='Prospekt').\n`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n[feil] Rullet tilbake:', e.message, '\n');
    process.exit(1);
  } finally {
    client.release();
  }
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
