import { api } from '../api.js';

const LS_KEY = 'crm_dismissed_dup_contacts';

function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveDismissed(set) {
  localStorage.setItem(LS_KEY, JSON.stringify([...set]));
}

function groupKey(g) {
  return g.type + '||' + (g.email || g.investor_id + (g.contacts || []).map(c => c._id).join(''));
}

function contactRowHtml(c, idx) {
  return `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8f9fa;border-radius:6px;margin-bottom:4px;flex-wrap:wrap">
      <div style="flex:1;min-width:180px">
        <span style="font-weight:600;font-size:13px">${window.escHtml(c.name || '—')}</span>
        ${c.title ? `<span style="font-size:11px;color:var(--muted);margin-left:6px">${window.escHtml(c.title)}</span>` : ''}
        ${c.investor_name ? `<div style="font-size:11px;color:var(--muted);margin-top:1px">→ ${window.escHtml(c.investor_name)}</div>` : ''}
      </div>
      <div style="font-size:11px;color:#555;display:flex;flex-direction:column;gap:2px">
        ${c.email ? `<span>✉ ${window.escHtml(c.email)}</span>` : ''}
        ${c.phone ? `<span>📞 ${window.escHtml(c.phone)}</span>` : ''}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" data-open-investor="${window.escHtml(c.investor_id || '')}" style="font-size:11px;min-height:44px">Åpne →</button>
        <button class="btn btn-ghost btn-sm" data-delete-contact="${window.escHtml(c._id || '')}" data-contact-name="${window.escHtml(c.name || '')}" style="font-size:11px;color:#e74c3c;min-height:44px">Slett</button>
      </div>
    </div>`;
}

function mergeRowHtml(c, role) {
  const badge = role === 'keep'
    ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(39,174,96,.15);color:#27ae60">Beholder</span>`
    : `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(231,76,60,.12);color:#e74c3c">Slettes</span>`;
  return `
    <div style="padding:10px 12px;background:#f8f9fa;border-radius:6px;margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">${badge}
        <span style="font-weight:600;font-size:13px">${window.escHtml(c.name || '—')}</span>
        ${c.title ? `<span style="font-size:11px;color:var(--muted)">${window.escHtml(c.title)}</span>` : ''}
      </div>
      <div style="font-size:11px;color:#555;display:flex;flex-direction:column;gap:2px">
        ${c.investor_name ? `<span>Investor: ${window.escHtml(c.investor_name)}</span>` : ''}
        ${c.email ? `<span>✉ ${window.escHtml(c.email)}</span>` : '<span style="color:#aaa">Ingen e-post</span>'}
        ${c.phone ? `<span>📞 ${window.escHtml(c.phone)}</span>` : ''}
        ${c.notes ? `<span style="color:#888">Notat: ${window.escHtml(c.notes)}</span>` : ''}
      </div>
    </div>`;
}

function showMergeModal(g, onConfirm) {
  const [a, b] = g.contacts;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;max-width:480px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.18)">
      <h3 style="margin:0 0 4px;font-size:16px">Slå sammen kontakter</h3>
      <p style="font-size:12px;color:#888;margin:0 0 16px">Velg hvem som skal beholdes. Felter som mangler hos den beholdte kontakten hentes fra den andre.</p>
      <div id="merge-a" style="cursor:pointer;border:2px solid transparent;border-radius:8px;padding:4px;transition:border-color .15s">
        ${mergeRowHtml(a, 'keep')}
      </div>
      <div style="text-align:center;font-size:18px;color:#aaa;margin:4px 0">⇅</div>
      <div id="merge-b" style="cursor:pointer;border:2px solid transparent;border-radius:8px;padding:4px;transition:border-color .15s">
        ${mergeRowHtml(b, 'drop')}
      </div>
      <p style="font-size:11px;color:#aaa;margin:12px 0 16px">Klikk på en kontakt for å velge hvem som beholdes. Notater slås sammen om begge har tekst.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="merge-cancel" style="min-height:44px">Avbryt</button>
        <button class="btn btn-primary btn-sm" id="merge-confirm" style="min-height:44px">Slå sammen</button>
      </div>
    </div>`;

  let keepId = a._id;
  let dropId = b._id;

  function updateSelection() {
    overlay.querySelector('#merge-a').style.borderColor = keepId === a._id ? '#27ae60' : '#e74c3c';
    overlay.querySelector('#merge-b').style.borderColor = keepId === b._id ? '#27ae60' : '#e74c3c';
    overlay.querySelector('#merge-a').querySelector('[style*="Beholder"]')?.parentElement?.replaceWith?.();
    const rowA = overlay.querySelector('#merge-a');
    const rowB = overlay.querySelector('#merge-b');
    rowA.innerHTML = mergeRowHtml(a, keepId === a._id ? 'keep' : 'drop');
    rowB.innerHTML = mergeRowHtml(b, keepId === b._id ? 'keep' : 'drop');
  }

  overlay.querySelector('#merge-a').addEventListener('click', () => { keepId = a._id; dropId = b._id; updateSelection(); });
  overlay.querySelector('#merge-b').addEventListener('click', () => { keepId = b._id; dropId = a._id; updateSelection(); });
  overlay.querySelector('#merge-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#merge-confirm').addEventListener('click', () => { overlay.remove(); onConfirm(keepId, dropId); });

  updateSelection();
  document.body.appendChild(overlay);
}

function groupHtml(g, dismissed) {
  const key = groupKey(g);
  const isExact = g.type === 'exact';
  const headerBg = isExact ? 'rgba(231,76,60,.06)' : 'rgba(52,152,219,.05)';
  const labelBg  = isExact ? 'rgba(231,76,60,.15)' : 'rgba(52,152,219,.12)';
  const labelColor = isExact ? '#e74c3c' : 'var(--blue)';

  const contacts = (g.contacts || []).map((c, i) => contactRowHtml(c, i)).join('');
  const emailStr = g.email ? `<span style="font-size:12px;color:var(--muted)">✉ ${window.escHtml(g.email)}</span>` : '';
  const invStr   = (isExact && g.investor_name) ? `<span style="font-size:12px;color:var(--muted)">${window.escHtml(g.investor_name)}</span>` : '';
  const mergeBtn = (isExact && (g.contacts || []).length === 2)
    ? `<button class="btn btn-ghost btn-sm" data-merge-group="${window.escHtml(key)}" style="font-size:11px;min-height:44px;color:#27ae60">Slå sammen</button>`
    : '';

  return `
    <div style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden">
      <div style="padding:10px 14px;background:${headerBg};display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 7px;border-radius:20px;background:${labelBg};color:${labelColor}">${window.escHtml(g.label || g.type)}</span>
          ${emailStr}${invStr}
        </div>
        <div style="display:flex;gap:6px">
          ${mergeBtn}
          <button class="btn btn-ghost btn-sm" data-dismiss-group="${window.escHtml(key)}" style="font-size:11px;min-height:44px">Avvis</button>
        </div>
      </div>
      <div style="padding:10px 12px">${contacts}</div>
    </div>`;
}

function buildContent(groups, dismissed) {
  const visible = groups.filter(g => !dismissed.has(groupKey(g)));
  const exact = visible.filter(g => g.type === 'exact');
  const email = visible.filter(g => g.type === 'email');

  if (!visible.length) {
    return `<div class="card" style="text-align:center;padding:48px;color:#888">
      <div style="font-size:32px;margin-bottom:12px">✓</div>
      <p style="font-weight:600">Ingen kontaktduplikater funnet</p>
    </div>`;
  }

  let html = '';
  if (exact.length) {
    html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#e74c3c;margin-bottom:8px">
      Eksakte duplikater — samme navn på samme investor (${exact.length})
    </div>`;
    html += exact.map(g => groupHtml(g, dismissed)).join('');
  }
  if (email.length) {
    html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--blue);margin-bottom:8px;${exact.length ? 'margin-top:20px' : ''}">
      Samme e-postadresse (${email.length})
    </div>
    <p style="font-size:12px;color:#aaa;margin-bottom:10px">
      Kan være samme person på flere investorer (legitimt), eller en importfeil. Vurder fra case til case.
    </p>`;
    html += email.map(g => groupHtml(g, dismissed)).join('');
  }
  return html;
}

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted" style="padding:24px">Analyserer…</p></div>';

  let groups = [];
  let dismissed = loadDismissed();

  async function reload() {
    el.querySelector('.content').innerHTML = '<p class="text-muted" style="padding:24px">Analyserer…</p>';
    try {
      groups = await api.duplicateContacts();
      buildPage();
    } catch (e) {
      el.querySelector('.content').innerHTML = `<div class="alert-err">Feil: ${window.escHtml(e.message)}</div>`;
    }
  }

  function buildPage() {
    const visible = groups.filter(g => !dismissed.has(groupKey(g)));
    const dismissedCount = dismissed.size;

    el.innerHTML = `
      <div class="topbar">
        <span class="topbar-title">Duplikate kontakter${groups.length ? ` (${visible.length} grupper)` : ''}</span>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${dismissedCount > 0 ? `<button class="btn btn-ghost btn-sm" id="reset-dismissed-btn" style="min-height:44px">Vis ${dismissedCount} avviste igjen</button>` : ''}
          <button class="btn btn-ghost btn-sm" id="reload-btn" style="min-height:44px">↺ Last inn på nytt</button>
        </div>
      </div>
      <div class="content">
        ${buildContent(groups, dismissed)}
      </div>`;

    el.querySelector('#reload-btn')?.addEventListener('click', reload);

    el.querySelector('#reset-dismissed-btn')?.addEventListener('click', () => {
      dismissed = new Set();
      saveDismissed(dismissed);
      buildPage();
    });

    el.querySelectorAll('[data-dismiss-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        dismissed.add(btn.dataset.dismissGroup);
        saveDismissed(dismissed);
        buildPage();
      });
    });

    el.querySelectorAll('[data-open-investor]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.openInvestor;
        if (id) window.navigate('detalj', id);
      });
    });

    el.querySelectorAll('[data-delete-contact]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteContact;
        const name = btn.dataset.contactName || 'denne kontakten';
        if (!window.confirm(`Slette kontakten "${name}"?`)) return;
        try {
          await api.deleteContact(id);
          await reload();
        } catch (e) {
          alert('Feil: ' + e.message);
        }
      });
    });

    el.querySelectorAll('[data-merge-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.mergeGroup;
        const g = groups.find(g => groupKey(g) === key);
        if (!g) return;
        showMergeModal(g, async (keep_id, drop_id) => {
          try {
            await api.mergeContacts(keep_id, drop_id);
            await reload();
          } catch (e) {
            alert('Feil ved sammenslåing: ' + e.message);
          }
        });
      });
    });
  }

  try {
    groups = await api.duplicateContacts();
    buildPage();
  } catch (e) {
    el.innerHTML = `
      <div class="topbar"><span class="topbar-title">Duplikate kontakter</span></div>
      <div class="content">
        <div style="background:#fdecea;color:#c0392b;border-radius:8px;padding:12px 16px;margin-bottom:16px">
          Feil: ${window.escHtml(e.message)} — husk å restarte serveren etter endringer.
        </div>
      </div>`;
  }
}
