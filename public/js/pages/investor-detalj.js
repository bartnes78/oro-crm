import { api } from '../api.js';

function addDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── HTML builders ─────────────────────────────────────────────────────────────

function buildDetailHeader(inv, products) {
  const prodMap = Object.fromEntries(products.map(p => [p._id, p]));
  const interestedProds = (inv.product_interests || []).map(id => prodMap[id]).filter(Boolean);

  const prodPills = interestedProds.map(p => `
    <span style="display:inline-flex;align-items:center;gap:4px;">
      <span>&#9733; ${window.escHtml(p.name)}</span>
      <button
        class="btn-quick-decline"
        data-product-id="${window.escHtml(String(p._id))}"
        title="Registrer avslag"
        style="background:none;border:none;cursor:pointer;color:#e74c3c;font-size:13px;padding:0 2px;line-height:1;opacity:.5;min-width:24px;min-height:24px;display:inline-flex;align-items:center;justify-content:center;"
        onmouseenter="this.style.opacity=1"
        onmouseleave="this.style.opacity=.5"
      >&#x2715;</button>
    </span>
  `).join('');

  return `
    <div class="detail-header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${window.escHtml(String(inv.id))}</div>
          <h2 style="margin:0;">${window.escHtml(inv.name)}</h2>
        </div>
        ${window.phaseBadge(inv.phase)}
      </div>
      <div class="detail-meta" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:10px;font-size:13px;color:var(--muted);">
        <span>&#128205; ${window.escHtml([inv.city, inv.country || 'Norge'].filter(Boolean).join(', '))}</span>
        ${inv.investor_type ? `<span>&#127991; ${window.escHtml(inv.investor_type)}</span>` : ''}
        ${inv.lead ? `<span>&#128100; Lead: ${window.escHtml(inv.lead)}</span>` : ''}
        ${inv.advisor ? `<span>&#129309; ${window.escHtml(inv.advisor)}</span>` : ''}
        ${interestedProds.length > 0 ? `<span style="display:contents;">${prodPills}</span>` : ''}
      </div>
    </div>
  `;
}

function buildPipelineCard(inv) {
  const weighted = inv.target_ticket && inv.probability
    ? window.fmt(inv.target_ticket * inv.probability, 1) + ' MNOK' : '—';

  const rows = [
    ['M&aring;lticket', window.fmt(inv.target_ticket) + (inv.target_ticket != null ? ' MNOK' : '')],
    ['Sannsynlighet', inv.probability != null ? Math.round(inv.probability * 100) + '%' : '—'],
    ['Vektet volum', weighted],
    ['First Close', inv.first_close ? 'Ja' : 'Nei'],
    ['Sist kontaktet', window.escHtml(inv.last_contact || '—')],
  ].map(([l, v]) => `
    <div class="info-item">
      <label>${l}</label>
      <p>${v}</p>
    </div>
  `).join('');

  return `
    <div class="card">
      <div class="card-title">Pipeline</div>
      <div class="info-grid">${rows}</div>
      ${inv.next_steps ? `
        <div style="margin-top:14px;">
          <label style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;">Hva skal til</label>
          <p style="margin-top:4px;font-size:13px;line-height:1.5;">${window.escHtml(inv.next_steps)}</p>
        </div>` : ''}
      ${inv.comments ? `
        <div style="margin-top:14px;">
          <label style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;">Kommentar</label>
          <p style="margin-top:4px;font-size:13px;line-height:1.5;">${window.escHtml(inv.comments)}</p>
        </div>` : ''}
    </div>
  `;
}

function buildDocsCard(inv, products) {
  const docs = inv.docs || {};
  const docItems = [
    { key: 'nda',         label: 'NDA signert',       hasVersion: false },
    { key: 'deck',        label: 'Deck sendt',        hasVersion: true  },
    { key: 'im_ppm',      label: 'IM/PPM sendt',      hasVersion: false },
    { key: 'fondsvilkar', label: 'Fondsvilk&aring;r sendt', hasVersion: false },
  ];
  const archivedPhases = ['Tegnet', 'Onboardet', 'Ikke relevant n&aring;'];
  const isArchived = ['Tegnet', 'Onboardet', 'Ikke relevant nå'].includes(inv.phase);

  const relevantProducts = products.filter(p => (inv.product_interests || []).includes(p._id));
  if (relevantProducts.length === 0) return '';

  const activeProds = isArchived
    ? relevantProducts.filter(p => docItems.some(i => (docs[String(p._id)] || {})[i.key]?.done))
    : relevantProducts;

  if (isArchived && activeProds.length === 0) return '';

  function buildDocProduct(p, archived) {
    const pd = docs[String(p._id)] || {};
    const doneCount = docItems.filter(i => pd[i.key]?.done).length;

    const rows = docItems.map(({ key, label, hasVersion }) => {
      const d = pd[key] || {};
      const disAttr = archived ? ' disabled' : '';
      return `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
          <input type="checkbox"
            class="doc-checkbox"
            data-product-id="${window.escHtml(String(p._id))}"
            data-doc-key="${key}"
            ${d.done ? 'checked' : ''}
            ${disAttr}
            style="width:16px;height:16px;cursor:${archived ? 'default' : 'pointer'};flex-shrink:0;min-width:16px;min-height:16px;" />
          <span style="font-size:13px;width:140px;opacity:${d.done ? 1 : .5};">${label}</span>
          <input type="date"
            class="doc-date"
            data-product-id="${window.escHtml(String(p._id))}"
            data-doc-key="${key}"
            value="${window.escHtml(d.date || '')}"
            ${disAttr}
            style="font-size:12px;padding:3px 6px;border-radius:5px;border:1px solid var(--border);width:130px;opacity:${d.done ? 1 : .4};" />
          ${hasVersion ? `
          <input type="text"
            class="doc-version"
            data-product-id="${window.escHtml(String(p._id))}"
            data-doc-key="${key}"
            value="${window.escHtml(d.version || '')}"
            placeholder="Versjon&hellip;"
            ${disAttr}
            style="font-size:12px;padding:3px 8px;border-radius:5px;border:1px solid var(--border);width:90px;" />
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <details ${!archived ? 'open' : ''} style="margin-bottom:8px;opacity:${archived ? .65 : 1};">
        <summary style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);cursor:pointer;padding-bottom:8px;user-select:none;list-style:none;display:flex;align-items:center;gap:6px;">
          ${window.escHtml(p.name)}
          ${doneCount > 0 ? `<span style="color:${archived ? 'var(--muted)' : '#1A8A6A'};font-size:11px;">&#10003; ${doneCount}/${docItems.length}</span>` : ''}
          ${archived ? '<span style="font-size:10px;color:var(--muted);font-style:italic;">arkivert</span>' : ''}
        </summary>
        <div style="display:flex;flex-direction:column;padding-left:4px;padding-bottom:8px;">
          ${rows}
        </div>
      </details>
    `;
  }

  const productsHtml = activeProds.map(p => buildDocProduct(p, isArchived)).join('');

  return `
    <div class="card">
      <div class="card-title">
        Dokumenter
        ${isArchived ? '<span style="margin-left:8px;font-size:11px;color:var(--muted);font-style:italic;font-weight:400;">arkiv</span>' : ''}
      </div>
      ${productsHtml}
    </div>
  `;
}

function buildContactsCard(inv, visInaktive) {
  const contacts = (inv.contacts || []).filter(c => c.active !== 0 || visInaktive);
  const inaktiveCount = (inv.contacts || []).filter(c => c.active === 0).length;

  const contactsHtml = contacts.length === 0
    ? '<p class="text-muted" style="font-size:13px;">Ingen kontakter registrert.</p>'
    : contacts.map(c => {
        const inaktiv = c.active === 0;
        return `
          <div style="border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:12px;opacity:${inaktiv ? .45 : 1};">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-weight:600;font-size:14px;text-decoration:${inaktiv ? 'line-through' : 'none'};">${window.escHtml(c.name)}</span>
                ${c.is_primary === 1 && !inaktiv ? '<span class="badge badge-prospect" style="font-size:10px;">Prim&aelig;r</span>' : ''}
                ${inaktiv ? '<span style="font-size:10px;color:var(--muted);font-style:italic;">inaktiv</span>' : ''}
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${!inaktiv ? `<button class="btn btn-ghost btn-sm contact-edit-btn" data-contact-id="${window.escHtml(String(c._id))}" style="font-size:11px;padding:2px 8px;min-height:32px;">Rediger</button>` : ''}
                <button class="btn btn-ghost btn-sm contact-toggle-btn" data-contact-id="${window.escHtml(String(c._id))}" data-active="${inaktiv ? 0 : 1}" style="font-size:11px;padding:2px 8px;color:${inaktiv ? '#1A8A6A' : '#e07000'};min-height:32px;">${inaktiv ? 'Aktiver' : 'Deaktiver'}</button>
                <button class="btn btn-ghost btn-sm contact-delete-btn" data-contact-id="${window.escHtml(String(c._id))}" style="font-size:11px;padding:2px 8px;color:#e74c3c;min-height:32px;">Slett</button>
              </div>
            </div>
            ${c.title ? `<div style="font-size:12px;color:var(--muted);margin-top:2px;">${window.escHtml(c.title)}</div>` : ''}
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;">
              ${c.email ? `<a href="mailto:${window.escHtml(c.email)}" style="font-size:12px;color:var(--blue);text-decoration:none;">&#9993; ${window.escHtml(c.email)}</a>` : ''}
              ${c.phone ? `<span style="font-size:12px;color:#555;">&#128222; ${window.escHtml(c.phone)}</span>` : ''}
              ${c.notes ? `<span style="font-size:11px;color:#aaa;font-style:italic;">${window.escHtml(c.notes)}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <div class="card-title" style="margin:0;">Kontakter</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${inaktiveCount > 0 ? `
            <button class="btn btn-ghost btn-sm" id="toggle-inaktive" style="font-size:11px;opacity:.7;min-height:36px;">
              ${visInaktive ? 'Skjul inaktive' : `Vis inaktive (${inaktiveCount})`}
            </button>` : ''}
          <button class="btn btn-ghost btn-sm" id="add-contact-btn" style="min-height:36px;">+ Legg til</button>
        </div>
      </div>
      ${contactsHtml}
    </div>
  `;
}

function buildProductCard(inv, products, piData) {
  if (products.length === 0) return '';
  const piMap = Object.fromEntries(piData.map(pi => [pi.product_id, pi]));
  const interests = new Set(inv.product_interests || []);

  const rows = products.map(p => {
    const interested = interests.has(p._id);
    const pi = piMap[p._id] || {};
    const isTegnet  = pi.committed_amount != null;
    const isDeclined = !!pi.decline_reason;

    return `
      <div class="pi-row" style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;flex-wrap:wrap;gap:10px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;min-width:170px;">
          <input type="checkbox" class="pi-toggle" data-pid="${window.escHtml(String(p._id))}"
            ${interested ? 'checked' : ''}
            style="width:16px;height:16px;cursor:pointer;accent-color:var(--blue);flex-shrink:0;" />
          <span style="font-weight:${interested ? 600 : 400};font-size:14px;color:${interested ? 'var(--text)' : 'var(--muted)'};">
            ${window.escHtml(p.name)}
          </span>
        </label>
        ${interested ? `
          <div style="display:flex;align-items:center;gap:4px;">
            <input class="pi-ticket" type="number" step="0.5" data-pid="${window.escHtml(String(p._id))}"
              value="${pi.target_ticket != null ? pi.target_ticket : ''}" placeholder="—"
              style="width:75px;font-size:12px;padding:3px 6px;border-radius:5px;border:1px solid var(--border);text-align:right;" />
            <span style="font-size:12px;color:var(--muted);">MNOK</span>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <input class="pi-prob" type="number" min="0" max="100" step="5" data-pid="${window.escHtml(String(p._id))}"
              value="${pi.probability != null ? Math.round(pi.probability * 100) : ''}" placeholder="—"
              style="width:60px;font-size:12px;padding:3px 6px;border-radius:5px;border:1px solid var(--border);text-align:right;" />
            <span style="font-size:12px;color:var(--muted);">%</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-left:auto;">
            ${isTegnet ? `<span style="font-size:11px;padding:2px 10px;border-radius:20px;background:rgba(26,138,106,.12);color:#1A8A6A;font-weight:700;">&#10003; Tegnet${pi.committed_amount ? ' ' + pi.committed_amount + 'M' : ''}</span>` : ''}
            ${isDeclined ? `<span style="font-size:11px;padding:2px 10px;border-radius:20px;background:rgba(231,76,60,.08);color:#e74c3c;font-weight:600;">Avsl&aring;tt</span>` : ''}
            <button class="pi-tegnet-btn btn btn-ghost btn-sm"
              data-pid="${window.escHtml(String(p._id))}"
              data-pname="${window.escHtml(p.name)}"
              data-committed="${pi.committed_amount != null ? pi.committed_amount : ''}"
              style="font-size:11px;color:#1A8A6A;border-color:#1A8A6A;min-height:28px;padding:2px 8px;">
              ${isTegnet ? 'Endre tegning' : '+ Tegnet'}
            </button>
            <button class="btn-quick-decline btn btn-ghost btn-sm"
              data-product-id="${window.escHtml(String(p._id))}"
              style="font-size:11px;color:#e74c3c;border-color:#e74c3c;min-height:28px;padding:2px 8px;">&#x2715; Avslag</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="card">
      <div class="card-title">Produktinteresse</div>
      ${rows}
    </div>
  `;
}

function buildLogCard(inv, products) {
  const allLog = inv.log || [];
  const planlagt = allLog.filter(l => l.status === 'planlagt').sort((a, b) => a.date.localeCompare(b.date));
  const avholdt  = allLog.filter(l => l.status !== 'planlagt').sort((a, b) => b.date.localeCompare(a.date));
  const prodMap = Object.fromEntries(products.map(p => [p._id, p]));

  function buildLogRow(l) {
    const isPlanlagt = l.status === 'planlagt';
    const declinedHtml = (l.declined_products || []).length > 0 ? `
      <div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
        <span style="font-size:11px;color:#e74c3c;font-weight:600;">Avsto fra:</span>
        ${(l.declined_products || []).map(id => {
          const prod = prodMap[id];
          return prod ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(231,76,60,.1);color:#e74c3c;font-weight:600;">${window.escHtml(prod.name)}</span>` : '';
        }).join('')}
      </div>
    ` : '';

    return `
      <div class="log-item" data-log-id="${window.escHtml(String(l._id))}" style="${isPlanlagt ? 'background:rgba(52,152,219,.04);border-radius:6px;padding:8px 10px;margin-bottom:4px;' : ''}">
        <div class="log-item-top" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="log-date" style="${isPlanlagt ? 'color:var(--blue);font-weight:600;' : ''}">${window.escHtml(l.date)}</span>
          <span class="badge badge-default">${window.escHtml(l.log_type || 'Kontakt')}</span>
          ${l.contact_person ? `<span style="font-size:12px;color:#555;">${window.escHtml(l.contact_person)}</span>` : ''}
          <span class="log-who" style="font-size:12px;color:var(--muted);">${window.escHtml(l.responsible || '')}</span>
          ${isPlanlagt ? `
            <button class="btn log-marker-avholdt" data-log-id="${window.escHtml(String(l._id))}" style="margin-left:4px;font-size:11px;padding:2px 8px;border-radius:5px;border:1px solid #1A8A6A;background:rgba(26,138,106,.08);color:#1A8A6A;cursor:pointer;font-weight:600;min-height:28px;">
              &#10003; Marker avholdt
            </button>` : ''}
          <button class="btn log-edit-btn" data-log-id="${window.escHtml(String(l._id))}" title="Rediger"
            style="margin-left:auto;background:none;border:none;cursor:pointer;color:var(--muted);font-size:12px;padding:0 4px;line-height:1;opacity:.5;min-width:28px;min-height:28px;"
            onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=.5">&#9998;</button>
          <button class="btn log-delete-btn" data-log-id="${window.escHtml(String(l._id))}" title="Slett"
            style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;padding:0 2px;line-height:1;opacity:.5;min-width:28px;min-height:28px;"
            onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=.5">&#x2715;</button>
        </div>
        ${l.subject ? `<div class="log-subject" style="font-size:13px;font-weight:600;margin-top:4px;">${window.escHtml(l.subject)}</div>` : ''}
        ${l.outcome ? `<div class="log-outcome" style="font-size:12px;color:#555;margin-top:2px;">${window.escHtml(l.outcome)}</div>` : ''}
        ${declinedHtml}
        ${l.notes ? `<div style="font-size:12px;color:#888;margin-top:3px;font-style:italic;">${window.escHtml(l.notes)}</div>` : ''}
      </div>
    `;
  }

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div class="card-title" style="margin:0;">Aktiviteter</div>
        <button class="btn btn-ghost btn-sm" id="new-log-btn" style="min-height:36px;">+ Ny</button>
      </div>
      ${allLog.length === 0 ? '<p class="text-muted" style="font-size:13px;">Ingen aktiviteter registrert.</p>' : ''}
      ${planlagt.length > 0 ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--blue);margin-bottom:6px;">Planlagt</div>
        ${planlagt.map(buildLogRow).join('')}
        ${avholdt.length > 0 ? '<div style="height:1px;background:var(--border);margin:12px 0;"></div>' : ''}
      ` : ''}
      ${avholdt.map(buildLogRow).join('')}
    </div>
  `;
}

function buildTasksCard(tasks) {
  const tasksHtml = tasks.length === 0
    ? '<p class="text-muted" style="font-size:13px;">Ingen oppgaver.</p>'
    : tasks.map(t => `
      <div style="display:flex;align-items:flex-start;gap:10px;border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:10px;" data-task-id="${window.escHtml(String(t._id))}">
        <input type="checkbox"
          class="task-checkbox"
          data-task-id="${window.escHtml(String(t._id))}"
          ${t.done ? 'checked' : ''}
          style="width:16px;height:16px;margin-top:2px;cursor:pointer;flex-shrink:0;min-width:16px;min-height:16px;" />
        <div style="flex:1;opacity:${t.done ? .6 : 1};">
          <div style="font-size:13px;font-weight:600;text-decoration:${t.done ? 'line-through' : 'none'};color:${t.done ? 'var(--muted)' : 'var(--text)'};">${window.escHtml(t.label)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;display:flex;gap:8px;">
            ${t.due_date ? `<span>&#128197; ${window.escHtml(t.due_date)}</span>` : ''}
            ${t.responsible ? `<span>&#128100; ${window.escHtml(t.responsible)}</span>` : ''}
          </div>
        </div>
        <button class="task-delete-btn" data-task-id="${window.escHtml(String(t._id))}"
          style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;padding:0 2px;opacity:.4;min-width:28px;min-height:28px;display:flex;align-items:center;justify-content:center;"
          onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=.4">&#x2715;</button>
      </div>
    `).join('');

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div class="card-title" style="margin:0;">Oppgaver</div>
        <button class="btn btn-ghost btn-sm" id="new-task-btn" style="min-height:36px;">+ Ny oppgave</button>
      </div>
      ${tasksHtml}
    </div>
  `;
}

// ── Modal builders ────────────────────────────────────────────────────────────

function buildProductPills(products, selectedIds, inputName) {
  return products.map(p => {
    const checked = (selectedIds || []).includes(p._id);
    return `
      <label style="display:inline-flex;flex-direction:row;gap:6px;align-items:center;cursor:pointer;
        padding:5px 12px;border-radius:20px;border:2px solid;
        border-color:${checked ? 'var(--blue)' : 'var(--border)'};
        background:${checked ? 'rgba(52,152,219,.1)' : 'transparent'};
        color:${checked ? 'var(--blue)' : 'var(--muted)'};
        font-weight:${checked ? 600 : 400};font-size:13px;min-height:34px;">
        <input type="checkbox" name="${inputName}" value="${window.escHtml(String(p._id))}" ${checked ? 'checked' : ''} style="display:none;" />
        ${window.escHtml(p.name)}
      </label>
    `;
  }).join('');
}

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
        font-weight:${checked ? 600 : 400};font-size:12px;min-height:32px;min-width:60px;">
        <input type="checkbox" name="declined_products" value="${window.escHtml(String(id))}" ${checked ? 'checked' : ''} style="display:none;" />
        ${window.escHtml(prod.name)}
      </label>
    `;
  }).join('');
}

function buildStatusToggle(currentStatus) {
  return ['avholdt', 'planlagt'].map(s => `
    <button type="button" class="status-toggle-btn" data-status="${s}"
      style="flex:1;padding:8px 0;border-radius:7px;border:2px solid;min-height:44px;
        border-color:${currentStatus === s ? (s === 'planlagt' ? 'var(--blue)' : '#1A8A6A') : 'var(--border)'};
        background:${currentStatus === s ? (s === 'planlagt' ? 'rgba(52,152,219,.1)' : 'rgba(26,138,106,.1)') : 'transparent'};
        color:${currentStatus === s ? (s === 'planlagt' ? 'var(--blue)' : '#1A8A6A') : 'var(--muted)'};
        font-weight:600;font-size:13px;cursor:pointer;">
      ${s === 'planlagt' ? '&#128197; Planlagt' : '&#10003; Avholdt'}
    </button>
  `).join('');
}

function openEditModal(inv, lookups, products, reload) {
  const html = `
    <div class="modal-header">
      <h3>Rediger investor</h3>
      <button class="btn-close" onclick="window.closeModal()">&#x2715;</button>
    </div>
    <div class="modal-body">
      <div id="edit-error" class="alert-err" style="display:none;"></div>
      <div class="form-grid">
        <div class="form-group full"><label>Navn</label><input id="e-name" value="${window.escHtml(inv.name || '')}" /></div>
        <div class="form-group"><label>Land</label><input id="e-country" value="${window.escHtml(inv.country || '')}" /></div>
        <div class="form-group"><label>By</label><input id="e-city" value="${window.escHtml(inv.city || '')}" placeholder="Oslo, Bergen&hellip;" /></div>
        <div class="form-group"><label>Fase</label>
          <select id="e-phase">
            ${(lookups.phases || []).map(p => `<option ${inv.phase === p ? 'selected' : ''}>${window.escHtml(p)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Lead</label>
          <select id="e-lead">
            <option value="">—</option>
            ${(lookups.leads || []).map(l => `<option ${inv.lead === l ? 'selected' : ''}>${window.escHtml(l)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Type investor</label>
          <select id="e-type">
            <option value="">—</option>
            ${(lookups.types || []).map(t => `<option ${inv.investor_type === t ? 'selected' : ''}>${window.escHtml(t)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>M&aring;lticket (MNOK)</label>
          <input id="e-ticket" type="number" value="${inv.target_ticket != null ? inv.target_ticket : ''}" />
        </div>
        <div class="form-group"><label>Sannsynlighet (0&ndash;1)</label>
          <input id="e-prob" type="number" step="0.05" min="0" max="1" value="${inv.probability != null ? inv.probability : ''}" />
        </div>
        <div class="form-group"><label>R&aring;dgiver</label>
          <select id="e-advisor">
            <option value="">—</option>
            ${(lookups.advisors || []).map(a => `<option ${inv.advisor === a ? 'selected' : ''}>${window.escHtml(a)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>First Close</label>
          <select id="e-firstclose">
            <option value="0" ${!inv.first_close ? 'selected' : ''}>Nei</option>
            <option value="1" ${inv.first_close ? 'selected' : ''}>Ja</option>
          </select>
        </div>
        <div class="form-group full"><label>Hva skal til</label>
          <textarea id="e-nextsteps">${window.escHtml(inv.next_steps || '')}</textarea>
        </div>
        <div class="form-group full"><label>Kommentar</label>
          <textarea id="e-comments">${window.escHtml(inv.comments || '')}</textarea>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-primary" id="edit-save-btn">Lagre</button>
    </div>
  `;

  window.openModal(html, () => {
    document.getElementById('edit-save-btn').addEventListener('click', async () => {
      const name = document.getElementById('e-name').value.trim();
      if (!name) {
        const errEl = document.getElementById('edit-error');
        errEl.textContent = 'Navn er p&aring;krevd';
        errEl.style.display = '';
        return;
      }

      const ticketVal = document.getElementById('e-ticket').value;
      const probVal   = document.getElementById('e-prob').value;
      const newPhase  = document.getElementById('e-phase').value;

      const data = {
        name,
        country:       document.getElementById('e-country').value.trim(),
        city:          document.getElementById('e-city').value.trim(),
        phase:         newPhase,
        lead:          document.getElementById('e-lead').value,
        investor_type: document.getElementById('e-type').value,
        target_ticket: ticketVal !== '' ? parseFloat(ticketVal) : null,
        probability:   probVal   !== '' ? parseFloat(probVal)   : null,
        advisor:       document.getElementById('e-advisor').value,
        first_close:   parseInt(document.getElementById('e-firstclose').value),
        next_steps:    document.getElementById('e-nextsteps').value,
        comments:      document.getElementById('e-comments').value,
      };

      const btn = document.getElementById('edit-save-btn');
      btn.disabled = true;
      btn.textContent = 'Lagrer&hellip;';
      try {
        await api.updateInvestor(inv.id, data);
        window.closeModal();
        const wentOnHold = newPhase === 'P&aring; vent' && inv.phase !== 'P&aring; vent';
        await reload();
        if (wentOnHold) {
          // Re-fetch updated inv after reload to pass to PaVentModal
          const freshInv = await api.investor(inv.id);
          openPaVentModal(freshInv, reload);
        }
      } catch (e) {
        const errEl = document.getElementById('edit-error');
        if (errEl) {
          errEl.textContent = e.message;
          errEl.style.display = '';
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Lagre'; }
      }
    });
  });
}

function openLogModal(inv, lookups, products, reload, prefill = {}) {
  const defResponsible = prefill.responsible || 'Kristian Bartnes';
  const initStatus = prefill.status || 'avholdt';

  const html = `
    <div class="modal-header">
      <h3>Logg kontakt &mdash; ${window.escHtml(inv.name)}</h3>
      <button class="btn-close" onclick="window.closeModal()">&#x2715;</button>
    </div>
    <div class="modal-body">
      <div id="log-error" class="alert-err" style="display:none;"></div>
      <div class="form-grid">
        <div class="form-group"><label>Dato</label>
          <input type="date" id="l-date" value="${window.escHtml(prefill.date || today())}" />
        </div>
        <div class="form-group"><label>Type</label>
          <select id="l-type">
            ${(lookups.logTypes || []).map(t => `<option ${(prefill.log_type || 'M&oslash;te') === t ? 'selected' : ''}>${window.escHtml(t)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Kontaktperson</label>
          <select id="l-contact">
            <option value="">— Velg —</option>
            ${(inv.contacts || []).filter(c => c.active !== 0).map(c => `
              <option value="${window.escHtml(c.name)}" ${(prefill.contact_person || '') === c.name ? 'selected' : ''}>
                ${window.escHtml(c.name)}${c.title ? ' (' + window.escHtml(c.title) + ')' : ''}
              </option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Ansvarlig</label>
          <select id="l-responsible">
            ${(lookups.leads || []).map(l => `<option ${defResponsible === l ? 'selected' : ''}>${window.escHtml(l)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group full" style="grid-column:1/-1;">
          <label>Status</label>
          <div style="display:flex;gap:8px;margin-top:4px;" id="l-status-wrap">
            ${buildStatusToggle(initStatus)}
          </div>
          <input type="hidden" id="l-status" value="${initStatus}" />
        </div>
        <div class="form-group full"><label>Emne / Agenda</label>
          <input id="l-subject" value="${window.escHtml(prefill.subject || '')}" />
        </div>
        <div class="form-group full"><label>Utfall / Neste steg</label>
          <textarea id="l-outcome">${window.escHtml(prefill.outcome || '')}</textarea>
        </div>
        ${(inv.product_interests || []).length > 0 ? `
        <div class="form-group full">
          <label>Avsto fra <span style="font-weight:400;color:var(--muted);font-size:11px;">(valgfritt)</span></label>
          <div id="l-declined" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
            ${buildDeclinedPills(products, inv.product_interests, prefill.declined_products || [])}
          </div>
        </div>` : ''}
        <div class="form-group full"><label>Notat</label>
          <textarea id="l-notes">${window.escHtml(prefill.notes || '')}</textarea>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-green" id="log-save-btn">Logg &#8594;</button>
    </div>
  `;

  window.openModal(html, () => {
    setupStatusToggle('l-status-wrap', 'l-status');
    setupDeclinedPills('l-declined');

    document.getElementById('log-save-btn').addEventListener('click', async () => {
      const date = document.getElementById('l-date').value;
      if (!date) return;

      const declinedInputs = document.querySelectorAll('#l-declined input[type=checkbox]:checked');
      const declined = [...declinedInputs].map(cb => {
        const v = cb.value;
        return isNaN(v) ? v : Number(v);
      });

      const data = {
        date,
        investor_id:       inv.id,
        investor_name:     inv.name,
        log_type:          document.getElementById('l-type').value,
        contact_person:    document.getElementById('l-contact').value,
        responsible:       document.getElementById('l-responsible').value,
        status:            document.getElementById('l-status').value,
        subject:           document.getElementById('l-subject').value,
        outcome:           document.getElementById('l-outcome').value,
        notes:             document.getElementById('l-notes').value,
        declined_products: declined,
      };

      const btn = document.getElementById('log-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        await api.addLog(data);
        window.closeModal();
        await reload();
      } catch (e) {
        const errEl = document.getElementById('log-error');
        if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
        if (btn) { btn.disabled = false; btn.textContent = 'Logg &rarr;'; }
      }
    });
  });
}

function openEditLogModal(entry, inv, lookups, products, reload) {
  const html = `
    <div class="modal-header">
      <h3>Rediger aktivitet</h3>
      <button class="btn-close" onclick="window.closeModal()">&#x2715;</button>
    </div>
    <div class="modal-body">
      <div id="editlog-error" class="alert-err" style="display:none;"></div>
      <div class="form-grid">
        <div class="form-group"><label>Dato</label>
          <input type="date" id="el-date" value="${window.escHtml(entry.date || '')}" />
        </div>
        <div class="form-group"><label>Type</label>
          <select id="el-type">
            ${(lookups.logTypes || []).map(t => `<option ${entry.log_type === t ? 'selected' : ''}>${window.escHtml(t)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Kontaktperson</label>
          <select id="el-contact">
            <option value="">— Velg —</option>
            ${(inv.contacts || []).filter(c => c.active !== 0).map(c => `
              <option value="${window.escHtml(c.name)}" ${(entry.contact_person || '') === c.name ? 'selected' : ''}>
                ${window.escHtml(c.name)}${c.title ? ' (' + window.escHtml(c.title) + ')' : ''}
              </option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Ansvarlig</label>
          <select id="el-responsible">
            ${(lookups.leads || []).map(l => `<option ${entry.responsible === l ? 'selected' : ''}>${window.escHtml(l)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group full" style="grid-column:1/-1;">
          <label>Status</label>
          <div style="display:flex;gap:8px;margin-top:4px;" id="el-status-wrap">
            ${buildStatusToggle(entry.status || 'avholdt')}
          </div>
          <input type="hidden" id="el-status" value="${window.escHtml(entry.status || 'avholdt')}" />
        </div>
        <div class="form-group full"><label>Emne / Agenda</label>
          <input id="el-subject" value="${window.escHtml(entry.subject || '')}" />
        </div>
        <div class="form-group full"><label>Utfall / Neste steg</label>
          <textarea id="el-outcome">${window.escHtml(entry.outcome || '')}</textarea>
        </div>
        ${(inv.product_interests || []).length > 0 ? `
        <div class="form-group full">
          <label>Avsto fra <span style="font-weight:400;color:var(--muted);font-size:11px;">(valgfritt)</span></label>
          <div id="el-declined" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
            ${buildDeclinedPills(products, inv.product_interests, entry.declined_products || [])}
          </div>
        </div>` : ''}
        <div class="form-group full"><label>Notat</label>
          <textarea id="el-notes">${window.escHtml(entry.notes || '')}</textarea>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-primary" id="editlog-save-btn">Lagre</button>
    </div>
  `;

  window.openModal(html, () => {
    setupStatusToggle('el-status-wrap', 'el-status');
    setupDeclinedPills('el-declined');

    document.getElementById('editlog-save-btn').addEventListener('click', async () => {
      const declined = [...document.querySelectorAll('#el-declined input[type=checkbox]:checked')]
        .map(cb => { const v = cb.value; return isNaN(v) ? v : Number(v); });

      const data = {
        date:              document.getElementById('el-date').value,
        log_type:          document.getElementById('el-type').value,
        contact_person:    document.getElementById('el-contact').value,
        responsible:       document.getElementById('el-responsible').value,
        status:            document.getElementById('el-status').value,
        subject:           document.getElementById('el-subject').value,
        outcome:           document.getElementById('el-outcome').value,
        notes:             document.getElementById('el-notes').value,
        declined_products: declined,
      };

      const btn = document.getElementById('editlog-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        await api.updateLog(entry._id, data);
        window.closeModal();
        await reload();
      } catch (e) {
        const errEl = document.getElementById('editlog-error');
        if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
        if (btn) { btn.disabled = false; btn.textContent = 'Lagre'; }
      }
    });
  });
}

function openContactModal(contact, reload) {
  const isNew = !contact._id;
  const html = `
    <div class="modal-header">
      <h3>${isNew ? 'Legg til kontaktperson' : 'Rediger kontaktperson'}</h3>
      <button class="btn-close" onclick="window.closeModal()">&#x2715;</button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-group full">
          <label>Navn *</label>
          <input id="c-name" value="${window.escHtml(contact.name || '')}" placeholder="Fullt navn" autofocus />
        </div>
        <div class="form-group full">
          <label>Tittel</label>
          <input id="c-title" value="${window.escHtml(contact.title || '')}" placeholder="CIO, Portfolio Manager&hellip;" />
        </div>
        <div class="form-group">
          <label>E-post</label>
          <input id="c-email" type="email" value="${window.escHtml(contact.email || '')}" placeholder="navn@selskap.no" />
        </div>
        <div class="form-group">
          <label>Telefon</label>
          <input id="c-phone" value="${window.escHtml(contact.phone || '')}" placeholder="+47 900 00 000" />
        </div>
        <div class="form-group full">
          <label>Notat</label>
          <textarea id="c-notes" style="min-height:52px;" placeholder="Valgfritt&hellip;">${window.escHtml(contact.notes || '')}</textarea>
        </div>
        <div class="form-group full">
          <label style="flex-direction:row;gap:8px;align-items:center;cursor:pointer;display:flex;">
            <input type="checkbox" id="c-primary" ${contact.is_primary ? 'checked' : ''} />
            Prim&aelig;rkontakt
          </label>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-primary" id="contact-save-btn">${isNew ? 'Legg til' : 'Lagre'}</button>
    </div>
  `;

  window.openModal(html, () => {
    document.getElementById('contact-save-btn').addEventListener('click', async () => {
      const name = document.getElementById('c-name').value.trim();
      if (!name) return;
      const data = {
        ...contact,
        name,
        title:      document.getElementById('c-title').value.trim(),
        email:      document.getElementById('c-email').value.trim(),
        phone:      document.getElementById('c-phone').value.trim(),
        notes:      document.getElementById('c-notes').value,
        is_primary: document.getElementById('c-primary').checked ? 1 : 0,
      };
      const btn = document.getElementById('contact-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        if (isNew) {
          await api.addContact(data);
        } else {
          await api.updateContact(contact._id, data);
        }
        window.closeModal();
        await reload();
      } catch (e) {
        alert('Feil: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = isNew ? 'Legg til' : 'Lagre'; }
      }
    });
  });
}

function openTaskModal(inv, lookups, reload) {
  const html = `
    <div class="modal-header">
      <h3>Ny oppgave</h3>
      <button class="btn-close" onclick="window.closeModal()">&#x2715;</button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-group full">
          <label>Investor</label>
          <input value="${window.escHtml(inv.name)}" disabled style="opacity:.6;" />
        </div>
        <div class="form-group full">
          <label>Oppgave *</label>
          <input id="t-label" placeholder="Beskriv oppgaven&hellip;" autofocus />
        </div>
        <div class="form-group">
          <label>Frist</label>
          <input type="date" id="t-due" />
        </div>
        <div class="form-group">
          <label>Ansvarlig</label>
          <select id="t-responsible">
            <option value="">—</option>
            ${(lookups.leads || []).map(l => `<option>${window.escHtml(l)}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-primary" id="task-save-btn">Legg til</button>
    </div>
  `;

  window.openModal(html, () => {
    document.getElementById('task-save-btn').addEventListener('click', async () => {
      const label = document.getElementById('t-label').value.trim();
      if (!label) return;
      const data = {
        investor_id:   inv.id,
        investor_name: inv.name,
        label,
        due_date:    document.getElementById('t-due').value || null,
        responsible: document.getElementById('t-responsible').value || null,
      };
      const btn = document.getElementById('task-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        await api.addTask(data);
        window.closeModal();
        await reload();
      } catch (e) {
        alert('Feil: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Legg til'; }
      }
    });
  });
}

function openPaVentModal(inv, reload) {
  const chips = [[3, '3 mnd'], [6, '6 mnd'], [12, '12 mnd']];
  const selected = new Set();

  const html = `
    <div class="modal-header">
      <h3>N&aring;r tar du kontakt igjen?</h3>
      <button class="btn-close" onclick="window.closeModal()">&#x2715;</button>
    </div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
        ${window.escHtml(inv.name)} er satt p&aring; vent. Velg oppf&oslash;lgingstidspunkt:
      </p>
      <div style="display:flex;gap:8px;margin-bottom:20px;" id="pavent-chips">
        ${chips.map(([m, l]) => `
          <button type="button" class="pavent-chip" data-months="${m}"
            style="flex:1;padding:10px 0;border-radius:8px;border:2px solid var(--border);background:transparent;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer;min-height:44px;">
            ${l}
          </button>
        `).join('')}
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label>Eller velg dato</label>
        <input type="date" id="pavent-custom" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Hopp over</button>
      <button class="btn btn-primary" id="pavent-save-btn">Legg til oppgaver</button>
    </div>
  `;

  window.openModal(html, () => {
    document.querySelectorAll('.pavent-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = parseInt(btn.dataset.months);
        if (selected.has(m)) {
          selected.delete(m);
          btn.style.borderColor = 'var(--border)';
          btn.style.background  = 'transparent';
          btn.style.color       = 'var(--muted)';
        } else {
          selected.add(m);
          btn.style.borderColor = 'var(--blue)';
          btn.style.background  = 'rgba(52,152,219,.1)';
          btn.style.color       = 'var(--blue)';
        }
      });
    });

    document.getElementById('pavent-save-btn').addEventListener('click', async () => {
      const customDate = document.getElementById('pavent-custom').value;
      if (selected.size === 0 && !customDate) return;

      const btn = document.getElementById('pavent-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        const existing = await api.tasks({ investorId: inv.id });
        const existingLabels = new Set(existing.map(t => t.label));
        for (const [months, label] of [[3, 'Følg opp — 3 mnd'], [6, 'Følg opp — 6 mnd'], [12, 'Følg opp — 12 mnd']]) {
          if (selected.has(months) && !existingLabels.has(label)) {
            await api.addTask({ investor_id: inv.id, investor_name: inv.name, due_date: addDate(months), label });
          }
        }
        if (customDate) {
          const label = `Følg opp — ${customDate}`;
          if (!existingLabels.has(label)) {
            await api.addTask({ investor_id: inv.id, investor_name: inv.name, due_date: customDate, label });
          }
        }
        window.closeModal();
        await reload();
      } catch (e) {
        alert('Feil ved lagring: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Legg til oppgaver'; }
      }
    });
  });
}

function openQuickDeclineModal(inv, product, products, reload) {
  const html = `
    <div class="modal-header">
      <h3>Takket nei</h3>
      <button class="btn-close" onclick="window.closeModal()">&#x2715;</button>
    </div>
    <div class="modal-body">
      <p style="font-size:14px;margin-bottom:16px;">
        <b>${window.escHtml(inv.name)}</b> avsto fra
        <span style="color:#e74c3c;font-weight:600;">${window.escHtml(product.name)}</span>
      </p>
      <div class="form-grid">
        <div class="form-group full">
          <label>Dato</label>
          <input type="date" id="qd-date" value="${today()}" />
        </div>
        <div class="form-group full">
          <label>Notat <span style="font-weight:400;color:var(--muted);font-size:11px;">(valgfritt)</span></label>
          <textarea id="qd-note" placeholder="Begrunnelse, kommentar&hellip;" style="min-height:60px;"></textarea>
        </div>
        <div class="form-group full">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex-direction:row;">
            <input type="checkbox" id="qd-remove" checked />
            Fjern ${window.escHtml(product.name)} fra produktinteresse
          </label>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-primary" id="qd-save-btn" style="background:#e74c3c;border-color:#e74c3c;">Registrer avslag</button>
    </div>
  `;

  window.openModal(html, () => {
    document.getElementById('qd-save-btn').addEventListener('click', async () => {
      const date   = document.getElementById('qd-date').value;
      const note   = document.getElementById('qd-note').value;
      const remove = document.getElementById('qd-remove').checked;
      const btn    = document.getElementById('qd-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer&hellip;';
      try {
        await api.addLog({
          date,
          investor_id:       inv.id,
          investor_name:     inv.name,
          log_type:          'Notat',
          subject:           `Takket nei til ${product.name}`,
          outcome:           note,
          responsible:       'Kristian Bartnes',
          notes:             '',
          declined_products: [product._id],
        });
        if (remove) {
          const updated = (inv.product_interests || []).filter(id => id !== product._id);
          await api.updateInvestor(inv.id, { product_interests: updated });
        }
        window.closeModal();
        await reload();
      } catch (e) {
        alert('Feil ved lagring: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Registrer avslag'; }
      }
    });
  });
}

function openTegnetModal(inv, productId, productName, currentAmount, reload) {
  const html = `
    <div class="modal-header">
      <h3>Tegning &mdash; ${window.escHtml(productName)}</h3>
      <button class="btn-close" onclick="window.closeModal()">&#x2715;</button>
    </div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
        Registrer tegnet bel&oslash;p for <b>${window.escHtml(inv.name)}</b>
      </p>
      <div class="form-group">
        <label>Tegnet bel&oslash;p (MNOK)</label>
        <input id="tegnet-amount" type="number" step="0.5" min="0"
          value="${currentAmount != null ? currentAmount : ''}" placeholder="0" autofocus />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-green" id="tegnet-save-btn">Bekreft tegning</button>
    </div>
  `;
  window.openModal(html, () => {
    document.getElementById('tegnet-save-btn').addEventListener('click', async () => {
      const raw = document.getElementById('tegnet-amount').value;
      const amount = raw !== '' ? parseFloat(raw) : null;
      const btn = document.getElementById('tegnet-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer…';
      try {
        await api.updateProductInvestor(productId, inv.id, { committed_amount: amount });
        window.closeModal();
        await reload();
      } catch (e) {
        alert('Feil: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Bekreft tegning'; }
      }
    });
  });
}

// ── Shared setup helpers ──────────────────────────────────────────────────────

function setupStatusToggle(wrapId, hiddenId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.querySelectorAll('.status-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.status;
      document.getElementById(hiddenId).value = s;
      wrap.querySelectorAll('.status-toggle-btn').forEach(b => {
        const active = b.dataset.status === s;
        const isPlan = b.dataset.status === 'planlagt';
        b.style.borderColor = active ? (isPlan ? 'var(--blue)' : '#1A8A6A') : 'var(--border)';
        b.style.background  = active ? (isPlan ? 'rgba(52,152,219,.1)' : 'rgba(26,138,106,.1)') : 'transparent';
        b.style.color       = active ? (isPlan ? 'var(--blue)' : '#1A8A6A') : 'var(--muted)';
      });
    });
  });
}

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

// ── Main render ───────────────────────────────────────────────────────────────

export async function render(el, state) {
  el.innerHTML = '<div class="content"><p class="text-muted">Laster&hellip;</p></div>';

  let inv, tasks, lookups, products, piData;
  try {
    [inv, tasks, lookups, products, piData] = await Promise.all([
      api.investor(state.id),
      api.tasks({ investorId: state.id }),
      api.lookups(),
      api.products(),
      api.productInvestors(state.id),
    ]);
  } catch (e) {
    el.innerHTML = `<div class="content"><p style="color:#c0392b;">Feil: ${window.escHtml(e.message)}</p></div>`;
    return;
  }

  // visInaktive tracked outside DOM
  let visInaktive = false;

  async function reload() {
    await render(el, state);
  }

  function buildPage() {
    el.innerHTML = `
      <div class="topbar">
        <button class="btn btn-ghost btn-sm" id="back-btn" style="min-height:36px;">&#8592; Tilbake</button>
        <span class="topbar-title" style="margin-left:8px;">${window.escHtml(inv.name)}</span>
        <button class="btn btn-primary btn-sm" id="edit-btn" style="min-height:36px;">Rediger</button>
        <button class="btn btn-green btn-sm" id="logg-btn" style="min-height:36px;">+ Logg kontakt</button>
        <button class="btn btn-ghost btn-sm" id="delete-btn" style="color:#e74c3c;margin-left:auto;min-height:36px;">Slett investor</button>
      </div>
      <div class="content">
        ${buildDetailHeader(inv, products)}
        ${buildProductCard(inv, products, piData)}
        <div class="grid-2">
          ${buildPipelineCard(inv)}
          ${buildDocsCard(inv, products)}
          ${buildContactsCard(inv, visInaktive)}
        </div>
        ${buildLogCard(inv, products)}
        ${buildTasksCard(tasks)}
      </div>
    `;

    // Re-bind events after innerHTML replace
    bindEvents();
  }

  function bindEvents() {
    // Topbar
    el.querySelector('#back-btn').addEventListener('click', () => window.navigate('investorer'));
    el.querySelector('#edit-btn').addEventListener('click', () => openEditModal(inv, lookups, products, reload));
    el.querySelector('#logg-btn').addEventListener('click', () => openLogModal(inv, lookups, products, reload, { responsible: state.currentUser?.displayName }));
    el.querySelector('#delete-btn').addEventListener('click', async () => {
      if (!window.confirm(`Slette ${inv.name}?\n\nDette sletter investoren permanent, inkludert alle kontakter og loggposter.`)) return;
      try {
        await api.deleteInvestor(inv.id);
        window.navigate('investorer');
      } catch (e) { alert('Feil ved sletting: ' + e.message); }
    });

    // Produktkort — toggle interesse
    el.querySelectorAll('.pi-toggle').forEach(cb => {
      cb.addEventListener('change', async () => {
        const pid = isNaN(cb.dataset.pid) ? cb.dataset.pid : Number(cb.dataset.pid);
        const newInterests = cb.checked
          ? [...(inv.product_interests || []), pid]
          : (inv.product_interests || []).filter(id => id !== pid);
        try {
          await api.updateInvestor(inv.id, { product_interests: newInterests });
          inv.product_interests = newInterests;
          await reload();
        } catch (e) { alert('Feil: ' + e.message); cb.checked = !cb.checked; }
      });
    });

    // Produktkort — ticket per produkt (lagres ved blur/enter)
    el.querySelectorAll('.pi-ticket').forEach(input => {
      const save = async () => {
        const pid = Number(input.dataset.pid);
        const val = input.value !== '' ? parseFloat(input.value) : null;
        try {
          await api.updateProductInvestor(pid, inv.id, { target_ticket: val });
          const pi = piData.find(p => p.product_id === pid);
          if (pi) pi.target_ticket = val;
          else piData.push({ product_id: pid, investor_id: inv.id, target_ticket: val, probability: null });
        } catch (e) { alert('Feil ved lagring: ' + e.message); }
      };
      input.addEventListener('change', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    });

    // Produktkort — sannsynlighet per produkt
    el.querySelectorAll('.pi-prob').forEach(input => {
      const save = async () => {
        const pid = Number(input.dataset.pid);
        const pct = input.value !== '' ? parseFloat(input.value) : null;
        const val = pct != null ? pct / 100 : null;
        try {
          await api.updateProductInvestor(pid, inv.id, { probability: val });
          const pi = piData.find(p => p.product_id === pid);
          if (pi) pi.probability = val;
          else piData.push({ product_id: pid, investor_id: inv.id, target_ticket: null, probability: val });
        } catch (e) { alert('Feil ved lagring: ' + e.message); }
      };
      input.addEventListener('change', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    });

    // Produktkort — tegnet-knapp
    el.querySelectorAll('.pi-tegnet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid      = Number(btn.dataset.pid);
        const pname    = btn.dataset.pname;
        const committed = btn.dataset.committed !== '' ? parseFloat(btn.dataset.committed) : null;
        openTegnetModal(inv, pid, pname, committed, reload);
      });
    });

    // Quick decline (header-piller og produktkort)
    el.querySelectorAll('.btn-quick-decline').forEach(btn => {
      btn.addEventListener('click', () => {
        const productId = btn.dataset.productId;
        const product = products.find(p => String(p._id) === String(productId));
        if (product) openQuickDeclineModal(inv, product, products, reload);
      });
    });

    // Docs card — checkbox, date, version
    el.querySelectorAll('.doc-checkbox').forEach(cb => {
      cb.addEventListener('change', async () => {
        const pid = cb.dataset.productId;
        const key = cb.dataset.docKey;
        const docs = inv.docs || {};
        const existing = (docs[pid] || {})[key] || {};
        const updated = {
          ...docs,
          [pid]: {
            ...(docs[pid] || {}),
            [key]: {
              ...existing,
              done: cb.checked ? 1 : 0,
              date: existing.date || new Date().toISOString().slice(0, 10),
            },
          },
        };
        try {
          await api.updateInvestor(inv.id, { docs: updated });
          inv.docs = updated;
        } catch (e) { alert('Feil: ' + e.message); cb.checked = !cb.checked; }
      });
    });

    el.querySelectorAll('.doc-date').forEach(input => {
      input.addEventListener('change', async () => {
        const pid = input.dataset.productId;
        const key = input.dataset.docKey;
        const docs = inv.docs || {};
        const existing = (docs[pid] || {})[key] || {};
        const updated = {
          ...docs,
          [pid]: {
            ...(docs[pid] || {}),
            [key]: { ...existing, date: input.value },
          },
        };
        try {
          await api.updateInvestor(inv.id, { docs: updated });
          inv.docs = updated;
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });

    el.querySelectorAll('.doc-version').forEach(input => {
      input.addEventListener('change', async () => {
        const pid = input.dataset.productId;
        const key = input.dataset.docKey;
        const docs = inv.docs || {};
        const existing = (docs[pid] || {})[key] || {};
        const updated = {
          ...docs,
          [pid]: {
            ...(docs[pid] || {}),
            [key]: { ...existing, version: input.value },
          },
        };
        try {
          await api.updateInvestor(inv.id, { docs: updated });
          inv.docs = updated;
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });

    // Contacts card
    const addContactBtn = el.querySelector('#add-contact-btn');
    if (addContactBtn) {
      addContactBtn.addEventListener('click', () => {
        openContactModal({ investor_id: inv.id, name: '', title: '', email: '', phone: '', is_primary: 0, notes: '', active: 1 }, reload);
      });
    }

    const toggleInaktiveBtn = el.querySelector('#toggle-inaktive');
    if (toggleInaktiveBtn) {
      toggleInaktiveBtn.addEventListener('click', async () => {
        visInaktive = !visInaktive;
        // Re-render just the contacts card region is complex; full reload simpler
        await reload();
      });
    }

    el.querySelectorAll('.contact-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cid = btn.dataset.contactId;
        const contact = (inv.contacts || []).find(c => String(c._id) === String(cid));
        if (contact) openContactModal({ ...contact }, reload);
      });
    });

    el.querySelectorAll('.contact-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cid    = btn.dataset.contactId;
        const active = parseInt(btn.dataset.active);
        const contact = (inv.contacts || []).find(c => String(c._id) === String(cid));
        if (!contact) return;
        try {
          await api.updateContact(cid, { ...contact, active: active === 1 ? 0 : 1 });
          await reload();
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });

    el.querySelectorAll('.contact-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Slette kontakt?')) return;
        try {
          await api.deleteContact(btn.dataset.contactId);
          await reload();
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });

    // Log card
    const newLogBtn = el.querySelector('#new-log-btn');
    if (newLogBtn) {
      newLogBtn.addEventListener('click', () => openLogModal(inv, lookups, products, reload, { responsible: state.currentUser?.displayName }));
    }

    el.querySelectorAll('.log-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lid = btn.dataset.logId;
        const entry = (inv.log || []).find(l => String(l._id) === String(lid));
        if (entry) openEditLogModal(entry, inv, lookups, products, reload);
      });
    });

    el.querySelectorAll('.log-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Slett denne aktiviteten?')) return;
        try {
          await api.deleteLog(btn.dataset.logId);
          await reload();
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });

    el.querySelectorAll('.log-marker-avholdt').forEach(btn => {
      btn.addEventListener('click', () => {
        const lid = btn.dataset.logId;
        const entry = (inv.log || []).find(l => String(l._id) === String(lid));
        if (entry) openEditLogModal({ ...entry, status: 'avholdt' }, inv, lookups, products, reload);
      });
    });

    // Tasks card
    const newTaskBtn = el.querySelector('#new-task-btn');
    if (newTaskBtn) {
      newTaskBtn.addEventListener('click', () => openTaskModal(inv, lookups, reload));
    }

    el.querySelectorAll('.task-checkbox').forEach(cb => {
      cb.addEventListener('change', async () => {
        const tid  = cb.dataset.taskId;
        const task = tasks.find(t => String(t._id) === String(tid));
        if (!task) return;
        try {
          await api.updateTask(tid, { done: task.done ? 0 : 1 });
          task.done = task.done ? 0 : 1;
          // Update visuals inline
          const row = el.querySelector(`[data-task-id="${tid}"]`);
          if (row) {
            const label = row.querySelector('div > div:first-child');
            if (label) {
              label.style.textDecoration = task.done ? 'line-through' : 'none';
              label.style.color          = task.done ? 'var(--muted)' : 'var(--text)';
            }
            const inner = row.querySelector('div[style*="flex:1"]') || row.querySelector('div[style*="flex: 1"]');
            if (inner) inner.style.opacity = task.done ? .6 : 1;
          }
        } catch (e) { alert('Feil: ' + e.message); cb.checked = !cb.checked; }
      });
    });

    el.querySelectorAll('.task-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tid = btn.dataset.taskId;
        try {
          await api.deleteTask(tid);
          tasks = tasks.filter(t => String(t._id) !== String(tid));
          const row = btn.closest('[data-task-id]');
          if (row) row.remove();
        } catch (e) { alert('Feil: ' + e.message); }
      });
    });
  }

  buildPage();
}
