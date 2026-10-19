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
const FAST = Math.max(30, +E.FAST_SEC || 60) * 1000, FAST_K = ['foodics', 'retm'];   // أرقام المبيعات كل دقيقة
const SITES = [
  { k: 'foodics', name: 'فودكس', url: 'https://console.foodics.com/', login: /login|auth|signin/i },
  { k: 'retm', name: 'رتم', url: 'https://retm.sa/dashboard?period=1', login: /login|signin/i },
  { k: 'bonat', name: 'بونات', url: 'https://store.bonat.io/', login: /login|signin/i },
  { k: 'olu', name: 'علو', url: 'https://hr.olu.sa/', login: /login|signin/i, noText: true },
  // تمارا: أُوقفت قراءتها بطلب ضيف الله (لا تحتاج الآن)؛ تقرير حساب يقرؤها عند الطلب فقط
];
let ctx = null, state = { at: null, sites: {} }, busy = false, viewers = 0, lastView = 0;
const SLOGF = '/data/sales_log.json'; let SLOG = {}; try { SLOG = JSON.parse(fs.readFileSync(SLOGF, 'utf8')); } catch (e) {}

const START = `<!doctype html><meta charset=utf-8><title>متصفح دال</title><body style="font-family:sans-serif;direction:rtl;padding:24px;background:#FFF7F0">
<h2>متصفح دال في السحابة</h2><p>سجّل دخولك بنفسك في كل منصة مرة واحدة. الجلسة تبقى محفوظة، والقارئ يقرأ اللوحات كل ${E.POLL_MIN || 5} دقائق (قراءة فقط).</p>
<ul style="line-height:2.4;font-size:18px">${SITES.map(s => `<li><a href="${s.url}" target="_blank">${s.name}</a></li>`).join('')}<li><a href="https://mail.google.com/mail/u/0" target="_blank">إيميل المحمصة</a></li></ul></body>`;

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
    for (const k of FAST_K) { const s = SITES.find(x => x.k === k); state.sites[k] = Object.assign({ name: s.name }, await readSite(s)); }
    await publishSales();
  } catch (e) { console.log('fast', e.message); } finally { fastBusy = false; }
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
async function invExport(ym) {   // ZIP: الملفات + فهرس CSV (UTF-8 BOM) لشهر
  let doc = { items: [] }; try { const r = await gas({ op: 'get', paths: ['live/invoices'] }); const d = r.docs && r.docs['live/invoices']; if (d && d.data) doc = d.data; } catch (e) {}
  const items = (doc.items || []).filter(x => String(x.date || x.at || '').slice(0, 7) === ym);
  const tmp = '/tmp/inv_' + ym + '_' + Date.now(); fs.mkdirSync(tmp, { recursive: true });
  const rows = [['#', 'الحالة', 'المورد', 'الرقم الضريبي', 'رقم الفاتورة', 'التاريخ', 'قبل الضريبة', 'الضريبة', 'الإجمالي', 'النوع', 'ما ينقص', 'الملف', 'المصدر']];
  let k = 0; for (const x of items) { k++; const f = invFile(x); const name = String(k).padStart(3, '0') + '_' + String(x.supplier || 'مورد').replace(/[\/\\:*?"<>|]/g, ' ').slice(0, 30) + '_' + String(x.invoice_no || x.id).replace(/[\/\\:*?"<>|]/g, '-').slice(0, 20) + '.' + invExt(x.mime);
    try { fs.copyFileSync(f, tmp + '/' + name); } catch (e) {}
    rows.push([k, x.status, x.supplier || '', x.supplier_vat || '', x.invoice_no || '', x.date || '', x.net ?? '', x.vat ?? '', x.total ?? '', x.kind || '', (x.missing || []).join(' / '), name, x.src === 'wa' ? 'واتساب ' + (x.chat || '') : 'التطبيق']); }
  fs.writeFileSync(tmp + '/فهرس-الفواتير-' + ym + '.csv', '﻿' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n'));
  const out = '/tmp/dal-invoices-' + ym + '.zip'; try { fs.unlinkSync(out); } catch (e) {}
  await new Promise((ok, no) => require('child_process').execFile('zip', ['-r', '-j', out, tmp], (e) => e ? no(e) : ok()));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  return { file: out, n: items.length, total: items.reduce((a, x) => a + (+x.total || 0), 0), vat: items.reduce((a, x) => a + (+x.vat || 0), 0) };
}

// ===== بوابة الموظفين: حسابات برموز PIN وصلاحيات لكل صفحة (يشوف/يعدّل)، تُفرض هنا على الخادم لا في المتصفح =====
const crypto2 = require('crypto');
// صفحات الموظفين والمستندات التي تقرؤها كل صفحة. «move» (حركة المخزون) يحتاج الحركات والوحدات وآخر جرد للرصيد وفهرس الفواتير (مختصر) للاستلام
const STAFF_PAGES = { invoices: ['invoices'], stock: ['stock', 'stock_state'], customers: ['cust_meta', 'cust_salla', 'cust_wa', 'customers', 'crm_state'], messages: ['crm_state'], count: ['count_state', 'units'], roastx: ['roast_ext'], units: ['units', 'pending_items', 'alerts_stock'], move: ['moves', 'units', 'stock', 'count_state', 'invoices', 'suppliers', 'pending_items', 'alerts_stock', 'customers', 'docs_out', 'roast_log', 'staff_names'], roast: ['roast_log', 'stock', 'moves', 'units', 'docs_out'], _any: ['alerts_stock'] };
const DOCS = require('./docs');   // المستندات المطبوعة: سجل الحركة / سند استلام / سند تسليم (PDF مرقّم)
// ===== مفاتيح الوحدات وحركة المخزون: الأساس مقفول على وحدة فودكس من count-items.json (نسخة مطابقة لملف التطبيق) =====
const DALU = require('./units-core');
let CITEMS = []; try { CITEMS = JSON.parse(fs.readFileSync(__dirname + '/count-items.json', 'utf8')).items || []; } catch (e) { console.log('count-items missing', e.message); }
const citem = s => CITEMS.find(i => i.s === s) || null;
const MOVE_UNDO_MS = 5 * 60e3, MOVES_CAP = 5000, UNITS_LOG_CAP = 500;
// تعديل سلّم صنف: يتحقق، يقفل الأساس، ويضيف سطرًا في السجل باسم المعدِّل ووقته. يرجع المستند الجديد أو يرمي خطأ
function unitsApply(doc, j, who, now) {
  const st = Object.assign({ items: {}, log: [] }, doc || {}); st.items = Object.assign({}, st.items); st.log = (st.log || []).slice();
  const sku = String(j.sku || '').slice(0, 40); const it = citem(sku); if (!it) throw new Error('sku');
  const cur = st.items[sku] || Object.assign({}, DALU.defaults(it), { _def: 1 }); const v = DALU.validate(j.lad || cur.lad, it, j.min === undefined ? cur.min : j.min); if (!v.ok) throw new Error(v.err);
  const desc = e => DALU.describe(e.lad) + (e.min != null ? ' | min=' + e.min : '');
  const before = desc(cur) + (cur._def ? ' (default)' : ''); const after = desc(v.entry); if (desc(cur) === after) return doc;   // لا تغيير: يرجع المستند نفسه بلا سطر سجل
  st.items[sku] = v.entry; st.log.unshift({ at: now, by: who, sku, change: (before + ' -> ' + after).slice(0, 240) }); st.log = st.log.slice(0, UNITS_LOG_CAP); st.at = now;
  return st;
}
// ===== حركة المخزون والدفعات: كل «إضافة» دفعة من مورد (t:'in' مع rem = الباقي)، و«السحب» يستهلك من الدفعات بالأقدم أولًا (أو دفعة يختارها الموظف)
// سجلات live/moves.list: in (دفعة) / out (سحب مع alloc) / done (خلصت دفعة) / adj (فرق جرد طُبّق على أحدث دفعة). الصنف قد يكون مؤقتًا tmp-… بانتظار فودكس
const INTERNAL_SUP = { id: 'dal', name: 'دال (إنتاج داخلي)' }, ROAST_SUP = { id: 'roast', name: 'تحميص دال' };
const r4 = v => Math.round(v * 10000) / 10000;
const pendItem = (pend, s) => { const p = pend && (pend.items || []).find(x => x.id === s && !x.linked); return p ? { s: p.id, ar: p.ar, en: p.en, u: p.u, c: 'Pending', pending: true } : null; };
const itemOf = (s, pend) => citem(s) || pendItem(pend, s);
const lotsOf = (list, sku) => list.filter(x => x.t === 'in' && x.s === sku && x.rem > 0).sort((a, b) => a.at.localeCompare(b.at));
function supOf(j, sups, pend, who, now, sys) {   // المورد: من القائمة، أو مورد مؤقت موجود، أو «مورد جديد» يُسجَّل بانتظار المالك، أو دال نفسها (sys: مسار التحميص)
  const sp = j.sup || {}; const id = String(sp.id || '').slice(0, 60);
  if (id === INTERNAL_SUP.id) return { sup: INTERNAL_SUP }; if (id === ROAST_SUP.id) return sys ? { sup: ROAST_SUP } : null;   // «تحميص دال» لا يُختار يدويًا: يأتي من مسار التحميص فقط
  const s = ((sups && sups.list) || []).find(x => x.id === id); if (s) return { sup: { id: s.id, name: String(s.name || s.id).slice(0, 80) } };
  const ps = ((pend && pend.suppliers) || []).find(x => x.id === id); if (ps) return { sup: { id: ps.id, name: ps.name, pending: true } };
  const name = String(sp.name || '').trim().slice(0, 80); if (sp.new && name) { const np = { id: 'psup-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, by: who, at: now }; return { sup: { id: np.id, name, pending: true }, newSup: np }; }
  return null;
}
// العميل في «تسليم لعميل»: من قائمة العملاء (live/customers)، أو عميل مؤقت سبق تسجيله، أو «عميل جديد» يُسجَّل بانتظار المالك. لا أرقام جوال تُحفظ في الحركة
function custOf(j, custs, pend, who, now) {
  const c = j.cust || {}; const id = String(c.id || '').slice(0, 80);
  const k = ((custs && custs.list) || []).find(x => String(x.id) === id || (id && String(x.phone || '').replace(/\D/g, '') === id)); if (k) return { cust: { id: String(k.id), name: String(k.name || k.id).slice(0, 80), type: k.type || undefined } };
  const pc = ((pend && pend.customers) || []).find(x => x.id === id); if (pc) return { cust: { id: pc.id, name: pc.name, pending: true } };
  const name = String(c.name || '').trim().slice(0, 80); if (c.new && name) { const np = { id: 'pcus-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, by: who, at: now }; return { cust: { id: np.id, name, pending: true }, newCust: np }; }
  return null;
}
function moveApply(doc, j, who, unitsDoc, now, ctx) {
  ctx = ctx || {}; const pend = ctx.pend || { items: [], suppliers: [] };
  const st = Object.assign({ list: [] }, doc || {}); st.list = (st.list || []).slice(); const out = { st, events: [] };
  const num = v => (v === '' || v == null || !isFinite(+v)) ? null : r4(+v);
  const mkId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (j.op === 'add') {
    const t = j.t === 'in' ? 'in' : j.t === 'out' ? 'out' : j.t === 'trf' ? 'trf' : null; if (!t) throw new Error('type');
    const sku = String(j.s || '').slice(0, 40); const it = itemOf(sku, pend); if (!it) throw new Error('sku');
    const entry = DALU.merge([it], unitsDoc)[sku];
    const lines = (Array.isArray(j.lines) ? j.lines : []).slice(0, 20).map(l => ({ n: num(l && l.n), u: String((l && l.u) || '').slice(0, 12) }));
    if (!lines.length || lines.some(l => !(l.n > 0) || !DALU.usable(entry, l.u))) throw new Error('lines');
    const tot = DALU.total(entry, lines); if (!(tot > 0)) throw new Error('total');
    // المواقع: إضافة إلى المستودع (افتراضي) أو المحمصة؛ نقل بأحد المسارات الأربعة فقط؛ تسليم من المستودع (افتراضي) أو المحمصة. غير ذلك → route
    const locIn = v => v == null || v === '' ? null : String(v).slice(0, 8);
    let from = locIn(j.from), to = locIn(j.to);
    if (t === 'in') { to = to || 'wh'; from = null; if (!DALU.isLoc(to) || to === 'cafe') throw new Error('route'); }
    else if (t === 'trf') { if (!from || !to || !DALU.routeOk(from, to)) throw new Error('route'); }
    else { from = from || (j.batch && ctx.sys ? 'rs' : 'wh'); if (!DALU.isLoc(from) || from === 'cafe') throw new Error('route'); to = j.dest === 'cust' || (ctx.sys && j.batch) ? null : (to || 'cafe'); if (to && to !== 'cafe') throw new Error('route'); }
    const rec = { id: mkId('M'), at: now, by: who, t: t === 'trf' && to === 'cafe' ? 'out' : t, s: sku, lines, tot, base: entry.base };   // النقل إلى المقهى سحب يستهلك الدفعات (كما كان «للبار»)
    if (from) rec.from = from; if (to) rec.to = to;
    const note = String(j.note || '').trim().slice(0, 120); if (note) rec.note = note;
    const batch = ctx.sys && j.batch ? String(j.batch).slice(0, 40) : '';   // وسم الدفعة من مسار التحميص فقط، لا من طلب العميل
    if (t === 'trf') { rec.trf = 1; const avail = DALU.balances(st.list, sku)[from]; if (avail < tot) rec.short = r4(tot - avail); }   // trf: طُلب كنقل؛ short: رصيد الموقع المصدر لا يغطيه (يُسجَّل ويُعلَّم، لا يُرفض)
    if (t === 'in') {
      const sp = supOf(j, ctx.sups, pend, who, now, ctx.sys); if (!sp) throw new Error('sup');
      rec.sup = sp.sup; rec.rem = tot; if (sp.newSup) out.newSup = sp.newSup;
      const inv = String(j.inv || '').trim().slice(0, 40); if (inv) { rec.inv = inv; const ix = (((ctx.invs || {}).items) || []).find(x => x.id === inv); if (ix && ix.invoice_no) rec.invNo = String(ix.invoice_no).slice(0, 40); }   // رقم الفاتورة كما طُبع عليها (للعرض والسندات)؛ inv يبقى مفتاح الفهرس
      if (batch) rec.batch = batch;
    } else if (rec.t === 'trf') {
      if (batch) rec.batch = batch;   // نقل تلقائي للتحميص: يحمل رقم الدفعة فيُلغى معها
    } else {
      if (batch) rec.batch = batch;
      if (j.dest === 'cust') { const cu = custOf(j, ctx.custs, pend, who, now); if (!cu) throw new Error('cust'); rec.cust = cu.cust; if (cu.newCust) out.newCust = cu.newCust; }   // تسليم لعميل: سحب يحمل العميل ويُنتج سند تسليم
      // الاستهلاك: الدفعة المختارة أولًا ثم الباقي بالأقدم؛ ما لا تغطيه الدفعات يبقى «بلا دفعة» (مخزون سابق للنظام)
      const open = lotsOf(st.list, sku); const want = String(j.lot || ''); const order = want ? [open.find(x => x.id === want)].filter(Boolean).concat(open.filter(x => x.id !== want)) : open;
      let left = tot; rec.alloc = [];
      for (const lot of order) { if (left <= 0) break; const n = r4(Math.min(left, lot.rem)); if (n <= 0) continue; const i = st.list.findIndex(x => x.id === lot.id); st.list[i] = Object.assign({}, lot, { rem: r4(lot.rem - n) }); rec.alloc.push({ lot: lot.id, n }); left = r4(left - n);
        if (st.list[i].rem <= 0) { const ev = { id: mkId('E'), at: now, by: who, t: 'done', s: sku, lot: lot.id, sup: lot.sup, base: entry.base }; out.events.push(ev); } }
      if (left > 0) { rec.un = left; if (!open.length) rec.flag = 'nolot'; }   // لا دفعات للصنف بعد: يُسجَّل ويُعلَّم للمالك ولا يظهر رصيد سالب
    }
    st.list.unshift(rec); out.events.forEach(ev => st.list.unshift(ev)); st.list = st.list.slice(0, MOVES_CAP); st.at = now; out.rec = rec; return out;
  }
  if (j.op === 'del') {
    const rec = st.list.find(x => x.id === j.id); if (!rec || !/^(in|out|trf)$/.test(rec.t)) throw new Error('nf');
    if (!ctx.sys && rec.by !== who) throw new Error('owner'); if (rec.t === 'in' && r4(rec.rem) !== r4(rec.tot)) throw new Error('used');   // دفعة بدأ السحب منها لا تُلغى
    if (rec.doc && DOCS.isSigned(ctx.docs, rec.doc)) throw new Error('signed');   // مستند موقّع: محتواه مقفول، لا تراجع ولا تعديل لأسطره
    if (!ctx.sys && new Date(now) - new Date(rec.at) > MOVE_UNDO_MS) throw new Error('late');   // sys: تراجع دفعة تحميص (قاعدة اليوم نفسه في مسار التحميص)
    if (rec.t === 'out') for (const a of rec.alloc || []) { const i = st.list.findIndex(x => x.id === a.lot); if (i >= 0) { st.list[i] = Object.assign({}, st.list[i], { rem: r4(st.list[i].rem + a.n) }); st.list = st.list.filter(x => !(x.t === 'done' && x.lot === a.lot)); } }
    st.list = st.list.filter(x => x.id !== j.id); st.at = now; out.rec = rec; return out;
  }
  throw new Error('op');
}
// دفعة تحميص دال تحرّك المخزون: سحب الأخضر (من الدفعة المختارة ثم الأقدم) وإضافة المحمّص كدفعة موردها «تحميص دال». عملية واحدة؛ دفعات العملاء الخارجيين لا تمر هنا أبدًا
// الأخضر يُستهلك في المحمصة والمحمّص يُنتج فيها. إن كان رصيد المحمصة من الأخضر أقل من الدفعة يُسجَّل نقل تلقائي من المستودع للنقص قبل الدفعة
// (حتى لا يصير رصيد المحمصة سالبًا بصمت)؛ وإن لم يكفِ المستودع والمحمصة معًا تُسجَّل الدفعة كما كان ويُعلَّم النقص short
function roastMoves(movesDoc, batch, who, unitsDoc, now, lot) {
  const gs = batch.gs; const rs = DALU.ROAST_MAP[gs]; if (!rs) throw new Error('green');
  let st = movesDoc, trf = null, short = 0; const b = DALU.balances((movesDoc && movesDoc.list) || [], gs); const need = r4(batch.g - Math.max(0, b.rs));
  if (need > 0) { const amt = r4(Math.min(need, Math.max(0, b.wh))); if (amt > 0) { const o0 = moveApply(st, { op: 'add', t: 'trf', s: gs, lines: [{ n: amt, u: 'kg' }], from: 'wh', to: 'rs', batch: batch.id, note: 'نقل تلقائي للتحميص ' + batch.id }, who, unitsDoc, now, { sys: true }); st = o0.st; trf = o0.rec; } if (need > amt) short = r4(need - amt); }
  const o1 = moveApply(st, { op: 'add', t: 'out', s: gs, lines: [{ n: batch.g, u: 'kg' }], lot, batch: batch.id, from: 'rs', note: 'تحميص ' + batch.id }, who, unitsDoc, now, { sys: true });
  const o2 = moveApply(o1.st, { op: 'add', t: 'in', s: rs, lines: [{ n: batch.r, u: 'kg' }], sup: { id: ROAST_SUP.id }, batch: batch.id, to: 'rs', note: 'تحميص ' + batch.id }, who, unitsDoc, now, { sys: true });
  return { st: o2.st, out: o1.rec, inn: o2.rec, trf, short, events: (o1.events || []).concat(o2.events || []), nolot: o1.rec.flag === 'nolot' };
}
function roastUndo(movesDoc, batch, who, now) { let st = movesDoc; for (const id of (batch.mv || [])) { try { st = moveApply(st, { op: 'del', id }, who, { items: {} }, now, { sys: true }).st; } catch (e) { if (e.message !== 'nf') throw e; } } return st; }
// تنبيهات الحد الأدنى: تُحسب بعد كل تغيير في الدفعات؛ إشعار واحد للصنف في اليوم عبر مسار الإشعارات الموجود (الناقل)
async function notifyOwner(title, msg, tag) { if (!RELAY || !KEY) return false; try { const r = await fetch(RELAY + '/push/send', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dal-key': KEY }, body: JSON.stringify({ title, msg, lv: 'warn', tag }) }); return r.ok; } catch (e) { return false; } }
function alertsCompute(prev, unitsDoc, movesDoc, now, items) {   // يرجع {doc, fresh:[...]} — fresh: ما يستحق إشعارًا اليوم (أول مرة في اليوم)
  const units = DALU.merge(items || CITEMS, unitsDoc); const cur = DALU.alerts(items || CITEMS, units, (movesDoc && movesDoc.list) || []);
  const day = DOCS.dayIso(now); const sent = Object.assign({}, (prev && prev.sent) || {}); const fresh = [];   // «اليوم» بتوقيت الرياض لا UTC: إشعار واحد للصنف في يوم المحمصة
  for (const a of cur) { const it = citem(a.s) || {}; a.ar = it.ar; a.en = it.en; a.at = now; if (sent[a.s] !== day) { sent[a.s] = day; fresh.push(a); } }
  for (const k of Object.keys(sent)) if (sent[k] !== day && !cur.some(a => a.s === k)) delete sent[k];
  return { doc: { at: now, items: cur, sent }, fresh };
}
async function alertsRefresh(unitsDoc, movesDoc, now) {   // بعد كل تغيير: يكتب live/alerts_stock ويرسل إشعارًا لما وصل حده أول مرة اليوم
  try { const r = await gas({ op: 'get', paths: ['live/alerts_stock'] }); const d = r.docs && r.docs['live/alerts_stock']; const { doc, fresh } = alertsCompute((d && d.data) || null, unitsDoc, movesDoc, now);
    await gas({ op: 'set', path: 'live/alerts_stock', data: doc });
    // نص الإشعار يحمل تاريخ اليوم: الناقل يمنع تكرار النص نفسه، فبدونه لا يصل تنبيه اليوم التالي إن لم يتغير الرصيد
    for (const a of fresh) await notifyOwner('وصل للحد الأدنى', (a.kind === 'roast' ? 'حمّص ' : 'اطلب ') + a.ar + ' — الباقي ' + a.bal + ' ' + DALU.name(a.base, false) + ' (الحد ' + a.min + ') · ' + DOCS.fmtDay(now, 'ar').full, 'stock-min-' + a.s);
    return doc; } catch (e) { console.log('alerts', e.message); return null; }
}
// فرق الجرد: الجرد لكل صنف (فودكس بلا دفعات)؛ إن اختلف عن مجموع باقي الدفعات يُطبَّق الفرق على أحدث دفعة (ثم التي قبلها إن لم تكفِ) ويُعلَّم
function countAdjust(doc, sku, q, who, now, cnt) {
  const st = Object.assign({ list: [] }, doc || {}); st.list = (st.list || []).slice();
  const lots = st.list.filter(x => x.t === 'in' && x.s === sku).sort((a, b) => b.at.localeCompare(a.at)); if (!lots.length) return { st, rec: null };
  const sum = r4(lots.reduce((a, x) => a + (+x.rem || 0), 0)); let diff = r4(q - sum); if (diff === 0) return { st, rec: null };
  const applied = []; let left = diff;
  for (const lot of lots) { if (left === 0) break; const i = st.list.findIndex(x => x.id === lot.id); const cur = +st.list[i].rem || 0; const n = left > 0 ? left : -Math.min(cur, -left); if (n === 0) continue; st.list[i] = Object.assign({}, st.list[i], { rem: r4(cur + n) }); applied.push({ lot: lot.id, n: r4(n) }); left = r4(left - n); }
  const rec = { id: 'A' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: now, by: who, t: 'adj', s: sku, n: diff, alloc: applied, cnt, flag: 1, base: (lots[0].base || '') };
  st.list.unshift(rec); st.list = st.list.slice(0, MOVES_CAP); st.at = now; return { st, rec };
}
// الأصناف المؤقتة (بانتظار إضافتها في فودكس) والموردون المؤقتون — لا يُنشأ شيء في فودكس أبدًا
function pendingApply(doc, j, who, now, movesDoc) {
  const st = Object.assign({ items: [], suppliers: [] }, doc || {}); st.items = (st.items || []).slice(); st.suppliers = (st.suppliers || []).slice(); const out = { st };
  if (j.op === 'add') {
    const ar = String(j.ar || '').trim().slice(0, 80), en = String(j.en || '').trim().slice(0, 80); if (!ar && !en) throw new Error('name');
    const u = String(j.u || '').trim(); if (!DALU.baseOf({ u })) throw new Error('unit');
    const it = { id: 'tmp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ar: ar || en, en: en || ar, u, c: 'Pending', by: who, at: now }; if (j.sup) it.sup = String(j.sup.name || j.sup.id || '').slice(0, 80);
    st.items.unshift(it); st.items = st.items.slice(0, 200); st.at = now; out.item = it; return out;
  }
  if (j.op === 'sup') { const name = String(j.name || '').trim().slice(0, 80); if (!name) throw new Error('name'); const sp = { id: 'psup-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, by: who, at: now }; st.suppliers.unshift(sp); st.suppliers = st.suppliers.slice(0, 100); st.at = now; out.sup = sp; return out; }
  if (j.op === 'link') {   // ربط صنف مؤقت برمز فودكس بعد تحديث القائمة: تُنقل حركاته ودفعاته إلى الرمز الحقيقي (الوحدة الأساسية لازم تتطابق)
    const i = st.items.findIndex(x => x.id === j.id); if (i < 0 || st.items[i].linked) throw new Error('nf');
    const it = citem(String(j.sku || '')); if (!it) throw new Error('sku'); if (DALU.baseOf(it) !== DALU.baseOf(st.items[i])) throw new Error('unit');
    st.items[i] = Object.assign({}, st.items[i], { linked: { sku: it.s, at: now, by: who } }); st.at = now;
    const mv = Object.assign({ list: [] }, movesDoc || {}); let n = 0; mv.list = (mv.list || []).map(x => x.s === j.id ? (n++, Object.assign({}, x, { s: it.s, from: j.id })) : x); if (n) mv.at = now;
    out.moves = mv; out.moved = n; return out;
  }
  throw new Error('op');
}
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
    const year = j.no ? (DOCS.yearOfNo(j.no) || CY()) : CY(); const X = await docsRead(year, ['live/moves', 'live/pending_items', 'live/invoices']); const g = n => X.g('live/' + n);
    const moves = g('moves') || { list: [] }; let docs = X.st; let item = null, reprint = false;
    const D = { moves, pending_items: g('pending_items') || { items: [] }, invoices: g('invoices') || { items: [] }, items: CITEMS };
    if (j.no) { item = DOCS.docsFind(docs, X.legacy, String(j.no)); if (!item) throw new Error('nf'); reprint = true; }
    else { const kind = String(j.kind || ''); if (!DOCS.KINDS[kind]) throw new Error('kind'); const params = DOCS.pickParams(kind, j.params); DOCS.build(kind, params, D, lang);   // حقول معروفة فقط تُحفظ في الفهرس (لا نص حر طويل)؛ البناء أولًا حتى لا يُستهلك رقم لمستند لا يُبنى
      const mv = params.move && (moves.list || []).find(x => x.id === params.move); if (mv && mv.doc) { item = DOCS.docsFind(docs, X.legacy, mv.doc); reprint = !!item; }
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
async function docSign(j, who, by, ua, owner) {
  const now = new Date().toISOString();
  return countQueue(async () => {
    let no = String(j.no || ''); const year = no ? (DOCS.yearOfNo(no) || CY()) : CY(); const X = await docsRead(year, ['live/moves', 'live/pending_items', 'live/invoices', DOCS.sigsPath(year)]); const g = n => X.g('live/' + n);
    let docs = X.st; let moves = null; const D = { moves: g('moves') || { list: [] }, pending_items: g('pending_items') || { items: [] }, invoices: g('invoices') || { items: [] }, items: CITEMS };
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
  const roles = Object.assign({}, me.roles || {}); if (!roles.count && roles.stock === 'edit') roles.count = 'edit';   // الجرد: من يعدّل المحاصيل يجرد
  if (!roles.move && roles.stock === 'edit') roles.move = 'edit';   // حركة المخزون: من يعدّل المحاصيل يسجّل سحبًا وإضافة
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
      if (out.suppliers) out.suppliers = { list: (out.suppliers.list || []).map(x => ({ id: x.id, name: x.name })) };   // أسماء الموردين فقط، بلا أسعار ولا فواتير
      if (out.docs_out) out.docs_out = Object.assign({}, out.docs_out, { items: (out.docs_out.items || []).map(x => DOCS.sigStrip(x, null)) });   // التواقيع: الأسماء والبصمات فقط، بلا صور (الصور في مخزن منفصل) وبلا النسخة المجمّدة
      if (out.stock) out.stock = Object.assign({}, out.stock, { items: (out.stock.items || []).map(x => ({ id: x.id, name: x.name, o: x.o, st: x.st, q: x.q, n: x.n })) });   // المحاصيل بلا أسعار شراء أو بيع (live/stock يحمل sell/buys للمالك)
      return json(200, { ok: true, docs: out }); } catch (e) { return json(500, { ok: false, err: 'db' }); }
  }
  if (path === '/staff/units' && req.method === 'GET') {   // سلالم الوحدات لكل صنف (المخزَّن مدموجًا مع الافتراضي) لمن يرى الوحدات أو الحركة أو الجرد
    if (!(can('units', 'view') || can('move', 'view') || can('count', 'view'))) return json(403, { ok: false, err: 'forbidden' });
    try { const r = await gas({ op: 'get', paths: ['live/units'] }); const d = r.docs && r.docs['live/units']; const doc = (d && d.data) || { items: {}, log: [] };
      return json(200, { ok: true, keys: DALU.KEYS, items: DALU.merge(CITEMS, doc), log: (doc.log || []).slice(0, 50), at: doc.at || null, canEdit: can('units', 'edit') }); } catch (e) { return json(500, { ok: false, err: 'db' }); }
  }
  if (path === '/staff/units' && req.method === 'POST') { if (!can('units', 'edit')) return json(403, { ok: false, err: 'forbidden' });   // تعديل سلّم صنف: {sku, lad:[[key,factor|null],...]}
    try { const j = JSON.parse(await readBody(req, 1e5) || '{}'); return await countQueue(async () => {
      const r = await gas({ op: 'get', paths: ['live/units'] }); const d = r.docs && r.docs['live/units']; const doc = (d && d.data) || { items: {}, log: [] }; const now = new Date().toISOString();
      const st = unitsApply(doc, j, me.name, now); if (st !== doc) { await gas({ op: 'set', path: 'live/units', data: st }); await staffLog(me.name, 'units', j.sku + ' ' + DALU.describe(st.items[j.sku].lad) + (st.items[j.sku].min != null ? ' min=' + st.items[j.sku].min : '')); if (j.min !== undefined) { const rm = await gas({ op: 'get', paths: ['live/moves'] }); const dm = rm.docs && rm.docs['live/moves']; await alertsRefresh(st, (dm && dm.data) || { list: [] }, now); } }
      return json(200, { ok: true, keys: DALU.KEYS, items: DALU.merge(CITEMS, st), log: (st.log || []).slice(0, 50), at: st.at || null, canEdit: true }); }); } catch (e) { return json(400, { ok: false, err: String(e.message || e) }); } }
  if (path === '/staff/move' && req.method === 'POST') { if (!can('move', 'edit')) return json(403, { ok: false, err: 'forbidden' });   // حركة مخزون: {op:'add', t:'in', to:'wh'|'rs', s, lines:[{n,u}], sup:{id}|{new:1,name}, inv} | {t:'trf', from, to (أحد المسارات الأربعة), lot} | {t:'out', dest:'cust', cust, from:'wh'|'rs', lot} أو {op:'del', id}. مسار غير مسموح → 400 route
    try { const j = JSON.parse(await readBody(req, 1e5) || '{}'); return await countQueue(async () => {
      const DP = DOCS.docsPath(CY()), DP1 = DOCS.docsPath(String(+CY() - 1)); const r = await gas({ op: 'get', paths: ['live/moves', 'live/units', 'live/suppliers', 'live/pending_items', 'live/customers', 'live/docs_out', 'live/invoices', DP, DP1] }); const g = n => { const d = r.docs && r.docs['live/' + n]; return (d && d.data) || null; }; const now = new Date().toISOString();
      const pend = g('pending_items') || { items: [], suppliers: [] }; const dy = r.docs && r.docs[DP]; const docsY = dy && dy.data ? dy.data : DOCS.docsSeed(g('docs_out'), CY()); const dy1 = r.docs && r.docs[DP1];
      const o = moveApply(g('moves') || { list: [] }, j, me.name, g('units') || { items: {} }, now, { sups: g('suppliers'), pend, custs: g('customers'), invs: g('invoices'), docs: { items: DOCS.docsMerge({ items: DOCS.docsMerge(docsY, dy1 && dy1.data) }, g('docs_out')) } });   // قفل المستند الموقّع: فهرس هذه السنة والماضية (رأس السنة) + القديم
      // سند مرقّم تلقائيًا: استلام لكل دفعة من مورد حقيقي، تسليم لكل سحب لعميل، ونقل داخلي لكل نقل بين المواقع. يُطبع الآن أو لاحقًا بالرقم نفسه
      const rec = o.rec; let docItem = null, docsOut = null;
      if (j.op === 'add' && ((rec.t === 'in' && rec.sup && rec.sup.id !== INTERNAL_SUP.id && rec.sup.id !== ROAST_SUP.id) || (rec.t === 'out' && rec.cust) || rec.trf)) {
        const kind = rec.t === 'in' ? 'rec' : rec.trf ? 'trf' : 'dlv'; const da = DOCS.docAdd(docsY, kind, { move: rec.id }, me.name, now, kind === 'rec' ? { sup: rec.sup.id, name: rec.sup.name, item: rec.s } : kind === 'trf' ? { from: rec.from, to: rec.to, item: rec.s } : { cust: rec.cust.id, name: rec.cust.name, item: rec.s });
        rec.doc = da.item.no; docItem = da.item; docsOut = da.st; }
      // الفهرس قبل الحركات: إن فشل حفظ الفهرس لا تُحفظ حركة تحمل رقمًا غير مسجّل (وإلا تكرر الرقم في السند التالي). مخزن GAS ليس ذريًا بين المستندين؛ الطابور هنا يسلسل الكتابة داخل هذه الخدمة فقط
      if (docsOut) await gas({ op: 'set', path: DP, data: docsOut });
      await gas({ op: 'set', path: 'live/moves', data: o.st }); const alerts = await alertsRefresh(g('units'), o.st, now);
      if (o.newSup || o.newCust) { if (o.newSup) pend.suppliers = [o.newSup].concat(pend.suppliers || []).slice(0, 100); if (o.newCust) pend.customers = [o.newCust].concat(pend.customers || []).slice(0, 200); pend.at = now; await gas({ op: 'set', path: 'live/pending_items', data: pend }); }
      const L = DALU.locs(rec, o.st.list); const ln = k => DALU.locName(k, false);
      await staffLog(me.name, 'move', (j.op === 'del' ? 'تراجع ' : rec.t === 'in' ? 'إضافة ' : rec.cust ? 'تسليم ' : DALU.isTrf(rec) ? 'نقل ' : 'سحب ') + rec.s + ' ' + rec.tot + ' ' + rec.base + (rec.sup ? ' من ' + rec.sup.name : '') + (rec.cust ? ' إلى ' + rec.cust.name : '') + (j.op !== 'del' && (L.from || L.to) ? ' ' + [L.from ? ln(L.from) : '', L.to ? ln(L.to) : ''].filter(Boolean).join(' ← ') : '') + (rec.short ? ' (نقص ' + rec.short + ')' : '') + (rec.inv ? ' فاتورة ' + (rec.invNo || rec.inv) : '') + (rec.doc ? ' ' + rec.doc : ''));
      return json(200, { ok: true, moves: o.st, rec, events: o.events || [], pending: pend, alerts, doc: docItem, docs_out: docsOut ? { items: DOCS.docsMerge(docsOut, g('docs_out')).map(x => DOCS.sigStrip(x, null)) } : undefined }); }); } catch (e) { return json(e.message === 'signed' ? 409 : 400, { ok: false, err: String(e.message || e) }); } }
  if (path === '/staff/sign' && req.method === 'POST') {   // توقيع إلكتروني {no, role, name, png}: صلاحية الحركة (تعديل) لسندات الاستلام/التسليم؛ «اعتماد» للمالك فقط (403 هنا دائمًا)
    if (!can('move', 'edit')) return json(403, { ok: false, err: 'forbidden' });
    try { const j = JSON.parse(await readBody(req, 2e5) || '{}'); if (!j.no) return json(400, { ok: false, err: 'no' }); const o = await docSign(j, me.name, me.id, req.headers['user-agent'], false);
      return json(200, { ok: true, doc: DOCS.sigStrip(o.item, me.id), sig: { role: o.sig.role, name: o.sig.name, at: o.sig.at, hash: o.sig.hash } }); }
    catch (e) { return json(e.message === 'too-big' ? 413 : SIGN_CODE[e.message] || 500, { ok: false, err: String(e.message || e) }); } }
  if (path === '/staff/doc' && req.method === 'POST') {   // مستند PDF: {kind:'mov'|'rec'|'dlv'|'trf', params, lang} يُرقَّم ويُفهرس، أو {no} لإعادة طباعة مستند بالرقم نفسه
    if (!(can('move', 'view') || can('roast', 'view'))) return json(403, { ok: false, err: 'forbidden' });
    try { const j = JSON.parse(await readBody(req, 1e5) || '{}'); const out = await docPdf(j, me.name); res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + out.no + '.pdf"', 'X-Dal-Doc': out.no }); res.end(out.pdf); return true; }
    catch (e) { return json(e.message === 'nf' || e.message === 'kind' || e.message === 'params' ? 400 : 500, { ok: false, err: String(e.message || e) }); } }
  if (path === '/staff/pending' && req.method === 'POST') {   // صنف مؤقت {op:'add', ar, en, u, sup} / مورد مؤقت {op:'sup', name} (حركة · تعديل) / ربط {op:'link', id, sku} (الوحدات · تعديل)
    try { const j = JSON.parse(await readBody(req, 1e5) || '{}'); if (!can(j.op === 'link' ? 'units' : 'move', 'edit')) return json(403, { ok: false, err: 'forbidden' }); return await countQueue(async () => {
      const r = await gas({ op: 'get', paths: ['live/pending_items', 'live/moves'] }); const g = n => { const d = r.docs && r.docs['live/' + n]; return (d && d.data) || null; }; const now = new Date().toISOString();
      const o = pendingApply(g('pending_items') || { items: [], suppliers: [] }, j, me.name, now, g('moves') || { list: [] });
      await gas({ op: 'set', path: 'live/pending_items', data: o.st }); if (o.moves) await gas({ op: 'set', path: 'live/moves', data: o.moves });
      await staffLog(me.name, 'pending', j.op === 'add' ? 'صنف مؤقت ' + o.item.ar : j.op === 'sup' ? 'مورد مؤقت ' + o.sup.name : 'ربط ' + j.id + ' → ' + j.sku + ' (' + o.moved + ' حركة)');
      return json(200, { ok: true, pending: o.st, item: o.item || null, sup: o.sup || null, moves: o.moves || null }); }); } catch (e) { return json(400, { ok: false, err: String(e.message || e) }); } }
  if (path === '/staff/invoice/upload' && req.method === 'POST') { if (!can('invoices', 'edit')) return json(403, { ok: false, err: 'forbidden' });
    try { const b = JSON.parse(await readBody(req, 25e6) || '{}'); b.meta = Object.assign({}, b.meta || {}, { src: 'staff', from: me.name }); const r = await fetch(RELAY + '/invoice/process', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dal-key': KEY }, body: JSON.stringify(b) }); const t = await r.text(); let rec = null; try { rec = JSON.parse(t).rec; } catch (e) {} await staffLog(me.name, 'invoice', rec ? (rec.supplier || '') + ' ' + (rec.total || '') + ' ' + rec.status : 'upload'); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(t); } catch (e) { json(500, { ok: false, err: String(e.message || e) }); } return true; }
  if (path === '/staff/stock' && req.method === 'POST') { if (!can('stock', 'edit')) return json(403, { ok: false, err: 'forbidden' });
    try { const j = JSON.parse(await readBody(req, 2e5) || '{}'); const r = await gas({ op: 'get', paths: ['live/stock_state'] }); const d = r.docs && r.docs['live/stock_state']; const st = Object.assign({ q: {}, st: {}, n: {} }, (d && d.data) || {}); if (j.st) st.st[j.id] = j.st; if (j.q != null) st.q[j.id] = j.q; if (j.n != null) st.n[j.id] = j.n; st.at = new Date().toISOString(); st.by = me.name; await gas({ op: 'set', path: 'live/stock_state', data: st }); await staffLog(me.name, 'stock', (j.id || '') + ' → ' + (j.st || '') + (j.q != null ? ' / ' + j.q : '')); return json(200, { ok: true }); } catch (e) { return json(500, { ok: false, err: 'db' }); } }
  if (path === '/staff/sent' && req.method === 'POST') { if (!can('messages', 'edit')) return json(403, { ok: false, err: 'forbidden' });
    try { const j = JSON.parse(await readBody(req, 1e5) || '{}'); const r = await gas({ op: 'get', paths: ['live/crm_state'] }); const d = r.docs && r.docs['live/crm_state']; const st = Object.assign({ sent: {}, opt: {}, tag: {}, note: {}, tpl: {} }, (d && d.data) || {}); (st.sent[j.k] = st.sent[j.k] || {})[j.t || 'generic'] = new Date().toISOString().slice(0, 10); await gas({ op: 'set', path: 'live/crm_state', data: st }); await staffLog(me.name, 'message', (j.name || j.k) + ' · ' + (j.t || '')); return json(200, { ok: true }); } catch (e) { return json(500, { ok: false, err: 'db' }); } }
  if (path === '/staff/count' && req.method === 'POST') { if (!can('count', 'edit')) return json(403, { ok: false, err: 'forbidden' });   // الجرد بالكاميرا: سطر جرد / إعداد صنف / جرد جديد
    try { const j = JSON.parse(await readBody(req, 2e5) || '{}'); return await countQueue(async () => {
      const r = await gas({ op: 'get', paths: ['live/count_state', 'live/moves'] }); const d = r.docs && r.docs['live/count_state']; const st = Object.assign({ cfg: {}, cur: null, hist: [] }, (d && d.data) || {}); const mvd = r.docs && r.docs['live/moves']; let adj = null;
      const now = new Date().toISOString(); const sku = String(j.sku || '').slice(0, 40); const num = v => (v === '' || v == null || !isFinite(+v)) ? null : Math.round(+v * 10000) / 10000;
      if (!st.cur) st.cur = { id: 'C' + now.slice(0, 10).replace(/-/g, '') + '-' + now.slice(11, 16).replace(':', ''), started: now, by: me.name, lines: {} };
      if (j.op === 'line') { if (!sku) throw new Error('sku'); if (j.del) delete st.cur.lines[sku]; else { const q = num(j.q); if (q == null || q < 0) throw new Error('qty'); st.cur.lines[sku] = { q, c: num(j.c), pc: num(j.pc), l: num(j.l), w: Array.isArray(j.w) ? j.w.slice(0, 60).map(num).filter(x => x != null) : null, b: num(j.b), t: num(j.t), ul: Array.isArray(j.ul) ? j.ul.slice(0, 20).map(x => ({ n: num(x && x.n), u: String((x && x.u) || '').slice(0, 12) })).filter(x => x.n > 0 && DALU.KEYS.includes(x.u)) : undefined, note: String(j.note || '').slice(0, 120), r: j.r ? String(j.r).slice(0, 40) : undefined, q0: num(j.q0), nf: j.nf ? 1 : undefined, by: me.name, at: now }; } await staffLog(me.name, 'count', sku + ' = ' + (j.del ? 'حذف' : j.q));
        if (!j.del && !j.nf) { const ca = countAdjust((mvd && mvd.data) || { list: [] }, sku, num(j.q), me.name, now, st.cur.id); if (ca.rec) { adj = ca.rec; await gas({ op: 'set', path: 'live/moves', data: ca.st }); await staffLog(me.name, 'move', 'فرق جرد ' + sku + ' ' + (adj.n > 0 ? '+' : '') + adj.n); const ru = await gas({ op: 'get', paths: ['live/units'] }); const du = ru.docs && ru.docs['live/units']; await alertsRefresh((du && du.data) || { items: {} }, ca.st, now); } } }
      else if (j.op === 'cfg') { if (!sku) throw new Error('sku'); const c = st.cfg[sku] = Object.assign({}, st.cfg[sku] || {}); if (j.pc !== undefined) c.pc = num(j.pc); if (j.t !== undefined) c.t = num(j.t); if (j.loc !== undefined) c.loc = String(j.loc || '').slice(0, 30); if (j.z !== undefined) c.z = String(j.z || '').slice(0, 30); if (j.sh !== undefined) c.sh = String(j.sh || '').slice(0, 30); if (j.o !== undefined) c.o = num(j.o); if (j.min !== undefined) c.min = num(j.min); }
      else if (j.op === 'order') { const L = Array.isArray(j.skus) ? j.skus.slice(0, 200) : []; L.forEach((k, i) => { k = String(k).slice(0, 40); const c = st.cfg[k] = Object.assign({}, st.cfg[k] || {}); c.o = i + 1; if (j.sh) c.sh = String(j.sh).slice(0, 30); if (j.z) c.z = String(j.z).slice(0, 30); }); }
      else if (j.op === 'place') { const p = String(j.p || '').slice(0, 30); if (!p) throw new Error('place'); st.cur.places = st.cur.places || {}; const P = st.cur.places[p] = Object.assign({}, st.cur.places[p] || {}); if (j.act === 'send') { P.sent = now; P.sentBy = me.name; P.mins = num(j.mins); P.n = num(j.n); } else if (j.act === 'reopen') { delete P.sent; } }
      else if (j.op === 'waste') { if (!sku) throw new Error('sku'); const q = num(j.q); if (q == null || q <= 0) throw new Error('qty'); st.waste = [{ sku, q, r: String(j.r || '').slice(0, 40), note: String(j.note || '').slice(0, 120), by: me.name, at: now }].concat(st.waste || []).slice(0, 400); await staffLog(me.name, 'waste', sku + ' = ' + q); }
      else if (j.op === 'new') { if (st.cur && Object.keys(st.cur.lines || {}).length) { st.cur.closed = now; st.cur.closedBy = me.name; st.hist = [st.cur].concat(st.hist || []).slice(0, 12); } st.cur = { id: 'C' + now.slice(0, 10).replace(/-/g, '') + '-' + now.slice(11, 16).replace(':', ''), started: now, by: me.name, lines: {} }; await staffLog(me.name, 'count', 'جرد جديد'); }
      else throw new Error('op');
      st.at = now; await gas({ op: 'set', path: 'live/count_state', data: st }); return json(200, { ok: true, state: st, adj });
    }); } catch (e) { return json(400, { ok: false, err: String(e.message || e) }); } }
  if (path === '/staff/roast' && req.method === 'POST') {   // سجل التحميص: دال في live/roast_log والعملاء الخارجيين في live/roast_ext — مستندان منفصلان بصلاحيتين. دفعات دال فقط تحرّك المخزون (أخضر ← محمّص)
    try { const j = JSON.parse(await readBody(req, 2e4) || '{}'); const X = j.t === 'ext'; if (!can(X ? 'roastx' : 'roast', 'edit')) return json(403, { ok: false, err: 'forbidden' }); const P = X ? 'live/roast_ext' : 'live/roast_log'; return await countQueue(async () => {
      const r = await gas({ op: 'get', paths: X ? [P] : [P, 'live/moves', 'live/units'] }); const d = r.docs && r.docs[P]; const lg = Object.assign({ list: [] }, (d && d.data) || {}); const now = new Date().toISOString(); const n = v => { const x = Number(v); return isFinite(x) ? Math.round(x * 1000) / 1000 : null; };
      const mvd = !X && r.docs && r.docs['live/moves']; const und = !X && r.docs && r.docs['live/units']; let moves = (mvd && mvd.data) || { list: [] }; const units = (und && und.data) || { items: {} }; let mvChanged = false, extra = {};
      if (j.op === 'add') { const t = X ? 'ext' : 'dal'; const g = n(j.g), rr = n(j.r); if (!(g > 0) || !(rr > 0) || rr > g || g > 200) throw new Error('weight');
        let gi = null; if (t === 'dal') { gi = citem(String(j.gs || '')); if (!gi || !DALU.ROAST_MAP[gi.s]) throw new Error('origin'); } if (t === 'ext' && !String(j.c || '').trim()) throw new Error('customer');
        const it = { id: 'R' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t, gs: t === 'dal' ? gi.s : undefined, rs: t === 'dal' ? DALU.ROAST_MAP[gi.s] : undefined, o: t === 'dal' ? String(j.o || gi.s).slice(0, 60) : undefined, on: t === 'dal' ? gi.ar : undefined, c: t === 'ext' ? String(j.c).slice(0, 80) : undefined, g, r: rr, n: String(j.n || '').slice(0, 120) || undefined, by: me.name, at: now };
        if (t === 'dal') { const rm = roastMoves(moves, it, me.name, units, now, j.lot ? String(j.lot) : ''); moves = rm.st; it.mv = (rm.trf ? [rm.trf.id] : []).concat([rm.out.id, rm.inn.id]); if (rm.nolot) it.nolot = 1; if (rm.short) it.short = rm.short; mvChanged = true; extra = { out: rm.out, inn: rm.inn, trf: rm.trf, short: rm.short || 0, events: rm.events, nolot: rm.nolot }; }
        lg.list = [it].concat(lg.list || []).slice(0, 3000); await staffLog(me.name, 'roast', (t === 'ext' ? 'خارجي ' + it.c : it.on || it.o) + ' ' + g + '→' + rr + (extra.trf ? ' (نقل تلقائي ' + extra.trf.tot + ' من المستودع)' : '') + (it.short ? ' (نقص ' + it.short + ')' : '') + (it.nolot ? ' (بلا دفعة أخضر)' : '')); }
      else if (j.op === 'del') { const it = (lg.list || []).find(x => x.id === j.id); if (!it) throw new Error('nf'); const dd = x => new Date(new Date(x).getTime() + 3 * 3600e3).toISOString().slice(0, 10); if (dd(it.at) !== dd(now)) return json(403, { ok: false, err: 'الحذف لدفعات اليوم فقط' });
        if (!X && it.mv && it.mv.length) { moves = roastUndo(moves, it, me.name, now); mvChanged = true; }
        lg.list = lg.list.filter(x => x.id !== j.id); await staffLog(me.name, 'roast', 'حذف دفعة ' + (it.on || it.c || '') + ' ' + it.g + '→' + it.r); }
      else throw new Error('op');
      lg.at = now; await gas({ op: 'set', path: P, data: lg }); if (mvChanged) { await gas({ op: 'set', path: 'live/moves', data: moves }); extra.alerts = await alertsRefresh(units, moves, now); extra.moves = moves; }
      return json(200, Object.assign({ ok: true, log: lg }, extra)); }); } catch (e) { return json(400, { ok: false, err: e.message === 'used' ? 'المحمّص من هذه الدفعة سُحب منه، لا يمكن التراجع' : (e.message || 'error') }); } }
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
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: !!ctx, at: state.at, salesAt: SALES.at, needLogin: state.needLogin || [], fcounts: { at: FC.at, err: FC.err, probe: FC.probe } })); }   // fcounts: حالة قارئ الجرد (مسارات ومفاتيح فقط، بلا بيانات)
  if (req.url.startsWith('/salla/callback')) {   // عودة تفويض سلة (عامة): نبادل الكود بتوكن ونخزّنه
    return (async () => {
      try {
        const u = new URL(req.url, 'http://x'); const code = u.searchParams.get('code'); if (!code) throw new Error('no-code');
        await sallaExchange({ grant_type: 'authorization_code', code, redirect_uri: E.SALLA_REDIRECT || 'https://browser-production-10fb.up.railway.app/salla/callback' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<meta charset=utf-8><body style="font-family:sans-serif;direction:rtl;text-align:center;padding:40px;background:#FFF7F0"><h2>✅ تم ربط سلة بنجاح</h2><p>أغلق هذه الصفحة وارجع للمحادثة.</p></body>');
      } catch (e) { res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<meta charset=utf-8><body style="font-family:sans-serif;direction:rtl;text-align:center;padding:40px"><h2>تعذّر الربط</h2><p>' + String(e.message || e) + '</p></body>'); }
    })();
  }
  if (req.url.startsWith('/salla/webhook')) {   // مستقبِل أحداث سلة (عام): نقبل ونخزّن آخر حدث
    let b = ''; req.on('data', c => { b += c; if (b.length > 2e6) req.destroy(); });
    req.on('end', () => { try { const j = JSON.parse(b || '{}'); const dt = j && j.data; if (j && /authorize/i.test(j.event || '') && dt && dt.access_token && dt.refresh_token) { const exp = dt.expires && +dt.expires > 1e11 ? +dt.expires : Date.now() + (+dt.expires || 1209600) * 1000; SOAUTH = { access: dt.access_token, refresh: dt.refresh_token, exp, at: Date.now() }; try { fs.writeFileSync(SOFILE, JSON.stringify(SOAUTH)); console.log('salla token via webhook, refresh ok'); } catch (e) {} } } catch (e) {} res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
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

  if (req.url.startsWith('/probe')) {   // فحص: أي واجهات تناديها صفحة ما (عناوين فقط + مفاتيح الرد، بلا قيم)
    return (async () => {
      const u = new URL(req.url, 'http://x'); const target = u.searchParams.get('u'); const pat = new RegExp(u.searchParams.get('p') || 'api');
      const seen = []; const p = await ctx.newPage();
      p.on('response', async r => { const ru = r.url(); if (!pat.test(ru)) return; let keys = null, sample = null; try { const j = await r.json(); keys = Object.keys(j || {}); const arr = Array.isArray(j) ? j : (j && (j.data || j.result || j.items)); const first = Array.isArray(arr) ? arr[0] : (arr && Array.isArray(arr.data) ? arr.data[0] : arr && Array.isArray(arr.items) ? arr.items[0] : null); if (first && typeof first === 'object') sample = Object.keys(first); if (arr && !Array.isArray(arr) && typeof arr === 'object') keys.push('data:' + Object.keys(arr).join('|')); } catch (e) {} seen.push({ url: ru.replace(/([?&])(token|key|auth)[^&]*/gi, '$1***'), status: r.status(), method: r.request().method(), keys, sample }); });
      try { await p.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 }); await p.waitForTimeout(+u.searchParams.get('w') || 8000); } catch (e) { seen.push({ err: String(e.message || e).slice(0, 100) }); } finally { await p.close().catch(() => {}); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(seen, null, 1));
    })();
  }
  cors(req, res);
  if (req.method === 'POST' && req.url === '/sign') {   // المالك: توقيع «اعتماد» على مستند {no, role:'appr', name, png} أو على فرق جرد {kind:'mov', params:{from,to,item}, adj, role:'appr', name, png}
    return (async () => { try { const j = JSON.parse(await readBody(req, 2e5) || '{}'); if (j.role !== 'appr') throw new Error('role'); const o = await docSign(j, String(j.name || 'المالك').slice(0, 80), 'owner', req.headers['user-agent'], true); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, doc: o.item, sig: o.sig })); }
      catch (e) { res.writeHead(e.message === 'too-big' ? 413 : SIGN_CODE[e.message] || 500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, err: String(e.message || e) })); } })();
  }
  if (req.url.startsWith('/doc')) {   // المالك: المستند نفسه الذي يطبعه الفريق (POST {kind,params,lang} أو {no}؛ GET ?no=…&lang=…)
    return (async () => { try { const u = new URL(req.url, 'http://x'); const j = req.method === 'POST' ? JSON.parse(await readBody(req, 1e5) || '{}') : { no: u.searchParams.get('no'), lang: u.searchParams.get('lang') }; const out = await docPdf(j, 'المالك'); res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + out.no + '.pdf"', 'X-Dal-Doc': out.no, 'Access-Control-Expose-Headers': 'X-Dal-Doc' }); res.end(out.pdf); } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, err: String(e.message || e) })); } })();
  }
  if (req.method === 'POST' && req.url === '/invoice/upload') {   // رفع يدوي من التطبيق → الناقل يقرأ ويفحص → يرجع هنا للتخزين
    return (async () => { try { const b = await readBody(req, 25e6); const r = await fetch(RELAY + '/invoice/process', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dal-key': KEY }, body: b }); const t = await r.text(); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(t); } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, err: String(e.message || e) })); } })();
  }
  if (req.method === 'POST' && req.url === '/invoice/update') {   // تعديل حالة (أُرسلت للمحاسب / تصحيح حقل)
    return (async () => { try { const j = JSON.parse(await readBody(req, 1e6) || '{}'); if (!j.id) throw new Error('id'); await invIndexAdd(j); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, err: String(e.message || e) })); } })();
  }
  if (req.url.startsWith('/invoice/file/')) {   // عرض ملف فاتورة
    const id = decodeURIComponent(req.url.split('/')[3] || '').replace(/[^A-Za-z0-9_-]/g, ''); let found = null;
    try { for (const ym of fs.readdirSync(IDIR)) for (const f of fs.readdirSync(IDIR + '/' + ym)) if (f.startsWith(id + '.')) found = IDIR + '/' + ym + '/' + f; } catch (e) {}
    if (!found) { res.writeHead(404); return res.end('no'); }
    const ext = found.split('.').pop(); res.writeHead(200, { 'Content-Type': ext === 'pdf' ? 'application/pdf' : 'image/' + (ext === 'jpg' ? 'jpeg' : ext), 'Cache-Control': 'private, max-age=86400' }); return fs.createReadStream(found).pipe(res);
  }
  if (req.url.startsWith('/invoice/export')) {   // ZIP الشهر للمحاسب
    return (async () => { try { const u = new URL(req.url, 'http://x'); const ym = (u.searchParams.get('month') || prevMonth().from.slice(0, 7)).replace(/[^0-9-]/g, ''); const z = await invExport(ym); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="dal-invoices-' + ym + '.zip"' }); fs.createReadStream(z.file).pipe(res); } catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('تعذّر التصدير: ' + String(e.message || e)); } })();
  }
  if (req.url.startsWith('/customers/sync')) { return (async () => { const m = await syncCustomers(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(m, null, 1)); })(); }
  if (req.url.startsWith('/salla/try')) { return (async () => { const u = new URL(req.url, 'http://x'); let o = {}; try { const tok = await sallaToken(); const r = await fetch('https://api.salla.dev' + u.searchParams.get('path'), { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' } }); o = { status: r.status, body: (await r.text()).slice(0, 600) }; } catch (e) { o = { err: String(e.message || e) }; } res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); })(); }
  if (req.url.startsWith('/bonat/one')) { return (async () => { const p = await ctx.newPage(); let o = {}; try { await p.goto('https://store.bonat.io/customers', { waitUntil: 'domcontentloaded', timeout: 30000 }); o = await p.evaluate(async () => { const r = await fetch('https://dashboard-api.bonat.io/api/v3/customers?page=1&limit=3&sort=' + encodeURIComponent('[{"lastVisit":"DESC"}]'), { credentials: 'include', headers: { Accept: 'application/json' } }); const j = await r.json(); const c = (j.data || [])[0] || {}; const mask = v => typeof v === 'string' ? v.replace(/[0-9]/g, '#').replace(/[^\s#@.\-:]/g, 'x') : v; const o = {}; for (const [k, v] of Object.entries(c)) o[k] = typeof v === 'object' && v ? v : mask(v); return o; }); } catch (e) { o = { err: String(e.message || e) }; } finally { await p.close().catch(() => {}); } res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o, null, 1)); })(); }
  if (req.url.startsWith('/tamara')) { return (async () => { const u = new URL(req.url, 'http://x'); const r = prevMonth(); const t = await readTamara(u.searchParams.get('from') || r.from, u.searchParams.get('to') || r.to); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(t, null, 1)); })(); }
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
const FCF = '/data/foodics_counts.json'; let FC = { notified: [], probe: null, at: null, err: null }; try { FC = Object.assign(FC, JSON.parse(fs.readFileSync(FCF, 'utf8'))); } catch (e) {}
const fcSave = () => { try { fs.writeFileSync(FCF, JSON.stringify({ notified: FC.notified.slice(-50) })); } catch (e) {} };
function fcNum(v) { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null; }
function fcName(o) { if (!o) return ''; const ar = s => /[؀-ۿ]/.test(s || ''); return (ar(o.name) ? o.name : ar(o.name_localized) ? o.name_localized : (o.name || o.name_localized || '')).trim(); }
function fcItems(raw) {   // يبحث عن مصفوفة أصناف الجرد في أي شكل يرجعه الكونسول ويطبّعها
  const arrs = []; const walk = (x, d) => { if (!x || d > 4) return; if (Array.isArray(x)) { if (x.length && typeof x[0] === 'object' && x[0] && (Object.keys(x[0]).some(k => /quant|qty|count/i.test(k)) || (x[0].pivot && typeof x[0].pivot === 'object'))) arrs.push(x); x.slice(0, 3).forEach(y => walk(y, d + 1)); } else if (typeof x === 'object') Object.values(x).forEach(y => walk(y, d + 1)); };
  walk(raw, 0); const list = arrs.sort((a, b) => b.length - a.length)[0] || []; return list.map(x0 => { const pv = x0.pivot && typeof x0.pivot === 'object' ? x0.pivot : null; const x = pv ? Object.assign({}, x0, pv) : x0; const it = x.inventory_item || x.item || x.product || (pv ? x0 : {}); const counted = fcNum(x.quantity ?? x.storage_quantity ?? x.entered_quantity ?? x.counted_quantity ?? x.count ?? x.actual_quantity); const orig = fcNum(x.original_quantity ?? x.system_quantity ?? x.expected_quantity ?? x.theoretical_quantity ?? x.previous_quantity ?? x.before_quantity ?? x.old_quantity ?? x.stock_quantity); const varq = fcNum(x.variance ?? x.variance_quantity ?? x.difference ?? x.diff) ?? (counted != null && orig != null ? Math.round((counted - orig) * 10000) / 10000 : null); return { name: fcName(it) || fcName(x), sku: it.sku || x.sku || '', unit: it.storage_unit || x0.storage_unit || x.unit || '', counted, orig, var: varq, cost: fcNum(x.variance_cost ?? x.cost_variance), c: Object.keys(x).join(',').slice(0, 200) }; }); }
async function readFoodicsCounts() {
  if (!ctx) return; const p = await ctx.newPage(); const out = { at: new Date().toISOString(), list: [] }; let via = null;
  try {
    await p.goto('https://console.foodics.com/inventory/InventoryCounts', { waitUntil: 'domcontentloaded', timeout: 30000 }); await p.waitForTimeout(1500);
    if (/login|auth|signin/i.test(p.url())) throw new Error('needLogin');
    const G = async (u) => p.evaluate(async u => { const r = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, j }; }, u);
    let L = null, counts = [], lu = null; const dig = j => { if (!j) return []; if (Array.isArray(j)) return j; if (Array.isArray(j.data)) return j.data; if (j.data && Array.isArray(j.data.data)) return j.data.data; if (Array.isArray(j.items)) return j.items; return []; };
    for (const u of ['/core-api/listing?url=/inventory_counts&page=1&with_total=true&include[]=branch&include[]=creator', '/core-api/listing?url=/inventory_counts&page=1', '/core-api/listing?url=/inventory_counts&page=1&with_total=true&sort=-created_at', '/core-api/inventory_counts?page=1&include[]=branch', '/core-api/listing?url=/inventory-counts&page=1']) {
      L = await G(u).catch(e => ({ s: 0 })); counts = dig(L.j); FC.probe = Object.assign({}, FC.probe, { listTried: ((FC.probe && FC.probe.listTried) || []).concat([u.split('?')[0] + ':' + L.s + ':' + (L.j ? Object.keys(L.j).join('|').slice(0, 80) : '-') + ':' + counts.length]).slice(-6) }); if (counts.length) { lu = u; break; }
    }
    if (!counts.length) throw new Error('no-counts:' + (L && L.s)); FC.probe.list = lu; FC.probe.countKeys = Object.keys(counts[0]).join(',').slice(0, 300);
    const recent = counts.slice().sort((a, b) => String(b.created_at || b.updated_at || '').localeCompare(String(a.created_at || a.updated_at || ''))).slice(0, 3);
    for (const c of recent) {
      const id = c.id || c.reference; let items = [], tried = [];
      const enc = encodeURIComponent; for (const u of ['/core-api/getting?url=' + enc('/inventory_counts/' + id) + '&include[]=items.inventory_item&include[]=creator&include[]=branch', '/core-api/getting?url=' + enc('/inventory_counts/' + id) + '&include[]=items', '/core-api/getting?url=' + enc('/inventory_counts/' + id), '/core-api/listing?url=' + enc('/inventory_counts/' + id + '/items') + '&include[]=inventory_item&with_total=true', '/core-api/listing?url=' + enc('/inventory_count_items') + '&filter[inventory_count_id]=' + id + '&include[]=inventory_item&with_total=true']) {
        const r = await G(u).catch(e => ({ s: 0 })); const kk = j => !j ? '-' : (Array.isArray(j) ? 'arr' + j.length : Object.keys(j).join('|').slice(0, 60) + (j.data && typeof j.data === 'object' ? ' data:' + (Array.isArray(j.data) ? 'arr' + j.data.length + (j.data[0] ? '{' + Object.keys(j.data[0]).join('|').slice(0, 120) + '}' : '') : Object.keys(j.data).join('|').slice(0, 160)) : '')); tried.push(u.replace(id, '<id>').replace(enc(id), '<id>').slice(0, 90) + ':' + r.s + ':' + kk(r.j)); if (r.s === 200 && r.j) { const dd = r.j.data || r.j; if (dd && dd.items) { const f0 = Array.isArray(dd.items) ? dd.items[0] : (typeof dd.items === 'object' ? Object.values(dd.items)[0] : null); FC.probe = Object.assign({}, FC.probe, { itemsType: Array.isArray(dd.items) ? 'arr' + dd.items.length : typeof dd.items, itemKeys: f0 && typeof f0 === 'object' ? Object.keys(f0).join(',').slice(0, 300) : String(f0).slice(0, 80), pivotKeys: f0 && f0.pivot && typeof f0.pivot === 'object' ? Object.keys(f0.pivot).join(',').slice(0, 300) : null }); } items = fcItems(r.j); if (items.length) { via = u.replace(id, '<id>'); break; } }
      }
      const who = c.creator || c.user || c.created_by || {}; const st = c.status != null ? c.status : (c.submitted_at ? 'submitted' : c.closed_at ? 'closed' : 'draft');
      out.list.push({ id, ref: c.reference || c.number || '', status: st, created_at: c.created_at || null, submitted_at: c.submitted_at || c.closed_at || null, by: who.name || who.full_name || '', branch: c.branch && c.branch.name || '', n: items.length, variances: items.filter(x => x.var).length, items: items.map(x => ({ name: x.name, sku: x.sku, unit: x.unit, counted: x.counted, orig: x.orig, var: x.var, cost: x.cost })), tried: items.length ? undefined : tried, keys: items[0] ? items[0].c : undefined });
    }
    FC.probe = Object.assign({}, FC.probe, { via, keys: (out.list[0] && out.list[0].keys) || null, tried: (out.list[0] && out.list[0].tried) || null, latest: out.list[0] ? { status: out.list[0].status, n: out.list[0].n, items_index: recent[0] && Array.isArray(recent[0].items_index) ? recent[0].items_index.length : null } : null });
    if (out.list[0] && !out.list[0].n && !(FC.probe.pageCalls || []).length) {   // اكتشاف مرة واحدة: أي واجهات تناديها صفحة الجرد في الكونسول (عناوين فقط)
      const calls = []; const q = await ctx.newPage(); q.on('response', r => { const ru = r.url(); if (/core-api|api\./.test(ru) && !/\.(js|css|png|woff)/.test(ru)) calls.push(r.request().method() + ' ' + ru.replace(/https?:\/\/[^/]+/, '').replace(out.list[0].id, '<id>').slice(0, 160) + ' ' + r.status()); });
      try { await q.goto('https://console.foodics.com/inventory/InventoryCounts/' + out.list[0].id, { waitUntil: 'domcontentloaded', timeout: 30000 }); await q.waitForTimeout(8000); } catch (e) { calls.push('err ' + String(e.message || e).slice(0, 80)); } finally { await q.close().catch(() => {}); }
      FC.probe.pageCalls = calls.slice(0, 25);
    } FC.at = out.at; FC.err = null;
    if (GAS && KEY) await gas({ op: 'set', path: 'live/foodics_counts', data: Object.assign({ via }, out) }).catch(e => console.log('gas', e.message));
    const latest = out.list[0]; if (latest && latest.n && !FC.notified.includes(String(latest.id))) {   // جرد جديد (أول مرة نراه): إشعار واحد
      const top = latest.items.filter(x => x.var).sort((a, b) => Math.abs(b.var) - Math.abs(a.var)).slice(0, 3).map(x => x.name + ' ' + (x.var > 0 ? '+' : '') + x.var + (x.unit ? ' ' + x.unit : '')).join('، ');
      await notifyOwner('جرد فودكس', (latest.by ? latest.by + ' · ' : '') + latest.n + ' صنف · ' + latest.variances + ' فرق' + (top ? ' — أكبرها: ' + top : '') + ' · ' + DOCS.fmtDay(latest.submitted_at || latest.created_at || out.at, 'ar').full + ' (' + (latest.status || '') + ')', 'fcount-' + latest.id); FC.notified.push(String(latest.id)); fcSave();
    }
    console.log('foodics counts', out.list.length, 'via', via);
  } catch (e) { FC.err = String(e.message || e).slice(0, 120); FC.at = out.at; console.log('foodics counts err', FC.err); } finally { await p.close().catch(() => {}); }
}
if (require.main !== module) { module.exports = { unitsApply, moveApply, countAdjust, pendingApply, roastMoves, roastUndo, alertsCompute, STAFF_PAGES, DALU, CITEMS, DOCS, docPdf, docSign, docsRead, srv, fcItems }; } else {
srv.listen(+E.PORT || 8080, E.HOST || '::', () => console.log('view up'));
launch().then(() => { setTimeout(poll, 60e3); setInterval(poll, POLL); setTimeout(readFoodicsCounts, 90e3); setInterval(readFoodicsCounts, 10 * 60e3); setTimeout(() => { fastSales(); setInterval(fastSales, FAST); }, 150e3); setInterval(checkReportReq, 60e3); dailyAt(4, syncCustomers); dailyAt(5, () => { try { for (const f of fs.readdirSync(WMDIR)) if (f.endsWith('.json')) { const m = JSON.parse(fs.readFileSync(WMDIR + '/' + f, 'utf8')); if (Date.now() - m.at > 45 * 864e5) { fs.rmSync(WMDIR + '/' + f, { force: true }); fs.rmSync(WMDIR + '/' + f.slice(0, -5), { force: true }); } } } catch (e) {} }); }).catch(e => { console.error(e); process.exit(1); });
}
