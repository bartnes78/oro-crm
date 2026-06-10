# ORO CRM — Oppgaveliste

## Pågående

### Kontakter — telefon 2 + duplikatopprydding

- [ ] `schema.sql` — legg til `phone2 TEXT` på `contacts` (idempotent DO-blokk)
- [ ] `server.js` — POST/PUT `/api/contacts` og `/api/contacts/merge` håndterer `phone2`
- [ ] `server.js` — Excel-eksport inkluderer `phone2`
- [ ] `investor-detalj.js` — kontaktmodal: nytt felt «Telefon 2»
- [ ] `investor-detalj.js` — vis `phone2` i kontaktkort og primærkontakt-sidebar
- [ ] DB: slå sammen K-Spar-duplikatkontakt (Harald Kristofer Berg) med begge telefonnumre
- [ ] DB: slå sammen 3 investor-duplikater (Statnett SF/SF's Pensjonskasse, Mallin/Mallin Eiendom AS, Stormbull/Stormbull Eiendom AS)
- [ ] Manuell test: ny kontakt med telefon 2, rediger eksisterende, eksport

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



### Kritisk (før ekte produksjonsdata)

- [ ] Sett `CRM_PASS` til sterkt passord i Railway-miljøvariabler
- [ ] Opprett personlige brukerkontoer for alle teammedlemmer via Brukeradmin
- [ ] Verifiser at Railway-deploy bruker HTTPS (aldri HTTP i prod)
- [ ] Bestem admin-rolle: hvem har tilgang til backup og brukerstyring

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
