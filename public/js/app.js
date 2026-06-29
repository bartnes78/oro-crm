import { api } from './api.js';
import { render as renderDashboard }       from './pages/dashboard.js';
import { render as renderInvestorer }      from './pages/investorer.js';
import { render as renderInvestorDetalj }  from './pages/investor-detalj.js';
import { render as renderLogg }            from './pages/logg-kontakt.js';
import { render as renderOppgaver }        from './pages/oppgaver.js';
import { render as renderProsjekter }      from './pages/prosjekter.js';
import { render as renderProsjektDetalj }  from './pages/prosjekt-detalj.js';
import { render as renderDuplikater }      from './pages/duplikater.js';
import { render as renderDupKontakter }    from './pages/duplikat-kontakter.js';
import { render as renderBulk }            from './pages/bulkredigering.js';
import { render as renderEpost }           from './pages/epost-import.js';
import { render as renderOppfolging }      from './pages/oppfolging.js';
import { render as renderBackup }          from './pages/backup.js';
import { render as renderBrukere }         from './pages/bruker-admin.js';
import { render as renderAnalyse }         from './pages/analyse.js';
import { render as renderKanban }          from './pages/kanban.js';
import { render as renderDataKvalitet }    from './pages/data-kvalitet.js';
import { render as renderAuditLogg }       from './pages/audit-logg.js';
import { render as renderPapirkurv }       from './pages/papirkurv.js';

// ── App state ─────────────────────────────────────────────────────────────────
const state = { page: 'dashboard', id: null, currentUser: null };

// Namespace localStorage keys per user so filters don't bleed across accounts
window.lsKey = (key) => `${key}:${state.currentUser?.username || '_'}`;

// ── Navigation ────────────────────────────────────────────────────────────────
window.navigate = function(page, id) {
  state.page = page;
  state.id   = id ?? null;
  renderPage();
  window.scrollTo(0, 0);
};

// ── Modal system ──────────────────────────────────────────────────────────────
window.openModal = function(html, setupFn) {
  const el = document.getElementById('modal');
  el.innerHTML = `
    <div class="modal-box" onclick="event.stopPropagation()">
      ${html}
    </div>`;
  el.classList.add('open');
  el.onclick = () => window.closeModal();
  if (setupFn) setupFn();
};

window.closeModal = function() {
  document.getElementById('modal').classList.remove('open');
};

// ── Helpers exposed globally ──────────────────────────────────────────────────
window.fmt = function(n, dec = 0) {
  if (n == null) return '—';
  return Number(n).toLocaleString('nb-NO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
};

window.phaseBadge = function(phase) {
  const map = {
    'Prospekt':'prospect','Aktiv dialog':'aktivdialog',
    'Investor':'investor','Tidligere investor':'tidligereinvestor','På vent':'pavent',
  };
  return `<span class="badge badge-${map[phase]||'default'}">${phase||'—'}</span>`;
};

window.brregBadge = function(inv) {
  if (!inv || !inv.org_nr) return '';
  return `<span title="Verifisert mot Brønnøysundregistrene (${inv.org_nr})"
    style="display:inline-flex;align-items:center;justify-content:center;
           width:16px;height:16px;border-radius:50%;
           background:#1a8a6a;color:#fff;font-size:9px;font-weight:700;
           margin-left:5px;flex-shrink:0;vertical-align:middle;line-height:1;">✓</span>`;
};

window.escHtml = function(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
};

window.ui = {
  emptyState: (msg) =>
    `<p class="text-muted" style="padding:20px 0;text-align:center;font-size:13px">${window.escHtml(msg)}</p>`,
  emptyRow: (msg, cols) =>
    `<tr><td colspan="${cols}" style="text-align:center;color:var(--muted);padding:20px 0">${window.escHtml(msg)}</td></tr>`,
  pipelineBar: (label, pct, color, count, extra = '') =>
    `<div class="phase-bar">
      <span class="phase-bar-label">${window.escHtml(label)}</span>
      <div class="phase-bar-track"><div class="phase-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="phase-bar-count">${count}</span>
      ${extra}
    </div>`,
  modal: (title, body, footer) =>
    `<div class="modal-header">
      <h3>${title}</h3>
      <button class="btn-close" onclick="window.closeModal()">&#x2715;</button>
    </div>
    <div class="modal-body">${body}</div>
    <div class="modal-footer">${footer}</div>`,
  toast: (msg, type = 'success', duration = 3500) => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icon = type === 'error' ? '✕' : type === 'info' ? 'ℹ' : '✓';
    el.innerHTML = `<span>${icon}</span><span>${window.escHtml(msg)}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      el.addEventListener('animationend', () => el.remove());
    }, duration);
  },
};

// ── Sidebar ───────────────────────────────────────────────────────────────────
const NAV_MAIN = [
  { id:'dashboard',  icon:'◼', label:'Dashboard' },
  { id:'investorer', icon:'◈', label:'Investorer' },
  { id:'epost',      icon:'✉', label:'Importer fra Outlook' },
  { id:'oppfolging', icon:'⏱', label:'Oppfølging' },
  { id:'kanban',     icon:'⬛', label:'Kanban' },
  { id:'oppgaver',   icon:'☑', label:'Oppgaver' },
  { id:'analyse',    icon:'📊', label:'Analyse' },
];
const NAV_ADMIN = [
  { id:'prosjekter',   icon:'◧', label:'Prosjekter' },
  { id:'bulk',         icon:'⊞',  label:'Bulkredigering' },
  { id:'duplikater',   icon:'⧉',  label:'Duplikater' },
  { id:'dupkontakter', icon:'👥', label:'Duplikate kontakter', iconColor:'#E67E22' },
  { id:'backup',       icon:'↩',  label:'Backup' },
  { id:'papirkurv',    icon:'🗑',  label:'Papirkurv',    iconColor:'#e74c3c' },
  { id:'datakvalitet', icon:'✓',   label:'Datakvalitet', iconColor:'#27ae60' },
  { id:'auditlogg',    icon:'📋',  label:'Audit-logg',   iconColor:'#7f8c8d' },
];

function buildSidebar() {
  const nav = document.getElementById('sidebar-nav');
  const isAdmin = state.currentUser?.role === 'admin';

  let html = NAV_MAIN.map(i => navItem(i)).join('');
  html += `<button class="nav-group-header" id="admin-toggle">
    <span class="nav-icon" id="admin-arrow" style="font-size:10px">▸</span> Administrasjon
  </button>
  <div id="admin-items" style="display:none">
    ${NAV_ADMIN.map(i => navItem(i)).join('')}
    ${isAdmin ? navItem({ id:'brukere', icon:'👤', label:'Brukere', iconColor:'#8E44AD' }) : ''}
  </div>`;
  // Global investor search
  html += `
    <div style="padding:10px 16px 4px">
      <div style="display:flex;align-items:center;gap:6px;background:rgba(253,252,249,.08);border:1px solid rgba(253,252,249,.12);border-radius:7px;padding:6px 10px;">
        <span style="opacity:.5;font-size:13px;flex-shrink:0">🔍</span>
        <input id="sidebar-search" type="search" placeholder="Søk investor…"
          style="background:none;border:none;outline:none;color:rgba(253,252,249,.85);font-size:12.5px;font-family:inherit;width:100%;min-width:0;"
          autocomplete="off">
      </div>
    </div>`;

  nav.innerHTML = html;

  nav.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => window.navigate(btn.dataset.page));
  });

  const searchInput = document.getElementById('sidebar-search');
  if (searchInput) {
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = searchInput.value.trim();
        if (!q) return;
        const k = window.lsKey('crm_filter_investorer');
        const saved = JSON.parse(localStorage.getItem(k) || '{}');
        localStorage.setItem(k, JSON.stringify({ ...saved, search: q }));
        searchInput.value = '';
        window.navigate('investorer');
        window.closeSidebar();
      }
    });
  }
  document.getElementById('admin-toggle').addEventListener('click', () => {
    const d     = document.getElementById('admin-items');
    const arrow = document.getElementById('admin-arrow');
    const open  = d.style.display === 'none';
    d.style.display  = open ? '' : 'none';
    arrow.textContent = open ? '▾' : '▸';
  });

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.onclick = async () => {
    logoutBtn.disabled = true;
    try { await api.logout(); } catch { /* lokal sesjon ryddes uansett via reload */ }
    window.location.reload();
  };

  updateSidebarActive();
}

function navItem(i) {
  const iconStyle = i.iconColor ? ` style="color:${i.iconColor}"` : '';
  return `<button class="nav-item" data-page="${i.id}">
    <span class="nav-icon"${iconStyle}>${i.icon}</span>${escHtml(i.label)}
  </button>`;
}

const ADMIN_PAGES = new Set(['prosjekter','prosjektDetalj','bulk','duplikater','dupkontakter','backup','brukere','papirkurv','datakvalitet','auditlogg']);

function updateSidebarActive() {
  const cur = state.page === 'detalj' ? 'investorer'
            : state.page === 'prosjektDetalj' ? 'prosjekter'
            : state.page;
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === cur);
  });

  // Auto-expand admin section when navigating to an admin page
  if (ADMIN_PAGES.has(state.page)) {
    const d     = document.getElementById('admin-items');
    const arrow = document.getElementById('admin-arrow');
    if (d && d.style.display === 'none') {
      d.style.display   = '';
      if (arrow) arrow.textContent = '▾';
    }
  }

  const userSpan = document.getElementById('sidebar-user');
  if (userSpan && state.currentUser) {
    userSpan.textContent = state.currentUser.displayName +
      (state.currentUser.role === 'admin' ? ' · admin' : '');
  }

  const mobileTitle = document.getElementById('mobile-title');
  if (mobileTitle) {
    const allNav = [...NAV_MAIN, ...NAV_ADMIN,
      { id:'detalj', label:'Investor' }, { id:'prosjektDetalj', label:'Prosjekt' }, { id:'brukere', label:'Brukere' }];
    const found = allNav.find(n => n.id === state.page);
    mobileTitle.textContent = found ? found.label : 'ORO CRM';
  }
}

// ── Mobile sidebar ────────────────────────────────────────────────────────────
window.toggleSidebar = function() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  const isOpen = sb.classList.contains('open');
  sb.classList.toggle('open', !isOpen);
  ov.classList.toggle('open', !isOpen);
};
window.closeSidebar = function() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
};

// ── Render ────────────────────────────────────────────────────────────────────
function renderPage() {
  updateSidebarActive();
  window.closeSidebar();

  const el = document.getElementById('page-container');
  const { page, id } = state;

  const titles = {
    dashboard:'Dashboard', investorer:'Investorer', detalj:'Investor',
    logg:'Logg kontakt', oppgaver:'Oppgaver', prosjekter:'Prosjekter',
    prosjektDetalj:'Prosjekt', duplikater:'Duplikater',
    dupkontakter:'Duplikate kontakter', bulk:'Bulkredigering',
    epost:'E-post import', oppfolging:'Oppfølging', backup:'Backup',
    brukere:'Brukere', analyse:'Analyse',
    datakvalitet:'Datakvalitet', auditlogg:'Audit-logg', papirkurv:'Papirkurv', kanban:'Pipeline Kanban',
  };
  const mobileTitle = document.getElementById('mobile-title');
  if (mobileTitle) mobileTitle.textContent = titles[page] || 'ORO CRM';

  switch (page) {
    case 'dashboard':      renderDashboard(el, state);       break;
    case 'investorer':     renderInvestorer(el, state);      break;
    case 'detalj':         renderInvestorDetalj(el, state);  break;
    case 'logg':           renderLogg(el, state);            break;
    case 'oppgaver':       renderOppgaver(el, state);        break;
    case 'prosjekter':     renderProsjekter(el, state);      break;
    case 'prosjektDetalj': renderProsjektDetalj(el, state);  break;
    case 'duplikater':     renderDuplikater(el, state);      break;
    case 'dupkontakter':   renderDupKontakter(el, state);    break;
    case 'bulk':           renderBulk(el, state);            break;
    case 'epost':          renderEpost(el, state);           break;
    case 'oppfolging':     renderOppfolging(el, state);      break;
    case 'backup':         renderBackup(el, state);          break;
    case 'brukere':        renderBrukere(el, state);         break;
    case 'analyse':        renderAnalyse(el, state);         break;
    case 'kanban':         renderKanban(el, state);           break;
    case 'datakvalitet':   renderDataKvalitet(el, state);    break;
    case 'auditlogg':      renderAuditLogg(el, state);       break;
    case 'papirkurv':      renderPapirkurv(el, state);       break;
    default:
      el.innerHTML = '<div class="content"><p class="text-muted">Side ikke funnet.</p></div>';
  }
}

// ── Feedback ──────────────────────────────────────────────────────────────────
window.openFeedback = async function() {
  let screenshotDataUrl = null;
  try {
    const canvas = await html2canvas(document.body, { scale: 0.6, useCORS: true, logging: false });
    screenshotDataUrl = canvas.toDataURL('image/jpeg', 0.7);
  } catch { /* skip screenshot on error */ }

  window.openModal(window.ui.modal(
    'Rapporter feil eller foreslå forbedring',
    `<div class="form-group">
      <label>Hva er feil eller hva foreslår du å forbedre?</label>
      <textarea id="fb-comment" rows="5" placeholder="Beskriv feilen eller forslaget..." style="width:100%"></textarea>
    </div>
    ${screenshotDataUrl
      ? `<div style="margin-top:12px"><img src="${screenshotDataUrl}" style="width:100%;border-radius:6px;border:1px solid var(--border)" alt="Skjermbilde"></div>`
      : '<p class="text-muted" style="font-size:12px;margin-top:8px">Skjermbilde kunne ikke tas.</p>'}`,
    `<button class="btn btn-ghost" onclick="window.closeModal()">Avbryt</button>
     <button class="btn btn-primary" id="fb-save-btn">Lagre</button>`
  ), () => {
    document.getElementById('fb-save-btn').addEventListener('click', async () => {
      const comment = document.getElementById('fb-comment').value.trim();
      if (!comment) { document.getElementById('fb-comment').focus(); return; }
      const btn = document.getElementById('fb-save-btn');
      btn.disabled = true; btn.textContent = 'Lagrer…';
      try {
        await api.submitFeedback({ page: state.page, comment, screenshot: screenshotDataUrl });
        window.closeModal();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Lagre';
        window.ui.toast('Kunne ikke lagre: ' + e.message, 'error');
      }
    });
    setTimeout(() => document.getElementById('fb-comment')?.focus(), 50);
  });
};

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }

  try {
    state.currentUser = await api.me();
  } catch {
    showLogin();
    return;
  }

  await bootAuthed();
}

// Kjøres etter vellykket autentisering (ved oppstart eller etter login)
async function bootAuthed() {
  buildSidebar();
  if (state.currentUser?.mustChangePassword) {
    await showChangePasswordModal();
  }
  renderPage();
}

// Utløpt eller manglende sesjon → vis login (idempotent: kalles både fra init og fra api-401-hook)
function showLogin() {
  if (document.getElementById('login-overlay')) return;
  state.currentUser = null;

  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--green);padding:20px';
  overlay.innerHTML = `
    <form id="login-form" autocomplete="on" style="background:var(--card);border-radius:12px;padding:32px 28px;width:100%;max-width:360px;box-shadow:0 24px 64px rgba(15,73,73,.35)">
      <img src="/logo.svg" alt="ORO" style="height:44px;width:auto;display:block;margin:0 auto 8px">
      <p style="text-align:center;font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:24px">Investor CRM</p>
      <div id="login-error" style="display:none;background:#fdeaec;color:var(--red);border-radius:6px;padding:9px 12px;font-size:13px;margin-bottom:14px"></div>
      <div class="form-group" style="margin-bottom:12px">
        <label style="display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:5px">Brukernavn</label>
        <input id="login-username" name="username" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" style="width:100%;min-height:44px" required>
      </div>
      <div class="form-group" style="margin-bottom:20px">
        <label style="display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:5px">Passord</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" style="width:100%;min-height:44px" required>
      </div>
      <button type="submit" id="login-btn" class="btn btn-primary" style="width:100%;min-height:46px">Logg inn</button>
    </form>`;
  document.body.appendChild(overlay);

  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('login-btn');
  document.getElementById('login-username').focus();

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) {
      errEl.textContent = 'Fyll inn brukernavn og passord'; errEl.style.display = 'block'; return;
    }
    btn.disabled = true; btn.textContent = 'Logger inn…';
    try {
      state.currentUser = await api.login(username, password);
      overlay.remove();  // fjerner passordfeltet fra DOM → nettleseren tilbyr å lagre passordet
      await bootAuthed();
    } catch (err) {
      errEl.textContent = err.message || 'Innlogging feilet';
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Logg inn';
      const pw = document.getElementById('login-password');
      pw.value = ''; pw.focus();
    }
  });
}

window.onUnauthorized = showLogin;

function showChangePasswordModal() {
  return new Promise(resolve => {
    const html = `
      <div class="modal-header">
        <h3>Endre passord</h3>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--muted);margin-bottom:16px">
          Velkommen! Du må sette et nytt passord før du kan bruke CRM-et.
        </p>
        <div id="cp-error" style="display:none" class="alert-err"></div>
        <div class="form-group">
          <label>Nytt passord <span style="font-weight:400;color:var(--muted)">(minst 6 tegn)</span></label>
          <input id="cp-pass1" type="password" placeholder="Nytt passord" style="min-height:44px">
        </div>
        <div class="form-group" style="margin-top:12px">
          <label>Gjenta passord</label>
          <input id="cp-pass2" type="password" placeholder="Gjenta passord" style="min-height:44px">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" id="cp-save-btn" style="min-height:44px">Lagre passord</button>
      </div>`;

    window.openModal(html, () => {
      document.getElementById('cp-pass1')?.focus();

      document.getElementById('cp-save-btn')?.addEventListener('click', async () => {
        const p1 = document.getElementById('cp-pass1').value;
        const p2 = document.getElementById('cp-pass2').value;
        const errEl = document.getElementById('cp-error');
        const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };

        if (p1.length < 6) { showErr('Passordet må være minst 6 tegn'); return; }
        if (p1 !== p2)     { showErr('Passordene er ikke like'); return; }

        const btn = document.getElementById('cp-save-btn');
        btn.disabled = true; btn.textContent = 'Lagrer…';
        try {
          await api.changeMyPassword(p1);
          state.currentUser.mustChangePassword = false;
          window.closeModal();
          resolve();
        } catch (e) {
          showErr(e.message);
          btn.disabled = false; btn.textContent = 'Lagre passord';
        }
      });
    });

    // Prevent closing by clicking backdrop
    document.getElementById('modal').onclick = null;
  });
}

init();
