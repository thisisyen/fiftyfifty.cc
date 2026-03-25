/**
 * Cloudflare Worker — api.fiftyfifty.cc
 * Proxies Notion, GitHub, and market data APIs.
 * Secrets set in Cloudflare dashboard: NOTION_TOKEN, GITHUB_TOKEN, API_KEY
 */

const NOTION_BASE  = "https://api.notion.com/v1";
const GITHUB_BASE  = "https://api.github.com";
const GITHUB_OWNER = "thisisyen";
const GITHUB_REPO  = "fiftyfifty.cc";
const NOTION_DB_MYTASKS    = "32acc8b4-7d6c-80aa-be0f-e148d71d2fd8";
const NOTION_DB_RELOCATION = "1ebd620b-2069-41c2-815e-62f1e981565d";

const CORS = {
  "Access-Control-Allow-Origin":  "https://fiftyfifty.cc",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
  "Vary": "Origin",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Auth check
    const key = request.headers.get("X-API-Key");
    if (key !== env.API_KEY) {
      return json({ error: "Unauthorized" }, 401);
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/notion/tasks")      return await getNotionTasks(env);
      if (path === "/notion/relocation") return await getNotionRelocation(env);
      if (path === "/github/runs")       return await getWorkflowRuns(env);
      if (path === "/github/trigger" && request.method === "POST")
                                          return await triggerWorkflow(request, env);
      if (path === "/market")            return await getMarketData();
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};

// ── Notion: My Tasks ──────────────────────────────────────────────────────────

async function getNotionTasks(env) {
  const data = await notionQuery(NOTION_DB_MYTASKS, env.NOTION_TOKEN, {});
  const tasks = data.results.map(row => {
    const props = row.properties;
    return {
      id:     row.id,
      title:  titleProp(props),
      status: selectOrStatus(props, "Status") || selectOrStatus(props, "State"),
      due:    dateProp(props, "Due") || dateProp(props, "Due date") || dateProp(props, "Date"),
    };
  });
  return json({ tasks });
}

// ── Notion: Relocation Tasks ──────────────────────────────────────────────────

async function getNotionRelocation(env) {
  const data = await notionQuery(NOTION_DB_RELOCATION, env.NOTION_TOKEN, {
    filter: {
      property: "Status",
      select: { does_not_equal: "Done" }
    },
    sorts: [{ property: "Due Date", direction: "ascending" }]
  });

  const tasks = data.results
    .filter(row => selectOrStatus(row.properties, "Status") !== "Blocked")
    .map(row => {
      const props = row.properties;
      return {
        id:       row.id,
        task:     titleProp(props),
        status:   selectOrStatus(props, "Status"),
        priority: selectOrStatus(props, "Priority"),
        track:    selectOrStatus(props, "Track"),
        due:      dateProp(props, "Due Date"),
      };
    });
  return json({ tasks });
}

// ── GitHub: Workflow runs ─────────────────────────────────────────────────────

async function getWorkflowRuns(env) {
  const workflows = ["morning-feed.yml", "sync-back.yml", "daily-briefing.yml"];
  const results = await Promise.all(workflows.map(async wf => {
    const r = await fetch(
      `${GITHUB_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${wf}/runs?per_page=1`,
      { headers: ghHeaders(env), signal: AbortSignal.timeout(10_000) }
    );
    const data = await r.json();
    const run  = data.workflow_runs?.[0];
    return {
      workflow: wf.replace(".yml", ""),
      status:   run?.status   || "unknown",
      conclusion: run?.conclusion || null,
      ran_at:   run?.updated_at || null,
    };
  }));
  return json({ runs: results });
}

// ── GitHub: Trigger workflow ──────────────────────────────────────────────────

async function triggerWorkflow(request, env) {
  const body = await request.json().catch(() => ({}));
  const workflow = body.workflow; // e.g. "morning-feed"

  const allowed = ["morning-feed", "sync-back", "daily-briefing"];
  if (!allowed.includes(workflow)) {
    return json({ error: "Unknown workflow" }, 400);
  }

  const r = await fetch(
    `${GITHUB_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflow}.yml/dispatches`,
    {
      method: "POST",
      headers: { ...ghHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (r.status === 204) {
    return json({ ok: true, triggered: workflow });
  }
  const err = await r.text();
  return json({ error: err }, r.status);
}

// ── Market data ───────────────────────────────────────────────────────────────

async function getMarketData() {
  const tickers = [
    { sym: "AAPL",  label: "AAPL" },
    { sym: "SOFI",  label: "SOFI" },
    { sym: "^GSPC", label: "S&P 500" },
    { sym: "^IXIC", label: "NASDAQ" },
    { sym: "^DJI",  label: "Dow" },
  ];

  const results = await Promise.all(tickers.map(async ({ sym, label }) => {
    try {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8_000) }
      );
      const data = await r.json();
      const meta   = data?.chart?.result?.[0]?.meta || {};
      const price  = meta.regularMarketPrice || 0;
      const prev   = meta.chartPreviousClose || price;
      const change = price - prev;
      const pct    = prev ? (change / prev * 100) : 0;
      return { sym, label, price, change: +change.toFixed(2), pct: +pct.toFixed(2) };
    } catch {
      return { sym, label, price: null, change: null, pct: null };
    }
  }));

  return json({ market: results });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function notionQuery(dbId, token, body, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const r = await fetch(`${NOTION_BASE}/databases/${dbId}/query`, {
      method: "POST",
      headers: {
        "Authorization":  `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type":   "application/json",
      },
      body: JSON.stringify({ page_size: 100, ...body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 429) {
      // Rate limited — back off and retry
      const retryAfter = parseInt(r.headers.get("Retry-After") || "1", 10);
      await new Promise(res => setTimeout(res, retryAfter * 1000));
      continue;
    }
    if (!r.ok) throw new Error(`Notion error ${r.status}`);
    return r.json();
  }
  throw new Error("Notion rate limit: max retries exceeded");
}

function ghHeaders(env) {
  return {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept":        "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent":    "fiftyfifty-worker/1.0",
  };
}

function titleProp(props) {
  for (const v of Object.values(props)) {
    if (v.type === "title") {
      return v.title?.map(t => t.plain_text).join("") || "";
    }
  }
  return "";
}

function selectOrStatus(props, key) {
  const p = props[key];
  if (!p) return null;
  if (p.type === "select")  return p.select?.name  || null;
  if (p.type === "status")  return p.status?.name  || null;
  return null;
}

function dateProp(props, key) {
  const p = props[key];
  if (!p || p.type !== "date") return null;
  return p.date?.start || null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
