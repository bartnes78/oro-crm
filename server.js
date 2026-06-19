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
const { runBackup, runWeeklyExport } = require('./lib/backup');

const app  = express();
const PORT = process.env.PORT || 3001;

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
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'"],
    },
  },
  crossOriginOpenerPolicy: false,
}));

const apiCors = cors({ origin: false });

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  validate: { ip: false },
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html'))
      res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use((req, res, next) => {
  if (req.path.startsWith('/api') && !['GET','HEAD','OPTIONS'].includes(req.method)) {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).json({ error: 'Mangler X-Requested-With header' });
    }
  }
  next();
});

// ── Auth-middleware ───────────────────────────────────────────────────────────
app.use('/api', apiCors, apiLimiter);

app.use('/api', session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      console.error('SESSION_SECRET er påkrevd i produksjon');
      process.exit(1);
    }
    return crypto.randomBytes(32).toString('hex');
  })(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

app.use('/api', (req, res, next) => {
  if (req.path === '/login') return next();
  if (!req.session?.userId) return res.status(401).json({ error: 'Ikke innlogget' });
  next();
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Brukernavn og passord er påkrevd' });
  try {
    const { rows } = await query('SELECT * FROM users WHERE username = $1', [username]);
    if (!rows[0]) {
      authLimiter._handler?.(req, res);
      return res.status(401).json({ error: 'Feil brukernavn eller passord' });
    }
    if (!verifyPassword(password, rows[0].password_hash)) {
      authLimiter._handler?.(req, res);
      return res.status(401).json({ error: 'Feil brukernavn eller passord' });
    }
    req.session.userId = rows[0].id;
    res.json(fmtUser(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Utlogging feilet' });
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.use('/api', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    if (!rows[0]) return res.status(401).json({ error: 'Bruker ikke funnet' });
    req.currentUser = fmtUser(rows[0]);
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use('/api', (req, res, next) => {
  if (req.currentUser.mustChangePassword) {
    const allowed = ['/me', '/me/password', '/logout'];
    const isAllowed = allowed.some(p =>
      req.path === p || (req.path.startsWith('/me') && req.method === 'GET')
    );
    if (!isAllowed) return res.status(403).json({ error: 'Du må bytte passord først', mustChangePassword: true });
  }
  next();
});

// ── Ruter ─────────────────────────────────────────────────────────────────────
app.use(require('./routes/dashboard'));
app.use(require('./routes/brreg'));
app.use(require('./routes/investors'));
app.use(require('./routes/contacts'));
app.use(require('./routes/log'));
app.use(require('./routes/tasks'));
app.use(require('./routes/users'));
app.use(require('./routes/products'));
app.use(require('./routes/admin'));

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Oppstart ──────────────────────────────────────────────────────────────────
async function init() {
  await initSchema();
  await bootstrapUsers();
  runBackup().catch(e => console.error('[backup] Oppstart-backup feilet:', e.message));
  setInterval(runBackup, 24 * 60 * 60 * 1000);

  runWeeklyExport().catch(e => console.error('[weekly-export] Oppstart-eksport feilet:', e.message));

  cron.schedule('0 4 * * 1', () => {
    runWeeklyExport().catch(e => console.error('[weekly-export] Uventet feil:', e.message));
  }, { timezone: 'Europe/Oslo' });

  app.listen(PORT, () => console.log('ORO CRM → http://localhost:' + PORT));
}

module.exports = app;

if (require.main === module) {
  init().catch(err => { console.error('Oppstart feilet:', err.message); process.exit(1); });
}
