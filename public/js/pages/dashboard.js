import { api } from '../api.js';

const PHASE_COLORS = {
  'Prospekt':           '#1A5276',
  'Aktiv dialog':       '#2155A3',
  'Investor':           'var(--color-signed)',
  'Tidligere investor': '#1A5C1A',
  'På vent':            '#9A6A1E',
};

const FILTER_KEY = 'crm_filter_dashboard';
let _productInvestors = null; // cached per-product investor list

function loadFilter() {
  try { return JSON.parse(localStorage.getItem(window.lsKey(FILTER_KEY))) || {}; } catch { return {}; }
}

function saveFilter(f) {
  localStorage.setItem(window.lsKey(FILTER_KEY), JSON.stringify(f));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) { return window.escHtml(s); }
function fmt(n, d) { return window.fmt(n, d); }

function computeTop10(data, filter) {
  if (filter.filterProduct && _productInvestors) {
    // Per-product investors have real ticket + probability
    return _productInvestors
      .filter(i => !filter.filterPhase || i.phase === filter.filterPhase)
      .filter(i => !filter.filterType  || i.investor_type === filter.filterType)
      .filter(i => !filter.filterLead  || i.lead === filter.filterLead)
      .filter(i => i.target_ticket != null && i.probability != null)
      .map(i => ({
        ...i,
        weighted: Math.round(i.target_ticket * i.probability * 10) / 10,
      }))
      .sort((a, b) => (b.weighted ?? -1) - (a.weighted ?? -1))
      .slice(0, 10);
  }
  // Default: use pre-aggregated top10 from server, apply phase/type/lead filters
  return (data.top10 || [])
    .filter(i => !filter.filterPhase || i.phase === filter.filterPhase)
    .filter(i => !filter.filterType  || i.investor_type === filter.filterType)
    .filter(i => !filter.filterLead  || i.lead === filter.filterLead)
    .slice(0, 10);
}

// ── HTML builders ─────────────────────────────────────────────────────────────

function buildKPIs(data) {
  return `
    <div class="kpi-grid">
      <div class="kpi-card kpi-accent">
        <div class="kpi-label">Vektet volum</div>
        <div class="kpi-value">${fmt(data.weighted, 1)}</div>
        <div class="kpi-sub">MNOK (ticket × sannsynlighet)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Aggregert volum</div>
        <div class="kpi-value">${fmt(data.ticket)}</div>
        <div class="kpi-sub">MNOK målticket</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Investorer totalt</div>
        <div class="kpi-value">${fmt(data.total)}</div>
      </div>
    </div>`;
}

function buildPipelineCard(data) {
  const maxPhase = Math.max(...(data.byPhase || []).map(p => p.count), 1);
  const rows = (data.byPhase || []).map(p => {
    const pct   = Math.round((p.count / maxPhase) * 100);
    const color = PHASE_COLORS[p.phase] || '#2471A3';
    const extra = `<span style="font-size:11px;color:#aaa;width:60px;text-align:right">${fmt(p.ticket)} M</span>`;
    return window.ui.pipelineBar(p.phase, pct, color, p.count, extra);
  }).join('');
  return `
    <div class="card">
      <div class="card-title">📊 Pipeline per fase</div>
      ${rows || window.ui.emptyState('Ingen data')}
    </div>`;
}

function buildTypeCard(data) {
  const rows = (data.byType || []).slice(0, 8).map(t => `
    <tr>
      <td>${esc(t.investor_type || '—')}</td>
      <td class="text-right">${t.count}</td>
      <td class="text-right">${fmt(t.ticket)}</td>
    </tr>`).join('');
  return `
    <div class="card">
      <div class="card-title">🏢 Type investor</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Type</th><th class="text-right">Antall</th><th class="text-right">Ticket (M)</th></tr></thead>
          <tbody>${rows || window.ui.emptyRow('Ingen data', 3)}</tbody>
        </table>
      </div>
    </div>`;
}

function buildTop10Card(data, investors, filter) {
  const filteredTop = computeTop10(data, filter);
  const hasFilter   = filter.filterPhase || filter.filterType || filter.filterLead || filter.filterProduct;
  const showProbCol = !!filter.filterProduct;

  const phases   = [...new Set(investors.map(i => i.phase).filter(Boolean))].sort();
  const types    = [...new Set(investors.map(i => i.investor_type).filter(Boolean))].sort();
  const leads    = [...new Set(investors.map(i => i.lead).filter(Boolean))].sort();
  const products = data.products || [];

  const makeSelect = (key, placeholder, opts, curVal) => {
    const options = opts
      .map(o => `<option value="${esc(o)}"${curVal === o ? ' selected' : ''}>${esc(o)}</option>`)
      .join('');
    return `<select class="dash-filter" data-key="${key}"
      style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);
             background:var(--bg);color:var(--text);cursor:pointer;min-height:32px">
      <option value="">${esc(placeholder)}</option>${options}
    </select>`;
  };

  const productOpts = products
    .map(p => `<option value="${esc(String(p._id))}"${filter.filterProduct === String(p._id) ? ' selected' : ''}>${esc(p.name)}</option>`)
    .join('');

  const productSel = `<select class="dash-filter" data-key="filterProduct"
    style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);
           background:var(--bg);color:var(--text);cursor:pointer;min-height:32px">
    <option value="">Alle produkter</option>${productOpts}
  </select>`;

  const resetBtn = hasFilter
    ? `<button id="dash-reset-filter"
        style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);
               background:transparent;color:var(--muted);cursor:pointer;min-height:32px">
        ✕ Nullstill
      </button>`
    : '';

  const cols = showProbCol ? 7 : 6;
  const tableRows = filteredTop.length === 0
    ? window.ui.emptyRow('Ingen treff', cols)
    : filteredTop.map((inv, i) => `
        <tr class="dash-inv-row" data-id="${esc(String(inv.id))}" style="cursor:pointer">
          <td style="color:#aaa;font-weight:700">${i + 1}</td>
          <td style="font-weight:600;color:var(--blue)">${esc(inv.name || '')}</td>
          <td class="hide-sm">${esc(inv.investor_type || '—')}</td>
          <td class="hide-sm">${window.phaseBadge(inv.phase)}</td>
          <td class="text-right">${fmt(inv.target_ticket)}</td>
          ${showProbCol ? `<td class="text-right">${inv.probability != null ? Math.round(inv.probability * 100) + '%' : '—'}</td>` : ''}
          <td class="text-right" style="font-weight:700;color:#1A3E5C">${fmt(inv.weighted, 1)}</td>
        </tr>`).join('');

  return `
    <div class="card dash-top10-card">
      <div style="margin-bottom:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between">
        <div class="card-title" style="margin:0">
          Topp ${filteredTop.length} — høyest vektet volum
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${makeSelect('filterPhase', 'Alle faser',  phases, filter.filterPhase)}
          ${makeSelect('filterType',  'Alle typer',  types,  filter.filterType)}
          ${makeSelect('filterLead',  'ORO Kontakt', leads,  filter.filterLead)}
          ${productSel}
          ${resetBtn}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Investor</th><th class="hide-sm">Type</th><th class="hide-sm">Fase</th>
              <th class="text-right">Ticket</th>
              ${showProbCol ? '<th class="text-right">Sanns.</th>' : ''}
              <th class="text-right">Vektet</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
}

function buildGaugeCards(data) {
  const ACTIVE_STATUSES = new Set(['Pipeline', 'Fundraise', 'Fundraising']);
  const prods = (data.products || []).filter(p => ACTIVE_STATUSES.has(p.status));
  if (!prods.length) return '';

  const ARC_LEN = Math.PI * 40; // semicircle radius 40 → ≈ 125.66

  function gauge(committed, target) {
    const pct    = target > 0 ? Math.min(committed / target, 1) : 0;
    const offset = ARC_LEN * (1 - pct);
    const color  = pct >= 1 ? 'var(--color-signed)' : pct >= 0.5 ? '#2155A3' : '#D35400';
    return `
      <svg viewBox="0 0 100 58" width="110" height="64" style="display:block;margin:0 auto 6px">
        <path d="M 10,54 A 40,40 0 0,1 90,54"
          fill="none" stroke="var(--border)" stroke-width="9" stroke-linecap="round"/>
        <path d="M 10,54 A 40,40 0 0,1 90,54"
          fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
          stroke-dasharray="${ARC_LEN.toFixed(2)}"
          stroke-dashoffset="${offset.toFixed(2)}"/>
        <text x="50" y="50" text-anchor="middle" font-size="13" font-weight="700"
          fill="var(--text)" font-family="inherit">${Math.round(pct * 100)}%</text>
      </svg>`;
  }

  const cards = prods.map((p, i) => `
    <div class="card gauge-card-link${i >= 4 ? ' gauge-extra' : ''}" data-product-id="${esc(String(p._id))}"
         style="text-align:center;flex:1;min-width:140px;max-width:220px;cursor:pointer;transition:box-shadow .15s">
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;
                  letter-spacing:.5px;margin-bottom:10px">${esc(p.name.replace('ORO ', ''))}</div>
      ${gauge(p.committed || 0, p.target_size || 0)}
      <div style="font-size:15px;font-weight:700;color:var(--color-signed)">${fmt(p.committed || 0, 0)} MNOK</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">av ${fmt(p.target_size || 0, 0)} MNOK mål</div>
    </div>`).join('');

  const showMoreBtn = prods.length > 4
    ? `<button class="btn btn-ghost btn-sm gauge-show-more" id="gauge-show-more" style="margin-top:8px">Vis ${prods.length - 4} flere</button>`
    : '';

  return `
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;
                  letter-spacing:.6px;margin-bottom:10px">Tegnet vs. mål per prosjekt</div>
      <div class="gauge-cards gauge-collapsed" style="display:flex;gap:16px;flex-wrap:wrap">${cards}</div>
      ${showMoreBtn}
    </div>`;
}

function buildRecentActivity(recent) {
  if (!recent || recent.length === 0) return '';
  const items = recent.map(l => `
    <div class="log-item">
      <div class="log-item-top">
        <span class="log-date">${esc(l.date || '')}</span>
        <span class="badge badge-default log-type">${esc(l.log_type || 'Kontakt')}</span>
        <span class="log-who">${esc(l.responsible || '')}</span>
      </div>
      <button class="dash-recent-row" data-id="${esc(String(l.investor_id))}"
        style="background:none;border:none;padding:0;cursor:pointer;text-align:left;
               font-size:13px;font-weight:600;color:var(--blue);min-height:44px">
        ${esc(l.investor_name || '')}
      </button>
      ${l.subject ? `<div class="log-outcome">${esc(l.subject)}</div>` : ''}
    </div>`).join('');

  return `
    <div class="card">
      <div class="card-title">🕐 Siste aktivitet</div>
      <div class="log-list">${items}</div>
    </div>`;
}

// ── Min dag ─────────────────────────────────────────────────────────────────
const MINDAG_KEY = 'crm_mindag_collapsed';
let _minDag = null;

function mdCollapsed() {
  try { return localStorage.getItem(window.lsKey(MINDAG_KEY)) === '1'; } catch { return false; }
}
function setMdCollapsed(v) {
  localStorage.setItem(window.lsKey(MINDAG_KEY), v ? '1' : '0');
}

function mdGreeting() {
  const h = new Date().getHours();
  return h < 10 ? 'God morgen' : h < 18 ? 'God dag' : 'God kveld';
}

const MD_MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
function mdDay(d) {
  if (!d) return '';
  const [, m, day] = d.split('-').map(Number);
  return `${day}.<small style="display:block;font-size:9px;font-weight:600;color:var(--muted);text-transform:uppercase">${MD_MONTHS[m - 1] || ''}</small>`;
}

function mdTaskRow(t, kind, color) {
  const lead    = t.investor_name ? esc(t.investor_name) : esc(t.label || '');
  const sub     = t.investor_name ? esc(t.label || '')   : '';
  const nav     = t.investor_id ? `data-nav="detalj" data-id="${esc(String(t.investor_id))}"` : `data-nav="oppgaver"`;
  const dt      = kind === 'today' ? 'I&nbsp;dag' : mdDay(t.due_date);
  return `
    <div class="mindag-row" ${nav}
      style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid #EEF3F1;cursor:pointer">
      <div style="width:44px;flex-shrink:0;font-size:11px;font-weight:700;text-align:center;line-height:1.15;color:${color}">${dt}</div>
      <div style="flex:1;min-width:0">
        <b style="font-size:13px;font-weight:600;color:var(--blue);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${lead}</b>
        ${sub ? `<span style="font-size:11px;color:var(--muted)">${sub}</span>` : ''}
      </div>
      <span style="font-size:11px;color:var(--muted);flex-shrink:0">Oppgave</span>
      <span style="color:#C4D2CE;font-size:14px;flex-shrink:0">›</span>
    </div>`;
}

function mdGroup(tag, n, color, bg, hint, rowsHtml) {
  return `
    <div style="border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;padding:9px 16px;background:var(--bg)">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:${color}">${esc(tag)}</span>
        <span style="font-size:11px;font-weight:700;color:#fff;background:${color};border-radius:11px;min-width:18px;height:18px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center">${n}</span>
        ${hint ? `<span style="margin-left:auto;font-size:11px;color:var(--muted)">${esc(hint)}</span>` : ''}
      </div>
      ${rowsHtml}
    </div>`;
}

// Returns the full panel wrapped in .mindag-host (empty string when nothing to show)
function buildMinDag(md) {
  if (!md) return '';
  const nOver = (md.overdue || []).length;
  const nDue  = (md.today   || []).length;
  const nLead = md.leads?.count || 0;
  const total = nOver + nDue + nLead;
  if (total === 0) return '';

  const chips = [
    nOver ? `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;color:#B23B3B;background:#F6E7E6;white-space:nowrap">${nOver} forfalt</span>` : '',
    nDue  ? `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;color:#9A6A1E;background:#F6EEDD;white-space:nowrap">${nDue} i dag</span>` : '',
    nLead ? `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;color:var(--blue);background:var(--blue-l);white-space:nowrap">${nLead} leads</span>` : '',
  ].join('');

  if (mdCollapsed()) {
    return `
      <div class="mindag-host">
        <div class="section-label" style="margin-top:0">Min dag</div>
        <div class="mindag-expand"
          style="display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:16px">
          <span style="font-size:14px">📋</span>
          <b style="font-size:13px;font-weight:700;color:var(--text);flex-shrink:0">Min dag</b>
          <span style="display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:0">${chips}</span>
          <span style="color:var(--muted);font-size:13px;flex-shrink:0">▾ Vis</span>
        </div>
      </div>`;
  }

  const overHtml = nOver ? mdGroup('Forfalt', nOver, '#B23B3B', '#F6E7E6', 'over frist',
    md.overdue.map(t => mdTaskRow(t, 'over', '#B23B3B')).join('')) : '';
  const dueHtml  = nDue  ? mdGroup('I dag', nDue, '#9A6A1E', '#F6EEDD', 'forfaller i dag',
    md.today.map(t => mdTaskRow(t, 'today', '#9A6A1E')).join('')) : '';
  const leadHtml = nLead ? mdGroup('Leads å kvalifisere', nLead, '#267777', '#E0EFEC', 'ukvalifiserte leads',
    `<div class="mindag-row" data-nav="leads"
      style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid #EEF3F1;cursor:pointer">
      <div style="width:44px;flex-shrink:0;font-size:11px;font-weight:700;text-align:center;color:#267777">NY</div>
      <div style="flex:1;min-width:0">
        <b style="font-size:13px;font-weight:600;color:var(--blue);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(md.leads.sampleName || 'Lead')}${nLead > 1 ? ` <span style="color:var(--muted);font-weight:400">m.fl.</span>` : ''}</b>
        <span style="font-size:11px;color:var(--muted)">Ring for introduksjonsmøte</span>
      </div>
      <span style="font-size:11px;color:var(--muted);flex-shrink:0">Lead</span>
      <span style="color:#C4D2CE;font-size:14px;flex-shrink:0">›</span>
    </div>`) : '';

  return `
    <div class="mindag-host">
      <div class="section-label" style="margin-top:0">Min dag</div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:8px;padding:15px 16px 12px">
          <b style="font-size:15px;font-weight:700;color:var(--text)">${esc(mdGreeting())}${md.user ? ', ' + esc(md.user.split(' ')[0]) : ''}</b>
          <span style="font-size:12px;color:var(--muted)">${(nOver + nDue) > 0 ? `${nOver + nDue} ${(nOver + nDue) === 1 ? 'oppgave' : 'oppgaver'} trenger deg i dag` : 'Ingen oppgaver forfaller'}</span>
          ${nOver ? `<span style="margin-left:auto;font-size:11px;font-weight:600;color:#B23B3B;background:#F6E7E6;padding:3px 9px;border-radius:20px">${nOver} forfalt</span>` : ''}
          <button class="mindag-toggle" ${nOver ? '' : 'style="margin-left:auto"'}
            style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:12px;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:6px">▴ Skjul</button>
        </div>
        ${overHtml}${dueHtml}${leadHtml}
      </div>
    </div>`;
}

function bindMinDag(pageRoot) {
  const host = pageRoot.querySelector('.mindag-host');
  if (!host) return;

  const rerender = () => {
    const fresh = document.createElement('div');
    fresh.innerHTML = buildMinDag(_minDag);
    const newHost = fresh.firstElementChild;
    host.replaceWith(newHost);
    bindMinDag(pageRoot);
  };

  const toggle = host.querySelector('.mindag-toggle');
  if (toggle) toggle.addEventListener('click', () => { setMdCollapsed(true);  rerender(); });

  const expand = host.querySelector('.mindag-expand');
  if (expand) expand.addEventListener('click', () => { setMdCollapsed(false); rerender(); });

  host.querySelectorAll('.mindag-row').forEach(row => {
    row.addEventListener('click', () => {
      const nav = row.dataset.nav;
      if (nav === 'detalj' && row.dataset.id) window.navigate('detalj', row.dataset.id);
      else if (nav) window.navigate(nav);
    });
  });
}

// ── Quick log modal ───────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function openQuickLogModal(investors, el, currentUser) {
  let lookups;
  try { lookups = await api.lookups(); } catch { lookups = {}; }

  const defaultLead = currentUser?.leadName || currentUser?.displayName || '';
  const sortedInvestors = [...investors].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nb'));
  const investorOpts = sortedInvestors
    .map(i => `<option value="${esc(String(i.id))}">${esc(i.name)}</option>`)
    .join('');
  const typeOpts = (lookups.logTypes || ['Møte', 'E-post', 'Telefon', 'Notat'])
    .map(t => `<option>${esc(t)}</option>`)
    .join('');
  const leadOpts = (lookups.leads || [])
    .map(l => `<option${l === defaultLead ? ' selected' : ''}>${esc(l)}</option>`)
    .join('');

  const html = window.ui.modal(
    'Logg kontakt',
    `<div id="ql-error" class="alert-err" style="display:none;"></div>
    <div class="form-grid">
      <div class="form-group full">
        <label>Investor *</label>
        <select id="ql-investor">
          <option value="">— Velg investor —</option>
          ${investorOpts}
        </select>
      </div>
      <div class="form-group">
        <label>Dato</label>
        <input type="date" id="ql-date" value="${today()}" />
      </div>
      <div class="form-group">
        <label>Type</label>
        <select id="ql-type">${typeOpts}</select>
      </div>
      ${leadOpts ? `
      <div class="form-group full">
        <label>Ansvarlig</label>
        <select id="ql-responsible">${leadOpts}</select>
      </div>` : ''}
      <div class="form-group full">
        <label>Emne</label>
        <input id="ql-subject" placeholder="Kort beskrivelse&hellip;" />
      </div>
    </div>`,
    `<button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
    <button class="btn btn-green" id="ql-save-btn">Logg &#8594;</button>`,
  );

  window.openModal(html, () => {
    document.getElementById('ql-save-btn').addEventListener('click', async () => {
      const investorId = document.getElementById('ql-investor').value;
      const date       = document.getElementById('ql-date').value;
      if (!investorId || !date) {
        const errEl = document.getElementById('ql-error');
        errEl.textContent = 'Velg investor og dato.';
        errEl.style.display = '';
        return;
      }
      const investor = investors.find(i => String(i.id) === investorId);
      const btn = document.getElementById('ql-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer…';
      try {
        await api.addLog({
          date,
          investor_id:   investorId,
          investor_name: investor?.name || '',
          log_type:      document.getElementById('ql-type').value,
          responsible:   document.getElementById('ql-responsible')?.value || '',
          subject:       document.getElementById('ql-subject').value,
          status:        'avholdt',
        });
        window.closeModal();
        await render(el);
      } catch (e) {
        const errEl = document.getElementById('ql-error');
        if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
        if (btn) { btn.disabled = false; btn.textContent = 'Logg →'; }
      }
    });
  });
}

// ── Event wiring ──────────────────────────────────────────────────────────────

// card = the .dash-top10-card element; pageRoot = the page container element
function bindTop10Card(card, pageRoot, data, investors, filter) {
  card.querySelectorAll('.dash-filter').forEach(sel => {
    sel.addEventListener('change', async () => {
      filter[sel.dataset.key] = sel.value;
      saveFilter(filter);
      if (sel.dataset.key === 'filterProduct') {
        _productInvestors = sel.value
          ? await api.investors({ product: parseInt(sel.value) }).catch(() => [])
          : null;
      }
      refreshTop10Card(pageRoot, data, investors, filter);
    });
  });

  const resetBtn = card.querySelector('#dash-reset-filter');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      filter.filterPhase   = '';
      filter.filterType    = '';
      filter.filterLead    = '';
      filter.filterProduct = '';
      localStorage.removeItem(window.lsKey(FILTER_KEY));
      refreshTop10Card(pageRoot, data, investors, filter);
    });
  }

  card.querySelectorAll('.dash-inv-row').forEach(row => {
    row.addEventListener('click', () => window.navigate('detalj', row.dataset.id));
  });
}

function refreshTop10Card(pageRoot, data, investors, filter) {
  const card = pageRoot.querySelector('.dash-top10-card');
  if (!card) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = buildTop10Card(data, investors, filter);
  const newCard = tmp.firstElementChild;
  card.replaceWith(newCard);
  bindTop10Card(newCard, pageRoot, data, investors, filter);
}

function setupEvents(el, data, investors, filter, state) {
  bindMinDag(el);

  el.querySelectorAll('.dash-logg-btn').forEach(btn => {
    btn.addEventListener('click', () => openQuickLogModal(investors, el, state?.currentUser));
  });

  el.querySelectorAll('.gauge-card-link').forEach(card => {
    card.addEventListener('click', () => window.navigate('prosjektDetalj', card.dataset.productId));
  });

  const showMoreBtn = el.querySelector('#gauge-show-more');
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', () => {
      const container = el.querySelector('.gauge-cards');
      const collapsed = container.classList.toggle('gauge-collapsed');
      const extraCount = container.querySelectorAll('.gauge-extra').length;
      showMoreBtn.textContent = collapsed ? `Vis ${extraCount} flere` : 'Vis færre';
    });
  }

  el.querySelectorAll('.dash-search-input').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const q = input.value.trim();
      if (!q) return;
      const k = window.lsKey('crm_filter_investorer');
      const saved = JSON.parse(localStorage.getItem(k) || '{}');
      localStorage.setItem(k, JSON.stringify({ ...saved, search: q }));
      input.value = '';
      window.navigate('investorer');
    });
  });

  // Top-10 card filters & rows
  const card = el.querySelector('.dash-top10-card');
  if (card) bindTop10Card(card, el, data, investors, filter);

  // Recent activity clicks
  el.querySelectorAll('.dash-recent-row').forEach(btn => {
    btn.addEventListener('click', () => window.navigate('detalj', btn.dataset.id));
  });
}

// ── Public render entry ───────────────────────────────────────────────────────

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted">Laster…</p></div>';

  try {
    const [data, investorsRaw, minDag] = await Promise.all([
      api.dashboard(),
      api.investors(),
      api.minDag().catch(() => null),
    ]);
    _minDag = minDag;

    const investors = Array.isArray(investorsRaw)
      ? investorsRaw
      : (investorsRaw.investors || []);

    const saved  = loadFilter();
    const filter = {
      filterPhase:   saved.filterPhase   || '',
      filterType:    saved.filterType    || '',
      filterLead:    saved.filterLead    || '',
      filterProduct: saved.filterProduct || '',
    };

    _productInvestors = filter.filterProduct
      ? await api.investors({ product: parseInt(filter.filterProduct) }).catch(() => [])
      : null;

    const recentHtml = buildRecentActivity(data.recent);
    el.innerHTML = `
      <div class="topbar">
        <span class="topbar-title">Dashboard</span>
        <div class="search-box" style="flex:1;max-width:260px">
          <span style="opacity:.45;font-size:13px;flex-shrink:0">🔍</span>
          <input class="dash-search-input" type="search" placeholder="Søk investor…"
            style="width:100%" autocomplete="off">
        </div>
        <button class="dash-logg-btn btn btn-green btn-sm" style="min-height:36px">+ Logg kontakt</button>
      </div>
      <div class="content">
        <div class="dash-mobile-bar">
          <div class="search-box">
            <span style="opacity:.45;font-size:13px;flex-shrink:0">🔍</span>
            <input class="dash-search-input" type="search" placeholder="Søk investor…"
              style="width:100%" autocomplete="off">
          </div>
          <button class="dash-logg-btn btn btn-green btn-sm" style="min-height:36px;white-space:nowrap">+ Logg</button>
        </div>
        ${buildMinDag(minDag)}
        ${buildKPIs(data)}
        ${buildGaugeCards(data)}
        <div class="section-label">Pipeline</div>
        <div class="grid-2">
          ${buildPipelineCard(data)}
          ${buildTypeCard(data)}
        </div>
        <div class="section-label">Topp investorer</div>
        <div class="dash-bottom-grid${recentHtml ? ' has-recent' : ''}">
          ${buildTop10Card(data, investors, filter)}
          ${recentHtml}
        </div>
      </div>`;

    setupEvents(el, data, investors, filter, state);

  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:red">Feil: ${window.escHtml(e.message)}</p></div>`;
  }
}
