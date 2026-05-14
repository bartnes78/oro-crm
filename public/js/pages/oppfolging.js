import { api } from '../api.js';

const PHASE_MAP = {
  'Prospekt': 'prospect', 'Ny kontakt': 'nykontakt', 'Intro sendt': 'introsendt',
  'Møte avtalt': 'moteavtalt', 'Aktiv dialog': 'aktivdialog',
  'Tegnet': 'tegnet', 'Ikke relevant nå': 'ikkerelevan', 'Onboardet': 'onboardet',
};
const ACTIVE_PHASES = ['Prospekt', 'Ny kontakt', 'Intro sendt', 'Møte avtalt', 'Aktiv dialog'];

// ── Module state ──────────────────────────────────────────────────────────────
let _el          = null;
let _investors   = [];
let _loading     = true;
let _filterPhase = '';
let _filterLead  = '';

// ── Entry ─────────────────────────────────────────────────────────────────────
export async function render(el, _state) {
  _el          = el;
  _loading     = true;
  _filterPhase = '';
  _filterLead  = '';

  _el.innerHTML = `
    <div class="topbar">
      <span class="topbar-title" id="of-title">Oppfølging</span>
      <button class="btn btn-green btn-sm" onclick="window.navigate('logg')">+ Logg kontakt</button>
    </div>
    <div class="content" id="of-content">
      <p style="color:#aaa;padding:24px 0;">Laster…</p>
    </div>`;

  _investors = await api.investors({});
  _loading   = false;
  renderContent();
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderContent() {
  const stale = getStale();

  // Update topbar title with count
  const titleEl = document.getElementById('of-title');
  if (titleEl) titleEl.textContent = `Oppfølging (${stale.length} aktive ikke fulgt opp)`;

  const leads  = [...new Set(_investors.map(i => i.lead).filter(Boolean))].sort();
  const content = document.getElementById('of-content');
  if (!content) return;

  const g90 = stale.filter(i => i.days >= 90);
  const g60 = stale.filter(i => i.days >= 60 && i.days < 90);
  const g30 = stale.filter(i => i.days >= 30 && i.days < 60);

  content.innerHTML = `
    <!-- Filters -->
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">
      <select id="of-filter-phase"
        style="font-size:12px;padding:5px 8px;border-radius:7px;min-height:36px;">
        <option value="">Alle faser</option>
        ${ACTIVE_PHASES.map(p =>
          `<option value="${esc(p)}"${_filterPhase === p ? ' selected' : ''}>${esc(p)}</option>`
        ).join('')}
      </select>
      <select id="of-filter-lead"
        style="font-size:12px;padding:5px 8px;border-radius:7px;min-height:36px;">
        <option value="">ORO Kontakt</option>
        ${leads.map(l =>
          `<option value="${esc(l)}"${_filterLead === l ? ' selected' : ''}>${esc(l)}</option>`
        ).join('')}
      </select>
      ${(_filterPhase || _filterLead)
        ? `<button class="btn btn-ghost btn-sm" id="of-reset-filters"
            style="min-height:36px;">× Nullstill</button>` : ''}
      <span style="font-size:11px;color:#aaa;margin-left:4px;">
        Aktive investorer ikke kontaktet på 30+ dager
      </span>
    </div>

    <!-- Results -->
    <div id="of-results">
      ${stale.length === 0
        ? `<div class="card" style="text-align:center;padding:48px;color:#888;">
            <div style="font-size:32px;margin-bottom:12px;">✓</div>
            <p style="font-weight:600;margin:0 0 4px;">Alle aktive investorer er fulgt opp</p>
            <p style="font-size:13px;margin:0;">Ingen investorer har gått 30+ dager uten kontakt.</p>
          </div>`
        : `<div class="card" style="padding:0;overflow:hidden;">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Investor</th>
                    <th>Type</th>
                    <th>Fase</th>
                    <th>Ansvarlig</th>
                    <th class="text-right">Ticket (M)</th>
                    <th>Sist kontaktet</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${renderGroup('+90 dager', g90, '#e74c3c')}
                  ${renderGroup('+60 dager', g60, '#e07000')}
                  ${renderGroup('+30 dager', g30, '#D4AC0D')}
                </tbody>
              </table>
            </div>
          </div>`}
    </div>`;

  // Filter events
  document.getElementById('of-filter-phase').addEventListener('change', e => {
    _filterPhase = e.target.value;
    renderContent();
  });
  document.getElementById('of-filter-lead').addEventListener('change', e => {
    _filterLead = e.target.value;
    renderContent();
  });
  const resetBtn = document.getElementById('of-reset-filters');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      _filterPhase = '';
      _filterLead  = '';
      renderContent();
    });
  }

  // Row click → investor detail
  content.querySelectorAll('.of-row').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('.btn-logg')) return;
      window.navigate('detalj', tr.dataset.invId);
    });
  });

  // Logg buttons
  content.querySelectorAll('.btn-logg').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      window.navigate('logg');
    });
  });
}

function getStale() {
  return _investors
    .filter(i => ACTIVE_PHASES.includes(i.phase))
    .filter(i => !_filterLead  || i.lead  === _filterLead)
    .filter(i => !_filterPhase || i.phase === _filterPhase)
    .map(i => ({ ...i, days: daysSince(i.last_contact) }))
    .filter(i => i.days >= 30)
    .sort((a, b) => b.days - a.days);
}

function renderGroup(title, items, color) {
  if (!items.length) return '';
  const plural = items.length !== 1 ? 'er' : '';
  return `
    <tr>
      <td colspan="7" style="background:#f8f9fa;padding:8px 14px;font-size:11px;font-weight:700;
        text-transform:uppercase;letter-spacing:.7px;color:${color};border-top:2px solid var(--border);">
        ${esc(title)} — ${items.length} investor${plural}
      </td>
    </tr>
    ${items.map(inv => staleRow(inv, color)).join('')}`;
}

function staleRow(inv, groupColor) {
  const phaseClass    = PHASE_MAP[inv.phase] || 'default';
  const contactColor  = inv.days >= 90 ? '#e74c3c' : inv.days >= 60 ? '#e07000' : '#D4AC0D';
  const contactText   = inv.last_contact ? `${inv.days} dager siden` : 'Aldri kontaktet';
  const ticket        = inv.target_ticket
    ? `${Number(inv.target_ticket).toLocaleString('nb-NO')} M` : '—';

  return `<tr class="of-row" data-inv-id="${esc(String(inv.id))}" style="cursor:pointer;">
    <td style="font-weight:600;color:var(--blue);">${esc(inv.name || '')}</td>
    <td style="font-size:12px;color:var(--muted);">${esc(inv.investor_type || '—')}</td>
    <td>
      <span class="badge badge-${phaseClass}" style="font-size:10px;">${esc(inv.phase || '')}</span>
    </td>
    <td style="font-size:12px;color:var(--muted);">${esc(inv.lead || '—')}</td>
    <td class="text-right" style="font-size:12px;color:var(--muted);">${esc(ticket)}</td>
    <td style="font-weight:600;font-size:12px;color:${contactColor};white-space:nowrap;">
      ${esc(contactText)}
    </td>
    <td>
      <button class="btn btn-ghost btn-sm btn-logg" style="font-size:11px;min-height:36px;">
        + Logg
      </button>
    </td>
  </tr>`;
}

// ── Util ──────────────────────────────────────────────────────────────────────
function daysSince(dateStr) {
  if (!dateStr) return 9999;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function esc(s) {
  return window.escHtml ? window.escHtml(s) : String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
