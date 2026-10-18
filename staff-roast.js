/* سجل التحميص — كل دفعة: المحصول، وزن الأخضر، وزن المحمّص، والفاقد يتحسب لحاله.
   الوقت والاسم يتسجلان تلقائياً. دفعات العملاء الخارجيين بنوع منفصل ولا تُحسب في بن دال.
   الحفظ في live/roast_log عبر /staff/roast. */
(function () {
  const R = window.DALR = { t: 'dal', o: '', c: '', g: '', r: '', n: '', busy: false };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = v => { const x = parseFloat(String(v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.')); return isFinite(x) ? x : null; };
  const f1 = v => v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const loss = (g, r) => g > 0 && r != null && r >= 0 ? (g - r) / g * 100 : null;
  const odd = p => p != null && (p < 10 || p > 22);   // خارج المعتاد = تأكد من الوزن
  const ksa = d => new Date(new Date(d).getTime() + 3 * 3600e3);
  const day = d => ksa(d).toISOString().slice(0, 10);
  const hm = d => ksa(d).toISOString().slice(11, 16);
  const MN = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const dName = s => { const today = day(Date.now()), y = day(Date.now() - 864e5); if (s === today) return 'اليوم'; if (s === y) return 'أمس'; const [Y, M, D] = s.split('-'); return +D + ' ' + MN[+M - 1]; };
  const list = () => ((window.DALD().roast_log || {}).list) || [];
  const origins = () => ((window.DALD().stock || {}).items) || [];

  const CSS = `<style id="rl-css">
  .rl-tg{display:flex;background:#EEF0F4;border-radius:14px;padding:4px;margin:.6rem 0}.rl-tg button{flex:1;border:0;background:transparent;border-radius:11px;padding:.6rem;font:inherit;font-weight:700;cursor:pointer;color:#475569}.rl-tg button[aria-pressed=true]{background:#fff;color:#0F172A;box-shadow:0 1px 3px rgba(15,23,42,.12)}
  .rl-f{background:#fff;border-radius:18px;padding:14px;box-shadow:0 0 0 1px #E6E9EF}
  .rl-f label{display:block;font-size:.8rem;color:#64748B;margin:.55rem 0 .25rem;font-weight:600}
  .rl-f select,.rl-f input{width:100%;margin:0;border:1.5px solid #DCE1EA;border-radius:12px;padding:.7rem;font:inherit;font-size:1rem;background:#fff;box-sizing:border-box}
  .rl-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.rl-two input{font-size:1.35rem;font-weight:800;text-align:center}
  .rl-ls{display:flex;align-items:center;justify-content:space-between;background:#0F172A;color:#fff;border-radius:14px;padding:.7rem .9rem;margin-top:.7rem}.rl-ls small{opacity:.7}.rl-ls b{font-size:1.4rem}.rl-ls.w{background:#B45309}
  .rl-sum{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:.8rem 0}.rl-sum div{background:#fff;border-radius:12px;padding:.55rem .3rem;text-align:center;box-shadow:0 0 0 1px #E6E9EF}.rl-sum small{display:block;font-size:.66rem;color:#64748B}.rl-sum b{font-size:1rem}
  .rl-d{font-size:.78rem;font-weight:800;color:#64748B;margin:1rem 2px .4rem}
  .rl-it{display:flex;align-items:center;gap:10px;background:#fff;border-radius:14px;padding:.65rem .75rem;margin-bottom:6px;box-shadow:0 0 0 1px #E6E9EF}
  .rl-it .tm{font-family:ui-monospace,monospace;font-size:.8rem;color:#64748B;width:42px;flex:none}.rl-it .t{flex:1;min-width:0}.rl-it .t b{display:block;font-size:.92rem}.rl-it .t small{color:#64748B;font-size:.74rem}
  .rl-it .p{font-weight:800;font-size:.9rem;text-align:end}.rl-it .p.w{color:#B45309}
  .rl-x{border:0;background:transparent;color:#94A3B8;font-size:1rem;cursor:pointer;padding:4px}
  .rl-ext{font-size:.66rem;background:#FEF3C7;color:#92400E;border-radius:6px;padding:1px 6px;margin-inline-start:4px;font-weight:700}
  </style>`;

  R.view = function (canEdit) {
    const L = list(); const today = day(Date.now());
    const td = L.filter(x => day(x.at) === today && x.t !== 'ext');
    const g = td.reduce((a, x) => a + (+x.g || 0), 0), r = td.reduce((a, x) => a + (+x.r || 0), 0);
    const ym = today.slice(0, 7); const mo = L.filter(x => day(x.at).slice(0, 7) === ym && x.t !== 'ext');
    const mg = mo.reduce((a, x) => a + (+x.g || 0), 0), mr = mo.reduce((a, x) => a + (+x.r || 0), 0);
    const p = loss(num(R.g), num(R.r));
    const form = !canEdit ? '' : `<div class="rl-tg">${[['dal', 'بن دال'], ['ext', 'عميل خارجي']].map(x => `<button data-rt="${x[0]}" aria-pressed="${R.t === x[0]}">${x[1]}</button>`).join('')}</div>
      <div class="rl-f">${R.t === 'dal'
        ? `<label for="rl-o">المحصول</label><select id="rl-o"><option value="">اختر المحصول</option>${origins().map(o => `<option value="${esc(o.id)}" ${R.o === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`
        : `<label for="rl-c">اسم العميل والمحصول</label><input id="rl-c" value="${esc(R.c)}" placeholder="مثلاً: محمد · كولومبي">`}
        <div class="rl-two"><div><label for="rl-g">الأخضر (كجم)</label><input id="rl-g" inputmode="decimal" value="${esc(R.g)}" placeholder="0"></div><div><label for="rl-r">المحمّص (كجم)</label><input id="rl-r" inputmode="decimal" value="${esc(R.r)}" placeholder="0"></div></div>
        <div class="rl-ls ${odd(p) ? 'w' : ''}" id="rl-ls"><small>${odd(p) ? 'الفاقد غير معتاد، تأكد من الوزن' : 'الفاقد'}</small><b>${p == null ? '—' : p.toFixed(1) + '%'}</b></div>
        <label for="rl-n">ملاحظة (اختياري)</label><input id="rl-n" value="${esc(R.n)}" placeholder="درجة التحميص أو أي ملاحظة">
        <button class="btn" data-rc="add" style="margin-top:.8rem" ${R.busy ? 'disabled' : ''}>🔥 سجّل الدفعة</button>
        <small style="display:block;text-align:center;color:#94A3B8;margin-top:.4rem">الوقت واسمك يتسجلان تلقائياً</small></div>`;
    const sum = `<div class="rl-sum"><div><small>دفعات اليوم</small><b>${td.length}</b></div><div><small>أخضر اليوم</small><b>${f1(g)}</b></div><div><small>محمّص اليوم</small><b>${f1(r)}</b></div><div><small>فاقد الشهر</small><b>${mg > 0 ? ((mg - mr) / mg * 100).toFixed(1) + '%' : '—'}</b></div></div>`;
    const groups = {}; L.slice(0, 120).forEach(x => { (groups[day(x.at)] = groups[day(x.at)] || []).push(x); });
    const rows = Object.keys(groups).sort().reverse().map(d => `<div class="rl-d">${dName(d)}</div>` + groups[d].map(x => { const lp = loss(+x.g, +x.r);
      return `<div class="rl-it"><span class="tm">${hm(x.at)}</span><div class="t"><b>${esc(x.t === 'ext' ? x.c : (x.on || x.o))}${x.t === 'ext' ? '<span class="rl-ext">خارجي</span>' : ''}</b><small>${f1(x.g)} ← ${f1(x.r)} كجم · ${esc(x.by || '')}${x.n ? ' · ' + esc(x.n) : ''}</small></div><span class="p ${odd(lp) ? 'w' : ''}">${lp == null ? '—' : lp.toFixed(1) + '%'}</span>${canEdit && day(x.at) === today ? `<button class="rl-x" data-rdel="${esc(x.id)}" aria-label="حذف">✕</button>` : ''}</div>`; }).join('')).join('');
    return CSS + `<h2>🔥 سجل التحميص</h2>${form}${sum}${rows || '<div class="note">ما فيه دفعات مسجّلة بعد.</div>'}`;
  };

  function upd() { const p = loss(num(R.g), num(R.r)); const el = document.getElementById('rl-ls'); if (!el) return; el.classList.toggle('w', odd(p)); el.innerHTML = `<small>${odd(p) ? 'الفاقد غير معتاد، تأكد من الوزن' : 'الفاقد'}</small><b>${p == null ? '—' : p.toFixed(1) + '%'}</b>`; }
  document.addEventListener('input', e => { const id = e.target.id; if (!/^rl-/.test(id)) return; const k = { 'rl-g': 'g', 'rl-r': 'r', 'rl-c': 'c', 'rl-n': 'n' }[id]; if (k) { R[k] = e.target.value; upd(); } });
  document.addEventListener('change', e => { if (e.target.id === 'rl-o') R.o = e.target.value; });
  document.addEventListener('click', async e => {
    const tg = e.target.closest('[data-rt]'); if (tg) { R.t = tg.getAttribute('data-rt'); window.DALRENDER(); return; }
    const dl = e.target.closest('[data-rdel]'); if (dl) { if (!confirm('حذف هذه الدفعة؟')) return; try { const r = await window.DALAPI('/staff/roast', { method: 'POST', body: JSON.stringify({ op: 'del', id: dl.getAttribute('data-rdel') }) }); if (r.ok) { window.DALD().roast_log = r.log; window.DALRENDER(); window.DALTOAST('✓ انحذفت'); } else window.DALTOAST(r.err || 'تعذّر'); } catch (x) { window.DALTOAST('تعذّر'); } return; }
    const b = e.target.closest('[data-rc="add"]'); if (!b || R.busy) return;
    const g = num(R.g), r = num(R.r);
    if (R.t === 'dal' && !R.o) return window.DALTOAST('اختر المحصول');
    if (R.t === 'ext' && !R.c.trim()) return window.DALTOAST('اكتب اسم العميل');
    if (!(g > 0)) return window.DALTOAST('اكتب وزن الأخضر');
    if (!(r > 0) || r > g) return window.DALTOAST('وزن المحمّص لازم يكون أقل من الأخضر');
    const o = origins().find(x => x.id === R.o);
    R.busy = true; window.DALRENDER();
    try {
      const res = await window.DALAPI('/staff/roast', { method: 'POST', body: JSON.stringify({ op: 'add', t: R.t, o: R.o, on: o ? o.name : '', c: R.c.trim(), g, r, n: R.n.trim() }) });
      if (!res.ok) throw new Error(res.err || 'تعذّر');
      window.DALD().roast_log = res.log; Object.assign(R, { g: '', r: '', n: '', c: '' }); window.DALTOAST('✓ انسجّلت الدفعة');
    } catch (x) { window.DALTOAST('تعذّر الحفظ — ' + x.message); }
    R.busy = false; window.DALRENDER();
  });
})();
