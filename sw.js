// 수급 레이더 — 휴대폰 알림 전용 서비스 워커 (화면 저장은 하지 않아요)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const PUSH_APP_NAME = '수급 레이더', PUSH_ICON = 'icon-180-v2.png';
// ── 휴대폰 푸시 알림 (friese-mobile-webapp-kit · web-push) ──
// 서버가 내용 없는 푸시를 보내면, 앱이 적어 둔 캐시 'push-cfg'(서버 주소·암호)로 문구를 받아 띄운다.
// 실패해도 알림은 반드시 하나 띄운다(아이폰은 안 띄운 푸시가 쌓이면 구독을 끊는다). activate 에서 'push-cfg' 캐시는 지우지 않는다.
self.addEventListener('push', e => e.waitUntil((async () => {
  let m = null;
  try {
    const r0 = await (await caches.open('push-cfg')).match('cfg'); const cfg = r0 ? await r0.json() : null;
    const sub = await self.registration.pushManager.getSubscription();
    if (cfg && cfg.api) {
      const r = await fetch(cfg.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({}, cfg.extra, { action: 'pushMsg', endpoint: sub && sub.endpoint })) });
      const j = await r.json(); m = j && (j.data ? j.data.msg : j.msg);
    }
  } catch (_) {}
  m = m || { title: PUSH_APP_NAME, body: '새 소식이 있어요. 눌러서 확인해 주세요.' };
  await self.registration.showNotification(m.title, { body: m.body, icon: PUSH_ICON, badge: PUSH_ICON });
})()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => ws.length ? ws[0].focus() : self.clients.openWindow('./')));
});
