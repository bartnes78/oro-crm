import { api } from '../api.js';


// ── State ─────────────────────────────────────────────────────────────────────
// Module-level state so we can update the investor list after load
let _lookups   = {};
let _investors = [];
let _products  = [];

// ── Declined pills interactivity ──────────────────────────────────────────────
function setupDeclinedPills(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('label').forEach(lbl => {
    lbl.addEventListener('click', () => {
      const cb = lbl.querySelector('input[type=checkbox]');
      const checked = !cb.checked;
      cb.checked = checked;
      lbl.style.borderColor = checked ? '#e74c3c' : 'var(--border)';
      lbl.style.background  = checked ? 'rgba(231,76,60,.08)' : 'transparent';
      lbl.style.color       = checked ? '#e74c3c' : 'var(--muted)';
      lbl.style.fontWeight  = checked ? '600' : '400';
    });
  });
}

// ── Build declined pills HTML ─────────────────────────────────────────────────
function buildDeclinedPills(products, productInterests, selectedIds) {
  return (productInterests || []).map(id => {
    const prod = products.find(p => p._id === id);
    if (!prod) return '';
    const checked = (selectedIds || []).includes(id);
    return `
      <label style="display:inline-flex;flex-direction:row;gap:5px;align-items:center;cursor:pointer;
        padding:4px 10px;border-radius:20px;border:2px solid;
        border-color:${checked ? '#e74c3c' : 'var(--border)'};
        background:${checked ? 'rgba(231,76,60,.08)' : 'transparent'};
        color:${checked ? '#e74c3c' : 'var(--muted)'};
        font-weight:${checked ? 600 : 400};font-size:12px;min-height:32px;">
        <input type="checkbox" name="declined_products" value="${window.escHtml(String(id))}" ${checked ? 'checked' : ''} style="display:none;" />
        ${window.escHtml(prod.name)}
      </label>
    `;
  }).join('');
}

// ── Build page HTML ───────────────────────────────────────────────────────────
function buildHTML(lookups, currentUserName) {
  const defaultResponsible = currentUserName || 'Kristian Bartnes';
  const todayVal = new Date().toISOString().slice(0, 10);

  return `
    <div class="topbar">
      <span class="topbar-title">Logg ny investorkontakt</span>
    </div>
    <div class="content">
      <div class="card" style="max-width:680px;">

        <div id="lk-success" style="display:none;background:#d4edda;color:#155724;border:1px solid #a9dfbf;
          border-radius:8px;padding:10px 16px;margin-bottom:20px;font-weight:600;">
          &#10003; Kontakt logget
        </div>
        <div id="lk-error" style="display:none;background:#fdecea;color:#c0392b;border:1px solid #f5c6cb;
          border-radius:8px;padding:10px 16px;margin-bottom:20px;font-size:13px;"></div>

        <div class="form-grid">

          <!-- Dato -->
          <div class="form-group">
            <label>Dato *</label>
            <input type="date" id="lk-date" value="${todayVal}" />
          </div>

          <!-- Type -->
          <div class="form-group">
            <label>Type kontakt *</label>
            <select id="lk-type">
              ${(lookups.logTypes || []).map(t => `<option>${window.escHtml(t)}</option>`).join('')}
            </select>
          </div>

          <!-- Investor autocomplete -->
          <div class="form-group full" style="position:relative;">
            <label>Investor *</label>
            <input
              id="lk-inv-search"
              placeholder="Skriv for å søke&hellip;"
              autocomplete="off"
              style="width:100%;"
            />
            <input type="hidden" id="lk-inv-id" />
            <input type="hidden" id="lk-inv-name" />
            <div id="lk-suggestions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;
              border:1px solid var(--border);border-radius:8px;z-index:200;box-shadow:0 4px 16px rgba(0,0,0,.1);
              max-height:220px;overflow-y:auto;"></div>
          </div>

          <!-- Kontaktperson (populated after investor select) -->
          <div class="form-group">
            <label>Kontaktperson</label>
            <select id="lk-contact" disabled>
              <option value="">— Velg —</option>
            </select>
          </div>

          <!-- Ansvarlig -->
          <div class="form-group">
            <label>Ansvarlig</label>
            <select id="lk-responsible">
              ${(lookups.leads || []).map(l => `<option ${l === defaultResponsible ? 'selected' : ''}>${window.escHtml(l)}</option>`).join('')}
            </select>
          </div>

          <!-- Status toggle -->
          <div class="form-group full" style="grid-column:1/-1;">
            <label>Status</label>
            <div style="display:flex;gap:8px;margin-top:4px;" id="lk-status-wrap">
              <button type="button" class="lk-status-btn" data-status="avholdt"
                style="flex:1;padding:8px 0;border-radius:7px;border:2px solid var(--color-signed);background:rgba(26,138,106,.1);color:var(--color-signed);font-weight:600;font-size:13px;cursor:pointer;min-height:44px;">
                &#10003; Avholdt
              </button>
              <button type="button" class="lk-status-btn" data-status="planlagt"
                style="flex:1;padding:8px 0;border-radius:7px;border:2px solid var(--border);background:transparent;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer;min-height:44px;">
                &#128197; Planlagt
              </button>
            </div>
            <input type="hidden" id="lk-status" value="avholdt" />
          </div>

          <!-- Emne -->
          <div class="form-group full">
            <label>Emne / Agenda</label>
            <input id="lk-subject" placeholder="Hva ble diskutert?" />
          </div>

          <!-- Utfall -->
          <div class="form-group full">
            <label>Utfall / Neste steg</label>
            <textarea id="lk-outcome" placeholder="Hva ble konklusjonen? Hva skal skje videre?"></textarea>
          </div>

          <!-- Avsto fra (shown when investor has product interests) -->
          <div class="form-group full" id="lk-declined-wrap" style="display:none;">
            <label>Avsto fra <span style="font-weight:400;color:var(--muted);font-size:11px;">(valgfritt)</span></label>
            <div id="lk-declined" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;"></div>
          </div>

          <!-- Notat -->
          <div class="form-group full">
            <label>Notat (valgfritt)</label>
            <textarea id="lk-notes" style="min-height:52px;"></textarea>
          </div>

          <!-- Oppdater fase -->
          <div class="form-group full">
            <label>Oppdater fase (valgfritt)</label>
            <select id="lk-phase">
              <option value="">— Ikke endre —</option>
              ${(lookups.phases || []).map(p => `<option>${window.escHtml(p)}</option>`).join('')}
            </select>
          </div>

        </div>

        <div style="margin-top:24px;display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-green" id="lk-submit-btn" disabled style="min-height:44px;">
            &#10003; Logg kontakt
          </button>
          <button class="btn btn-ghost" id="lk-cancel-btn" style="min-height:44px;">Avbryt</button>
        </div>

      </div>
    </div>
  `;
}

// ── Setup events ──────────────────────────────────────────────────────────────
function setupEvents(el, state) {
  const todayVal = new Date().toISOString().slice(0, 10);

  // Cancel
  el.querySelector('#lk-cancel-btn').addEventListener('click', () => {
    window.navigate('investorer');
  });

  // Status toggle
  const statusWrap = el.querySelector('#lk-status-wrap');
  const statusHidden = el.querySelector('#lk-status');
  statusWrap.querySelectorAll('.lk-status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.status;
      statusHidden.value = s;
      statusWrap.querySelectorAll('.lk-status-btn').forEach(b => {
        const active = b.dataset.status === s;
        const isPlan = b.dataset.status === 'planlagt';
        b.style.borderColor = active ? (isPlan ? 'var(--blue)' : 'var(--color-signed)') : 'var(--border)';
        b.style.background  = active ? (isPlan ? 'rgba(52,152,219,.1)' : 'rgba(26,138,106,.1)') : 'transparent';
        b.style.color       = active ? (isPlan ? 'var(--blue)' : 'var(--color-signed)') : 'var(--muted)';
      });
    });
  });

  // Investor search autocomplete
  const searchInput  = el.querySelector('#lk-inv-search');
  const invIdHidden  = el.querySelector('#lk-inv-id');
  const invNameHidden = el.querySelector('#lk-inv-name');
  const suggestBox   = el.querySelector('#lk-suggestions');
  const submitBtn    = el.querySelector('#lk-submit-btn');

  function renderSuggestions(query) {
    if (query.length < 2) {
      suggestBox.style.display = 'none';
      return;
    }
    const matches = _investors
      .filter(i => i.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8);

    if (matches.length === 0) {
      suggestBox.style.display = 'none';
      return;
    }

    suggestBox.innerHTML = matches.map(inv => `
      <div class="lk-sugg-item" data-id="${window.escHtml(String(inv.id))}" data-name="${window.escHtml(inv.name)}"
        style="padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;">
        <span style="font-weight:600;">${window.escHtml(inv.name)}</span>
        <span style="color:#aaa;font-size:11px;margin-left:8px;">${window.escHtml(inv.phase || '')}${inv.investor_type ? ' · ' + window.escHtml(inv.investor_type) : ''}</span>
      </div>
    `).join('');
    suggestBox.style.display = '';

    suggestBox.querySelectorAll('.lk-sugg-item').forEach(item => {
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(52,152,219,.08)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      item.addEventListener('mousedown', async (e) => {
        e.preventDefault(); // prevent blur from firing first
        await selectInvestor(item.dataset.id, item.dataset.name);
      });
    });
  }

  async function selectInvestor(id, name) {
    invIdHidden.value   = id;
    invNameHidden.value = name;
    searchInput.value   = name;
    suggestBox.style.display = 'none';

    // Enable submit
    const date = el.querySelector('#lk-date').value;
    submitBtn.disabled = !(date && id);

    // Load contacts for this investor
    const contactSelect = el.querySelector('#lk-contact');
    contactSelect.innerHTML = '<option value="">— Laster… —</option>';
    contactSelect.disabled = true;

    try {
      const [contacts, inv] = await Promise.all([
        api.contacts(id),
        api.investor(id),
      ]);

      contactSelect.innerHTML = '<option value="">— Velg —</option>' +
        contacts.map(c => `<option value="${window.escHtml(c.name)}">${window.escHtml(c.name)}${c.title ? ' (' + window.escHtml(c.title) + ')' : ''}</option>`).join('');
      contactSelect.disabled = false;

      // Show declined pills if investor has product interests
      const declinedWrap = el.querySelector('#lk-declined-wrap');
      const declinedContainer = el.querySelector('#lk-declined');
      const interests = inv.product_interests || [];
      if (interests.length > 0) {
        declinedContainer.innerHTML = buildDeclinedPills(_products, interests, []);
        declinedWrap.style.display = '';
        setupDeclinedPills('lk-declined');
      } else {
        declinedContainer.innerHTML = '';
        declinedWrap.style.display = 'none';
      }
    } catch (e) {
      contactSelect.innerHTML = '<option value="">— Feil ved lasting —</option>';
      contactSelect.disabled = false;
    }
  }

  searchInput.addEventListener('input', () => {
    const q = searchInput.value;
    // Clear selection if user types again
    invIdHidden.value   = '';
    invNameHidden.value = '';
    submitBtn.disabled  = true;
    renderSuggestions(q);
  });

  searchInput.addEventListener('focus', () => {
    if (searchInput.value.length >= 2) renderSuggestions(searchInput.value);
  });

  searchInput.addEventListener('blur', () => {
    // Small delay so mousedown on suggestion fires first
    setTimeout(() => { suggestBox.style.display = 'none'; }, 150);
  });

  // Date change: re-check submit button
  el.querySelector('#lk-date').addEventListener('change', () => {
    const date = el.querySelector('#lk-date').value;
    const id   = invIdHidden.value;
    submitBtn.disabled = !(date && id);
  });

  // Submit
  submitBtn.addEventListener('click', async () => {
    const date   = el.querySelector('#lk-date').value;
    const invId  = invIdHidden.value;
    const invName = invNameHidden.value;
    if (!date || !invId) return;

    const declined = [...el.querySelectorAll('#lk-declined input[type=checkbox]:checked')]
      .map(cb => { const v = cb.value; return isNaN(v) ? v : Number(v); });

    const newPhase = el.querySelector('#lk-phase').value;

    const data = {
      date,
      investor_id:       invId,
      investor_name:     invName,
      log_type:          el.querySelector('#lk-type').value,
      contact_person:    el.querySelector('#lk-contact').value,
      responsible:       el.querySelector('#lk-responsible').value,
      status:            el.querySelector('#lk-status').value,
      subject:           el.querySelector('#lk-subject').value,
      outcome:           el.querySelector('#lk-outcome').value,
      notes:             el.querySelector('#lk-notes').value,
      declined_products: declined,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Lagrer…';
    el.querySelector('#lk-error').style.display = 'none';

    try {
      await api.addLog(data);

      if (newPhase) {
        await api.updateInvestor(invId, { phase: newPhase });
      }

      // Show success banner
      const successEl = el.querySelector('#lk-success');
      successEl.style.display = '';
      setTimeout(() => { if (successEl) successEl.style.display = 'none'; }, 3000);

      // Reset form
      el.querySelector('#lk-date').value    = todayVal;
      el.querySelector('#lk-subject').value = '';
      el.querySelector('#lk-outcome').value = '';
      el.querySelector('#lk-notes').value   = '';
      el.querySelector('#lk-phase').value   = '';
      el.querySelector('#lk-status').value  = 'avholdt';
      el.querySelector('#lk-inv-search').value = '';
      invIdHidden.value   = '';
      invNameHidden.value = '';
      el.querySelector('#lk-contact').innerHTML = '<option value="">— Velg —</option>';
      el.querySelector('#lk-contact').disabled  = true;
      el.querySelector('#lk-declined').innerHTML = '';
      el.querySelector('#lk-declined-wrap').style.display = 'none';

      // Reset status buttons
      statusWrap.querySelectorAll('.lk-status-btn').forEach(b => {
        const isAvholdt = b.dataset.status === 'avholdt';
        b.style.borderColor = isAvholdt ? 'var(--color-signed)' : 'var(--border)';
        b.style.background  = isAvholdt ? 'rgba(26,138,106,.1)' : 'transparent';
        b.style.color       = isAvholdt ? 'var(--color-signed)' : 'var(--muted)';
      });

    } catch (e) {
      const errEl = el.querySelector('#lk-error');
      errEl.textContent = 'Feil: ' + e.message;
      errEl.style.display = '';
    } finally {
      submitBtn.disabled   = !invIdHidden.value;
      submitBtn.textContent = '✓ Logg kontakt';
    }
  });
}

// ── Main render ───────────────────────────────────────────────────────────────
export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted">Laster&hellip;</p></div>';

  try {
    [_lookups, _investors, _products] = await Promise.all([
      api.lookups(),
      api.investors({}),
      api.products(),
    ]);
  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:#c0392b;">Feil: ${window.escHtml(e.message)}</p></div>`;
    return;
  }

  const currentUserName = state.currentUser?.displayName || '';
  el.innerHTML = buildHTML(_lookups, currentUserName);
  setupEvents(el, state);
}
