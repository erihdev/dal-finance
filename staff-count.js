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
  C.view = function () {
    if (!C.items) return '<div class="note">Loading… · جارٍ التحميل…</div>';
    const L = lines(); const done = C.items.filter(i => L[i.s]).length; const tot = C.items.length;
    const q = C.q.trim().toLowerCase();
    const list = C.items.filter(inCat).filter(i => !q || i.en.toLowerCase().includes(q) || i.ar.includes(C.q.trim()) || i.s.toLowerCase().includes(q));
    const todo = list.filter(i => !L[i.s]), ok = list.filter(i => L[i.s]);
    const cur = C.st && C.st.cur;
    return `<div dir="ltr" style="text-align:left"><h2>📦 Stock count · <span dir="rtl">الجرد</span></h2>
    <div class="note">Scan the QR label on the shelf or bag, enter cartons + loose pieces (or the weight), save. When finished: <b>Download Foodics file</b> and import it in Foodics → Inventory Count.<br><span dir="rtl">امسح ملصق الصنف، أدخل الكراتين والحبات أو الوزن، احفظ. في النهاية نزّل ملف فودكس واستورده في الجرد.</span></div>
    <div class="sum"><div><b>${done}/${tot}</b><small>counted · مجرود</small></div><div><b style="color:${tot - done ? '#D9534F' : '#1f6b4a'}">${tot - done}</b><small>left · باقي</small></div><div><b style="font-size:.78rem">${cur ? esc(cur.id) : '—'}</b><small>${cur ? esc(cur.by || '') : 'no count yet'}</small></div></div>
    <button class="btn o" data-c="scan" style="font-size:1.1rem;padding:1.1rem">📷 Scan label · امسح الملصق</button>
    <div id="scanbox" style="display:${C.scan ? 'block' : 'none'};margin-top:.6rem"><div id="reader" style="width:100%;border-radius:14px;overflow:hidden;background:#000"></div><button class="btn s" data-c="stop">✕ Close camera · إغلاق الكاميرا</button></div>
    <input id="cq" placeholder="Search name or SKU · ابحث بالاسم" value="${esc(C.q)}" style="margin-top:.6rem">
    <div class="chips">${CAT.map(c => `<button data-cat="${c[0]}" aria-pressed="${C.cat === c[0]}">${c[1]}</button>`).join('')}</div>
    ${todo.length ? `<div class="note" style="color:#D9534F;margin:.2rem 0">Not counted · لم يُجرد (${todo.length})</div>` : ''}
    ${todo.map(row).join('')}
    ${ok.length ? `<div class="note" style="color:#1f6b4a;margin:.6rem 0 .2rem">Counted · مجرود (${ok.length})</div>` : ''}
    ${ok.map(row).join('')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:.8rem">
      <button class="btn" data-c="csv">⬇ Download Foodics file<br><small style="font-weight:400">ملف فودكس</small></button>
      <button class="btn s" data-c="labels">🖨 Print QR labels<br><small style="font-weight:400">طباعة الملصقات</small></button></div>
    <button class="btn s" data-c="new" style="margin-top:6px">↻ Start a new count · جرد جديد</button>
    ${C.pending.length ? `<div class="note" style="color:#d9a21b">⏳ ${C.pending.length} not saved yet (no internet) — will retry · لم تُحفظ بعد</div>` : ''}</div>`;
  };
  function row(i) {
    const l = lines()[i.s];
    return `<div class="row" data-item="${esc(i.s)}" style="cursor:pointer"><span class="st ${l ? 'ok' : 'bad'}">${l ? '✅' : '○'}</span><span class="r"><b>${esc(i.en)}</b><small><span dir="rtl">${esc(i.ar)}</span> · ${esc(i.s)} · ${esc(i.u)}</small></span><span style="text-align:center;min-width:64px"><b style="font-size:1rem">${l ? fmt(l.q) : '—'}</b><small style="color:var(--ink3);font-size:.7rem">${esc(i.u)}</small></span></div>`;
  }

  /* ---------- شاشة إدخال الصنف ---------- */
  function sheet() {
    const it = item(C.edit); if (!it) return '';
    const l = lines()[it.s] || {}; const cf = cfg(it.s); const w = isW(it);
    const pc = l.pc != null ? l.pc : (cf.pc != null ? cf.pc : '');
    const t = l.t != null ? l.t : (cf.t != null ? cf.t : '');
    const body = w ? `
      <div class="note">Weigh each bag/container and add it. Net = total − (bags × empty bag weight).<br><span dir="rtl">زِن كل كيس أو حاوية وأضفه. الصافي = المجموع − (عدد الأكياس × وزن الكيس الفارغ).</span></div>
      <label class="lb">Gross weight of one bag (${UNITW[it.u]}) · الوزن القائم</label>
      <div style="display:flex;gap:6px"><input id="cw" inputmode="decimal" placeholder="e.g. 24.6"><button class="btn" data-c="addw" style="width:auto;margin:0;padding:.6rem 1rem">＋ Add</button></div>
      <div id="wl" class="chips">${(l.w || []).map((x, k) => `<button data-wdel="${k}">${fmt(x)} ✕</button>`).join('')}</div>
      <label class="lb">Empty bag / container weight (${UNITW[it.u]}) · وزن الكيس الفارغ</label><input id="ct" inputmode="decimal" value="${esc(t)}" placeholder="0">
      <label class="lb">Or type the net total directly · أو اكتب الصافي مباشرة</label><input id="cd" inputmode="decimal" placeholder="net ${esc(it.u)}">`
      : `
      <label class="lb">${LIQ[it.u] ? 'Full bottles / cans · عبوات مليانة' : 'Full cartons · كراتين كاملة'}</label><input id="cc" inputmode="decimal" value="${esc(l.c != null ? l.c : '')}" placeholder="0">
      <label class="lb">${LIQ[it.u] ? 'Liters in one bottle · لتر في العبوة' : esc(it.u) + ' per carton · العدد في الكرتون'}</label><input id="cp" inputmode="decimal" value="${esc(pc)}" placeholder="${LIQ[it.u] ? 'e.g. 1' : 'e.g. 50'}">
      <label class="lb">${LIQ[it.u] ? 'Open bottle, liters left (estimate) · المفتوحة (تقدير باللتر)' : 'Loose ' + esc(it.u) + ' (open carton / shelf) · السائب'}</label><input id="cl" inputmode="decimal" value="${esc(l.l != null ? l.l : '')}" placeholder="0">
      <label class="lb">Or type the total directly · أو اكتب المجموع مباشرة</label><input id="cd" inputmode="decimal" placeholder="total ${esc(it.u)}">`;
    return `<div id="sheet" dir="ltr" style="text-align:left;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:20;display:flex;align-items:flex-end"><div style="background:var(--bg);width:100%;max-width:640px;margin:0 auto;border-radius:18px 18px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));max-height:92vh;overflow:auto">
      <div style="display:flex;align-items:flex-start;gap:8px"><div style="flex:1"><b style="font-size:1.08rem">${esc(it.en)}</b><div class="note" style="margin:0"><span dir="rtl">${esc(it.ar)}</span> · ${esc(it.s)} · unit <b>${esc(it.u)}</b>${cf.loc ? ' · 📍' + esc(cf.loc) : ''}</div></div><button class="btn s" data-c="close" style="width:auto;margin:0;padding:.4rem .8rem">✕</button></div>
      ${body}
      <label class="lb">Shelf / place (optional) · المكان</label><input id="cloc" value="${esc(cf.loc || '')}" placeholder="e.g. Store A2 · مستودع رف 2">
      <div style="background:#fff;border:1px solid var(--rule);border-radius:14px;padding:.7rem;margin-top:.7rem;text-align:center"><small style="color:var(--ink3)">Total to save · الكمية</small><div id="ctot" style="font-size:1.6rem;font-weight:800">—</div><small>${esc(it.u)}</small></div>
      <button class="btn" data-c="save" style="font-size:1.05rem">✓ Save · حفظ</button>
      ${lines()[it.s] ? `<button class="btn s" data-c="del">Remove this count · حذف الجرد لهذا الصنف</button>` : ''}
      <style>.lb{display:block;font-size:.8rem;color:var(--ink3);margin:.55rem 0 .2rem}</style></div></div>`;
  }
  let W = [];
  function total() {
    const it = item(C.edit); if (!it) return null; const v = id => n((document.getElementById(id) || {}).value);
    const d = v('cd'); if (d != null) return r4(d);
    if (isW(it)) { if (!W.length) return null; const t = v('ct') || 0; return r4(Math.max(0, W.reduce((a, x) => a + x, 0) - W.length * t)); }
    const c = v('cc'), p = v('cp'), l = v('cl'); if (c == null && l == null) return null; if (c && p == null) return null; return r4((c || 0) * (p || 0) + (l || 0));
  }
  function upd() { const el = document.getElementById('ctot'); if (!el) return; const t = total(); el.textContent = t == null ? '—' : fmt(t); const it = item(C.edit); if (it && isW(it)) { const wl = document.getElementById('wl'); if (wl) wl.innerHTML = W.map((x, k) => `<button data-wdel="${k}">${fmt(x)} ✕</button>`).join('') + (W.length ? `<small style="align-self:center;color:var(--ink3)">${W.length} bag(s) · ${fmt(W.reduce((a, x) => a + x, 0))} ${UNITW[it.u]}</small>` : ''); } }
  C.open = function (sku) {
    const it = item(sku); if (!it) { window.DALTOAST('Unknown label · ملصق غير معروف: ' + sku); return; }
    C.edit = sku; W = ((lines()[sku] || {}).w || []).slice(); const old = document.getElementById('sheet'); if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', sheet()); upd(); const f = document.getElementById(isW(it) ? 'cw' : 'cc'); if (f) setTimeout(() => f.focus(), 150);
  };
  function closeSheet() { C.edit = null; const s = document.getElementById('sheet'); if (s) s.remove(); }

  async function save() {
    const it = item(C.edit); const q = total(); if (q == null) { window.DALTOAST('Enter a quantity first · أدخل الكمية'); return; }
    const v = id => n((document.getElementById(id) || {}).value); const loc = ((document.getElementById('cloc') || {}).value || '').trim();
    const body = isW(it) ? { op: 'line', sku: it.s, q, w: W, b: W.length, t: v('ct') } : { op: 'line', sku: it.s, q, c: v('cc'), pc: v('cp'), l: v('cl') };
    const cf = cfg(it.s); const cb = { op: 'cfg', sku: it.s };
    if (isW(it)) { if (v('ct') != null && v('ct') !== cf.t) cb.t = v('ct'); } else if (v('cp') != null && v('cp') !== cf.pc) cb.pc = v('cp');
    if (loc !== (cf.loc || '')) cb.loc = loc;
    // تحديث محلي فوري ثم إرسال (مع إعادة المحاولة عند انقطاع النت)
    C.st = C.st || { cfg: {}, cur: null, hist: [] }; C.st.cur = C.st.cur || { id: 'new', by: '', lines: {} }; C.st.cur.lines[it.s] = Object.assign({}, body, { at: new Date().toISOString() });
    closeSheet(); window.DALRENDER(); window.DALTOAST('✓ ' + it.en + ' = ' + fmt(q) + ' ' + it.u);
    const jobs = [body]; if (Object.keys(cb).length > 2) jobs.push(cb); C.pending.push(...jobs); flush();
  }
  async function flush() {
    while (C.pending.length) { try { await post(C.pending[0]); C.pending.shift(); } catch (e) { setTimeout(flush, 8000); window.DALRENDER(); return; } }
    window.DALRENDER();
  }

  /* ---------- الكاميرا ---------- */
  function loadLib(src) { return new Promise((ok, no) => { if (document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
  async function startScan() {
    try { await loadLib('https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js'); } catch (e) { window.DALTOAST('Camera library failed to load · تعذّر تحميل الكاميرا'); return; }
    C.scan = true; window.DALRENDER(); const box = document.getElementById('scanbox'); if (box) box.style.display = 'block';
    try {
      const h = C.h = new Html5Qrcode('reader'); let last = '';
      await h.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, hh) => { const m = Math.floor(Math.min(w, hh) * 0.75); return { width: m, height: m }; } }, txt => {
        if (txt === last) return; last = txt; setTimeout(() => { last = ''; }, 2500);
        const m = String(txt).trim().match(/^DAL:(.+)$/i); const sku = m ? m[1].trim() : String(txt).trim();
        if (navigator.vibrate) navigator.vibrate(80); stopScan().then(() => C.open(sku));
      }, () => {});
    } catch (e) { C.scan = null; window.DALRENDER(); window.DALTOAST('Allow camera access, then try again · اسمح بالكاميرا'); }
  }
  async function stopScan() { try { if (C.h) { await C.h.stop(); C.h.clear(); } } catch (e) {} C.h = null; C.scan = null; const box = document.getElementById('scanbox'); if (box) box.style.display = 'none'; }

  /* ---------- ملف فودكس ---------- */
  function csv() {
    const L = lines(); const rows = [['Inventory Item Name', 'Inventory Item SKU', 'Storage quantity', 'Ingredients quantity', 'Inventory Count ID']];
    (C.items || []).forEach(i => { const l = L[i.s]; if (l) rows.push([i.ar, i.s, l.q, 0, '']); });
    if (rows.length < 2) { window.DALTOAST('Nothing counted yet · لا يوجد جرد'); return; }
    const txt = '﻿' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const id = (C.st && C.st.cur && C.st.cur.id) || 'count'; const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); a.download = 'foodics-count-' + id + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
    window.DALTOAST('⬇ ' + (rows.length - 1) + ' items · صنف');
  }

  /* ---------- ملصقات QR للطباعة ---------- */
  async function labels() {
    try { await loadLib('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'); } catch (e) { window.DALTOAST('QR library failed · تعذّر'); return; }
    const list = (C.items || []).filter(inCat);
    const svg = s => { const q = qrcode(0, 'M'); q.addData('DAL:' + s); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); };
    const w = window.open('', '_blank'); if (!w) { window.DALTOAST('Allow pop-ups · اسمح بالنوافذ'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Dal QR labels</title><style>@page{size:A4;margin:8mm}body{font-family:system-ui,Tahoma,sans-serif;margin:0}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}.l{border:1px dashed #999;border-radius:3mm;padding:3mm;display:flex;gap:3mm;align-items:center;break-inside:avoid;height:30mm}.l svg{width:24mm;height:24mm;flex:none}.t{font-size:9pt;line-height:1.3;overflow:hidden}.t b{display:block;font-size:10pt}.t .a{direction:rtl}.t small{color:#555}.bar{padding:3mm 0}@media print{.bar{display:none}}</style></head><body>
      <div class="bar"><button onclick="print()" style="font-size:16px;padding:8px 16px">🖨 Print</button> ${list.length} labels · ${esc(CAT.find(c => c[0] === C.cat)[1])}</div>
      <div class="g">${list.map(i => `<div class="l">${svg(i.s)}<div class="t"><b>${esc(i.en)}</b><div class="a">${esc(i.ar)}</div><small>${esc(i.s)} · ${esc(i.u)}</small></div></div>`).join('')}</div></body></html>`);
    w.document.close();
  }

  /* ---------- الأحداث ---------- */
  document.addEventListener('click', async e => {
    const it = e.target.closest('[data-item]'); if (it) { C.open(it.getAttribute('data-item')); return; }
    const cat = e.target.closest('[data-cat]'); if (cat) { C.cat = cat.getAttribute('data-cat'); window.DALRENDER(); return; }
    const wd = e.target.closest('[data-wdel]'); if (wd) { W.splice(+wd.getAttribute('data-wdel'), 1); upd(); return; }
    const b = e.target.closest('[data-c]'); if (!b) return; const c = b.getAttribute('data-c');
    if (c === 'scan') startScan(); else if (c === 'stop') stopScan(); else if (c === 'close') closeSheet(); else if (c === 'save') save();
    else if (c === 'addw') { const x = n(document.getElementById('cw').value); if (x == null || x <= 0) return; W.push(x); document.getElementById('cw').value = ''; document.getElementById('cw').focus(); upd(); }
    else if (c === 'del') { const s = C.edit; if (!confirm('Remove? · حذف؟')) return; delete lines()[s]; closeSheet(); window.DALRENDER(); C.pending.push({ op: 'line', sku: s, del: 1 }); flush(); }
    else if (c === 'csv') csv(); else if (c === 'labels') labels();
    else if (c === 'new') { if (!confirm('Start a new count? The current one is kept in history.\nبدء جرد جديد؟ الحالي يُحفظ في السجل.')) return; try { await post({ op: 'new' }); window.DALRENDER(); window.DALTOAST('✓ New count · جرد جديد'); } catch (x) { window.DALTOAST('Failed · تعذّر'); } }
  });
  document.addEventListener('input', e => {
    if (e.target.closest && e.target.closest('#sheet')) { upd(); return; }
    if (e.target.id === 'cq') { C.q = e.target.value; clearTimeout(C.qt); C.qt = setTimeout(() => { const el = document.getElementById('cq'); const pos = el ? el.selectionStart : 0; window.DALRENDER(); const nn = document.getElementById('cq'); if (nn) { nn.focus(); nn.setSelectionRange(pos, pos); } }, 250); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'cw') { e.preventDefault(); const bb = document.querySelector('[data-c="addw"]'); if (bb) bb.click(); } });
})();
