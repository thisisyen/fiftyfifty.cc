"""
daily_briefing.py
Sends a daily weekday morning briefing email to yen.lai@icloud.com.
Fetches: Notion tasks, Google Calendar (iCal), market data (Yahoo Finance).
Runs at 7:30 AM PDT weekdays via GitHub Actions.
"""

import os
import sys
import smtplib
import requests
from datetime import date, datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

try:
    from icalendar import Calendar
    import pytz
    HAS_ICAL = True
except ImportError:
    HAS_ICAL = False

# ── Secrets (set in GitHub Actions) ──────────────────────────────────────────
NOTION_TOKEN   = os.environ["NOTION_TOKEN"]
GMAIL_USER     = os.environ.get("GMAIL_USER", "letsgofiftyfifty@gmail.com")
GMAIL_APP_PASS = os.environ["GMAIL_APP_PASS"]
GCAL_ICAL_URL  = os.environ.get("GCAL_ICAL_URL", "")   # private iCal URL from Google Calendar
TO_EMAIL       = "yen.lai@icloud.com"

RELOCATION_DB = "1ebd620b-2069-41c2-815e-62f1e981565d"
MYTASKS_DB    = "4597933c-8e09-4223-860f-928d305e7706"
TAG_SUFFIX    = " (Relocation)"

NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

# ── Notion helpers ────────────────────────────────────────────────────────────

def query_database(db_id, filters=None):
    body = {"page_size": 50}
    if filters:
        body["filter"] = filters
    results = []
    while True:
        r = requests.post(
            f"https://api.notion.com/v1/databases/{db_id}/query",
            headers=NOTION_HEADERS, json=body
        )
        r.raise_for_status()
        data = r.json()
        results.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        body["start_cursor"] = data["next_cursor"]
    return results

def prop_value(page, key):
    prop = page.get("properties", {}).get(key, {})
    ptype = prop.get("type")
    if ptype == "title":
        return "".join(p.get("plain_text", "") for p in prop.get("title", []))
    if ptype in ("select", "status"):
        val = prop.get(ptype)
        return val.get("name") if val else None
    if ptype == "date":
        d = prop.get("date")
        return d.get("start") if d else None
    if ptype == "rich_text":
        return "".join(p.get("plain_text", "") for p in prop.get("rich_text", []))
    return None

# ── Task fetching ─────────────────────────────────────────────────────────────

def get_open_mytasks():
    rows = query_database(MYTASKS_DB)
    today_str = date.today().isoformat()
    tasks = {"today": [], "upcoming": [], "overdue": []}
    for row in rows:
        props = row.get("properties", {})
        # find title
        title = next(
            ("".join(p.get("plain_text","") for p in v.get("title",[]))
             for v in props.values() if v.get("type") == "title"), ""
        )
        status = next(
            (v.get(v["type"],{}).get("name","")
             for v in props.values() if v.get("type") in ("status","select")
             and v.get(v["type"],{}).get("name","").lower() not in ("done","complete","completed")), None
        )
        if status is None:  # already done
            continue
        due = next(
            (v["date"]["start"] for v in props.values()
             if v.get("type") == "date" and v.get("date")), None
        )
        if due and due < today_str:
            tasks["overdue"].append((title, due))
        elif due == today_str:
            tasks["today"].append((title, due))
        else:
            tasks["upcoming"].append((title, due))
    return tasks

# ── Calendar ──────────────────────────────────────────────────────────────────

def get_today_events():
    if not GCAL_ICAL_URL or not HAS_ICAL:
        return []
    try:
        r = requests.get(GCAL_ICAL_URL, timeout=10)
        r.raise_for_status()
        cal = Calendar.from_ical(r.content)
        today = date.today()
        tz = pytz.timezone("America/Los_Angeles")
        events = []
        for component in cal.walk():
            if component.name != "VEVENT":
                continue
            dtstart = component.get("DTSTART").dt
            dtend   = component.get("DTEND").dt
            summary = str(component.get("SUMMARY", "(no title)"))
            # normalize to date
            if isinstance(dtstart, datetime):
                dtstart_date = dtstart.astimezone(tz).date()
                time_str = dtstart.astimezone(tz).strftime("%-I:%M %p")
            else:
                dtstart_date = dtstart
                time_str = "all-day"
            if dtstart_date == today:
                events.append((time_str, summary))
        events.sort(key=lambda x: x[0])
        return events
    except Exception as e:
        return [("error", f"Could not fetch calendar: {e}")]

# ── Market data ───────────────────────────────────────────────────────────────

def get_quote(ticker):
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=2d"
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=8)
        data = r.json()
        meta = data["chart"]["result"][0]["meta"]
        price  = meta.get("regularMarketPrice", 0)
        prev   = meta.get("chartPreviousClose", price)
        change = price - prev
        pct    = (change / prev * 100) if prev else 0
        arrow  = "↑" if change >= 0 else "↓"
        return f"{ticker}: ${price:,.2f} {arrow}{abs(pct):.1f}%"
    except Exception as e:
        return f"{ticker}: unavailable"

def get_index(ticker, label):
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=2d"
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=8)
        data = r.json()
        meta = data["chart"]["result"][0]["meta"]
        price  = meta.get("regularMarketPrice", 0)
        prev   = meta.get("chartPreviousClose", price)
        change = price - prev
        pct    = (change / prev * 100) if prev else 0
        arrow  = "↑" if change >= 0 else "↓"
        return f"{label}: {arrow}{abs(pct):.2f}%"
    except:
        return f"{label}: unavailable"

# ── Email composition ─────────────────────────────────────────────────────────

def compose_email(events, tasks, quotes, indices):
    today_label = date.today().strftime("%A, %B %-d")
    lines = [f"Daily Briefing — {today_label}", ""]

    # Calendar
    lines.append("CALENDAR")
    if not events:
        lines.append("Clear today.")
    else:
        for time_str, summary in events:
            lines.append(f"  {time_str} — {summary}")
    lines.append("")

    # Tasks
    lines.append("TASKS")
    if tasks["overdue"]:
        lines.append("Overdue:")
        for title, due in tasks["overdue"]:
            lines.append(f"  [{due}] {title}")
    if tasks["today"]:
        lines.append("Due today:")
        for title, _ in tasks["today"]:
            lines.append(f"  {title}")
    if tasks["upcoming"]:
        lines.append("Up next:")
        for title, due in tasks["upcoming"][:5]:
            due_label = f" [{due}]" if due else ""
            lines.append(f"  {title}{due_label}")
    if not any(tasks.values()):
        lines.append("No open tasks.")
    lines.append("")

    # Markets
    lines.append("MARKETS (prev close)")
    lines.append("  " + " | ".join(indices))
    lines.append("  " + " | ".join(quotes))
    lines.append("")

    lines.append("— Claude")

    return "\n".join(lines)

def send_email(subject, body):
    msg = MIMEMultipart()
    msg["From"]    = GMAIL_USER
    msg["To"]      = TO_EMAIL
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(GMAIL_USER, GMAIL_APP_PASS)
        server.sendmail(GMAIL_USER, TO_EMAIL, msg.as_string())

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"[{datetime.now().isoformat()}] Running daily briefing")

    events  = get_today_events()
    tasks   = get_open_mytasks()
    quotes  = [get_quote("AAPL"), get_quote("SOFI")]
    indices = [
        get_index("^GSPC", "S&P 500"),
        get_index("^IXIC", "NASDAQ"),
        get_index("^DJI",  "Dow"),
    ]

    today_label = date.today().strftime("%A, %B %-d")
    subject = f"Daily Briefing — {today_label}"
    body    = compose_email(events, tasks, quotes, indices)

    send_email(subject, body)
    print(f"Sent to {TO_EMAIL}")

if __name__ == "__main__":
    main()
