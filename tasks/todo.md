# Kapital 400 2026 + relaterte selskaper

## Kapital 400 2026 ✅
- [x] Backup (2026-09-17_10-56-24) → `--apply`: 352 tagget, 14 nye leads, 1 flagget (TH Holm), 0 manglende
- [x] År-sammenligning bekreftet: Ferd 2026 #7/55 mrd gjeldende, 2025 #6/53 mrd (+2,0). 350 på begge år.

## Relaterte selskaper (kjerne) ✅
- [x] Schema: `persons` + `person_companies` (relation/rolle/verified, investor_id nullable)
- [x] Importør Fase C: leser `related_companies`, upsert person (dedup på navn) + koblinger
      (verified=true når crm_id satt); relation settes manuelt, DO UPDATE bevarer den
- [x] API: `related_persons` i GET /api/investors/:id; POST /persons/:id/main (hovedselskap);
      POST /persons/:id/create-lead (opprett lead fra relatert selskap)
- [x] UI: «🔗 Personer og relaterte selskaper»-kort — klikkbare CRM-selskaper, «Sett som hoved»,
      «Opprett som lead» for de utenfor CRM
- [x] Verifisert: Johan Johannson på INV-312/INV-997 + 6 selskaper utenfor CRM; set-hoved gir
      ★-badge (testet + nullstilt så bruker velger selv)

## Følger etter (egen jobb / Fase 2)
- [ ] contacts.person_id-kobling + egen person-detaljside (mest verdi når flere personer fylt ut)
- [ ] Evt. rang-chip i leads/investor-lista
- [ ] Fyll ut related_companies for flere personer (John Fredriksen/Geveran m.fl.) i Cowork
