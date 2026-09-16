# Neste bolk — åpne feedback-saker

Fra `feedback_reports` i DB. Tag-feltet er levert og deployet (commit ca6db86).

---

## #21 — Møtedato / neste møte (feedback 2026-09-09, investor-detalj) ✅

**Funn:** `meeting_date`-kolonnen var død. Valg (bruker): utled «neste møte» fra planlagte
møte-aktiviteter i loggen — én sannhet, ingen dobbeltføring.

**Levert:**
- [x] Backend: GET `/api/investors` aggregerer neste planlagte `Møte` (status=planlagt, date ≥ i dag) per investor → `next_meeting`
- [x] `fmtInvestor` eksponerer `next_meeting`
- [x] Investorliste: ny «Neste møte»-kolonne (📅, blå når satt)
- [x] Investor-detalj: «📅 Neste møte» i sidebar-nøkkeltall (utledet fra `inv.log`)
- [x] `meeting_date`-kolonnen latt ligge dormant (kun 1 gammel verdi) — destruktiv DROP tas
      som egen, bevisst opprydding med backup, ikke i denne commiten
- [ ] (utsatt) Kommende møter i «Min dag» — sidepanelet viser alt planlagte/forfalte

## #22 — Raskere avslagsregistrering (feedback 2026-09-15, prosjektDetalj) ✅

**Funn:** avslags-modalen på prosjektsiden har en nedtrekksliste (`DECLINE_REASONS`) som
manglet «Ønsker ikke fond» — grunnen bruker sier er vanligst.

**Levert:**
- [x] La til «Ønsker ikke fond» øverst i `DECLINE_REASONS` + flyttet «Timing» opp (vanligst først)

---

## Verifisering
- [x] Server startet rent (nodemon), ingen feil i logg
- [x] #21 API returnerer `next_meeting` (4 investorer med planlagt møte)
- [x] #21 liste: kolonne + datoer vises (INV-003 06.10, INV-220 12.10)
- [x] #21 detalj: «Neste møte 06. okt. 2026» i sidebar (INV-003)
- [x] #22 modal: «Ønsker ikke fond» først i nedtrekkslista

## Merk
- Service-worker-cache må tømmes ved testing for å se ny JS (kjent felle).
- Lagret listefilter i localStorage kan beholde en tag/verdi som ikke lenger finnes →
  tom liste til «Nullstill» trykkes. Liten pre-eksisterende UX-glipp, verdt å rydde senere.
- De ~20 eldre feedback-sakene (juni 2026) ser ut som allerede løst — bør ryddes/markeres.
