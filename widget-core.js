// SUPPLY_RADAR_WIDGET — 수급 레이더 위젯 본체 (Scriptable 앱용)
// 로더(widget.js)가 실행될 때마다 이 파일을 새로 받아 씁니다. 직접 고칠 필요 없습니다.
// 크기: 작은·중간·큰 위젯, 잠금 화면(사각형·한 줄) 위젯을 지원합니다.

const DATA_URL = "https://raw.githubusercontent.com/friese8807/supply-radar/data/data.json";
const APP_URL = "https://friese8807.github.io/supply-radar/";

const D = (l, d) => Color.dynamic(new Color(l), new Color(d));
const C = {
  bg: D("#ffffff", "#15171c"),
  card: D("#f4f5f7", "#20242c"),
  ink: D("#111318", "#eef0f4"),
  sub: D("#6b7079", "#9aa1ad"),
  faint: D("#9aa0a9", "#6c7380"),
  buy: D("#d42a30", "#ff6b71"),   // 순매수·상승 = 빨강
  sell: D("#1f56d1", "#7aa2ff"),  // 순매도·하락 = 파랑
  live: new Color("#22c55e"),
};
// 그림(DrawContext)은 밝기 전환이 안 되므로 양쪽에서 잘 보이는 고정색
const P = {
  buy: new Color("#e5484d"), sell: new Color("#3a6ee8"),
  buyDim: new Color("#e5484d", 0.45), sellDim: new Color("#3a6ee8", 0.45),
  track: new Color("#8a8f99", 0.2), zero: new Color("#8a8f99", 0.55),
  f: new Color("#7c5cf0"), i: new Color("#12a67a"), p: new Color("#f2a01e"),
};
const INV = [["외국인", "f", "foreign", P.f], ["기관", "i", "organ", P.i], ["개인", "p", "individual", P.p]];

/* ---------- 숫자 ---------- */
const fmt = n => Math.round(n).toLocaleString("ko-KR");
const sgn = n => (n > 0 ? "+" : n < 0 ? "-" : "");
function eok(n, unit) {
  if (n === null || n === undefined) return "–";
  const a = Math.abs(n);
  if (a >= 10000) return sgn(n) + (a / 10000).toFixed(a >= 100000 ? 1 : 2) + "조";
  return sgn(n) + fmt(a) + (unit === false ? "" : "억");
}
const tone = n => (n > 0 ? C.buy : n < 0 ? C.sell : C.sub);
const pctTxt = p => (p === null || p === undefined ? "" : (p > 0 ? "+" : "") + p.toFixed(2) + "%");
const pad = n => String(n).padStart(2, "0");
const amt = (r, k) => (r && r[k] !== null && r[k] !== undefined && r.close ? (r[k] * r.close) / 1e8 : null);
const mdTxt = b => (b ? +b.slice(4, 6) + "/" + +b.slice(6, 8) : "");

/** 종목의 투자자 금액(억원) 일별 배열, 오래된 날 → 최신 */
function series(stock, key) {
  return stock.trend.slice().reverse().map(r => amt(r, key)).filter(v => v !== null);
}
function streak(vals) {
  if (!vals.length || !vals[vals.length - 1]) return { n: 0, buy: null };
  const buy = vals[vals.length - 1] > 0;
  let n = 0;
  for (let i = vals.length - 1; i >= 0; i--) { if (vals[i] && vals[i] > 0 === buy) n++; else break; }
  return { n, buy };
}
function signal(stock) {
  const r = stock.trend[0];
  if (!r) return null;
  const f = r.foreign || 0, o = r.organ || 0;
  if (f > 0 && o > 0) return { c: C.buy, t: "외국인·기관 동반 매수" };
  if (f < 0 && o < 0) return { c: C.sell, t: "외국인·기관 동반 매도" };
  return null;
}

/* ---------- 글자 ---------- */
const FONT = { r: "systemFont", m: "mediumSystemFont", s: "semiboldSystemFont", b: "boldSystemFont", h: "heavySystemFont", rs: "semiboldRoundedSystemFont", rb: "boldRoundedSystemFont" };
function txt(st, s, size, color, w, scale) {
  const t = st.addText(String(s));
  t.font = Font[FONT[w || "r"]](size);
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = scale || 0.65;
  return t;
}
function hstack(p) { const s = p.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; }
function vstack(p) { const s = p.addStack(); s.layoutVertically(); return s; }
function fixed(p, w) { const s = p.addStack(); s.size = new Size(w, 0); s.layoutHorizontally(); s.centerAlignContent(); return s; }

/* ---------- 그림 ---------- */
function ctx(w, h) { const dc = new DrawContext(); dc.size = new Size(w, h); dc.opaque = false; dc.respectScreenScale = true; return dc; }
function round(dc, x, y, w, h, r, color) { const p = new Path(); p.addRoundedRect(new Rect(x, y, w, h), r, r); dc.addPath(p); dc.setFillColor(color); dc.fillPath(); }

/** 가운데 0 기준 좌우 막대 (오른쪽 빨강=매수, 왼쪽 파랑=매도) */
function divBar(v, max, w, h) {
  const dc = ctx(w, h);
  round(dc, 0, 0, w, h, h / 2, P.track);
  const half = w / 2, len = max && v ? Math.max(h, (Math.min(1, Math.abs(v) / max)) * half) : 0;
  if (len) round(dc, v > 0 ? half : half - len, 0, len, h, h / 2, v > 0 ? P.buy : P.sell);
  dc.setFillColor(P.zero); dc.fillRect(new Rect(half - 0.5, 0, 1, h));
  return dc.getImage();
}

/** 일별 세로 막대 (최근일 진하게) */
function dailyBars(vals, w, h) {
  const dc = ctx(w, h), n = vals.length;
  if (!n) return dc.getImage();
  const mx = Math.max(...vals.map(Math.abs), 1e-9), mid = h / 2, gap = 3;
  const bw = Math.max(3, (w - gap * (n - 1)) / n);
  vals.forEach((v, i) => {
    const bh = Math.max(1.5, (Math.abs(v) / mx) * (mid - 1)), x = i * (bw + gap), last = i === n - 1;
    const c = v >= 0 ? (last ? P.buy : P.buyDim) : (last ? P.sell : P.sellDim);
    round(dc, x, v >= 0 ? mid - bh : mid, bw, bh, Math.min(2, bw / 2), c);
  });
  dc.setFillColor(P.zero); dc.fillRect(new Rect(0, mid - 0.25, w, 0.5));
  return dc.getImage();
}

/** 장중 시장 수급 흐름 선 */
function lines(pts, w, h) {
  const dc = ctx(w, h);
  const toMin = t => { const [a, b] = t.split(":").map(Number); return a * 60 + b; };
  // 15:30 이후(마감 뒤 확정치)는 15:30 한 점으로 모아 장 마감에서 끝나게 합니다.
  const cl = [];
  pts.forEach(p => {
    if (toMin(p.t) >= 15 * 60 + 30) { const q = Object.assign({}, p, { t: "15:30" }); if (cl.length && cl[cl.length - 1].t === "15:30") cl[cl.length - 1] = q; else cl.push(q); }
    else cl.push(p);
  });
  pts = cl;
  const t0 = Math.min(toMin(pts[0].t), 9 * 60), t1 = 15 * 60 + 30;
  let mx = 1; pts.forEach(p => INV.forEach(k => { if (p[k[1]] !== null && p[k[1]] !== undefined) mx = Math.max(mx, Math.abs(p[k[1]])); }));
  mx *= 1.12;
  const X = t => 3 + ((toMin(t) - t0) / (t1 - t0)) * (w - 6), Y = v => 3 + (1 - (v + mx) / (2 * mx)) * (h - 6);
  dc.setFillColor(P.zero);
  for (let x = 0; x < w; x += 6) dc.fillRect(new Rect(x, Y(0) - 0.25, 3, 0.5));
  INV.forEach(k => {
    const ps = pts.filter(p => p[k[1]] !== null && p[k[1]] !== undefined);
    if (ps.length < 2) return;
    const path = new Path();
    ps.forEach((p, i) => (i ? path.addLine(new Point(X(p.t), Y(p[k[1]]))) : path.move(new Point(X(p.t), Y(p[k[1]])))));
    dc.addPath(path); dc.setStrokeColor(k[3]); dc.setLineWidth(2); dc.strokePath();
    const l = ps[ps.length - 1];
    dc.setFillColor(k[3]); dc.fillEllipse(new Rect(X(l.t) - 2.5, Y(l[k[1]]) - 2.5, 5, 5));
  });
  return dc.getImage();
}

/* ---------- 조각 ---------- */
function header(p, d, size) {
  const h = hstack(p);
  txt(h, "수급 레이더", size, C.ink, "h");
  h.addSpacer();
  if (d.open) { const dot = h.addStack(); dot.size = new Size(6, 6); dot.cornerRadius = 3; dot.backgroundColor = C.live; h.addSpacer(4); }
  txt(h, d.when, size - 3, C.sub, "m");
  return h;
}

/** 시장: 이름·지수·등락 + 투자자 3줄(막대) */
function marketBlock(p, m, o) {
  const s = vstack(p);
  const h = hstack(s);
  txt(h, m.name, o.fs + 1, C.ink, "b");
  if (!o.noIndex) { h.addSpacer(5); txt(h, m.price !== null && m.price !== undefined ? m.price.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "–", o.fs - 1, C.sub, "rs"); }
  h.addSpacer();
  txt(h, pctTxt(m.pct), o.fs, tone(m.pct || 0), "rs");
  s.addSpacer(o.gap);
  const f = m.flow || {};
  const vals = [["외국인", f.foreign], ["기관", f.institution], ["개인", f.personal]];
  const mx = Math.max(1, ...vals.map(v => Math.abs(v[1] || 0)));
  vals.forEach(([l, v], i) => {
    if (i) s.addSpacer(o.row);
    const r = hstack(s);
    const lb = fixed(r, o.lw); txt(lb, l, o.fs - 1, C.sub, "m"); lb.addSpacer();
    const im = r.addImage(divBar(v, mx, o.bw, o.bh)); im.imageSize = new Size(o.bw, o.bh);
    r.addSpacer();
    txt(r, eok(v), o.fs, tone(v || 0), "rb");
  });
  return s;
}

/** 종목: 이름·주가·등락 */
function stockHead(p, st, fs) {
  const h = hstack(p);
  txt(h, st.name, fs + 1, C.ink, "b");
  h.addSpacer(5);
  if (st.price !== null && st.price !== undefined) txt(h, fmt(st.price), fs - 1, C.sub, "rs");
  h.addSpacer();
  txt(h, pctTxt(st.pct), fs, tone(st.pct || 0), "rs");
  return h;
}
/** 종목: 외국인·기관·개인 오늘 금액, 세 칸 (위 이름, 아래 금액) */
function trio(p, st, fs, colW) {
  const r = hstack(p), t = st.trend[0];
  r.topAlignContent();
  INV.forEach(([l, , k, c], i) => {
    if (i) r.addSpacer();
    const cell = vstack(r); if (colW) cell.size = new Size(colW, 0);
    const lh = hstack(cell);
    const sw = lh.addStack(); sw.size = new Size(6, 6); sw.cornerRadius = 1.5; sw.backgroundColor = c; lh.addSpacer(4);
    txt(lh, l, fs - 2, C.sub, "m"); lh.addSpacer();
    cell.addSpacer(1);
    const vh = hstack(cell); const v = amt(t, k);
    txt(vh, eok(v), fs + 1, tone(v || 0), "rb"); vh.addSpacer();
  });
  return r;
}
function streakTxt(st, short) {
  const f = streak(series(st, "foreign")), o = streak(series(st, "organ"));
  const one = (n, s) => (s.n ? n + " " + s.n + "일 연속 " + (s.buy ? "매수" : "매도") : n + " 보합");
  return { t: short ? one("외국인", f) : one("외국인", f) + " · " + one("기관", o), c: f.n ? (f.buy ? C.buy : C.sell) : C.sub };
}

/* ---------- 데이터 ---------- */
async function getData() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.cacheDirectory(), "supply-radar-data.json");
  let d = null, stale = false;
  try {
    const r = new Request(DATA_URL + "?t=" + Date.now());
    r.timeoutInterval = 12;
    d = await r.loadJSON();
    if (d && d.ok) fm.writeString(path, JSON.stringify(d)); else d = null;
  } catch (e) { d = null; }
  if (!d && fm.fileExists(path)) { try { d = JSON.parse(fm.readString(path)); stale = true; } catch (e) {} }
  if (!d) return null;
  const dt = new Date(d.ts);
  d.open = (d.markets || []).some(m => m.status === "OPEN");
  const f0 = (d.markets || []).find(m => m.flow && m.flow.date);
  d.when = stale ? "오프라인 " + pad(dt.getHours()) + ":" + pad(dt.getMinutes())
    : d.open ? pad(dt.getHours()) + ":" + pad(dt.getMinutes())
    : "마감" + (f0 ? " " + mdTxt(f0.flow.date) : "");
  return d;
}

/* ---------- 크기별 화면 ---------- */
/** 작은 위젯 공통: 투자자 3줄 (이름·값, 아래에 전체 폭 막대) */
function smallRows(w, vals) {
  const mx = Math.max(1, ...vals.map(v => Math.abs(v[1] || 0)));
  vals.forEach(([l, v], i) => {
    if (i) w.addSpacer(5);
    const r = hstack(w); txt(r, l, 11, C.sub, "m"); r.addSpacer(); txt(r, eok(v), 12, tone(v || 0), "rb");
    w.addSpacer(2);
    const im = w.addImage(divBar(v, mx, 130, 4)); im.imageSize = new Size(130, 4);
  });
}
function smallHead(w, d, title, price, pct) {
  const h = hstack(w); txt(h, title, 13, C.ink, "h"); h.addSpacer();
  if (d.open) { const dot = h.addStack(); dot.size = new Size(6, 6); dot.cornerRadius = 3; dot.backgroundColor = C.live; }
  w.addSpacer(1);
  const p = hstack(w); txt(p, price, 15, C.ink, "rb"); p.addSpacer(4); txt(p, pctTxt(pct), 11, tone(pct || 0), "rs");
}
function small(w, d, param) {
  w.setPadding(13, 14, 12, 14);
  const st = d.stocks.find(s => s.code === param);
  if (st) {
    smallHead(w, d, st.name, st.price !== null && st.price !== undefined ? fmt(st.price) : "–", st.pct);
    w.addSpacer();
    smallRows(w, INV.map(k => [k[0], amt(st.trend[0], k[2])]));
    w.addSpacer();
    const sk = streakTxt(st, true); txt(w, sk.t, 10, sk.c, "s");
    return;
  }
  const m = d.markets.find(x => x.code === (/^(kosdaq|코스닥)$/i.test(param) ? "KOSDAQ" : "KOSPI")) || d.markets[0];
  smallHead(w, d, m.name + " 수급", m.price !== null && m.price !== undefined ? m.price.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "–", m.pct);
  w.addSpacer();
  const f = m.flow || {};
  smallRows(w, [["외국인", f.foreign], ["기관", f.institution], ["개인", f.personal]]);
  w.addSpacer();
  txt(w, d.when + " · 억원", 10, C.faint, "m");
}

function medium(w, d, stocks) {
  w.setPadding(12, 14, 11, 14);
  const body = hstack(w); body.topAlignContent();
  const left = vstack(body); left.size = new Size(146, 0);
  const o = { fs: 11, gap: 3, row: 2, lw: 30, bw: 28, bh: 5, noIndex: true };
  d.markets.slice(0, 2).forEach((m, i) => { if (i) left.addSpacer(7); marketBlock(left, m, o); });
  body.addSpacer(16);
  const right = vstack(body);
  const h = hstack(right); txt(h, "종목", 11, C.ink, "h"); h.addSpacer();
  if (d.open) { const dot = h.addStack(); dot.size = new Size(5, 5); dot.cornerRadius = 2.5; dot.backgroundColor = C.live; h.addSpacer(3); }
  txt(h, d.when, 10, C.sub, "m");
  stocks.slice(0, 2).forEach((st, i) => {
    right.addSpacer(i ? 7 : 4);
    const sh = hstack(right); txt(sh, st.name, 11, C.ink, "b"); sh.addSpacer(); txt(sh, pctTxt(st.pct), 11, tone(st.pct || 0), "rs");
    right.addSpacer(3);
    INV.forEach(([l, , k], j) => {
      if (j) right.addSpacer(1);
      const v = amt(st.trend[0], k), r = hstack(right);
      txt(r, l, 10, C.sub, "m"); r.addSpacer(); txt(r, eok(v), 10.5, tone(v || 0), "rb");
    });
  });
}

function large(w, d, stocks) {
  w.setPadding(15, 16, 14, 16);
  header(w, d, 15);
  w.addSpacer(7);
  const mk = hstack(w); mk.topAlignContent();
  const o = { fs: 12, gap: 4, row: 3, lw: 36, bw: 24, bh: 5 };
  d.markets.slice(0, 2).forEach((m, i) => { if (i) mk.addSpacer(18); const c = vstack(mk); c.size = new Size(144, 0); marketBlock(c, m, o); });
  w.addSpacer(7);

  // 장중 흐름
  const box = vstack(w); box.backgroundColor = C.card; box.cornerRadius = 12; box.setPadding(8, 10, 8, 10);
  const m = d.markets[0], pts = (m && m.intraday || []).filter(p => p && p.t);
  const lh = hstack(box); txt(lh, m.name + " 장중 흐름", 11, C.ink, "b"); lh.addSpacer();
  INV.forEach(([l, , , c], i) => {
    if (i) lh.addSpacer(7);
    const sw = lh.addStack(); sw.size = new Size(8, 3); sw.cornerRadius = 1.5; sw.backgroundColor = c; lh.addSpacer(3);
    txt(lh, l, 10, C.sub, "m");
  });
  box.addSpacer(4);
  if (pts.length >= 2) { const im = box.addImage(lines(pts, 286, 46)); im.imageSize = new Size(286, 46); }
  else { const e = hstack(box); e.size = new Size(286, 46); txt(e, "장이 열리면 약 5분마다 쌓여요", 11, C.faint, "m"); }
  w.addSpacer(8);

  // 종목
  stocks.slice(0, 2).forEach((st, i) => {
    if (i) w.addSpacer(8);
    stockHead(w, st, 12);
    w.addSpacer(4);
    trio(w, st, 12, 96);
    w.addSpacer(4);
    const r = hstack(w);
    const vals = series(st, "foreign");
    const im = r.addImage(dailyBars(vals, 92, 18)); im.imageSize = new Size(92, 18);
    r.addSpacer(8);
    const tx = vstack(r);
    const sk = streakTxt(st); txt(tx, sk.t, 10, sk.c, "s");
    const sg = signal(st);
    if (sg) txt(tx, sg.t, 9.5, sg.c, "m");
  });
  w.addSpacer();
}

function accessory(w, d, fam) {
  w.setPadding(0, 0, 0, 0);
  const m = d.markets[0], f = (m && m.flow) || {};
  if (fam === "accessoryInline") { txt(w, "외 " + eok(f.foreign) + " 기 " + eok(f.institution) + " 개 " + eok(f.personal), 12, C.ink, "s"); return; }
  txt(w, m.name + " " + pctTxt(m.pct) + " · " + d.when, 11, C.ink, "b");
  [["외국인", f.foreign], ["기관", f.institution], ["개인", f.personal]].forEach(([l, v]) => {
    const r = hstack(w); txt(r, l, 11, C.ink, "m"); r.addSpacer(); txt(r, eok(v), 11, C.ink, "rb");
  });
}

/* ---------- 실행 ---------- */
module.exports = async function (opts) {
  opts = opts || {};
  const param = String(opts.param || "").trim();
  const fam = config.widgetFamily || opts.family || "large";
  const w = new ListWidget();
  w.url = APP_URL;
  if (!fam.startsWith("accessory")) w.backgroundColor = C.bg;
  const d = await getData();
  if (!d) {
    txt(w, "수급 레이더", 14, C.ink, "h"); w.addSpacer(4);
    txt(w, "자료를 받지 못했어요. 잠시 뒤 다시 시도해요.", 11, C.sub, "m", 0.8);
    w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
  } else {
    // 파라미터에 종목코드가 있으면 그 종목을 맨 앞에
    const stocks = d.stocks.filter(s => s.trend && s.trend.length);
    const pin = stocks.findIndex(s => s.code === param);
    if (pin > 0) stocks.unshift(stocks.splice(pin, 1)[0]);
    if (fam === "small") small(w, d, param);
    else if (fam === "medium") medium(w, d, stocks);
    else if (fam.startsWith("accessory")) accessory(w, d, fam);
    else large(w, d, stocks);
    w.refreshAfterDate = new Date(Date.now() + (d.open ? 5 : 30) * 60 * 1000);
  }
  Script.setWidget(w);
  if (!config.runsInWidget) {
    if (fam === "small") await w.presentSmall();
    else if (fam === "medium") await w.presentMedium();
    else await w.presentLarge();
  }
  Script.complete();
  return w;
};
