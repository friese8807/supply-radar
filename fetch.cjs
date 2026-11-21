// 수급 레이더 — GitHub Actions가 주기적으로 실행해 data.json을 만듭니다.
// 네이버 응답 해석은 Code.gs의 함수를 그대로 씁니다.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const src = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const m = new Module('Code.gs'); m._compile(src, 'Code.gs');
const P = m.exports;

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
async function get(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://m.stock.naver.com/' }, signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
      console.error(r.status, url);
    } catch (e) { console.error(String(e), url); }
  }
  return null;
}

function readPrev(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

/** 시장 수급을 시각별로 쌓습니다(같은 집계일만, 값이 바뀔 때만). */
function intraday(prevMarket, flow, hhmm) {
  let pts = prevMarket && prevMarket.flow && flow && prevMarket.flow.date === flow.date && Array.isArray(prevMarket.intraday) ? prevMarket.intraday.slice() : [];
  if (!flow) return pts;
  // 마감 뒤(15:30 이후) 확정치는 15:30 점을 고쳐 씁니다 — 그래프가 저녁까지 늘어나지 않게.
  if (hhmm > '15:30') hhmm = '15:30';
  const pt = { t: hhmm, p: flow.personal, f: flow.foreign, i: flow.institution };
  const last = pts[pts.length - 1];
  if (!last || last.p !== pt.p || last.f !== pt.f || last.i !== pt.i) {
    if (last && last.t === hhmm) pts[pts.length - 1] = pt; else pts.push(pt);
  }
  return pts.slice(-240);
}

/* ---------- 시장 지도: 종목별 시가총액·등락률 + 업종 ---------- */
const num = v => { if (v == null) return null; const n = parseFloat(String(v).replace(/[,+%\s]/g, '')); return isFinite(n) ? n : null; };

/** 업종별 소속 종목(하루 한 번이면 충분). { 업종이름: [코드,...] } */
async function sectorMap(prev, today) {
  if (prev && prev.date === today && prev.sec && Object.keys(prev.sec).length > 30) return prev;
  const groups = [];
  for (let p = 1; p <= 5; p++) {
    const j = await get('https://m.stock.naver.com/api/stocks/industry?page=' + p + '&pageSize=100');
    if (!j || !Array.isArray(j.groups) || !j.groups.length) break;
    groups.push(...j.groups); if (groups.length >= (j.totalCount || 0)) break;
  }
  if (groups.length < 30) return prev && prev.sec ? prev : null;
  const sec = {};
  for (let i = 0; i < groups.length; i += 8) {
    await Promise.all(groups.slice(i, i + 8).map(async g => {
      const codes = [];
      for (let p = 1; p <= 10; p++) {
        const j = await get('https://m.stock.naver.com/api/stocks/industry/' + g.no + '?page=' + p + '&pageSize=100');
        const a = (j && j.stocks) || []; a.forEach(x => codes.push(x.itemCode));
        if (a.length < 100) break;
      }
      sec[g.name] = codes;
    }));
  }
  return { date: today, sec };
}

/** 코스피·코스닥 시가총액 상위 종목. 항목 = [코드, 이름, 시총(억원), 등락률, 현재가, 업종] */
async function marketMap(secs) {
  const of = {};
  if (secs) Object.entries(secs.sec).forEach(([name, codes]) => codes.forEach(c => { of[c] = name; }));
  const out = {};
  for (const mk of ['KOSPI', 'KOSDAQ']) {
    const pages = await Promise.all([1, 2, 3].map(p => get('https://m.stock.naver.com/api/stocks/marketValue/' + mk + '?page=' + p + '&pageSize=100')));
    const list = [];
    pages.forEach(j => ((j && j.stocks) || []).forEach(x => {
      if (x.stockEndType !== 'stock') return;
      const m = num(x.marketValue); if (!m) return;
      list.push([x.itemCode, x.stockName, m, num(x.fluctuationsRatio) || 0, num(x.closePrice), of[x.itemCode] || null]);
    }));
    // 우선주는 본주의 업종을 따름 (삼성전자우 → 삼성전자)
    const byName = {}; list.forEach(a => { byName[a[1]] = a; });
    list.forEach(a => { if (!a[5]) { const base = a[1].replace(/(\d?우B?|\(전환\))$/, ''); a[5] = (base !== a[1] && byName[base] && byName[base][5]) || '기타'; } });
    if (list.length) out[mk] = list.sort((a, b) => b[2] - a[2]);
  }
  return out;
}

if (require.main === module) (async () => {
  const prev = readPrev(process.argv[3] || '');
  const hhmm = new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 16);
  const watch = JSON.parse(fs.readFileSync(path.join(__dirname, 'watchlist.json'), 'utf8'));
  const codes = watch.map(w => w.code);
  const errors = [];
  const markets = [];
  for (const mk of [{ code: 'KOSPI', name: '코스피' }, { code: 'KOSDAQ', name: '코스닥' }]) {
    const [rt, integ] = await Promise.all([
      get('https://polling.finance.naver.com/api/realtime/domestic/index/' + mk.code),
      get('https://m.stock.naver.com/api/index/' + mk.code + '/integration')]);
    let flow = P.pickFlow(integ);
    if (!flow) flow = P.pickFlow(await get('https://m.stock.naver.com/api/index/' + mk.code + '/trend'));
    if (!flow) errors.push(mk.name + ' 투자자 동향을 받지 못했습니다');
    const q = P.pickQuote(rt, 0) || {};
    const pm = prev && Array.isArray(prev.markets) ? prev.markets.find(x => x.code === mk.code) : null;
    markets.push({ code: mk.code, name: mk.name, price: q.price, change: q.change, pct: q.pct, status: q.status, tradedAt: q.tradedAt, flow, intraday: intraday(pm, flow, hhmm) });
  }
  const rtStocks = await get('https://polling.finance.naver.com/api/realtime/domestic/stock/' + codes.join(','));
  const stocks = [];
  for (const w of watch) {
    const q = P.pickQuoteByCode(rtStocks, w.code) || {};
    const trend = P.pickTrend(await get('https://m.stock.naver.com/api/stock/' + w.code + '/trend?pageSize=10'));
    if (!trend.length) errors.push(w.name + ' 수급 데이터를 받지 못했습니다');
    stocks.push({ code: w.code, name: q.name || w.name, price: q.price, change: q.change, pct: q.pct, status: q.status, trend });
  }
  const ok = markets.some(x => x.flow || x.price != null) || stocks.some(s => s.trend.length);
  if (!ok) { console.error('받은 데이터가 없습니다'); process.exit(1); }
  const out = { ok: true, ts: new Date().toISOString(), snapshot: true, markets, stocks, errors };
  fs.mkdirSync(process.argv[2] || 'out', { recursive: true });
  fs.writeFileSync(path.join(process.argv[2] || 'out', 'data.json'), JSON.stringify(out));
  // 시장 지도 (실패해도 수급 자료는 그대로 올림 — 지난 지도를 유지)
  try {
    const dir = path.dirname(process.argv[3] || 'prev.json');
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const secs = await sectorMap(readPrev(path.join(dir, 'prevsec.json')), today);
    const mm = await marketMap(secs);
    const pm = readPrev(path.join(dir, 'prevmap.json'));
    const map = { ts: new Date().toISOString(), status: (markets[0] && markets[0].status) || '', markets: Object.assign({}, pm && pm.markets, mm) };
    if (secs) fs.writeFileSync(path.join(process.argv[2] || 'out', 'sectors.json'), JSON.stringify(secs));
    if (Object.keys(mm).length) fs.writeFileSync(path.join(process.argv[2] || 'out', 'map.json'), JSON.stringify(map));
    console.log('map', Object.entries(mm).map(([k, v]) => k + ':' + v.length).join(' '));
  } catch (e) { console.error('시장 지도 실패', String(e)); }
  console.log('markets', markets.map(x => x.code + ':' + JSON.stringify(x.flow)).join(' '), '| stocks', stocks.length, '| errors', errors.length);
})();

module.exports = { intraday, marketMap, sectorMap };
