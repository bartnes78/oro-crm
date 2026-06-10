import { api } from '../api.js';

const LOG_ICONS = {
  'Møte':           '🤝',
  'Telefon':        '📞',
  'Tapt anrop':     '📵',
  'E-post mottatt': '📨',
  'E-post sendt':   '📤',
  'Event':          '🎯',
  'Video':          '📹',
  'Notat':          '📝',
  'Annet':          '📋',
};

function addDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── HTML builders ─────────────────────────────────────────────────────────────

function buildDetailHeader(inv, products) {
  const prodMap = Object.fromEntries(products.map(p => [p._id, p]));
  const interestedProds = (inv.product_interests || []).map(id => prodMap[id]).filter(Boolean);

  const prodPills = interestedProds.map(p => `
    <span style="display:inline-flex;align-items:center;gap:4px;">
      <button
        class="btn-prod-nav"
        data-product-id="${window.escHtml(String(p._id))}"
        style="background:none;border:none;padding:0;cursor:pointer;font-size:13px;color:var(--blue);font-weight:600;"
        title="Gå til prosjekt"
      >&#9733; ${window.escHtml(p.name)}</button>
      <button
        class="icon-btn icon-btn-danger icon-btn-sm btn-quick-decline"
        data-product-id="${window.escHtml(String(p._id))}"
        title="Registrer avslag"
      >&#x2715;</button>
    </span>
  `).join('');

  return `
    <div class="detail-header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${window.escHtml(String(inv.id))}</div>
          <h2 style="margin:0;display:flex;align-items:center;">${window.escHtml(inv.name)}${window.brregBadge(inv)}</h2>
        </div>
        ${window.phaseBadge(inv.phase)}
      </div>
      <div class="detail-meta" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:10px;font-size:13px;color:var(--muted);">
        <span>&#128205; ${window.escHtml([inv.city, inv.country || 'Norge'].filter(Boolean).join(', '))}</span>
        ${inv.investor_type ? `<span>&#127991; ${window.escHtml(inv.investor_type)}</span>` : ''}
        ${inv.lead ? `<span>&#128100; Lead: ${window.escHtml(inv.lead)}</span>` : ''}
        ${inv.advisor ? `<span>&#129309; ${window.escHtml(inv.advisor)}</span>` : ''}
        ${interestedProds.length > 0 ? `<span style="display:contents;">${prodPills}</span>` : ''}
      </div>
    </div>
  `;
}

function buildPipelineCard(inv, lookups) {
  const phaseOptions = (lookups.phases || []).map(p =>
    `<option ${inv.phase === p ? 'selected' : ''}>${window.escHtml(p)}</option>`
  ).join('');
  const leadOptions = `<option value="">—</option>` + (lookups.leads || []).map(l =>
    `<option ${inv.lead === l ? 'selected' : ''}>${window.escHtml(l)}</option>`
  ).join('');

  return `
    <div class="card">
      <div class="card-title">Pipeline</div>
      <div class="form-grid" style="gap:10px;">
        <div class="form-group">
          <label>Fase</label>
          <select id="inline-phase" style="font-size:13px;">${phaseOptions}</select>
        </div>
        <div class="form-group">
          <label>Ansvarlig</label>
          <select id="inline-lead" style="font-size:13px;">${leadOptions}</select>
        </div>
        <div class="form-group full">
          <label>Hva skal til</label>
          <textarea id="inline-nextsteps" style="min-height:70px;font-size:13px;">${window.escHtml(inv.next_steps || '')}</textarea>
        </div>
        <div class="form-group full">
          <label>Kommentar</label>
          <textarea id="inline-comments" style="min-height:60px;font-size:13px;">${window.escHtml(inv.comments || '')}</textarea>
        </div>
      </div>
      <div style="margin-top:10px;display:flex;gap:16px;font-size:12px;color:var(--muted);">
        <span>First Close: <b style="color:var(--text);">${inv.first_close ? 'Ja' : 'Nei'}</b></span>
        ${inv.last_contact ? `<span>Sist kontaktet: <b style="color:var(--text);">${window.escHtml(inv.last_contact)}</b></span>` : ''}
      </div>
    </div>
  `;
}

function buildDocsCard(inv, products) {
  const docs = inv.docs || {};
  const docItems = [
    { key: 'nda',         label: 'NDA signert',       hasVersion: false },
    { key: 'deck',        label: 'Deck sendt',        hasVersion: true  },
    { key: 'im_ppm',      label: 'IM/PPM sendt',      hasVersion: false },
    { key: 'fondsvilkar', label: 'Fondsvilk&aring;r sendt', hasVersion: false },
  ];
  const archivedPhases = ['Investor', 'Tidligere investor', 'P&aring; vent'];
  const isArchived = ['Investor', 'Tidligere investor', 'På vent'].includes(inv.phase);

  const relevantProducts = products.filter(p =>
    (inv.product_interests || []).includes(p._id) && p.name !== 'Felles prosjekt'
  );
  if (relevantProducts.length === 0) return '';

  const activeProds = isArchived
    ? relevantProducts.filter(p => docItems.some(i => (docs[String(p._id)] || {})[i.key]?.done))
    : relevantProducts;

  if (isArchived && activeProds.length === 0) return '';

  function buildDocProduct(p, archived) {
    const pd = docs[String(p._id)] || {};
    const doneCount = docItems.filter(i => pd[i.key]?.done).length;

    const rows = docItems.map(({ key, label, hasVersion }) => {
      const d = pd[key] || {};
      const disAttr = archived ? ' disabled' : '';
      return `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
          <input type="checkbox"
            class="doc-checkbox"
            data-product-id="${window.escHtml(String(p._id))}"
            data-doc-key="${key}"
            ${d.done ? 'checked' : ''}
            ${disAttr}
            style="width:16px;height:16px;cursor:${archived ? 'default' : 'pointer'};flex-shrink:0;min-width:16px;min-height:16px;" />
          <span style="font-size:13px;width:140px;opacity:${d.done ? 1 : .5};">${label}</span>
          <input type="date"
            class="doc-date"
            data-product-id="${window.escHtml(String(p._id))}"
            data-doc-key="${key}"
            value="${window.escHtml(d.date || '')}"
            ${disAttr}
            style="font-size:12px;padding:3px 6px;border-radius:5px;border:1px solid var(--border);width:130px;opacity:${d.done ? 1 : .4};" />
          ${hasVersion ? `
          <input type="text"
            class="doc-version"
            data-product-id="${window.escHtml(String(p._id))}"
            data-doc-key="${key}"
            value="${window.escHtml(d.version || '')}"
            placeholder="Versjon&hellip;"
            ${disAttr}
            style="font-size:12px;padding:3px 8px;border-radius:5px;border:1px solid var(--border);width:90px;" />
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <details ${!archived ? 'open' : ''} style="margin-bottom:8px;opacity:${archived ? .65 : 1};">
        <summary style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);cursor:pointer;padding-bottom:8px;user-select:none;list-style:none;display:flex;align-items:center;gap:6px;">
          ${window.escHtml(p.name)}
          ${doneCount > 0 ? `<span style="color:${archived ? 'var(--muted)' : 'var(--color-signed)'};font-size:11px;">&#10003; ${doneCount}/${docItems.length}</span>` : ''}
          ${archived ? '<span style="font-size:10px;color:var(--muted);font-style:italic;">arkivert</span>' : ''}
        </summary>
        <div style="display:flex;flex-direction:column;padding-left:4px;padding-bottom:8px;">
          ${rows}
        </div>
      </details>
    `;
  }

  const productsHtml = activeProds.map(p => buildDocProduct(p, isArchived)).join('');

  return `
    <div class="card">
      <div class="card-title">
        Dokumenter
        ${isArchived ? '<span style="margin-left:8px;font-size:11px;color:var(--muted);font-style:italic;font-weight:400;">arkiv</span>' : ''}
      </div>
      ${productsHtml}
    </div>
  `;
}

function buildKeyFigures(inv, products, piData, tasks) {
  const piMap      = Object.fromEntries(piData.map(pi => [pi.product_id, pi]));
  const interests  = new Set(inv.product_interests || []);
  const declinedIds = new Set((inv.declined_offers || []).map(d => d.product_id));
  const activeProds = products.filter(p => interests.has(p._id) && !declinedIds.has(p._id) && p.name !== 'Felles prosjekt');

  let totalWeighted = 0, totalCommitted = 0;
  const prodRows = activeProds.map(p => {
    const pi        = piMap[p._id] || {};
    const ticket    = pi.target_ticket    != null ? pi.target_ticket    : null;
    const prob      = pi.probability      != null ? Math.round(pi.probability * 100) : null;
    const committed = pi.committed_amount != null ? pi.committed_amount : null;
    if (ticket != null && pi.probability != null) totalWeighted += ticket * pi.probability;
    if (committed != null) totalCommitted += committed;
    return `
      <div style="padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:3px">${window.escHtml(p.name)}</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          ${ticket != null ? `<span style="font-size:13px;font-weight:600">${window.fmt(ticket, 0)} <span style="font-size:10px;color:var(--muted)">MNOK</span></span>` : '<span style="font-size:12px;color:var(--muted)">—</span>'}
          ${prob  != null ? `<span style="font-size:12px;color:var(--muted)">${prob}%</span>` : ''}
          ${committed != null ? `<span style="font-size:11px;font-weight:600;color:var(--color-signed);background:rgba(26,138,106,.08);padding:2px 7px;border-radius:10px">✓ ${window.fmt(committed, 0)}M</span>` : ''}
        </div>
      </div>`;
  }).join('');

  const openTasks   = tasks.filter(t => !t.done);
  const allLog      = inv.log || [];
  const todayIso    = new Date().toISOString().slice(0, 10);
  const planned     = allLog.filter(l => l.status === 'planlagt');
  const overdue     = planned.filter(l => l.date < todayIso);
  const activityCnt = allLog.filter(l => l.status !== 'planlagt').length;
  const primaryCtct = (inv.contacts || []).find(c => c.is_primary === 1 && c.active !== 0);
  const lastContactStr = inv.last_contact
    ? new Date(inv.last_contact).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  return `
    <div class="inv-sidebar" style="width:272px;flex-shrink:0;position:sticky;top:16px;align-self:flex-start">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          ${window.phaseBadge(inv.phase)}
          ${lastContactStr ? `<span style="font-size:11px;color:var(--muted)">Sist: ${window.escHtml(lastContactStr)}</span>` : '<span style="font-size:11px;color:var(--muted)">Ikke kontaktet</span>'}
        </div>

        ${activeProds.length > 0 ? `
          <div style="margin-bottom:12px">
            ${prodRows}
            ${totalWeighted > 0 || totalCommitted > 0 ? `
              <div style="margin-top:10px;display:flex;gap:16px;flex-wrap:wrap">
                ${totalWeighted > 0 ? `<div>
                  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">Vektet</div>
                  <div style="font-size:17px;font-weight:700">${window.fmt(totalWeighted, 1)} M</div>
                </div>` : ''}
                ${totalCommitted > 0 ? `<div>
                  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">Tegnet</div>
                  <div style="font-size:17px;font-weight:700;color:var(--color-signed)">${window.fmt(totalCommitted, 1)} M</div>
                </div>` : ''}
              </div>` : ''}
          </div>` : `<p style="font-size:12px;color:var(--muted);margin-bottom:12px">Ingen produktinteresse</p>`}

        <div style="display:flex;flex-direction:column;gap:9px;padding-top:12px;border-top:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;color:var(--muted)">📋 Aktiviteter</span>
            <span style="font-size:13px;font-weight:600">${activityCnt}</span>
          </div>
          ${planned.length > 0 ? `
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:12px;color:${overdue.length > 0 ? '#e74c3c' : 'var(--blue)'}">📅 Planlagte</span>
              <span style="font-size:13px;font-weight:600;color:${overdue.length > 0 ? '#e74c3c' : 'var(--blue)'}">${planned.length}${overdue.length > 0 ? ` (${overdue.length} forfalt)` : ''}</span>
            </div>` : ''}
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;color:var(--muted)">☑ Åpne oppgaver</span>
            <span style="font-size:13px;font-weight:600${openTasks.length > 0 ? ';color:#e67e22' : ''}">${openTasks.length}</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;color:var(--muted)">👤 Kontakter</span>
            <span style="font-size:13px;font-weight:600">${(inv.contacts || []).filter(c => c.active !== 0).length}</span>
          </div>
          ${primaryCtct ? `
            <div style="background:var(--bg);border-radius:8px;padding:8px 10px;margin-top:2px">
              <div style="font-size:12px;font-weight:600">${window.escHtml(primaryCtct.name)}</div>
              ${primaryCtct.title ? `<div style="font-size:11px;color:var(--muted)">${window.escHtml(primaryCtct.title)}</div>` : ''}
              ${primaryCtct.email ? `<a href="mailto:${window.escHtml(primaryCtct.email)}" style="font-size:11px;color:var(--blue);text-decoration:none;display:block;margin-top:2px">${window.escHtml(primaryCtct.email)}</a>` : ''}
              ${primaryCtct.phone ? `<div style="font-size:11px;color:var(--muted)">${window.escHtml(primaryCtct.phone)}</div>` : ''}
              ${primaryCtct.phone2 ? `<div style="font-size:11px;color:var(--muted)">${window.escHtml(primaryCtct.phone2)}</div>` : ''}
            </div>` : ''}
        </div>
      </div>
    </div>`;
}

function buildContactsCard(inv, visInaktive) {
  const contacts = (inv.contacts || [])
    .filter(c => c.active !== 0 || visInaktive)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const aBrreg = a.c.source === 'brreg' ? 1 : 0;
      const bBrreg = b.c.source === 'brreg' ? 1 : 0;
      return aBrreg - bBrreg || a.i - b.i;
    })
    .map(({ c }) => c);
  const inaktiveCount = (inv.contacts || []).filter(c => c.active === 0).length;

  const contactsHtml = contacts.length === 0
    ? '<p class="text-muted" style="font-size:13px;">Ingen kontakter registrert.</p>'
    : contacts.map(c => {
        const inaktiv = c.active === 0;
        return `
          <div style="border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:12px;opacity:${inaktiv ? .45 : 1};">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-weight:600;font-size:14px;text-decoration:${inaktiv ? 'line-through' : 'none'};">${window.escHtml(c.name)}</span>
                ${c.is_primary === 1 && !inaktiv ? '<span class="badge badge-prospect" style="font-size:10px;">Prim&aelig;r</span>' : ''}
                ${c.source === 'brreg' ? '<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:rgba(26,138,106,.1);color:#1a8a6a;font-weight:600;">Brreg</span>' : ''}
                ${inaktiv ? '<span style="font-size:10px;color:var(--muted);font-style:italic;">inaktiv</span>' : ''}
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${!inaktiv ? `<button class="btn btn-ghost btn-sm contact-edit-btn" data-contact-id="${window.escHtml(String(c._id))}" style="font-size:11px;padding:2px 8px;min-height:32px;">Rediger</button>` : ''}
                <button class="btn btn-ghost btn-sm contact-toggle-btn" data-contact-id="${window.escHtml(String(c._id))}" data-active="${inaktiv ? 0 : 1}" style="font-size:11px;padding:2px 8px;color:${inaktiv ? 'var(--color-signed)' : '#e07000'};min-height:32px;">${inaktiv ? 'Aktiver' : 'Deaktiver'}</button>
                <button class="btn btn-ghost btn-sm contact-delete-btn" data-contact-id="${window.escHtml(String(c._id))}" style="font-size:11px;padding:2px 8px;color:#e74c3c;min-height:32px;">Slett</button>
              </div>
            </div>
            ${c.title ? `<div style="font-size:12px;color:var(--muted);margin-top:2px;">${window.escHtml(c.title)}</div>` : ''}
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;">
              ${c.email ? `<a href="mailto:${window.escHtml(c.email)}" style="font-size:12px;color:var(--blue);text-decoration:none;">&#9993; ${window.escHtml(c.email)}</a>` : ''}
              ${c.phone ? `<span style="font-size:12px;color:#555;">&#128222; ${window.escHtml(c.phone)}</span>` : ''}
              ${c.phone2 ? `<span style="font-size:12px;color:#555;">&#128222; ${window.escHtml(c.phone2)}</span>` : ''}
              ${c.notes ? `<span style="font-size:11px;color:#aaa;font-style:italic;">${window.escHtml(c.notes)}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <div class="card-title" style="margin:0;">Kontakter</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${inaktiveCount > 0 ? `
            <button class="btn btn-ghost btn-sm" id="toggle-inaktive" style="font-size:11px;opacity:.7;min-height:36px;">
              ${visInaktive ? 'Skjul inaktive' : `Vis inaktive (${inaktiveCount})`}
            </button>` : ''}
          <button class="btn btn-ghost btn-sm" id="add-contact-btn" style="min-height:36px;">+ Legg til</button>
        </div>
      </div>
      ${contactsHtml}
    </div>
  `;
}

function buildProductCard(inv, products, piData) {
  if (products.length === 0) return '';
  const piMap = Object.fromEntries(piData.map(pi => [pi.product_id, pi]));
  const interests = new Set(inv.product_interests || []);

  // Declined offers: map product_id → {decline_reason, declined_at}
  const declinedList = inv.declined_offers || [];
  const declinedMap  = Object.fromEntries(declinedList.map(d => [d.product_id, d]));
  const declinedIds  = new Set(declinedList.map(d => d.product_id));

  // Totals: only active interests (not declined)
  let totalWeighted = 0, totalCommitted = 0;
  for (const p of products) {
    if (!interests.has(p._id) || declinedIds.has(p._id)) continue;
    const pi = piMap[p._id] || {};
    if (pi.target_ticket != null && pi.probability != null) totalWeighted += pi.target_ticket * pi.probability;
    if (pi.committed_amount != null) totalCommitted += pi.committed_amount;
  }

  // Rows — only Pipeline/Fundraise products; delt i tre seksjoner
  const ACTIVE_STATUSES = new Set(['Pipeline', 'Fundraise', 'Fundraising']);
  const activeRows = [], tegnetRows = [], declinedRows = [];

  products.forEach(p => {
    if (!ACTIVE_STATUSES.has(p.status)) return;

    const isDeclined = declinedIds.has(p._id);
    const interested  = interests.has(p._id);
    const pi          = piMap[p._id] || {};
    const isTegnet    = pi.committed_amount != null;

    if (isDeclined) {
      const d = declinedMap[p._id];
      const dateStr = d.declined_at
        ? new Date(d.declined_at).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' })
        : '';
      declinedRows.push(`
        <div style="padding:8px 0 8px 10px;border-bottom:1px solid var(--border);border-left:3px solid #e74c3c;
                    display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:rgba(231,76,60,.05);">
          <span style="flex:1;min-width:160px;font-size:13px;font-weight:600;
                       text-decoration:line-through;color:var(--muted);">${window.escHtml(p.name)}</span>
          <span style="font-size:11px;padding:2px 10px;border-radius:20px;
                       background:#e74c3c;color:#fff;font-weight:700;white-space:nowrap;">&#x2715; Takket nei</span>
          ${dateStr ? `<span style="font-size:11px;color:var(--muted);white-space:nowrap;">${window.escHtml(dateStr)}</span>` : ''}
          ${d.decline_reason ? `<span style="font-size:11px;color:var(--muted);font-style:italic;flex-basis:100%;">&ldquo;${window.escHtml(d.decline_reason)}&rdquo;</span>` : ''}
        </div>`);
      return;
    }

    const row = `
      <div class="pi-row" style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;min-width:180px;">
          <label style="display:flex;align-items:center;cursor:pointer;flex-shrink:0;">
            <input type="checkbox" class="pi-toggle" data-pid="${window.escHtml(String(p._id))}"
              ${interested ? 'checked' : ''}
              style="width:16px;height:16px;cursor:pointer;accent-color:var(--blue);" />
          </label>
          <button class="pi-name-nav" data-pid="${window.escHtml(String(p._id))}"
            style="background:none;border:none;padding:0;cursor:pointer;text-align:left;
                   font-weight:${interested ? 600 : 400};font-size:13px;
                   color:${interested ? 'var(--blue)' : 'var(--muted)'};">
            ${window.escHtml(p.name)}
          </button>
        </div>
        ${interested ? `
          <div style="display:flex;align-items:center;gap:4px;">
            <input class="pi-ticket" type="number" step="0.5" data-pid="${window.escHtml(String(p._id))}"
              value="${pi.target_ticket != null ? pi.target_ticket : ''}" placeholder="—"
              style="width:75px;font-size:12px;padding:3px 6px;border-radius:5px;border:1px solid var(--border);text-align:right;" />
            <span style="font-size:12px;color:var(--muted);">MNOK</span>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <input class="pi-prob" type="number" min="0" max="100" step="5" data-pid="${window.escHtml(String(p._id))}"
              value="${pi.probability != null ? Math.round(pi.probability * 100) : ''}" placeholder="—"
              style="width:60px;font-size:12px;padding:3px 6px;border-radius:5px;border:1px solid var(--border);text-align:right;" />
            <span style="font-size:12px;color:var(--muted);">%</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-left:auto;">
            ${isTegnet ? `<span style="font-size:11px;padding:2px 10px;border-radius:20px;background:rgba(26,138,106,.12);color:var(--color-signed);font-weight:700;">&#10003; Tegnet${pi.committed_amount ? ' ' + pi.committed_amount + 'M' : ''}</span>` : ''}
            <button class="pi-tegnet-btn btn btn-ghost btn-sm"
              data-pid="${window.escHtml(String(p._id))}"
              data-pname="${window.escHtml(p.name)}"
              data-committed="${pi.committed_amount != null ? pi.committed_amount : ''}"
              style="font-size:11px;color:var(--color-signed);border-color:var(--color-signed);min-height:28px;padding:2px 8px;">
              ${isTegnet ? 'Endre tegning' : '+ Tegnet'}
            </button>
            <button class="btn-quick-decline btn btn-ghost btn-sm"
              data-product-id="${window.escHtml(String(p._id))}"
              style="font-size:11px;color:#e74c3c;border-color:#e74c3c;min-height:28px;padding:2px 8px;">&#x2715; Avslag</button>
          </div>
        ` : ''}
      </div>
    `;

    (isTegnet ? tegnetRows : activeRows).push(row);
  });

  const sectionHeader = (label, color) => `
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${color};margin:14px 0 4px;">${label}</div>`;

  const allRows = `
    ${activeRows.join('')}
    ${tegnetRows.length ? sectionHeader('Tegnet', 'var(--color-signed)') + tegnetRows.join('') : ''}
    ${declinedRows.length ? sectionHeader('Avslått', '#e74c3c') + declinedRows.join('') : ''}
  `;

  const aggregateHtml = (totalWeighted > 0 || totalCommitted > 0) ? `
    <div style="margin-top:12px;padding-top:10px;border-top:2px solid var(--border);display:flex;gap:24px;flex-wrap:wrap;">
      ${totalWeighted > 0 ? `
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;">Vektet volum</div>
          <div style="font-size:18px;font-weight:700;color:var(--text);">${window.fmt(totalWeighted, 1)} MNOK</div>
        </div>` : ''}
      ${totalCommitted > 0 ? `
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;">Totalt tegnet</div>
          <div style="font-size:18px;font-weight:700;color:var(--color-signed);">${window.fmt(totalCommitted, 1)} MNOK</div>
        </div>` : ''}
    </div>
  ` : '';

  return `
    <div class="card">
      <div class="card-title">Produktinteresse</div>
      ${allRows}
      ${aggregateHtml}
    </div>
  `;
}

function buildLogCard(inv, products) {
  const allLog = inv.log || [];
  const planlagt = allLog.filter(l => l.status === 'planlagt').sort((a, b) => a.date.localeCompare(b.date));
  const avholdt  = allLog.filter(l => l.status !== 'planlagt').sort((a, b) => b.date.localeCompare(a.date));
  const prodMap = Object.fromEntries(products.map(p => [p._id, p]));

  const todayStr = new Date().toISOString().slice(0, 10);

  function buildLogRow(l) {
    const isPlanlagt = l.status === 'planlagt';
    const isOverdue  = isPlanlagt && l.date < todayStr;
    const icon       = LOG_ICONS[l.log_type] || '📋';
    const declinedHtml = (l.declined_products || []).length > 0 ? `
      <div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
        <span style="font-size:11px;color:#e74c3c;font-weight:600;">Avsto fra:</span>
        ${(l.declined_products || []).map(id => {
          const prod = prodMap[id];
          return prod ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(231,76,60,.1);color:#e74c3c;font-weight:600;">${window.escHtml(prod.name)}</span>` : '';
        }).join('')}
      </div>
    ` : '';

    return `
      <div class="log-item" data-log-id="${window.escHtml(String(l._id))}" style="${isOverdue ? 'background:rgba(231,76,60,.04);border-radius:6px;padding:8px 10px;margin-bottom:4px;' : isPlanlagt ? 'background:rgba(52,152,219,.04);border-radius:6px;padding:8px 10px;margin-bottom:4px;' : ''}">
        <div class="log-item-top" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:15px;flex-shrink:0">${icon}</span>
          <span class="log-date" style="${isOverdue ? 'color:#e74c3c;font-weight:600;' : isPlanlagt ? 'color:var(--blue);font-weight:600;' : ''}">${window.escHtml(l.date)}${isOverdue ? ' ⚠' : ''}</span>
          <span class="badge badge-default">${window.escHtml(l.log_type || 'Kontakt')}</span>
          ${l.contact_person ? `<span style="font-size:12px;color:#555;">${window.escHtml(l.contact_person)}</span>` : ''}
          <span class="log-who" style="font-size:12px;color:var(--muted);">${window.escHtml(l.responsible || '')}</span>
          ${isPlanlagt ? `
            <button class="btn log-marker-avholdt" data-log-id="${window.escHtml(String(l._id))}" style="margin-left:4px;font-size:11px;padding:2px 8px;border-radius:5px;border:1px solid var(--color-signed);background:rgba(26,138,106,.08);color:var(--color-signed);cursor:pointer;font-weight:600;min-height:28px;">
              &#10003; Marker avholdt
            </button>` : ''}
          <button class="icon-btn log-edit-btn" data-log-id="${window.escHtml(String(l._id))}" title="Rediger" style="margin-left:auto;">&#9998;</button>
          <button class="icon-btn icon-btn-danger log-delete-btn" data-log-id="${window.escHtml(String(l._id))}" title="Slett">&#x2715;</button>
        </div>
        ${l.subject ? `<div class="log-subject" style="font-size:13px;font-weight:600;margin-top:4px;">${window.escHtml(l.subject)}</div>` : ''}
        ${l.outcome ? `<div class="log-outcome" style="font-size:12px;color:#555;margin-top:2px;">${window.escHtml(l.outcome)}</div>` : ''}
        ${declinedHtml}
        ${l.notes ? `<div style="font-size:12px;color:#888;margin-top:3px;font-style:italic;">${window.escHtml(l.notes)}</div>` : ''}
      </div>
    `;
  }

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div class="card-title" style="margin:0;">Aktiviteter</div>
        <button class="btn btn-ghost btn-sm" id="new-log-btn" style="min-height:36px;">+ Ny</button>
      </div>
      ${allLog.length === 0 ? '<p class="text-muted" style="font-size:13px;">Ingen aktiviteter registrert.</p>' : ''}
      ${planlagt.length > 0 ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--blue);margin-bottom:6px;">Planlagt</div>
        ${planlagt.map(buildLogRow).join('')}
        ${avholdt.length > 0 ? '<div style="height:1px;background:var(--border);margin:12px 0;"></div>' : ''}
      ` : ''}
      ${avholdt.map(buildLogRow).join('')}
    </div>
  `;
}

function buildBrregCard(inv) {
  if (inv.org_nr) {
    // ── Koblet: vis stamdata + adresser + roller ──────────────────────────────
    const bd = inv.brreg_data || {};
    const adresser = (bd.adresser || []).map(a => {
      const linje = [a.adresse ? a.adresse.join(', ') : null, a.postnummer && a.poststed ? `${a.postnummer} ${a.poststed}` : a.poststed, a.land !== 'Norge' ? a.land : null].filter(Boolean).join(' · ');
      return `
        <div style="margin-bottom:4px;">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-right:6px;">${window.escHtml(a.type)}</span>
          <span style="font-size:13px;">${window.escHtml(linje)}</span>
        </div>`;
    }).join('');

    const eksisterendeKontakter = new Set((inv.contacts || []).map(c => c.name.toLowerCase()));
    const roller = (bd.roller || []).map(r => {
      const alleredeKontakt = eksisterendeKontakter.has(r.navn.toLowerCase());
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">
        <div style="flex:1;">
          <span style="font-size:13px;font-weight:600;">${window.escHtml(r.navn)}</span>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:11px;font-weight:600;color:var(--text);">${window.escHtml(r.type)}</div>
          ${r.gruppe && r.gruppe !== r.type ? `<div style="font-size:10px;color:var(--muted);">${window.escHtml(r.gruppe)}</div>` : ''}
        </div>
        ${alleredeKontakt ? '' : `
          <button class="btn btn-ghost btn-sm brreg-add-contact-btn" style="font-size:11px;min-height:28px;padding:2px 8px;flex-shrink:0;"
            data-navn="${window.escHtml(r.navn)}" data-tittel="${window.escHtml(r.type)}">+ Kontakt</button>`}
      </div>`;
    }).join('');

    const syncedAt = bd.synced_at
      ? new Date(bd.synced_at).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })
      : null;

    return `
      <div class="card" id="brreg-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
          <div class="card-title" style="margin:0;">
            Brønnøysund
            <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:8px;">${window.escHtml(inv.org_nr)}</span>
          </div>
          <button class="btn btn-ghost btn-sm" id="brreg-sync-btn" style="font-size:11px;min-height:32px;">&#8635; Synkroniser</button>
        </div>

        ${inv.brreg_navn ? `<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Registrert navn: <b style="color:var(--text);">${window.escHtml(inv.brreg_navn)}</b></div>` : ''}

        <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--muted);margin-bottom:12px;">
          ${bd.orgform      ? `<span>&#127970; ${window.escHtml(bd.orgform)}</span>`      : ''}
          ${bd.naeringskode ? `<span>&#128200; ${window.escHtml(bd.naeringskode)}</span>` : ''}
          ${bd.stiftet      ? `<span>&#128197; Stiftet ${window.escHtml(bd.stiftet)}</span>` : ''}
          ${bd.ansatte != null ? `<span>&#128101; ${bd.ansatte} ansatte</span>` : ''}
        </div>

        ${adresser ? `<div style="margin-bottom:12px;">${adresser}</div>` : ''}

        ${roller ? `
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px;">Roller</div>
            ${roller}
          </div>` : ''}

        ${syncedAt ? `<div style="font-size:10px;color:var(--muted);margin-top:10px;text-align:right;">Synkronisert ${window.escHtml(syncedAt)}</div>` : ''}
      </div>
    `;
  }

  // ── Ikke koblet: søkeskjema ───────────────────────────────────────────────
  return `
    <div class="card" id="brreg-card">
      <div class="card-title">Brønnøysund</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px;">Koble investor til Brønnøysundregistrene for å hente stamdata, adresser og roller.</p>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <input id="brreg-search-input" type="text"
          placeholder="Søk på navn eller skriv inn org.nr (9 siffer)&hellip;"
          style="flex:1;font-size:13px;padding:6px 10px;border-radius:6px;border:1px solid var(--border);" />
        <button class="btn btn-ghost btn-sm" id="brreg-search-btn" style="min-height:36px;white-space:nowrap;">Søk</button>
      </div>
      <div id="brreg-search-results" style="display:none;border:1px solid var(--border);border-radius:6px;overflow:hidden;margin-bottom:6px;"></div>
      <div id="brreg-search-error" style="display:none;font-size:12px;color:#e74c3c;margin-top:4px;"></div>
    </div>
  `;
}

function buildTasksCard(tasks) {
  const tasksHtml = tasks.length === 0
    ? '<p class="text-muted" style="font-size:13px;">Ingen oppgaver.</p>'
    : tasks.map(t => `
      <div style="display:flex;align-items:flex-start;gap:10px;border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:10px;" data-task-id="${window.escHtml(String(t._id))}">
        <input type="checkbox"
          class="task-checkbox"
          data-task-id="${window.escHtml(String(t._id))}"
          ${t.done ? 'checked' : ''}
          style="width:16px;height:16px;margin-top:2px;cursor:pointer;flex-shrink:0;min-width:16px;min-height:16px;" />
        <div style="flex:1;opacity:${t.done ? .6 : 1};">
          <div style="font-size:13px;font-weight:600;text-decoration:${t.done ? 'line-through' : 'none'};color:${t.done ? 'var(--muted)' : 'var(--text)'};">${window.escHtml(t.label)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;display:flex;gap:8px;">
            ${t.due_date ? `<span>&#128197; ${window.escHtml(t.due_date)}</span>` : ''}
            ${t.responsible ? `<span>&#128100; ${window.escHtml(t.responsible)}</span>` : ''}
          </div>
        </div>
        <button class="icon-btn icon-btn-danger task-delete-btn" data-task-id="${window.escHtml(String(t._id))}">&#x2715;</button>
      </div>
    `).join('');

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div class="card-title" style="margin:0;">Oppgaver</div>
        <button class="btn btn-ghost btn-sm" id="new-task-btn" style="min-height:36px;">+ Ny oppgave</button>
      </div>
      ${tasksHtml}
    </div>
  `;
}

// ── Modal builders ────────────────────────────────────────────────────────────

function buildProductPills(products, selectedIds, inputName) {
  return products.map(p => {
    const checked = (selectedIds || []).includes(p._id);
    return `
      <label style="display:inline-flex;flex-direction:row;gap:6px;align-items:center;cursor:pointer;
        padding:5px 12px;border-radius:20px;border:2px solid;
        border-color:${checked ? 'var(--blue)' : 'var(--border)'};
        background:${checked ? 'rgba(52,152,219,.1)' : 'transparent'};
        color:${checked ? 'var(--blue)' : 'var(--muted)'};
        font-weight:${checked ? 600 : 400};font-size:13px;min-height:34px;">
        <input type="checkbox" name="${inputName}" value="${window.escHtml(String(p._id))}" ${checked ? 'checked' : ''} style="display:none;" />
        ${window.escHtml(p.name)}
      </label>
    `;
  }).join('');
}

function buildDeclinedPills(products, productInterests, selectedIds) {
  return (productInterests || []).map(id => {
    const prod = products.find(p => p._id === id);
    if (!prod) return '';
    const checked = (selectedIds || []).includes(id);
    return `
      <label style="display:inline-flex;flex-direction:row;gap:5px;align-items:center;cursor:pointer;
        padding:4px 10px;border-radius:20px;border:2px solid;
        border-color:${checked ? '#e74c3c' : 'var(--border)'};
        background:${checked ? 'rgba(231,76,60,.08)' : 'transparent'};
        color:${checked ? '#e74c3c' : 'var(--muted)'};
        font-weight:${checked ? 600 : 400};font-size:12px;min-height:32px;min-width:60px;">
        <input type="checkbox" name="declined_products" value="${window.escHtml(String(id))}" ${checked ? 'checked' : ''} style="display:none;" />
        ${window.escHtml(prod.name)}
      </label>
    `;
  }).join('');
}

function buildStatusToggle(currentStatus) {
  return ['avholdt', 'planlagt'].map(s => `
    <button type="button" class="status-toggle-btn" data-status="${s}"
      style="flex:1;padding:8px 0;border-radius:7px;border:2px solid;min-height:44px;
        border-color:${currentStatus === s ? (s === 'planlagt' ? 'var(--blue)' : 'var(--color-signed)') : 'var(--border)'};
        background:${currentStatus === s ? (s === 'planlagt' ? 'rgba(52,152,219,.1)' : 'rgba(26,138,106,.1)') : 'transparent'};
        color:${currentStatus === s ? (s === 'planlagt' ? 'var(--blue)' : 'var(--color-signed)') : 'var(--muted)'};
        font-weight:600;font-size:13px;cursor:pointer;">
      ${s === 'planlagt' ? '&#128197; Planlagt' : '&#10003; Avholdt'}
    </button>
  `).join('');
}

function openEditModal(inv, lookups, products, reload) {
  const html = window.ui.modal(
    'Rediger investor',
    `<div id="edit-error" class="alert-err" style="display:none;"></div>
    <div class="form-grid">
      <div class="form-group full"><label>Navn</label><input id="e-name" value="${window.escHtml(inv.name || '')}" /></div>
      <div class="form-group"><label>Land</label><input id="e-country" value="${window.escHtml(inv.country || '')}" /></div>
      <div class="form-group"><label>By</label><input id="e-city" value="${window.escHtml(inv.city || '')}" placeholder="Oslo, Bergen&hellip;" /></div>
      <div class="form-group"><label>Type investor</label>
        <select id="e-type">
          <option value="">—</option>
          ${(lookups.types || []).map(t => `<option ${inv.investor_type === t ? 'selected' : ''}>${window.escHtml(t)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>R&aring;dgiver</label>
        <select id="e-advisor">
          <option value="">—</option>
          ${(lookups.advisors || []).map(a => `<option ${inv.advisor === a ? 'selected' : ''}>${window.escHtml(a)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>First Close</label>
        <select id="e-firstclose">
          <option value="0" ${!inv.first_close ? 'selected' : ''}>Nei</option>
          <option value="1" ${inv.first_close ? 'selected' : ''}>Ja</option>
        </select>
      </div>
    </div>`,
    `<button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
    <button class="btn btn-primary" id="edit-save-btn">Lagre</button>`,
  );

  window.openModal(html, () => {
    document.getElementById('edit-save-btn').addEventListener('click', async () => {
      const name = document.getElementById('e-name').value.trim();
      if (!name) {
        const errEl = document.getElementById('edit-error');
        errEl.textContent = 'Navn er p&aring;krevd';
        errEl.style.display = '';
        return;
      }

      const data = {
        name,
        country:       document.getElementById('e-country').value.trim(),
        city:          document.getElementById('e-city').value.trim(),
        investor_type: document.getElementById('e-type').value,
        advisor:       document.getElementById('e-advisor').value,
        first_close:   parseInt(document.getElementById('e-firstclose').value),
      };

      const btn = document.getElementById('edit-save-btn');
      btn.disabled = true;
      btn.textContent = 'Lagrer&hellip;';
      try {
        await api.updateInvestor(inv.id, data);
        window.closeModal();
        await reload();
      } catch (e) {
        const errEl = document.getElementById('edit-error');
        if (errEl) {
          errEl.textContent = e.message;
          errEl.style.display = '';
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Lagre'; }
      }
    });
  });
}

function openLogModal(inv, lookups, products, reload, prefill = {}) {
  const defResponsible = prefill.responsible || 'Kristian Bartnes';
  const initStatus = prefill.status || 'avholdt';

  const html = window.ui.modal(
    `Logg kontakt &mdash; ${window.escHtml(inv.name)}`,
    `<div id="log-error" class="alert-err" style="display:none;"></div>
    <div class="form-grid">
      <div class="form-group"><label>Dato</label>
        <input type="date" id="l-date" value="${window.escHtml(prefill.date || today())}" />
      </div>
      <div class="form-group"><label>Type</label>
        <select id="l-type">
          ${(lookups.logTypes || []).map(t => `<option ${(prefill.log_type || 'M&oslash;te') === t ? 'selected' : ''}>${window.escHtml(t)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Kontaktperson</label>
        <select id="l-contact">
          <option value="">— Velg —</option>
          ${(inv.contacts || []).filter(c => c.active !== 0).map(c => `
            <option value="${window.escHtml(c.name)}" ${(prefill.contact_person || '') === c.name ? 'selected' : ''}>
              ${window.escHtml(c.name)}${c.title ? ' (' + window.escHtml(c.title) + ')' : ''}
            </option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Ansvarlig</label>
        <select id="l-responsible">
          ${(lookups.leads || []).map(l => `<option ${defResponsible === l ? 'selected' : ''}>${window.escHtml(l)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group full" style="grid-column:1/-1;">
        <label>Status</label>
        <div style="display:flex;gap:8px;margin-top:4px;" id="l-status-wrap">
          ${buildStatusToggle(initStatus)}
        </div>
        <input type="hidden" id="l-status" value="${initStatus}" />
      </div>
      <div class="form-group full"><label>Emne / Agenda</label>
        <input id="l-subject" value="${window.escHtml(prefill.subject || '')}" />
      </div>
      <div class="form-group full"><label>Utfall / Neste steg</label>
        <textarea id="l-outcome">${window.escHtml(prefill.outcome || '')}</textarea>
      </div>
      ${(inv.product_interests || []).length > 0 ? `
      <div class="form-group full">
        <label>Avsto fra <span style="font-weight:400;color:var(--muted);font-size:11px;">(valgfritt)</span></label>
        <div id="l-declined" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
          ${buildDeclinedPills(products, inv.product_interests, prefill.declined_products || [])}
        </div>
      </div>` : ''}
      <div class="form-group full"><label>Notat</label>
        <textarea id="l-notes">${window.escHtml(prefill.notes || '')}</textarea>
      </div>
    </div>`,
    `<button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
    <button class="btn btn-green" id="log-save-btn">Logg &#8594;</button>`,
  );

  window.openModal(html, () => {
    setupStatusToggle('l-status-wrap', 'l-status');
    setupDeclinedPills('l-declined');

    document.getElementById('log-save-btn').addEventListener('click', async () => {
      const date = document.getElementById('l-date').value;
      if (!date) return;

      const declinedInputs = document.querySelectorAll('#l-declined input[type=checkbox]:checked');
      const declined = [...declinedInputs].map(cb => {
        const v = cb.value;
        return isNaN(v) ? v : Number(v);
      });

      const data = {
        date,
        investor_id:       inv.id,
        investor_name:     inv.name,
        log_type:          document.getElementById('l-type').value,
        contact_person:    document.getElementById('l-contact').value,
        responsible:       document.getElementById('l-responsible').value,
        status:            document.getElementById('l-status').value,
        subject:           document.getElementById('l-subject').value,
        outcome:           document.getElementById('l-outcome').value,
        notes:             document.getElementById('l-notes').value,
        declined_products: declined,
      };

      const btn = document.getElementById('log-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        await api.addLog(data);
        window.closeModal();
        await reload();
      } catch (e) {
        const errEl = document.getElementById('log-error');
        if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
        if (btn) { btn.disabled = false; btn.textContent = 'Logg &rarr;'; }
      }
    });
  });
}

function openEditLogModal(entry, inv, lookups, products, reload) {
  const html = window.ui.modal(
    'Rediger aktivitet',
    `<div id="editlog-error" class="alert-err" style="display:none;"></div>
    <div class="form-grid">
      <div class="form-group"><label>Dato</label>
        <input type="date" id="el-date" value="${window.escHtml(entry.date || '')}" />
      </div>
      <div class="form-group"><label>Type</label>
        <select id="el-type">
          ${(lookups.logTypes || []).map(t => `<option ${entry.log_type === t ? 'selected' : ''}>${window.escHtml(t)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Kontaktperson</label>
        <select id="el-contact">
          <option value="">— Velg —</option>
          ${(inv.contacts || []).filter(c => c.active !== 0).map(c => `
            <option value="${window.escHtml(c.name)}" ${(entry.contact_person || '') === c.name ? 'selected' : ''}>
              ${window.escHtml(c.name)}${c.title ? ' (' + window.escHtml(c.title) + ')' : ''}
            </option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Ansvarlig</label>
        <select id="el-responsible">
          ${(lookups.leads || []).map(l => `<option ${entry.responsible === l ? 'selected' : ''}>${window.escHtml(l)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group full" style="grid-column:1/-1;">
        <label>Status</label>
        <div style="display:flex;gap:8px;margin-top:4px;" id="el-status-wrap">
          ${buildStatusToggle(entry.status || 'avholdt')}
        </div>
        <input type="hidden" id="el-status" value="${window.escHtml(entry.status || 'avholdt')}" />
      </div>
      <div class="form-group full"><label>Emne / Agenda</label>
        <input id="el-subject" value="${window.escHtml(entry.subject || '')}" />
      </div>
      <div class="form-group full"><label>Utfall / Neste steg</label>
        <textarea id="el-outcome">${window.escHtml(entry.outcome || '')}</textarea>
      </div>
      ${(inv.product_interests || []).length > 0 ? `
      <div class="form-group full">
        <label>Avsto fra <span style="font-weight:400;color:var(--muted);font-size:11px;">(valgfritt)</span></label>
        <div id="el-declined" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
          ${buildDeclinedPills(products, inv.product_interests, entry.declined_products || [])}
        </div>
      </div>` : ''}
      <div class="form-group full"><label>Notat</label>
        <textarea id="el-notes">${window.escHtml(entry.notes || '')}</textarea>
      </div>
    </div>`,
    `<button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
    <button class="btn btn-primary" id="editlog-save-btn">Lagre</button>`,
  );

  window.openModal(html, () => {
    setupStatusToggle('el-status-wrap', 'el-status');
    setupDeclinedPills('el-declined');

    document.getElementById('editlog-save-btn').addEventListener('click', async () => {
      const declined = [...document.querySelectorAll('#el-declined input[type=checkbox]:checked')]
        .map(cb => { const v = cb.value; return isNaN(v) ? v : Number(v); });

      const data = {
        date:              document.getElementById('el-date').value,
        log_type:          document.getElementById('el-type').value,
        contact_person:    document.getElementById('el-contact').value,
        responsible:       document.getElementById('el-responsible').value,
        status:            document.getElementById('el-status').value,
        subject:           document.getElementById('el-subject').value,
        outcome:           document.getElementById('el-outcome').value,
        notes:             document.getElementById('el-notes').value,
        declined_products: declined,
      };

      const btn = document.getElementById('editlog-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        await api.updateLog(entry._id, data);
        window.closeModal();
        await reload();
      } catch (e) {
        const errEl = document.getElementById('editlog-error');
        if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
        if (btn) { btn.disabled = false; btn.textContent = 'Lagre'; }
      }
    });
  });
}

function openContactModal(contact, reload) {
  const isNew = !contact._id;
  const html = window.ui.modal(
    isNew ? 'Legg til kontaktperson' : 'Rediger kontaktperson',
    `<div class="form-grid">
      <div class="form-group full">
        <label>Navn *</label>
        <input id="c-name" value="${window.escHtml(contact.name || '')}" placeholder="Fullt navn" autofocus />
      </div>
      <div class="form-group full">
        <label>Tittel</label>
        <input id="c-title" value="${window.escHtml(contact.title || '')}" placeholder="CIO, Portfolio Manager&hellip;" />
      </div>
      <div class="form-group">
        <label>E-post</label>
        <input id="c-email" type="email" value="${window.escHtml(contact.email || '')}" placeholder="navn@selskap.no" />
      </div>
      <div class="form-group">
        <label>Telefon</label>
        <input id="c-phone" value="${window.escHtml(contact.phone || '')}" placeholder="+47 900 00 000" />
      </div>
      <div class="form-group">
        <label>Telefon 2</label>
        <input id="c-phone2" value="${window.escHtml(contact.phone2 || '')}" placeholder="+47 900 00 000" />
      </div>
      <div class="form-group full">
        <label>Notat</label>
        <textarea id="c-notes" style="min-height:52px;" placeholder="Valgfritt&hellip;">${window.escHtml(contact.notes || '')}</textarea>
      </div>
      <div class="form-group full">
        <label style="flex-direction:row;gap:8px;align-items:center;cursor:pointer;display:flex;">
          <input type="checkbox" id="c-primary" ${contact.is_primary ? 'checked' : ''} />
          Prim&aelig;rkontakt
        </label>
      </div>
    </div>`,
    `<button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
    <button class="btn btn-primary" id="contact-save-btn">${isNew ? 'Legg til' : 'Lagre'}</button>`,
  );

  window.openModal(html, () => {
    document.getElementById('contact-save-btn').addEventListener('click', async () => {
      const name = document.getElementById('c-name').value.trim();
      if (!name) return;
      const data = {
        ...contact,
        name,
        title:      document.getElementById('c-title').value.trim(),
        email:      document.getElementById('c-email').value.trim(),
        phone:      document.getElementById('c-phone').value.trim(),
        phone2:     document.getElementById('c-phone2').value.trim(),
        notes:      document.getElementById('c-notes').value,
        is_primary: document.getElementById('c-primary').checked ? 1 : 0,
      };
      const btn = document.getElementById('contact-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        if (isNew) {
          await api.addContact(data);
        } else {
          await api.updateContact(contact._id, data);
        }
        window.closeModal();
        await reload();
      } catch (e) {
        alert('Feil: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = isNew ? 'Legg til' : 'Lagre'; }
      }
    });
  });
}

function openTaskModal(inv, lookups, reload) {
  const html = window.ui.modal(
    'Ny oppgave',
    `<div class="form-grid">
      <div class="form-group full">
        <label>Investor</label>
        <input value="${window.escHtml(inv.name)}" disabled style="opacity:.6;" />
      </div>
      <div class="form-group full">
        <label>Oppgave *</label>
        <input id="t-label" placeholder="Beskriv oppgaven&hellip;" autofocus />
      </div>
      <div class="form-group">
        <label>Frist</label>
        <input type="date" id="t-due" />
      </div>
      <div class="form-group">
        <label>Ansvarlig</label>
        <select id="t-responsible">
          <option value="">—</option>
          ${(lookups.leads || []).map(l => `<option>${window.escHtml(l)}</option>`).join('')}
        </select>
      </div>
    </div>`,
    `<button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
    <button class="btn btn-primary" id="task-save-btn">Legg til</button>`,
  );

  window.openModal(html, () => {
    document.getElementById('task-save-btn').addEventListener('click', async () => {
      const label = document.getElementById('t-label').value.trim();
      if (!label) return;
      const data = {
        investor_id:   inv.id,
        investor_name: inv.name,
        label,
        due_date:    document.getElementById('t-due').value || null,
        responsible: document.getElementById('t-responsible').value || null,
      };
      const btn = document.getElementById('task-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        await api.addTask(data);
        window.closeModal();
        await reload();
      } catch (e) {
        alert('Feil: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Legg til'; }
      }
    });
  });
}

function openPaVentModal(inv, reload) {
  const chips = [[3, '3 mnd'], [6, '6 mnd'], [12, '12 mnd']];
  const selected = new Set();

  const html = window.ui.modal(
    'N&aring;r tar du kontakt igjen?',
    `<p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
      ${window.escHtml(inv.name)} er satt p&aring; vent. Velg oppf&oslash;lgingstidspunkt:
    </p>
    <div style="display:flex;gap:8px;margin-bottom:20px;" id="pavent-chips">
      ${chips.map(([m, l]) => `
        <button type="button" class="pavent-chip" data-months="${m}"
          style="flex:1;padding:10px 0;border-radius:8px;border:2px solid var(--border);background:transparent;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer;min-height:44px;">
          ${l}
        </button>
      `).join('')}
    </div>
    <div class="form-group" style="margin-bottom:0;">
      <label>Eller velg dato</label>
      <input type="date" id="pavent-custom" />
    </div>`,
    `<button class="btn btn-ghost" onclick="window.closeModal()">Hopp over</button>
    <button class="btn btn-primary" id="pavent-save-btn">Legg til oppgaver</button>`,
  );

  window.openModal(html, () => {
    document.querySelectorAll('.pavent-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = parseInt(btn.dataset.months);
        if (selected.has(m)) {
          selected.delete(m);
          btn.style.borderColor = 'var(--border)';
          btn.style.background  = 'transparent';
          btn.style.color       = 'var(--muted)';
        } else {
          selected.add(m);
          btn.style.borderColor = 'var(--blue)';
          btn.style.background  = 'rgba(52,152,219,.1)';
          btn.style.color       = 'var(--blue)';
        }
      });
    });

    document.getElementById('pavent-save-btn').addEventListener('click', async () => {
      const customDate = document.getElementById('pavent-custom').value;
      if (selected.size === 0 && !customDate) return;

      const btn = document.getElementById('pavent-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        const existing = await api.tasks({ investorId: inv.id });
        const existingLabels = new Set(existing.map(t => t.label));
        for (const [months, label] of [[3, 'Følg opp — 3 mnd'], [6, 'Følg opp — 6 mnd'], [12, 'Følg opp — 12 mnd']]) {
          if (selected.has(months) && !existingLabels.has(label)) {
            await api.addTask({ investor_id: inv.id, investor_name: inv.name, due_date: addDate(months), label });
          }
        }
        if (customDate) {
          const label = `Følg opp — ${customDate}`;
          if (!existingLabels.has(label)) {
            await api.addTask({ investor_id: inv.id, investor_name: inv.name, due_date: customDate, label });
          }
        }
        window.closeModal();
        await reload();
      } catch (e) {
        alert('Feil ved lagring: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Legg til oppgaver'; }
      }
    });
  });
}

function openQuickDeclineModal(inv, product, products, reload, state) {
  const html = window.ui.modal(
    'Takket nei',
    `<p style="font-size:14px;margin-bottom:16px;">
      <b>${window.escHtml(inv.name)}</b> avsto fra
      <span style="color:#e74c3c;font-weight:600;">${window.escHtml(product.name)}</span>
    </p>
    <div class="form-grid">
      <div class="form-group full">
        <label>Dato</label>
        <input type="date" id="qd-date" value="${today()}" />
      </div>
      <div class="form-group full">
        <label>Notat <span style="font-weight:400;color:var(--muted);font-size:11px;">(valgfritt)</span></label>
        <textarea id="qd-note" placeholder="Begrunnelse, kommentar&hellip;" style="min-height:60px;"></textarea>
      </div>
    </div>`,
    `<button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
    <button class="btn btn-primary" id="qd-save-btn" style="background:#e74c3c;border-color:#e74c3c;">Registrer avslag</button>`,
  );

  window.openModal(html, () => {
    document.getElementById('qd-save-btn').addEventListener('click', async () => {
      const date = document.getElementById('qd-date').value;
      const note = document.getElementById('qd-note').value;
      const btn  = document.getElementById('qd-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        await Promise.all([
          api.addLog({
            date,
            investor_id:   inv.id,
            investor_name: inv.name,
            log_type:      'Notat',
            subject:       `Takket nei til ${product.name}`,
            outcome:       note,
            responsible:   state.currentUser?.displayName || state.currentUser?.username || 'Ukjent',
            notes:         '',
            status:        'avholdt',
          }),
          api.addDeclinedOffer({
            product_id:     product._id,
            investor_id:    inv.id,
            decline_reason: note || null,
            declined_at:    date,
          }),
        ]);
        window.closeModal();
        await reload();
      } catch (e) {
        alert('Feil ved lagring: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Registrer avslag'; }
      }
    });
  });
}

function openTegnetModal(inv, productId, productName, currentAmount, reload) {
  const html = window.ui.modal(
    `Tegning &mdash; ${window.escHtml(productName)}`,
    `<p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
      Registrer tegnet bel&oslash;p for <b>${window.escHtml(inv.name)}</b>
    </p>
    <div class="form-group">
      <label>Tegnet bel&oslash;p (MNOK)</label>
      <input id="tegnet-amount" type="number" step="0.5" min="0"
        value="${currentAmount != null ? currentAmount : ''}" placeholder="0" autofocus />
    </div>`,
    `<button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
    <button class="btn btn-green" id="tegnet-save-btn">Bekreft tegning</button>`,
  );
  window.openModal(html, () => {
    document.getElementById('tegnet-save-btn').addEventListener('click', async () => {
      const raw = document.getElementById('tegnet-amount').value;
      const amount = raw !== '' ? parseFloat(raw) : null;
      const btn = document.getElementById('tegnet-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer…';
      try {
        await api.updateProductInvestor(productId, inv.id, { committed_amount: amount });
        window.closeModal();
        await reload();
      } catch (e) {
        alert('Feil: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Bekreft tegning'; }
      }
    });
  });
}

// ── Shared setup helpers ──────────────────────────────────────────────────────

function setupStatusToggle(wrapId, hiddenId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.querySelectorAll('.status-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.status;
      document.getElementById(hiddenId).value = s;
      wrap.querySelectorAll('.status-toggle-btn').forEach(b => {
        const active = b.dataset.status === s;
        const isPlan = b.dataset.status === 'planlagt';
        b.style.borderColor = active ? (isPlan ? 'var(--blue)' : 'var(--color-signed)') : 'var(--border)';
        b.style.background  = active ? (isPlan ? 'rgba(52,152,219,.1)' : 'rgba(26,138,106,.1)') : 'transparent';
        b.style.color       = active ? (isPlan ? 'var(--blue)' : 'var(--color-signed)') : 'var(--muted)';
      });
    });
  });
}

function setupDeclinedPills(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('label').forEach(lbl => {
    lbl.addEventListener('click', () => {
      const cb = lbl.querySelector('input[type=checkbox]');
      const checked = !cb.checked;
      cb.checked = checked;
      lbl.style.borderColor = checked ? '#e74c3c' : 'var(--border)';
      lbl.style.background  = checked ? 'rgba(231,76,60,.08)' : 'transparent';
      lbl.style.color       = checked ? '#e74c3c' : 'var(--muted)';
      lbl.style.fontWeight  = checked ? '600' : '400';
    });
  });
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted">Laster&hellip;</p></div>';

  let inv, tasks, lookups, products, piData;
  try {
    [inv, tasks, lookups, products, piData] = await Promise.all([
      api.investor(state.id),
      api.tasks({ investorId: state.id }),
      api.lookups(),
      api.products(),
      api.productInvestors(state.id),
    ]);
  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:#c0392b;">Feil: ${window.escHtml(e.message)}</p></div>`;
    return;
  }

  // visInaktive tracked outside DOM
  let visInaktive = false;

  async function reload() {
    await render(el, state);
  }

  function buildPage() {
    el.innerHTML = `
      <div class="topbar">
        <button class="btn btn-ghost btn-sm" id="back-btn" style="min-height:36px;">&#8592; Tilbake</button>
        <span class="topbar-title" style="margin-left:8px;">${window.escHtml(inv.name)}</span>
        <button class="btn btn-primary btn-sm" id="edit-btn" style="min-height:36px;">Rediger</button>
        <button class="btn btn-green btn-sm" id="logg-btn" style="min-height:36px;">+ Logg kontakt</button>
        <button class="btn btn-ghost btn-sm" id="delete-btn" style="color:#e74c3c;margin-left:auto;min-height:36px;">Slett investor</button>
      </div>
      <div class="content">
        ${buildDetailHeader(inv, products)}
        <div class="inv-detail-layout" style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div class="grid-2">
              ${buildPipelineCard(inv, lookups)}
              ${buildProductCard(inv, products, piData)}
            </div>
            ${inv.org_nr ? buildBrregCard(inv) : ''}
            <div class="grid-2">
              ${buildDocsCard(inv, products)}
              ${buildContactsCard(inv, visInaktive)}
            </div>
            ${!inv.org_nr ? buildBrregCard(inv) : ''}
            ${buildLogCard(inv, products)}
            ${buildTasksCard(tasks)}
          </div>
          ${buildKeyFigures(inv, products, piData, tasks)}
        </div>
      </div>
    `;

    // Re-bind events after innerHTML replace
    bindEvents();
  }

  function bindTopbar() {
    el.querySelector('#back-btn').addEventListener('click', () => window.navigate('investorer'));
    el.querySelector('#edit-btn').addEventListener('click', () => openEditModal(inv, lookups, products, reload));

    el.querySelectorAll('.btn-prod-nav').forEach(btn => {
      btn.addEventListener('click', () => window.navigate('prosjektDetalj', btn.dataset.productId));
    });
    el.querySelector('#logg-btn').addEventListener('click', () => openLogModal(inv, lookups, products, reload, { responsible: state.currentUser?.displayName }));
    el.querySelector('#delete-btn').addEventListener('click', async () => {
      if (!window.confirm(`Slette ${inv.name}?\n\nDette sletter investoren permanent, inkludert alle kontakter og loggposter.`)) return;
      try {
        await api.deleteInvestor(inv.id);
        window.navigate('investorer');
      } catch (e) { alert('Feil ved sletting: ' + e.message); }
    });
  }

  function bindPipeline() {
    const saveInline = async (field, value) => {
      try {
        await api.updateInvestor(inv.id, { [field]: value });
        inv[field] = value;
      } catch (e) { alert('Feil ved lagring: ' + e.message); }
    };

    const inlinePhase = el.querySelector('#inline-phase');
    if (inlinePhase) inlinePhase.addEventListener('change', () => saveInline('phase', inlinePhase.value));

    const inlineLead = el.querySelector('#inline-lead');
    if (inlineLead) inlineLead.addEventListener('change', () => saveInline('lead', inlineLead.value));

    const inlineNextsteps = el.querySelector('#inline-nextsteps');
    if (inlineNextsteps) inlineNextsteps.addEventListener('blur', () => saveInline('next_steps', inlineNextsteps.value));

    const inlineComments = el.querySelector('#inline-comments');
    if (inlineComments) inlineComments.addEventListener('blur', () => saveInline('comments', inlineComments.value));
  }

  function bindProducts() {
    el.querySelectorAll('.pi-name-nav').forEach(btn => {
      btn.addEventListener('click', () => window.navigate('prosjektDetalj', btn.dataset.pid));
    });

    el.querySelectorAll('.pi-toggle').forEach(cb => {
      cb.addEventListener('change', async () => {
        const pid = isNaN(cb.dataset.pid) ? cb.dataset.pid : Number(cb.dataset.pid);
        const newInterests = cb.checked
          ? [...(inv.product_interests || []), pid]
          : (inv.product_interests || []).filter(id => id !== pid);
        try {
          await api.updateInvestor(inv.id, { product_interests: newInterests });
          inv.product_interests = newInterests;
          await reload();
        } catch (e) { alert('Feil: ' + e.message); cb.checked = !cb.checked; }
      });
    });

    el.querySelectorAll('.pi-ticket').forEach(input => {
      const save = async () => {
        const pid = Number(input.dataset.pid);
        const val = input.value !== '' ? parseFloat(input.value) : null;
        try {
          await api.updateProductInvestor(pid, inv.id, { target_ticket: val });
          const pi = piData.find(p => p.product_id === pid);
          if (pi) pi.target_ticket = val;
          else piData.push({ product_id: pid, investor_id: inv.id, target_ticket: val, probability: null });
        } catch (e) { alert('Feil ved lagring: ' + e.message); }
      };
      input.addEventListener('change', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    });

    el.querySelectorAll('.pi-prob').forEach(input => {
      const save = async () => {
        const pid = Number(input.dataset.pid);
        const pct = input.value !== '' ? parseFloat(input.value) : null;
        const val = pct != null ? pct / 100 : null;
        try {
          await api.updateProductInvestor(pid, inv.id, { probability: val });
          const pi = piData.find(p => p.product_id === pid);
          if (pi) pi.probability = val;
          else piData.push({ product_id: pid, investor_id: inv.id, target_ticket: null, probability: val });
        } catch (e) { alert('Feil ved lagring: ' + e.message); }
      };
      input.addEventListener('change', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    });

    el.querySelectorAll('.pi-tegnet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid       = Number(btn.dataset.pid);
        const pname     = btn.dataset.pname;
        const committed = btn.dataset.committed !== '' ? parseFloat(btn.dataset.committed) : null;
        openTegnetModal(inv, pid, pname, committed, reload);
      });
    });

    el.querySelectorAll('.btn-quick-decline').forEach(btn => {
      btn.addEventListener('click', () => {
        const product = products.find(p => String(p._id) === String(btn.dataset.productId));
        if (product) openQuickDeclineModal(inv, product, products, reload, state);
      });
    });
  }

  function bindDocs() {
    el.querySelectorAll('.doc-checkbox').forEach(cb => {
      cb.addEventListener('change', async () => {
        const pid = cb.dataset.productId;
        const key = cb.dataset.docKey;
        const docs = inv.docs || {};
        const existing = (docs[pid] || {})[key] || {};
        const updated = {
          ...docs,
          [pid]: {
            ...(docs[pid] || {}),
            [key]: { ...existing, done: cb.checked ? 1 : 0, date: existing.date || new Date().toISOString().slice(0, 10) },
          },
        };
        try {
          await api.updateInvestor(inv.id, { docs: updated });
          inv.docs = updated;
        } catch (e) { alert('Feil: ' + e.message); cb.checked = !cb.checked; }
      });
    });

    el.querySelectorAll('.doc-date').forEach(input => {
      input.addEventListener('change', async () => {
        const pid = input.dataset.productId;
        const key = input.dataset.docKey;
        const docs = inv.docs || {};
        const updated = {
          ...docs,
          [pid]: { ...(docs[pid] || {}), [key]: { ...((docs[pid] || {})[key] || {}), date: input.value } },
        };
        try {
          await api.updateInvestor(inv.id, { docs: updated });
          inv.docs = updated;
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });

    el.querySelectorAll('.doc-version').forEach(input => {
      input.addEventListener('change', async () => {
        const pid = input.dataset.productId;
        const key = input.dataset.docKey;
        const docs = inv.docs || {};
        const updated = {
          ...docs,
          [pid]: { ...(docs[pid] || {}), [key]: { ...((docs[pid] || {})[key] || {}), version: input.value } },
        };
        try {
          await api.updateInvestor(inv.id, { docs: updated });
          inv.docs = updated;
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });
  }

  function bindContacts() {
    const addContactBtn = el.querySelector('#add-contact-btn');
    if (addContactBtn) {
      addContactBtn.addEventListener('click', () => {
        openContactModal({ investor_id: inv.id, name: '', title: '', email: '', phone: '', is_primary: 0, notes: '', active: 1 }, reload);
      });
    }

    el.querySelectorAll('.brreg-add-contact-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        openContactModal({
          investor_id: inv.id, name: btn.dataset.navn, title: btn.dataset.tittel,
          email: '', phone: '', is_primary: 0, notes: '', active: 1,
        }, reload);
      });
    });

    const toggleInaktiveBtn = el.querySelector('#toggle-inaktive');
    if (toggleInaktiveBtn) {
      toggleInaktiveBtn.addEventListener('click', async () => {
        visInaktive = !visInaktive;
        await reload();
      });
    }

    el.querySelectorAll('.contact-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const contact = (inv.contacts || []).find(c => String(c._id) === String(btn.dataset.contactId));
        if (contact) openContactModal({ ...contact }, reload);
      });
    });

    el.querySelectorAll('.contact-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const active  = parseInt(btn.dataset.active);
        const contact = (inv.contacts || []).find(c => String(c._id) === String(btn.dataset.contactId));
        if (!contact) return;
        try {
          await api.updateContact(btn.dataset.contactId, { ...contact, active: active === 1 ? 0 : 1 });
          await reload();
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });

    el.querySelectorAll('.contact-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Slette kontakt?')) return;
        try {
          await api.deleteContact(btn.dataset.contactId);
          await reload();
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });
  }

  function bindLog() {
    const newLogBtn = el.querySelector('#new-log-btn');
    if (newLogBtn) {
      newLogBtn.addEventListener('click', () => openLogModal(inv, lookups, products, reload, { responsible: state.currentUser?.displayName }));
    }

    el.querySelectorAll('.log-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const entry = (inv.log || []).find(l => String(l._id) === String(btn.dataset.logId));
        if (entry) openEditLogModal(entry, inv, lookups, products, reload);
      });
    });

    el.querySelectorAll('.log-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Slett denne aktiviteten?')) return;
        try {
          await api.deleteLog(btn.dataset.logId);
          await reload();
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });

    el.querySelectorAll('.log-marker-avholdt').forEach(btn => {
      btn.addEventListener('click', () => {
        const entry = (inv.log || []).find(l => String(l._id) === String(btn.dataset.logId));
        if (entry) openEditLogModal({ ...entry, status: 'avholdt' }, inv, lookups, products, reload);
      });
    });
  }

  function bindTasks() {
    const newTaskBtn = el.querySelector('#new-task-btn');
    if (newTaskBtn) {
      newTaskBtn.addEventListener('click', () => openTaskModal(inv, lookups, reload));
    }

    el.querySelectorAll('.task-checkbox').forEach(cb => {
      cb.addEventListener('change', async () => {
        const tid  = cb.dataset.taskId;
        const task = tasks.find(t => String(t._id) === String(tid));
        if (!task) return;
        try {
          await api.updateTask(tid, { done: task.done ? 0 : 1 });
          task.done = task.done ? 0 : 1;
          const row = el.querySelector(`[data-task-id="${tid}"]`);
          if (row) {
            const label = row.querySelector('div > div:first-child');
            if (label) {
              label.style.textDecoration = task.done ? 'line-through' : 'none';
              label.style.color          = task.done ? 'var(--muted)' : 'var(--text)';
            }
            const inner = row.querySelector('div[style*="flex:1"]') || row.querySelector('div[style*="flex: 1"]');
            if (inner) inner.style.opacity = task.done ? .6 : 1;
          }
        } catch (e) { alert('Feil: ' + e.message); cb.checked = !cb.checked; }
      });
    });

    el.querySelectorAll('.task-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tid = btn.dataset.taskId;
        try {
          await api.deleteTask(tid);
          tasks = tasks.filter(t => String(t._id) !== String(tid));
          const row = btn.closest('[data-task-id]');
          if (row) row.remove();
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });
  }

  function bindBrreg() {
    // ── Synkroniser-knapp (koblet investor) ───────────────────────────────────
    const syncBtn = el.querySelector('#brreg-sync-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        syncBtn.textContent = 'Synkroniserer…';
        try {
          await api.brregSync(inv.id, { org_nr: inv.org_nr });
          const msg = 'Synkronisert!';
          window.ui.toast?.(msg) || alert(msg);
          await reload();
        } catch (e) {
          alert('Feil: ' + e.message);
          syncBtn.disabled = false;
          syncBtn.textContent = '↻ Synkroniser';
        }
      });
      return;
    }

    // ── Søk (ikke koblet investor) ────────────────────────────────────────────
    const searchInput  = el.querySelector('#brreg-search-input');
    const searchBtn    = el.querySelector('#brreg-search-btn');
    const resultsEl    = el.querySelector('#brreg-search-results');
    const errorEl      = el.querySelector('#brreg-search-error');
    if (!searchInput) return;

    async function doSearch() {
      const q = searchInput.value.trim();
      if (!q) return;
      searchBtn.disabled = true;
      searchBtn.textContent = 'Søker…';
      errorEl.style.display = 'none';
      resultsEl.style.display = 'none';
      resultsEl.innerHTML = '';
      try {
        // Direkte org.nr-oppslag hvis 9 siffer
        const hits = /^\d{9}$/.test(q.replace(/\s/g, ''))
          ? await api.brregEnhet(q.replace(/\s/g, '')).then(e => [{ orgnr: e.orgnr, navn: e.navn, orgform: e.orgform, poststed: (e.adresser[0] || {}).poststed || null }]).catch(() => [])
          : await api.brregSearch(q);

        if (hits.length === 0) {
          errorEl.textContent = 'Ingen treff i Brønnøysundregistrene.';
          errorEl.style.display = '';
        } else {
          resultsEl.innerHTML = hits.filter(h => !h.slettet).map(h => `
            <div class="brreg-hit" data-orgnr="${window.escHtml(h.orgnr)}"
              style="display:flex;align-items:center;justify-content:space-between;gap:10px;
                     padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;
                     transition:background .15s;"
              onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
              <div>
                <div style="font-size:13px;font-weight:600;">${window.escHtml(h.navn)}</div>
                <div style="font-size:11px;color:var(--muted);">
                  ${window.escHtml(h.orgnr)}
                  ${h.orgform  ? ' · ' + window.escHtml(h.orgform)  : ''}
                  ${h.poststed ? ' · ' + window.escHtml(h.poststed) : ''}
                </div>
              </div>
              <button class="btn btn-primary btn-sm brreg-koble-btn" data-orgnr="${window.escHtml(h.orgnr)}" data-poststed="${window.escHtml(h.poststed || '')}"
                style="font-size:11px;min-height:28px;padding:2px 10px;white-space:nowrap;">Koble</button>
            </div>
          `).join('');
          resultsEl.style.display = '';

          resultsEl.querySelectorAll('.brreg-koble-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
              e.stopPropagation();
              const orgnr    = btn.dataset.orgnr;
              const poststed = btn.dataset.poststed;
              btn.disabled = true;
              btn.textContent = 'Kobler…';
              try {
                // Bruk poststed fra Brreg som city hvis CRM-city er tom
                const cityPayload = !inv.city && poststed ? poststed : undefined;
                await api.brregSync(inv.id, { org_nr: orgnr, city: cityPayload });
                const msg = 'Investor koblet til Brreg!';
                window.ui.toast?.(msg) || alert(msg);
                await reload();
              } catch (err) {
                alert('Feil: ' + err.message);
                btn.disabled = false;
                btn.textContent = 'Koble';
              }
            });
          });
        }
      } catch (err) {
        errorEl.textContent = 'Feil: ' + err.message;
        errorEl.style.display = '';
      } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = 'Søk';
      }
    }

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    // Auto-søk med investornavnet ved innlasting
    searchInput.value = inv.name;
    doSearch();
  }

  function bindEvents() {
    bindTopbar();
    bindPipeline();
    bindProducts();
    bindDocs();
    bindContacts();
    bindLog();
    bindTasks();
    bindBrreg();
  }

  buildPage();
}
