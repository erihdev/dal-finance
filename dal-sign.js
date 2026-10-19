/* توقيع إلكتروني — Dal signature pad (shared by the staff app and the owner app, window.DALSIGN).
   لوحة توقيع بالقماش (canvas) وأحداث المؤشر فقط، بلا مكتبات: تعمل على سفاري iPhone وأندرويد (touch-action:none + pointer events).
   تنعيم الخط بمنحنيات تربيعية بين منتصفات النقاط، مسح/تراجع، تسميات عربي/إنجليزي، بلا رموز تعبيرية.
   الناتج: PNG مقصوص على حدود الحبر ومصغّر حتى يكون base64 ≤ 25 كيلوبايت. الضربات تبقى في الكائن (strokes) فتُستعاد بعد أي إعادة رسم للصفحة. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.DALSIGN = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const T = (L, ar, en) => L === 'en' ? en : ar;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MAX_B64 = 25 * 1024, INK = '#1d1d1f', WIDTH = 2.2, H = 160;
  const ICO = { x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>', undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>', ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' };
  const CSS = `<style id="ds-css">
  .ds{background:#fff;border-radius:14px;box-shadow:inset 0 0 0 1px #e5e5ea;padding:12px 12px 6px;margin:8px 0 12px;color:#1d1d1f;font-variant-numeric:tabular-nums}
  .ds-hd{display:flex;align-items:baseline;gap:8px;margin:0 4px 8px}.ds-hd b{flex:1;font-weight:600;font-size:15px;line-height:1.3}.ds-hd small{color:#6e6e73;font-size:13px}
  .ds input.ds-name{width:100%;border:1px solid #e5e5ea;border-radius:10px;min-height:44px;padding:8px 12px;font:inherit;font-size:16px;background:#fff;color:#1d1d1f;margin:0 0 8px;box-sizing:border-box}.ds input.ds-name:focus{outline:2px solid #F37121;outline-offset:-1px;border-color:transparent}
  .ds-c{position:relative;border:1px dashed #c7c7cc;border-radius:12px;background:#fafafa;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
  .ds-c canvas{display:block;width:100%;height:${H}px;touch-action:none;cursor:crosshair}
  .ds-c::after{content:"";position:absolute;left:16px;right:16px;bottom:38px;border-top:1px solid #d1d1d6;pointer-events:none}
  .ds-hint{position:absolute;inset-inline:0;bottom:10px;text-align:center;font-size:13px;color:#aeaeb2;pointer-events:none}.ds.on .ds-hint{display:none}
  .ds-acts{display:flex;gap:2px;justify-content:flex-end;align-items:center;margin-top:2px}.ds-acts small{flex:1;color:#6e6e73;font-size:12px;padding-inline-start:4px}
  .ds-acts button{display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;color:#c0560f;font:inherit;font-size:14px;font-weight:600;min-height:40px;padding:0 10px;cursor:pointer;border-radius:8px}.ds-acts button:disabled{color:#aeaeb2}.ds-acts button svg,.ds-ok svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
  .ds-ok{display:flex;align-items:center;gap:10px;background:#e8f5ec;color:#248a3d;border-radius:12px;padding:10px 12px}.ds-ok img{height:44px;max-width:45%;object-fit:contain;background:#fff;border-radius:8px;padding:2px}.ds-ok .t{flex:1;min-width:0;font-size:14px;line-height:1.4}.ds-ok b{display:block;font-weight:600;line-height:1.35}.ds-ok b svg{vertical-align:-4px;margin-inline-end:4px}.ds-ok small{display:block;color:#6e6e73;font-size:12px}.ds-ok code{font-size:12px;direction:ltr;unicode-bidi:embed;color:#6e6e73}
  </style>`;
  const css = () => (typeof document !== 'undefined' && document.getElementById('ds-css')) ? '' : CSS;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  // رسم كل الضربات على سياق بمقياس k (نقاط CSS × k)
  function paint(g, strokes, k, w, h) {
    g.clearRect(0, 0, w, h); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = INK; g.lineWidth = WIDTH * k;
    for (const s of strokes) { if (!s.length) continue; g.beginPath(); if (s.length < 3) { const p = s[0]; g.moveTo(p.x * k, p.y * k); const q = s[s.length - 1]; g.lineTo(q.x * k + (s.length === 1 ? 0.1 : 0), q.y * k); g.stroke(); continue; }
      g.moveTo(s[0].x * k, s[0].y * k); for (let i = 1; i < s.length - 1; i++) { const m = mid(s[i], s[i + 1]); g.quadraticCurveTo(s[i].x * k, s[i].y * k, m.x * k, m.y * k); } const l = s[s.length - 1]; g.lineTo(l.x * k, l.y * k); g.stroke(); }
  }
  // لوحة واحدة: el عنصر حاوٍ فارغ؛ o: {lang, title, sub, name: نص ثابت (يُعرض) | null: حقل اسم, namePlaceholder, strokes: ضربات سابقة لاستعادتها, signed: توقيع محفوظ {name, at, hash, png?}, dateText}
  function create(el, o) {
    o = o || {}; const L = o.lang === 'en' ? 'en' : 'ar'; const api = { el, strokes: Array.isArray(o.strokes) ? o.strokes.map(s => s.slice()) : [], role: o.role || '' };
    if (o.signed) { const s = o.signed; el.innerHTML = css() + `<div class="ds" data-ds="${esc(api.role)}"><div class="ds-hd"><b>${esc(o.title || '')}</b></div><div class="ds-ok">${s.png ? `<img src="${/^data:/.test(s.png) ? esc(s.png) : 'data:image/png;base64,' + esc(s.png)}" alt="">` : ''}<div class="t"><b>${ICO.ok}${T(L, 'موقّع', 'Signed')} · <span class="d">${esc(s.name || '')}</span></b><small>${esc(o.dateText || s.at || '')}</small>${s.hash ? `<code>${esc(String(s.hash).slice(0, 10))}</code>` : ''}</div></div></div>`; api.locked = true; api.empty = () => true; api.png = async () => null; api.name = () => s.name || ''; api.clear = api.undo = () => {}; return api; }
    el.innerHTML = css() + `<div class="ds" data-ds="${esc(api.role)}"><div class="ds-hd"><b>${esc(o.title || '')}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</div>
      ${o.name != null ? `<div class="ds-hd" style="margin-top:-4px"><small>${T(L, 'الاسم', 'Name')}: <span class="d" style="color:#1d1d1f">${esc(o.name)}</span></small></div>` : `<input class="ds-name" data-dsname="${esc(api.role)}" placeholder="${esc(o.namePlaceholder || T(L, 'الاسم', 'Name'))}" value="${esc(o.nameValue || '')}" autocomplete="name">`}
      <div class="ds-c"><canvas aria-label="${T(L, 'لوحة التوقيع', 'Signature pad')}"></canvas><div class="ds-hint">${T(L, 'وقّع هنا بإصبعك', 'Sign here with your finger')}</div></div>
      <div class="ds-acts"><small>${o.hint != null ? esc(o.hint) : T(L, 'التوقيع اختياري', 'Signature is optional')}</small><button type="button" data-dsundo>${ICO.undo}${T(L, 'تراجع', 'Undo')}</button><button type="button" data-dsclear>${ICO.x}${T(L, 'مسح', 'Clear')}</button></div></div>`;
    const box = el.querySelector('.ds'), cv = el.querySelector('canvas'), wrap = el.querySelector('.ds-c'), g = cv.getContext('2d'); let W = 0, dpr = 1, cur = null;
    const nameEl = el.querySelector('[data-dsname]');
    const ui = () => { box.classList.toggle('on', api.strokes.length > 0 || !!cur); el.querySelector('[data-dsundo]').disabled = !api.strokes.length; el.querySelector('[data-dsclear]').disabled = !api.strokes.length; };
    const redraw = () => paint(g, api.strokes, dpr, cv.width, cv.height);
    const size = () => { const w = Math.max(260, Math.round(wrap.getBoundingClientRect().width || el.clientWidth || 300)); dpr = Math.max(1, Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)); if (w === W && cv.width === Math.round(w * dpr)) return; W = w; cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr); cv.style.width = w + 'px'; redraw(); };
    const pt = e => { const r = cv.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) * 10) / 10, y: Math.round((e.clientY - r.top) * 10) / 10 }; };
    const seg = s => { const n = s.length; if (n < 2) return; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = INK; g.lineWidth = WIDTH * dpr; g.beginPath();
      if (n === 2) { g.moveTo(s[0].x * dpr, s[0].y * dpr); g.lineTo(s[1].x * dpr, s[1].y * dpr); } else { const a = mid(s[n - 3], s[n - 2]), b = mid(s[n - 2], s[n - 1]); g.moveTo(a.x * dpr, a.y * dpr); g.quadraticCurveTo(s[n - 2].x * dpr, s[n - 2].y * dpr, b.x * dpr, b.y * dpr); } g.stroke(); };
    cv.addEventListener('pointerdown', e => { if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return; e.preventDefault(); size(); try { cv.setPointerCapture(e.pointerId); } catch (x) {} cur = [pt(e)]; g.fillStyle = INK; g.beginPath(); g.arc(cur[0].x * dpr, cur[0].y * dpr, WIDTH * dpr / 2, 0, Math.PI * 2); g.fill(); ui(); });
    cv.addEventListener('pointermove', e => { if (!cur) return; e.preventDefault(); const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; for (const c of evs.length ? evs : [e]) { const p = pt(c); const l = cur[cur.length - 1]; if (Math.abs(p.x - l.x) < 0.6 && Math.abs(p.y - l.y) < 0.6) continue; cur.push(p); seg(cur); } });
    const end = e => { if (!cur) return; e && e.preventDefault && e.preventDefault(); api.strokes.push(cur); cur = null; redraw(); ui(); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end); cv.addEventListener('pointerleave', e => { if (cur && e.pointerType !== 'touch') end(e); });
    cv.addEventListener('touchstart', e => e.preventDefault(), { passive: false });   // سفاري القديم: منع التمرير أثناء التوقيع
    el.querySelector('[data-dsundo]').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); api.strokes.pop(); redraw(); ui(); });
    el.querySelector('[data-dsclear]').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); api.strokes = []; redraw(); ui(); });
    if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(() => size()); ro.observe(wrap); api.ro = ro; }
    size(); ui(); if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(size);
    api.locked = false; api.empty = () => !api.strokes.length; api.clear = () => { api.strokes = []; redraw(); ui(); }; api.undo = () => { api.strokes.pop(); redraw(); ui(); };
    api.name = () => (nameEl ? nameEl.value : (o.name || '')).trim();
    // PNG مقصوص على حدود الحبر ومصغّر حتى ≤ 25 كيلوبايت base64 (الناتج data URL)
    api.png = async () => exportPng(api.strokes);
    return api;
  }
  function exportPng(strokes) {
    if (!strokes || !strokes.length) return null; const pad = 6; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) for (const p of s) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
    const w0 = Math.max(1, x1 - x0 + 2 * pad), h0 = Math.max(1, y1 - y0 + 2 * pad); const moved = strokes.map(s => s.map(p => ({ x: p.x - x0 + pad, y: p.y - y0 + pad })));
    let k = Math.min(2, 600 / w0); let out = null;
    for (let i = 0; i < 12; i++) { const c = document.createElement('canvas'); c.width = Math.max(8, Math.round(w0 * k)); c.height = Math.max(8, Math.round(h0 * k)); const g = c.getContext('2d'); paint(g, moved, k, c.width, c.height);
      // قصّ دقيق على البكسلات الملوّنة (الخط أعرض من النقاط)
      const d = g.getImageData(0, 0, c.width, c.height).data; let bx0 = c.width, by0 = c.height, bx1 = -1, by1 = -1; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      if (bx1 < 0) return null; const cw = bx1 - bx0 + 1 + 2 * pad, ch = by1 - by0 + 1 + 2 * pad; const t = document.createElement('canvas'); t.width = cw; t.height = ch; t.getContext('2d').drawImage(c, bx0 - pad, by0 - pad, cw, ch, 0, 0, cw, ch);
      out = t.toDataURL('image/png'); c.width = c.height = t.width = t.height = 0; if (out.length - 22 <= MAX_B64 || k <= 0.25) break; k *= 0.8; }
    return out;
  }
  return { create, exportPng, CSS, css, MAX_B64, ICO };
});
