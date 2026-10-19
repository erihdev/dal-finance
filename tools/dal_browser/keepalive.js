/* إبقاء الجلسات حيّة: تبويب ثابت لكل منصة في المتصفح السحابي يُحدَّث كل 30 ثانية (قراءة فقط، بلا ضغط ولا إرسال)،
   فيبقى الموقع يرى نشاطاً ويجدّد مفاتيحه بنفسه. إن ظهرت صفحة تسجيل الدخول: إشعار للمالك مرة واحدة لكل انقطاع.
   فودكس الكونسول يقرؤه foodics_live كل 30 ثانية، ورتم له تبويبه اللحظي؛ هنا البقية. */
'use strict';
module.exports = function keepAlive(d) {
  const { E, getCtx, notify } = d; const viewing = d.viewing || (() => false);
  const EVERY = Math.max(30, +E.KEEP_SEC || 30) * 1000;
  const SITES = [
    { k: 'accounting', name: 'فودكس المحاسبي', url: 'https://accounting.foodics.com/dashboard', login: /\/login|signin/i },
    { k: 'tamara', name: 'تمارا', url: 'https://partners.tamara.co/#/transaction/list', login: /login|signin|auth\b/i },
    { k: 'bonat', name: 'بونات', url: 'https://store.bonat.io/', login: /\/login|signin/i },
    { k: 'salla', name: 'سلة', url: 'https://s.salla.sa/', login: /accounts\.salla|\/login|signin/i },
  ];
  const P = {}, S = {}; let busy = false;
  const isLogin = async (s, p) => { const u = p.url(); if (s.login.test(u)) return true;
    const t = await p.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 800)).catch(() => '');
    return /تسجيل الدخول|كلمة المرور|Sign in|Log in|Password/i.test(t) && !/تسجيل الخروج|Logout|Log out/i.test(t) && t.length < 800; };
  async function one(s, ctx) {
    const st = S[s.k] = S[s.k] || { ok: null, at: null, err: null, since: null, told: false };
    try {
      let p = P[s.k];
      if (!p || p.isClosed()) { p = P[s.k] = await ctx.newPage(); await p.goto(s.url, { waitUntil: 'commit', timeout: 60000 }).catch(() => {}); }
      else if (st.ok === false) await p.goto(s.url, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});   // كان على صفحة الدخول: نعود للموقع (بعد نقل الجلسة يفتح)
      else await p.reload({ waitUntil: 'commit', timeout: 60000 }).catch(() => {});
      await p.waitForTimeout(6000);
      const out = await isLogin(s, p);
      st.at = new Date().toISOString(); st.err = null;
      if (out) { if (st.ok !== false) st.since = st.at; st.ok = false;
        if (!st.told && notify) { st.told = true; notify('جلسة ' + s.name + ' انتهت', 'افتح إضافة «د» في كروم اللاب واضغط «انقل الجلسات الآن» (أو انتظر النقل التلقائي).', 'warning').catch(() => {}); }
      } else { st.ok = true; st.since = null; st.told = false; }
    } catch (e) { st.err = String(e.message || e).slice(0, 100); try { if (P[s.k]) await P[s.k].close(); } catch (x) {} P[s.k] = null; }
  }
  async function tick() {
    if (busy || viewing()) return; const ctx = getCtx(); if (!ctx) return; busy = true;
    try { for (const s of SITES) await one(s, ctx); } finally { busy = false; }
  }
  return {
    start() { setTimeout(tick, 120e3); setInterval(tick, EVERY); },
    status() { const o = {}; for (const s of SITES) o[s.k] = S[s.k] || null; return o; },
    needLogin() { return SITES.filter(s => S[s.k] && S[s.k].ok === false).map(s => s.name); },
  };
};
