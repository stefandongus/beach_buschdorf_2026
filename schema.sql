-- Schema für Beach Buschdorf 26/27
-- Anwenden mit: wrangler d1 execute buschdorf-db --file=./schema.sql --remote

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0,
  season_target INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,              -- 'YYYY-MM-DD'
  start_time TEXT NOT NULL DEFAULT '20:00',
  end_time TEXT NOT NULL DEFAULT '22:00',
  cancelled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rsvps (
  session_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'offen',   -- 'spielt' | 'nicht' | 'offen'
  selected INTEGER NOT NULL DEFAULT 0,     -- manuelle Admin-Auswahl bei mehr als 5 Zusagen
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, player_id)
);

-- Springer: von Spielern selbst hinzugefügte Ersatzleute für einen Termin
CREATE TABLE IF NOT EXISTS springer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  added_by TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Kommentare pro Termin, für alle sichtbar
CREATE TABLE IF NOT EXISTS kommentare (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Activity-Log: Admin-Verlaufsansicht (alle RSVP-, Springer-, Kommentar- und Admin-Aktionen)
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  session_id INTEGER,
  actor TEXT NOT NULL,
  action TEXT NOT NULL
);

-- Spieler-Seed. Die Tokens sind zufällige Zugangs-Tokens (Magic-Links) —
-- nach dem Einspielen nicht mehr ändern, sonst funktioniert der jeweilige Link nicht mehr.
INSERT INTO players (name, token, is_admin) VALUES
  ('Stefan D.', '7308b9974ef5e2dad61c02ef', 1),
  ('Markus', 'cd9297da1cb6edf37c37c152', 0),
  ('Jan', 'ee2ab6f5f9cf9b117176836d', 0),
  ('Dirk', '4f565f63e4a5007f77d9dbdc', 0),
  ('Bernd', 'f29e82723922450144374eb2', 0),
  ('Stefan W.', '6e958c02bbf7b1f219f4b8d3', 0);
