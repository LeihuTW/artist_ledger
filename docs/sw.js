/* 繪師委託帳本｜離線快取。版本號改了就會換新快取。 */
const CACHE = 'artist-ledger-1.3.0';
const FILES = ["./","index.html","model.js","sheets.js","cloud.js","publicpage.js","xlsx.full.min.js","web-api.js","app.js","style.css","manifest.webmanifest","gas/Code.gs","icons/apple-180.png","icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // 同步請求直接走網路
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  })).catch(() => caches.match('index.html')));
});
