import { api } from '../api.js';

const LS_KEY = 'crm_dismissed_pairs';
const FIELDS = [
  ['Fase',          'phase'],
  ['Lead',          'lead'],
  ['Type',          'investor_type'],
  ['Ticket (M)',    'target_ticket'],
  ['Sannsynlighet', 'probability'],
  ['Sist kontakt',  'last_contact'],
  ['Kilde',         'source'],
  ['Rådgiver',      'advisor'],
];

function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(window.lsKey(LS_KEY)) || '[]')); }
  catch { return new Set(); }
}
function saveDismissed(set) {
  localStorage.setItem(window.lsKey(LS_KEY), JSON.stringify([...set]));
}

function fmtVal(v) {
  if (v == null || v === '') return '<span style="color:#ccc">—</span>';
  if (typeof v === 'number') return Number(v).toLocaleString('nb-NO');
  return window.escHtml(String(v));
}

function scoreColor(score) {
  if (score === 100) return 'var(--green)';
  if (score >= 80)  return 'var(--blue)';
  return '#e67e22';
}

function productBadgesHtml(inv, products) {
  const prodMap = Object.fromEntries((products || []).map(p => [p._id, p.name]));
  const names = (inv.product_interests || []).map(id => prodMap[id]).filter(Boolean);
  if (!names.length) return '<span style="color:#ccc">—</span>';
  return names.map(n => `<span class="prod-pill" style="margin-right:4px">${window.escHtml(n)}</span>`).join('');
}

function buildTable(pairs, dismissed, products) {
  const visible = pairs.filter(p => !dismissed.has(p.a.id + '_' + p.b.id));
  if (!visible.length) {
    return `<div class="card" style="text-align:center;padding:48px;color:#888">
      <div style="font-size:32px;margin-bottom:12px">✓</div>
      <p style="font-weight:600">Ingen duplikater funnet</p>
      <p style="font-size:13px;margin-top:4px">Alle avviste par vises igjen ved neste lasting av siden.</p>
    </div>`;
  }
  const rows = visible.map((pair, i) => `
    <tr style="border-top:1px solid var(--border)">
      <td style="padding:12px 16px;text-align:center">
        <span style="font-weight:700;font-size:13px;color:${scoreColor(pair.score)}">${pair.score}%</span>
      </td>
      <td style="padding:12px 16px">
        <div style="font-weight:600;font-size:13px">${window.escHtml(pair.a.name)}</div>
        <div style="font-size:11px;color:#aaa">${window.escHtml(pair.a.id)} · ${window.escHtml(pair.a.phase || '—')} · ${window.escHtml(pair.a.investor_type || '—')}</div>
      </td>
      <td style="padding:12px 16px">
        <div style="font-weight:600;font-size:13px">${window.escHtml(pair.b.name)}</div>
        <div style="font-size:11px;color:#aaa">${window.escHtml(pair.b.id)} · ${window.escHtml(pair.b.phase || '—')} · ${window.escHtml(pair.b.investor_type || '—')}</div>
      </td>
      <td style="padding:12px 16px;text-align:right">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" data-dismiss="${i}" style="min-height:44px">Avvis</button>
          <button class="btn btn-primary btn-sm" data-review="${i}" style="min-height:44px">Gjennomgå →</button>
        </div>
      </td>
    </tr>`).join('');

  return `
    <p style="font-size:12px;color:#888;margin-bottom:12px">
      Klikk «Gjennomgå» for å se detaljer og eventuelt slå sammen. «Avvis» skjuler paret.
    </p>
    <div class="card" style="padding:0;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f8f9fa;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.4px">
            <th style="padding:10px 16px;text-align:left;width:60px">Treff</th>
            <th style="padding:10px 16px;text-align:left">Oppføring A</th>
            <th style="padding:10px 16px;text-align:left">Oppføring B</th>
            <th style="padding:10px 16px;width:180px"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildMergeModal(pair, products) {
  const fieldRows = FIELDS.map(([label, key]) => {
    const va = pair.a[key], vb = pair.b[key];
    const conflict = va != null && vb != null && va !== '' && vb !== '' && va !== vb;
    return `<tr data-conflict="${conflict}" style="background:${conflict ? '#fff8e1' : 'transparent'}">
      <td style="padding:4px 8px;color:#888;font-weight:500">${window.escHtml(label)}</td>
      <td style="padding:4px 8px" data-field-a="${window.escHtml(key)}">${fmtVal(va)}</td>
      <td style="padding:4px 8px" data-field-b="${window.escHtml(key)}">${fmtVal(vb)}</td>
    </tr>`;
  }).join('');

  return `
    <div class="modal-header">
      <h3>Slå sammen investorer</h3>
      <button class="btn-close" onclick="window.closeModal()">×</button>
    </div>
    <div class="modal-body">
      <p style="font-size:13px;color:#555;margin-bottom:16px">
        Velg hvilken oppføring som er <strong>primær</strong> (beholder navn og data).
        Den andre slettes — kontakter og kontaktlogg fra begge beholdes.
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        <div id="card-a" data-side="a"
          style="border:2px solid var(--blue);border-radius:10px;padding:14px 16px;cursor:pointer;background:rgba(52,152,219,.07);transition:all .15s">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-weight:700;font-size:14px">${window.escHtml(pair.a.name)}</span>
            <span id="badge-a" style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:var(--blue);color:#fff">✓ Beholder</span>
          </div>
          <div style="font-size:11px;color:#888;margin-bottom:4px">${window.escHtml(pair.a.id)}</div>
          <div style="font-size:12px">${window.phaseBadge ? window.phaseBadge(pair.a.phase) : (pair.a.phase ? `<span class="badge">${window.escHtml(pair.a.phase)}</span>` : '')}</div>
          <div style="margin-top:8px;font-size:12px">${productBadgesHtml(pair.a, products)}</div>
        </div>
        <div id="card-b" data-side="b"
          style="border:2px solid var(--border);border-radius:10px;padding:14px 16px;cursor:pointer;background:#fff;transition:all .15s">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-weight:700;font-size:14px">${window.escHtml(pair.b.name)}</span>
            <span id="badge-b" style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:#eee;color:#999">Slettes</span>
          </div>
          <div style="font-size:11px;color:#888;margin-bottom:4px">${window.escHtml(pair.b.id)}</div>
          <div style="font-size:12px">${window.phaseBadge ? window.phaseBadge(pair.b.phase) : (pair.b.phase ? `<span class="badge">${window.escHtml(pair.b.phase)}</span>` : '')}</div>
          <div style="margin-top:8px;font-size:12px">${productBadgesHtml(pair.b, products)}</div>
        </div>
      </div>
      <div style="background:#f8f9fa;border-radius:8px;padding:12px 16px">
        <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">
          Feltsammenligning — felt med konflikt markert
        </div>
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          <thead>
            <tr style="color:#888">
              <th style="text-align:left;padding:3px 8px;width:130px">Felt</th>
              <th style="text-align:left;padding:3px 8px">${window.escHtml(pair.a.name)}</th>
              <th style="text-align:left;padding:3px 8px">${window.escHtml(pair.b.name)}</th>
            </tr>
          </thead>
          <tbody>
            ${fieldRows}
            <tr>
              <td style="padding:4px 8px;color:#888;font-weight:500">Produkter</td>
              <td style="padding:4px 8px">${productBadgesHtml(pair.a, products)}</td>
              <td style="padding:4px 8px">${productBadgesHtml(pair.b, products)}</td>
            </tr>
          </tbody>
        </table>
        <p style="font-size:11px;color:#aaa;margin-top:8px">
          Ved konflikt vinner primæroppføringens verdi. Produktflagg fra begge beholdes alltid.
        </p>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avvis par</button>
      <button class="btn btn-primary" id="merge-confirm-btn">
        Slå sammen → beholder "${window.escHtml(pair.a.name)}"
      </button>
    </div>`;
}

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted" style="padding:24px">Analyserer…</p></div>';

  let pairs = [], products = [], dismissed = loadDismissed();

  try {
    [pairs, products] = await Promise.all([api.duplicates(), api.products()]);
  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:red">Feil: ${window.escHtml(e.message)}</p></div>`;
    return;
  }

  function buildPage() {
    const visible = pairs.filter(p => !dismissed.has(p.a.id + '_' + p.b.id));
    const dismissedCount = dismissed.size;

    el.innerHTML = `
      <div class="topbar">
        <span class="topbar-title">Duplikater${pairs.length ? ` (${visible.length} forslag)` : ''}</span>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${dismissedCount > 0 ? `<button class="btn btn-ghost btn-sm" id="reset-dismissed-btn" style="min-height:44px">Vis ${dismissedCount} avviste igjen</button>` : ''}
          <button class="btn btn-ghost btn-sm" id="reload-btn" style="min-height:44px">↺ Last inn på nytt</button>
        </div>
      </div>
      <div class="content">
        ${buildTable(pairs, dismissed, products)}
      </div>`;

    // Reload
    el.querySelector('#reload-btn')?.addEventListener('click', async () => {
      el.querySelector('.content').innerHTML = '<p class="text-muted" style="padding:24px">Analyserer…</p>';
      try {
        pairs = await api.duplicates();
        buildPage();
      } catch (e) {
        el.querySelector('.content').innerHTML = `<p style="color:red">Feil: ${window.escHtml(e.message)}</p>`;
      }
    });

    // Reset dismissed
    el.querySelector('#reset-dismissed-btn')?.addEventListener('click', () => {
      dismissed = new Set();
      saveDismissed(dismissed);
      buildPage();
    });

    // Dismiss buttons
    const visiblePairs = pairs.filter(p => !dismissed.has(p.a.id + '_' + p.b.id));
    el.querySelectorAll('[data-dismiss]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.dismiss, 10);
        const pair = visiblePairs[i];
        if (!pair) return;
        dismissed.add(pair.a.id + '_' + pair.b.id);
        saveDismissed(dismissed);
        buildPage();
      });
    });

    // Review (merge modal) buttons
    el.querySelectorAll('[data-review]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.review, 10);
        const pair = visiblePairs[i];
        if (!pair) return;
        openMergeModal(pair);
      });
    });
  }

  function openMergeModal(pair) {
    let primary = 'a'; // 'a' or 'b'

    window.openModal(buildMergeModal(pair, products), () => {
      function applyPrimary(p) {
        primary = p;
        const cardA = document.getElementById('card-a');
        const cardB = document.getElementById('card-b');
        const badgeA = document.getElementById('badge-a');
        const badgeB = document.getElementById('badge-b');
        const confirmBtn = document.getElementById('merge-confirm-btn');
        if (!cardA) return;

        if (p === 'a') {
          cardA.style.border = '2px solid var(--blue)';
          cardA.style.background = 'rgba(52,152,219,.07)';
          cardB.style.border = '2px solid var(--border)';
          cardB.style.background = '#fff';
          badgeA.style.background = 'var(--blue)';
          badgeA.style.color = '#fff';
          badgeA.textContent = '✓ Beholder';
          badgeB.style.background = '#eee';
          badgeB.style.color = '#999';
          badgeB.textContent = 'Slettes';
          if (confirmBtn) confirmBtn.textContent = `Slå sammen → beholder "${pair.a.name}"`;
        } else {
          cardB.style.border = '2px solid var(--blue)';
          cardB.style.background = 'rgba(52,152,219,.07)';
          cardA.style.border = '2px solid var(--border)';
          cardA.style.background = '#fff';
          badgeB.style.background = 'var(--blue)';
          badgeB.style.color = '#fff';
          badgeB.textContent = '✓ Beholder';
          badgeA.style.background = '#eee';
          badgeA.style.color = '#999';
          badgeA.textContent = 'Slettes';
          if (confirmBtn) confirmBtn.textContent = `Slå sammen → beholder "${pair.b.name}"`;
        }

        // Bold conflict winner
        document.querySelectorAll('[data-conflict="true"]').forEach(row => {
          const tdA = row.querySelector('[data-field-a]');
          const tdB = row.querySelector('[data-field-b]');
          if (tdA) tdA.style.fontWeight = p === 'a' ? '600' : '400';
          if (tdB) tdB.style.fontWeight = p === 'b' ? '600' : '400';
        });
      }

      document.getElementById('card-a')?.addEventListener('click', () => applyPrimary('a'));
      document.getElementById('card-b')?.addEventListener('click', () => applyPrimary('b'));

      document.getElementById('merge-confirm-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('merge-confirm-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Slår sammen…'; }
        try {
          const keep = primary === 'a' ? pair.a : pair.b;
          const drop = primary === 'a' ? pair.b : pair.a;
          await api.merge(keep.id, drop.id);
          const body = document.querySelector('.modal-body');
          if (body) body.innerHTML = `<div style="text-align:center;padding:40px"><div style="font-size:36px">✓</div><p style="font-weight:600;margin-top:8px">Sammenslått!</p></div>`;
          const footer = document.querySelector('.modal-footer');
          if (footer) footer.style.display = 'none';
          setTimeout(async () => {
            window.closeModal();
            pairs = await api.duplicates().catch(() => []);
            buildPage();
          }, 1000);
        } catch (e) {
          alert('Feil: ' + e.message);
          if (btn) { btn.disabled = false; btn.textContent = `Slå sammen → beholder "${(primary === 'a' ? pair.a : pair.b).name}"`; }
        }
      });
    });
  }

  buildPage();
}
