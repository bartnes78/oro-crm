# Tag-felt på investorer

Frie tekst-tags på investorer, med autocomplete-forslag fra eksisterende tags.
Lagres som JSONB-array på `investors`. Vises på investor-detalj + som filter i investorlista.

## Backend
- [x] `schema.sql`: idempotent `ALTER TABLE investors ADD COLUMN tags JSONB DEFAULT '[]'` + GIN-indeks
- [x] `lib/helpers.js`: `fmtInvestor` returnerer `tags`
- [x] `routes/investors.js`:
  - [x] valider at `tags` er liste med tekst
  - [x] `normalizeTags()` — trim, dropp tomme, dedupliser (case-insensitivt)
  - [x] PUT lagrer `tags`
  - [x] GET `/api/investors` støtter `?tag=`-filter (`tags @> $n`)
  - [x] ny rute GET `/api/tags` → distinkte tags for autocomplete

## Frontend
- [x] `public/js/api.js`: `tags()` + (updateInvestor finnes)
- [x] `public/js/pages/investor-detalj.js`: Tags-kort med chips + input m/ `<datalist>`, legg til/fjern → lagre inline
- [x] `public/js/pages/investorer.js`: tag-filter i filterlinja

## Verifisering
- [x] `npm run dev` starter rent — `[db] Skjema klar` (migrering kjørte OK mot prod-DB)
- [x] `GET /api/tags` → 200, tom liste → populert etter add
- [x] Detalj: legg til tag via UI (persisteres, chip vises)
- [x] Dedup: «vip-test» duplikat av «VIP-test» → ikke lagt til
- [x] Detalj: fjern tag via ×-knapp (persisteres)
- [x] Liste: «Alle tags»-filter vises, filtrerer korrekt (tag → 1 treff)
- [x] Opprydding: testtags fjernet fra INV-033 (`tags: []`)

## Oppsummering
Frie tekst-tags på investorer levert. JSONB-kolonne `tags` + GIN-indeks, `fmtInvestor`,
validering + `normalizeTags` (trim/dedup case-insensitivt), PUT-lagring, `?tag=`-filter og
`GET /api/tags`. Frontend: Tags-kort på detalj (chips + `<datalist>`-autocomplete, inline
lagring med optimistisk revert ved feil) og tag-filter i investorlista (gated på at tags finnes).
Verifisert ende-til-ende i nettleser mot prod-DB; alle testtags ryddet opp.
Ikke commitet/deployet ennå — venter på klarsignal.
