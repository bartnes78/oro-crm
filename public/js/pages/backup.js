import { api } from '../api.js';

function formatStamp(stamp) {
  // Expected format: 2026-05-12_14-30-00 → 12.05.2026 kl. 14:30
  try {
    const [date, time] = stamp.split('_');
    const [y, m, d]    = date.split('-');
    const [hh, mm]     = time.split('-');
    return `${d}.${m}.${y} kl. ${hh}:${mm}`;
  } catch {
    return stamp;
  }
}

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted" style="padding:24px">Laster…</p></div>';

  let backups = [];
  let restoredStamp = null;
  let restoringStamp = null;

  async function load() {
    try {
      backups = await api.backups();
      buildPage();
    } catch (e) {
      el.innerHTML = `
        <div class="topbar"><span class="topbar-title">Backup og gjenoppretting</span></div>
        <div class="content"><p style="color:red">Feil: ${window.escHtml(e.message)}</p></div>`;
    }
  }

  function buildPage() {
    const rows = backups.map(b => {
      const isRestored  = b.stamp === restoredStamp;
      const isRestoring = b.stamp === restoringStamp;
      const btnText = isRestoring ? 'Gjenoppretter…' : isRestored ? '✓ Gjenopprettet' : 'Gjenopprett';
      const btnColor = isRestored ? 'color:#1A8A6A' : '';

      return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;flex:1">📦 ${window.escHtml(formatStamp(b.stamp))}</span>
        <button class="btn btn-ghost btn-sm restore-btn"
          data-stamp="${window.escHtml(b.stamp)}"
          ${restoringStamp ? 'disabled' : ''}
          style="min-height:44px;${btnColor}">
          ${window.escHtml(btnText)}
        </button>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="topbar">
        <span class="topbar-title">Backup og gjenoppretting</span>
      </div>
      <div class="content">
        <div class="card" style="max-width:620px">
          <div class="card-title">Automatiske backups</div>
          <p style="font-size:13px;color:var(--muted);margin-bottom:20px">
            Backup tas ved serveroppstart og hver 24. time. De 10 siste bevares.
            Ved gjenoppretting tas det automatisk backup av nåværende tilstand først.
          </p>

          ${restoredStamp ? `
            <div style="padding:10px 14px;background:rgba(26,138,106,.1);border:1px solid #1A8A6A;border-radius:7px;margin-bottom:16px;font-size:13px;color:#1A8A6A;font-weight:600">
              ✓ Gjenopprettet fra ${window.escHtml(formatStamp(restoredStamp))} — last inn siden på nytt for å se endringene.
            </div>` : ''}

          ${backups.length === 0
            ? `<p style="color:var(--muted);font-size:13px">Ingen backups funnet. Start serveren på nytt for å opprette første backup.</p>`
            : rows}
        </div>
      </div>`;

    el.querySelectorAll('.restore-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const stamp = btn.dataset.stamp;
        const display = formatStamp(stamp);
        if (!window.confirm(`Rulle tilbake til ${display}?\n\nNåværende data tas backup av først.`)) return;

        restoringStamp = stamp;
        buildPage();

        try {
          await api.restoreBackup(stamp);
          restoredStamp  = stamp;
          restoringStamp = null;
          buildPage();
        } catch (e) {
          restoringStamp = null;
          buildPage();
          alert('Feil: ' + e.message);
        }
      });
    });
  }

  await load();
}
