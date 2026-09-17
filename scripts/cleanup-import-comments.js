// Rydder import-generert boilerplate ut av comments (Kommentar-feltet), og flytter
// K400-tall til strukturert list_meta + sikrer at kilde er en tag.
//
//   - "Kapital 400 YYYY: #rang Navn (formue mrd, bransje)"  → list_meta["K400 YYYY"].personer,
//     og linjen fjernes fra comments.
//   - "FBN-medlem (familieeid norsk virksomhet)"            → sikre tag "FBN medlemmer 2026"
//     (fra source), linjen fjernes.
//   - "⚑ Mulig duplikat av X (INV-y, n%) — verifiser/merge" → fjernes (dedup-metadata).
// Egne notater (linjer som ikke matcher mønstrene) beholdes. Tomt resultat → comments=NULL.
//
// Bruk:  node scripts/cleanup-import-comments.js            (dry-run)
//        node scripts/cleanup-import-comments.js --apply    (skriver)

require('dotenv').config();
const { query, pool } = require('../db');

const FBN_TAG = 'FBN medlemmer 2026';

const isK400Line = l => /^Kapital 400 \d{4}\s*:/.test(l);
const isFbnLine  = l => /^FBN-medlem/i.test(l);
const isDupLine  = l => /^⚑?\s*Mulig duplikat av/i.test(l);
const isBoiler   = l => isK400Line(l) || isFbnLine(l) || isDupLine(l);

function parseK400(line) {
  const m = line.match(/^Kapital 400 (\d{4})\s*:\s*(.+)$/);
  if (!m) return null;
  const personer = [];
  const re = /#(\d+)\s+(.+?)\s+\(([\d.]+)\s*mrd,\s*([^)]+)\)/g;
  let pm;
  while ((pm = re.exec(m[2]))) {
    personer.push({ rank: parseInt(pm[1]), person: pm[2].trim(), formue_mrd: parseFloat(pm[3]), bransje: pm[4].trim() });
  }
  return { tag: `K400 ${m[1]}`, personer };
}

async function run() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '\nMODUS: --apply (skriver)\n' : '\nMODUS: dry-run (ingen skriv — bruk --apply)\n');

  const { rows } = await query(`
    SELECT id, name, comments, tags, list_meta, source
    FROM investors
    WHERE deleted_at IS NULL AND comments IS NOT NULL
      AND (comments LIKE 'Kapital 400%' OR comments ILIKE '%FBN-medlem%' OR comments ILIKE '%Mulig duplikat av%')
  `);

  const plan = [];
  for (const r of rows) {
    // Split på linjeskift OG « | » (merge-en slår sammen comments med « | »)
    const lines = String(r.comments).split(/\n| \| /);
    const kept = lines.filter(l => !isBoiler(l.trim()));
    const newComments = kept.join('\n').trim() || null;

    // K400 → list_meta (kun berik når eksisterende år mangler rang)
    let lm = { ...(r.list_meta || {}) };
    let metaChanged = false;
    for (const l of lines) {
      const p = parseK400(l.trim());
      if (!p || !p.personer.length) continue;
      const cur = lm[p.tag];
      const curP = cur && Array.isArray(cur.personer) ? cur.personer : [];
      if (!curP.some(x => x.rank != null)) { lm[p.tag] = { ...(cur || {}), personer: p.personer }; metaChanged = true; }
    }

    // Kilde → tag
    let tags = Array.isArray(r.tags) ? [...r.tags] : [];
    let tagsChanged = false;
    if (/^FBN/i.test(r.source || '') && !tags.some(t => t.toLowerCase() === FBN_TAG.toLowerCase())) {
      tags.push(FBN_TAG); tagsChanged = true;
    }

    const commentsChanged = newComments !== r.comments;
    if (commentsChanged || metaChanged || tagsChanged) {
      plan.push({ id: r.id, name: r.name, newComments, lm, tags, commentsChanged, metaChanged, tagsChanged });
    }
  }

  console.log(`${rows.length} kandidatrader, ${plan.length} endres:`);
  console.log(`  Kommentar ryddet: ${plan.filter(p => p.commentsChanged).length}`);
  console.log(`  Formuesliste beriket (K400-tall): ${plan.filter(p => p.metaChanged).length}`);
  console.log(`  FBN-tag lagt til: ${plan.filter(p => p.tagsChanged).length}`);
  console.log('\nEksempler:');
  plan.slice(0, 6).forEach(p => console.log(`  ${p.id} ${p.name}: kommentar→${p.newComments ? '«'+p.newComments.slice(0,30)+'…»' : 'tom'}${p.metaChanged ? ' +tall' : ''}${p.tagsChanged ? ' +FBN-tag' : ''}`));

  if (!apply) { console.log('\nDry-run ferdig. Kjør med --apply for å skrive.\n'); process.exit(0); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of plan) {
      await client.query(
        `UPDATE investors SET comments=$2, list_meta=$3, tags=$4, updated_at=NOW() WHERE id=$1`,
        [p.id, p.newComments, JSON.stringify(p.lm), JSON.stringify(p.tags)]
      );
    }
    await client.query('COMMIT');
    console.log(`\n[ok] Ryddet ${plan.length} rader.\n`);
  } catch (e) {
    await client.query('ROLLBACK'); console.error('\n[feil] Rullet tilbake:', e.message, '\n'); process.exit(1);
  } finally { client.release(); }
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
