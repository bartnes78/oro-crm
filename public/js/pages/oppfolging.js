import { api } from '../api.js';

const PHASE_MAP = {
  'Prospekt': 'prospect', 'Aktiv dialog': 'aktivdialog',
  'Investor': 'investor', 'Tidligere investor': 'tidligereinvestor', 'På vent': 'pavent',
};

const PRIORITY_CFG = {
  high:   { label: 'Høy prioritet',    color: '#e74c3c', bg: 'rgba(231,76,60,.06)' },
  medium: { label: 'Medium prioritet', color: '#e07000', bg: 'rgba(224,112,0,.06)' },
  low:    { label: 'Lav prioritet',    color: '#3498db', bg: 'rgba(52,152,219,.06)' },
};

const PROGRESS_STEPS = [
  { key: 'has_contact',     label: 'Kontakt',    short: 'K' },
  { key: 'has_deck',        label: 'Deck',       short: 'D' },
  { key: 'has_meeting',     label: 'Møte',       short: 'M' },
  { key: 'has_im_ppm',      label: 'IM/PPM',     short: 'I' },
  { key: 'has_fondsvilkar', label: 'Fondsvilkår', short: 'V' },
];

let _el           = null;
let _suggestions  = [];
let _benchmarks   = null;
let _filterPhase  = '';
let _filterLead   = '';

export async function render(el, _state) {
  _el           = el;
  _filterPhase  = '';
  _filterLead   = '';

  _el.innerHTML = `
    <div class="topbar">
      <span class="topbar-title" id="of-title">Oppfølging</span>
      <button class="btn btn-green btn-sm" onclick="window.navigate('logg')">+ Logg kontakt</button>
    </div>
    <div class="content" id="of-content">
      <p style="color:#aaa;padding:24px 0;">Laster…</p>
    </div>`;

  try {
    const [suggestions, benchmarks] = await Promise.all([
      api.playbookSuggestions(),
      api.playbookBenchmarks(),
    ]);
    _suggestions = suggestions;
    _benchmarks  = benchmarks;
    renderContent();
  } catch (e) {
    _el.querySelector('#of-content').innerHTML =
      `<p style="color:red;padding:24px 0">Feil: ${esc(e.message)}</p>`;
  }
}

function renderContent() {
  const filtered = getFiltered();
  const content  = document.getElementById('of-content');
  if (!content) return;

  const titleEl = document.getElementById('of-title');
  if (titleEl) titleEl.textContent = `Oppfølging (${filtered.length} foreslåtte tiltak)`;

  const leads = [...new Set(_suggestions.map(s => s.lead).filter(Boolean))].sort();

  const high   = filtered.filter(s => s.suggestion.priority === 'high');
  const medium = filtered.filter(s => s.suggestion.priority === 'medium');
  const low    = filtered.filter(s => s.suggestion.priority === 'low');

  content.innerHTML = `
    ${renderBenchmarks()}

    <!-- Filters -->
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">
      <select id="of-filter-phase"
        style="font-size:12px;padding:5px 8px;border-radius:7px;min-height:36px;">
        <option value="">Alle faser</option>
        ${['Prospekt', 'Aktiv dialog', 'Investor', 'På vent'].map(p =>
          `<option value="${esc(p)}"${_filterPhase === p ? ' selected' : ''}>${esc(p)}</option>`
        ).join('')}
      </select>
      <select id="of-filter-lead"
        style="font-size:12px;padding:5px 8px;border-radius:7px;min-height:36px;">
        <option value="">Alle ansvarlige</option>
        ${leads.map(l =>
          `<option value="${esc(l)}"${_filterLead === l ? ' selected' : ''}>${esc(l)}</option>`
        ).join('')}
      </select>
      ${(_filterPhase || _filterLead)
        ? `<button class="btn btn-ghost btn-sm" id="of-reset-filters"
            style="min-height:36px;">× Nullstill</button>` : ''}
      <span style="font-size:11px;color:#aaa;margin-left:4px;">
        Basert på salgsprosess og historiske mønstre
      </span>
    </div>

    ${filtered.length === 0
      ? `<div class="card" style="text-align:center;padding:48px;color:#888;">
          <div style="font-size:32px;margin-bottom:12px;">✓</div>
          <p style="font-weight:600;margin:0 0 4px;">Ingen foreslåtte tiltak</p>
          <p style="font-size:13px;margin:0;">Alle investorer er på riktig spor i salgsprosessen.</p>
        </div>`
      : `<div class="card" style="padding:0;overflow:hidden;">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Investor</th>
                  <th>Fase</th>
                  <th>Neste steg</th>
                  <th>Fremgang</th>
                  <th>Ansvarlig</th>
                  <th class="text-right">Ticket (M)</th>
                  <th>Sist kontaktet</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${renderGroup(high, 'high')}
                ${renderGroup(medium, 'medium')}
                ${renderGroup(low, 'low')}
              </tbody>
            </table>
          </div>
        </div>`}`;

  // Event listeners
  document.getElementById('of-filter-phase')?.addEventListener('change', e => {
    _filterPhase = e.target.value;
    renderContent();
  });
  document.getElementById('of-filter-lead')?.addEventListener('change', e => {
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

  content.querySelectorAll('.of-row').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('.btn-logg')) return;
      window.navigate('detalj', tr.dataset.invId);
    });
  });
  content.querySelectorAll('.btn-logg').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      window.navigate('logg');
    });
  });
}

function getFiltered() {
  return _suggestions.filter(s => {
    if (_filterPhase && s.phase !== _filterPhase) return false;
    if (_filterLead  && s.lead  !== _filterLead)  return false;
    return true;
  });
}

// ── Benchmarks panel ─────────────────────────────────────────────────────────
function renderBenchmarks() {
  if (!_benchmarks?.converted || _benchmarks.converted.count === 0) return '';
  const c = _benchmarks.converted;
  const p = _benchmarks.pipeline;

  return `
    <div class="card" style="margin-bottom:16px;padding:16px 20px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);margin-bottom:10px;">
        Konverteringsmønstre — basert på ${c.count} investorer som har tegnet
      </div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-end;">
        <div>
          <div style="font-size:22px;font-weight:700;color:var(--text);">${c.avgActivities}</div>
          <div style="font-size:11px;color:var(--muted);">Snitt aktiviteter</div>
        </div>
        ${c.avgDaysToConvert != null ? `
        <div>
          <div style="font-size:22px;font-weight:700;color:var(--text);">${c.avgDaysToConvert} <span style="font-size:13px;font-weight:400;">dager</span></div>
          <div style="font-size:11px;color:var(--muted);">Snitt prosessvarighet</div>
        </div>` : ''}
        <div>
          <div style="font-size:22px;font-weight:700;color:var(--text);">${p.count}</div>
          <div style="font-size:11px;color:var(--muted);">I pipeline (${p.avgActivities} snitt akt.)</div>
        </div>
        ${c.docCompletion ? `
        <div style="display:flex;gap:12px;align-items:flex-end;margin-left:8px;">
          ${docBar('Deck', c.docCompletion.deck)}
          ${docBar('IM', c.docCompletion.im_ppm)}
          ${docBar('Vilkår', c.docCompletion.fondsvilkar)}
          ${docBar('NDA', c.docCompletion.nda)}
        </div>` : ''}
      </div>
    </div>`;
}

function docBar(label, pct) {
  const h = Math.max(pct * 0.4, 4);
  return `
    <div style="text-align:center;">
      <div style="width:28px;height:40px;background:var(--border);border-radius:4px;position:relative;overflow:hidden;">
        <div style="position:absolute;bottom:0;width:100%;height:${h}px;background:var(--color-signed);border-radius:0 0 4px 4px;"></div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px;">${esc(label)}</div>
      <div style="font-size:10px;font-weight:600;">${pct}%</div>
    </div>`;
}

// ── Priority group rendering ─────────────────────────────────────────────────
function renderGroup(items, priority) {
  if (!items.length) return '';
  const cfg    = PRIORITY_CFG[priority];
  const plural = items.length !== 1 ? 'er' : '';
  return `
    <tr>
      <td colspan="8" style="background:${cfg.bg};padding:8px 14px;font-size:11px;font-weight:700;
        text-transform:uppercase;letter-spacing:.7px;color:${cfg.color};border-top:2px solid var(--border);">
        ${esc(cfg.label)} — ${items.length} investor${plural}
      </td>
    </tr>
    ${items.map(s => suggestionRow(s)).join('')}`;
}

function suggestionRow(s) {
  const phaseClass   = PHASE_MAP[s.phase] || 'default';
  const contactColor = s.days_since_contact >= 90 ? '#e74c3c'
    : s.days_since_contact >= 60 ? '#e07000'
    : s.days_since_contact >= 30 ? '#D4AC0D' : 'var(--muted)';
  const contactText = s.last_contact
    ? `${s.days_since_contact}d siden`
    : 'Aldri';
  const ticket = s.target_ticket
    ? `${Number(s.target_ticket).toLocaleString('nb-NO')} M` : '—';
  const priColor = PRIORITY_CFG[s.suggestion.priority]?.color || 'var(--muted)';

  const dots = PROGRESS_STEPS.map(step => {
    const done = s.progress[step.key];
    return `<span title="${esc(step.label)}"
      style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;
        border-radius:50%;font-size:9px;font-weight:700;
        background:${done ? 'rgba(26,138,106,.15)' : 'var(--border)'};
        color:${done ? 'var(--color-signed)' : 'var(--muted)'};">${esc(step.short)}</span>`;
  }).join('');

  return `<tr class="of-row" data-inv-id="${esc(String(s.investor_id))}" style="cursor:pointer;">
    <td style="font-weight:600;color:var(--blue);">${esc(s.investor_name || '')}</td>
    <td>
      <span class="badge badge-${phaseClass}" style="font-size:10px;">${esc(s.phase || '')}</span>
    </td>
    <td>
      <div style="font-size:12px;font-weight:600;color:${priColor};">${esc(s.suggestion.action)}</div>
      <div style="font-size:11px;color:var(--muted);">${esc(s.suggestion.detail)}</div>
    </td>
    <td>
      <div style="display:flex;gap:3px;">${dots}</div>
    </td>
    <td style="font-size:12px;color:var(--muted);">${esc(s.lead || '—')}</td>
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
function esc(s) {
  return window.escHtml ? window.escHtml(s) : String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
