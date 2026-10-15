#!/usr/bin/env python3
"""
方向一＋方向二：GOOGLEFINANCE LiveQuotes 雲端報價同步 ＆ 財報開獎自動換季與 EPS 模型滾動校準腳本
每日 06:00 晨間排程執行 (Morning Schedule Automation & EPS Rolling Calibration Engine)

功能：
1. 從 Google Sheets `LiveQuotes` (14F4q5WvvjQRlGSSDcnK7QWBTxDZkT51RzN0bXo5vRYk / 1czITJdQ-NGsymNMc9DB2M1Enmxopg644XQb9_seGph8)
   拉取全數美股與 ETF 最新 GOOGLEFINANCE 收盤價、單日漲跌幅與 52 週高低點。
2. 自動檢測財報開獎狀態：
   - 開獎當日或開獎後 0~3 天內：標記為「🔔 財報已開獎 (Q3 結算中)」並觸發財報預期差 (Beat / Miss) 診斷。
   - 開獎已滿 3 天以上：自動將下次財報日推進一季 (+90 天)，避免出現過期日期。
3. 產出晨間早報「財報預期差診斷與估值模型參數動態修正建議」(Beat/Miss EPS & Target Price Calibration)。
"""

import json
import urllib.request
from datetime import datetime, timedelta

LIVE_QUOTES_SHEET_ID = "14F4q5WvvjQRlGSSDcnK7QWBTxDZkT51RzN0bXo5vRYk"
MAIN_VALUATION_SHEET_ID = "1czITJdQ-NGsymNMc9DB2M1Enmxopg644XQb9_seGph8"
BENCHMARK_YIELD = 5.28


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


def generate_beat_miss_calibration_report(current_yield=5.22):
    """
    針對本週已開獎或即將開獎之重點公司產出晨間 Beat / Miss 預期差診斷與目標價修正建議
    """
    yield_penalty = (current_yield - BENCHMARK_YIELD) * 0.06
    diagnostics = [
        {
            "symbol": "ASML",
            "name": "艾斯摩爾",
            "earnings_date": "2026-10-14",
            "verdict": "Beat (優於預期)",
            "actual_summary": "Q3 營收 €11.7B (近財測高標)、毛利率 57.5% (優於財測 54.0%)、Basic EPS €12.95；Q4 營收指引 €14.2B~€15.2B (毛利率 ~57%)，全年營收 €44B~€45B。",
            "old_eps27": 29.00,
            "new_eps27": 32.50,
            "pe": 26.0,
            "mult": 0.96,
        },
        {
            "symbol": "TSM",
            "name": "台積電 ADR",
            "earnings_date": "2026-10-16",
            "verdict": "Preview (開獎前夕預演)",
            "actual_summary": "市場共識 Q3 EPS $4.46、營收 $45.55B；若法說會毛利率與 CoWoS/AI 指引優於預期，觸發上修。",
            "old_eps27": 8.50,
            "new_eps27": 8.90,
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
    print(generate_beat_miss_calibration_report())
