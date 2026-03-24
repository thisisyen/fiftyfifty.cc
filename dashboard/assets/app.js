/**
 * 5050 Dashboard — app.js
 * Fetches data from api.fiftyfifty.cc (Cloudflare Worker) and renders the UI.
 * API key is stored in localStorage under "ff_api_key" (set on first visit).
 */

const API_BASE = "https://api.fiftyfifty.cc";

// ── API key prompt ────────────────────────────────────────────────────────────

function getApiKey() {
  let key = localStorage.getItem("ff_api_key");
  if (!key) {
    key = prompt("Enter dashboard API key:");
    if (key) localStorage.setItem("ff_api_key", key);
  }
  return key;
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

// ── Navigation ────────────────────────────────────────────────────────────────

function initNav() {
  document.querySelectorAll(".nav-item").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const panel = link.dataset.panel;
      document.querySelectorAll(".nav-item").forEach(l => l.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      link.classList.add("active");
      document.getElementById(`panel-${panel}`)?.classList.add("active");
    });
  });
}

// ── Date label ────────────────────────────────────────────────────────────────

function setDateLabel() {
  const label = document.getElementById("date-label");
  if (label) {
    label.textContent = new Date().toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric"
    });
  }
}

// ── Status indicator ──────────────────────────────────────────────────────────

function setStatus(ok) {
  const dot   = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  if (dot)   { dot.classList.toggle("ok", ok); dot.classList.toggle("err", !ok); }
  if (label) { label.textContent = ok ? "connected" : "offline"; }
}

// ── Tasks panel ───────────────────────────────────────────────────────────────

function dueBadge(due) {
  if (!due) return "";
  const today = new Date().toISOString().slice(0, 10);
  if (due < today) return `<span class="task-due overdue">${due} ⚠</span>`;
  if (due === today) return `<span class="task-due today">today</span>`;
  return `<span class="task-due">${due}</span>`;
}

function statusBadge(status) {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s.includes("progress"))  return `<span class="badge badge-blue">in progress</span>`;
  if (s.includes("blocked"))   return `<span class="badge badge-red">blocked</span>`;
  if (s.includes("done") || s.includes("complete")) return `<span class="badge badge-green">done</span>`;
  return `<span class="badge badge-gray">${status}</span>`;
}

async function loadTasks() {
  const container = document.getElementById("task-groups");
  try {
    const { tasks } = await apiFetch("/notion/tasks");
    setStatus(true);

    const today = new Date().toISOString().slice(0, 10);
    const done  = ["done", "complete", "completed"];

    const open   = tasks.filter(t => !done.some(d => (t.status||"").toLowerCase().includes(d)));
    const overdue  = open.filter(t => t.due && t.due < today);
    const dueToday = open.filter(t => t.due === today);
    const upcoming = open.filter(t => !t.due || t.due > today);

    if (!open.length) {
      container.innerHTML = `<div class="loading">No open tasks. Clean slate.</div>`;
      return;
    }

    const groups = [];

    if (overdue.length) {
      groups.push({ label: "Overdue", items: overdue });
    }
    if (dueToday.length) {
      groups.push({ label: "Due today", items: dueToday });
    }
    if (upcoming.length) {
      groups.push({ label: "Upcoming", items: upcoming });
    }

    container.innerHTML = groups.map(({ label, items }) => `
      <div class="task-group">
        <div class="task-group-label">${label}</div>
        <div class="task-list">
          ${items.map(t => {
            const isRelocation = (t.title || "").includes("(Relocation)");
            const displayTitle = (t.title || "").replace(" (Relocation)", "");
            return `
              <div class="task-item">
                <span class="task-title${isRelocation ? " relocation" : ""}">${displayTitle}</span>
                ${statusBadge(t.status)}
                ${dueBadge(t.due)}
              </div>`;
          }).join("")}
        </div>
      </div>
    `).join("");

  } catch (e) {
    setStatus(false);
    container.innerHTML = `<div class="loading">Could not load tasks: ${e.message}</div>`;
  }
}

// ── Relocation panel ──────────────────────────────────────────────────────────

const TRACK_COLORS = {
  "Visa & Immigration":  "#a78bfa",
  "Housing":             "#fb923c",
  "Finances & Banking":  "#4ade80",
  "Tax & Legal":         "#facc15",
  "Logistics & Shipping":"#60a5fa",
  "Family & School":     "#f472b6",
  "Employment & EOR":    "#94a3b8",
  "Home Sale":           "#fbbf24",
};

function relDueLabel(due) {
  if (!due) return "";
  const today = new Date().toISOString().slice(0, 10);
  const week  = new Date(Date.now() + 7*86400000).toISOString().slice(0, 10);
  if (due < today) return `<span class="track-task-due late">${due}</span>`;
  if (due <= week)  return `<span class="track-task-due soon">${due}</span>`;
  return `<span class="track-task-due">${due}</span>`;
}

async function loadRelocation() {
  const container = document.getElementById("track-grid");
  try {
    const { tasks } = await apiFetch("/notion/relocation");

    // Group by track
    const byTrack = {};
    for (const t of tasks) {
      const track = t.track || "Other";
      if (!byTrack[track]) byTrack[track] = [];
      byTrack[track].push(t);
    }

    if (!Object.keys(byTrack).length) {
      container.innerHTML = `<div class="loading">No open relocation tasks.</div>`;
      return;
    }

    container.innerHTML = Object.entries(byTrack).map(([track, items]) => {
      const color = TRACK_COLORS[track] || "#888";
      return `
        <div class="track-card">
          <div class="track-name" style="color:${color}">${track}</div>
          <div class="track-tasks">
            ${items.length ? items.map(t => `
              <div class="track-task">
                <span class="track-task-name">${t.task}</span>
                ${relDueLabel(t.due)}
              </div>`).join("") : `<div class="track-empty">All clear</div>`}
          </div>
        </div>`;
    }).join("");

  } catch (e) {
    container.innerHTML = `<div class="loading">Could not load relocation tasks: ${e.message}</div>`;
  }
}

// ── Market panel ──────────────────────────────────────────────────────────────

async function loadMarket() {
  const container = document.getElementById("market-grid");
  try {
    const { market } = await apiFetch("/market");

    container.innerHTML = market.map(item => {
      const up      = item.pct >= 0;
      const arrow   = up ? "↑" : "↓";
      const cls     = up ? "up" : "down";
      const isIndex = item.sym.startsWith("^");
      const price   = item.price != null
        ? (isIndex ? item.price.toLocaleString("en-US", {maximumFractionDigits: 0})
                   : `$${item.price.toFixed(2)}`)
        : "—";
      const change  = item.pct != null
        ? `${arrow} ${Math.abs(item.pct).toFixed(2)}%`
        : "unavailable";

      return `
        <div class="market-card">
          <div class="market-label">${item.label}</div>
          <div class="market-price">${price}</div>
          <div class="market-change ${cls}">${change}</div>
        </div>`;
    }).join("");

  } catch (e) {
    container.innerHTML = `<div class="loading">Could not load market data: ${e.message}</div>`;
  }
}

// ── Actions panel ─────────────────────────────────────────────────────────────

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
      btn.textContent = "Triggering…";

      try {
        await apiFetch("/github/trigger", {
          method: "POST",
          body: JSON.stringify({ workflow }),
        });
        btn.classList.remove("running");
        btn.classList.add("done");
        btn.textContent = "Triggered ✓";
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove("done");
          btn.textContent = "Run now";
          loadWorkflowStatus();
        }, 4000);
      } catch (e) {
        btn.disabled = false;
        btn.classList.remove("running");
        btn.textContent = "Failed — retry";
        setTimeout(() => { btn.textContent = "Run now"; }, 3000);
      }
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  initNav();
  setDateLabel();
  initActions();

  // Load all data in parallel
  loadTasks();
  loadRelocation();
  loadMarket();
  loadWorkflowStatus();

  // Refresh every 5 minutes
  setInterval(() => {
    loadTasks();
    loadRelocation();
    loadMarket();
    loadWorkflowStatus();
  }, 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", init);
