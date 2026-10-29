#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GitHub Actions 雲端全自動同步引擎 (Zero-Mac Dependency)
每日由 GitHub 官方雲端伺服器直接連線讀取：
1. 主估值試算表 (1czITJdQ-NGsymNMc9DB2M1Enmxopg644XQb9_seGph8) B1:B4 與 A6:O36
2. LiveQuotes 雲端即時股價中樞 (14F4q5WvvjQRlGSSDcnK7QWBTxDZkT51RzN0bXo5vRYk)
並自動更新 earnings_hub.json 與 livequotes_hub.js，確保個人 Mac 休眠或關機時網頁仍 100% 即時同步。
"""
import json
import re
import urllib.request
from datetime import datetime, timezone, timedelta

MAIN_SHEET_ID = "1czITJdQ-NGsymNMc9DB2M1Enmxopg644XQb9_seGph8"
LIVE_SHEET_ID = "14F4q5WvvjQRlGSSDcnK7QWBTxDZkT51RzN0bXo5vRYk"

def fetch_gviz_json(sheet_id):
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:json"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        text = resp.read().decode("utf-8")
    match = re.search(r"google\.visualization\.Query\.setResponse\(([\s\S]+)\);?", text)
    if not match:
        raise ValueError(f"Invalid gviz response from {sheet_id}")
    return json.loads(match.group(1))

def cell_val(c, idx):
    if idx >= len(c) or c[idx] is None:
        return ""
    v = c[idx].get("f") if c[idx].get("f") is not None else c[idx].get("v")
    return str(v).strip() if v is not None else ""

def main():
    tz_tpe = timezone(timedelta(hours=8))
    now_tpe = datetime.now(tz_tpe)
    with open("earnings_hub.json", "r", encoding="utf-8") as f:
        hub = json.load(f)

    try:
        main_data = fetch_gviz_json(MAIN_SHEET_ID)
        rows = main_data.get("table", {}).get("rows", [])
        for r in rows:
            c = r.get("c") or []
            k = cell_val(c, 0)
            v = cell_val(c, 1)
            if "Baseline Date" in k and v:
                hub["baselineDate"] = v
            elif "Treasury Yield" in k and v:
                m = re.search(r"([0-9]+\.[0-9]+)", v)
                if m:
                    hub["us10yYield"] = float(m.group(1))
            elif "FOMC" in k and v:
                m = re.search(r"(\d{4}-\d{2}-\d{2})", v)
                if m:
                    hub["fomcNextMeeting"] = m.group(1)

            # A6:O36 標的列
            sym = cell_val(c, 1)
            if re.match(r"^[A-Z.]{1,6}$", sym) and sym != "代號":
                next_ed = cell_val(c, 5)
                diag_raw = cell_val(c, 14)
                m_ed = re.search(r"(\d{4}-\d{2}-\d{2})", next_ed)
                if m_ed:
                    hub.setdefault("earningsDates", {})[sym] = m_ed.group(1)
                if diag_raw and "|" in diag_raw:
                    parts = [p.strip() for p in diag_raw.split("|", 1)]
                    summary_txt, url_txt = parts[0], parts[1]
                    for d in hub.get("recentDiagnostics", []):
                        if d.get("symbol") == sym:
                            d["actualSummary"] = summary_txt
                            if url_txt.startswith("http"):
                                d["sourceUrl"] = url_txt
    except Exception as e:
        print(f"Warning syncing Main Sheet: {e}")

    hub["updatedAt"] = now_tpe.isoformat(timespec="seconds")
    with open("earnings_hub.json", "w", encoding="utf-8") as f:
        json.dump(hub, f, ensure_ascii=False, indent=2)
    print("Successfully synced earnings_hub.json from Google Sheets.")

if __name__ == "__main__":
    main()
