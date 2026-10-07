// Beach Buschdorf 26/27 — Terminplaner, Worker Backend
// Statische Dateien aus /public werden automatisch von Cloudflare ausgeliefert
// (siehe [assets] in wrangler.toml). Dieser Worker übernimmt nur /api/*.

const PLAYER_ORDER = ["Stefan D.", "Markus", "Jan", "Dirk", "Bernd", "Stefan W."];
const STATUS_TEXT = { spielt: "spielt", nicht: "kann nicht", offen: "offen" };

function sortPlayers(list) {
  return [...list].sort((a, b) => PLAYER_ORDER.indexOf(a.name) - PLAYER_ORDER.indexOf(b.name));
}

// Activity-Log: protokolliert alle Änderungen (RSVP, Springer, Kommentare, Admin-
// Aktionen) für die Admin-Verlaufsansicht. sessionId ist null bei Aktionen ohne
// Terminbezug (z. B. Saisonziel ändern).
async function logActivity(db, sessionId, actor, action) {
  await db
    .prepare(
      `INSERT INTO activity_log (created_at, session_id, actor, action) VALUES (?, ?, ?, ?)`
    )
    .bind(new Date().toISOString(), sessionId ?? null, actor, action)
    .run();
}

async function getPlayerName(db, playerId) {
  const row = await db.prepare("SELECT name FROM players WHERE id = ?").bind(playerId).first();
  return row ? row.name : "Unbekannt";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function todayUTC() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function daysUntil(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  return Math.round((target - todayUTC()) / 86400000);
}

async function getPlayerByToken(db, token) {
  if (!token) return null;
  return await db
    .prepare("SELECT * FROM players WHERE token = ?")
    .bind(token)
    .first();
}

// Ampel für Beach Buschdorf: weniger als 4 = rot, genau 4 = hellgrün,
// genau 5 = dunkelgrün, mehr als 5 = orange. Gilt sofort für alle Termine.
function flagStatus(session, spieltCount) {
  if (session.cancelled) return "abgesagt";
  if (spieltCount < 4) return "rot";
  if (spieltCount === 4) return "hellgruen";
  if (spieltCount === 5) return "dunkelgruen";
  return "orange";
}

async function sessionWithCounts(db, session, playerId, allPlayers) {
  const rsvps = await db
    .prepare("SELECT player_id, status, selected FROM rsvps WHERE session_id = ?")
    .bind(session.id)
    .all();
  const rows = rsvps.results || [];
  const spielt = rows.filter((r) => r.status === "spielt").length;
  const nicht = rows.filter((r) => r.status === "nicht").length;
  const mine = rows.find((r) => r.player_id === playerId);
  // Jeder Spieler sieht die Auswahl aller — nur das Ändern bleibt auf die eigene Zeile beschränkt (siehe /api/rsvp).
  const players = allPlayers.map((p) => {
    const r = rows.find((x) => x.player_id === p.id);
    return { playerId: p.id, name: p.name, status: r ? r.status : "offen" };
  });
  const { results: springerRows } = await db
    .prepare("SELECT id, name, active FROM springer WHERE session_id = ? ORDER BY id ASC")
    .bind(session.id)
    .all();
  const springer = springerRows.map((sp) => ({ id: sp.id, name: sp.name, active: !!sp.active }));
  const aktiveSpringer = springer.filter((sp) => sp.active).length;
  const effektivSpielt = spielt + aktiveSpringer; // zählt für Ampel & Spielerzahl mit
  const { results: kommentarRows } = await db
    .prepare("SELECT id, player_id, player_name, text FROM kommentare WHERE session_id = ? ORDER BY id ASC")
    .bind(session.id)
    .all();
  const kommentare = kommentarRows.map((k) => ({ id: k.id, playerId: k.player_id, name: k.player_name, text: k.text }));
  return {
    id: session.id,
    date: session.date,
    start_time: session.start_time,
    end_time: session.end_time,
    cancelled: !!session.cancelled,
    spielt: effektivSpielt,
    nicht,
    offen: 6 - spielt - nicht,
    flag: flagStatus(session, effektivSpielt),
    daysUntil: daysUntil(session.date),
    myStatus: mine ? mine.status : "offen",
    players,
    springer,
    kommentare,
  };
}

async function handleSessions(db, player) {
  const { results } = await db
    .prepare("SELECT * FROM sessions ORDER BY date ASC")
    .all();
  const { results: allPlayersRaw } = await db
    .prepare("SELECT id, name FROM players ORDER BY id ASC")
    .all();
  const allPlayers = sortPlayers(allPlayersRaw);
  const upcoming = results.filter((s) => daysUntil(s.date) >= -1); // gestern noch mit anzeigen
  const withCounts = [];
  for (const s of upcoming) {
    withCounts.push(await sessionWithCounts(db, s, player.id, allPlayers));
  }
  return json({ player: { id: player.id, name: player.name, isAdmin: !!player.is_admin }, sessions: withCounts });
}

// Plan/Ist — lesbar für ALLE Spieler (nicht unter /api/admin/, daher kein Admin-Gate).
// Das Setzen der Plan-Werte bleibt über /api/admin/target admin-only.
async function handleStats(db) {
  const { results: playersRaw } = await db
    .prepare("SELECT id, name, season_target FROM players ORDER BY id ASC")
    .all();
  const players = sortPlayers(playersRaw);
  const out = [];
  for (const p of players) {
    const row = await db
      .prepare("SELECT COUNT(*) as c FROM rsvps WHERE player_id = ? AND status = 'spielt'")
      .bind(p.id)
      .first();
    out.push({ name: p.name, plan: p.season_target, ist: row.c });
  }
  return json({ stats: out });
}

async function handleRsvp(request, db, player) {
  const body = await request.json();
  const { sessionId, status } = body;
  if (!["spielt", "nicht", "offen"].includes(status)) {
    return json({ error: "ungültiger Status" }, 400);
  }
  await db
    .prepare(
      `INSERT INTO rsvps (session_id, player_id, status, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, player_id)
       DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
    )
    .bind(sessionId, player.id, status, new Date().toISOString())
    .run();
  await logActivity(db, sessionId, player.name, `→ ${STATUS_TEXT[status]}`);
  return json({ ok: true });
}

async function handleAdminSessions(db) {
  const { results: sessions } = await db
    .prepare("SELECT * FROM sessions ORDER BY date ASC")
    .all();
  const { results: playersRaw } = await db
    .prepare("SELECT id, name FROM players ORDER BY id ASC")
    .all();
  const players = sortPlayers(playersRaw);
  const out = [];
  for (const s of sessions) {
    const { results: rsvps } = await db
      .prepare("SELECT player_id, status, selected FROM rsvps WHERE session_id = ?")
      .bind(s.id)
      .all();
    const perPlayer = players.map((p) => {
      const r = rsvps.find((x) => x.player_id === p.id);
      return { playerId: p.id, name: p.name, status: r ? r.status : "offen", selected: r ? !!r.selected : false };
    });
    const spielt = perPlayer.filter((p) => p.status === "spielt").length;
    const { results: springerRows } = await db
      .prepare("SELECT active FROM springer WHERE session_id = ?")
      .bind(s.id)
      .all();
    const aktiveSpringer = springerRows.filter((sp) => sp.active).length;
    out.push({
      id: s.id,
      date: s.date,
      cancelled: !!s.cancelled,
      flag: flagStatus(s, spielt + aktiveSpringer),
      players: perPlayer,
    });
  }
  return json({ sessions: out });
}

async function handleAdminCancel(request, db, player) {
  const { sessionId, cancelled } = await request.json();
  await db
    .prepare("UPDATE sessions SET cancelled = ? WHERE id = ?")
    .bind(cancelled ? 1 : 0, sessionId)
    .run();
  await logActivity(db, sessionId, player.name, cancelled ? "hat Termin abgesagt" : "hat Termin wieder aktiviert");
  return json({ ok: true });
}

async function handleAdminSelect(request, db, player) {
  const { sessionId, playerId, selected } = await request.json();
  await db
    .prepare(
      `INSERT INTO rsvps (session_id, player_id, status, selected, updated_at)
       VALUES (?, ?, 'spielt', ?, ?)
       ON CONFLICT(session_id, player_id)
       DO UPDATE SET selected = excluded.selected, updated_at = excluded.updated_at`
    )
    .bind(sessionId, playerId, selected ? 1 : 0, new Date().toISOString())
    .run();
  const targetName = await getPlayerName(db, playerId);
  await logActivity(db, sessionId, player.name, `hat ${targetName} ${selected ? "eingeteilt" : "aus Einteilung entfernt"}`);
  return json({ ok: true });
}

async function handleAdminTarget(request, db, player) {
  const { playerId, target } = await request.json();
  await db
    .prepare("UPDATE players SET season_target = ? WHERE id = ?")
    .bind(target, playerId)
    .run();
  const targetName = await getPlayerName(db, playerId);
  await logActivity(db, null, player.name, `hat Saisonziel von ${targetName} auf ${target} gesetzt`);
  return json({ ok: true });
}

// Admin setzt den Status EINES beliebigen Spielers direkt (Zuteilung) — anders als
// /api/rsvp, das nur die eigene Zeile des angemeldeten Spielers ändern darf.
async function handleAdminRsvp(request, db, player) {
  const { sessionId, playerId, status } = await request.json();
  if (!["spielt", "nicht", "offen"].includes(status)) {
    return json({ error: "ungültiger Status" }, 400);
  }
  await db
    .prepare(
      `INSERT INTO rsvps (session_id, player_id, status, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, player_id)
       DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
    )
    .bind(sessionId, playerId, status, new Date().toISOString())
    .run();
  const targetName = await getPlayerName(db, playerId);
  await logActivity(db, sessionId, player.name, `hat ${targetName} auf "${STATUS_TEXT[status]}" gesetzt`);
  return json({ ok: true });
}

// Springer: darf JEDER der 6 Spieler hinzufügen/aktivieren/entfernen — deshalb bewusst
// nicht unter /api/admin/, sondern normale Routen mit nur normalem Login-Gate.
async function handleSpringerAdd(request, db, player) {
  const { sessionId, name } = await request.json();
  const trimmed = (name || "").trim();
  if (!trimmed) return json({ error: "Name fehlt" }, 400);
  await db
    .prepare(
      `INSERT INTO springer (session_id, name, added_by, active, created_at)
       VALUES (?, ?, ?, 0, ?)`
    )
    .bind(sessionId, trimmed, player.name, new Date().toISOString())
    .run();
  await logActivity(db, sessionId, player.name, `hat Springer "${trimmed}" hinzugefügt`);
  return json({ ok: true });
}

async function handleSpringerToggle(request, db, player) {
  const { springerId, active } = await request.json();
  const row = await db.prepare("SELECT session_id, name FROM springer WHERE id = ?").bind(springerId).first();
  await db
    .prepare("UPDATE springer SET active = ? WHERE id = ?")
    .bind(active ? 1 : 0, springerId)
    .run();
  if (row) {
    await logActivity(db, row.session_id, player.name, `hat Springer "${row.name}" ${active ? "aktiviert" : "deaktiviert"}`);
  }
  return json({ ok: true });
}

async function handleSpringerRemove(request, db, player) {
  const { springerId } = await request.json();
  const row = await db.prepare("SELECT session_id, name FROM springer WHERE id = ?").bind(springerId).first();
  await db.prepare("DELETE FROM springer WHERE id = ?").bind(springerId).run();
  if (row) {
    await logActivity(db, row.session_id, player.name, `hat Springer "${row.name}" entfernt`);
  }
  return json({ ok: true });
}

// Kommentare: darf ebenfalls JEDER der 6 Spieler hinzufügen, kein Admin-Gate.
async function handleKommentarAdd(request, db, player) {
  const { sessionId, text } = await request.json();
  const trimmed = (text || "").trim();
  if (!trimmed) return json({ error: "Kommentar ist leer" }, 400);
  await db
    .prepare(
      `INSERT INTO kommentare (session_id, player_id, player_name, text, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(sessionId, player.id, player.name, trimmed, new Date().toISOString())
    .run();
  await logActivity(db, sessionId, player.name, "hat einen Kommentar hinzugefügt");
  return json({ ok: true });
}

// Bearbeiten/Löschen: der Verfasser selbst ODER der Admin (Moderation) — serverseitig
// geprüft, nicht nur in der UI versteckt.
async function handleKommentarEdit(request, db, player) {
  const { kommentarId, text } = await request.json();
  const trimmed = (text || "").trim();
  if (!trimmed) return json({ error: "Kommentar ist leer" }, 400);
  const row = await db.prepare("SELECT player_id, session_id FROM kommentare WHERE id = ?").bind(kommentarId).first();
  if (!row) return json({ error: "Kommentar nicht gefunden" }, 404);
  if (row.player_id !== player.id && !player.is_admin) return json({ error: "kein Zugriff" }, 403);
  await db.prepare("UPDATE kommentare SET text = ? WHERE id = ?").bind(trimmed, kommentarId).run();
  await logActivity(db, row.session_id, player.name, "hat einen Kommentar bearbeitet");
  return json({ ok: true });
}

async function handleKommentarDelete(request, db, player) {
  const { kommentarId } = await request.json();
  const row = await db.prepare("SELECT player_id, session_id FROM kommentare WHERE id = ?").bind(kommentarId).first();
  if (!row) return json({ error: "Kommentar nicht gefunden" }, 404);
  if (row.player_id !== player.id && !player.is_admin) return json({ error: "kein Zugriff" }, 403);
  await db.prepare("DELETE FROM kommentare WHERE id = ?").bind(kommentarId).run();
  await logActivity(db, row.session_id, player.name, "hat einen Kommentar gelöscht");
  return json({ ok: true });
}

// Admin-Verlauf: ALLE protokollierten Aktionen, neueste zuerst.
async function handleAdminActivity(db) {
  const { results } = await db
    .prepare(
      `SELECT al.id, al.created_at, al.actor, al.action, s.date as session_date
       FROM activity_log al
       LEFT JOIN sessions s ON s.id = al.session_id
       ORDER BY al.id DESC`
    )
    .all();
  return json({
    activity: results.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      actor: r.actor,
      action: r.action,
      sessionDate: r.session_date || null,
    })),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      // Sollte durch [assets] eigentlich nie erreicht werden, ist aber ein sauberer Fallback.
      return new Response("Not found", { status: 404 });
    }

    try {
      // Das Frontend hängt den Token bei JEDEM Request als ?t=... an, auch bei POST.
      const token = url.searchParams.get("t");
      const player = await getPlayerByToken(env.DB, token);
      if (!player) return json({ error: "ungültiger Zugangslink" }, 401);

      const { pathname } = url;
      const isAdminRoute = pathname.startsWith("/api/admin/");
      if (isAdminRoute && !player.is_admin) {
        return json({ error: "kein Zugriff" }, 403);
      }

      if (pathname === "/api/sessions" && request.method === "GET") {
        return handleSessions(env.DB, player);
      }
      if (pathname === "/api/rsvp" && request.method === "POST") {
        return handleRsvp(request, env.DB, player);
      }
      if (pathname === "/api/stats" && request.method === "GET") {
        return handleStats(env.DB);
      }
      if (pathname === "/api/admin/sessions" && request.method === "GET") {
        return handleAdminSessions(env.DB);
      }
      if (pathname === "/api/admin/cancel" && request.method === "POST") {
        return handleAdminCancel(request, env.DB, player);
      }
      if (pathname === "/api/admin/select" && request.method === "POST") {
        return handleAdminSelect(request, env.DB, player);
      }
      if (pathname === "/api/admin/target" && request.method === "POST") {
        return handleAdminTarget(request, env.DB, player);
      }
      if (pathname === "/api/admin/rsvp" && request.method === "POST") {
        return handleAdminRsvp(request, env.DB, player);
      }
      if (pathname === "/api/admin/activity" && request.method === "GET") {
        return handleAdminActivity(env.DB);
      }
      if (pathname === "/api/springer/add" && request.method === "POST") {
        return handleSpringerAdd(request, env.DB, player);
      }
      if (pathname === "/api/springer/toggle" && request.method === "POST") {
        return handleSpringerToggle(request, env.DB, player);
      }
      if (pathname === "/api/springer/remove" && request.method === "POST") {
        return handleSpringerRemove(request, env.DB, player);
      }
      if (pathname === "/api/kommentar/add" && request.method === "POST") {
        return handleKommentarAdd(request, env.DB, player);
      }
      if (pathname === "/api/kommentar/edit" && request.method === "POST") {
        return handleKommentarEdit(request, env.DB, player);
      }
      if (pathname === "/api/kommentar/delete" && request.method === "POST") {
        return handleKommentarDelete(request, env.DB, player);
      }
      return json({ error: "unbekannte Route" }, 404);
    } catch (err) {
      // Ohne diesen Fang bleibt das Frontend bei einem Serverfehler für immer bei
      // "Lädt …" hängen, ohne dass irgendwo eine Fehlermeldung auftaucht.
      return json({ error: "Serverfehler: " + err.message }, 500);
    }
  },
};
