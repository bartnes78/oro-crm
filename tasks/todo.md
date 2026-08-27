# Ytelse: lazy-lasting av sider + fjerne html2canvas-404

## Mål
Redusere opplevd treghet ved oppstart uten å innføre byggesteg.

## #1 — Lazy-last sidemoduler (største spak)
- [x] Bytt de 19 statiske `import ... from './pages/*.js'` i app.js mot et `PAGES`-register med `() => import('./pages/*.js')`
- [x] Gjør `renderPage()` async: last kun siden brukeren navigerer til, med race-guard (`state.page !== page` → avbryt)
- [x] Behold `api.js` og `tutorial.js` statisk (brukes ved boot)
- [x] Feilhåndtering hvis en modul ikke lastes

## #2 — Fjern html2canvas-404 + lazy-last
- [x] Kopier `node_modules/html2canvas/dist/html2canvas.min.js` → `public/js/vendor/`
- [x] Fjern blokkerende `<script src="/js/vendor/html2canvas.min.js">` fra index.html `<head>`
- [x] Lazy-injiser html2canvas kun når feedback-modalen åpnes (`loadHtml2canvas()`-helper)

## #3 — Cache-invalidering
- [x] Bump service-worker CACHE v12 → v13 så ny app.js/index.html når klientene

## Verifisering
- [x] `npm run dev`, last i nettleser — Network på boot: kun `/`, logo.svg, app.js, api.js, tutorial.js, /api/me. Ingen sidemoduler.
- [x] Naviger mellom sider — verifisert i browser (brukerens innloggede sesjon): klikk Kanban → nøyaktig én `kanban.js`-fetch on-demand, siden tegnet fullt ut (669 investorer).
- [x] Ingen 404 på html2canvas ved sidelast (fjernet fra `<head>`; serverer 200 on-demand fra /js/vendor/)
- [x] Åpne feedback (🐛) → verifisert: `html2canvas.min.js` hentet on-demand (200), modal åpnet med gyldig data:image/jpeg-skjermbilde.
- [x] Ingen konsollfeil (kun forventet 401 på /api/me før login)

## Oppsummering
Boot-payload gikk fra 22 JS-filer (app.js + api.js + tutorial.js + 19 sider) til 3.
Sidemoduler lastes nå on-demand ved navigasjon og caches av nettleseren + service worker.
html2canvas (~200KB) lastes kun når feedback-knappen brukes, ikke på hver sidelast —
og 404-en på hver boot er borte (feedback-skjermbilder virker igjen).

Gjenstår å teste innlogget i prod: (1) at hver side faktisk tegner ved navigasjon,
(2) at feedback-skjermbildet tas. Deploy-forward-arbeidsflyt.

Merk (utenfor scope): service-worker SHELL pre-cacher ikke kanban/data-kvalitet/
audit-logg/papirkurv — de caches likevel ved første navigasjon (stale-while-revalidate),
så kun relevant for full offline-PWA-bruk. Kan legges til senere ved behov.
