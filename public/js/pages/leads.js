import { api } from '../api.js';

const esc = window.escHtml;

function fmtDate(ts) {
  try { return new Date(ts).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return ts; }
}

export async function render(el, state) {
  const isAdmin = state?.currentUser?.role === 'admin';
  el.innerHTML = '<div class="content"><p class="text-muted">Laster…</p></div>';

  let leads, dupMap;
  try {
    const [raw, dups] = await Promise.all([
      api.investors({ leads: 1, includeDiscarded: 1 }),
      api.leadDuplicates().catch(() => ({})),
    ]);
    leads = Array.isArray(raw) ? raw : (raw.investors || []);
    dupMap = dups || {};
  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:#c0392b">Feil: ${esc(e.message)}</p></div>`;
    return;
  }

  let tagFilter = '';
  let dupOnly = false;
  let showDiscarded = false;

  const active     = () => leads.filter(l => !l.discarded_at);
  const discarded  = () => leads.filter(l => l.discarded_at);
  const allTags    = () => [...new Set(leads.flatMap(l => l.tags || []))].sort((a, b) => a.localeCompare(b, 'nb'));
  const dupCount   = () => active().filter(l => dupMap[l.id]).length;
  const sureIds    = () => active().filter(l => dupMap[l.id]?.score === 100 && !dupMap[l.id].is_lead);

  function visible() {
    let list = showDiscarded ? discarded() : active();
    if (tagFilter) list = list.filter(l => (l.tags || []).includes(tagFilter));
    if (!showDiscarded && dupOnly) list = list.filter(l => dupMap[l.id]);
    return [...list].sort((a, b) => (dupMap[b.id]?.score || 0) - (dupMap[a.id]?.score || 0));
  }

  function kildeCell(l) {
    const tags = l.tags || [];
    if (!tags.length) return `<span style="color:var(--muted);font-size:13px">${esc(l.source || '—')}</span>`;
    return `<div style="display:flex;flex-wrap:wrap;gap:3px">${tags.map(t =>
      `<span style="display:inline-block;padding:2px 9px;border-radius:20px;background:rgba(52,152,219,.1);color:var(--blue);font-size:11px;font-weight:600">${esc(t)}</span>`
    ).join('')}</div>`;
  }

  function nameCell(l) {
    const d = dupMap[l.id];
    const dupLine = (!l.discarded_at && d) ? `<div style="font-size:11px;color:#c0392b;margin-top:3px">⚠ ligner <b>${esc(d.name)}</b> (${d.score}%${d.is_lead ? ', lead' : ''})</div>` : '';
    const discLine = l.discarded_at ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">Forkastet ${esc(fmtDate(l.discarded_at))}${l.discarded_by ? ' · ' + esc(l.discarded_by) : ''}</div>` : '';
    return `<span class="lead-name" style="color:var(--blue);cursor:pointer">${esc(l.name || '—')}</span>${window.brregBadge(l)}${dupLine}${discLine}`;
  }

  function actions(l) {
    const id = esc(String(l.id));
    if (l.discarded_at) {
      return `
        <button class="btn btn-green btn-sm lead-restore" data-id="${id}" style="min-height:36px">↩ Gjenopprett</button>
        ${isAdmin ? `<button class="btn btn-ghost btn-sm lead-delete" data-id="${id}" data-name="${esc(l.name || '')}" style="min-height:36px;color:#e74c3c">Slett</button>` : ''}`;
    }
    const d = dupMap[l.id];
    return `
      ${d && isAdmin ? `<button class="btn btn-ghost btn-sm lead-merge" data-id="${id}" data-keep="${esc(String(d.id))}" data-keepname="${esc(d.name)}" style="min-height:36px;color:#8e44ad">Slå sammen</button>` : ''}
      <button class="btn btn-primary btn-sm lead-qualify" data-id="${id}" style="min-height:36px">Kvalifiser</button>
      ${isAdmin ? `<button class="btn btn-ghost btn-sm lead-discard" data-id="${id}" style="min-height:36px;color:#e67e22">Forkast</button>` : ''}
      ${isAdmin ? `<button class="btn btn-ghost btn-sm lead-delete" data-id="${id}" data-name="${esc(l.name || '')}" style="min-height:36px;color:#e74c3c">Slett</button>` : ''}`;
  }

  function buildRows(list) {
    if (!list.length) {
      const msg = showDiscarded ? 'Ingen forkastede leads.'
        : dupOnly ? 'Ingen mulige duplikater. 🎉'
        : tagFilter ? 'Ingen leads med denne taggen.'
        : 'Ingen ukvalifiserte leads igjen. 🎉';
      return `<tr><td colspan="5" class="empty-state">${msg}</td></tr>`;
    }
    return list.map(l => `
      <tr data-id="${esc(String(l.id))}"${(!l.discarded_at && dupMap[l.id]) ? ' style="background:rgba(192,57,43,.03)"' : l.discarded_at ? ' style="opacity:.7"' : ''}>
        <td style="font-weight:600;padding:11px 14px">${nameCell(l)}</td>
        <td style="color:var(--muted);font-size:13px;padding:11px 14px">${esc(l.investor_type || '—')}</td>
        <td style="color:var(--muted);font-size:13px;padding:11px 14px">${esc(l.city || l.country || '—')}</td>
        <td style="padding:11px 14px">${kildeCell(l)}</td>
        <td style="padding:11px 14px"><div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">${actions(l)}</div></td>
      </tr>`).join('');
  }

  function filterBar() {
    const tags = allTags();
    const dc = dupCount();
    const disc = discarded().length;
    const sure = sureIds().length;
    return `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">
        ${tags.length ? `
          <label style="font-size:12px;color:var(--muted)">Kilde/tag:</label>
          <select id="lead-tag-filter" style="font-size:12px;padding:5px 8px;border-radius:7px;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;min-height:36px">
            <option value="">Alle kilder</option>
            ${tags.map(t => `<option value="${esc(t)}"${t === tagFilter ? ' selected' : ''}>${esc(t)}</option>`).join('')}
          </select>` : ''}
        ${!showDiscarded && dc ? `
          <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none">
            <input type="checkbox" id="lead-dup-only" ${dupOnly ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer">
            ⚠ Kun mulige duplikater (${dc})
          </label>` : ''}
        ${!showDiscarded && isAdmin && sure ? `
          <button id="lead-merge-all" class="btn btn-ghost btn-sm" style="min-height:36px;color:#8e44ad;border-color:#8e44ad">
            ⚡ Slå sammen alle 100% (${sure})
          </button>` : ''}
        <button id="lead-toggle-discarded" class="btn btn-ghost btn-sm" style="min-height:36px;margin-left:auto${showDiscarded ? ';color:var(--blue);border-color:var(--blue)' : ''}">
          ${showDiscarded ? '← Aktive leads' : `Vis forkastede (${disc})`}
        </button>
      </div>`;
  }

  function paint() {
    const title = showDiscarded ? 'Forkastede leads' : 'Ukvalifiserte leads';
    el.innerHTML = `
      <div class="topbar"><span class="topbar-title">${title} (<span id="lead-count">${visible().length}</span>)</span></div>
      <div class="content">
        <p class="text-muted" style="font-size:13px;margin-bottom:12px">
          ${showDiscarded
            ? 'Avviste leads. De er ikke slettet — <b>Gjenopprett</b> tar dem tilbake, og de dukker opp igjen automatisk hvis de treffer i en ny import. <b>Slett</b> flytter til papirkurven.'
            : `Importerte prospekter som ennå ikke er tatt inn i CRM-et. <b>Kvalifiser</b> gjør leadet til en investor i fasen «Prospekt».${isAdmin ? ' <b>Forkast</b> avviser (beholdes, kan komme igjen). <b>Slett</b> flytter til papirkurven.' : ''}`}
        </p>
        ${filterBar()}
        <div class="card" style="padding:0;overflow:hidden">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Navn</th><th>Type</th><th>Sted</th><th>Kilde</th><th style="width:260px"></th></tr></thead>
              <tbody class="lead-tbody">${buildRows(visible())}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    bind();
  }

  function bind() {
    el.querySelectorAll('.lead-name').forEach(n => {
      n.addEventListener('click', () => window.navigate('detalj', n.closest('tr').dataset.id));
    });

    el.querySelectorAll('.lead-qualify').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Kvalifiserer…';
      try {
        const inv = await api.qualifyLead(btn.dataset.id);
        window.ui.toast(`${inv.name} er nå investor (Prospekt)`, 'success');
        leads = leads.filter(l => String(l.id) !== String(btn.dataset.id)); delete dupMap[btn.dataset.id]; paint();
      } catch (e) { btn.disabled = false; btn.textContent = 'Kvalifiser'; window.ui.toast('Kunne ikke kvalifisere: ' + e.message, 'error'); }
    }));

    el.querySelectorAll('.lead-discard').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const u = await api.discardLead(btn.dataset.id, true);
        const l = leads.find(x => String(x.id) === String(btn.dataset.id));
        if (l) { l.discarded_at = u.discarded_at || new Date().toISOString(); l.discarded_by = u.discarded_by; }
        window.ui.toast('Lead forkastet (kan hentes fram igjen)', 'info');
        paint();
      } catch (e) { btn.disabled = false; window.ui.toast('Kunne ikke forkaste: ' + e.message, 'error'); }
    }));

    el.querySelectorAll('.lead-restore').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api.discardLead(btn.dataset.id, false);
        const l = leads.find(x => String(x.id) === String(btn.dataset.id));
        if (l) { l.discarded_at = null; l.discarded_by = null; }
        window.ui.toast('Lead gjenopprettet', 'success');
        paint();
      } catch (e) { btn.disabled = false; window.ui.toast('Kunne ikke gjenopprette: ' + e.message, 'error'); }
    }));

    el.querySelectorAll('.lead-delete').forEach(btn => btn.addEventListener('click', async () => {
      const name = btn.dataset.name || 'dette leadet';
      if (!window.confirm(`Slette ${name}?\n\nLeadet flyttes til papirkurven.`)) return;
      btn.disabled = true;
      try {
        await api.deleteInvestor(btn.dataset.id);
        window.ui.toast('Lead slettet (papirkurv)', 'info');
        leads = leads.filter(l => String(l.id) !== String(btn.dataset.id)); delete dupMap[btn.dataset.id]; paint();
      } catch (e) { btn.disabled = false; window.ui.toast('Kunne ikke slette: ' + e.message, 'error'); }
    }));

    el.querySelectorAll('.lead-merge').forEach(btn => btn.addEventListener('click', async () => {
      const dropId = btn.dataset.id, keepId = btn.dataset.keep;
      const lead = leads.find(l => String(l.id) === String(dropId));
      if (!window.confirm(`Slå «${lead?.name}» sammen inn i «${btn.dataset.keepname}»?\n\nKontakter, logg og kilde-tags flyttes over, og lead-raden fjernes.`)) return;
      btn.disabled = true; btn.textContent = 'Slår sammen…';
      try {
        await api.merge(keepId, dropId);
        window.ui.toast(`Slått sammen inn i ${btn.dataset.keepname}`, 'success');
        leads = leads.filter(l => String(l.id) !== String(dropId)); delete dupMap[dropId]; paint();
      } catch (e) { btn.disabled = false; btn.textContent = 'Slå sammen'; window.ui.toast('Kunne ikke slå sammen: ' + e.message, 'error'); }
    }));

    const tagSelect = el.querySelector('#lead-tag-filter');
    if (tagSelect) tagSelect.addEventListener('change', () => { tagFilter = tagSelect.value; paint(); });

    const dupToggle = el.querySelector('#lead-dup-only');
    if (dupToggle) dupToggle.addEventListener('change', () => { dupOnly = dupToggle.checked; paint(); });

    const discToggle = el.querySelector('#lead-toggle-discarded');
    if (discToggle) discToggle.addEventListener('click', () => { showDiscarded = !showDiscarded; dupOnly = false; paint(); });

    const mergeAllBtn = el.querySelector('#lead-merge-all');
    if (mergeAllBtn) mergeAllBtn.addEventListener('click', async () => {
      const targets = sureIds();
      if (!targets.length) return;
      if (!window.confirm(`Slå sammen ${targets.length} lead${targets.length === 1 ? '' : 's'} med 100 %-treff inn i sine eksisterende investorer?\n\nKontakter, logg og kilde-tags flyttes over, og lead-radene fjernes. Treff på 60–99 % må vurderes manuelt.`)) return;
      mergeAllBtn.disabled = true;
      let ok = 0, fail = 0;
      for (const l of targets) {
        mergeAllBtn.textContent = `Slår sammen… (${ok + fail + 1}/${targets.length})`;
        try { await api.merge(dupMap[l.id].id, l.id); ok++; } catch { fail++; }
      }
      window.ui.toast(`Slo sammen ${ok} duplikat${ok === 1 ? '' : 'er'}${fail ? `, ${fail} feilet` : ''}`, fail ? 'error' : 'success');
      await render(el, state);
    });
  }

  paint();
}
