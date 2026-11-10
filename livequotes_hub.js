/**
 * GOOGLEFINANCE LiveQuotes Cloud Hub, Q3 Earnings Auto-Rollover / EPS Calibration Engine
 * & Fed Core Macro Indicators Multi-Channel Auto-Sync Engine (v2.0 Dynamic Auto-Update)
 * 方向一：建立 GOOGLEFINANCE 雲端即時股價中樞 (LiveQuotes)
 * 方向二：SEC 財報實績、財報排程與 EPS 估值情境
 * 方向三：六大核心總經指標 (Core PCE / PCE / NFP / ADP / 失業率 / PPI) 自動抓取與雲端同步引擎
 */
(function () {
  'use strict';

  const LIVE_QUOTES_SHEET_ID = '14F4q5WvvjQRlGSSDcnK7QWBTxDZkT51RzN0bXo5vRYk';
  const MAIN_VALUATION_SHEET_ID = '1czITJdQ-NGsymNMc9DB2M1Enmxopg644XQb9_seGph8';
  const REPORTED_EARNINGS_URL = new URL('reported_earnings.json', document.currentScript.src);
  const US_DATE = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const SYNC_TIME = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const MONEY_NUMBER = new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: 2, maximumFractionDigits: 4
  });
  const EARNINGS_SYMBOL = /^[A-Z][A-Z.0-9-]{0,9}$/;
  const DAY_MS = 86400000;
  const MODEL_EPS_FIELDS = ['eps27', 'eps28', 'eps29'];
  let reportedEarnings = new Map();
  let reportedCashFlows = new Map();
  let reportedTrailingEps = new Map();
  let reportedEarningsUpdatedAt = null;
  let reportedEarningsSyncFailed = false;
  let reportedEarningsSecUnavailable = false;
  let reportedEarningsRequest;

  window.getReportedEarningsForValuation = function (symbol) {
    const report = reportedEarnings.get(symbol);
    return report ? { ...report } : null;
  };

  window.getReportedCashFlowForValuation = function (symbol) {
    const report = reportedCashFlows.get(symbol);
    return report ? { ...report } : null;
  };

  window.getReportedTrailingEpsForValuation = function (symbol) {
    const report = reportedTrailingEps.get(symbol);
    return report ? { ...report } : null;
  };

  function validCashFlowAmounts(row) {
    return row && ['quarter', 'ytd', 'annual', 'ttm'].includes(row.periodType)
      && [row.periodStart, row.periodEnd].every(value => Number.isFinite(earningsDay(value)))
      && row.periodStart < row.periodEnd
      && [row.value, row.operatingCashFlow, row.capitalExpenditure].every(Number.isSafeInteger)
      && row.capitalExpenditure >= 0 && row.value === row.operatingCashFlow - row.capitalExpenditure;
  }

  // 2026-10-21 GOOGLEFINANCE 雲端即時股價中樞最新快照 (2026-10-20 美股收盤 0ms 零延遲啟動基準)
  const LIVE_QUOTES_SNAPSHOT = {
    "NVDA":  { price: 216.47, chgPct: -0.29, high52: 243.37, low52: 164.27 },
    "MSFT":  { price: 531.87, chgPct: -0.31, high52: 553.72, low52: 349.20 },
    "AAPL":  { price: 339.50, chgPct: -1.00, high52: 348.15, low52: 243.42 },
    "AMZN":  { price: 262.63, chgPct:  0.07, high52: 287.16, low52: 196.00 },
    "GOOGL": { price: 340.28, chgPct: -1.13, high52: 408.61, low52: 244.15 },
    "GOOG":  { price: 340.28, chgPct: -1.13, high52: 408.61, low52: 244.15 },
    "META":  { price: 694.25, chgPct: -1.59, high52: 779.82, low52: 520.26 },
    "TSLA":  { price: 373.71, chgPct:  1.54, high52: 498.82, low52: 297.38 },
    "AVGO":  { price: 334.37, chgPct: -0.07, high52: 495.00, low52: 289.96 },
    "TSM":   { price: 425.08, chgPct:  1.16, high52: 487.47, low52: 266.82 },
    "ASML":  { price: 1630.84, chgPct: -0.99, high52: 1999.96, low52: 946.11 },
    "AMD":   { price: 534.74, chgPct: -0.62, high52: 658.52, low52: 188.22 },
    "QCOM":  { price: 175.71, chgPct:  1.26, high52: 259.92, low52: 121.99 },
    "TXN":   { price: 277.78, chgPct:  0.59, high52: 334.03, low52: 152.76 },
    "AMAT":  { price: 404.98, chgPct: -1.97, high52: 739.67, low52: 203.46 },
    "LRCX":  { price: 263.45, chgPct: -3.21, high52: 438.50, low52: 135.50 },
    "KLAC":  { price: 161.74, chgPct: -2.80, high52: 307.37, low52: 107.20 },
    "MU":    { price: 896.07, chgPct: -0.98, high52: 1255.00, low52: 192.40 },
    "ARM":   { price: 221.06, chgPct: -3.07, high52: 452.61, low52: 100.02 },
    "ADI":   { price: 397.05, chgPct:  0.68, high52: 445.83, low52: 223.48 },
    "MRVL":  { price: 240.42, chgPct:  1.40, high52: 329.88, low52: 70.69 },
    "NXPI":  { price: 237.60, chgPct:  3.22, high52: 339.95, low52: 183.00 },
    "INTC":  { price: 91.69,  chgPct: -0.37, high52: 142.34, low52: 32.89 },
    "ORCL":  { price: 131.14, chgPct:  1.18, high52: 287.19, low52: 114.50 },
    "CRM":   { price: 242.43, chgPct: -0.01, high52: 269.11, low52: 146.32 },
    "ADBE":  { price: 256.73, chgPct:  3.90, high52: 363.70, low52: 190.12 },
    "NOW":   { price: 149.54, chgPct:  2.88, high52: 192.97, low52: 81.24 },
    "INTU":  { price: 335.29, chgPct:  2.97, high52: 689.17, low52: 252.84 },
    "PANW":  { price: 340.28, chgPct: -1.92, high52: 432.33, low52: 139.57 },
    "CRWD":  { price: 227.37, chgPct: -0.32, high52: 286.99, low52: 85.68 },
    "PLTR":  { price: 192.60, chgPct: -0.80, high52: 212.94, low52: 106.38 },
    "IBM":   { price: 241.92, chgPct:  2.34, high52: 332.46, low52: 199.19 },
    "CSCO":  { price: 106.71, chgPct:  0.20, high52: 130.37, low52: 69.85 },
    "SNPS":  { price: 447.62, chgPct: -1.53, high52: 539.48, low52: 362.55 },
    "CDNS":  { price: 319.87, chgPct: -1.84, high52: 416.69, low52: 262.75 },
    "FTNT":  { price: 170.93, chgPct: -0.33, high52: 197.13, low52: 73.55 },
    "WDAY":  { price: 203.98, chgPct:  4.50, high52: 247.40, low52: 110.36 },
    "UBER":  { price: 68.94,  chgPct: -1.46, high52: 100.35, low52: 65.41 },
    "NFLX":  { price: 68.69,  chgPct: -1.66, high52: 124.86, low52: 65.10 },
    "BRK.B": { price: 539.82, chgPct:  1.43, high52: 541.00, low52: 464.01 },
    "JPM":   { price: 335.26, chgPct:  0.52, high52: 366.50, low52: 279.10 },
    "V":     { price: 406.57, chgPct:  0.91, high52: 408.59, low52: 293.89 },
    "MA":    { price: 620.42, chgPct:  0.65, high52: 624.29, low52: 464.52 },
    "BAC":   { price: 50.64,  chgPct:  0.50, high52: 65.22,  low52: 46.12 },
    "WFC":   { price: 82.20,  chgPct:  0.49, high52: 97.76,  low52: 72.78 },
    "GS":    { price: 884.81, chgPct:  1.03, high52: 1153.99, low52: 743.11 },
    "MS":    { price: 180.40, chgPct:  1.08, high52: 232.25, low52: 152.80 },
    "AXP":   { price: 318.34, chgPct:  0.61, high52: 387.49, low52: 290.97 },
    "TRV":   { price: 395.73, chgPct:  2.67, high52: 398.70, low52: 264.25 },
    "LLY":   { price: 1283.66, chgPct: 3.49, high52: 1311.75, low52: 793.82 },
    "UNH":   { price: 419.26, chgPct:  3.04, high52: 461.62, low52: 255.97 },
    "JNJ":   { price: 259.36, chgPct:  2.19, high52: 281.07, low52: 184.66 },
    "ABBV":  { price: 289.08, chgPct:  2.26, high52: 291.40, low52: 190.75 },
    "MRK":   { price: 148.30, chgPct:  3.25, high52: 156.92, low52: 82.01 },
    "AMGN":  { price: 438.94, chgPct:  3.29, high52: 447.01, low52: 288.00 },
    "TMO":   { price: 687.37, chgPct:  1.18, high52: 704.00, low52: 435.27 },
    "WMT":   { price: 117.85, chgPct: -0.72, high52: 135.16, low52: 98.88 },
    "COST":  { price: 994.61, chgPct: -0.09, high52: 1096.50, low52: 844.06 },
    "PG":    { price: 159.32, chgPct:  1.03, high52: 167.25, low52: 137.62 },
    "HD":    { price: 315.11, chgPct:  1.69, high52: 397.63, low52: 277.15 },
    "MCD":   { price: 246.52, chgPct:  1.59, high52: 341.75, low52: 229.20 },
    "KO":    { price: 93.49,  chgPct:  0.07, high52: 94.10,  low52: 67.27 },
    "PEP":   { price: 134.02, chgPct:  0.34, high52: 171.48, low52: 123.47 },
    "NKE":   { price: 37.88,  chgPct:  1.80, high52: 70.44,  low52: 31.97 },
    "DIS":   { price: 111.67, chgPct:  1.90, high52: 117.09, low52: 92.19 },
    "XOM":   { price: 177.86, chgPct: -0.24, high52: 180.26, low52: 111.99 },
    "CVX":   { price: 225.71, chgPct:  0.60, high52: 227.28, low52: 146.49 },
    "CAT":   { price: 725.24, chgPct: -0.08, high52: 1073.46, low52: 510.21 },
    "GE":    { price: 299.87, chgPct: -3.67, high52: 388.84, low52: 268.91 },
    "BA":    { price: 190.47, chgPct: -0.50, high52: 254.35, low52: 176.77 },
    "HON":   { price: 213.32, chgPct:  1.59, high52: 260.15, low52: 195.77 },
    "RTX":   { price: 193.34, chgPct:  0.64, high52: 226.88, low52: 166.74 },
    "UNP":   { price: 287.61, chgPct:  0.21, high52: 315.99, low52: 215.53 },
    "VZ":    { price: 44.54,  chgPct:  0.88, high52: 51.68,  low52: 38.39 },
    "SHW":   { price: 336.01, chgPct:  1.33, high52: 377.77, low52: 289.86 },
    "DOW":   { price: 30.69,  chgPct:  2.03, high52: 42.74,  low52: 20.93 },
    "C":     { price: 122.51, chgPct:  0.67, high52: 147.96, low52: 95.00 },
    "PFE":   { price: 30.11,  chgPct:  2.31, high52: 30.25,  low52: 23.62 },
    "CVS":   { price: 94.75,  chgPct:  2.23, high52: 110.68, low52: 69.51 },
    "T":     { price: 23.42,  chgPct:  0.95, high52: 29.44,  low52: 19.89 },
    "GM":    { price: 77.09,  chgPct: -6.84, high52: 91.85,  low52: 62.36 },
    "TM":    { price: 196.53, chgPct:  1.27, high52: 248.90, low52: 166.10 },
    "QQQ":   { price: 717.63, chgPct: -0.10, high52: 762.86, low52: 555.60 },
    "SPY":   { price: 769.05, chgPct:  0.34, high52: 781.62, low52: 629.28 },
    "SMH":   { price: 546.36, chgPct: -0.38, high52: 671.83, low52: 315.05 },
    "SOXX":  { price: 500.01, chgPct: -0.38, high52: 655.94, low52: 260.50 },
    "IWM":   { price: 275.78, chgPct:  1.66, high52: 305.18, low52: 228.44 },
    "DIA":   { price: 524.36, chgPct:  1.05, high52: 546.75, low52: 450.44 },
    "XLK":   { price: 185.44, chgPct: -0.28, high52: 203.25, low52: 126.68 },
    "XLF":   { price: 55.72,  chgPct:  1.20, high52: 58.60,  low52: 47.67 },
    "TLT":   { price: 80.13,  chgPct:  0.84, high52: 92.19,  low52: 76.43 },
    "ARKK":  { price: 9.21,   chgPct:  0.34, high52: 10.66,  low52: 6.74 }
  };

  // 方向三：六大核心總經指標官方最新基準快照 (含 10/29 發布之 9 月 PCE 3.6%/核心 3.1% 與 11/04 發布之 10 月 ADP +8.6 萬人)
  const MACRO_RELEASE_SCHEDULES = {
    core_pce: ["2026-09-30", "2026-10-29", "2026-11-25", "2026-12-23", "2027-01-29", "2027-02-26", "2027-03-26", "2027-04-30", "2027-05-28", "2027-06-25"],
    headline_pce: ["2026-09-30", "2026-10-29", "2026-11-25", "2026-12-23", "2027-01-29", "2027-02-26", "2027-03-26", "2027-04-30", "2027-05-28", "2027-06-25"],
    nfp: ["2026-10-02", "2026-11-06", "2026-12-04", "2027-01-08", "2027-02-05", "2027-03-05", "2027-04-02", "2027-05-07", "2027-06-04"],
    adp: ["2026-09-30", "2026-11-04", "2026-12-02", "2027-01-06", "2027-02-03", "2027-03-03", "2027-04-01", "2027-05-05", "2027-06-02"],
    unrate: ["2026-10-02", "2026-11-06", "2026-12-04", "2027-01-08", "2027-02-05", "2027-03-05", "2027-04-02", "2027-05-07", "2027-06-04"],
    ppi: ["2026-10-15", "2026-11-13", "2026-12-15", "2027-01-14", "2027-02-12", "2027-03-12", "2027-04-14", "2027-05-13", "2027-06-11"]
  };

  const MACRO_INDICATORS_SNAPSHOT = [
    {
      id: "core_pce",
      name: "核心 PCE 年增率 (Core PCE)",
      fredSeries: "PCEPILFE",
      calcType: "yoy_pct",
      value: "3.1%",
      numericValue: 3.1,
      prevValue: "3.0%",
      consensus: "3.0%",
      metaLeft: "前期: 3.0% ｜ 預期: 3.0%",
      releaseDate: "10/29",
      referencePeriod: "2026-09",
      nextReleaseDate: "2026-11-25",
      releaseSchedule: MACRO_RELEASE_SCHEDULES.core_pce,
      badgeText: "Fed核心指標",
      badgeClass: "status-sticky",
      sourceName: "BEA Personal Income & Outlays",
      sourceUrl: "https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026"
    },
    {
      id: "headline_pce",
      name: "整體 PCE 年增率 (Headline PCE)",
      fredSeries: "PCEPI",
      calcType: "yoy_pct",
      value: "3.6%",
      numericValue: 3.6,
      prevValue: "3.4%",
      consensus: "3.5%",
      metaLeft: "前期: 3.4% ｜ 預期: 3.5%",
      releaseDate: "10/29",
      referencePeriod: "2026-09",
      nextReleaseDate: "2026-11-25",
      releaseSchedule: MACRO_RELEASE_SCHEDULES.headline_pce,
      badgeText: "通膨微溫",
      badgeClass: "status-sticky",
      sourceName: "BEA Personal Income & Outlays",
      sourceUrl: "https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026"
    },
    {
      id: "nfp",
      name: "大非農新增就業 (Nonfarm Payrolls)",
      fredSeries: "PAYEMS",
      calcType: "mom_diff_10k",
      value: "+2.9 萬人",
      numericValue: 2.9,
      prevValue: "13.3 萬",
      consensus: "4.5 萬",
      metaLeft: "前期: 13.3 萬 ｜ 均值: 4.5 萬",
      releaseDate: "10/02",
      referencePeriod: "2026-09",
      nextReleaseDate: "2026-11-06",
      releaseSchedule: MACRO_RELEASE_SCHEDULES.nfp,
      badgeText: "動能放緩",
      badgeClass: "status-easing",
      sourceName: "BLS Employment Situation",
      sourceUrl: "https://www.bls.gov/news.release/empsit.nr0.htm"
    },
    {
      id: "adp",
      name: "小非農就業 (ADP Employment)",
      fredSeries: "ADPMNUSNERSA",
      calcType: "mom_diff_10k",
      value: "+8.6 萬人",
      numericValue: 8.6,
      prevValue: "8.6 萬",
      consensus: "8.0 萬",
      metaLeft: "前期: 8.6 萬 ｜ 預期: 8.0 萬",
      releaseDate: "11/04",
      referencePeriod: "2026-10",
      nextReleaseDate: "2026-12-02",
      releaseSchedule: MACRO_RELEASE_SCHEDULES.adp,
      badgeText: "穩健擴張",
      badgeClass: "status-solid",
      sourceName: "ADP National Employment Report",
      sourceUrl: "https://mediacenter.adp.com/2026-11-04-ADP-National-Employment-Report-Private-Sector-Employment-Increased-by-86,000-Jobs-in-October"
    },
    {
      id: "unrate",
      name: "失業率 (Unemployment Rate)",
      fredSeries: "UNRATE",
      calcType: "level_pct",
      value: "4.2%",
      numericValue: 4.2,
      prevValue: "4.2%",
      consensus: "4.2%",
      metaLeft: "前期: 4.2% ｜ 預期: 4.2%",
      releaseDate: "10/02",
      referencePeriod: "2026-09",
      nextReleaseDate: "2026-11-06",
      releaseSchedule: MACRO_RELEASE_SCHEDULES.unrate,
      badgeText: "健康低檔",
      badgeClass: "status-solid",
      sourceName: "BLS Employment Situation",
      sourceUrl: "https://www.bls.gov/news.release/empsit.nr0.htm"
    },
    {
      id: "ppi",
      name: "生產者物價 PPI / 核心 PPI",
      fredSeries: "PPIFIS,PPIFES",
      calcType: "dual_yoy_pct",
      value: "6.4% / 5.0%",
      numericValue: 6.4,
      coreNumericValue: 5.0,
      prevValue: "5.4%",
      consensus: "4.4%",
      metaLeft: "核心預期: 4.4% ｜ 整體前期: 5.4%",
      releaseDate: "10/15",
      referencePeriod: "2026-09",
      nextReleaseDate: "2026-11-13",
      releaseSchedule: MACRO_RELEASE_SCHEDULES.ppi,
      badgeText: "通膨升溫",
      badgeClass: "status-sticky",
      sourceName: "BLS Producer Price Index",
      sourceUrl: "https://www.bls.gov/news.release/ppi.nr0.htm"
    }
  ];

  // 方向二：財報開獎診斷、本週預告與全市場財報日基準快照 (可由 ./earnings_hub.json 與 Google Sheets 即時覆寫)
  const EARNINGS_HUB_SNAPSHOT = {
    "updatedAt": "2026-10-29T16:05:00+08:00",
    "baselineDate": "2026-10-28 收盤 (台北時間 2026-10-29 即時同步)",
    "us10yYield": 5.05,
    "fomcNextMeeting": "2026-12-09",
    "source": "Google Sheets LiveQuotes Hub + Main Valuation Sheet (gviz/tq Direct Cloud Sync) + SEC/IR Releases",
    "recentDiagnostics": [
        {
            "symbol": "MSFT",
            "name": "微軟",
            "reportDate": "2026-10-28",
            "nextReportDate": "2027-01-27",
            "quarter": "Q1 FY27",
            "timing": "AMC",
            "verdict": "Beat & Raise (Azure 勁揚 48%・Q1 結算中)",
            "badgeText": "10/28 盤後已開獎・Q1/Q3 結算中",
            "badgeStyle": "background:#f5f3ff; color:#6d28d9; border:1px solid #c4b5fd;",
            "actualSummary": "Q1 FY27 營收 $90.74B（年增 16.7%，優於市場共識 $90.60B）、稀釋 EPS $4.74（優於共識 $4.71），Azure 雲端營收在 AI 算力推升下強勢年增 48%，微軟雲毛利率穩守 65%。",
            "guidanceSummary": "Copilot 企業授權滲透率持續擴大，AI 資料中心資本支出與商業雲 RPO 訂單動能強勁。",
            "oldEps27": 14.9,
            "newEps27": 15.6,
            "newEps28": 18.0,
            "newEps29": 20.5,
            "pe": 28.0,
            "mult": 0.96,
            "sourceName": "Microsoft FY27 Q1 Earnings Release",
            "sourceUrl": "https://www.microsoft.com/en-us/investor/default"
        },
        {
            "symbol": "META",
            "name": "Meta",
            "reportDate": "2026-10-28",
            "nextReportDate": "2027-01-27",
            "quarter": "Q3 2026",
            "timing": "AMC",
            "verdict": "Revenue Beat (營收年增 26%・AI 資本支出擴大)",
            "badgeText": "10/28 盤後已開獎・Q3 結算中",
            "badgeStyle": "background:#f5f3ff; color:#6d28d9; border:1px solid #c4b5fd;",
            "actualSummary": "Q3 營收 $64.60B（年增 26%，超越市場共識 $63.34B），AI 廣告投放轉換率與平均單價雙雙提升；單季 GAAP EPS $3.83（受一次性法規準備金與重資本投入影響）。",
            "guidanceSummary": "重申全年資本支出 $130B～$145B 投入次世代 Llama 與 AI 算力叢集，並擴大股權回購與長期 AI 變現佈局。",
            "oldEps27": 30.0,
            "newEps27": 31.8,
            "newEps28": 37.0,
            "newEps29": 42.8,
            "pe": 22.0,
            "mult": 0.96,
            "sourceName": "Meta Q3 2026 Earnings Release",
            "sourceUrl": "https://admiralmarkets.com/analytics/traders-blog/meta-stock-muse-singapore"
        },
        {
            "symbol": "GOOGL",
            "name": "Alphabet",
            "reportDate": "2026-10-27",
            "nextReportDate": "2027-01-26",
            "quarter": "Q3 2026",
            "timing": "AMC",
            "verdict": "Cloud 暴增 103% (營益率擴張・Q3 結算中)",
            "badgeText": "10/27 盤後已開獎・Q3 結算中",
            "badgeStyle": "background:#f5f3ff; color:#6d28d9; border:1px solid #c4b5fd;",
            "actualSummary": "Q3 Google Cloud 營收受惠 AI 基礎設施與自研 TPU 需求暴增 103%，合併營業利益年增 30%，整體營業利益率擴張至 31.8%，Gemini 用戶突破 10 億大關。",
            "guidanceSummary": "持續擴大 AI 伺服器與資料中心資本支出以滿足企業雲端積壓訂單。",
            "oldEps27": 9.7,
            "newEps27": 10.3,
            "newEps28": 11.9,
            "newEps29": 13.6,
            "pe": 21.0,
            "mult": 0.96,
            "sourceName": "Alphabet Q3 2026 SEC Form 8-K",
            "sourceUrl": "https://www.sec.gov/Archives/edgar/data/1652044/000165204426000080/googexhibit991q32026.htm"
        },
        {
            "symbol": "KLAC",
            "name": "科磊",
            "reportDate": "2026-10-28",
            "nextReportDate": "2027-01-27",
            "quarter": "FQ1 2027",
            "timing": "AMC",
            "verdict": "Beat & Raise (檢測設備強勁・Q1 結算中)",
            "badgeText": "10/28 盤後已開獎・FQ1 結算中",
            "badgeStyle": "background:#f5f3ff; color:#6d28d9; border:1px solid #c4b5fd;",
            "actualSummary": "FQ1 27 營收 $4.14B（超越財測中位數 $4.0B）、拆股後 Non-GAAP EPS $1.22（GAAP EPS $1.18），單季自由現金流 $1.34B（近 12 個月 FCF 達 $4.04B）。",
            "guidanceSummary": "FQ2 營收指引上調至 $4.7B +/- $200M，Non-GAAP 毛利率指引 62.5% +/- 1.0%，Non-GAAP EPS 指引 $1.44 +/- $0.11。",
            "oldEps27": 34.0,
            "newEps27": 36.2,
            "newEps28": 44.5,
            "newEps29": 52.0,
            "pe": 21.0,
            "mult": 0.96,
            "sourceName": "KLA FQ1 2027 Official Release",
            "sourceUrl": "https://ir.kla.com/news-events/press-releases/detail/523/kla-corporation-reports-fiscal-2027-first-quarter-results"
        },
        {
            "symbol": "CDNS",
            "name": "益華電腦",
            "reportDate": "2026-10-26",
            "nextReportDate": "2027-01-25",
            "quarter": "Q3 2026",
            "timing": "AMC",
            "verdict": "Beat & Record Backlog (在手訂單 $8.2B 創高)",
            "badgeText": "10/26 已開獎・Q3 結算中",
            "badgeStyle": "background:#f5f3ff; color:#6d28d9; border:1px solid #c4b5fd;",
            "actualSummary": "Q3 營收 $1.63B（優於共識 $1.61B，經常性營收年增 18%）、Non-GAAP 稀釋 EPS $2.11（優於共識 $2.05），在手訂單（Backlog）創下 $8.2B 歷史新高。",
            "guidanceSummary": "受惠 AI 晶片複雜度提升與系統驗證硬體熱銷，全面上調全年營收與獲利展望。",
            "oldEps27": 7.5,
            "newEps27": 7.9,
            "newEps28": 9.2,
            "newEps29": 10.6,
            "pe": 34.0,
            "mult": 0.96,
            "sourceName": "Cadence Q3 2026 Financial Results",
            "sourceUrl": "https://investor.cadence.com/news/news-details/2026/Cadence-Reports-Third-Quarter-2026-Financial-Results/"
        },
        {
            "symbol": "TSLA",
            "name": "特斯拉",
            "reportDate": "2026-10-21",
            "nextReportDate": "2027-01-27",
            "quarter": "Q3 2026",
            "timing": "AMC",
            "verdict": "EPS & 毛利率雙超預期 (已換季)",
            "badgeText": "10/21 已開獎・下次 01/27 (+1季)",
            "badgeStyle": "background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;",
            "actualSummary": "Q3 營收 $28.05B、Non-GAAP EPS $0.48（優於共識 $0.43 達 +11.6%），扣除碳權後汽車毛利率回升至 18.1%，單季自由現金流 $1.53B。",
            "guidanceSummary": "持續推進 Cybercab 自駕量產與儲能業務高毛利擴張。",
            "oldEps27": 3.2,
            "newEps27": 3.55,
            "newEps28": 4.95,
            "newEps29": 7.1,
            "pe": 42.0,
            "mult": 0.96,
            "sourceName": "Tesla Q3 2026 Update",
            "sourceUrl": "https://ir.tesla.com"
        },
        {
            "symbol": "TXN",
            "name": "德州儀器",
            "reportDate": "2026-10-21",
            "nextReportDate": "2027-01-21",
            "quarter": "Q3 2026",
            "timing": "AMC",
            "verdict": "Beat (類比晶片復甦強勁・已換季)",
            "badgeText": "10/21 已開獎・下次 01/21 (+1季)",
            "badgeStyle": "background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;",
            "actualSummary": "Q3 營收 $6.06B（年增 28%、季增 11%）、稀釋 EPS $2.62（年增 77%，優於共識 $2.42 達 +8.3%），毛利率達 64%。",
            "guidanceSummary": "工控與車用類比晶片庫存回補動能延續。",
            "oldEps27": 7.2,
            "newEps27": 7.65,
            "newEps28": 9.0,
            "newEps29": 10.3,
            "pe": 23.0,
            "mult": 0.96,
            "sourceName": "TI Q3 2026 Results",
            "sourceUrl": "https://news.alphastreet.com/texas-instruments-q3-2026-earnings-preview-october-21-street-expects-2-42-eps/"
        },
        {
            "symbol": "TSM",
            "name": "台積電 ADR",
            "reportDate": "2026-10-15",
            "nextReportDate": "2027-01-14",
            "quarter": "Q3 2026",
            "timing": "BMO",
            "verdict": "Beat & Raise (營收毛利雙破表・已換季)",
            "badgeText": "10/15 已開獎・下次 01/14 (+1季)",
            "badgeStyle": "background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;",
            "actualSummary": "Q3 營收 US$46.72B（季增 16.2%、年增 41.2%）、毛利率 66.4%、每單位 ADR EPS US$4.60（優於共識 $4.46）。",
            "guidanceSummary": "Q4 營收指引大幅上調至 US$52.3B～$54.3B（毛利率指引 65%～67%），FY27E ADR EPS 校準上調至 $20.50。",
            "oldEps27": 18.5,
            "newEps27": 20.5,
            "newEps28": 23.5,
            "newEps29": 26.6,
            "pe": 22.0,
            "mult": 0.96,
            "sourceName": "TSMC Q3 2026 Official Release",
            "sourceUrl": "https://pr.tsmc.com/english/news/3346"
        },
        {
            "symbol": "NFLX",
            "name": "Netflix",
            "reportDate": "2026-10-20",
            "nextReportDate": "2027-01-19",
            "quarter": "Q3 2026",
            "timing": "AMC",
            "verdict": "Beat (EPS 優於預期・已換季)",
            "badgeText": "10/20 已開獎・下次 01/19 (+1季)",
            "badgeStyle": "background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;",
            "actualSummary": "Q3 營收 $12.874B（年增 12%）、營業利益率 34.6%、拆股後稀釋 EPS $0.87（優於共識 $0.82 達 +6.1%）。",
            "guidanceSummary": "Q4 營收指引 $13.44B；重申 2026 全年營收指引 $51.1B，拆股後 FY27E EPS 校準為 $2.52。",
            "oldEps27": 2.4,
            "newEps27": 2.52,
            "newEps28": 2.95,
            "newEps29": 3.4,
            "pe": 28.0,
            "mult": 0.96,
            "sourceName": "Netflix Q3 2026 Earnings Release",
            "sourceUrl": "https://www.tradingview.com/news/tradingview:5f43a356c05d6:0-netflix-posts-q3-revenue-12-874b-operating-margin-34-6-and-diluted-eps-0-87/"
        }
    ],
    "upcomingPreviews": [
        {
            "symbol": "AAPL",
            "name": "蘋果",
            "earningsDate": "2026-10-29",
            "timing": "盤後 (AMC)",
            "consensusEps": "$1.88",
            "consensusRev": "$104.0B",
            "previewNote": "今晚壓軸開獎！聚焦 iPhone 換機週期、Apple Intelligence 端側 AI 滲透率與 Services 服務毛利率。",
            "oldEps27": 8.0,
            "bullEps27": 8.4,
            "bullEps28": 9.35,
            "bullEps29": 10.3,
            "sourceUrl": "https://www.nasdaq.com/market-activity/earnings"
        },
        {
            "symbol": "AMZN",
            "name": "亞馬遜",
            "earningsDate": "2026-10-29",
            "timing": "盤後 (AMC)",
            "consensusEps": "$1.62",
            "consensusRev": "$182.5B",
            "previewNote": "今晚壓軸開獎！聚焦 AWS 生成式 AI 雲端增速、自研 Trainium 晶片部署與北美零售營業利益率擴張。",
            "oldEps27": 7.3,
            "bullEps27": 7.8,
            "bullEps28": 9.5,
            "bullEps29": 11.5,
            "sourceUrl": "https://www.nasdaq.com/market-activity/earnings"
        },
        {
            "symbol": "NXPI",
            "name": "恩智浦",
            "earningsDate": "2026-11-02",
            "timing": "盤後 (AMC)",
            "consensusEps": "$3.45",
            "consensusRev": "$3.25B",
            "previewNote": "下週一打頭陣，聚焦車用雷達、邊緣 AI 微控制器與工業物聯網庫存去化進度。",
            "oldEps27": 15.2,
            "bullEps27": 16.1,
            "bullEps28": 17.8,
            "bullEps29": 19.2,
            "sourceUrl": "https://www.nasdaq.com/market-activity/earnings"
        },
        {
            "symbol": "AMD",
            "name": "超微半導體",
            "earningsDate": "2026-11-03",
            "timing": "盤後 (AMC)",
            "consensusEps": "$1.15",
            "consensusRev": "$8.75B",
            "previewNote": "下週二焦點，聚焦 MI350/MI400 AI 加速器全年營收上修幅度與 EPYC 伺服器 CPU 市佔率。",
            "oldEps27": 5.6,
            "bullEps27": 6.1,
            "bullEps28": 7.2,
            "bullEps29": 8.4,
            "sourceUrl": "https://www.nasdaq.com/market-activity/earnings"
        },
        {
            "symbol": "QCOM",
            "name": "高通",
            "earningsDate": "2026-11-04",
            "timing": "盤後 (AMC)",
            "consensusEps": "$2.85",
            "consensusRev": "$11.10B",
            "previewNote": "聚焦 Snapdragon 旗艦手機晶片、AI PC 與車用數位座艙平台（Automotive）營收動能。",
            "oldEps27": 11.9,
            "bullEps27": 12.6,
            "bullEps28": 13.5,
            "bullEps29": 14.3,
            "sourceUrl": "https://www.nasdaq.com/market-activity/earnings"
        },
        {
            "symbol": "ARM",
            "name": "安謀",
            "earningsDate": "2026-11-05",
            "timing": "盤後 (AMC)",
            "consensusEps": "$0.42",
            "consensusRev": "$1.12B",
            "previewNote": "聚焦 Armv9 架構權利金費率翻倍效應與資料中心客製化 AI 伺服器晶片授權進度。",
            "oldEps27": 2.1,
            "bullEps27": 2.3,
            "bullEps28": 2.85,
            "bullEps29": 3.45,
            "sourceUrl": "https://www.nasdaq.com/market-activity/earnings"
        },
        {
            "symbol": "FTNT",
            "name": "飛塔資訊",
            "earningsDate": "2026-11-05",
            "timing": "盤後 (AMC)",
            "consensusEps": "$0.62",
            "consensusRev": "$1.68B",
            "previewNote": "聚焦 Unified SASE 安全存取服務邊緣帳單金額（Billings）增速與次世代防火牆升級潮。",
            "oldEps27": 2.7,
            "bullEps27": 2.88,
            "bullEps28": 3.25,
            "bullEps29": 3.65,
            "sourceUrl": "https://www.nasdaq.com/market-activity/earnings"
        }
    ],
    "earningsDates": {
        "PEP": "2027-01-08",
        "JPM": "2027-01-13",
        "WFC": "2027-01-13",
        "GS": "2027-01-13",
        "UNH": "2027-01-13",
        "JNJ": "2027-01-13",
        "C": "2027-01-13",
        "ASML": "2027-01-20",
        "BAC": "2027-01-14",
        "MS": "2027-01-14",
        "TSM": "2027-01-14",
        "AXP": "2027-01-16",
        "PG": "2027-01-16",
        "UNP": "2027-01-16",
        "TRV": "2027-01-17",
        "NFLX": "2027-01-19",
        "GE": "2027-01-19",
        "GM": "2027-01-19",
        "RTX": "2027-01-19",
        "TSLA": "2027-01-27",
        "IBM": "2027-01-20",
        "LRCX": "2027-01-21",
        "TXN": "2027-01-21",
        "TMO": "2027-01-21",
        "T": "2027-01-21",
        "KLAC": "2026-10-28",
        "INTC": "2026-10-29",
        "NOW": "2026-10-28",
        "V": "2027-01-22",
        "KO": "2027-01-22",
        "BA": "2027-01-22",
        "VZ": "2027-01-22",
        "SHW": "2027-01-22",
        "HON": "2027-01-23",
        "ABBV": "2027-01-24",
        "CAT": "2027-01-24",
        "DOW": "2027-01-24",
        "CDNS": "2026-10-26",
        "GOOGL": "2026-10-27",
        "MSFT": "2026-10-28",
        "META": "2026-10-28",
        "MCD": "2026-10-28",
        "AAPL": "2026-10-29",
        "AMZN": "2026-10-29",
        "LLY": "2026-10-29",
        "MRK": "2026-10-29",
        "MA": "2026-10-30",
        "AMGN": "2026-10-30",
        "XOM": "2026-10-30",
        "CVX": "2026-10-30",
        "NXPI": "2026-11-02",
        "PLTR": "2026-11-02",
        "BRK.B": "2026-11-02",
        "AMD": "2026-11-03",
        "PFE": "2026-11-03",
        "QCOM": "2026-11-04",
        "CVS": "2026-11-04",
        "ARM": "2026-11-05",
        "FTNT": "2026-11-05",
        "UBER": "2026-11-05",
        "TM": "2026-11-06",
        "AMAT": "2026-11-12",
        "HD": "2026-11-12",
        "DIS": "2026-11-13",
        "NVDA": "2026-11-18",
        "CSCO": "2026-11-18",
        "PANW": "2026-11-19",
        "WMT": "2026-11-19",
        "INTU": "2026-11-24",
        "ADI": "2026-11-24",
        "WDAY": "2026-11-24",
        "CRM": "2026-11-25",
        "CRWD": "2026-12-02",
        "SNPS": "2026-12-02",
        "MRVL": "2026-12-03",
        "ORCL": "2026-12-08",
        "AVGO": "2026-12-10",
        "ADBE": "2026-12-10",
        "COST": "2026-12-10",
        "MU": "2026-12-16",
        "NKE": "2026-12-18"
    }
};

  window.LIVE_QUOTES_HUB = Object.assign({}, LIVE_QUOTES_SNAPSHOT);
  window.MACRO_INDICATORS_HUB = MACRO_INDICATORS_SNAPSHOT.map(item => Object.assign({}, item));
  window.EARNINGS_HUB = JSON.parse(JSON.stringify(EARNINGS_HUB_SNAPSHOT));

  // 自動檢核並推進六大總經指標之發布日 (releaseDate) 與下次發布日 (nextReleaseDate)
  function resolveMacroReleaseSchedule(ind, todayStr, forceAdvanceReleaseDate) {
    if (!ind || !ind.id) return;
    const sched = Array.isArray(ind.releaseSchedule) && ind.releaseSchedule.length > 0
      ? ind.releaseSchedule.slice().sort()
      : (MACRO_RELEASE_SCHEDULES[ind.id] ? MACRO_RELEASE_SCHEDULES[ind.id].slice().sort() : []);
    if (sched.length === 0) return;
    ind.releaseSchedule = sched;

    const pastOrToday = sched.filter(d => d <= todayStr);
    const futureDates = sched.filter(d => d >= todayStr);

    if (forceAdvanceReleaseDate || !ind.nextReleaseDate || ind.nextReleaseDate < todayStr) {
      if (pastOrToday.length > 0) {
        const latestIso = pastOrToday[pastOrToday.length - 1];
        ind.releaseDate = `${latestIso.slice(5, 7)}/${latestIso.slice(8, 10)}`;
      }
      const strictFuture = sched.filter(d => d > todayStr);
      if (strictFuture.length > 0) {
        ind.nextReleaseDate = strictFuture[0];
      } else {
        const parts = sched[sched.length - 1].split('-').map(Number);
        const dt = new Date(parts[0], parts[1] - 1, parts[2]);
        while (dt.toISOString().slice(0, 10) <= todayStr) {
          dt.setDate(dt.getDate() + 30);
        }
        ind.nextReleaseDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      }
    } else if (futureDates.length > 0 && !ind.nextReleaseDate) {
      ind.nextReleaseDate = futureDates[0];
    }
  }

  // 將六大總經指標渲染至網頁 DOM (支援 index.html 與 nasdaq/index.html)
  function applyMacroIndicatorsToPage(indicatorsList, sourceLabel) {
    if (!Array.isArray(indicatorsList) || indicatorsList.length === 0) return;

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    indicatorsList.forEach(ind => {
      if (!ind || !ind.id) return;
      resolveMacroReleaseSchedule(ind, todayStr, false);

      let box = document.getElementById(`ind-box-${ind.id}`);
      if (!box) {
        document.querySelectorAll('.indicator-box').forEach(el => {
          const titleSpan = el.querySelector('.ind-name span:first-child');
          if (titleSpan && ind.name && titleSpan.textContent.includes(ind.name.split(' ')[0])) {
            box = el;
          }
        });
      }
      if (!box) return;

      const valEl = document.getElementById(`ind-val-${ind.id}`) || box.querySelector('.ind-value');
      if (valEl && ind.value) {
        valEl.textContent = ind.value;
      }

      const badgeEl = document.getElementById(`ind-badge-${ind.id}`) || box.querySelector('.tag-status');
      if (badgeEl && ind.badgeText) {
        badgeEl.textContent = ind.badgeText;
        badgeEl.className = `tag-status ${ind.badgeClass || 'status-solid'}`;
      }

      const metaSpans = box.querySelectorAll('.ind-meta span');
      const metaLeftEl = document.getElementById(`ind-meta-left-${ind.id}`) || (metaSpans.length > 0 ? metaSpans[0] : null);
      const metaRightEl = document.getElementById(`ind-meta-right-${ind.id}`) || (metaSpans.length > 1 ? metaSpans[1] : null);

      if (metaLeftEl && ind.metaLeft) {
        metaLeftEl.textContent = ind.metaLeft;
      }

      if (metaRightEl && ind.releaseDate) {
        let releaseHtml = `發布: ${ind.releaseDate}`;
        if (ind.nextReleaseDate) {
          const parts = String(ind.nextReleaseDate).split('-').map(Number);
          if (parts.length === 3) {
            const nextDt = new Date(parts[0], parts[1] - 1, parts[2]);
            const diffDays = Math.round((nextDt - todayMidnight) / 86400000);
            const nextShort = `${String(parts[1]).padStart(2, '0')}/${String(parts[2]).padStart(2, '0')}`;
            if (diffDays === 0) {
              releaseHtml = `發布: ${ind.releaseDate} <span style="color:#d97706; font-weight:800;" title="下次官方發布日：今日 (${nextShort}) 美東 08:30">· 🔔今日開獎</span>`;
            } else if (diffDays > 0 && diffDays <= 5) {
              releaseHtml = `發布: ${ind.releaseDate} <span style="color:#059669; font-weight:700;" title="下次官方發布日：${ind.nextReleaseDate} (倒數 ${diffDays} 天)">· 下期 ${nextShort}</span>`;
            } else if (diffDays > 5) {
              releaseHtml = `發布: ${ind.releaseDate} <span style="color:#6c8370; font-weight:600;" title="下次官方發布日：${ind.nextReleaseDate} (倒數 ${diffDays} 天)">· 下期 ${nextShort}</span>`;
            }
          }
        }
        metaRightEl.innerHTML = releaseHtml;
      }

      if (ind.sourceUrl) {
        const tooltipParts = [
          `【${ind.name}】`,
          `• 最新數值：${ind.value} (${ind.metaLeft || ''})`,
          ind.referencePeriod ? `• 數據統計月份：${ind.referencePeriod}` : '',
          `• 最近發布日：${ind.releaseDate}`,
          ind.nextReleaseDate ? `• 下次發布日：${ind.nextReleaseDate}` : '',
          ind.fredSeries ? `• FRED 官方序列：${ind.fredSeries}` : '',
          `• 點擊卡片可查看 ${ind.sourceName || '官方機構'} 最新報告`
        ].filter(Boolean).join('\n');
        box.setAttribute('title', tooltipParts);
        box.style.cursor = 'pointer';
        box.onclick = function (e) {
          if (e.target && e.target.tagName === 'A') return;
          window.open(ind.sourceUrl, '_blank', 'noopener');
        };
      }

      if (ind.id === 'core_pce' && ind.value) {
        const hdrPce = document.getElementById('header-core-pce-val');
        if (hdrPce) {
          hdrPce.textContent = ind.value;
        } else {
          document.querySelectorAll('.header div').forEach(el => {
            if (el.children.length === 0 && el.textContent.includes('核心 PCE：')) {
              el.textContent = el.textContent.replace(/核心 PCE：[0-9.]+%/, `核心 PCE：${ind.value}`);
            }
          });
        }
      }
    });

    const syncStatusEl = document.getElementById('macro-indicators-sync-status');
    if (syncStatusEl && sourceLabel) {
      syncStatusEl.innerHTML = `🟢 殖利率每日即時連線 ｜ 六大總經指標已自動同步 (${sourceLabel})`;
    }
  }

  window.applyMacroIndicatorsToPage = applyMacroIndicatorsToPage;

  async function fetchFredSeriesObservations(seriesId, count) {
    const rawUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
    const proxies = [
      `https://corsproxy.io/?url=${encodeURIComponent(rawUrl)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`
    ];
    for (const pUrl of proxies) {
      try {
        const res = await fetch(pUrl, { signal: AbortSignal.timeout(4500) });
        if (!res.ok) continue;
        const csvText = await res.text();
        const lines = csvText.trim().split(/\r?\n/);
        if (lines.length < 3) continue;
        const obs = [];
        for (let i = Math.max(1, lines.length - (count || 16)); i < lines.length; i++) {
          const cols = lines[i].split(',');
          if (cols.length >= 2) {
            const dt = cols[0].trim();
            const val = parseFloat(cols[1].trim());
            if (/^\d{4}-\d{2}-\d{2}$/.test(dt) && !isNaN(val)) {
              obs.push({ date: dt, period: dt.slice(0, 7), value: val });
            }
          }
        }
        if (obs.length > 0) return obs;
      } catch (e) {}
    }
    return null;
  }

  async function syncMacroIndicatorsFromFredClient() {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let fredUpdated = false;
    const getInd = id => (window.MACRO_INDICATORS_HUB || []).find(x => x.id === id);

    const tasks = [
      async () => {
        const item = getInd('core_pce');
        if (!item) return;
        const obs = await fetchFredSeriesObservations('PCEPILFE', 16);
        if (obs && obs.length >= 13) {
          const latest = obs[obs.length - 1], prev12 = obs[obs.length - 13];
          const prev1 = obs[obs.length - 2], prev13 = obs[obs.length - 14];
          if (latest.period > (item.referencePeriod || '2026-08')) {
            const yoy = ((latest.value / prev12.value) - 1.0) * 100.0;
            const prevYoy = ((prev1.value / prev13.value) - 1.0) * 100.0;
            item.value = `${yoy.toFixed(1)}%`;
            item.numericValue = Number(yoy.toFixed(1));
            item.prevValue = `${prevYoy.toFixed(1)}%`;
            item.metaLeft = `前期: ${prevYoy.toFixed(1)}% ｜ 預期: ${item.consensus || item.value}`;
            item.referencePeriod = latest.period;
            resolveMacroReleaseSchedule(item, todayStr, true);
            fredUpdated = true;
          }
        }
      },
      async () => {
        const item = getInd('headline_pce');
        if (!item) return;
        const obs = await fetchFredSeriesObservations('PCEPI', 16);
        if (obs && obs.length >= 13) {
          const latest = obs[obs.length - 1], prev12 = obs[obs.length - 13];
          const prev1 = obs[obs.length - 2], prev13 = obs[obs.length - 14];
          if (latest.period > (item.referencePeriod || '2026-08')) {
            const yoy = ((latest.value / prev12.value) - 1.0) * 100.0;
            const prevYoy = ((prev1.value / prev13.value) - 1.0) * 100.0;
            item.value = `${yoy.toFixed(1)}%`;
            item.numericValue = Number(yoy.toFixed(1));
            item.prevValue = `${prevYoy.toFixed(1)}%`;
            item.metaLeft = `前期: ${prevYoy.toFixed(1)}% ｜ 預期: ${item.consensus || item.value}`;
            item.referencePeriod = latest.period;
            resolveMacroReleaseSchedule(item, todayStr, true);
            fredUpdated = true;
          }
        }
      },
      async () => {
        const item = getInd('nfp');
        if (!item) return;
        const obs = await fetchFredSeriesObservations('PAYEMS', 6);
        if (obs && obs.length >= 3) {
          const latest = obs[obs.length - 1], prev1 = obs[obs.length - 2], prev2 = obs[obs.length - 3];
          if (latest.period > (item.referencePeriod || '2026-09')) {
            const diffWan = (latest.value - prev1.value) / 10.0;
            const prevWan = (prev1.value - prev2.value) / 10.0;
            const sign = diffWan >= 0 ? '+' : '';
            item.value = `${sign}${diffWan.toFixed(1)} 萬人`;
            item.numericValue = Number(diffWan.toFixed(1));
            item.prevValue = `${prevWan.toFixed(1)} 萬`;
            item.metaLeft = `前期: ${prevWan.toFixed(1)} 萬 ｜ 均值: ${item.consensus || '4.5 萬'}`;
            item.referencePeriod = latest.period;
            resolveMacroReleaseSchedule(item, todayStr, true);
            fredUpdated = true;
          }
        }
      },
      async () => {
        const item = getInd('adp');
        if (!item) return;
        const obs = await fetchFredSeriesObservations('ADPMNUSNERSA', 6);
        if (obs && obs.length >= 3) {
          const latest = obs[obs.length - 1], prev1 = obs[obs.length - 2], prev2 = obs[obs.length - 3];
          if (latest.period > (item.referencePeriod || '2026-09')) {
            const divisor = latest.value > 500000 ? 10000.0 : 10.0;
            const diffWan = (latest.value - prev1.value) / divisor;
            const prevWan = (prev1.value - prev2.value) / divisor;
            const sign = diffWan >= 0 ? '+' : '';
            item.value = `${sign}${diffWan.toFixed(1)} 萬人`;
            item.numericValue = Number(diffWan.toFixed(1));
            item.prevValue = `${prevWan.toFixed(1)} 萬`;
            item.metaLeft = `前期: ${prevWan.toFixed(1)} 萬 ｜ 預期: ${item.consensus || '8.0 萬'}`;
            item.referencePeriod = latest.period;
            resolveMacroReleaseSchedule(item, todayStr, true);
            fredUpdated = true;
          }
        }
      },
      async () => {
        const item = getInd('unrate');
        if (!item) return;
        const obs = await fetchFredSeriesObservations('UNRATE', 6);
        if (obs && obs.length >= 2) {
          const latest = obs[obs.length - 1], prev1 = obs[obs.length - 2];
          if (latest.period > (item.referencePeriod || '2026-09')) {
            item.value = `${latest.value.toFixed(1)}%`;
            item.numericValue = Number(latest.value.toFixed(1));
            item.prevValue = `${prev1.value.toFixed(1)}%`;
            item.metaLeft = `前期: ${prev1.value.toFixed(1)}% ｜ 預期: ${latest.value.toFixed(1)}%`;
            item.referencePeriod = latest.period;
            resolveMacroReleaseSchedule(item, todayStr, true);
            fredUpdated = true;
          }
        }
      },
      async () => {
        const item = getInd('ppi');
        if (!item) return;
        const [obsH, obsC] = await Promise.all([
          fetchFredSeriesObservations('PPIFIS', 16),
          fetchFredSeriesObservations('PPIFES', 16)
        ]);
        if (obsH && obsH.length >= 13 && obsC && obsC.length >= 13) {
          const latestH = obsH[obsH.length - 1], prev12H = obsH[obsH.length - 13];
          const prev1H = obsH[obsH.length - 2], prev13H = obsH[obsH.length - 14];
          const latestC = obsC[obsC.length - 1], prev12C = obsC[obsC.length - 13];
          if (latestH.period > (item.referencePeriod || '2026-09')) {
            const yoyH = ((latestH.value / prev12H.value) - 1.0) * 100.0;
            const prevYoyH = ((prev1H.value / prev13H.value) - 1.0) * 100.0;
            const yoyC = ((latestC.value / prev12C.value) - 1.0) * 100.0;
            item.value = `${yoyH.toFixed(1)}% / ${yoyC.toFixed(1)}%`;
            item.numericValue = Number(yoyH.toFixed(1));
            item.coreNumericValue = Number(yoyC.toFixed(1));
            item.prevValue = `${prevYoyH.toFixed(1)}%`;
            item.metaLeft = `核心預期: ${item.consensus || `${yoyC.toFixed(1)}%`} ｜ 整體前期: ${prevYoyH.toFixed(1)}%`;
            item.referencePeriod = latestH.period;
            resolveMacroReleaseSchedule(item, todayStr, true);
            fredUpdated = true;
          }
        }
      }
    ];

    await Promise.allSettled(tasks.map(fn => fn()));
    return fredUpdated;
  }

  async function syncMacroIndicatorsFromCloud(manualTrigger) {
    let updatedFrom = null;
    let syncDateTag = '';

    const jsonPaths = ['./macro_indicators.json', '../macro_indicators.json'];
    for (const path of jsonPaths) {
      try {
        const res = await fetch(`${path}?t=${Date.now()}`, { signal: AbortSignal.timeout(3500) });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && Array.isArray(data.indicators) && data.indicators.length >= 6) {
          window.MACRO_INDICATORS_HUB = data.indicators;
          if (data.updatedAt && /^\d{4}-\d{2}-\d{2}/.test(data.updatedAt)) {
            syncDateTag = ` · ${data.updatedAt.slice(5, 7)}/${data.updatedAt.slice(8, 10)} 更新`;
          }
          updatedFrom = `官方排程 JSON 同步${syncDateTag}`;
          applyMacroIndicatorsToPage(window.MACRO_INDICATORS_HUB, updatedFrom);
          break;
        }
      } catch (e) {}
    }

    const sheetUrls = [
      `https://docs.google.com/spreadsheets/d/${LIVE_QUOTES_SHEET_ID}/gviz/tq?tqx=out:json&sheet=MacroIndicators&t=${Date.now()}`,
      `https://docs.google.com/spreadsheets/d/${MAIN_VALUATION_SHEET_ID}/gviz/tq?tqx=out:json&sheet=MacroIndicators&t=${Date.now()}`
    ];
    for (const sUrl of sheetUrls) {
      try {
        const res = await fetch(sUrl, { signal: AbortSignal.timeout(3500) });
        if (!res.ok) continue;
        const txt = await res.text();
        const match = txt.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?/);
        if (!match) continue;
        const json = JSON.parse(match[1]);
        const rows = (json.table && json.table.rows) || [];
        let matched = 0;
        rows.forEach(r => {
          const c = r.c || [];
          const id = c[0] && c[0].v ? String(c[0].v).trim() : '';
          const target = window.MACRO_INDICATORS_HUB.find(x => x.id === id);
          if (target) {
            const val = c[2] && c[2].v !== null ? String(c[2].f || c[2].v).trim() : '';
            const metaLeft = c[3] && c[3].v !== null ? String(c[3].v).trim() : '';
            const relDate = c[4] && c[4].v !== null ? String(c[4].f || c[4].v).trim() : '';
            const nextRel = c[5] && c[5].v !== null ? String(c[5].f || c[5].v).trim() : '';
            const bText = c[6] && c[6].v !== null ? String(c[6].v).trim() : '';
            const bClass = c[7] && c[7].v !== null ? String(c[7].v).trim() : '';
            if (val) target.value = val;
            if (metaLeft) target.metaLeft = metaLeft;
            if (relDate) target.releaseDate = relDate;
            if (nextRel) target.nextReleaseDate = nextRel;
            if (bText) target.badgeText = bText;
            if (bClass) target.badgeClass = bClass;
            matched++;
          }
        });
        if (matched >= 4) {
          updatedFrom = 'Google Sheets 雲端中樞同步';
          applyMacroIndicatorsToPage(window.MACRO_INDICATORS_HUB, updatedFrom);
          break;
        }
      } catch (e) {}
    }

    // 若使用者手動點擊同步，或有指標已抵達發布日，啟動前端 FRED 即時序列檢核
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const needsFredCheck = manualTrigger || (window.MACRO_INDICATORS_HUB || []).some(ind => !ind.nextReleaseDate || ind.nextReleaseDate <= todayStr);
    if (needsFredCheck) {
      try {
        const fredChanged = await syncMacroIndicatorsFromFredClient();
        if (fredChanged) {
          updatedFrom = 'FRED 官方序列即時同步';
          applyMacroIndicatorsToPage(window.MACRO_INDICATORS_HUB, updatedFrom);
        }
      } catch (e) {}
    }

    try {
      localStorage.setItem('MACRO_INDICATORS_HUB_CACHE', JSON.stringify({
        updatedAt: new Date().toISOString(),
        indicators: window.MACRO_INDICATORS_HUB
      }));
    } catch (e) {}

    return !!updatedFrom;
  }

  window.syncMacroIndicatorsFromCloud = syncMacroIndicatorsFromCloud;

  function earningsDay(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date) / DAY_MS : NaN;
  }

  function safeEarningsLink(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function escapeEarningsText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function resolveEarningsStatus(targetDateStr, sym) {
    const today = earningsDay(US_DATE.format(new Date()));
    const target = earningsDay(targetDateStr);
    const report = reportedEarnings.get(sym);
    const reportedDay = earningsDay(report?.reportDate);
    const rawDiff = target - today;
    const recentReport = reportedDay >= today - 3 && reportedDay <= today;
    const matchesSchedule = !Number.isFinite(target) || (rawDiff <= 1 && reportedDay >= target - 1);

    if (recentReport && matchesSchedule) {
      return { days: 0, displayDate: report.reportDate, badgeText: '已收錄財報', isReported: true };
    }
    if (!Number.isFinite(target)) {
      return { days: 9999, displayDate: '—', badgeText: '日期待確認' };
    }
    if (rawDiff >= -3 && rawDiff <= 0) {
      return {
        days: 0,
        displayDate: targetDateStr,
        badgeText: rawDiff < 0 ? '已過預定日・待核對' : '今日預計公布'
      };
    }
    if (rawDiff < -3) {
      const explicitNext = window.EARNINGS_HUB?.recentDiagnostics?.find(item =>
        item.symbol === sym && item.reportDate === targetDateStr)?.nextReportDate;
      const nextDay = earningsDay(explicitNext);
      if (nextDay > today) {
        return { days: nextDay - today, displayDate: explicitNext, isRolled: true };
      }
      const estimate = target + Math.ceil(-rawDiff / 90) * 90;
      return {
        days: estimate - today,
        displayDate: new Date(estimate * DAY_MS).toISOString().slice(0, 10),
        isRolled: true
      };
    }
    return { days: rawDiff, displayDate: targetDateStr };
  }

  window.resolveEarningsStatus = resolveEarningsStatus;

  function formatReportedAmounts(result) {
    const currency = result.currency;
    const revenue = Math.abs(result.revenue) >= 1e8
      ? `${currency} ${MONEY_NUMBER.format(result.revenue / 1e8)} 億`
      : `${currency} ${MONEY_NUMBER.format(result.revenue)}`;
    const eps = `${currency} ${MONEY_NUMBER.format(result.eps)}`;
    const perUnit = result.epsBasis === 'ADS' ? '／ADS' : result.symbol === 'TSM' ? '／普通股' : '';
    const epsLabel = result.epsBasis === 'class_b' ? 'B 股等值 EPS' : '稀釋 EPS';
    return `營收 ${revenue} · ${result.accounting} ${epsLabel} ${eps}${perUnit}`;
  }

  function renderDynamicEarningsPanel() {
    const cardsContainer = document.getElementById('lq-dynamic-cards-grid');
    if (!cardsContainer) return;

    const today = earningsDay(US_DATE.format(new Date()));
    const hub = window.EARNINGS_HUB || EARNINGS_HUB_SNAPSHOT;
    const stockList = typeof stocks !== 'undefined' && Array.isArray(stocks) ? stocks : [];
    const companies = new Map(stockList.map(stock => [stock.t, stock]));
    const previewList = Array.isArray(hub.upcomingPreviews) ? hub.upcomingPreviews : [];
    const previews = new Map(previewList.filter(item => EARNINGS_SYMBOL.test(item?.symbol)).map(item => [item.symbol, item]));
    const schedule = new Map(stockList.map(stock => [stock.t, stock._origEd || stock.ed]));
    previews.forEach((item, symbol) => {
      if (!schedule.has(symbol)) schedule.set(symbol, item.earningsDate);
    });

    const upcoming = Array.from(schedule, ([symbol, date]) => ({ symbol, date, days: earningsDay(date) - today }))
      .filter(item => {
        const report = reportedEarnings.get(item.symbol);
        const alreadyReported = report && earningsDay(report.reportDate) >= earningsDay(item.date) - 1;
        return item.days >= 0 && item.days <= 14 && !alreadyReported;
      })
      .sort((a, b) => a.days - b.days || a.symbol.localeCompare(b.symbol));
    const results = Array.from(reportedEarnings.values())
      .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || a.symbol.localeCompare(b.symbol));

    const renderResult = result => {
      const company = companies.get(result.symbol)?.n;
      const name = escapeEarningsText(company ? `${result.symbol}（${company}）` : result.symbol);
      const period = result.quarter ? `${escapeEarningsText(result.quarter)} · ` : '';
      return `<li style="margin:0 0 5px;">
        <strong>${name}</strong> · ${result.reportDate} · ${period}季末 ${result.periodEnd}<br>
        ${formatReportedAmounts(result)}
        <a href="${escapeEarningsText(result.sourceUrl)}" target="_blank" rel="noopener" style="color:#4c1d95; text-decoration:underline;">${escapeEarningsText(result.sourceName || '官方來源')} ↗</a>
      </li>`;
    };
    const listStyle = 'font-size:11.5px; color:#475569; line-height:1.55; margin:8px 0; padding-left:18px;';
    const resultsMessage = reportedEarningsSyncFailed
      ? (results.length ? '暫時無法同步，以下為先前取得的結果。' : '暫時無法取得官方財報資料，請稍後重新同步。')
      : (reportedEarningsUpdatedAt ? '目前沒有可顯示的官方財報資料。' : '正在讀取官方財報資料…');
    const syncLabel = reportedEarningsUpdatedAt
      ? `資料更新 ${SYNC_TIME.format(reportedEarningsUpdatedAt)} 台北時間 · ${results.length} 檔`
      : '';
    const moreOpen = cardsContainer.querySelector('#lq-more-reported')?.open ? ' open' : '';
    const calibrationOpen = cardsContainer.querySelector('#lq-model-actions')?.open ? ' open' : '';

    const upcomingHtml = upcoming.slice(0, 6).map(({ symbol, date, days }) => {
      const company = companies.get(symbol)?.n || previews.get(symbol)?.name;
      const name = escapeEarningsText(company ? `${symbol}（${company}）` : symbol);
      const timing = days ? `預計 ${days} 天後` : '今日預計公布';
      return `<li style="margin:0 0 5px;"><strong>${name}</strong> · ${date} · ${timing}</li>`;
    }).join('');

    // EPS 校準僅使用既有估值假設，官方單季數字不直接代入模型。
    const calibrationItems = EARNINGS_HUB_SNAPSHOT.recentDiagnostics.slice(0, 3).map(item => ({
      symbol: item.symbol, oldEps27: item.oldEps27,
      newEps27: item.newEps27, newEps28: item.newEps28, newEps29: item.newEps29
    }));
    upcoming.slice(0, 2).forEach(({ symbol, date }) => {
      const preview = previews.get(symbol);
      if (preview?.earningsDate !== date || ![preview.oldEps27, preview.bullEps27, preview.bullEps28, preview.bullEps29].every(Number.isFinite)) return;
      calibrationItems.push({
        symbol, oldEps27: preview.oldEps27, newEps27: preview.bullEps27,
        newEps28: preview.bullEps28, newEps29: preview.bullEps29
      });
    });

    cardsContainer.innerHTML = `
      <div style="background:#ffffff; border:1px solid #ddd6fe; border-left:4px solid #7c3aed; border-radius:8px; padding:12px 14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:6px; flex-wrap:wrap;">
          <strong style="font-size:13px; color:#1e1b4b;">🔔 最新已公布財報</strong>
          <span style="font-size:10.5px; color:#6d28d9;">${syncLabel}</span>
        </div>
        <div style="font-size:11px; color:#475569;">每檔顯示最新一季 · 公布或申報日期採美東時間</div>
        ${reportedEarningsSyncFailed || !results.length ? `<p style="font-size:11.5px; color:#475569; margin:7px 0;">${resultsMessage}</p>` : ''}
        ${reportedEarningsSecUnavailable ? '<p style="font-size:11.5px; color:#92400e; margin:7px 0;">SEC 財報來源暫時無法連線，部分公司可能尚未更新。</p>' : ''}
        ${results.length ? `<ul style="${listStyle}">${results.slice(0, 4).map(renderResult).join('')}</ul>` : ''}
        ${results.length > 4 ? `
          <details id="lq-more-reported"${moreOpen}>
            <summary style="font-size:11.5px; font-weight:700; color:#4c1d95; cursor:pointer;">查看其餘 ${results.length - 4} 檔</summary>
            <ul style="${listStyle}">${results.slice(4).map(renderResult).join('')}</ul>
          </details>` : ''}
      </div>

      <div style="background:#ffffff; border:1px solid #fde047; border-left:4px solid #ca8a04; border-radius:8px; padding:12px 14px;">
        <strong style="font-size:13px; color:#132a18;">⚡ 未來 14 天財報預告</strong>
        <div style="font-size:11px; color:#475569; margin-top:6px;">日期為排程預估（美東時間）</div>
        ${upcomingHtml ? `<ul style="${listStyle}">${upcomingHtml}</ul>` : `<p style="font-size:11.5px; color:#475569; margin:7px 0;">目前沒有待公布的排程。</p>`}
        <details id="lq-model-actions"${calibrationOpen}>
          <summary style="font-size:11.5px; font-weight:700; color:#475569; cursor:pointer;">估值模型 EPS 情境</summary>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:6px;">
            ${calibrationItems.map(item => `
              <button type="button" onclick="window.applyEarningsCalibration('${item.symbol}', ${item.newEps27}, ${item.newEps28}, ${item.newEps29})" style="font-size:11px; font-weight:700; color:#4c1d95; background:#f5f3ff; border:1px solid #c4b5fd; padding:5px 10px; border-radius:6px; cursor:pointer;">預演 ${item.symbol} EPS ($${item.oldEps27.toFixed(2)}→$${item.newEps27.toFixed(2)})</button>
              <span id="calib-status-${item.symbol}" style="font-size:11px; color:#6d28d9;"></span>`).join('')}
            <button type="button" onclick="window.resetEarningsCalibrations()" style="font-size:11px; color:#475569; background:#f1f5f9; border:1px solid #cbd5e1; padding:5px 10px; border-radius:6px; cursor:pointer;">還原預設 EPS</button>
          </div>
        </details>
      </div>`;
  }

  window.renderDynamicEarningsPanel = renderDynamicEarningsPanel;

  // 將報價與財報日期字典套用至頁面上的 stocks / GOOGLE_FINANCE_LATEST_CLOSES / FCN 模擬器並重繪
  function setValuationQuoteStatus(message) {
    if (!document.getElementById('valuation-section')) return;
    const status = document.getElementById('livequotes-hub-status');
    if (status) status.textContent = message;
  }

  function applyModelCalibration(stock, calibration) {
    const fields = MODEL_EPS_FIELDS.filter(field => Number.isFinite(calibration?.[field]));
    if (!fields.length) return false;
    if (!stock._valuationOriginalEps) {
      stock._valuationOriginalEps = Object.fromEntries(MODEL_EPS_FIELDS
        .filter(field => Object.prototype.hasOwnProperty.call(stock, field))
        .map(field => [field, stock[field]]));
    }
    fields.forEach(field => { stock[field] = calibration[field]; });
    stock._valuationCalibrationAt = typeof calibration.updatedAt === 'string'
      && Number.isFinite(Date.parse(calibration.updatedAt)) ? calibration.updatedAt : null;
    return true;
  }

  function recentObservedStockQuote(stock) {
    const quote = stock._observedQuote;
    const elapsed = Date.now() - Date.parse(quote?.observedAt);
    return quote && elapsed >= -300_000 && elapsed <= 7 * DAY_MS ? quote : null;
  }

  function applyQuotesToPage(quotesMap, sourceLabel) {
    if (!quotesMap) return;
    const isValuationPage = !!document.getElementById('valuation-section');

    if (!isValuationPage) {
      const now = new Date();
      const todayStr = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
      document.querySelectorAll('.header p').forEach(pEl => {
        if (pEl.textContent.includes('基準日：')) {
          pEl.textContent = pEl.textContent.replace(/基準日：[^｜]+/, `基準日：${todayStr} (雲端即時同步) `);
        }
      });
    }

    if (typeof GOOGLE_FINANCE_LATEST_CLOSES !== 'undefined') {
      Object.keys(quotesMap).forEach(sym => {
        const q = quotesMap[sym];
        if (!q || !q.price) return;
        if (typeof GOOGLE_FINANCE_LATEST_CLOSES[sym] === 'object' && GOOGLE_FINANCE_LATEST_CLOSES[sym] !== null) {
          GOOGLE_FINANCE_LATEST_CLOSES[sym].current = q.price;
        } else {
          GOOGLE_FINANCE_LATEST_CLOSES[sym] = q.price;
        }
      });
    }

    if (typeof stocks !== 'undefined' && Array.isArray(stocks)) {
      if (!stocks.some(s => s.t === 'NFLX')) {
        stocks.splice(18, 0, {
          t: "NFLX", n: "Netflix", s: "數位娛樂串流", cat: "CLOUD",
          sp500: true, nasdaq: true, dow: false,
          p: 68.69, ed: "2027-01-19", eps27: 2.52, eps28: 2.95, eps29: 3.40, pe: 28, mult: 0.96
        });
      }
      // 強制校準 NFLX (拆股後基期 1:10) 與 TSM (最新 ADR EPS 基期 $20.50)，消除估值失真
      stocks.forEach(s => {
        if (s._valuationOriginalEps) return;
        if (s.t === 'NFLX' && s.eps27 > 10) {
          s.eps27 = 2.52; s.eps28 = 2.95; s.eps29 = 3.40;
        }
        if (s.t === 'TSM' && s.eps27 < 15) {
          s.eps27 = 20.50; s.eps28 = 23.50; s.eps29 = 26.60;
        }
      });

      const hubDates = (window.EARNINGS_HUB && window.EARNINGS_HUB.earningsDates) || EARNINGS_HUB_SNAPSHOT.earningsDates || {};

      stocks.forEach(s => {
        // 優先採用 earnings_hub.json 或 Google Sheets 同步之最新財報日
        if (hubDates[s.t]) {
          s._origEd = hubDates[s.t];
        } else if (!s._origEd) {
          s._origEd = s.ed;
        }

        const q = quotesMap[s.t];
        if (q) {
          // Bundled and Sheets prices do not carry a market observation time.
          if (q.price > 0 && !recentObservedStockQuote(s)) s.p = q.price;
          if (q.chgPct !== undefined) s.chg = q.chgPct;
          if (q.high52) s.high52 = q.high52;
          if (q.low52) s.low52 = q.low52;
          if (q.sheetEd && /^\d{4}-\d{2}-\d{2}$/.test(q.sheetEd)) {
            s._origEd = q.sheetEd;
          }
        }

        const status = resolveEarningsStatus(s._origEd, s.t);
        s._earnStatus = status;
        s.ed = status.displayDate;
      });

      try {
        const savedCalib = JSON.parse(localStorage.getItem('EPS_CALIBRATIONS_V1') || '{}') || {};
        Object.entries(savedCalib).forEach(([sym, calibration]) => {
          const st = stocks.find(x => x.t === sym);
          if (st) applyModelCalibration(st, calibration);
        });
      } catch (e) {}

      if (typeof renderTable === 'function') {
        renderTable();
        decorateEarningsAndQuotesCells();
      }
      if (typeof calcPortfolioRisk === 'function') {
        calcPortfolioRisk();
      }
    }

    renderDynamicEarningsPanel();

    const statusEl = document.getElementById('livequotes-hub-status');
    if (statusEl && sourceLabel && !isValuationPage) {
      statusEl.innerHTML = `🟢 <strong>LiveQuotes 雲端報價與財報排程中樞已同步</strong> (${sourceLabel}) ｜ 已即時更新 ${Object.keys(quotesMap).length} 檔美股現價、六大總經指標與財報倒數`;
    }
  }

  function decorateEarningsAndQuotesCells() {
    const tbody = document.getElementById('tableBody');
    if (!tbody || typeof stocks === 'undefined') return;

    const rows = tbody.querySelectorAll('tr');
    rows.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 13) return;
      const symEl = tds[1].querySelector('.ticker-symbol');
      if (!symEl) return;
      const sym = symEl.textContent.trim();
      const sObj = stocks.find(x => x.t === sym);
      if (!sObj) return;

      const priceTd = tds[5];
      if (priceTd && !priceTd.dataset.lqDecorated && Number.isFinite(sObj.p) && sObj.p > 0) {
        priceTd.dataset.lqDecorated = "1";
        const quote = recentObservedStockQuote(sObj);
        const displayedQuote = quote?.price === sObj.p ? quote : null;
        const chg = sObj.chg;
        const chgHtml = !displayedQuote && (chg !== undefined && chg !== null && !isNaN(chg))
          ? `<div style="font-size:10px; font-weight:700; color:${chg >= 0 ? '#059669' : '#e11d48'};">${chg >= 0 ? '▲ +' : '▼ '}${Number(chg).toFixed(2)}%</div>`
          : '';
        const rangeTitle = !displayedQuote && (sObj.low52 && sObj.high52)
          ? `52週高低點: $${Number(sObj.low52).toFixed(2)} ~ $${Number(sObj.high52).toFixed(2)}`
          : '';
        if (rangeTitle) priceTd.setAttribute('title', rangeTitle);
        const quoteHtml = displayedQuote
          ? `<div style="font-size:10px; white-space:nowrap;"><a href="${escapeEarningsText(displayedQuote.sourceUrl)}" target="_blank" rel="noopener">CNBC ${escapeEarningsText(displayedQuote.observedDate)}（美東）</a></div>`
          : '';
        priceTd.innerHTML = `<div class="mono" style="font-weight:700;">$${sObj.p.toFixed(2)}</div>${quoteHtml || chgHtml}`;
      }

      const edTd = tds[11];
      const daysTd = tds[12];
      const st = sObj._earnStatus || resolveEarningsStatus(sObj._origEd || sObj.ed, sObj.t);
      const report = reportedEarnings.get(sym);
      if (report) {
        edTd.title = `最近已公布財報（${report.reportDate}）：${formatReportedAmounts(report)}`;
      }
      if (st.isReported && report) {
        const link = document.createElement('a');
        link.className = 'countdown-badge badge-normal mono';
        link.href = report.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = `${st.badgeText} ↗`;
        daysTd.replaceChildren(link);
      } else if (st.badgeText) {
        daysTd.innerHTML = `<span class="countdown-badge badge-normal mono">${st.badgeText}</span>`;
      } else if (st.isRolled) {
        edTd.textContent = `${st.displayDate}（估）`;
        daysTd.innerHTML = `<span class="countdown-badge badge-normal mono">${st.days} 天（估）</span>`;
      }
    });
  }

  function hookRenderTable() {
    if (typeof window.renderTable === 'function' && !window.renderTable._lqHooked) {
      const origRender = window.renderTable;
      const wrapped = function () {
        origRender.apply(this, arguments);
        decorateEarningsAndQuotesCells();
      };
      wrapped._lqHooked = true;
      window.renderTable = wrapped;
    }
  }

  // 注入「方向一 LiveQuotes 雲端報價中樞 ＋ 方向二 財報季開獎診斷與 EPS 模型動態校準」互動面板
  function injectUpgradePanels() {
    const valSection = document.getElementById('valuation-section');
    if (valSection && !document.getElementById('lq-earnings-calibration-panel')) {
      const panel = document.createElement('div');
      panel.id = 'lq-earnings-calibration-panel';
      panel.style.cssText = 'background: linear-gradient(135deg, #ffffff 0%, #f0fdf4 60%, #f5f3ff 100%); border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);';

      panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #e2e8f0;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="background:#059669; color:#fff; font-size:11px; font-weight:800; padding:3px 9px; border-radius:999px;">股價、財報與總經資料</span>
            <span id="livequotes-hub-status" style="font-size:12.5px; color:#132a18;">🟢 <strong>LiveQuotes 雲端報價與財報排程中樞連線中...</strong></span>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <a href="https://docs.google.com/spreadsheets/d/${LIVE_QUOTES_SHEET_ID}/edit" target="_blank" style="font-size:11.5px; font-weight:700; color:#059669; background:#ecfdf5; border:1px solid #a7f3d0; padding:4px 10px; border-radius:6px; text-decoration:none;">📊 開啟 LiveQuotes 雲端表 ↗</a>
            <a href="https://docs.google.com/spreadsheets/d/${MAIN_VALUATION_SHEET_ID}/edit" target="_blank" style="font-size:11.5px; font-weight:700; color:#1d4ed8; background:#eff6ff; border:1px solid #bfdbfe; padding:4px 10px; border-radius:6px; text-decoration:none;">📑 主估值追蹤試算表 ↗</a>
            <button type="button" onclick="window.syncEarningsHubFromCloud(true); window.syncLiveQuotesFromCloud(true); window.syncMacroIndicatorsFromCloud(true);" style="font-size:11.5px; font-weight:700; color:#ffffff; background:#059669; border:none; padding:5px 12px; border-radius:6px; cursor:pointer;">⚡ 重新同步股價、財報與總經數據</button>
          </div>
        </div>
        <div id="lq-dynamic-cards-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap:12px;"></div>
      `;

      valSection.insertAdjacentElement('afterend', panel);
      renderDynamicEarningsPanel();
    }

    const portalsGrid = document.querySelector('.portals-grid');
    if (portalsGrid && !document.getElementById('lq-earnings-calibration-panel') && !document.getElementById('lq-portal-banner')) {
      const banner = document.createElement('div');
      banner.id = 'lq-portal-banner';
      banner.style.cssText = 'background: linear-gradient(135deg, #ffffff 0%, #f0fdf4 65%, #fefce8 100%); border: 1px solid #cbd5e1; border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);';
      banner.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <span style="background:#059669; color:#fff; font-size:10.5px; font-weight:800; padding:2px 8px; border-radius:999px;">LIVE CLOUD HUB</span>
              <strong style="font-size:14.5px; color:#132a18;">GOOGLEFINANCE 雲端即時股價、六大總經指標 (FRED) ＆ Q3 財報季動態校準雷達</strong>
            </div>
            <div id="livequotes-hub-status" style="font-size:12px; color:#556d59;">
              🟢 已直連 Google Sheets 雙雲端中樞 ｜ MSFT / META / GOOGL / KLAC / CDNS / TSLA / TXN 已開獎・今晚 AAPL ＆ AMZN 壓軸登場
            </div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" onclick="window.syncEarningsHubFromCloud(true); window.syncMacroIndicatorsFromCloud(true); window.syncLiveQuotesFromCloud(true);" style="font-size:12px; font-weight:700; color:#ffffff; background:#059669; border:none; padding:6px 12px; border-radius:8px; cursor:pointer;">⚡ 立即同步最新數據</button>
            <a href="https://docs.google.com/spreadsheets/d/${LIVE_QUOTES_SHEET_ID}/edit" target="_blank" style="font-size:12px; font-weight:700; color:#059669; background:#ecfdf5; border:1px solid #a7f3d0; padding:6px 12px; border-radius:8px; text-decoration:none;">📊 LiveQuotes 試算表 ↗</a>
            <a href="./nasdaq/#valuation-section" style="font-size:12px; font-weight:700; color:#6d28d9; background:#f5f3ff; border:1px solid #c4b5fd; padding:6px 12px; border-radius:8px; text-decoration:none;">🔔 前往財報 EPS 校準面板 →</a>
          </div>
        </div>
      `;
      portalsGrid.insertAdjacentElement('beforebegin', banner);
    }
  }

  window.applyEarningsCalibration = function (sym, eps27, eps28, eps29) {
    if (typeof stocks === 'undefined') return;
    const st = stocks.find(x => x.t === sym);
    if (!st) return;

    const calibration = { eps27, eps28, eps29, updatedAt: new Date().toISOString() };
    if (!MODEL_EPS_FIELDS.every(field => Number.isFinite(calibration[field]))) return;
    applyModelCalibration(st, calibration);

    try {
      const saved = JSON.parse(localStorage.getItem('EPS_CALIBRATIONS_V1') || '{}') || {};
      saved[sym] = calibration;
      localStorage.setItem('EPS_CALIBRATIONS_V1', JSON.stringify(saved));
    } catch (e) {}

    if (typeof renderTable === 'function') renderTable();
    if (typeof calcPortfolioRisk === 'function') calcPortfolioRisk();

    const lbl = document.getElementById(`calib-status-${sym}`);
    if (lbl) lbl.textContent = `✔ 已套用 ${sym} 估值情境`;
  };

  window.resetEarningsCalibrations = function () {
    try { localStorage.removeItem('EPS_CALIBRATIONS_V1'); } catch (e) {}
    if (typeof stocks !== 'undefined' && Array.isArray(stocks)) {
      stocks.forEach(s => {
        const original = s._valuationOriginalEps;
        if (original) {
          MODEL_EPS_FIELDS.forEach(field => {
            if (Object.prototype.hasOwnProperty.call(original, field)) s[field] = original[field];
            else delete s[field];
          });
          delete s._valuationOriginalEps;
        }
        delete s._valuationCalibrationAt;
      });
      if (typeof renderTable === 'function') renderTable();
      if (typeof calcPortfolioRisk === 'function') calcPortfolioRisk();
    }
    document.querySelectorAll('[id^="calib-status-"]').forEach(label => {
      label.textContent = '已還原預設';
    });
  };

  async function fetchReportedEarnings() {
    try {
      const url = new URL(REPORTED_EARNINGS_URL);
      url.searchParams.set('t', Date.now());
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Official earnings feed unavailable');
      const data = await response.json();
      const updatedAt = new Date(data.updatedAt);
      if (!data.updatedAt || !Number.isFinite(updatedAt.getTime()) || !Array.isArray(data.results)) {
        throw new Error('Invalid official earnings feed');
      }

      const results = new Map();
      for (const row of data.results) {
        const sourceUrl = safeEarningsLink(row?.sourceUrl);
        if (!row || !EARNINGS_SYMBOL.test(row.symbol) || !sourceUrl
            || !Number.isFinite(earningsDay(row.reportDate)) || !Number.isFinite(earningsDay(row.periodEnd))
            || !Number.isFinite(row.revenue) || !Number.isFinite(row.eps)
            || !/^[A-Z]{3}$/.test(row.currency) || !['GAAP', 'IFRS'].includes(row.accounting)) {
          continue;
        }
        const previous = results.get(row.symbol);
        if (!previous || row.periodEnd > previous.periodEnd
            || (row.periodEnd === previous.periodEnd && row.reportDate > previous.reportDate)) {
          results.set(row.symbol, { ...row, sourceUrl });
        }
      }
      if (data.results.length && !results.size) throw new Error('No valid official results');
      if (!reportedEarningsUpdatedAt || updatedAt >= reportedEarningsUpdatedAt) {
        reportedEarnings = results;
        if (Array.isArray(data.cashFlows)) {
          const cashFlows = new Map();
          for (const row of data.cashFlows) {
            const sourceUrl = safeEarningsLink(row?.sourceUrl);
            if (!row || !EARNINGS_SYMBOL.test(row.symbol) || !sourceUrl || !/^[A-Z]{3}$/.test(row.currency)
                || !['GAAP', 'IFRS'].includes(row.accounting)
                || !['ppe', 'productive_assets', 'issuer_capex'].includes(row.capexBasis)
                || !Number.isFinite(earningsDay(row.reportDate)) || !validCashFlowAmounts(row)
                || row.periodEnd > row.reportDate) continue;
            const previous = cashFlows.get(row.symbol);
            if (!previous || row.periodEnd > previous.periodEnd
                || (row.periodEnd === previous.periodEnd && row.reportDate > previous.reportDate)) {
              const supportingSources = (Array.isArray(row.supportingSources) ? row.supportingSources : [])
                .flatMap(source => {
                  const url = safeEarningsLink(source?.sourceUrl);
                  return url ? [{ sourceUrl: url, sourceName: source.sourceName }] : [];
                });
              const period = row.reportedPeriod;
              const reportedPeriod = validCashFlowAmounts(period) && period.periodEnd === row.periodEnd
                && ['quarter', 'ytd'].includes(period.periodType) ? period : null;
              cashFlows.set(row.symbol, { ...row, sourceUrl, supportingSources, reportedPeriod });
            }
          }
          reportedCashFlows = cashFlows;
        }
        if (Array.isArray(data.trailingEps)) {
          const trailing = new Map();
          for (const row of data.trailingEps) {
            const sourceUrl = safeEarningsLink(row?.sourceUrl);
            if (!row || !EARNINGS_SYMBOL.test(row.symbol) || !sourceUrl || row.currency !== 'USD'
                || row.epsBasis !== 'share' || !Number.isFinite(row.eps)
                || !['reported_annual', 'calculated_ttm'].includes(row.method)
                || ![row.periodStart, row.periodEnd, row.reportDate].every(value => Number.isFinite(earningsDay(value)))
                || row.periodStart >= row.periodEnd || row.periodEnd > row.reportDate) continue;
            const days = earningsDay(row.periodEnd) - earningsDay(row.periodStart) + 1;
            if (days < 345 || days > 385) continue;
            const previous = trailing.get(row.symbol);
            if (previous && (row.periodEnd < previous.periodEnd
                || (row.periodEnd === previous.periodEnd && row.reportDate < previous.reportDate))) continue;
            const supportingSources = (Array.isArray(row.supportingSources) ? row.supportingSources : [])
              .flatMap(source => {
                const url = safeEarningsLink(source?.sourceUrl);
                return url ? [{ sourceUrl: url, sourceName: source.sourceName }] : [];
              });
            if (row.method === 'calculated_ttm' && !supportingSources.length) continue;
            trailing.set(row.symbol, { ...row, sourceUrl, supportingSources });
          }
          reportedTrailingEps = trailing;
        }
        reportedEarningsUpdatedAt = updatedAt;
        reportedEarningsSecUnavailable = data.secStatus === 'unavailable';
      }
      reportedEarningsSyncFailed = false;
      applyQuotesToPage(window.LIVE_QUOTES_HUB);
      return true;
    } catch {
      reportedEarningsSyncFailed = true;
      renderDynamicEarningsPanel();
      return false;
    }
  }

  function syncReportedEarningsFromCloud() {
    if (!document.getElementById('lq-dynamic-cards-grid')) return Promise.resolve(false);
    if (!reportedEarningsRequest) {
      reportedEarningsRequest = fetchReportedEarnings().finally(() => { reportedEarningsRequest = null; });
    }
    return reportedEarningsRequest;
  }

  async function syncEarningsCalendarFromCloud() {
    const jsonPaths = ['./earnings_hub.json', '../earnings_hub.json'];
    for (const path of jsonPaths) {
      try {
        const res = await fetch(`${path}?t=${Date.now()}`, { signal: AbortSignal.timeout(3500) });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && (Array.isArray(data.recentDiagnostics) || data.earningsDates)) {
          window.EARNINGS_HUB = data;
          applyQuotesToPage(window.LIVE_QUOTES_HUB, '雲端財報排程 JSON 即時同步');
          return true;
        }
      } catch (e) {}
    }
    return false;
  }

  async function syncEarningsHubFromCloud() {
    const results = await Promise.all([syncReportedEarningsFromCloud(), syncEarningsCalendarFromCloud()]);
    return results.some(Boolean);
  }

  window.syncEarningsHubFromCloud = syncEarningsHubFromCloud;

  // 從 Google Sheets LiveQuotes 雲端工作表與主估值表拉取最新 GOOGLEFINANCE 報價與財報日期 (支援 fetch 與 JSONP 雙重通道)
  async function syncLiveQuotesFromCloud(manualTrigger) {
    const sheetUrls = [
      `https://docs.google.com/spreadsheets/d/${LIVE_QUOTES_SHEET_ID}/gviz/tq?tqx=out:json&t=${Date.now()}`,
      `https://docs.google.com/spreadsheets/d/${MAIN_VALUATION_SHEET_ID}/gviz/tq?tqx=out:json&t=${Date.now()}`
    ];

    let anySynced = false;
    let pricesRetrievedAt = null;

    for (const url of sheetUrls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
        if (!res.ok) continue;
        const txt = await res.text();
        const match = txt.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?/);
        if (!match) continue;
        const json = JSON.parse(match[1]);
        const rows = (json.table && json.table.rows) || [];
        let updatedCount = 0;

        rows.forEach(r => {
          const c = r.c || [];
          const c0 = c[0] && c[0].v !== null ? String(c[0].v).trim() : '';
          const c1 = c[1] && c[1].v !== null ? String(c[1].v).trim() : '';

          // 支援 LiveQuotes 與主估值表的報價及財報日期欄位。
          let sym = '';
          let isMainSheetRow = false;
          if (/^[A-Z.]{1,6}$/.test(c0) && c0 !== 'TICKER') {
            sym = c0;
          } else if (/^[A-Z.]{1,6}$/.test(c1) && c1 !== 'TICKER') {
            sym = c1;
            isMainSheetRow = true;
          }
          // 讀取主估值表 B1:B4 頂部總經定錨列 (Data Baseline Date / 10-Year US Treasury Yield / Next FOMC countdown)
          if (!sym) {
            if (c0.includes("Baseline Date") && c1) {
              if (window.EARNINGS_HUB) window.EARNINGS_HUB.baselineDate = c1;
            } else if ((c0.includes("Treasury Yield") || c0.includes("10年期美債")) && c1) {
              const mY = c1.match(/([0-9]+\.[0-9]+)/);
              if (mY && window.EARNINGS_HUB) window.EARNINGS_HUB.us10yYield = parseFloat(mY[1]);
            } else if (c0.includes("FOMC") && c1) {
              const mF = c1.match(/(\d{4}-\d{2}-\d{2})/);
              if (mF && window.EARNINGS_HUB) window.EARNINGS_HUB.fomcNextMeeting = mF[1];
            }
            return;
          }

          if (!isMainSheetRow) {
            const v1 = c[1] && c[1].v !== null ? c[1].v : null;
            const v2 = c[2] && c[2].v !== null ? c[2].v : null;
            const v3 = c[3] && c[3].v !== null ? c[3].v : null;
            const v4 = c[4] && c[4].v !== null ? c[4].v : null;
            const v5 = c[5] && c[5].v !== null ? c[5].v : null;
            const v7 = c[7] && (c[7].f || c[7].v) ? String(c[7].f || c[7].v).trim() : '';

            let price = null, chgPct = 0, high52 = null, low52 = null;
            if (typeof v1 === 'number' && v1 > 0) {
              price = v1;
              chgPct = typeof v2 === 'number' ? v2 : 0;
              high52 = typeof v3 === 'number' ? v3 : null;
              low52  = typeof v4 === 'number' ? v4 : null;
            } else if (typeof v2 === 'number' && v2 > 0) {
              price = v2;
              chgPct = typeof v3 === 'number' ? v3 : 0;
              high52 = typeof v4 === 'number' ? v4 : null;
              low52  = typeof v5 === 'number' ? v5 : null;
            }

            if (price && price > 0) {
              pricesRetrievedAt = new Date();
              const prev = window.LIVE_QUOTES_HUB[sym] || {};
              const dateMatch = v7.match(/(\d{4}-\d{2}-\d{2})/);
              window.LIVE_QUOTES_HUB[sym] = {
                price: Math.round(price * 100) / 100,
                chgPct: !isNaN(chgPct) ? Math.round(chgPct * 100) / 100 : (prev.chgPct || 0),
                high52: !isNaN(high52) && high52 > 0 ? Math.round(high52 * 100) / 100 : (prev.high52 || null),
                low52:  !isNaN(low52)  && low52 > 0  ? Math.round(low52 * 100) / 100  : (prev.low52 || null),
                sheetEd: dateMatch ? dateMatch[1] : prev.sheetEd
              };
              updatedCount++;
            }
          } else {
            // 主估值表欄位：E 現價、F 下次財報日。
            const pRaw = c[4] && (c[4].f || c[4].v) ? String(c[4].f || c[4].v).replace(/[^0-9.]/g, '') : '';
            const edRaw = c[5] && (c[5].f || c[5].v) ? String(c[5].f || c[5].v).trim() : '';
            const dateMatch = edRaw.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch && window.EARNINGS_HUB && window.EARNINGS_HUB.earningsDates) {
              window.EARNINGS_HUB.earningsDates[sym] = dateMatch[1];
            }
            if (!window.LIVE_QUOTES_HUB[sym]) window.LIVE_QUOTES_HUB[sym] = {};
            const parsedP = parseFloat(pRaw);
            if (!isNaN(parsedP) && parsedP > 0 && !window.LIVE_QUOTES_HUB[sym].price) {
              window.LIVE_QUOTES_HUB[sym].price = parsedP;
              pricesRetrievedAt = new Date();
            }
            if (dateMatch) window.LIVE_QUOTES_HUB[sym].sheetEd = dateMatch[1];
            updatedCount++;
          }
        });

        if (updatedCount >= 10) {
          anySynced = true;
          try {
            localStorage.setItem('LIVE_QUOTES_HUB_CACHE', JSON.stringify({
              updatedAt: new Date().toISOString(),
              quotes: window.LIVE_QUOTES_HUB
            }));
          } catch (e) {}
          applyQuotesToPage(window.LIVE_QUOTES_HUB, 'Google Sheets LiveQuotes 即時連線');
        }
      } catch (err) {}
    }

    if (!anySynced && manualTrigger) {
      applyQuotesToPage(window.LIVE_QUOTES_HUB, 'Google Finance 雲端快照基準 (2026-10-21)');
    }
    if (pricesRetrievedAt) {
      setValuationQuoteStatus(`Google 試算表報價讀取時間（台北）${SYNC_TIME.format(pricesRetrievedAt)}。個別市場報價時間未提供，部分標的可能沿用備援資料。`);
    } else if (manualTrigger) {
      setValuationQuoteStatus('此次未讀到 Google 試算表報價，可能顯示先前報價或內建快照。');
    }
    return anySynced;
  }

  window.syncLiveQuotesFromCloud = syncLiveQuotesFromCloud;

  // 方向五：客戶溝通一鍵情境模式 (Macro Scenario Presets)
  window.applyMacroScenarioPreset = function (yieldRate, scenarioMode, presetKey, btnEl) {
    const yVal = parseFloat(yieldRate) || 5.05;
    const slider = document.getElementById('yieldSlider');
    if (slider) {
      slider.value = yVal.toFixed(2);
    }
    const scenSel = document.getElementById('scenarioSelect');
    if (scenSel && scenarioMode) {
      scenSel.value = scenarioMode;
    }
    if (typeof window.updateYield === 'function') {
      window.updateYield(yVal);
    }
    if (typeof window.calcPortfolioRisk === 'function') {
      window.calcPortfolioRisk();
    }
    document.querySelectorAll('.macro-scenario-btn').forEach(b => {
      b.style.background = '#f8fafc';
      b.style.color = '#334155';
      b.style.borderColor = '#cbd5e1';
      b.style.boxShadow = 'none';
    });
    if (btnEl) {
      if (presetKey === 'soft_landing') {
        btnEl.style.background = '#ecfdf5';
        btnEl.style.color = '#065f46';
        btnEl.style.borderColor = '#10b981';
        btnEl.style.boxShadow = '0 2px 6px rgba(16, 185, 129, 0.18)';
      } else if (presetKey === 'fed_hold') {
        btnEl.style.background = '#eff6ff';
        btnEl.style.color = '#1e40af';
        btnEl.style.borderColor = '#3b82f6';
        btnEl.style.boxShadow = '0 2px 6px rgba(59, 130, 246, 0.18)';
      } else {
        btnEl.style.background = '#fff1f2';
        btnEl.style.color = '#9f1239';
        btnEl.style.borderColor = '#f43f5e';
        btnEl.style.boxShadow = '0 2px 6px rgba(244, 63, 94, 0.18)';
      }
    }
    const adviceEl = document.getElementById('macro-scenario-advice-bar');
    if (adviceEl) {
      const map = {
        soft_landing: '🟢 <strong>【軟著陸降息情境｜10Y 殖利率 4.50%】對客溝通重點</strong>：當無風險利率回落 55 bps，科技巨頭折現本益比獲得擴張空間（3 年隱含 CAGR 普遍拉升 3%~5%）。適合建議客戶<strong>分批布局 AI 雲端與高成長軟體現股（GOOGL、AMZN、MSFT、PANW）</strong>，或配置<strong>80%~85% Strike 之積極型 FCN</strong> 參與上檔空間。',
        fed_hold: '⚖️ <strong>【10/28 FOMC 按兵不動現況｜10Y 殖利率 5.05%】對客溝通重點</strong>：聯準會維持 3.75%~4.00% 利率高原期，單純追高硬體股 PE 空間受限。建議客戶採取<strong>「長天期投資級公司債鎖利 5%+」搭配「75%~80% Strike / 65% KI 之防禦型 FCN」</strong>，將科技巨頭財報後的高波動轉化為 10%~14% 穩健年化票息。',
        inflation_stress: '🔴 <strong>【通膨復燃升息壓力測試｜10Y 殖利率 5.40%】對客溝通重點</strong>：反映 2 位鷹派委員主張升息與 PPI (6.4%) 黏性之極端壓力測試。高估值硬體股面臨折現收縮，建議客戶<strong>檢視下方「投資組合風險評估系統」，調降高 PE 標的比重，並將 FCN 轉換價下調至 70%~75% 深價外安全邊際區間</strong>。'
      };
      adviceEl.innerHTML = map[presetKey] || map.fed_hold;
    }
  };


  function initLiveQuotesAndEarningsEngine() {
    hookRenderTable();
    injectUpgradePanels();
    setValuationQuoteStatus('內建報價備援為美東 2026-10-20 收盤基準。財報依個別官方來源更新。');
    applyMacroIndicatorsToPage(window.MACRO_INDICATORS_HUB, 'BEA/BLS/ADP 官方快照 (11/05)');
    applyQuotesToPage(window.LIVE_QUOTES_HUB, 'GOOGLEFINANCE 雲端快照 (10/21)');
    syncEarningsHubFromCloud(false);
    syncMacroIndicatorsFromCloud(false);
    syncLiveQuotesFromCloud(false);

    // 每 5 分鐘自動重刷雲端報價、財報開獎狀態與倒數計時，並在切換回分頁時立即同步
    setInterval(function () {
      syncEarningsHubFromCloud(false);
      syncLiveQuotesFromCloud(false);
      syncMacroIndicatorsFromCloud(false);
    }, 300000);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        renderDynamicEarningsPanel();
        syncEarningsHubFromCloud(false);
        syncLiveQuotesFromCloud(false);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiveQuotesAndEarningsEngine);
  } else {
    initLiveQuotesAndEarningsEngine();
  }
})();
