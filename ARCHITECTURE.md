# ORO CRM — Arkitekturoversikt

Dette dokumentet beskriver hvordan CRM-systemet er bygget, hvordan delene henger sammen, og hva som bør gjøres før systemet brukes til ekte investordata.

> **Sist oppdatert:** 29. juni 2026 — gjenspeiler vanilla-JS-frontend, oppdelt backend (`routes/` + `lib/`), PostgreSQL og session-basert innlogging.

---

## 1. Lokal utvikling

CRM-et kjører som én enkelt Node.js-prosess. Frontend er ren JavaScript uten byggsteg — det finnes ingen Vite/React-pipeline. Du trenger kun en kjørende Node og en tilkobling til PostgreSQL-databasen (Railway).

**Krav:**
- Node.js versjon 18 eller nyere (last ned fra [nodejs.org](https://nodejs.org))
- Tilgang til PostgreSQL-databasen via `DATABASE_URL` i `.env` (se avsnitt 7)

**Første gangs oppsett:**
```bash
npm install                 # installer avhengigheter
cp .env.example .env        # fyll inn DATABASE_URL (og evt. andre verdier)
npm run dev                 # start CRM-et med nodemon (auto-restart ved endring)
```

Åpne deretter http://localhost:3001 i nettleseren.

**Daglig bruk:**
```bash
npm run dev    # utvikling (nodemon, auto-restart)
npm start      # produksjonsstil (node server.js, ingen auto-restart)
npm test       # ikke-muterende røyktester for auth/CSRF (krever DATABASE_URL)
```

Ved oppstart oppretter serveren skjemaet (idempotent fra `schema.sql`), tar en backup av alle tabeller, og lytter på http://localhost:3001.

> **Merk:** Det finnes ingen byggsteg og ingen `seed.js`. Frontend serveres direkte fra `public/`. Engangs-datamigreringer kjøres via `npm run migrate` (`migrate.js`) eller egne skript i `scripts/`.

---

## 2. Mappestruktur

```
oro-crm/
│
├── server.js              Oppsett, middleware, auth, backup, SPA-fallback + rute-registrering (~389 linjer)
├── db.js                  PostgreSQL-tilkobling (node-postgres) + egendefinert typeparsing
├── schema.sql             Idempotent skjema (CREATE TABLE IF NOT EXISTS ...)
├── migrate.js             Engangs-datamigreringer (npm run migrate)
│
├── routes/                API-ruter, delt opp per domene
│   ├── investors.js       Investorer, duplikater, merge, papirkurv
│   ├── contacts.js        Kontaktpersoner + merge
│   ├── products.js        Prosjekter, product_investors, declined_offers
│   ├── log.js             Kontaktlogg (møter, e-post, telefon)
│   ├── tasks.js           Oppgaver
│   ├── users.js           /api/me, passordbytte, brukeradmin
│   ├── dashboard.js       Dashboard + analyse + aktivitetslogg
│   ├── brreg.js           Brønnøysund-integrasjon + ukentlig synk-cron
│   ├── admin.js           Audit-logg, datakvalitet, lookups, backup/restore, eksport, feedback
│   └── email.js           Import av .msg-e-post fra Outlook
│
├── lib/                   Delt logikk brukt på tvers av ruter
│   ├── helpers.js         fmtRow, fmtInvestor, fmtUser, hashPassword, verifyPassword, requireAdmin, auditLog, validationError
│   ├── validation.js      VALID_*-konstanter + isValidDate
│   └── excel.js           buildExcelWorkbook (eksport)
│
├── public/                Frontend — serveres statisk, ingen byggsteg
│   ├── index.html         App-skall + global CSS
│   ├── service-worker.js  Cacher .js/.css/.svg (stale-while-revalidate)
│   └── js/
│       ├── app.js         SPA-routing, modal-system, globale hjelpere (window.fmt, escHtml, telHref, ...)
│       ├── api.js         Alle API-kall — eneste sted URL-er er definert
│       └── pages/         19 sidekomponenter (render(el, state)-mønster)
│
├── scripts/               Engangs- og import-skript (kjøres manuelt med node)
└── data/
    └── exports/           Ukentlige Excel-eksporter (siste 8 beholdes)
```

**Frontend-mønster:** Hver side eksporterer `async function render(el, state)` som henter data via `api.js`, setter `el.innerHTML`, og knytter event listeners på nytt. Ingen virtuell DOM — alt er direkte DOM-manipulasjon. Brukergenerert innhold escapes alltid med `window.escHtml()`.

---

## 3. Hvordan frontend snakker med backend

Frontend og Express-serveren kjører på **samme port** (3001). Express serverer de statiske filene fra `public/` og håndterer alle `/api/`-ruter. Alt ikke-API faller tilbake til `public/index.html` (SPA-fallback).

```
Nettleser (vanilla JS SPA)
   │
   │  GET /                 → server.js sender public/index.html
   │  GET /api/investors    → routes/investors.js returnerer JSON fra PostgreSQL
   │  PUT /api/investors/X  → routes/investors.js oppdaterer databasen og returnerer oppdatert objekt
   ▼
server.js (port 3001) → routes/* → db.js → PostgreSQL
```

All kommunikasjon bruker standard HTTP og JSON. Autentisering skjer via **session-cookie** (se avsnitt 9) — ikke lenger HTTP Basic Auth.

Alle API-kall i frontend går gjennom én fil: [`public/js/api.js`](public/js/api.js). Dette er det eneste stedet der URL-er og HTTP-metoder er definert. Hvert ikke-GET-kall sender headeren `X-Requested-With: XMLHttpRequest` (CSRF-vern) og `credentials: 'same-origin'` (sender session-cookien).

---

## 4. Hvordan data lagres

All data lagres i **PostgreSQL** (Railway-hostet). Tilkoblingen håndteres av `db.js` via `node-postgres`. Skjemaet opprettes automatisk ved oppstart fra `schema.sql`.

**Tabeller:**

| Tabell | Innhold |
|---|---|
| `investors` | Investorer med fase, type, lead m.m. (id i format `INV-NNN`, TEXT) |
| `contacts` | Kontaktpersoner knyttet til investorer (FK → investors, CASCADE) |
| `contact_log` | Logg over møter, e-poster og telefonsamtaler |
| `tasks` | Oppgaver med frist og ansvarlig |
| `products` | Fundraising-prosjekter (status: Pipeline/Fundraising/Etablert/Avlyst) |
| `product_investors` | Per-prosjekt ticket, sannsynlighet og tegnet beløp (FK → products + investors, CASCADE) |
| `declined_offers` | Registrerte avslag per investor/prosjekt |
| `users` | Brukere med hashet passord (scrypt), rolle og lead-navn |
| `backups` | App-interne snapshot av alle tabeller (se avsnitt 8) |
| `feedback_reports` | Brukerrapporter fra 🐛-knappen (med valgfritt skjermbilde) |
| `audit_log` | Sporing av sensitive endringer (merge, sletting, migreringer m.m.) |

`user_sessions` opprettes automatisk av `connect-pg-simple` for session-lagring.

**Typeparsing (`db.js`):** PostgreSQL `DATE` returneres som streng `YYYY-MM-DD` (ikke JS Date), og `NUMERIC` returneres som tall (`parseFloat`, ikke streng).

**Tilkobling lokalt:** Hent `DATABASE_PUBLIC_URL` fra Railway → Postgres → Variables og legg i `.env` som `DATABASE_URL`. På Railway brukes `DATABASE_PRIVATE_URL` (intern nettverking, ingen SSL-overhead).

---

## 5. GitHub-arbeidsflyt

**Hva som IKKE skal committes (allerede i `.gitignore`):**
- `node_modules/` — installeres på nytt med `npm install`
- `.env` — inneholder hemmeligheter, skal aldri i Git
- `data/exports/` — genereres automatisk

**Anbefalt arbeidsflyt for kodeendringer:**
1. Gjør endringer lokalt
2. Test at alt fungerer (`npm run dev` → test i nettleser)
3. Commit og push til `main`
4. Railway deployer automatisk (se avsnitt 6)

> **Ingen byggsteg:** Siden frontend er ren JavaScript serveres `public/`-filene direkte. Du trenger ikke bygge noe før push — endringer i `public/js/` er live så snart de er deployet.

---

## 6. Deployment til Railway

Railway kjører applikasjonen i skyen slik at hele teamet når CRM-et uten å starte noe lokalt.

**Oppsett (gjøres én gang):**
1. Gå til [railway.app](https://railway.app) og logg inn med GitHub
2. **New Project → Deploy from GitHub repo** → velg CRM-repoet
3. Legg til en PostgreSQL-tjeneste i samme prosjekt
4. Railway oppdager Node.js-appen og kjører `npm start`
5. Sett miljøvariablene under **Variables** (se avsnitt 7)

**Automatisk deploy:** Hver push til `main` re-deployer automatisk. Nedetid er typisk 10–30 sekunder. Det er ingen byggsteg å vente på.

**HTTPS:** Railway terminerer HTTPS i en proxy foran appen. `server.js` setter `trust proxy` slik at secure-cookies fungerer, og HTTP redirectes automatisk til HTTPS på prod-domenet.

**Egendefinert domene:** Kan kobles til under Railway-innstillingene (f.eks. `crm.oro-areal.no`).

---

## 7. Miljøvariabler

Kopier `.env.example` til `.env` og fyll inn verdier. `.env` skal aldri committes.

| Variabel | Beskrivelse | Påkrevd |
|---|---|---|
| `PORT` | Port serveren lytter på (standard 3001) | Nei |
| `DATABASE_URL` | PostgreSQL-tilkobling (public proxy, brukes lokalt) | Ja (lokalt) |
| `DATABASE_PRIVATE_URL` | Intern Railway-tilkobling (foretrukket i prod, ingen SSL) | Nei |
| `NODE_ENV` | `production` aktiverer fail-closed CORS og krever `SESSION_SECRET` + `ALLOWED_ORIGIN` | I prod |
| `SESSION_SECRET` | Signerer session-cookies. **Påkrevd i prod** (serveren avbryter oppstart uten den); tilfeldig fallback i dev | I prod |
| `ALLOWED_ORIGIN` | Tillatt CORS-origin (Railway-domenet). **Påkrevd i prod** | I prod |
| `CRM_USER` / `CRM_PASS` / `CRM_DISPLAY_NAME` | Admin-konto som opprettes **kun** ved første oppstart med tom `users`-tabell. Ubrukt etter at ekte kontoer finnes | Nei |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_ONEDRIVE_USER`, `MS_ONEDRIVE_FOLDER` | Azure AD-app for opplasting av ukentlig Excel-eksport til OneDrive (valgfritt) | Nei |

**På Railway:** Legg inn variablene under **Variables**. Ikke bruk `.env`-filer på Railway.

---

## 8. Backup og databeskyttelse

**Automatisk backup (app-internt):**
- Ved hver oppstart, og deretter hver 24. time, tas en komplett snapshot av alle tabeller
- Snapshotene lagres i `backups`-tabellen i **samme** PostgreSQL-database, navngitt med tidsstempel
- De 10 siste beholdes (eldre slettes automatisk)
- Gjenoppretting: **Backup**-siden i CRM-et (kun admin) → velg tidsstempel → **Gjenopprett** (tar en ny backup av gjeldende tilstand først)

> **Merk:** Backup/restore utelater `users`-tabellen bevisst, for å unngå å låse seg ute ved en gjenoppretting.

**Viktig begrensning:** App-backupen ligger i *samme* database som live-dataene. Den beskytter mot feilrettinger og feilslettinger — men ikke mot at hele Railway PG-instansen forsvinner. Railway sine egne PG-backups/PITR krever Pro-plan (vi er ikke på Pro per juni 2026).

**Ukentlig Excel-eksport (eksternt lag):**
- Hver mandag kl. 04:00 (Europe/Oslo), etter Brreg-synk, genereres en full Excel-eksport til `data/exports/ORO_CRM_<år>-W<uke>.xlsx`
- De 8 siste (~2 måneder) beholdes
- Nedlastbar fra **Backup**-siden (alle innloggede brukere har dataeksport-tilgang — bevisst)
- Hvis `MS_*`-variablene er satt, lastes filen i tillegg opp til OneDrive via Microsoft Graph (client credentials)

**Reelt eksternt sikkerhetslag:** Admin bør periodisk laste ned siste ukentlige eksport og arkivere den utenfor Railway.

---

## 9. Autentisering og sikkerhet

**Innlogging (session-basert):**
- `express-session` med `connect-pg-simple` lagrer sesjoner i `user_sessions`-tabellen → overlever Railway-redeploys
- Cookie er `httpOnly`, `sameSite=lax`, `secure` i prod, rullende 30-dagers utløp
- `POST /api/login` verifiserer passord (scrypt) og setter `session.userId`; `POST /api/logout` destruerer sesjonen
- Brukere med `must_change_password` blokkeres fra alt unntatt passordbytte (server-håndhevet)

**Beskyttelseslag:**
- **Passord:** scrypt-hashing (`hashPassword`/`verifyPassword` i `lib/helpers.js`)
- **Rate limiting:** generell limiter (300 req / 15 min) + egen brute-force-limiter på innlogging (15 forsøk / 15 min per IP)
- **CSRF:** alle ikke-GET-kall krever headeren `X-Requested-With: XMLHttpRequest`. Sammen med `SameSite=Lax`-cookie gir dette rimelig vern for en same-origin intern app. Token-basert CSRF er **ikke** implementert — vurder det hvis CRM-et åpnes bredere enn det interne teamet
- **SQL:** alltid parameteriserte spørringer (`$1, $2, ...`) — aldri strenginterpolasjon
- **Helmet:** Content-Security-Policy og øvrige sikkerhetsheadere
- **CORS:** fail-closed i prod (kun `ALLOWED_ORIGIN`)
- **Tilgangskontroll:** `requireAdmin` på sensitive ruter (brukeradmin, backup/restore, sletting, merge, produkt-CRUD)

**Prosess-robusthet:** `server.js` har `uncaughtException`- og `unhandledRejection`-handlere som logger full stack (i stedet for stille død), og en `EADDRINUSE`-handler på `app.listen` som gir lesbar melding ved port-kollisjon.

---

## 10. Kjent teknisk gjeld

- **Tester:** `npm test` kjører ikke-muterende røyktester for kjerne-middleware (auth, CSRF, SPA-fallback) via innebygd `node:test` — krever en kjørende dev-DB (`DATABASE_URL`). Utover dette er QA manuell i nettleser. Autentiserte/muterende tester (investor-CRUD, merge) gjenstår og bør kjøres mot en **egen test-DB**, ikke prod.
- **Token-basert CSRF mangler** — kun relevant hvis appen åpnes bredere enn internt team (se avsnitt 9).
- **`.env.example`** lister ikke `SESSION_SECRET` og `MS_*`-variablene ennå.
- **`CRM_PASS`/`CRM_USER`** er ubrukt nå som ekte kontoer finnes — kan ryddes fra Railway-variabler (lav prioritet, ikke en sikkerhetsrisiko).
- **Railway volume/persistent storage** er ikke satt opp — vurder for å sikre at data overlever Railway-migrasjoner.
