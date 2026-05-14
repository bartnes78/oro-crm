import { api } from '../api.js';

const PHASES = ['Prospekt','Ny kontakt','Intro sendt','Møte avtalt','Aktiv dialog','Tegnet','Ikke relevant nå','Onboardet'];
const FILTER_KEY = 'crm_filter_bulk';

function loadFilter() {
  try { return JSON.parse(localStorage.getItem(FILTER_KEY)) || {}; } catch { return {}; }
}
function saveFilter(f) {
  localStorage.setItem(FILTER_KEY, JSON.stringify(f));
}

function selectHtml(id, value, options, emptyLabel) {
  const opts = (emptyLabel ? `<option value="">${window.escHtml(emptyLabel)}</option>` : '') +
    options.map(o => `<option value="${window.escHtml(o)}"${o === value ? ' selected' : ''}>${window.escHtml(o)}</option>`).join('');
  return `<select id="${id}" style="font-size:12px;padding:5px 8px;border-radius:7px;border:1px solid var(--border);min-height:44px">${opts}</select>`;
}

function statusIcon(status) {
  if (status === 'ok')      return '<span style="color:var(--green)">✓</span>';
  if (status === 'saving')  return '<span style="color:#aaa">…</span>';
  if (status === 'err')     return '<span style="color:red">!</span>';
  return '';
}

function buildRow(inv, savedStatus, leads, phases, types, selectedSet) {
  const weighted = (inv.target_ticket && inv.probability)
    ? (inv.target_ticket * inv.probability).toFixed(1)
    : null;
  const pctDisplay = (inv.probability != null && inv.probability !== '')
    ? Math.round(parseFloat(inv.probability) * 100) + '%'
    : '<span style="color:#ccc">—</span>';
  const ticketDisplay = (inv.target_ticket != null && inv.target_ticket !== '')
    ? Number(inv.target_ticket).toLocaleString('nb-NO')
    : '<span style="color:#ccc">—</span>';

  const checked = selectedSet.has(inv.id) ? ' checked' : '';
  const rowOpacity = savedStatus === 'saving' ? 'opacity:.6;' : '';

  return `<tr data-inv-id="${window.escHtml(inv.id)}" style="${rowOpacity}border-top:1px solid var(--border)">
    <td style="padding:8px 12px;text-align:center;width:28px">
      <input type="checkbox" class="row-check" data-id="${window.escHtml(inv.id)}" ${checked} style="width:18px;height:18px;cursor:pointer;accent-color:var(--blue)">
    </td>
    <td style="padding:8px 12px;font-weight:600;max-width:240px">
      <span class="inv-link" data-id="${window.escHtml(inv.id)}" style="cursor:pointer;color:var(--blue)">${window.escHtml(inv.name)}</span>
    </td>
    <td style="padding:6px 8px;width:140px">
      <select class="edit-cell" data-id="${window.escHtml(inv.id)}" data-field="phase"
        style="font-size:12px;padding:4px 6px;border-radius:5px;border:1px solid var(--border);width:100%;min-height:36px">
        ${phases.map(p => `<option value="${window.escHtml(p)}"${p === inv.phase ? ' selected' : ''}>${window.escHtml(p)}</option>`).join('')}
      </select>
    </td>
    <td style="padding:6px 8px;width:160px">
      <select class="edit-cell" data-id="${window.escHtml(inv.id)}" data-field="lead"
        style="font-size:12px;padding:4px 6px;border-radius:5px;border:1px solid var(--border);width:100%;min-height:36px">
        <option value="">—</option>
        ${leads.map(l => `<option value="${window.escHtml(l)}"${l === inv.lead ? ' selected' : ''}>${window.escHtml(l)}</option>`).join('')}
      </select>
    </td>
    <td style="padding:6px 8px;width:160px">
      <select class="edit-cell" data-id="${window.escHtml(inv.id)}" data-field="investor_type"
        style="font-size:12px;padding:4px 6px;border-radius:5px;border:1px solid var(--border);width:100%;min-height:36px">
        <option value="">—</option>
        ${types.map(t => `<option value="${window.escHtml(t)}"${t === inv.investor_type ? ' selected' : ''}>${window.escHtml(t)}</option>`).join('')}
      </select>
    </td>
    <td style="padding:6px 8px;width:100px;text-align:right">
      <input class="edit-cell" type="number" data-id="${window.escHtml(inv.id)}" data-field="target_ticket"
        value="${inv.target_ticket != null ? inv.target_ticket : ''}"
        style="font-size:12px;padding:4px 6px;border-radius:5px;border:1px solid var(--border);width:80px;text-align:right;min-height:36px"
        placeholder="—">
    </td>
    <td style="padding:6px 8px;width:90px;text-align:right">
      <input class="edit-cell" type="number" data-id="${window.escHtml(inv.id)}" data-field="probability"
        value="${inv.probability != null ? Math.round(parseFloat(inv.probability) * 100) : ''}"
        min="0" max="100" step="1"
        style="font-size:12px;padding:4px 6px;border-radius:5px;border:1px solid var(--border);width:70px;text-align:right;min-height:36px"
        placeholder="—">
    </td>
    <td style="padding:8px 12px;text-align:right;width:90px;font-weight:600;color:${weighted ? 'var(--navy,#1A2B4A)' : '#ccc'}">
      ${weighted ? Number(weighted).toLocaleString('nb-NO') : '—'}
    </td>
    <td style="padding:6px 8px;width:200px">
      <input class="edit-cell" type="text" data-id="${window.escHtml(inv.id)}" data-field="next_steps"
        value="${window.escHtml(inv.next_steps || '')}"
        style="font-size:12px;padding:4px 6px;border-radius:5px;border:1px solid var(--border);width:100%;min-height:36px"
        placeholder="Hva skal til…">
    </td>
    <td style="padding:8px 4px;text-align:center;width:44px">
      <span style="font-size:14px;display:inline-block;width:20px;text-align:center">${statusIcon(savedStatus)}</span>
    </td>
    <td style="padding:6px 8px;width:44px;text-align:center">
      <button class="btn btn-ghost btn-sm inv-open" data-id="${window.escHtml(inv.id)}" title="Åpne detaljer"
        style="font-size:12px;padding:4px 8px;min-height:36px">→</button>
    </td>
  </tr>`;
}

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted" style="padding:24px">Laster…</p></div>';

  let investors = [], lookups = {};
  const savedStatus = {}; // id → 'saving'|'ok'|'err'
  const pendingChanges = {}; // id → {field: value}
  let selectedIds = new Set();
  const flt = loadFilter();
  let search = flt.search || '';
  let filterPhase = flt.filterPhase || '';
  let filterLead  = flt.filterLead  || '';
  let filterType  = flt.filterType  || '';
  let sortField = '';
  let sortDir   = 'asc';

  try {
    [investors, lookups] = await Promise.all([api.investors({}), api.lookups()]);
  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:red">Feil: ${window.escHtml(e.message)}</p></div>`;
    return;
  }

  const leads  = lookups.leads  || [];
  const phases = lookups.phases || PHASES;
  const types  = lookups.types  || [];

  function getFiltered() {
    const q = search.toLowerCase();
    const filtered = investors.filter(inv => {
      if (q && !inv.name.toLowerCase().includes(q)) return false;
      if (filterPhase && inv.phase !== filterPhase) return false;
      if (filterLead  && inv.lead  !== filterLead)  return false;
      if (filterType) {
        if (filterType === '__ukjent__') { if (inv.investor_type) return false; }
        else if (inv.investor_type !== filterType)  return false;
      }
      return true;
    });
    if (!sortField) return filtered;
    return [...filtered].sort((a, b) => {
      let av = sortField === 'weighted'
        ? (a.target_ticket && a.probability ? a.target_ticket * a.probability : null)
        : a[sortField];
      let bv = sortField === 'weighted'
        ? (b.target_ticket && b.probability ? b.target_ticket * b.probability : null)
        : b[sortField];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = (typeof av === 'number' && typeof bv === 'number')
        ? av - bv
        : String(av).localeCompare(String(bv), 'nb');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  async function saveOne(id, field, rawValue) {
    let value;
    if (field === 'probability') {
      const n = parseFloat(rawValue);
      value = isNaN(n) ? null : n / 100;
    } else if (field === 'target_ticket') {
      const n = parseFloat(rawValue);
      value = isNaN(n) ? null : n;
    } else {
      value = rawValue === '' ? null : rawValue;
    }

    savedStatus[id] = 'saving';
    updateStatusCell(id);

    try {
      const updated = await api.updateInvestor(id, { [field]: value });
      const idx = investors.findIndex(i => i.id === id);
      if (idx !== -1) investors[idx] = { ...investors[idx], ...updated };
      savedStatus[id] = 'ok';
      updateStatusCell(id);
      // Update weighted cell
      updateWeightedCell(id);
      setTimeout(() => { delete savedStatus[id]; updateStatusCell(id); }, 1500);
    } catch {
      savedStatus[id] = 'err';
      updateStatusCell(id);
    }
  }

  function updateStatusCell(id) {
    const row = el.querySelector(`tr[data-inv-id="${CSS.escape(id)}"]`);
    if (!row) return;
    const cells = row.querySelectorAll('td');
    const statusCell = cells[cells.length - 2]; // second to last
    if (statusCell) statusCell.innerHTML = `<span style="font-size:14px;display:inline-block;width:20px;text-align:center">${statusIcon(savedStatus[id])}</span>`;
    row.style.opacity = savedStatus[id] === 'saving' ? '0.6' : '1';
  }

  function updateWeightedCell(id) {
    const row = el.querySelector(`tr[data-inv-id="${CSS.escape(id)}"]`);
    if (!row) return;
    const inv = investors.find(i => i.id === id);
    if (!inv) return;
    const weighted = (inv.target_ticket && inv.probability)
      ? (inv.target_ticket * inv.probability).toFixed(1) : null;
    const cells = row.querySelectorAll('td');
    const wCell = cells[7]; // index of weighted column
    if (wCell) {
      wCell.style.color = weighted ? 'var(--navy,#1A2B4A)' : '#ccc';
      wCell.textContent = weighted ? Number(weighted).toLocaleString('nb-NO') : '—';
    }
  }

  function buildBulkBar() {
    const count = selectedIds.size;
    if (!count) return '';
    const phaseOptions = phases.map(p => `<option value="${window.escHtml(p)}">${window.escHtml(p)}</option>`).join('');
    return `<div id="bulk-bar" style="background:var(--blue);color:#fff;padding:10px 16px;border-radius:8px;margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="font-weight:600;font-size:13px">${count} rad${count > 1 ? 'er' : ''} valgt</span>
      <select id="bulk-phase-select" style="font-size:12px;padding:5px 8px;border-radius:6px;border:none;min-height:36px">
        <option value="">Sett fase…</option>
        ${phaseOptions}
      </select>
      <button id="bulk-phase-btn" class="btn btn-sm" style="background:#fff;color:var(--blue);font-weight:600;min-height:36px">Lagre fase</button>
      <button id="deselect-all-btn" class="btn btn-ghost btn-sm" style="color:#fff;border-color:rgba(255,255,255,.4);min-height:36px">Fjern valg</button>
    </div>`;
  }

  function buildTable() {
    const filtered = getFiltered();
    const pendingCount = Object.keys(pendingChanges).length;
    const allChecked = filtered.length > 0 && filtered.every(i => selectedIds.has(i.id));

    const rows = filtered.length === 0
      ? `<tr><td colspan="11" class="empty-state">Ingen investorer funnet.</td></tr>`
      : filtered.map(inv => buildRow(inv, savedStatus[inv.id], leads, phases, types, selectedIds)).join('');

    return `
      ${buildBulkBar()}
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width:28px;padding:8px 12px">
                  <input type="checkbox" id="select-all-chk" ${allChecked ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;accent-color:var(--blue)">
                </th>
                <th data-sort="name" style="cursor:pointer;user-select:none">Investor <span class="sort-icon" data-for="name"></span></th>
                <th data-sort="phase" style="width:140px;cursor:pointer;user-select:none">Fase <span class="sort-icon" data-for="phase"></span></th>
                <th data-sort="lead" style="width:160px;cursor:pointer;user-select:none">Ansvarlig <span class="sort-icon" data-for="lead"></span></th>
                <th data-sort="investor_type" style="width:160px;cursor:pointer;user-select:none">Type <span class="sort-icon" data-for="investor_type"></span></th>
                <th data-sort="target_ticket" style="width:100px;text-align:right;cursor:pointer;user-select:none">Ticket (M) <span class="sort-icon" data-for="target_ticket"></span></th>
                <th data-sort="probability" style="width:90px;text-align:right;cursor:pointer;user-select:none">Sanns. % <span class="sort-icon" data-for="probability"></span></th>
                <th data-sort="weighted" style="width:90px;text-align:right;cursor:pointer;user-select:none">Vektet <span class="sort-icon" data-for="weighted"></span></th>
                <th data-sort="next_steps" style="width:200px;cursor:pointer;user-select:none">Hva skal til <span class="sort-icon" data-for="next_steps"></span></th>
                <th style="width:28px"></th>
                <th style="width:44px"></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
      <div style="margin-top:8px;font-size:11px;color:#aaa">
        Tips: Endre en verdi i kolonnen direkte og trykk Tab/Enter eller klikk bort for å lagre umiddelbart. Klikk investornavnet for fullstendig detaljside.
      </div>`;
  }

  function rebuildTable() {
    const tbody = el.querySelector('tbody');
    const filtered = getFiltered();
    const allChecked = filtered.length > 0 && filtered.every(i => selectedIds.has(i.id));
    const chk = el.querySelector('#select-all-chk');
    if (chk) chk.checked = allChecked;

    if (tbody) {
      tbody.innerHTML = filtered.length === 0
        ? `<tr><td colspan="11" class="empty-state">Ingen investorer funnet.</td></tr>`
        : filtered.map(inv => buildRow(inv, savedStatus[inv.id], leads, phases, types, selectedIds)).join('');
      attachRowEvents();
    }

    // Rebuild bulk bar
    const bulkBar = el.querySelector('#bulk-bar');
    if (bulkBar) {
      bulkBar.outerHTML = buildBulkBar();
    } else {
      const contentDiv = el.querySelector('.content > div:first-child');
      if (selectedIds.size > 0) {
        const bulkHtml = buildBulkBar();
        const card = el.querySelector('.card');
        if (card) card.insertAdjacentHTML('beforebegin', bulkHtml);
        attachBulkEvents();
      }
    }
    attachBulkEvents();
  }

  function attachBulkEvents() {
    el.querySelector('#deselect-all-btn')?.addEventListener('click', () => {
      selectedIds.clear();
      rebuildTable();
    });

    el.querySelector('#bulk-phase-btn')?.addEventListener('click', async () => {
      const sel = el.querySelector('#bulk-phase-select');
      const phase = sel?.value;
      if (!phase) { alert('Velg en fase først.'); return; }
      const ids = [...selectedIds];
      for (const id of ids) {
        await saveOne(id, 'phase', phase);
      }
      selectedIds.clear();
      rebuildTable();
    });
  }

  function attachRowEvents() {
    // Checkboxes
    el.querySelectorAll('.row-check').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.dataset.id;
        if (chk.checked) selectedIds.add(id); else selectedIds.delete(id);
        rebuildTable();
      });
    });

    // Select all
    el.querySelector('#select-all-chk')?.addEventListener('change', e => {
      const filtered = getFiltered();
      if (e.target.checked) filtered.forEach(i => selectedIds.add(i.id));
      else filtered.forEach(i => selectedIds.delete(i.id));
      rebuildTable();
    });

    // Inline edit cells — save on change/blur
    el.querySelectorAll('.edit-cell').forEach(input => {
      const id    = input.dataset.id;
      const field = input.dataset.field;

      if (input.tagName === 'SELECT') {
        input.addEventListener('change', () => saveOne(id, field, input.value));
      } else {
        input.addEventListener('change', () => saveOne(id, field, input.value));
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { input.blur(); saveOne(id, field, input.value); }
          if (e.key === 'Escape') {
            const inv = investors.find(i => i.id === id);
            if (inv) {
              if (field === 'probability') {
                input.value = inv.probability != null ? Math.round(parseFloat(inv.probability) * 100) : '';
              } else {
                input.value = inv[field] || '';
              }
            }
          }
        });
      }
    });

    // Investor name links
    el.querySelectorAll('.inv-link, .inv-open').forEach(btn => {
      btn.addEventListener('click', () => window.navigate('detalj', btn.dataset.id));
    });
  }

  function updateSortIndicators() {
    el.querySelectorAll('.sort-icon').forEach(span => {
      const field = span.dataset.for;
      span.textContent = field === sortField ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    });
  }

  function attachHeaderEvents() {
    el.querySelectorAll('thead th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (sortField === field) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortField = field;
          sortDir = 'asc';
        }
        updateSortIndicators();
        rebuildTable();
      });
    });
  }

  const COL_WIDTHS_KEY = 'crm_bulk_colwidths';
  function saveColWidths(table) {
    const widths = [...table.querySelectorAll('thead th')].map(th => th.offsetWidth);
    localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(widths));
  }
  function restoreColWidths(table) {
    try {
      const widths = JSON.parse(localStorage.getItem(COL_WIDTHS_KEY));
      if (!Array.isArray(widths)) return;
      const ths = table.querySelectorAll('thead th');
      widths.forEach((w, i) => { if (ths[i] && w > 20) ths[i].style.width = w + 'px'; });
    } catch { /* ignorér */ }
  }
  function makeColumnsResizable(table) {
    restoreColWidths(table);
    table.querySelectorAll('thead th').forEach(th => {
      if (th.querySelector('.col-resize-handle')) return;
      th.style.position = 'relative';
      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      handle.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:6px;cursor:col-resize;user-select:none;z-index:1';
      handle.title = 'Dra for å justere kolonnebredde';
      th.appendChild(handle);
      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        const startX = e.pageX;
        const startW = th.offsetWidth;
        const onMove = ev => { th.style.width = Math.max(30, startW + ev.pageX - startX) + 'px'; };
        const onUp   = ()  => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
          saveColWidths(table);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    });
  }

  function buildPage() {
    const filtered = getFiltered();

    el.innerHTML = `
      <div class="topbar">
        <span class="topbar-title">Bulkredigering (${filtered.length})</span>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="position:relative">
            <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:#aaa;pointer-events:none">🔍</span>
            <input id="search-input" value="${window.escHtml(search)}" placeholder="Søk navn…"
              style="padding:8px 10px 8px 32px;border-radius:8px;border:1px solid var(--border);font-size:13px;min-height:44px;width:200px">
          </div>
        </div>
      </div>
      <div class="content">
        <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${selectHtml('filter-phase', filterPhase, phases, 'Alle faser')}
          <select id="filter-type" style="font-size:12px;padding:5px 8px;border-radius:7px;border:1px solid var(--border);min-height:44px">
            <option value="">Alle typer</option>
            <option value="__ukjent__"${filterType === '__ukjent__' ? ' selected' : ''}>Ukjent type</option>
            ${types.map(t => `<option value="${window.escHtml(t)}"${t === filterType ? ' selected' : ''}>${window.escHtml(t)}</option>`).join('')}
          </select>
          ${selectHtml('filter-lead', filterLead, leads, 'ORO Kontakt')}
          ${(filterPhase || filterLead || filterType) ? `<button class="btn btn-ghost btn-sm" id="clear-filters-btn" style="min-height:44px">× Nullstill</button>` : ''}
          <span style="font-size:11px;color:#aaa;margin-left:4px">Klikk en celle for å redigere direkte — lagres umiddelbart</span>
        </div>
        <div id="table-container">
          ${buildTable()}
        </div>
      </div>`;

    // Filter events
    el.querySelector('#search-input')?.addEventListener('input', e => {
      search = e.target.value;
      saveFilter({ search, filterPhase, filterLead, filterType });
      el.querySelector('.topbar-title').textContent = `Bulkredigering (${getFiltered().length})`;
      rebuildTable();
    });

    el.querySelector('#filter-phase')?.addEventListener('change', e => {
      filterPhase = e.target.value;
      saveFilter({ search, filterPhase, filterLead, filterType });
      el.querySelector('.topbar-title').textContent = `Bulkredigering (${getFiltered().length})`;
      rebuildTable();
    });

    el.querySelector('#filter-type')?.addEventListener('change', e => {
      filterType = e.target.value;
      saveFilter({ search, filterPhase, filterLead, filterType });
      el.querySelector('.topbar-title').textContent = `Bulkredigering (${getFiltered().length})`;
      rebuildTable();
    });

    el.querySelector('#filter-lead')?.addEventListener('change', e => {
      filterLead = e.target.value;
      saveFilter({ search, filterPhase, filterLead, filterType });
      el.querySelector('.topbar-title').textContent = `Bulkredigering (${getFiltered().length})`;
      rebuildTable();
    });

    el.querySelector('#clear-filters-btn')?.addEventListener('click', () => {
      filterPhase = ''; filterLead = ''; filterType = '';
      localStorage.removeItem(FILTER_KEY);
      buildPage();
    });

    attachRowEvents();
    attachBulkEvents();
    attachHeaderEvents();
    updateSortIndicators();
    const table = el.querySelector('table');
    if (table) makeColumnsResizable(table);
  }

  buildPage();
}
