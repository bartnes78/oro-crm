require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const ExcelJS   = require('exceljs');
const { query, pool } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Formathjelpere ────────────────────────────────────────────────────────────
function fmtInvestor(row) {
  if (!row) return null;
  return {
    id:                row.id,
    name:              row.name,
    country:           row.country,
    city:              row.city,
    investor_type:     row.investor_type,
    fund_vehicle:      row.fund_vehicle,
    product_interests: row.product_interests || [],  // populated by caller from product_investors
    phase:             row.phase,
    lead:              row.lead,
    advisor:           row.advisor,
    target_ticket:     row.target_ticket,
    probability:       row.probability,
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
  };
}

function fmtRow(row) {
  if (!row) return null;
  const { id, ...rest } = row;
  return { _id: id, ...rest };
}

function fmtUser(row) {
  if (!row) return null;
  return { _id: row.id, username: row.username, displayName: row.display_name, role: row.role };
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

// ── Passord-hashing ───────────────────────────────────────────────────────────
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

app.use(express.json());
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
app.use('/api', async (req, res, next) => {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="ORO CRM"');
    return res.status(401).json({ error: 'Innlogging kreves' });
  }
  const decoded  = Buffer.from(auth.slice(6), 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);
  try {
    const { rows } = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      // Kallast berre ved reell auth-feil — teller mot brute-force-grensa (15/15 min per IP)
      return authLimiter(req, res, () => {
        res.setHeader('WWW-Authenticate', 'Basic realm="ORO CRM"');
        res.status(401).json({ error: 'Feil brukernavn eller passord' });
      });
    }
    req.currentUser = fmtUser(user);
    next();
  } catch (e) {
    res.status(500).json({ error: 'Auth feilet' });
  }
});

app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'XMLHttpRequest')
    return res.status(403).json({ error: 'Ugyldig forespørsel' });
  next();
});

function requireAdmin(req, res, next) {
  if (req.currentUser?.role !== 'admin')
    return res.status(403).json({ error: 'Kun administratorer har tilgang' });
  next();
}

// ── Validering ────────────────────────────────────────────────────────────────
const VALID_PHASES    = ['Prospekt','Aktiv dialog','Investor','Tidligere investor','På vent'];
const VALID_TYPES     = ['Pensjon','Stiftelse','Family Office','Forsikring','Institusjonell','Pensjonskasse','Private Banking','Rådgiver','Annet'];
const VALID_LOG_TYPES = ['Møte','Telefon','Tapt anrop','E-post mottatt','E-post sendt','Event','Video','Annet','Notat'];
const VALID_LEADS     = ['Kristian Bartnes','Anders Brustad-Nilsen','Nikolai Staubo','Anders Aasand','Gunnar Vestby','Ekstern'];
const VALID_VEHICLES  = ['IS','Feeder','Ikke avklart'];

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}
function validationError(res, errors) {
  return res.status(400).json({ error: errors.join('. ') });
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

// ── Analyse ───────────────────────────────────────────────────────────────────
app.get('/api/analyse', async (req, res) => {
  try {
    const [{ rows: products }, { rows: piRows }, { rows: investors }, { rows: logRows }] = await Promise.all([
      query('SELECT * FROM products ORDER BY id'),
      query(`SELECT pi.product_id, pi.investor_id, pi.target_ticket, pi.probability, pi.committed_amount
             FROM product_investors pi
             WHERE NOT EXISTS (
               SELECT 1 FROM declined_offers d
               WHERE d.investor_id = pi.investor_id AND d.product_id = pi.product_id
             )`),
      query('SELECT id, phase, investor_type FROM investors'),
      query(`SELECT DATE_TRUNC('month', date)::date AS month, COUNT(*)::int AS count, responsible
             FROM contact_log
             WHERE date >= NOW() - INTERVAL '13 months'
             GROUP BY 1, 3 ORDER BY 1`),
    ]);

    const invMap = Object.fromEntries(investors.map(i => [i.id, i]));

    const fundStats = products.map(p => {
      const pis = piRows.filter(pi => pi.product_id === p.id);
      const ticket    = pis.reduce((s, pi) => s + (Number(pi.target_ticket) || 0), 0);
      const weighted  = pis.reduce((s, pi) => s + (pi.target_ticket != null && pi.probability != null
        ? Number(pi.target_ticket) * Number(pi.probability) : 0), 0);
      const signedPis = pis.filter(pi => Number(pi.committed_amount) > 0);
      const signedTicket = signedPis.reduce((s, pi) => s + (Number(pi.committed_amount) || Number(pi.target_ticket) || 0), 0);
      return {
        id: p.id, name: p.name, target_size: p.target_size,
        investorCount: pis.length,
        ticket:       Math.round(ticket * 10) / 10,
        weighted:     Math.round(weighted * 10) / 10,
        signedCount:  signedPis.length,
        signedTicket: Math.round(signedTicket * 10) / 10,
      };
    });

    // Monthly totals (last 12 months)
    const monthTotals = {};
    logRows.forEach(r => {
      const m = String(r.month).slice(0, 7);
      monthTotals[m] = (monthTotals[m] || 0) + r.count;
    });

    // Per-responsible totals
    const respMap = {};
    logRows.forEach(r => {
      if (!r.responsible) return;
      respMap[r.responsible] = (respMap[r.responsible] || 0) + r.count;
    });
    const byResponsible = Object.entries(respMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Phase breakdown with ticket
    const phaseMap = {};
    investors.forEach(i => {
      const p = i.phase || 'Ukjent';
      if (!phaseMap[p]) phaseMap[p] = { phase: p, count: 0 };
      phaseMap[p].count++;
    });
    const byPhase = Object.values(phaseMap).sort((a, b) => b.count - a.count);

    // Investor type with ticket
    const typeMap = {};
    piRows.forEach(pi => {
      const inv = invMap[pi.investor_id];
      if (!inv) return;
      const t = inv.investor_type || 'Ukjent';
      if (!typeMap[t]) typeMap[t] = { type: t, count: 0, ticket: 0 };
      typeMap[t].ticket += Number(pi.target_ticket) || 0;
    });
    investors.forEach(i => {
      const t = i.investor_type || 'Ukjent';
      if (!typeMap[t]) typeMap[t] = { type: t, count: 0, ticket: 0 };
      typeMap[t].count++;
    });
    const byType = Object.values(typeMap)
      .map(t => ({ ...t, ticket: Math.round(t.ticket * 10) / 10 }))
      .sort((a, b) => b.ticket - a.ticket);

    res.json({ fundStats, monthly: monthTotals, byResponsible, byPhase, byType });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/aktivitetslogg', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT date::text AS date, log_type, responsible FROM contact_log WHERE date IS NOT NULL ORDER BY date`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    const [{ rows: investors }, { rows: recent }, { rows: piRows }, { rows: productList }, { rows: piAllRows }] = await Promise.all([
      query('SELECT id, name, phase, investor_type, lead, last_contact, updated_at FROM investors'),
      query('SELECT * FROM contact_log ORDER BY date DESC, created_at DESC LIMIT 8'),
      query(`SELECT pi.investor_id, pi.target_ticket, pi.probability
             FROM product_investors pi
             WHERE pi.target_ticket IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM declined_offers d
               WHERE d.investor_id = pi.investor_id AND d.product_id = pi.product_id
             )`),
      query('SELECT * FROM products'),
      query('SELECT product_id, investor_id FROM product_investors'),
    ]);

    const total = investors.length;

    // Aggregate ticket and weighted from product_investors (per-product values)
    const ticket = piRows.reduce((s, pi) => s + (Number(pi.target_ticket) || 0), 0);
    const wgtd   = piRows.reduce((s, pi) =>
      s + (pi.target_ticket != null && pi.probability != null
        ? Number(pi.target_ticket) * Number(pi.probability) : 0), 0);

    // Per-investor sums for breakdown tables
    const invPiMap = {};
    for (const pi of piRows) {
      if (!invPiMap[pi.investor_id]) invPiMap[pi.investor_id] = { ticket: 0, weighted: 0 };
      invPiMap[pi.investor_id].ticket += Number(pi.target_ticket) || 0;
      if (pi.probability != null)
        invPiMap[pi.investor_id].weighted += Number(pi.target_ticket) * Number(pi.probability);
    }

    const phaseMap = {};
    investors.forEach(i => {
      const p = i.phase || 'Ukjent';
      if (!phaseMap[p]) phaseMap[p] = { phase: p, count: 0, ticket: 0, weighted: 0 };
      phaseMap[p].count++;
      const pi = invPiMap[i.id] || {};
      phaseMap[p].ticket   += pi.ticket   || 0;
      phaseMap[p].weighted += pi.weighted || 0;
    });
    const byPhase = Object.values(phaseMap).sort((a, b) => b.count - a.count);

    const typeMap = {};
    investors.forEach(i => {
      const t = i.investor_type || 'Ukjent';
      if (!typeMap[t]) typeMap[t] = { investor_type: t, count: 0, ticket: 0 };
      typeMap[t].count++;
      typeMap[t].ticket += (invPiMap[i.id] || {}).ticket || 0;
    });
    const byType = Object.values(typeMap).sort((a, b) => b.count - a.count);

    const invsByProduct = {};
    piAllRows.forEach(pi => {
      if (!invsByProduct[pi.product_id]) invsByProduct[pi.product_id] = new Set();
      invsByProduct[pi.product_id].add(pi.investor_id);
    });
    const products = productList.map(p => ({
      _id: p.id, name: p.name,
      count: (invsByProduct[p.id] || new Set()).size,
    }));

    const top10 = investors
      .map(i => ({
        ...fmtInvestor(i),
        target_ticket: (invPiMap[i.id] || {}).ticket  || null,
        weighted:      (invPiMap[i.id] || {}).weighted || null,
      }))
      .filter(i => i.weighted > 0)
      .sort((a, b) => b.weighted - a.weighted)
      .slice(0, 10);

    res.json({ total, ticket: Math.round(ticket * 10) / 10, weighted: Math.round(wgtd * 10) / 10, byPhase, byType, products, top10, recent: recent.map(fmtRow) });
  } catch (e) {
    console.error('[dashboard]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Investorer ────────────────────────────────────────────────────────────────
app.get('/api/investors', async (req, res) => {
  try {
    const { search, phase, type, lead, product, country, city } = req.query;
    const params = [];
    const where  = [];
    let join     = '';

    if (product) {
      params.push(parseInt(product));
      join = `JOIN product_investors pi ON pi.investor_id = i.id AND pi.product_id = $${params.length}`;
    }
    if (search)  { params.push('%' + search + '%');       where.push(`i.name ILIKE $${params.length}`); }
    if (phase)   { params.push(phase);                    where.push(`i.phase = $${params.length}`); }
    if (type)    { params.push(type);                     where.push(`i.investor_type = $${params.length}`); }
    if (lead)    { params.push(lead);                     where.push(`i.lead = $${params.length}`); }
    if (country) { params.push(country);                  where.push(`i.country = $${params.length}`); }
    if (city)    { params.push('%' + city + '%');          where.push(`i.city ILIKE $${params.length}`); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    let { rows } = await query(`SELECT i.* FROM investors i ${join} ${whereClause}`, params);

    if (product) {
      const pid = parseInt(product);
      const { rows: piRows } = await query('SELECT * FROM product_investors WHERE product_id = $1', [pid]);
      const piMap = Object.fromEntries(piRows.map(pi => [pi.investor_id, pi]));
      rows = rows.map(inv => {
        const pi = piMap[inv.id];
        return {
          ...inv,
          target_ticket:    pi?.target_ticket    ?? null,
          probability:      pi?.probability      ?? null,
          decline_reason:   pi?.decline_reason   ?? null,
          committed_amount: pi?.committed_amount ?? null,
        };
      });
    }

    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const { rows: piAll } = await query(
        'SELECT investor_id, product_id FROM product_investors WHERE investor_id = ANY($1)', [ids]
      );
      const piMap = {};
      piAll.forEach(pi => {
        if (!piMap[pi.investor_id]) piMap[pi.investor_id] = [];
        piMap[pi.investor_id].push(pi.product_id);
      });
      rows = rows.map(r => ({ ...r, product_interests: (piMap[r.id] || []).sort((a, b) => a - b) }));
    }

    rows.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    res.json(rows.map(fmtInvestor));
  } catch (e) {
    console.error('[GET /investors]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/locations', async (req, res) => {
  try {
    const { rows } = await query('SELECT DISTINCT country, city FROM investors');
    const countries = [...new Set(rows.map(r => r.country).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nb'));
    const cities    = [...new Set(rows.map(r => r.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nb'));
    res.json({ countries, cities });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/investors', async (req, res) => {
  const errors = validateInvestorBody(req.body, true);
  if (errors.length) return validationError(res, errors);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: last } = await client.query(`SELECT id FROM investors WHERE id ~ '^INV-\\d+$' ORDER BY CAST(SUBSTRING(id FROM 5) AS INTEGER) DESC LIMIT 1`);
    const maxNum = last.length ? parseInt(last[0].id.slice(4)) : 0;
    const id = 'INV-' + String(maxNum + 1).padStart(3, '0');

    const { rows: [inv] } = await client.query(`
      INSERT INTO investors
        (id, name, country, city, investor_type, fund_vehicle,
         phase, lead, advisor, first_close, next_steps, comments, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING *
    `, [
      id, String(req.body.name).trim(), req.body.country || 'Norge', req.body.city || null,
      req.body.investor_type || null, null,
      req.body.phase || 'Prospekt', req.body.lead || null, req.body.advisor || null, 0,
      req.body.next_steps || null, req.body.comments || null,
    ]);
    const interests = Array.isArray(req.body.product_interests) ? req.body.product_interests : [];
    if (interests.length > 0) {
      await Promise.all(interests.map(pid =>
        client.query('INSERT INTO product_investors (product_id, investor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [pid, id])
      ));
    }
    await client.query('COMMIT');
    res.json({ ...fmtInvestor(inv), product_interests: interests });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /investors]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/investors/:id', async (req, res) => {
  try {
    const { rows: invRows } = await query('SELECT * FROM investors WHERE id = $1', [req.params.id]);
    if (!invRows[0]) return res.status(404).json({ error: 'Not found' });
    const [{ rows: contacts }, { rows: log }, { rows: piRows }, { rows: declinedRows }] = await Promise.all([
      query('SELECT * FROM contacts WHERE investor_id = $1 ORDER BY is_primary DESC', [req.params.id]),
      query('SELECT * FROM contact_log WHERE investor_id = $1 ORDER BY date DESC', [req.params.id]),
      query('SELECT product_id FROM product_investors WHERE investor_id = $1', [req.params.id]),
      query('SELECT product_id, decline_reason, declined_at FROM declined_offers WHERE investor_id = $1 ORDER BY declined_at DESC', [req.params.id]),
    ]);
    const inv = {
      ...invRows[0],
      product_interests: piRows.map(r => r.product_id).sort((a, b) => a - b),
      declined_offers:   declinedRows,
    };
    res.json({ ...fmtInvestor(inv), contacts: contacts.map(fmtRow), log: log.map(fmtRow) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/investors/:id', async (req, res) => {
  const errors = validateInvestorBody(req.body, false);
  if (errors.length) return validationError(res, errors);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM investors WHERE id = $1', [req.params.id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const cur = rows[0];
    const b   = req.body;
    const v   = k => (k in b ? b[k] : cur[k]);
    const vNull = k => (k in b ? (b[k] || null) : cur[k]);

    const { rows: [updated] } = await client.query(`
      UPDATE investors SET
        name=$2, country=$3, city=$4, investor_type=$5, fund_vehicle=$6,
        phase=$7, lead=$8, advisor=$9,
        first_close=$10, source=$11,
        next_steps=$12, last_contact=$13, doc_shared=$14, meeting_date=$15,
        comments=$16, docs=$17, updated_at=NOW()
      WHERE id=$1 RETURNING *
    `, [
      req.params.id,
      v('name'), v('country'), vNull('city'), vNull('investor_type'), vNull('fund_vehicle'),
      v('phase'), vNull('lead'), vNull('advisor'),
      v('first_close') || 0, vNull('source'), vNull('next_steps'),
      vNull('last_contact'), vNull('doc_shared'), vNull('meeting_date'), vNull('comments'),
      JSON.stringify('docs' in b ? (b.docs || {}) : (cur.docs || {})),
    ]);

    let newInterests = null;
    if ('product_interests' in b) {
      const newIds = (Array.isArray(b.product_interests) ? b.product_interests : []).map(Number);
      const { rows: existing } = await client.query('SELECT product_id FROM product_investors WHERE investor_id = $1', [req.params.id]);
      const existingIds = existing.map(r => r.product_id);
      const toAdd    = newIds.filter(id => !existingIds.includes(id));
      const toRemove = existingIds.filter(id => !newIds.includes(id));
      if (toAdd.length > 0)
        await Promise.all(toAdd.map(pid =>
          client.query('INSERT INTO product_investors (product_id, investor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [pid, req.params.id])
        ));
      if (toRemove.length > 0)
        await client.query('DELETE FROM product_investors WHERE investor_id=$1 AND product_id=ANY($2)', [req.params.id, toRemove]);
      newInterests = newIds;
    } else {
      const { rows: piRows } = await client.query('SELECT product_id FROM product_investors WHERE investor_id = $1', [req.params.id]);
      newInterests = piRows.map(r => r.product_id).sort((a, b) => a - b);
    }

    await client.query('COMMIT');
    res.json({ ...fmtInvestor(updated), product_interests: newInterests });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[PUT /investors]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.delete('/api/investors/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const { rows } = await query('SELECT id FROM investors WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Investor ikke funnet' });
    await query('DELETE FROM investors WHERE id = $1', [id]); // CASCADE sletter contacts, contact_log, tasks, product_investors, declined_offers
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Duplikater ────────────────────────────────────────────────────────────────
function normalizeName(name) {
  return (name || '').toLowerCase()
    .replace(/[.,\(\)\/\-]/g, ' ')
    .replace(/\b(as|asa|is|sa|ans|pk|ab|spk)\b/g, ' ')
    .replace(/\b(pensjonskasse|pensjon|stiftelse|fond|fondet|forsikring|livsforsikring|kapitalforvaltning|kommunale|kommune|private|banking|management|drift|holding|group|gruppen|invest)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function jaccard(a, b) {
  const sa = new Set(a.split(' ').filter(x => x.length > 1));
  const sb = new Set(b.split(' ').filter(x => x.length > 1));
  if (!sa.size || !sb.size) return 0;
  const inter = [...sa].filter(x => sb.has(x)).length;
  return inter / new Set([...sa, ...sb]).size;
}

app.get('/api/duplicates', async (req, res) => {
  try {
    const { rows: investors } = await query('SELECT * FROM investors');
    const pairs = [];
    for (let i = 0; i < investors.length; i++) {
      for (let j = i + 1; j < investors.length; j++) {
        const score = jaccard(normalizeName(investors[i].name), normalizeName(investors[j].name));
        if (score >= 0.6) pairs.push({ score: Math.round(score * 100), a: fmtInvestor(investors[i]), b: fmtInvestor(investors[j]) });
      }
    }
    res.json(pairs.sort((a, b) => b.score - a.score));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/duplicate-contacts', async (req, res) => {
  try {
    const [{ rows: contacts }, { rows: investors }] = await Promise.all([
      query('SELECT * FROM contacts'),
      query('SELECT id, name FROM investors'),
    ]);
    const invMap = Object.fromEntries(investors.map(i => [i.id, i.name]));
    const groups = [];

    const byInvName = {};
    contacts.forEach(c => {
      const key = c.investor_id + '||' + (c.name || '').trim().toLowerCase();
      if (!byInvName[key]) byInvName[key] = [];
      byInvName[key].push(fmtRow(c));
    });
    Object.values(byInvName).forEach(cs => {
      if (cs.length > 1) groups.push({ type: 'exact', label: 'Samme navn, samme investor',
        investor_name: invMap[cs[0].investor_id] || cs[0].investor_id,
        investor_id: cs[0].investor_id, contacts: cs });
    });

    const byEmail = {};
    contacts.forEach(c => {
      const e = (c.email || '').trim().toLowerCase();
      if (!e) return;
      if (!byEmail[e]) byEmail[e] = [];
      byEmail[e].push(fmtRow(c));
    });
    Object.entries(byEmail).forEach(([email, cs]) => {
      if (cs.length > 1) {
        const investorIds = [...new Set(cs.map(c => c.investor_id))];
        groups.push({ type: 'email', label: 'Samme e-postadresse', email,
          investor_ids: investorIds,
          investor_names: investorIds.map(id => invMap[id] || id),
          contacts: cs.map(c => ({ ...c, investor_name: invMap[c.investor_id] || c.investor_id })) });
      }
    });

    res.json(groups.sort((a, b) => (a.type === 'exact' ? -1 : 1)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/merge', async (req, res) => {
  const { keep_id, drop_id } = req.body;
  if (!keep_id || !drop_id) return res.status(400).json({ error: 'keep_id og drop_id er påkrevd' });

  const client = await pool.connect();
  try {
    const [{ rows: keepRows }, { rows: dropRows }] = await Promise.all([
      client.query('SELECT * FROM investors WHERE id = $1', [keep_id]),
      client.query('SELECT * FROM investors WHERE id = $1', [drop_id]),
    ]);
    if (!keepRows[0] || !dropRows[0]) return res.status(404).json({ error: 'Investor ikke funnet' });

    const keep = keepRows[0];
    const drop = dropRows[0];
    const merged = { ...keep };
    for (const key of Object.keys(drop)) {
      if (key === 'id' || key === 'updated_at') continue;
      if (merged[key] == null || merged[key] === '' || merged[key] === 0) {
        if (drop[key] != null && drop[key] !== '' && drop[key] !== 0) merged[key] = drop[key];
      }
    }
    if (keep.comments && drop.comments && keep.comments !== drop.comments)
      merged.comments = keep.comments + ' | ' + drop.comments;

    await client.query('BEGIN');
    await client.query(`
      UPDATE investors SET name=$2, country=$3, city=$4, investor_type=$5, phase=$6, lead=$7,
        advisor=$8, comments=$9, updated_at=NOW()
      WHERE id=$1
    `, [keep_id, merged.name, merged.country, merged.city, merged.investor_type, merged.phase,
        merged.lead, merged.advisor, merged.comments]);
    await client.query('UPDATE contacts SET investor_id=$1 WHERE investor_id=$2', [keep_id, drop_id]);
    await client.query('UPDATE contact_log SET investor_id=$1, investor_name=$2 WHERE investor_id=$3', [keep_id, keep.name, drop_id]);
    await client.query('UPDATE tasks SET investor_id=$1, investor_name=$2 WHERE investor_id=$3', [keep_id, keep.name, drop_id]);
    // Kopier drop's produktkoblinger til keep — behold keep's verdier ved konflikt
    await client.query(`
      INSERT INTO product_investors (product_id, investor_id, target_ticket, probability, committed_amount, decline_reason)
      SELECT product_id, $1, target_ticket, probability, committed_amount, decline_reason
      FROM product_investors WHERE investor_id = $2
      ON CONFLICT (product_id, investor_id) DO NOTHING
    `, [keep_id, drop_id]);
    await client.query('DELETE FROM investors WHERE id=$1', [drop_id]);
    await client.query('COMMIT');

    const { rows: [final] } = await client.query('SELECT * FROM investors WHERE id=$1', [keep_id]);
    const { rows: finalPi } = await client.query('SELECT product_id FROM product_investors WHERE investor_id=$1', [keep_id]);
    res.json({ ok: true, merged: { ...fmtInvestor(final), product_interests: finalPi.map(r => r.product_id).sort((a, b) => a - b) } });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[merge]', e.message);
    res.status(500).json({ error: 'Sammenslåing feilet' });
  } finally {
    client.release();
  }
});

// ── Kontakter ─────────────────────────────────────────────────────────────────
app.get('/api/contacts', async (req, res) => {
  try {
    const sql    = req.query.investorId
      ? 'SELECT * FROM contacts WHERE investor_id = $1 ORDER BY is_primary DESC'
      : 'SELECT * FROM contacts ORDER BY is_primary DESC';
    const params = req.query.investorId ? [req.query.investorId] : [];
    const { rows } = await query(sql, params);
    res.json(rows.map(fmtRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/contacts', async (req, res) => {
  const errors = [];
  if (!String(req.body.investor_id || '').trim()) errors.push('investor_id er påkrevd');
  if (!String(req.body.name || '').trim())        errors.push('Navn er påkrevd');
  if (errors.length) return validationError(res, errors);
  try {
    const { rows: [c] } = await query(`
      INSERT INTO contacts (investor_id, name, title, email, phone, is_primary, notes, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [req.body.investor_id, req.body.name, req.body.title || null,
        req.body.email || null, req.body.phone || null, req.body.is_primary || 0, req.body.notes || null,
        req.body.active ?? 1]);
    res.json(fmtRow(c));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/contacts/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM contacts WHERE id = $1', [parseInt(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const cur = rows[0];
    const b   = req.body;
    const v   = k => (k in b ? b[k] : cur[k]);
    const { rows: [c] } = await query(`
      UPDATE contacts SET investor_id=$2, name=$3, title=$4, email=$5, phone=$6, is_primary=$7, notes=$8, active=$9
      WHERE id=$1 RETURNING *
    `, [parseInt(req.params.id), v('investor_id'), v('name'), v('title') || null,
        v('email') || null, v('phone') || null, v('is_primary') || 0, v('notes') || null,
        'active' in b ? (b.active ?? 1) : (cur.active ?? 1)]);
    res.json(fmtRow(c));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/contacts/:id', async (req, res) => {
  try {
    await query('DELETE FROM contacts WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/contacts/merge', async (req, res) => {
  const { keep_id, drop_id } = req.body || {};
  if (!keep_id || !drop_id || keep_id === drop_id) return res.status(400).json({ error: 'Ugyldig merge-forespørsel' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM contacts WHERE id = ANY($1)', [[parseInt(keep_id), parseInt(drop_id)]]);
    const keep = rows.find(r => r.id === parseInt(keep_id));
    const drop = rows.find(r => r.id === parseInt(drop_id));
    if (!keep || !drop) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Kontakt ikke funnet' }); }
    // Merge: keep wins, fill nulls from drop
    await client.query(`
      UPDATE contacts SET
        title     = COALESCE(NULLIF(title,''), $2),
        email     = COALESCE(NULLIF(email,''), $3),
        phone     = COALESCE(NULLIF(phone,''), $4),
        notes     = CASE WHEN notes IS NOT NULL AND notes <> '' AND $5::TEXT IS NOT NULL AND $5::TEXT <> ''
                         THEN notes || E'\n' || $5::TEXT
                         ELSE COALESCE(NULLIF(notes,''), $5::TEXT) END
      WHERE id = $1
    `, [parseInt(keep_id), drop.title, drop.email, drop.phone, drop.notes]);
    await client.query('DELETE FROM contacts WHERE id = $1', [parseInt(drop_id)]);
    await client.query('COMMIT');
    const { rows: [merged] } = await client.query('SELECT * FROM contacts WHERE id = $1', [parseInt(keep_id)]);
    res.json(fmtRow(merged));
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── Kontaktlogg ───────────────────────────────────────────────────────────────
app.get('/api/log', async (req, res) => {
  try {
    let sql    = 'SELECT * FROM contact_log';
    const params = [];
    if (req.query.investorId) { params.push(req.query.investorId); sql += ` WHERE investor_id = $1`; }
    sql += ' ORDER BY date DESC, created_at DESC';
    if (req.query.limit) { params.push(parseInt(req.query.limit)); sql += ` LIMIT $${params.length}`; }
    const { rows } = await query(sql, params);
    res.json(rows.map(fmtRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/log', async (req, res) => {
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
    res.json(fmtRow(entry));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /log]', e.message);
    res.status(500).json({ error: 'Kunne ikke lagre — prøv igjen' });
  } finally {
    client.release();
  }
});

app.put('/api/log/:id', async (req, res) => {
  if (req.body.date && !isValidDate(req.body.date)) return validationError(res, ['Ugyldig dato']);
  if (req.body.log_type && !VALID_LOG_TYPES.includes(req.body.log_type)) return validationError(res, [`Ugyldig type: ${req.body.log_type}`]);
  try {
    const { rows } = await query('SELECT * FROM contact_log WHERE id = $1', [parseInt(req.params.id)]);
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
    `, [parseInt(req.params.id), v('investor_id'), v('investor_name') || null, v('date'),
        v('log_type') || null, v('contact_person') || null, v('responsible') || null,
        v('subject') || null, v('outcome') || null, v('notes') || null,
        v('status') || null, declinedProducts]);
    res.json(fmtRow(entry));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/log/:id', async (req, res) => {
  try {
    await query('DELETE FROM contact_log WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Oppgaver ──────────────────────────────────────────────────────────────────
app.get('/api/tasks', async (req, res) => {
  try {
    const params = [];
    const where  = [];
    if (req.query.investorId) { params.push(String(req.query.investorId)); where.push(`investor_id = $${params.length}`); }
    if (req.query.done !== undefined) { params.push(parseInt(req.query.done)); where.push(`done = $${params.length}`); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const { rows } = await query(`SELECT * FROM tasks ${whereClause} ORDER BY due_date`, params);
    res.json(rows.map(fmtRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks', async (req, res) => {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/tasks/:id', async (req, res) => {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await query('DELETE FROM tasks WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Brukere ───────────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => res.json(req.currentUser));

app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM users ORDER BY id');
    res.json(rows.map(fmtUser));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, displayName, password, role } = req.body;
  const errors = [];
  if (!String(username    || '').trim()) errors.push('Brukernavn er påkrevd');
  if (!String(displayName || '').trim()) errors.push('Visningsnavn er påkrevd');
  if (!String(password    || '').trim()) errors.push('Passord er påkrevd');
  if (!['admin','bruker'].includes(role)) errors.push('Ugyldig rolle');
  if (errors.length) return validationError(res, errors);
  try {
    const { rows: [u] } = await query(`
      INSERT INTO users (username, display_name, role, password_hash)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [username.trim(), displayName.trim(), role, hashPassword(password)]);
    res.json(fmtUser(u));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Brukernavnet er allerede i bruk' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Bruker ikke funnet' });
    const cur = rows[0];
    const { displayName, password, role } = req.body;
    const newDisplayName = displayName ? displayName.trim() : cur.display_name;
    const newRole        = role && ['admin','bruker'].includes(role) ? role : cur.role;
    const newHash        = password && password.trim() ? hashPassword(password) : cur.password_hash;
    const { rows: [u] } = await query(`
      UPDATE users SET display_name=$2, role=$3, password_hash=$4 WHERE id=$1 RETURNING *
    `, [id, newDisplayName, newRole, newHash]);
    res.json(fmtUser(u));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.currentUser._id) return res.status(400).json({ error: 'Du kan ikke slette din egen konto' });
  try {
    const { rows } = await query('SELECT id FROM users WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Bruker ikke funnet' });
    await query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Lookups ───────────────────────────────────────────────────────────────────
app.get('/api/lookups', (req, res) => res.json({
  phases:   VALID_PHASES,
  types:    VALID_TYPES,
  vehicles: VALID_VEHICLES,
  logTypes: VALID_LOG_TYPES,
  leads:    VALID_LEADS,
  advisors: ['Grieg Investor','Mercer','Gabler','Formue','Industrifinans','Søderberg','DNB','Nordea','Handelsbanken','Intervalor'],
}));

// ── Produkt-investorer ────────────────────────────────────────────────────────
app.get('/api/product-investors', async (req, res) => {
  const { investorId } = req.query;
  if (!investorId) return res.status(400).json({ error: 'investorId er påkrevd' });
  try {
    const { rows } = await query('SELECT * FROM product_investors WHERE investor_id = $1', [investorId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/product-investors', async (req, res) => {
  const { product_id, investor_id, ...fields } = req.body;
  if (!product_id || !investor_id) return validationError(res, ['product_id og investor_id er påkrevd']);

  // Validate numeric fields only when explicitly sent and non-empty
  if ('target_ticket' in fields && fields.target_ticket != null && fields.target_ticket !== '') {
    const t = parseFloat(fields.target_ticket);
    if (isNaN(t) || t < 0) return validationError(res, ['Målticket må være et positivt tall']);
    fields.target_ticket = t;
  } else if ('target_ticket' in fields) { fields.target_ticket = null; }

  if ('probability' in fields && fields.probability != null && fields.probability !== '') {
    const p = parseFloat(fields.probability);
    if (isNaN(p) || p < 0 || p > 1) return validationError(res, ['Sannsynlighet må være mellom 0 og 1']);
    fields.probability = p;
  } else if ('probability' in fields) { fields.probability = null; }

  if ('committed_amount' in fields && fields.committed_amount != null && fields.committed_amount !== '') {
    const c = parseFloat(fields.committed_amount);
    if (isNaN(c) || c < 0) return validationError(res, ['Innbetalt beløp må være et positivt tall']);
    fields.committed_amount = c;
  } else if ('committed_amount' in fields) { fields.committed_amount = null; }

  // Only update fields that were explicitly sent — allows clearing to null
  const allowed = ['target_ticket', 'probability', 'decline_reason', 'committed_amount'];
  const sent = allowed.filter(f => f in fields);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Ensure row exists
    await client.query(
      'INSERT INTO product_investors (product_id, investor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [parseInt(product_id), investor_id]
    );
    // Update only the fields that were sent (null = explicit clear)
    if (sent.length > 0) {
      const setParts = sent.map((f, i) => `${f} = $${i + 3}`);
      await client.query(
        `UPDATE product_investors SET ${setParts.join(', ')} WHERE product_id=$1 AND investor_id=$2`,
        [parseInt(product_id), investor_id, ...sent.map(f => fields[f] ?? null)]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── Produkter ─────────────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM products ORDER BY id');
    res.json(rows.map(r => ({ ...fmtRow(r) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products', async (req, res) => {
  if (!String(req.body.name || '').trim()) return validationError(res, ['Produktnavn er påkrevd']);
  try {
    const { rows: [p] } = await query(`
      INSERT INTO products (name, type, status, target_size, description)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [req.body.name, req.body.type || null, req.body.status || null,
        req.body.target_size || null, req.body.description || null]);
    res.json(fmtRow(p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { rows } = await query('SELECT * FROM products WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const cur = rows[0];
    const b   = req.body;
    const v   = k => (k in b ? b[k] : cur[k]);
    const { rows: [p] } = await query(`
      UPDATE products SET name=$2, type=$3, status=$4, target_size=$5, description=$6
      WHERE id=$1 RETURNING *
    `, [id, v('name'), v('type') || null, v('status') || null,
        v('target_size') || null, v('description') || null]);
    res.json(fmtRow(p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await query('DELETE FROM products WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Backup API ────────────────────────────────────────────────────────────────
app.get('/api/backups', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT DISTINCT stamp FROM backups ORDER BY stamp DESC');
    res.json(rows.map(r => ({
      stamp: r.stamp,
      label: r.stamp.replace('_', ' ').replace(/-/g, ':').replace(':', '-').replace(':', '-'),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/backups/restore/:stamp', requireAdmin, async (req, res) => {
  const { stamp } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(stamp))
    return res.status(400).json({ error: 'Ugyldig backup-tidsstempel' });

  const { rows: exists } = await query('SELECT 1 FROM backups WHERE stamp = $1 LIMIT 1', [stamp]);
  if (!exists.length) return res.status(404).json({ error: 'Backup ikke funnet' });

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
    const SKIP_COLS = new Set(['product_interests']); // fjernet kolonne — backups tatt før migrering
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
    res.json({ ok: true, restored });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[restore]', e.message);
    res.status(500).json({ error: 'Gjenoppretting feilet: ' + e.message });
  } finally {
    client.release();
  }
});

// ── Admin: seed pensjon-investorer inn i ORO Areal ────────────────────────────
app.post('/api/admin/seed-pensjon-oro-areal', requireAdmin, async (req, res) => {
  try {
    // Finn ORO Areal-produktet
    const { rows: products } = await query(`SELECT id FROM products WHERE name ILIKE '%ORO Areal%' LIMIT 1`);
    if (products.length === 0) return res.status(404).json({ error: 'Fant ikke produkt med navn "ORO Areal"' });
    const productId = products[0].id;

    // Finn alle investorer med investor_type = 'Pensjon' (case-insensitive)
    const { rows: investors } = await query(`SELECT id FROM investors WHERE investor_type ILIKE '%pensjon%'`);
    if (investors.length === 0) return res.json({ ok: true, inserted: 0, message: 'Ingen investorer med type "pensjon" funnet' });

    let inserted = 0;
    for (const inv of investors) {
      const r = await query(
        `INSERT INTO product_investors (product_id, investor_id, target_ticket, probability)
         VALUES ($1, $2, 50, 0.05)
         ON CONFLICT (product_id, investor_id) DO NOTHING`,
        [productId, inv.id]
      );
      if (r.rowCount > 0) inserted++;
    }

    res.json({ ok: true, productId, investorCount: investors.length, inserted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Avslåtte tilbud ───────────────────────────────────────────────────────────
app.get('/api/declined-offers', async (req, res) => {
  const productId = parseInt(req.query.productId);
  if (!productId) return validationError(res, ['productId påkrevd']);
  try {
    const { rows } = await query(
      `SELECT d.id, d.product_id, d.investor_id, d.decline_reason, d.declined_at,
              i.name AS investor_name, i.lead, i.last_contact,
              pi.target_ticket
       FROM declined_offers d
       JOIN investors i ON i.id = d.investor_id
       LEFT JOIN product_investors pi ON pi.investor_id = d.investor_id AND pi.product_id = d.product_id
       WHERE d.product_id = $1
       ORDER BY d.declined_at DESC NULLS LAST, i.name`,
      [productId]
    );
    res.json(rows.map(fmtRow));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/declined-offers', async (req, res) => {
  const { product_id, investor_id, decline_reason, declined_at } = req.body;
  if (!product_id || !investor_id) return validationError(res, ['product_id og investor_id påkrevd']);
  try {
    const { rows } = await query(
      `INSERT INTO declined_offers (product_id, investor_id, decline_reason, declined_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, investor_id) DO UPDATE
         SET decline_reason = EXCLUDED.decline_reason,
             declined_at    = EXCLUDED.declined_at
       RETURNING *`,
      [product_id, investor_id, decline_reason || null, declined_at || null]
    );
    res.json(fmtRow(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/declined-offers/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return validationError(res, ['Ugyldig id']);
  try {
    await query('DELETE FROM declined_offers WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
app.get('/api/export/excel', async (req, res) => {
  try {
    const [{ rows: investors }, { rows: contacts }, { rows: log }, { rows: products }, { rows: piRows }] = await Promise.all([
      query('SELECT * FROM investors ORDER BY name'),
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
      'Telefon': c.phone || '', 'Primærkontakt': c.is_primary ? 'Ja' : '', 'Notater': c.notes || '',
    }));
    const wsCt = wb.addWorksheet('Kontakter');
    wsCt.columns = [
      { header: 'Investor ID', key: 'Investor ID', width: 10 }, { header: 'Investor', key: 'Investor', width: 30 },
      { header: 'Navn', key: 'Navn', width: 24 }, { header: 'Tittel', key: 'Tittel', width: 22 },
      { header: 'E-post', key: 'E-post', width: 28 }, { header: 'Telefon', key: 'Telefon', width: 16 },
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

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', `attachment; filename="ORO_CRM_${new Date().toISOString().slice(0,10)}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) {
    console.error('[export]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Oppstart ──────────────────────────────────────────────────────────────────
async function init() {
  await initSchema();
  await bootstrapUsers();
  runBackup().catch(e => console.error('[backup] Oppstart-backup feilet:', e.message));
  setInterval(runBackup, 24 * 60 * 60 * 1000);
  app.listen(PORT, () => console.log('ORO CRM → http://localhost:' + PORT));
}

init().catch(err => { console.error('Oppstart feilet:', err.message); process.exit(1); });
