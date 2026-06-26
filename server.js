require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const session   = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const ExcelJS   = require('exceljs');
const cron      = require('node-cron');
const { query, pool } = require('./db');
const { fmtUser, hashPassword, verifyPassword } = require('./lib/helpers');
const { VALID_PHASES, VALID_TYPES, VALID_LOG_TYPES, VALID_LEADS, VALID_VEHICLES, isValidDate } = require('./lib/validation');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Formathjelpere ────────────────────────────────────────────────────────────
function fmtRow(row) {
  if (!row) return null;
  const { id, ...rest } = row;
  return { _id: id, ...rest };
}


// ── Backup ────────────────────────────────────────────────────────────────────
async function runBackup() {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const tables = [
    'investors', 'contacts', 'contact_log', 'tasks',
    'products', 'product_investors', 'declined_offers', 'users',
  ];
  try {
    for (const name of tables) {
      const { rows } = await query(`SELECT * FROM ${name}`);
      await query(
        'INSERT INTO backups (stamp, table_name, data) VALUES ($1,$2,$3) ON CONFLICT (stamp, table_name) DO UPDATE SET data = EXCLUDED.data',
        [stamp, name, JSON.stringify(rows)]
      );
    }
    const { rows: allStamps } = await query('SELECT DISTINCT stamp FROM backups ORDER BY stamp DESC');
    const toDelete = allStamps.slice(10).map(r => r.stamp);
    if (toDelete.length > 0)
      await query('DELETE FROM backups WHERE stamp = ANY($1)', [toDelete]);
    console.log(`[backup] ${stamp}`);
  } catch (e) {
    console.error('[backup] Feilet:', e.message);
  }
}

// ── Ukentlig Excel-eksport ──────────────────────────────────────────────────────
const EXPORT_DIR = path.join(__dirname, 'data', 'exports');

function isoWeekStamp(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // mandag=0 ... søndag=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function runWeeklyExport() {
  try {
    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
    const file = path.join(EXPORT_DIR, `ORO_CRM_${isoWeekStamp()}.xlsx`);
    if (fs.existsSync(file)) return; // allerede eksportert denne uken

    const wb = await buildExcelWorkbook();
    await wb.xlsx.writeFile(file);

    const files = (await fs.promises.readdir(EXPORT_DIR)).filter(f => f.endsWith('.xlsx')).sort();
    const toDelete = files.slice(0, -8); // behold de 8 siste (~2 måneder)
    for (const f of toDelete) await fs.promises.unlink(path.join(EXPORT_DIR, f));

    console.log(`[weekly-export] ${file}`);
    if (process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET) {
      uploadToOneDrive(file, path.basename(file)).catch(e =>
        console.error('[weekly-export] OneDrive-opplasting feilet:', e.message)
      );
    }
  } catch (e) {
    console.error('[weekly-export] Feilet:', e.message);
  }
}

async function uploadToOneDrive(filePath, fileName) {
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  );
  const { access_token, error_description } = await tokenRes.json();
  if (!access_token) throw new Error('MS token feilet: ' + error_description);

  const user   = encodeURIComponent(process.env.MS_ONEDRIVE_USER   || '');
  const folder = encodeURIComponent(process.env.MS_ONEDRIVE_FOLDER || 'ORO CRM Backups');
  const fileContent = await fs.promises.readFile(filePath);

  const uploadRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${user}/drive/root:/${folder}/${fileName}:/content`,
    {
      method:  'PUT',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type':  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      body: fileContent,
    }
  );
  if (!uploadRes.ok) {
    const msg = await uploadRes.text().catch(() => uploadRes.status);
    throw new Error(`Graph API ${uploadRes.status}: ${msg}`);
  }
  console.log(`[weekly-export] Lastet opp til OneDrive: ${fileName}`);
}

// ── Passord-hashing ───────────────────────────────────────────────────────────

// ── Skjema og admin-bootstrap ─────────────────────────────────────────────────
async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(sql);
  console.log('[db] Skjema klar');
}

async function bootstrapUsers() {
  const { rows } = await query('SELECT id FROM users LIMIT 1');
  if (rows.length > 0) return;
  const username    = process.env.CRM_USER         || 'admin';
  const password    = process.env.CRM_PASS         || crypto.randomBytes(8).toString('hex');
  const displayName = process.env.CRM_DISPLAY_NAME || username;
  await query(
    'INSERT INTO users (username, display_name, role, password_hash) VALUES ($1,$2,$3,$4)',
    [username, displayName, 'admin', hashPassword(password)]
  );
  if (!process.env.CRM_PASS) {
    console.log(`\n[auth] Ingen brukere funnet — opprettet admin-konto`);
    console.log(`       Brukernavn : ${username}`);
    console.log(`       Passord    : ${password}\n`);
  } else {
    console.log(`[auth] Admin-konto opprettet — brukernavn: ${username}`);
  }
}

// ── Express-oppsett ───────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'"],
      workerSrc:   ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const IS_PROD        = process.env.NODE_ENV === 'production';
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '').trim().replace(/\/$/, '') || null;

if (IS_PROD && !ALLOWED_ORIGIN) {
  console.error('[sikkerhet] ALLOWED_ORIGIN er ikke satt i production — avbryter oppstart.');
  process.exit(1);
}

const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PROD ? null : crypto.randomBytes(32).toString('hex'));
if (IS_PROD && !SESSION_SECRET) {
  console.error('[sikkerhet] SESSION_SECRET er ikke satt i production — avbryter oppstart.');
  process.exit(1);
}

// Railway terminerer HTTPS i en proxy foran appen — kreves for at secure-cookies skal settes
app.set('trust proxy', 1);

const DEV_ORIGINS = /^https?:\/\/localhost(:\d+)?$/;
const apiCors = cors({
  origin: (origin, cb) => {
    // Ingen Origin-header = same-origin eller server-til-server, alltid tillatt
    if (!origin) return cb(null, true);
    const normOrigin = origin.trim().replace(/\/$/, '');
    if (IS_PROD) {
      // cb(null, false) = avvis stille uten å kaste feil (CORS-blokkering skjer i browser)
      return cb(null, normOrigin === ALLOWED_ORIGIN);
    }
    cb(null, DEV_ORIGINS.test(normOrigin) || normOrigin === ALLOWED_ORIGIN);
  },
  credentials: true,
});

// Mild general limiter — teller alle forespørsler, hindrer DoS
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'For mange forespørsler. Prøv igjen om litt.' },
});

// Brute-force-limiter — kallast manuelt berre ved feil credentials, aldri på andre API-feil
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'For mange innloggingsforsøk. Prøv igjen om 15 minutter.' },
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const s  = res.statusCode;
    const c  = s >= 500 ? '\x1b[31m' : s >= 400 ? '\x1b[33m' : '\x1b[32m';
    console.log(`${c}[${new Date().toISOString().slice(11,19)}] ${req.method} ${req.path} ${s} ${ms}ms\x1b[0m`);
  });
  next();
});

// ── Auth-middleware ───────────────────────────────────────────────────────────
app.use('/api', apiCors, apiLimiter);

app.use('/api', session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'oro.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,  // fornyer utløpstid ved hver forespørsel → aktive brukere forblir innlogget
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 30 * 24 * 60 * 60 * 1000,  // 30 dager
  },
}));

// X-Requested-With-vern mot CSRF — gjelder også /api/login og /api/logout
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'XMLHttpRequest')
    return res.status(403).json({ error: 'Ugyldig forespørsel' });
  next();
});

// Login/logout — registrert før «auth kreves»-middleware, så de fungerer uten aktiv sesjon
app.post('/api/login', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password)
    return res.status(400).json({ error: 'Brukernavn og passord er påkrevd' });
  try {
    const { rows } = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      // Kallast berre ved reell auth-feil — teller mot brute-force-grensa (15/15 min per IP)
      return authLimiter(req, res, () =>
        res.status(401).json({ error: 'Feil brukernavn eller passord' }));
    }
    req.session.userId = user.id;
    res.json(fmtUser(user));
  } catch (e) {
    res.status(500).json({ error: 'Innlogging feilet' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('oro.sid');
    res.json({ ok: true });
  });
});

// Auth kreves for alle øvrige /api-ruter
app.use('/api', async (req, res, next) => {
  if (!req.session?.userId)
    return res.status(401).json({ error: 'Innlogging kreves' });
  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    const user = rows[0];
    if (!user)  // brukeren er slettet etter at sesjonen ble opprettet
      return req.session.destroy(() => res.status(401).json({ error: 'Innlogging kreves' }));
    req.currentUser = fmtUser(user);
    next();
  } catch (e) {
    res.status(500).json({ error: 'Auth feilet' });
  }
});

app.use('/api', (req, res, next) => {
  if (!req.currentUser?.mustChangePassword) return next();
  const allowed =
    (req.method === 'GET'  && req.path === '/me') ||
    (req.method === 'PUT'  && req.path === '/me/password') ||
    (req.method === 'POST' && req.path === '/logout');
  if (!allowed)
    return res.status(403).json({ error: 'Passord må endres før du kan bruke CRM' });
  next();
});

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

// ── Validering ────────────────────────────────────────────────────────────────
function validationError(res, errors) {
  return res.status(400).json({ error: errors.join('. ') });
}

// ── Dashboard / Analyse ──────────────────────────────────────────────────────
app.use(require('./routes/dashboard'));

// ── Brønnøysundregistrene ─────────────────────────────────────────────────────
app.use(require('./routes/brreg'));

// ── Produkter / product_investors / declined_offers ───────────────────────────
app.use(require('./routes/products'));

// ── Investorer / duplikater / merge ───────────────────────────────────────────
app.use(require('./routes/investors'));

// ── Kontakter ─────────────────────────────────────────────────────────────────
app.use(require('./routes/contacts'));

// ── Kontaktlogg ───────────────────────────────────────────────────────────────
app.use(require('./routes/log'));

// ── Oppgaver ──────────────────────────────────────────────────────────────────
app.use(require('./routes/tasks'));

// ── Brukere ───────────────────────────────────────────────────────────────────
app.use(require('./routes/users'));

// ── Admin (audit, datakvalitet, lookups, backups, seed, eksport, feedback) ───
app.use(require('./routes/admin')({ runBackup, buildExcelWorkbook }));

// ── MSG-parsing ───────────────────────────────────────────────────────────────
let _multer, _MsgReader;
function getMulter()    { if (!_multer)    _multer    = require('multer');                  return _multer; }
function getMsgReader() { if (!_MsgReader) _MsgReader = require('@kenjiuno/msgreader');     return _MsgReader; }

app.post('/api/email/parse-msg', (req, res, next) => {
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

// ── Excel-eksport ─────────────────────────────────────────────────────────────
async function buildExcelWorkbook() {
    const [{ rows: investors }, { rows: contacts }, { rows: log }, { rows: products }, { rows: piRows }] = await Promise.all([
      query('SELECT * FROM investors WHERE deleted_at IS NULL ORDER BY name'),
      query('SELECT * FROM contacts'),
      query('SELECT * FROM contact_log ORDER BY date DESC'),
      query('SELECT * FROM products'),
      query(`SELECT pi.* FROM product_investors pi
             WHERE NOT EXISTS (
               SELECT 1 FROM declined_offers d
               WHERE d.investor_id = pi.investor_id AND d.product_id = pi.product_id
             )`),
    ]);
    const prodNameById = Object.fromEntries(products.map(p => [p.id, p.name]));
    const wb = new ExcelJS.Workbook();

    // Aggregate product_investors per investor (sum across all products)
    const piByInv = {};
    const prodsByInv = {};
    for (const pi of piRows) {
      if (!piByInv[pi.investor_id]) piByInv[pi.investor_id] = { ticket: 0, weighted: 0, committed: 0 };
      piByInv[pi.investor_id].ticket    += Number(pi.target_ticket)    || 0;
      piByInv[pi.investor_id].committed += Number(pi.committed_amount) || 0;
      if (pi.target_ticket != null && pi.probability != null)
        piByInv[pi.investor_id].weighted += Number(pi.target_ticket) * Number(pi.probability);
      if (!prodsByInv[pi.investor_id]) prodsByInv[pi.investor_id] = [];
      prodsByInv[pi.investor_id].push(pi.product_id);
    }

    const invRows = investors.map(i => {
      const pi = piByInv[i.id] || {};
      return {
        'ID': i.id, 'Navn': i.name, 'Land': i.country || '', 'By': i.city || '',
        'Type': i.investor_type || '', 'Fase': i.phase || '', 'Lead': i.lead || '',
        'Rådgiver': i.advisor || '',
        'Ticket totalt (MNOK)': pi.ticket ? Math.round(pi.ticket * 10) / 10 : '',
        'Vektet totalt (MNOK)': pi.weighted ? Math.round(pi.weighted * 10) / 10 : '',
        'Innbetalt (MNOK)': pi.committed ? Math.round(pi.committed * 10) / 10 : '',
        'Produktinteresse': (prodsByInv[i.id] || []).map(id => prodNameById[id] || id).join(', '),
        'Sist kontakt': i.last_contact || '', 'Neste steg': i.next_steps || '', 'Kommentarer': i.comments || '',
      };
    });
    const wsInv = wb.addWorksheet('Investorer');
    wsInv.columns = [
      { header: 'ID', key: 'ID', width: 10 }, { header: 'Navn', key: 'Navn', width: 36 },
      { header: 'Land', key: 'Land', width: 10 }, { header: 'By', key: 'By', width: 16 },
      { header: 'Type', key: 'Type', width: 18 }, { header: 'Fase', key: 'Fase', width: 14 },
      { header: 'Lead', key: 'Lead', width: 22 }, { header: 'Rådgiver', key: 'Rådgiver', width: 18 },
      { header: 'Ticket totalt (MNOK)', key: 'Ticket totalt (MNOK)', width: 16 },
      { header: 'Vektet totalt (MNOK)', key: 'Vektet totalt (MNOK)', width: 16 },
      { header: 'Innbetalt (MNOK)', key: 'Innbetalt (MNOK)', width: 14 },
      { header: 'Produktinteresse', key: 'Produktinteresse', width: 50 },
      { header: 'Sist kontakt', key: 'Sist kontakt', width: 14 },
      { header: 'Neste steg', key: 'Neste steg', width: 28 },
      { header: 'Kommentarer', key: 'Kommentarer', width: 40 },
    ];
    wsInv.addRows(invRows);

    // Extra sheet: pipeline per produkt
    const piSheetRows = piRows
      .filter(pi => pi.target_ticket != null || pi.committed_amount != null)
      .map(pi => {
        const inv = investors.find(i => i.id === pi.investor_id);
        const weighted = (pi.target_ticket != null && pi.probability != null)
          ? Math.round(Number(pi.target_ticket) * Number(pi.probability) * 10) / 10 : '';
        return {
          'Produkt': prodNameById[pi.product_id] || pi.product_id,
          'Investor': inv?.name || pi.investor_id,
          'Fase': inv?.phase || '',
          'Ticket (MNOK)': pi.target_ticket != null ? Number(pi.target_ticket) : '',
          'Sannsynlighet (%)': pi.probability != null ? Math.round(Number(pi.probability) * 100) : '',
          'Vektet (MNOK)': weighted,
          'Innbetalt (MNOK)': pi.committed_amount != null ? Number(pi.committed_amount) : '',
          'Avslagsgrunn': pi.decline_reason || '',
        };
      })
      .sort((a, b) => String(a['Produkt']).localeCompare(String(b['Produkt'])) || String(a['Investor']).localeCompare(String(b['Investor'])));
    const wsPi = wb.addWorksheet('Pipeline per produkt');
    wsPi.columns = [
      { header: 'Produkt', key: 'Produkt', width: 36 }, { header: 'Investor', key: 'Investor', width: 36 },
      { header: 'Fase', key: 'Fase', width: 14 }, { header: 'Ticket (MNOK)', key: 'Ticket (MNOK)', width: 14 },
      { header: 'Sannsynlighet (%)', key: 'Sannsynlighet (%)', width: 16 },
      { header: 'Vektet (MNOK)', key: 'Vektet (MNOK)', width: 14 },
      { header: 'Innbetalt (MNOK)', key: 'Innbetalt (MNOK)', width: 14 },
      { header: 'Avslagsgrunn', key: 'Avslagsgrunn', width: 24 },
    ];
    wsPi.addRows(piSheetRows);

    const invMap = Object.fromEntries(investors.map(i => [i.id, i.name]));
    const ctRows = contacts.map(c => ({
      'Investor ID': c.investor_id, 'Investor': invMap[c.investor_id] || '',
      'Navn': c.name || '', 'Tittel': c.title || '', 'E-post': c.email || '',
      'Telefon': c.phone || '', 'Telefon 2': c.phone2 || '', 'Primærkontakt': c.is_primary ? 'Ja' : '', 'Notater': c.notes || '',
    }));
    const wsCt = wb.addWorksheet('Kontakter');
    wsCt.columns = [
      { header: 'Investor ID', key: 'Investor ID', width: 10 }, { header: 'Investor', key: 'Investor', width: 30 },
      { header: 'Navn', key: 'Navn', width: 24 }, { header: 'Tittel', key: 'Tittel', width: 22 },
      { header: 'E-post', key: 'E-post', width: 28 }, { header: 'Telefon', key: 'Telefon', width: 16 },
      { header: 'Telefon 2', key: 'Telefon 2', width: 16 },
      { header: 'Primærkontakt', key: 'Primærkontakt', width: 14 }, { header: 'Notater', key: 'Notater', width: 36 },
    ];
    wsCt.addRows(ctRows);

    const logRows = log.map(l => ({
      'Dato': l.date || '', 'Investor ID': l.investor_id, 'Investor': invMap[l.investor_id] || l.investor_name || '',
      'Type': l.log_type || '', 'Kontaktperson': l.contact_person || '', 'Ansvarlig': l.responsible || '',
      'Emne': l.subject || '', 'Utfall': l.outcome || '', 'Notater': l.notes || '',
    }));
    const wsLog = wb.addWorksheet('Kontaktlogg');
    wsLog.columns = [
      { header: 'Dato', key: 'Dato', width: 12 }, { header: 'Investor ID', key: 'Investor ID', width: 10 },
      { header: 'Investor', key: 'Investor', width: 30 }, { header: 'Type', key: 'Type', width: 10 },
      { header: 'Kontaktperson', key: 'Kontaktperson', width: 22 }, { header: 'Ansvarlig', key: 'Ansvarlig', width: 22 },
      { header: 'Emne', key: 'Emne', width: 36 }, { header: 'Utfall', key: 'Utfall', width: 36 },
      { header: 'Notater', key: 'Notater', width: 50 },
    ];
    wsLog.addRows(logRows);

    return wb;
}

// ── Vendor / SPA fallback ────────────────────────────────────────────────────
app.get('/js/vendor/html2canvas.min.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules', 'html2canvas', 'dist', 'html2canvas.min.js'))
);

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Oppstart ──────────────────────────────────────────────────────────────────
async function init() {
  await initSchema();
  await bootstrapUsers();
  runBackup().catch(e => console.error('[backup] Oppstart-backup feilet:', e.message));
  setInterval(runBackup, 24 * 60 * 60 * 1000);

  runWeeklyExport().catch(e => console.error('[weekly-export] Oppstart-eksport feilet:', e.message));

  // Ukentlig Excel-eksport til disk: mandag kl. 04:00
  cron.schedule('0 4 * * 1', () => {
    runWeeklyExport().catch(e => console.error('[weekly-export] Uventet feil:', e.message));
  }, { timezone: 'Europe/Oslo' });

  app.listen(PORT, () => console.log('ORO CRM → http://localhost:' + PORT));
}

init().catch(err => { console.error('Oppstart feilet:', err.message); process.exit(1); });
