const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { query, pool } = require('../db');
const { requireAdmin, validationError, auditLog, VALID_PHASES, VALID_TYPES, VALID_VEHICLES, VALID_LOG_TYPES, VALID_LEADS } = require('../lib/helpers');

const router = express.Router();

// ── Audit-logg ────────────────────────────────────────────────────────────────
router.get('/api/audit-log', requireAdmin, async (req, res) => {
  try {
    const limit      = Math.min(parseInt(req.query.limit) || 200, 500);
    const entityType = req.query.entity_type;
    const params     = [];
    const where      = [];
    if (entityType) { params.push(entityType); where.push(`entity_type = $${params.length}`); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const { rows } = await query(
      `SELECT id, user_id, username, action, entity_type, entity_id, description, created_at
       FROM audit_log ${whereClause}
       ORDER BY created_at DESC LIMIT $${params.length + 1}`,
      [...params, limit]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Datakvalitet ──────────────────────────────────────────────────────────────
router.get('/api/data-quality', requireAdmin, async (req, res) => {
  try {
    const [{ rows: investors }, { rows: contacts }, { rows: piRows }] = await Promise.all([
      query('SELECT id, name, phase, lead, last_contact, org_nr FROM investors WHERE deleted_at IS NULL'),
      query('SELECT investor_id, email FROM contacts WHERE active = 1'),
      query('SELECT investor_id, target_ticket, probability FROM product_investors'),
    ]);

    const contactsByInv = {};
    contacts.forEach(c => {
      if (!contactsByInv[c.investor_id]) contactsByInv[c.investor_id] = [];
      contactsByInv[c.investor_id].push(c);
    });

    const now       = Date.now();
    const ms30      = 30 * 24 * 60 * 60 * 1000;
    const noEmail   = [], noLead = [], noPhase = [], noLastContact = [], noBrreg = [];
    const inactive30 = [], inactive60 = [], inactive90 = [];

    investors.forEach(inv => {
      const ctList   = contactsByInv[inv.id] || [];
      if (!ctList.some(c => c.email)) noEmail.push({ id: inv.id, name: inv.name });
      if (!inv.lead)                  noLead.push({ id: inv.id, name: inv.name });
      if (!inv.phase)                 noPhase.push({ id: inv.id, name: inv.name });
      if (!inv.org_nr)                noBrreg.push({ id: inv.id, name: inv.name });
      if (!inv.last_contact) {
        noLastContact.push({ id: inv.id, name: inv.name });
        inactive30.push({ id: inv.id, name: inv.name, last_contact: null });
        inactive60.push({ id: inv.id, name: inv.name, last_contact: null });
        inactive90.push({ id: inv.id, name: inv.name, last_contact: null });
      } else {
        const age = now - new Date(inv.last_contact).getTime();
        const item = { id: inv.id, name: inv.name, last_contact: inv.last_contact };
        if (age > ms30)      inactive30.push(item);
        if (age > ms30 * 2)  inactive60.push(item);
        if (age > ms30 * 3)  inactive90.push(item);
      }
    });

    const piMissing = piRows
      .filter(pi => pi.target_ticket == null || pi.probability == null)
      .map(pi => ({ investor_id: pi.investor_id, target_ticket: pi.target_ticket, probability: pi.probability }));

    res.json({
      noContactEmail: { count: noEmail.length,       items: noEmail },
      noLead:         { count: noLead.length,         items: noLead },
      noPhase:        { count: noPhase.length,        items: noPhase },
      noLastContact:  { count: noLastContact.length,  items: noLastContact },
      noBrreg:        { count: noBrreg.length,        items: noBrreg },
      inactive30days: { count: inactive30.length,     items: inactive30 },
      inactive60days: { count: inactive60.length,     items: inactive60 },
      inactive90days: { count: inactive90.length,     items: inactive90 },
      piMissingData:  { count: piMissing.length,      items: piMissing },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Lookups ───────────────────────────────────────────────────────────────────
router.get('/api/lookups', (req, res) => res.json({
  phases:   VALID_PHASES,
  types:    VALID_TYPES,
  vehicles: VALID_VEHICLES,
  logTypes: VALID_LOG_TYPES,
  leads:    VALID_LEADS,
  advisors: ['Grieg Investor','Mercer','Gabler','Formue','Industrifinans','Søderberg','DNB','Nordea','Handelsbanken','Intervalor'],
}));

// ── Backup API ────────────────────────────────────────────────────────────────
router.get('/api/backups', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT DISTINCT stamp FROM backups ORDER BY stamp DESC');
    res.json(rows.map(r => ({
      stamp: r.stamp,
      label: r.stamp.replace('_', ' ').replace(/-/g, ':').replace(':', '-').replace(':', '-'),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const EXPORT_DIR = path.join(__dirname, '..', 'data', 'exports');

router.get('/api/exports', requireAdmin, async (req, res) => {
  try {
    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
    const files = (await fs.promises.readdir(EXPORT_DIR)).filter(f => f.endsWith('.xlsx')).sort().reverse();
    res.json(files);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/exports/:file', requireAdmin, async (req, res) => {
  const { file } = req.params;
  if (!/^ORO_CRM_\d{4}-W\d{2}\.xlsx$/.test(file))
    return res.status(400).json({ error: 'Ugyldig filnavn' });
  const fullPath = path.join(EXPORT_DIR, file);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Fil ikke funnet' });
  res.download(fullPath);
});

router.post('/api/backups/restore/:stamp', requireAdmin, async (req, res) => {
  const { stamp } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(stamp))
    return res.status(400).json({ error: 'Ugyldig backup-tidsstempel' });

  const { rows: exists } = await query('SELECT 1 FROM backups WHERE stamp = $1 LIMIT 1', [stamp]);
  if (!exists.length) return res.status(404).json({ error: 'Backup ikke funnet' });

  const { runBackup } = require('../lib/backup');
  const client = await pool.connect();
  try {
    await runBackup();
    await client.query('BEGIN');

    const tableMap = [
      { name: 'investors',         isText: true },
      { name: 'contacts',          isText: false },
      { name: 'contact_log',       isText: false },
      { name: 'tasks',             isText: false },
      { name: 'products',          isText: false },
      { name: 'product_investors', isText: false },
      { name: 'declined_offers',   isText: false },
    ];

    await client.query('TRUNCATE declined_offers, product_investors, contact_log, tasks, products RESTART IDENTITY CASCADE');
    await client.query('DELETE FROM contacts');
    await client.query('DELETE FROM investors');

    let restored = 0;
    const SKIP_COLS = new Set(['product_interests']);
    for (const t of tableMap) {
      const { rows: bRows } = await client.query(
        'SELECT data FROM backups WHERE stamp = $1 AND table_name = $2', [stamp, t.name]
      );
      if (!bRows.length) continue;
      for (const row of bRows[0].data) {
        const keys = Object.keys(row).filter(k => !SKIP_COLS.has(k));
        const cols = keys.join(', ');
        const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
        const data = keys.map(k => {
          const v = row[k];
          if (v !== null && typeof v === 'object') return JSON.stringify(v);
          return v;
        });
        const overriding = t.isText ? '' : 'OVERRIDING SYSTEM VALUE';
        await client.query(`INSERT INTO ${t.name} (${cols}) ${overriding} VALUES (${vals}) ON CONFLICT DO NOTHING`, data);
      }
      restored++;
    }

    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'restore', 'backup', stamp, null, { stamp }, `Gjenopprettet backup: ${stamp}`);
    res.json({ ok: true, restored });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[restore]', e.message);
    res.status(500).json({ error: 'Gjenoppretting feilet: ' + e.message });
  } finally {
    client.release();
  }
});

// ── MSG-parsing ───────────────────────────────────────────────────────────────
let _multer, _MsgReader;
function getMulter()    { if (!_multer)    _multer    = require('multer');                  return _multer; }
function getMsgReader() { if (!_MsgReader) _MsgReader = require('@kenjiuno/msgreader');     return _MsgReader; }

router.post('/api/email/parse-msg', (req, res, next) => {
  let multer;
  try { multer = getMulter(); } catch { return res.status(503).json({ error: 'Kjør npm install og restart' }); }
  multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }).single('file')(req, res, next);
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ingen fil' });
  try {
    let MsgReader;
    try { MsgReader = getMsgReader(); } catch { return res.status(503).json({ error: 'Kjør npm install og restart' }); }
    const reader = new MsgReader.default(req.file.buffer);
    const data   = reader.getFileData();
    const msgClass   = (data.messageClass || '').toLowerCase();
    const isCalendar = msgClass.includes('appointment') || msgClass.includes('meeting') || msgClass.includes('schedule');
    let date = '';
    const rawDate = (isCalendar && data.apptStartWhole) ? data.apptStartWhole : data.messageDeliveryTime || data.clientSubmitTime || data.creationTime;
    if (rawDate) {
      let d = rawDate instanceof Date ? rawDate : typeof rawDate === 'string' ? new Date(rawDate) : typeof rawDate === 'number' ? new Date(rawDate / 10000 - 11644473600000) : null;
      if (d && !isNaN(d)) date = d.toISOString().slice(0, 10);
    }
    if (!date) date = new Date().toISOString().slice(0, 10);
    let body = data.body || '';
    if (!body && data.bodyHTML) {
      body = data.bodyHTML.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    }
    const senderEmail = (data.senderEmail || '').startsWith('/O=') ? '' : (data.senderEmail || '');
    const senderName  = data.senderName || '';
    const senderDomain = senderEmail.includes('@') ? senderEmail.split('@')[1].split('.')[0] : '';
    const recipients = (data.recipients || [])
      .map(r => ({ name: r.name || '', email: (r.email || r.smtpAddress || '').startsWith('/O=') ? '' : (r.email || r.smtpAddress || ''), recipType: r.recipType }))
      .filter(r => r.name || r.email);
    res.json({ from: senderEmail ? `${senderName} <${senderEmail}>` : senderName, senderName, senderEmail, senderDomain, recipients, subject: data.subject || '', date, body: body.slice(0, 3000), isCalendar, location: data.apptLocation || '' });
  } catch (e) {
    console.error('MSG parse error:', e);
    res.status(500).json({ error: 'Kunne ikke lese .msg-filen: ' + e.message });
  }
});

// ── Excel-eksport (nedlasting) ────────────────────────────────────────────────
router.get('/api/export/excel', async (req, res) => {
  try {
    const { buildExcelWorkbook } = require('../lib/backup');
    const wb = await buildExcelWorkbook();
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', `attachment; filename="ORO_CRM_${new Date().toISOString().slice(0,10)}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) {
    console.error('[export]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Feedback / bugreport ──────────────────────────────────────────────────────
router.get('/js/vendor/html2canvas.min.js', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'node_modules', 'html2canvas', 'dist', 'html2canvas.min.js'))
);

router.post('/api/feedback', express.json({ limit: '8mb' }), async (req, res) => {
  try {
    const { page, comment, screenshot } = req.body;
    if (!comment?.trim()) return validationError(res, ['Kommentar er påkrevd']);
    const username = req.currentUser?.username || null;
    const { rows } = await query(
      'INSERT INTO feedback_reports (page, comment, screenshot, username) VALUES ($1,$2,$3,$4) RETURNING id',
      [page || null, comment.trim(), screenshot || null, username]
    );
    res.json({ id: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/feedback', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, page, comment, username, created_at FROM feedback_reports ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/feedback/:id/screenshot', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT screenshot FROM feedback_reports WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Ikke funnet' });
    res.json({ screenshot: rows[0].screenshot });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
