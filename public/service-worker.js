const CACHE = 'oro-crm-v16';
const SHELL = [
  '/',
  '/js/app.js',
  '/js/api.js',
  '/js/tutorial.js',
  '/js/pages/dashboard.js',
  '/js/pages/investorer.js',
  '/js/pages/investor-detalj.js',
  '/js/pages/logg-kontakt.js',
  '/js/pages/oppgaver.js',
  '/js/pages/prosjekter.js',
  '/js/pages/prosjekt-detalj.js',
  '/js/pages/analyse.js',
  '/js/pages/duplikater.js',
  '/js/pages/duplikat-kontakter.js',
  '/js/pages/bulkredigering.js',
  '/js/pages/epost-import.js',
  '/js/pages/oppfolging.js',
  '/js/pages/backup.js',
  '/js/pages/bruker-admin.js',
  '/logo.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) {
    return; // Let browser handle API requests directly — SW interception can drop custom headers
  }
  // HTML: network-first so updates land immediately
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok) caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // JS/CSS: network-first — nye deployer lander umiddelbart. Cache er kun offline-fallback.
  // (Tidligere stale-while-revalidate serverte gammel JS én versjon bak etter hver deploy.)
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.svg')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok) { const clone = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Everything else: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
