# Forkast = avvist men beholdes (ikke papirkurv)

Forkastede leads blir liggende som ukvalifiserte (is_lead=TRUE, discarded_at satt),
skjult fra aktiv liste men hentbare via filter — og re-surfacer hvis de treffer i ny import.

## Backend
- [ ] `schema.sql`: `discarded_at TIMESTAMPTZ` + `discarded_by TEXT` på investors (idempotent)
- [ ] `fmtInvestor`: returner `discarded_at`
- [ ] GET `/api/investors`: `leads=1` = aktive (discarded_at IS NULL) som default;
      `includeDiscarded=1` tar med forkastede
- [ ] Ny rute `POST /api/investors/:id/discard` (body `{discarded}`) — sett/nullstill
      discarded_at + discarded_by + auditLog
- [ ] `import-leads.js`: sikre treff mot forkastet lead → union tag OG nullstill discarded_at
      (re-surface), rapporter det

## Frontend
- [ ] `api.js`: `discardLead(id, discarded)`
- [ ] `leads.js`: last aktive + forkastede i ett kall; «Vis forkastede (N)»-filter;
      Forkast = discard (ut av aktiv); forkastet-rad → Gjenopprett + Slett (papirkurv, admin);
      behold Slett for søppel i aktiv (admin)

## Verifisering
- [x] Backend: discard tar ut av aktiv (125→124), includeDiscarded tar med, gjenopprett tilbake
- [x] Import re-surface: forkastet lead treffes → «[re-surfaces fra forkastet]» i rapport;
      --commit nullstilte discarded_at + union'et ny tag (testlead ryddet)
- [x] UI: Forkast → «Forkastede leads»-visning m/notat + Gjenopprett + Slett; Gjenopprett → aktiv
- [x] Slett → papirkurv (uendret)

## Oppsummering
«Forkast» er nå en lett avvist-men-behold-tilstand (`discarded_at`), ikke papirkurv: leadet
beholdes som ukvalifisert, skjules fra aktiv liste, hentes via «Vis forkastede (N)» med
Gjenopprett — og re-surfacer automatisk (discarded_at nullstilles) hvis det treffer i en ny
import. Egen «Slett» (papirkurv, admin) beholdt for søppel. Deployet.
NB testrader i papirkurv: INV-992 (forrige økt) + INV-993 (denne) — kan tømmes manuelt.
