# ORO Areal — Investor CRM

CRM for investoroppfølging for ORO Areal Eiendomsfond IS. Kjører som en Express-server med en vanilla JS-frontend og PostgreSQL-database (Railway).

## Krav

- **Node.js** versjon 18 eller nyere — last ned fra [nodejs.org](https://nodejs.org) (velg LTS)
- **PostgreSQL** — lokalt via Railway (`DATABASE_PUBLIC_URL`)

## Oppsett (gjøres én gang)

```bash
npm install
cp .env.example .env   # fyll inn DATABASE_URL fra Railway
npm run dev            # start serveren
```

Åpne http://localhost:3001

## Daglig bruk

```bash
npm run dev
```

## Kommandooversikt

| Kommando          | Hva den gjør                                              |
|-------------------|-----------------------------------------------------------|
| `npm install`     | Installer avhengigheter (kun første gang)                 |
| `npm run dev`     | Start CRM-et lokalt med auto-restart (nodemon)            |
| `npm run start`   | Start uten auto-restart (produksjon)                      |
| `npm run migrate` | Engangsmigrasjon fra JSON-filer til PostgreSQL            |

## Teknisk oversikt

Se [ARCHITECTURE.md](ARCHITECTURE.md) for full dokumentasjon av arkitektur, mappestruktur, miljøvariabler, backup og deployment til Railway.

## Filstruktur

```
oro-crm/
├── server.js        Express-server — hele API-et
├── db.js            PostgreSQL-tilkobling (node-postgres)
├── schema.sql       Databaseskjema — kjøres automatisk ved oppstart
├── migrate.js       Engangsmigrasjon fra JSON → PostgreSQL
├── public/          Frontend (vanilla JS)
│   ├── index.html
│   ├── js/app.js
│   └── js/pages/
└── data/            Backup-filer (ekskludert fra git)
    └── backups/
```
