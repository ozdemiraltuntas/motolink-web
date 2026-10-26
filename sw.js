// MotoLink web: uygulama dosyalarını telefonda saklar (hızlı açılış). Sürüm değişince yenisi indirilir.
const V = 'motolink-web-1.1.6';
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
