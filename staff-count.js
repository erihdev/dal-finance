/* جرد دال بالكاميرا — Stock count with the phone camera.
   يمسح ملصق QR على الصنف (DAL:<sku>) → يُدخل الكراتين والحبات أو الوزن → يُحفظ في live/count_state عبر /staff/count
   → ملف CSV جاهز للاستيراد في Foodics (Inventory Count → Import Items). */
(function () {
  const C = window.DALC = { items: null, st: null, cat: 'all', q: '', edit: null, scan: null, pending: [] };
  const UNITW = { KG: 'kg' };   // أصناف تُوزن (البن والبودرة)
  const LIQ = { Liter: 1 };   // سوائل: عبوات × لتر + المفتوحة
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

  C.load = async function (api) {
    if (!C.items) { try { const r = await fetch('count-items.json?v=' + Date.now()); C.items = (await r.json()).items || []; } catch (e) { C.items = []; } }
    try { const r = await api('/staff/docs?names=count_state'); if (r.ok) C.st = (r.docs || {}).count_state || { cfg: {}, cur: null, hist: [] }; } catch (e) {}
  };
  async function post(body) {
    const r = await window.DALAPI('/staff/count', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.err || 'error'); C.st = r.state; return r;
  }
  function inCat(it) { return C.cat === 'all' || (C.cat === 'other' ? !MAIN.has(it.c) : it.c === C.cat); }

  /* ---------- الصفحة الرئيسية ---------- */
  let LANG = 'ar'; try { LANG = localStorage.getItem('dal-count-lang') || 'ar'; } catch (e) {}
  const T = (ar, en) => LANG === 'en' ? en : ar;
  const DIR = () => LANG === 'en' ? 'dir="ltr" style="text-align:left"' : 'dir="rtl" style="text-align:right"';
  const nm = i => LANG === 'en' ? i.en : i.ar; const nm2 = i => LANG === 'en' ? i.ar : i.en;
  const CATN = c => LANG === 'en' ? c[1] : c[2];
  const ICO = { 'Green Coffee': '🫘', 'Roasted Coffee': '☕', 'Packaging': '🥤', 'Milk': '🥛', 'Sauce': '🍯', 'Syrup': '🧴', 'Powder': '🧂', 'Cake': '🍰', 'Water & Drink': '💧', 'Fresh Product': '🍋', 'Filters': '🧻', 'Cleaning': '🧽', 'Other': '📦', all: '✦', other: '📦' };
  const ico = c => ICO[c] || '📦';
  // تصميم مستقل لتبويب الجرد: بطاقة تقدّم داكنة، قائمة بطاقات، زر مسح عائم في متناول الإبهام، وأزرار ± كبيرة بدل الكتابة
  const CSS = `<style id="dc-css">
  .dc{--e:#21140D;--e2:#4A2C1B;--a:#F26B1D;--ok:#1E8E5A;--bad:#E5484D;--mut:#8E8E93;--line:#E5E5EA;--card:#fff;--soft:#F2F2F7;font-feature-settings:"tnum";padding-bottom:96px}
  .dc-top{display:flex;align-items:center;gap:10px;margin:.2rem 0 .8rem}.dc-top h2{flex:1;margin:0;font-size:1.45rem;font-weight:800;letter-spacing:-.01em}
  .dc-pill{border:0;background:var(--soft);color:var(--e);border-radius:999px;padding:.45rem .9rem;font:inherit;font-size:.8rem;font-weight:700;cursor:pointer}
  .dc-hero{background:linear-gradient(135deg,var(--e),var(--e2));color:#fff;border-radius:24px;padding:18px;display:flex;align-items:center;gap:16px;box-shadow:0 12px 28px -14px rgba(33,20,13,.7)}
  .dc-hero .k{flex:1;min-width:0}.dc-hero .big{font-size:2rem;font-weight:800;line-height:1}.dc-hero .big small{font-size:.95rem;opacity:.6;font-weight:600}
  .dc-hero .sub{font-size:.8rem;opacity:.75;margin-top:.35rem}.dc-hero .tags{display:flex;gap:6px;margin-top:.7rem;flex-wrap:wrap}.dc-hero .tags span{background:rgba(255,255,255,.12);border-radius:999px;padding:.2rem .65rem;font-size:.72rem}
  .dc-ring{width:84px;height:84px;flex:none}
  .dc-search{display:flex;align-items:center;gap:8px;background:var(--soft);border-radius:14px;padding:0 .8rem;margin:14px 0 10px}.dc-search input{border:0;background:transparent;margin:0;padding:.8rem 0;font-size:1rem}.dc-search input:focus{outline:none}
  .dc-cats{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 8px;margin:0 -2px;scrollbar-width:none}.dc-cats::-webkit-scrollbar{display:none}
  .dc-cats button{flex:none;display:flex;align-items:center;gap:6px;border:1px solid var(--line);background:#fff;border-radius:14px;padding:.5rem .8rem;font:inherit;font-size:.85rem;color:var(--e);cursor:pointer}
  .dc-cats button[aria-pressed=true]{background:var(--e);border-color:var(--e);color:#fff}
  .dc-h{display:flex;align-items:center;gap:8px;margin:14px 2px 8px;font-size:.78rem;font-weight:800;color:var(--mut);letter-spacing:.02em}.dc-h i{width:8px;height:8px;border-radius:50%;display:inline-block}
  .dc-list{background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 1px 0 var(--line),0 6px 18px -12px rgba(0,0,0,.18)}
  .dc-it{display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer;border-bottom:1px solid var(--soft)}.dc-it:last-child{border-bottom:0}.dc-it:active{background:var(--soft)}
  .dc-av{width:42px;height:42px;border-radius:12px;background:var(--soft);display:grid;place-items:center;font-size:1.25rem;flex:none}
  .dc-it .t{flex:1;min-width:0}.dc-it .t b{display:block;font-size:.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-it .t small{display:block;font-size:.73rem;color:var(--mut);margin-top:2px}
  .dc-q{text-align:center;min-width:58px}.dc-q b{display:block;font-size:1rem}.dc-q small{font-size:.66rem;color:var(--mut)}
  .dc-q.no b{color:#C7C7CC}.dc-it.ok .dc-av{background:#E3F4EC}
  .dc-tools{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px}.dc-tools button{border:0;background:#fff;border-radius:16px;padding:14px 6px;font:inherit;font-size:.76rem;font-weight:700;color:var(--e);cursor:pointer;box-shadow:0 1px 0 var(--line)}.dc-tools button span{display:block;font-size:1.35rem;margin-bottom:4px}
  .dc-fab{position:fixed;bottom:calc(74px + env(safe-area-inset-bottom));inset-inline:0;margin:0 auto;width:min(320px,calc(100% - 48px));border:0;border-radius:999px;background:var(--a);color:#fff;font:inherit;font-size:1.08rem;font-weight:800;padding:1rem;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 14px 30px -10px rgba(242,107,29,.75);z-index:4;cursor:pointer}
  .dc-cam{margin-top:12px;border-radius:20px;overflow:hidden;background:#000}
  .dc-warnbar{background:#FFF4D6;color:#8A5A00;border-radius:12px;padding:.6rem .8rem;font-size:.8rem;margin-top:10px}
  .dc-sh{position:fixed;inset:0;background:rgba(10,6,4,.5);z-index:20;display:flex;align-items:flex-end}
  .dc-pan{background:#F7F7F9;width:100%;max-width:640px;margin:0 auto;border-radius:26px 26px 0 0;padding:10px 16px calc(16px + env(safe-area-inset-bottom));max-height:94vh;overflow:auto}
  .dc-grab{width:40px;height:5px;border-radius:9px;background:#D1D1D6;margin:0 auto 12px}
  .dc-ph{display:flex;gap:12px;align-items:center}.dc-ph .dc-av{width:52px;height:52px;font-size:1.5rem;background:#fff}.dc-ph b{font-size:1.1rem;display:block}.dc-ph small{color:var(--mut);font-size:.78rem}
  .dc-x{margin-inline-start:auto;border:0;background:#E9E9EE;width:34px;height:34px;border-radius:50%;font-size:.95rem;cursor:pointer;flex:none}
  .dc-unit{display:flex;gap:8px;align-items:center;background:#E8F3EE;color:#14593B;border-radius:14px;padding:.6rem .8rem;font-size:.84rem;margin-top:12px}
  .dc-grp{background:#fff;border-radius:18px;padding:4px 14px;margin-top:12px}
  .dc-f{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--soft)}.dc-f:last-child{border-bottom:0}.dc-f label{flex:1;font-size:.88rem;font-weight:600;line-height:1.35}
  .dc-st{display:flex;align-items:center;gap:6px}.dc-st button{width:42px;height:42px;border-radius:12px;border:0;background:var(--soft);font-size:1.3rem;font-weight:700;color:var(--e);cursor:pointer}.dc-st button:active{background:#E0E0E6}
  .dc-st input{width:84px;text-align:center;margin:0;border:1.5px solid var(--line);border-radius:12px;padding:.55rem .2rem;font-size:1.1rem;font-weight:700}.dc-st input:focus{border-color:var(--e);outline:none}
  .dc-f.wide{flex-wrap:wrap}.dc-f.wide input{flex:1;min-width:0;margin:0}
  .dc-tot{background:var(--e);color:#fff;border-radius:20px;padding:14px 16px;margin-top:12px;display:flex;align-items:center;gap:10px}.dc-tot small{opacity:.7;font-size:.78rem;flex:1}.dc-tot b{font-size:1.9rem;font-weight:800}.dc-tot em{font-style:normal;opacity:.7;font-size:.85rem}
  .dc-save{width:100%;border:0;border-radius:16px;background:var(--ok);color:#fff;font:inherit;font-weight:800;font-size:1.08rem;padding:1rem;margin-top:12px;cursor:pointer}
  .dc-del{width:100%;border:0;background:transparent;color:var(--bad);font:inherit;font-weight:700;padding:.8rem;cursor:pointer}
  .dc-chips{display:flex;flex-wrap:wrap;gap:6px;padding:4px 0 10px}.dc-chips button{border:0;background:var(--soft);border-radius:999px;padding:.35rem .7rem;font:inherit;font-size:.8rem;cursor:pointer}
  </style>`;
  function ring(done, tot) {
    const r = 34, L = 2 * Math.PI * r, f = tot ? done / tot : 0;
    return `<svg class="dc-ring" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="${r}" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="9"/><circle cx="42" cy="42" r="${r}" fill="none" stroke="#F26B1D" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(L * f).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 42 42)"/><text x="42" y="47" text-anchor="middle" fill="#fff" font-size="16" font-weight="800">${Math.round(f * 100)}%</text></svg>`;
  }
  C.view = function () {
    if (!C.items) return '<div class="note">' + T('جارٍ التحميل…', 'Loading…') + '</div>';
    const L = lines(); const done = C.items.filter(i => L[i.s]).length; const tot = C.items.length;
    const q = C.q.trim().toLowerCase();
    const list = C.items.filter(inCat).filter(i => !q || i.en.toLowerCase().includes(q) || i.ar.includes(C.q.trim()) || i.s.toLowerCase().includes(q));
    const todo = list.filter(i => !L[i.s]), ok = list.filter(i => L[i.s]);
    const cur = C.st && C.st.cur;
    return CSS + `<div class="dc" ${DIR()}>
    <div class="dc-top"><h2>${T('الجرد', 'Stock count')}</h2><button class="dc-pill" data-c="lang">${T('English', 'عربي')}</button></div>
    <div class="dc-hero">${ring(done, tot)}<div class="k"><div class="big">${done} <small>/ ${tot}</small></div><div class="sub">${T('صنف مجرود', 'items counted')} · <b>${tot - done}</b> ${T('باقي', 'left')}</div>
      <div class="tags"><span>${cur ? esc(cur.id) : T('لم يبدأ جرد', 'No count yet')}</span>${cur && cur.by ? `<span>👤 ${esc(cur.by)}</span>` : ''}</div></div></div>
    <div id="scanbox" class="dc-cam" style="display:${C.scan ? 'block' : 'none'}"><div id="reader" style="width:100%"></div><button class="dc-del" data-c="stop" style="color:#fff">✕ ${T('إغلاق الكاميرا', 'Close camera')}</button></div>
    <div class="dc-search"><span>🔍</span><input id="cq" placeholder="${T('ابحث بالاسم أو الرمز', 'Search name or SKU')}" value="${esc(C.q)}"></div>
    <div class="dc-cats">${CAT.map(c => `<button data-cat="${c[0]}" aria-pressed="${C.cat === c[0]}"><span>${ico(c[0])}</span>${CATN(c)}</button>`).join('')}</div>
    ${C.pending.length ? `<div class="dc-warnbar">⏳ ${C.pending.length} ${T('لم تُحفظ بعد (لا يوجد نت) — يعيد المحاولة', 'not saved yet (no internet) — will retry')}</div>` : ''}
    ${todo.length ? `<div class="dc-h"><i style="background:var(--bad)"></i>${T('لم يُجرد', 'NOT COUNTED')} · ${todo.length}</div><div class="dc-list">${todo.map(row).join('')}</div>` : ''}
    ${ok.length ? `<div class="dc-h"><i style="background:var(--ok)"></i>${T('مجرود', 'COUNTED')} · ${ok.length}</div><div class="dc-list">${ok.map(row).join('')}</div>` : ''}
    <div class="dc-tools"><button data-c="csv"><span>⬇️</span>${T('ملف فودكس', 'Foodics file')}</button><button data-c="labels"><span>🏷️</span>${T('ملصقات QR', 'QR labels')}</button><button data-c="new"><span>↻</span>${T('جرد جديد', 'New count')}</button></div>
    ${C.scan ? '' : `<button class="dc-fab" data-c="scan"><span style="font-size:1.3rem">📷</span>${T('امسح الملصق', 'Scan label')}</button>`}</div>`;
  };
  function row(i) {
    const l = lines()[i.s];
    return `<div class="dc-it ${l ? 'ok' : ''}" data-item="${esc(i.s)}"><div class="dc-av">${l ? '✅' : ico(i.c)}</div><div class="t"><b>${esc(nm(i))}</b><small>${esc(nm2(i))} · ${esc(i.s)}</small></div><div class="dc-q ${l ? '' : 'no'}"><b>${l ? fmt(l.q) : '—'}</b><small>${esc(i.u)}</small></div></div>`;
  }

  /* ---------- شاشة إدخال الصنف ---------- */
  const stp = (id, label, val, ph) => `<div class="dc-f"><label for="${id}">${label}</label><div class="dc-st"><button type="button" data-step="${id}:-1" aria-label="−">−</button><input id="${id}" inputmode="decimal" value="${esc(val)}" placeholder="${esc(ph == null ? '0' : ph)}"><button type="button" data-step="${id}:1" aria-label="+">+</button></div></div>`;
  const fld = (id, label, val, ph) => `<div class="dc-f"><label for="${id}">${label}</label><div class="dc-st"><input id="${id}" inputmode="decimal" value="${esc(val)}" placeholder="${esc(ph || '')}" style="width:126px"></div></div>`;
  function sheet() {
    const it = item(C.edit); if (!it) return '';
    const l = lines()[it.s] || {}; const cf = cfg(it.s); const w = isW(it); const u = esc(it.u);
    const pc = l.pc != null ? l.pc : (cf.pc != null ? cf.pc : '');
    const t = l.t != null ? l.t : (cf.t != null ? cf.t : '');
    const pk = !w && isPK(it); const F = +it.f; const liq = LIQ[it.u];
    const had = lines()[it.s];
    const v0 = x => x != null ? x : '';
    const prevBox = had ? `<div class="dc-warnbar" style="margin-top:12px">${T('محفوظ لهذا الصنف', 'Already saved')}: <b>${fmt(had.q)} ${u}</b>${had.note ? ' · 📍' + esc(had.note) : ''}<label style="display:flex;gap:10px;align-items:center;margin-top:.5rem;font-weight:800;color:#3a2a00"><input type="checkbox" id="cadd" style="width:22px;height:22px;margin:0;flex:none"> ${T('هذا مكان ثاني: أضف على المحفوظ', 'Another place: add to the saved amount')}</label><small style="display:block;margin-top:.2rem">${T('بدون صح: الرقم الجديد يستبدل المحفوظ (للتصحيح).', 'Unticked: the new number replaces the saved one (to correct it).')}</small></div>` : '';
    const unit = pk ? `<div class="dc-unit">ℹ️ <span>${T('فودكس يحسب هذا الصنف بالـ', 'Foodics counts this item in ')}<b>${u}</b>${T('، والـ' + u + ' فيه ', '; one ' + u + ' = ')}<b>${F}</b> ${T('حبة', 'pcs')}.</span></div>` : '';
    const body = pk ? `<div class="dc-grp">${stp('cc', T(u + ' كاملة مقفلة', 'Full sealed ' + u), v0(l.c))}${stp('cl', T('حبات سائبة من ' + u + ' مفتوح', 'Loose pieces from an open ' + u), v0(l.l))}${fld('cd', T('أو المجموع مباشرة (' + u + ')', 'Or total directly (' + u + ')'), '', u)}</div>`
      : w ? `<div class="dc-grp"><div class="dc-f wide"><label for="cw" style="flex-basis:100%">${T('زِن كل كيس أو حاوية واضغط «أضف»', 'Weigh each bag / container, then Add')}</label><input id="cw" inputmode="decimal" placeholder="${T('الوزن القائم (كجم) مثلاً 24.6', 'Gross kg, e.g. 24.6')}"><button class="dc-pill" data-c="addw" style="background:var(--e);color:#fff;padding:.7rem 1.1rem">＋ ${T('أضف', 'Add')}</button></div>
        <div id="wl" class="dc-chips">${(l.w || []).map((x, k) => `<button data-wdel="${k}">${fmt(x)} ✕</button>`).join('')}</div>
        ${fld('ct', T('وزن الكيس أو الحاوية فارغة (كجم)', 'Empty bag / container (kg)'), t, '0')}${fld('cd', T('أو الصافي مباشرة', 'Or net total directly'), '', u)}</div>`
      : `<div class="dc-grp">${stp('cc', liq ? T('عبوات مليانة', 'Full bottles') : T('كراتين كاملة مقفلة', 'Full sealed cartons'), v0(l.c))}${fld('cp', liq ? T('لتر في العبوة', 'Liters per bottle') : T('العدد في الكرتون (' + u + ')', u + ' per carton'), pc, liq ? '1' : '50')}${stp('cl', liq ? T('المفتوحة: كم لتر باقي', 'Open bottle: liters left') : T('السائب (' + u + ')', 'Loose ' + u), v0(l.l))}${fld('cd', T('أو المجموع مباشرة', 'Or total directly'), '', u)}</div>`;
    return `<div id="sheet" class="dc dc-sh" ${DIR().replace(/style="[^"]*"/, '')} style="padding:0"><div class="dc-pan">
      <div class="dc-grab"></div>
      <div class="dc-ph"><div class="dc-av">${ico(it.c)}</div><div style="min-width:0"><b>${esc(nm(it))}</b><small>${esc(nm2(it))} · ${esc(it.s)}${cf.loc ? ' · 📍' + esc(cf.loc) : ''}</small></div><button class="dc-x" data-c="close" aria-label="close">✕</button></div>
      ${unit}${prevBox}${body}
      <div class="dc-grp"><div class="dc-f wide"><label for="cloc" style="flex-basis:100%">📍 ${T('المكان (اختياري)', 'Place (optional)')}</label><input id="cloc" value="${esc(cf.loc || '')}" placeholder="${T('مثلاً مستودع رف 2', 'e.g. Store A2')}"></div></div>
      <div class="dc-tot"><small>${T('الكمية اللي بتنحفظ', 'Total to save')}</small><b id="ctot">—</b><em>${u}</em></div>
      <div id="cwarn" style="display:none;background:#FDECEC;color:#B03A2E;border-radius:12px;padding:.6rem .8rem;font-size:.85rem;font-weight:700;margin-top:10px"></div>
      <button class="dc-save" data-c="save">✓ ${T('حفظ', 'Save')}</button>
      ${had ? `<button class="dc-del" data-c="del">${T('حذف الجرد لهذا الصنف', 'Remove this count')}</button>` : ''}
    </div></div>`;
  }
  let W = [];
  function total() {
    const it = item(C.edit); if (!it) return null; const v = id => n((document.getElementById(id) || {}).value);
    const add = (document.getElementById('cadd') || {}).checked && lines()[it.s] ? +lines()[it.s].q || 0 : 0;
    const x = part(it, v); return x == null ? null : r4(x + add);
  }
  function part(it, v) {
    const d = v('cd'); if (d != null) return r4(d);
    if (isPK(it)) { const c = v('cc'), l = v('cl'); if (c == null && l == null) return null; return r4((c || 0) + (l || 0) / +it.f); }
    if (isW(it)) { if (!W.length) return null; const t = v('ct') || 0; return r4(Math.max(0, W.reduce((a, x) => a + x, 0) - W.length * t)); }
    const c = v('cc'), p = v('cp'), l = v('cl'); if (c == null && l == null) return null; if (c && p == null) return null; return r4((c || 0) * (p || 0) + (l || 0));
  }
  function upd() { const el = document.getElementById('ctot'); if (!el) return; const t = total(); el.textContent = t == null ? '—' : fmt(t); C.warned = null; const wn = document.getElementById('cwarn'); if (wn) wn.style.display = 'none'; const it = item(C.edit); if (it && isW(it)) { const wl = document.getElementById('wl'); if (wl) wl.innerHTML = W.map((x, k) => `<button data-wdel="${k}">${fmt(x)} ✕</button>`).join('') + (W.length ? `<small style="align-self:center;color:var(--ink3)">${W.length} ${T('كيس', 'bag(s)')} · ${fmt(W.reduce((a, x) => a + x, 0))} ${UNITW[it.u]}</small>` : ''); } }
  C.open = function (sku) {
    const it = item(sku); if (!it) { window.DALTOAST(T('ملصق غير معروف: ', 'Unknown label: ') + sku); return; }
    C.edit = sku; W = ((lines()[sku] || {}).w || []).slice(); const old = document.getElementById('sheet'); if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', sheet()); upd(); const f = document.getElementById(isW(it) ? 'cw' : 'cc'); if (f) setTimeout(() => f.focus(), 150);
  };
  function closeSheet() { C.edit = null; const s = document.getElementById('sheet'); if (s) s.remove(); }

  async function save() {
    const it = item(C.edit); const q = total(); if (q == null) { window.DALTOAST(T('أدخل الكمية أولاً', 'Enter a quantity first')); return; }
    const v = id => n((document.getElementById(id) || {}).value); const loc = ((document.getElementById('cloc') || {}).value || '').trim();
    const adding = !!(document.getElementById('cadd') || {}).checked && !!lines()[it.s];
    // تنبيه: الرقم بعيد جداً عن آخر جرد (غالباً خطأ وحدة: حبات بدل علب، جرام بدل كيلو)
    const pq = prevQ(it.s);
    if (pq != null && pq > 0 && (q > pq * 3 || q < pq / 3) && C.warned !== it.s + ':' + q) {
      C.warned = it.s + ':' + q; const wn = document.getElementById('cwarn');
      if (wn) { wn.textContent = T('⚠ الرقم بعيد جداً عن آخر جرد. تأكد من الوحدة (' + it.u + ') ثم اضغط حفظ مرة ثانية.', '⚠ Very different from the last count. Check the unit (' + it.u + '), then tap Save again.'); wn.style.display = 'block'; }
      if (navigator.vibrate) navigator.vibrate([60, 60, 60]); return;
    }
    const oldNote = adding ? (lines()[it.s].note || '') : '';
    const note = (adding ? [oldNote || '—', loc || '—'].join(' + ') : loc).slice(0, 120);
    const body = isW(it) ? { op: 'line', sku: it.s, q, w: W, b: W.length, t: v('ct'), note } : isPK(it) ? { op: 'line', sku: it.s, q, c: v('cc'), l: v('cl'), note } : { op: 'line', sku: it.s, q, c: v('cc'), pc: v('cp'), l: v('cl'), note };
    const cf = cfg(it.s); const cb = { op: 'cfg', sku: it.s };
    if (isW(it)) { if (v('ct') != null && v('ct') !== cf.t) cb.t = v('ct'); } else if (!isPK(it) && v('cp') != null && v('cp') !== cf.pc) cb.pc = v('cp');
    if (loc !== (cf.loc || '')) cb.loc = loc;
    // تحديث محلي فوري ثم إرسال (مع إعادة المحاولة عند انقطاع النت)
    C.st = C.st || { cfg: {}, cur: null, hist: [] }; C.st.cur = C.st.cur || { id: 'new', by: '', lines: {} }; C.st.cur.lines[it.s] = Object.assign({}, body, { at: new Date().toISOString() });
    closeSheet(); window.DALRENDER(); window.DALTOAST('✓ ' + nm(it) + ' = ' + fmt(q) + ' ' + it.u);
    const jobs = [body]; if (Object.keys(cb).length > 2) jobs.push(cb); C.pending.push(...jobs); flush();
  }
  async function flush() {
    while (C.pending.length) { try { await post(C.pending[0]); C.pending.shift(); } catch (e) { setTimeout(flush, 8000); window.DALRENDER(); return; } }
    window.DALRENDER();
  }

  /* ---------- الكاميرا ---------- */
  function loadLib(src) { return new Promise((ok, no) => { if (document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
  async function startScan() {
    try { await loadLib('https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js'); } catch (e) { window.DALTOAST(T('تعذّر تحميل الكاميرا', 'Camera failed to load')); return; }
    C.scan = true; window.DALRENDER(); const box = document.getElementById('scanbox'); if (box) box.style.display = 'block';
    try {
      const h = C.h = new Html5Qrcode('reader'); let last = '';
      await h.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, hh) => { const m = Math.floor(Math.min(w, hh) * 0.75); return { width: m, height: m }; } }, txt => {
        if (txt === last) return; last = txt; setTimeout(() => { last = ''; }, 2500);
        const m = String(txt).trim().match(/^DAL:(.+)$/i); const sku = m ? m[1].trim() : String(txt).trim();
        if (navigator.vibrate) navigator.vibrate(80); stopScan().then(() => C.open(sku));
      }, () => {});
    } catch (e) { try { if (C.h) C.h.clear(); } catch (x) {} C.h = null; C.scan = null; window.DALRENDER(); window.DALTOAST(T('اسمح للمتصفح بالكاميرا ثم جرّب مرة ثانية', 'Allow camera access, then try again')); }
  }
  async function stopScan() { try { if (C.h) { await C.h.stop(); C.h.clear(); } } catch (e) {} C.h = null; C.scan = null; const box = document.getElementById('scanbox'); if (box) box.style.display = 'none'; }

  /* ---------- ملف فودكس ---------- */
  function csv() {
    const L = lines(); const rows = [['Inventory Item Name', 'Inventory Item SKU', 'Storage quantity', 'Ingredients quantity', 'Inventory Count ID']];
    (C.items || []).forEach(i => { const l = L[i.s]; if (l) rows.push([i.ar, i.s, l.q, 0, '']); });
    if (rows.length < 2) { window.DALTOAST(T('لا يوجد جرد بعد', 'Nothing counted yet')); return; }
    const txt = '﻿' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const id = (C.st && C.st.cur && C.st.cur.id) || 'count'; const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); a.download = 'foodics-count-' + id + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
    window.DALTOAST('⬇ ' + (rows.length - 1) + T(' صنف', ' items'));
  }

  /* ---------- ملصقات QR للطباعة ---------- */
  async function labels() {
    try { await loadLib('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'); } catch (e) { window.DALTOAST(T('تعذّر', 'Failed')); return; }
    const list = (C.items || []).filter(inCat);
    const svg = s => { const q = qrcode(0, 'M'); q.addData('DAL:' + s); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); };
    const w = window.open('', '_blank'); if (!w) { window.DALTOAST(T('اسمح بالنوافذ المنبثقة', 'Allow pop-ups')); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Dal QR labels</title><style>@page{size:A4;margin:8mm}body{font-family:system-ui,Tahoma,sans-serif;margin:0}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}.l{border:1px dashed #999;border-radius:3mm;padding:3mm;display:flex;gap:3mm;align-items:center;break-inside:avoid;height:30mm}.l svg{width:24mm;height:24mm;flex:none}.t{font-size:9pt;line-height:1.3;overflow:hidden}.t b{display:block;font-size:10pt}.t .a{direction:rtl}.t small{color:#555}.bar{padding:3mm 0}@media print{.bar{display:none}}</style></head><body>
      <div class="bar"><button onclick="print()" style="font-size:16px;padding:8px 16px">🖨 Print</button> ${list.length} ${T('ملصق', 'labels')} · ${esc(CATN(CAT.find(c => c[0] === C.cat)))}</div>
      <div class="g">${list.map(i => `<div class="l">${svg(i.s)}<div class="t"><b>${esc(i.en)}</b><div class="a">${esc(i.ar)}</div><small>${esc(i.s)} · ${esc(i.u)}</small></div></div>`).join('')}</div></body></html>`);
    w.document.close();
  }

  /* ---------- الأحداث ---------- */
  document.addEventListener('click', async e => {
    const it = e.target.closest('[data-item]'); if (it) { C.open(it.getAttribute('data-item')); return; }
    const cat = e.target.closest('[data-cat]'); if (cat) { C.cat = cat.getAttribute('data-cat'); window.DALRENDER(); return; }
    const sp = e.target.closest('[data-step]'); if (sp) { const [id, dv] = sp.getAttribute('data-step').split(':'); const f = document.getElementById(id); if (f) { f.value = Math.max(0, (n(f.value) || 0) + (+dv)); upd(); } return; }
    const wd = e.target.closest('[data-wdel]'); if (wd) { W.splice(+wd.getAttribute('data-wdel'), 1); upd(); return; }
    const b = e.target.closest('[data-c]'); if (!b) return; const c = b.getAttribute('data-c');
    if (c === 'scan') startScan(); else if (c === 'stop') stopScan(); else if (c === 'close') closeSheet(); else if (c === 'save') save();
    else if (c === 'addw') { const x = n(document.getElementById('cw').value); if (x == null || x <= 0) return; W.push(x); document.getElementById('cw').value = ''; document.getElementById('cw').focus(); upd(); }
    else if (c === 'del') { const s = C.edit; if (!confirm(T('حذف؟', 'Remove?'))) return; delete lines()[s]; closeSheet(); window.DALRENDER(); C.pending.push({ op: 'line', sku: s, del: 1 }); flush(); }
    else if (c === 'csv') csv(); else if (c === 'labels') labels();
    else if (c === 'lang') { LANG = LANG === 'en' ? 'ar' : 'en'; try { localStorage.setItem('dal-count-lang', LANG); } catch (x) {} window.DALRENDER(); }
    else if (c === 'new') { if (!confirm(T('بدء جرد جديد؟ الجرد الحالي يُحفظ في السجل.', 'Start a new count? The current one is kept in history.'))) return; try { await post({ op: 'new' }); window.DALRENDER(); window.DALTOAST(T('✓ جرد جديد', '✓ New count')); } catch (x) { window.DALTOAST(T('تعذّر', 'Failed')); } }
  });
  document.addEventListener('input', e => {
    if (e.target.closest && e.target.closest('#sheet')) { if (e.target.id === 'cadd' && e.target.checked) { ['cc', 'cl', 'cd', 'cw'].forEach(k => { const f = document.getElementById(k); if (f) f.value = ''; }); W = []; } upd(); return; }
    if (e.target.id === 'cq') { C.q = e.target.value; clearTimeout(C.qt); C.qt = setTimeout(() => { const el = document.getElementById('cq'); const pos = el ? el.selectionStart : 0; window.DALRENDER(); const nn = document.getElementById('cq'); if (nn) { nn.focus(); nn.setSelectionRange(pos, pos); } }, 250); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'cw') { e.preventDefault(); const bb = document.querySelector('[data-c="addw"]'); if (bb) bb.click(); } });
})();
