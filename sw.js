/* Service Worker — المجابيد
   - الصفحة الرئيسية: شبكة أولاً، وإذا السيرفر نايم/بطيء تظهر شاشة تحميل بدل صفحة رندر
   - باقي الملفات: شبكة أولاً ثم الكاش */
const CACHE = 'majabeed-v4';
const SHELL = ['/loading.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];
const SKIP = ['/ev', '/send', '/chk', '/download', '/majabeed.apk'];

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

function loadingPage() {
  return caches.match('/loading.html').then(r => r || new Response('Loading...', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || SKIP.includes(url.pathname)) return;

  // فتح اللعبة بعد ما تأكدت شاشة التحميل إن السيرفر صاحي: مرّرها مباشرة بدون أي فحص (يمنع التعليق)
  if (req.mode === 'navigate' && url.searchParams.has('live')) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)); }
        return res;
      }).catch(() => caches.match('/').then(r => r || loadingPage()))
    );
    return;
  }

  // فتح اللعبة نفسها
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 5000))
        ]);
        // رد اللعبة الحقيقي فيه هذا الهيدر، أما صفحة "السيرفر يصحى" حق رندر فلا
        if (res && res.ok && res.headers.get('X-Majabeed') === '1') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('/', copy));
          return res;
        }
        if (url.pathname === '/loading.html') return res;
        return loadingPage();
      } catch (err) {
        // لا يوجد إنترنت أصلًا: افتح نسخة اللعبة المحفوظة (يشتغل وضع الكمبيوتر)
        if (!navigator.onLine || err.message !== 'slow') {
          const cached = await caches.match('/');
          if (cached) return cached;
        }
        return loadingPage();
      }
    })());
    return;
  }

  // باقي الملفات
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
