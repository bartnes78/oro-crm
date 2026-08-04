const crypto = require('crypto');
const { query } = require('../db');

function fmtRow(row) {
  if (!row) return null;
  const { id, ...rest } = row;
  return { _id: id, ...rest };
}

function fmtInvestor(row) {
  if (!row) return null;
  return {
    id:                row.id,
    name:              row.name,
    country:           row.country,
    city:              row.city,
    investor_type:     row.investor_type,
    fund_vehicle:      row.fund_vehicle,
    product_interests: row.product_interests || [],  // populated by caller from product_investors
    declined_offers:   row.declined_offers   || [],  // populated by caller from declined_offers
    phase:             row.phase,
    lead:              row.lead,
    advisor:           row.advisor,
    target_ticket:     row.target_ticket,
    probability:       row.probability,
    committed_total:   row.committed_total ?? 0,
    weighted_total:    row.weighted_total  ?? 0,
    committed_amount:  row.committed_amount  ?? null,
    decline_reason:    row.decline_reason    ?? null,
    first_close:       row.first_close || 0,
    source:            row.source,
    next_steps:        row.next_steps,
    last_contact:      row.last_contact  || null,
    doc_shared:        row.doc_shared    || null,
    meeting_date:      row.meeting_date  || null,
    comments:          row.comments,
    docs:              row.docs              || {},
    updated_at:        row.updated_at,
    org_nr:            row.org_nr            || null,
    brreg_navn:        row.brreg_navn        || null,
    brreg_data:        row.brreg_data        || {},
    is_lead:            !!row.is_lead,
    finansinntekt_mnok: row.finansinntekt_mnok ?? null,
    kapitalkilde:       row.kapitalkilde       || null,
    relevans_indikativ: row.relevans_indikativ || null,
    provenance:         row.provenance         || {},
  };
}

function validationError(res, errors) {
  return res.status(400).json({ error: errors.join('. ') });
}

// Navnenormalisering + Jaccard for duplikat-deteksjon. Delt av /api/duplicates
// og lead-importøren (scripts/import-leads.js) slik at forhåndssjekk før innsett
// bruker nøyaktig samme logikk som duplikat-sveipet i UI-et.
function normalizeName(name) {
  return (name || '').toLowerCase()
    .replace(/[.,\(\)\/\-]/g, ' ')
    .replace(/\b(as|asa|is|sa|ans|pk|ab|spk)\b/g, ' ')
    .replace(/\b(pensjonskasse|pensjon|stiftelse|fond|fondet|forsikring|livsforsikring|kapitalforvaltning|kommunale|kommune|private|banking|management|drift|holding|group|gruppen|invest)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function jaccard(a, b) {
  const sa = new Set(a.split(' ').filter(x => x.length > 1));
  const sb = new Set(b.split(' ').filter(x => x.length > 1));
  if (!sa.size || !sb.size) return 0;
  const inter = [...sa].filter(x => sb.has(x)).length;
  return inter / new Set([...sa, ...sb]).size;
}

function requireAdmin(req, res, next) {
  if (req.currentUser?.role !== 'admin')
    return res.status(403).json({ error: 'Kun administratorer har tilgang' });
  next();
}

async function auditLog(userId, username, action, entityType, entityId, oldVal, newVal, description) {
  try {
    await query(
      `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, old_value, new_value, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId ?? null, username ?? null, action, entityType, String(entityId ?? ''),
       oldVal != null ? JSON.stringify(oldVal) : null,
       newVal != null ? JSON.stringify(newVal) : null,
       description ?? null]
    );
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

function fmtUser(row) {
  if (!row) return null;
  return { _id: row.id, username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: !!row.must_change_password, leadName: row.lead_name || null };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const buf = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(buf, Buffer.from(hash, 'hex'));
}

module.exports = { fmtRow, fmtInvestor, validationError, requireAdmin, auditLog, fmtUser, hashPassword, verifyPassword, normalizeName, jaccard };
