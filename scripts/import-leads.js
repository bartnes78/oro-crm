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

const DUP_THRESHOLD  = 0.6;              // samme terskel som duplikat-sveipet i UI
const AUTO_MERGE_THRESHOLD = 0.9;       // sikkert nok til å legge kilde-tag på eksisterende automatisk

// Provenans-metadata per batch. Overstyres med flagg (se bruk øverst), f.eks.
//   --batch=fbn-2026-09-07 --kilde-dato=2026-09-07 --inntektsaar=
// Standardverdiene bevarer opprinnelig Finansavisen-batch.
function argVal(args, name, fallback) {
  const p = args.find(a => a.startsWith(`--${name}=`));
  return p !== undefined ? p.slice(name.length + 3) : fallback;
}

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
  const includeDups = args.includes('--include-dups');  // ta inn ALLE, flagg duplikater for manuell verifisering
  const BATCH = argVal(args, 'batch', 'finansavisen-2026-07-25');
  const KILDE_DATO = argVal(args, 'kilde-dato', '2026-07-25');
  const inntektsaarRaw = argVal(args, 'inntektsaar', '2025');
  const INNTEKTSAAR = inntektsaarRaw ? parseInt(inntektsaarRaw) : null;
  // Kilde-tag for hele batchen (f.eks. "K400 2025"). Faller tilbake til per-rad kilde.
  const TAG = argVal(args, 'tag', null);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('Mangler CSV-sti.'); process.exit(1); }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) { console.error(`Fant ikke fil: ${abs}`); process.exit(1); }

  const leads = toObjects(parseCsv(fs.readFileSync(abs, 'utf8')));
  console.log(`\nLest ${leads.length} leads fra ${path.relative(process.cwd(), abs)}`);
  console.log(commit ? 'MODUS: --commit (skriver til databasen)\n' : 'MODUS: dry-run (ingen skriv — bruk --commit for å skrive)\n');

  // Alle eksisterende (leads OG kvalifiserte) for dedup + overlapp-håndtering.
  const { rows: existing } = await query(
    'SELECT id, name, org_nr, is_lead, tags, discarded_at FROM investors WHERE deleted_at IS NULL'
  );
  const existingNorm = existing.map(e => ({ ...e, norm: normalizeName(e.name) }));

  function topDuplicate(name) {
    const norm = normalizeName(name);
    let best = null;
    for (const e of existingNorm) {
      const score = jaccard(norm, e.norm);
      if (!best || score > best.score) best = { id: e.id, name: e.name, score, entry: e };
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
  const tagMerges = [];   // sikre treff: legg kilde-tag på eksisterende i stedet for dublett
  for (const l of leads) {
    const name = (l.investor_name || '').trim();
    if (!name) continue;
    const tag = TAG || blankToNull(l.kilde);
    const dup = topDuplicate(name);
    const isSure = dup && dup.score >= AUTO_MERGE_THRESHOLD;
    const isDup  = dup && dup.score >= DUP_THRESHOLD;

    // Sikkert treff (nær identisk navn): union kilde-tag på eksisterende, ingen dublett.
    if (isSure && tag) {
      const alreadyTagged = Array.isArray(dup.entry.tags) && dup.entry.tags.some(t => t.toLowerCase() === tag.toLowerCase());
      const wasDiscarded = !!dup.entry.discarded_at;
      tagMerges.push({ id: dup.id, name: dup.name, tag, alreadyTagged, wasDiscarded, isLead: dup.entry.is_lead, score: dup.score });
      continue;
    }
    // Usikkert treff (0.6–0.9): flagg for manuell merge (som før).
    if (isDup && !includeDups) {
      skipped.push({ name, dup });
      continue;
    }
    const contacts = (l.contact_persons || '').split(';').map(s => s.trim()).filter(Boolean);
    const finansinntekt = l.finansinntekt_mnok ? parseFloat(l.finansinntekt_mnok) : null;
    const provenance = { kilde: l.kilde || null, dato: KILDE_DATO, batch: BATCH, importert_dato: new Date().toISOString().slice(0, 10) };
    if (finansinntekt != null && INNTEKTSAAR != null) provenance.inntektsaar_finansinntekt = INNTEKTSAAR;
    // Flagg mulige duplikater i selve leadet slik at de kan verifiseres/merges manuelt.
    let redFlags = blankToNull(l.red_flags);
    if (isDup) {
      const note = `Mulig duplikat av ${dup.name} (${dup.id}, ${Math.round(dup.score * 100)}%) — verifiser/merge`;
      redFlags = redFlags ? `${redFlags}; ${note}` : note;
      provenance.mulig_duplikat = { id: dup.id, name: dup.name, score: Math.round(dup.score * 100) };
    }
    toInsert.push({
      id: 'INV-' + String(nextNum++).padStart(3, '0'),
      name,
      city:              blankToNull(l.lokasjon),
      finansinntekt,
      kapitalkilde:      blankToNull(l.kapitalkilde),
      relevans:          blankToNull(l.relevans),
      next_steps:        blankToNull(l.neste_steg),
      comments:          buildComments(blankToNull(l.profil), redFlags),
      source:            blankToNull(l.kilde),
      provenance,
      contacts,
      tags:              tag ? [tag] : [],
      dupNote:           dup ? `${dup.name} (${Math.round(dup.score * 100)}%)` : null,
    });
  }

  // Rapport
  console.log(`Kilde-tag: ${TAG ? `"${TAG}" (fast for batch)` : '(per rad, fra kilde-kolonnen)'}`);
  for (const r of toInsert) {
    const inntekt = r.finansinntekt != null ? `${r.finansinntekt} mNOK` : '—';
    const tagStr = r.tags.length ? `  #${r.tags.join(',#')}` : '';
    console.log(`  ${r.id}  ${r.name.padEnd(22)} inntekt=${inntekt.padEnd(11)} kontakter=${r.contacts.length}${tagStr}` +
      (r.dupNote ? `  ~ligner: ${r.dupNote}` : ''));
    r.contacts.forEach(c => console.log(`         · ${c}`));
  }
  if (tagMerges.length) {
    console.log(`\n${tagMerges.length} sikkert treff → kilde-tag legges på eksisterende (ingen dublett):`);
    tagMerges.forEach(m => console.log(
      `  ↳ ${m.name} (${m.id}, ${Math.round(m.score * 100)}%${m.isLead ? ', lead' : ''})  +#${m.tag}` +
      (m.alreadyTagged ? '  [har taggen alt — hopper over]' : m.wasDiscarded ? '  [re-surfaces fra forkastet]' : '')));
  }
  if (skipped.length) {
    console.log(`\n${skipped.length} rad(er) HOPPET OVER (usikkert duplikat ${Math.round(DUP_THRESHOLD * 100)}–${Math.round(AUTO_MERGE_THRESHOLD * 100)}% mot eksisterende):`);
    skipped.forEach(s => console.log(`  ✗ ${s.name}  →  ${s.dup.name} (${Math.round(s.dup.score * 100)}%)  [vurder merge manuelt]`));
  }
  const tagUpdates = tagMerges.filter(m => !m.alreadyTagged);
  console.log(`\nOppsummering: ${toInsert.length} settes inn, ${tagUpdates.length} får kilde-tag, ${skipped.length} hoppes over.`);

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
           next_steps, comments, source, provenance, tags, updated_at)
        VALUES ($1,$2,'Norge',$3,'Prospekt',TRUE,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      `, [r.id, r.name, r.city, r.finansinntekt, r.kapitalkilde, r.relevans,
          r.next_steps, r.comments, r.source, JSON.stringify(r.provenance), JSON.stringify(r.tags)]);
      for (let i = 0; i < r.contacts.length; i++) {
        await client.query(
          `INSERT INTO contacts (investor_id, name, is_primary, source) VALUES ($1,$2,$3,'lead-import')`,
          [r.id, r.contacts[i], i === 0 ? 1 : 0]
        );
      }
    }
    // Union kilde-tag på sikre treff (idempotent: @> hopper over hvis taggen finnes).
    for (const m of tagUpdates) {
      // Nytt kilde-treff => union tag, og re-surface hvis leadet var forkastet.
      await client.query(
        `UPDATE investors
         SET tags = CASE WHEN tags @> $2 THEN tags ELSE COALESCE(tags,'[]'::jsonb) || $2 END,
             discarded_at = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [m.id, JSON.stringify([m.tag])]
      );
    }
    await client.query('COMMIT');
    console.log(`\n[ok] Satt inn ${toInsert.length} leads, la kilde-tag på ${tagUpdates.length} eksisterende.\n`);
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
