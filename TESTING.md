# Manuell testprotokoll — ORO CRM

Ingen automatisert testsuite. Kjør disse scenariene etter større endringer.

## Oppstart
```
npm run dev   # nodemon, port 3001
```

---

## 1. must_change_password — serversidehåndhevelse

| Steg | Handling | Forventet |
|---|---|---|
| 1 | Admin oppretter ny bruker via Brukeradmin | Bruker opprettes med `must_change_password=true` |
| 2 | Ny bruker logger inn | Frontend ber om passordbytte |
| 3 | Ny bruker: `GET /api/me` (curl med Basic Auth) | 200 OK |
| 4 | Ny bruker: `GET /api/dashboard` (curl) | 403 "Passord må endres før du kan bruke CRM" |
| 5 | Ny bruker: `PUT /api/me/password` med nytt passord ≥ 6 tegn | 200 OK, `mustChangePassword: false` |
| 6 | Ny bruker: `GET /api/dashboard` etter passordbytte | 200 OK |

```bash
# Eksempel-curl (erstatt credentials)
curl -u nybruker:byttpassord http://localhost:3001/api/dashboard
# → 403

curl -u nybruker:byttpassord -X PUT http://localhost:3001/api/me/password \
  -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" \
  -d '{"password":"nyttPassord123"}'
# → 200

curl -u nybruker:nyttPassord123 http://localhost:3001/api/dashboard
# → 200
```

---

## 2. validationError — 400 ikke 500

| Handling | Forventet |
|---|---|
| `PUT /api/me/password` med passord < 6 tegn | 400 "Passordet må være minst 6 tegn" |
| `POST /api/feedback` med tom kommentar | 400 "Kommentar er påkrevd" |

---

## 3. Admin-tilgang på risikohandlinger

Kjør som vanlig bruker (ikke admin):

| Endepunkt | Forventet |
|---|---|
| `DELETE /api/investors/:id` | 403 "Kun administratorer har tilgang" |
| `POST /api/merge` | 403 |
| `DELETE /api/contacts/:id` | 403 |
| `GET /api/users` | 403 |
| `POST /api/backups/restore/:stamp` | 403 |

---

## 4. Audit-logg

| Handling | Verifiser via `GET /api/audit-log` |
|---|---|
| Opprett investor | action=create, entity_type=investor |
| Oppdater investor | action=update, old_value og new_value inneholder name/phase/lead |
| Slett investor (admin) | action=delete, old_value inneholder investor-navn |
| Merge investorer (admin) | action=merge, description inneholder begge ID-er |
| Opprett kontakt | action=create, entity_type=contact |
| Slett kontakt (admin) | action=delete, entity_type=contact |
| Ny loggføring | action=create, entity_type=log |
| Slett loggføring | action=delete, entity_type=log |
| Opprett oppgave | action=create, entity_type=task |
| Slett oppgave | action=delete, entity_type=task |
| Backup restore | action=restore, entity_type=backup |
| Opprett bruker | action=create, entity_type=user |
| Oppdater bruker | action=update, description inneholder hva som endret seg |
| Slett bruker | action=delete, entity_type=user |

```bash
curl -u admin:passord http://localhost:3001/api/audit-log
curl -u admin:passord "http://localhost:3001/api/audit-log?entity_type=investor&limit=50"
```

---

## 5. Datakvalitet-API

```bash
curl -u admin:passord http://localhost:3001/api/data-quality
```

Svar skal inneholde alle disse feltene med `count` og `items`:
- `noContactEmail` — investorer uten e-post på noen kontakt
- `noLead` — investorer uten ansvarlig
- `noPhase` — investorer uten fase
- `noLastContact` — investorer uten registrert sist kontakt
- `inactive30days`, `inactive60days`, `inactive90days`
- `piMissingData` — product-investor-koblinger uten target_ticket eller probability

Kun admin får tilgang. Vanlig bruker → 403.

---

## 6. Gylden vei — investor-flyt

1. Opprett investor → vises i investorlisten
2. Legg til kontakt → vises under investor
3. Loggfør møte → `last_contact` oppdateres på investor
4. Legg til oppgave → vises i oppgavelisten
5. Koble til produkt med ticket og sannsynlighet
6. Sjekk dashboard-tall (total, ticket, weighted)
7. Slett loggføring, slett oppgave — begge forsvinner

---

## 7. Schema-idempotens

Start server to ganger på rad. Ingen feil i konsollen ved andre oppstart (alle `CREATE TABLE IF NOT EXISTS` og `DO $$` blokker skal passere stille).
