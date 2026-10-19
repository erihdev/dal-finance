/* تحميص العملاء (سلو والعملاء الذين يحضرون بنّهم) — المنطق الخالص، يُستخدم في الخادم والاختبارات.
   المستند live/roast_ext: { at, custs:[{id,name,at,by}], list:[{id, at, by, t:'in'|'roast'|'out', cust:{id,name}, coffee, g, r, kg, sacks, bags, n, doc}] }
   in: بن أخضر استلمناه من العميل (g كجم، sacks خيش) → سند XRC.  roast: دفعة تحميص (g أخضر استُخدم ← r محمّص).  out: محمّص سُلّم للعميل (kg، bags) → سند XDL.
   الأرصدة لكل عميل ومحصول: أخضر عندنا = Σin.g − Σroast.g ؛ محمّص جاهز = Σroast.r − Σout.kg.  بلا أسعار ولا أجور هنا أبداً (الأجور عند المالك فقط).
   السجل القديم (t:'ext', c:اسم) يُقرأ كدفعة تحميص لعميل باسمه. */
'use strict';
const SLOW = { id: 'slow', name: 'سلو' };
const num = v => { const x = Number(v); return isFinite(x) ? Math.round(x * 1000) / 1000 : null; };
const slug = s => 'c' + require('crypto').createHash('sha1').update(String(s || '').trim().toLowerCase()).digest('hex').slice(0, 8);
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
// توحيد المستند: الهيكل الجديد + ترحيل السجلات القديمة + سلو دائماً أول العملاء
function normalize(doc) {
  const d = Object.assign({ custs: [], list: [] }, doc || {}); const custs = (d.custs || []).slice(); const list = (d.list || []).map(x => {
    if (x.t === 'ext' || (!x.t && x.c)) { const name = norm(x.c); const id = slug(name); return Object.assign({}, x, { t: 'roast', cust: { id, name }, coffee: x.coffee || '', c: undefined }); } return x; });
  for (const x of list) if (x.cust && !custs.some(c => c.id === x.cust.id)) custs.push({ id: x.cust.id, name: x.cust.name, at: x.at, by: x.by });
  if (!custs.some(c => c.id === SLOW.id)) custs.unshift(Object.assign({}, SLOW));
  return Object.assign({}, d, { custs, list });
}
// الأرصدة: لكل عميل ثم لكل محصول (+ الإجمالي) — بالكيلو
function balances(doc, custId) {
  const out = {}; for (const x of (doc.list || [])) { if (!x.cust || (custId && x.cust.id !== custId)) continue; const C = out[x.cust.id] = out[x.cust.id] || { name: x.cust.name, coffees: {}, green: 0, roasted: 0, in: 0, used: 0, made: 0, out: 0, n: 0, last: null };
    const k = norm(x.coffee) || '—'; const F = C.coffees[k] = C.coffees[k] || { green: 0, roasted: 0, in: 0, used: 0, made: 0, out: 0 }; const add = (f, v) => { C[f] += v; F[f] += v; };
    if (x.t === 'in') { add('in', +x.g || 0); add('green', +x.g || 0); } else if (x.t === 'roast') { add('used', +x.g || 0); add('green', -(+x.g || 0)); add('made', +x.r || 0); add('roasted', +x.r || 0); } else if (x.t === 'out') { add('out', +x.kg || 0); add('roasted', -(+x.kg || 0)); }
    C.n++; if (!C.last || x.at > C.last) C.last = x.at; }
  const r3 = v => Math.round(v * 1000) / 1000; for (const C of Object.values(out)) { for (const f of ['green', 'roasted', 'in', 'used', 'made', 'out']) C[f] = r3(C[f]); for (const F of Object.values(C.coffees)) for (const f of ['green', 'roasted', 'in', 'used', 'made', 'out']) F[f] = r3(F[f]); }
  return custId ? out[custId] || null : out;
}
const dayKsa = x => new Date(new Date(x).getTime() + 3 * 3600e3).toISOString().slice(0, 10);
// يطبّق عملية ويرجع {st, rec?, cust?}. الأخطاء: op | customer | coffee | weight | nf | today | signed
function apply(doc, j, who, now, opt) {
  const st = normalize(doc); const op = String(j.op || '');
  if (op === 'cust') { const name = norm(j.name).slice(0, 80); if (!name) throw new Error('customer'); const id = slug(name); let c = st.custs.find(x => x.id === id || x.name.toLowerCase() === name.toLowerCase()); if (!c) { c = { id, name, at: now, by: who }; st.custs = st.custs.concat([c]); } st.at = now; return { st, cust: c }; }
  if (op === 'add') {
    const t = String(j.t || ''); if (!['in', 'roast', 'out'].includes(t)) throw new Error('op');
    const cid = String(j.cust || ''); const c = st.custs.find(x => x.id === cid); if (!c) throw new Error('customer');
    const coffee = norm(j.coffee).slice(0, 60); if (!coffee) throw new Error('coffee');
    const rec = { id: 'X' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: now, by: who, t, cust: { id: c.id, name: c.name }, coffee, n: norm(j.n).slice(0, 120) || undefined };
    if (t === 'in') { const g = num(j.g); if (!(g > 0) || g > 5000) throw new Error('weight'); rec.g = g; const s = num(j.sacks); if (s > 0) rec.sacks = s; }
    else if (t === 'roast') { const g = num(j.g), r = num(j.r); if (!(g > 0) || !(r > 0) || r > g || g > 200) throw new Error('weight'); rec.g = g; rec.r = r; const B = balances(st, c.id); const F = B && B.coffees[coffee]; if (!F || F.green < g - 1e-9) rec.over = Math.round(((g - (F ? F.green : 0))) * 1000) / 1000; }   // أكثر من الأخضر المسجّل له: يُسجَّل ويُعلَّم (لا يُرفض)
    else { const kg = num(j.kg); if (!(kg > 0) || kg > 5000) throw new Error('weight'); rec.kg = kg; const b = num(j.bags); if (b > 0) rec.bags = b; const B = balances(st, c.id); const F = B && B.coffees[coffee]; if (!F || F.roasted < kg - 1e-9) rec.over = Math.round(((kg - (F ? F.roasted : 0))) * 1000) / 1000; }
    st.list = [rec].concat(st.list).slice(0, 5000); st.at = now; return { st, rec };
  }
  if (op === 'del') { const it = st.list.find(x => x.id === j.id); if (!it) throw new Error('nf'); if (dayKsa(it.at) !== dayKsa(now)) throw new Error('today'); if (it.doc && opt && opt.signed && opt.signed(it.doc)) throw new Error('signed'); st.list = st.list.filter(x => x.id !== j.id); st.at = now; return { st, rec: it }; }
  throw new Error('op');
}
// نص سطر للسجل والإشعار (بلا أسعار)
function describe(rec) { const c = rec.cust ? rec.cust.name : ''; return rec.t === 'in' ? 'استلام أخضر ' + c + ' · ' + rec.coffee + ' ' + rec.g + ' كجم' + (rec.sacks ? ' (' + rec.sacks + ' خيش)' : '') : rec.t === 'roast' ? 'تحميص ' + c + ' · ' + rec.coffee + ' ' + rec.g + '→' + rec.r + (rec.over ? ' (أكثر من الأخضر المسجّل بـ' + rec.over + ')' : '') : 'تسليم محمّص ' + c + ' · ' + rec.coffee + ' ' + rec.kg + ' كجم' + (rec.bags ? ' (' + rec.bags + ' كيس)' : '') + (rec.over ? ' (أكثر من الجاهز بـ' + rec.over + ')' : ''); }
module.exports = { SLOW, normalize, balances, apply, describe, slug, dayKsa };
