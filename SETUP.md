# Setup Guide — fiftyfifty.cc

## Prerequisites
- GitHub account: thisisyen / org: Fiftyfifty
- Domain: fiftyfifty.cc (iCloud/IONOS)
- Cloudflare account (free tier)

---

## Step 1 — Cloudflare: Move DNS

1. Go to https://cloudflare.com → sign up (free)
2. Click "Add a site" → enter `fiftyfifty.cc`
3. Choose Free plan
4. Cloudflare scans your existing DNS. Click Continue.
5. Cloudflare gives you two nameservers, e.g.:
   - `duke.ns.cloudflare.com`
   - `uma.ns.cloudflare.com`
6. Go to iCloud.com → Account Settings → Domains → fiftyfifty.cc → DNS / Name Servers
7. Replace existing nameservers with the two Cloudflare gave you
8. Save. Propagation takes a few minutes to 24 hours.

---

## Step 2 — GitHub: Create repo and push code

1. Go to github.com/Fiftyfifty → New repository
2. Name it `fiftyfifty.cc`, set to Public, no README
3. In Terminal (on your Mac), run:

```bash
cd ~/Downloads  # or wherever this project folder is
cd fiftyfifty-project
git init
git add .
git commit -m "Initial build"
git branch -M main
git remote add origin https://github.com/Fiftyfifty/fiftyfifty.cc.git
git push -u origin main
```

4. On GitHub: Settings → Pages → Source: Deploy from branch → Branch: main → / (root) → Save
5. GitHub Pages will build. In a minute, check: https://Fiftyfifty.github.io/fiftyfifty.cc/dashboard

---

## Step 3 — GitHub: Add secrets

Settings → Secrets and variables → Actions → New repository secret

Add these secrets:

| Name | Value |
|------|-------|
| `NOTION_TOKEN` | Your Notion integration token (see below) |
| `GMAIL_APP_PASS` | Gmail app password (see below) |
| `GCAL_ICAL_URL` | Google Calendar private iCal URL (see below) |

### Get NOTION_TOKEN
1. Go to https://www.notion.so/my-integrations
2. New integration → name it "fiftyfifty-actions" → Submit
3. Copy the "Internal Integration Token"
4. In Notion: open each database (My tasks, Relocation Tasks) → ... menu → Add connections → fiftyfifty-actions

### Get GMAIL_APP_PASS
1. Go to myaccount.google.com (letsgofiftyfifty@gmail.com)
2. Security → 2-Step Verification (enable if not already)
3. Security → App passwords → Select app: Mail → Generate
4. Copy the 16-character password

### Get GCAL_ICAL_URL
1. Open Google Calendar → Settings → click your primary calendar
2. Scroll to "Secret address in iCal format"
3. Copy the full URL (starts with https://calendar.google.com/calendar/ical/...)

---

## Step 4 — Cloudflare: Point domain to GitHub Pages

In Cloudflare dashboard → fiftyfifty.cc → DNS:

Add these records:

| Type | Name | Content |
|------|------|---------|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | Fiftyfifty.github.io |

Set Proxy status to DNS only (gray cloud) for all of them.

Back in GitHub: Settings → Pages → Custom domain → enter `fiftyfifty.cc` → Save
Check "Enforce HTTPS" once it appears.

---

## Step 5 — Cloudflare Worker: Deploy API proxy

1. In Cloudflare dashboard → Workers & Pages → Create → Create Worker
2. Name it `fiftyfifty-api`
3. Click "Edit code" → paste contents of `worker/index.js` → Save and Deploy
4. Go to Settings → Variables → Add these secrets (use "Encrypt"):
   - `NOTION_TOKEN` — same as GitHub secret
   - `GITHUB_TOKEN` — GitHub personal access token (below)
   - `API_KEY` — make up a strong random password (you'll enter this on first dashboard visit)
5. Go to Settings → Triggers → Add Custom Domain → `api.fiftyfifty.cc`

### Get GITHUB_TOKEN
1. github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Generate new token:
   - Resource owner: Fiftyfifty (org)
   - Repository access: Only fiftyfifty.cc
   - Permissions: Actions → Read and write
3. Copy token → add as `GITHUB_TOKEN` in Cloudflare Worker settings

---

## Step 6 — Test

1. Visit https://fiftyfifty.cc/dashboard
2. Enter your API_KEY when prompted (it saves to localStorage)
3. Tasks, Relocation, Market, Actions panels should all load
4. Go to Actions → click "Run now" on Morning Feed to test end-to-end

---

## Cron schedule reference

| Job | Schedule | UTC cron |
|-----|----------|----------|
| Morning feed | 6:45 AM PDT | `45 13 * * 1-5` |
| Sync-back | Every 30 min | `*/30 * * * 1-5` |
| Daily briefing | 7:30 AM PDT | `30 14 * * 1-5` |

Note: After July 1 (Tokyo move), update crons for JST (UTC+9):
- 6:45 AM JST = `45 21 * * 0-4` (previous day UTC)
- 7:30 AM JST = `30 22 * * 0-4`

---

## File reference

```
fiftyfifty-project/
├── index.html               Photography site root (placeholder)
├── CNAME                    Custom domain for GitHub Pages
├── dashboard/
│   ├── index.html           Dashboard UI (fiftyfifty.cc/dashboard)
│   └── assets/
│       ├── style.css        Dashboard styles
│       └── app.js           Dashboard logic
├── scripts/
│   ├── notion_feed.py       Morning task feed
│   ├── notion_sync.py       Sync-back to Relocation Tasks
│   ├── daily_briefing.py    Email briefing
│   └── requirements.txt     Python deps
├── worker/
│   ├── index.js             Cloudflare Worker (API proxy)
│   └── wrangler.toml        Worker config
└── .github/workflows/
    ├── morning-feed.yml
    ├── sync-back.yml
    └── daily-briefing.yml
```
