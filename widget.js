// 수급 레이더 위젯 — Scriptable 앱에 이 글 전체를 붙여넣으세요. (처음 한 번만)
// 위젯은 작은·중간·큰 크기와 잠금 화면 위젯을 모두 지원해요.
// 위젯 편집 > Parameter 칸(선택):
//   비워 두기  → 기본 (작은 위젯은 코스피 수급)
//   코스닥      → 작은 위젯에 코스닥 수급
//   000660     → 그 종목을 먼저 보여 줌 (작은 위젯은 그 종목 수급)

// ---- 아래는 고치지 않아요. 위젯 본체를 인터넷에서 받아 늘 최신으로 유지해요. ----
const fm = module.filename.includes("Documents/iCloud") || module.filename.includes("Mobile Documents") ? FileManager.iCloud() : FileManager.local();
const dir = module.filename.slice(0, module.filename.lastIndexOf("/"));
const core = fm.joinPath(dir, "supply-radar-core.js");
try {
  const r = new Request("https://friese8807.github.io/supply-radar/widget-core.js?t=" + Date.now());
  r.timeoutInterval = 15;
  const code = await r.loadString();
  if (code.includes("SUPPLY_RADAR_WIDGET")) fm.writeString(core, code);
} catch (e) {}
if (fm.isFileStoredIniCloud(core) && !fm.isFileDownloaded(core)) await fm.downloadFileFromiCloud(core);
await importModule("supply-radar-core")({ param: args.widgetParameter || "" });
