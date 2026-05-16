import { api } from '../api.js';

const PHASE_COLORS = {
  'Prospekt':         '#1A5276',
  'Ny kontakt':       '#0F4949',
  'Intro sendt':      '#1A7A5E',
  'Møte avtalt':      '#9A6A1E',
  'Aktiv dialog':     '#2155A3',
  'Tegnet':           'var(--color-signed)',
  'Ikke relevant nå': '#717D87',
  'Onboardet':        '#1A5C1A',
};

const FILTER_KEY = 'crm_filter_dashboard';
let _productInvestors = null; // cached per-product investor list

function loadFilter() {
  try { return JSON.parse(localStorage.getItem(FILTER_KEY)) || {}; } catch { return {}; }
}

function saveFilter(f) {
  localStorage.setItem(FILTER_KEY, JSON.stringify(f));
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
  const productItems = (data.products || [])
    .map(p => `<span style="font-size:12px"><b>${esc(String(p.count))}</b> ${esc(p.name.replace('ORO ', ''))}</span>`)
    .join('');

  return `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Investorer totalt</div>
        <div class="kpi-value">${fmt(data.total)}</div>
      </div>
      <div class="kpi-card" style="border-top-color:var(--color-signed)">
        <div class="kpi-label">Aggregert volum</div>
        <div class="kpi-value">${fmt(data.ticket)}</div>
        <div class="kpi-sub">MNOK målticket</div>
      </div>
      <div class="kpi-card" style="border-top-color:#D35400">
        <div class="kpi-label">Vektet volum</div>
        <div class="kpi-value">${fmt(data.weighted, 1)}</div>
        <div class="kpi-sub">MNOK (ticket × sannsynlighet)</div>
      </div>
      <div class="kpi-card" style="border-top-color:#8E44AD">
        <div class="kpi-label">Produktinteresse</div>
        <div class="kpi-value" style="font-size:16px;margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
          ${productItems || '<span style="font-size:12px;color:var(--muted)">—</span>'}
        </div>
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
      <div class="card-title">Pipeline per fase</div>
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
      <div class="card-title">Type investor</div>
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
          <td>${esc(inv.investor_type || '—')}</td>
          <td>${window.phaseBadge(inv.phase)}</td>
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
              <th>#</th><th>Investor</th><th>Type</th><th>Fase</th>
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
      <div class="card-title">Siste aktivitet</div>
      <div class="log-list">${items}</div>
    </div>`;
}

// ── Quick log modal ───────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function openQuickLogModal(investors, el) {
  let lookups;
  try { lookups = await api.lookups(); } catch { lookups = {}; }

  const sortedInvestors = [...investors].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nb'));
  const investorOpts = sortedInvestors
    .map(i => `<option value="${esc(String(i.id))}">${esc(i.name)}</option>`)
    .join('');
  const typeOpts = (lookups.logTypes || ['Møte', 'E-post', 'Telefon', 'Notat'])
    .map(t => `<option>${esc(t)}</option>`)
    .join('');
  const leadOpts = (lookups.leads || [])
    .map(l => `<option>${esc(l)}</option>`)
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
      localStorage.removeItem(FILTER_KEY);
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

function setupEvents(el, data, investors, filter) {
  const loggBtn = el.querySelector('#dash-logg-btn');
  if (loggBtn) loggBtn.addEventListener('click', () => openQuickLogModal(investors, el));

  // Top-10 card filters & rows
  const card = el.querySelector('.dash-top10-card');
  if (card) bindTop10Card(card, el, data, investors, filter);

  // Recent activity clicks
  el.querySelectorAll('.dash-recent-row').forEach(btn => {
    btn.addEventListener('click', () => window.navigate('detalj', btn.dataset.id));
  });
}

// ── Public render entry ───────────────────────────────────────────────────────

export async function render(el) {
  el.innerHTML = '<div class="content"><p class="text-muted">Laster…</p></div>';

  try {
    const [data, investorsRaw] = await Promise.all([
      api.dashboard(),
      api.investors(),
    ]);

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
        <button id="dash-logg-btn" class="btn btn-green btn-sm" style="min-height:36px">+ Logg kontakt</button>
      </div>
      <div class="content">
        ${buildKPIs(data)}
        <div class="grid-2">
          ${buildPipelineCard(data)}
          ${buildTypeCard(data)}
        </div>
        <div class="dash-bottom-grid${recentHtml ? ' has-recent' : ''}">
          ${buildTop10Card(data, investors, filter)}
          ${recentHtml}
        </div>
      </div>`;

    setupEvents(el, data, investors, filter);

  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:red">Feil: ${window.escHtml(e.message)}</p></div>`;
  }
}
