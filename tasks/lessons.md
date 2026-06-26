# ORO CRM — Lærte mønstre

Oppdateres etter korreksjoner fra brukeren. Gjennomgås ved starten av nye økter.

---

## Mønstre

### [2026-06-25] Tegnet investor må ha target_ticket + probability, ikke bare committed_amount

**Hva som gikk galt:** Ved import av tegnerlister (prosjektene Valstadsvingen 2 og Strømsveien) satte jeg kun `product_investors.committed_amount`. «Tegnet av mål»-baren og Tegnet-KPI-en stemte, men i investor-tabellen på prosjekt-detalj viste kolonnene **Ticket (M)**, **Sanns.** og **Vektet (M)** «—» for hver tegner, og «Estimert volum» ble 0. Brukeren oppdaget at tegnet beløp «ikke kom riktig inn».
**Rotårsak:** Tabellen i `public/js/pages/prosjekt-detalj.js` (renderTable, ~linje 375–390) leser `target_ticket` og `probability` per rad — ikke `committed_amount`. Aggregatet `signedTicket` bruker `committed_amount || target_ticket`, derfor stemte totalen selv om radene var tomme.
**Regel:** For en **tegnet** investor skal alle tre settes: `committed_amount = target_ticket` og `probability = 1` (100 %). Dette er konvensjonen for Etablert-prosjektene (verifisert på produkt 7/14/16). Full presisjon er OK (eks. 2.4500025). Gjenbruk INSERT-mønsteret fra `scripts/import-*.js`.

### [2026-06-10] Probability lagret som prosent i stedet for desimal

**Hva som gikk galt:** Ved opprettelse av interessenter for ORO Care ble `product_investors.probability` satt til 5 og 10 (heltall), som viste seg som "500%" og "1000%" i UI.  
**Rotårsak:** `probability` lagres i databasen som desimal (0.0–1.0). Frontend gjør `Math.round(pi.probability * 100)` for visning. Jeg behandlet feltet som om det allerede var en prosentverdi.  
**Regel:** Skriv alltid `probability` som desimal (f.eks. 0.05 for 5 %). Sjekk frontend-konverteringen (`* 100` / `/ 100`) før direkte DB-skriving av dette feltet.

### [2026-06-10] Feil antakelse om `investors.id`-format ved opprettelse

**Hva som gikk galt:** Insert av nye investorer feilet med "null value in column id" og deretter med duplikatnøkkel-feil mot `investors_pkey`.  
**Rotårsak:** `investors.id` er TEXT i format `INV-NNN` (ikke SERIAL). Et regex-basert oppslag (`id ~ '^INV-\d+'`) for å finne neste nummer feilet pga. shell-escaping i `node -e`, og returnerte 0 → forsøk på å gjenbruke `INV-001`.  
**Regel:** For å finne neste ledige `INV-`-nummer: `SELECT id FROM investors WHERE id LIKE 'INV-%'`, hent ut tallet i JS og bruk `.reduce()` for å finne max. Ikke stol på regex-oppslag via shell-kommandoer.

### [2026-06-10] PayloadTooLargeError ved lagring av Brreg-data

**Hva som gikk galt:** Lagring feilet i produksjon med "PayloadTooLargeError" og modal "Kunne ikke lagre".  
**Rotårsak:** `express.json()` bruker default-grense på 100kb. `brreg_data` (adresser + roller som JSONB) kan overstige dette for selskaper med mange roller.  
**Regel:** `express.json({ limit: '5mb' })` er satt i `server.js` (linje ~181). Hvis flere store JSON-felt legges til senere, vurder om grensen fortsatt er tilstrekkelig — ikke senk den uten grunn.

### [2026-06-10] Arkitekturendring i endepunkt glemte duplisert logikk i cron-jobb

**Hva som gikk galt:** Brreg-roller ble automatisk importert som `contacts`-rader (source='brreg') ved hver synk, og dukket opp som duplikater/støy i Kontakter-fanen. Dette ble fjernet fra `/api/investors/:id/brreg-sync`-endepunktet og erstattet med en opt-in "+ Kontakt"-knapp i Brreg-kortet — men den ukentlige cron-jobben `brregSyncAll()` hadde **identisk** auto-import/auto-slett-logikk som ville gjenskapt de 63 nylig opprydde kontaktene ved neste kjøring.  
**Rotårsak:** Samme forretningslogikk var duplisert to steder i `server.js` (manuelt endepunkt + cron-jobb), og kun det ene stedet ble oppdatert først.  
**Regel:** Når en arkitektur-/atferdsendring gjøres i ett endepunkt, søk gjennom hele `server.js` (inkl. cron-jobber og bakgrunnsjobber) etter samme mønster/logikk og oppdater alle forekomster samtidig.

### [2026-06-10] Navnenormalisering for Brreg-matching kan slå sammen selskap og pensjonskasse

**Hva som gikk galt:** Ved automatisk Brreg-kobling av 399 investorer (eksakt navnetreff etter normalisering) ble `INV-042 "Å Energi PK"` foreslått matchet mot "Å ENERGI AS" — men "PK" er trolig forkortelse for *Pensjonskasse*, en egen juridisk enhet, ikke morselskapet. Samme felle som de 2 tidligere falske duplikat-forslagene (Aker ASA/Aker Pensjonskasse, Nordea Norge AS/Nordea Norge Pensjonskasse).  
**Rotårsak:** `normalizeBrregName()` (i `bulkredigering.js`) fjerner ordet "pk" som støy (sammen med as/asa/is/sa/ans/ab/spk) for å treffe forkortelser av selskapsformer — men "PK" er også en vanlig forkortelse for "Pensjonskasse" i investornavn, og da blir normaliseringen feil retning.  
**Regel:** Før automatisk kobling/sammenslåing basert på normalisert navnematch: flagg og hold tilbake (ikke autokoble) tilfeller der investornavnet inneholder "PK" eller "Pensjonskasse"/"Stiftelse" men treff-enhetens `organisasjonsform` ikke er "Pensjonskasse"/"Stiftelse" — slik konflikt tyder på at det finnes to separate juridiske enheter (mor + pensjonskasse/stiftelse), ikke én.

### [2026-06-11] fmtInvestor-whitelisten dropper nye felter stille

**Hva som gikk galt:** Avslått-seksjonen i produktkortet på investor-detalj rendret aldri — GET /api/investors/:id bygde `declined_offers` på investor-objektet, men `fmtInvestor()` er en eksplisitt whitelist og droppet feltet stille. Samme feilklasse som mai-fiksen der `committed_amount`/`decline_reason` manglet.  
**Rotårsak:** `fmtInvestor()` returnerer et håndplukket felt-sett. Nye felter lagt på investor-objektet i en rute forsvinner i responsen uten feil, og frontend faller tilbake til tom default (`|| []`) — usynlig både i konsoll og server-logg.  
**Regel:** Når et nytt felt skal ut via et investor-endepunkt: oppdater `fmtInvestor()` i samme commit. Ved «data finnes i DB men vises ikke»-symptomer: sjekk API-responsen i nettverksfanen/fetch før frontend-koden mistenkes.

### [2026-06-11] Service worker serverte gammel JS under lokal verifisering

**Hva som gikk galt:** Etter endring av `app.js`/`api.js` viste nettleseren fortsatt gammel oppførsel (gammel `init()` uten login-skjerm) ved reload, og feilsøking pekte mot ikke-eksisterende bugs.  
**Rotårsak:** `public/service-worker.js` bruker stale-while-revalidate for `.js`/`.css`/`.svg` — den serverer cachet versjon umiddelbart og oppdaterer cachen i bakgrunnen. En enkelt reload viser derfor forrige versjon av frontend-koden.  
**Regel:** Ved verifisering av frontend-endringer i nettleser: avregistrer service worker + tøm cache først (`navigator.serviceWorker.getRegistrations()` → `unregister()`, `caches.keys()` → `caches.delete()`), deretter reload. Merk også at `preview_click` ikke alltid utløser `onclick`/form-submit i denne appen — bruk `el.click()` / `form.requestSubmit()` via eval for å teste handler-logikk deterministisk.

### [2026-06-23] Express-rute med fast segment skygges av `/:id` når den registreres etterpå

**Hva som gikk galt:** `GET /api/investors/trash` returnerte 404. Papirkurv-siden (admin) hadde vært brutt i prod fordi `GET /api/investors/:id` var registrert *før* `trash`-ruten — `:id` matchet "trash" som en investor-id, fant ingen rad, og svarte 404. Oppdaget under utflytting av investor-ruter til `routes/investors.js`; rekkefølgen var arvet uendret fra `server.js`.  
**Rotårsak:** Express matcher ruter i registreringsrekkefølge. En parameterrute (`/:id`) fanger alle faste søsken-segmenter (`/trash`, `/export` osv.) som registreres etter den.  
**Regel:** Registrer alltid faste/litterale subruter (`/api/investors/trash`) *før* den generiske `/:id`-ruten. Ved utflytting til moduler: bevar relativ rekkefølge, men sjekk samtidig om eksisterende rekkefølge skjuler en latent bug — test faste subruter eksplisitt (ikke bare `/:id` med ekte verdier).

### [2026-06-23] Halvferdig redigering krasjet nodemon med "Identifier already declared"

**Hva som gikk galt:** Under flytting av delt logikk ut av `server.js` la jeg til `const { VALID_PHASES, ... } = require(...)` øverst i én edit, og fjernet de lokale `const VALID_PHASES = [...]`-definisjonene i en *senere* edit. Mellom de to editene plukket nodemon opp fila og krasjet med `SyntaxError: Identifier 'VALID_PHASES' has already been declared`.  
**Rotårsak:** Med nodemon kjørende blir hver Edit en egen restart. En import som dupliserer et navn som fortsatt er deklarert lokalt gir en kortvarig, men ekte, krasj-tilstand.  
**Regel:** Når en lokal definisjon erstattes med et import: gjør tillegg av import og fjerning av den lokale definisjonen i *samme* edit der det er mulig, eller forvent en forbigående nodemon-krasj og verifiser at den *siste* oppstarten er ren (sjekk `preview_logs` til bunns, ikke bare at serveren svarer).

---

## Format

Hvert mønster følger denne strukturen:

### [Dato] Kort beskrivelse av feilen

**Hva som gikk galt:** Konkret beskrivelse av feilen.  
**Rotårsak:** Hvorfor feilen skjedde.  
**Regel:** Hva som skal gjøres annerledes fremover.
