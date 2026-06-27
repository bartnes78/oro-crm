const router = require('express').Router();
const { query, pool } = require('../db');
const { fmtRow, validationError, auditLog } = require('../lib/helpers');
const { VALID_LOG_TYPES, isValidDate } = require('../lib/validation');

router.get('/api/log', async (req, res) => {
  try {
    let sql    = 'SELECT * FROM contact_log';
    const params = [];
    if (req.query.investorId) { params.push(req.query.investorId); sql += ` WHERE investor_id = $1`; }
    sql += ' ORDER BY date DESC, created_at DESC';
    if (req.query.limit) { params.push(parseInt(req.query.limit)); sql += ` LIMIT $${params.length}`; }
    const { rows } = await query(sql, params);
    res.json(rows.map(fmtRow));
  } catch (e) {
    console.error('[GET /log]', e);
    res.status(500).json({ error: 'Kunne ikke hente logg' });
  }
});

router.post('/api/log', async (req, res) => {
  const errors = [];
  if (!req.body.investor_id)       errors.push('investor_id er påkrevd');
  if (!isValidDate(req.body.date)) errors.push('Ugyldig dato — bruk format ÅÅÅÅ-MM-DD');
  if (req.body.log_type && !VALID_LOG_TYPES.includes(req.body.log_type)) errors.push(`Ugyldig type: ${req.body.log_type}`);
  if (errors.length) return validationError(res, errors);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE investors SET last_contact=$1, updated_at=NOW() WHERE id=$2', [req.body.date, req.body.investor_id]);
    const { rows: [entry] } = await client.query(`
      INSERT INTO contact_log (investor_id, investor_name, date, log_type, contact_person, responsible, subject, outcome, notes, status, declined_products)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `, [req.body.investor_id, req.body.investor_name || null, req.body.date, req.body.log_type || null,
        req.body.contact_person || null, req.body.responsible || null,
        req.body.subject || null, req.body.outcome || null, req.body.notes || null,
        req.body.status || null,
        JSON.stringify(Array.isArray(req.body.declined_products) ? req.body.declined_products : [])]);
    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'create', 'log', entry.id, null, { investor_id: entry.investor_id, date: entry.date, log_type: entry.log_type }, `Ny loggføring for ${req.body.investor_name || req.body.investor_id}`);
    res.json(fmtRow(entry));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /log]', e.message);
    res.status(500).json({ error: 'Kunne ikke lagre — prøv igjen' });
  } finally {
    client.release();
  }
});

router.put('/api/log/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Ugyldig ID' });
  if (req.body.date && !isValidDate(req.body.date)) return validationError(res, ['Ugyldig dato']);
  if (req.body.log_type && !VALID_LOG_TYPES.includes(req.body.log_type)) return validationError(res, [`Ugyldig type: ${req.body.log_type}`]);
  try {
    const { rows } = await query('SELECT * FROM contact_log WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const cur = rows[0];
    const b   = req.body;
    const v   = k => (k in b ? b[k] : cur[k]);
    const declinedProducts = 'declined_products' in req.body
      ? JSON.stringify(Array.isArray(req.body.declined_products) ? req.body.declined_products : [])
      : JSON.stringify(cur.declined_products || []);
    const { rows: [entry] } = await query(`
      UPDATE contact_log SET investor_id=$2, investor_name=$3, date=$4, log_type=$5,
        contact_person=$6, responsible=$7, subject=$8, outcome=$9, notes=$10, status=$11, declined_products=$12
      WHERE id=$1 RETURNING *
    `, [id, v('investor_id'), v('investor_name') || null, v('date'),
        v('log_type') || null, v('contact_person') || null, v('responsible') || null,
        v('subject') || null, v('outcome') || null, v('notes') || null,
        v('status') || null, declinedProducts]);
    res.json(fmtRow(entry));
  } catch (e) {
    console.error('[PUT /log]', e);
    res.status(500).json({ error: 'Kunne ikke oppdatere logg' });
  }
});

router.delete('/api/log/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Ugyldig ID' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT investor_id, date, log_type FROM contact_log WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Loggføring ikke funnet' }); }
    await client.query('DELETE FROM contact_log WHERE id = $1', [id]);
    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'delete', 'log', req.params.id, { investor_id: rows[0].investor_id, date: rows[0].date, log_type: rows[0].log_type }, null, `Slettet loggføring`);
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[DELETE /log]', e);
    res.status(500).json({ error: 'Kunne ikke slette loggføring' });
  } finally {
    client.release();
  }
});

module.exports = router;
