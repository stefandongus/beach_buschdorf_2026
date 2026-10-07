# Beach Buschdorf 26/27 — Terminplaner

PWA für die Montags-Beachvolleyballgruppe (20–22 Uhr, 05.10.2026 – 31.05.2027).
Läuft komplett auf Cloudflare Workers (Static Assets + D1), keine weitere Infrastruktur nötig.
Keine E-Mail-Erinnerungen.

## Ampel pro Termin

| Zusagen | Farbe |
|---|---|
| weniger als 4 | rot |
| 4 | hellgrün |
| 5 | dunkelgrün |
| mehr als 5 | orange (Admin kann auswählen, wer dabei ist) |

Aktive Springer zählen wie Zusagen.

## Einmalig einrichten

```
npm install -g wrangler
wrangler login

# D1-Datenbank anlegen
wrangler d1 create buschdorf-db
# -> die ausgegebene database_id in wrangler.toml eintragen
#    (ersetzt "WIRD_NACH_D1_CREATE_HIER_EINGETRAGEN")

# Schema + Spieler + Saison-Termine einspielen
wrangler d1 execute buschdorf-db --file=./schema.sql --remote
wrangler d1 execute buschdorf-db --file=./seed_sessions.sql --remote
```

Danach in Cloudflare (Workers & Pages → Create → Import a repository) das Repo
`beach_buschdorf_2026` verbinden. Jeder Push auf `main` deployt automatisch.

## Zugang

Jeder Spieler hat einen persönlichen Magic-Link: `https://<worker-url>/?t=<token>`.
Die Tokens stehen in `schema.sql` (Tabelle `players`). Stefan D. ist Admin.

Stand: 07.10.2026
