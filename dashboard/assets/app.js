/**
 * 5050 Dashboard — app.js
 * Fetches data from api.fiftyfifty.cc (Cloudflare Worker) and renders the UI.
 * API key is stored in localStorage under "ff_api_key" (set on first visit).
 */

const API_BASE = "https://api.fiftyfifty.cc";

// ── API key ───────────────────────────────────────────────────────────────────

function getApiKey() {
  let key = localStorage.getItem("ff_api_key");
  if (!key) {
    key = prompt("Enter dashboard API key:");
    if (key) localStorage.setItem("ff_api_key", key);
  }
  return key;
}

function resetApiKey() {
  localStorage.removeItem("ff_api_key");
  const key = prompt("Enter new API key:");
  if (key) {
    localStorage.setItem("ff_api_key", key);
    location.reload();
  }
}

async function apiFetch(path, opts = {}) {
  const key = getApiKey();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "X-API-Key": key, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ── Date label ────────────────────────────────────────────────────────────────

function setDateLabel() {
  const el = document.getElementById("header-date");
  if (el) {
    el.textContent = new Date().toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric"
    });
  }
}

// ── Status indicator ──────────────────────────────────────────────────────────

function setStatus(ok) {
  const el = document.getElementById("header-status");
  if (!el) return;
  el.className = "header-status " + (ok ? "ok" : "err");
  el.textContent = ok ? "connected" : "offline";
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

function formatIsoDate(iso) {
  // "2026-03-23" → "03.23.2026"
  const [y, m, d] = iso.split("-");
  return `${m}.${d}.${y}`;
}

function taskBadge(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("progress"))                         return ["badge-in-progress", "in progress"];
  if (s.includes("blocked"))                          return ["badge-blocked", "blocked"];
  if (s.includes("done") || s.includes("complete"))  return ["badge-done", "done"];
  return ["badge-not-started", s || "not started"];
}

async function loadTasks() {
  const container = document.getElementById("task-groups");
  try {
    const { tasks } = await apiFetch("/notion/tasks");
    setStatus(true);

    const today = new Date().toISOString().slice(0, 10);
    const done  = ["done", "complete", "completed"];
    const open  = tasks.filter(t => !done.some(d => (t.status || "").toLowerCase().includes(d)));

    if (!open.length) {
      container.innerHTML = `<div class="muted-text">No open tasks.</div>`;
      return;
    }

    // Group by due date (ISO), sort dates ascending
    const byDate = {};
    for (const t of open) {
      const key = t.due || "no date";
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(t);
    }

    const sortedDates = Object.keys(byDate).sort((a, b) => {
      if (a === "no date") return 1;
      if (b === "no date") return -1;
      return a < b ? -1 : 1;
    });

    container.innerHTML = sortedDates.map(dateKey => {
      const heading = dateKey === "no date" ? "no date" : formatIsoDate(dateKey);
      const items   = byDate[dateKey];

      return `
        <div class="date-group">
          <div class="date-heading">${heading}</div>
          ${items.map(t => {
            const s       = (t.status || "").toLowerCase();
            const checked = s.includes("progress") || s.includes("done") || s.includes("complete");
            const check   = checked ? "[X]" : "[ ]";
            const [cls, label] = taskBadge(t.status);
            const title   = (t.title || "").replace(" (Relocation)", "");
            return `
              <div class="task-row">
                <span class="task-check">${check}</span>
                <div class="task-body">
                  <div class="task-name">${title}</div>
                  <span class="task-badge ${cls}">${label}</span>
                </div>
              </div>`;
          }).join("")}
        </div>`;
    }).join("");

  } catch (e) {
    setStatus(false);
    container.innerHTML = `<div class="muted-text">Could not load tasks: ${e.message}</div>`;
  }
}

// ── Relocation ────────────────────────────────────────────────────────────────

const TRACK_COLORS = {
  "Visa & Immigration":   "#a78bfa",
  "Housing":              "#fb923c",
  "Finances & Banking":   "#4ade80",
  "Tax & Legal":          "#facc15",
  "Logistics & Shipping": "#60a5fa",
  "Family & School":      "#f472b6",
  "Employment & EOR":     "#94a3b8",
  "Home Sale":            "#fbbf24",
};

function relDueLabel(due) {
  if (!due) return "";
  const today = new Date().toISOString().slice(0, 10);
  const week  = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  if (due < today)  return `<span class="track-task-due late">${formatIsoDate(due)}</span>`;
  if (due <= week)  return `<span class="track-task-due soon">${formatIsoDate(due)}</span>`;
  return `<span class="track-task-due">${formatIsoDate(due)}</span>`;
}

async function loadRelocation() {
  const container = document.getElementById("track-grid");
  try {
    const { tasks } = await apiFetch("/notion/relocation");

    const byTrack = {};
    for (const t of tasks) {
      const track = t.track || "Other";
      if (!byTrack[track]) byTrack[track] = [];
      byTrack[track].push(t);
    }

    if (!Object.keys(byTrack).length) {
      container.innerHTML = `<div class="muted-text">No open relocation tasks.</div>`;
      return;
    }

    container.innerHTML = Object.entries(byTrack).map(([track, items]) => {
      const color = TRACK_COLORS[track] || "#888";
      return `
        <div class="track-card">
          <div class="track-name" style="color:${color}">${track}</div>
          <div class="track-tasks">
            ${items.map(t => `
              <div class="track-task">
                <span class="track-task-name">${t.task}</span>
                ${relDueLabel(t.due)}
              </div>`).join("") || `<div class="track-empty">All clear</div>`}
          </div>
        </div>`;
    }).join("");

  } catch (e) {
    container.innerHTML = `<div class="muted-text">Could not load: ${e.message}</div>`;
  }
}

// ── Market ────────────────────────────────────────────────────────────────────

async function loadMarket() {
  const container = document.getElementById("market-rows");
  const updatedEl = document.getElementById("market-updated");
  try {
    const { market } = await apiFetch("/market");

    if (updatedEl) {
      const now = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      updatedEl.textContent = `Last updated: ${now}`;
    }

    container.innerHTML = market.map(item => {
      const up      = (item.pct ?? 0) >= 0;
      const cls     = up ? "up" : "down";
      const isIndex = item.sym.startsWith("^");
      const price   = item.price != null
        ? (isIndex
            ? item.price.toLocaleString("en-US", { maximumFractionDigits: 0 })
            : `$${item.price.toFixed(2)}`)
        : "—";

      // Dollar change: use item.change if provided, otherwise compute from price × pct
      const changeDollar = item.change != null
        ? Math.abs(item.change)
        : (item.price != null && item.pct != null ? Math.abs(item.price * item.pct / 100) : null);

      const pillText = changeDollar != null
        ? `$${isIndex ? changeDollar.toFixed(0) : changeDollar.toFixed(2)}`
        : "—";

      const pctText = item.pct != null
        ? `${Math.abs(item.pct).toFixed(0)}%`
        : "—";

      return `
        <div class="market-row">
          <span class="market-ticker">${item.label}</span>
          <span class="market-price">${price}</span>
          <span class="market-pill ${cls}">${pillText}</span>
          <span class="market-pct ${cls}">${pctText}</span>
        </div>`;
    }).join("");

  } catch (e) {
    container.innerHTML = `<div class="muted-text">Could not load: ${e.message}</div>`;
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function loadWorkflowStatus() {
  try {
    const { runs } = await apiFetch("/github/runs");
    runs.forEach(run => {
      const el = document.getElementById(`status-${run.workflow}`);
      if (!el) return;
      const when    = run.ran_at ? new Date(run.ran_at).toLocaleString() : "never";
      const outcome = run.conclusion || run.status || "unknown";
      el.textContent = `Last run: ${when} · ${outcome}`;
    });
  } catch (_) {}
}

function initActions() {
  document.querySelectorAll(".btn[data-workflow]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const workflow = btn.dataset.workflow;
      btn.disabled = true;
      btn.classList.add("running");
      btn.textContent = "…";

      try {
        await apiFetch("/github/trigger", {
          method: "POST",
          body: JSON.stringify({ workflow }),
        });
        btn.classList.remove("running");
        btn.classList.add("done");
        btn.textContent = "done";
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove("done");
          btn.textContent = "run";
          loadWorkflowStatus();
        }, 4000);
      } catch (e) {
        btn.disabled = false;
        btn.classList.remove("running");
        btn.textContent = "err";
        setTimeout(() => { btn.textContent = "run"; }, 3000);
      }
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  setDateLabel();
  initActions();

  loadTasks();
  loadRelocation();
  loadMarket();
  loadWorkflowStatus();

  setInterval(() => {
    loadTasks();
    loadRelocation();
    loadMarket();
    loadWorkflowStatus();
  }, 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", init);
