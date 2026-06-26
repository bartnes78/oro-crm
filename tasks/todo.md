# ORO CRM — Oppgaveliste

## Fase 1 — stabilisering før ny utvikling *(plan vedtatt 11. juni)*

1. [x] Lukk de fire åpne manuelle testene fra pågående arbeid — gjennomført 11. juni, to bugs funnet og fikset underveis (se «Funn fra QA-runden» under)
2. [x] Verifiser Railway backup/restore — **Railway sine PG-backups krever Pro-plan (vi er ikke på Pro), PITR er av, ingen volume-backups finnes.** Eneste backup i dag er app-internt: `backups`-tabell i samme DB, daglig snapshot av alle 8 tabeller, siste 10 beholdes (verifisert 15. juni, nyeste stamp 2026-06-15 08:31). Risiko: app-backupen ligger i *samme* database — beskytter mot feilrettinger/feilslettinger, men ikke mot at hele DB-instansen forsvinner. Ukentlig Excel-eksport er derfor det reelle eksterne backup-laget. *(15. juni)*
3. [x] Dokumenter backup-prosedyre og ansvar — prosedyren er beskrevet i ARCHITECTURE.md §8 (15. juni). I tillegg automatisert: serveren genererer nå selv en ukentlig Excel-eksport (mandag kl. 04:00, etter Brreg-synk) til `data/exports/`, beholder de 8 siste (~2 mnd), nedlastbar fra **Backup**-siden (admin). Ingen manuell ansvarsperson nødvendig for selve genereringen — admin bør periodisk laste ned og arkivere eksternt (f.eks. OneDrive) *(15. juni)*
4. [x] **Innfør express-session + login/logout (erstatter Basic Auth)** — ferdig 11. juni
   - [x] Avhengigheter: `express-session` + `connect-pg-simple` (PG-store, overlever Railway-redeploys)
   - [x] Backend: session-middleware (`trust proxy`, httpOnly/sameSite=lax/secure-i-prod, rullende 30-dagers cookie, tabell `user_sessions`)
   - [x] Backend: `SESSION_SECRET` påkrevd i prod (process.exit ellers), tilfeldig dev-fallback
   - [x] Backend: `POST /api/login` (verifiser + sett session.userId, authLimiter ved feil), `POST /api/logout` (destroy)
   - [x] Backend: erstattet Basic-dekoding med session-oppslag, laster bruker fra DB på userId, fjernet WWW-Authenticate
   - [x] Backend: rekkefølge — login/logout etter X-Requested-With-sjekk, før «auth kreves»; mustChange-gate whitelist login/logout
   - [x] Frontend: `api.login`/`api.logout`, `req()` credentials='same-origin' + 401-hook (`window.onUnauthorized`)
   - [x] Frontend: pen login-side (ekte `<form>` + autocomplete username/current-password for passordbehandler/biometri-autofyll)
   - [x] Frontend: «Logg ut»-knapp i sidebar-footer → reload til login
   - [x] Verifisering (browser + HTTP): 401 uten sesjon, 401 feil passord (feilmelding i skjema), 403 uten X-Requested-With, 200 login/me/logout, HttpOnly+SameSite=Lax-cookie, sesjon overlever server-restart, login/logout-flyt i UI. Ingen konsollfeil.
   - [x] `SESSION_SECRET` satt i Railway-variabler *(15. juni)*
5. [x] ~~Tvunget passordbytte server-håndhevet~~ — finnes allerede: middleware i server.js blokkerer alt unntatt GET /me og PUT /me/password når `must_change_password` er satt
6. [x] Smoke-tester rundt de viktigste API-flytene (auth, investor-CRUD, merge, produkter) — kjørt mot dev-server med temp testbruker (slettet etterpå): innlogging (riktig/feil passord, 401 uten/etter sesjon), investor opprett/hent/oppdater/søk, merge av to investorer (kommentarer slått sammen korrekt, drop-investor 404 etterpå), produktinteresse (PUT product-investors, validering av negativ ticket → 400), sletting (soft-delete via deleted_at). Alle OK. Testdata ryddet *(15. juni)*

Først deretter: gradvis utflytting fra server.js til rutemoduler (se Teknisk gjeld).

### Funn fra QA-runden 11. juni

- [x] **Bug: Avslått-seksjonen rendret aldri** — `fmtInvestor()` i server.js whitelistet bort `declined_offers` fra GET /api/investors/:id (samme feilklasse som committed_amount-fiksen i mai). Fikset: feltet lagt til i fmtInvestor.
- [x] **Bug: dashboard-prosjektkort lå 4-i-bredden på mobil (#9)** — inline `flex:1` på kortene slo media query-regelen `.gauge-cards > .card`. Fikset: `!important` på flex-regelen i index.html.
- [x] **Datafunn: `committed_amount` lagret i NOK, ikke MNOK** — migrert 11. juni etter godkjenning: 40 rader (ikke 41 som antatt) delt på 1e6, alle stemmer nå med `target_ticket`. Samme drift funnet og fikset i `products.target_size` for de tre Etablert-prosjektene (id 6, 7, 8). Alt audit-logget (`username='migration'`). Verifisert i UI (investor-detalj INV-053 «Totalt tegnet 20,0 MNOK», prosjekt-detalj 100 % tegnet av mål) og Excel-eksport. Skript: `scripts/migrate-*.js` (idempotente).
- Observasjon: «+ Kontakt» fra Brreg-rolle oppretter kontakt med `source=null` (ikke `'brreg'`) — bevisst valgte kontakter sorteres dermed som vanlige. Sorteringen «brreg sist» (#6.2) er kodeverifisert, men ingen kontakter i databasen har `source='brreg'` i dag.
- Observasjon: Brreg-fuzzysøket returnerer nesten alltid et forslag (f.eks. «Brookfield» → «BROOKFIELD HAGESERVICE»), så «ingen treff»-grenen i bulkmodalen er sjelden. Ufarlig — usikre treff forhåndskrysses ikke.

## Pågående

### Produktinteresse-opprydding (bug #4, #6, #7)

- [x] **#7 dashboard** — allerede løst: `buildGaugeCards()` filtrerer på Pipeline/Fundraise og kortene er klikkbare (`gauge-card-link` → `prosjektDetalj`)
- [x] **#4/#6 investor-detalj** — `buildProductCard()`: delt i seksjoner — aktiv interesse øverst, "Tegnet" i egen seksjon, "Avslått" i egen seksjon nederst
- [x] **#6.2** — `buildContactsCard()`: kontakter sorteres slik at `source==='brreg'` vises sist (stabil sortering ellers)
- [x] **#6.3** — tydeligere merking av avslag: egen "Avslått"-seksjon med overskrift i produktkortet
- [x] Manuell test: investor med tegnet+aktiv+avslått produkt (INV-053, testdata via UI, ryddet etterpå) — alle tre seksjoner OK etter fmtInvestor-fiks. Brreg-kontakt-sortering kodeverifisert (ingen source='brreg'-kontakter i DB) *(11. juni)*

### Ny feedback fra databasen (#10-13, ikke tidligere i todo)

- [x] **#12 dashboard** — `buildGaugeCards()` brukte `p.id` (alltid undefined fra `/api/dashboard`, som returnerer `_id`) → lenke til prosjekt virket ikke. Fikset til `p._id`
- [x] **#11 prosjekter** — nytt felt `established_date` (DATE) på `products`. Lagt til i `schema.sql`, POST/PUT `/api/products`, redigeringsmodal i `prosjekter.js` og `prosjekt-detalj.js`, vist i produktkort og prosjektheader
- [x] **#10 detalj** — `DELETE /api/investors/:id/brreg-sync` fjerner org_nr/brreg_navn/brreg_data (audit-logget). "Fjern kobling"-knapp i Brreg-kortet (`investor-detalj.js`), deretter vises søkeskjema igjen for å koble til riktig enhet (f.eks. ved fisjon/fusjon)
- [x] Manuell test (browser): #12 navigasjon fra dashboard, #11 lagring/visning av etableringsdato, #10 fjern/gjenopprett Brreg-kobling — alle OK *(11. juni)*
- [x] **#13 brukere** — fjernet "Hilsen ORO Areal" fra velkomstmail-teksten (`bruker-admin.js`)

### Resterende bug-rapporter (#5, #8, #9)

- [x] **#5** — `buildProductCard()`: ned 1px på produktnavn (13→12px), ticket/% inputs og enheter (12→11px)
- [x] **#8** — allerede løst: "+ Kontakt"-knapp (`brreg-add-contact-btn`) per Brreg-rolle som ikke allerede er kontakt, ingen auto-flytting
- [x] **#9** — `dashboard.js` `buildGaugeCards()`: prosjekter >4 får klasse `gauge-extra`, "Vis X flere"/"Vis færre"-knapp toggler `.gauge-collapsed`. CSS skjuler `.gauge-extra` og viser knappen kun under 640px (mobil)
- [x] Manuell test: dashboard på mobilbredde med 5 aktive prosjekter — vis mer/færre OK, to-og-to-grid OK etter CSS-fiks. "+Kontakt fra rolle" på Brreg-kort OK (forhåndsutfylt navn/tittel, vises kun for roller uten kontakt) *(11. juni)*

### Bulkredigering — sjekk Brreg-treff for valgte rader

- [x] `bulkredigering.js` — vis Brreg-badge (✓) ved investornavn for allerede koblede
- [x] `bulkredigering.js` — ny knapp «🔍 Sjekk Brreg-treff» i bulk-action-bar (vises ved valgte rader uten org_nr)
- [x] Sekvensielt søk mot `/api/brreg/search` per valgt investor (300ms pause, samme mønster som ukentlig sync)
- [x] Resultatmodal: investor → forslag (navn, orgnr, poststed, orgform) eller «ingen treff», med avkrysning (forhåndskrysset ved sterkt navnetreff)
- [x] «Koble valgte» → `brregSync` per godkjent rad, deretter reload av investorlisten
- [x] Manuell test: 4 usikre treff (inkl. PK-regelen: Asker Kommunale PK holdt tilbake som usikker mot ASKER KOMMUNALE PENSJONSKASSE), ingen forhåndskrysset, allerede koblede viser ✓-badge, avbrutt uten kobling *(11. juni)*
- [x] Engangsjobb: full Brreg-gjennomgang av alle 619 ukoblede investorer kjørt direkte mot DB — 398 sterke (eksakte) navnetreff koblet automatisk (org_nr/brreg_navn/brreg_data + audit-logget), 203 usikre og 17 uten treff stod igjen ukoblet *(10. juni)*
- [x] `data-kvalitet.js` + `/api/data-quality` — nytt kort «Ikke koblet til Brreg» som lister alle investorer uten `org_nr`
- [x] `INV-042 "Å Energi PK"` ble utelatt fra autokobling — navnetreff gikk mot "Å ENERGI AS", men "PK" var *Pensjonskasse* (egen juridisk enhet). Bekreftet og koblet til "Å ENERGI PENSJONSKASSE" (org.nr 986086021) via investorsiden *(15. juni)*
- [x] 203 investorer med usikre Brreg-treff og 17 uten treff — gjennomgått via Datakvalitet-kortet «Ikke koblet til Brreg» *(15. juni)*. Automatisert pass med normalisert navnesammenligning (`normalizeOrgName`, samme regel som #16) koblet 19 til som ble oversett 10. juni (rene AS/ASA-suffiksvarianter). Manuell gjennomgang av resten fant 10 til med høy konfidens: 6× «X Kommunale PK» → «X KOMMUNALE PENSJONSKASSE» (INV-010, 014, 041, 044, 048, 050 — samme PK-regel som Asker-eksempelet i #11-testen), ordrekkefølge «Kaare Berg stiftelsen» → «STIFTELSEN KAARE BERG» (INV-603), STI-suffiks (INV-468), skrivefeil «Cenntennial» → «Centennial Eiendom Asa» (INV-171), og fusjonsbytte «Sparebankstiftelsen Sparebanken Vest» → «...SPAREBANKEN NORGE, VEST» etter 2024-fusjonen (INV-518). Totalt 29 nye koblinger (+ INV-042 = 30); 202 investorer uten org_nr gjenstår. De resterende ~185 usikre + 17 uten treff er i hovedsak utenlandske/internasjonale institusjoner uten norsk org.nr (Blackhorse, ImmoFinRE, KZVK, Nuveen, PICTET, PensionDanmark, Sampension, Tryghedsgruppen m.fl.) eller navnetreff mot urelaterte selskaper — korrekt ukoblet. Unntak: INV-210 «Fearnleys Pensjonskasse» har ingen treff i Brreg (trolig avviklet/fusjonert inn i kollektiv pensjonsordning).
- [x] Mulig duplikat funnet under gjennomgangen: INV-622 «Marienlyst Eiendom» (org.nr 931296787, allerede koblet til MARIENLYST EIENDOM AS) og INV-729 «Marienlyst Eiendom AS» (samme org.nr ifølge Brreg-søk, men kunne ikke kobles pga. unikhetssjekk på org_nr). Ulike leads (Nikolai Staubo / Anders Brustad-Nilsen) og ulike produktrelasjoner (INV-622: 5 % sannsynlighet produkt 4; INV-729: tegnet 5,8225 MNOK produkt 16) — kan være samme juridiske enhet registrert to ganger. Vurder manuelt om de bør slås sammen *(15. juni)* — løst direkte i databasen *(19. juni)*

### Kontakter — telefon 2 + duplikatopprydding

- [x] `schema.sql` — legg til `phone2 TEXT` på `contacts` (idempotent DO-blokk)
- [x] `server.js` — POST/PUT `/api/contacts` og `/api/contacts/merge` håndterer `phone2`
- [x] `server.js` — Excel-eksport inkluderer `phone2`
- [x] `investor-detalj.js` — kontaktmodal: nytt felt «Telefon 2»
- [x] `investor-detalj.js` — vis `phone2` i kontaktkort og primærkontakt-sidebar
- [x] DB: slå sammen K-Spar-duplikatkontakt (Harald Kristofer Berg) — telefon 988 93 822 (primær) + telefon 2: 92497600
- [x] DB: slå sammen 3 investor-duplikater (Statnett SF/SF's Pensjonskasse → INV-004, Mallin/Mallin Eiendom AS → INV-361, Stormbull/Stormbull Eiendom AS → INV-538), audit-logget
- [x] Manuell test: ny kontakt med telefon 2 (via Brreg-rolle-knapp), redigering av telefon 2, Excel-eksport verifisert med exceljs-parsing («Telefon 2»-kolonne + verdier i Kontakter-arket) *(11. juni)*
- [x] Bruker: avvis de 2 falske duplikat-forslagene (Aker ASA/Aker Pensjonskasse, Nordea Norge AS/Nordea Norge Pensjonskasse) i Duplikater-siden — begge par skal stå som separate investorer *(19. juni)*

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
- [x] **[analyse]** "KB" som bruker vises ikke korrekt — skal være "Kristian Bartnes" *(kristian, 12. juni)*. Datafiks: én `contact_log`-rad (id=1) hadde `responsible='KB'`, rettet til "Kristian Bartnes", audit-logget *(15. juni)*
- [x] **[investorer]** Kolonner i tabellen henter ikke tall *(kristian, 12. juni)*. Årsak: `target_ticket`/`probability` ble droppet fra `investors` i mai-sprinten, men investorer.js leste fortsatt disse feltene direkte på investor-objektet → alltid tomme. Fikset: `GET /api/investors` aggregerer nå `committed_total` (Etablert+Avlyst-produkter) og `weighted_total` (Fundraising+Pipeline-produkter) per investor fra `product_investors`. Tabellen har nå 2 kolonner "Tegnet (M)" og "Vektet (M)" (erstatter de 3 gamle "Ticket/Sanns./Vektet"). Verifisert i browser *(15. juni)*
- [x] **[detalj]** Foreslå navneendring der investornavn ikke stemmer med Brønnøysundregisteret *(kristian, 12. juni)*. Implementert i `buildBrregCard()`: varselbanner + "Bruk dette navnet"-knapp vises når `brreg_navn` ≠ `name` etter normalisering (`normalizeOrgName`: store bokstaver, fjern punktum/komma, trim AS/ASA/A-S/SA-suffiks). Uten normalisering ville 120/431 Brreg-koblede investorer vist banneret pga. bevisste AS/ASA-forskjeller i CRM-navn; med normalisering gjenstår 13 reelle avvik (f.eks. INV-039 "Bærum Kommunale PK" vs "BÆRUM KOMMUNALE PENSJONSKASSE"). Knappen oppdaterer navnet via `PUT /api/investors/:id`. Verifisert i browser på INV-039 *(15. juni)*
- [x] **#17 [prosjekter]** Sorter prosjektlisten etter fase-prioritet (Pipeline → Fundraise → Etablert), nyeste først innen hver gruppe, avlyste/fullførte nederst *(kristian, 25. juni)*. Fikset: sekundær sortering på `established_date`/`created_at` innen samme statusgruppe *(26. juni)*
- [x] **#18 [prosjekt-detalj]** Tegningsbeløp manglet ved import — løst: `target_ticket` + `probability` settes nå sammen med `committed_amount` *(kristian, 25. juni)*
- [x] **#19 [dashboard]** Fjern produktoversikten oppe til høyre — dashboard skal handle om pipeline/fundraise. Topp 10 viser vektet volum (ticket × sannsynlighet). Fikset: fjernet «Produktinteresse»-KPI-kortet *(kristian, 26. juni)*
- [x] **#19 [analyse]** Topp 30 investorer sortert etter tegnet volum (committed_amount), på tvers av alle produkter. Klikkbare rader. Ny seksjon i analysefanen + nytt `top30`-felt fra `/api/analyse` *(kristian, 26. juni)*



### Koble brukere til "Ansvarlig"-identitet (lead-navn)

Implementert *(19. juni)*

- [x] `schema.sql` — `users.lead_name TEXT` (nullable, unik)
- [x] `server.js` — POST/PUT `/api/users` validerer `leadName`, `fmtUser` returnerer `leadName`
- [x] `bruker-admin.js` — dropdown «Tilknyttet ansvarlig» i modal + «Ansvarlig»-kolonne i tabell
- [x] `logg-kontakt.js` — forhåndsvelger `currentUser.leadName` (fallback: `displayName`)
- [x] `dashboard.js` — hurtiglogg-modal forhåndsvelger ansvarlig via `leadName`
- [x] `investorer.js` — ny-investor-modal forhåndsvelger lead via `leadName`
- [ ] **Gjenstår (admin-oppgave):** sett `lead_name` for `kristian` → Kristian Bartnes og `nikolai` → Nikolai Staubo via Brukeradmin → Rediger

### Kritisk (før ekte produksjonsdata)

- [ ] `CRM_PASS`/`CRM_USER` brukes kun ved førstegangsoppsett (tom `users`-tabell) og er ubrukt nå som ekte kontoer finnes — rydd evt. bort fra Railway-variabler (lav prioritet, ikke en sikkerhetsrisiko)
- [x] Opprett personlige brukerkontoer for resterende teammedlemmer — `andersbn` (Anders Brustad-Nilsen), `andersa` (Anders Aasand), `gunnar` (Gunnar Vestby) opprettet med startpassord «byttpassord» og `lead_name` forhåndsutfylt *(19. juni)*
- [x] Verifisert at Railway-deploy bruker HTTPS — HTTP redirecter automatisk til HTTPS på prod-domenet *(kristian, 10. juni)*
- [x] Admin-rolle avklart — `kristian` har `role='admin'`, full tilgang til backup/brukerstyring/sletting/sammenslåing

### Data

- [ ] Kjør seed/migrasjon på nytt fra oppdatert Excel-fil
- [ ] Gå gjennom Duplikater-siden og slå sammen like investorer
- [ ] Gå gjennom DuplikatKontakter-siden og rydd kontaktduplikater
- [ ] Sett riktige faser og sannsynligheter på alle aktive investorer

### Teknisk gjeld

- [x] **Brreg-ruter + `brregSyncAll`-cron** — flyttet til `routes/brreg.js`. Delte hjelpere (`auditLog`, `validationError`, `fmtRow`, `requireAdmin`) i `lib/helpers.js`. Duplikert adresse/rolle-parsing konsolidert i `parseAdresser`/`parseRoller`. server.js redusert med ~200 linjer *(19. juni)*
  **Utflytting #5 — Kontaktlogg, oppgaver, brukere — ferdig (26. juni):**
  - [x] Ny `routes/log.js` — 4 ruter: GET/POST/PUT/DELETE `/api/log`. Bruker `pool` for transaksjon i POST.
  - [x] Ny `routes/tasks.js` — 4 ruter: GET/POST/PUT/DELETE `/api/tasks`.
  - [x] Ny `routes/users.js` — 6 ruter: GET `/api/me`, PUT `/api/me/password`, GET/POST/PUT/DELETE `/api/users`.
  - [x] `fmtUser`, `hashPassword`, `verifyPassword` løftet til `lib/helpers.js` (delt med login i server.js).
  - [x] Verifisert: ren serveroppstart, alle ruter svarer korrekt (logg, oppgaver, me, brukere). server.js 1236 → 1013 linjer (−223).

  **Utflytting #6 — Dashboard/analyse + admin — ferdig (26. juni):**
  - [x] Ny `routes/dashboard.js` — 3 ruter: GET `/api/analyse`, `/api/aktivitetslogg`, `/api/dashboard`.
  - [x] Ny `routes/admin.js` — 10 ruter: audit-log, data-quality, lookups, backups (list/exports/restore), seed, excel-eksport, feedback (POST/GET/screenshot). Factory-funksjon som tar `{ runBackup, buildExcelWorkbook }`.
  - [x] `fmtUser`, `hashPassword`, `verifyPassword` i `lib/helpers.js` (delt med login i server.js).
  - [x] Verifisert: ren serveroppstart, alle 7 endepunkter svarer 200, dashboard rendrer korrekt. server.js 1013 → 563 linjer (−450).

- [ ] **Gjenstående utflytting** — MSG-parse (~35 linjer) og `buildExcelWorkbook` (~120 linjer) ligger fortsatt i server.js. Lokale `fmtRow`/`requireAdmin`/`auditLog`/`validationError` dupliserer lib/helpers — kan ryddes ved neste utflytting.

  **Utflytting #4 — Kontakter — ferdig (23. juni):**
  - [x] Ny `routes/contacts.js` — 5 ruter: GET/POST `/api/contacts`, PUT/DELETE `/api/contacts/:id`, POST `/api/contacts/merge`. Bruker delte hjelpere fra `lib/helpers.js`.
  - [x] Mountet `app.use(require('./routes/contacts'))`; kontaktlogg (`/api/log`) er et eget domene og ble værende i server.js.
  - [x] Verifisert ende-til-ende mot innlogget sesjon: kontaktliste (845, `fmtRow` OK), filtrert på investorId, POST-validering (400 «investor_id/Navn påkrevd»), merge-validering (400 ved lik id), PUT ukjent id (404). Ingen konsollfeil. server.js 1310 → 1213 linjer (−97).

  **Utflytting #3 — Investorer / duplikater / merge — ferdig (23. juni):**
  - [x] Ny `lib/validation.js` — `VALID_*`-konstanter + `isValidDate` (delt mellom server.js og investor-modul; server.js bruker dem fortsatt i lookups/contact_log/tasks/bruker-admin)
  - [x] `fmtInvestor` løftet til `lib/helpers.js` (delt med dashboard i server.js)
  - [x] Ny `routes/investors.js` — 11 ruter: investorliste, locations, POST/GET/PUT/DELETE `:id`, trash, restore, duplicates, duplicate-contacts, merge. Lokale `validateInvestorBody`/`normalizeName`/`jaccard`.
  - [x] server.js: fjernet lokale `fmtInvestor`/`VALID_*`/`isValidDate`/`validateInvestorBody`, importerer nå fra delte moduler; beholdt `validationError`. Mountet `app.use(require('./routes/investors'))`.
  - [x] **Bugfiks underveis:** `GET /api/investors/trash` lå etter `GET /api/investors/:id` (både i original og etter flytt) → ble shadowet av `:id` og returnerte 404. Papirkurv-siden (admin) var dermed brutt i prod. Flyttet `trash`-ruten foran `:id` i investor-modulen. Verifisert: trash→200 (tom array), `:id`→200 for ekte investor, ukjent id→404.
  - [x] Verifisert ende-til-ende mot innlogget sesjon: investorliste (662, sortert), detalj (kontakter/logg/interesser), locations, duplicates (2 par), POST-validering (400 "Navn er påkrevd"), trash, restore-rute registrert. server.js 1747 → 1310 linjer (−437).

  **Utflytting #2 — Produkter — ferdig (23. juni):**
  - [x] Flyttet `/api/product-investors` (GET/PUT) til `routes/products.js`
  - [x] Flyttet `/api/products` (GET/POST/PUT/:id, cancel, complete, DELETE) til `routes/products.js`
  - [x] Flyttet `/api/declined-offers` (GET/POST/DELETE) til `routes/products.js`
  - [x] Mountet via `app.use(require('./routes/products'))` i server.js (ved siden av brreg)
  - [x] Kode flyttet verbatim; bruker delte hjelpere fra `lib/helpers.js` (`fmtRow`, `validationError`, `requireAdmin`, `auditLog`)
  - [x] Verifisert: ren serveroppstart (ingen require-/mountfeil), syntakssjekk OK, alle 11 ruter registrert på router-stacken, ingen rute-rester i server.js. server.js 1961 → 1747 linjer (−214).
  - [ ] **Gjenstår:** ende-til-ende autentisert HTTP-test (krever innlogget sesjon — dev-`.env`-passordet matcher ikke lenger den ekte `kristian`-kontoen, og jeg unngikk å skrive temp-bruker til prod-DB). Bør bekreftes i nettleser ved neste innlogging: prosjektliste, opprett/rediger prosjekt, registrer interesse/tegning, avlys/fullfør, registrer/slett avslag.
  - Merk: admin-seed-ruten `/api/admin/seed-pensjon-oro-areal` ble bevisst værende i server.js (admin/seed-konsern, ikke kjerne-produkt-CRUD). Bruker fortsatt `query`/`requireAdmin`/`auditLog` i server.js-scope.
      Når `server.js` er under ~500 linjer (kun oppsett, middleware, SPA-fallback,
      route-registrering), regnes utflyttingen som ferdig.
      Etter hver utflytting: full manuell test av berørt sides hovedflyt.
- [ ] Oppdater ARCHITECTURE.md — beskriver fortsatt én stor server.js, mangler rutemoduler og lib/
- [ ] Ingen automatiserte tester — vurder enkel integrasjonstest for kjerneruter
- [ ] CSRF-beskyttelse mangler — nødvendig hvis CRM åpnes bredere enn internt team

### Bevisste sikkerhetsbeslutninger (dokumentert etter review 26. juni)
- **Excel-eksport (`/api/export/excel`)** er åpen for alle innloggede brukere — bevisst, alle 5 brukere er betrodd full dataeksport
- **Backup/restore utelater `users`-tabellen** — bevisst for å unngå å låse seg ute ved restore
- **Produkt-CRUD** er nå admin-only (POST/PUT/DELETE) etter review-funn — `product-investors` PUT er fortsatt åpen for alle (investorinteresse-registrering)

### Backup-rutine

- [x] Automatisk OneDrive-opplasting — etter ukentlig Excel-eksport lastes filen opp til OROEiendom OneDrive via Microsoft Graph API (client credentials). Aktiveres med Railway-vars `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_ONEDRIVE_USER`, `MS_ONEDRIVE_FOLDER` *(19. juni)*
- [ ] **Gjenstår (admin-oppgave):** registrer Azure AD-app med `Files.ReadWrite.All`-tillatelse, legg inn Railway-variabler. Se oppsettinstruksjoner nedenfor.

  **Azure AD-oppsett (én gang):**
  1. portal.azure.com → Azure Active Directory → App-registreringer → Ny registrering
  2. API-tillatelser → Legg til → Microsoft Graph → Apptillatelser → `Files.ReadWrite.All` → Gi admin-godkjenning
  3. Sertifikater og hemmeligheter → Ny klienthemmelighet → kopier verdi
  4. Railway-vars: `MS_TENANT_ID` (katalog-ID), `MS_CLIENT_ID` (program-ID), `MS_CLIENT_SECRET`, `MS_ONEDRIVE_USER` (e-post til OneDrive-eier i OROEiendom), `MS_ONEDRIVE_FOLDER` (f.eks. `ORO CRM Backups`)
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
