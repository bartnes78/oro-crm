import { api } from '../api.js';

// ── Internal ORO users ────────────────────────────────────────────────────────
const INTERNAL_NAMES = ['kristian bartnes', 'anders brustad-nilsen', 'nikolai staubo'];
function isInternal(name, email) {
  if (!name && !email) return false;
  const n = (name  || '').toLowerCase();
  const e = (email || '').toLowerCase();
  return INTERNAL_NAMES.some(i => n.includes(i) || e.includes(i))
    || e.includes('@oroareal') || e.includes('@oro.no');
}

// ── Normalisation + Jaccard for fuzzy investor matching ───────────────────────
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
function matchInvestors(query, investors) {
  if (!query || query.length < 2) return [];
  const normQ = normalizeName(query);
  const q = query.toLowerCase();
  return investors
    .map(inv => {
      const normI = normalizeName(inv.name);
      const boost = inv.name.toLowerCase().includes(q) ? 0.3 : 0;
      const score = Math.min(1, jaccard(normQ, normI) + boost);
      return { inv, score };
    })
    .filter(x => x.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

// ── .ics calendar parser ──────────────────────────────────────────────────────
function parseIcs(text) {
  function get(key) {
    const re = new RegExp(`^${key}(?:;[^:\\r\\n]*)?:(.+)`, 'm');
    const m = text.match(re);
    return m ? m[1].replace(/\r/g, '').trim() : '';
  }
  function icsDateToIso(s) {
    const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }
  function unescape(s) { return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\\\/g, '\\'); }
  function extractCN(line) { return (line.match(/CN=([^;:\r\n]+)/) || [])[1]?.trim() || ''; }

  const summary  = unescape(get('SUMMARY'));
  const location = unescape(get('LOCATION'));
  const desc     = unescape(get('DESCRIPTION'));
  const date     = icsDateToIso(get('DTSTART'));
  const orgLine  = get('ORGANIZER');
  const organizer = extractCN(orgLine) || orgLine.replace(/^mailto:/i, '');

  const attendees = [...text.matchAll(/^ATTENDEE(?:;[^:\r\n]*)?:(.+)/mg)].map(m => {
    return extractCN(m[0]) || m[1].replace(/^mailto:/i, '');
  }).filter(Boolean);

  return {
    isCalendar: true,
    date: date || new Date().toISOString().slice(0, 10),
    subject: summary,
    location,
    body: desc,
    senderName: organizer,
    senderEmail: '',
    senderDomain: '',
    from: organizer,
    recipients: attendees.map(name => ({ name, email: '' })),
  };
}

// ── Plain-text email parser ───────────────────────────────────────────────────
function parseEmailText(raw) {
  const lines = raw.split('\n').map(l => l.trim());
  function extract(patterns) {
    for (const line of lines) {
      for (const re of patterns) {
        const m = line.match(re);
        if (m) return m[1].trim();
      }
    }
    return '';
  }
  const from    = extract([/^Fra:\s*(.+)/i, /^From:\s*(.+)/i, /^Avsender:\s*(.+)/i]);
  const subject = extract([/^Emne:\s*(.+)/i, /^Subject:\s*(.+)/i]);
  const dateRaw = extract([/^Sendt:\s*(.+)/i, /^Sent:\s*(.+)/i, /^Dato:\s*(.+)/i, /^Date:\s*(.+)/i]);

  let date = '';
  if (dateRaw) {
    const iso = dateRaw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) { date = iso[0]; }
    else {
      const NO = {januar:1,februar:2,mars:3,april:4,mai:5,juni:6,juli:7,august:8,september:9,oktober:10,november:11,desember:12};
      const no = dateRaw.toLowerCase().match(/(\d{1,2})\.\s*(\w+)\s+(\d{4})/);
      if (no) { date = `${no[3]}-${String(NO[no[2]]||1).padStart(2,'0')}-${no[1].padStart(2,'0')}`; }
      else {
        const EN = {january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
        const en = dateRaw.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
        if (en) date = `${en[3]}-${String(EN[en[1].toLowerCase()]||1).padStart(2,'0')}-${en[2].padStart(2,'0')}`;
      }
    }
  }
  if (!date) date = new Date().toISOString().slice(0, 10);

  let senderName = '', senderEmail = '', senderDomain = '';
  if (from) {
    const em = from.match(/<([\w.+-]+@[\w.-]+)>/);
    if (em) {
      senderEmail  = em[1];
      senderDomain = senderEmail.split('@')[1]?.split('.')[0] || '';
      senderName   = from.replace(/<.+>/, '').replace(/"/g, '').trim();
    } else { senderName = from; }
  }

  let bodyStart = 0, inH = true;
  for (let i = 0; i < lines.length; i++) {
    if (inH && lines[i] === '' && i > 2) { bodyStart = i + 1; inH = false; break; }
  }
  const body = lines.slice(bodyStart).join('\n').trim().slice(0, 3000);

  return {
    from: senderEmail ? `${senderName} <${senderEmail}>` : senderName,
    senderName, senderEmail, senderDomain, subject, date, body,
    recipients: [],
  };
}

// ── Build investor matches ────────────────────────────────────────────────────
function buildMatches(p, investors, contacts) {
  const invById = Object.fromEntries(investors.map(i => [i.id, i]));
  const scored  = new Map(); // id → { inv, score, via }

  function bump(inv, score, via) {
    if (!inv) return;
    const ex = scored.get(inv.id);
    if (!ex || score > ex.score) scored.set(inv.id, { inv, score, via });
  }

  function matchPerson(name, email, mult, label) {
    if (email) {
      const el = email.toLowerCase();
      for (const c of contacts) {
        if ((c.email || '').toLowerCase() === el)
          bump(invById[c.investor_id], 1.0 * mult, `${label} e-post: ${c.name}`);
      }
    }
    if (name) {
      const normN = name.toLowerCase().replace(/[^a-zæøå ]/gi, ' ').replace(/\s+/g, ' ').trim();
      const toksN = new Set(normN.split(' ').filter(t => t.length > 1));
      for (const c of contacts) {
        if (!c.name) continue;
        const normC = c.name.toLowerCase().replace(/[^a-zæøå ]/gi, ' ').replace(/\s+/g, ' ').trim();
        const toksC = new Set(normC.split(' ').filter(t => t.length > 1));
        if (!toksN.size || !toksC.size) continue;
        const inter = [...toksN].filter(t => toksC.has(t)).length;
        const score = inter / new Set([...toksN, ...toksC]).size;
        if (score >= 0.5) bump(invById[c.investor_id], score * 0.95 * mult, `${label}: ${c.name}`);
      }
    }
  }

  const senderIsInternal = isInternal(p.senderName, p.senderEmail);
  const recipients = p.recipients || [];

  if (senderIsInternal) {
    const external = recipients.filter(r => !isInternal(r.name, r.email));
    for (const r of external) {
      matchPerson(r.name, r.email, 1.0, 'mottaker');
      const domain = (r.email || '').includes('@') ? r.email.split('@')[1].split('.')[0] : '';
      for (const { inv, score } of matchInvestors(r.name, investors)) bump(inv, score * 0.8, 'mottaker navn');
      for (const { inv, score } of matchInvestors(domain, investors)) bump(inv, score * 0.7, 'domene');
    }
  } else {
    matchPerson(p.senderName, p.senderEmail, 1.0, 'kontakt');
    for (const { inv, score } of matchInvestors(p.senderName, investors)) bump(inv, score * 0.8, 'selskapsnavn');
    for (const { inv, score } of matchInvestors(p.senderDomain, investors)) bump(inv, score * 0.7, 'domene');
  }

  return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 6);
}

// ── Match card HTML ───────────────────────────────────────────────────────────
function matchCardHtml(inv, score, via, checked) {
  const border  = checked ? '2px solid var(--green)' : '2px solid var(--border)';
  const bg      = checked ? 'rgba(26,138,106,.08)' : '#fff';
  const scoreBg = score > 0.85 ? 'rgba(26,138,106,.15)' : score > 0.5 ? '#FBF2E3' : '#f0f0f0';
  const scoreC  = score > 0.85 ? 'var(--green)' : score > 0.5 ? '#9A6A1E' : '#888';
  const phaseBadge = inv.phase ? `<span class="badge">${window.escHtml(inv.phase)}</span>` : '';
  const leadStr = inv.lead ? `<span style="font-size:11px;color:#888">· ${window.escHtml(inv.lead)}</span>` : '';
  const viaStr  = via ? `<span style="font-size:10px;color:var(--green,var(--color-signed));margin-left:auto">↳ ${window.escHtml(via)}</span>` : '';
  const scoreTag = score != null
    ? `<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:${scoreBg};color:${scoreC};flex-shrink:0">${Math.round(score * 100)}%</span>` : '';

  return `<div class="match-card" data-inv-id="${window.escHtml(inv.id)}"
    style="padding:10px 12px;border-radius:8px;cursor:pointer;margin-bottom:8px;border:${border};background:${bg};transition:all .12s;display:flex;gap:10px;align-items:flex-start">
    <input type="checkbox" ${checked ? 'checked' : ''} readonly style="margin-top:3px;accent-color:var(--green);cursor:pointer;flex-shrink:0;width:16px;height:16px">
    <div style="flex:1;min-width:0">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:600;font-size:13px">${window.escHtml(inv.name)}</span>
        ${scoreTag}
      </div>
      <div style="display:flex;gap:8px;margin-top:4px;align-items:center;flex-wrap:wrap">
        ${phaseBadge}
        <span style="font-size:11px;color:#aaa">${window.escHtml(inv.id)}</span>
        ${leadStr}
        ${viaStr}
      </div>
    </div>
  </div>`;
}

// ── Drop zone HTML ────────────────────────────────────────────────────────────
function dropZoneHtml() {
  return `<div style="max-width:660px">
    <div id="drop-zone"
      style="border:2px dashed var(--border);border-radius:12px;padding:48px 24px;text-align:center;cursor:pointer;background:#fafbfa;transition:all .15s;margin-bottom:16px">
      <input id="file-input" type="file" accept=".msg,.ics" style="display:none">
      <div style="font-size:40px;margin-bottom:12px;opacity:.5">✉</div>
      <p style="font-weight:700;font-size:15px;color:var(--green,var(--color-signed));margin-bottom:4px">Dra .msg eller .ics hit</p>
      <p style="font-size:13px;color:#888">eller klikk for å velge fil</p>
      <p style="font-size:11px;color:#bbb;margin-top:8px">E-post og møteforespørsler (.msg) · Kalenderinvitasjoner (.ics)</p>
    </div>
    <div>
      <button class="btn btn-ghost btn-sm" id="toggle-paste-btn" style="width:100%;justify-content:center;min-height:44px">▼ Lim inn e-posttekst manuelt i stedet</button>
      <div id="paste-area" style="display:none;margin-top:12px">
        <p style="font-size:12px;color:#888;margin-bottom:8px;line-height:1.6">
          Kopier e-posten fra Outlook (inkl. Fra, Sendt, Emne-linjer) og lim inn under.
        </p>
        <textarea id="paste-input" rows="8"
          placeholder="Fra: John Smith &lt;john@selskap.no&gt;&#10;Sendt: torsdag 1. mai 2026 14:30&#10;Til: Kristian Bartnes&#10;Emne: RE: ORO Areal Eiendomsfond&#10;&#10;Hei Kristian,&#10;&#10;[Brødtekst…]"
          style="width:100%;font-family:monospace;font-size:12px;padding:12px;border-radius:8px;border:1px solid var(--border);resize:vertical;line-height:1.6;min-height:200px"></textarea>
        <button class="btn btn-primary" id="parse-paste-btn" style="margin-top:10px;min-height:44px" disabled>Analyser tekst →</button>
      </div>
    </div>
  </div>`;
}

// ── Log form HTML ─────────────────────────────────────────────────────────────
function logFormHtml(form, lookups, selectedCount, isCalendar) {
  const logTypes = lookups.logTypes || ['E-post mottatt', 'E-post sendt', 'Møte', 'Telefon'];
  const leads    = lookups.leads || [];
  const disabled = selectedCount === 0 ? 'disabled' : '';
  const opacity  = selectedCount === 0 ? 'opacity:.5' : '';

  const logTypeOpts = logTypes.map(t => `<option value="${window.escHtml(t)}"${t === form.log_type ? ' selected' : ''}>${window.escHtml(t)}</option>`).join('');
  const leadOpts    = `<option value="">—</option>` + leads.map(l => `<option value="${window.escHtml(l)}"${l === form.responsible ? ' selected' : ''}>${window.escHtml(l)}</option>`).join('');

  const statusAvholdt  = form.status === 'avholdt'  ? 'border-color:var(--color-signed);background:rgba(26,138,106,.1);color:var(--color-signed);font-weight:600' : 'border-color:var(--border);color:var(--muted)';
  const statusPlanlagt = form.status === 'planlagt' ? 'border-color:var(--blue);background:rgba(52,152,219,.1);color:var(--blue);font-weight:600' : 'border-color:var(--border);color:var(--muted)';

  const locationField = isCalendar ? `
    <div class="form-group full">
      <label>Sted</label>
      <input id="form-location" value="${window.escHtml(form.location || '')}" placeholder="Møtested…" style="min-height:44px">
    </div>` : '';

  return `<div class="card">
    <div class="card-title">Loggfør aktivitet</div>
    ${selectedCount === 0 ? `<p style="font-size:13px;color:#aaa;margin-bottom:12px">Velg én eller flere investorer til venstre.</p>` : ''}
    <fieldset ${disabled} style="border:none;padding:0;${opacity}">
      <div class="form-grid">
        <div class="form-group">
          <label>Dato</label>
          <input id="form-date" type="date" value="${window.escHtml(form.date || '')}" style="min-height:44px">
        </div>
        <div class="form-group">
          <label>Type</label>
          <select id="form-log-type" style="min-height:44px">${logTypeOpts}</select>
        </div>
        <div class="form-group full">
          <label>Status</label>
          <div style="display:flex;gap:6px;margin-top:4px">
            <button type="button" id="status-avholdt" style="flex:1;padding:8px 0;border-radius:6px;border:2px solid;font-size:12px;cursor:pointer;min-height:44px;${statusAvholdt}">✓ Avholdt</button>
            <button type="button" id="status-planlagt" style="flex:1;padding:8px 0;border-radius:6px;border:2px solid;font-size:12px;cursor:pointer;min-height:44px;${statusPlanlagt}">📅 Planlagt</button>
          </div>
        </div>
        <div class="form-group">
          <label>Ansvarlig</label>
          <select id="form-responsible" style="min-height:44px">${leadOpts}</select>
        </div>
        <div class="form-group">
          <label>Kontaktperson</label>
          <input id="form-contact-person" value="${window.escHtml(form.contact_person || '')}" placeholder="Navn hos investor…" style="min-height:44px">
        </div>
        <div class="form-group full">
          <label>Emne</label>
          <input id="form-subject" value="${window.escHtml(form.subject || '')}" style="min-height:44px">
        </div>
        ${locationField}
        <div class="form-group full">
          <label>Utfall / neste steg</label>
          <input id="form-outcome" value="${window.escHtml(form.outcome || '')}" placeholder="Hva ble avtalt…" style="min-height:44px">
        </div>
        <div class="form-group full">
          <label>Notater</label>
          <textarea id="form-notes" rows="6">${window.escHtml(form.notes || '')}</textarea>
        </div>
      </div>
    </fieldset>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
      <button class="btn btn-ghost" id="cancel-btn" style="min-height:44px">Avbryt</button>
      <button class="btn btn-primary" id="save-log-btn" ${selectedCount === 0 || !form.date ? 'disabled' : ''} style="min-height:44px">
        ${selectedCount > 1 ? `✓ Loggfør (${selectedCount} investorer)` : '✓ Loggfør'}
      </button>
    </div>
  </div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────
export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted" style="padding:24px">Laster…</p></div>';

  let investors = [], contacts = [], lookups = {};
  try {
    [investors, contacts, lookups] = await Promise.all([
      api.investors(),
      api.contacts(),
      api.lookups(),
    ]);
  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:red">Feil: ${window.escHtml(e.message)}</p></div>`;
    return;
  }

  let parsed      = null;
  let matches     = [];
  let selectedIds = new Set();
  let oroAttendees = [];
  let form        = {};

  function getSelectedInvestors() {
    // collect from matches and any manual extras stored in allMatchMap
    return [...allMatchMap.values()].filter(m => selectedIds.has(m.inv.id)).map(m => m.inv);
  }

  // Map of all known inv entries (from auto matches + manual search)
  const allMatchMap = new Map(); // id → { inv, score, via }

  function resetState() {
    parsed = null; matches = []; selectedIds = new Set();
    oroAttendees = []; form = {};
    allMatchMap.clear();
  }

  // ── Drop zone view ──
  function renderDropZone(errorMsg) {
    el.innerHTML = `
      <div class="topbar"><span class="topbar-title">Importer fra Outlook</span></div>
      <div class="content">
        ${errorMsg ? `<div style="background:#fdecea;color:#c0392b;border-radius:8px;padding:10px 16px;margin-bottom:16px;font-size:13px;max-width:660px">⚠ ${window.escHtml(errorMsg)}</div>` : ''}
        ${dropZoneHtml()}
      </div>`;

    const zone      = el.querySelector('#drop-zone');
    const fileInput = el.querySelector('#file-input');
    const pasteBtn  = el.querySelector('#toggle-paste-btn');
    const pasteArea = el.querySelector('#paste-area');
    const pasteInput = el.querySelector('#paste-input');
    const parsePasteBtn = el.querySelector('#parse-paste-btn');

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--green)'; zone.style.background = 'rgba(26,138,106,.06)'; });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = 'var(--border)'; zone.style.background = '#fafbfa'; });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.style.borderColor = 'var(--border)'; zone.style.background = '#fafbfa';
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    zone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

    pasteBtn.addEventListener('click', () => {
      const open = pasteArea.style.display !== 'none';
      pasteArea.style.display = open ? 'none' : 'block';
      pasteBtn.textContent = open ? '▼ Lim inn e-posttekst manuelt i stedet' : '▲ Skjul';
    });

    pasteInput?.addEventListener('input', () => {
      parsePasteBtn.disabled = !pasteInput.value.trim();
    });
    parsePasteBtn?.addEventListener('click', () => {
      const p = parseEmailText(pasteInput.value);
      handleParsed(p);
    });
  }

  async function handleFile(file) {
    const name = file.name.toLowerCase();
    const zone = el.querySelector('#drop-zone');
    if (zone) { zone.innerHTML = `<div style="font-size:32px;margin-bottom:10px">⏳</div><p style="font-weight:600;color:var(--green)">Leser fil…</p>`; }

    if (name.endsWith('.ics')) {
      try {
        const text = await file.text();
        handleParsed(parseIcs(text));
      } catch (e) {
        renderDropZone('Kunne ikke lese .ics-filen: ' + e.message);
      }
      return;
    }

    if (name.endsWith('.msg')) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/email/parse-msg', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Serverfeil');
        handleParsed(data);
      } catch (e) {
        renderDropZone(e.message);
      }
      return;
    }

    renderDropZone('Kun .msg og .ics støttes. Bruk «Lim inn tekst» for andre formater.');
  }

  function handleParsed(p) {
    parsed = p;
    selectedIds = new Set();
    allMatchMap.clear();

    const autoMatches = buildMatches(p, investors, contacts);
    matches = autoMatches;
    for (const m of matches) allMatchMap.set(m.inv.id, m);

    // Auto-select high-confidence matches
    for (const m of matches) {
      if (m.score > 0.9) selectedIds.add(m.inv.id);
    }

    // ORO attendees
    const recipients = p.recipients || [];
    oroAttendees = recipients.filter(r => isInternal(r.name, r.email)).map(r => r.name).filter(Boolean);

    // Default form values
    const senderIsInternal = isInternal(p.senderName, p.senderEmail);
    const external = recipients.filter(r => !isInternal(r.name, r.email));
    const contactPerson = senderIsInternal && external.length > 0
      ? external.map(r => r.name).filter(Boolean).join(', ')
      : p.senderName;

    const autoType = p.isCalendar ? 'Møte' : senderIsInternal ? 'E-post sendt' : 'E-post mottatt';
    const today = new Date().toISOString().slice(0, 10);
    const autoStatus = (p.isCalendar && p.date > today) ? 'planlagt' : 'avholdt';

    form = {
      date:           p.date,
      log_type:       autoType,
      status:         autoStatus,
      responsible:    'Kristian Bartnes',
      contact_person: contactPerson || '',
      subject:        p.subject || '',
      location:       p.location || '',
      outcome:        '',
      notes:          (p.body || '').slice(0, 500),
    };

    renderReviewView();
  }

  function readForm() {
    form.date           = el.querySelector('#form-date')?.value           || form.date;
    form.log_type       = el.querySelector('#form-log-type')?.value       || form.log_type;
    form.responsible    = el.querySelector('#form-responsible')?.value    || form.responsible;
    form.contact_person = el.querySelector('#form-contact-person')?.value ?? form.contact_person;
    form.subject        = el.querySelector('#form-subject')?.value        ?? form.subject;
    form.location       = el.querySelector('#form-location')?.value       ?? form.location;
    form.outcome        = el.querySelector('#form-outcome')?.value        ?? form.outcome;
    form.notes          = el.querySelector('#form-notes')?.value          ?? form.notes;
  }

  function renderMatchList() {
    // Build cards for auto matches
    let html = matches.map(m => matchCardHtml(m.inv, m.score, m.via, selectedIds.has(m.inv.id))).join('');
    if (!matches.length) html = `<p style="font-size:13px;color:#999;margin-bottom:12px">Ingen automatisk treff.</p>`;

    html += `<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
      <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Legg til manuelt</div>
      <input id="manual-search" value="" placeholder="Skriv investornavn…"
        style="width:100%;font-size:13px;padding:7px 10px;border-radius:7px;border:1px solid var(--border);margin-bottom:6px;min-height:44px">
      <div id="manual-results"></div>
    </div>`;
    return html;
  }

  function renderReviewView() {
    const selectedInvs = getSelectedInvestors();
    const selectedCount = selectedIds.size;

    el.innerHTML = `
      <div class="topbar">
        <span class="topbar-title">Importer fra Outlook</span>
        <button class="btn btn-ghost btn-sm" id="new-email-btn" style="min-height:44px">← Ny e-post</button>
      </div>
      <div class="content">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1020px">
          <div>
            <div class="card" style="margin-bottom:16px">
              <div class="card-title">E-post — tolket innhold</div>
              <table style="width:100%;font-size:13px;border-collapse:collapse">
                <tbody>
                  <tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:7px 0;width:55px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">Fra</td>
                    <td style="padding:7px 0">${window.escHtml(parsed.senderName || parsed.from || '—')}</td>
                  </tr>
                  <tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:7px 0;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">Emne</td>
                    <td style="padding:7px 0">${window.escHtml(parsed.subject || '—')}</td>
                  </tr>
                  <tr>
                    <td style="padding:7px 0;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">Dato</td>
                    <td style="padding:7px 0">${window.escHtml(parsed.date || '—')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="card">
              <div class="card-title">
                Velg investor${selectedCount > 0 ? ` — <span style="color:var(--green)">${selectedCount} valgt</span>` : ''}
              </div>
              ${oroAttendees.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
                <span style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px">ORO:</span>
                ${oroAttendees.map(name => `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(26,138,106,.12);color:var(--green);font-weight:600">${window.escHtml(name)}</span>`).join('')}
              </div>` : ''}
              <div id="match-list">${renderMatchList()}</div>
            </div>
          </div>
          <div id="log-form-col">${logFormHtml(form, lookups, selectedCount, parsed.isCalendar)}</div>
        </div>
      </div>`;

    attachReviewEvents();
  }

  function attachReviewEvents() {
    el.querySelector('#new-email-btn')?.addEventListener('click', () => {
      resetState();
      renderDropZone(null);
    });

    el.querySelector('#cancel-btn')?.addEventListener('click', () => {
      resetState();
      renderDropZone(null);
    });

    // Match card clicks (toggle selection)
    el.querySelectorAll('.match-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.invId;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        syncFormAndMatchList();
      });
    });

    // Manual investor search
    el.querySelector('#manual-search')?.addEventListener('input', e => {
      const q = e.target.value;
      const results = el.querySelector('#manual-results');
      if (!results) return;
      if (q.length < 2) { results.innerHTML = ''; return; }

      const hits = [
        ...matchInvestors(q, investors),
        ...investors
          .filter(i => i.name.toLowerCase().includes(q.toLowerCase()))
          .filter(i => !matchInvestors(q, investors).find(m => m.inv.id === i.id))
          .slice(0, 3)
          .map(i => ({ inv: i, score: null })),
      ].slice(0, 6);

      for (const { inv } of hits) {
        if (!allMatchMap.has(inv.id)) allMatchMap.set(inv.id, { inv, score: null, via: null });
      }

      results.innerHTML = hits.map(({ inv, score }) => matchCardHtml(inv, score, null, selectedIds.has(inv.id))).join('');
      results.querySelectorAll('.match-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.dataset.invId;
          if (selectedIds.has(id)) selectedIds.delete(id);
          else selectedIds.add(id);
          syncFormAndMatchList();
        });
      });
    });

    // Status toggle buttons
    el.querySelector('#status-avholdt')?.addEventListener('click', () => {
      readForm(); form.status = 'avholdt'; rerenderForm();
    });
    el.querySelector('#status-planlagt')?.addEventListener('click', () => {
      readForm(); form.status = 'planlagt'; rerenderForm();
    });

    // Save log
    el.querySelector('#save-log-btn')?.addEventListener('click', async () => {
      readForm();
      const selectedInvs = getSelectedInvestors();
      if (!selectedInvs.length) return;
      const btn = el.querySelector('#save-log-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Lagrer…'; }
      try {
        for (const inv of selectedInvs) {
          await api.addLog({ ...form, investor_id: inv.id, investor_name: inv.name });
        }
        renderSuccessView(selectedInvs);
      } catch (e) {
        alert('Feil: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = selectedInvs.length > 1 ? `✓ Loggfør (${selectedInvs.length} investorer)` : '✓ Loggfør'; }
      }
    });
  }

  function syncFormAndMatchList() {
    readForm();
    // Re-render match list cards in-place
    const matchContainer = el.querySelector('#match-list');
    if (matchContainer) {
      const manualQ = el.querySelector('#manual-search')?.value || '';
      matchContainer.innerHTML = renderMatchList();
      // Reattach click events
      matchContainer.querySelectorAll('.match-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.dataset.invId;
          if (selectedIds.has(id)) selectedIds.delete(id);
          else selectedIds.add(id);
          syncFormAndMatchList();
        });
      });
      // Rebind manual search
      matchContainer.querySelector('#manual-search')?.addEventListener('input', e => {
        const q = e.target.value;
        if (q.length < 2) { matchContainer.querySelector('#manual-results').innerHTML = ''; return; }
        const hits = [
          ...matchInvestors(q, investors),
          ...investors.filter(i => i.name.toLowerCase().includes(q.toLowerCase())).slice(0, 3).map(i => ({ inv: i, score: null })),
        ].slice(0, 6);
        for (const { inv } of hits) {
          if (!allMatchMap.has(inv.id)) allMatchMap.set(inv.id, { inv, score: null, via: null });
        }
        const res = matchContainer.querySelector('#manual-results');
        if (res) {
          res.innerHTML = hits.map(({ inv, score }) => matchCardHtml(inv, score, null, selectedIds.has(inv.id))).join('');
          res.querySelectorAll('.match-card').forEach(c => {
            c.addEventListener('click', () => {
              const id = c.dataset.invId;
              if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
              syncFormAndMatchList();
            });
          });
        }
        if (manualQ) matchContainer.querySelector('#manual-search').value = manualQ;
      });
      if (manualQ) matchContainer.querySelector('#manual-search').value = manualQ;
    }
    rerenderForm();
  }

  function rerenderForm() {
    const col = el.querySelector('#log-form-col');
    if (col) {
      col.innerHTML = logFormHtml(form, lookups, selectedIds.size, parsed?.isCalendar);
      el.querySelector('#status-avholdt')?.addEventListener('click', () => { readForm(); form.status = 'avholdt'; rerenderForm(); });
      el.querySelector('#status-planlagt')?.addEventListener('click', () => { readForm(); form.status = 'planlagt'; rerenderForm(); });
      el.querySelector('#cancel-btn')?.addEventListener('click', () => { resetState(); renderDropZone(null); });
      el.querySelector('#save-log-btn')?.addEventListener('click', async () => {
        readForm();
        const selectedInvs = getSelectedInvestors();
        if (!selectedInvs.length) return;
        const btn = el.querySelector('#save-log-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Lagrer…'; }
        try {
          for (const inv of selectedInvs) {
            await api.addLog({ ...form, investor_id: inv.id, investor_name: inv.name });
          }
          renderSuccessView(selectedInvs);
        } catch (e) {
          alert('Feil: ' + e.message);
          if (btn) { btn.disabled = false; }
        }
      });
      // Update title
      const titleSel = el.querySelector('.card-title');
      // Update selected count in match list title
      const matchTitle = el.querySelectorAll('.card-title')[0];
      if (matchTitle && selectedIds.size > 0) {
        matchTitle.innerHTML = `Velg investor — <span style="color:var(--green)">${selectedIds.size} valgt</span>`;
      }
    }
  }

  function renderSuccessView(savedInvs) {
    el.innerHTML = `
      <div class="topbar"><span class="topbar-title">Importer fra Outlook</span></div>
      <div class="content">
        <div class="card" style="text-align:center;padding:56px;max-width:520px">
          <div style="font-size:44px;margin-bottom:12px">✓</div>
          <p style="font-weight:700;font-size:16px;color:var(--green)">
            Logget på ${savedInvs.length} investor${savedInvs.length > 1 ? 'er' : ''}
          </p>
          <div style="margin-top:10px;margin-bottom:24px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
            ${savedInvs.map(inv => `<button class="btn btn-ghost btn-sm inv-nav-btn" data-id="${window.escHtml(inv.id)}" style="min-height:44px">${window.escHtml(inv.name)} →</button>`).join('')}
          </div>
          <button class="btn btn-primary" id="import-new-btn" style="min-height:44px">Importer ny e-post</button>
        </div>
      </div>`;
    el.querySelectorAll('.inv-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => window.navigate('detalj', btn.dataset.id));
    });
    el.querySelector('#import-new-btn')?.addEventListener('click', () => {
      resetState();
      renderDropZone(null);
    });
  }

  renderDropZone(null);
}
