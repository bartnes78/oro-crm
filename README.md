# ORO Areal — Investor CRM

CRM for investoroppfølging for ORO Areal Eiendomsfond IS. Kjører som en Express-server med en vanilla JS-frontend og JSON-fillagring.

## Krav

- **Node.js** versjon 18 eller nyere — last ned fra [nodejs.org](https://nodejs.org) (velg LTS)

## Oppsett (gjøres én gang)

```bash
npm install
npm run seed    # importer data fra ORO Investorer Master.xlsx
npm run dev     # start serveren
```

Åpne http://localhost:3001

## Daglig bruk

```bash
npm run dev
```

## Kommandooversikt

| Kommando       | Hva den gjør                                              |
|----------------|-----------------------------------------------------------|
| `npm install`  | Installer avhengigheter (kun første gang)                 |
| `npm run seed` | Importer data fra Excel-filen til JSON-filene i `data/`   |
| `npm run dev`  | Start CRM-et på http://localhost:3001                     |

## Teknisk oversikt

Se [ARCHITECTURE.md](ARCHITECTURE.md) for full dokumentasjon av arkitektur, mappestruktur, miljøvariabler, backup og deployment til Railway.

## Filstruktur

```
oro-crm/
├── server.js              Express-server — hele API-et
├── db.js                  Lese/skrive JSON-filer med atomic write og skriv-kø
├── seed.js                Importer data fra Excel-fil
├── public/                Frontend (vanilla JS — dette er produksjonskoden)
│   ├── index.html
│   ├── js/app.js
│   └── js/pages/
└── data/                  JSON-filer — all data lagres her
    ├── investors.json
    ├── contacts.json
    ├── contact_log.json
    ├── tasks.json
    ├── products.json
    ├── product_investors.json
    └── users.json
```

## Seed på nytt etter Excel-oppdatering

Hvis du oppdaterer `ORO Investorer Master.xlsx`, kjør:

```bash
npm run seed
```

**NB:** Dette overskriver investorer og kontakter. Kontaktlogg, oppgaver og prosjektdata beholdes.
