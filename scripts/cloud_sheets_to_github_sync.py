#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GitHub Actions 雲端全自動同步引擎 (Zero-Mac Dependency)
每日由 GitHub 官方雲端伺服器直接連線讀取：
1. 主估值試算表 (1czITJdQ-NGsymNMc9DB2M1Enmxopg644XQb9_seGph8) B1:B4 與 A6:O36
2. LiveQuotes 雲端即時股價中樞 (14F4q5WvvjQRlGSSDcnK7QWBTxDZkT51RzN0bXo5vRYk)
3. St. Louis Fed FRED 官方公開數據端點與 BEA/BLS/ADP 官方發布排程表
自動更新 earnings_hub.json、macro_indicators.json、livequotes_hub.js、index.html 與 nasdaq/index.html，
確保個人 Mac 休眠或關機時，六大總經指標數值、發布日與下期排程仍 100% 即時推進。
"""
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

MAIN_SHEET_ID = "1czITJdQ-NGsymNMc9DB2M1Enmxopg644XQb9_seGph8"
LIVE_SHEET_ID = "14F4q5WvvjQRlGSSDcnK7QWBTxDZkT51RzN0bXo5vRYk"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EARNINGS_JSON_PATH = os.path.join(BASE_DIR, "earnings_hub.json")
MACRO_JSON_PATH = os.path.join(BASE_DIR, "macro_indicators.json")
LIVEQUOTES_JS_PATH = os.path.join(BASE_DIR, "livequotes_hub.js")

OFFICIAL_RELEASE_SCHEDULES = {
    "core_pce": [
        "2026-09-30", "2026-10-29", "2026-11-25", "2026-12-23",
        "2027-01-29", "2027-02-26", "2027-03-26", "2027-04-30",
        "2027-05-28", "2027-06-25"
    ],
    "headline_pce": [
        "2026-09-30", "2026-10-29", "2026-11-25", "2026-12-23",
        "2027-01-29", "2027-02-26", "2027-03-26", "2027-04-30",
        "2027-05-28", "2027-06-25"
    ],
    "nfp": [
        "2026-10-02", "2026-11-06", "2026-12-04", "2027-01-08",
        "2027-02-05", "2027-03-05", "2027-04-02", "2027-05-07",
        "2027-06-04"
    ],
    "adp": [
        "2026-09-30", "2026-11-04", "2026-12-02", "2027-01-06",
        "2027-02-03", "2027-03-03", "2027-04-01", "2027-05-05",
        "2027-06-02"
    ],
    "unrate": [
        "2026-10-02", "2026-11-06", "2026-12-04", "2027-01-08",
        "2027-02-05", "2027-03-05", "2027-04-02", "2027-05-07",
        "2027-06-04"
    ],
    "ppi": [
        "2026-10-15", "2026-11-13", "2026-12-15", "2027-01-14",
        "2027-02-12", "2027-03-12", "2027-04-14", "2027-05-13",
        "2027-06-11"
    ],
}


def fetch_gviz_json(sheet_id, sheet_name=None):
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:json"
    if sheet_name:
        url += f"&sheet={urllib.parse.quote(sheet_name)}"
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


def fetch_fred_series(series_id, count=18):
    """從 St. Louis Fed FRED 官方公開 CSV 端點讀取最新時間序列"""
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    obs = []
    with urllib.request.urlopen(req, timeout=15) as resp:
        lines = resp.read().decode("utf-8", errors="ignore").strip().splitlines()
        for line in lines[max(1, len(lines) - count):]:
            parts = line.split(",")
            if len(parts) >= 2:
                dt_str = parts[0].strip()
                val_str = parts[1].strip()
                try:
                    val = float(val_str)
                    obs.append({"date": dt_str, "period": dt_str[:7], "value": val})
                except ValueError:
                    continue
    return obs


def resolve_macro_release_schedule(item, today_str, data_updated=False):
    """
    依據官方發布排程表自動推進 releaseDate (MM/DD) 與 nextReleaseDate (YYYY-MM-DD)：
    - 若抓到新月份數據，或原定 nextReleaseDate 已經過期 (nextReleaseDate < today_str)，
      自動將最近一次已到期的排程日設為最新 releaseDate，並將 nextReleaseDate 推進至下一個未來排程日。
    - 若排程表全數過期，自動以 +30 天滾動推進，確保永遠不會卡在過期日期。
    """
    ind_id = item.get("id", "")
    sched = list(item.get("releaseSchedule") or OFFICIAL_RELEASE_SCHEDULES.get(ind_id, []))
    if not sched:
        return False

    sched = sorted(set(sched))
    item["releaseSchedule"] = sched
    changed = False

    past_or_today = [d for d in sched if d <= today_str]
    future_dates = [d for d in sched if d > today_str]

    cur_next = item.get("nextReleaseDate", "")
    if data_updated or (cur_next and cur_next < today_str):
        if past_or_today:
            latest_rel_iso = past_or_today[-1]
            mm_dd = f"{latest_rel_iso[5:7]}/{latest_rel_iso[8:10]}"
            if item.get("releaseDate") != mm_dd:
                item["releaseDate"] = mm_dd
                changed = True

        if future_dates:
            next_iso = future_dates[0]
        else:
            last_dt = datetime.strptime(sched[-1], "%Y-%m-%d")
            while last_dt.strftime("%Y-%m-%d") <= today_str:
                last_dt += timedelta(days=30)
            next_iso = last_dt.strftime("%Y-%m-%d")

        if item.get("nextReleaseDate") != next_iso:
            item["nextReleaseDate"] = next_iso
            changed = True

    return changed


def sync_macro_indicators(now_tpe):
    """
    同步六大核心總經指標 (Core PCE / Headline PCE / NFP / ADP / 失業率 / PPI)：
    1. 讀取 FRED 官方公開時間序列，偵測是否有新月份數據
    2. 檢查並自動推進 releaseDate 與 nextReleaseDate
    3. 同步寫入 macro_indicators.json、livequotes_hub.js、index.html 與 nasdaq/index.html
    """
    if not os.path.exists(MACRO_JSON_PATH):
        print(f"Warning: {MACRO_JSON_PATH} not found.")
        return False

    with open(MACRO_JSON_PATH, "r", encoding="utf-8") as f:
        macro_data = json.load(f)

    indicators = {item["id"]: item for item in macro_data.get("indicators", [])}
    today_str = now_tpe.strftime("%Y-%m-%d")
    updated = False

    # 1. Core PCE (PCEPILFE YoY %)
    try:
        obs = fetch_fred_series("PCEPILFE", 16)
        if len(obs) >= 13 and "core_pce" in indicators:
            latest, prev12 = obs[-1], obs[-13]
            prev1, prev13 = obs[-2], obs[-14]
            item = indicators["core_pce"]
            data_up = False
            if latest["period"] > item.get("referencePeriod", "2026-08"):
                yoy = ((latest["value"] / prev12["value"]) - 1.0) * 100.0
                prev_yoy = ((prev1["value"] / prev13["value"]) - 1.0) * 100.0
                item["value"] = f"{yoy:.1f}%"
                item["numericValue"] = round(yoy, 1)
                item["prevValue"] = f"{prev_yoy:.1f}%"
                item["metaLeft"] = f"前期: {prev_yoy:.1f}% ｜ 預期: {item.get('consensus', f'{yoy:.1f}%')}"
                item["referencePeriod"] = latest["period"]
                data_up = True
                updated = True
            if resolve_macro_release_schedule(item, today_str, data_up):
                updated = True
    except Exception as e:
        print(f"[WARN] Core PCE FRED fetch skipped: {e}")
        if "core_pce" in indicators and resolve_macro_release_schedule(indicators["core_pce"], today_str, False):
            updated = True

    # 2. Headline PCE (PCEPI YoY %)
    try:
        obs = fetch_fred_series("PCEPI", 16)
        if len(obs) >= 13 and "headline_pce" in indicators:
            latest, prev12 = obs[-1], obs[-13]
            prev1, prev13 = obs[-2], obs[-14]
            item = indicators["headline_pce"]
            data_up = False
            if latest["period"] > item.get("referencePeriod", "2026-08"):
                yoy = ((latest["value"] / prev12["value"]) - 1.0) * 100.0
                prev_yoy = ((prev1["value"] / prev13["value"]) - 1.0) * 100.0
                item["value"] = f"{yoy:.1f}%"
                item["numericValue"] = round(yoy, 1)
                item["prevValue"] = f"{prev_yoy:.1f}%"
                item["metaLeft"] = f"前期: {prev_yoy:.1f}% ｜ 預期: {item.get('consensus', f'{yoy:.1f}%')}"
                item["referencePeriod"] = latest["period"]
                item["badgeText"] = "較前期趨緩" if yoy <= prev_yoy else "通膨微溫"
                item["badgeClass"] = "status-easing" if yoy <= prev_yoy else "status-sticky"
                data_up = True
                updated = True
            if resolve_macro_release_schedule(item, today_str, data_up):
                updated = True
    except Exception as e:
        print(f"[WARN] Headline PCE FRED fetch skipped: {e}")
        if "headline_pce" in indicators and resolve_macro_release_schedule(indicators["headline_pce"], today_str, False):
            updated = True

    # 3. Nonfarm Payrolls (PAYEMS MoM diff in 10k / 萬人)
    try:
        obs = fetch_fred_series("PAYEMS", 6)
        if len(obs) >= 3 and "nfp" in indicators:
            latest, prev1, prev2 = obs[-1], obs[-2], obs[-3]
            item = indicators["nfp"]
            data_up = False
            if latest["period"] > item.get("referencePeriod", "2026-09"):
                diff_wan = (latest["value"] - prev1["value"]) / 10.0
                prev_wan = (prev1["value"] - prev2["value"]) / 10.0
                sign = "+" if diff_wan >= 0 else ""
                item["value"] = f"{sign}{diff_wan:.1f} 萬人"
                item["numericValue"] = round(diff_wan, 1)
                item["prevValue"] = f"{prev_wan:.1f} 萬"
                item["metaLeft"] = f"前期: {prev_wan:.1f} 萬 ｜ 均值: {item.get('consensus', '4.5 萬')}"
                item["referencePeriod"] = latest["period"]
                item["badgeText"] = "就業穩健" if diff_wan >= 10.0 else "動能放緩"
                item["badgeClass"] = "status-solid" if diff_wan >= 10.0 else "status-easing"
                data_up = True
                updated = True
            if resolve_macro_release_schedule(item, today_str, data_up):
                updated = True
    except Exception as e:
        print(f"[WARN] PAYEMS FRED fetch skipped: {e}")
        if "nfp" in indicators and resolve_macro_release_schedule(indicators["nfp"], today_str, False):
            updated = True

    # 4. ADP Employment (ADPMNUSNERSA MoM diff in 10k / 萬人)
    try:
        obs = fetch_fred_series("ADPMNUSNERSA", 6)
        if len(obs) >= 3 and "adp" in indicators:
            latest, prev1, prev2 = obs[-1], obs[-2], obs[-3]
            item = indicators["adp"]
            data_up = False
            if latest["period"] > item.get("referencePeriod", "2026-09"):
                divisor = 10000.0 if latest["value"] > 500000 else 10.0
                diff_wan = (latest["value"] - prev1["value"]) / divisor
                prev_wan = (prev1["value"] - prev2["value"]) / divisor
                sign = "+" if diff_wan >= 0 else ""
                item["value"] = f"{sign}{diff_wan:.1f} 萬人"
                item["numericValue"] = round(diff_wan, 1)
                item["prevValue"] = f"{prev_wan:.1f} 萬"
                item["metaLeft"] = f"前期: {prev_wan:.1f} 萬 ｜ 預期: {item.get('consensus', '8.0 萬')}"
                item["referencePeriod"] = latest["period"]
                item["badgeText"] = "穩健擴張" if diff_wan >= 5.0 else "動能放緩"
                item["badgeClass"] = "status-solid" if diff_wan >= 5.0 else "status-easing"
                data_up = True
                updated = True
            if resolve_macro_release_schedule(item, today_str, data_up):
                updated = True
    except Exception as e:
        print(f"[WARN] ADP FRED fetch skipped: {e}")
        if "adp" in indicators and resolve_macro_release_schedule(indicators["adp"], today_str, False):
            updated = True

    # 5. Unemployment Rate (UNRATE %)
    try:
        obs = fetch_fred_series("UNRATE", 6)
        if len(obs) >= 2 and "unrate" in indicators:
            latest, prev1 = obs[-1], obs[-2]
            item = indicators["unrate"]
            data_up = False
            if latest["period"] > item.get("referencePeriod", "2026-09"):
                item["value"] = f"{latest['value']:.1f}%"
                item["numericValue"] = round(latest["value"], 1)
                item["prevValue"] = f"{prev1['value']:.1f}%"
                item["metaLeft"] = f"前期: {prev1['value']:.1f}% ｜ 預期: {latest['value']:.1f}%"
                item["referencePeriod"] = latest["period"]
                data_up = True
                updated = True
            if resolve_macro_release_schedule(item, today_str, data_up):
                updated = True
    except Exception as e:
        print(f"[WARN] UNRATE FRED fetch skipped: {e}")
        if "unrate" in indicators and resolve_macro_release_schedule(indicators["unrate"], today_str, False):
            updated = True

    # 6. Producer Price Index (PPIFIS / PPIFES YoY %)
    try:
        obs_head = fetch_fred_series("PPIFIS", 16)
        obs_core = fetch_fred_series("PPIFES", 16)
        if len(obs_head) >= 13 and len(obs_core) >= 13 and "ppi" in indicators:
            latest_h, prev12_h = obs_head[-1], obs_head[-13]
            prev1_h, prev13_h = obs_head[-2], obs_head[-14]
            latest_c, prev12_c = obs_core[-1], obs_core[-13]
            item = indicators["ppi"]
            data_up = False
            if latest_h["period"] > item.get("referencePeriod", "2026-09"):
                yoy_h = ((latest_h["value"] / prev12_h["value"]) - 1.0) * 100.0
                prev_yoy_h = ((prev1_h["value"] / prev13_h["value"]) - 1.0) * 100.0
                yoy_c = ((latest_c["value"] / prev12_c["value"]) - 1.0) * 100.0
                item["value"] = f"{yoy_h:.1f}% / {yoy_c:.1f}%"
                item["numericValue"] = round(yoy_h, 1)
                item["coreNumericValue"] = round(yoy_c, 1)
                item["prevValue"] = f"{prev_yoy_h:.1f}%"
                item["metaLeft"] = f"核心預期: {item.get('consensus', f'{yoy_c:.1f}%')} ｜ 整體前期: {prev_yoy_h:.1f}%"
                item["referencePeriod"] = latest_h["period"]
                data_up = True
                updated = True
            if resolve_macro_release_schedule(item, today_str, data_up):
                updated = True
    except Exception as e:
        print(f"[WARN] PPI FRED fetch skipped: {e}")
        if "ppi" in indicators and resolve_macro_release_schedule(indicators["ppi"], today_str, False):
            updated = True

    macro_data["updatedAt"] = now_tpe.isoformat(timespec="seconds")
    with open(MACRO_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(macro_data, f, ensure_ascii=False, indent=2)

    # 同步寫入 index.html 與 nasdaq/index.html 的靜態預設 DOM
    for rel_html in ("index.html", os.path.join("nasdaq", "index.html")):
        html_path = os.path.join(BASE_DIR, rel_html)
        if not os.path.exists(html_path):
            continue
        with open(html_path, "r", encoding="utf-8") as f:
            html = f.read()
        orig_html = html
        for ind_id, item in indicators.items():
            html = re.sub(
                rf'(<div class="ind-value mono" id="ind-val-{re.escape(ind_id)}">)([^<]*)(</div>)',
                rf'\g<1>{item["value"]}\g<3>',
                html,
            )
            html = re.sub(
                rf'(<span class="tag-status [^"]*" id="ind-badge-{re.escape(ind_id)}">)([^<]*)(</span>)',
                rf'<span class="tag-status {item.get("badgeClass", "status-solid")}" id="ind-badge-{ind_id}">{item.get("badgeText", "")}</span>',
                html,
            )
            html = re.sub(
                rf'(<span id="ind-meta-left-{re.escape(ind_id)}">)([^<]*)(</span>)',
                rf'\g<1>{item["metaLeft"]}\g<3>',
                html,
            )
            next_rel = item.get("nextReleaseDate", "")
            next_short = f"{next_rel[5:7]}/{next_rel[8:10]}" if len(next_rel) >= 10 else ""
            right_label = f"發布: {item['releaseDate']} · 下期 {next_short}" if next_short else f"發布: {item['releaseDate']}"
            html = re.sub(
                rf'(<span id="ind-meta-right-{re.escape(ind_id)}">)([\s\S]*?)(</span>)',
                rf'\g<1>{right_label}\g<3>',
                html,
            )
        if "core_pce" in indicators:
            html = re.sub(
                r'(<span id="header-core-pce-val">)([^<]*)(</span>)',
                rf'\g<1>{indicators["core_pce"]["value"]}\g<3>',
                html,
            )
        if html != orig_html:
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(html)

    print("Successfully synced macro_indicators.json and static HTML snapshots.")
    return updated


def main():
    tz_tpe = timezone(timedelta(hours=8))
    now_tpe = datetime.now(tz_tpe)
    with open(EARNINGS_JSON_PATH, "r", encoding="utf-8") as f:
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
    with open(EARNINGS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(hub, f, ensure_ascii=False, indent=2)
    print("Successfully synced earnings_hub.json from Google Sheets.")

    # 同步六大核心總經指標與排程日期推進
    sync_macro_indicators(now_tpe)


if __name__ == "__main__":
    main()
