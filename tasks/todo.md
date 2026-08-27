# Leads å kvalifisere — liste + kvalifiser/forkast-handlinger

## Kontekst
Min dag-panelet teller ukvalifiserte leads (is_lead=TRUE) men lenket bare til ett
lead, og det fantes ingen liste eller kvalifiser-handling i UI. Modell: leads
promoteres ved å sette is_lead=FALSE. Ved kvalifisering → fase = Prospekt (bekreftet).

## Oppgaver
- [x] Backend: `POST /api/investors/:id/qualify` (authed) → is_lead=FALSE, phase='Prospekt', audit-logg (routes/investors.js)
- [x] api.js: `qualifyLead(id)`
- [x] Ny side `public/js/pages/leads.js`: liste over is_lead=TRUE med Navn/Type/Sted/Kilde + knapper «Kvalifiser» (alle) og «Forkast» (kun admin, gjenbruker DELETE→papirkurv); navn-klikk → detalj
- [x] app.js: registrer `leads`-side (PAGES, titles)
- [x] dashboard.js: Min dag «Leads å kvalifisere»-rad → `navigate('leads')` i stedet for ett lead
- [x] service-worker cache v14→v15

## Beslutninger
- Kvalifiser tilgjengelig for alle innloggede (kjerne-lead-arbeid). Forkast (soft-delete
  til papirkurv) kun admin — gjenbruker eksisterende DELETE, konsistent med app-modellen.
- Fase ved kvalifisering: **Prospekt**.

## Verifisering
- [x] Røyktest: leads.js parser + eksporterer render (dynamisk import i nettleser)
- [~] Innlogget render/klikk IKKE testet av Claude — dev treffer prod-DB, kvalifiser/forkast
      ville mutert ekte data. Testes i prod (deploy-forward).

## Oppsummering
Leads-panelet var halvbygd: talte ukvalifiserte leads (is_lead=TRUE) uten liste eller
kvalifiser-handling. Nå: Min dag-raden åpner en full liste (`GET /investors?leads=1`),
hvert lead kan kvalifiseres (→ investor, fase Prospekt, via nytt qualify-endepunkt) eller
forkastes (admin → papirkurv). Fase-valg bekreftet med bruker: Prospekt.
Kjørt gjennom deploy-pipelinen som forrige leveranser.
