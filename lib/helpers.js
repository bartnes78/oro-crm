const { query } = require('../db');

function fmtRow(row) {
  if (!row) return null;
  const { id, ...rest } = row;
  return { _id: id, ...rest };
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

module.exports = { fmtRow, validationError, requireAdmin, auditLog };
