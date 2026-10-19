/* متصفح دال في السحابة.
   1) عرض عن بُعد محمي بكلمة مرور: ضيف الله يفتح الرابط من جواله ويسجّل دخوله بنفسه في المنصات (لا تُخزَّن كلمات مرور هنا؛ فقط جلسات المتصفح).
   2) قارئ دوري (قراءة فقط): كل POLL_MIN دقائق يفتح لوحات المنصات في تبويبات خلفية، يقرأ النص، ويكتبه في قاعدة الجوال live/web_now.
   لا يضغط أي زر ولا يرسل أي نموذج. */
'use strict';
const http = require('http'), httpProxy = require('http-proxy');
const { chromium } = require('playwright');
const PARSE = require('./parse');
let SALES = { at: null };
const E = process.env; const fs = require('fs');
const USER = E.VIEW_USER || 'dal', PASS = E.VIEW_PASSWORD || '';
const GAS = E.GAS_URL, KEY = E.DAL_KEY, POLL = (+E.POLL_MIN || 5) * 60e3;
const WMDIR = '/data/wamedia';   // مرفقات واتساب الخاصة (تُحذف بعد 45 يومًا)
const FAST = Math.max(30, +E.FAST_SEC || 30) * 1000, FAST_K = ['foodics', 'retm'];   // أرقام المبيعات كل 30 ثانية
const SITES = [
  { k: 'foodics', name: 'فودكس', url: 'https://console.foodics.com/', login: /login|auth|signin/i },
  { k: 'retm', name: 'رتم', url: 'https://retm.sa/dashboard?period=1', login: /login|signin/i },
  { k: 'bonat', name: 'بونات', url: 'https://store.bonat.io/', login: /login|signin/i },
  // تمارا: أُوقفت قراءتها بطلب ضيف الله (لا تحتاج الآن)؛ تقرير حساب يقرؤها عند الطلب فقط
];
let ctx = null, state = { at: null, sites: {} }, busy = false, viewers = 0, lastView = 0;
const SLOGF = '/data/sales_log.json'; let SLOG = {}; try { SLOG = JSON.parse(fs.readFileSync(SLOGF, 'utf8')); } catch (e) {}

const START = `<!doctype html><meta charset=utf-8><title>متصفح دال</title><body style="font-family:sans-serif;direction:rtl;padding:24px;background:#FFF7F0">
<h2>متصفح دال في السحابة</h2><p>سجّل دخولك بنفسك في كل منصة مرة واحدة. الجلسة تبقى محفوظة، والقارئ يقرأ اللوحات كل ${E.POLL_MIN || 5} دقائق (قراءة فقط).</p>
<ul style="line-height:2.4;font-size:18px">${SITES.map(s => `<li><a href="${s.url}" target="_blank">${s.name}</a></li>`).join('')}<li><a href="https://accounting.foodics.com/" target="_blank">فودكس المحاسبي</a></li><li><a href="https://mail.google.com/mail/u/0" target="_blank">إيميل المحمصة</a></li></ul></body>`;

async function gas(o) {
  o.k = KEY;
  const r = await fetch(GAS, { method: 'POST', body: JSON.stringify(o), redirect: 'follow', headers: { 'Content-Type': 'text/plain' } });
  const j = await r.json(); if (!j.ok) throw new Error('gas ' + j.err); return j;
}
function riyadhToday() {   // تاريخ اليوم بتوقيت الرياض (UTC+3)
  const d = new Date(Date.now() + 3 * 3600e3);
  return d.toISOString().slice(0, 10);
}
function prevMonth() {   // الشهر الميلادي السابق بتوقيت الرياض
  const n = new Date(Date.now() + 3 * 3600e3), y = n.getUTCFullYear(), m = n.getUTCMonth();
  const s = new Date(Date.UTC(y, m - 1, 1)), e = new Date(Date.UTC(y, m, 0));
  return { from: s.toISOString().slice(0, 10), to: e.toISOString().slice(0, 10) };
}
async function readBonat(p, from, to) {   // قراءة مؤشرات بونات من dashboard-api بالكوكيز المنقولة (من/إلى اختياري، الافتراضي اليوم)
  const day = from || riyadhToday(), day2 = to || from || riyadhToday();
  try {
    const stats = await p.evaluate(async (rng) => {
      const [day, day2] = rng;
      const B = 'https://dashboard-api.bonat.io/api/v5/';
      const q = '?from=' + day + 'T00:00:00&to=' + day2 + 'T23:59:59';
      const m = {
        customers: 'customers/count', newCustomers: 'customers/count-new-customers',
        visits: 'visits/count', totalSale: 'customers/total-sale',
        discountSale: 'customers/total-discount-sale', giftcardSale: 'customers/total-giftcard-sale',
        pickupSale: 'customers/total-pickup-sale', retentionRate: 'customers/retention-rate',
        feedbacks: 'feedbacks/count', feedbackAvg: 'feedbacks/overall',
        feedbackPositive: 'feedbacks/positive-count', feedbackNegative: 'feedbacks/negative-count'
      };
      const out = {}; let okAny = false;
      for (const [k, e] of Object.entries(m)) {
        try {
          const r = await fetch(B + e + q, { credentials: 'include', headers: { Accept: 'application/json' } });
          if (r.status === 200) { const j = await r.json(); const v = (j && j.data !== undefined) ? j.data : j; if (typeof v === 'number' || typeof v === 'string') { out[k] = v; okAny = true; } }
          else if (r.status === 401 || r.status === 403) out.__auth = r.status;
        } catch (e) {}
      }
      return { okAny, out };
    }, [day, day2]).catch(e => ({ err: String(e.message || e).slice(0, 160) }));
    if (stats && stats.err) return { ok: false, err: stats.err };
    if (!stats || !stats.okAny) return { ok: false, err: 'auth ' + ((stats && stats.out && stats.out.__auth) || '—') };
    delete stats.out.__auth;
    return { ok: true, stats: Object.assign({ day, from: day, to: day2 }, stats.out) };
  } catch (e) { return { ok: false, err: String(e.message || e).slice(0, 160) }; }
}
// ===== سلة: قراءة الطلبات عبر Admin API بمفتاح منقول =====
// ===== سلة عبر OAuth الرسمي (توكن خادمي دائم؛ لا متصفح ولا Cloudflare) =====
const SOFILE = '/data/salla_oauth.json';
let SOAUTH = {}; try { SOAUTH = JSON.parse(fs.readFileSync(SOFILE, 'utf8')); } catch (e) {}
let sallaRefreshing = null;
async function sallaExchange(params) {
  const body = new URLSearchParams(Object.assign({ client_id: E.SALLA_CLIENT_ID || '', client_secret: E.SALLA_CLIENT_SECRET || '' }, params));
  const r = await fetch('https://accounts.salla.sa/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Error('salla-token-' + r.status + ' ' + (j.error || ''));
  SOAUTH = { access: j.access_token, refresh: j.refresh_token || SOAUTH.refresh, exp: Date.now() + (+j.expires_in || 1209600) * 1000, at: Date.now() };
  try { fs.writeFileSync(SOFILE, JSON.stringify(SOAUTH)); console.log('salla token saved, refresh:', !!SOAUTH.refresh); } catch (e) { console.log('salla save ERR', e.message); }
  return SOAUTH;
}
async function sallaToken() {
  if (SOAUTH.access && SOAUTH.exp - 120000 > Date.now()) return SOAUTH.access;
  if (!SOAUTH.refresh) throw new Error('salla-not-linked');
  if (!sallaRefreshing) sallaRefreshing = sallaExchange({ grant_type: 'refresh_token', refresh_token: SOAUTH.refresh }).finally(() => { sallaRefreshing = null; });
  await sallaRefreshing; return SOAUTH.access;
}
async function sallaApi(path) {
  const tok = await sallaToken();
  const r = await fetch('https://api.salla.dev' + path, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' } });
  if (!r.ok) throw new Error('salla-api-' + r.status);
  return r.json();
}
function num(x) { return typeof x === 'number' ? x : (x && typeof x === 'object' && typeof x.amount === 'number' ? x.amount : (parseFloat(x) || 0)); }
async function readSalla(from, to) {   // ملخص طلبات سلة بين تاريخين YYYY-MM-DD عبر الواجهة الرسمية
  try {
    const agg = { orders: 0, sales: 0, byStatus: {}, byPayment: {}, refunds: 0, refundAmount: 0, currency: 'SAR', from, to };
    let page = 1, pages = 1;
    do {
      const j = await sallaApi(`/admin/v2/orders?from_date=${from}&to_date=${to}&per_page=50&page=${page}`);
      const data = j.data || [], pg = j.pagination || {}; pages = pg.totalPages || 1;
      if (page === 1) agg.orders = pg.total != null ? pg.total : data.length;
      for (const o of data) {
        agg.sales += num(o.amounts && (o.amounts.total || o.amounts.sub_total)) || num(o.total) || num(o.amount);
        const st = (o.status && (o.status.slug || o.status.name)) || o.status || 'unknown'; agg.byStatus[st] = (agg.byStatus[st] || 0) + 1;
        const pm = (o.payment_method && (o.payment_method.name || o.payment_method)) || o.payment_method || 'unknown'; agg.byPayment[pm] = (agg.byPayment[pm] || 0) + 1;
        const rf = num(o.amounts && o.amounts.refunded); if (rf) { agg.refunds++; agg.refundAmount += rf; }
        const cur = (o.amounts && o.amounts.total && o.amounts.total.currency) || o.currency; if (cur) agg.currency = cur;
      }
      page++;
    } while (page <= pages && page <= 60);
    agg.sales = Math.round(agg.sales * 100) / 100; agg.refundAmount = Math.round(agg.refundAmount * 100) / 100;
    return { ok: true, stats: agg };
  } catch (e) { return { ok: false, err: String(e.message || e).slice(0, 120) }; }
}
async function readSite(s) {
  const p = await ctx.newPage();
  try {
    await p.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(6000);
    const url = p.url();
    let text = '';
    if (!s.noText) text = (await p.evaluate(() => document.body ? document.body.innerText : '')).replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
    // بونات يصرّح عن واجهته بالكوكيز (لا بمفتاح localStorage)، فنقرأ الأرقام من الواجهة مباشرة ولا نعتمد على ظهور اللوحة
    if (s.k === 'bonat') {
      const b = await readBonat(p);
      if (b.ok) return { at: new Date().toISOString(), ok: true, url, stats: b.stats };
      return { at: new Date().toISOString(), ok: false, needLogin: true, url, err: b.err };
    }
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
    for (const s of SITES) if (!FAST_K.includes(s.k) || !state.sites[s.k]) state.sites[s.k] = Object.assign({ name: s.name }, await readSite(s));
    state.at = new Date().toISOString();
    state.needLogin = SITES.filter(s => state.sites[s.k] && !state.sites[s.k].ok).map(s => s.name);
    if (GAS && KEY) await gas({ op: 'set', path: 'live/web_now', data: state }).catch(e => console.log('gas', e.message));
    await publishSales();
    // مؤشرات بونات (عملاء/زيارات/تقييمات) في مستند مستقل للتطبيق
    const bs = state.sites.bonat;
    if (GAS && KEY && bs && bs.ok && bs.stats) await gas({ op: 'set', path: 'live/bonat_now', data: Object.assign({ at: bs.at }, bs.stats) }).catch(e => console.log('gas', e.message));
  } finally { busy = false; }
}
async function publishSales() {
    // أرقام المبيعات كما تظهر حرفياً في لوحتي رتم وفودكس
    for (const k of ['retm', 'foodics']) { const st = state.sites[k]; const v = st && st.ok ? PARSE[k](st.text) : null; if (v) SALES[k] = Object.assign(v, { at: st.at }); }
    // سجل قراءات اليوم (كل 5 دقائق) لمقارنة «أمس في نفس الوقت» بدل أمس كاملًا
    try { const r = SALES.retm; if (r && r.revenue != null) { const n = new Date(Date.now() + 3 * 3600e3); const d = n.toISOString().slice(0, 10), hm = n.getUTCHours() * 60 + n.getUTCMinutes();
      SLOG[d] = SLOG[d] || []; const lastE = SLOG[d][SLOG[d].length - 1]; if (!lastE || hm - lastE[0] >= 4) SLOG[d].push([hm, r.revenue, r.invoices || 0]); for (const k of Object.keys(SLOG)) if (k < new Date(Date.now() + 3 * 3600e3 - 3 * 864e5).toISOString().slice(0, 10)) delete SLOG[k];
      const yd = new Date(Date.now() + 3 * 3600e3 - 864e5).toISOString().slice(0, 10); const Y = SLOG[yd] || []; let best = null; for (const e of Y) if (e[0] <= hm + 3) best = e;
      r.ySame = best ? { revenue: best[1], invoices: best[2], at: yd + ' ' + String(Math.floor(best[0] / 60)).padStart(2, '0') + ':' + String(best[0] % 60).padStart(2, '0') } : null;
      r.today = SLOG[d].map(e => [e[0], e[1]]); fs.writeFileSync(SLOGF, JSON.stringify(SLOG)); } } catch (e) { }
    SALES.at = new Date().toISOString();
    if (GAS && KEY && (SALES.retm || SALES.foodics)) await gas({ op: 'set', path: 'live/sales_now', data: SALES }).catch(e => console.log('gas', e.message));
}
let fastBusy = false;
async function fastSales() {   // فودكس ورتم وحدهما كل FAST_SEC ثانية (بدل 5 دقائق)
  if (fastBusy || busy || !ctx) return;
  if (viewers > 0 || Date.now() - lastView < 3 * 60e3) return;
  fastBusy = true;
  try {
    for (const k of FAST_K) { if (k === 'retm' && RL.page && !RL.err) { await retmRefresh('timer'); continue; } const s = SITES.find(x => x.k === k); state.sites[k] = Object.assign({ name: s.name }, await readSite(s)); }
    await publishSales();
  } catch (e) { console.log('fast', e.message); } finally { fastBusy = false; }
}
/* ===== رتم لحظياً: تبويب واحد يبقى مفتوحاً على لوحة رتم. اللوحة نفسها مشتركة في قناة رتم الحية (Pusher: private-POS.<الشركة>)،
   فنستمع لكل حدث يصلها (فاتورة جديدة، إرجاع، إقفال…) ونعيد قراءة اللوحة فوراً وننشر الرقم — بدل انتظار الدورة. الدورة كل 30 ثانية تبقى احتياطاً. */
const RL = { page: null, err: null, at: null, evAt: null, evs: [], n: 0 };
let rlBusy = false, rlAgain = false, rlTimer = null;
async function retmRefresh(why) {
  if (!RL.page) return; if (rlBusy) { rlAgain = true; return; } rlBusy = true;
  try {
    const p = RL.page; await p.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForFunction(() => /\d/.test((document.body && document.body.innerText) || '') && !document.querySelector('.pace-running'), null, { timeout: 12000 }).catch(() => {});
    await p.waitForTimeout(1200);
    const url = p.url(); const text = (await p.evaluate(() => document.body ? document.body.innerText : '')).replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
    const s = SITES.find(x => x.k === 'retm'); const needLogin = s.login.test(url) || /تسجيل الدخول|Sign in|Log in|كلمة المرور|Password/i.test(text.slice(0, 600));
    state.sites.retm = { name: s.name, at: new Date().toISOString(), ok: !needLogin, needLogin, url, text, via: why };
    RL.at = state.sites.retm.at; RL.err = needLogin ? 'needLogin' : null; RL.n++;
    if (why !== 'timer') await publishSales();
  } catch (e) { RL.err = String(e.message || e).slice(0, 120); } finally { rlBusy = false; if (rlAgain) { rlAgain = false; setTimeout(() => retmRefresh('event'), 300); } }
}
async function retmLive() {
  if (!ctx || RL.page) return;
  try {
    const p = await ctx.newPage(); RL.page = p; p.on('close', () => { RL.page = null; setTimeout(retmLive, 60e3); });
    await p.exposeFunction('__dalRetmEv', ev => { RL.evAt = new Date().toISOString(); RL.evs = RL.evs.concat([String(ev).slice(0, 60)]).slice(-10); clearTimeout(rlTimer); rlTimer = setTimeout(() => retmRefresh('event'), 800); });
    // بعد كل تحميل للصفحة: ننتظر اتصال اللوحة بقناتها الحية ثم نستمع لأحداثها (أسماء الأحداث فقط تُسجّل، بلا بيانات)
    await p.addInitScript(() => { const tick = () => { const P = window.Pusher, i = P && P.instances && P.instances[0]; if (!i) return setTimeout(tick, 1000); if (i.__dal) return; i.__dal = 1; i.bind_global(ev => { if (!/^pusher[:_]/.test(ev)) window.__dalRetmEv(ev); }); }; tick(); });
    await p.goto(SITES.find(x => x.k === 'retm').url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(6000); await retmRefresh('start');
    console.log('retm live', RL.err || 'ok');
  } catch (e) { RL.err = String(e.message || e).slice(0, 120); console.log('retm live err', RL.err); }
}
async function launch() {
  ctx = await chromium.launchPersistentContext('/data/profile', {
    headless: false, viewport: null, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', acceptDownloads: true,
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
const SFILE = '/data/session_storage.json', AFILE = '/data/auth_headers.json';
let SSTORE = {}; try { SSTORE = JSON.parse(fs.readFileSync(SFILE, 'utf8')); } catch (e) {}
let AUTHH = {}; try { AUTHH = JSON.parse(fs.readFileSync(AFILE, 'utf8')); } catch (e) {}   // host -> "Bearer ..." (مفاتيح واجهات مثل سلة)
async function refreshInject() {   // نحقن تخزين الجلسة في كل صفحة من نفس الموقع (sessionStorage يضيع مع إغلاق التبويب)
  if (!ctx || !Object.keys(SSTORE).length) return;
  await ctx.addInitScript(all => {
    try { const d = all[location.origin]; if (!d) return;
      for (const [a, v] of Object.entries(d.session || {})) sessionStorage.setItem(a, v);
      for (const [a, v] of Object.entries(d.local || {})) if (localStorage.getItem(a) !== v) localStorage.setItem(a, v); } catch (e) {}   // الأحدث المنقول يغلب القديم (توكن بونات)
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
          const pk = c.partitionKey && (c.partitionKey.topLevelSite || (typeof c.partitionKey === 'string' ? c.partitionKey : ''));
          if (pk) { o.partitionKey = pk; o.secure = true; if (o.sameSite !== 'None') o.sameSite = 'None'; }   // كوكي مقسّم (CHIPS) يلزمه Secure + SameSite=None
          if (o.sameSite === 'None' && !o.secure) o.sameSite = 'Lax';
          return o; });
        // الترتيب مهم: التخزين (مفتاح الدخول) أولاً ثم الكوكيز؛ وإلا تفتح الصفحة بلا مفتاح فتحذف كوكي الدخول (is_auth في بونات)
        let st = 0;
        for (const [origin, data] of Object.entries(site.storage || {})) SSTORE[origin] = data;
        await refreshInject();
        for (const [origin, data] of Object.entries(site.storage || {})) {
          const p = await ctx.newPage();
          try {
            await p.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await p.evaluate(d => { for (const [a, v] of Object.entries(d.local || {})) localStorage.setItem(a, v); for (const [a, v] of Object.entries(d.session || {})) sessionStorage.setItem(a, v); }, data);
            st++;
          } catch (e) { } finally { await p.close().catch(() => {}); }
        }
        let added = 0;
        for (const ck of cookies) { try { await ctx.addCookies([ck]); added++; } catch (e) { if (ck.partitionKey) { const c2 = Object.assign({}, ck); delete c2.partitionKey; try { await ctx.addCookies([c2]); added++; continue; } catch (e2) {} } console.log('cookie', k, ck.name, e.message.slice(0, 120)); } }
        if (k === 'bonat') { const now = (await ctx.cookies('https://store.bonat.io')).map(c => c.name); console.log('bonat sent', cookies.map(c => c.name + (c.url ? '@host' : '@' + c.domain) + ':' + c.expires).join(' '), '| now', now.join(',')); }
        out[k] = { cookies: added, of: cookies.length, storage: st };
      }
      for (const [host, val] of Object.entries(j.authHeaders || {})) { if (val && /^bearer /i.test(val)) { AUTHH[host] = val; out['auth:' + host] = 'ok'; } }
      try { fs.writeFileSync(SFILE, JSON.stringify(SSTORE)); } catch (e) {}
      try { fs.writeFileSync(AFILE, JSON.stringify(AUTHH)); } catch (e) {}
      await refreshInject();
      lastView = 0; setTimeout(() => poll(true), 3000);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, out }));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, err: String(e.message || e) })); }
  });
}

// ===== تمارا: قراءة التسوية والعمليات والفواتير من بوابة الشركاء بالجلسة المنقولة (لا واجهة رسمية للتسويات) =====
const TDIR = '/data/tamara'; try { fs.mkdirSync(TDIR, { recursive: true }); } catch (e) {}
function tamaraInvoiceParse(txt) {   // يقرأ الفاتورة الضريبية الشهرية (PDF→نص): الرقم، الفترة، الرسوم، الضريبة، الإجمالي
  const g = re => { const m = txt.match(re); return m ? m[1].trim() : null; };
  const num = v => v == null ? null : +String(v).replace(/,/g, '');
  const out = { invoice: g(/Invoice Number\s+(\d+)/), issued: g(/Invoice Issue Date\s+(\d{4}-\d{2}-\d{2})/), period: g(/Transaction Period\s+(\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2})/) };
  const tot = txt.match(/Total Amounts[\s\S]*?([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
  if (tot) Object.assign(out, { fees: num(tot[1]), taxable: num(tot[2]), vat: num(tot[3]), prepaid: num(tot[4]), total: num(tot[5]) });
  const lines = []; const re = /^\s*(.+?\/\s*\S+)\s+([\d,]+\.\d{2})\s+(\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/gm; let m;
  while ((m = re.exec(txt))) if (!/Total/i.test(m[1])) lines.push({ item: m[1].replace(/\s+/g, ' '), price: num(m[2]), qty: +m[3], fees: num(m[4]), vat: num(m[5]), total: num(m[6]) });
  if (lines.length) out.lines = lines;
  return out;
}
async function pdfText(file) { return new Promise(res => require('child_process').execFile('pdftotext', ['-layout', file, '-'], { maxBuffer: 5e6 }, (e, so) => res(e ? '' : String(so)))); }

async function tamaraDownloadRow(p, name, file) {   // يضغط زر التنزيل في صف الفاتورة ويلتقط الملف (حدث تنزيل أو نافذة جديدة)
  try {
    if (!/invoices\/list/.test(p.url())) { await p.goto('https://partners.tamara.co/#/invoices/list', { waitUntil: 'domcontentloaded', timeout: 30000 }); }
    const row = p.locator('tr', { hasText: name }).first(); await row.waitFor({ timeout: 15000 });
    const btn = row.locator('button, a').last();
    const popupP = ctx.waitForEvent('page', { timeout: 20000 }).catch(() => null);
    const dlP = p.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await btn.click();
    const dl = await dlP; if (dl) { await dl.saveAs(file); return true; }
    const pop = await popupP; if (pop) { const u = pop.url(); try { const resp = await ctx.request.get(u); if (resp.ok()) { fs.writeFileSync(file, await resp.body()); await pop.close().catch(() => {}); return true; } } catch (e) {} await pop.close().catch(() => {}); }
  } catch (e) { console.log('tamara dl', name, String(e.message || e).slice(0, 120)); }
  return false;
}
async function readTamara(from, to) {
  const out = { ok: false, at: new Date().toISOString() };
  if (!ctx) return Object.assign(out, { err: 'no-browser' });
  const p = await ctx.newPage(); const caught = {};
  p.on('response', async r => { const u = r.url(); if (!/partner-api\.tamara\.co\/merchants\//.test(u)) return; try { const j = await r.json(); const k = /invoices/.test(u) ? 'invoices' : /transaction/.test(u) ? 'transactions' : /settlement/.test(u) ? 'settlement' : null; if (k && !caught[k]) caught[k] = j; } catch (e) {} });
  const go = async (hash, key, ms) => { await p.goto('https://partners.tamara.co/' + hash, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}); for (let i = 0; i < (ms || 15000) / 500 && !caught[key]; i++) await p.waitForTimeout(500); };
  try {
    await go('#/invoices/list', 'invoices');
    if (!caught.invoices) { const url = p.url(), t = await p.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => ''); return Object.assign(out, { needLogin: true, err: /login|otp|تحقق|رمز/i.test(url + t) ? 'login' : 'no-data' }); }
    await go('#/transaction/list', 'transactions'); await go('#/settlement/information', 'settlement');
    out.ok = true; out.raw = { invoices: Object.keys(caught.invoices || {}), transactions: Object.keys(caught.transactions || {}), settlement: Object.keys(caught.settlement || {}) };
    // الفواتير: نبحث عن قائمة فيها اسم ملف/روابط
    const find = (o, d = 0) => { if (!o || d > 4) return null; if (Array.isArray(o) && o.length && typeof o[0] === 'object') return o; for (const v of Object.values(o)) if (typeof v === 'object') { const r = find(v, d + 1); if (r) return r; } return null; };
    const inv = find(caught.invoices) || []; out.invoices = inv.map(x => { const s = JSON.stringify(x); const name = (s.match(/MonthlyTaxInvoice_\d+|Invoice_\d+/) || [])[0]; const url = (s.match(/"(https?:[^"]+\.(?:pdf|xlsx)[^"]*)"/) || [])[1]; return { name, url, type: /Tax/.test(name || '') ? 'tax' : 'settlement', _: x }; });
    // الفاتورة الضريبية للفترة المطلوبة: الفاتورة التي فترتها داخل من/إلى (الاسم ينتهي بآخر يوم في الفترة)
    const want = out.invoices.filter(i => i.type === 'tax' && i.name && (() => { const d = i.name.slice(-8); const iso = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6); return iso >= from && iso <= to; })());
    out.taxInvoices = [];
    for (const i of want) {
      try {
        const file = TDIR + '/' + i.name + '.pdf'; const u = i.url;
        let ok = fs.existsSync(file);
        if (!ok && u) { const b = await p.evaluate(async u => { const r = await fetch(u, { credentials: 'include' }); if (!r.ok) throw new Error('http ' + r.status); return Array.from(new Uint8Array(await r.arrayBuffer())); }, u).catch(e => null); if (b) { fs.writeFileSync(file, Buffer.from(b)); ok = true; } }
        if (!ok) ok = await tamaraDownloadRow(p, i.name, file);   // الزر في الصفحة (تنزيل أو تبويب جديد)
        const parsed = ok ? tamaraInvoiceParse(await pdfText(file)) : { err: 'no-file' };
        out.taxInvoices.push(Object.assign({ name: i.name, file: ok ? file : null }, parsed));
      } catch (e) { out.taxInvoices.push({ name: i.name, err: String(e.message || e).slice(0, 120) }); }
    }
    out.fees = out.taxInvoices.reduce((a, i) => a + (i.fees || 0), 0); out.vat = out.taxInvoices.reduce((a, i) => a + (i.vat || 0), 0); out.feesTotal = out.taxInvoices.reduce((a, i) => a + (i.total || 0), 0);
    // العمليات داخل الفترة
    const tx = find(caught.transactions) || []; const inRange = tx.filter(t => { const s = JSON.stringify(t); const d = (s.match(/20\d{2}-\d{2}-\d{2}/) || [])[0]; return d && d >= from && d <= to; });
    out.transactions = { count: inRange.length, totalAll: tx.length, sample: inRange.slice(0, 3) };
    out.settlement = caught.settlement || null;
    out.invoices = out.invoices.map(i => ({ name: i.name, type: i.type, hasUrl: !!i.url, keys: Object.keys(i._ || {}) }));
  } catch (e) { out.err = String(e.message || e).slice(0, 160); }
  finally { await p.close().catch(() => {}); }
  return out;
}
// ===== مُجهّز تقرير «حساب»: سلة + بونات + تمارا لفترة، ويكتبه في live/hesab_report =====
async function buildReport(from, to, label, reqTs) {
  const rep = { at: new Date().toISOString(), from, to, label: label || '', reqTs: reqTs || 0, sources: {} };
  rep.sources.salla = await readSalla(from, to);
  let p; try { p = await ctx.newPage(); await p.goto('https://store.bonat.io/', { waitUntil: 'domcontentloaded', timeout: 30000 }); rep.sources.bonat = await readBonat(p, from, to); } catch (e) { rep.sources.bonat = { ok: false, err: String(e.message || e).slice(0, 120) }; } finally { if (p) await p.close().catch(() => {}); }
  try { rep.sources.tamara = await readTamara(from, to); } catch (e) { rep.sources.tamara = { ok: false, err: String(e.message || e).slice(0, 120) }; }
  if (GAS && KEY) await gas({ op: 'set', path: 'live/hesab_report', data: rep }).catch(e => console.log('gas', e.message));
  return rep;
}
let lastReqTs = 0, reportBusy = false;
async function checkReportReq() {   // التطبيق يكتب live/report_req أو live/cust_req؛ فحص واحد كل دقيقة لكليهما (حصّة Apps Script اليومية محدودة)
  if (reportBusy || !ctx || !GAS || !KEY) return; reportBusy = true;
  try {
    const r = await gas({ op: 'get', paths: ['live/report_req', 'live/cust_req'] });
    const d = r.docs && r.docs['live/report_req']; const q = d && d.data;
    if (q && q.ts && q.ts !== lastReqTs && q.from && q.to) { lastReqTs = q.ts; await buildReport(q.from, q.to, q.label || '', q.ts); }
    const c = r.docs && r.docs['live/cust_req']; const cq = c && c.data;
    if (cq && cq.ts && cq.ts !== lastCustReq && !custBusy) { lastCustReq = cq.ts; await syncCustomers(); }
  } catch (e) { } finally { reportBusy = false; }
}

// ===== العملاء: سحب كل عملاء بونات (بالجلسة) وسلة (بالواجهة الرسمية) إلى live/cust_* للتطبيق =====
const CHUNK = 7000;
function d10(x) { return x ? String(x).slice(0, 10) : ''; }
async function syncBonatCustomers() {
  const p = await ctx.newPage(); const out = { ok: false, n: 0, rows: [], segments: {} };
  try {
    await p.goto('https://store.bonat.io/customers', { waitUntil: 'domcontentloaded', timeout: 30000 });
    let page = 1, limit = 500, totalPages = 1;
    while (page <= totalPages && page < 400) {
      const r = await p.evaluate(async ([page, limit]) => {
        const u = 'https://dashboard-api.bonat.io/api/v3/customers?page=' + page + '&limit=' + limit + '&sort=' + encodeURIComponent('[{"lastVisit":"DESC"}]');
        const r = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } });
        const j = await r.json().catch(() => ({})); return { status: r.status, totalPages: j.totalPages, totalDocs: j.totalDocs, data: (j.data || []).map(c => [c.name || '', String(c.dialCode || '') + String(c.phoneNumber || ''), c.visitsCount || 0, c.pointsCount || 0, c.lastVisit ? String(c.lastVisit).slice(0, 10) : '', c.registeredSince ? String(c.registeredSince).slice(0, 10) : '', (c.segmentObj && (c.segmentObj.nameAr || c.segmentObj.nameEn)) || '', c.email || '', c.gender || '', c.birthday ? String(c.birthday).slice(0, 10) : '', c.rewardsRedeemed || 0]) };
      }, [page, limit]);
      if (r.status === 401 || r.status === 403) { out.needLogin = true; out.err = 'login'; return out; }
      if (r.status !== 200) { if (limit > 100) { limit = 100; continue; } out.err = 'http ' + r.status; return out; }
      totalPages = +r.totalPages || 1; out.total = +r.totalDocs || 0;
      for (const row of r.data) { out.rows.push(row); out.segments[row[6] || '?'] = (out.segments[row[6] || '?'] || 0) + 1; }
      page++;
    }
    out.n = out.rows.length; out.ok = out.n > 0;
  } catch (e) { out.err = String(e.message || e).slice(0, 160); }
  finally { await p.close().catch(() => {}); }
  return out;
}
async function syncSallaCustomers() {
  const out = { ok: false, n: 0, rows: [] };
  try {
    let page = 1, pages = 1;
    while (page <= pages && page < 300) {
      const j = await sallaApi('/admin/v2/customers?per_page=50&page=' + page);
      const pg = j.pagination || {}; pages = +pg.totalPages || +pg.total_pages || 1;
      for (const c of (j.data || [])) out.rows.push([(c.full_name || ((c.first_name || '') + ' ' + (c.last_name || ''))).trim(), String(c.mobile_code || '').replace('+', '') + String(c.mobile || ''), c.email || '', (c.city || ''), d10(c.updated_at && (c.updated_at.date || c.updated_at)), c.id, (c.groups || []).map(g => g.name || g).join('،')]);
      page++;
    }
    out.n = out.rows.length; out.ok = true;
  } catch (e) { out.err = String(e.message || e).slice(0, 160); }
  return out;
}
let custBusy = false;
async function syncCustomers() {
  if (custBusy || !ctx || !GAS || !KEY) return { err: 'busy' }; custBusy = true;
  const meta = { at: new Date().toISOString(), bonat: {}, salla: {} };
  try {
    const b = await syncBonatCustomers(); meta.bonat = { ok: b.ok, n: b.n, total: b.total || 0, err: b.err || null, needLogin: !!b.needLogin, segments: b.segments || {} };
    if (b.ok) { const chunks = []; for (let i = 0; i < b.rows.length; i += CHUNK) chunks.push(b.rows.slice(i, i + CHUNK));
      for (let i = 0; i < chunks.length; i++) await gas({ op: 'set', path: 'live/cust_bonat_' + (i + 1), data: { at: meta.at, i: i + 1, of: chunks.length, cols: ['name', 'phone', 'visits', 'points', 'lastVisit', 'since', 'segment', 'email', 'gender', 'birthday', 'rewards'], rows: chunks[i] } });
      meta.bonat.chunks = chunks.length; }
    const sl = await syncSallaCustomers(); meta.salla = { ok: sl.ok, n: sl.n, err: sl.err || null };
    if (sl.ok) await gas({ op: 'set', path: 'live/cust_salla', data: { at: meta.at, cols: ['name', 'phone', 'email', 'city', 'updated', 'id', 'groups'], rows: sl.rows } });
    await gas({ op: 'set', path: 'live/cust_meta', data: meta });
    console.log('customers', JSON.stringify({ b: meta.bonat.n, s: meta.salla.n }));
  } catch (e) { meta.err = String(e.message || e).slice(0, 160); }
  finally { custBusy = false; }
  return meta;
}
let lastCustReq = 0;
async function checkCustReq() {   // التطبيق يكتب live/cust_req فنحدّث القوائم
  if (custBusy || !ctx || !GAS || !KEY) return;
  try { const r = await gas({ op: 'get', paths: ['live/cust_req'] }); const d = r.docs && r.docs['live/cust_req']; const q = d && d.data; if (q && q.ts && q.ts !== lastCustReq) { lastCustReq = q.ts; await syncCustomers(); } } catch (e) { }
}
function dailyAt(h, fn) { const t = () => { const n = new Date(Date.now() + 3 * 3600e3); const ms = ((24 + h - n.getUTCHours() - 1) % 24) * 3600e3 + (60 - n.getUTCMinutes()) * 60e3; setTimeout(() => { fn(); t(); }, ms); }; t(); }

// ===== صندوق الفواتير: تخزين الملفات في /data/invoices وفهرس live/invoices، تصدير شهري ZIP للمحاسب =====
const IDIR = '/data/invoices'; try { fs.mkdirSync(IDIR, { recursive: true }); } catch (e) {}
const RELAY = (E.RELAY_URL || 'http://relay.railway.internal:8080').replace(/\/$/, '');
let invBusy = Promise.resolve();
function invQueue(fn) { invBusy = invBusy.then(fn, fn); return invBusy; }
async function invIndexAdd(rec) {   // يضيف/يحدّث سجلًا في live/invoices (آخر 15 شهرًا)
  return invQueue(async () => {
    let doc = { items: [] }; try { const r = await gas({ op: 'get', paths: ['live/invoices'] }); const d = r.docs && r.docs['live/invoices']; if (d && d.data && Array.isArray(d.data.items)) doc = d.data; } catch (e) {}
    const i = doc.items.findIndex(x => x.id === rec.id); if (i >= 0) doc.items[i] = Object.assign(doc.items[i], rec); else doc.items.push(rec);
    const cut = new Date(Date.now() - 460 * 864e5).toISOString(); doc.items = doc.items.filter(x => (x.at || '') >= cut).sort((a, b) => (b.date || b.at || '').localeCompare(a.date || a.at || ''));
    doc.at = new Date().toISOString(); doc.n = doc.items.length;
    await gas({ op: 'set', path: 'live/invoices', data: doc });
  });
}
function invExt(m) { return /pdf/i.test(m) ? 'pdf' : /png/i.test(m) ? 'png' : /webp/i.test(m) ? 'webp' : 'jpg'; }
function invFile(rec) { const ym = String(rec.date || rec.at || '').slice(0, 7) || 'unknown'; const d = IDIR + '/' + ym; try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} return d + '/' + rec.id + '.' + invExt(rec.mime); }
function readBody(req, max) { return new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > max) { req.destroy(); no(new Error('too-big')); } }); req.on('end', () => ok(b)); req.on('error', no); }); }
function cors(req, res) { const o = req.headers.origin || ''; if (/erihdev\.github\.io$|^https:\/\/dalksa\.com$/.test(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.setHeader('Access-Control-Expose-Headers', 'X-Dal-Doc'); } }
// ===== بوابة الموظفين: حسابات برموز PIN وصلاحيات لكل صفحة (يشوف/يعدّل)، تُفرض هنا على الخادم لا في المتصفح =====
const crypto2 = require('crypto');
// صفحات الموظفين والمستندات التي تقرؤها كل صفحة. «move» (حركة المخزون) يحتاج الحركات والوحدات وآخر جرد للرصيد وفهرس الفواتير (مختصر) للاستلام
const STAFF_PAGES = { roastx: ['roast_ext', 'docs_out'] };   // تطبيق الفريق الآن لتحميص العملاء فقط
const DOCS = require('./docs'); const XR = require('./xroast');   // تحميص العملاء (سلو والعملاء الخارجيين)   // المستندات المطبوعة: سجل الحركة / سند استلام / سند تسليم (PDF مرقّم)
// ===== مفاتيح الوحدات وحركة المخزون: الأساس مقفول على وحدة فودكس من count-items.json (نسخة مطابقة لملف التطبيق) =====
const DALU = require('./units-core');
let CITEMS = []; try { CITEMS = JSON.parse(fs.readFileSync(__dirname + '/count-items.json', 'utf8')).items || []; } catch (e) { console.log('count-items missing', e.message); }
const citem = s => CITEMS.find(i => i.s === s) || null;
async function notifyOwner(title, msg, tag) { if (!RELAY || !KEY) return false; try { const r = await fetch(RELAY + '/push/send', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dal-key': KEY }, body: JSON.stringify({ title, msg, lv: 'warn', tag }) }); return r.ok; } catch (e) { return false; } }
const loginHits = new Map();   // ip -> [timestamps]
const forgotHits = new Map();   // ip -> [timestamps] لطلبات «نسيت الرمز»
function staffToken(id, exp) { return id + '.' + exp + '.' + crypto2.createHmac('sha256', KEY).update(id + '|' + exp).digest('hex').slice(0, 40); }
function staffVerify(tok) { const [id, exp, sig] = String(tok || '').split('.'); if (!id || !exp || !sig) return null; if (+exp < Date.now()) return null; const ok = crypto2.timingSafeEqual(Buffer.from(sig), Buffer.from(crypto2.createHmac('sha256', KEY).update(id + '|' + exp).digest('hex').slice(0, 40))); return ok ? id : null; }
// إسقاط العميل لنسخة الموظف: بلا مبالغ (amount/price)، بلا تحويلات، بلا نص رسائل، بلا حقائق المالك؛ full = عنده صفحة العملاء (الرقم كاملًا والطلبات كميةً وحالةً)
const maskPhone = p => String(p || '').replace(/\D/g, '').replace(/^(\d{0,3})\d*(\d{3})$/, (m, a, b) => a + '•••••' + b);
function custStaff(x, full) {
  const o = { id: x.id, name: x.name, type: x.type };
  if (full) { o.phone = x.phone || ''; o.city = x.city; o.lastAt = x.lastAt; if (x.last && x.last.d) o.last = { d: x.last.d }; if (x.returning) o.returning = true; o.orders = (x.orders || []).map(r => ({ id: r.id, d: r.d, what: DOCS.scrubAmounts(r.what), kg: r.kg, st: r.st, src: r.src })); }   // بلا ملاحظات (قد تحمل أسعارًا)
  else o.phone_m = maskPhone(x.phone);
  return o;
}
async function staffList() { try { const r = await gas({ op: 'get', paths: ['live/staff'] }); const d = r.docs && r.docs['live/staff']; return (d && d.data && Array.isArray(d.data.users)) ? d.data.users : []; } catch (e) { return []; } }
async function staffLog(who, action, detail) { try { const r = await gas({ op: 'get', paths: ['live/staff_log'] }); const d = r.docs && r.docs['live/staff_log']; const L = (d && d.data && Array.isArray(d.data.items)) ? d.data.items : []; L.unshift({ t: new Date().toISOString(), who, action, detail: String(detail || '').slice(0, 160) }); await gas({ op: 'set', path: 'live/staff_log', data: { at: new Date().toISOString(), items: L.slice(0, 500) } }); } catch (e) {} }
function sha(s) { return crypto2.createHash('sha256').update(s).digest('hex'); }
let countBusy = Promise.resolve(); function countQueue(fn) { const p = countBusy.then(fn, fn); countBusy = p.catch(() => {}); return p; }
// مستند PDF مرقّم: {kind, params, lang} جديد (سجل حركة دائمًا رقم جديد؛ استلام/تسليم يأخذ رقم الحركة إن سبق ترقيمها) أو {no} إعادة طباعة. يرجع {no, pdf}
let LOGO_URI = null; try { LOGO_URI = 'data:image/png;base64,' + fs.readFileSync(__dirname + '/logo.png').toString('base64'); } catch (e) {}
// فهرس المستندات مقسّم بالسنة: يقرأ فهرس السنة (ويهيّئه من الفهرس القديم live/docs_out أول مرة) مع الفهرس القديم للقراءة المتوافقة، وأي مستندات أخرى مطلوبة
const CY = () => DOCS.yearOfAt(new Date().toISOString());
async function docsRead(year, extra) {
  const P = DOCS.docsPath(year); const r = await gas({ op: 'get', paths: [P, DOCS.LEGACY].concat(extra || []) }); const g = p => { const d = r.docs && r.docs[p]; return (d && d.data) || null; };
  const legacy = g(DOCS.LEGACY); const st = g(P) || DOCS.docsSeed(legacy, year); return { st, legacy, year, g, path: P, all: () => DOCS.docsMerge(st, legacy) };
}
async function docPdf(j, who) {
  const lang = j.lang === 'en' ? 'en' : 'ar'; const now = new Date().toISOString();
  return countQueue(async () => {
    const year = j.no ? (DOCS.yearOfNo(j.no) || CY()) : CY(); const X = await docsRead(year, ['live/moves', 'live/pending_items', 'live/invoices', 'live/roast_ext']); const g = n => X.g('live/' + n);
    const moves = g('moves') || { list: [] }; let docs = X.st; let item = null, reprint = false; const xdoc = XR.normalize(g('roast_ext') || {});
    const D = { moves, pending_items: g('pending_items') || { items: [] }, invoices: g('invoices') || { items: [] }, items: CITEMS, roast_ext: xdoc };
    if (j.no) { item = DOCS.docsFind(docs, X.legacy, String(j.no)); if (!item) throw new Error('nf'); reprint = true; }
    else { const kind = String(j.kind || ''); if (!DOCS.KINDS[kind]) throw new Error('kind'); const params = DOCS.pickParams(kind, j.params); DOCS.build(kind, params, D, lang);   // حقول معروفة فقط تُحفظ في الفهرس (لا نص حر طويل)؛ البناء أولًا حتى لا يُستهلك رقم لمستند لا يُبنى
      const mv = params.move && (moves.list || []).find(x => x.id === params.move); if (mv && mv.doc) { item = DOCS.docsFind(docs, X.legacy, mv.doc); reprint = !!item; }
      const xr = params.x && xdoc.list.find(x => x.id === params.x); if (xr && xr.doc) { item = DOCS.docsFind(docs, X.legacy, xr.doc); reprint = !!item; }
      if (!item && xr) { const da = DOCS.docAdd(docs, kind, params, who, now, { cust: xr.cust.id, name: xr.cust.name, coffee: xr.coffee }); docs = da.st; item = da.item; xr.doc = item.no; xdoc.at = now; await gas({ op: 'set', path: 'live/roast_ext', data: xdoc }); await gas({ op: 'set', path: X.path, data: docs }); }
      if (!item) { const ref = kind === 'mov' ? { from: params.from, to: params.to, item: params.item, sup: params.sup, cust: params.cust, loc: params.loc } : mv ? (mv.sup ? { sup: mv.sup.id, name: mv.sup.name, item: mv.s } : mv.cust ? { cust: mv.cust.id, name: mv.cust.name, item: mv.s } : kind === 'trf' ? Object.assign({ item: mv.s }, DALU.locs(mv, moves.list)) : { item: mv.s }) : { inv: params.inv };
        const da = DOCS.docAdd(docs, kind, params, who, now, ref); docs = da.st; item = da.item; if (mv) { mv.doc = item.no; moves.at = now; await gas({ op: 'set', path: 'live/moves', data: moves }); } await gas({ op: 'set', path: X.path, data: docs }); } }
    let sigs = item.sigs || []; if (sigs.length) { const rs = await gas({ op: 'get', paths: [DOCS.sigsPath(DOCS.yearOfNo(item.no) || year)] }); const sd = rs.docs && rs.docs[DOCS.sigsPath(DOCS.yearOfNo(item.no) || year)]; sigs = DOCS.sigMerge(item, (sd && sd.data) || null).sigs; }
    const doc = DOCS.docData(item, D, lang);   // مستند موقّع: من النسخة المجمّدة عند التوقيع؛ وإلا من البيانات الحية
    const pdf = await DOCS.renderPdf(DOCS.html(doc, { no: item.no, by: who, printedAt: now, reprint, logo: LOGO_URI, sigs }, lang));   // إعادة الطباعة تحمل التواقيع دائمًا
    await staffLog(who, 'doc', (reprint ? 'إعادة طباعة ' : 'طباعة ') + item.no); return { no: item.no, pdf, item };
  });
}
// توقيع إلكتروني على مستند: {no, role, name, png} أو (المالك فقط) {kind:'mov', params, adj, role:'appr', name, png} يُنشئ سجل الحركة ثم يوقّعه ويعلّم فرق الجرد adj بالرقم.
// يرجع {item (سجل المستند كاملًا), sig}. الأخطاء: nf 404 | role/png/name/params 400 | forbidden 403 | dup 409
async function docSign(j, who, by, ua, owner, kinds) {
  const now = new Date().toISOString();
  return countQueue(async () => {
    let no = String(j.no || ''); const year = no ? (DOCS.yearOfNo(no) || CY()) : CY(); const X = await docsRead(year, ['live/moves', 'live/pending_items', 'live/invoices', 'live/roast_ext', DOCS.sigsPath(year)]); const g = n => X.g('live/' + n);
    let docs = X.st; let moves = null; const D = { moves: g('moves') || { list: [] }, pending_items: g('pending_items') || { items: [] }, invoices: g('invoices') || { items: [] }, items: CITEMS, roast_ext: XR.normalize(g('roast_ext') || {}) };
    if (kinds) { const it0 = DOCS.docsFind(docs, X.legacy, no); if (!it0 || !kinds.includes(it0.kind)) throw new Error('forbidden'); }   // موظف تحميص العملاء يوقّع سندات العملاء فقط
    if (!no && j.kind === 'mov') { if (!owner) throw new Error('forbidden'); const params = DOCS.pickParams('mov', j.params); DOCS.build('mov', params, D, 'ar');   // يتحقق من التواريخ قبل الترقيم
      const adj = j.adj ? String(j.adj).slice(0, 40) : ''; const da = DOCS.docAdd(docs, 'mov', params, who, now, Object.assign({ from: params.from, to: params.to, item: params.item }, adj ? { adj } : {})); docs = da.st; no = da.item.no;
      if (adj) { moves = D.moves; const i = (moves.list || []).findIndex(x => x.id === adj && x.t === 'adj'); if (i < 0) throw new Error('nf'); moves.list = moves.list.slice(); moves.list[i] = Object.assign({}, moves.list[i], { appr: no }); moves.at = now; } }
    // مستند من الفهرس القديم لم يُنقل بعد: يُنقل إلى فهرس سنته قبل التوقيع (الفهرس القديم يبقى كما هو للقراءة)
    if (!(docs.items || []).some(x => x.no === no)) { const old = DOCS.docsFind(null, X.legacy, no); if (!old) throw new Error('nf'); docs = Object.assign({}, docs, { items: [old].concat(docs.items || []) }); }
    // أول توقيع يجمّد المحتوى المعروض: الطباعة بعده من هذه النسخة لا من البيانات الحية
    const i0 = docs.items.findIndex(x => x.no === no); if (!(docs.items[i0].sigs || []).length && !docs.items[i0].snap) { docs = Object.assign({}, docs, { items: docs.items.slice() }); docs.items[i0] = Object.assign({}, docs.items[i0], { snap: DOCS.snapOf(docs.items[i0], D) }); }
    const o = DOCS.sigAdd(docs, no, j, who, by, ua, now, owner); const SP = DOCS.sigsPath(o.year); const sd = DOCS.sigsPut(X.g(SP), no, o.sig, now);
    await gas({ op: 'set', path: SP, data: sd }); await gas({ op: 'set', path: X.path, data: o.st }); if (moves) await gas({ op: 'set', path: 'live/moves', data: moves });   // الصورة أولًا: فهرس بلا صورة أهون من صورة بلا فهرس
    await staffLog(who, 'sign', o.item.no + ' ' + o.sig.role + ' ' + o.sig.name + ' ' + o.sig.hash.slice(0, 10)); return { item: DOCS.sigMerge(o.item, sd), sig: o.sig };
  });
}
const SIGN_CODE = { nf: 404, dup: 409, forbidden: 403, role: 400, png: 400, name: 400, params: 400, kind: 400 };
async function staffRoute(req, res) {   // كل مسارات /staff/* ؛ ترجع true إذا عالجت الطلب
  cors(req, res);
  const u = new URL(req.url, 'http://x'); const path = u.pathname; const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
  if (path === '/staff/login' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''; const now = Date.now(); const h = (loginHits.get(ip) || []).filter(t => now - t < 3600e3); if (h.length >= 12) return json(429, { ok: false, err: 'محاولات كثيرة، انتظر ساعة' }); h.push(now); loginHits.set(ip, h);
    try { const j = JSON.parse(await readBody(req, 1e5) || '{}'); const users = await staffList(); const uu = users.find(x => x.id === j.id && x.active !== false); if (!uu || !j.pin || sha(uu.salt + ':' + String(j.pin)) !== uu.pin) return json(401, { ok: false, err: 'الرمز غير صحيح' });
      const exp = now + 30 * 864e5; await staffLog(uu.name, 'login', ''); return json(200, { ok: true, token: staffToken(uu.id, exp), user: { id: uu.id, name: uu.name, roles: uu.roles || {} } }); } catch (e) { return json(400, { ok: false, err: 'bad' }); }
  }
  if (path === '/staff/users' && req.method === 'GET') { const users = await staffList(); return json(200, { ok: true, users: users.filter(x => x.active !== false).map(x => ({ id: x.id, name: x.name })) }); }   // أسماء فقط لشاشة الدخول
  if (path === '/staff/forgot' && req.method === 'POST') {   // نسيت الرمز: يُسجَّل طلب للمالك (live/staff_pinreq) ويصله إشعار؛ المالك يصدر رمزًا جديدًا من صفحة المستخدمين. لا رمز يُرسل آليًا.
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''; const now = Date.now(); const h = (forgotHits.get(ip) || []).filter(t => now - t < 3600e3); if (h.length >= 5) return json(429, { ok: false, err: 'many' }); h.push(now); forgotHits.set(ip, h);
    try { const j = JSON.parse(await readBody(req, 1e4) || '{}'); const users = await staffList(); const uu = users.find(x => x.id === j.id && x.active !== false); if (!uu) return json(404, { ok: false, err: 'user' });
      const r = await gas({ op: 'get', paths: ['live/staff_pinreq'] }).catch(() => ({})); const d = r.docs && r.docs['live/staff_pinreq']; const items = (d && d.data && Array.isArray(d.data.items)) ? d.data.items : [];
      const prev = items.find(x => x.id === uu.id); if (prev && now - Date.parse(prev.at) < 10 * 60e3) return json(200, { ok: true, again: true });   // طلب قائم خلال 10 دقائق: لا تكرار للإشعار
      const nowIso = new Date(now).toISOString(); const next = items.filter(x => x.id !== uu.id).concat([{ id: uu.id, name: uu.name, at: nowIso }]).slice(-50);
      await gas({ op: 'set', path: 'live/staff_pinreq', data: { at: nowIso, items: next } }); await staffLog(uu.name, 'forgot', ''); await notifyOwner('نسي الرمز', uu.name + ' يطلب رمز دخول جديد · ' + DOCS.fmtDay(nowIso, 'ar').full + ' — أصدره من «فريق العمل» وأرسله له', 'pinreq-' + uu.id);
      return json(200, { ok: true }); } catch (e) { return json(400, { ok: false, err: 'bad' }); }
  }
  const id = staffVerify((req.headers.authorization || '').replace(/^Bearer /i, '')); if (!id) return json(401, { ok: false, err: 'login' });
  const users = await staffList(); const me = users.find(x => x.id === id && x.active !== false); if (!me) return json(401, { ok: false, err: 'disabled' });
  const roles = Object.assign({}, me.roles || {});
  const can = (page, lvl) => roles[page] === 'edit' || (lvl === 'view' && roles[page] === 'view');
  if (path === '/staff/me') return json(200, { ok: true, user: { id: me.id, name: me.name, roles } });
  if (path === '/staff/docs' && req.method === 'GET') {   // قراءة المستندات المسموحة فقط
    const want = String(u.searchParams.get('names') || '').split(',').filter(Boolean); const allowed = new Set(); for (const [pg, docs] of Object.entries(STAFF_PAGES)) if (pg === '_any' || can(pg, 'view')) docs.forEach(d => allowed.add(d));   // _any: تنبيهات الحد الأدنى لكل موظف داخل
    const names = want.filter(n => allowed.has(n)); if (!names.length) return json(403, { ok: false, err: 'forbidden' });
    const YRS = [CY(), String(+CY() - 1)];   // قائمة المستندات: فهرس هذه السنة والسنة الماضية + الفهرس القديم (مدمجة تحت الاسم docs_out نفسه، فهرس السنة يغلب)
    try { const r = await gas({ op: 'get', paths: names.filter(n => n !== 'staff_names').map(n => 'live/' + n).concat(names.includes('docs_out') ? YRS.map(DOCS.docsPath) : []) }); const out = {}; for (const n of names) { const d = r.docs && r.docs['live/' + n]; out[n] = d ? d.data : null; }
      if (names.includes('docs_out')) { const yd = YRS.map(y => { const d = r.docs && r.docs[DOCS.docsPath(y)]; return d && d.data ? d.data : null; }); const L = DOCS.docsMerge({ items: DOCS.docsMerge(yd[0] || DOCS.docsSeed(out.docs_out, YRS[0]), yd[1]) }, out.docs_out); out.docs_out = L.length || out.docs_out ? { items: L } : null; } if (out.crm_state) out.crm_state = { tpl: out.crm_state.tpl || {}, opt: out.crm_state.opt || {}, tag: out.crm_state.tag || {}, sent: out.crm_state.sent || {} };
      if (names.includes('staff_names')) out.staff_names = { users: users.filter(x => x.active !== false).map(x => ({ id: x.id, name: x.name, roles: Object.keys(x.roles || {}).filter(k => x.roles[k]) })) };   // أسماء الفريق وصفحاتهم لبطاقة المحمصة، بلا رموز
      // قائمة العملاء: الموظف لا يرى مبالغ ولا تحويلات ولا نص الرسائل أبدًا. مع صفحة العملاء: الرقم كاملًا والطلبات (كمية وحالة فقط)؛ بدونها (التسليم في حركة المخزون): الاسم والنوع ورقم مقنّع فقط
      if (out.customers) { const full = can('customers', 'view'); out.customers = { list: (out.customers.list || []).map(x => custStaff(x, full)) }; }
      // فهرس الفواتير لمن ليس عنده صفحة الفواتير (الاستلام في حركة المخزون): بلا مبالغ، فقط المورد والتاريخ والرقم ووصف الأصناف (مع حذف أي مبلغ ورد في الوصف)
      if (out.invoices && !can('invoices', 'view')) out.invoices = { items: (out.invoices.items || []).map(x => ({ id: x.id, at: x.at, date: x.date, supplier: x.supplier, invoice_no: x.invoice_no, items: DOCS.scrubAmounts(x.items), from: x.from, status: x.status })) };
      if (names.includes('roast_ext')) out.roast_ext = XR.normalize(out.roast_ext || {});   // تحميص العملاء: الهيكل الموحّد (العملاء + السجل)، بلا أسعار أصلاً
      if (out.suppliers) out.suppliers = { list: (out.suppliers.list || []).map(x => ({ id: x.id, name: x.name })) };   // أسماء الموردين فقط، بلا أسعار ولا فواتير
      if (out.docs_out) out.docs_out = Object.assign({}, out.docs_out, { items: (out.docs_out.items || []).filter(x => x.kind === 'xrc' || x.kind === 'xdl').map(x => DOCS.sigStrip(x, null)) });   // بلا صلاحية الحركة: سندات العملاء فقط   // التواقيع: الأسماء والبصمات فقط، بلا صور (الصور في مخزن منفصل) وبلا النسخة المجمّدة
      if (out.stock) out.stock = Object.assign({}, out.stock, { items: (out.stock.items || []).map(x => ({ id: x.id, name: x.name, o: x.o, st: x.st, q: x.q, n: x.n })) });   // المحاصيل بلا أسعار شراء أو بيع (live/stock يحمل sell/buys للمالك)
      return json(200, { ok: true, docs: out }); } catch (e) { return json(500, { ok: false, err: 'db' }); }
  }
  if (path === '/staff/sign' && req.method === 'POST') {   // توقيع إلكتروني {no, role, name, png}: صلاحية الحركة (تعديل) لسندات الاستلام/التسليم؛ «اعتماد» للمالك فقط (403 هنا دائمًا)
    if (!can('roastx', 'edit')) return json(403, { ok: false, err: 'forbidden' });
    try { const j = JSON.parse(await readBody(req, 2e5) || '{}'); if (!j.no) return json(400, { ok: false, err: 'no' }); const o = await docSign(j, me.name, me.id, req.headers['user-agent'], false, ['xrc', 'xdl']);
      return json(200, { ok: true, doc: DOCS.sigStrip(o.item, me.id), sig: { role: o.sig.role, name: o.sig.name, at: o.sig.at, hash: o.sig.hash } }); }
    catch (e) { return json(e.message === 'too-big' ? 413 : SIGN_CODE[e.message] || 500, { ok: false, err: String(e.message || e) }); } }
  if (path === '/staff/doc' && req.method === 'POST') {   // مستند PDF: {kind:'mov'|'rec'|'dlv'|'trf', params, lang} يُرقَّم ويُفهرس، أو {no} لإعادة طباعة مستند بالرقم نفسه
    if (!can('roastx', 'view')) return json(403, { ok: false, err: 'forbidden' });
    try { const j = JSON.parse(await readBody(req, 1e5) || '{}'); if (!(j.no ? /^X(RC|DL)-/.test(String(j.no)) : (j.kind === 'xrc' || j.kind === 'xdl'))) return json(403, { ok: false, err: 'forbidden' }); const out = await docPdf(j, me.name); res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + out.no + '.pdf"', 'X-Dal-Doc': out.no }); res.end(out.pdf); return true; }
    catch (e) { return json(e.message === 'nf' || e.message === 'kind' || e.message === 'params' ? 400 : 500, { ok: false, err: String(e.message || e) }); } }
  if (path === '/staff/xroast' && req.method === 'POST') {   // تحميص العملاء: {op:'cust', name} | {op:'add', t:'in'|'roast'|'out', cust, coffee, g, r, kg, sacks, bags, n} | {op:'del', id}. استلام/تسليم يأخذ سنداً مرقّماً (XRC/XDL) تلقائياً
    if (!can('roastx', 'edit')) return json(403, { ok: false, err: 'forbidden' });
    try { const j = JSON.parse(await readBody(req, 2e4) || '{}'); return await countQueue(async () => {
      const DP = DOCS.docsPath(CY()); const r = await gas({ op: 'get', paths: ['live/roast_ext', 'live/docs_out', DP] }); const g = n => { const d = r.docs && r.docs[n]; return (d && d.data) || null; }; const now = new Date().toISOString();
      const docsY = g(DP) || DOCS.docsSeed(g('live/docs_out'), CY()); const signed = no => DOCS.isSigned(docsY, no) || DOCS.isSigned(g('live/docs_out'), no);
      const o = XR.apply(g('live/roast_ext'), j, me.name, now, { signed }); let docItem = null, docsOut = null;
      if (j.op === 'add' && (o.rec.t === 'in' || o.rec.t === 'out')) { const kind = o.rec.t === 'in' ? 'xrc' : 'xdl'; const da = DOCS.docAdd(docsY, kind, { x: o.rec.id }, me.name, now, { cust: o.rec.cust.id, name: o.rec.cust.name, coffee: o.rec.coffee }); o.rec.doc = da.item.no; docItem = da.item; docsOut = da.st; }
      if (docsOut) await gas({ op: 'set', path: DP, data: docsOut }); await gas({ op: 'set', path: 'live/roast_ext', data: o.st });
      if (o.rec) { await staffLog(me.name, 'roastx', (j.op === 'del' ? 'حذف: ' : '') + XR.describe(o.rec) + (o.rec.doc ? ' ' + o.rec.doc : '')); if (j.op === 'add' && o.rec.t !== 'roast') notifyOwner('تحميص العملاء', me.name + ': ' + XR.describe(o.rec), 'xroast-' + o.rec.id).catch(() => {}); } else if (o.cust) await staffLog(me.name, 'roastx', 'عميل جديد ' + o.cust.name);
      return json(200, { ok: true, log: o.st, rec: o.rec || null, cust: o.cust || null, doc: docItem, docs_out: docsOut ? { items: DOCS.docsMerge(docsOut, g('live/docs_out')).map(x => DOCS.sigStrip(x, null)) } : undefined }); }); }
    catch (e) { return json(e.message === 'signed' ? 409 : e.message === 'today' ? 403 : 400, { ok: false, err: String(e.message || e) }); } }
  if (path === '/staff/log' && req.method === 'POST') { try { const j = JSON.parse(await readBody(req, 1e5) || '{}'); await staffLog(me.name, String(j.action || 'note').slice(0, 30), j.detail); return json(200, { ok: true }); } catch (e) { return json(400, { ok: false }); } }
  return json(404, { ok: false, err: 'no' });
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
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: !!ctx, at: state.at, salesAt: SALES.at, needLogin: state.needLogin || [], vnc: VNC, fx: FX.status(), retm: { live: !!RL.page, at: RL.at, evAt: RL.evAt, evs: RL.evs, n: RL.n, err: RL.err }, sf: (() => { const s = SF.status(); return { linked: s.linked, hasClient: s.hasClient, at: s.at, err: s.err, mapped: s.mapped, counts: s.counts }; })() })); }   // fcounts: حالة قارئ الجرد (مسارات ومفاتيح فقط، بلا بيانات)
  if (req.url.startsWith('/salla/callback')) {   // عودة تفويض سلة (عامة): نبادل الكود بتوكن ونخزّنه
    return (async () => {
      try {
        const u = new URL(req.url, 'http://x'); const code = u.searchParams.get('code'); if (!code) throw new Error('no-code');
        await sallaExchange({ grant_type: 'authorization_code', code, redirect_uri: E.SALLA_REDIRECT || 'https://browser-production-10fb.up.railway.app/salla/callback' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<meta charset=utf-8><body style="font-family:sans-serif;direction:rtl;text-align:center;padding:40px;background:#FFF7F0"><h2>✅ تم ربط سلة بنجاح</h2><p>أغلق هذه الصفحة وارجع للمحادثة.</p></body>');
      } catch (e) { res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<meta charset=utf-8><body style="font-family:sans-serif;direction:rtl;text-align:center;padding:40px"><h2>تعذّر الربط</h2><p>' + String(e.message || e) + '</p></body>'); }
    })();
  }
  if (req.url.startsWith('/foodics/callback') || req.url.startsWith('/foodics/webhook')) { SF.route(req, res, false).catch(() => { try { res.writeHead(500); res.end(); } catch (e) {} }); return; }   // عودة تفويض فودكس (عامة)
  if (req.url.startsWith('/salla/webhook')) {   // مستقبِل أحداث سلة (عام): نقبل ونخزّن آخر حدث
    let b = ''; req.on('data', c => { b += c; if (b.length > 2e6) req.destroy(); });
    req.on('end', () => { try { const j = JSON.parse(b || '{}'); const dt = j && j.data; if (j && /order/i.test(j.event || '')) SF.schedule(20e3); if (j && /menu|product|inventory/i.test(j.event || '')) FX.kick(); if (j && /authorize/i.test(j.event || '') && dt && dt.access_token && dt.refresh_token) { const exp = dt.expires && +dt.expires > 1e11 ? +dt.expires : Date.now() + (+dt.expires || 1209600) * 1000; SOAUTH = { access: dt.access_token, refresh: dt.refresh_token, exp, at: Date.now() }; try { fs.writeFileSync(SOFILE, JSON.stringify(SOAUTH)); console.log('salla token via webhook, refresh ok'); } catch (e) {} } } catch (e) {} res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
    return;
  }
  if (req.method === 'POST' && req.url === '/invoice/ingest') {   // من الناقل: ملف + سجل مفحوص (محمي بمفتاح)
    return (async () => { try { if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); } const j = JSON.parse(await readBody(req, 25e6) || '{}'); const rec = j.rec; if (!rec || !rec.id) throw new Error('bad'); if (j.b64) fs.writeFileSync(invFile(rec), Buffer.from(j.b64, 'base64')); await invIndexAdd(rec); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, err: String(e.message || e) })); } })();
  }
  if (req.method === 'GET' && /^\/relay\/(health|debug\/(hist|who))(\?|$)/.test(req.url)) {   // قراءة حالة الناقل وتشخيصه (بمفتاح)
    return (async () => { try { if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); } const r = await fetch(RELAY + req.url.slice(6), { headers: { 'x-dal-key': KEY } }); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(await r.text()); } catch (e) { res.writeHead(500); res.end(String(e.message || e)); } })();
  }
  if (req.method === 'POST' && /^\/relay\/gfiles\/backfill(\?|$)/.test(req.url)) {   // قراءة ملفات قروب سابقة عبر الناقل (بمفتاح)
    return (async () => { try { if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); } const r = await fetch(RELAY + req.url.slice(6), { method: 'POST', headers: { 'x-dal-key': KEY } }); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(await r.text()); } catch (e) { res.writeHead(500); res.end(String(e.message || e)); } })();
  }
  if (req.method === 'POST' && req.url === '/relay/gfiles/ingest') {   // ملف من تصدير محادثة إلى الناقل (بمفتاح)
    return (async () => { try { if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); } const b = await readBody(req, 40e6); const r = await fetch(RELAY + '/gfiles/ingest', { method: 'POST', headers: { 'x-dal-key': KEY, 'content-type': 'application/json' }, body: b }); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(await r.text()); } catch (e) { res.writeHead(500); res.end(String(e.message || e)); } })();
  }
  if (req.method === 'POST' && req.url === '/push/test') {   // تجربة إشعار عبر الناقل (بمفتاح)
    return (async () => { try { if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); } const r = await fetch(RELAY + '/push/test', { method: 'POST', headers: { 'x-dal-key': KEY } }); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(await r.text()); } catch (e) { res.writeHead(500); res.end(String(e.message || e)); } })();
  }
  if (req.method === 'POST' && req.url === '/mail') {   // من سكربت Gmail في حساب المحمصة (بمفتاح) → الناقل: مهام يومية + إشعار
    return (async () => { try { if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); } const b = await readBody(req, 1e6); const r = await fetch(RELAY + '/mail', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dal-key': KEY }, body: b }); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(await r.text()); } catch (e) { res.writeHead(500); res.end(String(e.message || e)); } })();
  }
  if (req.method === 'POST' && req.url === '/wa/media/ingest') {   // من الناقل: مرفق رسالة واتساب خاصة (محمي بمفتاح)
    return (async () => { try { if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); }
      const j = JSON.parse(await readBody(req, 30e6) || '{}'); const id = String(j.id || '').replace(/[^a-f0-9]/g, ''); if (id.length < 24 || !j.b64) throw new Error('bad');
      fs.mkdirSync(WMDIR, { recursive: true }); fs.writeFileSync(WMDIR + '/' + id, Buffer.from(j.b64, 'base64')); fs.writeFileSync(WMDIR + '/' + id + '.json', JSON.stringify({ mime: String(j.mime || 'application/octet-stream').slice(0, 100), name: String(j.name || '').slice(0, 150), at: Date.now() }));
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); } catch (e) { res.writeHead(500); res.end(String(e.message || e)); } })();
  }
  if (req.method === 'GET' && req.url.startsWith('/wa/m/')) {   // عرض المرفق برابط سري عشوائي (للتطبيق فقط)
    const id = (req.url.split('/')[3] || '').split('?')[0].replace(/[^a-f0-9]/g, ''); let meta = null;
    try { meta = JSON.parse(fs.readFileSync(WMDIR + '/' + id + '.json', 'utf8')); } catch (e) {}
    if (id.length < 24 || !meta) { res.writeHead(404); return res.end('no'); }
    res.writeHead(200, { 'Content-Type': meta.mime, 'Cache-Control': 'private, max-age=604800', 'Access-Control-Allow-Origin': '*', 'Content-Disposition': 'inline' + (meta.name ? "; filename*=UTF-8''" + encodeURIComponent(meta.name) : '') });
    return fs.createReadStream(WMDIR + '/' + id).pipe(res);
  }
  if (req.url.startsWith('/staff/')) { staffRoute(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch (e) {} }); return; }
  if (req.method === 'OPTIONS') { cors(req, res); res.writeHead(204); return res.end(); }
  if (!authed(req)) {
    if (req.url === '/import') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, err: 'الرمز غير صحيح' })); }   // بلا نافذة دخول حتى لا تعلق الإضافة
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dal"' }); return res.end('auth'); }
  res.setHeader('Set-Cookie', 'dalv=' + TOK + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000');
  if (req.url === '/' || req.url === '') { res.writeHead(302, { Location: '/vnc.html?autoconnect=1&resize=scale&reconnect=1&quality=5&compression=7&show_dot=1&path=websockify' }); return res.end(); }
  if (req.method === 'POST' && req.url === '/import') return importSessions(req, res);
  if (req.url === '/poll') { poll(true); res.writeHead(200); return res.end('ok'); }
  if (req.url === '/salla/status') {   // هل سلة مربوطة؟
    return (async () => { let ok = false, err = null; try { await sallaToken(); ok = true; } catch (e) { err = String(e.message || e); } res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ linked: !!(SOAUTH && SOAUTH.refresh), tokenOk: ok, err, hasClientId: !!E.SALLA_CLIENT_ID })); })();
  }

  cors(req, res);
  if (req.url.startsWith('/foodics/')) { SF.route(req, res, true).catch(e => { try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, err: String(e.message || e) })); } catch (x) {} }); return; }   // جسر سلة → فودكس (المالك)
  if (req.url.startsWith('/customers/sync')) { return (async () => { const m = await syncCustomers(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(m, null, 1)); })(); }
  if (req.url.startsWith('/report')) {   // تجهيز تقرير «حساب» عن فترة (سلة + بونات)
    return (async () => {
      try {
        const u = new URL(req.url, 'http://x'); let from = u.searchParams.get('from'), to = u.searchParams.get('to');
        if (!from || !to) { const r = prevMonth(); from = r.from; to = r.to; }
        const rep = await buildReport(from, to, u.searchParams.get('label') || '', 0);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(rep, null, 1));
      } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, err: String(e.message || e) })); }
    })();
  }
  proxy.web(req, res);
});
srv.on('upgrade', (req, sock, head) => { if (!authed(req)) return sock.destroy(); viewers++; lastView = Date.now(); sock.on('close', () => { viewers = Math.max(0, viewers - 1); lastView = Date.now(); }); proxy.ws(req, sock, head); });
// ===== جرد فودكس: يقرأ آخر عمليات الجرد من كونسول فودكس (جلسة المتصفح، قراءة فقط) → live/foodics_counts للمالك، وإشعار عند جرد جديد =====
const SF = require('./salla_foodics')({ E, fs, gas: (GAS && KEY) ? gas : null, notifyOwner, sallaApi, readBody });
// شاشة المتصفح (noVNC): فحص المنافذ كل دقيقة وإعادة تشغيل x11vnc/websockify إن سقطا
const VNC = { vnc: null, ws: null, at: null, fixed: 0 };
function portUp(port) { return new Promise(ok => { const c = require('net').connect(port, '127.0.0.1'); const t = setTimeout(() => { c.destroy(); ok(false); }, 2000); c.on('connect', () => { clearTimeout(t); c.end(); ok(true); }); c.on('error', () => { clearTimeout(t); ok(false); }); }); }
async function vncCheck() {
  const { spawn } = require('child_process'); VNC.vnc = await portUp(5900); VNC.ws = await portUp(6080); VNC.at = new Date().toISOString();
  if (!VNC.vnc) { VNC.fixed++; spawn('x11vnc', ['-display', ':99', '-localhost', '-forever', '-shared', '-nopw', '-quiet', '-rfbport', '5900', '-xkb', '-noxdamage', '-wait', '20', '-defer', '20'], { detached: true, stdio: 'ignore', env: Object.assign({}, process.env, { DISPLAY: ':99' }) }).unref(); }
  if (!VNC.ws) { VNC.fixed++; spawn('websockify', ['--web', '/usr/share/novnc', '127.0.0.1:6080', '127.0.0.1:5900'], { detached: true, stdio: 'ignore' }).unref(); }
}
setTimeout(vncCheck, 20e3); setInterval(vncCheck, 60e3);
const FX = require('./foodics_live')({ E, gas: (GAS && KEY) ? gas : null, getCtx: () => ctx, viewing: () => viewers > 0 || Date.now() - lastView < 60e3 });   // أرقام فودكس لحظية (الكونسول كل 30 ثانية، المحاسبي كل 10 دقائق)   // جسر سلة → فودكس

if (require.main !== module) { module.exports = { STAFF_PAGES, DOCS, XR, docPdf, docSign, docsRead, srv, SF }; } else {
srv.listen(+E.PORT || 8080, E.HOST || '::', () => console.log('view up'));
launch().then(() => { SF.start(); FX.start(); setTimeout(retmLive, 45e3); setTimeout(poll, 60e3); setInterval(poll, POLL); setTimeout(() => { fastSales(); setInterval(fastSales, FAST); }, 150e3); setInterval(checkReportReq, 60e3); dailyAt(4, syncCustomers); dailyAt(5, () => { try { for (const f of fs.readdirSync(WMDIR)) if (f.endsWith('.json')) { const m = JSON.parse(fs.readFileSync(WMDIR + '/' + f, 'utf8')); if (Date.now() - m.at > 45 * 864e5) { fs.rmSync(WMDIR + '/' + f, { force: true }); fs.rmSync(WMDIR + '/' + f.slice(0, -5), { force: true }); } } } catch (e) {} }); }).catch(e => { console.error(e); process.exit(1); });
}
