# Todo — Regnskapstall fra Brreg + Proff-lenke

Hente regnskapstall (årsresultat, egenkapital, sum eiendeler, sum gjeld) fra det
åpne Regnskapsregisteret for investorer som er koblet til Brønnøysund, og vise dem
i Brønnøysund-kortet. I tillegg en «Sjekk hos Proff»-knapp (søk på org.nr) for
detaljer som ikke finnes i det åpne API-et (kasse/bank, full historikk).

## Bakgrunn / funn
- Åpent API: `https://data.brreg.no/regnskapsregisteret/regnskap/{orgnr}` — gratis, ingen auth.
- Gir kun sum-nivå: årsresultat, sumEgenkapital, sumGjeld, sumEiendeler, sumOmløpsmidler.
- Kasse/bank finnes IKKE i åpent API (kun i fullstendig årsrapport → Proff).
- Ofte kun 1 år tilgjengelig for nyere selskaper.
- Ikke-regnskapspliktige (stiftelser, utland, mange pensjonskasser) → tomt svar → tom-tilstand.
- Proff-lenke: `https://www.proff.no/søk?q={org_nr}` (valgt fremfor eksakt deep-link).

## Backend — routes/brreg.js
- [x] `brregRegnskapGet(orgnr)` — henter fra regnskapsregisteret, resolver mykt (404/tomt → `[]`).
- [x] `parseRegnskap(body)` — plukk år, sorter nyeste først, maks 5 år; null hvis ingen.
- [x] POST `/investors/:id/brreg-sync`: hent regnskap i Promise.all, lagre `brreg_data.regnskap`.
- [x] `brregSyncAll` (cron): samme, med regnskap i lagret brregData.

## Frontend — public/js/pages/investor-detalj.js
- [x] `buildBrregCard`: bygg regnskapsseksjon fra `bd.regnskap`.
- [x] Tre nøkkeltall (Årsresultat m/fortegnsfarge, Egenkapital, Sum eiendeler) i MNOK.
- [x] Historikk-tabell (år vi faktisk har) med Årsresultat, Egenkapital, Sum gjeld.
- [x] «Sjekk hos Proff»-knapp med ekte Proff-logo (SVG), lenker til søk på org.nr.
- [x] Tom-tilstand «Ingen regnskap innsendt» + Proff-knapp når regnskap mangler.
- [x] Plasser seksjonen rett under stamdata-metalinjen, over adresser.

## Verifisering
- [x] Syntakssjekk `node --check` på begge filer — OK.
- [x] `parseRegnskap` mot ekte API (925781630): 137,1 / 819,6 / 837,8 / 18,2 MNOK ✓.
- [x] Tom-svar (enkeltpersonforetak) → `[]` → tom-tilstand ✓.
- [x] Server starter uten crash (`[db] Skjema klar`).
- [ ] UI-sjekk i nettleser — krever innlogging (bruker logger inn, så synk en investor).
- [ ] Bekreft at Proff-knappen åpner søk på org.nr.

## Oppsummering
(fylles ut når ferdig)
