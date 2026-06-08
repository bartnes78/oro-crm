import { api } from '../api.js';

const PHASES = ['Prospekt', 'Aktiv dialog', 'Investor', 'Tidligere investor', 'På vent'];

const PHASE_COLORS = {
  'Prospekt':           '#1A5276',
  'Aktiv dialog':       '#2155A3',
  'Investor':           'var(--color-signed)',
  'Tidligere investor': '#1A5C1A',
  'På vent':            '#9A6A1E',
};

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function lastContactLabel(dateStr) {
  const d = daysSince(dateStr);
  if (d === null) return { text: 'Ikke kontaktet', color: '#e74c3c' };
  if (d === 0)   return { text: 'I dag', color: 'var(--color-signed)' };
  if (d <= 7)    return { text: `${d}d siden`, color: 'var(--color-signed)' };
  if (d <= 30)   return { text: `${d}d siden`, color: '#e67e22' };
  return { text: `${d}d siden`, color: '#e74c3c' };
}

function buildCard(inv) {
  const lc = lastContactLabel(inv.last_contact);
  return `
    <div class="kanban-card" data-id="${window.escHtml(inv.id)}"
      style="background:var(--card);border:1px solid var(--border);border-radius:10px;
             padding:12px 14px;margin-bottom:10px;cursor:pointer;
             transition:box-shadow .15s,border-color .15s">
      <div style="font-weight:600;font-size:13px;color:var(--text);margin-bottom:8px;
                  line-height:1.3">${window.escHtml(inv.name)}</div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${inv.investor_type ? `
          <span style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px">
            🏷 ${window.escHtml(inv.investor_type)}
          </span>` : ''}
        ${inv.lead ? `
          <span style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px">
            👤 ${window.escHtml(inv.lead)}
          </span>` : ''}
        <span style="font-size:11px;color:${lc.color};display:flex;align-items:center;gap:4px">
          📅 ${window.escHtml(lc.text)}
        </span>
      </div>
    </div>`;
}

function buildColumn(phase, investors) {
  const color = PHASE_COLORS[phase] || '#888';
  const cards = investors.filter(i => (i.phase || 'Prospekt') === phase);
  return `
    <div style="flex-shrink:0;width:230px;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;
                  padding-bottom:10px;border-bottom:3px solid ${color}">
        <span style="font-weight:700;font-size:13px;color:var(--text)">${window.escHtml(phase)}</span>
        <span style="font-size:11px;color:var(--muted);background:var(--bg);
                     padding:2px 8px;border-radius:10px;font-weight:600">${cards.length}</span>
      </div>
      <div style="flex:1;overflow-y:auto;padding-right:2px;
                  max-height:calc(100vh - 160px)">
        ${cards.length === 0
          ? `<p style="font-size:12px;color:var(--muted);text-align:center;padding:24px 0">—</p>`
          : cards.map(buildCard).join('')}
      </div>
    </div>`;
}

export async function render(el, state) {
  el.innerHTML = `
    <div class="topbar"><span class="topbar-title">Pipeline Kanban</span></div>
    <div class="content"><p class="text-muted" style="padding:8px 0">Laster…</p></div>`;

  let investors;
  try {
    investors = await api.investors();
  } catch (e) {
    el.querySelector('.content').innerHTML =
      `<p style="color:red">Feil: ${window.escHtml(e.message)}</p>`;
    return;
  }

  el.innerHTML = `
    <div class="topbar">
      <span class="topbar-title">Pipeline Kanban</span>
      <span style="font-size:12px;color:var(--muted);margin-left:8px">${investors.length} investorer</span>
    </div>
    <div class="content" style="padding-right:0;overflow:hidden">
      <div style="display:flex;gap:16px;overflow-x:auto;padding-bottom:24px;
                  padding-right:24px;min-height:calc(100vh - 130px)">
        ${PHASES.map(p => buildColumn(p, investors)).join('')}
      </div>
    </div>`;

  el.querySelectorAll('.kanban-card').forEach(card => {
    card.addEventListener('click', () => window.navigate('detalj', card.dataset.id));
    card.addEventListener('mouseenter', () => {
      card.style.boxShadow   = '0 4px 14px rgba(0,0,0,.14)';
      card.style.borderColor = 'var(--blue)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.boxShadow   = '';
      card.style.borderColor = 'var(--border)';
    });
  });
}
