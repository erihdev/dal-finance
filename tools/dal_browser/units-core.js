/* مفاتيح الوحدات — Unit keys shared by the staff app (window.DALU) and the backend (require).
   لكل صنف سلّم: [[مفتاح, العامل إلى الوحدة التالية], ...] والوحدة الأساسية هي وحدة التخزين في فودكس (لا تتغير أبدًا).
   الوحدات بعد الأساسية (غرام تحت الكيلو) عاملها = كم وحدة أساسية تساوي (0.001). العامل null = غير محدد بعد، والوحدة لا تُستخدم حتى يُملأ.
   Factors are never invented here: only the Foodics storage unit, kg→g, Foodics ingredient factors (f) and the two sacks the owner confirmed (25 kg). */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.DALU = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const KEYS = ['carton', 'sleeve', 'piece', 'bag', 'sack', 'kg', 'g', 'L', 'box', 'pack', 'bottle', 'roll'];
  const NAME = { carton: ['كرتون', 'Carton'], sleeve: ['شدة', 'Sleeve'], piece: ['حبة', 'Piece'], bag: ['كيس', 'Bag'], sack: ['خيشة', 'Sack'], kg: ['كيلو', 'kg'], g: ['غرام', 'g'], L: ['لتر', 'L'], box: ['علبة', 'Box'], pack: ['باكيت', 'Pack'], bottle: ['عبوة', 'Bottle'], roll: ['رول', 'Roll'] };
  const FOOD = { KG: 'kg', PCS: 'piece', LITER: 'L', BOX: 'box', PACK: 'pack', BOTTLE: 'bottle', ROLL: 'roll' };   // وحدة تخزين فودكس → المفتاح الأساسي
  const SACK25 = { 'inv-13': 25, 'inv-14': 25 };   // أكّدها المالك: خيشة عنب وأوغندا = 25 كجم
  // البن الأخضر → المحمّص المقابل في فودكس (بالمحصول). المكان الوحيد لهذا الربط؛ التحميص يسحب من الأخضر ويضيف للمحمّص
  const ROAST_MAP = { 'inv-11': 'sk-0170', 'inv-9': 'sk-0169', 'inv-10': 'sk-0168', 'inv-16': 'sk-0173', 'inv-13': 'sk-0171', 'inv-12': 'sk-0172', 'inv-15': 'sk-0175', 'inv-14': 'sk-0174' };
  const ROASTED_MIN = 50;   // سياسة المالك: 50 كجم حد أدنى لكل محصول محمّص (المحمّص فقط)
  const MAXL = 6;
  const baseOf = it => (it && FOOD[String(it.u || '').toUpperCase()]) || null;
  const name = (k, en) => (NAME[k] || [k, k])[en ? 1 : 0];
  const isNum = v => typeof v === 'number' && isFinite(v);
  // السلّم الافتراضي: ما هو مؤكد فقط
  function defaults(it) {
    const b = baseOf(it); if (!b) return null; const lad = [];
    if (b === 'kg') { if (it.c === 'Green Coffee') lad.push(['sack', SACK25[it.s] || null]); lad.push(['kg', 1], ['g', 0.001]); }
    else if (b === 'piece') { if (it.c === 'Packaging') lad.push(['carton', null], ['sleeve', null]); lad.push(['piece', 1]); }
    else if (b === 'box' || b === 'pack') { lad.push([b, 1]); const f = +it.f; if (f > 1 && /^(pcs|p)$/i.test(String(it.iu || ''))) lad.push(['piece', 1 / f]); }
    else lad.push([b, 1]);
    const e = { base: b, lad, min: null }; if (it.c === 'Roasted Coffee' && Object.values(ROAST_MAP).includes(it.s)) e.min = ROASTED_MIN;
    return e;
  }
  // العامل الكلي من وحدة إلى الوحدة الأساسية (null إذا مرّ بعامل غير محدد)
  function factor(entry, u) {
    if (!entry || !Array.isArray(entry.lad)) return null; const lad = entry.lad; const i = lad.findIndex(x => x[0] === u); if (i < 0) return null;
    let f = 1; for (let j = i; j < lad.length; j++) { if (lad[j][0] === entry.base) break; if (!isNum(lad[j][1]) || lad[j][1] <= 0) return null; f *= lad[j][1]; }
    return f;
  }
  const usable = (entry, u) => factor(entry, u) != null;
  // مجموع أسطر [{n,u}] بالوحدة الأساسية (null إذا سطر بوحدة غير قابلة للاستخدام أو كمية غير صالحة)
  function total(entry, lines) {
    if (!Array.isArray(lines) || !lines.length) return null; let s = 0;
    for (const l of lines) { const n = +l.n; const f = factor(entry, l.u); if (!(n > 0) || f == null) return null; s += n * f; }
    return Math.round(s * 10000) / 10000;
  }
  // تحقق من سلّم مُرسل وتطبيعه؛ الأساس مقفول على وحدة فودكس
  function validate(lad, it, min) {
    const b = baseOf(it); if (!b) return { ok: false, err: 'base' };
    if (min === '' || min === undefined) min = null; if (min !== null) { min = +min; if (!isFinite(min) || min < 0) return { ok: false, err: 'min' }; min = Math.round(min * 10000) / 10000; }
    if (!Array.isArray(lad) || !lad.length || lad.length > MAXL) return { ok: false, err: 'ladder' };
    const out = []; const seen = new Set(); let bi = -1;
    for (const x of lad) {
      const k = Array.isArray(x) ? x[0] : (x && x.k); let f = Array.isArray(x) ? x[1] : (x && x.f);
      if (!KEYS.includes(k)) return { ok: false, err: 'key' }; if (seen.has(k)) return { ok: false, err: 'dup' }; seen.add(k);
      if (f === '' || f === undefined) f = null; if (f !== null) { f = +f; if (!isFinite(f) || f <= 0) return { ok: false, err: 'factor' }; f = Math.round(f * 1e6) / 1e6; }
      if (k === b) { bi = out.length; f = 1; }
      out.push([k, f]);
    }
    if (bi < 0) return { ok: false, err: 'base' };
    for (let j = bi + 1; j < out.length; j++) if (out[j][1] == null) return { ok: false, err: 'sub' };   // ما تحت الأساس لازم عامله معروف
    return { ok: true, entry: { base: b, lad: out, min } };
  }
  // دمج المخزون مع الافتراضي: كل صنف له سلّم دائمًا، والأساس دائمًا من فودكس
  function merge(items, stored) {
    const out = {}; const st = (stored && stored.items) || {};
    for (const it of items || []) { const d = defaults(it); if (!d) continue; const s = st[it.s]; const v = s && validate(s.lad, it, s.min === undefined ? d.min : s.min); out[it.s] = v && v.ok ? v.entry : d; }
    return out;
  }
  const describe = lad => (lad || []).map(x => x[0] + (x[1] == null ? '=?' : x[1] === 1 ? '' : '=' + x[1])).join(' > ');
  // الرصيد المحسوب لصنف من الدفعات: مجموع الباقي في دفعاته (null = لا دفعات بعد، فلا رقم ولا تنبيه)
  function balance(list, sku) { let has = false, s = 0; for (const x of list || []) if (x.t === 'in' && x.s === sku) { has = true; s += +x.rem || 0; } return has ? Math.round(s * 10000) / 10000 : null; }
  // ما وصل للحد الأدنى: [{s, bal, min, kind}] — kind: roast (محمّص → حمّص) أو order (أخضر وغيره → اطلب)
  function alerts(items, units, list) { const out = []; for (const it of items || []) { const e = units && units[it.s]; if (!e || e.min == null) continue; const bal = balance(list, it.s); if (bal == null || bal > e.min) continue; out.push({ s: it.s, bal, min: e.min, base: e.base, kind: it.c === 'Roasted Coffee' ? 'roast' : 'order' }); } return out; }
  return { KEYS, NAME, FOOD, ROAST_MAP, ROASTED_MIN, name, baseOf, defaults, factor, usable, total, validate, merge, describe, balance, alerts };
});
