/* سجل التحميص (v5) — كل دفعة: المحصول (رمز الأخضر في فودكس)، وزن الأخضر، وزن المحمّص، والفاقد يتحسب لحاله.
   دفعة دال تحرّك المخزون على الخادم: الأخضر يُستهلك في المحمصة (من دفعة الأخضر الأقدم أو المختارة) والمحمّص يُنتج فيها (الربط في units-core ROAST_MAP).
   إن كان رصيد المحمصة من الأخضر أقل من الدفعة يسجّل الخادم نقلًا تلقائيًا من المستودع للنقص قبل الدفعة.
   الوقت والاسم يتسجلان تلقائياً. دفعات العملاء الخارجيين بنوع منفصل ولا تُحسب في بن دال.
   الحفظ في live/roast_log (دال) و live/roast_ext (الخارجيين) عبر /staff/roast. */
(function () {
  const R = window.DALR = { t: 'dal', o: '', c: '', g: '', r: '', n: '', lot: null, busy: false };
  const U = () => window.DALU; const C = () => window.DALC;
  // الأخضر من قائمة فودكس (الثمانية التي لها محمّص مقابل)، لا نص حر
  const greens = () => ((C() && C().items) || []).filter(i => U() && U().ROAST_MAP[i.s]);
  const lotsOf = s => (((window.DALD().moves || {}).list) || []).filter(x => x.t === 'in' && x.s === s && x.rem > 0).sort((a, b) => a.at.localeCompare(b.at));
  const EN = () => window.DALLANG && window.DALLANG() === 'en';
  const T = (ar, en) => window.DALT ? window.DALT(ar, en) : ar;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = v => { const x = parseFloat(String(v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.')); return isFinite(x) ? x : null; };
  const f1 = v => v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const loss = (g, r) => g > 0 && r != null && r >= 0 ? (g - r) / g * 100 : null;
  const odd = p => p != null && (p < 10 || p > 22);   // خارج المعتاد = تأكد من الوزن
  const ksa = d => new Date(new Date(d).getTime() + 3 * 3600e3);
  const day = d => ksa(d).toISOString().slice(0, 10);
  const hm = d => ksa(d).toISOString().slice(11, 16);
  const dName = s => { const today = day(Date.now()), y = day(Date.now() - 864e5); if (s === today) return T('اليوم', 'Today'); if (s === y) return T('أمس', 'Yesterday'); const [, M, D] = s.split('-'); return +D + ' ' + (window.DALMN ? window.DALMN(+M - 1) : M); };
  const DOC = t => t === 'ext' ? 'roast_ext' : 'roast_log';   // دال والعملاء الخارجيين في مستندين منفصلين، لا يختلطان أبداً
  const list = () => ((window.DALD()[DOC(R.t)] || {}).list) || [];
  const origins = () => greens().map(i => ({ id: i.s, name: EN() ? i.en.replace(/^Green Coffee - /, '') : i.ar.replace(/^قهوة خضراء - /, '') }));
  const lossLbl = p => odd(p) ? T('الفاقد غير معتاد، تأكد من الوزن', 'Unusual loss. Check the weights.') : T('الفاقد', 'Weight loss');
  const SV = { origin: ['اختر المحصول', 'Choose the coffee'], customer: ['اكتب اسم العميل', 'Enter the customer name'], weight: ['تأكد من الأوزان', 'Check the weights'], 'الحذف لدفعات اليوم فقط': ['الحذف لدفعات اليوم فقط', "Only today's batches can be deleted"], forbidden: ['ليس لديك صلاحية', 'Not allowed'] };
  const svErr = m => SV[m] ? T(SV[m][0], SV[m][1]) : (m || T('تعذّر', 'Failed'));

  const CSS = `<style id="rl-css">
  .rl-seg{display:flex;background:var(--fill);border-radius:9px;padding:2px;margin:4px 0 12px}.rl-seg button{flex:1;border:0;background:transparent;min-height:40px;border-radius:7px;font-size:15px;color:var(--ink2);cursor:pointer}.rl-seg button[aria-pressed=true]{background:#fff;color:var(--ink);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12)}
  .rl-f{background:#fff;border-radius:12px;padding:12px 16px;margin-bottom:12px}
  .rl-f label{display:block;font-size:13px;color:var(--ink2);margin:8px 0 0}
  .rl-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.rl-two input{font-size:22px;font-weight:600;text-align:center}
  .rl-ls{display:flex;align-items:center;justify-content:space-between;background:var(--fill);border-radius:10px;padding:10px 12px;margin-top:8px;min-height:48px}.rl-ls small{color:var(--ink2);font-size:14px}.rl-ls b{font-size:22px;font-weight:600}.rl-ls.w{background:var(--warn-soft)}.rl-ls.w small,.rl-ls.w b{color:var(--warn)}
  .rl-it .tm{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--ink2);width:44px;flex:none}
  .rl-x{border:0;background:transparent;color:var(--ink3);width:44px;height:44px;cursor:pointer;display:grid;place-items:center;flex:none;margin-inline-end:-10px}
  .rl-ext{font-size:12px;background:var(--warn-soft);color:var(--warn);border-radius:6px;padding:1px 6px;margin-inline-start:4px;font-weight:600}
  </style>`;

  R.view = function (can) {
    const okD = can('roast', 'view'), okX = can('roastx', 'view'); if (R.t === 'dal' && !okD) R.t = 'ext'; if (R.t === 'ext' && !okX) R.t = 'dal';
    const canEdit = can(R.t === 'ext' ? 'roastx' : 'roast', 'edit'); const ext = R.t === 'ext';
    const L = list(); const today = day(Date.now());
    const td = L.filter(x => day(x.at) === today);
    const g = td.reduce((a, x) => a + (+x.g || 0), 0), r = td.reduce((a, x) => a + (+x.r || 0), 0);
    const ym = today.slice(0, 7); const mo = L.filter(x => day(x.at).slice(0, 7) === ym);
    const mg = mo.reduce((a, x) => a + (+x.g || 0), 0), mr = mo.reduce((a, x) => a + (+x.r || 0), 0);
    const p = loss(num(R.g), num(R.r));
    const tabs = okD && okX ? `<div class="rl-seg" role="group">${[['dal', T('بن دال', 'Dal coffee')], ['ext', T('العملاء الخارجيين', 'Outside customers')]].map(x => `<button data-rt="${x[0]}" aria-pressed="${R.t === x[0]}">${x[1]}</button>`).join('')}</div>` : '';
    const form = !canEdit ? '' : `<div class="rl-f">${R.t === 'dal'
        ? `<label for="rl-o">${T('المحصول (بن أخضر في فودكس)', 'Coffee (green, from Foodics)')}</label><select id="rl-o"><option value="">${T('اختر المحصول', 'Choose the coffee')}</option>${origins().map(o => `<option value="${esc(o.id)}" ${R.o === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>${lotChips()}`
        : `<label for="rl-c">${T('اسم العميل والمحصول', 'Customer and coffee')}</label><input id="rl-c" value="${esc(R.c)}" placeholder="${T('مثلاً: محمد · كولومبي', 'e.g. Mohammed · Colombia')}">`}
        <div class="rl-two"><div><label for="rl-g">${T('الأخضر (كجم)', 'Green (kg)')}</label><input id="rl-g" inputmode="decimal" value="${esc(R.g)}" placeholder="0"></div><div><label for="rl-r">${T('المحمّص (كجم)', 'Roasted (kg)')}</label><input id="rl-r" inputmode="decimal" value="${esc(R.r)}" placeholder="0"></div></div>
        <div class="rl-ls ${odd(p) ? 'w' : ''}" id="rl-ls"><small>${lossLbl(p)}</small><b>${p == null ? '—' : p.toFixed(1) + '%'}</b></div>
        <label for="rl-n">${T('ملاحظة (اختياري)', 'Note (optional)')}</label><input id="rl-n" value="${esc(R.n)}" placeholder="${T('درجة التحميص أو أي ملاحظة', 'Roast level or any note')}">
        <button class="btn" data-rc="add" ${R.busy ? 'disabled' : ''}>${T('سجّل الدفعة', 'Log batch')}</button>
        <small style="display:block;text-align:center;color:var(--ink2);margin-top:6px;font-size:13px">${T('الوقت واسمك يتسجلان تلقائياً', 'Time and your name are saved automatically')}</small></div>`;
    const sum = `<div class="stats" style="grid-template-columns:repeat(4,1fr)"><div><b>${td.length}</b><small>${T('دفعات اليوم', 'Batches today')}</small></div><div><b>${f1(g)}</b><small>${T('أخضر اليوم', 'Green today')}</small></div><div><b>${f1(r)}</b><small>${T('محمّص اليوم', 'Roasted today')}</small></div><div><b>${mg > 0 ? ((mg - mr) / mg * 100).toFixed(1) + '%' : '—'}</b><small>${T('فاقد الشهر', 'Month loss')}</small></div></div>`;
    const groups = {}; L.slice(0, 120).forEach(x => { (groups[day(x.at)] = groups[day(x.at)] || []).push(x); });
    const rows = Object.keys(groups).sort().reverse().map(d => `<div class="sec">${dName(d)}</div><div class="grp">` + groups[d].map(x => { const lp = loss(+x.g, +x.r);
      return `<div class="cell rl-it"><span class="tm">${hm(x.at)}</span><div class="t"><b class="d">${esc(ext ? x.c : (x.on || x.o))}</b><small>${f1(x.g)} ${T('←', '→')} ${f1(x.r)} ${T('كجم', 'kg')} · <span class="d">${esc(x.by || '')}</span>${x.n ? ' · <span class="d">' + esc(x.n) + '</span>' : ''}</small></div><div class="v"><b style="${odd(lp) ? 'color:var(--warn)' : ''}">${lp == null ? '—' : lp.toFixed(1) + '%'}</b></div>${canEdit && day(x.at) === today ? `<button class="rl-x" data-rdel="${esc(x.id)}" aria-label="${T('حذف', 'Delete')}">${window.DALICO ? window.DALICO('x', 18) : '×'}</button>` : ''}</div>`; }).join('') + '</div>').join('');
    return CSS + `<h1>${ext ? T('تحميص العملاء الخارجيين', 'Outside customer roasting') : T('سجل تحميص دال', 'Dal roasting log')}</h1>${ext ? `<p class="note">${T('منفصل تماماً عن بن دال ولا يدخل في مخزونها ولا أرقامها.', "Kept completely separate from Dal's coffee. Not part of Dal's stock or numbers.")}</p>` : '<div style="height:8px"></div>'}${tabs}${form}${sum}${rows || `<p class="note">${T('ما فيه دفعات مسجّلة بعد.', 'No batches logged yet.')}</p>`}`;
  };

  // دفعات الأخضر المفتوحة للمحصول المختار: إن كانت أكثر من واحدة يختار الموظف (الأقدم أولًا)؛ وإن لم توجد دفعات بعد فالرصيد «—» ويُعلَّم للمالك
  function lotChips() { if (!R.o) return ''; const L = lotsOf(R.o); const B = U() ? U().balances(((window.DALD().moves || {}).list) || [], R.o) : { total: null, wh: 0, rs: 0 }; const bal = B.total; const LN = k => U().locName(k, EN());
    const sup = s => s && s.id === 'dal' && EN() ? 'Dal (in-house)' : (s && s.name) || '';
    const head = `<label>${T('رصيد الأخضر', 'Green balance')}: ${LN('rs')} <b style="color:var(--ink)">${f1(B.rs)}</b> · ${LN('wh')} <b style="color:var(--ink)">${f1(B.wh)}</b> · ${T('الإجمالي', 'Total')} <b style="color:var(--ink)">${bal == null ? '—' : f1(bal) + ' ' + T('كجم', 'kg')}</b>${bal == null ? ' · ' + T('لا دفعات بعد (يُسجَّل ويُعلَّم للمالك)', 'no lots yet (logged and flagged for the owner)') : ''}</label><small style="display:block;color:var(--ink2);font-size:12px;margin-top:2px">${T('الأخضر يُستهلك في المحمصة؛ ما ينقص فيها يُنقل تلقائيًا من المستودع مع الدفعة.', 'Green is consumed at the roastery; any shortfall there is transferred automatically from the warehouse with the batch.')}</small>`;
    if (L.length < 2) return head;
    return head + `<div class="chips" style="padding-top:6px">${L.map((l, k) => `<button data-rlot="${esc(l.id)}" aria-pressed="${(R.lot || L[0].id) === l.id}"><bdi class="d">${esc(sup(l.sup))}</bdi> · <bdi>${dName(day(l.at))}</bdi> · ${T('باقي', 'left')} ${f1(l.rem)}</button>`).join('')}</div>`; }
  function upd() { const p = loss(num(R.g), num(R.r)); const el = document.getElementById('rl-ls'); if (!el) return; el.classList.toggle('w', odd(p)); el.innerHTML = `<small>${lossLbl(p)}</small><b>${p == null ? '—' : p.toFixed(1) + '%'}</b>`; }
  document.addEventListener('input', e => { const id = e.target.id; if (!/^rl-/.test(id)) return; const k = { 'rl-g': 'g', 'rl-r': 'r', 'rl-c': 'c', 'rl-n': 'n' }[id]; if (k) { R[k] = e.target.value; upd(); } });
  document.addEventListener('change', e => { if (e.target.id === 'rl-o') { R.o = e.target.value; R.lot = null; window.DALRENDER(); } });
  document.addEventListener('click', async e => {
    if (!e.target.closest) return;
    const tg = e.target.closest('[data-rt]'); if (tg) { R.t = tg.getAttribute('data-rt'); window.DALRENDER(); return; }
    const lt = e.target.closest('[data-rlot]'); if (lt) { R.lot = lt.getAttribute('data-rlot'); window.DALRENDER(); return; }
    const dl = e.target.closest('[data-rdel]'); if (dl) { if (!confirm(T('حذف هذه الدفعة؟', 'Delete this batch?'))) return; try { const r = await window.DALAPI('/staff/roast', { method: 'POST', body: JSON.stringify({ op: 'del', t: R.t, id: dl.getAttribute('data-rdel') }) }); if (r.ok) { window.DALD()[DOC(R.t)] = r.log; if (r.moves) window.DALD().moves = r.moves; if (r.alerts) window.DALD().alerts_stock = r.alerts; window.DALRENDER(); window.DALTOAST(T('انحذفت', 'Deleted')); } else window.DALTOAST(svErr(r.err)); } catch (x) { window.DALTOAST(T('تعذّر', 'Failed')); } return; }
    const b = e.target.closest('[data-rc="add"]'); if (!b || R.busy) return;
    const g = num(R.g), r = num(R.r);
    if (R.t === 'dal' && !R.o) return window.DALTOAST(T('اختر المحصول', 'Choose the coffee'));
    if (R.t === 'ext' && !R.c.trim()) return window.DALTOAST(T('اكتب اسم العميل', 'Enter the customer name'));
    if (!(g > 0)) return window.DALTOAST(T('اكتب وزن الأخضر', 'Enter the green weight'));
    if (!(r > 0) || r > g) return window.DALTOAST(T('وزن المحمّص لازم يكون أقل من الأخضر', 'Roasted weight must be less than green'));
    const o = origins().find(x => x.id === R.o);
    R.busy = true; window.DALRENDER();
    try {
      const lots = R.t === 'dal' ? lotsOf(R.o) : []; const res = await window.DALAPI('/staff/roast', { method: 'POST', body: JSON.stringify({ op: 'add', t: R.t, gs: R.t === 'dal' ? R.o : undefined, lot: lots.length > 1 ? (R.lot || lots[0].id) : undefined, o: R.o, on: o ? o.name : '', c: R.c.trim(), g, r, n: R.n.trim() }) });
      if (!res.ok) throw new Error(svErr(res.err));
      window.DALD()[DOC(R.t)] = res.log; if (res.moves) window.DALD().moves = res.moves; if (res.alerts) window.DALD().alerts_stock = res.alerts; Object.assign(R, { g: '', r: '', n: '', c: '', lot: null });
      window.DALTOAST(res.out ? T('انسجّلت الدفعة: سُحب ', 'Batch logged: issued ') + f1(res.out.tot) + T(' كجم أخضر وأُضيف ', ' kg green, added ') + f1(res.inn.tot) + T(' كجم محمّص', ' kg roasted') + (res.trf ? T(' · نُقل ', ' · transferred ') + f1(res.trf.tot) + T(' كجم من المستودع للمحمصة تلقائيًا', ' kg from the warehouse to the roastery automatically') : '') + (res.short ? T(' · نقص ', ' · short ') + f1(res.short) + T(' كجم في المستودع والمحمصة معًا (للمالك)', ' kg across warehouse and roastery (flagged)') : '') + (res.nolot ? T(' · بلا دفعة أخضر (للمالك)', ' · no green lot (flagged)') : '') : T('انسجّلت الدفعة', 'Batch logged'));
    } catch (x) { window.DALTOAST(T('تعذّر الحفظ — ', 'Could not save — ') + x.message); }
    R.busy = false; window.DALRENDER();
  });
})();
