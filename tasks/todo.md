# Duplikat-håndtering i leads-lista

## Backend
- [ ] Fiks `/api/merge`: union tags (keep + drop, dedup case-insensitivt) — bevar kilde ved merge
- [ ] Ny rute `GET /api/leads/duplicates`: per lead, beste treff mot ALLE ikke-slettede
      (investorer + andre leads), jaccard ≥ 0.6, ekskluder seg selv → {lead_id: {id,name,score,is_lead}}

## Frontend
- [ ] `api.js`: `leadDuplicates()`
- [ ] `leads.js`: last leads + dup-map parallelt; «⚠ ligner X (n%)»-badge på rad;
      «Slå sammen» (admin, keep=match, drop=lead) + Forkast; «Kun duplikater»-filter; dup først

## Backend ✅ / Frontend ✅

## Verifisering
- [x] Merge bevarer tags: keep[FBN]+drop[K400,FBN] → [FBN,K400] (union, dedup) — testrader ryddet
- [x] `/api/leads/duplicates`: 26 leads med treff (mest 100% mot eksisterende investorer), ~2,3s
- [x] Leads-lista: 26 badges + 26 «Slå sammen», «Kun duplikater (26)»-filter virker, dup øverst
- [x] Skjermbilde bekreftet

## Oppsummering
Live duplikat-flagging i leads-lista: nytt `/api/leads/duplicates` (per lead beste treff mot
alle ikke-slettede, jaccard ≥ 0.6, investor foretrekkes ved lik score), badge «⚠ ligner X (n%)»,
«Slå sammen»-knapp (admin → /api/merge), «Kun duplikater»-filter, dup sortert øverst. Fikset
`/api/merge` til å union'e tags (kilde bevares ved sammenslåing). Deployet.
NB: én testrad «ZZ Merge Keep Test» (INV-992) ligger igjen i papirkurven — kan tømmes manuelt.
