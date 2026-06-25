const express = require('express');
const { query, pool } = require('../db');
const { fmtRow, validationError, requireAdmin, auditLog } = require('../lib/helpers');

const router = express.Router();

// ── Kontakter ─────────────────────────────────────────────────────────────────
router.get('/api/contacts', async (req, res) => {
  try {
    const sql    = req.query.investorId
      ? 'SELECT * FROM contacts WHERE investor_id = $1 ORDER BY is_primary DESC'
      : 'SELECT * FROM contacts ORDER BY is_primary DESC';
    const params = req.query.investorId ? [req.query.investorId] : [];
    const { rows } = await query(sql, params);
    res.json(rows.map(fmtRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/contacts', async (req, res) => {
  const errors = [];
  if (!String(req.body.investor_id || '').trim()) errors.push('investor_id er påkrevd');
  if (!String(req.body.name || '').trim())        errors.push('Navn er påkrevd');
  if (errors.length) return validationError(res, errors);
  try {
    const { rows: [c] } = await query(`
      INSERT INTO contacts (investor_id, name, title, email, phone, phone2, is_primary, notes, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [req.body.investor_id, req.body.name, req.body.title || null,
        req.body.email || null, req.body.phone || null, req.body.phone2 || null, req.body.is_primary || 0, req.body.notes || null,
        req.body.active ?? 1]);
    await auditLog(req.currentUser._id, req.currentUser.username, 'create', 'contact', c.id, null, { name: c.name, investor_id: c.investor_id }, `Opprettet kontakt: ${c.name}`);
    res.json(fmtRow(c));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/contacts/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM contacts WHERE id = $1', [parseInt(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const cur = rows[0];
    const b   = req.body;
    const v   = k => (k in b ? b[k] : cur[k]);
    const { rows: [c] } = await query(`
      UPDATE contacts SET investor_id=$2, name=$3, title=$4, email=$5, phone=$6, phone2=$7, is_primary=$8, notes=$9, active=$10
      WHERE id=$1 RETURNING *
    `, [parseInt(req.params.id), v('investor_id'), v('name'), v('title') || null,
        v('email') || null, v('phone') || null, v('phone2') || null, v('is_primary') || 0, v('notes') || null,
        'active' in b ? (b.active ?? 1) : (cur.active ?? 1)]);
    res.json(fmtRow(c));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/contacts/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM contacts WHERE id = $1', [parseInt(req.params.id)]);
    await query('DELETE FROM contacts WHERE id = $1', [parseInt(req.params.id)]);
    if (rows[0]) await auditLog(req.currentUser._id, req.currentUser.username, 'delete', 'contact', req.params.id, { name: rows[0].name, investor_id: rows[0].investor_id }, null, `Slettet kontakt: ${rows[0].name}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/contacts/merge', async (req, res) => {
  const { keep_id, drop_id } = req.body || {};
  if (!keep_id || !drop_id || keep_id === drop_id) return res.status(400).json({ error: 'Ugyldig merge-forespørsel' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM contacts WHERE id = ANY($1)', [[parseInt(keep_id), parseInt(drop_id)]]);
    const keep = rows.find(r => r.id === parseInt(keep_id));
    const drop = rows.find(r => r.id === parseInt(drop_id));
    if (!keep || !drop) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Kontakt ikke funnet' }); }
    // Merge: keep wins, fill nulls from drop. Hvis keep.phone og drop.phone begge er satt
    // og ulike, havner drop.phone i phone2 (i stedet for å gå tapt).
    let phone  = keep.phone;
    let phone2 = keep.phone2;
    if (!phone) phone = drop.phone || null;
    else if (drop.phone && drop.phone !== phone && !phone2) phone2 = drop.phone;
    if (!phone2) phone2 = drop.phone2 || null;

    await client.query(`
      UPDATE contacts SET
        title     = COALESCE(NULLIF(title,''), $2),
        email     = COALESCE(NULLIF(email,''), $3),
        phone     = $4,
        phone2    = $5,
        notes     = CASE WHEN notes IS NOT NULL AND notes <> '' AND $6::TEXT IS NOT NULL AND $6::TEXT <> ''
                         THEN notes || E'\n' || $6::TEXT
                         ELSE COALESCE(NULLIF(notes,''), $6::TEXT) END
      WHERE id = $1
    `, [parseInt(keep_id), drop.title, drop.email, phone, phone2, drop.notes]);
    await client.query('DELETE FROM contacts WHERE id = $1', [parseInt(drop_id)]);
    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'merge', 'contact', keep_id,
      { dropped_id: drop_id, dropped_name: drop.name },
      { kept_id: keep_id, kept_name: keep.name },
      `Slo sammen kontakter: ${drop.name} inn i ${keep.name}`);
    const { rows: [merged] } = await client.query('SELECT * FROM contacts WHERE id = $1', [parseInt(keep_id)]);
    res.json(fmtRow(merged));
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
