/**
 * 수급 레이더 — 데이터 중계 (Google Apps Script)
 * 네이버 증권 공개 JSON을 받아 웹앱이 쓰기 좋은 형태로 돌려줍니다.
 *
 * 배포: 배포 > 새 배포 > 유형 "웹 앱" > 실행 "나", 액세스 "모든 사용자"
 *
 *   ?action=all&codes=005930,000660   시장(코스피·코스닥) + 관심종목
 *   ?action=search&q=삼성             종목 검색
 *   ?action=debug&codes=005930        원본 응답 일부 확인(문제 생겼을 때)
 *
 * 장중 수급 흐름 기록(그래프용): 편집기에서 setup 함수를 한 번 실행하면
 * 1분마다 recordFlow 가 돌면서 코스피·코스닥 투자자별 순매수를 저장합니다.
 * (GitHub 예약 실행은 몇 시간씩 늦거나 빠지는 날이 있어 그래프가 비는 문제를 막습니다)
 */

var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
var MARKETS = [{ code: 'KOSPI', name: '코스피' }, { code: 'KOSDAQ', name: '코스닥' }];
var CACHE_SEC = 8;

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'all';
  var out;
  try {
    if (action === 'search') out = search_(p.q || '');
    else if (action === 'debug') out = debug_(cleanCodes_(p.codes));
    else out = all_(cleanCodes_(p.codes));
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 휴대폰 알림 요청(POST JSON): pushKey·pushMsg·pushSub·pushOff·pushTest */
function doPost(e) {
  var req = {}, out;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) {}
  try { var r = pushRoute_(req, 'me', ''); out = r ? { ok: true, data: r } : { ok: false, error: '모르는 요청이에요' }; }
  catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 요청 ---------- */

function opt_() {
  return { muteHttpExceptions: true, headers: { 'User-Agent': UA, 'Referer': 'https://m.stock.naver.com/' } };
}

function req_(url) {
  var o = opt_(); o.url = url; return o;
}

function parse_(resp) {
  try {
    if (resp.getResponseCode() !== 200) return null;
    return JSON.parse(resp.getContentText());
  } catch (err) { return null; }
}

function all_(codes) {
  var cache = CacheService.getScriptCache();
  var key = 'all:' + codes.join(',');
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var reqs = [];
  MARKETS.forEach(function (m) {
    reqs.push(req_('https://polling.finance.naver.com/api/realtime/domestic/index/' + m.code));
    reqs.push(req_('https://m.stock.naver.com/api/index/' + m.code + '/integration'));
  });
  if (codes.length) reqs.push(req_('https://polling.finance.naver.com/api/realtime/domestic/stock/' + codes.join(',')));
  codes.forEach(function (c) {
    reqs.push(req_('https://m.stock.naver.com/api/stock/' + c + '/trend?pageSize=10'));
  });

  var res = UrlFetchApp.fetchAll(reqs).map(parse_);
  var errors = [];
  var i = 0;

  var markets = MARKETS.map(function (m) {
    var rt = res[i++], integ = res[i++];
    var flow = pickFlow(integ);
    if (!flow) {
      // 예비 경로
      var alt = parse_(UrlFetchApp.fetch('https://m.stock.naver.com/api/index/' + m.code + '/trend', opt_()));
      flow = pickFlow(alt);
    }
    if (!flow) errors.push(m.name + ' 투자자 동향을 받지 못했습니다');
    var q = pickQuote(rt, 0) || {};
    return { code: m.code, name: m.name, price: q.price, change: q.change, pct: q.pct, status: q.status, tradedAt: q.tradedAt, flow: flow,
      intraday: flow ? readIntra_(m.code, flow.date) : [] };
  });

  var rtStocks = codes.length ? res[i++] : null;
  var stocks = codes.map(function (c, k) {
    var q = pickQuoteByCode(rtStocks, c) || pickQuote(rtStocks, k) || {};
    var trend = pickTrend(res[i++]);
    if (!trend.length) errors.push(c + ' 수급 데이터를 받지 못했습니다');
    return { code: c, name: q.name || '', price: q.price, change: q.change, pct: q.pct, status: q.status, trend: trend };
  });

  var out = { ok: true, ts: new Date().toISOString(), markets: markets, stocks: stocks, errors: errors };
  try { cache.put(key, JSON.stringify(out), CACHE_SEC); } catch (err) {}
  return out;
}

/* ---------- 장중 흐름 기록 (1분마다) ---------- */

/** 편집기에서 한 번 실행: 1분마다 기록하는 트리거를 설치합니다(중복 설치 안 함). */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'recordFlow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('recordFlow').timeBased().everyMinutes(1).create();
  recordFlow();
  Logger.log('설치 완료: 장중(평일 09:00~15:35) 1분마다 기록합니다.');
}

function kst_() {
  var d = new Date(Date.now() + 9 * 3600e3);
  return { date: d.toISOString().slice(0, 10).replace(/-/g, ''), t: d.toISOString().slice(11, 16), dow: d.getUTCDay() };
}

function recordFlow() {
  var now = kst_();
  if (now.dow === 0 || now.dow === 6 || now.t < '09:00' || now.t > '15:35') return;
  var t = now.t > '15:30' ? '15:30' : now.t;
  var props = PropertiesService.getScriptProperties();
  var res = UrlFetchApp.fetchAll(MARKETS.map(function (m) {
    return req_('https://m.stock.naver.com/api/index/' + m.code + '/integration');
  })).map(parse_);
  var close = [];
  MARKETS.forEach(function (m, k) {
    var f = pickFlow(res[k]);
    if (!f || f.date !== now.date) return;
    close.push(m.name + ' 외국인 ' + eok_(f.foreign) + ' · 기관 ' + eok_(f.institution) + ' · 개인 ' + eok_(f.personal));
    // 시간대(시)별로 나눠 저장: 값 하나 9KB 제한 대비. 형식 "HH:MM,개인,외국인,기관;"
    var key = 'i:' + m.code + ':' + now.date + ':' + t.slice(0, 2);
    var rows = (props.getProperty(key) || '').split(';').filter(function (r) { return r && r.slice(0, 5) !== t; });
    rows.push([t, f.personal, f.foreign, f.institution].join(','));
    props.setProperty(key, rows.join(';'));
  });
  // 장 마감 뒤 첫 기록 때 하루 한 번: 휴대폰 알림을 켠 곳에 오늘 수급 요약
  if (now.t >= '15:31' && close.length && props.getProperty('closePush') !== now.date) {
    props.setProperty('closePush', now.date);
    pushTo_(function () { return true; }, '📊 오늘 수급 마감', close.join('\n'));
  }
  // 지난 날짜 정리
  var all = props.getKeys();
  all.forEach(function (k) { if (k.indexOf('i:') === 0 && k.split(':')[2] !== now.date) props.deleteProperty(k); });
}

function eok_(v) { if (v === null || v === undefined) return '-'; var n = Math.round(v); return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ko-KR') + '억'; }

function readIntra_(code, date) {
  try {
    var props = PropertiesService.getScriptProperties().getProperties();
    var pts = [];
    Object.keys(props).filter(function (k) { return k.indexOf('i:' + code + ':' + date + ':') === 0; }).sort().forEach(function (k) {
      props[k].split(';').forEach(function (r) {
        var a = r.split(',');
        if (a.length === 4) pts.push({ t: a[0], p: num(a[1]), f: num(a[2]), i: num(a[3]) });
      });
    });
    return pts.sort(function (x, y) { return x.t < y.t ? -1 : x.t > y.t ? 1 : 0; });
  } catch (err) { return []; }
}

function search_(q) {
  q = String(q).trim();
  if (!q) return { ok: true, items: [] };
  var url = 'https://m.stock.naver.com/front-api/search/autoComplete?query=' + encodeURIComponent(q) + '&target=stock';
  var j = parse_(UrlFetchApp.fetch(url, opt_()));
  return { ok: true, items: pickSearch(j) };
}

function debug_(codes) {
  var urls = [
    'https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI',
    'https://m.stock.naver.com/api/index/KOSPI/integration',
    'https://m.stock.naver.com/api/index/KOSPI/trend'
  ];
  if (codes.length) {
    urls.push('https://polling.finance.naver.com/api/realtime/domestic/stock/' + codes[0]);
    urls.push('https://m.stock.naver.com/api/stock/' + codes[0] + '/trend?pageSize=3');
  }
  var res = UrlFetchApp.fetchAll(urls.map(req_));
  return urls.map(function (u, k) {
    return { url: u, status: res[k].getResponseCode(), body: res[k].getContentText().slice(0, 1500) };
  });
}

/* ---------- 순수 파싱 함수 (네이버 응답 → 숫자) ---------- */

function cleanCodes_(s) {
  return String(s || '').split(',').map(function (x) { return x.trim().toUpperCase(); })
    .filter(function (x) { return /^[0-9A-Z]{6}$/.test(x); }).slice(0, 15);
}

/** "-1,673,323" / "+2,746,972" / 123 → 숫자. 못 읽으면 null */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var n = parseFloat(String(v).replace(/[,+\s%]/g, ''));
  return isFinite(n) ? n : null;
}

/** 지수 투자자별 순매수(억원). integration의 dealTrendInfo 또는 trend 응답 */
function pickFlow(j) {
  if (!j) return null;
  var d = j.dealTrendInfo || (Array.isArray(j.dealTrendInfos) ? j.dealTrendInfos[0] : null) || (Array.isArray(j) ? j[0] : j);
  if (!d) return null;
  var f = { date: d.bizdate || '', personal: num(d.personalValue), foreign: num(d.foreignValue), institution: num(d.institutionalValue) };
  if (f.personal === null && f.foreign === null && f.institution === null) return null;
  return f;
}

function quoteOf(d) {
  if (!d) return null;
  var change = num(d.compareToPreviousClosePrice);
  var pct = num(d.fluctuationsRatio);
  var dir = d.compareToPreviousPrice && String(d.compareToPreviousPrice.code);
  if (dir === '4' || dir === '5') { // 하한·하락인데 부호가 빠져 온 경우
    if (change !== null && change > 0) change = -change;
    if (pct !== null && pct > 0) pct = -pct;
  }
  return {
    code: d.itemCode || d.symbolCode || '', name: d.stockName || d.indexName || '',
    price: num(d.closePrice), change: change, pct: pct,
    status: d.marketStatus || '', tradedAt: d.localTradedAt || ''
  };
}

function pickQuote(j, k) {
  if (!j || !Array.isArray(j.datas)) return null;
  return quoteOf(j.datas[k]);
}

function pickQuoteByCode(j, code) {
  if (!j || !Array.isArray(j.datas)) return null;
  for (var k = 0; k < j.datas.length; k++) {
    var d = j.datas[k];
    if (d && (d.itemCode === code || d.symbolCode === code)) return quoteOf(d);
  }
  return null;
}

/** 종목 일별 투자자 순매수(주). 최신일이 앞 */
function pickTrend(j) {
  var a = Array.isArray(j) ? j : (j && Array.isArray(j.result) ? j.result : []);
  return a.map(function (r) {
    return {
      date: String(r.bizdate || ''),
      foreign: num(r.foreignerPureBuyQuant),
      organ: num(r.organPureBuyQuant),
      individual: num(r.individualPureBuyQuant),
      holdRatio: num(r.foreignerHoldRatio),
      close: num(r.closePrice),
      change: signedChange_(r)
    };
  }).filter(function (r) { return r.date && (r.foreign !== null || r.organ !== null); });
}

/** 전일 대비. 하락인데 부호가 빠진 경우 바로잡음 */
function signedChange_(r) {
  var c = num(r.compareToPreviousClosePrice);
  if (c === null) return null;
  var dir = r.compareToPreviousPrice && String(r.compareToPreviousPrice.code);
  if ((dir === '4' || dir === '5') && c > 0) c = -c;
  return c;
}

function pickSearch(j) {
  var items = (j && j.result && j.result.items) || (j && j.items) || [];
  return items.filter(function (x) { return x && /^[0-9A-Z]{6}$/.test(String(x.code || '')); })
    .slice(0, 12)
    .map(function (x) { return { code: String(x.code), name: x.name || '', market: x.typeName || '' }; });
}

if (typeof module !== 'undefined') module.exports = { num: num, pickFlow: pickFlow, pickQuote: pickQuote, pickQuoteByCode: pickQuoteByCode, pickTrend: pickTrend, pickSearch: pickSearch, cleanCodes_: cleanCodes_ };

var PUSH_SUB_URL = 'https://friese8807.github.io/supply-radar/';
// ════════════════════════ 휴대폰 푸시 알림 ════════════════════════
// friese-mobile-webapp-kit · web-push. 내용 없는 푸시를 VAPID 서명으로 보내고, 휴대폰(sw.js)이 pushMsg 로 문구를 받아 띄운다.
// 구독 목록·열쇠는 스크립트 속성(PUSH_SUBS·VAPID_*). 처음 한 번 편집기에서 allowPush() 실행 → 외부 연결 권한 허용.
// route: pushKey · pushMsg · pushSub · pushOff · pushTest (아래 pushRoute_ 한 줄로 연결)

/** 편집기에서 한 번 실행: '외부 서비스 연결' 권한 허용 창을 띄운다 */
function allowPush() {
  UrlFetchApp.fetch('https://web.push.apple.com/', { muteHttpExceptions: true });
  Logger.log('알림 권한이 허용돼 있어요. 이제 앱에서 휴대폰 알림을 켜 보세요.');
}
/** route 에서: const pr = pushRoute_(req, who, name); if (pr) return pr; — 푸시 요청이 아니면 null */
function pushRoute_(req, who, name) {
  const a = req.action, ep = String(req.endpoint || '');
  if (a === 'pushKey') return { key: vapid_().pub };
  if (a === 'pushMsg') return { msg: popMsg_(ep) };
  if (a === 'pushSub') { pushSub_(ep, who, name); return { on: true }; }
  if (a === 'pushOff') { pushOff_(ep); return { on: false }; }
  if (a === 'pushTest') return { res: pushTo_(function (x) { return x.endpoint === ep; }, '알림이 잘 와요 🔔', (name ? name + ' ' : '') + '휴대폰에 알림이 켜져 있어요') };
  return null;
}
function pushList_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PUSH_SUBS') || '[]'); } catch (e) { return []; } }
function pushSave_(l) { PropertiesService.getScriptProperties().setProperty('PUSH_SUBS', JSON.stringify(l.slice(-30))); }
function pushSub_(ep, who, name) {
  if (!/^https:\/\/[^\s]{10,900}$/.test(ep)) throw new Error('알림 주소가 올바르지 않아요');
  const l = pushList_().filter(function (x) { return x.endpoint !== ep; });
  l.push({ endpoint: ep, who: String(who || ''), name: String(name || '').slice(0, 20), at: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm') });
  pushSave_(l);
}
function pushOff_(ep) { pushSave_(pushList_().filter(function (x) { return x.endpoint !== ep; })); }
function pushCount_() { return pushList_().length; }
function msgKey_(ep) { return 'pm_' + pBig_(pSha_(String(ep))).toString(16); }
function popMsg_(ep) {
  const c = CacheService.getScriptCache(), k = msgKey_(ep); let list = [];
  try { list = JSON.parse(c.get(k) || '[]'); } catch (e) { list = []; }
  const m = list.shift() || null; c.put(k, JSON.stringify(list), 21600);
  return m;
}
/** 조건에 맞는 휴대폰마다 문구를 맡기고 내용 없는 푸시를 보낸다. 결과 문자열 배열. 오류는 삼킨다(본래 동작을 막지 않게). */
function pushTo_(match, title, body) {
  const out = [];
  try {
    const all = pushList_(), targets = all.filter(match); if (!targets.length) return out;
    const v = vapid_(), c = CacheService.getScriptCache(), gone = {};
    targets.forEach(function (t) {
      const k = msgKey_(t.endpoint); let list = [];
      try { list = JSON.parse(c.get(k) || '[]'); } catch (e) {}
      list.push({ title: String(title).slice(0, 80), body: String(body).slice(0, 300) }); c.put(k, JSON.stringify(list.slice(-5)), 21600);
      const res = UrlFetchApp.fetch(t.endpoint, { method: 'post', payload: '', muteHttpExceptions: true,
        headers: { TTL: '86400', Urgency: 'high', Authorization: 'vapid t=' + jwt_(v, t.endpoint.match(/^https:\/\/[^\/]+/)[0]) + ', k=' + v.pub } });
      const code = res.getResponseCode(), txt = code + ' ' + String(res.getContentText() || '').slice(0, 120);
      out.push(txt); t.last = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM-dd HH:mm') + ' ' + txt;
      if (code === 404 || code === 410) gone[t.endpoint] = 1;
    });
    pushSave_(all.filter(function (x) { return !gone[x.endpoint]; }));
  } catch (e) { out.push('오류 ' + e); }
  return out;
}
// ---- VAPID (ES256, P-256) — Apps Script V8 의 BigInt 로 직접 서명 ----
function pB64u_(x) { return (typeof x === 'string' ? Utilities.base64EncodeWebSafe(x, Utilities.Charset.UTF_8) : Utilities.base64EncodeWebSafe(x)).replace(/=+$/, ''); }
function pSha_(x) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, x); }
function pBig_(bytes) { var h = '0x0'; bytes.forEach(function (b) { h += ('0' + ((b + 256) % 256).toString(16)).slice(-2); }); return BigInt(h); }
function pBytes_(x, n) { var h = x.toString(16); while (h.length < n * 2) h = '0' + h; var o = []; for (var i = 0; i < n; i++) { var v = parseInt(h.substr(i * 2, 2), 16); o.push(v > 127 ? v - 256 : v); } return o; }
var P256_ = null;
function p256_() {
  if (!P256_) P256_ = { p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'), n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
    G: [BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')] };
  return P256_;
}
function pMod_(a, m) { a = a % m; return a < BigInt(0) ? a + m : a; }
function pInv_(a, m) { var t = BigInt(0), nt = BigInt(1), r = m, nr = pMod_(a, m), q, x; while (nr !== BigInt(0)) { q = r / nr; x = t - q * nt; t = nt; nt = x; x = r - q * nr; r = nr; nr = x; } return pMod_(t, m); }
function pAdd_(P, Q) {
  if (!P) return Q; if (!Q) return P;
  var p = p256_().p, l;
  if (P[0] === Q[0]) { if (pMod_(P[1] + Q[1], p) === BigInt(0)) return null; l = pMod_(BigInt(3) * P[0] * P[0] - BigInt(3), p) * pInv_(BigInt(2) * P[1], p) % p; }
  else l = pMod_(Q[1] - P[1], p) * pInv_(Q[0] - P[0], p) % p;
  var x = pMod_(l * l - P[0] - Q[0], p);
  return [x, pMod_(l * (P[0] - x) - P[1], p)];
}
function pMul_(k, P) { var R = null; while (k > BigInt(0)) { if (k % BigInt(2) === BigInt(1)) R = pAdd_(R, P); P = pAdd_(P, P); k = k / BigInt(2); } return R; }
function pRnd_(extra) { return pBig_(pSha_(Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + String(extra || '') + Date.now())); }
function vapid_() {
  const P_ = PropertiesService.getScriptProperties();
  var d = P_.getProperty('VAPID_D'), pub = P_.getProperty('VAPID_PUB');
  if (!d || !pub) {
    var n = p256_().n, D = pMod_(pRnd_(), n - BigInt(1)) + BigInt(1), Q = pMul_(D, p256_().G);
    d = D.toString(16); pub = pB64u_([4].concat(pBytes_(Q[0], 32), pBytes_(Q[1], 32)));
    P_.setProperties({ VAPID_D: d, VAPID_PUB: pub });
  }
  return { d: BigInt('0x' + d), pub: pub };
}
function jwt_(v, aud) {
  var msg = pB64u_(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' + pB64u_(JSON.stringify({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: PUSH_SUB_URL }));
  var c = p256_(), e = pBig_(pSha_(msg)), r = BigInt(0), s = BigInt(0);
  while (r === BigInt(0) || s === BigInt(0)) {
    var k = pMod_(pRnd_(v.d.toString(16) + msg), c.n - BigInt(1)) + BigInt(1);
    r = pMod_(pMul_(k, c.G)[0], c.n);
    s = pMod_(pInv_(k, c.n) * (e + r * v.d), c.n);
  }
  return msg + '.' + pB64u_(pBytes_(r, 32).concat(pBytes_(s, 32)));
}
