# ORO CRM — Oppgaveliste

## Pågående

### Produktinteresse-opprydding (bug #4, #6, #7)

- [x] **#7 dashboard** — allerede løst: `buildGaugeCards()` filtrerer på Pipeline/Fundraise og kortene er klikkbare (`gauge-card-link` → `prosjektDetalj`)
- [x] **#4/#6 investor-detalj** — `buildProductCard()`: delt i seksjoner — aktiv interesse øverst, "Tegnet" i egen seksjon, "Avslått" i egen seksjon nederst
- [x] **#6.2** — `buildContactsCard()`: kontakter sorteres slik at `source==='brreg'` vises sist (stabil sortering ellers)
- [x] **#6.3** — tydeligere merking av avslag: egen "Avslått"-seksjon med overskrift i produktkortet
- [ ] Manuell test: investor med tegnet+aktiv+avslått produkt, kontaktliste med Brreg-kontakter (kristian — server kjører på localhost:3001)

### Resterende bug-rapporter (#5, #8, #9)

- [x] **#5** — `buildProductCard()`: ned 1px på produktnavn (13→12px), ticket/% inputs og enheter (12→11px)
- [x] **#8** — allerede løst: "+ Kontakt"-knapp (`brreg-add-contact-btn`) per Brreg-rolle som ikke allerede er kontakt, ingen auto-flytting
- [x] **#9** — `dashboard.js` `buildGaugeCards()`: prosjekter >4 får klasse `gauge-extra`, "Vis X flere"/"Vis færre"-knapp toggler `.gauge-collapsed`. CSS skjuler `.gauge-extra` og viser knappen kun under 640px (mobil)
- [ ] Manuell test: dashboard på mobilbredde med >4 aktive prosjekter (vis mer/færre), "+Kontakt fra rolle" på Brreg-kort

### Bulkredigering — sjekk Brreg-treff for valgte rader

- [x] `bulkredigering.js` — vis Brreg-badge (✓) ved investornavn for allerede koblede
- [x] `bulkredigering.js` — ny knapp «🔍 Sjekk Brreg-treff» i bulk-action-bar (vises ved valgte rader uten org_nr)
- [x] Sekvensielt søk mot `/api/brreg/search` per valgt investor (300ms pause, samme mønster som ukentlig sync)
- [x] Resultatmodal: investor → forslag (navn, orgnr, poststed, orgform) eller «ingen treff», med avkrysning (forhåndskrysset ved sterkt navnetreff)
- [x] «Koble valgte» → `brregSync` per godkjent rad, deretter reload av investorlisten
- [ ] Manuell test: noen treff, noen uten treff, noen allerede koblet
- [x] Engangsjobb: full Brreg-gjennomgang av alle 619 ukoblede investorer kjørt direkte mot DB — 398 sterke (eksakte) navnetreff koblet automatisk (org_nr/brreg_navn/brreg_data + audit-logget), 203 usikre og 17 uten treff stod igjen ukoblet *(10. juni)*
- [x] `data-kvalitet.js` + `/api/data-quality` — nytt kort «Ikke koblet til Brreg» som lister alle investorer uten `org_nr`
- [ ] `INV-042 "Å Energi PK"` ble utelatt fra autokobling — navnetreff gikk mot "Å ENERGI AS", men "PK" er trolig *Pensjonskasse* (egen juridisk enhet, samme felle som Aker/Nordea-falskpositivene). Sjekk manuelt om "Å Energi Pensjonskasse" finnes i Brreg og koble riktig enhet via investorsiden.
- [ ] 203 investorer med usikre Brreg-treff og 17 uten treff — gå gjennom Datakvalitet-kortet «Ikke koblet til Brreg» og koble manuelt der det er riktig

### Kontakter — telefon 2 + duplikatopprydding

- [x] `schema.sql` — legg til `phone2 TEXT` på `contacts` (idempotent DO-blokk)
- [x] `server.js` — POST/PUT `/api/contacts` og `/api/contacts/merge` håndterer `phone2`
- [x] `server.js` — Excel-eksport inkluderer `phone2`
- [x] `investor-detalj.js` — kontaktmodal: nytt felt «Telefon 2»
- [x] `investor-detalj.js` — vis `phone2` i kontaktkort og primærkontakt-sidebar
- [x] DB: slå sammen K-Spar-duplikatkontakt (Harald Kristofer Berg) — telefon 988 93 822 (primær) + telefon 2: 92497600
- [x] DB: slå sammen 3 investor-duplikater (Statnett SF/SF's Pensjonskasse → INV-004, Mallin/Mallin Eiendom AS → INV-361, Stormbull/Stormbull Eiendom AS → INV-538), audit-logget
- [ ] Manuell test: ny kontakt med telefon 2, rediger eksisterende, eksport
- [ ] Bruker: avvis de 2 falske duplikat-forslagene (Aker ASA/Aker Pensjonskasse, Nordea Norge AS/Nordea Norge Pensjonskasse) i Duplikater-siden — lagres i nettleserens localStorage, må gjøres av hver bruker

### Brreg-integrasjon

- [x] `schema.sql` — legg til `org_nr`, `brreg_navn`, `brreg_data` (idempotent DO-blokker)
- [x] `server.js` — oppdater `fmtInvestor` med nye felter
- [x] `server.js` — `GET /api/brreg/search?q=...` (proxy til Brreg navnesøk)
- [x] `server.js` — `GET /api/brreg/enhet/:orgnr` (hent stamdata)
- [x] `server.js` — `POST /api/investors/:id/brreg-sync` (koble orgnr + sync data + importer roller som kontakter)
- [x] `public/js/api.js` — `brregSearch`, `brregEnhet`, `brregSync`
- [x] `investor-detalj.js` — `buildBrregCard()`: søk+koble hvis ikke koblet, vis stamdata+adresser+roller hvis koblet
- [x] `investor-detalj.js` — event listeners for søk, kobling og synkronisering
- [x] Manuell test: søk, koble, synkroniser, adresser, roller → kontakter

---

## Pågående (tidligere)

### Avslåtte tilbud — ny `declined_offers`-tabell

- [x] Velg løsning (alternativ B: egen tabell)
- [x] `schema.sql` — legg til `declined_offers`-tabell
- [x] `server.js` — backup og restore inkluderer ny tabell
- [x] `server.js` — GET `/api/declined-offers?productId=X`
- [x] `server.js` — POST `/api/declined-offers`
- [x] `server.js` — DELETE `/api/declined-offers/:id`
- [x] `public/js/api.js` — 3 nye metoder
- [x] `prosjekt-detalj.js` — last `_declinedOffers` i `loadData()`
- [x] `prosjekt-detalj.js` — erstatt eksisterende "Takket nei"-seksjon med ny datakilde
- [x] `prosjekt-detalj.js` — "Registrer avslag"-knapp per investorrad (modal med grunn + dato)
- [x] `prosjekt-detalj.js` — slett-knapp i avslåtte-seksjonen

---

## Backlog

### Feedback fra brukere (innrapportert via 🐛-knapp)

- [x] **[detalj-side]** «Felles prosjekt»-kategorien skal ikke ha dokumenter — skjult i dokumentseksjonen *(kristian, 3. juni)*
- [x] **[dashboard]** Global kundesøk i topbaren — søkefelt i sidemenyen, Enter navigerer til investorer *(kristian, 3. juni)*
- [x] **[brukere]** Send velkomstmail til nye brukere — modal med ferdigskrevet velkomstmelding + kopierknapp *(kristian, 4. juni)*
- [x] **[detalj]** Produktinteresse: vis kun produkter i fase Pipeline/Pre-marketing og Fundraise — tegnede produkter flyttes lengre ned/til egen seksjon *(kristian, 8. juni)*
- [x] **[detalj]** Ta ned fontstørrelsen på produktinteresser-seksjonen *(kristian, 8. juni)*
- [x] **[detalj]** 1) Rydd i produkter — kun Pipeline/Pre-marketing og Fundraise vises, tegnede produkter i kolonne til høyre. 2) Sorter kontakter — Brreg-kontakter nederst. 3) Tydeligere merking av avslag *(kristian, 9. juni)*
- [x] **[dashboard]** Vis kun prosjekter i fase Fundraise eller Pipeline, og gjør prosjektkortene klikkbare *(kristian, 10. juni)*
- [x] **[detalj]** Brreg-kontakter (roller) holder å ligge under "Roller" — ikke flytt automatisk til Kontakter. Vurder en "Legg til kontakt fra roller"-knapp i stedet *(kristian, 10. juni)*
- [x] **[dashboard]** Prosjektoversikt — vis to og to (grid), legg til "vis mer"-knapp ved >4 prosjekter. Gjelder kun mobil/smale visninger (desktop viser trolig alle/flere i rad allerede) *(kristian, 10. juni)*



### Kritisk (før ekte produksjonsdata)

- [ ] `CRM_PASS`/`CRM_USER` brukes kun ved førstegangsoppsett (tom `users`-tabell) og er ubrukt nå som ekte kontoer finnes — rydd evt. bort fra Railway-variabler (lav prioritet, ikke en sikkerhetsrisiko)
- [ ] Opprett personlige brukerkontoer for resterende teammedlemmer via Brukeradmin — i dag finnes kun `kristian` (admin) og `nikolai` (bruker), ~8 personer mangler egen konto
- [x] Verifisert at Railway-deploy bruker HTTPS — HTTP redirecter automatisk til HTTPS på prod-domenet *(kristian, 10. juni)*
- [x] Admin-rolle avklart — `kristian` har `role='admin'`, full tilgang til backup/brukerstyring/sletting/sammenslåing

### Data

- [ ] Kjør seed/migrasjon på nytt fra oppdatert Excel-fil
- [ ] Gå gjennom Duplikater-siden og slå sammen like investorer
- [ ] Gå gjennom DuplikatKontakter-siden og rydd kontaktduplikater
- [ ] Sett riktige faser og sannsynligheter på alle aktive investorer

### Teknisk gjeld

- [ ] **`server.js` (2060 linjer, voksende) — gradvis utflytting til rutemoduler.**
      Strategi: IKKE en stor refactor-commit. I stedet, hver gang vi likevel
      jobber i et rute-område og gjør en funksjonell endring der, flytt *de*
      endepunktene (+ delte hjelpefunksjoner de bruker, f.eks. cron-jobber for
      samme domene) til en egen `routes/<domene>.js`-modul i samme commit.
      Mål-struktur etter hvert: `routes/investors.js`, `routes/products.js`,
      `routes/contacts.js`, `routes/brreg.js`, `routes/users.js`,
      `routes/feedback.js`, osv. Delte ting (`pool`/`query`, `fmtRow`,
      `auditLog`, `requireAdmin`, `validationError`) flyttes til en liten
      `lib/`-modul som rutemodulene importerer.
      Rekkefølge — gjør neste utflytting når vi likevel rører domenet, foreslått
      prioritet basert på hva som mest sannsynlig endres snart:
        1. Brreg-ruter + `brregSyncAll`-cron (allerede nylig endret to ganger)
        2. Produkter / `product_investors` / `declined_offers`
        3. Investorer (kjerne-CRUD)
        4. Kontakter
        5. Brukere / auth / feedback (mest stabile, lavest prioritet)
      Når `server.js` er under ~500 linjer (kun oppsett, middleware, SPA-fallback,
      route-registrering), regnes utflyttingen som ferdig.
      Etter hver utflytting: full manuell test av berørt sides hovedflyt
      (golden path + tomme/feil-tilfeller), siden vi ikke har automatiserte tester.
- [ ] Ingen automatiserte tester — vurder enkel integrasjonstest for kjerneruter
- [ ] CSRF-beskyttelse mangler — nødvendig hvis CRM åpnes bredere enn internt team

### Backup-rutine

- [ ] Avtal hvem er ansvarlig for ukentlig Excel-eksport
- [ ] Vurder om Railway volume/persistent storage bør settes opp

---

## Fullført

- [x] CLAUDE.md, tasks/todo.md, tasks/lessons.md opprettet
- [x] Fjernet ubrukte react/react-dom-avhengigheter
- [x] Slettet ødelagt seed.js
- [x] CSRF-beskyttelse via X-Requested-With (POST/PUT/DELETE)
- [x] multer 1.x → 2.x
- [x] xlsx → exceljs (0 sårbarheter)
- [x] Fikset fmtInvestor: committed_amount og decline_reason inkludert
- [x] Fikset tegnet-telling: fase Tegnet brukes, ikke bare committed_amount
