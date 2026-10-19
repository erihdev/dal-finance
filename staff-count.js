/* جرد دال بالكاميرا — Stock count with the phone camera (v8).
   الكمية تُدخل بمفاتيح الوحدات (كرتون/شدة/حبة…) من live/units وتُحفظ بوحدة تخزين فودكس. الوحدة التي عاملها غير محدد لا تُختار.
   يمسح ملصق QR على الصنف (DAL:<sku>) أو باركود Code128/EAN يحمل رمز الصنف → يُدخل الكراتين والحبات أو الوزن
   → يُحفظ في live/count_state عبر /staff/count → ملف CSV جاهز للاستيراد في Foodics (Inventory Count → Import Items).
   يقرأ بقارئ الجوال (BarcodeDetector) وإلا بمكتبة ZXing التي لا تُحمَّل إلا عند فتح الكاميرا. */
(function () {
  const C = window.DALC = { items: null, st: null, units: null, cat: 'all', q: '', edit: null, scan: null, pending: [], unit: null };
  const UNITW = { KG: 'kg' };   // أصناف تُوزن (البن والبودرة)
  const LIQ = { Liter: 1 };     // سوائل: عبوات × لتر + المفتوحة
  const CAT = [['all', 'All', 'الكل'], ['Green Coffee', 'Green coffee', 'بن أخضر'], ['Roasted Coffee', 'Roasted', 'بن محمّص'], ['Packaging', 'Packaging', 'تغليف وأكواب'], ['Milk', 'Milk & dairy', 'حليب'], ['Sauce', 'Sauces', 'صوصات'], ['Syrup', 'Syrups', 'شراب'], ['Powder', 'Powders & sugar', 'بودرة وسكر'], ['Cake', 'Cakes', 'كيك'], ['other', 'Other', 'أخرى']];
  const MAIN = new Set(CAT.slice(1, -1).map(c => c[0]));
  const n = v => (v === '' || v == null || !isFinite(+v)) ? null : +v;
  const r4 = v => Math.round(v * 10000) / 10000;
  const fmt = v => v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lines = () => (C.st && C.st.cur && C.st.cur.lines) || {};
  const cfg = s => (C.st && C.st.cfg && C.st.cfg[s]) || {};
  const item = s => (C.items || []).find(i => i.s === s);
  const isW = it => !!UNITW[it.u];
  // أصناف وحدتها في فودكس علبة/باكيت فيها حبات (ماء نوفا 24، أعواد سكر 500...): يُعدّ العلب + الحبات السائبة ونحوّلها لوحدة فودكس
  const isPK = it => /^(box|pack)$/i.test(it.u) && +it.f > 1 && /^(pcs|p)$/i.test(it.iu || '');
  // آخر جرد سابق للصنف (للتنبيه فقط، لا يُعرض قبل العدّ)
  const prevQ = s => { const h = (C.st && C.st.hist) || []; for (const x of h) { const l = x && x.lines && x.lines[s]; if (l && l.q != null) return +l.q; } return null; };
  const T = (ar, en) => window.DALT ? window.DALT(ar, en) : ar;
  const EN = () => window.DALLANG && window.DALLANG() === 'en';
  const nm = i => EN() ? i.en : i.ar; const nm2 = i => EN() ? i.ar : i.en;
  const CATN = c => EN() ? c[1] : c[2];
  const ico = (k, s) => window.DALICO ? window.DALICO(k, s) : '';

  C.loadItems = async function () { if (!C.items) { try { const r = await fetch('count-items.json?v=' + Date.now()); C.items = (await r.json()).items || []; } catch (e) { C.items = []; } } return C.items; };
  C.load = async function (api) {
    await C.loadItems();
    try { const r = await api('/staff/docs?names=count_state'); if (r.ok) C.st = (r.docs || {}).count_state || { cfg: {}, cur: null, hist: [] }; } catch (e) {}
    await C.loadUnits(api);
  };
  // سلالم الوحدات (المخزَّن مدموجًا مع الافتراضي من الخادم)؛ وإن تعذّر: الافتراضي محليًا بنفس القواعد
  C.loadUnits = async function (api) {
    try { const r = await (api || window.DALAPI)('/staff/units'); if (r.ok && r.items) { C.units = r.items; C.unitsLog = r.log || []; C.unitsEdit = !!r.canEdit; return; } } catch (e) {}
    if (!C.units && window.DALU && C.items) C.units = window.DALU.merge(C.items, null);
  };
  C.entry = it => (C.units && C.units[it.s]) || (window.DALU ? window.DALU.defaults(it) : null);
  const uname = k => window.DALU ? window.DALU.name(k, EN()) : k;
  // وصف الوحدة في الشريحة: الأساسية / = N أساسية / 1 أساسية = N منها / غير محدد
  C.udesc = function (e, k) { const f = window.DALU.factor(e, k); if (f == null) return T('غير محدد', 'Not set'); if (k === e.base) return T('الوحدة الأساسية', 'Base unit'); return f >= 1 ? '= ' + fmt(f) + ' ' + uname(e.base) : '1 ' + uname(e.base) + ' = ' + fmt(Math.round(1 / f * 1000) / 1000) + ' ' + uname(k); };
  C.chips = function (e, sel, attr) { return `<div class="dc-uc">${e.lad.map(x => { const ok = window.DALU.usable(e, x[0]); return `<button type="button" data-${attr || 'un'}="${x[0]}" aria-pressed="${sel === x[0]}" ${ok ? '' : 'disabled'}>${uname(x[0])}<small>${C.udesc(e, x[0])}</small></button>`; }).join('')}</div>`; };
  async function post(body) {
    const r = await window.DALAPI('/staff/count', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.err || 'error'); C.st = r.state; return r;
  }
  function inCat(it) { return C.cat === 'all' || (C.cat === 'other' ? !MAIN.has(it.c) : it.c === C.cat); }

  /* ---------- التصميم ---------- */
  const CSS = `<style id="dc-css">
  .dc{font-variant-numeric:tabular-nums;padding-bottom:84px}
  .dc-prog{background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:12px}.dc-prog .k{display:flex;align-items:baseline;gap:6px}.dc-prog .k b{font-size:28px;font-weight:600;line-height:1.1}.dc-prog .k span{color:var(--ink2);font-size:15px}
  .dc-bar{height:6px;border-radius:6px;background:var(--fill);overflow:hidden;margin-top:10px}.dc-bar i{display:block;height:100%;background:var(--acc);border-radius:6px}
  .dc-warn{background:var(--warn-soft);color:var(--warn);border-radius:10px;padding:10px 12px;font-size:14px;margin:0 0 12px}
  .dc-fab{width:auto;position:fixed;bottom:calc(66px + env(safe-area-inset-bottom));inset-inline:16px;max-width:420px;margin:0 auto;z-index:5;box-shadow:0 8px 24px -10px rgba(0,0,0,.35)}
  .dc-shx{position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:20;display:flex;align-items:flex-end}
  .dc-pan{background:var(--bg);width:100%;max-width:640px;margin:0 auto;border-radius:14px 14px 0 0;padding:8px 16px calc(16px + env(safe-area-inset-bottom));max-height:94vh;overflow:auto}
  .dc-grab{width:36px;height:5px;border-radius:5px;background:#c7c7cc;margin:0 auto 10px}
  .dc-ph{display:flex;gap:10px;align-items:flex-start;padding:2px 0 10px}.dc-ph .t{flex:1;min-width:0}.dc-ph b{font-size:19px;font-weight:600;display:block;line-height:1.25}.dc-ph small{color:var(--ink2);font-size:13px}
  .dc-x{border:0;background:var(--fill);width:44px;height:44px;border-radius:50%;cursor:pointer;flex:none;display:grid;place-items:center;color:var(--ink2)}
  .dc-info{background:#fff;border-radius:12px;padding:12px 16px;font-size:14px;color:var(--ink2);margin-bottom:12px}
  .dc-f{display:flex;align-items:center;gap:10px;min-height:56px;padding:6px 16px;position:relative}.dc-f+.dc-f::before{content:"";position:absolute;top:0;inset-inline-start:16px;inset-inline-end:0;border-top:1px solid var(--line)}
  .dc-f label{flex:1;font-size:15px;line-height:1.3}
  .dc-st{display:flex;align-items:center;gap:6px}.dc-st button{width:44px;height:44px;border-radius:10px;border:0;background:var(--fill);font-size:22px;color:var(--ink);cursor:pointer;line-height:1}.dc-st button:active{background:#e0e0e4}
  .dc-st input{width:84px;text-align:center;margin:0;font-size:18px;font-weight:600;padding:8px 4px}
  .dc-f.wide{flex-wrap:wrap}.dc-f.wide label{flex-basis:100%}.dc-f.wide input{flex:1;min-width:0;margin:0}
  .dc-wl{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px}.dc-wl button{border:0;background:var(--fill);border-radius:999px;min-height:44px;padding:0 12px;font-size:14px;cursor:pointer}
  .dc-tot{display:flex;align-items:center;gap:10px;background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:12px}.dc-tot small{flex:1;color:var(--ink2);font-size:15px}.dc-tot b{font-size:28px;font-weight:600}.dc-tot em{font-style:normal;color:var(--ink2)}
  .dc-err{display:none;background:var(--bad-soft);color:var(--bad);border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:10px}
  .dc-two{display:flex;gap:8px}.dc-two .btn{flex:1}
  .dc-uc{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px 4px}.dc-uc button{border:0;background:#fff;box-shadow:inset 0 0 0 1px var(--line);border-radius:999px;min-height:44px;padding:4px 13px;font-size:14px;line-height:1.25;cursor:pointer;text-align:center}.dc-uc button small{display:block;font-size:11px;color:var(--ink2)}.dc-uc button[aria-pressed=true]{background:var(--ink);color:#fff;box-shadow:none}.dc-uc button[aria-pressed=true] small{color:#c7c7cc}.dc-uc button[disabled]{opacity:.45;cursor:default}
  .dc-ul{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px}.dc-ul button{border:0;background:var(--fill);border-radius:999px;min-height:44px;padding:0 12px;font-size:14px;cursor:pointer}.dc-ul button small{color:var(--ink2);margin-inline-start:4px}
  .dc-scan{position:fixed;inset:0;z-index:30;background:#000;color:#fff;display:flex;flex-direction:column}
  .dc-scan .top{display:flex;align-items:center;gap:10px;padding:calc(8px + env(safe-area-inset-top)) 12px 8px}.dc-scan .top b{flex:1;font-size:17px;font-weight:600}
  .dc-scan .cb{border:0;background:rgba(255,255,255,.16);color:#fff;min-width:44px;height:44px;border-radius:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;padding:0 12px;font-size:15px}.dc-scan .cb[aria-pressed=true]{background:#fff;color:#000}.dc-scan [hidden]{display:none!important}
  .dc-scan .vw{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
  .dc-scan video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.dc-scan .fr{position:relative;width:86%;max-width:440px;aspect-ratio:4/3;border:2px solid rgba(255,255,255,.9);border-radius:16px;box-shadow:0 0 0 100vmax rgba(0,0,0,.38)}
  .dc-scan .msg{padding:10px 16px;font-size:15px;line-height:1.5;text-align:center;color:#d1d1d6;min-height:44px}.dc-scan .msg.e{color:#fff;background:#3a1012;margin:0 16px;border-radius:10px;text-align:start}
  .dc-scan .man{display:flex;gap:8px;padding:8px 16px calc(14px + env(safe-area-inset-bottom))}.dc-scan .man input{margin:0;background:#1c1c1e;border-color:#3a3a3c;color:#fff}.dc-scan .man .btn{margin:0;width:auto;flex:none}
  </style>`;

  C.CSS = CSS;   // صفحة الحركة تستخدم شرائح الوحدات نفسها
  /* ---------- الصفحة الرئيسية ---------- */
  C.view = function () {
    if (!C.items) return `<p class="note">${T('جارٍ التحميل…', 'Loading…')}</p>`;
    const L = lines(); const done = C.items.filter(i => L[i.s]).length; const tot = C.items.length;
    const q = C.q.trim().toLowerCase();
    const list = C.items.filter(inCat).filter(i => !q || i.en.toLowerCase().includes(q) || i.ar.includes(C.q.trim()) || i.s.toLowerCase().includes(q));
    const todo = list.filter(i => !L[i.s]), ok = list.filter(i => L[i.s]);
    const cur = C.st && C.st.cur; const pct = tot ? Math.round(done / tot * 100) : 0;
    return CSS + `<div class="dc">
    <h1>${T('الجرد', 'Stock count')}</h1><p class="sub">${cur ? '<span class="d">' + esc(cur.id) + '</span>' + (cur.by ? ' · <span class="d">' + esc(cur.by) + '</span>' : '') : T('لم يبدأ جرد بعد', 'No count started yet')}</p>
    <div class="dc-prog"><div class="k"><b>${done}</b><span>/ ${tot} ${T('صنف مجرود', 'items counted')}</span><span style="margin-inline-start:auto">${tot - done} ${T('باقي', 'left')}</span></div><div class="dc-bar"><i style="width:${pct}%"></i></div></div>
    ${C.pending.length ? `<div class="dc-warn">${C.pending.length} ${T('لم تُحفظ بعد (لا يوجد إنترنت) — يعيد المحاولة وحده', 'not saved yet (offline). Retrying automatically.')}</div>` : ''}
    <div class="search">${ico('search', 18)}<input id="cq" placeholder="${T('ابحث بالاسم أو الرمز', 'Search name or SKU')}" value="${esc(C.q)}"></div>
    <div class="chips">${CAT.map(c => `<button data-cat="${c[0]}" aria-pressed="${C.cat === c[0]}">${CATN(c)}</button>`).join('')}</div>
    ${todo.length ? `<div class="sec">${T('لم يُجرد', 'Not counted')} · ${todo.length}</div><div class="grp">${todo.map(row).join('')}</div>` : ''}
    ${ok.length ? `<div class="sec">${T('مجرود', 'Counted')} · ${ok.length}</div><div class="grp">${ok.map(row).join('')}</div>` : ''}
    ${!todo.length && !ok.length ? `<p class="note">${T('لا نتائج.', 'No results.')}</p>` : ''}
    <div class="sec">${T('أدوات', 'Tools')}</div>
    <div class="grp"><button class="cell" data-c="csv"><span class="t"><b>${T('ملف فودكس (CSV)', 'Foodics file (CSV)')}</b><small>${T('للاستيراد في Inventory Count', 'Import into Inventory Count')}</small></span></button>
      <button class="cell" data-c="labels"><span class="t"><b>${T('طباعة ملصقات QR', 'Print QR labels')}</b><small>${T('للتصنيف المختار', 'For the selected category')}</small></span></button>
      <button class="cell" data-c="labelsnew"><span class="t"><b>${T('ملصقات الأصناف الجديدة فقط', 'Labels for new items only')}</b><small>${T('ما لم يُطبع من هذا الجهاز من قبل', 'Not printed from this device before')}</small></span></button>
      <button class="cell" data-c="new"><span class="t"><b style="color:var(--bad)">${T('بدء جرد جديد', 'Start a new count')}</b><small>${T('الجرد الحالي يُحفظ في السجل', 'The current count is kept in history')}</small></span></button></div>
    <button class="btn dc-fab" data-c="scan">${ico('cam')}${T('امسح الملصق', 'Scan label')}</button></div>`;
  };
  function row(i) {
    const l = lines()[i.s];
    const v = l ? (l.nf ? `<div class="v"><b style="color:var(--warn);font-size:14px">${T('ما لقيته', 'Not found')}</b></div>` : `<div class="v"><b>${fmt(l.q)}</b><small>${esc(i.u)}</small></div>`) : `<div class="v"><b style="color:var(--ink3)">—</b><small>${esc(i.u)}</small></div>`;
    return `<div class="cell" data-item="${esc(i.s)}"><div class="t"><b class="d">${esc(nm(i))}</b><small><span class="d">${esc(nm2(i))}</span> · <span class="d">${esc(i.s)}</span></small></div>${v}</div>`;
  }

  /* ---------- شاشة إدخال الصنف ---------- */
  const stp = (id, label, val, ph) => `<div class="dc-f"><label for="${id}">${label}</label><div class="dc-st"><button type="button" data-step="${id}:-1" aria-label="-1">−</button><input id="${id}" inputmode="decimal" value="${esc(val)}" placeholder="${esc(ph == null ? '0' : ph)}"><button type="button" data-step="${id}:1" aria-label="+1">+</button></div></div>`;
  const fld = (id, label, val, ph) => `<div class="dc-f"><label for="${id}">${label}</label><div class="dc-st"><input id="${id}" inputmode="decimal" value="${esc(val)}" placeholder="${esc(ph || '')}" style="width:126px"></div></div>`;
  function sheet() {
    const it = item(C.edit); if (!it) return '';
    const l = lines()[it.s] || {}; const cf = cfg(it.s); const w = isW(it); const u = esc(it.u);
    const pc = l.pc != null ? l.pc : (cf.pc != null ? cf.pc : '');
    const t = l.t != null ? l.t : (cf.t != null ? cf.t : '');
    const pk = !w && isPK(it); const F = +it.f; const liq = LIQ[it.u];
    const had = lines()[it.s];
    const v0 = x => x != null ? x : '';
    const prevBox = had && !had.nf ? `<div class="dc-warn">${T('محفوظ لهذا الصنف', 'Already saved')}: <b>${fmt(had.q)} ${u}</b>${had.note ? ' · ' + esc(had.note) : ''}<label style="display:flex;gap:10px;align-items:center;margin-top:8px;font-weight:600;min-height:44px"><input type="checkbox" id="cadd" style="width:24px;height:24px;min-height:0;margin:0;flex:none;accent-color:var(--acc)"> ${T('هذا مكان ثاني: أضف على المحفوظ', 'Another place: add to the saved amount')}</label><small style="display:block">${T('بدون صح: الرقم الجديد يستبدل المحفوظ (للتصحيح).', 'Unticked: the new number replaces the saved one (to correct it).')}</small></div>` : '';
    const e = C.entry(it); if (!C.unit || !e.lad.some(x => x[0] === C.unit)) C.unit = e ? e.base : null;
    const unit = pk && e ? `<div class="dc-info">${T('فودكس يحسب هذا الصنف بالـ', 'Foodics counts this item in ')}<b>${u}</b>${T('، والـ' + u + ' فيه ', '; one ' + u + ' = ')}<b>${F}</b> ${T('حبة', 'pcs')}.</div>` : '';
    // أسطر بالوحدات لكل الأصناف: ٣ كراتين + ٥ شدات + ٧ حبات، أو خيشتان + ١٢ كيلو؛ والأصناف الموزونة تحتفظ بالميزان (قائم − فارغ)
    const ulines = e ? `<div class="grp">${C.chips(e, C.unit)}${stp('cu', T('الكمية بالوحدة المختارة', 'Quantity in the chosen unit'), '')}<div class="dc-f" style="padding-top:0"><button class="btn k" data-c="addl" style="margin:0">${T('أضف سطر', 'Add line')}</button></div><div id="ul" class="dc-ul"></div></div>` : '';
    const body = w ? `<div class="grp"><div class="dc-f wide"><label for="cw">${T('أو زِن كل كيس أو حاوية واضغط «أضف»', 'Or weigh each bag or container, then tap Add')}</label><input id="cw" inputmode="decimal" placeholder="${T('الوزن القائم (كجم) مثلاً 24.6', 'Gross weight (kg), e.g. 24.6')}"><button class="btn k" data-c="addw" style="width:auto;margin:0">${T('أضف', 'Add')}</button></div>
        <div id="wl" class="dc-wl">${(l.w || []).map((x, k) => `<button data-wdel="${k}" aria-label="remove">${fmt(x)} ×</button>`).join('')}</div>
        ${fld('ct', T('وزن الكيس أو الحاوية فارغة (كجم)', 'Empty bag or container (kg)'), t, '0')}${fld('cd', T('أو الصافي مباشرة', 'Or the net total directly'), '', u)}</div>`
      : `<div class="grp">${fld('cd', T('أو المجموع مباشرة (' + u + ')', 'Or the total directly (' + u + ')'), '', u)}</div>`;
    return `<div id="sheet" class="dc-shx" role="dialog" aria-modal="true"><div class="dc-pan">
      <div class="dc-grab"></div>
      <div class="dc-ph"><div class="t"><b class="d">${esc(nm(it))}</b><small><span class="d">${esc(nm2(it))}</span> · <span class="d">${esc(it.s)}</span>${cf.loc ? ' · <span class="d">' + esc(cf.loc) + '</span>' : ''}</small></div><button class="dc-x" data-c="close" aria-label="${T('إغلاق', 'Close')}">${ico('x', 20)}</button></div>
      ${unit}${prevBox}${ulines}${body}
      <div class="grp"><div class="dc-f wide"><label for="cloc">${T('المكان (اختياري)', 'Place (optional)')}</label><input id="cloc" value="${esc(cf.loc || '')}" placeholder="${T('مثلاً مستودع رف 2', 'e.g. Store, shelf 2')}"></div></div>
      <div class="dc-tot"><small>${T('الكمية اللي بتنحفظ', 'Total to save')}</small><b id="ctot">—</b><em>${u}</em></div>
      <div id="cwarn" class="dc-err"></div>
      <div class="dc-two"><button class="btn s" data-c="nf">${T('ما لقيته', 'Not found')}</button><button class="btn" data-c="save">${T('حفظ', 'Save')}</button></div>
      ${had ? `<button class="lnk bad" data-c="del" style="width:100%;margin-top:6px">${T('حذف الجرد لهذا الصنف', 'Remove this count')}</button>` : ''}
    </div></div>`;
  }
  let W = [], UL = [];
  // مجموع الأسطر بالوحدات + السطر الجاري غير المضاف (الرقم في الحقل بالوحدة المختارة)
  function ulTotal(it) { const e = C.entry(it); if (!e) return null; const v = n((document.getElementById('cu') || {}).value); const L = UL.slice(); if (v != null && v > 0 && C.unit) L.push({ n: v, u: C.unit }); if (!L.length) return null; return window.DALU.total(e, L); }
  function total() {
    const it = item(C.edit); if (!it) return null; const v = id => n((document.getElementById(id) || {}).value);
    const add = (document.getElementById('cadd') || {}).checked && lines()[it.s] ? +lines()[it.s].q || 0 : 0;
    const x = part(it, v); return x == null ? null : r4(x + add);
  }
  function part(it, v) {
    const d = v('cd'); if (d != null) return r4(d);
    const ut = ulTotal(it); let wn = null;
    if (isW(it) && W.length) { const t = v('ct') || 0; wn = Math.max(0, W.reduce((a, x) => a + x, 0) - W.length * t); }
    if (ut == null && wn == null) return null; return r4((ut || 0) + (wn || 0));
  }
  function ulHtml(it) { const e = C.entry(it); return UL.map((x, k) => `<button data-udel="${k}" aria-label="remove">${fmt(x.n)} ${uname(x.u)}<small>= ${fmt(window.DALU.total(e, [x]))} ${uname(e.base)}</small> ×</button>`).join(''); }
  function upd() { const el = document.getElementById('ctot'); if (!el) return; const t = total(); el.textContent = t == null ? '—' : fmt(t); C.warned = null; const ul = document.getElementById('ul'); if (ul) { const it0 = item(C.edit); ul.innerHTML = it0 ? ulHtml(it0) : ''; } const wn = document.getElementById('cwarn'); if (wn) wn.style.display = 'none'; const it = item(C.edit); if (it && isW(it)) { const wl = document.getElementById('wl'); if (wl) wl.innerHTML = W.map((x, k) => `<button data-wdel="${k}" aria-label="remove">${fmt(x)} ×</button>`).join('') + (W.length ? `<small style="align-self:center;color:var(--ink2)">${W.length} ${T('كيس', 'bag(s)')} · ${fmt(W.reduce((a, x) => a + x, 0))} ${UNITW[it.u]}</small>` : ''); } }
  C.open = function (sku) {
    const it = item(sku); if (!it) { window.DALTOAST(T('ملصق غير معروف: ', 'Unknown label: ') + sku); return; }
    C.edit = sku; W = ((lines()[sku] || {}).w || []).slice(); UL = ((lines()[sku] || {}).ul || []).slice(); C.unit = null; const old = document.getElementById('sheet'); if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', sheet()); upd(); const f = document.getElementById('cu'); if (f) setTimeout(() => f.focus(), 150);
  };
  C.relang = function () { if (C.edit && document.getElementById('sheet')) { const s = C.edit, u0 = C.unit, ul0 = UL.slice(); C.open(s); C.unit = u0; UL = ul0; const b = document.querySelector('#sheet [data-un]'); if (b) { document.querySelectorAll('#sheet [data-un]').forEach(x => x.setAttribute('aria-pressed', x.getAttribute('data-un') === C.unit)); } upd(); } if (C.scan) scanText(); };
  function closeSheet() { C.edit = null; const s = document.getElementById('sheet'); if (s) s.remove(); }

  async function save() {
    const it = item(C.edit); const q = total(); if (q == null) { window.DALTOAST(T('أدخل الكمية أولاً', 'Enter a quantity first')); return; }
    const v = id => n((document.getElementById(id) || {}).value); const loc = ((document.getElementById('cloc') || {}).value || '').trim();
    const adding = !!(document.getElementById('cadd') || {}).checked && !!lines()[it.s];
    // تنبيه: الرقم بعيد جداً عن آخر جرد (غالباً خطأ وحدة: حبات بدل علب، جرام بدل كيلو)
    const pq = prevQ(it.s);
    if (pq != null && pq > 0 && (q > pq * 3 || q < pq / 3) && C.warned !== it.s + ':' + q) {
      C.warned = it.s + ':' + q; const wn = document.getElementById('cwarn');
      if (wn) { wn.textContent = T('الرقم بعيد جداً عن آخر جرد. تأكد من الوحدة (' + it.u + ') ثم اضغط حفظ مرة ثانية.', 'Very different from the last count. Check the unit (' + it.u + '), then tap Save again.'); wn.style.display = 'block'; }
      if (navigator.vibrate) navigator.vibrate([60, 60, 60]); return;
    }
    const oldNote = adding ? (lines()[it.s].note || '') : '';
    const note = (adding ? [oldNote || '—', loc || '—'].join(' + ') : loc).slice(0, 120);
    const cu = v('cu'); const ul = UL.slice(); if (cu != null && cu > 0 && C.unit) ul.push({ n: cu, u: C.unit });
    const body = isW(it) ? { op: 'line', sku: it.s, q, ul, w: W, b: W.length, t: v('ct'), note } : { op: 'line', sku: it.s, q, ul, note };
    const cf = cfg(it.s); const cb = { op: 'cfg', sku: it.s };
    if (isW(it)) { if (v('ct') != null && v('ct') !== cf.t) cb.t = v('ct'); }
    if (loc !== (cf.loc || '')) cb.loc = loc;
    commit(it, body, Object.keys(cb).length > 2 ? cb : null);
  }
  // تحديث محلي فوري ثم إرسال (مع إعادة المحاولة عند انقطاع النت)
  function commit(it, body, cb) {
    C.st = C.st || { cfg: {}, cur: null, hist: [] }; C.st.cur = C.st.cur || { id: 'new', by: '', lines: {} }; C.st.cur.lines[it.s] = Object.assign({}, body, { at: new Date().toISOString() });
    closeSheet(); window.DALRENDER(); window.DALTOAST(nm(it) + ' = ' + (body.nf ? T('ما لقيته', 'not found') : fmt(body.q) + ' ' + it.u));
    C.pending.push(body); if (cb) C.pending.push(cb); flush();
  }
  async function flush() {
    if (C.flushing) return; C.flushing = true;
    while (C.pending.length) { try { await post(C.pending[0]); C.pending.shift(); } catch (e) { C.flushing = false; setTimeout(flush, 8000); window.DALRENDER(); return; } }
    C.flushing = false; window.DALRENDER();
  }

  /* ---------- الكاميرا: QR و Code128 و EAN ----------
     قارئ الجوال نفسه (BarcodeDetector في أندرويد) بدقة الفيديو الكاملة، وإن لم يتوفر (آيفون) نستخدم ZXing
     ولا يُحمَّل إلا عند فتح الكاميرا. الكاميرا الخلفية، والإضاءة إن كانت مدعومة، والإدخال اليدوي دائماً متاح. */
  const ZX = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
  const NATIVE = ['qr_code', 'code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39', 'data_matrix'];
  function loadLib(src) { return new Promise((ok, no) => { const o = document.querySelector('script[src="' + src + '"]'); if (o) { if (o.dataset.ok) return ok(); o.addEventListener('load', ok); o.addEventListener('error', no); return; } const s = document.createElement('script'); s.src = src; s.onload = () => { s.dataset.ok = 1; ok(); }; s.onerror = () => { s.remove(); no(new Error('lib')); }; document.head.appendChild(s); }); }
  async function decoder() {
    if (C.dec) return C.dec;
    if ('BarcodeDetector' in window) { try { const sup = await window.BarcodeDetector.getSupportedFormats(); const f = NATIVE.filter(x => sup.includes(x)); if (f.includes('qr_code') && f.includes('code_128')) { const d = new window.BarcodeDetector({ formats: f }); return C.dec = { kind: 'native', run: async (v) => { const r = await d.detect(v); return r && r[0] ? r[0].rawValue : null; } }; } } catch (e) {} }
    await loadLib(ZX); const Z = window.ZXing; const B = Z.BarcodeFormat; const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [B.QR_CODE, B.CODE_128, B.EAN_13, B.EAN_8, B.UPC_A, B.UPC_E, B.CODE_39, B.DATA_MATRIX]); hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const rd = new Z.MultiFormatReader(); rd.setHints(hints); const cv = document.createElement('canvas'); const g = cv.getContext('2d', { willReadFrequently: true });
    return C.dec = { kind: 'zxing', run: async (v) => {
      // منتصف الإطار بدقته الأصلية (حتى 1280 بكسل) — بدون تصغير يضيّع خطوط الباركود الرفيعة
      const vw = v.videoWidth, vh = v.videoHeight; if (!vw) return null; const sw = Math.round(vw * 0.9), sh = Math.round(vh * 0.7); const k = Math.min(1, 1280 / sw);
      cv.width = Math.round(sw * k); cv.height = Math.round(sh * k); g.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, cv.width, cv.height);
      try { return rd.decodeWithState(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(cv)))).getText(); } catch (e) { return null; } finally { rd.reset(); }
    } };
  }
  // يحوّل النص الممسوح إلى رمز صنف: «DAL:inv-11» أو «inv-11» (أي حالة أحرف)
  function toSku(txt) {
    const raw = String(txt || '').trim(); const m = raw.match(/^DAL:(.+)$/i); const s = (m ? m[1] : raw).trim();
    if (item(s)) return s; const lo = s.toLowerCase(); const hit = (C.items || []).find(i => i.s.toLowerCase() === lo); if (hit) return hit.s;
    const p = window.DALM && window.DALM.pendItem && window.DALM.pendItem(s); return p ? p.s : null;   // ملصق مؤقت لصنف بانتظار فودكس
  }
  C.toSku = toSku;
  function camErr(e) {
    const s = String((e && (e.name || '')) + ' ' + (e && e.message || e || ''));
    if (/NotAllowed|Permission|denied|SecurityError/i.test(s)) return T('لم يُسمح للمتصفح باستخدام الكاميرا. اسمح بالكاميرا لهذا الموقع ثم أعد المحاولة. في الآيفون: الإعدادات ← Safari ← الكاميرا ← اسمح. ويمكنك كتابة الرمز يدويًا بالأسفل.', 'Camera access was blocked. Allow the camera for this site, then try again. On iPhone: Settings → Safari → Camera → Allow. You can also type the code below.');
    if (/NotFound|Overconstrained|not found|no camera/i.test(s)) return T('لم نجد كاميرا في هذا الجهاز. اكتب الرمز يدويًا بالأسفل.', 'No camera was found on this device. Type the code below.');
    if (/NotReadable|TrackStart|in use/i.test(s)) return T('الكاميرا مشغولة بتطبيق آخر. أغلقه ثم أعد المحاولة.', 'The camera is busy in another app. Close it and try again.');
    if (/https|secure|mediaDevices/i.test(s)) return T('الكاميرا تحتاج اتصالًا آمنًا (https).', 'The camera needs a secure (https) connection.');
    if (/lib/i.test(s)) return T('تعذّر تحميل قارئ الباركود. تأكد من الإنترنت ثم أعد المحاولة، أو اكتب الرمز بالأسفل.', 'Could not load the barcode reader. Check the internet and try again, or type the code below.');
    return T('تعذّر تشغيل الكاميرا. أعد المحاولة أو اكتب الرمز يدويًا.', 'Could not start the camera. Try again or type the code.');
  }
  function scanText() {
    const o = document.getElementById('scanov'); if (!o) return;
    o.querySelector('.top b').textContent = T('امسح الملصق', 'Scan label');
    o.querySelector('[data-c="stop"]').setAttribute('aria-label', T('إغلاق الكاميرا', 'Close camera'));
    o.querySelector('[data-c="torch"] span').textContent = T('الإضاءة', 'Light');
    const m = o.querySelector('.msg'); if (!m.dataset.k) m.textContent = T('وجّه الكاميرا على رمز QR أو الباركود داخل الإطار', 'Point the camera at the QR code or barcode inside the frame');
    o.querySelector('#cman').placeholder = T('أو اكتب رمز الصنف', 'Or type the item code'); o.querySelector('[data-c="man"]').textContent = T('افتح', 'Open');
  }
  function scanMsg(t, err) { const m = document.querySelector('#scanov .msg'); if (!m) return; m.textContent = t; m.classList.toggle('e', !!err); m.dataset.k = 1; }
  // تُستخدم من صفحة الحركة أيضًا: C.scanFor(cb) يفتح الكاميرا ويستدعي cb(sku) بدل فتح ورقة الجرد
  C.scanFor = function (cb) { return startScan(cb); };
  async function startScan(cb) {
    if (document.getElementById('scanov')) return;
    const run = C.scan = { cb: cb || null }; C.torch = false;
    document.body.insertAdjacentHTML('beforeend', `<div id="scanov" class="dc-scan" role="dialog" aria-modal="true"><div class="top"><b></b><button class="cb" data-c="torch" hidden aria-pressed="false">${ico('torch', 20)}<span></span></button><button class="cb" data-c="stop">${ico('x', 20)}</button></div>
      <div class="vw"><video id="cvid" playsinline muted autoplay></video><div class="fr" aria-hidden="true"></div></div><div class="msg" role="status" aria-live="polite"></div>
      <div class="man"><input id="cman" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><button class="btn" data-c="man"></button></div></div>`);
    scanText(); document.documentElement.style.overflow = 'hidden';
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error(window.isSecureContext === false ? 'https' : 'mediaDevices');
      const [stream, dec] = await Promise.all([navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }), decoder()]);
      if (C.scan !== run) { stream.getTracks().forEach(t => t.stop()); return; }
      run.stream = stream; const v = document.getElementById('cvid'); v.srcObject = stream; await v.play().catch(() => {});
      const tr = stream.getVideoTracks()[0]; run.track = tr; let caps = {}; try { caps = tr.getCapabilities ? tr.getCapabilities() : {}; } catch (e) {}
      if (caps.focusMode && caps.focusMode.includes('continuous')) tr.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      const tb = document.querySelector('#scanov [data-c="torch"]'); if (tb) tb.hidden = !caps.torch;
      C.decKind = dec.kind; let last = '', lastAt = 0;
      const tick = async () => {
        if (C.scan !== run) return;
        let txt = null; try { if (v.readyState >= 2) txt = await dec.run(v); } catch (e) {}
        if (C.scan !== run) return;
        if (txt) { const now = Date.now(); if (!(txt === last && now - lastAt < 2500)) { last = txt; lastAt = now; const sku = toSku(txt);
          if (sku) { if (navigator.vibrate) navigator.vibrate(80); C.lastScan = { txt: String(txt), sku, via: dec.kind }; await stopScan(); (run.cb || C.open)(sku); return; }
          scanMsg(T('ملصق غير معروف: ', 'Unknown label: ') + String(txt).slice(0, 60), true); } }
        run.t = setTimeout(tick, dec.kind === 'native' ? 80 : 120);
      };
      tick();
    } catch (e) { const t = camErr(e); scanMsg(t, true); const fr = document.querySelector('#scanov .fr'); if (fr) fr.hidden = true; C.camErr = t; if (run.stream) run.stream.getTracks().forEach(x => x.stop()); }
  }
  async function stopScan() {
    const run = C.scan; C.scan = null;
    if (run) { clearTimeout(run.t); if (run.stream) run.stream.getTracks().forEach(t => t.stop()); }
    const o = document.getElementById('scanov'); if (o) { const v = o.querySelector('video'); if (v) v.srcObject = null; o.remove(); } document.documentElement.style.overflow = '';
  }
  async function setTorch(on) { const r = C.scan; if (!r || !r.track) throw new Error('no'); await r.track.applyConstraints({ advanced: [{ torch: on }] }); }
  C.stopScan = stopScan;
  function manual() { const el = document.getElementById('cman'); const v = (el && el.value || '').trim(); if (!v) { if (el) el.focus(); return; } const run = C.scan || {}; const sku = toSku(v); if (!sku) { if (run.unknown) { stopScan().then(() => run.unknown(v)); return; } scanMsg(T('رمز غير معروف: ', 'Unknown code: ') + v, true); return; } stopScan().then(() => (run.cb || C.open)(sku)); }

  /* ---------- ملف فودكس («ما لقيته» = صفر) ---------- */
  function csv() {
    const L = lines(); const rows = [['Inventory Item Name', 'Inventory Item SKU', 'Storage quantity', 'Ingredients quantity', 'Inventory Count ID']];
    (C.items || []).forEach(i => { const l = L[i.s]; if (l) rows.push([i.ar, i.s, l.nf ? 0 : l.q, 0, '']); });
    if (rows.length < 2) { window.DALTOAST(T('لا يوجد جرد بعد', 'Nothing counted yet')); return; }
    const txt = '﻿' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const id = (C.st && C.st.cur && C.st.cur.id) || 'count'; const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); a.download = 'foodics-count-' + id + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
    window.DALTOAST((rows.length - 1) + T(' صنف في الملف', ' items in the file'));
  }

  /* ---------- ملصقات QR للطباعة (المحتوى: DAL:<sku>) ---------- */
  const PRINTED = 'dal-labels-printed'; const printed = () => { try { return JSON.parse(localStorage.getItem(PRINTED) || '[]'); } catch (e) { return []; } };
  async function labels(onlyNew, extra) {
    try { await loadLib('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'); } catch (e) { window.DALTOAST(T('تعذّر تحميل مولّد الملصقات', 'Could not load the label maker')); return; }
    const done = new Set(printed()); let list = extra || (onlyNew ? (C.items || []).filter(i => !done.has(i.s)) : (C.items || []).filter(inCat));
    if (!list.length) { window.DALTOAST(T('لا أصناف جديدة للطباعة', 'No new items to print')); return; }
    try { localStorage.setItem(PRINTED, JSON.stringify([...new Set(printed().concat(list.map(i => i.s)))])); } catch (e) {}
    const svg = s => { const q = qrcode(0, 'M'); q.addData('DAL:' + s); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); };
    const w = window.open('', '_blank'); if (!w) { window.DALTOAST(T('اسمح بالنوافذ المنبثقة', 'Allow pop-ups')); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Dal QR labels</title><style>@page{size:A4;margin:8mm}body{font-family:system-ui,Tahoma,sans-serif;margin:0}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}.l{border:1px dashed #999;border-radius:3mm;padding:3mm;display:flex;gap:3mm;align-items:center;break-inside:avoid;height:30mm}.l svg{width:24mm;height:24mm;flex:none}.t{font-size:9pt;line-height:1.3;overflow:hidden}.t b{display:block;font-size:10pt}.t .a{direction:rtl}.t small{color:#555}.bar{padding:3mm 0}@media print{.bar{display:none}}</style></head><body>
      <div class="bar"><button onclick="print()" style="font-size:16px;padding:8px 16px">Print</button> ${list.length} ${T('ملصق', 'labels')} · ${extra ? T('مؤقت', 'Temporary') : onlyNew ? T('الجديدة فقط', 'New only') : esc(CATN(CAT.find(c => c[0] === C.cat)))}</div>
      <div class="g">${list.map(i => `<div class="l">${svg(i.s)}<div class="t"><b>${esc(i.en)}</b><div class="a">${esc(i.ar)}</div><small>${esc(i.s)} · ${esc(i.u)}</small>${i.pending ? `<small style="color:#b00">${T('مؤقت · بانتظار فودكس', 'Temporary · waiting for Foodics')}</small>` : ''}</div></div>`).join('')}</div></body></html>`);
    w.document.close();
  }

  C.labels = labels;
  /* ---------- الأحداث ---------- */
  document.addEventListener('click', async e => {
    if (!e.target.closest) return;
    const it = e.target.closest('[data-item]'); if (it) { C.open(it.getAttribute('data-item')); return; }
    const cat = e.target.closest('[data-cat]'); if (cat) { C.cat = cat.getAttribute('data-cat'); window.DALRENDER(); return; }
    const sp = e.target.closest('[data-step]'); if (sp) { const [id, dv] = sp.getAttribute('data-step').split(':'); const f = document.getElementById(id); if (f) { f.value = Math.max(0, (n(f.value) || 0) + (+dv)); upd(); } return; }
    const wd = e.target.closest('[data-wdel]'); if (wd) { W.splice(+wd.getAttribute('data-wdel'), 1); upd(); return; }
    const ud = e.target.closest('#sheet [data-udel]'); if (ud) { UL.splice(+ud.getAttribute('data-udel'), 1); upd(); return; }
    const un = e.target.closest('#sheet [data-un]'); if (un) { if (un.disabled) return; C.unit = un.getAttribute('data-un'); document.querySelectorAll('#sheet [data-un]').forEach(x => x.setAttribute('aria-pressed', x === un)); upd(); return; }
    const b = e.target.closest('[data-c]'); if (!b) return; const c = b.getAttribute('data-c'); const cur = item(C.edit);
    if (c === 'scan') startScan(); else if (c === 'stop') stopScan(); else if (c === 'man') manual(); else if (c === 'close') closeSheet(); else if (c === 'save') save();
    else if (c === 'torch') { try { await setTorch(!C.torch); C.torch = !C.torch; b.setAttribute('aria-pressed', C.torch); } catch (x) { b.hidden = true; } }
    else if (c === 'addl') { const f = document.getElementById('cu'); const x = n(f && f.value); if (x == null || x <= 0 || !C.unit) { window.DALTOAST(T('اكتب الكمية واختر الوحدة', 'Enter a quantity and pick a unit')); return; } UL.push({ n: x, u: C.unit }); f.value = ''; f.focus(); upd(); }
    else if (c === 'addw') { const x = n(document.getElementById('cw').value); if (x == null || x <= 0) return; W.push(x); document.getElementById('cw').value = ''; document.getElementById('cw').focus(); upd(); }
    else if (c === 'nf') { if (!cur) return; commit(cur, { op: 'line', sku: cur.s, q: 0, nf: 1 }); }
    else if (c === 'del') { const s = C.edit; if (!confirm(T('حذف الجرد لهذا الصنف؟', 'Remove this count?'))) return; delete lines()[s]; closeSheet(); window.DALRENDER(); C.pending.push({ op: 'line', sku: s, del: 1 }); flush(); }
    else if (c === 'csv') csv(); else if (c === 'labels') labels(); else if (c === 'labelsnew') labels(true);
    else if (c === 'new') { if (!confirm(T('بدء جرد جديد؟ الجرد الحالي يُحفظ في السجل.', 'Start a new count? The current one is kept in history.'))) return; try { await post({ op: 'new' }); window.DALRENDER(); window.DALTOAST(T('بدأ جرد جديد', 'New count started')); } catch (x) { window.DALTOAST(T('تعذّر', 'Failed')); } }
  });
  document.addEventListener('input', e => {
    if (e.target.closest && e.target.closest('#sheet')) { if (e.target.id === 'cadd' && e.target.checked) { UL = []; ['cu', 'cd', 'cw'].forEach(k => { const f = document.getElementById(k); if (f) f.value = ''; }); W = []; } upd(); return; }
    if (e.target.id === 'cq') { C.q = e.target.value; clearTimeout(C.qt); C.qt = setTimeout(() => { const el = document.getElementById('cq'); const pos = el ? el.selectionStart : 0; window.DALRENDER(); const nn = document.getElementById('cq'); if (nn) { nn.focus(); nn.setSelectionRange(pos, pos); } }, 250); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'cw') { e.preventDefault(); const bb = document.querySelector('[data-c="addw"]'); if (bb) bb.click(); }
    if (e.key === 'Enter' && e.target.id === 'cu') { e.preventDefault(); const bb = document.querySelector('[data-c="addl"]'); if (bb) bb.click(); }
    if (e.key === 'Enter' && e.target.id === 'cman') { e.preventDefault(); manual(); }
    if (e.key === 'Escape') { if (document.getElementById('scanov')) stopScan(); else if (document.getElementById('sheet')) closeSheet(); }
  });
})();
