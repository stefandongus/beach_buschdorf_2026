const app = document.getElementById("app");

function getToken() {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("t");
  if (fromUrl) {
    localStorage.setItem("bv_token", fromUrl);
    return fromUrl;
  }
  return localStorage.getItem("bv_token");
}

const TOKEN = getToken();

function api(path, opts = {}) {
  const url = new URL(path, location.origin);
  url.searchParams.set("t", TOKEN);
  return fetch(url, {
    ...opts,
    headers: { "content-type": "application/json" },
  })
    .then((r) => r.json())
    .catch((err) => ({ error: "Verbindung fehlgeschlagen: " + err.message }));
}

const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;
}
function fmtWeekday(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return WOCHENTAG[d.getUTCDay()];
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  const datum = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
  const zeit = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${datum} ${zeit}`;
}

const FLAG_LABEL = {
  rot: "zu wenige",
  hellgruen: "4 — passt",
  dunkelgruen: "5 — top",
  orange: "mehr als 5",
  neutral: "noch offen",
  abgesagt: "abgesagt",
};

const STATUS_LABEL = { spielt: "spielt", nicht: "kann nicht", offen: "offen" };

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function statusText(s) {
  if (s.cancelled) return "Termin abgesagt";
  return `${s.spielt} spielen · ${s.nicht} können nicht`;
}

function zugesagteNamen(s) {
  const namen = s.players.filter((p) => p.status === "spielt").map((p) => p.name);
  const springerNamen = (s.springer || []).filter((sp) => sp.active).map((sp) => `${sp.name} (Springer)`);
  return [...namen, ...springerNamen];
}

function zugesagtHtml(s) {
  if (s.cancelled) return "";
  const namen = zugesagteNamen(s);
  if (namen.length === 0) return `<div class="zugesagt-namen">🏐 Noch niemand</div>`;
  return `<div class="zugesagt-namen">🏐 ${namen.map(escapeHtml).join(", ")}</div>`;
}

// ---------- Spieler-Ansicht ----------

async function renderPlayer() {
  const data = await api("/api/sessions");
  if (data.error) {
    app.innerHTML = `<p class="error">${data.error}</p>`;
    return;
  }
  const { player, sessions } = data;
  const active = sessions.filter((s) => !s.cancelled);
  const next = active[0];
  const rest = sessions.slice(1);

  app.innerHTML = `
    <div class="topbar">
      <div class="greeting">Hey <strong>${player.name}</strong></div>
      <div class="nav-links">
        <a class="admin-link" href="#stats">Statistik</a>
        ${player.isAdmin ? `<a class="admin-link" href="#admin">Admin →</a>` : ""}
      </div>
    </div>

    ${next ? heroHtml(next) : `<p class="loading">Keine Termine mehr.</p>`}

    <div class="liste">
      <h2>Weitere Termine</h2>
      ${rest.map(rowHtml).join("")}
    </div>
  `;

  if (next) {
    app.querySelectorAll(".hero .rsvp-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api("/api/rsvp", {
          method: "POST",
          body: JSON.stringify({ sessionId: next.id, status: btn.dataset.status }),
        });
        renderPlayer();
      });
    });
  }
  app.querySelectorAll(".mini-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessionId = Number(btn.dataset.session);
      const clicked = btn.dataset.status;
      const row = sessions.find((s) => s.id === sessionId);
      const newStatus = row.myStatus === clicked ? "offen" : clicked;
      await api("/api/rsvp", {
        method: "POST",
        body: JSON.stringify({ sessionId, status: newStatus }),
      });
      renderPlayer();
    });
  });
}

function heroHtml(s) {
  return `
    <div class="hero" data-flag="${s.flag}">
      <div class="eyebrow">Nächster Termin</div>
      <div class="datum">${fmtWeekday(s.date)}, ${fmtDate(s.date)}</div>
      <div class="uhrzeit">${s.start_time}–${s.end_time} Uhr</div>
      <div class="zaehler">
        <span class="pill" data-flag="${s.flag}">${FLAG_LABEL[s.flag]}</span>
        &nbsp;·&nbsp; <b>${s.spielt}</b> spielen
        ${s.kommentare.length > 0 ? `<span class="comment-hint" title="Kommentar vorhanden">💬</span>` : ""}
      </div>
      ${zugesagtHtml(s)}
      <div class="rsvp-group">
        <button class="rsvp-btn ${s.myStatus === "spielt" ? "active" : ""}" data-status="spielt">Ich spiele</button>
        <button class="rsvp-btn ${s.myStatus === "nicht" ? "active" : ""}" data-status="nicht">Kann nicht</button>
        <button class="rsvp-btn ${s.myStatus === "offen" ? "active" : ""}" data-status="offen">Noch offen</button>
      </div>
      <a class="details-link" href="#s/${s.id}">Alle 6 Spieler ansehen →</a>
    </div>
  `;
}

function rowHtml(s) {
  return `
    <div class="termin-row" data-flag="${s.flag}">
      <div class="tag">
        <div class="wtag">${fmtWeekday(s.date)}</div>
        <div class="datum">${fmtDate(s.date)}</div>
      </div>
      <div class="mitte">
        <div class="status-text">${statusText(s)}${s.kommentare.length > 0 ? ` <span class="comment-hint" title="Kommentar vorhanden">💬</span>` : ""}</div>
        ${zugesagtHtml(s)}
      </div>
      ${
        s.cancelled
          ? ""
          : `<div class="mini-rsvp">
              <button class="mini-btn ${s.myStatus === "spielt" ? "active" : ""}" data-status="spielt" data-session="${s.id}">✓</button>
              <button class="mini-btn ${s.myStatus === "nicht" ? "active" : ""}" data-status="nicht" data-session="${s.id}">✕</button>
            </div>`
      }
      <a class="chevron-btn" href="#s/${s.id}" aria-label="Termin-Details">›</a>
    </div>
  `;
}

// ---------- Termin-Detail (für ALLE Spieler: alle 6 Status sehen) ----------

async function renderSessionDetail(id) {
  const data = await api("/api/sessions");
  if (data.error) {
    app.innerHTML = `<p class="error">${data.error}</p>`;
    return;
  }
  const s = data.sessions.find((x) => x.id === id);
  if (!s) {
    app.innerHTML = `<p class="error">Termin nicht gefunden.</p><a class="zurueck" href="#">← zurück</a>`;
    return;
  }
  const myName = data.player.name;

  app.innerHTML = `
    <div class="admin-header">
      <h2>${fmtWeekday(s.date)}, ${fmtDate(s.date)}</h2>
      <a class="zurueck" href="#">← zurück</a>
    </div>

    <div class="hero" data-flag="${s.flag}">
      <div class="uhrzeit">${s.start_time}–${s.end_time} Uhr</div>
      <div class="zaehler">
        <span class="pill" data-flag="${s.flag}">${FLAG_LABEL[s.flag]}</span>
        &nbsp;·&nbsp; <b>${s.spielt}</b> spielen
      </div>
      ${
        s.cancelled
          ? ""
          : `<div class="rsvp-group">
              <button class="rsvp-btn ${s.myStatus === "spielt" ? "active" : ""}" data-status="spielt">Ich spiele</button>
              <button class="rsvp-btn ${s.myStatus === "nicht" ? "active" : ""}" data-status="nicht">Kann nicht</button>
              <button class="rsvp-btn ${s.myStatus === "offen" ? "active" : ""}" data-status="offen">Noch offen</button>
            </div>`
      }
    </div>

    <div class="admin-section">
      <h3>Alle Spieler</h3>
      ${s.players
        .map(
          (p) => `
        <div class="spieler-row">
          <span><span class="check-box" data-status="${p.status}"></span>${p.name}${p.name === myName ? " (du)" : ""}</span>
          <span class="status-tag" data-status="${p.status}">${STATUS_LABEL[p.status]}</span>
        </div>`
        )
        .join("")}
    </div>

    <div class="admin-section">
      <h3>Springer</h3>
      ${
        s.springer.length === 0
          ? `<p class="status-text">Noch keine Springer eingetragen.</p>`
          : s.springer
              .map(
                (sp) => `
        <div class="spieler-row">
          <span><button class="springer-check" data-active="${sp.active ? 1 : 0}" data-springer="${sp.id}"></button>${escapeHtml(sp.name)}</span>
          <button class="springer-remove" data-springer="${sp.id}" aria-label="${escapeHtml(sp.name)} entfernen">entfernen</button>
        </div>`
              )
              .join("")
      }
      <div class="springer-add">
        <input type="text" id="springer-name" placeholder="Name des Springers" maxlength="40">
        <button id="springer-add-btn">Hinzufügen</button>
      </div>
    </div>

    <div class="admin-section">
      <h3>Kommentare</h3>
      ${
        s.kommentare.length === 0
          ? `<p class="status-text">Noch keine Kommentare.</p>`
          : s.kommentare
              .map(
                (k) => `
        <div class="kommentar-item">
          <div class="kommentar-meta">${escapeHtml(k.name)}</div>
          <div class="kommentar-text">${escapeHtml(k.text)}</div>
          ${
            k.playerId === data.player.id || data.player.isAdmin
              ? `<div class="kommentar-actions">
                  <button class="kommentar-edit" data-kommentar="${k.id}">bearbeiten</button>
                  <button class="kommentar-delete" data-kommentar="${k.id}">löschen</button>
                </div>`
              : ""
          }
        </div>`
              )
              .join("")
      }
      <div class="springer-add">
        <input type="text" id="kommentar-text" placeholder="Kommentar schreiben …" maxlength="300">
        <button id="kommentar-add-btn">Absenden</button>
      </div>
    </div>
  `;

  app.querySelectorAll(".rsvp-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/rsvp", {
        method: "POST",
        body: JSON.stringify({ sessionId: id, status: btn.dataset.status }),
      });
      renderSessionDetail(id);
    });
  });

  app.querySelectorAll(".springer-check").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/springer/toggle", {
        method: "POST",
        body: JSON.stringify({ springerId: Number(btn.dataset.springer), active: btn.dataset.active !== "1" }),
      });
      renderSessionDetail(id);
    });
  });

  app.querySelectorAll(".springer-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/springer/remove", {
        method: "POST",
        body: JSON.stringify({ springerId: Number(btn.dataset.springer) }),
      });
      renderSessionDetail(id);
    });
  });

  const addBtn = document.getElementById("springer-add-btn");
  addBtn.addEventListener("click", async () => {
    const input = document.getElementById("springer-name");
    const name = input.value.trim();
    if (!name) return;
    addBtn.disabled = true;
    await api("/api/springer/add", {
      method: "POST",
      body: JSON.stringify({ sessionId: id, name }),
    });
    renderSessionDetail(id);
  });

  const kommentarBtn = document.getElementById("kommentar-add-btn");
  kommentarBtn.addEventListener("click", async () => {
    const input = document.getElementById("kommentar-text");
    const text = input.value.trim();
    if (!text) return;
    kommentarBtn.disabled = true;
    await api("/api/kommentar/add", {
      method: "POST",
      body: JSON.stringify({ sessionId: id, text }),
    });
    renderSessionDetail(id);
  });

  app.querySelectorAll(".kommentar-edit").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const current = btn.closest(".kommentar-item").querySelector(".kommentar-text").textContent;
      const updated = prompt("Kommentar bearbeiten:", current);
      if (updated === null) return;
      const trimmed = updated.trim();
      if (!trimmed) return;
      await api("/api/kommentar/edit", {
        method: "POST",
        body: JSON.stringify({ kommentarId: Number(btn.dataset.kommentar), text: trimmed }),
      });
      renderSessionDetail(id);
    });
  });

  app.querySelectorAll(".kommentar-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Kommentar wirklich löschen?")) return;
      await api("/api/kommentar/delete", {
        method: "POST",
        body: JSON.stringify({ kommentarId: Number(btn.dataset.kommentar) }),
      });
      renderSessionDetail(id);
    });
  });
}

// ---------- Statistik (für ALLE Spieler lesbar, niemand außer Admin kann hier ändern) ----------

async function renderStats() {
  const data = await api("/api/stats");
  if (data.error) {
    app.innerHTML = `<p class="error">${data.error}</p>`;
    return;
  }
  app.innerHTML = `
    <div class="admin-header">
      <h2>Plan / Ist</h2>
      <a class="zurueck" href="#">← zurück</a>
    </div>
    <table class="stats-table">
      <tr><th>Name</th><th>Plan</th><th>Ist</th></tr>
      ${data.stats.map((s) => `<tr><td>${s.name}</td><td>${s.plan}</td><td>${s.ist}</td></tr>`).join("")}
    </table>
  `;
}

// ---------- Admin-Ansicht ----------

async function renderAdmin() {
  const [sessionsData, statsData, activityData] = await Promise.all([
    api("/api/admin/sessions"),
    api("/api/stats"),
    api("/api/admin/activity"),
  ]);
  if (sessionsData.error) {
    app.innerHTML = `<p class="error">${sessionsData.error}</p>`;
    return;
  }

  app.innerHTML = `
    <div class="admin-header">
      <h2>Admin</h2>
      <a class="zurueck" href="#">← zurück</a>
    </div>

    <div class="admin-section">
      <h3>Plan / Ist — Saison</h3>
      <table class="stats-table">
        <tr><th>Name</th><th>Plan</th><th>Ist</th></tr>
        ${statsData.stats
          .map(
            (s, i) => `
          <tr>
            <td>${s.name}</td>
            <td><input type="number" min="0" value="${s.plan}" data-player-idx="${i}"></td>
            <td>${s.ist}</td>
          </tr>`
          )
          .join("")}
      </table>
    </div>

    <div class="admin-section">
      <h3>Verlauf</h3>
      <div class="verlauf-list">
        ${
          activityData.error || !activityData.activity || activityData.activity.length === 0
            ? `<p class="loading">Noch keine Einträge.</p>`
            : activityData.activity.map(verlaufItemHtml).join("")
        }
      </div>
    </div>

    <div class="admin-section">
      <h3>Termine</h3>
      ${sessionsData.sessions.map(adminTerminHtml).join("")}
    </div>
  `;

  // Plan-Werte speichern
  const playerIds = sessionsData.sessions[0]?.players.map((p) => p.playerId) || [];
  app.querySelectorAll("input[data-player-idx]").forEach((input) => {
    input.addEventListener("change", async () => {
      const idx = Number(input.dataset.playerIdx);
      await api("/api/admin/target", {
        method: "POST",
        body: JSON.stringify({ playerId: playerIds[idx], target: Number(input.value) }),
      });
    });
  });

  // Jede Termin-Karte kümmert sich nach einer Aktion nur noch um sich selbst
  // (siehe wireTerminCard) — dadurch bleibt der Rest der Seite und die Scroll-Position
  // beim Pflegen mehrerer Spieler komplett unangetastet.
  sessionsData.sessions.forEach((s) => {
    const card = app.querySelector(`.admin-termin[data-session-id="${s.id}"]`);
    if (card) wireTerminCard(card, s);
  });
}

function wireTerminCard(card, s) {
  const abschaltBtn = card.querySelector(".abschalt-btn");
  if (abschaltBtn) {
    abschaltBtn.addEventListener("click", async () => {
      await api("/api/admin/cancel", {
        method: "POST",
        body: JSON.stringify({ sessionId: s.id, cancelled: !s.cancelled }),
      });
      refreshTerminCard(s.id);
    });
  }

  card.querySelectorAll(".select-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/admin/select", {
        method: "POST",
        body: JSON.stringify({
          sessionId: s.id,
          playerId: Number(btn.dataset.player),
          selected: btn.dataset.selected !== "1",
        }),
      });
      refreshTerminCard(s.id);
    });
  });

  card.querySelectorAll(".check-box-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const order = ["offen", "spielt", "nicht"];
      const next = order[(order.indexOf(btn.dataset.status) + 1) % order.length];
      await api("/api/admin/rsvp", {
        method: "POST",
        body: JSON.stringify({
          sessionId: s.id,
          playerId: Number(btn.dataset.player),
          status: next,
        }),
      });
      refreshTerminCard(s.id);
    });
  });
}

// Lädt nur die Daten EINES Termins neu und tauscht nur dessen Karte aus —
// keine komplette Seiten-Neuladung, also auch kein Scroll-Sprung.
async function refreshTerminCard(sessionId) {
  const data = await api("/api/admin/sessions");
  if (data.error) return;
  const s = data.sessions.find((x) => x.id === sessionId);
  if (!s) return;
  const oldCard = document.querySelector(`.admin-termin[data-session-id="${sessionId}"]`);
  if (!oldCard) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = adminTerminHtml(s).trim();
  const newCard = wrapper.firstElementChild;
  oldCard.replaceWith(newCard);
  wireTerminCard(newCard, s);
}

function verlaufItemHtml(item) {
  return `
    <div class="verlauf-item">
      <div class="verlauf-text">
        <strong>${escapeHtml(item.actor)}</strong> ${escapeHtml(item.action)}${
    item.sessionDate ? ` <span class="verlauf-termin">(${fmtWeekday(item.sessionDate)} ${fmtDate(item.sessionDate)})</span>` : ""
  }
      </div>
      <div class="verlauf-zeit">${fmtDateTime(item.createdAt)}</div>
    </div>
  `;
}

function adminTerminHtml(s) {
  const spieltCount = s.players.filter((p) => p.status === "spielt").length;
  const ueberbucht = spieltCount > 5; // orange: mehr als 5, Admin wählt aus
  return `
    <div class="admin-termin" data-session-id="${s.id}">
      <div class="kopf">
        <strong>${fmtWeekday(s.date)}, ${fmtDate(s.date)}</strong>
        <div>
          <span class="pill" data-flag="${s.flag}">${FLAG_LABEL[s.flag]}</span>
          <button class="abschalt-btn" data-session="${s.id}" data-cancelled="${s.cancelled ? 1 : 0}">
            ${s.cancelled ? "reaktivieren" : "absagen"}
          </button>
        </div>
      </div>
      ${s.players
        .map(
          (p) => `
        <div class="spieler-row">
          <span><button class="check-box-btn" data-status="${p.status}" data-session="${s.id}" data-player="${p.playerId}" aria-label="Status von ${p.name} ändern"></button>${p.name}</span>
          <span>
            <span class="status-tag" data-status="${p.status}">${p.status}</span>
            ${
              ueberbucht && p.status === "spielt"
                ? `<button class="select-toggle ${p.selected ? "active" : ""}" data-session="${s.id}" data-player="${p.playerId}" data-selected="${p.selected ? 1 : 0}">dabei</button>`
                : ""
            }
          </span>
        </div>`
        )
        .join("")}
    </div>
  `;
}

// ---------- Router ----------

function route() {
  if (!TOKEN) {
    app.innerHTML = `<p class="error">Kein gültiger Zugangslink. Bitte über den persönlichen Link öffnen.</p>`;
    return;
  }
  const hash = location.hash;
  if (hash === "#admin") renderAdmin();
  else if (hash === "#stats") renderStats();
  else if (hash.startsWith("#s/")) renderSessionDetail(Number(hash.slice(3)));
  else renderPlayer();
}

window.addEventListener("hashchange", route);
route();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
