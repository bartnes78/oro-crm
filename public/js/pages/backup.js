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

function formatWeekStamp(stamp) {
  // ORO_CRM_2026-W25.xlsx → 2026, uke 25
  const m = stamp.match(/(\d{4})-W(\d{2})/);
  return m ? `${m[1]}, uke ${m[2]}` : stamp;
}

// Statusrad for nattjobbene: grønn hvis fersk, rød hvis for gammel/mangler
function statusRow(label, timestamp, maxAgeHours) {
  let text = 'Aldri kjørt';
  let ok = false;
  if (timestamp) {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    const hours = ageMs / 36e5;
    ok = hours <= maxAgeHours;
    text = hours < 1.5 ? 'For under en time siden'
         : hours < 48  ? `${Math.round(hours)} timer siden`
         : `${Math.round(hours / 24)} døgn siden`;
  }
  const color = ok ? 'var(--color-signed)' : 'var(--red)';
  const icon  = ok ? '●' : '⚠';
  return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
    <span style="color:${color};flex-shrink:0">${icon}</span>
    <span style="flex:1">${window.escHtml(label)}</span>
    <span style="color:${ok ? 'var(--muted)' : 'var(--red)'};font-weight:${ok ? '400' : '600'}">${window.escHtml(text)}</span>
  </div>`;
}

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted" style="padding:24px">Laster…</p></div>';

  let backups = [];
  let exportFiles = [];
  let sysStatus = null;
  let restoredStamp = null;
  let restoringStamp = null;

  async function load() {
    try {
      [backups, exportFiles, sysStatus] = await Promise.all([
        api.backups(), api.exports(), api.systemStatus().catch(() => null),
      ]);
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
      const btnColor = isRestored ? 'color:var(--color-signed)' : '';

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
        ${sysStatus ? `
        <div class="card" style="max-width:620px;margin-bottom:20px">
          <div class="card-title">Systemstatus</div>
          <p style="font-size:13px;color:var(--muted);margin-bottom:12px">
            Overvåking av de automatiske jobbene. Rød varsling betyr at en jobb ikke har kjørt som forventet — sjekk Railway-loggene.
          </p>
          ${statusRow('Daglig backup (hver 24. time)', sysStatus.lastBackup, 25)}
          ${statusRow('Ukentlig Excel-eksport (mandag 04:00)', sysStatus.lastExport?.mtime, 8 * 24)}
          ${statusRow('Brreg-synkronisering (mandag 03:00)', sysStatus.lastBrregSync, 8 * 24)}
          <div style="font-size:11px;color:var(--muted);margin-top:10px">Serverversjon: ${window.escHtml(String(sysStatus.version).slice(0, 10))}</div>
        </div>` : ''}
        <div class="card" style="max-width:620px">
          <div class="card-title">Automatiske backups</div>
          <p style="font-size:13px;color:var(--muted);margin-bottom:20px">
            Backup tas ved serveroppstart og hver 24. time. De 10 siste bevares.
            Ved gjenoppretting tas det automatisk backup av nåværende tilstand først.
          </p>

          ${restoredStamp ? `
            <div style="padding:10px 14px;background:rgba(26,138,106,.1);border:1px solid var(--color-signed);border-radius:7px;margin-bottom:16px;font-size:13px;color:var(--color-signed);font-weight:600">
              ✓ Gjenopprettet fra ${window.escHtml(formatStamp(restoredStamp))} — last inn siden på nytt for å se endringene.
            </div>` : ''}

          ${backups.length === 0
            ? `<p style="color:var(--muted);font-size:13px">Ingen backups funnet. Start serveren på nytt for å opprette første backup.</p>`
            : rows}
        </div>

        <div class="card" style="max-width:620px;margin-top:20px">
          <div class="card-title">Ukentlig Excel-eksport</div>
          <p style="font-size:13px;color:var(--muted);margin-bottom:20px">
            Hver mandag genereres en full Excel-eksport og lagres på serveren. De 8 siste (~2 måneder) beholdes.
            Last ned og lagre eksternt (f.eks. OneDrive) som ekstra sikring.
          </p>
          ${exportFiles.length === 0
            ? `<p style="color:var(--muted);font-size:13px">Ingen ukentlige eksporter funnet ennå.</p>`
            : exportFiles.map(f => `
              <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
                <span style="font-size:13px;flex:1">📄 ${window.escHtml(formatWeekStamp(f))}</span>
                <a class="btn btn-ghost btn-sm" style="min-height:44px" href="/api/exports/${encodeURIComponent(f)}">Last ned</a>
              </div>`).join('')}
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
          window.ui.toast('Feil: ' + e.message, 'error');
        }
      });
    });
  }

  await load();
}
