/* Service Worker — المجابيد
   شبكة أولاً (عشان اللعب أونلاين والتحديثات تنزل مباشرة)، وإذا ما فيه نت يرجع للكاش */
const CACHE = 'majabeed-v1';
const SHELL = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // لا نلمس طلبات اللعب الجماعي (SSE / إرسال / فحص الغرفة)
  if (req.method !== 'GET' || url.origin !== location.origin ||
      ['/ev', '/send', '/chk'].includes(url.pathname)) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('/')))
  );
});
