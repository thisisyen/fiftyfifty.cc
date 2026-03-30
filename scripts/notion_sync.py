"""
notion_sync.py
Sync-back: finds completed (Relocation) items in My Tasks and mirrors
Done status back to source entries in Relocation Tasks.
Runs every 30 min on weekdays via GitHub Actions.
"""

import os
import sys
import requests
from datetime import datetime

NOTION_TOKEN  = os.environ["NOTION_TOKEN"]
RELOCATION_DB = "1ebd620b-2069-41c2-815e-62f1e981565d"
MYTASKS_DB    = "32acc8b4-7d6c-80aa-be0f-e148d71d2fd8"
TAG_SUFFIX    = " (Relocation)"

# My Tasks properties (confirmed)
MY_TITLE  = "Task name"
MY_STATUS = "Status"   # type: status

# Relocation Tasks properties (confirmed)
REL_TITLE  = "Task"
REL_STATUS = "Status"  # type: select — options: Blocked, In Progress, Up Next, Backlog, Done

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

def notion_post(path, body):
    r = requests.post(f"https://api.notion.com/v1{path}", headers=HEADERS, json=body)
    r.raise_for_status()
    return r.json()

def notion_patch(path, body):
    r = requests.patch(f"https://api.notion.com/v1{path}", headers=HEADERS, json=body)
    r.raise_for_status()
    return r.json()

def query_database(db_id, filters=None):
    body = {"page_size": 100}
    if filters: body["filter"] = filters
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
    return None

def set_relocation_status(page_id, status):
    # Relocation Tasks uses select type for Status
    notion_patch(f"/pages/{page_id}", {
        "properties": {
            REL_STATUS: {"select": {"name": status}}
        }
    })

def main():
    print(f"[{datetime.now().isoformat()}] Running sync-back")

    # All My Tasks entries tagged (Relocation)
    all_my = query_database(MYTASKS_DB)
    tagged = []
    for row in all_my:
        title  = prop_value(row, MY_TITLE) or ""
        status = prop_value(row, MY_STATUS) or ""
        if TAG_SUFFIX in title:
            tagged.append({
                "id":        row["id"],
                "base_name": title.replace(TAG_SUFFIX, "").strip(),
                "status":    status,
            })

    if not tagged:
        print("No (Relocation) items in My Tasks.")
        return

    # Index relocation tasks by name
    rel_rows = query_database(RELOCATION_DB)
    rel_index = {}
    for row in rel_rows:
        name = (prop_value(row, REL_TITLE) or "").strip()
        rel_index[name] = row

    synced, warnings = [], []

    for item in tagged:
        base   = item["base_name"]
        status = item["status"]

        # Lookup (case-insensitive fallback)
        rel = rel_index.get(base)
        if not rel:
            matches = [r for n, r in rel_index.items() if n.lower() == base.lower()]
            if len(matches) == 1:
                rel = matches[0]
            elif len(matches) > 1:
                warnings.append(f"Ambiguous: '{base}'")
                continue
            else:
                warnings.append(f"No match: '{base}'")
                continue

        rel_status = prop_value(rel, REL_STATUS)
        rel_id     = rel["id"]

        # My Tasks status type groups: "Done" → sync Done to relocation
        if status.lower() == "done" and rel_status != "Done":
            try:
                set_relocation_status(rel_id, "Done")
                synced.append(f"Done: {base}")
                print(f"  ✓ Done: {base}")
            except Exception as e:
                warnings.append(f"Failed '{base}': {e}")

        # "In progress" in My Tasks → In Progress in Relocation
        elif "progress" in status.lower() and rel_status in ("Backlog", "Up Next"):
            try:
                set_relocation_status(rel_id, "In Progress")
                synced.append(f"In Progress: {base}")
                print(f"  → In Progress: {base}")
            except Exception as e:
                warnings.append(f"Failed '{base}': {e}")

    print(f"\n{len(synced)} synced, {len(warnings)} warnings.")
    for w in warnings:
        print(f"  ! {w}", file=sys.stderr)

if __name__ == "__main__":
    main()
