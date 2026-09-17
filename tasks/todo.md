# Kapital 400 2025-import (tag + meta)

Bruk tags (ikke kategori-tabeller). «K400 2025» = tag (medlemskap/filter). Rang/formue i
`list_meta["K400 2025"]` (én nøkkel per år → siste år trumfer, eldre ligger igjen). Persondata
committes ALDRI til repoet.

## Kode
- [x] `scripts/import-kapital400.js` — leser Cowork-JSON, tag_existing (by id) → tag+meta,
      new_leads → dedup (gjenbruker helpers): sikre→union, usikre→rapporter, rene→opprett.
      Dry-run default, `--apply` skriver. År/tag parametrisert (gjenbruk for 2026).
- [x] `schema.sql`: `list_meta JSONB` på investors
- [x] `fmtInvestor`: returnerer `list_meta`
- [x] Rapport: svake treff (40–60%) logges (NorgesGruppen m.fl.) — opprettes, manuell vurdering

## Dry-run (verifisert)
- [x] 159 tag_existing: alle funnet, 0 manglende
- [x] 214 nye: alle opprettes, 0 sikre/usikre duplikater (dedup sanity-sjekket)
- [x] 5 svake treff rapportert (NorgesGruppen → manuell)

## Kjøring (GDPR OK gitt) ✅
- [x] Commit + push (735bd69) → list_meta-kolonnen i prod bekreftet
- [x] Backup av prod: stamp 2026-09-17_10-32-21 (10 tabeller)
- [x] `--apply`: 159 tagget, 214 nye leads
- [x] Stikkprøver: Ferd INV-220 (rank 6, 53 mrd), Canica INV-685 (rank 9, 33.1 mrd),
      Hemen Holding INV-994 (nytt lead, tag + kontakt m/tittel). Totalt tag «K400 2025» = 373.

## Følger etter (egen jobb)
- [ ] UI: vis rang/formue fra list_meta (gjeldende = nyeste år) + 2025-vs-2026-sammenligning
- [ ] Kapital 400 2026 når Cowork er ferdig (samme kommando, 2026-JSON)
