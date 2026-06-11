# ORO CRM — Lærte mønstre

Oppdateres etter korreksjoner fra brukeren. Gjennomgås ved starten av nye økter.

---

## Mønstre

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

---

## Format

Hvert mønster følger denne strukturen:

### [Dato] Kort beskrivelse av feilen

**Hva som gikk galt:** Konkret beskrivelse av feilen.  
**Rotårsak:** Hvorfor feilen skjedde.  
**Regel:** Hva som skal gjøres annerledes fremover.
