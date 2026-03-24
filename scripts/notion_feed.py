"""
notion_feed.py
Morning task feed: pulls today-due and upcoming relocation tasks
into "My Tasks" Notion database. Runs at 6:45 AM PDT weekdays via GitHub Actions.
"""

import os
import sys
import requests
from datetime import date, datetime, timedelta

NOTION_TOKEN  = os.environ["NOTION_TOKEN"]
RELOCATION_DB = "1ebd620b-2069-41c2-815e-62f1e981565d"
MYTASKS_DB    = "4597933c-8e09-4223-860f-928d305e7706"
YEN_USER_ID   = "32ad872b-594c-8125-86f4-00021483a30d"
TAG_SUFFIX    = " (Relocation)"
TARGET_MINUTES = 150  # ~2.5 hours

# Relocation Tasks properties (confirmed)
REL_TITLE  = "Task"
REL_STATUS = "Status"
REL_PRIORITY = "Priority"
REL_DUE    = "Due Date"
REL_TRACK  = "Track"
REL_NOTES  = "Notes"

# My Tasks properties (confirmed)
MY_TITLE    = "Task name"
MY_STATUS   = "Status"   # type: status — groups: To-do, In progress, Done
MY_DUE      = "Due"
MY_ASSIGNEE = "Assignee"
MY_SOURCE   = "Source"

TRACK_MINUTES = {
    "Visa & Immigration":   60,
    "Housing":              45,
    "Finances & Banking":   30,
    "Tax & Legal":          45,
    "Logistics & Shipping": 30,
    "Family & School":      30,
    "Employment & EOR":     45,
    "Home Sale":            30,
}

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

def notion_post(path, body):
    r = requests.post(f"https://api.notion.com/v1{path}", headers=HEADERS, json=body)
    r.raise_for_status()
    return r.json()

def query_database(db_id, filters=None, sorts=None):
    body = {"page_size": 100}
    if filters: body["filter"] = filters
    if sorts:   body["sorts"] = sorts
    results = []
    while True:
        data = notion_post(f"/databases/{db_id}/query", body)
        results.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        body["start_cursor"] = data["next_cursor"]
    return results

def prop_value(page, key):
    prop = page.get("properties", {}).get(key, {})
    t = prop.get("type")
    if t == "title":
        return "".join(p.get("plain_text", "") for p in prop.get("title", []))
    if t == "select":
        s = prop.get("select"); return s.get("name") if s else None
    if t == "status":
        s = prop.get("status"); return s.get("name") if s else None
    if t == "date":
        d = prop.get("date"); return d.get("start") if d else None
    if t == "rich_text":
        return "".join(p.get("plain_text", "") for p in prop.get("rich_text", []))
    return None

def fetch_existing_mytasks():
    """Return set of base task names already in My Tasks (tagged, not done)."""
    rows = query_database(MYTASKS_DB)
    existing = {}
    for row in rows:
        title  = prop_value(row, MY_TITLE) or ""
        status = prop_value(row, MY_STATUS) or ""
        if TAG_SUFFIX in title and status.lower() not in ("done",):
            base = title.replace(TAG_SUFFIX, "").strip()
            existing[base] = row["id"]
    return existing

def classify(row, today_str, week_str):
    name     = prop_value(row, REL_TITLE) or "(unnamed)"
    status   = prop_value(row, REL_STATUS) or ""
    priority = prop_value(row, REL_PRIORITY) or "Low"
    due      = prop_value(row, REL_DUE)
    track    = prop_value(row, REL_TRACK) or ""
    notes    = prop_value(row, REL_NOTES) or ""

    if status == "Blocked":
        return "blocked", name, track, due, priority, notes

    urgent = status == "In Progress" or (due and due <= today_str)
    upcoming = due and today_str < due <= week_str and priority in ("High", "Medium")

    cat = "urgent" if urgent else ("upcoming" if upcoming else "backlog")
    return cat, name, track, due, priority, notes

def create_mytask(name, track, due, priority, notes):
    note_text = f"Track: {track} | Priority: {priority} | Source: Relocation Tasks"
    if notes:
        note_text += f"\n{notes}"

    properties = {
        MY_TITLE: {
            "title": [{"type": "text", "text": {"content": name + TAG_SUFFIX}}]
        },
        MY_ASSIGNEE: {
            "people": [{"object": "user", "id": YEN_USER_ID}]
        },
    }
    if due:
        properties[MY_DUE] = {"date": {"start": due}}
    # Source field — try as rich_text, gracefully skip if type differs
    properties[MY_SOURCE] = {
        "rich_text": [{"type": "text", "text": {"content": "Relocation"}}]
    }

    return notion_post("/pages", {
        "parent": {"database_id": MYTASKS_DB},
        "properties": properties,
    })

def main():
    today     = date.today()
    today_str = today.isoformat()
    week_str  = (today + timedelta(days=7)).isoformat()

    print(f"[{datetime.now().isoformat()}] Morning task feed — {today_str}")

    existing = fetch_existing_mytasks()
    rows     = query_database(
        RELOCATION_DB,
        filters={"property": REL_STATUS, "select": {"does_not_equal": "Done"}},
        sorts=[{"property": REL_DUE, "direction": "ascending"}],
    )

    urgent, upcoming = [], []
    for row in rows:
        cat, *rest = classify(row, today_str, week_str)
        if cat == "urgent":   urgent.append(rest)
        elif cat == "upcoming": upcoming.append(rest)

    feed, used_min = [], 0

    for item in urgent:
        name, track, due, priority, notes = item
        if name not in existing:
            feed.append(item)
            used_min += TRACK_MINUTES.get(track, 30)

    for item in upcoming:
        if used_min >= TARGET_MINUTES:
            break
        name, track, due, priority, notes = item
        if name not in existing:
            feed.append(item)
            used_min += TRACK_MINUTES.get(track, 30)

    if not feed:
        print("No new tasks to add today.")
        return

    added = []
    for name, track, due, priority, notes in feed:
        try:
            create_mytask(name, track, due, priority, notes)
            added.append(name)
            print(f"  + {name} ({track}, ~{TRACK_MINUTES.get(track, 30)}min)")
        except Exception as e:
            print(f"  ! Failed '{name}': {e}", file=sys.stderr)

    print(f"\n{len(added)} tasks added, ~{used_min}min queued.")

if __name__ == "__main__":
    main()
