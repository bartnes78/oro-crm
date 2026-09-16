# Behandlet-markering for feedback (alt. 2)

Legg til mulighet for å markere innmeldt feedback som behandlet — beholder historikk.
Krever også en enkel admin-side, siden feedback i dag kun kan sees via API.

## Backend
- [x] `schema.sql`: `resolved_at TIMESTAMPTZ`, `resolved_by TEXT` på `feedback_reports` (idempotent)
- [x] `routes/admin.js`: GET `/api/feedback` returnerer resolved-felter + `has_screenshot`
- [x] `routes/admin.js`: PUT `/api/feedback/:id/resolve` (body `{resolved}`) — admin, setter/nullstiller + auditLog

## Frontend
- [x] `public/js/api.js`: `resolveFeedback(id, resolved)`
- [x] Ny side `public/js/pages/feedback.js`: åpne saker + kollapsbar behandlet-seksjon, «Marker behandlet»/«Åpne igjen», skjermbilde-modal
- [x] `public/js/app.js`: registrert side `feedback`, admin-nav-punkt (💬 Tilbakemeldinger), ADMIN_PAGES

## Verifisering
- [x] Server startet rent, migrering OK (`Skjema klar`)
- [x] Siden viser «22 åpne · 0 behandlet», 22 kort
- [x] Marker behandlet → 21 åpne · 1 behandlet, server har resolved_at + resolved_by
- [x] Åpne igjen → 22 åpne · 0 behandlet, server nullstilt (test ryddet)

## Oppsummering
Behandlet-markering for feedback levert. `resolved_at`/`resolved_by` på feedback_reports,
PUT-toggle med auditLog, og ny admin-side «Tilbakemeldinger» (💬) som viser åpne saker +
kollapsbar behandlet-liste, med skjermbilde-visning. Historikk beholdes (ingen sletting).
De 20 gamle sakene kan nå hukes av i UI-et — ikke gjort automatisk (venter på klarsignal).
