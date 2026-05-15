import { api } from '../api.js';

const PHASES = [
  'Prospekt', 'Ny kontakt', 'Intro sendt', 'Møte avtalt',
  'Aktiv dialog', 'Tegnet', 'Ikke relevant nå', 'Onboardet',
];
const PHASE_MAP = {
  'Prospekt': 'prospect', 'Ny kontakt': 'nykontakt', 'Intro sendt': 'introsendt',
  'Møte avtalt': 'moteavtalt', 'Aktiv dialog': 'aktivdialog',
  'Tegnet': 'tegnet', 'Ikke relevant nå': 'ikkerelevan', 'Onboardet': 'onboardet',
};
const ACTIVE_PHASES  = ['Prospekt', 'Ny kontakt', 'Intro sendt', 'Møte avtalt', 'Aktiv dialog'];
const DECLINE_REASONS = [
  'For høy risiko', 'Allerede eksponert', 'Timing', 'Manglende kapital',
  'Ikke aktuelt nå', 'Ingen svar', 'Annet',
];
const TYPES    = ['Fond', 'Prosjekt', 'Co-invest', 'Annet'];
const STATUSES = ['Fundraising', 'Aktiv', 'Avsluttet', 'Pipeline'];
const STATUS_COLOR = {
  'Fundraising': '#D4AC0D', 'Aktiv': 'var(--color-signed)', 'Avsluttet': '#717D87', 'Pipeline': '#2471A3',
};

// ── Module state ──────────────────────────────────────────────────────────────
let _el             = null;
let _productId      = null;
let _product        = null;
let _investors      = [];
let _declinedOffers = [];
let _sort           = { col: 'weighted', dir: 'desc' };
let _saving         = {};   // investorId -> 'saving' | 'ok' | 'err'
let _showPct        = false;

// ── Entry ─────────────────────────────────────────────────────────────────────
export async function render(el, state) {
  _el        = el;
  _productId = state.id;
  _sort      = { col: 'weighted', dir: 'desc' };
  _saving    = {};
  _showPct   = false;

  _el.innerHTML = `
    <div class="topbar">
      <button class="btn btn-ghost btn-sm" id="btn-back">← Prosjekter</button>
      <span class="topbar-title" style="flex:1;" id="prod-title">…</span>
      <button class="btn btn-ghost btn-sm" id="btn-edit-prod">Rediger</button>
      <button class="btn btn-green btn-sm" onclick="window.navigate('logg')">+ Logg kontakt</button>
    </div>
    <div class="content" id="pd-content">
      <p class="text-muted">Laster…</p>
    </div>`;

  _el.querySelector('#btn-back').addEventListener('click', () => window.navigate('prosjekter'));
  _el.querySelector('#btn-edit-prod').addEventListener('click', openEditModal);

  await loadData();
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadData() {
  const [products, investors, declinedOffers] = await Promise.all([
    api.products(),
    api.investors({ product: _productId }),
    api.declinedOffers(_productId),
  ]);
  _product        = products.find(p => String(p._id) === String(_productId)) || null;
  _investors      = investors;
  _declinedOffers = declinedOffers;

  if (!_product) {
    document.getElementById('pd-content').innerHTML =
      '<p class="text-muted">Prosjekt ikke funnet.</p>';
    return;
  }

  document.getElementById('prod-title').textContent = _product.name;
  renderContent();
}

// ── Main content ──────────────────────────────────────────────────────────────
function renderContent() {
  const content = document.getElementById('pd-content');
  if (!content) return;

  const active   = _investors.filter(i => ACTIVE_PHASES.includes(i.phase));
  const signed   = _investors.filter(i => i.phase === 'Tegnet' || Number(i.committed_amount) > 0);
  const declined = _investors.filter(i => i.phase === 'Ikke relevant nå');

  const totalWeighted = active.reduce((s, i) =>
    s + (i.target_ticket != null && i.probability != null ? i.target_ticket * i.probability : 0), 0);
  const signedTicket = signed.reduce((s, i) => s + (Number(i.committed_amount) || Number(i.target_ticket) || 0), 0);
  const fillPct      = _product.target_size
    ? Math.round((signedTicket / _product.target_size) * 100) : null;

  const sc = STATUS_COLOR[_product.status] || 'var(--muted)';

  content.innerHTML = `
    <!-- Product header card -->
    <div class="card" style="padding:16px 20px;margin-bottom:0;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;
              background:${sc}22;color:${sc};">${esc(_product.status || '')}</span>
            <span style="font-size:12px;color:var(--muted);">${esc(_product.type || '')}</span>
            ${_product.target_size
              ? `<span style="font-size:16px;font-weight:700;color:var(--text);">${fmt(_product.target_size)} MNOK</span>`
              : ''}
          </div>
          ${_product.description
            ? `<p style="font-size:13px;color:var(--muted);margin:8px 0 0;max-width:600px;">${esc(_product.description)}</p>`
            : ''}
        </div>
        ${fillPct != null ? `
          <div style="text-align:right;">
            <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">Tegnet av mål</div>
            <div style="width:180px;height:8px;background:var(--border);border-radius:4px;overflow:hidden;">
              <div style="width:${Math.min(fillPct, 100)}%;height:100%;background:var(--color-signed);border-radius:4px;"></div>
            </div>
            <div style="font-size:12px;font-weight:700;color:var(--color-signed);margin-top:4px;">
              ${fmt(signedTicket)} / ${fmt(_product.target_size)} MNOK (${fillPct}%)
            </div>
          </div>` : ''}
      </div>
    </div>

    <!-- KPIs -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;margin-bottom:0;">
      <div></div>
      ${_product.target_size ? `
        <button id="btn-toggle-pct"
          style="font-size:11px;padding:4px 12px;border-radius:20px;border:1.5px solid var(--border);background:${_showPct ? 'var(--blue)' : 'transparent'};color:${_showPct ? '#fff' : 'var(--muted)'};cursor:pointer;font-weight:600;transition:all .15s;">
          ${_showPct ? '% av mål' : 'MNOK'} ⇄ ${_showPct ? 'MNOK' : '% av mål'}
        </button>` : ''}
    </div>
    <div class="kpi-grid" style="margin-top:8px;">
      ${kpiCard('Totalt',         _investors.length,           null,              null)}
      ${kpiCard('Aktiv pipeline', active.length,               null,              '#2471A3')}
      ${_showPct && _product.target_size
        ? kpiCard('Estimert volum', `${fmt(totalWeighted / _product.target_size * 100, 1)} %`, 'av målet', '#D35400')
        : kpiCard('Estimert volum', `${fmt(totalWeighted, 1)} M`, 'ticket × sanns.', '#D35400')}
      <div class="kpi-card" style="border-top-color:var(--color-signed);">
        <div class="kpi-label">Tegnet</div>
        <div class="kpi-value">${signed.length} inv.</div>
        ${signedTicket ? `<div class="kpi-value" style="font-size:1.35rem;color:var(--color-signed);">
          ${_showPct && _product.target_size
            ? fmt(signedTicket / _product.target_size * 100, 1) + ' %'
            : fmt(signedTicket, 0) + ' MNOK'}
        </div>` : ''}
      </div>
      ${kpiCard('Avslått',        _declinedOffers.length,      null,              '#C0392B')}
    </div>

    <!-- Investor table -->
    <div class="card" style="padding:0;overflow:hidden;margin-top:16px;" id="inv-table-wrap">
      ${renderTable()}
    </div>

    <!-- Avslåtte tilbud -->
    <details id="declined-section" style="margin-top:16px;" ${_declinedOffers.length > 0 ? 'open' : ''}>
      <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--bg);border:1px solid var(--border);border-radius:8px;user-select:none;font-size:13px;font-weight:600;color:var(--muted);">
        <span style="color:#C0392B;">&#9679;</span>
        Avslåtte tilbud — ${_declinedOffers.length} investor${_declinedOffers.length !== 1 ? 'er' : ''}
        <span style="font-size:11px;font-weight:400;margin-left:4px;">(telles ikke i volum)</span>
        <span class="details-arrow" style="margin-left:auto;font-size:11px;opacity:.5;">▼</span>
      </summary>
      <div class="card" style="padding:0;overflow:hidden;margin-top:4px;border-radius:0 0 8px 8px;">
        ${renderDeclinedSection()}
      </div>
    </details>`;

  attachTableEvents();

  const toggleBtn = content.querySelector('#btn-toggle-pct');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      _showPct = !_showPct;
      renderContent();
    });
  }

  content.querySelector('#declined-section')?.querySelectorAll('.inv-link').forEach(el => {
    el.addEventListener('click', () => window.navigate('detalj', el.dataset.invId));
  });

  content.querySelector('#declined-section')?.querySelectorAll('.delete-declined-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Fjern avslaget?')) return;
      try {
        await api.deleteDeclinedOffer(parseInt(btn.dataset.id));
        _declinedOffers = _declinedOffers.filter(d => String(d._id) !== btn.dataset.id);
        renderContent();
      } catch (e) { alert(e.message); }
    });
  });
}

function kpiCard(label, value, sub, color) {
  return `<div class="kpi-card" style="${color ? `border-top-color:${color};` : ''}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${esc(String(value))}</div>
    ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}
  </div>`;
}

// ── Avslåtte tilbud-seksjon ───────────────────────────────────────────────────
function renderDeclinedSection() {
  if (!_declinedOffers.length) {
    return `<p style="padding:16px;font-size:13px;color:var(--muted);">Ingen registrerte avslag for dette prosjektet.</p>`;
  }
  const rows = _declinedOffers.map(d => {
    const ticket = d.target_ticket != null ? `${fmt(d.target_ticket, 0)} M` : '—';
    return `<tr>
      <td style="font-weight:600;max-width:220px;">
        <span class="inv-link" data-inv-id="${esc(String(d.investor_id))}"
          style="cursor:pointer;color:var(--blue);">${esc(d.investor_name || '')}</span>
      </td>
      <td style="font-size:12px;color:var(--muted);">${esc(d.lead || '—')}</td>
      <td style="font-size:12px;color:#c0392b;">${esc(d.decline_reason || '—')}</td>
      <td style="font-size:12px;color:var(--muted);">${esc(d.declined_at || '—')}</td>
      <td class="text-right" style="font-size:12px;color:var(--muted);opacity:.6;">${ticket}</td>
      <td style="text-align:right;">
        <button class="delete-declined-btn" data-id="${esc(String(d._id))}"
          style="background:none;border:none;cursor:pointer;color:#C0392B;font-size:13px;padding:2px 6px;opacity:.5;"
          title="Fjern avslag">✕</button>
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Investor</th>
            <th>Ansvarlig</th>
            <th>Avslagsårsak</th>
            <th>Dato</th>
            <th class="text-right" style="opacity:.6;">Ticket</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Table ─────────────────────────────────────────────────────────────────────
function sortedInvestors() {
  return [..._investors].sort((a, b) => {
    let va, vb;
    const { col, dir } = _sort;
    if (col === 'weighted') {
      va = a.target_ticket != null && a.probability != null ? a.target_ticket * a.probability : -1;
      vb = b.target_ticket != null && b.probability != null ? b.target_ticket * b.probability : -1;
    } else if (col === 'name') {
      va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase();
    } else if (col === 'phase') {
      va = PHASES.indexOf(a.phase); vb = PHASES.indexOf(b.phase);
    } else if (col === 'lead') {
      va = (a.lead || '').toLowerCase(); vb = (b.lead || '').toLowerCase();
    } else if (col === 'last_contact') {
      va = a.last_contact || ''; vb = b.last_contact || '';
    } else {
      va = a[col] != null ? a[col] : -1;
      vb = b[col] != null ? b[col] : -1;
    }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function sortTh(col, label, alignRight = false) {
  const active = _sort.col === col;
  const arrow  = active
    ? `<span style="margin-left:4px;font-size:10px;opacity:.7;">${_sort.dir === 'asc' ? '▲' : '▼'}</span>`
    : `<span style="margin-left:4px;font-size:10px;opacity:.2;">⇅</span>`;
  return `<th class="sort-th${alignRight ? ' text-right' : ''}" data-col="${col}"
    style="cursor:pointer;user-select:none;white-space:nowrap;">${esc(label)}${arrow}</th>`;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function renderTable() {
  const invs = sortedInvestors().filter(i => i.phase !== 'Ikke relevant nå');
  if (!invs.length) {
    return `<div class="table-wrap">
      <p style="padding:24px;color:var(--muted);font-size:13px;">Ingen investorer koblet til dette prosjektet.</p>
    </div>`;
  }

  const pctBase = _showPct && _product?.target_size ? _product.target_size : null;
  const fmtVal  = (v, dec = 1) => pctBase
    ? (v != null ? fmt(v / pctBase * 100, dec) + ' %' : null)
    : (v != null ? fmt(v, dec)                         : null);

  let sumTicket = 0, sumWeighted = 0;
  for (const inv of invs) {
    if (inv.target_ticket != null) sumTicket += inv.target_ticket;
    if (inv.target_ticket != null && inv.probability != null)
      sumWeighted += inv.target_ticket * inv.probability;
  }

  const rows = invs.map(inv => {
    const weighted = inv.target_ticket != null && inv.probability != null
      ? inv.target_ticket * inv.probability : null;
    const days   = daysSince(inv.last_contact);
    const stale  = days != null && days >= 30 && ACTIVE_PHASES.includes(inv.phase);
    const status = _saving[inv.id];

    const statusCell = `<td style="width:24px;text-align:center;font-size:13px;">
      ${status === 'ok'      ? `<span style="color:var(--green);">✓</span>` : ''}
      ${status === 'saving'  ? `<span style="color:#aaa;">…</span>` : ''}
      ${status === 'err'     ? `<span style="color:red;">!</span>` : ''}
    </td>`;

    const phaseClass = PHASE_MAP[inv.phase] || 'default';

    const lastContactColor = stale
      ? (days >= 60 ? '#e74c3c' : '#e07000') : 'var(--muted)';
    const lastContactText  = inv.last_contact
      ? (stale ? `${days} dager siden` : inv.last_contact) : '—';

    const alreadyDeclined = _declinedOffers.some(d => d.investor_id === inv.id);

    return `<tr data-inv-id="${esc(String(inv.id))}" style="${status === 'saving' ? 'opacity:.6;' : ''}">
      ${statusCell}
      <td style="font-weight:600;max-width:220px;">
        <span class="inv-link" data-inv-id="${esc(String(inv.id))}"
          style="cursor:pointer;color:var(--blue);">${esc(inv.name || '')}</span>
      </td>
      <td class="phase-cell editable-cell" data-inv-id="${esc(String(inv.id))}" data-phase="${esc(inv.phase || '')}"
        style="white-space:nowrap;" title="Klikk for å endre fase">
        <span class="badge badge-${phaseClass}">${esc(inv.phase || '—')}</span>
        <span style="margin-left:4px;opacity:.25;font-size:10px;">✎</span>
      </td>
      <td style="font-size:12px;color:var(--muted);">${esc(inv.lead || '—')}</td>
      <td class="ticket-cell editable-cell text-right" data-inv-id="${esc(String(inv.id))}"
        data-val="${inv.target_ticket != null ? inv.target_ticket : ''}"
        title="Klikk for å endre">
        ${fmtVal(inv.target_ticket, 1) ?? `<span style="opacity:.25;">—</span>`}
        <span style="margin-left:3px;opacity:.2;font-size:10px;">✎</span>
      </td>
      <td class="prob-cell editable-cell text-right" data-inv-id="${esc(String(inv.id))}"
        data-val="${inv.probability != null ? inv.probability : ''}"
        title="Klikk for å endre">
        ${inv.probability != null
          ? Math.round(inv.probability * 100) + '%'
          : `<span style="opacity:.25;">—</span>`}
        <span style="margin-left:3px;opacity:.2;font-size:10px;">✎</span>
      </td>
      <td class="text-right" style="font-weight:600;">
        ${fmtVal(weighted, 1) ?? '—'}
      </td>
      <td style="font-size:12px;color:var(--muted);">—</td>
      <td style="font-size:12px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${esc(inv.next_steps || '—')}
      </td>
      <td style="font-size:12px;white-space:nowrap;
        color:${lastContactColor};
        font-weight:${stale ? 600 : 400};">
        ${esc(lastContactText)}
      </td>
      <td style="text-align:right;white-space:nowrap;">
        ${alreadyDeclined
          ? `<span style="font-size:11px;color:#c0392b;opacity:.5;">Avslått ✓</span>`
          : `<button class="register-decline-btn"
              data-inv-id="${esc(String(inv.id))}"
              data-inv-name="${esc(inv.name || '')}"
              style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid #c0392b;background:none;color:#c0392b;cursor:pointer;opacity:.6;"
              title="Registrer avslag for dette prosjektet">Avslag</button>`}
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:24px;"></th>
            ${sortTh('name',          'Investor')}
            ${sortTh('phase',         'Fase')}
            ${sortTh('lead',          'Ansvarlig')}
            ${sortTh('target_ticket', pctBase ? 'Ticket (%)' : 'Ticket (M)', true)}
            ${sortTh('probability',   'Sanns.',                              true)}
            ${sortTh('weighted',      pctBase ? 'Vektet (%)' : 'Vektet (M)', true)}
            <th>Avslag</th>
            <th>Neste steg</th>
            ${sortTh('last_contact',  'Sist kontakt')}
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="background:var(--bg);border-top:2px solid var(--border);font-weight:700;">
            <td></td>
            <td style="font-size:12px;color:var(--muted);padding-top:8px;padding-bottom:8px;">
              Sum (${invs.length} inv.)
            </td>
            <td></td>
            <td></td>
            <td class="text-right" style="font-size:13px;padding-top:8px;padding-bottom:8px;">
              ${fmtVal(sumTicket, 1) ?? '—'}
              ${!pctBase && _product?.target_size && sumTicket > 0
                ? `<div style="font-size:10px;font-weight:400;color:${sumTicket / _product.target_size > 1 ? '#e07000' : 'var(--color-signed)'};">
                    ${fmt(sumTicket / _product.target_size * 100, 0)} % av mål
                   </div>`
                : ''}
            </td>
            <td></td>
            <td class="text-right" style="font-size:13px;color:#D35400;padding-top:8px;padding-bottom:8px;">
              ${fmtVal(sumWeighted, 1) ?? '—'}
            </td>
            <td colspan="3"></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div style="padding:8px 16px;font-size:11px;color:#aaa;border-top:1px solid var(--border);">
      Klikk fase, ticket, sanns. eller avlag for å redigere direkte · Klikk kolonneoverskrift for å sortere · Klikk investornavn for detaljside
    </div>`;
}

function refreshTable() {
  const wrap = document.getElementById('inv-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = renderTable();
  attachTableEvents();
}

function attachTableEvents() {
  const wrap = document.getElementById('inv-table-wrap');
  if (!wrap) return;

  // Sort headers
  wrap.querySelectorAll('.sort-th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (_sort.col === col) {
        _sort.dir = _sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        _sort = {
          col,
          dir: ['weighted', 'target_ticket', 'probability'].includes(col) ? 'desc' : 'asc',
        };
      }
      refreshTable();
    });
  });

  // Investor links
  wrap.querySelectorAll('.inv-link').forEach(el => {
    el.addEventListener('click', () => window.navigate('detalj', el.dataset.invId));
  });

  // Phase cells
  wrap.querySelectorAll('.phase-cell').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('select')) return;
      const invId = td.dataset.invId;
      const inv   = _investors.find(i => String(i.id) === invId);
      if (!inv) return;
      const sel = document.createElement('select');
      sel.style.cssText = 'font-size:12px;padding:3px 6px;border-radius:5px;border:2px solid var(--blue);outline:none;';
      PHASES.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        if (p === inv.phase) opt.selected = true;
        sel.appendChild(opt);
      });
      td.innerHTML = '';
      td.appendChild(sel);
      sel.focus();

      const commit = async (newPhase) => {
        if (newPhase === inv.phase) { refreshTable(); return; }
        setSaving(inv.id, 'saving');
        try {
          const updated = await api.updateInvestor(inv.id, { phase: newPhase });
          _investors = _investors.map(i => i.id === inv.id ? { ...i, ...updated, phase: newPhase } : i);
          setSaving(inv.id, 'ok');
          scheduleOkClear(inv.id);
        } catch {
          setSaving(inv.id, 'err');
        }
        refreshTable();
      };

      sel.addEventListener('change', () => commit(sel.value));
      sel.addEventListener('blur',   () => commit(sel.value));
    });
  });

  // Ticket cells
  wrap.querySelectorAll('.ticket-cell').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('input')) return;
      const invId = td.dataset.invId;
      const inv   = _investors.find(i => String(i.id) === invId);
      if (!inv) return;
      const input = document.createElement('input');
      input.type  = 'number';
      input.value = inv.target_ticket != null ? inv.target_ticket : '';
      input.style.cssText = 'width:72px;font-size:12px;padding:3px 6px;border-radius:5px;border:2px solid var(--blue);outline:none;text-align:right;';
      td.innerHTML = '';
      td.appendChild(input);
      input.focus();
      input.select();

      const commit = async () => {
        const val = input.value === '' ? null : (parseFloat(input.value) || null);
        if (val === inv.target_ticket) { refreshTable(); return; }
        setSaving(inv.id, 'saving');
        try {
          await api.updateProductInvestor(_productId, inv.id, { target_ticket: val });
          _investors = _investors.map(i => i.id === inv.id ? { ...i, target_ticket: val } : i);
          setSaving(inv.id, 'ok');
          scheduleOkClear(inv.id);
        } catch {
          setSaving(inv.id, 'err');
        }
        refreshTable();
      };

      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  commit();
        if (e.key === 'Escape') refreshTable();
      });
    });
  });

  // Probability cells
  wrap.querySelectorAll('.prob-cell').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('input')) return;
      const invId = td.dataset.invId;
      const inv   = _investors.find(i => String(i.id) === invId);
      if (!inv) return;
      const input = document.createElement('input');
      input.type  = 'number';
      input.min   = '0';
      input.max   = '100';
      input.value = inv.probability != null ? Math.round(inv.probability * 100) : '';
      input.style.cssText = 'width:58px;font-size:12px;padding:3px 6px;border-radius:5px;border:2px solid var(--blue);outline:none;text-align:right;';
      const pct = document.createElement('span');
      pct.textContent = '%';
      pct.style.cssText = 'font-size:11px;margin-left:2px;';
      td.innerHTML = '';
      td.appendChild(input);
      td.appendChild(pct);
      input.focus();
      input.select();

      const commit = async () => {
        const raw = parseFloat(input.value);
        const val = input.value === '' ? null : (isNaN(raw) ? null : Math.min(100, Math.max(0, raw)) / 100);
        if (val === inv.probability) { refreshTable(); return; }
        setSaving(inv.id, 'saving');
        try {
          await api.updateProductInvestor(_productId, inv.id, { probability: val });
          _investors = _investors.map(i => i.id === inv.id ? { ...i, probability: val } : i);
          setSaving(inv.id, 'ok');
          scheduleOkClear(inv.id);
        } catch {
          setSaving(inv.id, 'err');
        }
        refreshTable();
      };

      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  commit();
        if (e.key === 'Escape') refreshTable();
      });
    });
  });

  // Registrer avslag-knapper
  wrap.querySelectorAll('.register-decline-btn').forEach(btn => {
    btn.addEventListener('click', () => openDeclineModal(btn.dataset.invId, btn.dataset.invName));
  });

}

// ── Saving state helpers ──────────────────────────────────────────────────────
function setSaving(id, status) {
  _saving[id] = status;
  // Update just the status cell without full re-render
  const td = document.querySelector(`tr[data-inv-id="${id}"] td:first-child`);
  if (!td) return;
  td.innerHTML = status === 'ok'     ? `<span style="color:var(--green);">✓</span>` :
                 status === 'saving' ? `<span style="color:#aaa;">…</span>`         :
                 status === 'err'    ? `<span style="color:red;">!</span>`          : '';
  const tr = td.closest('tr');
  if (tr) tr.style.opacity = status === 'saving' ? '0.6' : '';
}

function scheduleOkClear(id) {
  setTimeout(() => {
    delete _saving[id];
    const td = document.querySelector(`tr[data-inv-id="${id}"] td:first-child`);
    if (td) { td.innerHTML = ''; const tr = td.closest('tr'); if (tr) tr.style.opacity = ''; }
  }, 1500);
}

// ── Edit product modal ────────────────────────────────────────────────────────
function openEditModal() {
  if (!_product) return;
  const p = _product;

  const html = `
    <div class="modal-header">
      <h3>Rediger prosjekt</h3>
      <button class="btn-close" onclick="window.closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div id="edit-err" class="alert-err" style="display:none;margin-bottom:12px;"></div>
      <div class="form-grid">
        <div class="form-group full">
          <label>Navn</label>
          <input id="ep-name" value="${esc(p.name || '')}" />
        </div>
        <div class="form-group">
          <label>Type</label>
          <select id="ep-type">
            ${TYPES.map(t => `<option${p.type === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Status</label>
          <select id="ep-status">
            ${STATUSES.map(s => `<option${p.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Målstørrelse (MNOK)</label>
          <input id="ep-size" type="number" min="0" step="0.1" value="${p.target_size != null ? p.target_size : ''}" />
        </div>
        <div class="form-group full">
          <label>Beskrivelse</label>
          <textarea id="ep-desc" style="min-height:60px;">${esc(p.description || '')}</textarea>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-primary" id="btn-save-edit">Lagre</button>
    </div>`;

  window.openModal(html, () => {
    document.getElementById('ep-name').focus();
    document.getElementById('btn-save-edit').addEventListener('click', async () => {
      const name = document.getElementById('ep-name').value.trim();
      if (!name) {
        const err = document.getElementById('edit-err');
        err.textContent = 'Navn er påkrevd.';
        err.style.display = '';
        return;
      }
      const payload = {
        name,
        type:        document.getElementById('ep-type').value,
        status:      document.getElementById('ep-status').value,
        target_size: parseFloat(document.getElementById('ep-size').value) || null,
        description: document.getElementById('ep-desc').value.trim(),
      };
      try {
        await api.updateProduct(_productId, payload);
        window.closeModal();
        await loadData();
      } catch (e) {
        const err = document.getElementById('edit-err');
        err.textContent = e.message || 'Lagring feilet.';
        err.style.display = '';
      }
    });
  });
}

// ── Registrer avslag-modal ────────────────────────────────────────────────────
function openDeclineModal(invId, invName) {
  const today = new Date().toISOString().slice(0, 10);
  const reasonOpts = DECLINE_REASONS.map(r =>
    `<option value="${esc(r)}">${esc(r)}</option>`).join('');

  window.openModal(`
    <div style="padding:24px;min-width:340px;">
      <h3 style="margin:0 0 16px;font-size:16px;">Registrer avslag</h3>
      <p style="font-size:13px;color:var(--muted);margin:0 0 16px;">${esc(invName)}</p>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Avslagsårsak</label>
        <select id="decline-reason-sel" style="width:100%;padding:7px 10px;border-radius:6px;border:1.5px solid var(--border);font-size:13px;">
          <option value="">— Velg årsak —</option>
          ${reasonOpts}
        </select>
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Dato</label>
        <input id="decline-date-inp" type="date" value="${today}"
          style="width:100%;padding:7px 10px;border-radius:6px;border:1.5px solid var(--border);font-size:13px;box-sizing:border-box;">
      </div>
      <p id="decline-err" style="display:none;color:red;font-size:12px;margin:0 0 10px;"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="decline-cancel-btn" class="btn btn-ghost btn-sm">Avbryt</button>
        <button id="decline-save-btn" class="btn btn-sm" style="background:#c0392b;color:#fff;border:none;">Registrer avslag</button>
      </div>
    </div>`);

  document.getElementById('decline-cancel-btn').addEventListener('click', window.closeModal);
  document.getElementById('decline-save-btn').addEventListener('click', async () => {
    const reason = document.getElementById('decline-reason-sel').value;
    const date   = document.getElementById('decline-date-inp').value;
    const errEl  = document.getElementById('decline-err');
    if (!reason) { errEl.textContent = 'Velg en årsak.'; errEl.style.display = ''; return; }
    try {
      await api.addDeclinedOffer({
        product_id: _productId, investor_id: invId,
        decline_reason: reason, declined_at: date || null,
      });
      window.closeModal();
      await loadData();
    } catch (e) {
      errEl.textContent = e.message || 'Lagring feilet.';
      errEl.style.display = '';
    }
  });
}

// ── Util ──────────────────────────────────────────────────────────────────────
function fmt(n, dec = 0) {
  return window.fmt ? window.fmt(n, dec) : (n == null ? '—'
    : Number(n).toLocaleString('nb-NO', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
}

function esc(s) {
  return window.escHtml ? window.escHtml(s) : String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
