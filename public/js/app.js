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

// ── App state ─────────────────────────────────────────────────────────────────
const state = { page: 'dashboard', id: null, currentUser: null };

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
  el.classList.remove('hidden');
  el.onclick = () => window.closeModal();
  if (setupFn) setupFn();
};

window.closeModal = function() {
  document.getElementById('modal').classList.add('hidden');
};

// ── Helpers exposed globally ──────────────────────────────────────────────────
window.fmt = function(n, dec = 0) {
  if (n == null) return '—';
  return Number(n).toLocaleString('nb-NO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
};

window.phaseBadge = function(phase) {
  const map = {
    'Prospekt':'prospect','Ny kontakt':'nykontakt','Intro sendt':'introsendt',
    'Møte avtalt':'moteavtalt','Aktiv dialog':'aktivdialog',
    'Tegnet':'tegnet','Ikke relevant nå':'ikkerelevan','Onboardet':'onboardet',
  };
  return `<span class="badge badge-${map[phase]||'default'}">${phase||'—'}</span>`;
};

window.escHtml = function(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
};

// ── Sidebar ───────────────────────────────────────────────────────────────────
const NAV_MAIN = [
  { id:'dashboard',  icon:'◼', label:'Dashboard' },
  { id:'investorer', icon:'◈', label:'Investorer' },
  { id:'logg',       icon:'✎', label:'Logg kontakt' },
  { id:'epost',      icon:'✉', label:'Importer fra Outlook' },
  { id:'oppfolging', icon:'⏱', label:'Oppfølging' },
  { id:'oppgaver',   icon:'☑', label:'Oppgaver' },
  { id:'prosjekter', icon:'◧', label:'Prosjekter' },
];
const NAV_ADMIN = [
  { id:'bulk',         icon:'⊞', label:'Bulkredigering' },
  { id:'duplikater',   icon:'⧉', label:'Duplikater' },
  { id:'dupkontakter', icon:'👥', label:'Duplikate kontakter' },
  { id:'backup',       icon:'↩', label:'Backup' },
];

function buildSidebar() {
  const nav = document.getElementById('sidebar-nav');
  const isAdmin = state.currentUser?.role === 'admin';

  let html = NAV_MAIN.map(i => navItem(i)).join('');
  html += `<button class="nav-group-header" id="admin-toggle">
    <span class="nav-icon" style="font-size:10px">▾</span> Administrasjon
  </button>
  <div id="admin-items">
    ${NAV_ADMIN.map(i => navItem(i)).join('')}
    ${isAdmin ? navItem({ id:'brukere', icon:'👤', label:'Brukere' }) : ''}
  </div>`;
  nav.innerHTML = html;

  nav.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => window.navigate(btn.dataset.page));
  });
  document.getElementById('admin-toggle').addEventListener('click', () => {
    const d = document.getElementById('admin-items');
    d.style.display = d.style.display === 'none' ? '' : 'none';
  });

  updateSidebarActive();
}

function navItem(i) {
  return `<button class="nav-item" data-page="${i.id}">
    <span class="nav-icon">${i.icon}</span>${escHtml(i.label)}
  </button>`;
}

function updateSidebarActive() {
  const cur = state.page === 'detalj' ? 'investorer'
            : state.page === 'prosjektDetalj' ? 'prosjekter'
            : state.page;
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === cur);
  });

  const userSpan = document.getElementById('sidebar-user');
  if (userSpan && state.currentUser) {
    userSpan.textContent = state.currentUser.displayName +
      (state.currentUser.role === 'admin' ? ' · admin' : '');
  }
}

// ── Mobile sidebar ────────────────────────────────────────────────────────────
window.toggleSidebar = function() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  const open = !sb.classList.contains('-translate-x-full');
  sb.classList.toggle('-translate-x-full', open);
  ov.classList.toggle('hidden', open);
};
window.closeSidebar = function() {
  document.getElementById('sidebar').classList.add('-translate-x-full');
  document.getElementById('sidebar-overlay').classList.add('hidden');
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
    epost:'E-post import', oppfolging:'Oppfølging', backup:'Backup', brukere:'Brukere',
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
    default:
      el.innerHTML = '<div class="content"><p class="text-muted">Side ikke funnet.</p></div>';
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    state.currentUser = await api.me();
  } catch { /* Browser shows Basic Auth dialog */ }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }

  buildSidebar();
  renderPage();
}

init();
