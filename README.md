# 수급 레이더

외국인·기관·개인이 사고 있는지 팔고 있는지 보는 웹앱입니다.
주소: https://friese8807.github.io/supply-radar/

| 파일 | 역할 |
| --- | --- |
| `index.html` | 웹앱 화면 (홈 화면에 추가해서 사용) |
| `icon-180-v2.png`, `icon-512-v2.png`, `manifest.json` | 홈 화면 아이콘 |
| `widget.js` | 아이폰 Scriptable 위젯 로더 (처음 한 번만 붙여 넣기) |
| `widget-core.js` | 위젯 본체 — 로더가 실행될 때마다 새로 받아 씀 (작은·중간·큰·잠금 화면) |
| `fetch.cjs`, `watchlist.json` | GitHub Actions가 장중 1분마다 `data` 브랜치의 `data.json`(수급)·`map.json`(시장 지도)을 갱신, 업종 목록 `sectors.json`은 하루 한 번 |
| `detail.cjs` | 시장 지도 종목의 상세 자료(지표·1년 차트·실적·수급·리포트·뉴스·동종업계)를 `detail` 브랜치 `d/코드.json`으로 — 장중 30분마다·마감 뒤 |
| `Code.gs` | (선택) Apps Script 데이터 서버 — 연결하면 모든 종목, 15초 간격 |

- 기본 동작: 서버 주소 없이 `watchlist.json`의 종목(삼성전자, SK하이닉스)과 코스피·코스닥을 약 5분 간격으로 표시합니다.
- 종목을 바꾸려면 `watchlist.json`을 고칩니다.
- 실시간에 가깝게 보려면 `Code.gs`를 Apps Script 웹 앱(액세스: 모든 사용자)으로 배포하고, 앱 메뉴의 "데이터 서버 주소"에 붙여 넣습니다.
- 시장 지도: 코스피·코스닥 시가총액 상위 약 300종목을 업종 카드로 묶어 보여 줍니다. 상자 크기는 시가총액, 색은 그날 등락률(±5%에서 가장 진함)입니다.
- 지도 상자를 누르면 종목 상세가 열립니다: 시세·차트(1일·1개월·3개월·1년), 지표·수급·실적·뉴스·업종 탭.
- 시장 전체 수급은 장중 값, 종목별 수급은 거래일 단위 집계입니다. 금액은 수량 × 종가 추정치입니다.
- 데이터 출처: 네이버 증권. 투자 판단의 참고용입니다.

## 새 버전 반영

`index.html`을 고쳐 올릴 때는 `index.html`의 `BUILD` 숫자와 `version.txt` 숫자를 같은 새 숫자로 함께 올립니다. 앱이 열리거나 화면으로 돌아올 때 `version.txt`를 확인해 숫자가 다르면 새 버전으로 다시 엽니다.

## 데스크톱 미리보기 (Claude 데스크톱 오른쪽 패널)

```bash
node tools/preview.cjs index.html --out /tmp/preview.html   # 아이폰 틀 · ☀️주간/🌙야간 · 마우스로 끌어서 스크롤 · 서버 없으면 예시 모드
```

자료 파일로 보기는 `--data 자료.json`(서버 응답 흉내), 시각 고정은 `--now 2026-12-03T07:40`. 미리보기 파일은 저장소 밖에 만든다.
도구는 friese-mobile-webapp-kit 스킬의 `scripts/preview.cjs` 와 같다.
