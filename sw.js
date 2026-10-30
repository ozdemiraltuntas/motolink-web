// MotoLink web: uygulama dosyalarını telefonda saklar (hızlı açılış). Sürüm değişince yenisi indirilir.
const V = 'motolink-web-1.1.9';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'lib/livekit-client.umd.js', 'lib/leaflet.js', 'lib/leaflet.css', 'lib/qrcode.js',
  'img/wordmark.png', 'img/tmp.png', 'img/icon-192.png', 'img/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // sunucu, harita ve radyo her zaman internetten
  // Önce internetten dene (güncel kalsın), yoksa saklanandan aç
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match('index.html'))));
});

// 1.1.8: bildirime dokununca uygulamayı öne getir
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((l) => {
    for (const c of l) { if ('navigate' in c && link !== './') { return c.navigate(link).then((w) => w && w.focus()); } if ('focus' in c) return c.focus(); }
    return self.clients.openWindow ? self.clients.openWindow(link) : null;
  }));
});

// 1.1.8: Firebase'den gelen bildirim (uygulama kapalıyken de)
self.addEventListener('push', (e) => {
  let j = {};
  try { j = e.data ? e.data.json() : {}; } catch (err) { j = {}; }
  const n = j.notification || {};
  const d = j.data || {};
  const link = (j.fcmOptions && j.fcmOptions.link) || (n.click_action) || './';
  const title = n.title || 'MotoLink';
  e.waitUntil(self.registration.showNotification(title, {
    body: n.body || '', icon: n.icon || 'img/icon-192.png', badge: 'img/icon-192.png',
    tag: n.tag || ('ml-' + (d.room || '')), renotify: true, data: { link }
  }));
});
