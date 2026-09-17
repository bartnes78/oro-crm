import { api } from '../api.js';

const esc = window.escHtml;

export async function render(el, state) {
  const isAdmin = state?.currentUser?.role === 'admin';
  el.innerHTML = '<div class="content"><p class="text-muted">Laster…</p></div>';

  let leads;
  try {
    const raw = await api.investors({ leads: 1 });
    leads = Array.isArray(raw) ? raw : (raw.investors || []);
  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:#c0392b">Feil: ${esc(e.message)}</p></div>`;
    return;
  }

  // Distinkte tagger på tvers av leadene — bygger filter-alternativene.
  const allTags = [...new Set(leads.flatMap(l => l.tags || []))].sort((a, b) => a.localeCompare(b, 'nb'));
  let tagFilter = '';

  function visible() {
    return tagFilter ? leads.filter(l => (l.tags || []).includes(tagFilter)) : leads;
  }

  function kildeCell(l) {
    const tags = l.tags || [];
    if (!tags.length) return `<span style="color:var(--muted);font-size:13px">${esc(l.source || '—')}</span>`;
    return `<div style="display:flex;flex-wrap:wrap;gap:3px">${tags.map(t =>
      `<span style="display:inline-block;padding:2px 9px;border-radius:20px;background:rgba(52,152,219,.1);color:var(--blue);font-size:11px;font-weight:600">${esc(t)}</span>`
    ).join('')}</div>`;
  }

  function buildRows(list) {
    if (!list.length)
      return `<tr><td colspan="5" class="empty-state">${tagFilter ? 'Ingen leads med denne taggen.' : 'Ingen ukvalifiserte leads igjen. 🎉'}</td></tr>`;
    return list.map(l => `
      <tr data-id="${esc(String(l.id))}">
        <td style="font-weight:600;padding:11px 14px">
          <span class="lead-name" style="color:var(--blue);cursor:pointer">${esc(l.name || '—')}</span>${window.brregBadge(l)}
        </td>
        <td style="color:var(--muted);font-size:13px;padding:11px 14px">${esc(l.investor_type || '—')}</td>
        <td style="color:var(--muted);font-size:13px;padding:11px 14px">${esc(l.city || l.country || '—')}</td>
        <td style="padding:11px 14px">${kildeCell(l)}</td>
        <td style="padding:11px 14px">
          <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm lead-qualify" data-id="${esc(String(l.id))}" style="min-height:36px">Kvalifiser</button>
            ${isAdmin ? `<button class="btn btn-ghost btn-sm lead-discard" data-id="${esc(String(l.id))}" data-name="${esc(l.name || '')}" style="min-height:36px;color:#e74c3c">Forkast</button>` : ''}
          </div>
        </td>
      </tr>`).join('');
  }

  const filterBar = allTags.length ? `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <label style="font-size:12px;color:var(--muted)">Kilde/tag:</label>
      <select id="lead-tag-filter" style="font-size:12px;padding:5px 8px;border-radius:7px;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;min-height:36px">
        <option value="">Alle kilder</option>
        ${allTags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
      </select>
    </div>` : '';

  el.innerHTML = `
    <div class="topbar"><span class="topbar-title">Ukvalifiserte leads (<span id="lead-count">${leads.length}</span>)</span></div>
    <div class="content">
      <p class="text-muted" style="font-size:13px;margin-bottom:12px">
        Importerte prospekter som ennå ikke er tatt inn i CRM-et. <b>Kvalifiser</b> gjør leadet til en investor i fasen «Prospekt».${isAdmin ? ' <b>Forkast</b> flytter det til papirkurven.' : ''}
      </p>
      ${filterBar}
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Navn</th><th>Type</th><th>Sted</th><th>Kilde</th><th style="width:180px"></th></tr></thead>
            <tbody class="lead-tbody">${buildRows(leads)}</tbody>
          </table>
        </div>
      </div>
    </div>`;

  const tbody = el.querySelector('.lead-tbody');

  function refresh() {
    tbody.innerHTML = buildRows(visible());
    const countEl = el.querySelector('#lead-count');
    if (countEl) countEl.textContent = visible().length;
    bind();
  }

  function removeRow(id) {
    leads = leads.filter(l => String(l.id) !== String(id));
    refresh();
  }

  function bind() {
    tbody.querySelectorAll('.lead-name').forEach(n => {
      n.addEventListener('click', () => window.navigate('detalj', n.closest('tr').dataset.id));
    });

    tbody.querySelectorAll('.lead-qualify').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Kvalifiserer…';
        try {
          const inv = await api.qualifyLead(btn.dataset.id);
          window.ui.toast(`${inv.name} er nå investor (Prospekt)`, 'success');
          removeRow(btn.dataset.id);
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Kvalifiser';
          window.ui.toast('Kunne ikke kvalifisere: ' + e.message, 'error');
        }
      });
    });

    tbody.querySelectorAll('.lead-discard').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name || 'dette leadet';
        if (!window.confirm(`Forkaste ${name}?\n\nLeadet flyttes til papirkurven.`)) return;
        btn.disabled = true;
        try {
          await api.deleteInvestor(btn.dataset.id);
          window.ui.toast('Lead forkastet', 'info');
          removeRow(btn.dataset.id);
        } catch (e) {
          btn.disabled = false;
          window.ui.toast('Kunne ikke forkaste: ' + e.message, 'error');
        }
      });
    });
  }

  const tagSelect = el.querySelector('#lead-tag-filter');
  if (tagSelect) {
    tagSelect.addEventListener('change', () => { tagFilter = tagSelect.value; refresh(); });
  }

  bind();
}
