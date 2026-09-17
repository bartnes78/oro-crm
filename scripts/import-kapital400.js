// Importer Kapital 400-kartlegging som TAG + strukturert meta.
//   - Tag ("K400 <år>") = medlemskap (filter/pills, som resten av lead-taggene).
//   - list_meta[tag] = per-liste meta {personer:[{rank,person,formue_mrd,bransje}]}
//     for år-mot-år-sammenligning. Én JSONB-kolonne, ingen kategori-tabeller.
//
// Bruk:
//   node scripts/import-kapital400.js <import.json>                 (dry-run)
//   node scripts/import-kapital400.js <import.json> --apply         (skriver)
//   node scripts/import-kapital400.js <import.json> --tag="K400 2025"
//
// Dry-run er default. --apply skriver i én transaksjon og er idempotent
// (tag-union + jsonb_set + navne-dedup hindrer nye rader ved ny kjøring).
// Persondata skrives ALDRI til repoet: input leses fra angitt sti, rapport
// legges ved siden av input-fila.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../db');
const { normalizeName, jaccard, auditLog } = require('../lib/helpers');

const DUP_THRESHOLD = 0.6;
const AUTO_MERGE_THRESHOLD = 0.9;

function argVal(args, name, fallback) {
  const p = args.find(a => a.startsWith(`--${name}=`));
  return p !== undefined ? p.slice(name.length + 3) : fallback;
}

async function run() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('Mangler sti til import-JSON.'); process.exit(1); }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) { console.error(`Fant ikke fil: ${abs}`); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));

  const YEAR  = data.year || argVal(args, 'year', null);
  const TAG   = argVal(args, 'tag', null) || (YEAR ? `K400 ${YEAR}` : data.category);
  const KILDE = data.source || data.category || TAG;
  const BATCH = data.batch || (YEAR ? `kapital400-${YEAR}` : 'kapital400');
  const IMPORT_DATO = new Date().toISOString().slice(0, 10);
  const tagExisting = data.tag_existing || [];
  const newLeads = data.new_leads || [];

  console.log(`\nKapital 400-import  ·  tag="${TAG}"  ·  kilde="${KILDE}"  ·  batch=${BATCH}`);
  console.log(apply ? 'MODUS: --apply (skriver til databasen)\n' : 'MODUS: dry-run (ingen skriv — bruk --apply)\n');

  const { rows: existing } = await query(
    'SELECT id, name, org_nr, tags, discarded_at FROM investors WHERE deleted_at IS NULL'
  );
  const byId = Object.fromEntries(existing.map(e => [e.id, e]));
  const norm = existing.map(e => ({ ...e, n: normalizeName(e.name) }));
  const hasTag = e => Array.isArray(e.tags) && e.tags.some(t => t.toLowerCase() === TAG.toLowerCase());

  function topDuplicate(name) {
    const nn = normalizeName(name);
    let best = null;
    for (const e of norm) {
      const score = jaccard(nn, e.n);
      if (!best || score > best.score) best = { id: e.id, name: e.name, score, entry: e };
    }
    return best && best.score > 0 ? best : null;
  }

  const { rows: last } = await query(
    `SELECT id FROM investors WHERE id ~ '^INV-\\d+$' ORDER BY CAST(SUBSTRING(id FROM 5) AS INTEGER) DESC LIMIT 1`
  );
  let nextNum = last.length ? parseInt(last[0].id.slice(4)) + 1 : 1;

  // ── Fase A: tag_existing (eksakt id) ──────────────────────────────────────────
  const tagById = [];
  const missingIds = [];
  for (const item of tagExisting) {
    const e = byId[item.investor_id];
    if (!e) { missingIds.push(item.investor_id); continue; }
    tagById.push({ id: e.id, name: e.name, wasDiscarded: !!e.discarded_at, alreadyTagged: hasTag(e), meta: item.meta || {} });
  }

  // ── Fase B: new_leads (navne-dedup) ───────────────────────────────────────────
  const toInsert = [];
  const newLeadUnions = [];
  const candidates = [];
  const weakMatches = [];   // 0.4–0.6: opprettes likevel, kun til info (manuell vurdering)
  for (const l of newLeads) {
    const name = (l.name || '').trim();
    if (!name) continue;
    const dup = topDuplicate(name);
    if (dup && dup.score >= AUTO_MERGE_THRESHOLD) {
      newLeadUnions.push({ id: dup.id, name: dup.name, score: Math.round(dup.score * 100), wasDiscarded: !!dup.entry.discarded_at, alreadyTagged: hasTag(dup.entry), meta: l.meta || {} });
      continue;
    }
    if (dup && dup.score >= DUP_THRESHOLD) {
      candidates.push({ name, matchId: dup.id, matchName: dup.name, score: Math.round(dup.score * 100) });
      continue;
    }
    if (dup && dup.score >= 0.4) weakMatches.push({ name, matchId: dup.id, matchName: dup.name, score: Math.round(dup.score * 100) });
    toInsert.push({ id: 'INV-' + String(nextNum++).padStart(3, '0'), lead: l });
  }

  // ── Rapport ───────────────────────────────────────────────────────────────────
  const allUnions = [...tagById, ...newLeadUnions];
  const resurfacing = allUnions.filter(u => u.wasDiscarded);
  console.log(`Fase A — ${tagExisting.length} tag_existing:`);
  console.log(`  ${tagById.filter(t => !t.alreadyTagged).length} får tag+meta, ${tagById.filter(t => t.alreadyTagged).length} har taggen alt, ${missingIds.length} mangler i CRM`);
  if (missingIds.length) console.log(`  Mangler: ${missingIds.join(', ')}`);
  console.log(`\nFase B — ${newLeads.length} new_leads:`);
  console.log(`  ${toInsert.length} nye leads opprettes`);
  console.log(`  ${newLeadUnions.length} sikre treff mot eksisterende → tag+meta (ingen dublett)`);
  console.log(`  ${candidates.length} mulige duplikater (${Math.round(DUP_THRESHOLD * 100)}–${Math.round(AUTO_MERGE_THRESHOLD * 100)}%) — RAPPORTERES, ikke opprettet:`);
  candidates.forEach(c => console.log(`    ? ${c.name}  ~  ${c.matchName} (${c.matchId}, ${c.score}%)`));
  if (weakMatches.length) {
    console.log(`\n  ${weakMatches.length} svake treff (40–60%) — opprettes, men verdt et manuelt blikk:`);
    weakMatches.forEach(w => console.log(`    ~ ${w.name}  ~  ${w.matchName} (${w.matchId}, ${w.score}%)`));
  }
  if (resurfacing.length) console.log(`\n  ${resurfacing.length} forkastede re-surfacer: ${resurfacing.map(r => r.id).join(', ')}`);
  console.log(`\nOppsummering: ${tagById.filter(t => !t.alreadyTagged).length + newLeadUnions.length} eksisterende får tag, ${toInsert.length} nye leads, ${candidates.length} flagget, ${missingIds.length} manglende id.`);

  const report = {
    tag: TAG, kilde: KILDE, batch: BATCH, importert_dato: IMPORT_DATO, dry_run: !apply,
    counts: { tag_existing: tagById.length, new_inserted: toInsert.length, new_unions: newLeadUnions.length, duplicate_candidates: candidates.length, missing_ids: missingIds.length, resurfaced: resurfacing.length },
    duplicate_candidates: candidates,
    weak_matches: weakMatches,
    missing_ids: missingIds,
    inserted: toInsert.map(t => ({ id: t.id, name: t.lead.name })),
    unions: allUnions.map(u => ({ id: u.id, name: u.name })),
  };
  const reportPath = path.join(path.dirname(abs), `import_report_kapital400_${YEAR || 'x'}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nRapport skrevet: ${reportPath}`);

  if (!apply) { console.log('\nDry-run ferdig. Kjør på nytt med --apply for å skrive.\n'); process.exit(0); }

  // ── Skriv ───────────────────────────────────────────────────────────────────
  const tagArr = JSON.stringify([TAG]);
  const setTagMeta = async (client, id, meta) => client.query(
    `UPDATE investors
     SET tags = CASE WHEN tags @> $2 THEN tags ELSE COALESCE(tags,'[]'::jsonb) || $2 END,
         list_meta = jsonb_set(COALESCE(list_meta,'{}'::jsonb), $3::text[], $4::jsonb, true),
         discarded_at = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [id, tagArr, [TAG], JSON.stringify(meta || {})]
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of allUnions) await setTagMeta(client, u.id, u.meta);
    for (const { id, lead } of toInsert) {
      await client.query(
        `INSERT INTO investors
           (id, name, country, phase, is_lead, source, next_steps, comments, provenance, tags, list_meta, updated_at)
         VALUES ($1,$2,$3,'Prospekt',TRUE,$4,$5,$6,$7,$8,$9,NOW())`,
        [id, lead.name, lead.country || 'Norge', KILDE, lead.next_steps || null, lead.comments || null,
         JSON.stringify({ batch: BATCH, kilde: KILDE, importert_dato: IMPORT_DATO }),
         tagArr, JSON.stringify({ [TAG]: lead.meta || {} })]
      );
      const contacts = lead.contacts || [];
      for (let i = 0; i < contacts.length; i++) {
        await client.query(
          `INSERT INTO contacts (investor_id, name, title, is_primary, source) VALUES ($1,$2,$3,$4,'kapital400-import')`,
          [id, contacts[i].name, contacts[i].title || null, i === 0 ? 1 : 0]
        );
      }
    }
    await client.query('COMMIT');
    await auditLog(null, 'import-kapital400', 'import', 'investor', TAG, null,
      { tagged: allUnions.length, inserted: toInsert.length }, `Kapital 400-import: ${allUnions.length} tagget, ${toInsert.length} nye leads (${TAG})`);
    console.log(`\n[ok] ${allUnions.length} eksisterende tagget, ${toInsert.length} nye leads opprettet.\n`);
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
