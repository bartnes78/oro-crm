# ORO CRM — Oppgaveliste

## Pågående

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

- [ ] `server.js` er 1357 linjer — vurder å splitte i rutemoduler hvis filen vokser ytterligere
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
