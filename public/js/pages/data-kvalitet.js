import { api } from '../api.js';

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted" style="padding:24px">Laster…</p></div>';

  let data;
  try {
    data = await api.dataQuality();
  } catch (e) {
    el.innerHTML = `<div class="topbar"><span class="topbar-title">Datakvalitet</span></div>
      <div class="content"><p style="color:red">Feil: ${window.escHtml(e.message)}</p></div>`;
    return;
  }

  function investorLinks(items) {
    if (!items.length) return '<p class="text-muted" style="font-size:13px;padding:8px 0">Ingen</p>';
    return items.map(i =>
      `<div style="padding:4px 0;font-size:13px">
        <a href="#" class="inv-link" data-id="${window.escHtml(i.id)}"
           style="color:var(--accent);text-decoration:none">${window.escHtml(i.name)}</a>
        ${i.last_contact ? `<span style="color:var(--muted);margin-left:8px">${window.escHtml(i.last_contact)}</span>` : ''}
      </div>`
    ).join('');
  }

  function card(icon, title, count, items, colorClass) {
    const isOk = count === 0;
    const countColor = isOk ? 'var(--color-signed)' : (count > 10 ? '#e74c3c' : '#e67e22');
    return `
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span style="font-size:18px">${icon}</span>
          <span style="font-weight:600;font-size:14px;flex:1">${window.escHtml(title)}</span>
          <span style="font-size:22px;font-weight:700;color:${countColor}">${count}</span>
        </div>
        ${isOk
          ? `<p style="font-size:13px;color:var(--color-signed)">✓ Alt i orden</p>`
          : `<details style="margin-top:4px">
               <summary style="font-size:12px;color:var(--muted);cursor:pointer;user-select:none">Vis liste</summary>
               <div style="margin-top:8px;max-height:240px;overflow-y:auto">${investorLinks(items)}</div>
             </details>`
        }
      </div>`;
  }

  const piMissing = data.piMissingData;

  el.innerHTML = `
    <div class="topbar">
      <span class="topbar-title">Datakvalitet</span>
    </div>
    <div class="content">
      <p style="font-size:13px;color:var(--muted);margin-bottom:24px">
        Oversikt over hull i investor-dataene. Klikk på en investor for å åpne den.
      </p>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
        ${card('📧', 'Ingen e-post på kontaktperson',    data.noContactEmail.count, data.noContactEmail.items)}
        ${card('👤', 'Mangler ansvarlig (lead)',          data.noLead.count,         data.noLead.items)}
        ${card('🏷', 'Mangler fase',                      data.noPhase.count,        data.noPhase.items)}
        ${card('📅', 'Ingen sist-kontakt registrert',     data.noLastContact.count,  data.noLastContact.items)}
        ${card('🏢', 'Ikke koblet til Brreg',             data.noBrreg.count,        data.noBrreg.items)}
        ${card('⏱', 'Ingen aktivitet siste 30 dager',    data.inactive30days.count, data.inactive30days.items)}
        ${card('⏱', 'Ingen aktivitet siste 60 dager',    data.inactive60days.count, data.inactive60days.items)}
        ${card('⏱', 'Ingen aktivitet siste 90 dager',    data.inactive90days.count, data.inactive90days.items)}
      </div>

      ${piMissing.count > 0 ? `
        <div class="card" style="margin-top:4px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <span style="font-size:18px">📊</span>
            <span style="font-weight:600;font-size:14px;flex:1">Produktkoblinger uten ticket eller sannsynlighet</span>
            <span style="font-size:22px;font-weight:700;color:#e67e22">${piMissing.count}</span>
          </div>
          <p style="font-size:13px;color:var(--muted)">
            Disse investor-produkt-koblingene mangler data som brukes i pipeline-beregninger.
            Gå til produktsiden for å fylle inn.
          </p>
        </div>` : `
        <div class="card" style="margin-top:4px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:18px">📊</span>
            <span style="font-weight:600;font-size:14px;flex:1">Produktkoblinger uten ticket eller sannsynlighet</span>
            <span style="font-size:22px;font-weight:700;color:var(--color-signed)">0</span>
          </div>
          <p style="font-size:13px;color:var(--color-signed);margin-top:8px">✓ Alt i orden</p>
        </div>`}
    </div>`;

  el.querySelectorAll('.inv-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      window.navigate('detalj', a.dataset.id);
    });
  });
}
