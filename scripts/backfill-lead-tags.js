// Engangs back-fill: konverter lead-kilde til tag på eksisterende rader.
// Setter tag = source på investorer som kom fra lead-import (is_lead=TRUE eller
// provenance.kilde satt) og som ikke alt har taggen. Idempotent — trygg å kjøre flere ganger.
//
// Bruk:
//   node scripts/backfill-lead-tags.js            (dry-run)
//   node scripts/backfill-lead-tags.js --commit   (skriver)

require('dotenv').config();
const { query, pool } = require('../db');

async function run() {
  const commit = process.argv.includes('--commit');
  console.log(commit ? '\nMODUS: --commit (skriver)\n' : '\nMODUS: dry-run (ingen skriv — bruk --commit)\n');

  // Lead-opprinnelse: enten fortsatt lead, eller kvalifisert men med provenance.kilde.
  const { rows } = await query(`
    SELECT id, name, source, is_lead, tags
    FROM investors
    WHERE deleted_at IS NULL
      AND source IS NOT NULL
      AND (is_lead = TRUE OR provenance ? 'kilde')
  `);

  const toTag = rows.filter(r => {
    const tags = Array.isArray(r.tags) ? r.tags : [];
    return !tags.some(t => t.toLowerCase() === r.source.toLowerCase());
  });

  console.log(`${rows.length} lead-opprinnede rader, ${toTag.length} mangler kilde-tag.\n`);
  for (const r of toTag) {
    console.log(`  ${r.id}  ${r.name.padEnd(30)} +#${r.source}${r.is_lead ? '  (lead)' : ''}`);
  }

  if (!commit) {
    console.log('\nDry-run ferdig. Kjør på nytt med --commit for å skrive.\n');
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of toTag) {
      await client.query(
        `UPDATE investors
         SET tags = CASE WHEN tags @> $2 THEN tags ELSE COALESCE(tags,'[]'::jsonb) || $2 END,
             updated_at = NOW()
         WHERE id = $1`,
        [r.id, JSON.stringify([r.source])]
      );
    }
    await client.query('COMMIT');
    console.log(`\n[ok] La kilde-tag på ${toTag.length} rader.\n`);
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
