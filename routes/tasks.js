const router = require('express').Router();
const { query, pool } = require('../db');
const { fmtRow, validationError, auditLog } = require('../lib/helpers');
const { isValidDate } = require('../lib/validation');

router.get('/api/tasks', async (req, res) => {
  try {
    const params = [];
    const where  = [];
    if (req.query.investorId) { params.push(String(req.query.investorId)); where.push(`investor_id = $${params.length}`); }
    if (req.query.done !== undefined) { params.push(parseInt(req.query.done)); where.push(`done = $${params.length}`); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const { rows } = await query(`SELECT * FROM tasks ${whereClause} ORDER BY due_date`, params);
    res.json(rows.map(fmtRow));
  } catch (e) {
    console.error('[GET /tasks]', e);
    res.status(500).json({ error: 'Kunne ikke hente oppgaver' });
  }
});

router.post('/api/tasks', async (req, res) => {
  const errors = [];
  if (!String(req.body.label || '').trim()) errors.push('Oppgavetekst er påkrevd');
  if (!isValidDate(req.body.due_date))      errors.push('Ugyldig frist — bruk format ÅÅÅÅ-MM-DD');
  if (errors.length) return validationError(res, errors);
  try {
    const { rows: [task] } = await query(`
      INSERT INTO tasks (investor_id, investor_name, label, due_date, done, created_at)
      VALUES ($1,$2,$3,$4,0,CURRENT_DATE) RETURNING *
    `, [req.body.investor_id || null, req.body.investor_name || null, req.body.label, req.body.due_date]);
    res.json(fmtRow(task));
  } catch (e) {
    console.error('[POST /tasks]', e);
    res.status(500).json({ error: 'Kunne ikke opprette oppgave' });
  }
});

router.put('/api/tasks/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM tasks WHERE id = $1', [parseInt(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const cur = rows[0];
    const b   = req.body;
    const v   = k => (k in b ? b[k] : cur[k]);
    const { rows: [task] } = await query(`
      UPDATE tasks SET investor_id=$2, investor_name=$3, label=$4, due_date=$5, done=$6
      WHERE id=$1 RETURNING *
    `, [parseInt(req.params.id), v('investor_id') || null, v('investor_name') || null,
        v('label'), v('due_date'), 'done' in b ? (b.done ? 1 : 0) : cur.done]);
    res.json(fmtRow(task));
  } catch (e) {
    console.error('[PUT /tasks]', e);
    res.status(500).json({ error: 'Kunne ikke oppdatere oppgave' });
  }
});

router.delete('/api/tasks/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT label, investor_id FROM tasks WHERE id = $1 FOR UPDATE', [parseInt(req.params.id)]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Oppgave ikke funnet' }); }
    await client.query('DELETE FROM tasks WHERE id = $1', [parseInt(req.params.id)]);
    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'delete', 'task', req.params.id, { label: rows[0].label, investor_id: rows[0].investor_id }, null, `Slettet oppgave: ${rows[0].label}`);
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[DELETE /tasks]', e);
    res.status(500).json({ error: 'Kunne ikke slette oppgave' });
  } finally {
    client.release();
  }
});

module.exports = router;
