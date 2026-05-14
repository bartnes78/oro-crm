# ORO CRM — Arkitekturoversikt

Dette dokumentet beskriver hvordan CRM-systemet er bygget, hvordan delene henger sammen, og hva som bør gjøres før systemet brukes til ekte investordata.

---

## 1. Lokal utvikling

CRM-et kjører som én enkelt Node.js-prosess på maskinen din. Du trenger ikke internett, ingen sky-tjeneste, ingen database å installere.

**Krav:**
- Node.js versjon 18 eller nyere (last ned fra [nodejs.org](https://nodejs.org))

**Første gangs oppsett:**
```bash
npm install          # installer avhengigheter
npm run seed         # importer data fra Excel-filen
npm run dev          # start CRM-et
```

Åpne deretter http://localhost:3001 i nettleseren.

**Daglig bruk:**
```bash
npm run dev
```

Serveren starter, tar automatisk en backup av alle data, og CRM-et er klart på http://localhost:3001.

> **Merk:** `npm run dev` er identisk med `npm start` — begge starter `server.js` direkte. Det finnes ingen separat Vite-utviklingsserver i produksjonsoppsettet; React-appen er forhåndsbygd og lagret i `public/`.

---

## 2. Mappestruktur

```
oro-crm/
│
├── server.js              Én fil — hele API-et (Express, auth, backup)
├── db.js                  Lese/skrive JSON-filer, skriv-kø, atomic write
├── seed.js                Importer data fra Excel til JSON-filer
├── vite.config.js         Bygger React-appen til public/ (kun for bygg)
│
├── src/                   React-kildekode (frontend)
│   ├── App.jsx            Rotkomponent, sidenavigering (ingen ruter — én SPA)
│   ├── api.js             Alle API-kall mot backend (ett sted)
│   ├── index.css          Global CSS, fargepalett, badge-stilar
│   ├── components/
│   │   ├── Sidebar.jsx    Navigasjonsmeny
│   │   └── ErrorBoundary.jsx
│   └── pages/
│       ├── Dashboard.jsx         Oversikt og nøkkeltall
│       ├── Investorer.jsx        Investorliste med filter
│       ├── InvestorDetalj.jsx    Detaljside per investor
│       ├── LoggKontakt.jsx       Logg møte, e-post, o.l.
│       ├── Prosjekter.jsx        Fundraising-prosjekter (liste)
│       ├── ProsjektDetalj.jsx    Pipeline per prosjekt
│       ├── Oppfolging.jsx        Investorer som trenger oppfølging
│       ├── Oppgaver.jsx          Oppgaveliste (tasks)
│       ├── Bulkredigering.jsx    Redigere mange investorer på én gang
│       ├── Duplikater.jsx        Finn og slå sammen duplikater
│       ├── DuplikatKontakter.jsx Finn duplikate kontaktpersoner
│       ├── EpostImport.jsx       Importer .msg-e-post fra Outlook
│       ├── Backup.jsx            Vis og gjenopprett backuper
│       └── BrukerAdmin.jsx       Administrer brukere (kun admin)
│
├── public/                Bygget React-app (genereres av `npm run build`)
│   └── index.html         + bundle.js + assets
│
└── data/                  All data — dette er "databasen"
    ├── investors.json
    ├── contacts.json
    ├── contact_log.json
    ├── tasks.json
    ├── products.json
    ├── product_investors.json   Per-prosjekt ticket/sannsynlighet
    ├── users.json               Brukernavn og passord-hash
    └── backups/                 Automatiske backuper (beholdes siste 10)
        ├── 2026-05-14_13-47-45_investors.json
        └── ...
```

---

## 3. Hvordan frontend snakker med backend

React-appen og Express-serveren kjører på **samme port** (3001) i produksjon. Express server de statiske filene fra `public/` og håndterer alle `/api/`-ruter.

```
Nettleser
   │
   │  GET /                 → server.js sender public/index.html
   │  GET /api/investors    → server.js returnerer JSON fra investors.json
   │  PUT /api/investors/X  → server.js oppdaterer investors.json og returnerer oppdatert objekt
   ▼
server.js (port 3001)
```

All kommunikasjon bruker standard HTTP og JSON. Autentisering skjer via **HTTP Basic Auth** — nettleseren sender brukernavn og passord som en base64-kodet header på hvert kall.

Alle API-kall i frontend går gjennom én fil: [`src/api.js`](src/api.js). Denne filen er det eneste stedet der URL-er og HTTP-metoder er definert. Vil du endre et endepunkt, gjør du det her.

**Lokal utvikling med Vite** (valgfritt, for rask frontend-utvikling):
```bash
# Terminal 1:
npm run dev       # starter backend på port 3001

# Terminal 2:
npx vite          # starter Vite dev-server på port 5173
```
Vite-konfigurasjonen (`vite.config.js`) proxyer alle `/api`-kall videre til port 3001, slik at du får hot-reload i frontend uten å måtte bygge på nytt.

---

## 4. Hvordan data lagres

Det er ingen SQL-database. All data lagres som JSON-filer i `data/`-mappen. Dette gjør systemet enkelt å forstå, flytte og ta backup av.

**Tabeller (JSON-filer):**

| Fil | Innhold |
|---|---|
| `investors.json` | Alle investorer med fase, ticket, sannsynlighet m.m. |
| `contacts.json` | Kontaktpersoner knyttet til investorer |
| `contact_log.json` | Logg over alle møter, e-poster og telefonsamtaler |
| `tasks.json` | Oppgaver med frist og ansvarlig |
| `products.json` | Fundraising-prosjekter (f.eks. ORO Areal Eiendomsfond IS) |
| `product_investors.json` | Per-prosjekt overstyrte verdier for ticket og sannsynlighet |
| `users.json` | Brukere med hashet passord (scrypt, ikke klartekst) |

**Skriv-sikkerhet:** Når en fil oppdateres skrives den først til en `.tmp`-fil, som verifiseres (JSON-parset), før den atomisk erstatter den faktiske filen. Forrige versjon beholdes som `.bak`. Dette forhindrer korrupte filer ved krasj midt i skriving.

**Samtidige brukere:** `writeAsync()` i `db.js` bruker en per-tabell Promise-kø som serialiserer skriveoperasjoner. To brukere kan ikke overskrive hverandres endringer på samme tabell samtidig.

---

## 5. GitHub-arbeidsflyt

**Repository-oppsett:**

```bash
git init
git remote add origin https://github.com/ORO-Areal/crm.git
git push -u origin main
```

**Hva som IKKE skal committes (allerede i `.gitignore`):**
- `node_modules/` — installeres på nytt med `npm install`
- `.env` — inneholder passord, skal aldri i Git
- `data/backups/` — for store, endres konstant
- `*.bak`, `*.tmp` — midlertidige skrivefiler

**Hva som BØR committes:**
- `data/*.json` — dette er faktiske investordata og "databasen". Med få brukere og sjeldne konflikter er det greit å ha data i Git som en ekstra backup-lag.
- All kildekode under `src/`, `server.js`, `db.js`, `seed.js`

**Anbefalt arbeidsflyt for kodeendringer:**
1. Gjør endringer lokalt
2. Test at alt fungerer (`npm run dev`)
3. Commit og push til `main`
4. Railway deployer automatisk (se avsnitt 6)

> **Viktig:** Ikke rediger data i GitHub direkte. All dataredigering skjer gjennom CRM-grensesnittet.

---

## 6. Deployment til Railway

Railway kjører applikasjonen i skyen slik at alle i teamet kan nå CRM-et uten å starte noe lokalt.

**Sett opp Railway (gjøres én gang):**

1. Gå til [railway.app](https://railway.app) og logg inn med GitHub
2. Klikk **New Project → Deploy from GitHub repo**
3. Velg ditt CRM-repository
4. Railway oppdager automatisk at dette er en Node.js-app og kjører `npm start`

**Bygg-steg:** Før du pusher for første gang, bygg React-appen og commit `public/`-mappen:
```bash
npx vite build       # genererer public/
git add public/
git commit -m "bygg frontend"
git push
```

Etter dette trenger du bare å pushe kodeendringer — `public/` er allerede i Git. Kun ved endringer i React-kildekoden (`src/`) må du bygge på nytt og committe `public/` igjen.

**Automatisk deploy:** Hver gang du pusher til `main`, re-deployer Railway automatisk. Nedetid er typisk 10–30 sekunder.

**Data på Railway:** `data/`-mappen er filsystemet på Railway-serveren. Den **nullstilles ikke** ved re-deploy — Railway beholder filsystemet mellom deployments på samme instans. Men: hvis du sletter prosjektet og starter på nytt, forsvinner data. Se avsnitt 8 om backup.

**Egendefinert domene:** Under innstillingene i Railway kan du koble til et eget domene (f.eks. `crm.oro-areal.no`).

---

## 7. Miljøvariabler

Kopier `.env.example` til `.env` og fyll inn verdier. `.env` skal aldri committes til Git.

| Variabel | Beskrivelse | Standard |
|---|---|---|
| `PORT` | Hvilken port serveren lytter på | `3001` |
| `CRM_USER` | Brukernavn for admin-konto som opprettes ved første oppstart | `admin` |
| `CRM_PASS` | Passord for admin-kontoen | Tilfeldig generert (vises i konsolloggen) |
| `CRM_DISPLAY_NAME` | Visningsnavn for admin-kontoen | Samme som `CRM_USER` |

**På Railway:** Legg inn miljøvariabler under **Variables** i prosjektinnstillingene. Ikke bruk `.env`-filer på Railway.

**Første oppstart uten `CRM_PASS`:** Hvis `CRM_PASS` ikke er satt, genererer serveren et tilfeldig passord og skriver det til konsolloggen. Logg inn Railway → **Deployments → Logs** for å se det. Etter innlogging anbefales det å opprette dedikerte brukere via Brukeradmin-siden og endre admin-passordet.

---

## 8. Backup og databeskyttelse

**Automatisk backup:**
- Ved hver oppstart av serveren tas det en komplett backup av alle JSON-filer
- Deretter kjøres backup én gang per 24. time
- De 10 siste backup-settene beholdes (eldre slettes automatisk)
- Backupene ligger i `data/backups/` og er navngitt med tidsstempel

**Manuell gjenoppretting:**
- Gå til **Backup**-siden i CRM-et
- Velg et tidsstempel og klikk **Gjenopprett**
- Serveren tar backup av gjeldende tilstand før gjenoppretting

**Begrensninger med JSON-fillagring:**
- Alle brukere skriver til de samme filene. Skriv-køen forhindrer at to operasjoner kolliderer, men systemet er ikke designet for mange samtidige brukere (mer enn 5–10 aktive brukere kan gi ytelsesproblemer).
- Filene på Railway-serveren kan gå tapt hvis instansen slettes eller migreres. **Ha alltid en ekstern kopi.**

**Anbefalte ekstra sikkerhetslag:**
1. Sett opp automatisk eksport: last ned Excel-eksport ukentlig via **Investorer → Eksporter Excel** og lagre lokalt
2. Commit `data/*.json` til Git jevnlig — det gir full historikk over dataendringer
3. Bruk sterke, unike passord for alle brukere (minst 12 tegn)

---

## 9. Anbefalte neste steg før ekte investordata

Disse punktene bør gjennomgås før dere tar CRM-et i bruk for reelle investorer.

**Sikkert passord (kritisk):**
- [ ] Sett `CRM_PASS` til et sterkt passord i Railway-miljøvariabler
- [ ] Opprett personlige brukerkontoer for alle som skal ha tilgang (via Brukeradmin-siden)
- [ ] Slett eller endre standard admin-kontoen

**HTTPS (kritisk for Railway-deploy):**
- [ ] Verifiser at Railway-domenet ditt bruker HTTPS (det gjør det som standard — sjekk at du bruker `https://` og ikke `http://`)
- [ ] HTTP Basic Auth sender passord i klartekst uten HTTPS — bruk aldri systemet over HTTP i produksjon

**Data-gjennomgang:**
- [ ] Kjør seed på nytt fra oppdatert Excel-fil for å få ferske data
- [ ] Gå gjennom Duplikater-siden og slå sammen like investorer
- [ ] Sett riktige faser og sannsynligheter på alle aktive investorer

**Tilgangskontroll:**
- [ ] Beslut hvem som skal ha admin-rolle (kan administrere brukere og gjenopprette backuper) versus bruker-rolle
- [ ] Ikke del admin-passordet med alle — kun systemansvarlig trenger det

**Ekstern backup-rutine:**
- [ ] Avtal hvem som er ansvarlig for ukentlig Excel-eksport
- [ ] Vurder om `data/*.json` skal committes til Git jevnlig som backup

**Valgfritt på sikt:**
- [ ] Flytte data til en ekte database (PostgreSQL) når dere er mer enn 10 aktive brukere eller ønsker bedre ytelse
- [ ] Legge til CSRF-beskyttelse hvis CRM-et åpnes mot internett bredere enn internt team
- [ ] Sette opp Railway volume/persistent storage for å sikre at data overlever Railway-migrasjoner
