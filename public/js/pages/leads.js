import { api } from '../api.js';

const esc = window.escHtml;

export async function render(el, state) {
  const isAdmin = state?.currentUser?.role === 'admin';
  el.innerHTML = '<div class="content"><p class="text-muted">Laster…</p></div>';

  let leads, dupMap;
  try {
    const [raw, dups] = await Promise.all([
      api.investors({ leads: 1 }),
      api.leadDuplicates().catch(() => ({})),
    ]);
    leads = Array.isArray(raw) ? raw : (raw.investors || []);
    dupMap = dups || {};
  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:#c0392b">Feil: ${esc(e.message)}</p></div>`;
    return;
  }

  // Distinkte tagger på tvers av leadene — bygger filter-alternativene.
  const allTags = [...new Set(leads.flatMap(l => l.tags || []))].sort((a, b) => a.localeCompare(b, 'nb'));
  const dupCount = leads.filter(l => dupMap[l.id]).length;
  // Trygge for bulk-merge: 100%-treff der målet er en KVALIFISERT investor (ikke et annet lead)
  // — da forsvinner ikke merge-målet under batchen.
  const sureIds = () => leads.filter(l => dupMap[l.id]?.score === 100 && !dupMap[l.id].is_lead);
  let tagFilter = '';
  let dupOnly = false;

  function visible() {
    let list = leads;
    if (tagFilter) list = list.filter(l => (l.tags || []).includes(tagFilter));
    if (dupOnly)   list = list.filter(l => dupMap[l.id]);
    // Mulige duplikater først (høyest score øverst), så resten.
    return [...list].sort((a, b) => (dupMap[b.id]?.score || 0) - (dupMap[a.id]?.score || 0));
  }

  function kildeCell(l) {
    const tags = l.tags || [];
    if (!tags.length) return `<span style="color:var(--muted);font-size:13px">${esc(l.source || '—')}</span>`;
    return `<div style="display:flex;flex-wrap:wrap;gap:3px">${tags.map(t =>
      `<span style="display:inline-block;padding:2px 9px;border-radius:20px;background:rgba(52,152,219,.1);color:var(--blue);font-size:11px;font-weight:600">${esc(t)}</span>`
    ).join('')}</div>`;
  }

  function dupBadge(l) {
    const d = dupMap[l.id];
    if (!d) return '';
    return `<div style="font-size:11px;color:#c0392b;margin-top:3px">⚠ ligner <b>${esc(d.name)}</b> (${d.score}%${d.is_lead ? ', lead' : ''})</div>`;
  }

  function buildRows(list) {
    if (!list.length)
      return `<tr><td colspan="5" class="empty-state">${dupOnly ? 'Ingen mulige duplikater. 🎉' : tagFilter ? 'Ingen leads med denne taggen.' : 'Ingen ukvalifiserte leads igjen. 🎉'}</td></tr>`;
    return list.map(l => {
      const d = dupMap[l.id];
      return `
      <tr data-id="${esc(String(l.id))}"${d ? ' style="background:rgba(192,57,43,.03)"' : ''}>
        <td style="font-weight:600;padding:11px 14px">
          <span class="lead-name" style="color:var(--blue);cursor:pointer">${esc(l.name || '—')}</span>${window.brregBadge(l)}
          ${dupBadge(l)}
        </td>
        <td style="color:var(--muted);font-size:13px;padding:11px 14px">${esc(l.investor_type || '—')}</td>
        <td style="color:var(--muted);font-size:13px;padding:11px 14px">${esc(l.city || l.country || '—')}</td>
        <td style="padding:11px 14px">${kildeCell(l)}</td>
        <td style="padding:11px 14px">
          <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
            ${d && isAdmin ? `<button class="btn btn-ghost btn-sm lead-merge" data-id="${esc(String(l.id))}" data-keep="${esc(String(d.id))}" data-keepname="${esc(d.name)}" style="min-height:36px;color:#8e44ad">Slå sammen</button>` : ''}
            <button class="btn btn-primary btn-sm lead-qualify" data-id="${esc(String(l.id))}" style="min-height:36px">Kvalifiser</button>
            ${isAdmin ? `<button class="btn btn-ghost btn-sm lead-discard" data-id="${esc(String(l.id))}" data-name="${esc(l.name || '')}" style="min-height:36px;color:#e74c3c">Forkast</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  const filterBar = (allTags.length || dupCount) ? `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">
      ${allTags.length ? `
        <label style="font-size:12px;color:var(--muted)">Kilde/tag:</label>
        <select id="lead-tag-filter" style="font-size:12px;padding:5px 8px;border-radius:7px;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;min-height:36px">
          <option value="">Alle kilder</option>
          ${allTags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
        </select>` : ''}
      ${dupCount ? `
        <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none">
          <input type="checkbox" id="lead-dup-only" style="width:15px;height:15px;cursor:pointer">
          ⚠ Kun mulige duplikater (${dupCount})
        </label>` : ''}
      ${isAdmin && sureIds().length ? `
        <button id="lead-merge-all" class="btn btn-ghost btn-sm" style="min-height:36px;color:#8e44ad;border-color:#8e44ad;margin-left:auto">
          ⚡ Slå sammen alle 100% (${sureIds().length})
        </button>` : ''}
    </div>` : '';

  el.innerHTML = `
    <div class="topbar"><span class="topbar-title">Ukvalifiserte leads (<span id="lead-count">${leads.length}</span>)</span></div>
    <div class="content">
      <p class="text-muted" style="font-size:13px;margin-bottom:12px">
        Importerte prospekter som ennå ikke er tatt inn i CRM-et. <b>Kvalifiser</b> gjør leadet til en investor i fasen «Prospekt».${isAdmin ? ' <b>Slå sammen</b> fletter et duplikat inn i den eksisterende (kilde-tags bevares). <b>Forkast</b> flytter til papirkurven.' : ''}
      </p>
      ${filterBar}
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Navn</th><th>Type</th><th>Sted</th><th>Kilde</th><th style="width:240px"></th></tr></thead>
            <tbody class="lead-tbody">${buildRows(visible())}</tbody>
          </table>
        </div>
      </div>
    </div>`;

  const tbody = el.querySelector('.lead-tbody');

  function refresh() {
    tbody.innerHTML = buildRows(visible());
    const countEl = el.querySelector('#lead-count');
    if (countEl) countEl.textContent = visible().length;
    bind();
  }

  function removeRow(id) {
    leads = leads.filter(l => String(l.id) !== String(id));
    delete dupMap[id];
    refresh();
  }

  function bind() {
    tbody.querySelectorAll('.lead-name').forEach(n => {
      n.addEventListener('click', () => window.navigate('detalj', n.closest('tr').dataset.id));
    });

    tbody.querySelectorAll('.lead-qualify').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Kvalifiserer…';
        try {
          const inv = await api.qualifyLead(btn.dataset.id);
          window.ui.toast(`${inv.name} er nå investor (Prospekt)`, 'success');
          removeRow(btn.dataset.id);
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Kvalifiser';
          window.ui.toast('Kunne ikke kvalifisere: ' + e.message, 'error');
        }
      });
    });

    tbody.querySelectorAll('.lead-merge').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dropId = btn.dataset.id;
        const keepId = btn.dataset.keep;
        const lead   = leads.find(l => String(l.id) === String(dropId));
        if (!window.confirm(`Slå «${lead?.name}» sammen inn i «${btn.dataset.keepname}»?\n\nKontakter, logg og kilde-tags flyttes over, og lead-raden fjernes.`)) return;
        btn.disabled = true; btn.textContent = 'Slår sammen…';
        try {
          await api.merge(keepId, dropId);
          window.ui.toast(`Slått sammen inn i ${btn.dataset.keepname}`, 'success');
          removeRow(dropId);
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Slå sammen';
          window.ui.toast('Kunne ikke slå sammen: ' + e.message, 'error');
        }
      });
    });

    tbody.querySelectorAll('.lead-discard').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name || 'dette leadet';
        if (!window.confirm(`Forkaste ${name}?\n\nLeadet flyttes til papirkurven.`)) return;
        btn.disabled = true;
        try {
          await api.deleteInvestor(btn.dataset.id);
          window.ui.toast('Lead forkastet', 'info');
          removeRow(btn.dataset.id);
        } catch (e) {
          btn.disabled = false;
          window.ui.toast('Kunne ikke forkaste: ' + e.message, 'error');
        }
      });
    });
  }

  const tagSelect = el.querySelector('#lead-tag-filter');
  if (tagSelect) tagSelect.addEventListener('change', () => { tagFilter = tagSelect.value; refresh(); });

  const dupToggle = el.querySelector('#lead-dup-only');
  if (dupToggle) dupToggle.addEventListener('change', () => { dupOnly = dupToggle.checked; refresh(); });

  const mergeAllBtn = el.querySelector('#lead-merge-all');
  if (mergeAllBtn) {
    mergeAllBtn.addEventListener('click', async () => {
      const targets = sureIds();
      if (!targets.length) return;
      if (!window.confirm(`Slå sammen ${targets.length} lead${targets.length === 1 ? '' : 's'} med 100 %-treff inn i sine eksisterende investorer?\n\nKontakter, logg og kilde-tags flyttes over, og lead-radene fjernes. Treff på 60–99 % må vurderes manuelt.`)) return;
      mergeAllBtn.disabled = true;
      let ok = 0, fail = 0;
      for (const l of targets) {
        mergeAllBtn.textContent = `Slår sammen… (${ok + fail + 1}/${targets.length})`;
        try { await api.merge(dupMap[l.id].id, l.id); ok++; }
        catch { fail++; }
      }
      window.ui.toast(`Slo sammen ${ok} duplikat${ok === 1 ? '' : 'er'}${fail ? `, ${fail} feilet` : ''}`, fail ? 'error' : 'success');
      await render(el, state);
    });
  }

  bind();
}
