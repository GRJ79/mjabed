'use strict';
/* خادم المجابيد — يعمل بدون أي مكتبات خارجية (Node.js فقط)
   التشغيل:  node server.js
   ثم افتح:  http://<IP-الجهاز>:8080/
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

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

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) { r = { clients: new Map() }; rooms.set(code, r); }
  return r;
}
function sendSSE(res, obj) { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} }

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);

  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '/game')) {
    const g = gamePath();
    if (!g) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('game html file not found next to server.js');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(g).pipe(res);
  }

  if (req.method === 'GET' && u.pathname === '/dev') {
    const p = path.join(__dirname, 'المجابيد - نسخة المطور.html');
    if (!fs.existsSync(p)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('dev build not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(p).pipe(res);
  }

  if (req.method === 'GET' && u.pathname === '/chk') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(rooms.has(u.query.room) ? 'ok' : 'no');
  }

  if (req.method === 'GET' && u.pathname === '/ev') {
    const code = String(u.query.room || '').trim();
    const id = String(u.query.id || 'x').trim();
    if (!code) { res.writeHead(400); return res.end(); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 1500\n\n');
    const r = getRoom(code);
    r.clients.set(id, res);
    const ping = setInterval(() => { try { res.write(':ping\n\n'); } catch (e) {} }, 15000);
    req.on('close', () => {
      clearInterval(ping);
      if (r.clients.get(id) === res) r.clients.delete(id);
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
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('ok');
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Majabeed server running on http://0.0.0.0:' + PORT);
  console.log('Open http://<this-pc-ip>:' + PORT + '/ on the same Wi-Fi');
});
