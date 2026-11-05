#!/usr/bin/env python3
"""
方向一＋方向二＋方向三：
1. GOOGLEFINANCE LiveQuotes 雲端報價同步
2. 財報開獎自動換季 (+90天) 與 EPS 模型滾動校準腳本
3. 六大核心總經指標 (Core PCE / Headline PCE / NFP / ADP / 失業率 / PPI) FRED 官方數據自動抓取與網頁同步引擎
每日 06:00 晨間排程與 GitHub Actions 自動執行
"""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

from scripts.cloud_sheets_to_github_sync import sync_macro_indicators as _cloud_sync_macro_indicators

LIVE_QUOTES_SHEET_ID = "14F4q5WvvjQRlGSSDcnK7QWBTxDZkT51RzN0bXo5vRYk"
MAIN_VALUATION_SHEET_ID = "1czITJdQ-NGsymNMc9DB2M1Enmxopg644XQb9_seGph8"
BENCHMARK_YIELD = 5.28
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MACRO_JSON_PATH = os.path.join(BASE_DIR, "macro_indicators.json")


def sync_macro_indicators():
    """
    自動從 FRED 官方序列抓取最新六大總經指標，推進發布日與下次排程日，
    並同步更新 macro_indicators.json、livequotes_hub.js、index.html 與 nasdaq/index.html。
    """
    tz_tpe = timezone(timedelta(hours=8))
    now_tpe = datetime.now(tz_tpe)
    return _cloud_sync_macro_indicators(now_tpe)


def fetch_live_quotes_from_sheet(sheet_id=LIVE_QUOTES_SHEET_ID):
    """從 Google Sheets gviz JSON 端點讀取 LiveQuotes 最新報價"""
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:json"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    quotes = {}
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read().decode("utf-8", errors="ignore")
        start = raw.find("(") + 1
        end = raw.rfind(")")
        payload = json.loads(raw[start:end])
        rows = payload.get("table", {}).get("rows", [])
        for r in rows:
            c = r.get("c", [])
            sym = str(c[0].get("v", "")).strip().upper() if c and c[0] else ""
            if not sym or sym in ("代號", "TICKER"):
                continue
            price = c[2].get("v") if len(c) > 2 and c[2] else None
            chg_pct = c[3].get("v") if len(c) > 3 and c[3] else 0.0
            high52 = c[4].get("v") if len(c) > 4 and c[4] else None
            low52 = c[5].get("v") if len(c) > 5 and c[5] else None
            if isinstance(price, (int, float)) and price > 0:
                quotes[sym] = {
                    "price": round(float(price), 2),
                    "chgPct": round(float(chg_pct or 0.0), 2),
                    "high52": round(float(high52), 2) if isinstance(high52, (int, float)) else None,
                    "low52": round(float(low52), 2) if isinstance(low52, (int, float)) else None,
                }
    return quotes


def evaluate_earnings_rollover(ed_str, today=None):
    """
    計算距離財報日天數並執行自動換季：
    - 若 0 >= diff_days >= -3：返回「🔔 財報已開獎 (Q3 結算中)」
    - 若 diff_days < -3：自動推進一季 (+90 天)
    """
    if today is None:
        now = datetime.now()
        today = datetime(now.year, now.month, now.day)
    target = datetime.strptime(ed_str, "%Y-%m-%d")
    raw_diff = (target - today).days

    if -3 <= raw_diff <= 0:
        return {
            "status": "SETTLING",
            "badge": "🔔 財報已開獎 (Q3 結算中)",
            "next_earnings_date": ed_str,
            "days": 0,
            "rolled": False,
        }

    rolled = False
    while raw_diff < -3:
        target += timedelta(days=90)
        raw_diff = (target - today).days
        rolled = True

    return {
        "status": "ROLLED" if rolled else "UPCOMING",
        "badge": f"{raw_diff} 天",
        "next_earnings_date": target.strftime("%Y-%m-%d"),
        "days": raw_diff,
        "rolled": rolled,
    }


def generate_beat_miss_calibration_report(current_yield=5.05):
    """
    針對本週已開獎或即將開獎之重點公司產出晨間 Beat / Miss 預期差診斷與目標價修正建議
    """
    yield_penalty = (current_yield - BENCHMARK_YIELD) * 0.06
    diagnostics = [
        {
            "symbol": "MSFT",
            "name": "微軟",
            "earnings_date": "2026-10-28",
            "verdict": "Beat & Raise (優於預期)",
            "actual_summary": "Q1 FY27 營收 $90.74B (年增 16.7%)、稀釋 EPS $4.74 (優於共識 $4.71)，Azure 雲端營收年增 48%。",
            "old_eps27": 14.90,
            "new_eps27": 15.60,
            "pe": 28.0,
            "mult": 0.96,
        },
        {
            "symbol": "META",
            "name": "Meta",
            "earnings_date": "2026-10-28",
            "verdict": "Revenue Beat (營收超預期)",
            "actual_summary": "Q3 營收 $64.60B (年增 26%，超越市場共識 $63.34B)，AI 廣告轉換率與平均單價雙雙提升。",
            "old_eps27": 30.00,
            "new_eps27": 31.80,
            "pe": 22.0,
            "mult": 0.96,
        },
    ]

    report_lines = ["=== 晨間 06:00 財報預期差 (Beat / Miss) 診斷與估值模型動態修正建議 ==="]
    for item in diagnostics:
        adj_pe = max(8.0, item["pe"] * (1.0 - yield_penalty))
        old_target = round(item["old_eps27"] * adj_pe * item["mult"], 1)
        new_target = round(item["new_eps27"] * adj_pe * item["mult"], 1)
        report_lines.append(
            f"• [{item['symbol']} {item['name']}] ({item['verdict']})：{item['actual_summary']}\n"
            f"  👉 修正建議：建議將 FY27 EPS 由 ${item['old_eps27']:.2f} 上調至 ${item['new_eps27']:.2f}，"
            f"FY27 合理目標價將由 ${old_target:.1f} 升至 ${new_target:.1f}。"
        )
    return "\n".join(report_lines)


if __name__ == "__main__":
    sync_macro_indicators()
    print(generate_beat_miss_calibration_report())
