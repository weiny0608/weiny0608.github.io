(function (root) {
    'use strict';
    const C = typeof module !== 'undefined' && module.exports ? require('./fcn-core.js') : FCNCore;
    const API = 'https://fcn-market-proxy.weiny0608.workers.dev';
    const historyCache = new Map(), pending = new Map();
    let blockedUntil = 0;
    function clock(date = new Date()) {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
        }).formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
        return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`,
            weekday: p.weekday, minute: Number(p.hour) * 60 + Number(p.minute) };
    }
    const completedDate = () => { const n = clock(); return n.minute >= 1080 ? n.date : C.plusDays(n.date, -1); };
    const marketHours = () => { const n = clock(); return !['Sat', 'Sun'].includes(n.weekday) && n.minute >= 570 && n.minute <= 960; };
    function message(error) {
        const text = error instanceof Error ? error.message : String(error);
        const [key, detail, asset] = text.split(':');
        return ({
            INVALID_DATE: '請填寫有效日期。', START_AFTER_ASOF: '期初日不可晚於截至日。',
            ASSET_COUNT: '請輸入 1 至 4 檔股票。', DUPLICATE_SYMBOL: '股票代碼不可重複。',
            INVALID_SYMBOL: '股票代碼格式不正確。', INVALID_INITIAL: '期初價須大於零。',
            INVALID_BARRIER: '障礙價須介於 0 至 300%，且大於零。',
            BARRIER_ORDER: '請設定 KI ≤ 執行價 ≤ KO。', INVALID_TENOR: '存續期間須為 1 至 36 個整數月。',
            INVALID_GUARANTEE: 'KO 鎖定期須介於 0 至存續月數。', INVALID_NOTIONAL: '請輸入有效本金。',
            INVALID_COUPON: '年票息須介於 0% 至 100%。', INVALID_OPTION: '請選擇有效觀察選項。',
            NO_DATA: '所選期間沒有已完成的共同日線。請調整日期。',
            INCOMPLETE_DAY: `${detail} 缺少 ${asset} 日線，已停止判定，沒有補造價格。`,
            MISSING_INCEPTION: `資料未涵蓋期初日，第一筆共同資料為 ${detail}。`,
            MISSING_MATURITY: `缺少到期日 ${detail} 附近的行情，無法結算。`,
            MISSING_OBSERVATION: `缺少觀察日 ${detail} 附近的行情。`,
            MISSING_LOW: `${detail} 缺少低價，請改用每日收盤 KI。`,
            BAD_LOW: `${detail} 日低價無效。`, BAD_CLOSE: `${detail} 收盤價無效。`,
            DUPLICATE_DATE: `${detail} 出現重複日期。`, ZERO_INITIAL: '期初價格不能為零。'
        })[key] || text;
    }
    async function request(endpoint, params) {
        if (Date.now() < blockedUntil) throw new Error('行情服務限流中，請一分鐘後重試。');
        const key = JSON.stringify([endpoint, params]);
        if (pending.has(key)) return pending.get(key);
        const job = (async () => {
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
            try {
                const response = await fetch(API, { method: 'POST', mode: 'cors', credentials: 'omit',
                    referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal,
                    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint, params }) });
                const json = await response.json();
                if (response.status === 429 || Number(json.code) === 429) {
                    blockedUntil = Date.now() + 60000;
                    throw new Error('行情服務額度或頻率受限（429），已暫停重試一分鐘。');
                }
                if (!response.ok || json.status === 'error' || Number(json.code) >= 400)
                    throw new Error(String(json.message || `行情服務 HTTP ${response.status}`));
                return json;
            } catch (e) {
                if (e.name === 'AbortError') throw new Error('行情服務逾時，請稍後重試。');
                if (e instanceof TypeError) throw new Error('無法連上行情服務，已保留上次結果。');
                throw e;
            } finally { clearTimeout(timer); }
        })();
        pending.set(key, job);
        try { return await job; } finally { pending.delete(key); }
    }
    function parseSeries(json, symbol) {
        if (!json.meta || json.meta.currency !== 'USD' || !Array.isArray(json.values) || !json.values.length)
            throw new Error(`${symbol} 沒有可用的美元歷史行情。`);
        const bars = json.values.map(v => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v.datetime) || v.close == null || String(v.close).trim() === '')
                throw new Error(`${symbol} 日線格式不完整。`);
            return { date: v.datetime, close: Number(v.close), low: v.low == null || v.low === '' ? null : Number(v.low) };
        }).sort((a, b) => a.date.localeCompare(b.date));
        return { meta: json.meta, bars };
    }
    function parseQuote(q, symbol) {
        const price = Number(q.close), rawTime = Number(q.last_quote_at);
        const timestamp = rawTime > 1e12 ? rawTime : rawTime * 1000;
        if ((q.currency && q.currency !== 'USD') || q.close == null || q.close === '' || !Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 300000)
            throw new Error(`${symbol} 最新報價或時間無效。`);
        const n = clock(new Date(timestamp));
        return { symbol, price, timestamp, date: n.date, time: `${n.date} ${n.time} ET`, localTime: `${n.date}T${n.time}` };
    }
    function validate(c) {
        C.validate(c);
        if (c.start > clock().date || c.asOf > clock().date) throw new Error('不可取得未來價格。');
        if (C.days(c.start, c.asOf) > 3653) throw new Error('每次最多載入十年日線。');
        if (c.snapshotMode === 'time') {
            const n = clock();
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c.pointTime) || c.pointTime.slice(0, 10) < c.start || c.pointTime.slice(0, 10) > c.asOf || c.pointTime > `${n.date}T${n.time}`)
                throw new Error('指定時間須在期初日與截至日之間，且不可晚於紐約現在。');
        }
    }
    async function load(c, force = false) {
        validate(c);
        const end = c.snapshotMode === 'time' ? c.pointTime.slice(0, 10) : c.asOf;
        const bundle = { mode: 'LIVE', source: 'Twelve Data', fetchedAt: new Date().toISOString(), requestedStart: c.start, series: {}, quotes: {}, minutes: {}, quoteErrors: [] };
        const jobs = c.assets.map(async a => {
            const key = JSON.stringify([a.symbol, c.start, end, completedDate()]);
            let series = !force && historyCache.get(key);
            if (!series) {
                const json = await request('time_series', { symbol: a.symbol, interval: '1day', start_date: C.plusDays(c.start, -7),
                    end_date: end, outputsize: 5000, order: 'ASC', adjust: 'splits', country: 'United States', timezone: 'America/New_York' });
                series = parseSeries(json, a.symbol);
                historyCache.set(key, series);
                if (historyCache.size > 32) historyCache.delete(historyCache.keys().next().value);
            }
            bundle.series[a.symbol] = series;
        });
        const quoteJobs = c.snapshotMode === 'latest' ? c.assets.map(async a => {
            try { bundle.quotes[a.symbol] = parseQuote(await request('quote', { symbol: a.symbol, country: 'United States' }), a.symbol); }
            catch (e) { bundle.quoteErrors.push(`${a.symbol}：${message(e)}`); }
        }) : [];
        const results = await Promise.allSettled([...jobs, ...quoteJobs]);
        const failed = results.find(r => r.status === 'rejected');
        if (failed) throw failed.reason;
        if (c.snapshotMode === 'time') {
            const points = await Promise.all(c.assets.map(async a => {
                const date = c.pointTime.slice(0, 10);
                const j = await request('time_series', { symbol: a.symbol, interval: '1min', start_date: date + ' 00:00:00', end_date: c.pointTime.replace('T', ' ')+':00', outputsize: 5000, order: 'ASC', adjust: 'splits', country: 'United States', timezone: 'America/New_York' });
                if (j.meta?.currency !== 'USD') throw new Error(`${a.symbol} 分鐘資料不是美元行情。`);
                // Minute bars are labelled by their opening time; exclude the unfinished requested minute.
                const rows = (j.values || []).filter(v => v.datetime?.slice(0, 10) === date && v.datetime.replace(' ', 'T').slice(0, 16) < c.pointTime && v.close != null && String(v.close).trim() !== '' && Number.isFinite(Number(v.close)) && Number(v.close) > 0).sort((a,b) => a.datetime.localeCompare(b.datetime));
                const last = rows.at(-1);
                if (!last) throw new Error(`${a.symbol} 在指定時點前沒有當日分鐘行情，可能休市或方案不支援。`);
                bundle.minutes[a.symbol] = rows.map(row => ({time: row.datetime, price: Number(row.close)}));
                return { symbol: a.symbol, price: Number(last.close), date, localTime: last.datetime.replace(' ', 'T').slice(0, 16), time: last.datetime + ' ET（分鐘起點）' };
            }));
            points.forEach(p => { bundle.quotes[p.symbol] = p; });
        }
        return bundle;
    }
    function view(c, bundle) {
        validate(c);
        if (c.start < bundle.requestedStart) throw new Error('新的期初日早於快取範圍，請更新行情。');
        let cutoff = completedDate(), asOf = c.asOf;
        if (c.snapshotMode === 'time') {
            asOf = c.pointTime.slice(0, 10);
            if (c.pointTime.slice(11) < '18:00') cutoff = cutoff < asOf ? cutoff : C.plusDays(asOf, -1);
        }
        const config = { ...c, asOf }, aligned = C.align(config, bundle.series, cutoff);
        for (let i = 1; i < aligned.rows.length; i++)
            if (C.days(aligned.rows[i-1].date, aligned.rows[i].date) > 7) throw new Error('日線有超過七日的缺口，已停止合約判定。');
        const result = C.evaluate(config, aligned);
        const rows = aligned.rows.filter(r => r.date <= asOf), last = rows.at(-1), warnings = [];
        if (result.start !== c.start) warnings.push(`期初日休市或無共同日線，已順延至 ${result.start}。`);
        if (C.days(last.date, asOf) > 5) warnings.push(`日線停在 ${last.date}，資料可能過期。`);
        let snapshot = { prices: last.prices, date: last.date, times: c.assets.map(() => last.date + ' 收盤'), key: last.date, label: '共同收盤價', kind: 'DAILY' };
        if (c.snapshotMode === 'latest' || c.snapshotMode === 'time') {
            const quotes = c.assets.map(a => bundle.quotes[a.symbol]);
            const complete = quotes.every(Boolean);
            const coherent = complete && quotes.every(q => q.date === quotes[0].date && q.date >= last.date) &&
                (c.snapshotMode === 'time' ? quotes.every(q => q.localTime === quotes[0].localTime && q.localTime <= c.pointTime) : Math.max(...quotes.map(q=>q.timestamp)) - Math.min(...quotes.map(q=>q.timestamp)) <= 900000);
            if (coherent) snapshot = { prices: quotes.map(q => q.price), date: quotes[0].date, times: quotes.map(q => q.time), key: quotes[0].localTime.replace('T', ' '), label: c.snapshotMode === 'time' ? '指定時點前已完成分鐘線收盤' : '最新報價快照', kind: 'QUOTE' };
            else if (c.snapshotMode === 'time') throw new Error('指定時點的各標的分鐘資料不同步，請改選時間或收盤價。');
            else warnings.push('最新報價不完整或時間不同步，整籃改用同日收盤價。' + bundle.quoteErrors.join('；'));
        }
        if (C.days(snapshot.date, clock().date) > 5 && c.snapshotMode === 'latest') warnings.push('最新比較價距紐約今天超過五日，請核對資料時間。');
        const assets = c.assets.map((a, i) => ({ symbol: a.symbol, initialPrice: result.initials[i], currentPrice: snapshot.prices[i], level: snapshot.prices[i] / result.initials[i] * 100, performance: (snapshot.prices[i] / result.initials[i] - 1) * 100, time: snapshot.times[i] }));
        const history = rows.map(row => Object.fromEntries([['date', row.date], ...c.assets.map((a,i) => [a.symbol, row.prices[i] / result.initials[i] * 100])]));
        if (snapshot.kind === 'QUOTE') history.push(Object.fromEntries([['date', snapshot.key + ' 快照'], ...assets.map(a=>[a.symbol, a.level])]));
        const minuteMaps = c.assets.map(a => new Map((bundle.minutes?.[a.symbol] || []).map(p => [p.time,p.price])));
        const minuteHistory = [...minuteMaps[0].keys()].filter(t => minuteMaps.every(m => m.has(t)))
            .map(t => Object.fromEntries([['date',t],...c.assets.map((a,i) => [a.symbol,minuteMaps[i].get(t)/result.initials[i]*100])]));
        return { config: c, bundle, result, assets, history, minuteHistory, snapshot, warnings };
    }
    const api = { clock, completedDate, marketHours, message, request, parseSeries, parseQuote, validate, load, view, clearCache: () => historyCache.clear() };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FCNMarket = api;
})(typeof window !== 'undefined' ? window : globalThis);
