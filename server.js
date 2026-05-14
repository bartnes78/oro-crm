require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const XLSX    = require('xlsx');
const { read, write, writeAsync, nextId } = require('./db');

// ── Backup ────────────────────────────────────────────────────────────────────
const DATA_DIR   = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function runBackup() {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const tables = ['investors', 'contacts', 'contact_log', 'tasks', 'products', 'product_investors', 'users'];
  tables.forEach(t => {
    const src = path.join(DATA_DIR, `${t}.json`);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(BACKUP_DIR, `${stamp}_${t}.json`));
    }
  });
  // Behold kun de 10 siste backup-settene (10 × 7 filer = 70 filer)
  const files = fs.readdirSync(BACKUP_DIR).sort();
  const stamps = [...new Set(files.map(f => f.slice(0, 19)))];
  if (stamps.length > 10) {
    stamps.slice(0, stamps.length - 10).forEach(old => {
      files.filter(f => f.startsWith(old)).forEach(f =>
        fs.unlinkSync(path.join(BACKUP_DIR, f))
      );
    });
  }
  console.log(`[backup] ${stamp}`);
}

// Backup ved oppstart og deretter hver 24. time
runBackup();
setInterval(runBackup, 24 * 60 * 60 * 1000);

// multer og msgreader lastes lazy — serveren starter selv om npm install ikke er kjørt ennå
let _multer, _MsgReader;
function getMulter() {
  if (!_multer) _multer = require('multer');
  return _multer;
}
function getMsgReader() {
  if (!_MsgReader) _MsgReader = require('@kenjiuno/msgreader');
  return _MsgReader;
}

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms     = Date.now() - start;
    const status = res.statusCode;
    const color  = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';
    const reset  = '\x1b[0m';
    const time   = new Date().toISOString().slice(11, 19);
    console.log(`${color}[${time}] ${req.method} ${req.path} ${status} ${ms}ms${reset}`);
  });
  next();
});

// ── Passord-hashing (innebygd crypto, ingen avhengigheter) ───────────────────
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

// ── Bootstrap brukerdatabase ──────────────────────────────────────────────────
// Oppretter admin-konto første gang hvis users.json er tom
(function bootstrapUsers() {
  const users = read('users');
  if (users.length > 0) return;
  const username    = process.env.CRM_USER        || 'admin';
  const password    = process.env.CRM_PASS        || crypto.randomBytes(8).toString('hex');
  const displayName = process.env.CRM_DISPLAY_NAME || username;
  const admin = { _id: 1, username, displayName, role: 'admin', passwordHash: hashPassword(password) };
  write('users', [admin]);
  if (!process.env.CRM_PASS) {
    console.log(`\n[auth] Ingen brukere funnet — opprettet admin-konto`);
    console.log(`       Brukernavn : ${username}`);
    console.log(`       Passord    : ${password}\n`);
  } else {
    console.log(`[auth] Admin-konto opprettet — brukernavn: ${username}`);
  }
})();

// Statiske filer serveres uten auth (index.html, JS, CSS, bilder)
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth-middleware (kun for /api/-ruter) ────────────────────────────────────
app.use('/api', (req, res, next) => {
  const users = read('users');
  const auth  = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="ORO CRM"');
    return res.status(401).json({ error: 'Innlogging kreves' });
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);
  const user = users.find(u => u.username === username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="ORO CRM"');
    return res.status(401).json({ error: 'Feil brukernavn eller passord' });
  }
  req.currentUser = { _id: user._id, username: user.username, displayName: user.displayName, role: user.role };
  next();
});

function requireAdmin(req, res, next) {
  if (req.currentUser?.role !== 'admin')
    return res.status(403).json({ error: 'Kun administratorer har tilgang' });
  next();
}

// ── Validation ────────────────────────────────────────────────────────────────
const VALID_PHASES    = ['Prospekt','Ny kontakt','Intro sendt','Møte avtalt','Aktiv dialog','Tegnet','Ikke relevant nå','Onboardet'];
const VALID_TYPES     = ['Pensjon','Stiftelse','Family Office','Forsikring','Institusjonell','Pensjonskasse','Private Banking','Rådgiver','Annet'];
const VALID_LOG_TYPES = ['Møte','Telefon','E-post mottatt','E-post sendt','Event','Video','Annet','Notat'];
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
  if (body.target_ticket != null && body.target_ticket !== '') {
    const t = parseFloat(body.target_ticket);
    if (isNaN(t) || t < 0) errors.push('Målticket må være et positivt tall');
  }
  if (body.probability != null && body.probability !== '') {
    const p = parseFloat(body.probability);
    if (isNaN(p) || p < 0 || p > 1) errors.push('Sannsynlighet må være mellom 0 og 1');
  }
  if (body.product_interests != null && !Array.isArray(body.product_interests)) {
    errors.push('product_interests må være en liste');
  }
  return errors;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function weighted(inv) {
  return (inv.target_ticket != null && inv.probability != null)
    ? Math.round(inv.target_ticket * inv.probability * 10) / 10
    : null;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', (req, res) => {
  const investors = read('investors');
  const log       = read('log');

  const total  = investors.length;
  const ticket = investors.reduce((s,i) => s + (i.target_ticket||0), 0);
  const wgtd   = investors.reduce((s,i) => s + (weighted(i)||0), 0);

  // By phase
  const phaseMap = {};
  investors.forEach(i => {
    const p = i.phase||'Ukjent';
    if (!phaseMap[p]) phaseMap[p] = { phase:p, count:0, ticket:0, weighted:0 };
    phaseMap[p].count++;
    phaseMap[p].ticket  += i.target_ticket||0;
    phaseMap[p].weighted += weighted(i)||0;
  });
  const byPhase = Object.values(phaseMap).sort((a,b) => b.count-a.count);

  // By type
  const typeMap = {};
  investors.forEach(i => {
    const t = i.investor_type||'Ukjent';
    if (!typeMap[t]) typeMap[t] = { investor_type:t, count:0, ticket:0 };
    typeMap[t].count++;
    typeMap[t].ticket += i.target_ticket||0;
  });
  const byType = Object.values(typeMap).sort((a,b) => b.count-a.count);

  const productList = read('products');
  const productCounts = productList.map(p => ({
    _id: p._id,
    name: p.name,
    count: investors.filter(i => Array.isArray(i.product_interests) && i.product_interests.includes(p._id)).length,
  }));
  const products = productCounts; // array for dashboard

  const top10 = investors
    .filter(i => weighted(i) != null)
    .sort((a,b) => weighted(b)-weighted(a))
    .slice(0,10)
    .map(i => ({ ...i, weighted: weighted(i) }));

  const recent = [...log]
    .sort((a,b) => (b.date+b.created_at) < (a.date+a.created_at) ? -1 : 1)
    .slice(0,8);

  res.json({ total, ticket, weighted: Math.round(wgtd*10)/10, byPhase, byType, products, top10, recent });
});

// ── Investors ─────────────────────────────────────────────────────────────────
app.get('/api/investors', (req, res) => {
  let list = read('investors');
  const { search, phase, type, lead, product, country, city } = req.query;
  if (search)  list = list.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
  if (phase)   list = list.filter(i => i.phase === phase);
  if (type)    list = list.filter(i => i.investor_type === type);
  if (lead)    list = list.filter(i => i.lead === lead);
  if (product) {
    const pid = parseInt(product);
    list = list.filter(i => Array.isArray(i.product_interests) && i.product_interests.includes(pid));
    const piRows = read('product_investors').filter(pi => pi.product_id === pid);
    const piMap  = Object.fromEntries(piRows.map(pi => [pi.investor_id, pi]));
    list = list.map(i => {
      const pi = piMap[i.id];
      if (!pi) return i;
      return {
        ...i,
        target_ticket:  pi.target_ticket  != null ? pi.target_ticket  : i.target_ticket,
        probability:    pi.probability    != null ? pi.probability    : i.probability,
        decline_reason: pi.decline_reason ?? null,
      };
    });
  }
  if (country) list = list.filter(i => i.country === country);
  if (city)    list = list.filter(i => (i.city||'').toLowerCase().includes(city.toLowerCase()));
  list.sort((a,b) => a.name.localeCompare(b.name, 'nb'));
  res.json(list);
});

app.get('/api/locations', (req, res) => {
  const investors = read('investors');
  const countries = [...new Set(investors.map(i => i.country).filter(Boolean))].sort((a,b) => a.localeCompare(b,'nb'));
  const cities    = [...new Set(investors.map(i => i.city).filter(Boolean))].sort((a,b) => a.localeCompare(b,'nb'));
  res.json({ countries, cities });
});

app.post('/api/investors', (req, res) => {
  const errors = validateInvestorBody(req.body, true);
  if (errors.length) return validationError(res, errors);
  const list = read('investors');
  // Generate next ID: find max numeric part of existing INV-XXX ids
  const maxNum = list.reduce((max, i) => {
    const m = String(i.id).match(/INV-(\d+)/);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  const id = 'INV-' + String(maxNum + 1).padStart(3, '0');
  const entry = {
    id,
    name:          req.body.name || '',
    country:       req.body.country || 'Norge',
    city:          req.body.city || null,
    investor_type: req.body.investor_type || null,
    fund_vehicle:  null,
    product_interests: Array.isArray(req.body.product_interests) ? req.body.product_interests : [],
    phase:         req.body.phase         || 'Prospekt',
    lead:          req.body.lead          || null,
    advisor:       req.body.advisor       || null,
    target_ticket: req.body.target_ticket || null,
    probability:   req.body.probability   || null,
    first_close:   0,
    next_steps:    req.body.next_steps    || null,
    last_contact:  null,
    doc_shared:    null,
    meeting_date:  null,
    comments:      req.body.comments      || null,
    updated_at:    new Date().toISOString(),
  };
  list.push(entry);
  write('investors', list);
  res.json(entry);
});

app.get('/api/investors/:id', (req, res) => {
  const inv = read('investors').find(i => i.id === req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const contacts = read('contacts').filter(c => c.investor_id === req.params.id)
    .sort((a,b) => b.is_primary - a.is_primary);
  const log = read('log').filter(l => l.investor_id === req.params.id)
    .sort((a,b) => b.date.localeCompare(a.date));
  res.json({ ...inv, contacts, log });
});

app.put('/api/investors/:id', (req, res) => {
  const errors = validateInvestorBody(req.body, false);
  if (errors.length) return validationError(res, errors);
  const list = read('investors');
  const idx  = list.findIndex(i => i.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  list[idx] = { ...list[idx], ...req.body, id: req.params.id, updated_at: new Date().toISOString() };
  write('investors', list);
  res.json(list[idx]);
});

app.delete('/api/investors/:id', (req, res) => {
  const id = req.params.id;
  if (!read('investors').find(i => i.id === id))
    return res.status(404).json({ error: 'Investor ikke funnet' });

  write('investors',        read('investors').filter(i => i.id !== id));
  write('contacts',         read('contacts').filter(c => c.investor_id !== id));
  write('log',              read('log').filter(l => l.investor_id !== id));
  write('tasks',            read('tasks').filter(t => t.investor_id !== id));
  write('product_investors', read('product_investors').filter(pi => pi.investor_id !== id));
  res.json({ ok: true });
});

// ── Duplicates ────────────────────────────────────────────────────────────────
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
  const union = new Set([...sa, ...sb]).size;
  return union ? inter / union : 0;
}

app.get('/api/duplicates', (req, res) => {
  const investors = read('investors');
  const pairs = [];
  for (let i = 0; i < investors.length; i++) {
    for (let j = i + 1; j < investors.length; j++) {
      const na = normalizeName(investors[i].name);
      const nb = normalizeName(investors[j].name);
      const score = jaccard(na, nb);
      if (score >= 0.6) {
        pairs.push({ score: Math.round(score * 100), a: investors[i], b: investors[j] });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  res.json(pairs);
});

// ── Duplicate contacts ────────────────────────────────────────────────────────
app.get('/api/duplicate-contacts', (req, res) => {
  const contacts  = read('contacts');
  const investors = read('investors');
  const invMap    = Object.fromEntries(investors.map(i => [i.id, i.name]));

  const groups = [];

  // 1. Same name + same investor_id (exact duplicate rows)
  const byInvName = {};
  contacts.forEach(c => {
    const key = c.investor_id + '||' + (c.name || '').trim().toLowerCase();
    if (!byInvName[key]) byInvName[key] = [];
    byInvName[key].push(c);
  });
  Object.values(byInvName).forEach(cs => {
    if (cs.length > 1) {
      groups.push({
        type: 'exact',
        label: 'Samme navn, samme investor',
        investor_name: invMap[cs[0].investor_id] || cs[0].investor_id,
        investor_id:   cs[0].investor_id,
        contacts: cs,
      });
    }
  });

  // 2. Same email on multiple contacts (different investors or same)
  const byEmail = {};
  contacts.forEach(c => {
    const e = (c.email || '').trim().toLowerCase();
    if (!e) return;
    if (!byEmail[e]) byEmail[e] = [];
    byEmail[e].push(c);
  });
  Object.entries(byEmail).forEach(([email, cs]) => {
    if (cs.length > 1) {
      // Skip if already caught as exact-on-same-investor
      const investorIds = [...new Set(cs.map(c => c.investor_id))];
      groups.push({
        type: 'email',
        label: 'Samme e-postadresse',
        email,
        investor_ids: investorIds,
        investor_names: investorIds.map(id => invMap[id] || id),
        contacts: cs.map(c => ({ ...c, investor_name: invMap[c.investor_id] || c.investor_id })),
      });
    }
  });

  groups.sort((a, b) => {
    if (a.type === 'exact' && b.type !== 'exact') return -1;
    if (b.type === 'exact' && a.type !== 'exact') return 1;
    return 0;
  });

  res.json(groups);
});

app.post('/api/merge', async (req, res) => {
  const { keep_id, drop_id } = req.body;
  if (!keep_id || !drop_id) return res.status(400).json({ error: 'keep_id og drop_id er påkrevd' });

  let investors = read('investors');
  const keep = investors.find(i => i.id === keep_id);
  const drop = investors.find(i => i.id === drop_id);
  if (!keep || !drop) return res.status(404).json({ error: 'Investor ikke funnet' });

  // Merge fields: keep's values win, drop fills in nulls
  const merged = { ...keep };
  for (const key of Object.keys(drop)) {
    if (key === 'id' || key === 'updated_at') continue;
    if (merged[key] == null || merged[key] === '' || merged[key] === 0) {
      if (drop[key] != null && drop[key] !== '' && drop[key] !== 0) {
        merged[key] = drop[key];
      }
    }
  }
  // Union-merge product interests
  const keepInts  = Array.isArray(keep.product_interests)  ? keep.product_interests  : [];
  const dropInts  = Array.isArray(drop.product_interests)  ? drop.product_interests  : [];
  merged.product_interests = [...new Set([...keepInts, ...dropInts])].sort((a,b)=>a-b);
  // Merge comments
  if (keep.comments && drop.comments && keep.comments !== drop.comments) {
    merged.comments = keep.comments + ' | ' + drop.comments;
  }
  merged.updated_at = new Date().toISOString();

  try {
    // Save merged investor, remove dropped
    investors = investors.filter(i => i.id !== drop_id);
    const idx = investors.findIndex(i => i.id === keep_id);
    investors[idx] = merged;
    await writeAsync('investors', investors);

    // Move contacts from drop → keep
    const contacts = read('contacts').map(c =>
      c.investor_id === drop_id ? { ...c, investor_id: keep_id } : c
    );
    await writeAsync('contacts', contacts);

    // Move log entries from drop → keep
    const log = read('log').map(l =>
      l.investor_id === drop_id ? { ...l, investor_id: keep_id, investor_name: keep.name } : l
    );
    await writeAsync('log', log);

    res.json({ ok: true, merged });
  } catch(e) {
    console.error('[merge] skriv feilet:', e.message);
    res.status(500).json({ error: 'Sammenslåing feilet — data kan være inkonsistente' });
  }
});

// ── Contacts ──────────────────────────────────────────────────────────────────
app.get('/api/contacts', (req, res) => {
  let list = read('contacts');
  if (req.query.investorId) list = list.filter(c => c.investor_id === req.query.investorId);
  list.sort((a,b) => b.is_primary - a.is_primary);
  res.json(list);
});

app.post('/api/contacts', (req, res) => {
  const errors = [];
  if (!String(req.body.investor_id || '').trim()) errors.push('investor_id er påkrevd');
  if (!String(req.body.name || '').trim())        errors.push('Navn er påkrevd');
  if (errors.length) return validationError(res, errors);
  const list = read('contacts');
  const entry = { ...req.body, _id: nextId('contacts') };
  list.push(entry);
  write('contacts', list);
  res.json(entry);
});

app.put('/api/contacts/:id', (req, res) => {
  const list = read('contacts');
  const id   = parseInt(req.params.id);
  const idx  = list.findIndex(c => c._id === id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  list[idx] = { ...list[idx], ...req.body, _id: id };
  write('contacts', list);
  res.json(list[idx]);
});

app.delete('/api/contacts/:id', (req, res) => {
  const list = read('contacts').filter(c => c._id !== parseInt(req.params.id));
  write('contacts', list);
  res.json({ ok: true });
});

// ── Contact log ───────────────────────────────────────────────────────────────
app.get('/api/log', (req, res) => {
  let list = read('log');
  if (req.query.investorId) list = list.filter(l => l.investor_id === req.query.investorId);
  list.sort((a,b) => b.date.localeCompare(a.date));
  if (req.query.limit) list = list.slice(0, parseInt(req.query.limit));
  res.json(list);
});

app.post('/api/log', async (req, res) => {
  const errors = [];
  if (!req.body.investor_id)            errors.push('investor_id er påkrevd');
  if (!isValidDate(req.body.date))      errors.push('Ugyldig dato — bruk format ÅÅÅÅ-MM-DD');
  if (req.body.log_type && !VALID_LOG_TYPES.includes(req.body.log_type))
    errors.push(`Ugyldig type: ${req.body.log_type}`);
  if (errors.length) return validationError(res, errors);

  try {
    // Update last_contact on investor
    const invs = read('investors');
    const idx  = invs.findIndex(i => i.id === req.body.investor_id);
    if (idx >= 0) {
      invs[idx].last_contact = req.body.date;
      invs[idx].updated_at   = new Date().toISOString();
      await writeAsync('investors', invs);
    }

    const list  = read('log');
    const entry = { ...req.body, _id: nextId('log'), created_at: new Date().toISOString() };
    list.push(entry);
    await writeAsync('log', list);
    res.json(entry);
  } catch(e) {
    console.error('[log] skriv feilet:', e.message);
    res.status(500).json({ error: 'Kunne ikke lagre — prøv igjen' });
  }
});

app.put('/api/log/:id', (req, res) => {
  if (req.body.date && !isValidDate(req.body.date))
    return validationError(res, ['Ugyldig dato — bruk format ÅÅÅÅ-MM-DD']);
  if (req.body.log_type && !VALID_LOG_TYPES.includes(req.body.log_type))
    return validationError(res, [`Ugyldig type: ${req.body.log_type}`]);
  const id   = parseInt(req.params.id);
  const list = read('log');
  const idx  = list.findIndex(l => l._id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  list[idx] = { ...list[idx], ...req.body, _id: id };
  write('log', list);
  res.json(list[idx]);
});

app.delete('/api/log/:id', (req, res) => {
  const id   = parseInt(req.params.id);
  const list = read('log').filter(l => l._id !== id);
  write('log', list);
  res.json({ ok: true });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/api/tasks', (req, res) => {
  let list = read('tasks');
  if (req.query.investorId) {
    list = list.filter(t => String(t.investor_id) === String(req.query.investorId));
  }
  if (req.query.done !== undefined) {
    const done = parseInt(req.query.done);
    list = list.filter(t => t.done === done);
  }
  list.sort((a, b) => a.due_date.localeCompare(b.due_date));
  res.json(list);
});

app.post('/api/tasks', (req, res) => {
  const errors = [];
  if (!String(req.body.label || '').trim()) errors.push('Oppgavetekst er påkrevd');
  if (!isValidDate(req.body.due_date))      errors.push('Ugyldig frist — bruk format ÅÅÅÅ-MM-DD');
  if (errors.length) return validationError(res, errors);
  const list = read('tasks');
  const task = { ...req.body, _id: nextId('tasks'), done: 0, created_at: new Date().toISOString().slice(0,10) };
  list.push(task);
  write('tasks', list);
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const id   = parseInt(req.params.id);
  const list = read('tasks');
  const idx  = list.findIndex(t => t._id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  list[idx] = { ...list[idx], ...req.body, _id: id };
  write('tasks', list);
  res.json(list[idx]);
});

app.delete('/api/tasks/:id', (req, res) => {
  const id   = parseInt(req.params.id);
  const list = read('tasks').filter(t => t._id !== id);
  write('tasks', list);
  res.json({ ok: true });
});

// ── Brukere ───────────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => res.json(req.currentUser));

app.get('/api/users', requireAdmin, (req, res) => {
  res.json(read('users').map(({ passwordHash, ...u }) => u));
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, displayName, password, role } = req.body;
  const errors = [];
  if (!String(username || '').trim())    errors.push('Brukernavn er påkrevd');
  if (!String(displayName || '').trim()) errors.push('Visningsnavn er påkrevd');
  if (!String(password || '').trim())    errors.push('Passord er påkrevd');
  if (!['admin', 'bruker'].includes(role)) errors.push('Ugyldig rolle');
  if (errors.length) return validationError(res, errors);

  const users = read('users');
  if (users.find(u => u.username === username))
    return res.status(409).json({ error: 'Brukernavnet er allerede i bruk' });

  const entry = {
    _id: nextId('users'),
    username: username.trim(),
    displayName: displayName.trim(),
    role,
    passwordHash: hashPassword(password),
  };
  users.push(entry);
  write('users', users);
  const { passwordHash, ...safe } = entry;
  res.json(safe);
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const id    = parseInt(req.params.id);
  const users = read('users');
  const idx   = users.findIndex(u => u._id === id);
  if (idx === -1) return res.status(404).json({ error: 'Bruker ikke funnet' });

  const { displayName, password, role } = req.body;
  if (displayName) users[idx].displayName = displayName.trim();
  if (role && ['admin', 'bruker'].includes(role)) users[idx].role = role;
  if (password && password.trim()) users[idx].passwordHash = hashPassword(password);

  write('users', users);
  const { passwordHash, ...safe } = users[idx];
  res.json(safe);
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.currentUser._id)
    return res.status(400).json({ error: 'Du kan ikke slette din egen konto' });
  const users = read('users');
  if (!users.find(u => u._id === id))
    return res.status(404).json({ error: 'Bruker ikke funnet' });
  write('users', users.filter(u => u._id !== id));
  res.json({ ok: true });
});

// ── Lookups ───────────────────────────────────────────────────────────────────
app.get('/api/lookups', (req, res) => {
  res.json({
    phases:   ['Prospekt','Ny kontakt','Intro sendt','Møte avtalt','Aktiv dialog','Tegnet','Ikke relevant nå','Onboardet'],
    types:    ['Pensjon','Stiftelse','Family Office','Forsikring','Institusjonell','Pensjonskasse','Private Banking','Rådgiver','Annet'],
    vehicles: ['IS','Feeder','Ikke avklart'],
    logTypes: ['Møte','Telefon','E-post mottatt','E-post sendt','Event','Video','Annet'],
    leads:    ['Kristian Bartnes','Anders Brustad-Nilsen','Nikolai Staubo','Anders Aasand','Gunnar Vestby','Ekstern'],
    advisors: ['Grieg Investor','Mercer','Gabler','Formue','Industrifinans','Søderberg','DNB','Nordea','Handelsbanken','Intervalor'],
  });
});

// ── MSG parse ─────────────────────────────────────────────────────────────────
app.post('/api/email/parse-msg', (req, res, next) => {
  let multer;
  try { multer = getMulter(); } catch(e) {
    return res.status(503).json({ error: 'Pakker ikke installert — kjør npm install i oro-crm-mappen og restart serveren.' });
  }
  multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })
    .single('file')(req, res, next);
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ingen fil' });

  try {
    let MsgReader;
    try { MsgReader = getMsgReader(); } catch(e) {
      return res.status(503).json({ error: 'Pakker ikke installert — kjør npm install i oro-crm-mappen og restart serveren.' });
    }
    const reader   = new MsgReader.default(req.file.buffer);
    const data     = reader.getFileData();

    // Date — for kalender brukes apptStartWhole, ellers leveringstidspunkt
    const msgClass_early = (data.messageClass || '').toLowerCase();
    const isCalendarEarly = msgClass_early.includes('appointment') || msgClass_early.includes('meeting') || msgClass_early.includes('schedule');
    let date = '';
    const rawDate = (isCalendarEarly && data.apptStartWhole)
      ? data.apptStartWhole
      : data.messageDeliveryTime || data.clientSubmitTime || data.creationTime;
    if (rawDate) {
      let d;
      if (rawDate instanceof Date) d = rawDate;
      else if (typeof rawDate === 'string') d = new Date(rawDate);
      else if (typeof rawDate === 'number') {
        // Windows FILETIME: 100ns intervals since 1601-01-01
        d = new Date(rawDate / 10000 - 11644473600000);
      }
      if (d && !isNaN(d)) date = d.toISOString().slice(0, 10);
    }
    if (!date) date = new Date().toISOString().slice(0, 10);

    // Body — prefer plain text, fall back to HTML stripped
    let body = data.body || '';
    if (!body && data.bodyHTML) {
      body = data.bodyHTML
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const senderName  = data.senderName || '';
    // Exchange Legacy DN (/O=.../CN=...) er ikke en brukbar e-postadresse — forkast den
    const rawEmail    = data.senderEmail || '';
    const senderEmail = rawEmail.startsWith('/O=') || rawEmail.startsWith('/o=') ? '' : rawEmail;
    const senderDomain = senderEmail.includes('@')
      ? senderEmail.split('@')[1].split('.')[0]
      : '';

    // Mottakere — inkluder alle (recipType-verdier varierer mellom Outlook-versjoner),
    // ekskl. Exchange Legacy DN-adresser. Klienten filtrerer interne mottakere.
    const recipients = (data.recipients || [])
      .map(r => ({
        name:     r.name     || '',
        email:    (r.email || r.smtpAddress || '').startsWith('/O=')
                    ? ''
                    : (r.email || r.smtpAddress || ''),
        recipType: r.recipType,
      }))
      .filter(r => r.name || r.email);

    // Kalender / møteforespørsel?
    const msgClass   = (data.messageClass || '').toLowerCase();
    const isCalendar = msgClass.includes('appointment') || msgClass.includes('meeting') || msgClass.includes('schedule');

    const location = data.apptLocation || '';

    res.json({
      from:         senderEmail ? `${senderName} <${senderEmail}>` : senderName,
      senderName,
      senderEmail,
      senderDomain,
      recipients,
      subject:      data.subject || '',
      date,
      body:         body.slice(0, 3000),
      isCalendar,
      location,
    });
  } catch (e) {
    console.error('MSG parse error:', e);
    res.status(500).json({ error: 'Kunne ikke lese .msg-filen: ' + e.message });
  }
});

// ── Excel export ──────────────────────────────────────────────────────────────
app.get('/api/export/excel', (req, res) => {
  const investors = read('investors');
  const contacts  = read('contacts');
  const log       = read('log');

  const wb = XLSX.utils.book_new();

  // ─ Ark 1: Investorer ─
  const xlsProducts = read('products');
  const prodNameById = Object.fromEntries(xlsProducts.map(p => [p._id, p.name]));
  const invRows = investors
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
    .map(i => {
      const interests = Array.isArray(i.product_interests)
        ? i.product_interests.map(id => prodNameById[id] || id).join(', ')
        : '';
      return {
        'ID':                i.id,
        'Navn':              i.name,
        'Land':              i.country || '',
        'By':                i.city || '',
        'Type':              i.investor_type || '',
        'Fase':              i.phase || '',
        'Lead':              i.lead || '',
        'Rådgiver':          i.advisor || '',
        'Ticket (MNOK)':     i.target_ticket != null ? i.target_ticket : '',
        'Sannsynlighet (%)': i.probability   != null ? i.probability   : '',
        'Vektet (MNOK)':     (i.target_ticket && i.probability)
                              ? Math.round(i.target_ticket * i.probability * 10) / 10
                              : '',
        'Produktinteresse':  interests,
        'Sist kontakt':      i.last_contact || '',
        'Neste steg':        i.next_steps   || '',
        'Kommentarer':       i.comments     || '',
        'Oppdatert':         i.updated_at   ? i.updated_at.slice(0, 10) : '',
      };
    });
  const wsInv = XLSX.utils.json_to_sheet(invRows);
  // Kolonnebredder
  wsInv['!cols'] = [
    {wch:10},{wch:36},{wch:10},{wch:16},{wch:18},{wch:14},{wch:22},
    {wch:18},{wch:14},{wch:18},{wch:14},{wch:50},
    {wch:14},{wch:28},{wch:40},{wch:12},
  ];
  XLSX.utils.book_append_sheet(wb, wsInv, 'Investorer');

  // ─ Ark 2: Kontakter ─
  // Bygg investor-navn lookup
  const invMap = Object.fromEntries(investors.map(i => [i.id, i.name]));
  const ctRows = contacts.map(c => ({
    'Investor ID':   c.investor_id,
    'Investor':      invMap[c.investor_id] || c.investor_name || '',
    'Navn':          c.name  || '',
    'Tittel':        c.title || '',
    'E-post':        c.email || '',
    'Telefon':       c.phone || '',
    'Primærkontakt': c.is_primary ? 'Ja' : '',
    'Notater':       c.notes || '',
  }));
  const wsCt = XLSX.utils.json_to_sheet(ctRows);
  wsCt['!cols'] = [{wch:10},{wch:30},{wch:24},{wch:22},{wch:28},{wch:16},{wch:14},{wch:36}];
  XLSX.utils.book_append_sheet(wb, wsCt, 'Kontakter');

  // ─ Ark 3: Kontaktlogg ─
  const logRows = [...log]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(l => ({
      'Dato':           l.date || '',
      'Investor ID':    l.investor_id,
      'Investor':       invMap[l.investor_id] || l.investor_name || '',
      'Type':           l.log_type || '',
      'Kontaktperson':  l.contact_person || '',
      'Ansvarlig':      l.responsible   || '',
      'Emne':           l.subject       || '',
      'Utfall':         l.outcome       || '',
      'Notater':        l.notes         || '',
    }));
  const wsLog = XLSX.utils.json_to_sheet(logRows);
  wsLog['!cols'] = [{wch:12},{wch:10},{wch:30},{wch:10},{wch:22},{wch:22},{wch:36},{wch:36},{wch:50}];
  XLSX.utils.book_append_sheet(wb, wsLog, 'Kontaktlogg');

  const buf      = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `ORO_CRM_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── Product-investor (per-produkt ticket/sannsynlighet/avlag) ─────────────────
app.put('/api/product-investors', (req, res) => {
  const { product_id, investor_id, ...fields } = req.body;
  if (!product_id || !investor_id)
    return validationError(res, ['product_id og investor_id er påkrevd']);

  if (fields.target_ticket != null && fields.target_ticket !== '') {
    const t = parseFloat(fields.target_ticket);
    if (isNaN(t) || t < 0) return validationError(res, ['Målticket må være et positivt tall']);
    fields.target_ticket = t;
  }
  if (fields.probability != null && fields.probability !== '') {
    const p = parseFloat(fields.probability);
    if (isNaN(p) || p < 0 || p > 1) return validationError(res, ['Sannsynlighet må være mellom 0 og 1']);
    fields.probability = p;
  }

  const allowed = ['target_ticket', 'probability', 'decline_reason'];
  const update  = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));

  const list = read('product_investors');
  const idx  = list.findIndex(pi => pi.product_id === product_id && pi.investor_id === investor_id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...update };
  } else {
    list.push({ _id: nextId('product_investors'), product_id, investor_id, ...update });
  }
  write('product_investors', list);
  res.json({ ok: true });
});

// ── Products ──────────────────────────────────────────────────────────────────
app.get('/api/products', (req, res) => res.json(read('products')));

app.post('/api/products', (req, res) => {
  if (!String(req.body.name || '').trim())
    return validationError(res, ['Produktnavn er påkrevd']);
  const list = read('products');
  const item = { ...req.body, _id: nextId('products') };
  list.push(item);
  write('products', list);
  res.json(item);
});

app.put('/api/products/:id', (req, res) => {
  const id   = parseInt(req.params.id);
  const list = read('products');
  const idx  = list.findIndex(p => p._id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  list[idx] = { ...list[idx], ...req.body, _id: id };
  write('products', list);
  res.json(list[idx]);
});

app.delete('/api/products/:id', (req, res) => {
  const id   = parseInt(req.params.id);
  write('products', read('products').filter(p => p._id !== id));
  res.json({ ok: true });
});

// ── Backup API ────────────────────────────────────────────────────────────────
app.get('/api/backups', (req, res) => {
  const files  = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).sort().reverse() : [];
  const stamps = [...new Set(files.map(f => f.slice(0, 19)))];
  res.json(stamps.map(s => ({ stamp: s, label: s.replace('_',' ').replace(/-/g,':').replace(':','-').replace(':','-') })));
});

app.post('/api/backups/restore/:stamp', (req, res) => {
  const { stamp } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(stamp))
    return res.status(400).json({ error: 'Ugyldig backup-tidsstempel' });

  const tables = ['investors', 'contacts', 'contact_log', 'tasks', 'products', 'product_investors', 'users'];
  runBackup(); // ta backup av nåværende tilstand først
  let restored = 0;
  tables.forEach(t => {
    const src = path.resolve(BACKUP_DIR, stamp + '_' + t + '.json');
    if (!src.startsWith(BACKUP_DIR)) return; // path traversal-sjekk
    if (fs.existsSync(src)) {
      const data = JSON.parse(fs.readFileSync(src, 'utf8'));
      write(t, data);
      restored++;
    }
  });
  res.json({ ok: true, restored });
});

// SPA fallback — return index.html for any non-API, non-static route
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log('ORO CRM → http://localhost:' + PORT));
