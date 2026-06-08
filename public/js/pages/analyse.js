import { api } from '../api.js';

function esc(s) { return window.escHtml(s); }
function fmt(n, dec = 0) { return window.fmt(n, dec); }

// ── SVG sparkline ─────────────────────────────────────────────────────────────
function sparkline(values, w = 320, h = 52) {
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * w;
    const y = h - (v / max) * (h - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">
    <polyline points="${pts}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round"/>
    ${values.map((v, i) => {
      const x = (i / (values.length - 1 || 1)) * w;
      const y = h - (v / max) * (h - 8) - 4;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--gold)"/>`;
    }).join('')}
  </svg>`;
}

// ── Fondsstatus ───────────────────────────────────────────────────────────────
const STATUS_STYLE = {
  'Fundraising':  { bg: '#FEF9E7', color: '#9A6A1E', border: '#D4AC0D' },
  'Etablert':     { bg: '#EAFAF1', color: '#1A5C1A', border: 'var(--color-signed)' },
  'Fullført':     { bg: '#F2F3F4', color: '#555',    border: '#AAA' },
  'Avlyst':       { bg: '#FDEDEC', color: '#922B21', border: '#C0392B' },
  'Pipeline':     { bg: '#EBF5FB', color: '#1A5276', border: '#2471A3' },
};

function statusBadge(status) {
  if (!status) return '';
  const s = STATUS_STYLE[status] || { bg: '#F2F3F4', color: '#555', border: '#AAA' };
  return `<span style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:10px;
    background:${s.bg};color:${s.color};border:1px solid ${s.border};margin-left:8px;
    vertical-align:middle;white-space:nowrap">${esc(status)}</span>`;
}

function buildFundStats(fundStats) {
  const active = fundStats
    .filter(f => f.status === 'Fundraising' || f.status === 'Pipeline')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'Fundraising' ? -1 : 1));
  if (!active.length) return `<div class="card" style="margin-bottom:20px">${window.ui.emptyState('Ingen fondsdata')}</div>`;
  const rows = active.map(f => {
    const pct = f.target_size ? Math.min(Math.round(f.signedTicket / f.target_size * 100), 100) : null;
    const pctPipeline = f.target_size ? Math.min(Math.round(f.weighted / f.target_size * 100), 100) : null;
    const dimmed = false;
    return `
      <div style="padding:12px 0;border-bottom:1px solid var(--border);${dimmed ? 'opacity:.55' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
          <div>
            <button class="fund-nav-btn" data-id="${esc(String(f.id))}"
              style="background:none;border:none;padding:0;cursor:pointer;font-weight:600;font-size:14px;color:var(--blue);text-align:left">
              ${esc(f.name)}
            </button>
            ${statusBadge(f.status)}
          </div>
          <span style="font-size:12px;color:var(--muted)">${f.investorCount} investorer</span>
        </div>
        ${f.target_size ? `
        <div style="background:var(--border);border-radius:4px;height:8px;margin-bottom:6px;position:relative;overflow:hidden">
          <div style="position:absolute;left:0;top:0;height:100%;width:${pctPipeline}%;background:rgba(180,140,60,.35);border-radius:4px"></div>
          <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:var(--color-signed);border-radius:4px"></div>
        </div>
        <div style="display:flex;gap:20px;font-size:12px">
          <span style="color:var(--color-signed)"><b>${fmt(f.signedTicket, 0)} MNOK</b> tegnet (${pct}% av mål)</span>
          <span style="color:var(--muted)">Vektet pipeline: ${fmt(f.weighted, 0)} MNOK (${pctPipeline}%)</span>
          <span style="color:var(--muted)">Mål: ${fmt(f.target_size, 0)} MNOK</span>
        </div>
        ` : `
        <div style="font-size:12px;color:var(--muted)">
          Vektet: <b style="color:var(--text)">${fmt(f.weighted, 0)} MNOK</b> &nbsp;·&nbsp;
          Tegnet: <b style="color:var(--color-signed)">${fmt(f.signedTicket, 0)} MNOK</b>
          &nbsp;(${f.signedCount} inv.)
        </div>
        `}
      </div>`;
  }).join('');
  return `
    <div class="card" style="margin-bottom:20px">
      <div class="card-title">Status fond og prosjekt</div>
      ${rows}
    </div>`;
}

// ── Pipeline per fase ─────────────────────────────────────────────────────────
const PHASE_COLORS = {
  'Prospekt':           '#1A5276',
  'Aktiv dialog':       '#2155A3',
  'Investor':           'var(--color-signed)',
  'Tidligere investor': '#1A5C1A',
  'På vent':            '#9A6A1E',
};

function buildPhaseChart(byPhase) {
  const max = Math.max(...byPhase.map(p => p.count), 1);
  const rows = byPhase.map(p => {
    const pct   = Math.round((p.count / max) * 100);
    const color = PHASE_COLORS[p.phase] || '#2471A3';
    return window.ui.pipelineBar(p.phase, pct, color, p.count);
  }).join('');
  return `
    <div class="card" style="margin-bottom:20px">
      <div class="card-title">Pipeline per fase</div>
      ${rows || window.ui.emptyState('Ingen data')}
    </div>`;
}

// ── Investor-type tabell ───────────────────────────────────────────────────────
function buildTypeTable(byType) {
  const rows = byType.map(t => `
    <tr>
      <td>${esc(t.type)}</td>
      <td class="text-right">${t.count}</td>
      <td class="text-right">${fmt(t.ticket, 0)}</td>
    </tr>`).join('');
  return `
    <div class="card" style="margin-bottom:20px">
      <div class="card-title">Investor-type</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Type</th><th class="text-right">Antall</th><th class="text-right">Pipeline (MNOK)</th></tr></thead>
          <tbody>${rows || window.ui.emptyRow('Ingen data', 3)}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Aktivitet ─────────────────────────────────────────────────────────────────
function buildActivity(monthly, byResponsible) {
  // Build last 12 month keys
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  const values = months.map(m => monthly[m] || 0);
  const total = values.reduce((s, v) => s + v, 0);

  const labels = months.map(m => {
    const [y, mo] = m.split('-');
    return new Date(+y, +mo - 1, 1).toLocaleString('nb-NO', { month: 'short' });
  });

  const monthRow = months.map((m, i) => `
    <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0">
      <span style="font-size:11px;color:var(--muted);margin-top:4px">${esc(labels[i])}</span>
    </div>`).join('');

  const respRows = byResponsible.slice(0, 6).map(r => `
    <tr>
      <td>${esc(r.name)}</td>
      <td class="text-right">${r.count}</td>
    </tr>`).join('');

  return `
    <div class="grid-2" style="margin-bottom:20px">
      <div class="card">
        <div class="card-title">Kontaktaktivitet siste 12 måneder
          <span style="font-weight:400;font-size:12px;color:var(--muted);margin-left:8px">${total} totalt</span>
        </div>
        <div style="margin:8px 0">${sparkline(values)}</div>
        <div style="display:flex">${monthRow}</div>
      </div>
      <div class="card">
        <div class="card-title">Aktivitet per ansvarlig</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ORO Kontakt</th><th class="text-right">Aktiviteter</th></tr></thead>
            <tbody>${respRows || window.ui.emptyRow('Ingen data', 2)}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

// ── KPI-rad øverst ────────────────────────────────────────────────────────────
function buildKPIs(fundStats) {
  const totalTicket   = fundStats.reduce((s, f) => s + f.ticket, 0);
  const totalWeighted = fundStats.reduce((s, f) => s + f.weighted, 0);
  const totalSigned   = fundStats.reduce((s, f) => s + f.signedTicket, 0);
  const totalInv      = fundStats.reduce((s, f) => s + f.investorCount, 0);
  return `
    <div class="kpi-grid" style="margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-label">Investorer i pipeline</div>
        <div class="kpi-value">${fmt(totalInv)}</div>
      </div>
      <div class="kpi-card" style="border-top-color:#1A5276">
        <div class="kpi-label">Aggregert ticket</div>
        <div class="kpi-value">${fmt(totalTicket, 0)}</div>
        <div class="kpi-sub">MNOK</div>
      </div>
      <div class="kpi-card" style="border-top-color:#D35400">
        <div class="kpi-label">Vektet volum</div>
        <div class="kpi-value">${fmt(totalWeighted, 0)}</div>
        <div class="kpi-sub">MNOK (ticket × sanns.)</div>
      </div>
      <div class="kpi-card" style="border-top-color:var(--color-signed)">
        <div class="kpi-label">Tegnet</div>
        <div class="kpi-value">${fmt(totalSigned, 0)}</div>
        <div class="kpi-sub">MNOK</div>
      </div>
    </div>`;
}

// ── Aktivitetsfordeling ───────────────────────────────────────────────────────
function buildActivityBreakdown(allRows, logTypes) {
  const responsibles = [...new Set(allRows.map(r => r.responsible).filter(Boolean))].sort();

  function filterRows(period, responsible, logType) {
    const cutoff = period !== 'all'
      ? new Date(Date.now() - parseInt(period) * 86400000)
      : null;
    return allRows.filter(r => {
      if (cutoff && new Date(r.date) < cutoff) return false;
      if (responsible && r.responsible !== responsible) return false;
      if (logType && r.log_type !== logType) return false;
      return true;
    });
  }

  function renderContent(filtered) {
    const typeCounts = {};
    filtered.forEach(r => {
      const t = r.log_type || 'Ukjent';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const entries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const total = filtered.length;
    const max = entries.length ? entries[0][1] : 1;

    const bars = entries.map(([type, count]) => {
      const pct = Math.round((count / max) * 100);
      const pctTotal = total ? Math.round((count / total) * 100) : 0;
      return window.ui.pipelineBar(type, pct, 'var(--gold)', count,
        `<span style="font-size:11px;color:var(--muted);margin-left:6px">${pctTotal}%</span>`);
    }).join('');

    const tableRows = entries.map(([type, count]) => {
      const pctTotal = total ? Math.round((count / total) * 100) : 0;
      return `<tr><td>${esc(type)}</td><td class="text-right">${count}</td><td class="text-right">${pctTotal}%</td></tr>`;
    }).join('');

    return `
      <div>${bars || window.ui.emptyState('Ingen aktiviteter i valgt periode')}</div>
      ${entries.length ? `
      <div class="table-wrap" style="margin-top:16px">
        <table>
          <thead><tr><th>Type</th><th class="text-right">Antall</th><th class="text-right">Andel</th></tr></thead>
          <tbody>${tableRows}</tbody>
          <tfoot><tr><td><b>Totalt</b></td><td class="text-right"><b>${total}</b></td><td class="text-right">100%</td></tr></tfoot>
        </table>
      </div>` : ''}`;
  }

  const periodOpts = [
    ['30', 'Siste 30 dager'], ['90', 'Siste 90 dager'],
    ['365', 'Siste 12 mnd'], ['all', 'Alt'],
  ].map(([v, l]) => `<option value="${v}" ${v === '365' ? 'selected' : ''}>${l}</option>`).join('');

  const respOpts = `<option value="">Alle ansvarlige</option>` +
    responsibles.map(r => `<option>${esc(r)}</option>`).join('');

  const typeOpts = `<option value="">Alle typer</option>` +
    logTypes.map(t => `<option>${esc(t)}</option>`).join('');

  return `
    <div class="card" style="margin-bottom:20px">
      <div class="card-title">Aktivitetsfordeling</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <select id="act-period" style="flex:1;min-width:140px">${periodOpts}</select>
        <select id="act-resp"   style="flex:1;min-width:160px">${respOpts}</select>
        <select id="act-type"   style="flex:1;min-width:140px">${typeOpts}</select>
      </div>
      <div id="act-content">${renderContent(filterRows('365', '', ''))}</div>
    </div>`;
}

function setupActivityListeners(el, allRows) {
  function update() {
    const period     = el.querySelector('#act-period').value;
    const responsible = el.querySelector('#act-resp').value;
    const logType    = el.querySelector('#act-type').value;

    const cutoff = period !== 'all'
      ? new Date(Date.now() - parseInt(period) * 86400000)
      : null;
    const filtered = allRows.filter(r => {
      if (cutoff && new Date(r.date) < cutoff) return false;
      if (responsible && r.responsible !== responsible) return false;
      if (logType && r.log_type !== logType) return false;
      return true;
    });

    const typeCounts = {};
    filtered.forEach(r => {
      const t = r.log_type || 'Ukjent';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const entries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const total = filtered.length;
    const max = entries.length ? entries[0][1] : 1;

    const bars = entries.map(([type, count]) => {
      const pct = Math.round((count / max) * 100);
      const pctTotal = total ? Math.round((count / total) * 100) : 0;
      return window.ui.pipelineBar(type, pct, 'var(--gold)', count,
        `<span style="font-size:11px;color:var(--muted);margin-left:6px">${pctTotal}%</span>`);
    }).join('');

    const tableRows = entries.map(([type, count]) => {
      const pctTotal = total ? Math.round((count / total) * 100) : 0;
      return `<tr><td>${esc(type)}</td><td class="text-right">${count}</td><td class="text-right">${pctTotal}%</td></tr>`;
    }).join('');

    el.querySelector('#act-content').innerHTML = `
      <div>${bars || window.ui.emptyState('Ingen aktiviteter i valgt periode')}</div>
      ${entries.length ? `
      <div class="table-wrap" style="margin-top:16px">
        <table>
          <thead><tr><th>Type</th><th class="text-right">Antall</th><th class="text-right">Andel</th></tr></thead>
          <tbody>${tableRows}</tbody>
          <tfoot><tr><td><b>Totalt</b></td><td class="text-right"><b>${total}</b></td><td class="text-right">100%</td></tr></tfoot>
        </table>
      </div>` : ''}`;
  }

  el.querySelector('#act-period')?.addEventListener('change', update);
  el.querySelector('#act-resp')?.addEventListener('change', update);
  el.querySelector('#act-type')?.addEventListener('change', update);
}

// ── Render entry ──────────────────────────────────────────────────────────────
export async function render(el) {
  el.innerHTML = '<div class="content"><p class="text-muted">Laster analyse…</p></div>';
  try {
    const [data, actRows, lookups] = await Promise.all([
      api.analyse(),
      api.aktivitetslogg(),
      api.lookups(),
    ]);
    el.innerHTML = `
      <div class="topbar"><span class="topbar-title">Analyse</span></div>
      <div class="content">
        ${buildKPIs(data.fundStats)}
        ${buildFundStats(data.fundStats)}
        <div class="grid-2" style="margin-bottom:20px">
          ${buildPhaseChart(data.byPhase)}
          ${buildTypeTable(data.byType)}
        </div>
        ${buildActivity(data.monthly, data.byResponsible)}
        ${buildActivityBreakdown(actRows, lookups.logTypes || [])}
      </div>`;

    el.querySelectorAll('.fund-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => window.navigate('prosjektDetalj', btn.dataset.id));
    });
    setupActivityListeners(el, actRows);
  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:red">Feil: ${esc(e.message)}</p></div>`;
  }
}
