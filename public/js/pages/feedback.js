import { api } from '../api.js';

function esc(s) { return window.escHtml(s); }

function fmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('nb-NO') + ' ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

async function showScreenshot(id) {
  try {
    const { screenshot } = await api.getFeedbackScreenshot(id);
    if (!screenshot) { window.ui.toast('Ingen skjermbilde lagret', 'error'); return; }
    const html = window.ui.modal(
      'Skjermbilde',
      `<img src="${esc(screenshot)}" alt="Skjermbilde" style="max-width:100%;border-radius:8px;display:block;" />`,
      `<button class="btn btn-ghost" onclick="window.closeModal()">Lukk</button>`,
    );
    window.openModal(html);
  } catch (e) {
    window.ui.toast('Feil: ' + e.message, 'error');
  }
}

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted" style="padding:24px">Laster…</p></div>';

  let rows = [];
  let showResolved = false;

  async function load() {
    try {
      rows = await api.getFeedback();
      buildPage();
    } catch (e) {
      el.innerHTML = `<div class="topbar"><span class="topbar-title">Tilbakemeldinger</span></div>
        <div class="content"><p style="color:red;padding:24px">Feil: ${esc(e.message)}</p></div>`;
    }
  }

  function buildCard(r) {
    const resolved = !!r.resolved_at;
    return `
      <div class="card" style="margin-bottom:10px;${resolved ? 'opacity:.7;' : ''}" data-id="${esc(String(r.id))}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
              <span class="badge badge-default">${esc(r.page || '—')}</span>
              <span style="font-size:12px;color:var(--muted);">${esc(r.username || '—')}</span>
              <span style="font-size:12px;color:var(--muted);">${esc(fmtTime(r.created_at))}</span>
              ${resolved ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(26,138,106,.12);color:var(--color-signed);font-weight:600;">✓ Behandlet${r.resolved_by ? ' · ' + esc(r.resolved_by) : ''}</span>` : ''}
            </div>
            <div style="font-size:13px;white-space:pre-wrap;">${esc(r.comment || '')}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">
            ${r.has_screenshot ? `<button class="btn btn-ghost btn-sm fb-shot-btn" data-id="${esc(String(r.id))}" style="min-height:32px;">🖼 Skjermbilde</button>` : ''}
            <button class="btn ${resolved ? 'btn-ghost' : 'btn-green'} btn-sm fb-toggle-btn" data-id="${esc(String(r.id))}" data-resolved="${resolved ? 1 : 0}" style="min-height:32px;white-space:nowrap;">
              ${resolved ? '↺ Åpne igjen' : '✓ Marker behandlet'}
            </button>
          </div>
        </div>
      </div>`;
  }

  function buildPage() {
    const open     = rows.filter(r => !r.resolved_at);
    const resolved = rows.filter(r => r.resolved_at);

    el.innerHTML = `
      <div class="topbar">
        <span class="topbar-title">Tilbakemeldinger</span>
        <span style="font-size:12px;color:var(--muted);margin-left:auto;">${open.length} åpne · ${resolved.length} behandlet</span>
      </div>
      <div class="content">
        <div class="section-label" style="margin-top:0">Åpne (${open.length})</div>
        ${open.length === 0 ? window.ui.emptyState('Ingen åpne tilbakemeldinger 🎉') : open.map(buildCard).join('')}

        ${resolved.length > 0 ? `
          <button id="fb-toggle-resolved" class="btn btn-ghost btn-sm" style="margin:16px 0 8px;min-height:36px;">
            ${showResolved ? '▾' : '▸'} Behandlet (${resolved.length})
          </button>
          <div id="fb-resolved-list" style="display:${showResolved ? 'block' : 'none'};">
            ${resolved.map(buildCard).join('')}
          </div>` : ''}
      </div>`;

    bindEvents();
  }

  function bindEvents() {
    el.querySelectorAll('.fb-shot-btn').forEach(btn => {
      btn.addEventListener('click', () => showScreenshot(btn.dataset.id));
    });

    el.querySelectorAll('.fb-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id       = btn.dataset.id;
        const resolved = btn.dataset.resolved === '1';
        btn.disabled = true;
        try {
          await api.resolveFeedback(id, !resolved);
          const row = rows.find(r => String(r.id) === String(id));
          if (row) row.resolved_at = !resolved ? new Date().toISOString() : null;
          buildPage();
        } catch (e) {
          window.ui.toast('Feil: ' + e.message, 'error');
          btn.disabled = false;
        }
      });
    });

    const toggleResolved = el.querySelector('#fb-toggle-resolved');
    if (toggleResolved) {
      toggleResolved.addEventListener('click', () => { showResolved = !showResolved; buildPage(); });
    }
  }

  await load();
}
