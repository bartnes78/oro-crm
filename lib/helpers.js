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
    product_interests: row.product_interests || [],
    declined_offers:   row.declined_offers   || [],
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
  };
}

function fmtUser(row) {
  if (!row) return null;
  return { _id: row.id, username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: !!row.must_change_password, leadName: row.lead_name || null };
}

function validationError(res, errors) {
  return res.status(400).json({ error: errors.join('. ') });
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

const VALID_PHASES    = ['Prospekt','Aktiv dialog','Investor','Tidligere investor','På vent'];
const VALID_TYPES     = ['Pensjon','Stiftelse','Family Office','Forsikring','Institusjonell','Pensjonskasse','Private Banking','Rådgiver','Annet'];
const VALID_LOG_TYPES = ['Møte','Telefon','Tapt anrop','E-post mottatt','E-post sendt','Event','Video','Annet','Notat'];
const VALID_LEADS     = ['Kristian Bartnes','Anders Brustad-Nilsen','Nikolai Staubo','Anders Aasand','Gunnar Vestby','Ekstern'];
const VALID_VEHICLES  = ['IS','Feeder','Ikke avklart'];

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function validateInvestorBody(body, requireName = true) {
  const errors = [];
  if (requireName && !String(body.name || '').trim()) errors.push('Navn er påkrevd');
  if (body.phase         && !VALID_PHASES.includes(body.phase))         errors.push(`Ugyldig fase: ${body.phase}`);
  if (body.investor_type && !VALID_TYPES.includes(body.investor_type))  errors.push(`Ugyldig type: ${body.investor_type}`);
  if (body.lead          && !VALID_LEADS.includes(body.lead))           errors.push(`Ugyldig lead: ${body.lead}`);
  if (body.fund_vehicle  && !VALID_VEHICLES.includes(body.fund_vehicle))errors.push(`Ugyldig kjøretøy: ${body.fund_vehicle}`);
  if (body.product_interests != null && !Array.isArray(body.product_interests))
    errors.push('product_interests må være en liste');
  return errors;
}

const crypto = require('crypto');

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

module.exports = {
  fmtRow, fmtInvestor, fmtUser,
  validationError, requireAdmin, auditLog,
  VALID_PHASES, VALID_TYPES, VALID_LOG_TYPES, VALID_LEADS, VALID_VEHICLES,
  isValidDate, validateInvestorBody,
  hashPassword, verifyPassword,
};
