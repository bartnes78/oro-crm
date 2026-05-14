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
  'Fundraising': '#D4AC0D', 'Aktiv': '#1A8A6A', 'Avsluttet': '#717D87', 'Pipeline': '#2471A3',
};

// ── Module state ──────────────────────────────────────────────────────────────
let _el         = null;
let _productId  = null;
let _product    = null;
let _investors  = [];
let _sort       = { col: 'weighted', dir: 'desc' };
let _saving     = {};   // investorId -> 'saving' | 'ok' | 'err'

// ── Entry ─────────────────────────────────────────────────────────────────────
export async function render(el, state) {
  _el        = el;
  _productId = state.id;
  _sort      = { col: 'weighted', dir: 'desc' };
  _saving    = {};

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
  const [products, investors] = await Promise.all([
    api.products(),
    api.investors({ product: _productId }),
  ]);
  _product   = products.find(p => String(p._id) === String(_productId)) || null;
  _investors = investors;

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
  const signed   = _investors.filter(i => i.phase === 'Tegnet' || i.phase === 'Onboardet');
  const declined = _investors.filter(i => i.phase === 'Ikke relevant nå');

  const totalWeighted = active.reduce((s, i) =>
    s + (i.target_ticket != null && i.probability != null ? i.target_ticket * i.probability : 0), 0);
  const signedTicket = signed.reduce((s, i) => s + (i.target_ticket || 0), 0);
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
              ? `<span style="font-size:12px;color:var(--muted);">Mål: <b>${fmt(_product.target_size)} MNOK</b></span>`
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
              <div style="width:${Math.min(fillPct, 100)}%;height:100%;background:#1E8449;border-radius:4px;"></div>
            </div>
            <div style="font-size:12px;font-weight:700;color:#1E8449;margin-top:4px;">
              ${fmt(signedTicket)} / ${fmt(_product.target_size)} MNOK (${fillPct}%)
            </div>
          </div>` : ''}
      </div>
    </div>

    <!-- KPIs -->
    <div class="kpi-grid" style="margin-top:16px;">
      ${kpiCard('Totalt',         _investors.length,           null,              null)}
      ${kpiCard('Aktiv pipeline', active.length,               null,              '#2471A3')}
      ${kpiCard('Vektet volum',   `${fmt(totalWeighted, 1)} M`, 'ticket × sanns.', '#D35400')}
      ${kpiCard('Tegnet',         signed.length,               signedTicket ? `${fmt(signedTicket)} MNOK` : null, '#1E8449')}
      ${kpiCard('Avslått',        declined.length,             null,              '#C0392B')}
    </div>

    <!-- Investor table -->
    <div class="card" style="padding:0;overflow:hidden;margin-top:16px;" id="inv-table-wrap">
      ${renderTable()}
    </div>`;

  attachTableEvents();
}

function kpiCard(label, value, sub, color) {
  return `<div class="kpi-card" style="${color ? `border-top-color:${color};` : ''}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${esc(String(value))}</div>
    ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}
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
  const invs = sortedInvestors();
  if (!invs.length) {
    return `<div class="table-wrap">
      <p style="padding:24px;color:var(--muted);font-size:13px;">Ingen investorer koblet til dette prosjektet.</p>
    </div>`;
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

    const declineContent = inv.phase === 'Ikke relevant nå'
      ? (inv.decline_reason
          ? `<span style="color:#c0392b;">${esc(inv.decline_reason)}</span>`
          : `<span style="opacity:.35;">Sett årsak</span>`)
      : `<span style="color:var(--muted);">—</span>`;

    const declineCursor = inv.phase === 'Ikke relevant nå' ? 'cursor:pointer;' : '';

    return `<tr data-inv-id="${esc(String(inv.id))}" style="${status === 'saving' ? 'opacity:.6;' : ''}">
      ${statusCell}
      <td style="font-weight:600;max-width:220px;">
        <span class="inv-link" data-inv-id="${esc(String(inv.id))}"
          style="cursor:pointer;color:var(--blue);">${esc(inv.name || '')}</span>
      </td>
      <td class="phase-cell" data-inv-id="${esc(String(inv.id))}" data-phase="${esc(inv.phase || '')}"
        style="cursor:pointer;white-space:nowrap;" title="Klikk for å endre fase">
        <span class="badge badge-${phaseClass}">${esc(inv.phase || '—')}</span>
        <span style="margin-left:4px;opacity:.25;font-size:10px;">✎</span>
      </td>
      <td style="font-size:12px;color:var(--muted);">${esc(inv.lead || '—')}</td>
      <td class="ticket-cell text-right" data-inv-id="${esc(String(inv.id))}"
        data-val="${inv.target_ticket != null ? inv.target_ticket : ''}"
        style="cursor:pointer;" title="Klikk for å endre">
        ${inv.target_ticket != null
          ? fmt(inv.target_ticket)
          : `<span style="opacity:.25;">—</span>`}
        <span style="margin-left:3px;opacity:.2;font-size:10px;">✎</span>
      </td>
      <td class="prob-cell text-right" data-inv-id="${esc(String(inv.id))}"
        data-val="${inv.probability != null ? inv.probability : ''}"
        style="cursor:pointer;" title="Klikk for å endre">
        ${inv.probability != null
          ? Math.round(inv.probability * 100) + '%'
          : `<span style="opacity:.25;">—</span>`}
        <span style="margin-left:3px;opacity:.2;font-size:10px;">✎</span>
      </td>
      <td class="text-right" style="font-weight:600;">
        ${weighted != null ? fmt(weighted, 1) : '—'}
      </td>
      <td class="decline-cell" data-inv-id="${esc(String(inv.id))}"
        data-phase="${esc(inv.phase || '')}"
        style="${declineCursor}font-size:12px;white-space:nowrap;"
        title="${inv.phase === 'Ikke relevant nå' ? 'Klikk for å endre avlagsårsak' : ''}">
        ${declineContent}
        ${inv.phase === 'Ikke relevant nå'
          ? `<span style="margin-left:3px;opacity:.2;font-size:10px;">✎</span>` : ''}
      </td>
      <td style="font-size:12px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${esc(inv.next_steps || '—')}
      </td>
      <td style="font-size:12px;white-space:nowrap;
        color:${lastContactColor};
        font-weight:${stale ? 600 : 400};">
        ${esc(lastContactText)}
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
            ${sortTh('target_ticket', 'Ticket (M)', true)}
            ${sortTh('probability',   'Sanns.',     true)}
            ${sortTh('weighted',      'Vektet (M)', true)}
            <th>Avlag</th>
            <th>Neste steg</th>
            ${sortTh('last_contact',  'Sist kontakt')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
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

  // Decline cells
  wrap.querySelectorAll('.decline-cell').forEach(td => {
    if (td.dataset.phase !== 'Ikke relevant nå') return;
    td.addEventListener('click', () => {
      if (td.querySelector('select')) return;
      const invId = td.dataset.invId;
      const inv   = _investors.find(i => String(i.id) === invId);
      if (!inv) return;
      const sel = document.createElement('select');
      sel.style.cssText = 'font-size:12px;padding:3px 6px;border-radius:5px;border:2px solid var(--blue);outline:none;';
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = '— Velg årsak —';
      sel.appendChild(blank);
      DECLINE_REASONS.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r;
        if (r === inv.decline_reason) opt.selected = true;
        sel.appendChild(opt);
      });
      td.innerHTML = '';
      td.appendChild(sel);
      sel.focus();

      const commit = async (newVal) => {
        const val = newVal || null;
        if (val === inv.decline_reason) { refreshTable(); return; }
        setSaving(inv.id, 'saving');
        try {
          await api.updateProductInvestor(_productId, inv.id, { decline_reason: val });
          _investors = _investors.map(i => i.id === inv.id ? { ...i, decline_reason: val } : i);
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
