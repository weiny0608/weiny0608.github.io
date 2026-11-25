(function () {
  'use strict';

  const scriptUrl = document.currentScript && document.currentScript.src;
  const card = document.getElementById('fedwatch-card');
  if (!scriptUrl || !card) return;
  const dataUrl = new URL('latest.json', scriptUrl);
  const statusUrl = new URL('status.json', scriptUrl);
  const statusEl = document.getElementById('fedwatch-status');
  const metaEl = document.getElementById('fedwatch-meta');
  const toolbar = document.getElementById('fedwatch-toolbar');
  const select = document.getElementById('fedwatch-meeting');
  const detail = document.getElementById('fedwatch-detail');
  const matrix = document.getElementById('fedwatch-matrix');
  const matrixTable = document.getElementById('fedwatch-matrix-table');
  const observation = document.getElementById('fedwatch-observation');
  let snapshot = null;
  let collectionStatus = null;
  let statusUnavailable = false;
  let pending = false;
  let selectedMeeting = '';
  let lastNewYorkDay = '';

  const style = document.createElement('style');
  style.textContent = `
    .fedwatch-card { min-width:0; }
    .fedwatch-card .card-header { align-items:flex-start; flex-wrap:wrap; gap:12px; }
    .fedwatch-card h3 { margin:0; }
    .fedwatch-card [hidden] { display:none !important; }
    .fw-subtitle { margin:5px 0 0; color:var(--text-muted,#556d59); font-size:14px; }
    .fw-status { display:inline-block; padding:5px 9px; border-radius:6px; font-size:13px; font-weight:700; background:#eef3ed; color:#526256; }
    .fw-status[data-state="ok"] { background:#e6f5ed; color:#106348; }
    .fw-status[data-state="stale"],.fw-status[data-state="error"] { background:#fff4d7; color:#81500c; }
    .fw-meta { margin:12px 0; color:var(--text-muted,#556d59); font-size:14px; line-height:1.65; overflow-wrap:anywhere; }
    .fw-meta a { color:#08765c; text-decoration:underline; text-underline-offset:3px; }
    .fw-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px; margin:15px 0 12px; font-size:14px; }
    .fw-toolbar label { font-weight:700; }
    .fw-toolbar select { color:#173d29; background-color:#fff; border:1px solid #b9cdbb; border-radius:6px; padding:7px 30px 7px 9px; font:inherit; appearance:none; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='m1 1 5 5 5-5' fill='none' stroke='%23556d59' stroke-width='1.8'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 10px center; background-size:11px; }
    .fw-toolbar select:focus-visible,.fw-matrix summary:focus-visible { outline:2px solid #08765c; outline-offset:3px; }
    #fedwatch-observation { color:var(--text-muted,#556d59); font-size:14px; }
    .fw-table-scroll { max-width:100%; overflow-x:auto; overscroll-behavior-x:contain; }
    .fedwatch-card .fedwatch-table { font-size:14px; }
    .fedwatch-card .fedwatch-table th { padding:10px; font-size:14px; white-space:nowrap; }
    .fedwatch-card .fedwatch-table td { padding:11px 10px; white-space:nowrap; font-variant-numeric:tabular-nums; }
    .fedwatch-card .fedwatch-table td:not(:first-child),.fedwatch-card .fedwatch-table th:not(:first-child) { text-align:right; }
    .fw-probability { display:block; font-weight:700; color:#08765c; }
    .fw-probability-track { height:5px; min-width:70px; margin-top:6px; border-radius:3px; background:#eaf1e8; overflow:hidden; }
    .fw-probability-track span { display:block; height:100%; background:#16b787; border-radius:3px; }
    .fw-history { color:#63736a; }
    .fw-matrix { margin-top:16px; padding-top:12px; border-top:1px solid var(--border-light,#dce8d5); }
    .fw-matrix summary { cursor:pointer; font-size:14px; font-weight:700; color:#215c41; padding:4px 0 10px; }
    .fw-matrix .fedwatch-table { font-size:14px; }
    .fw-matrix .fw-leading { color:#085941; background:#dff3e9; font-weight:700; }
    .fw-matrix .fw-selected th { color:#08765c; }
    .fw-matrix .fedwatch-table th:first-child { position:sticky; left:0; background:#f4f8f1; z-index:1; }
    .fw-note { margin:14px 0 0; color:var(--text-muted,#556d59); font-size:12px; line-height:1.7; }
    .fw-empty { margin:18px 0; padding:18px 12px; border:1px dashed #c8d6c8; border-radius:8px; color:#5d6e61; font-size:14px; line-height:1.6; }
    @media(max-width:560px) {
      .fedwatch-card .fedwatch-table th,.fedwatch-card .fedwatch-table td { padding:9px 7px; }
      .fedwatch-card .fedwatch-table { font-size:14px; }
      .fedwatch-card .fedwatch-table th { font-size:14px; }
      .fw-toolbar { gap:8px; }
      #fedwatch-observation { flex-basis:100%; }
    }
  `;
  document.head.appendChild(style);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function newYorkDay() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = type => parts.find(item => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function ratesValid(rates) {
    return Array.isArray(rates) && rates.length > 0 && rates.every(rate =>
      Number.isInteger(rate.lower_bps) && Number.isInteger(rate.upper_bps) &&
      rate.lower_bps >= 0 && rate.upper_bps > rate.lower_bps &&
      (rate.probability === null || (typeof rate.probability === 'number' &&
        Number.isFinite(rate.probability) && rate.probability >= 0 && rate.probability <= 1))
    ) && new Set(rates.map(rateKey)).size === rates.length;
  }

  function validate(data) {
    if (!data || data.schema_version !== 1 || !isDate(data.data_as_of) ||
        !Number.isFinite(Date.parse(data.retrieved_at)) || !data.source ||
        typeof data.source.name !== 'string' || typeof data.source.url !== 'string' ||
        !Array.isArray(data.meetings) || data.meetings.length === 0) {
      throw new Error('官方機率資料格式不完整');
    }
    const source = new URL(data.source.url);
    if (source.protocol !== 'https:') throw new Error('資料來源連結格式錯誤');
    const dates = new Set();
    for (const meeting of data.meetings) {
      if (!isDate(meeting.meeting_date) || !isDate(meeting.as_of) || !ratesValid(meeting.rates) ||
          dates.has(meeting.meeting_date)) throw new Error('會議機率資料格式錯誤');
      dates.add(meeting.meeting_date);
      for (const key of ['previous_day', 'previous_week']) {
        const history = meeting[key];
        if (history != null && (!isDate(history.as_of) || history.as_of >= meeting.as_of ||
            !ratesValid(history.rates))) throw new Error('歷史機率資料格式錯誤');
      }
    }
    return data;
  }

  function rateKey(rate) {
    return `${rate.lower_bps}-${rate.upper_bps}`;
  }

  function rangeLabel(rate) {
    return `${(rate.lower_bps / 100).toFixed(2)}–${(rate.upper_bps / 100).toFixed(2)}%`;
  }

  function probability(value) {
    return typeof value === 'number' ? (value * 100).toFixed(1) + '%' : '—';
  }

  function rateMap(rates) {
    return new Map((rates || []).map(rate => [rateKey(rate), rate.probability]));
  }

  function allRanges(meetings, includeHistory) {
    const ranges = new Map();
    meetings.forEach(meeting => {
      const snapshots = [meeting];
      if (includeHistory) snapshots.push(meeting.previous_day, meeting.previous_week);
      snapshots.filter(Boolean).forEach(item => item.rates.forEach(rate => {
        if (typeof rate.probability === 'number' && rate.probability > 0) ranges.set(rateKey(rate), rate);
      }));
    });
    return [...ranges.values()].sort((a, b) => a.lower_bps - b.lower_bps || a.upper_bps - b.upper_bps);
  }

  function readableTime(value) {
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(value));
  }

  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusEl.textContent = text;
  }

  function renderMeeting(meeting) {
    const ranges = allRanges([meeting], true);
    const latest = rateMap(meeting.rates);
    const previousDay = rateMap(meeting.previous_day && meeting.previous_day.rates);
    const previousWeek = rateMap(meeting.previous_week && meeting.previous_week.rates);
    const dayHeading = meeting.previous_day ? `前一筆<br>${escapeHtml(meeting.previous_day.as_of)}` : '前一筆<br>未提供';
    const weekHeading = meeting.previous_week ? `約一週前<br>${escapeHtml(meeting.previous_week.as_of)}` : '約一週前<br>未提供';
    observation.textContent = `機率觀察日：${meeting.as_of}`;
    if (!ranges.length) {
      detail.innerHTML = '<p class="fw-empty">此會議尚未提供可顯示的機率區間。</p>';
      return;
    }
    detail.innerHTML = `<table class="fedwatch-table"><caption class="fw-note" style="text-align:left;margin:0 0 8px">${escapeHtml(meeting.meeting_date)} 會後目標利率區間</caption><thead><tr><th scope="col">目標利率區間</th><th scope="col">最新快照<br>${escapeHtml(meeting.as_of)}</th><th scope="col">${dayHeading}</th><th scope="col">${weekHeading}</th></tr></thead><tbody>${ranges.map(rate => {
      const key = rateKey(rate);
      const value = latest.get(key);
      const bar = typeof value === 'number' ? `<div class="fw-probability-track" aria-hidden="true"><span style="width:${(value * 100).toFixed(4)}%"></span></div>` : '';
      return `<tr><th scope="row">${rangeLabel(rate)}</th><td><span class="fw-probability">${probability(value)}</span>${bar}</td><td class="fw-history">${probability(previousDay.get(key))}</td><td class="fw-history">${probability(previousWeek.get(key))}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function renderMatrix(meetings) {
    const ranges = allRanges(meetings, false);
    matrix.hidden = meetings.length < 2 || ranges.length === 0;
    if (matrix.hidden) {
      matrixTable.replaceChildren();
      return;
    }
    matrixTable.innerHTML = `<table class="fedwatch-table"><caption class="fw-note" style="text-align:left;margin:0 0 8px">各場會議最新可用快照・目標利率區間</caption><thead><tr><th scope="col">會議日期<br>觀察日</th>${ranges.map(range => `<th scope="col">${rangeLabel(range)}</th>`).join('')}</tr></thead><tbody>${meetings.map(meeting => {
      const rates = rateMap(meeting.rates);
      const highest = Math.max(...meeting.rates.map(rate => typeof rate.probability === 'number' ? rate.probability : -1));
      return `<tr${meeting.meeting_date === selectedMeeting ? ' class="fw-selected"' : ''}><th scope="row">${escapeHtml(meeting.meeting_date)}<br><span class="fw-note">${escapeHtml(meeting.as_of)}</span></th>${ranges.map(range => {
        const value = rates.get(rateKey(range));
        return `<td${typeof value === 'number' && value === highest && value > 0 ? ' class="fw-leading"' : ''}>${probability(value)}</td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody></table>`;
  }

  function render() {
    if (!snapshot) return;
    const today = newYorkDay();
    lastNewYorkDay = today;
    const meetings = snapshot.meetings.filter(meeting => meeting.meeting_date >= today)
      .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
    const next = meetings[0];
    const nextEl = document.getElementById('fedwatch-next-meeting');
    if (nextEl) nextEl.textContent = next ? `下次 FOMC：${next.meeting_date}` : '下次 FOMC：等待新會期資料';
    if (!meetings.some(meeting => meeting.meeting_date === selectedMeeting)) selectedMeeting = next ? next.meeting_date : '';
    select.replaceChildren(...meetings.map(meeting => {
      const option = document.createElement('option');
      option.value = meeting.meeting_date;
      option.textContent = meeting.meeting_date;
      option.selected = meeting.meeting_date === selectedMeeting;
      return option;
    }));
    toolbar.hidden = !next;
    card.setAttribute('aria-busy', 'false');

    // Observation age and retrieval age are independent: downloading an old snapshot does not make it fresh.
    const ageDays = Math.floor((Date.parse(today + 'T12:00:00Z') - Date.parse(snapshot.data_as_of + 'T12:00:00Z')) / 86400000);
    const retrievalAgeHours = (Date.now() - Date.parse(snapshot.retrieved_at)) / 3600000;
    const sourceLink = document.createElement('a');
    sourceLink.href = snapshot.source.url;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    sourceLink.textContent = snapshot.source.name;
    metaEl.replaceChildren(`觀察日：${snapshot.data_as_of} ｜ 擷取：${readableTime(snapshot.retrieved_at)}（台北） ｜ 來源：`, sourceLink);
    if (collectionStatus && collectionStatus.state === 'error') {
      setStatus('error', '更新失敗・保留最近成功資料');
      if (typeof collectionStatus.last_attempt_at === 'string' && Number.isFinite(Date.parse(collectionStatus.last_attempt_at))) {
        metaEl.append(` ｜ 最近嘗試：${readableTime(collectionStatus.last_attempt_at)}（台北）`);
      }
    } else if (!next || ageDays > 5 || retrievalAgeHours > 72) {
      setStatus('stale', '資料待更新・請留意觀察日');
    } else if (statusUnavailable) {
      setStatus('stale', '已載入快照・更新狀態待確認');
    } else {
      setStatus('ok', '官方歷史資料・延遲更新');
    }

    if (!next) {
      detail.innerHTML = '<p class="fw-empty">目前快照中的會議皆已結束，尚無下一場會議資料。請稍後再查看。</p>';
      observation.textContent = '';
      matrix.hidden = true;
      matrixTable.replaceChildren();
      return;
    }
    renderMeeting(meetings.find(meeting => meeting.meeting_date === selectedMeeting));
    renderMatrix(meetings);
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function refresh() {
    if (pending) return;
    pending = true;
    try {
      const [dataResult, statusResult] = await Promise.allSettled([fetchJson(dataUrl), fetchJson(statusUrl)]);
      statusUnavailable = statusResult.status !== 'fulfilled' ||
        !statusResult.value || !['ok', 'error'].includes(statusResult.value.state);
      collectionStatus = statusUnavailable ? null : statusResult.value;
      if (dataResult.status !== 'fulfilled') throw new Error('無法載入官方快照');
      snapshot = validate(dataResult.value);
      render();
    } catch (error) {
      card.setAttribute('aria-busy', 'false');
      if (snapshot) {
        render();
        setStatus('error', '連線失敗・保留已載入快照');
      } else {
        setStatus('error', '官方機率資料暫時無法取得');
        metaEl.textContent = '尚未載入有效的官方機率資料，請稍後重新整理。';
        detail.innerHTML = '<p class="fw-empty">目前沒有可用機率快照。</p>';
        toolbar.hidden = true;
        matrix.hidden = true;
        const nextEl = document.getElementById('fedwatch-next-meeting');
        if (nextEl) nextEl.textContent = '下次 FOMC：資料暫時無法取得';
      }
    } finally {
      pending = false;
    }
  }

  select.addEventListener('change', function () {
    selectedMeeting = select.value;
    render();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });
  setInterval(function () {
    if (!document.hidden) refresh();
  }, 30 * 60 * 1000);
  setInterval(function () {
    if (snapshot && newYorkDay() !== lastNewYorkDay) render();
  }, 60 * 1000);
  refresh();
})();
