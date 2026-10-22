/* أرقام فودكس لحظية: خادم دال يقرأ الكونسول (المنتجات ووصفاتها، المواد، طرق الدفع، الأعداد) كل دقيقتين من جلسة المتصفح السحابي،
   وفودكس المحاسبي كل 10 دقائق، ويكتب live/foodics حين يتغير شيء (وتحديث الوقت كل 10 دقائق ليظهر أن المراقبة شغالة).
   قراءة فقط: طلبات GET داخل الصفحة، لا ضغط ولا حفظ ولا إرسال أي نموذج. */
'use strict';
module.exports = function foodicsLive(d) {
  const { E, gas, getCtx } = d; const KEEP = d.keep; const viewing = d.viewing || (() => false);
  const EVERY = Math.max(30, +E.FX_SEC || 30) * 1000, ACC_EVERY = 10 * 60e3, BEAT = 10 * 60e3;
  const S = { at: null, wrote: null, accAt: 0, err: null, accErr: null, n: 0, busy: false, needLogin: false, last: null };
  const r2 = v => v == null || !isFinite(+v) ? null : Math.round(+v * 100) / 100;
  const ar = s => /[؀-ۿ]/.test(s || '');
  const nm = o => o ? (ar(o.name) ? o.name : ar(o.name_localized) ? o.name_localized : (o.name || o.name_localized || '')).trim() : '';
  const live = a => (a || []).filter(x => !x.deleted_at);

  async function pullConsole(p) {
    if (!/^https:\/\/console\.foodics\.com\//.test(p.url())) { await p.goto('https://console.foodics.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(1500); }   // التبويب الدائم؛ لا تنقّل إن كان على الكونسول
    if (/login|auth|signin/i.test(p.url())) { S.needLogin = true; throw new Error('needLogin'); }
    S.needLogin = false;
    const D = await p.evaluate(async () => {
      const G = async (ep, inc) => { let out = [], pg = 1, last = 1; do { const u = '/core-api/listing?url=/' + ep + '&page=' + pg + '&with_total=true' + (inc || []).map(i => '&include[]=' + i).join('');
        const r = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(ep + ':' + r.status); const j = await r.json(); out = out.concat(j.data || []); last = (j.meta && j.meta.last_page) || 1; pg++; } while (pg <= last && pg < 40); return out; };
      const o = {}; o.products = await G('products', ['ingredients', 'category']); o.items = await G('inventory_items', ['category']); o.pay = await G('payment_methods');
      for (const k of ['discounts', 'users', 'suppliers', 'inventory_counts']) { try { o[k] = await G(k); } catch (e) { o[k] = null; } }
      return o; });
    const items = live(D.items); const idx = new Map(items.map((x, i) => [x.id, i]));
    const products = live(D.products);
    const P = products.map(p => { const ing = p.ingredients || []; let c = null;
      if (ing.length && ing.every(g => g.cost != null)) c = ing.reduce((s, g) => s + (+g.cost) / ((+g.storage_to_ingredient_factor) || 1) * (+((g.pivot || {}).quantity) || 0), 0); else if (p.cost != null) c = +p.cost;
      return [nm(p), nm(p.category), r2(p.price), r2(c), ing.length]; });
    const rec = products.map(p => (p.ingredients || []).filter(g => idx.has(g.id)).map(g => [idx.get(g.id), Math.round((+((g.pivot || {}).quantity) || 0) * 1000) / 1000]));
    const It = items.map(i => [nm(i), i.storage_unit || '', r2(i.cost), nm(i.category)]);
    const iu = items.map(i => [i.ingredient_unit || null, +i.storage_to_ingredient_factor || 1]);
    const U = D.users ? live(D.users) : null;
    const counts = { discounts: D.discounts ? live(D.discounts).length : null, suppliers: D.suppliers ? live(D.suppliers).length : null, users: U ? U.length : null,
      withPin: U ? U.filter(u => u.has_pin).length : null, cashierLogins: U ? U.filter(u => u.last_cashier_login_at).length : null, invCounts: D.inventory_counts ? D.inventory_counts.length : null,
      noMin: items.filter(i => !(+i.minimum_level > 0)).length, cats: new Set(P.map(p => p[1]).filter(Boolean)).size };
    return { products: P, items: It, rec, iu, pay: live(D.pay).map(x => [nm(x), x.type, !!x.is_active]), counts };
  }

  async function pullAcc(p) {   // العدّادات من نص الصفحات (عربي أو إنجليزي)؛ أي فشل يُبقي القراءة السابقة
    const txt = async u => { try { await p.goto(u, { waitUntil: 'commit', timeout: 60000 }); } catch (e) { if (!/interrupted|ERR_ABORTED|Timeout/i.test(String(e.message))) throw e; } for (let i = 0; i < 12; i++) { await p.waitForTimeout(2500); const t = await p.evaluate(() => document.body ? document.body.innerText : '').catch(() => ''); if (/\(\d+\)|\d{2,}|login|تسجيل الدخول/i.test(t) && t.length > 200) break; } if (/login|auth|signin/i.test(p.url())) throw new Error('acc-login ' + p.url().replace(/\?.*/, '').slice(0, 60)); return p.evaluate(() => document.body.innerText); };
    const n = (t, re) => { const m = t.match(re); return m ? +m[1] : null; };
    const a = {};
    a.posInv = n(await txt('https://accounting.foodics.com/pos_transactions/invoices/all'), /(?:الكل|All)\s*\((\d+)\)/);
    a.posDraft = n(await txt('https://accounting.foodics.com/settings/manual_journals/pos/draft'), /(?:إجمالي النتائج|Total results?)\s*:?\s*(\d+)/i);
    a.journals = n(await txt('https://accounting.foodics.com/settings/manual_journals/manual/all'), /(?:الكل|All)\s*\((\d+)\)/);
    await txt('https://accounting.foodics.com/settings/chart_of_accounts/all'); a.accounts = await p.evaluate(() => document.querySelectorAll('table tbody tr').length) || null;
    const w = await txt('https://accounting.foodics.com/wp-connect'); const lines = w.split('\n').map(x => x.trim()).filter(x => /\d{1,2}:\d\d/.test(x)); a.lastSync = lines.length ? lines[lines.length - 1].slice(0, 160) : null;
    if (a.posInv == null && a.posDraft == null && a.journals == null) throw new Error('acc-parse');
    a.at = new Date().toISOString(); return a;
  }

  function diff(o, n) {   // جمل قصيرة بما تغيّر
    const out = []; if (!o) return out;
    const om = new Map((o.products || []).map(p => [p[0], p])), nmap = new Map((n.products || []).map(p => [p[0], p]));
    for (const [k, p] of nmap) { const q = om.get(k); if (!q) out.push('منتج جديد: ' + k + ' بسعر ' + p[2]); else { if (q[2] !== p[2]) out.push('سعر ' + k + ': ' + q[2] + ' ← ' + p[2]); if (q[3] !== p[3] && p[3] != null) out.push('تكلفة ' + k + ': ' + (q[3] == null ? '—' : q[3]) + ' ← ' + p[3]); } }
    for (const k of om.keys()) if (!nmap.has(k)) out.push('حُذف منتج: ' + k);
    const oi = new Map((o.items || []).map(p => [p[0], p])); for (const p of (n.items || [])) { const q = oi.get(p[0]); if (!q) out.push('مادة جديدة: ' + p[0]); else if (q[2] !== p[2] && p[2] != null) out.push('تكلفة مادة ' + p[0] + ': ' + (q[2] == null ? '—' : q[2]) + ' ← ' + p[2]); }
    const L = { discounts: 'الخصومات', suppliers: 'الموردين', users: 'المستخدمين', invCounts: 'عمليات الجرد' };
    for (const [k, t] of Object.entries(L)) { const a = (o.counts || {})[k], b = (n.counts || {})[k]; if (a != null && b != null && a !== b) out.push(t + ': ' + a + ' ← ' + b); }
    return out.slice(0, 40);
  }

  // ---------- مبيعات اليوم من طلبات فودكس: الأكثر مبيعاً، طرق الدفع، ومقارنة أمس بنفس الوقت ----------
  const O = new Map(); let ordAt = 0, ordFull = 0;   // الطلبات المختصرة لآخر يومين عمل (في الذاكرة)
  async function pullOrders(p, full) {
    if (!/^https:\/\/console\.foodics\.com\//.test(p.url())) { await p.goto('https://console.foodics.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(1500); }
    const since = full ? 0 : ordAt - 15 * 60e3;
    return p.evaluate(async (since) => {
      const ar = s => /[؀-ۿ]/.test(s || ''); const nm = o => o ? (ar(o.name) ? o.name : ar(o.name_localized) ? o.name_localized : (o.name || '')) : '';
      const out = []; let pg = 1, last = 1, dates = new Set(), stop = false;
      do {
        const r = await fetch('/core-api/listing?url=/orders&page=' + pg + '&with_total=true&include[]=payments.payment_method&include[]=products.product', { credentials: 'include', headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('orders:' + r.status); const j = await r.json(); last = (j.meta && j.meta.last_page) || 1;
        for (const o of (j.data || [])) {
          dates.add(o.business_date);
          out.push([o.id, o.business_date, o.status, +o.total_price || 0, o.closed_at || o.opened_at || o.created_at,
            (o.payments || []).map(x => [nm(x.payment_method) || (x.payment_method && x.payment_method.name) || '؟', +x.amount || 0]),
            (o.products || []).map(x => [nm(x.product), (+x.quantity || 0) - (+x.returned_quantity || 0), +x.total_price || 0])]);
          if (since && Date.parse((o.updated_at || o.created_at).replace(' ', 'T') + 'Z') < since) stop = true;
        }
        if (dates.size > 2) stop = true;   // تجاوزنا اليومين
        pg++;
      } while (!stop && pg <= last && pg < 60);
      return out;
    }, since);
  }
  const PAY_AR = { cash: 'نقد', card: 'شبكة', mada: 'مدى', visa: 'فيزا', 'master card': 'ماستركارد', mastercard: 'ماستركارد', 'apple pay': 'Apple Pay', tamara: 'تمارا', tabby: 'تابي', jahez: 'جاهز', 'jahez-paid': 'جاهز', 'hunger station': 'هنقرستيشن', 'pullup - pay at store (card)': 'بول أب (شبكة)', 'pullup - pay at store (cash)': 'بول أب (نقد)' };
  const payName = n => PAY_AR[String(n).toLowerCase()] || n;
  function salesDoc() {
    const ds = [...new Set([...O.values()].map(o => o[1]))].sort(); const today = ds[ds.length - 1], yday = ds[ds.length - 2] || null;
    const ts = o => Date.parse(String(o[4]).replace(' ', 'T') + 'Z');
    const cut = Date.now() - 864e5;
    const agg = (list) => { const r = { orders: 0, net: 0, returns: 0, voids: 0 }; for (const o of list) { if (o[2] === 4) { r.orders++; r.net += o[3]; } else if (o[2] === 5) r.returns++; else if (o[2] === 7) r.voids++; } r.net = Math.round(r.net * 100) / 100; r.avg = r.orders ? Math.round(r.net / r.orders * 100) / 100 : null; return r; };
    const T = [...O.values()].filter(o => o[1] === today), Y = yday ? [...O.values()].filter(o => o[1] === yday) : [];
    const pay = {}, prod = {}, hours = Array(24).fill(0);
    for (const o of T) { if (o[2] !== 4) continue;
      for (const [n, a] of o[5]) { const k = payName(n); pay[k] = pay[k] || [k, 0, 0]; pay[k][1]++; pay[k][2] += a; }
      for (const [n, q, v] of o[6]) { if (!n || q <= 0) continue; prod[n] = prod[n] || [n, 0, 0]; prod[n][1] += q; prod[n][2] += v; }
      const h = new Date(ts(o) + 3 * 3600e3).getUTCHours(); hours[h] += o[3]; }
    const rnd = a => a.map(x => [x[0], x[1], Math.round(x[2] * 100) / 100]);
    return { at: new Date().toISOString(), src: 'foodics-orders', today: Object.assign({ date: today }, agg(T)), ySame: yday ? Object.assign({ date: yday }, agg(Y.filter(o => ts(o) <= cut))) : null, yFull: yday ? Object.assign({ date: yday }, agg(Y)) : null,
      payments: rnd(Object.values(pay).sort((a, b) => b[2] - a[2])), products: rnd(Object.values(prod).sort((a, b) => b[1] - a[1] || b[2] - a[2])).slice(0, 15), hours: hours.map(v => Math.round(v)) };
  }
  let lastSalesSig = '';
  async function runOrders() {
    const full = !ordFull || Date.now() - ordFull > 10 * 60e3;
    const rows = await KEEP.withPage('console', p => pullOrders(p, full));
    if (full) O.clear();
    for (const r of rows) O.set(r[0], r);
    const keepD = [...new Set([...O.values()].map(o => o[1]))].sort().slice(-2); for (const [k, o] of O) if (!keepD.includes(o[1])) O.delete(k);
    ordAt = Date.now(); if (full) ordFull = ordAt;
    const doc = salesDoc(); const sig = JSON.stringify([doc.today, doc.payments, doc.products]);
    if (sig !== lastSalesSig || full) { await gas({ op: 'set', path: 'live/sales_fx', data: doc }); lastSalesSig = sig; }
    S.ordN = O.size; S.ordAt = new Date(ordAt).toISOString();
  }

  async function run(force) {
    if (S.busy) return; const ctx = getCtx(); if (!ctx || !gas || !KEEP) return; S.busy = true;
    try {
      const con = await KEEP.withPage('console', p => pullConsole(p));   // من تبويب الكونسول الدائم، بلا تبويبات طارئة
      try { await runOrders(); S.ordErr = null; } catch (e) { S.ordErr = String(e.message || e).slice(0, 80); }
      const cur = S.last || await gas({ op: 'get', paths: ['live/foodics'] }).then(r => { const x = r.docs && r.docs['live/foodics']; return x && x.data || null; }).catch(() => null);
      const old = cur && cur.con || null;
      let acc = cur && cur.acc || null;
      if ((force || Date.now() - S.accAt > ACC_EVERY) && !viewing()) { S.accAt = Date.now(); try { acc = await KEEP.withPage('accounting', async p => { try { return await pullAcc(p); } finally { await p.goto('https://accounting.foodics.com/dashboard', { waitUntil: 'commit', timeout: 60000 }).catch(() => {}); } }); S.accErr = null; } catch (e) { S.accErr = String(e.message || e).slice(0, 80); } }
      const keep = old ? { ask: old.ask, set: old.set, sales: old.sales } : {};
      const counts = Object.assign({}, old && old.counts || {}, con.counts);
      const next = Object.assign({}, keep, con, { counts });
      const sig = JSON.stringify([next.products, next.items, next.pay, next.counts, acc && [acc.posInv, acc.posDraft, acc.journals, acc.accounts, acc.lastSync]]);
      const osig = old ? JSON.stringify([old.products, old.items, old.pay, old.counts, cur.acc && [cur.acc.posInv, cur.acc.posDraft, cur.acc.journals, cur.acc.accounts, cur.acc.lastSync]]) : '';
      const now = new Date().toISOString(); S.at = now; S.n++; S.err = null;
      const changed = sig !== osig;
      if (changed || force || !S.wrote || Date.now() - Date.parse(S.wrote) > BEAT) {
        const ch = changed ? diff(old, next) : null;
        const doc = { at: now, live: true, every: EVERY / 1000, prev: changed ? (cur && cur.at) || null : (cur && cur.prev) || null, chg: ch && ch.length ? ch : (cur && cur.chg) || [], con: next, acc };
        await gas({ op: 'set', path: 'live/foodics', data: doc }); S.wrote = now; S.last = doc;
      }
    } catch (e) { S.err = String(e.message || e).slice(0, 120); }
    finally { S.busy = false; }
  }
  let tm = null;
  return {
    start() { setTimeout(() => run(true), 20e3); setInterval(() => run(false), EVERY); },
    kick() { clearTimeout(tm); tm = setTimeout(() => run(false), 5e3); },   // ويب هوك تغيّر المنيو (حين يُربط تطبيق فودكس)
    run, diff,
    status() { return { paused: S.paused || null, ordN: S.ordN || 0, ordAt: S.ordAt || null, ordErr: S.ordErr || null, at: S.at, wrote: S.wrote, n: S.n, err: S.err, accErr: S.accErr, needLogin: S.needLogin, every: EVERY / 1000 }; },
  };
};
