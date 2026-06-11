import { api } from '../api.js';

const TYPES    = ['Fond', 'Prosjekt', 'Co-invest', 'Annet'];
const STATUSES = ['Fundraising', 'Aktiv', 'Avsluttet', 'Pipeline'];
const ARCHIVED_STATUSES = new Set(['Avlyst', 'Fullført']);

const STATUS_COLOR = {
  'Pipeline':    '#2471A3',
  'Fundraising': '#D4AC0D',
  'Etablert':    'var(--color-signed)',
  'Aktiv':       'var(--color-signed)',
  'Avsluttet':   '#717D87',
  'Avlyst':      '#C0392B',
  'Fullført':    '#1A5C1A',
};

const STATUS_ORDER = ['Pipeline', 'Fundraising', 'Etablert', 'Aktiv', 'Avsluttet', 'Fullført', 'Avlyst'];
function statusSort(a, b) {
  const ai = STATUS_ORDER.indexOf(a.status ?? '');
  const bi = STATUS_ORDER.indexOf(b.status ?? '');
  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
}

// ── State ─────────────────────────────────────────────────────────────────────
let _el        = null;
let _products  = [];

// ── Render entry ──────────────────────────────────────────────────────────────
export async function render(el, _state) {
  _el = el;
  _el.innerHTML = `
    <div class="topbar">
      <span class="topbar-title">Prosjekter og produkter</span>
      <button class="btn btn-green btn-sm" id="btn-new-product">+ Nytt produkt</button>
    </div>
    <div class="content">
      <div id="product-list" style="display:flex;flex-direction:column;gap:10px;"></div>
    </div>`;

  _el.querySelector('#btn-new-product').addEventListener('click', () => openProductModal({}));

  await loadProducts();
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadProducts() {
  _products = await api.products();
  renderList();
}

// ── List ──────────────────────────────────────────────────────────────────────
function productCard(p) {
  const sc      = STATUS_COLOR[p.status] || 'var(--muted)';
  const archived = ARCHIVED_STATUSES.has(p.status);
  const sub     = [p.type, p.target_size ? `${Number(p.target_size).toLocaleString('nb-NO')} MNOK` : '',
                    p.established_date ? `Etablert ${p.established_date}` : '']
                    .filter(Boolean).join(' · ');
  return `
    <div class="card product-card" data-id="${escHtml(p._id)}"
      style="padding:16px 20px;cursor:pointer;${archived ? 'opacity:.6;' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-weight:700;font-size:15px;">${escHtml(p.name)}</div>
          ${sub ? `<div style="font-size:12px;color:var(--muted);margin-top:2px;">${escHtml(sub)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
          <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;
            background:${sc}22;color:${sc};">${escHtml(p.status || '')}</span>
          ${!archived ? `<button class="btn btn-ghost btn-sm btn-edit-product" data-id="${escHtml(p._id)}"
            style="min-height:36px;">Rediger</button>` : ''}
          <button class="btn btn-ghost btn-sm btn-del-product" data-id="${escHtml(p._id)}"
            style="color:#e74c3c;min-height:36px;">Slett</button>
          <span style="font-size:14px;color:var(--muted);">→</span>
        </div>
      </div>
      ${p.description
        ? `<p style="font-size:13px;color:var(--muted);margin:8px 0 0;">${escHtml(p.description)}</p>`
        : ''}
    </div>`;
}

function renderList() {
  const list = _el.querySelector('#product-list');
  if (!_products.length) {
    list.innerHTML = '<p class="text-muted">Ingen produkter registrert ennå.</p>';
    return;
  }

  const active   = _products.filter(p => !ARCHIVED_STATUSES.has(p.status)).sort(statusSort);
  const archived = _products.filter(p =>  ARCHIVED_STATUSES.has(p.status)).sort(statusSort);

  let html = active.map(productCard).join('');
  if (archived.length) {
    html += `
      <div style="margin-top:24px;padding-top:16px;border-top:1px dashed var(--border);">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;
                    letter-spacing:.6px;margin-bottom:12px;">Arkivert</div>
        ${archived.map(productCard).join('')}
      </div>`;
  }
  list.innerHTML = html;

  // Navigate on card click (not on button clicks)
  list.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      window.navigate('prosjektDetalj', card.dataset.id);
    });
  });

  list.querySelectorAll('.btn-edit-product').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const p = _products.find(x => String(x._id) === btn.dataset.id);
      if (p) openProductModal(p);
    });
  });

  list.querySelectorAll('.btn-del-product').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const p = _products.find(x => String(x._id) === btn.dataset.id);
      if (!p) return;
      if (!window.confirm(`Slette "${p.name}"?`)) return;
      await api.deleteProduct(p._id);
      await loadProducts();
    });
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openProductModal(product) {
  const isNew = !product._id;
  const form  = { name: '', type: 'Fond', status: 'Fundraising', target_size: '', description: '', established_date: '', ...product };

  const html = `
    <div class="modal-header">
      <h3>${isNew ? 'Nytt produkt / prosjekt' : 'Rediger produkt'}</h3>
      <button class="btn-close" onclick="window.closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div id="modal-err" class="alert-err" style="display:none;margin-bottom:12px;"></div>
      <div class="form-grid">
        <div class="form-group full">
          <label>Navn *</label>
          <input id="f-name" value="${escHtml(form.name)}" placeholder="F.eks. ORO Areal Eiendomsfond IS" />
        </div>
        <div class="form-group">
          <label>Type</label>
          <select id="f-type">
            ${TYPES.map(t => `<option${form.type === t ? ' selected' : ''}>${escHtml(t)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Status</label>
          <select id="f-status">
            ${STATUSES.map(s => `<option${form.status === s ? ' selected' : ''}>${escHtml(s)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Målstørrelse (MNOK)</label>
          <input id="f-size" type="number" min="0" step="0.1"
            value="${form.target_size != null ? form.target_size : ''}" />
        </div>
        <div class="form-group">
          <label>Etablert</label>
          <input id="f-established" type="date" value="${form.established_date || ''}" />
        </div>
        <div class="form-group full">
          <label>Beskrivelse</label>
          <textarea id="f-desc" style="min-height:60px;">${escHtml(form.description || '')}</textarea>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-primary" id="btn-save-product">Lagre</button>
    </div>`;

  window.openModal(html, () => {
    const nameEl = document.getElementById('f-name');
    nameEl.focus();

    document.getElementById('btn-save-product').addEventListener('click', async () => {
      const name = nameEl.value.trim();
      if (!name) {
        const err = document.getElementById('modal-err');
        err.textContent = 'Navn er påkrevd.';
        err.style.display = '';
        return;
      }
      const payload = {
        name,
        type:        document.getElementById('f-type').value,
        status:      document.getElementById('f-status').value,
        target_size: parseFloat(document.getElementById('f-size').value) || null,
        established_date: document.getElementById('f-established').value || null,
        description: document.getElementById('f-desc').value.trim(),
      };
      try {
        if (isNew) await api.addProduct(payload);
        else       await api.updateProduct(product._id, payload);
        window.closeModal();
        await loadProducts();
      } catch (err) {
        const errEl = document.getElementById('modal-err');
        errEl.textContent = err.message || 'Lagring feilet.';
        errEl.style.display = '';
      }
    });
  });
}

// ── Util ──────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return window.escHtml ? window.escHtml(s) : String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
