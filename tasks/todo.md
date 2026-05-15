# ORO CRM — Oppgaveliste

## Pågående

*(ingen aktiv oppgave)*

---

## Backlog

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
- [ ] Ingen automatiserte tester — vurder enkel integrasjonstest for kjerneruter (`/api/investors`, `/api/dashboard`)
- [ ] `react` og `react-dom` er listet som avhengigheter men ikke brukt — fjern fra `package.json`
- [ ] CSRF-beskyttelse mangler — nødvendig hvis CRM åpnes bredere enn internt team

### Backup-rutine

- [ ] Avtal hvem er ansvarlig for ukentlig Excel-eksport (Investorer → Eksporter Excel)
- [ ] Vurder om Railway volume/persistent storage bør settes opp for ekstra sikring

---

## Fullført

*(ingen fullførte oppgaver ennå)*
