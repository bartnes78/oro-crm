import { api } from '../api.js';

const ENTITY_LABELS = {
  investor: 'Investor', contact: 'Kontakt', log: 'Loggføring',
  task: 'Oppgave', user: 'Bruker', backup: 'Backup',
};

const ACTION_LABELS = {
  create: 'Opprettet', update: 'Oppdatert', delete: 'Slettet',
  merge: 'Slått sammen', restore: 'Gjenopprettet',
};

const ACTION_COLORS = {
  create: 'var(--color-signed)', update: 'var(--accent)',
  delete: '#e74c3c', merge: '#8e44ad', restore: '#e67e22',
};

function fmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('nb-NO') + ' ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted" style="padding:24px">Laster…</p></div>';

  let rows = [];
  let entityFilter = '';

  async function load() {
    try {
      const params = {};
      if (entityFilter) params.entity_type = entityFilter;
      params.limit = 300;
      rows = await api.auditLog(params);
      buildPage();
    } catch (e) {
      el.innerHTML = `<div class="topbar"><span class="topbar-title">Audit-logg</span></div>
        <div class="content"><p style="color:red">Feil: ${window.escHtml(e.message)}</p></div>`;
    }
  }

  function buildPage() {
    const filterOptions = ['', 'investor', 'contact', 'log', 'task', 'user', 'backup']
      .map(v => `<option value="${v}" ${v === entityFilter ? 'selected' : ''}>${v ? (ENTITY_LABELS[v] || v) : 'Alle typer'}</option>`)
      .join('');

    const tableRows = rows.map(r => {
      const actionColor = ACTION_COLORS[r.action] || 'var(--muted)';
      const actionLabel = ACTION_LABELS[r.action] || r.action;
      const entityLabel = ENTITY_LABELS[r.entity_type] || r.entity_type;
      return `
        <tr>
          <td style="padding:8px 12px;font-size:12px;color:var(--muted);white-space:nowrap">${window.escHtml(fmtTime(r.created_at))}</td>
          <td style="padding:8px 12px;font-size:13px">${window.escHtml(r.username || '—')}</td>
          <td style="padding:8px 12px">
            <span style="font-size:12px;font-weight:600;color:${actionColor}">${window.escHtml(actionLabel)}</span>
          </td>
          <td style="padding:8px 12px;font-size:12px;color:var(--muted)">${window.escHtml(entityLabel)}</td>
          <td style="padding:8px 12px;font-size:12px;color:var(--muted)">${window.escHtml(r.entity_id || '—')}</td>
          <td style="padding:8px 12px;font-size:13px;max-width:320px">${window.escHtml(r.description || '—')}</td>
        </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="topbar">
        <span class="topbar-title">Audit-logg</span>
      </div>
      <div class="content">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
          <label style="font-size:13px;color:var(--muted)">Filtrer type:</label>
          <select id="entity-filter" style="font-size:13px;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text)">
            ${filterOptions}
          </select>
          <span style="font-size:12px;color:var(--muted);margin-left:auto">${rows.length} oppføringer</span>
        </div>

        ${rows.length === 0
          ? window.ui.emptyState('Ingen audit-hendelser funnet')
          : `<div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                  <tr style="border-bottom:2px solid var(--border);text-align:left">
                    <th style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--muted)">Tidspunkt</th>
                    <th style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--muted)">Bruker</th>
                    <th style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--muted)">Handling</th>
                    <th style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--muted)">Type</th>
                    <th style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--muted)">ID</th>
                    <th style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--muted)">Beskrivelse</th>
                  </tr>
                </thead>
                <tbody>${tableRows}</tbody>
              </table>
            </div>`
        }
      </div>`;

    document.getElementById('entity-filter')?.addEventListener('change', e => {
      entityFilter = e.target.value;
      load();
    });
  }

  await load();
}
