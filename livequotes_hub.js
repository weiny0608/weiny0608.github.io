/**
 * GOOGLEFINANCE LiveQuotes Cloud Hub, Q3 Earnings Auto-Rollover / EPS Calibration Engine
 * & Fed Core Macro Indicators Multi-Channel Auto-Sync Engine (v2.0 Dynamic Auto-Update)
 * 方向一：建立 GOOGLEFINANCE 雲端即時股價中樞 (LiveQuotes)
 * 方向二：財報開獎自動偵測、動態預告面板、自動換季 (+90天) 與 EPS 模型滾動校準 (earnings_hub.json + Google Sheets 雙向同步)
 * 方向三：六大核心總經指標 (Core PCE / PCE / NFP / ADP / 失業率 / PPI) 自動抓取與雲端同步引擎
 */
(function () {
  'use strict';

  const LIVE_QUOTES_SHEET_ID = '14F4q5WvvjQRlGSSDcnK7QWBTxDZkT51RzN0bXo5vRYk';
  const MAIN_VALUATION_SHEET_ID = '1czITJdQ-NGsymNMc9DB2M1Enmxopg644XQb9_seGph8';

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

  // 方向三：六大核心總經指標官方最新基準快照 (含 10/15 發布之 9 月 PPI 6.4% / 核心 5.0%)
  const MACRO_INDICATORS_SNAPSHOT = [
    {
      id: "core_pce",
      name: "核心 PCE 年增率 (Core PCE)",
      fredSeries: "PCEPILFE",
      calcType: "yoy_pct",
      value: "3.0%",
      numericValue: 3.0,
      prevValue: "3.3%",
      consensus: "3.0%",
      metaLeft: "前期: 3.3% ｜ 預期: 3.0%",
      releaseDate: "09/30",
      referencePeriod: "2026-08",
      nextReleaseDate: "2026-10-29",
      badgeText: "Fed核心指標",
      badgeClass: "status-sticky",
      sourceName: "BEA Personal Income & Outlays",
      sourceUrl: "https://www.bea.gov/news/2026/personal-income-and-outlays-august-2026"
    },
    {
      id: "headline_pce",
      name: "整體 PCE 年增率 (Headline PCE)",
      fredSeries: "PCEPI",
      calcType: "yoy_pct",
      value: "3.4%",
      numericValue: 3.4,
      prevValue: "3.7%",
      consensus: "3.4%",
      metaLeft: "前期: 3.7% ｜ 預期: 3.4%",
      releaseDate: "09/30",
      referencePeriod: "2026-08",
      nextReleaseDate: "2026-10-29",
      badgeText: "較前期趨緩",
      badgeClass: "status-easing",
      sourceName: "BEA Personal Income & Outlays",
      sourceUrl: "https://www.bea.gov/news/2026/personal-income-and-outlays-august-2026"
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
      value: "+9.0 萬人",
      numericValue: 9.0,
      prevValue: "3.6 萬",
      consensus: "8.5 萬",
      metaLeft: "前期: 3.6 萬 ｜ 預期: 8.5 萬",
      releaseDate: "09/30",
      referencePeriod: "2026-09",
      nextReleaseDate: "2026-11-04",
      badgeText: "就業回溫",
      badgeClass: "status-solid",
      sourceName: "ADP National Employment Report",
      sourceUrl: "https://mediacenter.adp.com/2026-09-30-ADP-National-Employment-Report-Private-Sector-Employment-Increased-by-90,000-Jobs-in-September"
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
      badgeText: "通膨升溫",
      badgeClass: "status-sticky",
      sourceName: "BLS Producer Price Index",
      sourceUrl: "https://www.bls.gov/news.release/ppi.nr0.htm"
    }
  ];

  // 方向二：財報開獎診斷、本週預告與全市場財報日基準快照 (可由 ./earnings_hub.json 與 Google Sheets 即時覆寫)
  const EARNINGS_HUB_SNAPSHOT = {
    updatedAt: "2026-10-21T11:00:00+08:00",
    baselineDate: "2026-10-20 收盤 (台北時間 2026-10-21 即時同步)",
    us10yYield: 5.12,
    recentDiagnostics: [
      {
        symbol: "NFLX",
        name: "Netflix",
        reportDate: "2026-10-20",
        nextReportDate: "2027-01-19",
        quarter: "Q3 2026",
        timing: "AMC",
        verdict: "Beat (EPS 優於預期・Q3 結算中)",
        badgeText: "10/20 盤後已開獎・Q3 結算中",
        actualSummary: "Q3 營收 $12.874B（年增 12%，符合市場共識 $12.87B）、營業利益率 34.6%（優於財測）、拆股後稀釋 EPS $0.87（優於共識 $0.82 達 +6.1%，拆股前約當 $8.70）、淨利 $3.664B。",
        guidanceSummary: "Q4 營收指引 $13.44B、Q4 EPS 指引 $0.67；重申 2026 全年營收指引 $51.1B。",
        oldEps27: 24.00, newEps27: 25.20, newEps28: 29.50, newEps29: 34.00,
        sourceUrl: "https://www.tradingview.com/news/tradingview:5f43a356c05d6:0-netflix-posts-q3-revenue-12-874b-operating-margin-34-6-and-diluted-eps-0-87/"
      },
      {
        symbol: "TSM",
        name: "台積電 ADR",
        reportDate: "2026-10-15",
        nextReportDate: "2027-01-14",
        quarter: "Q3 2026",
        timing: "BMO",
        verdict: "Beat & Raise (營收毛利雙破表・已換季)",
        badgeText: "10/15 已開獎・下次 01/14 (+1季)",
        actualSummary: "Q3 營收 US$46.72B（季增 16.2%、年增 41.2%，超越財測高標 $45.8B）、毛利率 66.4%、每單位 ADR EPS US$4.60（台幣 NT$29.43，優於共識 $4.46）。",
        guidanceSummary: "Q4 營收指引大幅上調至 US$52.3B～$54.3B（季增 14%）、毛利率指引 65%～67%，全年資本支出 $60B～$64B。",
        oldEps27: 8.50, newEps27: 9.20, newEps28: 11.20, newEps29: 13.20,
        sourceUrl: "https://pr.tsmc.com/english/news/3346"
      },
      {
        symbol: "ASML",
        name: "艾斯摩爾",
        reportDate: "2026-10-14",
        nextReportDate: "2027-01-20",
        quarter: "Q3 2026",
        timing: "BMO",
        verdict: "Beat & Raise (毛利率驚艷・已換季)",
        badgeText: "10/14 已開獎・下次 01/20 (+1季)",
        actualSummary: "Q3 營收 €11.7B、毛利率 57.5%（優於預期 54.0%）、Basic EPS €12.95。",
        guidanceSummary: "Q4 營收指引 €14.2B～€15.2B，2026 全年營收上調至 €44B～€45B。",
        oldEps27: 29.00, newEps27: 32.50, newEps28: 39.80, newEps29: 46.50,
        sourceUrl: "https://www.stocktitan.net/news/ASML/asml-reports-11-7-billion-total-net-sales-and-5-0-billion-net-income-dd7ttrmk06ng.html"
      },
      {
        symbol: "GE",
        name: "奇異航太",
        reportDate: "2026-10-20",
        nextReportDate: "2027-01-19",
        quarter: "Q3 2026",
        timing: "BMO",
        verdict: "Beat & Raise (上調全年指引・Q3 結算中)",
        badgeText: "10/20 已開獎・Q3 結算中",
        actualSummary: "Q3 調整後 EPS $2.25（優於共識 $2.01）、營收 $13.3B（優於共識 $12.88B）；GM 同日公佈 Q3 EPS $3.70 Beat 並宣布 $20B 庫藏股。",
        guidanceSummary: "GE 再度上調 2026 全年獲利與自由現金流指引。",
        oldEps27: 5.40, newEps27: 5.85, newEps28: 7.00, newEps29: 8.30,
        sourceUrl: "https://www.newsquawk.com/headlines/ge-aerospace-ge-q3-2026-usd-adj-eps-225-exp-201-adj-revenue-133bln-exp-1288bln"
      }
    ],
    upcomingPreviews: [
      {
        symbol: "TSLA", name: "特斯拉", earningsDate: "2026-10-21", timing: "盤後 (AMC)",
        consensusEps: "$0.45", consensusRev: "$28.10B",
        previewNote: "Q3 交車逾 48.6 萬輛、儲能部署 13.7 GWh；聚焦汽車毛利率與 Robotaxi 自駕量產時程。",
        oldEps27: 3.20, bullEps27: 3.55, bullEps28: 4.95, bullEps29: 7.10,
        sourceUrl: "https://ir.tesla.com/press-release/tesla-third-quarter-2026-production-deliveries-and-deployments"
      },
      {
        symbol: "IBM", name: "IBM", earningsDate: "2026-10-21", timing: "盤後 (AMC)",
        consensusEps: "$2.87", consensusRev: "$16.82B",
        previewNote: "聚焦 Red Hat 混合雲增速、生成式 AI 諮詢訂單簿與全年自由現金流指引。",
        oldEps27: 11.20, bullEps27: 11.80, bullEps28: 12.80, bullEps29: 13.90,
        sourceUrl: "https://www.ibm.com/investor/events/earnings-3q26"
      },
      {
        symbol: "LRCX", name: "科林研發", earningsDate: "2026-10-21", timing: "盤後 (AMC)",
        consensusEps: "$2.18", consensusRev: "$5.95B",
        previewNote: "FQ1 2027 財報，聚焦 HBM 晶圓深孔蝕刻與先進封裝設備出貨動能。",
        oldEps27: 39.00, bullEps27: 41.50, bullEps28: 52.00, bullEps29: 60.00,
        sourceUrl: "https://investor.lamresearch.com/events"
      },
      {
        symbol: "TXN", name: "德州儀器", earningsDate: "2026-10-21", timing: "盤後 (AMC)",
        consensusEps: "$2.42", consensusRev: "$5.92B",
        previewNote: "公司財測 EPS $2.23～$2.57；觀察工控與車用類比晶片庫存週期復甦力道。",
        oldEps27: 7.20, bullEps27: 7.65, bullEps28: 9.00, bullEps29: 10.30,
        sourceUrl: "https://news.alphastreet.com/texas-instruments-q3-2026-earnings-preview-october-21-street-expects-2-42-eps/"
      },
      {
        symbol: "KLAC", name: "科磊", earningsDate: "2026-10-22", timing: "盤後 (AMC)",
        consensusEps: "$8.65", consensusRev: "$3.18B",
        previewNote: "受惠台積電 2nm 與先進封裝製程檢測強度提升，關注 WFE 晶圓廠設備支出展望。",
        oldEps27: 34.00, bullEps27: 36.20, bullEps28: 44.50, bullEps29: 52.00,
        sourceUrl: "https://seekingalpha.com/symbol/KLAC"
      },
      {
        symbol: "INTC", name: "英特爾", earningsDate: "2026-10-22", timing: "盤後 (AMC)",
        consensusEps: "$0.22", consensusRev: "$14.30B",
        previewNote: "聚焦資料中心 AI 伺服器 CPU 動能與 18A 晶圓代工外部客戶進度。",
        oldEps27: 1.20, bullEps27: 1.45, bullEps28: 2.05, bullEps29: 2.70,
        sourceUrl: "https://www.tradingnews.com/news/intc-95-usd-rebounds-as-59-percent-data-center-growth-meets-a-62x-valuation"
      },
      {
        symbol: "NOW", name: "ServiceNow", earningsDate: "2026-10-22", timing: "盤後 (AMC)",
        consensusEps: "$4.25", consensusRev: "$3.48B",
        previewNote: "聚焦 Now Assist 企業級 AI Agent 變現率與 cRPO 剩餘履約義務增速。",
        oldEps27: 17.50, bullEps27: 18.60, bullEps28: 22.80, bullEps29: 27.50,
        sourceUrl: "https://www.ciodive.com/news/tech-bytes-servicenow-boost-ai-agent-control/833175/"
      },
      {
        symbol: "GOOGL", name: "Alphabet", earningsDate: "2026-10-27", timing: "盤後 (AMC)",
        consensusEps: "$2.35", consensusRev: "$102.5B",
        previewNote: "下週科技七巨頭打頭陣，聚焦 Google Cloud 利潤率與 AI 搜尋廣告變現。",
        oldEps27: 9.70, bullEps27: 10.30, bullEps28: 11.90, bullEps29: 13.60,
        sourceUrl: "https://www.nasdaq.com/market-activity/earnings"
      },
      {
        symbol: "MSFT", name: "微軟", earningsDate: "2026-10-28", timing: "盤後 (AMC)",
        consensusEps: "$3.65", consensusRev: "$75.8B",
        previewNote: "聚焦 Azure AI 算力貢獻佔比與 Copilot 企業授權滲透率。",
        oldEps27: 14.90, bullEps27: 15.60, bullEps28: 18.00, bullEps29: 20.50,
        sourceUrl: "https://www.nasdaq.com/market-activity/earnings"
      },
      {
        symbol: "META", name: "Meta", earningsDate: "2026-10-28", timing: "盤後 (AMC)",
        consensusEps: "$6.85", consensusRev: "$49.2B",
        previewNote: "聚焦 AI 廣告投放轉換率提升與 2027 基礎設施資本支出指引。",
        oldEps27: 30.00, bullEps27: 31.80, bullEps28: 37.00, bullEps29: 42.80,
        sourceUrl: "https://www.nasdaq.com/market-activity/earnings"
      },
      {
        symbol: "AAPL", name: "蘋果", earningsDate: "2026-10-29", timing: "盤後 (AMC)",
        consensusEps: "$1.88", consensusRev: "$104.0B",
        previewNote: "聚焦 iPhone 18 / Apple Intelligence 換機週期與服務毛利率。",
        oldEps27: 8.00, bullEps27: 8.40, bullEps28: 9.35, bullEps29: 10.30,
        sourceUrl: "https://www.nasdaq.com/market-activity/earnings"
      },
      {
        symbol: "AMZN", name: "亞馬遜", earningsDate: "2026-10-29", timing: "盤後 (AMC)",
        consensusEps: "$1.62", consensusRev: "$182.5B",
        previewNote: "聚焦 AWS 生成式 AI 雲端增速與北美零售營業利益率擴張。",
        oldEps27: 7.30, bullEps27: 7.80, bullEps28: 9.50, bullEps29: 11.50,
        sourceUrl: "https://www.nasdaq.com/market-activity/earnings"
      }
    ],
    earningsDates: {
      "PEP": "2026-10-08", "JPM": "2026-10-13", "WFC": "2026-10-13", "GS": "2026-10-13", "UNH": "2026-10-13",
      "JNJ": "2026-10-13", "C": "2026-10-13", "ASML": "2026-10-14", "BAC": "2026-10-14", "MS": "2026-10-14",
      "TSM": "2026-10-15", "AXP": "2026-10-16", "PG": "2026-10-16", "UNP": "2026-10-16", "TRV": "2026-10-17",
      "NFLX": "2026-10-20", "GE": "2026-10-20", "GM": "2026-10-20", "RTX": "2026-10-20", "TSLA": "2026-10-21",
      "IBM": "2026-10-21", "LRCX": "2026-10-21", "TXN": "2026-10-21", "TMO": "2026-10-21", "T": "2026-10-21",
      "KLAC": "2026-10-22", "INTC": "2026-10-22", "NOW": "2026-10-22", "V": "2026-10-22", "KO": "2026-10-22",
      "BA": "2026-10-22", "VZ": "2026-10-22", "SHW": "2026-10-22", "HON": "2026-10-23", "ABBV": "2026-10-24",
      "CAT": "2026-10-24", "DOW": "2026-10-24", "CDNS": "2026-10-26", "GOOGL": "2026-10-27", "MSFT": "2026-10-28",
      "META": "2026-10-28", "MCD": "2026-10-28", "AAPL": "2026-10-29", "AMZN": "2026-10-29", "LLY": "2026-10-29",
      "MRK": "2026-10-29", "MA": "2026-10-30", "AMGN": "2026-10-30", "XOM": "2026-10-30", "CVX": "2026-10-30",
      "NXPI": "2026-11-02", "PLTR": "2026-11-02", "BRK.B": "2026-11-02", "AMD": "2026-11-03", "PFE": "2026-11-03",
      "QCOM": "2026-11-04", "CVS": "2026-11-04", "ARM": "2026-11-05", "FTNT": "2026-11-05", "UBER": "2026-11-05",
      "TM": "2026-11-06", "AMAT": "2026-11-12", "HD": "2026-11-12", "DIS": "2026-11-13", "NVDA": "2026-11-18",
      "CSCO": "2026-11-18", "PANW": "2026-11-19", "WMT": "2026-11-19", "INTU": "2026-11-24", "ADI": "2026-11-24",
      "WDAY": "2026-11-24", "CRM": "2026-11-25", "CRWD": "2026-12-02", "SNPS": "2026-12-02", "MRVL": "2026-12-03",
      "ORCL": "2026-12-08", "AVGO": "2026-12-10", "ADBE": "2026-12-10", "COST": "2026-12-10", "MU": "2026-12-16",
      "NKE": "2026-12-18"
    }
  };

  window.LIVE_QUOTES_HUB = Object.assign({}, LIVE_QUOTES_SNAPSHOT);
  window.MACRO_INDICATORS_HUB = MACRO_INDICATORS_SNAPSHOT.map(item => Object.assign({}, item));
  window.EARNINGS_HUB = JSON.parse(JSON.stringify(EARNINGS_HUB_SNAPSHOT));

  // 將六大總經指標渲染至網頁 DOM (支援 index.html 與 nasdaq/index.html)
  function applyMacroIndicatorsToPage(indicatorsList, sourceLabel) {
    if (!Array.isArray(indicatorsList) || indicatorsList.length === 0) return;

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    indicatorsList.forEach(ind => {
      if (!ind || !ind.id) return;

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

  async function syncMacroIndicatorsFromCloud(manualTrigger) {
    let updatedFrom = null;

    const jsonPaths = ['./macro_indicators.json', '../macro_indicators.json'];
    for (const path of jsonPaths) {
      try {
        const res = await fetch(`${path}?t=${Date.now()}`, { signal: AbortSignal.timeout(3500) });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && Array.isArray(data.indicators) && data.indicators.length >= 6) {
          window.MACRO_INDICATORS_HUB = data.indicators;
          updatedFrom = '官方排程 JSON 同步';
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

    try {
      localStorage.setItem('MACRO_INDICATORS_HUB_CACHE', JSON.stringify({
        updatedAt: new Date().toISOString(),
        indicators: window.MACRO_INDICATORS_HUB
      }));
    } catch (e) {}

    return !!updatedFrom;
  }

  window.syncMacroIndicatorsFromCloud = syncMacroIndicatorsFromCloud;

  // 方向二：財報開獎自動偵測、今日開獎徽章、Q3 結算徽章與 +90 天自動換季
  function resolveEarningsStatus(targetDateStr, sym) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const parts = String(targetDateStr || "2026-11-01").split("-").map(Number);
    let target = new Date(parts[0] || 2026, (parts[1] || 1) - 1, parts[2] || 1);
    let rawDiff = Math.round((target - today) / 86400000);

    // 檢查是否已經在 recentDiagnostics 中公佈財報
    const hub = window.EARNINGS_HUB || {};
    const diagMatch = sym && Array.isArray(hub.recentDiagnostics)
      ? hub.recentDiagnostics.find(d => d.symbol === sym && d.reportDate === targetDateStr)
      : null;

    // 若為當日開獎 (rawDiff === 0) 且尚未被列入已開獎診斷，顯示「⚡ 今晚開獎 (0 天)」
    if (rawDiff === 0 && !diagMatch) {
      return {
        days: 0,
        rawDiff: 0,
        displayDate: targetDateStr,
        isSettling: false,
        isToday: true,
        isRolled: false,
        badgeText: "⚡ 今日開獎 (0 天)",
        badgeStyle: "background:#fff1f2; color:#be123c; border:1px solid #fecdd3; font-weight:800;"
      };
    }

    // 開獎後 1~3 天內 (-3 <= rawDiff <= -1) 或已列入開獎診斷：顯示 🔔 財報已開獎 (Q3 結算中)
    if ((rawDiff < 0 && rawDiff >= -3) || (rawDiff === 0 && diagMatch)) {
      return {
        days: 0,
        rawDiff: rawDiff,
        displayDate: targetDateStr,
        isSettling: true,
        isToday: false,
        isRolled: false,
        badgeText: "🔔 財報已開獎 (Q3 結算中)",
        badgeStyle: "background:#f5f3ff; color:#6d28d9; border:1px solid #c4b5fd; font-weight:800;"
      };
    }

    // 超過 3 天 (rawDiff < -3)：優先使用診斷中指定的 nextReportDate，否則自動推進一季 (+90 天)
    if (rawDiff < -3 && diagMatch && diagMatch.nextReportDate) {
      const nParts = String(diagMatch.nextReportDate).split("-").map(Number);
      const nextTarget = new Date(nParts[0] || 2027, (nParts[1] || 1) - 1, nParts[2] || 15);
      const nextDiff = Math.round((nextTarget - today) / 86400000);
      if (nextDiff > 0) {
        return {
          days: nextDiff,
          rawDiff: nextDiff,
          displayDate: diagMatch.nextReportDate,
          isSettling: false,
          isToday: false,
          isRolled: true,
          badgeText: `${nextDiff} 天`,
          badgeStyle: ""
        };
      }
    }

    let rolled = false;
    while (rawDiff < -3) {
      target = new Date(target.getTime() + 90 * 86400000);
      rawDiff = Math.round((target - today) / 86400000);
      rolled = true;
    }

    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, "0");
    const d = String(target.getDate()).padStart(2, "0");
    return {
      days: rawDiff,
      rawDiff: rawDiff,
      displayDate: `${y}-${m}-${d}`,
      isSettling: false,
      isToday: false,
      isRolled: rolled,
      badgeText: `${rawDiff} 天`,
      badgeStyle: ""
    };
  }

  window.resolveEarningsStatus = resolveEarningsStatus;

  // 動態渲染「🔔 最新財報開獎診斷」與「⚡ 本週重點開獎預告」雙卡片 (100% 依當日實際日期與雲端資料自動更新)
  function renderDynamicEarningsPanel() {
    const cardsContainer = document.getElementById('lq-dynamic-cards-grid');
    if (!cardsContainer) return;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;

    const hub = window.EARNINGS_HUB || EARNINGS_HUB_SNAPSHOT;
    const diagnostics = Array.isArray(hub.recentDiagnostics) && hub.recentDiagnostics.length > 0
      ? hub.recentDiagnostics
      : EARNINGS_HUB_SNAPSHOT.recentDiagnostics;
    const previews = Array.isArray(hub.upcomingPreviews) && hub.upcomingPreviews.length > 0
      ? hub.upcomingPreviews
      : EARNINGS_HUB_SNAPSHOT.upcomingPreviews;

    // 篩選今日 (diff === 0) 與未來 10 天內即將開獎之重點公司
    const activePreviews = previews.map(item => {
      const copy = Object.assign({}, item);
      const parts = String(copy.earningsDate || '').split('-').map(Number);
      if (parts.length === 3) {
        const dt = new Date(parts[0], parts[1] - 1, parts[2]);
        copy._diffDays = Math.round((dt - today) / 86400000);
        copy._shortDate = `${String(parts[1]).padStart(2, '0')}/${String(parts[2]).padStart(2, '0')}`;
      } else {
        copy._diffDays = 99;
        copy._shortDate = '';
      }
      return copy;
    }).filter(item => item._diffDays >= 0 && item._diffDays <= 10)
      .sort((a, b) => a._diffDays - b._diffDays);

    // 若預設清單皆已過期，從 stocks 陣列自動挑出未來 14 天內開獎之公司
    if (activePreviews.length === 0 && typeof stocks !== 'undefined' && Array.isArray(stocks)) {
      stocks.forEach(s => {
        const st = s._earnStatus || resolveEarningsStatus(s._origEd || s.ed, s.t);
        if (st && st.days >= 0 && st.days <= 14) {
          const parts = String(st.displayDate || s.ed).split('-');
          activePreviews.push({
            symbol: s.t,
            name: s.n,
            earningsDate: st.displayDate || s.ed,
            timing: "盤後",
            _diffDays: st.days,
            _shortDate: parts.length === 3 ? `${parts[1]}/${parts[2]}` : st.displayDate,
            consensusEps: `$${(s.eps27 / 4).toFixed(2)}`,
            consensusRev: "詳見財報表",
            previewNote: `${s.s}指標大廠，系統自動排程倒數追蹤中。`,
            oldEps27: s.eps27,
            bullEps27: +(s.eps27 * 1.06).toFixed(2),
            bullEps28: +(s.eps28 * 1.06).toFixed(2),
            bullEps29: +(s.eps29 * 1.06).toFixed(2),
            sourceUrl: "https://www.nasdaq.com/market-activity/earnings"
          });
        }
      });
      activePreviews.sort((a, b) => a._diffDays - b._diffDays);
    }

    const rolledTickers = (typeof stocks !== 'undefined' && Array.isArray(stocks))
      ? stocks.filter(s => s._earnStatus && s._earnStatus.isRolled).map(s => s.t).slice(0, 8).join('、')
      : 'TSM、ASML、JPM、WFC、GS、MS、BAC、UNH';

    const d1 = diagnostics[0] || EARNINGS_HUB_SNAPSHOT.recentDiagnostics[0];
    const d2 = diagnostics[1] || EARNINGS_HUB_SNAPSHOT.recentDiagnostics[1];
    const d3 = diagnostics[2] || EARNINGS_HUB_SNAPSHOT.recentDiagnostics[2];

    const previewHeadline = activePreviews.slice(0, 4).map(p => `${p.symbol} (${p._shortDate})`).join(' ＆ ') || '下週重點科技股財報';

    cardsContainer.innerHTML = `
      <!-- 左側：最新已開獎公司 Beat/Miss 診斷與 EPS 上修校準 -->
      <div style="background:#ffffff; border:1px solid #ddd6fe; border-left:4px solid #7c3aed; border-radius:8px; padding:12px 14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:6px; flex-wrap:wrap;">
          <strong style="font-size:13px; color:#1e1b4b;">🔔 最新財報開獎診斷：${d1.symbol} (${d1.name}) ＆ ${d2.symbol} (${d2.name})</strong>
          <span style="font-size:10.5px; font-weight:800; background:#f5f3ff; color:#6d28d9; border:1px solid #c4b5fd; padding:2px 8px; border-radius:999px;">${d1.badgeText}</span>
        </div>
        <div style="font-size:11.5px; color:#475569; line-height:1.55; margin-bottom:8px;">
          • <strong><a href="${d1.sourceUrl}" target="_blank" rel="noopener" style="color:#4c1d95; text-decoration:underline;">${d1.symbol} (${d1.name})</a></strong>：${d1.actualSummary} ${d1.guidanceSummary || ''}<br>
          • <strong><a href="${d2.sourceUrl}" target="_blank" rel="noopener" style="color:#4c1d95; text-decoration:underline;">${d2.symbol} (${d2.name})</a></strong>：${d2.actualSummary} ${d2.guidanceSummary || ''}<br>
          • <strong>估值模型修正建議</strong>：建議將 <code>${d2.symbol} FY27 EPS</code> 由 <strong>$${Number(d2.oldEps27).toFixed(2)} 上調至 $${Number(d2.newEps27).toFixed(2)}</strong>；<code>${d1.symbol} FY27 EPS</code> 由 <strong>$${Number(d1.oldEps27).toFixed(2)} 上調至 $${Number(d1.newEps27).toFixed(2)}</strong>（<a href="${d3.sourceUrl}" target="_blank" rel="noopener" style="color:#6d28d9;">${d3.symbol}</a> 亦建議由 $${Number(d3.oldEps27).toFixed(2)} 上調至 $${Number(d3.newEps27).toFixed(2)}）。
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <button type="button" id="btn-calib-${d2.symbol}" onclick="window.applyEarningsCalibration('${d2.symbol}', ${d2.newEps27}, ${d2.newEps28}, ${d2.newEps29})" style="font-size:11px; font-weight:800; color:#fff; background:#7c3aed; border:none; padding:5px 11px; border-radius:6px; cursor:pointer;">✅ 套用 ${d2.symbol} EPS 上修 ($${Number(d2.oldEps27).toFixed(2)}→$${Number(d2.newEps27).toFixed(2)})</button>
          <button type="button" id="btn-calib-${d1.symbol}" onclick="window.applyEarningsCalibration('${d1.symbol}', ${d1.newEps27}, ${d1.newEps28}, ${d1.newEps29})" style="font-size:11px; font-weight:800; color:#4c1d95; background:#ede9fe; border:1px solid #c4b5fd; padding:5px 11px; border-radius:6px; cursor:pointer;">✅ 套用 ${d1.symbol} EPS 上修 ($${Number(d1.oldEps27).toFixed(2)}→$${Number(d1.newEps27).toFixed(2)})</button>
          <button type="button" id="btn-calib-${d3.symbol}" onclick="window.applyEarningsCalibration('${d3.symbol}', ${d3.newEps27}, ${d3.newEps28}, ${d3.newEps29})" style="font-size:11px; font-weight:700; color:#475569; background:#f8fafc; border:1px solid #cbd5e1; padding:5px 10px; border-radius:6px; cursor:pointer;">✅ 套用 ${d3.symbol} ($${Number(d3.oldEps27).toFixed(1)}→$${Number(d3.newEps27).toFixed(1)})</button>
          <span id="calib-status-${d2.symbol}" style="font-size:11px; color:#6d28d9; font-weight:700;"></span>
          <span id="calib-status-${d1.symbol}" style="font-size:11px; color:#6d28d9; font-weight:700;"></span>
          <span id="calib-status-${d3.symbol}" style="font-size:11px; color:#6d28d9; font-weight:700;"></span>
        </div>
      </div>

      <!-- 右側：今日與本週重點開獎預告 (依當日日期動態倒數) -->
      <div style="background:#ffffff; border:1px solid #fde047; border-left:4px solid #ca8a04; border-radius:8px; padding:12px 14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:6px; flex-wrap:wrap;">
          <strong style="font-size:13px; color:#132a18;">⚡ 本週重點開獎預告 (${mmdd} 即時倒數)：${previewHeadline}</strong>
          <span style="font-size:10.5px; font-weight:800; background:#fef9c3; color:#854d0e; border:1px solid #fde047; padding:2px 8px; border-radius:999px;">06:00 晨報 ＆ 盤後自動抓取</span>
        </div>
        <div style="font-size:11.5px; color:#475569; line-height:1.55; margin-bottom:8px;">
          ${activePreviews.slice(0, 3).map(p => {
            const badge = p._diffDays === 0
              ? `<span style="color:#be123c; font-weight:800; background:#fff1f2; border:1px solid #fecdd3; padding:1px 5px; border-radius:4px;">⚡ 今晚 (${p._shortDate}) ${p.timing} 開獎・倒數 0 天</span>`
              : `<span style="color:#854d0e; font-weight:700; background:#fef9c3; border:1px solid #fde047; padding:1px 5px; border-radius:4px;">⏳ ${p._shortDate} ${p.timing} 開獎・倒數 ${p._diffDays} 天</span>`;
            return `• <strong><a href="${p.sourceUrl}" target="_blank" rel="noopener" style="color:#132a18; text-decoration:underline;">${p.symbol} (${p.name})</a></strong>：${badge}，市場共識 EPS <strong>${p.consensusEps}</strong>、營收 <strong>${p.consensusRev}</strong>。${p.previewNote}`;
          }).join('<br>')}
          <br>• <strong>自動換季機制 (+90天)</strong>：${rolledTickers} 等開獎已滿 3 天標的，下次財報日已自動推進至 2027 Q1。
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          ${activePreviews[0] ? `<button type="button" onclick="window.applyEarningsCalibration('${activePreviews[0].symbol}', ${activePreviews[0].bullEps27}, ${activePreviews[0].bullEps28}, ${activePreviews[0].bullEps29})" style="font-size:11px; font-weight:800; color:#fff; background:#059669; border:none; padding:5px 11px; border-radius:6px; cursor:pointer;">📈 預演 ${activePreviews[0].symbol} Beat 上修 ($${Number(activePreviews[0].oldEps27).toFixed(2)}→$${Number(activePreviews[0].bullEps27).toFixed(2)})</button>` : ''}
          ${activePreviews[1] ? `<button type="button" onclick="window.applyEarningsCalibration('${activePreviews[1].symbol}', ${activePreviews[1].bullEps27}, ${activePreviews[1].bullEps28}, ${activePreviews[1].bullEps29})" style="font-size:11px; font-weight:700; color:#065f46; background:#ecfdf5; border:1px solid #a7f3d0; padding:5px 10px; border-radius:6px; cursor:pointer;">📈 預演 ${activePreviews[1].symbol} Beat 上修</button>` : ''}
          <button type="button" onclick="window.resetEarningsCalibrations()" style="font-size:11px; font-weight:600; color:#475569; background:#f1f5f9; border:1px solid #cbd5e1; padding:5px 10px; border-radius:6px; cursor:pointer;">還原預設 EPS</button>
          ${activePreviews[0] ? `<span id="calib-status-${activePreviews[0].symbol}" style="font-size:11px; color:#059669; font-weight:700;"></span>` : ''}
          ${activePreviews[1] ? `<span id="calib-status-${activePreviews[1].symbol}" style="font-size:11px; color:#059669; font-weight:700;"></span>` : ''}
        </div>
      </div>
    `;
  }

  window.renderDynamicEarningsPanel = renderDynamicEarningsPanel;

  // 將報價與財報日期字典套用至頁面上的 stocks / GOOGLE_FINANCE_LATEST_CLOSES / FCN 模擬器並重繪
  function applyQuotesToPage(quotesMap, sourceLabel) {
    if (!quotesMap) return;

    // 同步頂部基準日文字
    const now = new Date();
    const todayStr = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
    document.querySelectorAll('.header p').forEach(pEl => {
      if (pEl.textContent.includes('基準日：')) {
        pEl.textContent = pEl.textContent.replace(/基準日：[^｜]+/, `基準日：${todayStr} (雲端即時同步) `);
      }
    });

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
          p: 68.69, ed: "2026-10-20", eps27: 25.2, eps28: 29.5, eps29: 34.0, pe: 28, mult: 0.96
        });
      }

      const hubDates = (window.EARNINGS_HUB && window.EARNINGS_HUB.earningsDates) || EARNINGS_HUB_SNAPSHOT.earningsDates || {};

      window.getDaysDiff = function (edStr) {
        return resolveEarningsStatus(edStr).days;
      };

      stocks.forEach(s => {
        // 優先採用 earnings_hub.json 或 Google Sheets 同步之最新財報日
        if (hubDates[s.t]) {
          s._origEd = hubDates[s.t];
        } else if (!s._origEd) {
          s._origEd = s.ed;
        }

        const q = quotesMap[s.t];
        if (q) {
          if (q.price > 0) s.p = q.price;
          if (q.chgPct !== undefined) s.chg = q.chgPct;
          if (q.high52) s.high52 = q.high52;
          if (q.low52) s.low52 = q.low52;
          if (q.sheetEd && /^\d{4}-\d{2}-\d{2}$/.test(q.sheetEd)) {
            s._origEd = q.sheetEd;
          }
          if (q.sheetSummary) {
            s._sheetSummary = q.sheetSummary;
          }
        }

        const status = resolveEarningsStatus(s._origEd, s.t);
        s._earnStatus = status;
        if (status.isRolled) {
          s.ed = status.displayDate;
        } else {
          s.ed = s._origEd;
        }
      });

      try {
        const savedCalib = JSON.parse(localStorage.getItem('EPS_CALIBRATIONS_V1') || '{}');
        Object.keys(savedCalib).forEach(sym => {
          const st = stocks.find(x => x.t === sym);
          if (st && savedCalib[sym]) {
            if (savedCalib[sym].eps27) st.eps27 = savedCalib[sym].eps27;
            if (savedCalib[sym].eps28) st.eps28 = savedCalib[sym].eps28;
            if (savedCalib[sym].eps29) st.eps29 = savedCalib[sym].eps29;
          }
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
    if (statusEl) {
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
      if (priceTd && !priceTd.dataset.lqDecorated) {
        priceTd.dataset.lqDecorated = "1";
        const chg = sObj.chg;
        const chgHtml = (chg !== undefined && chg !== null && !isNaN(chg))
          ? `<div style="font-size:10px; font-weight:700; color:${chg >= 0 ? '#059669' : '#e11d48'};">${chg >= 0 ? '▲ +' : '▼ '}${Number(chg).toFixed(2)}%</div>`
          : '';
        const rangeTitle = (sObj.low52 && sObj.high52)
          ? `52週高低點: $${Number(sObj.low52).toFixed(2)} ~ $${Number(sObj.high52).toFixed(2)}`
          : '';
        if (rangeTitle) priceTd.setAttribute('title', rangeTitle);
        priceTd.innerHTML = `<div class="mono" style="font-weight:700;">$${sObj.p.toFixed(2)}</div>${chgHtml}`;
      }

      const edTd = tds[11];
      const daysTd = tds[12];
      const st = sObj._earnStatus || resolveEarningsStatus(sObj._origEd || sObj.ed, sObj.t);
      if (sObj._sheetSummary && edTd) {
        edTd.setAttribute('title', sObj._sheetSummary);
      }
      if ((st.isSettling || st.isToday) && daysTd) {
        daysTd.innerHTML = `<span class="countdown-badge mono" style="${st.badgeStyle}">${st.badgeText}</span>`;
      } else if (st.isRolled) {
        if (edTd) {
          edTd.innerHTML = `<span class="mono" title="原財報日 (${sObj._origEd}) 已開獎滿 3 天，自動推進一季 (+90天)">${st.displayDate} <span style="font-size:9.5px; color:#059669; font-weight:700; background:#ecfdf5; border:1px solid #a7f3d0; padding:1px 4px; border-radius:4px;">+1季</span></span>`;
        }
        if (daysTd) {
          daysTd.innerHTML = `<span class="countdown-badge badge-normal mono">${st.days} 天</span>`;
        }
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
            <span style="background:#059669; color:#fff; font-size:11px; font-weight:800; padding:3px 9px; border-radius:999px;">全自動數據中樞 已啟用</span>
            <span id="livequotes-hub-status" style="font-size:12.5px; color:#132a18;">🟢 <strong>LiveQuotes 雲端報價與財報排程中樞連線中...</strong></span>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <a href="https://docs.google.com/spreadsheets/d/${LIVE_QUOTES_SHEET_ID}/edit" target="_blank" style="font-size:11.5px; font-weight:700; color:#059669; background:#ecfdf5; border:1px solid #a7f3d0; padding:4px 10px; border-radius:6px; text-decoration:none;">📊 開啟 LiveQuotes 雲端表 ↗</a>
            <a href="https://docs.google.com/spreadsheets/d/${MAIN_VALUATION_SHEET_ID}/edit" target="_blank" style="font-size:11.5px; font-weight:700; color:#1d4ed8; background:#eff6ff; border:1px solid #bfdbfe; padding:4px 10px; border-radius:6px; text-decoration:none;">📑 主估值追蹤試算表 ↗</a>
            <button type="button" onclick="window.syncEarningsHubFromCloud(true); window.syncLiveQuotesFromCloud(true); window.syncMacroIndicatorsFromCloud(true);" style="font-size:11.5px; font-weight:700; color:#ffffff; background:#059669; border:none; padding:5px 12px; border-radius:6px; cursor:pointer;">⚡ 重新同步股價、財報與總經數據</button>
          </div>
        </div>
        <div id="lq-dynamic-cards-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:12px;"></div>
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
              🟢 已連線 LiveQuotes 雲端試算表 ｜ NFLX (10/20 Beat)・TSM (10/15 Beat & Raise)・TSLA / IBM / LRCX / TXN (10/21 開獎)
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

    if (!st._origEps27) {
      st._origEps27 = st.eps27;
      st._origEps28 = st.eps28;
      st._origEps29 = st.eps29;
    }

    st.eps27 = eps27;
    st.eps28 = eps28;
    st.eps29 = eps29;

    try {
      const saved = JSON.parse(localStorage.getItem('EPS_CALIBRATIONS_V1') || '{}');
      saved[sym] = { eps27, eps28, eps29, updatedAt: new Date().toISOString() };
      localStorage.setItem('EPS_CALIBRATIONS_V1', JSON.stringify(saved));
    } catch (e) {}

    if (typeof renderTable === 'function') renderTable();
    if (typeof calcPortfolioRisk === 'function') calcPortfolioRisk();

    const lbl = document.getElementById(`calib-status-${sym}`);
    if (lbl) lbl.textContent = `✔ 已套用 ${sym} 最新財報 EPS 校準`;
  };

  window.resetEarningsCalibrations = function () {
    try { localStorage.removeItem('EPS_CALIBRATIONS_V1'); } catch (e) {}
    if (typeof stocks !== 'undefined' && Array.isArray(stocks)) {
      stocks.forEach(s => {
        if (s._origEps27) {
          s.eps27 = s._origEps27;
          s.eps28 = s._origEps28;
          s.eps29 = s._origEps29;
        }
      });
      if (typeof renderTable === 'function') renderTable();
      if (typeof calcPortfolioRisk === 'function') calcPortfolioRisk();
    }
    ['ASML', 'TSM', 'NFLX', 'TSLA', 'IBM', 'LRCX', 'TXN'].forEach(sym => {
      const lbl = document.getElementById(`calib-status-${sym}`);
      if (lbl) lbl.textContent = '已還原預設';
    });
  };

  // 從同源 earnings_hub.json 讀取最新財報開獎診斷與財報日曆
  async function syncEarningsHubFromCloud(manualTrigger) {
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

  window.syncEarningsHubFromCloud = syncEarningsHubFromCloud;

  // 從 Google Sheets LiveQuotes 雲端工作表與主估值表拉取最新 GOOGLEFINANCE 報價與財報日期 (支援 fetch 與 JSONP 雙重通道)
  async function syncLiveQuotesFromCloud(manualTrigger) {
    const sheetUrls = [
      `https://docs.google.com/spreadsheets/d/${LIVE_QUOTES_SHEET_ID}/gviz/tq?tqx=out:json&t=${Date.now()}`,
      `https://docs.google.com/spreadsheets/d/${MAIN_VALUATION_SHEET_ID}/gviz/tq?tqx=out:json&t=${Date.now()}`
    ];

    let anySynced = false;

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

          // 支援 LiveQuotes (A欄代號, C欄現價, D欄漲跌, E欄52高, F欄52低, H欄財報狀態/日期, I欄財報摘要)
          // 以及主估值表 (B欄代號, E欄現價, F欄下次財報日, G欄距離天數, O欄財報診斷)
          let sym = '';
          let isMainSheetRow = false;
          if (/^[A-Z.]{1,6}$/.test(c0) && c0 !== 'TICKER') {
            sym = c0;
          } else if (/^[A-Z.]{1,6}$/.test(c1) && c1 !== 'TICKER') {
            sym = c1;
            isMainSheetRow = true;
          }
          if (!sym) return;

          if (!isMainSheetRow) {
            const v1 = c[1] && c[1].v !== null ? c[1].v : null;
            const v2 = c[2] && c[2].v !== null ? c[2].v : null;
            const v3 = c[3] && c[3].v !== null ? c[3].v : null;
            const v4 = c[4] && c[4].v !== null ? c[4].v : null;
            const v5 = c[5] && c[5].v !== null ? c[5].v : null;
            const v7 = c[7] && (c[7].f || c[7].v) ? String(c[7].f || c[7].v).trim() : '';
            const v8 = c[8] && (c[8].f || c[8].v) ? String(c[8].f || c[8].v).trim() : '';

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
              const prev = window.LIVE_QUOTES_HUB[sym] || {};
              const dateMatch = v7.match(/(\d{4}-\d{2}-\d{2})/);
              window.LIVE_QUOTES_HUB[sym] = {
                price: Math.round(price * 100) / 100,
                chgPct: !isNaN(chgPct) ? Math.round(chgPct * 100) / 100 : (prev.chgPct || 0),
                high52: !isNaN(high52) && high52 > 0 ? Math.round(high52 * 100) / 100 : (prev.high52 || null),
                low52:  !isNaN(low52)  && low52 > 0  ? Math.round(low52 * 100) / 100  : (prev.low52 || null),
                sheetEd: dateMatch ? dateMatch[1] : prev.sheetEd,
                sheetSummary: v8 || prev.sheetSummary
              };
              updatedCount++;
            }
          } else {
            // 主估值表列讀取 (F欄下次財報日 c[5], O欄財報摘要 c[14])
            const edRaw = c[5] && (c[5].f || c[5].v) ? String(c[5].f || c[5].v).trim() : '';
            const sumRaw = c[14] && (c[14].f || c[14].v) ? String(c[14].f || c[14].v).trim() : '';
            const dateMatch = edRaw.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch && window.EARNINGS_HUB && window.EARNINGS_HUB.earningsDates) {
              window.EARNINGS_HUB.earningsDates[sym] = dateMatch[1];
            }
            if (window.LIVE_QUOTES_HUB[sym]) {
              if (dateMatch) window.LIVE_QUOTES_HUB[sym].sheetEd = dateMatch[1];
              if (sumRaw) window.LIVE_QUOTES_HUB[sym].sheetSummary = sumRaw;
            }
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
    return anySynced;
  }

  window.syncLiveQuotesFromCloud = syncLiveQuotesFromCloud;

  function initLiveQuotesAndEarningsEngine() {
    hookRenderTable();
    injectUpgradePanels();
    applyMacroIndicatorsToPage(window.MACRO_INDICATORS_HUB, 'BEA/BLS/ADP 官方快照 (10/21)');
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
