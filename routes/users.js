const router = require('express').Router();
const { query, pool } = require('../db');
const { fmtUser, validationError, requireAdmin, auditLog, hashPassword } = require('../lib/helpers');
const { VALID_LEADS } = require('../lib/validation');

router.get('/api/me', (req, res) => res.json(req.currentUser));

router.put('/api/me/password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.trim().length < 6)
    return validationError(res, ['Passordet må være minst 6 tegn']);
  try {
    const { rows: [u] } = await query(
      'UPDATE users SET password_hash=$1, must_change_password=FALSE WHERE id=$2 RETURNING *',
      [hashPassword(password.trim()), req.currentUser._id]
    );
    res.json(fmtUser(u));
  } catch (e) {
    console.error('[PUT /me/password]', e);
    res.status(500).json({ error: 'Kunne ikke endre passord' });
  }
});

router.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM users ORDER BY id');
    res.json(rows.map(fmtUser));
  } catch (e) {
    console.error('[GET /users]', e);
    res.status(500).json({ error: 'Kunne ikke hente brukere' });
  }
});

router.post('/api/users', requireAdmin, async (req, res) => {
  const { username, displayName, password, role, leadName } = req.body;
  const errors = [];
  if (!String(username    || '').trim()) errors.push('Brukernavn er påkrevd');
  if (!String(displayName || '').trim()) errors.push('Visningsnavn er påkrevd');
  const effectivePassword = String(password || '').trim() || 'byttpassord';
  if (!['admin','bruker'].includes(role)) errors.push('Ugyldig rolle');
  const validTeamLeads = VALID_LEADS.filter(l => l !== 'Ekstern');
  if (leadName && !validTeamLeads.includes(leadName)) errors.push(`Ugyldig lead-navn: ${leadName}`);
  if (errors.length) return validationError(res, errors);
  try {
    const { rows: [u] } = await query(`
      INSERT INTO users (username, display_name, role, password_hash, must_change_password, lead_name)
      VALUES ($1,$2,$3,$4,TRUE,$5) RETURNING *
    `, [username.trim(), displayName.trim(), role, hashPassword(effectivePassword), leadName || null]);
    await auditLog(req.currentUser._id, req.currentUser.username, 'create', 'user', u.id, null, { username: u.username, role: u.role }, `Opprettet bruker: ${u.username}`);
    res.json(fmtUser(u));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Brukernavnet er allerede i bruk' });
    console.error('[POST /users]', e);
    res.status(500).json({ error: 'Kunne ikke opprette bruker' });
  }
});

router.put('/api/users/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Ugyldig ID' });
  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Bruker ikke funnet' });
    const cur = rows[0];
    const { displayName, password, role, leadName } = req.body;
    const validTeamLeads = VALID_LEADS.filter(l => l !== 'Ekstern');
    if (leadName !== undefined && leadName !== null && leadName !== '' && !validTeamLeads.includes(leadName))
      return validationError(res, [`Ugyldig lead-navn: ${leadName}`]);
    const newDisplayName = displayName ? displayName.trim() : cur.display_name;
    const newRole        = role && ['admin','bruker'].includes(role) ? role : cur.role;
    const passwordReset  = password && password.trim();
    const newHash        = passwordReset ? hashPassword(password) : cur.password_hash;
    const mustChange     = passwordReset && id !== req.currentUser._id ? true : cur.must_change_password;
    const newLeadName    = leadName !== undefined ? (leadName || null) : cur.lead_name;
    const { rows: [u] } = await query(`
      UPDATE users SET display_name=$2, role=$3, password_hash=$4, must_change_password=$5, lead_name=$6 WHERE id=$1 RETURNING *
    `, [id, newDisplayName, newRole, newHash, mustChange, newLeadName]);
    const changes = [];
    if (displayName && displayName.trim() !== cur.display_name) changes.push('navn');
    if (role && role !== cur.role) changes.push(`rolle: ${cur.role} → ${role}`);
    if (passwordReset) changes.push('passord tilbakestilt');
    if (leadName !== undefined && leadName !== cur.lead_name) changes.push(`lead: ${cur.lead_name || '—'} → ${leadName || '—'}`);
    await auditLog(req.currentUser._id, req.currentUser.username, 'update', 'user', id,
      { role: cur.role, display_name: cur.display_name, lead_name: cur.lead_name },
      { role: u.role, display_name: u.display_name, lead_name: u.lead_name },
      `Oppdaterte bruker ${u.username}${changes.length ? ': ' + changes.join(', ') : ''}`);
    res.json(fmtUser(u));
  } catch (e) {
    console.error('[PUT /users]', e);
    res.status(500).json({ error: 'Kunne ikke oppdatere bruker' });
  }
});

router.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Ugyldig ID' });
  if (id === req.currentUser._id) return res.status(400).json({ error: 'Du kan ikke slette din egen konto' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Bruker ikke funnet' }); }
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'delete', 'user', id, { username: rows[0].username, role: rows[0].role }, null, `Slettet bruker: ${rows[0].username}`);
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[DELETE /users]', e);
    res.status(500).json({ error: 'Kunne ikke slette bruker' });
  } finally {
    client.release();
  }
});

module.exports = router;
