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

  function buildRows(list) {
    if (!list.length)
      return `<tr><td colspan="5" class="empty-state">Ingen ukvalifiserte leads igjen. 🎉</td></tr>`;
    return list.map(l => `
      <tr data-id="${esc(String(l.id))}">
        <td style="font-weight:600;padding:11px 14px">
          <span class="lead-name" style="color:var(--blue);cursor:pointer">${esc(l.name || '—')}</span>${window.brregBadge(l)}
        </td>
        <td style="color:var(--muted);font-size:13px;padding:11px 14px">${esc(l.investor_type || '—')}</td>
        <td style="color:var(--muted);font-size:13px;padding:11px 14px">${esc(l.city || l.country || '—')}</td>
        <td style="color:var(--muted);font-size:13px;padding:11px 14px">${esc(l.source || '—')}</td>
        <td style="padding:11px 14px">
          <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm lead-qualify" data-id="${esc(String(l.id))}" style="min-height:36px">Kvalifiser</button>
            ${isAdmin ? `<button class="btn btn-ghost btn-sm lead-discard" data-id="${esc(String(l.id))}" data-name="${esc(l.name || '')}" style="min-height:36px;color:#e74c3c">Forkast</button>` : ''}
          </div>
        </td>
      </tr>`).join('');
  }

  el.innerHTML = `
    <div class="topbar"><span class="topbar-title">Ukvalifiserte leads (<span id="lead-count">${leads.length}</span>)</span></div>
    <div class="content">
      <p class="text-muted" style="font-size:13px;margin-bottom:12px">
        Importerte prospekter som ennå ikke er tatt inn i CRM-et. <b>Kvalifiser</b> gjør leadet til en investor i fasen «Prospekt».${isAdmin ? ' <b>Forkast</b> flytter det til papirkurven.' : ''}
      </p>
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

  function removeRow(id) {
    leads = leads.filter(l => String(l.id) !== String(id));
    tbody.innerHTML = buildRows(leads);
    const countEl = el.querySelector('#lead-count');
    if (countEl) countEl.textContent = leads.length;
    bind();
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

  bind();
}
