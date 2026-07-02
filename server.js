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
const cron      = require('node-cron');
const { query, pool } = require('./db');
const { fmtUser, hashPassword, verifyPassword } = require('./lib/helpers');
const { buildExcelWorkbook } = require('./lib/excel');

const app  = express();
const PORT = process.env.PORT || 3001;

// Uten disse dør prosessen stille ved en uoppfanget async-feil (ingen stack i loggen).
// uncaughtException etterlater prosessen i udefinert tilstand → logg stack og avslutt
// (nodemon/Railway restarter). unhandledRejection er som regel gjenopprettelig → logg, men lev videre.
process.on('uncaughtException', err => {
  console.error('[FATAL] uncaughtException:', err && err.stack || err);
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  console.error('[FATAL] unhandledRejection:', reason && reason.stack || reason);
});

// ── Backup ────────────────────────────────────────────────────────────────────
// Returnerer true/false så kallere (f.eks. restore) kan avbryte hvis sikkerhetsbackupen feiler.
async function runBackup() {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const tables = [
    'investors', 'contacts', 'contact_log', 'tasks',
    'products', 'product_investors', 'declined_offers', 'users',
    'audit_log', 'feedback_reports',
  ];
  // Skjermbilder (base64, opptil 8 MB per rapport) ville blåst opp backups-tabellen ×10 snapshots
  const selectOverride = {
    feedback_reports: 'SELECT id, page, comment, username, created_at FROM feedback_reports',
  };
  try {
    for (const name of tables) {
      const { rows } = await query(selectOverride[name] || `SELECT * FROM ${name}`);
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
    return true;
  } catch (e) {
    console.error('[backup] Feilet:', e.message);
    return false;
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

// ── Helse og versjon — uautentisert, registrert før session/auth-kjeden ──────
// Eksponerer ingen data: health = «lever prosessen + svarer DB», version = git-SHA.
const APP_VERSION = process.env.RAILWAY_GIT_COMMIT_SHA || 'dev';

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'Database utilgjengelig' });
  }
});

app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));

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
app.use(require('./routes/admin')({ runBackup }));

// ── E-post (MSG-parsing) ─────────────────────────────────────────────────────
app.use(require('./routes/email'));

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

  const server = app.listen(PORT, () => console.log('ORO CRM → http://localhost:' + PORT));
  // Under rask redigering rekker ikke den gamle nodemon-prosessen alltid å frigi
  // porten før den nye starter → EADDRINUSE. Uten denne listeneren ble det en
  // uoppfanget exception som drepte prosessen uten lesbar stack.
  server.on('error', err => {
    if (err.code === 'EADDRINUSE')
      console.error(`[oppstart] Port ${PORT} er opptatt — venter på at forrige prosess frigir den.`);
    else
      console.error('[oppstart] Server-feil:', err.stack || err.message);
    process.exit(1);
  });

  // Railway sender SIGTERM ved hver redeploy — la pågående forespørsler fullføre
  // før prosessen dør, i stedet for å kappe dem midt i en transaksjon.
  process.on('SIGTERM', () => {
    console.log('[shutdown] SIGTERM mottatt — stenger for nye tilkoblinger');
    server.close(() => {
      pool.end().then(() => process.exit(0)).catch(() => process.exit(0));
    });
    setTimeout(() => {
      console.error('[shutdown] Tidsavbrudd — tvinger avslutning');
      process.exit(0);
    }, 10000).unref();
  });
}

// Kun ved direkte kjøring (node server.js / nodemon) — ved require fra tester
// importeres `app` ferdig kablet uten å starte schema-init, backup, cron og listen.
if (require.main === module)
  init().catch(err => { console.error('Oppstart feilet:', err.message); process.exit(1); });

module.exports = app;
