# ORO CRM — Endringslogg

## [0.4.0] — Beta — 2026-05-14

### Infrastruktur
- Migrert fra JSON-fillagring til PostgreSQL (Railway)
- Ny `db.js` med pg-tilkobling og type-parsere (DATE, NUMERIC)
- `migrate.js` for engangsmigrering av alle JSON-data til PostgreSQL
- `schema.sql` med 7 tabeller: investors, contacts, contact_log, tasks, products, product_investors, users
- Nodemon lagt til for automatisk server-restart under utvikling

### Nye funksjoner
- Sammenslåing av duplikate kontakter (modal med valg av hvilken som beholdes)
- Cascading delete: sletting av investor fjerner også kontakter, logg, oppgaver og produkt-koblinger

### Feilrettinger
- Vektet volum KPI inkluderer nå Tegnet-investorer korrekt
- Fase "Tegnet" setter alltid sannsynlighet til 100 %
- Standard fase rettet fra "Prospect" til "Prospekt"
- Backup dekker nå alle 7 tabeller (var 4)
- Backup-stamp validering mot path traversal
- Bruker-admin: type-mismatch (_id number vs string) rettet

### Sikkerhet
- Sensitiv data (investorer, kontakter, passord-hashes) fjernet fra git-historikk
- `.gitignore` oppdatert: ekskluderer `data/`, `.env`, `*.bak`

---

## [0.3.0] — 2026-04 (estimert)

- GitHub-repo opprettet (rent, uten sensitiv historikk)
- Railway-deployment satt opp med PostgreSQL-plugin
- ARCHITECTURE.md dokumentasjon

## [0.2.0] — 2026-03 (estimert)

- Duplikat-detektor for investorer og kontakter
- Produkt-modul med investor-koblinger
- Backup og restore av alle data
- Bruker-administrasjon med roller

## [0.1.0] — 2026-02 (estimert)

- Grunnleggende CRM: investorliste, detalj, kontakter, kontaktlogg, oppgaver
- Dashboard med KPI-er
- HTTP Basic Auth med scrypt-hashing
