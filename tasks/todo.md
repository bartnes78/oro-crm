# Lead-kilde som tag + kvalifisering fra investorkortet

## Del 1 — Kilde blir tag ved import, med overlapp-håndtering ✅
- [x] `scripts/import-leads.js`: `--tag=`-flagg (fallback per-rad `kilde`)
- [x] Dedup-pool = ALLE ikke-slettede (leads + investorer), henter org_nr + tags
- [x] Sikkert treff (navn ≥ 0.9) → union tag på eksisterende, ingen dublett
- [x] Usikkert treff (0.6–0.9) → flagg for manuell merge (som før)
- [x] Ingen/lavt treff → ny lead med `tags=[tag]`
- [x] Rapport viser innsatt / tag-union / flagget
- [x] `scripts/backfill-lead-tags.js` (dry-run + --commit), idempotent

## Del 2 — Kvalifiser direkte fra investorkortet ✅
- [x] `investor-detalj.js`: banner + Kvalifiser/Forkast når `inv.is_lead`, kaller qualifyLead + reload

## Verifisering
- [x] Importør dry-run: 198 union-tag, 2 innsatt, 0 dublett (fbn-CSV + --tag=«K400 2025»)
- [x] Back-fill dry-run: 216 lead-rader mangler kilde-tag
- [x] Kvalifiser fra kort: is_lead→false, banner forsvinner (testet på INV-754, revertert)

## Gjenstår (venter på brukeren)
- [ ] Kjøre back-fill --commit mot prod — MEN kilde-verdiene er ordrike
      («FBN Norsk Familieeierskap (fbn.no/vare-medlemmer)»). Avklar om vi bruker source
      ordrett, eller korte labels (f.eks. «Finansavisen 2026», «FBN 2026»).
- [ ] Kjøre reell K400 2025-import med `--tag="K400 2025"` når CSV er klar.

## Oppsummering
Kode levert: importør tagger + slår sammen overlapp (kun sikre treff), back-fill-skript,
og Kvalifiser/Forkast rett fra investorkortet. Ingen prod-data skrevet ennå av del 1
(kun dry-run) — venter på avklaring om tag-labels før back-fill.
