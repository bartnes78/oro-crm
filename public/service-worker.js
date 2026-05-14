const CACHE = 'oro-crm-v2';
const SHELL = [
  '/',
  '/js/app.js',
  '/js/api.js',
  '/js/pages/dashboard.js',
  '/js/pages/investorer.js',
  '/js/pages/investor-detalj.js',
  '/js/pages/logg-kontakt.js',
  '/js/pages/oppgaver.js',
  '/js/pages/prosjekter.js',
  '/js/pages/prosjekt-detalj.js',
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
  // API calls: network first, no cache
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Static assets: cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      });
    })
  );
});
