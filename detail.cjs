// 수급 레이더 — 종목 상세 자료(지표·1년 차트·실적·수급·리포트·뉴스·동종업계)를 종목마다 파일 하나로 만듭니다.
// 시장 지도에 나오는 종목(map.json)을 하루 한두 번 모아서 detail 브랜치의 d/코드.json 으로 올립니다.
//   node detail.cjs 출력폴더 map.json [최대종목수]
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
async function get(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://m.stock.naver.com/' }, signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch (e) { /* 한 번 더 */ }
  }
  return null;
}
const num = v => { if (v == null) return null; const n = parseFloat(String(v).replace(/[,+%\s원배]/g, '')); return isFinite(n) ? n : null; };
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

/** 실적 표: 필요한 줄만, 열은 과거→추정 순서 */
const FIN_ROWS = ['매출액', '영업이익', '당기순이익', '영업이익률', '순이익률', 'ROE', '부채비율', 'EPS', 'PER', 'BPS', 'PBR', '주당배당금'];
function finance(j) {
  const f = j && j.financeInfo; if (!f || !Array.isArray(f.trTitleList)) return null;
  const cols = f.trTitleList.map(t => ({ k: t.key, t: t.title.replace(/\.$/, ''), e: t.isConsensus === 'Y' ? 1 : 0 }));
  const rows = {};
  (f.rowList || []).forEach(r => { if (FIN_ROWS.includes(r.title)) rows[r.title] = cols.map(c => num(r.columns && r.columns[c.k] && r.columns[c.k].value)); });
  return { cols: cols.map(c => [c.t, c.e]), rows };
}

async function one(code) {
  const end = new Date(Date.now() + 9 * 3600e3), start = new Date(end.getTime() - 380 * 864e5);
  const [integ, basic, ann, qtr, news, chart] = await Promise.all([
    get('https://m.stock.naver.com/api/stock/' + code + '/integration'),
    get('https://m.stock.naver.com/api/stock/' + code + '/basic'),
    get('https://m.stock.naver.com/api/stock/' + code + '/finance/annual'),
    get('https://m.stock.naver.com/api/stock/' + code + '/finance/quarter'),
    get('https://m.stock.naver.com/api/news/stock/' + code + '?pageSize=6&page=1'),
    get('https://api.stock.naver.com/chart/domestic/item/' + code + '/day?startDateTime=' + ymd(start) + '0000&endDateTime=' + ymd(end) + '2359')
  ]);
  if (!integ && !basic) return null;
  const d = { c: code, n: (integ && integ.stockName) || (basic && basic.stockName) || '', ts: new Date().toISOString() };
  if (basic) {
    d.mk = basic.stockExchangeName || '';
    d.logo = basic.itemLogoPngUrl || '';
    d.p = num(basic.closePrice); d.ch = num(basic.compareToPreviousClosePrice); d.r = num(basic.fluctuationsRatio);
    const dir = basic.compareToPreviousPrice && String(basic.compareToPreviousPrice.code);
    if ((dir === '4' || dir === '5') && d.ch > 0) d.ch = -d.ch;
    d.at = basic.localTradedAt || '';
  }
  if (integ) {
    // 지표: [이름, 값, 기준] — 시총·PER·PBR·배당·52주 범위 등 네이버가 주는 그대로
    d.info = (integ.totalInfos || []).map(x => [x.key, x.value, x.valueDesc || '']);
    // 투자자별 순매수(주): [날짜, 외국인, 기관, 개인, 외국인 보유율, 종가]
    d.deal = (integ.dealTrendInfos || []).slice(0, 10).map(x => [x.bizdate, num(x.foreignerPureBuyQuant), num(x.organPureBuyQuant), num(x.individualPureBuyQuant), num(x.foreignerHoldRatio), num(x.closePrice)]);
    // 동종업계: [코드, 이름, 등락률, 시총(억원)]
    d.peer = (integ.industryCompareInfo || []).slice(0, 6).map(x => [x.itemCode, x.stockName, num(x.fluctuationsRatio), num(x.marketValue)]);
    // 증권사 리포트: [제목, 증권사, 날짜, 번호]
    d.res = (integ.researches || []).slice(0, 5).map(x => [x.tit, x.bnm, x.wdt, x.id]);
  }
  d.fa = finance(ann); d.fq = finance(qtr);
  // 뉴스: [제목, 언론사, 시각(yyyymmddhhmm), 주소]
  d.news = (Array.isArray(news) ? news : []).flatMap(g => g.items || []).slice(0, 6)
    .map(x => [x.titleFull || x.title, x.officeName, x.datetime, x.mobileNewsUrl || ('https://n.news.naver.com/mnews/article/' + x.officeId + '/' + x.articleId)]);
  // 1년 일별: [날짜, 종가, 거래량]
  const pi = Array.isArray(chart) ? chart : (chart && chart.priceInfos) || [];
  d.ch1y = pi.map(x => [x.localDate, x.closePrice, x.accumulatedTradingVolume]);
  return d;
}

if (require.main === module) (async () => {
  const outDir = process.argv[2] || 'out-detail';
  const map = JSON.parse(fs.readFileSync(process.argv[3] || 'map.json', 'utf8'));
  const limit = +(process.argv[4] || 0);
  const codes = [...new Set(Object.values(map.markets || {}).flat().map(a => a[0]))];
  let watch = []; try { watch = JSON.parse(fs.readFileSync(path.join(__dirname, 'watchlist.json'), 'utf8')).map(w => w.code); } catch (e) {}
  const all = [...new Set(watch.concat(codes))].slice(0, limit || undefined);
  fs.mkdirSync(path.join(outDir, 'd'), { recursive: true });
  let ok = 0, fail = 0;
  for (let i = 0; i < all.length; i += 6) {
    await Promise.all(all.slice(i, i + 6).map(async c => {
      try { const d = await one(c); if (d) { fs.writeFileSync(path.join(outDir, 'd', c + '.json'), JSON.stringify(d)); ok++; } else fail++; }
      catch (e) { fail++; }
    }));
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ ts: new Date().toISOString(), count: ok }));
  console.log('detail ok', ok, 'fail', fail, 'of', all.length);
  if (!ok) process.exit(1);
})();

module.exports = { one, finance };
