import { api } from '../api.js';

function showWelcomeModal(displayName, username) {
  const loginUrl = window.location.origin;
  const msg = `Hei ${displayName}!

Du har fått tilgang til ORO CRM.

🔗 Lenke: ${loginUrl}
👤 Brukernavn: ${username}
🔑 Passord: byttpassord

Logg inn og endre passordet ditt ved første anledning.`;

  window.openModal(`
    <div class="modal-header">
      <h3>Velkomstmelding klar</h3>
      <button class="btn-close" onclick="window.closeModal()">×</button>
    </div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px">Kopier og send til brukeren:</p>
      <textarea id="welcome-msg-txt" style="width:100%;height:200px;font-size:13px;font-family:inherit;resize:none" readonly>${window.escHtml(msg)}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Lukk</button>
      <button class="btn btn-primary" id="copy-welcome-btn">Kopier tekst</button>
    </div>`, () => {
    document.getElementById('copy-welcome-btn')?.addEventListener('click', () => {
      const txt = document.getElementById('welcome-msg-txt');
      txt.select();
      navigator.clipboard.writeText(txt.value).catch(() => document.execCommand('copy'));
      const btn = document.getElementById('copy-welcome-btn');
      btn.textContent = '✓ Kopiert!';
      setTimeout(() => { btn.textContent = 'Kopier tekst'; }, 2000);
    });
  });
}

function roleBadgeHtml(role) {
  const isAdmin = role === 'admin';
  return `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;
    background:${isAdmin ? 'rgba(52,152,219,.12)' : 'rgba(0,0,0,.05)'};
    color:${isAdmin ? 'var(--blue)' : 'var(--muted)'}">
    ${isAdmin ? 'Admin' : 'Bruker'}
  </span>`;
}

const TEAM_LEADS = ['Kristian Bartnes','Anders Brustad-Nilsen','Nikolai Staubo','Anders Aasand','Gunnar Vestby'];

function userModalHtml(user) {
  const isNew = !user;
  const title = isNew ? 'Legg til bruker' : 'Rediger bruker';
  const displayName = window.escHtml(user?.displayName || '');
  const username    = window.escHtml(user?.username    || '');
  const role        = user?.role     || 'bruker';
  const leadName    = user?.leadName || '';

  const leadOpts = `<option value="">— Ingen —</option>` +
    TEAM_LEADS.map(l => `<option value="${window.escHtml(l)}"${l === leadName ? ' selected' : ''}>${window.escHtml(l)}</option>`).join('');

  return `
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="btn-close" onclick="window.closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div id="modal-error" style="display:none;background:#fdecea;color:#c0392b;border-radius:7px;padding:8px 12px;margin-bottom:12px;font-size:13px"></div>
      <div class="form-grid">
        <div class="form-group full">
          <label>Fullt navn *</label>
          <input id="modal-display-name" value="${displayName}" placeholder="Ola Nordmann" autofocus style="min-height:44px">
        </div>
        ${isNew ? `
        <div class="form-group full">
          <label>Brukernavn *</label>
          <input id="modal-username" value="${username}" placeholder="ola.nordmann" style="min-height:44px">
        </div>
        <div class="form-group full">
          <p style="font-size:12px;color:var(--muted);background:var(--bg);border-radius:6px;padding:8px 10px;">
            🔑 Startpassord: <strong>byttpassord</strong> — brukeren blir bedt om å endre det ved første innlogging.
          </p>
        </div>` : `
        <div class="form-group full">
          <label>Nytt passord <span style="font-weight:400;color:var(--muted);font-size:11px">(la stå tomt for å beholde)</span></label>
          <input id="modal-password" type="password" placeholder="••••••••" style="min-height:44px">
        </div>`}
        <div class="form-group full">
          <label>Rolle</label>
          <select id="modal-role" style="min-height:44px">
            <option value="bruker"${role === 'bruker' ? ' selected' : ''}>Bruker</option>
            <option value="admin"${role === 'admin'   ? ' selected' : ''}>Admin</option>
          </select>
        </div>
        <div class="form-group full">
          <label>Tilknyttet ansvarlig</label>
          <select id="modal-lead-name" style="min-height:44px">${leadOpts}</select>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
      <button class="btn btn-primary" id="modal-save-btn" style="min-height:44px">${isNew ? 'Opprett' : 'Lagre'}</button>
    </div>`;
}

export async function render(el, state) {
  const currentUser = state?.currentUser;

  // Access guard
  if (currentUser?.role !== 'admin') {
    el.innerHTML = `
      <div class="topbar"><span class="topbar-title">Brukere</span></div>
      <div class="content">
        <div style="background:#fdecea;color:#c0392b;border-radius:8px;padding:16px 20px;font-size:14px">
          Du har ikke tilgang til denne siden.
        </div>
      </div>`;
    return;
  }

  el.innerHTML = '<div class="content"><p class="text-muted" style="padding:24px">Laster…</p></div>';

  let users = [];

  async function load() {
    try {
      users = await api.users();
      buildPage();
    } catch (e) {
      el.innerHTML = `
        <div class="topbar"><span class="topbar-title">Brukere</span></div>
        <div class="content"><p style="color:red">Feil: ${window.escHtml(e.message)}</p></div>`;
    }
  }

  function buildPage() {
    const rows = users.length === 0
      ? `<tr><td colspan="5" class="empty-state">Ingen brukere.</td></tr>`
      : users.map(u => {
          const isSelf = u._id === currentUser?._id;
          return `<tr>
            <td style="font-weight:600;padding:12px 16px">
              ${window.escHtml(u.displayName || u.username)}
              ${isSelf ? `<span style="margin-left:8px;font-size:11px;color:var(--muted);font-weight:400;font-style:italic">deg</span>` : ''}
            </td>
            <td style="color:var(--muted);font-size:13px;padding:12px 16px">${window.escHtml(u.username || '')}</td>
            <td style="padding:12px 16px">${roleBadgeHtml(u.role)}</td>
            <td style="color:var(--muted);font-size:13px;padding:12px 16px">${window.escHtml(u.leadName || '—')}</td>
            <td style="padding:12px 16px">
              <div style="display:flex;gap:6px;justify-content:flex-end">
                <button class="btn btn-ghost btn-sm edit-user-btn" data-id="${window.escHtml(u._id)}" style="font-size:11px;min-height:44px">Rediger</button>
                ${!isSelf ? `<button class="btn btn-ghost btn-sm delete-user-btn" data-id="${window.escHtml(u._id)}" data-name="${window.escHtml(u.displayName || u.username)}" style="font-size:11px;color:#e74c3c;min-height:44px">Slett</button>` : ''}
              </div>
            </td>
          </tr>`;
        }).join('');

    el.innerHTML = `
      <div class="topbar">
        <span class="topbar-title">Brukere</span>
        <button class="btn btn-primary btn-sm" id="add-user-btn" style="min-height:44px">+ Ny bruker</button>
      </div>
      <div class="content">
        <div class="card" style="padding:0;overflow:hidden">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Navn</th>
                  <th>Brukernavn</th>
                  <th>Rolle</th>
                  <th>Ansvarlig</th>
                  <th style="width:140px"></th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    // Add user
    el.querySelector('#add-user-btn')?.addEventListener('click', () => {
      openUserModal(null);
    });

    // Edit user
    el.querySelectorAll('.edit-user-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const user = users.find(u => String(u._id) === btn.dataset.id);
        if (user) openUserModal(user);
      });
    });

    // Delete user
    el.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name || 'denne brukeren';
        if (!window.confirm(`Slette ${name}?\n\nBrukeren mister tilgang umiddelbart.`)) return;
        try {
          await api.deleteUser(btn.dataset.id);
          await load();
        } catch (e) {
          window.ui.toast('Feil: ' + e.message, 'error');
        }
      });
    });
  }

  function openUserModal(user) {
    const isNew = !user;

    window.openModal(userModalHtml(user), () => {
      // Auto-focus
      const nameInput = document.getElementById('modal-display-name');
      if (nameInput) nameInput.focus();

      // Auto-lowercase username as typed
      const unameInput = document.getElementById('modal-username');
      if (unameInput) {
        unameInput.addEventListener('input', () => {
          const pos = unameInput.selectionStart;
          unameInput.value = unameInput.value.toLowerCase().replace(/\s/g, '');
          unameInput.setSelectionRange(pos, pos);
        });
      }

      document.getElementById('modal-save-btn')?.addEventListener('click', async () => {
        const displayName = document.getElementById('modal-display-name')?.value?.trim() || '';
        const username    = document.getElementById('modal-username')?.value?.trim()    || '';
        const password    = document.getElementById('modal-password')?.value            || '';
        const role        = document.getElementById('modal-role')?.value                || 'bruker';
        const leadName    = document.getElementById('modal-lead-name')?.value           || '';

        const errEl = document.getElementById('modal-error');
        function showErr(msg) {
          if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        }

        if (!displayName) { showErr('Visningsnavn er påkrevd'); return; }
        if (isNew && !username) { showErr('Brukernavn er påkrevd'); return; }
        if (!isNew && password && password.length < 6) { showErr('Passordet må være minst 6 tegn'); return; }

        const saveBtn = document.getElementById('modal-save-btn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Lagrer…'; }
        if (errEl) errEl.style.display = 'none';

        try {
          if (isNew) {
            await api.createUser({ displayName, username, role, leadName: leadName || null });
            window.closeModal();
            await load();
            showWelcomeModal(displayName, username);
          } else {
            const patch = { displayName, role, leadName: leadName || null };
            if (password.trim()) patch.password = password;
            await api.updateUser(user._id, patch);
            window.closeModal();
            await load();
          }
        } catch (e) {
          showErr(e.message);
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isNew ? 'Opprett' : 'Lagre'; }
        }
      });
    });
  }

  await load();
}
