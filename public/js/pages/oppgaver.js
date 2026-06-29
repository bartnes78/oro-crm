import { api } from '../api.js';

// ── Module state ──────────────────────────────────────────────────────────────
let _el          = null;
let _state       = null;
let _tasks       = [];
let _lookups     = {};
let _investors   = [];
let _filter      = 'pending';   // 'pending' | 'all'

// ── Entry ─────────────────────────────────────────────────────────────────────
export async function render(el, state) {
  _el    = el;
  _state = state;

  _el.innerHTML = `
    <div class="topbar">
      <span class="topbar-title">Oppgaver</span>
      <div style="display:flex;gap:6px;margin-left:auto;" id="topbar-actions"></div>
    </div>
    <div class="content" id="task-content">
      <p class="text-muted">Laster…</p>
    </div>`;

  // Load reference data once
  [_lookups, _investors] = await Promise.all([
    api.lookups(),
    api.investors({}).then(d => d.investors || d),
  ]);

  await loadTasks();
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadTasks() {
  const params = _filter === 'pending' ? { done: 0 } : {};
  _tasks = await api.tasks(params);
  renderContent();
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderContent() {
  const today    = new Date().toISOString().slice(0, 10);
  const overdue  = _tasks.filter(t => !t.done && t.due_date < today);
  const upcoming = _tasks.filter(t => !t.done && t.due_date >= today);
  const done     = _tasks.filter(t => t.done);
  const pending  = overdue.length + upcoming.length;

  // Topbar buttons
  const actions = _el.querySelector('#topbar-actions');
  if (actions) {
    actions.innerHTML = `
      <button class="btn btn-sm ${_filter === 'pending' ? 'btn-primary' : 'btn-ghost'}" id="btn-filter-pending"
        style="min-height:36px;">
        Aktive${pending > 0 ? ` (${pending})` : ''}
      </button>
      <button class="btn btn-sm ${_filter === 'all' ? 'btn-primary' : 'btn-ghost'}" id="btn-filter-all"
        style="min-height:36px;">
        Alle
      </button>
      <button class="btn btn-green btn-sm" id="btn-new-task" style="min-height:36px;">
        + Ny oppgave
      </button>`;

    actions.querySelector('#btn-filter-pending').addEventListener('click', () => {
      _filter = 'pending';
      loadTasks();
    });
    actions.querySelector('#btn-filter-all').addEventListener('click', () => {
      _filter = 'all';
      loadTasks();
    });
    actions.querySelector('#btn-new-task').addEventListener('click', () => openNewTaskModal());
  }

  // Content area
  const content = document.getElementById('task-content');
  if (!content) return;

  if (_tasks.length === 0) {
    content.innerHTML = '<p class="text-muted">Ingen oppgaver.</p>';
    return;
  }

  content.innerHTML = `
    <div id="section-overdue"></div>
    <div id="section-upcoming"></div>
    <div id="section-done"></div>`;

  renderSection('section-overdue',  'Forfalt',   overdue,  '#e74c3c', today);
  renderSection('section-upcoming', 'Kommende',  upcoming, 'var(--blue)', today);
  if (_filter === 'all') {
    renderSection('section-done', 'Fullført', done, 'var(--muted)', today);
  }
}

function renderSection(containerId, title, items, color, today) {
  const container = document.getElementById(containerId);
  if (!container || !items.length) return;

  container.innerHTML = `
    <div style="margin-bottom:28px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;
        color:${color};margin-bottom:8px;">
        ${esc(title)} (${items.length})
      </div>
      <div id="${containerId}-rows"></div>
    </div>`;

  const rowsEl = document.getElementById(`${containerId}-rows`);
  items.forEach(task => {
    const row = buildTaskRow(task, today);
    rowsEl.appendChild(row);
  });
}

function buildTaskRow(t, today) {
  const isOverdue = !t.done && t.due_date && t.due_date < today;

  const div = document.createElement('div');
  div.style.cssText = `display:flex;align-items:flex-start;gap:12px;padding:10px 0;
    border-bottom:1px solid var(--border);opacity:${t.done ? .5 : 1};`;

  div.innerHTML = `
    <input type="checkbox" ${t.done ? 'checked' : ''}
      style="cursor:pointer;width:18px;height:18px;flex-shrink:0;margin-top:2px;accent-color:var(--green);" />
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:500;
        text-decoration:${t.done ? 'line-through' : 'none'};
        color:${isOverdue ? '#e74c3c' : 'inherit'};">
        ${esc(t.label || '')}
      </div>
      <div style="display:flex;gap:10px;margin-top:3px;flex-wrap:wrap;align-items:center;">
        ${t.investor_name
          ? `<button class="inv-link" data-inv-id="${esc(String(t.investor_id || ''))}"
              style="background:none;border:none;padding:0;cursor:pointer;font-size:12px;
                color:var(--blue);min-height:0;">
              ${esc(t.investor_name)}
            </button>` : ''}
        ${t.responsible
          ? `<span style="font-size:11px;color:var(--muted);">👤 ${esc(t.responsible)}</span>` : ''}
      </div>
    </div>
    <span style="font-size:11px;white-space:nowrap;flex-shrink:0;
      color:${isOverdue ? '#e74c3c' : 'var(--muted)'};
      font-weight:${isOverdue ? 600 : 400};">
      ${esc(t.due_date || '')}${isOverdue ? ' · forfalt' : ''}
    </span>
    <button class="btn-edit-task" title="Rediger"
      style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:14px;
        padding:0 4px;opacity:.5;flex-shrink:0;min-height:36px;min-width:28px;">✎</button>
    <button class="btn-del-task" title="Slett"
      style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:14px;
        padding:0 4px;opacity:.5;flex-shrink:0;min-height:36px;min-width:28px;">✕</button>`;

  // Checkbox toggle
  div.querySelector('input[type="checkbox"]').addEventListener('change', async () => {
    try {
      await api.updateTask(t._id, { done: t.done ? 0 : 1 });
      await loadTasks();
    } catch (e) {
      window.ui.toast('Feil: ' + e.message, 'error');
    }
  });

  // Investor link
  const invLink = div.querySelector('.inv-link');
  if (invLink) {
    invLink.addEventListener('click', () => window.navigate('detalj', invLink.dataset.invId));
  }

  // Edit
  div.querySelector('.btn-edit-task').addEventListener('click', () => openEditTaskModal(t));

  // Delete
  div.querySelector('.btn-del-task').addEventListener('click', async () => {
    if (!window.confirm('Slette oppgaven?')) return;
    try {
      await api.deleteTask(t._id);
      await loadTasks();
    } catch (e) {
      window.ui.toast('Feil: ' + e.message, 'error');
    }
  });

  // Hover opacity
  const hoverBtns = div.querySelectorAll('.btn-edit-task, .btn-del-task');
  hoverBtns.forEach(btn => {
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '.5'; });
  });

  return div;
}

// ── New task modal ────────────────────────────────────────────────────────────
function openNewTaskModal() {
  const today       = new Date().toISOString().slice(0, 10);
  const defaultLead = _state?.currentUser?.displayName || 'Kristian Bartnes';
  const leads       = _lookups?.leads || ['Kristian Bartnes', 'Anders Brustad-Nilsen', 'Nikolai Staubo'];

  const html = `
    <div class="modal-header">
      <h3>Ny oppgave</h3>
      <button class="btn-close" onclick="window.closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div id="task-err" class="alert-err" style="display:none;margin-bottom:12px;"></div>
      <div class="form-grid">
        <div class="form-group full">
          <label>Oppgave *</label>
          <input id="t-label" placeholder='F.eks. "Følg opp Peter etter Stockholm"' />
        </div>
        <div class="form-group">
          <label>Frist</label>
          <input id="t-due" type="date" value="${today}" />
        </div>
        <div class="form-group">
          <label>Ansvarlig</label>
          <select id="t-resp">
            ${leads.map(l =>
              `<option${l === defaultLead ? ' selected' : ''}>${esc(l)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group full" style="position:relative;">
          <label>Investor (valgfritt)</label>
          <input id="t-inv-search" placeholder="Søk investor…" autocomplete="off" />
          <div id="t-inv-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;
            background:var(--card);border:1px solid var(--border);border-radius:7px;z-index:10;
            max-height:180px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,.15);"></div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-primary" id="btn-save-task">Legg til</button>
    </div>`;

  window.openModal(html, () => {
    const labelEl  = document.getElementById('t-label');
    const saveBtn  = document.getElementById('btn-save-task');
    let selectedInvId   = '';
    let selectedInvName = '';

    labelEl.focus();

    // Investor autocomplete
    const searchEl   = document.getElementById('t-inv-search');
    const dropdownEl = document.getElementById('t-inv-dropdown');

    function updateDropdown() {
      const q = searchEl.value.toLowerCase().trim();
      if (!q) { dropdownEl.style.display = 'none'; return; }
      const matches = _investors.filter(i => i.name.toLowerCase().includes(q)).slice(0, 8);
      if (!matches.length) { dropdownEl.style.display = 'none'; return; }
      dropdownEl.innerHTML = matches.map(i =>
        `<div class="inv-option" data-id="${esc(String(i.id))}" data-name="${esc(i.name)}"
          style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);">
          ${esc(i.name)}
        </div>`
      ).join('');
      dropdownEl.style.display = '';
      dropdownEl.querySelectorAll('.inv-option').forEach(opt => {
        opt.addEventListener('mousedown', e => {
          e.preventDefault();   // prevent blur before click
          selectedInvId   = opt.dataset.id;
          selectedInvName = opt.dataset.name;
          searchEl.value  = opt.dataset.name;
          dropdownEl.style.display = 'none';
        });
        opt.addEventListener('mouseenter', () => { opt.style.background = 'var(--offwhite)'; });
        opt.addEventListener('mouseleave', () => { opt.style.background = ''; });
      });
    }

    searchEl.addEventListener('input', () => {
      selectedInvId   = '';
      selectedInvName = '';
      updateDropdown();
    });
    searchEl.addEventListener('focus', updateDropdown);
    searchEl.addEventListener('blur',  () => setTimeout(() => { dropdownEl.style.display = 'none'; }, 150));

    // Enter to save
    labelEl.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });

    saveBtn.addEventListener('click', async () => {
      const label   = labelEl.value.trim();
      const due     = document.getElementById('t-due').value;
      const errEl   = document.getElementById('task-err');

      if (!label || !due) {
        errEl.textContent = 'Oppgave og frist er påkrevd.';
        errEl.style.display = '';
        return;
      }

      saveBtn.disabled      = true;
      saveBtn.textContent   = 'Lagrer…';
      errEl.style.display   = 'none';

      try {
        await api.addTask({
          label,
          due_date:      due,
          responsible:   document.getElementById('t-resp').value,
          investor_id:   selectedInvId   || undefined,
          investor_name: selectedInvName || undefined,
          done:          0,
        });
        window.closeModal();
        await loadTasks();
      } catch (e) {
        errEl.textContent   = e.message || 'Lagring feilet.';
        errEl.style.display = '';
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Legg til';
      }
    });
  });
}

// ── Edit task modal ───────────────────────────────────────────────────────────
function openEditTaskModal(task) {
  const leads = _lookups?.leads || ['Kristian Bartnes', 'Anders Brustad-Nilsen', 'Nikolai Staubo'];

  const html = `
    <div class="modal-header">
      <h3>Rediger oppgave</h3>
      <button class="btn-close" onclick="window.closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div id="edit-task-err" class="alert-err" style="display:none;margin-bottom:12px;"></div>
      <div class="form-grid">
        <div class="form-group full">
          <label>Oppgave</label>
          <input id="et-label" value="${esc(task.label || '')}" />
        </div>
        <div class="form-group">
          <label>Frist</label>
          <input id="et-due" type="date" value="${esc(task.due_date || '')}" />
        </div>
        <div class="form-group">
          <label>Ansvarlig</label>
          <select id="et-resp">
            <option value="">—</option>
            ${leads.map(l =>
              `<option${(task.responsible || '') === l ? ' selected' : ''}>${esc(l)}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-primary" id="btn-save-edit-task">Lagre</button>
    </div>`;

  window.openModal(html, () => {
    const labelEl = document.getElementById('et-label');
    labelEl.focus();

    document.getElementById('btn-save-edit-task').addEventListener('click', async () => {
      const saveBtn = document.getElementById('btn-save-edit-task');
      const errEl   = document.getElementById('edit-task-err');
      saveBtn.disabled    = true;
      saveBtn.textContent = 'Lagrer…';
      errEl.style.display = 'none';

      try {
        await api.updateTask(task._id, {
          label:       labelEl.value.trim() || task.label,
          due_date:    document.getElementById('et-due').value   || task.due_date,
          responsible: document.getElementById('et-resp').value  || task.responsible,
        });
        window.closeModal();
        await loadTasks();
      } catch (e) {
        errEl.textContent   = e.message || 'Lagring feilet.';
        errEl.style.display = '';
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Lagre';
      }
    });
  });
}

// ── Util ──────────────────────────────────────────────────────────────────────
function esc(s) {
  return window.escHtml ? window.escHtml(s) : String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
