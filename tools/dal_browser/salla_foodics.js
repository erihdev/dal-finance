// ===== جسر سلة → فودكس: كل طلب سلة مدفوع يدخل فودكس كطلب (قناة واجهة برمجية) مع دفعته، فيخصم المخزون ويدخل المبيعات بعد إقفاله على الكاشير =====
// يُحقن بالاعتماديات من main.js (لا يقرأ البيئة مباشرة) ليُختبر بخادم فودكس وهمي.
'use strict';
const crypto = require('crypto');
module.exports = function sallaFoodics(d) {
  const { E, fs, gas, notifyOwner, sallaApi, readBody, log = console.log } = d;
  const DIR = d.dir || '/data';
  const API = (E.FOODICS_API || 'https://api.foodics.com/v5').replace(/\/$/, '');
  const OAUTH = E.FOODICS_OAUTH || 'https://api.foodics.com/oauth/token';
  const AUTHZ = E.FOODICS_AUTHZ || 'https://console.foodics.com/authorize';
  const REDIRECT = E.FOODICS_REDIRECT || 'https://browser-production-10fb.up.railway.app/foodics/callback';
  const PAID = new Set((E.SALLA_PAID_STATUSES || 'in_progress,completed,delivering,delivered,shipped').split(','));   // حالات سلة التي تعني «مدفوع»
  const rd = (f, def) => { try { return Object.assign(def, JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8'))); } catch (e) { return def; } };
  const wr = (f, o) => { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(DIR + '/' + f, JSON.stringify(o)); } catch (e) { log('sf save ERR', f, e.message); } };
  let TOK = rd('foodics_oauth.json', {});                                   // {access, exp, at, business}
  let CFG = rd('sf_cfg.json', { branch: null, branchName: '', pay: null, map: {}, auto: true });   // map: معرّف منتج سلة → {fid, fname, sname, sku}
  let ST = rd('sf_state.json', { orders: {}, at: null, err: null, notified: [] }); // orders: معرّف طلب سلة → سجل الدفع
  const PENDING_STATE = new Map();                                           // state → وقت الإنشاء (حماية CSRF لتفويض فودكس)
  let syncing = null, timer = null, CAT = null;

  // ---------- فودكس ----------
  function jwtExp(t) { try { const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); return p.exp ? p.exp * 1000 : null; } catch (e) { return null; } }
  const linked = () => !!(TOK.access && (!TOK.exp || TOK.exp > Date.now()));
  async function fx(method, path, body) {
    if (!linked()) throw new Error('foodics-not-linked');
    const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + TOK.access, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    if (r.status === 401) { TOK.err = 'unauthorized'; wr('foodics_oauth.json', TOK); }
    if (!r.ok) { const e = new Error('foodics-' + r.status + ' ' + (j && (j.message || (j.errors && JSON.stringify(j.errors).slice(0, 200))) || t.slice(0, 120))); e.status = r.status; e.body = j; throw e; }
    return j;
  }
  async function fxAll(path) {   // كل الصفحات (meta.last_page)
    let out = [], page = 1, last = 1;
    do { const j = await fx('GET', path + (path.includes('?') ? '&' : '?') + 'page=' + page); out = out.concat(j.data || []); last = (j.meta && j.meta.last_page) || 1; page++; } while (page <= last && page < 40);
    return out;
  }
  const arName = o => { if (!o) return ''; const ar = s => /[؀-ۿ]/.test(s || ''); return (ar(o.name) ? o.name : ar(o.name_localized) ? o.name_localized : (o.name || o.name_localized || '')).trim(); };
  async function exchange(code) {
    const r = await fetch(OAUTH, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: E.FOODICS_CLIENT_ID || '', client_secret: E.FOODICS_CLIENT_SECRET || '', redirect_uri: REDIRECT }) });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Error('foodics-token-' + r.status + ' ' + (j.error || j.message || ''));
    TOK = { access: j.access_token, exp: j.expires_in ? Date.now() + (+j.expires_in) * 1000 : jwtExp(j.access_token), at: Date.now() };
    try { const w = await fx('GET', '/whoami'); const b = w && w.data && (w.data.business || w.data); TOK.business = b && (b.name || b.reference || '') || ''; } catch (e) {}
    wr('foodics_oauth.json', TOK); log('foodics token saved; exp', TOK.exp ? new Date(TOK.exp).toISOString().slice(0, 10) : '—');
    return TOK;
  }
  async function ensureBranch() {   // فرع واحد نشط → يُختار تلقائياً؛ أكثر → المالك يختار
    if (CFG.branch) return CFG.branch;
    const bs = (await fxAll('/branches')).filter(b => !b.deleted_at);
    CFG.branches = bs.map(b => ({ id: b.id, name: arName(b), online: !!b.receives_online_orders }));
    if (bs.length === 1) { CFG.branch = bs[0].id; CFG.branchName = arName(bs[0]); wr('sf_cfg.json', CFG); }
    return CFG.branch;
  }
  async function ensurePay() {   // طريقة دفع من النوع 7 (واجهة برمجية) باسم «سلة»؛ تُنشأ إن لم توجد
    if (CFG.pay) return CFG.pay;
    const ms = (await fxAll('/payment_methods')).filter(m => !m.deleted_at);
    let m = ms.find(x => +x.type === 7 && /سلة|salla/i.test((x.name || '') + ' ' + (x.name_localized || ''))) || ms.find(x => +x.type === 7);
    if (!m) { try { const j = await fx('POST', '/payment_methods', { name: 'سلة', name_localized: 'Salla', type: 7 }); m = j && j.data; } catch (e) { throw new Error('pay-method: ' + e.message); } }
    if (!m) throw new Error('no-pay-method');
    CFG.pay = m.id; CFG.payName = arName(m); wr('sf_cfg.json', CFG); return CFG.pay;
  }

  // ---------- الكتالوج والربط ----------
  const norm = s => String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/(\d+)\s*(كيلو ?غرام|كيلو|كجم|كغ|kg)(?=\s|$)/g, '$1 كجم').replace(/(\d+)\s*(غرام|جرام|جم|غ|g|gm)(?=\s|$)/g, '$1 جم').replace(/\s+/g, ' ').trim();
  function suggest(sp, fps) {   // اقتراح منتج فودكس لمنتج سلة: نفس SKU، وإلا نفس الاسم المطبّع، وإلا احتواء الاسم مع نفس الوزن
    const sku = String(sp.sku || '').trim();
    if (sku) { const m = fps.find(f => String(f.sku || '').trim().toLowerCase() === sku.toLowerCase()); if (m) return { fid: m.id, why: 'sku' }; }
    const n = norm(sp.name); if (!n) return null;
    let m = fps.find(f => norm(f.name) === n || norm(f.name_localized) === n); if (m) return { fid: m.id, why: 'name' };
    const w = (n.match(/\d+\s*(كجم|كيلو|غ|جم|جرام|kg|g)\b/) || [])[0];
    const cands = fps.filter(f => { const fn = norm(f.name) + ' ' + norm(f.name_localized); return (fn.includes(n) || n.includes(norm(f.name))) && (!w || fn.includes(w)); });
    return cands.length === 1 ? { fid: cands[0].id, why: 'contains' } : null;
  }
  async function catalog() {   // منتجات سلة ومنتجات فودكس + اقتراحات؛ يُحفظ في live/sf_catalog لبطاقة المالك
    const sps = []; let page = 1, pages = 1;
    do { const j = await sallaApi('/admin/v2/products?per_page=50&page=' + page); for (const p of (j.data || [])) sps.push({ id: String(p.id), name: p.name, sku: p.sku || '', price: p.price && (p.price.amount != null ? p.price.amount : p.price), status: p.status }); pages = (j.pagination && j.pagination.totalPages) || 1; page++; } while (page <= pages && page < 20);
    const fps = (await fxAll('/products?include=category')).filter(p => !p.deleted_at).map(p => ({ id: p.id, name: arName(p), name_localized: p.name_localized || '', sku: p.sku || '', price: p.price != null ? +p.price : null, active: p.is_active !== false, category: arName(p.category) }));
    let added = 0;
    for (const sp of sps) { if (CFG.map[sp.id]) continue; const s = suggest(sp, fps); if (s) { const f = fps.find(x => x.id === s.fid); CFG.map[sp.id] = { fid: f.id, fname: f.name, sname: sp.name, sku: sp.sku, why: s.why }; added++; } }
    if (added) wr('sf_cfg.json', CFG);
    const out = { at: new Date().toISOString(), salla: sps, foodics: fps.map(f => ({ id: f.id, name: f.name, sku: f.sku, price: f.price, category: f.category, active: f.active })), map: CFG.map };
    CAT = out; try { await gas({ op: 'set', path: 'live/sf_catalog', data: out }); } catch (e) { log('gas sf_catalog', e.message); }
    return out;
  }

  // ---------- المزامنة ----------
  const uuid5 = s => { const h = crypto.createHash('sha1').update('dal-salla-foodics:' + s).digest(); h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80; const x = h.toString('hex'); return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20, 32); };
  const amt = v => typeof v === 'number' ? v : (v && typeof v === 'object' && v.amount != null ? +v.amount : (parseFloat(v) || 0));
  const r2 = n => Math.round(n * 100) / 100;
  function buildOrder(o, items) {   // من طلب سلة (تفاصيله) إلى جسم طلب فودكس؛ يرجع {body, unmapped[]}
    const unmapped = [], products = [];
    for (const it of items) {
      const sid = String((it.product && it.product.id) || it.product_id || ''); const m = CFG.map[sid];
      const q = +it.quantity || 1; const line = amt(it.amounts && it.amounts.total) || amt(it.total) || (amt(it.amounts && it.amounts.price_without_tax) + amt(it.amounts && it.amounts.tax && it.amounts.tax.amount)) * q;
      if (!m) { unmapped.push({ sid, name: it.name || '', sku: (it.product && it.product.sku) || it.sku || '' }); continue; }
      products.push({ product_id: m.fid, quantity: q, unit_price: r2(line / q), meta: { salla_item: String(it.id || '') } });
    }
    const ship = o.shipping && (o.shipping.type || o.shipping.method || '');
    const body = { type: /pickup|branch|استلام/i.test(String(ship)) ? 2 : 3, branch_id: CFG.branch, products, customer_notes: ('سلة ' + (o.reference_id || o.id) + (o.customer && o.customer.first_name ? ' · ' + [o.customer.first_name, o.customer.last_name].filter(Boolean).join(' ') : '')).slice(0, 190), meta: { external_number: 'سلة-' + (o.reference_id || o.id), salla_id: String(o.id), salla_ref: String(o.reference_id || '') } };
    return { body, unmapped };
  }
  async function pushOne(o) {   // يدفع طلباً واحداً؛ يرجع سجل الحالة
    const rec = { ref: String(o.reference_id || o.id), at: new Date().toISOString(), date: String(o.date && (o.date.date || o.date) || '').slice(0, 19), status: 'err', total: r2(amt(o.amounts && o.amounts.total) || amt(o.total)), slug: (o.status && (o.status.slug || o.status.name)) || '' };
    try {
      const det = await sallaApi('/admin/v2/orders/' + o.id); const od = det.data || o; const items = od.items || [];
      if (!items.length) { rec.status = 'err'; rec.err = 'no-items'; return rec; }
      const { body, unmapped } = buildOrder(od, items);
      rec.items = body.products.length + unmapped.length; rec.lines = items.map(it => (it.name || '') + ' ×' + (it.quantity || 1)).slice(0, 12);
      if (unmapped.length) { rec.status = 'unmapped'; rec.unmapped = unmapped; return rec; }
      await ensureBranch(); if (!CFG.branch) { rec.status = 'err'; rec.err = 'no-branch'; return rec; }
      body.branch_id = CFG.branch;
      let total = null; try { const c = await fx('POST', '/orders_calculator', body); total = c && c.data && c.data.total_price != null ? +c.data.total_price : null; } catch (e) { rec.calc = e.message.slice(0, 100); }
      if (total == null) total = r2(body.products.reduce((s, p) => s + p.unit_price * p.quantity, 0));
      rec.ftotal = r2(total); rec.diff = r2(rec.total - rec.ftotal);
      const pay = await ensurePay(); body.payments = [{ amount: rec.ftotal, tendered: rec.ftotal, payment_method_id: pay, tips: 0, meta: { salla_payment: String((o.payment_method && (o.payment_method.name || o.payment_method)) || '') } }];
      let j; try { j = await fx('POST', '/orders', Object.assign({ id: uuid5(o.id) }, body)); } catch (e) { if (e.status === 422 && /\bid\b/.test(JSON.stringify(e.body || '')) ) j = await fx('POST', '/orders', body); else throw e; }
      const fo = j && j.data || {}; rec.fid = fo.id || null; rec.fref = fo.reference || fo.number || null; rec.status = 'ok'; rec.err = null;
      return rec;
    } catch (e) { rec.err = String(e.message || e).slice(0, 160); rec.tries = ((ST.orders[String(o.id)] || {}).tries || 0) + 1; return rec; }
  }
  async function sync(reason) {   // كل 10 دقائق وبعد أي حدث من سلة: الطلبات المدفوعة في آخر 3 أيام التي لم تُدفع لفودكس
    if (syncing) return syncing; syncing = (async () => {
      const out = { at: new Date().toISOString(), reason: reason || 'timer', pushed: 0, skipped: 0, errors: 0, unmapped: 0 };
      try {
        if (!linked()) throw new Error('foodics-not-linked');
        if (CFG.auto === false) throw new Error('paused');
        const to = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), from = new Date(Date.now() + 3 * 3600e3 - 3 * 864e5).toISOString().slice(0, 10);
        let page = 1, pages = 1, list = [];
        do { const j = await sallaApi(`/admin/v2/orders?from_date=${from}&to_date=${to}&per_page=50&page=${page}`); list = list.concat(j.data || []); pages = (j.pagination && j.pagination.totalPages) || 1; page++; } while (page <= pages && page < 10);
        for (const o of list) {
          const id = String(o.id), slug = (o.status && (o.status.slug || o.status.name)) || ''; const prev = ST.orders[id];
          if (!PAID.has(slug)) { if (!prev) { ST.orders[id] = { ref: String(o.reference_id || id), at: new Date().toISOString(), status: 'skip', slug, total: r2(amt(o.amounts && o.amounts.total)) }; out.skipped++; } else if (prev.status === 'skip') prev.slug = slug; continue; }
          if (prev && (prev.status === 'ok' || (prev.status === 'err' && (prev.tries || 0) >= 5))) continue;
          if (prev && prev.status === 'unmapped') { const still = (prev.unmapped || []).some(u => !CFG.map[u.sid]); if (still) { out.unmapped++; continue; } }
          const rec = await pushOne(o); ST.orders[id] = rec;
          if (rec.status === 'ok') out.pushed++; else if (rec.status === 'unmapped') out.unmapped++; else out.errors++;
          if (rec.status === 'unmapped' && !ST.notified.includes('um-' + id)) { await notifyOwner('سلة ← فودكس', 'طلب ' + rec.ref + ' فيه منتج غير مربوط بفودكس: ' + rec.unmapped.map(u => u.name).join('، ') + ' — اربطه من بطاقة «سلة ↔ فودكس»', 'sf-um-' + id); ST.notified.push('um-' + id); }
          if (rec.status === 'err' && (rec.tries || 0) === 5 && !ST.notified.includes('er-' + id)) { await notifyOwner('سلة ← فودكس', 'تعذّر إدخال طلب ' + rec.ref + ' في فودكس: ' + rec.err, 'sf-er-' + id); ST.notified.push('er-' + id); }
        }
        ST.err = null;
      } catch (e) { ST.err = String(e.message || e).slice(0, 140); out.err = ST.err; }
      ST.at = out.at; ST.last = out; ST.notified = ST.notified.slice(-200);
      const ids = Object.keys(ST.orders).sort((a, b) => (ST.orders[b].at || '').localeCompare(ST.orders[a].at || '')); for (const k of ids.slice(400)) delete ST.orders[k];
      wr('sf_state.json', ST); await publish().catch(() => {});
      log('salla→foodics', JSON.stringify(out));
      return out;
    })().finally(() => { syncing = null; });
    return syncing;
  }
  function status() {
    const os = Object.values(ST.orders); const recent = os.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 60);
    return { linked: linked(), tokenExp: TOK.exp || null, business: TOK.business || '', tokenErr: TOK.err || null, hasClient: !!E.FOODICS_CLIENT_ID, redirect: REDIRECT, branch: CFG.branch, branchName: CFG.branchName || '', branches: CFG.branches || null, pay: CFG.pay, payName: CFG.payName || '', auto: CFG.auto !== false, mapped: Object.keys(CFG.map).length, at: ST.at, err: ST.err, last: ST.last || null, counts: { ok: os.filter(x => x.status === 'ok').length, unmapped: os.filter(x => x.status === 'unmapped').length, err: os.filter(x => x.status === 'err').length, skip: os.filter(x => x.status === 'skip').length }, recent };
  }
  async function publish() { if (!gas) return; await gas({ op: 'set', path: 'live/salla_foodics', data: status() }); }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => sync('event').catch(() => {}), ms || 20e3); }

  // ---------- المسارات ----------
  async function route(req, res, authed) {   // يرجع true إن عالج الطلب
    const u = new URL(req.url, 'http://x'); const p = u.pathname; const J = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
    if (p === '/foodics/callback') {   // عام: عودة تفويض فودكس
      try { const code = u.searchParams.get('code'), st = u.searchParams.get('state'); if (!code) throw new Error('no-code'); if (!st || !PENDING_STATE.has(st)) throw new Error('bad-state'); PENDING_STATE.delete(st); await exchange(code); await ensureBranch().catch(() => {}); await publish().catch(() => {}); schedule(5e3);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<meta charset=utf-8><body style="font-family:sans-serif;direction:rtl;text-align:center;padding:40px;background:#FFF7F0"><h2>تم ربط فودكس</h2><p>' + (TOK.business ? 'الحساب: ' + TOK.business + '<br>' : '') + 'أغلق هذه الصفحة وارجع للتطبيق.</p></body>'); }
      catch (e) { res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<meta charset=utf-8><body style="font-family:sans-serif;direction:rtl;text-align:center;padding:40px"><h2>تعذّر ربط فودكس</h2><p>' + String(e.message || e).replace(/[<>]/g, '') + '</p></body>'); }
      return true;
    }
    if (!p.startsWith('/foodics/')) return false;
    if (!authed) { J(401, { ok: false, err: 'auth' }); return true; }
    if (p === '/foodics/connect') {   // يبدأ التفويض: تحويل المالك لصفحة فودكس
      if (!E.FOODICS_CLIENT_ID) { J(400, { ok: false, err: 'FOODICS_CLIENT_ID غير مضبوط في Railway' }); return true; }
      const st = crypto.randomBytes(12).toString('hex'); PENDING_STATE.set(st, Date.now()); for (const [k, v] of PENDING_STATE) if (Date.now() - v > 900e3) PENDING_STATE.delete(k);
      res.writeHead(302, { Location: AUTHZ + '?client_id=' + encodeURIComponent(E.FOODICS_CLIENT_ID) + '&state=' + st + '&redirect_uri=' + encodeURIComponent(REDIRECT) }); res.end(); return true;
    }
    if (p === '/foodics/status') { J(200, status()); return true; }
    if (p === '/foodics/catalog') { try { J(200, await catalog()); } catch (e) { J(500, { ok: false, err: String(e.message || e) }); } return true; }
    if (p === '/foodics/map' && req.method === 'POST') {   // {map:{sid:{fid,fname,sname,sku}|null}, branch?, pay?, auto?}
      try { const j = JSON.parse(await readBody(req, 2e5) || '{}'); if (j.map && typeof j.map === 'object') for (const [k, v] of Object.entries(j.map)) { if (!v) delete CFG.map[k]; else CFG.map[k] = { fid: String(v.fid), fname: String(v.fname || '').slice(0, 120), sname: String(v.sname || '').slice(0, 120), sku: String(v.sku || '').slice(0, 60), why: 'owner' }; }
        if (j.branch !== undefined) { CFG.branch = j.branch || null; CFG.branchName = String(j.branchName || '').slice(0, 80); } if (j.pay !== undefined) { CFG.pay = j.pay || null; CFG.payName = String(j.payName || '').slice(0, 80); } if (typeof j.auto === 'boolean') CFG.auto = j.auto;
        wr('sf_cfg.json', CFG); if (CAT) { CAT.map = CFG.map; try { await gas({ op: 'set', path: 'live/sf_catalog', data: CAT }); } catch (e) {} } await publish().catch(() => {}); schedule(3e3); J(200, { ok: true, mapped: Object.keys(CFG.map).length }); }
      catch (e) { J(400, { ok: false, err: String(e.message || e) }); } return true;
    }
    if (p === '/foodics/sync' && req.method === 'POST') { try { J(200, await sync('manual')); } catch (e) { J(500, { ok: false, err: String(e.message || e) }); } return true; }
    if (p === '/foodics/unlink' && req.method === 'POST') { TOK = {}; wr('foodics_oauth.json', TOK); await publish().catch(() => {}); J(200, { ok: true }); return true; }
    J(404, { ok: false }); return true;
  }
  function start() { setTimeout(() => sync('boot').catch(() => {}), 120e3); setInterval(() => sync('timer').catch(() => {}), 10 * 60e3); }
  return { route, sync, status, catalog, buildOrder, suggest, schedule, start, linked, _cfg: () => CFG, _state: () => ST, _tok: () => TOK };
};
