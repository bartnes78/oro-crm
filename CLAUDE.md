# ORO CRM — Claude-instruksjoner

## Prosjektoversikt

Investoroppfølgings-CRM for ORO Areal Eiendomsfond IS. Node.js Express-backend med vanilla JS SPA-frontend og PostgreSQL (Railway). ~10 interne brukere, ingen offentlig eksponering.

**Kjør alltid:** `npm run dev` (nodemon, port 3001) → test i nettleser på http://localhost:3001

## Tech Stack

| Lag | Teknologi |
|---|---|
| Backend | Node.js + Express, enkeltfil `server.js` (1357 linjer) |
| Database | PostgreSQL via `node-postgres` (`db.js`, 25 linjer) |
| Frontend | Vanilla ES6 JS SPA, 15 sider i `public/js/pages/` |
| Auth | HTTP Basic Auth + scrypt-hashing |
| Deploy | Railway (auto-deploy på push til main) |
| Test | Ingen — manuell QA i nettleser |

## Arkitekturnormer

**Backend (`server.js`):**
- Alle ruter bruker parameteriserte SQL-spørringer (`$1, $2, ...`) — aldri strenginterpolasjon i SQL
- Valideringsfeil → `validationError(res, msg)` → HTTP 400
- Alle ruter er innpakket i `try/catch` → HTTP 500 med feilmelding
- Faselogikk: `Tegnet` setter alltid `probability = 100`
- Dataformateringshjelper: `fmtRow()` gjør `id` → `_id` for frontend-kompatibilitet

**Frontend (`public/js/`):**
- Alle API-kall går gjennom `public/js/api.js` — aldri direkte `fetch('/api/...')` i sider
- Sidemønster: `export async function render(el, state)` — hent data, sett `el.innerHTML`, legg til event listeners
- HTML-escape alltid brukergenerert innhold: `window.escHtml(s)`
- Globale UI-hjelpere: `window.fmt()`, `window.phaseBadge()`, `window.openModal()`, `window.ui.*`
- Etter `el.innerHTML = ...`, knytt alltid event listeners på nytt (ingen React-virtual DOM)

**Database:**
- PostgreSQL DATE returneres som streng `YYYY-MM-DD` (egendefinert typeparsing i `db.js`)
- NUMERIC returneres som `parseFloat` (ikke streng)
- Kaskadesletting er satt opp — investorsletting fjerner kontakter, logg, oppgaver, produktkoblinger automatisk

## Gyldige domenedata

```
FASER: Prospekt | Aktiv dialog | Investor | Tidligere investor | På vent
(Fase = kundens livssyklus. Tegning styres via committed_amount på product_investors, ikke fase.)
TYPER: Pensjon | Stiftelse | Family Office | Forsikring | Institusjonell | Pensjonskasse | Private Banking | Rådgiver | Annet
LOGGTYPER: Møte | Telefon | Tapt anrop | E-post mottatt | E-post sendt | Event | Video | Annet | Notat
LEADS: (5 teamnavn) | Ekstern
VEHICLES: IS | Feeder | Ikke avklart
```

## Utviklingsarbeidsflyt

### Plan-modus — bruk for ikke-trivielle oppgaver (3+ trinn eller arkitekturendringer)
1. Skriv plan i `tasks/todo.md` med avkryssingsbokser
2. Bekreft planen med brukeren
3. Kryss av etter hvert
4. Legg til oppsummeringsnotat når ferdig

### Verifisering — aldri merk ferdig uten å bevise det
- Start serveren (`npm run dev`) og test i nettleser
- Test gylden vei **og** kanttilfeller (ugyldig input, tom tilstand, admin vs. bruker)
- Se etter konsollfeil i terminalen og nettleserens DevTools
- For backend-endringer: test via curl eller direkte nettleserkall

### Selvforbedring
- Etter en korreksjon fra brukeren: legg til mønsteret i `tasks/lessons.md`
- Les `tasks/lessons.md` ved starten av en ny økt

## Sikkerhetsnormer

- Aldri strenginterpolasjon i SQL → alltid parameteriserte spørringer
- Aldri vis `DATABASE_URL`, passord-hasher eller nøkler i logger eller svar
- CSRF-beskyttelse er ikke implementert — ikke utvid til offentlig internett uten det
- Basic Auth er kun trygt over HTTPS — håndheves av Railway i produksjon

## Filstruktur — viktigste filer

```
server.js          Backend-API (~50 endepunkter)
db.js              PostgreSQL-tilkobling og typeparsing
schema.sql         Idempotent skjema (CREATE IF NOT EXISTS)
public/js/api.js   Alle frontend-API-kall (eneste sted for URL-er)
public/js/app.js   SPA-routing, modal-system, globale hjelpere
public/js/pages/   15 sidekomponenter
tasks/todo.md      Nåværende arbeidsplan
tasks/lessons.md   Lærte mønstre og korreksjoner
```

## Prinsipper

- **Enkelhet først:** Minimer berørt kode. Server.js er allerede en stor fil — ikke legg til abstraksjonslag uten at det er nødvendig.
- **Ingen latskap:** Finn rotårsaker. Ingen midlertidige fikser.
- **Minimal påvirkning:** Endre kun det som er nødvendig. Sideeffekter er lett å overse i en 1357-linjers fil.
- **Ingen kommentarer** med mindre *hvorfor* er ikke åpenbart (skjulte begrensninger, workaround for spesifikk bug).
