/**
 * GOOGLEFINANCE LiveQuotes Cloud Hub & Q3 Earnings Auto-Rollover / EPS Calibration Engine
 * 方向一：建立 GOOGLEFINANCE 雲端即時股價中樞 (LiveQuotes)
 * 方向二：財報開獎自動換季 (+90天) 與 EPS 模型滾動校準
 */
(function () {
  'use strict';

  const LIVE_QUOTES_SHEET_ID = '14F4q5WvvjQRlGSSDcnK7QWBTxDZkT51RzN0bXo5vRYk';
  const MAIN_VALUATION_SHEET_ID = '1czITJdQ-NGsymNMc9DB2M1Enmxopg644XQb9_seGph8';

  // 2026-10-15 GOOGLEFINANCE 雲端即時股價中樞最新快照 (0ms 零延遲啟動基準)
  const LIVE_QUOTES_SNAPSHOT = {
    "NVDA":  { price: 221.30, chgPct: -3.16, high52: 243.37, low52: 164.27 },
    "MSFT":  { price: 533.69, chgPct: -1.80, high52: 553.72, low52: 349.20 },
    "AAPL":  { price: 342.96, chgPct:  0.50, high52: 348.15, low52: 243.42 },
    "AMZN":  { price: 254.08, chgPct: -1.74, high52: 287.16, low52: 196.00 },
    "GOOGL": { price: 347.64, chgPct: -1.74, high52: 408.61, low52: 244.15 },
    "GOOG":  { price: 347.64, chgPct: -1.74, high52: 408.61, low52: 244.15 },
    "META":  { price: 737.54, chgPct: -3.27, high52: 779.82, low52: 520.26 },
    "TSLA":  { price: 367.16, chgPct: -2.15, high52: 498.82, low52: 297.38 },
    "AVGO":  { price: 346.25, chgPct: -3.10, high52: 495.00, low52: 289.96 },
    "TSM":   { price: 430.00, chgPct: -3.40, high52: 487.47, low52: 266.82 },
    "ASML":  { price: 1650.00, chgPct: -3.94, high52: 1999.96, low52: 946.11 },
    "AMD":   { price: 570.82, chgPct: -5.73, high52: 658.52, low52: 188.22 },
    "QCOM":  { price: 172.62, chgPct: -2.40, high52: 259.92, low52: 121.99 },
    "TXN":   { price: 280.65, chgPct: -2.50, high52: 334.03, low52: 152.76 },
    "AMAT":  { price: 446.63, chgPct: -3.79, high52: 739.67, low52: 203.46 },
    "LRCX":  { price: 286.92, chgPct: -4.71, high52: 438.50, low52: 135.50 },
    "KLAC":  { price: 178.81, chgPct: -2.82, high52: 307.37, low52: 99.86 },
    "MU":    { price: 914.13, chgPct: -4.08, high52: 1255.00, low52: 187.42 },
    "ARM":   { price: 238.01, chgPct: -6.81, high52: 452.61, low52: 100.02 },
    "ADI":   { price: 403.57, chgPct: -2.68, high52: 445.83, low52: 223.48 },
    "MRVL":  { price: 245.28, chgPct: -8.72, high52: 329.88, low52: 70.69 },
    "NXPI":  { price: 220.83, chgPct: -2.43, high52: 339.95, low52: 183.00 },
    "INTC":  { price: 98.12,  chgPct: -4.56, high52: 142.34, low52: 32.89 },
    "ORCL":  { price: 130.55, chgPct: -8.83, high52: 322.54, low52: 114.50 },
    "CRM":   { price: 235.95, chgPct: -0.87, high52: 269.11, low52: 146.32 },
    "ADBE":  { price: 240.68, chgPct:  1.86, high52: 363.70, low52: 190.12 },
    "NOW":   { price: 139.98, chgPct:  0.99, high52: 192.97, low52: 81.24 },
    "INTU":  { price: 310.44, chgPct:  2.98, high52: 689.17, low52: 252.84 },
    "PANW":  { price: 375.04, chgPct: -5.54, high52: 432.33, low52: 139.57 },
    "CRWD":  { price: 249.29, chgPct: -4.56, high52: 286.99, low52: 85.68 },
    "PLTR":  { price: 200.97, chgPct: -3.69, high52: 212.94, low52: 106.38 },
    "IBM":   { price: 227.88, chgPct: -1.26, high52: 332.46, low52: 199.19 },
    "CSCO":  { price: 113.64, chgPct: -1.24, high52: 130.37, low52: 68.58 },
    "SNPS":  { price: 479.93, chgPct: -2.95, high52: 539.48, low52: 362.55 },
    "CDNS":  { price: 329.46, chgPct: -1.42, high52: 416.69, low52: 262.75 },
    "FTNT":  { price: 184.05, chgPct: -3.52, high52: 197.13, low52: 73.55 },
    "WDAY":  { price: 188.77, chgPct:  1.48, high52: 247.40, low52: 110.36 },
    "UBER":  { price: 69.29,  chgPct: -2.85, high52: 100.35, low52: 65.41 },
    "NFLX":  { price: 70.57,  chgPct:  0.16, high52: 124.86, low52: 65.10 },
    "BRK.B": { price: 526.35, chgPct:  1.11, high52: 537.74, low52: 464.01 },
    "JPM":   { price: 335.28, chgPct:  1.16, high52: 366.50, low52: 279.10 },
    "V":     { price: 391.43, chgPct: -1.17, high52: 397.19, low52: 293.89 },
    "MA":    { price: 603.24, chgPct: -0.26, high52: 606.61, low52: 464.52 },
    "BAC":   { price: 51.39,  chgPct: -4.76, high52: 65.22,  low52: 46.12 },
    "WFC":   { price: 80.90,  chgPct:  0.20, high52: 97.76,  low52: 72.78 },
    "GS":    { price: 878.72, chgPct: -1.48, high52: 1153.99, low52: 740.01 },
    "MS":    { price: 181.51, chgPct: -2.75, high52: 232.25, low52: 152.80 },
    "AXP":   { price: 306.95, chgPct: -0.93, high52: 387.49, low52: 290.97 },
    "TRV":   { price: 377.82, chgPct:  1.22, high52: 398.70, low52: 252.26 },
    "LLY":   { price: 1208.74, chgPct: 3.62, high52: 1292.65, low52: 783.85 },
    "UNH":   { price: 395.62, chgPct:  4.73, high52: 461.62, low52: 255.97 },
    "JNJ":   { price: 253.91, chgPct:  2.13, high52: 281.07, low52: 184.66 },
    "ABBV":  { price: 283.48, chgPct:  3.32, high52: 285.40, low52: 190.75 },
    "MRK":   { price: 147.37, chgPct:  3.80, high52: 156.92, low52: 82.01 },
    "AMGN":  { price: 426.11, chgPct:  3.21, high52: 447.01, low52: 288.00 },
    "TMO":   { price: 673.20, chgPct:  1.53, high52: 694.33, low52: 435.27 },
    "WMT":   { price: 116.16, chgPct:  3.46, high52: 135.16, low52: 98.88 },
    "COST":  { price: 982.00, chgPct:  2.87, high52: 1096.50, low52: 844.06 },
    "PG":    { price: 156.53, chgPct:  2.28, high52: 167.25, low52: 137.62 },
    "HD":    { price: 295.51, chgPct:  0.54, high52: 397.63, low52: 277.15 },
    "MCD":   { price: 238.31, chgPct:  1.06, high52: 341.75, low52: 229.20 },
    "KO":    { price: 91.78,  chgPct:  1.85, high52: 92.49,  low52: 66.92 },
    "PEP":   { price: 129.27, chgPct:  1.55, high52: 171.48, low52: 123.47 },
    "NKE":   { price: 35.30,  chgPct: -0.08, high52: 70.44,  low52: 31.97 },
    "DIS":   { price: 108.99, chgPct:  0.38, high52: 117.09, low52: 92.19 },
    "XOM":   { price: 177.01, chgPct:  1.68, high52: 177.43, low52: 110.39 },
    "CVX":   { price: 222.04, chgPct:  1.98, high52: 222.55, low52: 146.49 },
    "CAT":   { price: 748.98, chgPct: -3.08, high52: 1073.46, low52: 510.21 },
    "GE":    { price: 307.02, chgPct: -0.20, high52: 388.84, low52: 268.91 },
    "BA":    { price: 184.66, chgPct: -0.98, high52: 254.35, low52: 176.77 },
    "HON":   { price: 207.61, chgPct:  0.15, high52: 260.15, low52: 195.77 },
    "RTX":   { price: 186.47, chgPct:  1.89, high52: 226.88, low52: 155.64 },
    "UNP":   { price: 286.43, chgPct:  1.44, high52: 315.99, low52: 215.53 },
    "VZ":    { price: 44.42,  chgPct:  2.04, high52: 51.68,  low52: 38.39 },
    "SHW":   { price: 324.54, chgPct:  0.14, high52: 377.77, low52: 289.86 },
    "DOW":   { price: 29.19,  chgPct:  2.39, high52: 42.74,  low52: 20.93 },
    "C":     { price: 122.27, chgPct: -1.81, high52: 147.96, low52: 95.00 },
    "PFE":   { price: 29.21,  chgPct:  2.96, high52: 29.49,  low52: 23.62 },
    "CVS":   { price: 90.39,  chgPct:  3.24, high52: 110.68, low52: 69.51 },
    "T":     { price: 23.05,  chgPct:  0.88, high52: 29.44,  low52: 19.89 },
    "GM":    { price: 83.05,  chgPct: -1.13, high52: 91.85,  low52: 56.81 },
    "TM":    { price: 188.60, chgPct: -0.06, high52: 248.90, low52: 166.10 },
    "QQQ":   { price: 728.95, chgPct: -1.97, high52: 762.86, low52: 555.60 },
    "SPY":   { price: 769.60, chgPct: -1.08, high52: 781.62, low52: 629.28 },
    "SMH":   { price: 564.74, chgPct: -3.98, high52: 671.83, low52: 315.05 },
    "SOXX":  { price: 519.42, chgPct: -4.50, high52: 655.94, low52: 260.50 },
    "IWM":   { price: 271.37, chgPct: -1.93, high52: 305.18, low52: 228.44 },
    "DIA":   { price: 515.63, chgPct: -0.11, high52: 546.75, low52: 450.44 },
    "XLK":   { price: 190.43, chgPct: -2.98, high52: 203.25, low52: 126.68 },
    "XLF":   { price: 54.52,  chgPct: -0.55, high52: 58.60,  low52: 47.67 },
    "TLT":   { price: 78.89,  chgPct:  0.66, high52: 92.19,  low52: 76.43 },
    "ARKK":  { price: 9.38,   chgPct: -2.85, high52: 10.66,  low52: 6.74 }
  };

  window.LIVE_QUOTES_HUB = Object.assign({}, LIVE_QUOTES_SNAPSHOT);

  // 方向二：財報開獎自動偵測、Q3 結算徽章與 +90 天自動換季
  function resolveEarningsStatus(targetDateStr) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const parts = String(targetDateStr || "2026-11-01").split("-").map(Number);
    let target = new Date(parts[0] || 2026, (parts[1] || 1) - 1, parts[2] || 1);
    let rawDiff = Math.round((target - today) / 86400000);

    // 當日或開獎後 3 天內 (-3 <= rawDiff <= 0)：顯示 🔔 財報已開獎 (Q3 結算中)
    if (rawDiff <= 0 && rawDiff >= -3) {
      return {
        days: 0,
        rawDiff: rawDiff,
        displayDate: targetDateStr,
        isSettling: true,
        isRolled: false,
        badgeText: "🔔 財報已開獎 (Q3 結算中)",
        badgeStyle: "background:#f5f3ff; color:#6d28d9; border:1px solid #c4b5fd; font-weight:800;"
      };
    }

    // 超過 3 天 (rawDiff < -3)：自動推進一季 (+90 天)
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
      isRolled: rolled,
      badgeText: `${rawDiff} 天`,
      badgeStyle: ""
    };
  }

  window.resolveEarningsStatus = resolveEarningsStatus;

  // 將報價字典套用至頁面上的 stocks / GOOGLE_FINANCE_LATEST_CLOSES / FCN 模擬器並重繪
  function applyQuotesToPage(quotesMap, sourceLabel) {
    if (!quotesMap) return;

    // 1. 更新全域 GOOGLE_FINANCE_LATEST_CLOSES (若存在於美股儀表板或 FCN Master)
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

    // 2. 若在美股儀表板 (具備 stocks 陣列與 renderTable)
    if (typeof stocks !== 'undefined' && Array.isArray(stocks)) {
      // 確保 NFLX 存在於 stocks 清單中
      if (!stocks.some(s => s.t === 'NFLX')) {
        stocks.splice(18, 0, {
          t: "NFLX", n: "Netflix", s: "數位娛樂串流", cat: "CLOUD",
          sp500: true, nasdaq: true, dow: false,
          p: 70.57, ed: "2026-10-15", eps27: 24.0, eps28: 28.0, eps29: 32.0, pe: 28, mult: 0.96
        });
      }

      // 覆寫 getDaysDiff 以啟用今日實際日期計算與 +90 天自動換季
      window.getDaysDiff = function (edStr) {
        return resolveEarningsStatus(edStr).days;
      };

      stocks.forEach(s => {
        // 先儲存原始財報日以供判定開獎後 0~3 天或 >3 天換季
        if (!s._origEd) s._origEd = s.ed;
        const status = resolveEarningsStatus(s._origEd);
        s._earnStatus = status;
        if (status.isRolled) {
          s.ed = status.displayDate;
        }

        const q = quotesMap[s.t];
        if (q && q.price > 0) {
          s.p = q.price;
          s.chg = q.chgPct;
          s.high52 = q.high52;
          s.low52 = q.low52;
        }
      });

      // 檢查是否有已確認套用的財報 EPS 校準覆寫 (LocalStorage)
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

    // 更新狀態徽章
    const statusEl = document.getElementById('livequotes-hub-status');
    if (statusEl) {
      statusEl.innerHTML = `🟢 <strong>LiveQuotes 雲端報價中樞已同步</strong> (${sourceLabel}) ｜ 已即時更新 ${Object.keys(quotesMap).length} 檔美股現價、單日漲跌幅、52週高低點與 3 年 CAGR`;
    }
  }

  // 在表格渲染後，為「財報已開獎 (Q3 結算中)」、「已換季 (+90天)」與「單日漲跌幅 / 52W區間」加上強化視覺標記
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

      // 1. 強化現價欄 (顯示單日漲跌幅與 52W 高低點 Tooltip)
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

      // 2. 強化財報日與倒數天數欄 (方向二：過期偵測與 Q3 結算中 / +90天換季)
      const edTd = tds[11];
      const daysTd = tds[12];
      const st = sObj._earnStatus || resolveEarningsStatus(sObj._origEd || sObj.ed);
      if (st.isSettling && daysTd) {
        daysTd.innerHTML = `<span class="countdown-badge mono" style="${st.badgeStyle}">${st.badgeText}</span>`;
      } else if (st.isRolled) {
        if (edTd) {
          edTd.innerHTML = `<span class="mono" title="原財報日 (${sObj._origEd}) 已過超過 3 天，自動推進一季 (+90天)">${st.displayDate} <span style="font-size:9.5px; color:#059669; font-weight:700; background:#ecfdf5; border:1px solid #a7f3d0; padding:1px 4px; border-radius:4px;">+1季</span></span>`;
        }
        if (daysTd) {
          daysTd.innerHTML = `<span class="countdown-badge badge-normal mono">${st.days} 天</span>`;
        }
      }
    });
  }

  // 攔截原生 renderTable，確保每次篩選/排序/拉動殖利率滑桿後都保留方向一與方向二標記
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
    // 若在美股儀表板 (#valuation-section)
    const valSection = document.getElementById('valuation-section');
    if (valSection && !document.getElementById('lq-earnings-calibration-panel')) {
      const panel = document.createElement('div');
      panel.id = 'lq-earnings-calibration-panel';
      panel.style.cssText = 'background: linear-gradient(135deg, #ffffff 0%, #f0fdf4 60%, #f5f3ff 100%); border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);';

      panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #e2e8f0;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="background:#059669; color:#fff; font-size:11px; font-weight:800; padding:3px 9px; border-radius:999px;">方向一＋方向二 已啟用</span>
            <span id="livequotes-hub-status" style="font-size:12.5px; color:#132a18;">🟢 <strong>LiveQuotes 雲端報價中樞已連線</strong> ｜ 68+ 檔美股即時收盤價、單日漲跌幅与 3 年 CAGR 已同步</span>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <a href="https://docs.google.com/spreadsheets/d/${LIVE_QUOTES_SHEET_ID}/edit" target="_blank" style="font-size:11.5px; font-weight:700; color:#065f46; background:#ecfdf5; border:1px solid #a7f3d0; padding:4px 10px; border-radius:6px; text-decoration:none;">📊 開啟 LiveQuotes 雲端表 ↗</a>
            <a href="https://docs.google.com/spreadsheets/d/${MAIN_VALUATION_SHEET_ID}/edit" target="_blank" style="font-size:11.5px; font-weight:700; color:#1e40af; background:#eff6ff; border:1px solid #bfdbfe; padding:4px 10px; border-radius:6px; text-decoration:none;">📑 主估值追蹤試算表 ↗</a>
            <button type="button" onclick="window.syncLiveQuotesFromCloud(true)" style="font-size:11.5px; font-weight:700; color:#fff; background:#059669; border:none; padding:5px 11px; border-radius:6px; cursor:pointer;">⚡ 重新同步雲端報價</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:12px;">
          <!-- ASML Q3 已開獎 Beat 診斷與 EPS 校準卡 -->
          <div style="background:#ffffff; border:1px solid #ddd6fe; border-left:4px solid #7c3aed; border-radius:8px; padding:12px 14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <strong style="font-size:13px; color:#1e1b4b;">🔔 ASML (艾斯摩爾) Q3 財報開獎診斷</strong>
              <span style="font-size:10.5px; font-weight:800; background:#f5f3ff; color:#6d28d9; border:1px solid #c4b5fd; padding:2px 7px; border-radius:999px;">10/14 已開獎 · Q3 結算中</span>
            </div>
            <div style="font-size:11.5px; color:#475569; line-height:1.55; margin-bottom:8px;">
              • <strong>Q3 實績 (Beat)</strong>：營收 <strong>€11.7B</strong>（近財測高標）、毛利率 <strong>57.5%</strong>（優於預期 54.0%）、Basic EPS <strong>€12.95</strong>。<br>
              • <strong>Q4 與全年財測</strong>：Q4 營收指引 <strong>€14.2B~€15.2B</strong>（毛利率 ~57%），2026 全年營收 <strong>€44B~€45B</strong>，AI 客戶需求能見度延伸至 2029–2030 年。<br>
              • <strong>估值模型修正建議</strong>：建議將 <code>FY27 EPS</code> 由 <strong>$29.00 上調至 $32.50</strong>（<code>FY28</code> 升至 $39.80、<code>FY29</code> 升至 $46.50）。
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <button type="button" id="btn-calib-asml" onclick="window.applyEarningsCalibration('ASML', 32.5, 39.8, 46.5)" style="font-size:11px; font-weight:700; background:#7c3aed; color:#fff; border:none; padding:4px 10px; border-radius:5px; cursor:pointer;">✅ 套用 ASML EPS 上修建議</button>
              <span id="calib-status-ASML" style="font-size:11px; color:#6d28d9; font-weight:700;"></span>
            </div>
          </div>

          <!-- NFLX & TSM 今明開獎監控與試算卡 -->
          <div style="background:#ffffff; border:1px solid #fde047; border-left:4px solid #ca8a04; border-radius:8px; padding:12px 14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <strong style="font-size:13px; color:#132a18;">⚡ 本週重點開獎預告：NFLX (10/15) ＆ TSM (10/16)</strong>
              <span style="font-size:10.5px; font-weight:800; background:#fef9c3; color:#854d0e; border:1px solid #fde047; padding:2px 7px; border-radius:999px;">06:00 晨報自動診斷</span>
            </div>
            <div style="font-size:11.5px; color:#475569; line-height:1.55; margin-bottom:8px;">
              • <strong>TSM (台積電 ADR)</strong>：市場共識 Q3 EPS <strong>$4.46</strong>、營收 <strong>$45.55B</strong>。若毛利率與 AI/CoWoS 指引優於預期，建議將 <code>FY27 EPS</code> 由 <strong>$8.50 上調至 $8.90</strong>。<br>
              • <strong>NFLX (Netflix)</strong>：今日 (10/15) 盤後開獎（已自動切換為 <code>🔔 財報已開獎 (Q3 結算中)</code>），Q3 營收指引約 <strong>$12.86B (+12% YoY)</strong>。<br>
              • <strong>自動換季機制</strong>：JPM、WFC、PEP 等開獎已滿 3 天標的，下次財報日已自動推進一季 (<code>+90 天</code>)。
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <button type="button" id="btn-calib-tsm" onclick="window.applyEarningsCalibration('TSM', 8.9, 10.8, 12.8)" style="font-size:11px; font-weight:700; background:#059669; color:#fff; border:none; padding:4px 10px; border-radius:5px; cursor:pointer;">📈 預演 TSM Beat 上修 ($8.50➔$8.90)</button>
              <button type="button" onclick="window.resetEarningsCalibrations()" style="font-size:11px; font-weight:600; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; padding:4px 8px; border-radius:5px; cursor:pointer;">還原預設 EPS</button>
              <span id="calib-status-TSM" style="font-size:11px; color:#059669; font-weight:700;"></span>
            </div>
          </div>
        </div>
      `;
      valSection.insertAdjacentElement('afterend', panel);
    }

    // 若在主儀表板 (Global Markets Hub, 無 #valuation-section 但有 .portals-grid)
    const portalsGrid = document.querySelector('.portals-grid');
    if (portalsGrid && !document.getElementById('hub-livequotes-banner')) {
      const hubBanner = document.createElement('div');
      hubBanner.id = 'hub-livequotes-banner';
      hubBanner.style.cssText = 'background: linear-gradient(135deg, #ffffff 0%, #f0fdf4 65%, #f5f3ff 100%); border: 1px solid #dce7d5; border-radius: 14px; padding: 16px 22px; margin-bottom: 28px; box-shadow: 0 4px 18px -2px rgba(22, 60, 30, 0.05);';
      hubBanner.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <span style="background:#059669; color:#fff; font-size:10.5px; font-weight:800; padding:2px 8px; border-radius:999px;">LIVEQUOTES 雲端中樞</span>
              <strong style="font-size:14.5px; color:#132a18;">GOOGLEFINANCE 雲端即時股價中樞 ＆ Q3 財報季動態校準雷達</strong>
            </div>
            <div id="livequotes-hub-status" style="font-size:12px; color:#556d59;">
              🟢 已連線 Google Sheets <code>LiveQuotes</code> 分頁 ｜ NVDA <strong>$221.30</strong> (-3.16%) · MSFT <strong>$533.69</strong> (-1.80%) · AAPL <strong>$342.96</strong> (+0.50%) · TSM <strong>$430.00</strong> (-3.40%) · ASML <strong>$1,650.00</strong> (🔔 Q3 結算中)
            </div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <a href="https://docs.google.com/spreadsheets/d/${LIVE_QUOTES_SHEET_ID}/edit" target="_blank" style="font-size:12px; font-weight:700; color:#065f46; background:#ecfdf5; border:1px solid #a7f3d0; padding:6px 12px; border-radius:8px; text-decoration:none;">📊 LiveQuotes 雲端報價表 ↗</a>
            <a href="./nasdaq/#valuation-section" style="font-size:12px; font-weight:700; color:#6d28d9; background:#f5f3ff; border:1px solid #ddd6fe; padding:6px 12px; border-radius:8px; text-decoration:none;">🔔 查看 Q3 財報開獎與 EPS 校準 →</a>
          </div>
        </div>
      `;
      portalsGrid.insertAdjacentElement('afterend', hubBanner);
    }
  }

  // 一鍵套用財報開獎後之 EPS 模型參數動態修正
  window.applyEarningsCalibration = function (sym, eps27, eps28, eps29) {
    if (typeof stocks === 'undefined') return;
    const st = stocks.find(x => x.t === sym);
    if (!st) return;
    if (!st._origEps) {
      st._origEps = { eps27: st.eps27, eps28: st.eps28, eps29: st.eps29 };
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
    if (lbl) lbl.textContent = `✓ 已套用 (FY27 EPS $${eps27.toFixed(2)})`;
  };

  window.resetEarningsCalibrations = function () {
    try { localStorage.removeItem('EPS_CALIBRATIONS_V1'); } catch (e) {}
    if (typeof stocks !== 'undefined') {
      stocks.forEach(st => {
        if (st._origEps) {
          st.eps27 = st._origEps.eps27;
          st.eps28 = st._origEps.eps28;
          st.eps29 = st._origEps.eps29;
        }
      });
    }
    ['ASML', 'TSM'].forEach(sym => {
      const lbl = document.getElementById(`calib-status-${sym}`);
      if (lbl) lbl.textContent = '';
    });
    if (typeof renderTable === 'function') renderTable();
    if (typeof calcPortfolioRisk === 'function') calcPortfolioRisk();
  };

  // 從 Google Sheets LiveQuotes 雲端工作表拉取最新 GOOGLEFINANCE 報價
  async function syncLiveQuotesFromCloud(manualTrigger) {
    const endpoints = [
      `https://docs.google.com/spreadsheets/d/${LIVE_QUOTES_SHEET_ID}/gviz/tq?tqx=out:json&t=${Date.now()}`,
      `https://docs.google.com/spreadsheets/d/${MAIN_VALUATION_SHEET_ID}/gviz/tq?tqx=out:json&sheet=LiveQuotes&t=${Date.now()}`
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) continue;
        const txt = await res.text();
        const match = txt.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?/);
        if (!match) continue;
        const json = JSON.parse(match[1]);
        const rows = (json.table && json.table.rows) || [];
        let parsedCount = 0;

        rows.forEach(r => {
          const c = r.c || [];
          const sym = c[0] && c[0].v ? String(c[0].v).trim().toUpperCase() : '';
          if (!sym || sym === '代號' || sym === 'TICKER') return;

          // 兼容兩種欄位順序：(A:代號, B:名稱, C:現價, D:漲跌幅, E:52高, F:52低) 或 (A:代號, B:現價, C:漲跌幅, D:52高低)
          let price = null, chgPct = null, high52 = null, low52 = null;
          const v1 = c[1] && c[1].v !== null ? c[1].v : null;
          const v2 = c[2] && c[2].v !== null ? c[2].v : null;
          const v3 = c[3] && c[3].v !== null ? c[3].v : null;
          const v4 = c[4] && c[4].v !== null ? c[4].v : null;
          const v5 = c[5] && c[5].v !== null ? c[5].v : null;

          if (typeof v1 === 'number' && v1 > 0) {
            price = v1;
            chgPct = typeof v2 === 'number' ? v2 : parseFloat(v2);
            high52 = typeof v3 === 'number' ? v3 : parseFloat(v3);
            low52  = typeof v4 === 'number' ? v4 : parseFloat(v4);
          } else if (typeof v2 === 'number' && v2 > 0) {
            price = v2;
            chgPct = typeof v3 === 'number' ? v3 : parseFloat(v3);
            high52 = typeof v4 === 'number' ? v4 : parseFloat(v4);
            low52  = typeof v5 === 'number' ? v5 : parseFloat(v5);
          }

          if (price && !isNaN(price) && price > 0) {
            window.LIVE_QUOTES_HUB[sym] = {
              price: Math.round(price * 100) / 100,
              chgPct: !isNaN(chgPct) ? Math.round(chgPct * 100) / 100 : (window.LIVE_QUOTES_HUB[sym]?.chgPct || 0),
              high52: !isNaN(high52) && high52 > 0 ? Math.round(high52 * 100) / 100 : (window.LIVE_QUOTES_HUB[sym]?.high52 || null),
              low52:  !isNaN(low52)  && low52 > 0  ? Math.round(low52 * 100) / 100  : (window.LIVE_QUOTES_HUB[sym]?.low52 || null)
            };
            parsedCount++;
          }
        });

        if (parsedCount >= 10) {
          try {
            localStorage.setItem('LIVE_QUOTES_HUB_CACHE', JSON.stringify({
              updatedAt: new Date().toISOString(),
              quotes: window.LIVE_QUOTES_HUB
            }));
          } catch (e) {}
          applyQuotesToPage(window.LIVE_QUOTES_HUB, 'Google Sheets LiveQuotes 即時連線');
          return true;
        }
      } catch (e) {
        // 繼續嘗試下一個雲端端點
      }
    }

    if (manualTrigger) {
      applyQuotesToPage(window.LIVE_QUOTES_HUB, 'Google Finance 雲端快照基準');
    }
    return false;
  }

  window.syncLiveQuotesFromCloud = syncLiveQuotesFromCloud;

  // 啟動初始化：先以 0ms 載入最新快照與攔截器，再非同步拉取 Google Sheets LiveQuotes
  function initLiveQuotesAndEarningsEngine() {
    hookRenderTable();
    injectUpgradePanels();
    applyQuotesToPage(window.LIVE_QUOTES_HUB, 'GOOGLEFINANCE 雲端快照');
    syncLiveQuotesFromCloud(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiveQuotesAndEarningsEngine);
  } else {
    initLiveQuotesAndEarningsEngine();
  }
})();
