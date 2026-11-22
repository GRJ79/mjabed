'use strict';
/* خادم المجابيد — يعمل بدون أي مكتبات خارجية (Node.js فقط)
   التشغيل:  node server.js
   ثم افتح:  http://<IP-الجهاز>:8080/
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

const PORT = +(process.env.PORT || 8080);
const rooms = new Map();

function gamePath() {
  if (process.env.GAME) {
    const p = path.resolve(process.env.GAME);
    if (fs.existsSync(p)) return p;
  }
  const names = ['المجابيد.html', 'مجابيد.html', 'index.html'];
  for (const f of names) {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}


/* ملفات الـ PWA الثابتة (manifest + service worker + الأيقونات) */
const STATIC = {
  '/manifest.json': ['manifest.json', 'application/manifest+json; charset=utf-8'],
  '/sw.js':         ['sw.js',         'application/javascript; charset=utf-8'],
  '/icon-192.png':  ['icon-192.png',  'image/png'],
  '/icon-512.png':  ['icon-512.png',  'image/png'],
  '/loading.html':  ['loading.html',  'text/html; charset=utf-8'],
  '/.well-known/assetlinks.json': ['assetlinks.json', 'application/json; charset=utf-8']
};


/* صفحة تنزيل اللعبة (للأقارب) */
const DOWNLOAD_PAGE = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b0b0b">
<title>تحميل لعبة المجابيد</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
background:radial-gradient(ellipse at center,#16130e,#030303 80%);color:#e8c55a;font-family:Tahoma,"Segoe UI",sans-serif;text-align:center}
.box{width:100%;max-width:420px}
img{width:140px;height:140px;border-radius:28px;box-shadow:0 0 30px #d4af3744}
h1{margin:16px 0 6px;font-size:28px}
p.sub{margin:0 0 22px;opacity:.8}
a.btn{display:block;padding:18px;border-radius:16px;background:linear-gradient(135deg,#f6e27a,#c9a227 45%,#8c6d12 72%,#f3d96b);
color:#1a1405;font-size:22px;font-weight:700;text-decoration:none}
.st{margin-top:26px;text-align:right;background:#14110a;border:1px solid #d4af3755;border-radius:16px;padding:16px 18px;line-height:2}
.st b{display:block;margin-bottom:4px;font-size:17px}
.st span{display:block;color:#f1dc94}
small{display:block;margin-top:14px;opacity:.6}
</style></head><body><div class="box">
<img src="/icon-512.png" alt="المجابيد">
<h1>المجابيد</h1>
<p class="sub">لعبة ورق جماعية أونلاين</p>
<a class="btn" href="/majabeed.apk" download>⬇ تحميل اللعبة (أندرويد)</a>
<div class="st"><b>طريقة التثبيت:</b>
<span>1) اضغط زر التحميل، ولو طلع تنبيه اختر «تنزيل» أو «الاحتفاظ».</span>
<span>2) افتح الملف بعد ما ينزل.</span>
<span>3) لو سألك عن السماح بالتثبيت اضغط «إعدادات» ثم فعّل «السماح من هذا المصدر».</span>
<span>4) اضغط «تثبيت»، ولو طلع تحذير اختر «تثبيت على أي حال».</span></div>
<div class="st"><b>للآيفون 🍎</b>
<span>1) افتح هذا الرابط في <b style="display:inline">Safari</b> (مو كروم).</span>
<span>2) اضغط زر المشاركة ⬆️ ثم «إضافة إلى الشاشة الرئيسية».</span></div>
<small>اللعبة تحتاج إنترنت. أول فتح قد يتأخر قليلًا.</small>
</div></body></html>`;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
let gz = null;
function sendGame(req, res, g) {
  const h = Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'X-Majabeed': '1', 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding' }, CORS);
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const st = fs.statSync(g);
    if (!gz || gz.p !== g || gz.m !== st.mtimeMs) gz = { p: g, m: st.mtimeMs, buf: zlib.gzipSync(fs.readFileSync(g), { level: 6 }) };
    h['Content-Encoding'] = 'gzip'; h['Content-Length'] = gz.buf.length;
    res.writeHead(200, h); return res.end(gz.buf);
  }
  res.writeHead(200, h);
  return fs.createReadStream(g).pipe(res);
}

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) { r = { clients: new Map() }; rooms.set(code, r); }
  return r;
}
function sendSSE(res, obj) { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} }

/* السيرفر القديم: نقفله ونعرض رسالة انتقال (يشتغل لو الدومين من القائمة، ويمكن تغييرها من متغير OLD_HOSTS في رندر) */
const OLD_HOSTS = (process.env.OLD_HOSTS || 'mjabed.onrender.com').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const NEW_SITE = process.env.NEW_SITE || 'https://mjabed-1.onrender.com';
const NEW_APK_URL = process.env.NEW_APK_URL || '';
const MOVED_PAGE = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b0b0b"><title>المجابيد</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:radial-gradient(ellipse at center,#16130e,#030303 80%);color:#e8c55a;font-family:Tahoma,sans-serif;text-align:center}
.b{max-width:420px}h1{margin:0 0 10px;font-size:26px}p{line-height:1.9;font-size:17px;margin:8px 0}
a.btn{display:block;margin:12px 0;padding:15px;border-radius:14px;background:linear-gradient(135deg,#f6e27a,#c9a227 45%,#8c6d12 72%,#f3d96b);color:#1a1405;font-size:19px;font-weight:700;text-decoration:none}</style></head>
<body><div class="b"><h1>🃏 المجابيد</h1><p>انتقلت اللعبة لسيرفر جديد أسرع، وهذا الرابط القديم تم إيقافه.</p>
${NEW_APK_URL ? '<a class="btn" href="' + NEW_APK_URL + '">⬇ تحميل التطبيق الجديد (أندرويد)</a>' : ''}
<a class="btn" href="${NEW_SITE}">🌐 فتح اللعبة من الرابط الجديد</a>
<p style="font-size:14px;opacity:.8">للآيفون: افتح الرابط الجديد في Safari ثم «إضافة إلى الشاشة الرئيسية».</p></div></body></html>`;

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  /* السيرفر القديم: ما فيه لعب. نرد بصفحة الانتقال فقط */
  const hostName = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase().split(':')[0];
  if (OLD_HOSTS.indexOf(hostName) !== -1) {
    const keep = u.pathname === '/loading.html' || u.pathname === '/sw.js' || u.pathname === '/manifest.json' || u.pathname === '/icon-192.png' || u.pathname === '/icon-512.png' || u.pathname === '/.well-known/assetlinks.json';
    if (!keep) {
      if (u.pathname === '/chk') { res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS)); return res.end('no'); }
      if (u.pathname === '/ev' || u.pathname === '/send') { res.writeHead(410, CORS); return res.end('moved'); }
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, CORS));
      return res.end(MOVED_PAGE);
    }
  }

  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '/game')) {
    const g = gamePath();
    if (!g) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('game html file not found next to server.js');
    }
    return sendGame(req, res, g);
  }

  if (req.method === 'GET' && u.pathname === '/download') {
    const f = path.join(__dirname, 'download.html');
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const site = proto + '://' + String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (fs.existsSync(f)) {
      let apk = process.env.APK_URL || '';
      if (!apk && fs.existsSync(path.join(__dirname, 'majabeed.apk'))) apk = '/majabeed.apk';
      const html = fs.readFileSync(f, 'utf8')
        .split('{{SITE}}').join(site)
        .split('{{APK}}').join(apk || '#')
        .split('{{VERSION}}').join(process.env.APP_VERSION || '1.1');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(html);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(DOWNLOAD_PAGE);
  }

  /* صور صفحة التنزيل (ملفات dl-*.webp / jpg / png في المجلد الرئيسي) */
  if (req.method === 'GET' && (/^\/dl-[a-z0-9-]+\.(webp|jpg|png)$/.test(u.pathname) || u.pathname === '/favicon.ico')) {
    const name = u.pathname === '/favicon.ico' ? 'icon-192.png' : u.pathname.slice(1);
    const f = path.join(__dirname, name);
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
    const ext = name.split('.').pop();
    res.writeHead(200, { 'Content-Type': ext === 'webp' ? 'image/webp' : ext === 'jpg' ? 'image/jpeg' : 'image/png', 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(f).pipe(res);
  }

  /* معلومات آخر إصدار (يفحصها التطبيق ليعرض رسالة تحديث). عدّل ملف version.json عند كل إصدار جديد */
  if (req.method === 'GET' && u.pathname === '/version.json') {
    let info = { build: 0 };
    try { info = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')); } catch (e) {}
    if (!info.apk) {
      const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
      const site = proto + '://' + String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      info.apk = process.env.APK_URL || (site + '/majabeed.apk');
    }
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS));
    return res.end(JSON.stringify(info));
  }

  if (req.method === 'GET' && u.pathname === '/majabeed.apk') {
    const f = path.join(__dirname, 'majabeed.apk');
    if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('apk not found'); }
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="majabeed.apk"',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': fs.statSync(f).size,
      'Cache-Control': 'no-cache'
    });
    return fs.createReadStream(f).pipe(res);
  }

  if (req.method === 'GET' && STATIC[u.pathname]) {
    const f = path.join(__dirname, STATIC[u.pathname][0]);
    if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
    const h = { 'Content-Type': STATIC[u.pathname][1] };
    if (u.pathname === '/sw.js') { h['Cache-Control'] = 'no-cache'; h['Service-Worker-Allowed'] = '/'; }
    else h['Cache-Control'] = 'public, max-age=3600';
    res.writeHead(200, h);
    return fs.createReadStream(f).pipe(res);
  }

  if (req.method === 'GET' && u.pathname === '/dev') {
    const p = path.join(__dirname, 'المجابيد - نسخة المطور.html');
    if (!fs.existsSync(p)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('dev build not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(p).pipe(res);
  }

  if (req.method === 'GET' && u.pathname === '/chk') {
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, CORS));
    return res.end(rooms.has(u.query.room) ? 'ok' : 'no');
  }

  if (req.method === 'GET' && u.pathname === '/ev') {
    const code = String(u.query.room || '').trim();
    const id = String(u.query.id || 'x').trim();
    if (!code) { res.writeHead(400); return res.end(); }
    try { req.socket.setNoDelay(true); req.socket.setKeepAlive(true, 10000); req.socket.setTimeout(0); } catch (e) {}
    res.writeHead(200, Object.assign({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }, CORS));
    res.write('retry: 1500\n\n');
    const r = getRoom(code);
    const old = r.clients.get(id);
    r.clients.set(id, res);
    if (old && old !== res) { try { old.write('retry: 600000\n\n'); old.end(); } catch (e) {} }   /* نفس اللاعب رجع: نقفل الاتصال القديم بدون ما نعتبره طلع */
    const ping = setInterval(() => { try { res.write(':ping\n\n'); } catch (e) {} }, 10000);
    res.on('close', () => {
      clearInterval(ping);
      if (r.clients.get(id) !== res) return;                      /* اتصال قديم انستبدل: لا تبلّغ أحد إنه طلع */
      r.clients.delete(id);
      const left = { m: 'ev', ev: 'left', id: id };
      r.clients.forEach(cr => sendSSE(cr, left));
      setTimeout(() => {
        if (rooms.get(code) === r && !r.clients.size) rooms.delete(code);
      }, 60000);
    });
    return;
  }

  if (u.pathname === '/send' && req.method === 'POST') {
    let body = '';
    let big = false;
    req.on('data', d => { body += d; if (body.length > 300000) { big = true; req.destroy(); } });
    req.on('end', () => {
      if (big) { try { res.writeHead(413); } catch (e) {} return; }
      let m;
      try { m = JSON.parse(body || '{}'); } catch (e) { res.writeHead(400); return res.end('bad json'); }
      const code = String(u.query.room || '').trim();
      const to = String(u.query.to || '*');
      const from = String(u.query.id || 'x');
      m.from = from;
      const r = rooms.get(code);
      if (!r) { res.writeHead(404); return res.end('no room'); }
      r.clients.forEach((cr, cid) => {
        if (to === '*' ? cid !== from : cid === to) sendSSE(cr, m);
      });
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS));
      return res.end('ok');
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

/* مهم لـ Render: الوسيط عندهم يعيد استخدام الاتصالات، والقيمة الافتراضية (5 ثواني) تسبب قطع وأخطاء عشوائية */
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
server.requestTimeout = 0;

server.listen(PORT, '0.0.0.0', () => {
  if (!fs.existsSync(path.join(__dirname, 'majabeed.apk'))) console.log('تنبيه: majabeed.apk غير موجود، رابط /majabeed.apk ما راح يشتغل');
  console.log('Majabeed server running on http://0.0.0.0:' + PORT);
  console.log('Open http://<this-pc-ip>:' + PORT + '/ on the same Wi-Fi');
});
