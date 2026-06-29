import { api } from '../api.js';

function fmtDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString('nb-NO'); } catch { return ts; }
}

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted" style="padding:24px">Laster…</p></div>';

  let investors = [];
  let restoring = null;

  async function load() {
    try {
      investors = await api.deletedInvestors();
      buildPage();
    } catch (e) {
      el.innerHTML = `<div class="topbar"><span class="topbar-title">Papirkurv</span></div>
        <div class="content"><p style="color:red">Feil: ${window.escHtml(e.message)}</p></div>`;
    }
  }

  function buildPage() {
    const rows = investors.map(inv => {
      const isRestoring = restoring === inv.id;
      return `
        <tr style="border-bottom:1px solid var(--border)">
          <td style="padding:10px 14px">
            <div style="font-weight:600;font-size:13px">${window.escHtml(inv.name)}</div>
            <div style="font-size:11px;color:var(--muted)">${window.escHtml(inv.id)}</div>
          </td>
          <td style="padding:10px 14px;font-size:13px">${window.phaseBadge(inv.phase)}</td>
          <td style="padding:10px 14px;font-size:13px;color:var(--muted)">${window.escHtml(inv.lead || '—')}</td>
          <td style="padding:10px 14px;font-size:12px;color:var(--muted)">${fmtDate(inv.deleted_at)}</td>
          <td style="padding:10px 14px;font-size:12px;color:var(--muted)">${inv.contact_count ?? 0} kontakter</td>
          <td style="padding:10px 14px;text-align:right">
            <button class="btn btn-ghost btn-sm restore-btn"
              data-id="${window.escHtml(inv.id)}"
              data-name="${window.escHtml(inv.name)}"
              ${isRestoring ? 'disabled' : ''}
              style="min-height:36px">
              ${isRestoring ? 'Gjenoppretter…' : '↩ Gjenopprett'}
            </button>
          </td>
        </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="topbar">
        <span class="topbar-title">Papirkurv</span>
      </div>
      <div class="content">
        <div class="card">
          <div class="card-title">Slettede investorer</div>
          <p style="font-size:13px;color:var(--muted);margin-bottom:20px">
            Investorer som er slettet kan gjenopprettes her. Kontakter, logg og oppgaver er bevart.
          </p>

          ${investors.length === 0
            ? window.ui.emptyState('Papirkurven er tom')
            : `<table style="width:100%;border-collapse:collapse">
                <thead>
                  <tr style="border-bottom:2px solid var(--border);text-align:left">
                    <th style="padding:8px 14px;font-size:11px;font-weight:600;color:var(--muted)">Investor</th>
                    <th style="padding:8px 14px;font-size:11px;font-weight:600;color:var(--muted)">Fase</th>
                    <th style="padding:8px 14px;font-size:11px;font-weight:600;color:var(--muted)">Lead</th>
                    <th style="padding:8px 14px;font-size:11px;font-weight:600;color:var(--muted)">Slettet</th>
                    <th style="padding:8px 14px;font-size:11px;font-weight:600;color:var(--muted)">Data</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>`
          }
        </div>
      </div>`;

    el.querySelectorAll('.restore-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id   = btn.dataset.id;
        const name = btn.dataset.name;
        if (!confirm(`Gjenopprette ${name}?`)) return;
        restoring = id;
        buildPage();
        try {
          await api.restoreInvestor(id);
          investors = investors.filter(i => i.id !== id);
          restoring = null;
          buildPage();
        } catch (e) {
          restoring = null;
          buildPage();
          window.ui.toast('Feil: ' + e.message, 'error');
        }
      });
    });
  }

  await load();
}
