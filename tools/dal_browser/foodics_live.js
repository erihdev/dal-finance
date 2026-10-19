/* أرقام فودكس لحظية: خادم دال يقرأ الكونسول (المنتجات ووصفاتها، المواد، طرق الدفع، الأعداد) كل دقيقتين من جلسة المتصفح السحابي،
   وفودكس المحاسبي كل 10 دقائق، ويكتب live/foodics حين يتغير شيء (وتحديث الوقت كل 10 دقائق ليظهر أن المراقبة شغالة).
   قراءة فقط: طلبات GET داخل الصفحة، لا ضغط ولا حفظ ولا إرسال أي نموذج. */
'use strict';
module.exports = function foodicsLive(d) {
  const { E, gas, getCtx } = d; const viewing = d.viewing || (() => false);
  const EVERY = Math.max(30, +E.FX_SEC || 30) * 1000, ACC_EVERY = 10 * 60e3, BEAT = 10 * 60e3;
  const S = { at: null, wrote: null, accAt: 0, err: null, accErr: null, n: 0, busy: false, needLogin: false, last: null };
  const r2 = v => v == null || !isFinite(+v) ? null : Math.round(+v * 100) / 100;
  const ar = s => /[؀-ۿ]/.test(s || '');
  const nm = o => o ? (ar(o.name) ? o.name : ar(o.name_localized) ? o.name_localized : (o.name || o.name_localized || '')).trim() : '';
  const live = a => (a || []).filter(x => !x.deleted_at);

  async function pullConsole(p) {
    await p.goto('https://console.foodics.com/inventory/Items', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(1500);
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
    const txt = async u => { try { await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch (e) { if (!/interrupted|ERR_ABORTED/i.test(String(e.message))) throw e; } await p.waitForTimeout(5000); if (/login|auth|signin/i.test(p.url())) throw new Error('acc-login ' + p.url().replace(/\?.*/, '').slice(0, 60)); return p.evaluate(() => document.body.innerText); };
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

  async function run(force) {
    if (S.busy) return; if (viewing()) { S.paused = new Date().toISOString(); return; }   // لا نفتح تبويبات وأنت تستخدم شاشة المتصفح
    const ctx = getCtx(); if (!ctx || !gas) return; S.busy = true; let p = null;
    try {
      p = await ctx.newPage(); const con = await pullConsole(p);
      const cur = S.last || await gas({ op: 'get', paths: ['live/foodics'] }).then(r => { const x = r.docs && r.docs['live/foodics']; return x && x.data || null; }).catch(() => null);
      const old = cur && cur.con || null;
      let acc = cur && cur.acc || null;
      if (force || Date.now() - S.accAt > ACC_EVERY) { S.accAt = Date.now(); try { acc = await pullAcc(p); S.accErr = null; } catch (e) { S.accErr = String(e.message || e).slice(0, 80); } }
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
    finally { if (p) await p.close().catch(() => {}); S.busy = false; }
  }
  let tm = null;
  return {
    start() { setTimeout(() => run(true), 90e3); setInterval(() => run(false), EVERY); },
    kick() { clearTimeout(tm); tm = setTimeout(() => run(false), 5e3); },   // ويب هوك تغيّر المنيو (حين يُربط تطبيق فودكس)
    run, diff,
    status() { return { paused: S.paused || null, at: S.at, wrote: S.wrote, n: S.n, err: S.err, accErr: S.accErr, needLogin: S.needLogin, every: EVERY / 1000 }; },
  };
};
