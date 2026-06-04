import { api } from '../api.js';

const FILTER_KEY = 'crm_filter_investorer';

function loadFilter() {
  try { return JSON.parse(localStorage.getItem(window.lsKey(FILTER_KEY))) || {}; } catch { return {}; }
}

function saveFilter(search, filter) {
  localStorage.setItem(window.lsKey(FILTER_KEY), JSON.stringify({ search, filter }));
}

function esc(s) { return window.escHtml(s); }
function fmt(n) { return window.fmt(n); }

// ── Ny investor modal (rask opprettelse — fullfør på detalj-siden) ────────────

function openNyInvestorModal(lookups) {
  const typeOpts = (lookups.types || [])
    .map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  const leadOpts = (lookups.leads || [])
    .map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');

  const html = window.ui.modal(
    'Ny investor',
    `<p style="font-size:13px;color:var(--muted);margin-bottom:16px">
      Fyll inn det viktigste — fullfør resten p&aring; investorkortet.
    </p>
    <div id="ni-error" class="alert-err" style="display:none"></div>
    <div class="form-grid">
      <div class="form-group full">
        <label>Navn *</label>
        <input id="ni-name" type="text" placeholder="Selskapsnavn&hellip;" autocomplete="off" />
      </div>
      <div class="form-group">
        <label>Type investor</label>
        <select id="ni-type">
          <option value="">—</option>
          ${typeOpts}
        </select>
      </div>
      <div class="form-group">
        <label>Ansvarlig</label>
        <select id="ni-lead">
          <option value="">—</option>
          ${leadOpts}
        </select>
      </div>
    </div>`,
    `<button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
    <button class="btn btn-primary" id="ni-save-btn">Opprett og &aring;pne &rarr;</button>`,
  );

  window.openModal(html, () => {
    const nameEl = document.getElementById('ni-name');
    if (nameEl) setTimeout(() => nameEl.focus(), 50);

    document.getElementById('ni-save-btn').addEventListener('click', async () => {
      const btn   = document.getElementById('ni-save-btn');
      const errEl = document.getElementById('ni-error');
      const name  = (nameEl?.value || '').trim();
      if (!name) {
        errEl.textContent = 'Navn er påkrevd.';
        errEl.style.display = '';
        nameEl?.focus();
        return;
      }
      errEl.style.display = 'none';
      btn.disabled = true; btn.textContent = 'Lagrer…';
      try {
        const inv = await api.createInvestor({
          name,
          investor_type: document.getElementById('ni-type').value,
          lead:          document.getElementById('ni-lead').value,
          phase:         'Prospekt',
          country:       'Norge',
        });
        window.closeModal();
        window.navigate('detalj', inv.id || inv._id);
      } catch (e) {
        errEl.textContent = 'Feil: ' + e.message;
        errEl.style.display = '';
        btn.disabled = false; btn.textContent = 'Opprett og åpne →';
      }
    });
  });
}

// ── Table builder ─────────────────────────────────────────────────────────────

function buildTableRows(investors, products) {
  if (investors.length === 0) {
    return `<tr><td colspan="9" class="empty-state">Ingen investorer funnet.</td></tr>`;
  }

  const prodMap = Object.fromEntries(products.map(p => [p._id, p.name]));

  return investors.map(inv => {
    const weighted = (inv.target_ticket != null && inv.probability != null)
      ? Number((inv.target_ticket * inv.probability).toFixed(1)).toLocaleString('nb-NO')
      : '—';

    const prods = (inv.product_interests || [])
      .map(id => prodMap[id])
      .filter(Boolean);

    const prodPills = prods
      .map(p => `<span class="prod-pill">${esc(p)}</span>`)
      .join('');

    return `
      <tr class="inv-row" data-id="${esc(String(inv.id || inv._id))}" style="cursor:pointer">
        <td style="font-weight:600;max-width:260px">${esc(inv.name || '')}</td>
        <td class="hide-sm" style="color:#717D87;font-size:12px">${esc(inv.investor_type || '—')}</td>
        <td>${window.phaseBadge(inv.phase)}</td>
        <td class="hide-sm" style="font-size:12px">${esc(inv.lead || '—')}</td>
        <td class="text-right hide-sm">${fmt(inv.target_ticket)}</td>
        <td class="text-right hide-sm">${inv.probability != null ? Math.round(inv.probability * 100) + '%' : '—'}</td>
        <td class="text-right hide-sm" style="font-weight:600">${weighted}</td>
        <td class="hide-sm"><div class="prod-pills">${prodPills}</div></td>
        <td class="hide-sm" style="font-size:12px;color:#717D87">${esc(inv.last_contact || '—')}</td>
      </tr>`;
  }).join('');
}

function buildFilterBar(lookups, products, locations, filter) {
  const makeSelect = (key, placeholder, opts) => {
    const options = opts
      .map(o => `<option value="${esc(o)}"${filter[key] === o ? ' selected' : ''}>${esc(o)}</option>`)
      .join('');
    return `<select class="inv-filter" data-key="${key}"
      style="font-size:12px;padding:5px 8px;border-radius:7px;border:1px solid var(--border);
             background:var(--bg);color:var(--text);cursor:pointer;min-height:36px">
      <option value="">${esc(placeholder)}</option>${options}
    </select>`;
  };

  const productOpts = products
    .map(p => `<option value="${esc(String(p._id))}"${filter.product === String(p._id) ? ' selected' : ''}>${esc(p.name)}</option>`)
    .join('');

  const productSel = `<select class="inv-filter" data-key="product"
    style="font-size:12px;padding:5px 8px;border-radius:7px;border:1px solid var(--border);
           background:var(--bg);color:var(--text);cursor:pointer;min-height:36px">
    <option value="">Alle produkter</option>${productOpts}
  </select>`;

  const hasFilter = filter.phase || filter.type || filter.lead || filter.product || filter.country || filter.city;
  const resetBtn = hasFilter
    ? `<button id="inv-reset-filter" class="btn btn-ghost btn-sm" style="min-height:36px">× Nullstill</button>`
    : '';

  return `
    <div id="inv-filterbar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
      ${makeSelect('phase',   'Alle faser',  lookups.phases  || [])}
      ${makeSelect('type',    'Alle typer',  lookups.types   || [])}
      ${makeSelect('lead',    'ORO Kontakt', lookups.leads   || [])}
      ${productSel}
      ${makeSelect('country', 'Alle land',   locations.countries || [])}
      <input id="inv-city-input" class="inv-city" type="text"
        value="${esc(filter.city || '')}"
        placeholder="By…"
        style="font-size:12px;padding:5px 8px;border-radius:7px;border:1px solid var(--border);
               background:var(--bg);color:var(--text);width:110px;min-height:36px">
      ${resetBtn}
    </div>`;
}

// ── Page state (module-scoped to survive filter interactions) ─────────────────

let _state = null;   // { investors, lookups, products, locations, search, filter }

async function loadData(search, filter) {
  const params = {};
  if (search)         params.search  = search;
  if (filter.phase)   params.phase   = filter.phase;
  if (filter.type)    params.type    = filter.type;
  if (filter.lead)    params.lead    = filter.lead;
  if (filter.product) params.product = filter.product;
  if (filter.country) params.country = filter.country;
  if (filter.city)    params.city    = filter.city;

  const raw = await api.investors(params);
  return Array.isArray(raw) ? raw : (raw.investors || []);
}

function updateTableSection(el, investors, products) {
  const tbody = el.querySelector('.inv-tbody');
  if (tbody) {
    tbody.innerHTML = buildTableRows(investors, products);
    bindRowClicks(tbody);
  }
  const titleEl = el.querySelector('.inv-count-title');
  if (titleEl) titleEl.textContent = `Investorer (${investors.length})`;
}

function bindRowClicks(container) {
  container.querySelectorAll('.inv-row').forEach(row => {
    row.addEventListener('click', () => window.navigate('detalj', row.dataset.id));
  });
}

async function reloadTable(el) {
  if (!_state) return;
  const { search, filter, products } = _state;

  try {
    const investors = await loadData(search, filter);
    _state.investors = investors;
    saveFilter(search, filter);
    updateTableSection(el, investors, products);
  } catch (e) {
    const wrap = el.querySelector('.inv-table-wrap');
    if (wrap) wrap.innerHTML = `<p style="padding:24px;color:#c0392b">Feil: ${esc(e.message)}</p>`;
  }
}

function setupEvents(el) {
  // Search input — debounced
  let searchTimer = null;
  const searchInput = el.querySelector('#inv-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (_state) {
          _state.search = searchInput.value;
          reloadTable(el);
        }
      }, 280);
    });
  }

  // Filter selects
  el.querySelectorAll('.inv-filter').forEach(sel => {
    sel.addEventListener('change', () => {
      if (_state) {
        _state.filter[sel.dataset.key] = sel.value;
        reloadTable(el);
      }
    });
  });

  // City input — debounced
  let cityTimer = null;
  const cityInput = el.querySelector('.inv-city');
  if (cityInput) {
    cityInput.addEventListener('input', () => {
      clearTimeout(cityTimer);
      cityTimer = setTimeout(() => {
        if (_state) {
          _state.filter.city = cityInput.value;
          reloadTable(el);
        }
      }, 280);
    });
  }

  // Reset filter
  const resetBtn = el.querySelector('#inv-reset-filter');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!_state) return;
      _state.filter = { phase: '', type: '', lead: '', product: '', country: '', city: '' };
      saveFilter(_state.search, _state.filter);
      // Re-render filter bar and reload
      const filterBar = el.querySelector('#inv-filterbar');
      if (filterBar) {
        const tmp = document.createElement('div');
        tmp.innerHTML = buildFilterBar(_state.lookups, _state.products, _state.locations, _state.filter);
        filterBar.replaceWith(tmp.firstElementChild);
        // Re-bind the newly rendered filter bar
        el.querySelectorAll('.inv-filter').forEach(sel => {
          sel.addEventListener('change', () => {
            _state.filter[sel.dataset.key] = sel.value;
            reloadTable(el);
          });
        });
        const newCity = el.querySelector('.inv-city');
        if (newCity) {
          newCity.addEventListener('input', () => {
            clearTimeout(cityTimer);
            cityTimer = setTimeout(() => {
              _state.filter.city = newCity.value;
              reloadTable(el);
            }, 280);
          });
        }
      }
      reloadTable(el);
    });
  }

  // Ny investor button
  const nyBtn = el.querySelector('#inv-ny-btn');
  if (nyBtn) {
    nyBtn.addEventListener('click', () => {
      if (_state) openNyInvestorModal(_state.lookups);
    });
  }

  // Table row clicks
  const tbody = el.querySelector('.inv-tbody');
  if (tbody) bindRowClicks(tbody);
}

// ── Public render entry ───────────────────────────────────────────────────────

export async function render(el) {
  el.innerHTML = '<div class="content"><p class="text-muted">Laster…</p></div>';

  try {
    const saved  = loadFilter();
    const search = saved.search || '';
    const filter = {
      phase:   '',
      type:    '',
      lead:    '',
      product: '',
      country: '',
      city:    '',
      ...(saved.filter || {}),
    };

    // Fetch lookups, locations, products and initial investor list in parallel
    const [lookups, locations, products, investors] = await Promise.all([
      api.lookups(),
      api.locations(),
      api.products(),
      loadData(search, filter),
    ]);

    // Store in module state for event handlers
    _state = { investors, lookups, products, locations, search, filter };

    const tableRows = buildTableRows(investors, products);

    el.innerHTML = `
      <div class="topbar" style="flex-wrap:wrap;gap:8px">
        <span class="topbar-title inv-count-title">Investorer (${investors.length})</span>
        <div class="search-box" style="flex:1;min-width:160px;max-width:280px">
          <span>🔍</span>
          <input id="inv-search-input" type="text" placeholder="Søk navn…"
            value="${esc(search)}" style="min-height:36px">
        </div>
        <a href="/api/export/excel" download
           class="btn btn-ghost btn-sm"
           style="text-decoration:none;min-height:36px;display:inline-flex;align-items:center">
          ⬇ Eksporter
        </a>
        <button id="inv-ny-btn" class="btn btn-primary btn-sm" style="min-height:36px">+ Ny investor</button>
      </div>
      <div class="content">
        ${buildFilterBar(lookups, products, locations, filter)}
        <div class="card inv-table-wrap" style="padding:0;overflow:hidden">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Investor</th>
                  <th class="hide-sm">Type</th>
                  <th>Fase</th>
                  <th class="hide-sm">Lead</th>
                  <th class="text-right hide-sm">Ticket (M)</th>
                  <th class="text-right hide-sm">Sanns.</th>
                  <th class="text-right hide-sm">Vektet (M)</th>
                  <th class="hide-sm">Produkter</th>
                  <th class="hide-sm">Sist kontaktet</th>
                </tr>
              </thead>
              <tbody class="inv-tbody">${tableRows}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    setupEvents(el);

  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:red">Feil: ${window.escHtml(e.message)}</p></div>`;
  }
}
