/* تبويبات دائمة في المتصفح السحابي: فودكس الكونسول، فودكس المحاسبي، تمارا، بونات، سلة، علو (+ رتم في تبويبه اللحظي في main.js).
   تُفتح فور تشغيل الخادم، وتُحدَّث كل 30 ثانية (قراءة فقط، بلا ضغط ولا إرسال)، ولا تُغلق أبداً: عند أي خطأ يُعاد تحميل التبويب نفسه.
   القرّاء الآخرون (أرقام فودكس، القارئ العام) يقرؤون من هذه التبويبات نفسها عبر withPage بقفل لكل تبويب، فلا تُفتح تبويبات طارئة.
   إن ظهرت صفحة تسجيل الدخول: إشعار للمالك مرة واحدة لكل انقطاع. */
'use strict';
module.exports = function keepAlive(d) {
  const { E, getCtx, notify } = d; const viewing = d.viewing || (() => false);
  const EVERY = Math.max(30, +E.KEEP_SEC || 30) * 1000;
  const SITES = [
    { k: 'console', name: 'فودكس', url: 'https://console.foodics.com/', login: /\/login|signin|auth\b/i },
    { k: 'accounting', name: 'فودكس المحاسبي', url: 'https://accounting.foodics.com/dashboard', login: /\/login|signin/i },
    { k: 'tamara', name: 'تمارا', url: 'https://partners.tamara.co/#/transaction/list', login: /login|signin|auth\b/i },
    { k: 'bonat', name: 'بونات', url: 'https://store.bonat.io/', login: /\/login|signin/i },
    { k: 'salla', name: 'سلة', url: 'https://s.salla.sa/', login: /accounts\.salla|\/login|signin/i },
    { k: 'olu', name: 'علو', url: 'https://hr.olu.sa/', login: /\/login|signin|auth\b/i },
  ];
  const BY = Object.fromEntries(SITES.map(s => [s.k, s]));
  const P = {}, S = {}, LOCK = {};
  const isLogin = async (s, p) => { const u = p.url(); if (s.login.test(u)) return true;
    const t = await p.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 800)).catch(() => '');
    return /تسجيل الدخول|كلمة المرور|Sign in|Log in|Password/i.test(t) && !/تسجيل الخروج|Logout|Log out/i.test(t) && t.length < 800; };
  const W = {};   // القنوات اللحظية المكتشفة: عنوان خادم المقبس فقط وأسماء مكتبات البث — بلا قراءة أي محتوى
  function watch(s, p) { const w = W[s.k] = W[s.k] || { ws: {}, libs: null };
    p.on('websocket', ws => { let h = ''; try { const u = new URL(ws.url()); h = u.host + u.pathname.slice(0, 40); } catch (e) { h = String(ws.url()).slice(0, 60); } w.ws[h] = (w.ws[h] || 0) + 1; });
    p.on('load', async () => { w.libs = await p.evaluate(() => ['Pusher', 'Echo', 'io', 'firebase', 'Ably', 'signalR', 'Centrifuge', 'socket', 'mqtt'].filter(k => typeof window[k] !== 'undefined')).catch(() => null); }); }
  // التبويب الدائم للموقع: يُنشأ مرة واحدة، ولا يُعاد إنشاؤه إلا إن أغلقه المتصفح نفسه (انهيار)
  async function pageOf(s) { const ctx = getCtx(); if (!ctx) return null; let p = P[s.k];
    if (!p || p.isClosed()) { p = P[s.k] = await ctx.newPage(); watch(s, p); S[s.k] = Object.assign(S[s.k] || {}, { opened: new Date().toISOString() }); await p.goto(s.url, { waitUntil: 'commit', timeout: 60000 }).catch(() => {}); }
    return p; }
  // قفل لكل تبويب: التحديث الدوري والقرّاء الآخرون لا يتصادمون على نفس التبويب
  function withPage(k, fn) { const s = BY[k]; if (!s) return Promise.reject(new Error('no-site'));
    const run = (LOCK[k] || Promise.resolve()).then(async () => { const p = await pageOf(s); if (!p) throw new Error('no-browser'); return fn(p, s); });
    LOCK[k] = run.catch(() => {}); return run; }
  async function one(s) {
    const st = S[s.k] = S[s.k] || {};
    await withPage(s.k, async p => {
      try {
        if (st.ok === false || !s.login.test(p.url()) && !String(p.url()).startsWith(new URL(s.url).origin)) await p.goto(s.url, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});   // كان على صفحة الدخول أو خرج من الموقع: نعود
        else await p.reload({ waitUntil: 'commit', timeout: 60000 }).catch(() => {});
        await p.waitForTimeout(6000);
        const out = await isLogin(s, p);
        st.at = new Date().toISOString(); st.err = null;
        if (out) { if (st.ok !== false) st.since = st.at; st.ok = false;
          if (!st.told && notify) { st.told = true; notify('جلسة ' + s.name + ' انتهت', 'افتح إضافة «د» في كروم اللاب واضغط «انقل الجلسات الآن» (أو انتظر النقل التلقائي).', 'warning').catch(() => {}); }
        } else { st.ok = true; st.since = null; st.told = false; }
      } catch (e) { st.err = String(e.message || e).slice(0, 100); }   // لا إغلاق: الدورة التالية تعيد تحميل التبويب نفسه
    }).catch(e => { st.err = String(e.message || e).slice(0, 100); });
  }
  let busy = false;
  async function tick(force) { if (busy || (!force && viewing())) return; if (!getCtx()) return; busy = true;
    try { for (const s of SITES) await one(s); } finally { busy = false; } }
  async function openAll() { for (const s of SITES) await withPage(s.k, async () => {}).catch(() => {}); }   // فتح الستة فوراً بلا انتظار
  return {
    start() { openAll().then(() => tick(true)); setInterval(() => tick(false), EVERY); },
    withPage, has: k => !!BY[k],
    status() { const o = {}; for (const s of SITES) o[s.k] = Object.assign({ open: !!(P[s.k] && !P[s.k].isClosed()) }, S[s.k] || {}, { rt: W[s.k] || null }); return o; },
    needLogin() { return SITES.filter(s => S[s.k] && S[s.k].ok === false).map(s => s.name); },
  };
};
