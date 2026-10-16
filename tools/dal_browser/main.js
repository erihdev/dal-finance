/* متصفح دال في السحابة.
   1) عرض عن بُعد محمي بكلمة مرور: ضيف الله يفتح الرابط من جواله ويسجّل دخوله بنفسه في المنصات (لا تُخزَّن كلمات مرور هنا؛ فقط جلسات المتصفح).
   2) قارئ دوري (قراءة فقط): كل POLL_MIN دقائق يفتح لوحات المنصات في تبويبات خلفية، يقرأ النص، ويكتبه في قاعدة الجوال live/web_now.
   لا يضغط أي زر ولا يرسل أي نموذج. */
'use strict';
const http = require('http'), httpProxy = require('http-proxy');
const { chromium } = require('playwright');
const E = process.env;
const USER = E.VIEW_USER || 'dal', PASS = E.VIEW_PASSWORD || '';
const GAS = E.GAS_URL, KEY = E.DAL_KEY, POLL = (+E.POLL_MIN || 5) * 60e3;
const SITES = [
  { k: 'foodics', name: 'فودكس', url: 'https://console.foodics.com/', login: /login|auth|signin/i },
  { k: 'retm', name: 'رتم', url: 'https://retm.sa/dashboard?period=1', login: /login|signin/i },
  { k: 'bonat', name: 'بونات', url: 'https://store.bonat.io/', login: /login|signin/i },
  { k: 'olu', name: 'علو', url: 'https://hr.olu.sa/', login: /login|signin/i, noText: true },
];
let ctx = null, state = { at: null, sites: {} }, busy = false, viewers = 0, lastView = 0;

const START = `<!doctype html><meta charset=utf-8><title>متصفح دال</title><body style="font-family:sans-serif;direction:rtl;padding:24px;background:#FFF7F0">
<h2>متصفح دال في السحابة</h2><p>سجّل دخولك بنفسك في كل منصة مرة واحدة. الجلسة تبقى محفوظة، والقارئ يقرأ اللوحات كل ${E.POLL_MIN || 5} دقائق (قراءة فقط).</p>
<ul style="line-height:2.4;font-size:18px">${SITES.map(s => `<li><a href="${s.url}" target="_blank">${s.name}</a></li>`).join('')}<li><a href="https://mail.google.com/mail/u/0" target="_blank">إيميل المحمصة</a></li></ul></body>`;

async function gas(o) {
  o.k = KEY;
  const r = await fetch(GAS, { method: 'POST', body: JSON.stringify(o), redirect: 'follow', headers: { 'Content-Type': 'text/plain' } });
  const j = await r.json(); if (!j.ok) throw new Error('gas ' + j.err); return j;
}
async function readSite(s) {
  const p = await ctx.newPage();
  try {
    await p.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(6000);
    const url = p.url();
    let text = '';
    if (!s.noText) text = (await p.evaluate(() => document.body ? document.body.innerText : '')).replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
    const needLogin = s.login.test(url) || /تسجيل الدخول|Sign in|Log in|كلمة المرور|Password/i.test(text.slice(0, 600));
    return { at: new Date().toISOString(), ok: !needLogin, needLogin, url, text };
  } catch (e) { return { at: new Date().toISOString(), ok: false, err: String(e.message || e).slice(0, 200) }; }
  finally { await p.close().catch(() => {}); }
}
async function poll(force) {
  if (busy || !ctx) return;
  if (!force && (viewers > 0 || Date.now() - lastView < 3 * 60e3)) return;   // لا نفتح تبويبات أثناء استخدامك للشاشة
  busy = true;
  try {
    for (const s of SITES) state.sites[s.k] = Object.assign({ name: s.name }, await readSite(s));
    state.at = new Date().toISOString();
    state.needLogin = SITES.filter(s => state.sites[s.k] && !state.sites[s.k].ok).map(s => s.name);
    if (GAS && KEY) await gas({ op: 'set', path: 'live/web_now', data: state }).catch(e => console.log('gas', e.message));
  } finally { busy = false; }
}
async function launch() {
  ctx = await chromium.launchPersistentContext('/data/profile', {
    headless: false, viewport: null, locale: 'ar-SA', timezoneId: 'Asia/Riyadh',
    args: ['--no-sandbox', '--start-maximized', '--disable-dev-shm-usage', '--lang=ar', '--disable-gpu', '--disable-smooth-scrolling', '--wm-window-animations-disabled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  ctx.on('close', () => { ctx = null; setTimeout(launch, 3000); });
  await refreshInject();
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.setContent(START);
  console.log('browser up');
}
// استيراد جلسات الدخول من إضافة كروم (كوكيز + تخزين المتصفح) — لا كلمات مرور
const fs = require('fs'); const SFILE = '/data/session_storage.json';
let SSTORE = {}; try { SSTORE = JSON.parse(fs.readFileSync(SFILE, 'utf8')); } catch (e) {}
async function refreshInject() {   // نحقن تخزين الجلسة في كل صفحة من نفس الموقع (sessionStorage يضيع مع إغلاق التبويب)
  if (!ctx || !Object.keys(SSTORE).length) return;
  await ctx.addInitScript(all => {
    try { const d = all[location.origin]; if (!d) return;
      for (const [a, v] of Object.entries(d.session || {})) sessionStorage.setItem(a, v);
      for (const [a, v] of Object.entries(d.local || {})) if (localStorage.getItem(a) == null) localStorage.setItem(a, v); } catch (e) {}
  }, SSTORE).catch(() => {});
}
const SS = { no_restriction: 'None', lax: 'Lax', strict: 'Strict', unspecified: 'Lax' };
function importSessions(req, res) {
  let b = ''; req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); });
  req.on('end', async () => {
    const out = {};
    try {
      if (!ctx) throw new Error('المتصفح يعيد التشغيل، جرّب بعد دقيقة');
      const j = JSON.parse(b || '{}');
      for (const [k, site] of Object.entries(j.sites || {})) {
        const cookies = (site.cookies || []).filter(c => c.name && c.domain).map(c => {
          const o = { name: c.name, value: c.value || '', httpOnly: !!c.httpOnly, secure: !!c.secure || /^__(Host|Secure)-/.test(c.name),
            sameSite: SS[c.sameSite] || 'Lax', expires: c.session || !c.expirationDate ? -1 : Math.floor(c.expirationDate) };
          if (c.hostOnly || /^__Host-/.test(c.name)) o.url = 'https://' + c.domain.replace(/^\./, '') + (c.path || '/');   // كوكي خاص بالنطاق نفسه
          else { o.domain = c.domain; o.path = c.path || '/'; }
          if (o.sameSite === 'None' && !o.secure) o.sameSite = 'Lax';
          return o; });
        let added = 0;
        for (const ck of cookies) { try { await ctx.addCookies([ck]); added++; } catch (e) { console.log('cookie', k, ck.name, e.message.slice(0, 120)); } }
        let st = 0;
        for (const [origin, data] of Object.entries(site.storage || {})) SSTORE[origin] = data;
        for (const [origin, data] of Object.entries(site.storage || {})) {
          const p = await ctx.newPage();
          try {
            await p.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await p.evaluate(d => { for (const [a, v] of Object.entries(d.local || {})) localStorage.setItem(a, v); for (const [a, v] of Object.entries(d.session || {})) sessionStorage.setItem(a, v); }, data);
            st++;
          } catch (e) { } finally { await p.close().catch(() => {}); }
        }
        out[k] = { cookies: added, of: cookies.length, storage: st };
      }
      try { fs.writeFileSync(SFILE, JSON.stringify(SSTORE)); } catch (e) {}
      await refreshInject();
      lastView = 0; setTimeout(() => poll(true), 3000);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, out }));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, err: String(e.message || e) })); }
  });
}
// العرض عن بُعد خلف كلمة مرور
const proxy = httpProxy.createProxyServer({ target: 'http://127.0.0.1:6080', ws: true });
proxy.on('error', () => {});
const TOK = require('crypto').createHash('sha256').update('dal:' + PASS).digest('hex').slice(0, 40);
const authed = req => {
  if (!PASS) return false;
  if ((req.headers.cookie || '').split(/;\s*/).includes('dalv=' + TOK)) return true;   // سفاري لا يرسل Basic مع websocket، فنعتمد كوكي بعد الدخول
  const h = req.headers.authorization || ''; const i = Buffer.from(h.replace(/^Basic /, ''), 'base64').toString(); const c = i.indexOf(':');
  return c > 0 && i.slice(0, c) === USER && i.slice(c + 1) === PASS;
};
const srv = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: !!ctx, at: state.at, needLogin: state.needLogin || [] })); }
  if (!authed(req)) {
    if (req.url === '/import') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, err: 'الرمز غير صحيح' })); }   // بلا نافذة دخول حتى لا تعلق الإضافة
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dal"' }); return res.end('auth'); }
  res.setHeader('Set-Cookie', 'dalv=' + TOK + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000');
  if (req.url === '/' || req.url === '') { res.writeHead(302, { Location: '/vnc.html?autoconnect=1&resize=scale&reconnect=1&quality=5&compression=7&show_dot=1&path=websockify' }); return res.end(); }
  if (req.method === 'POST' && req.url === '/import') return importSessions(req, res);
  if (req.url === '/poll') { poll(true); res.writeHead(200); return res.end('ok'); }
  proxy.web(req, res);
});
srv.on('upgrade', (req, sock, head) => { if (!authed(req)) return sock.destroy(); viewers++; lastView = Date.now(); sock.on('close', () => { viewers = Math.max(0, viewers - 1); lastView = Date.now(); }); proxy.ws(req, sock, head); });
srv.listen(+E.PORT || 8080, E.HOST || '::', () => console.log('view up'));
launch().then(() => { setTimeout(poll, 60e3); setInterval(poll, POLL); }).catch(e => { console.error(e); process.exit(1); });
