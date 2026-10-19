/* حركة المخزون — Stock movement (v2): إضافة من مورد (إلى المستودع أو المحمصة)، نقل داخلي بأربعة مسارات (المستودع ← المقهى، المستودع ← المحمصة، المحمصة ← المقهى، المحمصة ← المستودع)،
   وتسليم لعميل (من المستودع أو المحمصة)، بمفاتيح الوحدات ودفعات الموردين والاستلام من فاتورة والأصناف المؤقتة وصفحة الوحدات. المواقع والأرصدة بالموقع في units-core.js.
   البيانات: live/moves (كل إضافة دفعة من مورد مع «الباقي»؛ النقل إلى المقهى والتسليم يستهلكان الدفعات بالأقدم أولًا؛ النقل مستودع ↔ محمصة لا يمسّ الدفعات)، live/units (سلالم الوحدات والحد الأدنى)،
   live/pending_items (أصناف وموردون مؤقتون بانتظار فودكس)، live/suppliers (أسماء فقط)، live/invoices (مختصر). كل الحسابات النهائية على الخادم.
   لا أسعار ولا تكاليف هنا أبدًا. يعتمد على staff-count.js (الكاميرا وقائمة الأصناف) و units-core.js (window.DALU). */
(function () {
  const M = window.DALM = { seg: 'move', mode: 'trf', cur: null, unit: null, q: '', lines: [], lot: null, sup: null, inv: null, newItem: null, pick: null, uq: '', ucat: 'all', link: null, busy: false, loc: 'wh', route: null, src: null, cust: null, cq: '', card: null, lastDoc: null, df: {}, sign: null, pads: {}, sigName: '' };
  const T = (ar, en) => window.DALT ? window.DALT(ar, en) : ar;
  const EN = () => window.DALLANG && window.DALLANG() === 'en';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = v => v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const ico = (k, s) => window.DALICO ? window.DALICO(k, s) : '';
  const U = () => window.DALU; const C = () => window.DALC; const D = () => (window.DALD ? window.DALD() : {});
  const can = (p, l) => window.DALCAN ? window.DALCAN(p, l) : false;
  const uname = k => U().name(k, EN());
  const ksa = d => new Date(new Date(d).getTime() + 3 * 3600e3); const day = d => ksa(d).toISOString().slice(0, 10); const hm = d => ksa(d).toISOString().slice(11, 16);
  const dTxt = d => { if (!d) return '—'; const x = new Date(String(d).slice(0, 10) + 'T12:00:00'); return isNaN(x) ? String(d) : x.getDate() + ' ' + (window.DALMN ? window.DALMN(x.getMonth()) : x.getMonth() + 1); };
  const ymNow = () => day(Date.now()).slice(0, 7);
  const moves = () => ((D().moves || {}).list) || [];
  const pend = () => D().pending_items || { items: [], suppliers: [] };
  const BUILTIN = [{ id: 'dal', name: 'دال (إنتاج داخلي)', en: 'Dal (in-house)' }];
  const sups = () => BUILTIN.concat(((D().suppliers || {}).list) || [], (pend().suppliers || []).map(x => Object.assign({ pending: true }, x)));
  const supName = s => !s ? '' : (s.id === 'dal' && EN() ? 'Dal (in-house)' : s.id === 'roast' && EN() ? 'Dal roasting' : s.name || s.id);
  // الصنف: من فودكس أو صنف مؤقت (tmp-…) غير مربوط بعد
  M.pendItem = s => { const p = (pend().items || []).find(x => x.id === s && !x.linked); return p ? { s: p.id, ar: p.ar, en: p.en, u: p.u, c: 'Pending', pending: true, sup: p.sup } : null; };
  const item = s => (C().items || []).find(i => i.s === s) || M.pendItem(s);
  const nm = i => EN() ? i.en : i.ar; const nm2 = i => EN() ? i.ar : i.en;
  const entry = it => C().entry(it);
  const lotsOf = s => moves().filter(x => x.t === 'in' && x.s === s && x.rem > 0).sort((a, b) => a.at.localeCompare(b.at));
  const balance = s => U().balance(moves(), s);
  // المواقع: المستودع wh / المحمصة rs / المقهى cafe (units-core). النقل بأربعة مسارات فقط؛ الإضافة إلى المستودع أو المحمصة؛ التسليم من المستودع أو المحمصة
  const LN = k => U().locName(k, EN());
  const ARROW = () => T('←', '→');
  const routeTxt = (f, t) => LN(f) + ' ' + ARROW() + ' ' + LN(t);
  const isRoasted = it => !!(it && it.c === 'Roasted Coffee');
  const route = it => M.route || (isRoasted(it) ? ['rs', 'cafe'] : ['wh', 'cafe']);   // المسار الافتراضي: المحمّص من المحمصة، وغيره من المستودع
  const src = it => M.src || (isRoasted(it) ? 'rs' : 'wh');
  const consumes = it => M.mode === 'dlv' || (M.mode === 'trf' && route(it)[1] === 'cafe');   // ما يستهلك الدفعات (التسليم والنقل إلى المقهى)
  const bals = s => U().balances(moves(), s, U().lastCountAt(D().count_state));
  const KIND = { rec: ['سند استلام', 'Receipt note'], dlv: ['سند تسليم', 'Delivery note'], trf: ['سند نقل داخلي', 'Internal transfer note'] };
  const kindLbl = k => (KIND[k] || [k, k])[EN() ? 1 : 0];
  const CSS = `<style id="dm-css">
  .dm{font-variant-numeric:tabular-nums}
  .dm-seg{display:flex;background:var(--fill);border-radius:12px;padding:3px;margin:8px 0 12px}.dm-seg button{flex:1;border:0;background:transparent;min-height:44px;border-radius:10px;font-size:15px;font-weight:600;color:var(--ink2);cursor:pointer}.dm-seg button[aria-pressed=true]{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}.dm-seg button[aria-pressed=true].out{color:var(--bad)}.dm-seg button[aria-pressed=true].in{color:var(--ok)}.dm-seg button[aria-pressed=true].trf{color:#0a6ccf}
  .dm-rt{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 10px}.dm-rt button{border:0;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);border-radius:12px;min-height:56px;padding:8px 10px;font-size:15px;font-weight:600;color:var(--ink);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;line-height:1.25}.dm-rt button[aria-pressed=true]{box-shadow:inset 0 0 0 2px #0a6ccf;color:#0a6ccf;background:#eef5fd}.dm-rt button .ar{color:var(--ink3);font-weight:400}.dm-rt button[aria-pressed=true] .ar{color:#0a6ccf}
  .dm-bal{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:0 0 10px}.dm-bal div{background:var(--card);border-radius:12px;padding:8px 6px;text-align:center}.dm-bal b{display:block;font-size:18px;font-weight:600;direction:ltr}.dm-bal small{display:block;font-size:12px;color:var(--ink2);margin-top:1px}.dm-bal div.c b{color:#0a6ccf}
  .dm-ic{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font-size:15px;font-weight:600;color:#fff;background:var(--ink3);flex:none}.dm-ic.out{background:var(--bad)}.dm-ic.in{background:var(--ok)}.dm-ic.done{background:var(--warn)}.dm-ic.adj{background:#0a6ccf}
  .dm-qty{display:flex;align-items:center;gap:10px;background:var(--card);border-radius:12px;padding:12px 16px;margin:10px 0}.dm-qty b{flex:1;font-size:40px;font-weight:600;letter-spacing:-1px;direction:ltr;text-align:end;line-height:1.1}.dm-qty small{font-size:14px;color:var(--ink2)}
  .dm-num{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 10px}.dm-num button{background:var(--card);border:0;box-shadow:inset 0 0 0 1px var(--line);border-radius:12px;min-height:52px;font-size:22px;font-weight:600;cursor:pointer;color:var(--ink)}.dm-num button:active{background:var(--fill)}.dm-num button.a{grid-column:span 3;background:var(--ink);color:#fff;box-shadow:none;font-size:16px}
  .dm-tot{display:flex;align-items:center;gap:10px;background:var(--card);border-radius:12px;padding:12px 16px;margin:10px 0}.dm-tot small{flex:1;color:var(--ink2);font-size:14px}.dm-tot b{font-size:24px;font-weight:600;direction:ltr}
  .dm-lot{display:flex;flex-direction:column;gap:6px;padding:0 0 10px}.dm-lot button{border:0;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);border-radius:12px;min-height:48px;padding:8px 14px;text-align:start;font-size:15px;cursor:pointer;display:flex;gap:10px;align-items:center}.dm-lot button[aria-pressed=true]{box-shadow:inset 0 0 0 2px var(--ink)}.dm-lot button small{color:var(--ink2);font-size:13px;display:block}
  .dm-ban{display:flex;align-items:center;gap:10px;background:var(--acc-soft);color:var(--acc-ink);border-radius:12px;padding:10px 14px;margin:0 0 10px;font-size:14px}.dm-ban .t{flex:1;min-width:0}.dm-ban b{display:block;font-weight:600}
  .dm-badge{display:inline-block;background:var(--bad);color:#fff;font-size:12px;font-weight:600;border-radius:999px;padding:2px 8px;margin-inline-start:6px}
  .dm-sg{display:inline-flex;align-items:center;gap:3px;background:var(--ok-soft);color:var(--ok);font-size:12px;font-weight:600;border-radius:6px;padding:1px 7px;vertical-align:middle}.dm-sg svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}.dm-sg.w{background:var(--fill);color:var(--ink2)}
  .dm-ban .acts{display:flex;flex-direction:column;align-items:flex-end;gap:0}.dm-ban .acts .lnk{min-height:36px;padding:0 4px;font-size:15px}
  .dm-ul .cell small{color:var(--ink2)}
  .dm-lad{display:flex;align-items:center;gap:8px;min-height:52px;padding:8px 16px;position:relative;flex-wrap:wrap}.dm-lad+.dm-lad::before{content:"";position:absolute;top:0;inset-inline-start:16px;inset-inline-end:0;border-top:1px solid var(--line)}
  .dm-lad .n{min-width:72px;font-weight:600}.dm-lad .eq{color:var(--ink2);font-size:14px;display:flex;align-items:center;gap:6px;flex:1;flex-wrap:wrap}.dm-lad input{width:88px;margin:0;text-align:center;direction:ltr;min-height:40px;padding:6px}.dm-lad input:disabled{background:var(--fill);color:var(--ink2)}.dm-lad .x{border:0;background:var(--fill);width:36px;height:36px;border-radius:50%;cursor:pointer;color:var(--ink2);display:grid;place-items:center}
  .dm-addu{display:flex;gap:8px;align-items:center;padding:8px 16px 12px}.dm-addu select{margin:0;flex:1;min-height:44px}.dm-addu .btn{width:auto;margin:0;min-height:44px;padding:0 16px}
  .dm-min{display:flex;align-items:center;gap:8px;padding:8px 16px 12px;font-size:14px;color:var(--ink2)}.dm-min input{width:110px;margin:0;text-align:center;direction:ltr;min-height:40px}
  .dm-link{display:flex;gap:8px;align-items:center;padding:8px 16px 12px}.dm-link select{margin:0;flex:1;min-height:44px}.dm-link .btn{width:auto;margin:0;min-height:44px;padding:0 16px}
  </style>`;

  M.load = async function () { /* البيانات تأتي مع load() في staff.html؛ هنا فقط الوحدات إن لم تُحمَّل */ if (!C().units) await C().loadUnits(window.DALAPI); };
  function reset() { M.cur = null; M.unit = null; M.q = ''; M.lines = []; M.lot = null; M.sup = null; M.newItem = null; M.src = null; M.cust = null; M.cq = ''; }   // الموقع والمسار يبقيان لمواصلة العمل على أصناف عدة
  const custs = () => (((D().customers || {}).list) || []).concat(((pend().customers) || []).map(x => Object.assign({ pending: true, type: '' }, x)));
  const custOf = id => custs().find(x => String(x.id) === String(id));
  const CK = () => window.DALCARDS;
  const rr = () => window.DALRENDER();
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const docsL = () => ((D().docs_out || {}).items) || [];
  const docOf = no => docsL().find(x => x.no === no) || null;
  const sigsOf = no => { const d = docOf(no); return (d && d.sigs) || []; };
  const ROLES = { rec: ['rcv', 'sup'], dlv: ['dlv', 'cust'], trf: ['snd', 'rcv'] };   // أدوار الموظف (الأول دوره هو: اسمه من حساب الدخول)؛ «اعتماد» للمالك فقط
  const RL = { rcv: ['المستلم (دال)', 'Received by (Dal)'], sup: ['مندوب المورد', 'Supplier representative'], dlv: ['المسلّم (دال)', 'Delivered by (Dal)'], cust: ['المستلم (العميل)', 'Received by (customer)'], snd: ['المسلّم', 'Handed over by'], appr: ['اعتماد المالك', 'Owner approval'] };
  const RLT = { rcv: ['المستلم', 'Received by'] };   // في سند النقل المستلم موظف دال في الموقع الآخر
  const rl = (r, kind) => ((kind === 'trf' && RLT[r]) || RL[r] || [r, r])[EN() ? 1 : 0];
  const sgBadge = sigs => sigs && sigs.length ? `<span class="dm-sg">${CHECK}${T('موقّع', 'Signed')} ${sigs.length}</span>` : '';
  const canSign = no => { const d = docOf(no); return !!(d && ROLES[d.kind] && ROLES[d.kind].some(r => !(d.sigs || []).some(x => x.role === r))); };

  /* ---------- الصفحة ---------- */
  M.view = function () {
    if (!C().items) return `<p class="note">${T('جارٍ التحميل…', 'Loading…')}</p>`;
    const segs = []; if (can('move', 'view')) segs.push(['move', T('حركة', 'Move')], ['log', T('السجل', 'Log')]); if (can('units', 'view')) segs.push(['units', T('الوحدات', 'Units')]); if (can('move', 'view')) segs.push(['docs', T('المستندات', 'Documents')]);
    if (!segs.some(s => s[0] === M.seg)) M.seg = segs[0] ? segs[0][0] : 'move';
    const npend = (pend().items || []).filter(x => !x.linked).length; const badge = npend && can('units', 'edit') ? `<span class="dm-badge">${npend}</span>` : '';
    return (C().CSS || '') + CSS + `<div class="dm">${segs.length > 1 ? `<div class="dm-seg" role="tablist">${segs.map(s => `<button role="tab" data-ms="${s[0]}" aria-pressed="${M.seg === s[0]}">${s[1]}${s[0] === 'units' ? badge : ''}</button>`).join('')}</div>` : ''}
    ${M.sign ? vSign() : M.card ? vCard() : M.seg === 'move' ? vMove() : M.seg === 'log' ? vLog() : M.seg === 'docs' ? vDocs() : vUnits()}</div>`;
  };
  /* ---------- التوقيع الإلكتروني: بعد حفظ سند استلام/تسليم أو لاحقًا من قائمة المستندات. لوحتان: موظف دال (الاسم تلقائي) والطرف الآخر (اسم + لوحة). كلاهما اختياري؛ كل دور يوقَّع مرة واحدة ثم يُقفل ---------- */
  function vSign() {
    const d = docOf(M.sign.no); if (!d || !ROLES[d.kind]) { M.sign = null; return vMove(); } const K = CK(); const f = K ? K.fmtDay(d.at, EN() ? 'en' : 'ar') : { full: '', time: '' }; const r = d.ref || {};
    const [mine, other] = ROLES[d.kind]; const done = ROLES[d.kind].every(x => (d.sigs || []).some(s => s.role === x));
    setTimeout(mountPads, 0);
    return `<h1>${T('توقيع', 'Signature')} <span dir="ltr" style="font-size:20px;color:var(--ink2)">${esc(d.no)}</span></h1><p class="note">${kindLbl(d.kind)} · ${d.kind === 'trf' ? routeTxt(r.from, r.to) : '<span class="d">' + esc(r.name || '') + '</span>'} · ${esc(f.full)} ${f.time}<br>${T('التوقيع اختياري. كل دور يوقّع مرة واحدة ثم يُقفل، ويُقفل محتوى السند بعد أول توقيع. يظهر التوقيع في PDF مع الاسم والوقت وبصمة التحقق.', 'Signing is optional. Each role signs once and is then locked; the note’s content locks after the first signature. The PDF shows the signature with the name, time and verification hash.')}</p>
    <div data-dspad="${mine}"></div><div data-dspad="${other}"></div>
    <div class="err" id="msg-err"></div>
    ${done ? '' : `<button class="btn k" data-ma="signsave" ${M.busy ? 'disabled' : ''}>${T('احفظ التوقيع', 'Save signature')}</button>`}<button class="btn s" data-mdoc="${esc(d.no)}">${(d.sigs || []).length ? T('PDF موقّع', 'Signed PDF') : T('PDF', 'PDF')}</button><button class="btn g" data-ma="signx">${done ? T('رجوع', 'Back') : T('لاحقًا', 'Later')}</button>`;
  }
  function mountPads() {
    const S = window.DALSIGN; if (!S || !M.sign) return; const d = docOf(M.sign.no); if (!d) return; const me = window.DALME ? (window.DALME() || {}).name : ''; const K = CK(); const L = EN() ? 'en' : 'ar'; const r = d.ref || {};
    document.querySelectorAll('[data-dspad]').forEach(el => { if (el.querySelector('.ds')) return; const role = el.getAttribute('data-dspad'); const s = (d.sigs || []).find(x => x.role === role); const isMine = role === ROLES[d.kind][0]; const prev = M.pads[role];
      M.pads[role] = S.create(el, { lang: L, role, title: rl(role, d.kind), sub: isMine ? '' : (d.kind === 'dlv' ? T('يوقّع العميل على جوالك عند التسليم', 'The customer signs on your phone at handover') : d.kind === 'trf' ? T('يوقّع المستلم في الموقع الآخر على جوالك', 'The receiver at the other location signs on your phone') : T('يوقّع المندوب على جوالك', 'The representative signs on your phone')), name: isMine ? me : null, namePlaceholder: d.kind === 'dlv' ? T('اسم مستلم البضاعة', 'Name of the person receiving') : d.kind === 'trf' ? T('اسم المستلم', 'Receiver’s name') : T('اسم مندوب المورد', 'Supplier representative’s name'), nameValue: prev && !prev.locked ? prev.name() : (role === 'cust' ? (r.name || '') : ''), strokes: prev && !prev.locked ? prev.strokes : null, signed: s ? { name: s.name, at: s.at, hash: s.hash, png: s.png } : null, dateText: s && K ? K.fmtDay(s.at, L).full + ' ' + K.fmtDay(s.at, L).time : '' }); });
  }
  async function signSave() {
    const d = docOf(M.sign.no); if (!d) return; const err = document.getElementById('msg-err'); if (err) err.textContent = ''; const todo = [];
    for (const role of ROLES[d.kind]) { const p = M.pads[role]; if (!p || p.locked || p.empty()) continue; const name = p.name(); if (!name) { if (err) err.textContent = T('اكتب اسم الموقّع: ', 'Enter the signer’s name: ') + rl(role, d.kind); return; } const png = await p.png(); if (!png) continue; todo.push({ role, name, png }); }
    if (!todo.length) { if (err) err.textContent = T('لا توقيع بعد. وقّع في اللوحة أو اضغط «لاحقًا».', 'Nothing signed yet. Sign in the pad or tap “Later”.'); return; }
    M.busy = true; rr(); let n = 0;
    try { for (const t of todo) { const r = await window.DALAPI('/staff/sign', { method: 'POST', body: JSON.stringify({ no: d.no, role: t.role, name: t.name, png: t.png }) }); if (!r.ok) throw new Error(r.err === 'dup' ? T('هذا الدور موقّع مسبقًا', 'This role is already signed') : r.err === 'png' ? T('صورة التوقيع غير صالحة', 'Invalid signature image') : r.err === 'forbidden' ? T('ليس لديك صلاحية', 'Not allowed') : r.err || 'err'); putDoc(r.doc); delete M.pads[t.role]; n++; }
      window.DALTOAST(T('حُفظ التوقيع', 'Signature saved') + ' · ' + d.no); } catch (e) { window.DALTOAST(T('تعذّر حفظ التوقيع: ', 'Could not save the signature: ') + e.message); }
    M.busy = false; rr();
  }
  function putDoc(item) { if (!item) return; const dd = D().docs_out || (D().docs_out = { items: [] }); const i = (dd.items || []).findIndex(x => x.no === item.no); if (i >= 0) dd.items[i] = item; else dd.items = [item].concat(dd.items || []); }
  /* ---------- حركة: إضافة / نقل / تسليم ---------- */
  const SEG = () => [['in', 'in', '+ ' + T('إضافة', 'Add')], ['trf', 'trf', T('نقل', 'Transfer')], ['dlv', 'out', '− ' + T('تسليم', 'Delivery')]];
  function routeUi(it) { const cur = route(it); return `<div class="sec">${T('نوع الصرف', 'Transfer type')}</div><div class="dm-rt">${U().ROUTES.map(r => `<button data-mroute="${r[0]}-${r[1]}" aria-pressed="${cur[0] === r[0] && cur[1] === r[1]}"><span>${LN(r[0])}</span><span class="ar">${ARROW()}</span><span>${LN(r[1])}</span></button>`).join('')}</div>`; }
  function locUi(sel, attr, label) { return `<div class="sec">${label}</div><div class="dm-seg">${['wh', 'rs'].map(k => `<button data-${attr}="${k}" aria-pressed="${sel === k}">${LN(k)}</button>`).join('')}</div>`; }
  function vMove() {
    const edit = can('move', 'edit'); const mode = M.mode; const tr = mode === 'trf', dl = mode === 'dlv', inn = mode === 'in';
    const head = `<h1>${T('حركة المخزون', 'Stock movement')}</h1><p class="note">${T('اختر إضافة من مورد، أو نقل بين المستودع والمحمصة والمقهى، أو تسليم لعميل. امسح ملصق الصنف واكتب الكمية بالوحدة اللي قدامك. الإضافة من مورد تصير دفعة؛ النقل إلى المقهى والتسليم ينقصان من الدفعات بالأقدم أولًا.', 'Pick an addition from a supplier, a transfer between the warehouse, the roastery and the cafe, or a delivery to a customer. Scan the item label, then type the quantity in the unit in front of you. An addition from a supplier becomes a lot; transfers to the cafe and deliveries consume lots oldest first.')}</p>
    <div class="dm-seg">${SEG().map(x => `<button data-mm="${x[0]}" class="${x[1]}" aria-pressed="${mode === x[0]}">${x[2]}</button>`).join('')}</div>`;
    if (!edit) return head + `<p class="note">${T('صلاحيتك للعرض فقط.', 'View only.')}</p>` + vLog(true);
    if (M.newItem) return head + vNewItem();
    if (!M.cur) {
      const lsig = M.lastDoc ? sigsOf(M.lastDoc.no) : [];
      const docBan = M.lastDoc ? `<div class="dm-ban" style="background:var(--ok-soft);color:var(--ok)">${ico('doc', 22)}<div class="t"><b>${kindLbl(M.lastDoc.kind)} <span dir="ltr">${esc(M.lastDoc.no)}</span> ${sgBadge(lsig)}</b>${M.lastDoc.kind === 'trf' ? routeTxt(M.lastDoc.from, M.lastDoc.to) : esc(M.lastDoc.name || '')}${lsig.length ? '<br><small>' + lsig.map(x => esc(rl(x.role, M.lastDoc.kind)) + ': <span class="d">' + esc(x.name) + '</span>').join(' · ') + '</small>' : ''}</div><div class="acts"><button class="lnk" data-mdoc="${esc(M.lastDoc.no)}">${lsig.length ? T('PDF موقّع', 'Signed PDF') : T('اطبع', 'Print')}</button>${canSign(M.lastDoc.no) ? `<button class="lnk" data-msign="${esc(M.lastDoc.no)}">${T('توقيع', 'Sign')}</button>` : ''}<button class="lnk" data-ma="docx">${T('إخفاء', 'Hide')}</button></div></div>` : '';
      const inv = M.inv ? `<div class="dm-ban">${ico('doc', 22)}<div class="t"><b>${T('استلام فاتورة', 'Receiving invoice')} <span class="d">${esc(M.inv.supplier || '')}${M.inv.invoice_no ? ' · #' + esc(M.inv.invoice_no) : ''}</span></b>${M.inv.items ? `<span class="d">${esc(M.inv.items)}</span>` : ''}</div><button class="lnk" data-ma="invx">${T('إنهاء', 'Done')}</button></div>` : '';
      return head + docBan + (inn ? inv : '') + (tr ? routeUi(null) : inn ? locUi(M.loc, 'mloc', T('إلى أين تُضاف؟', 'Add to which location?')) : '') + `<button class="btn k" data-ma="scan">${ico('cam')}${T('امسح ملصق الصنف', 'Scan the item label')}</button>
      <div class="search" style="margin-top:12px">${ico('search', 18)}<input id="mq" placeholder="${T('أو ابحث بالاسم أو الرمز', 'Or search name or SKU')}" value="${esc(M.q)}"></div>
      ${M.q.trim() ? list() : ''}
      ${!inn ? '' : `<div class="grp" style="margin-top:4px">${M.inv ? '' : `<button class="cell" data-ma="inv"><span class="t"><b>${T('من فاتورة', 'From an invoice')}</b><small>${T('فواتير هذا الشهر: يُربط الاستلام برقم الفاتورة', 'This month’s invoices: the receipt is tagged with the invoice')}</small></span></button>`}<button class="cell" data-ma="newitem"><span class="t"><b>${T('صنف جديد', 'New item')}</b><small>${T('غير موجود في فودكس بعد: يُسجَّل مؤقتًا ويُربط لاحقًا', 'Not in Foodics yet: recorded temporarily and linked later')}</small></span></button></div>`}
      ${M.pick === 'inv' ? vInvPick() : ''}`;
    }
    const it = item(M.cur); if (!it) { M.cur = null; return head; }
    const e = entry(it); if (!M.unit || !e.lad.some(x => x[0] === M.unit)) M.unit = e.base;
    const B = bals(it.s); const lots = lotsOf(it.s); const cons = consumes(it); const rt = route(it);
    const tot = U().total(e, M.lines.concat(M.q && +M.q > 0 ? [{ n: +M.q, u: M.unit }] : [])) || 0;
    const balUi = `<div class="dm-bal"><div><b>${fmt(B.wh)}</b><small>${LN('wh')}</small></div><div><b>${fmt(B.rs)}</b><small>${LN('rs')}</small></div><div class="c"><b>${fmt(B.cafe)}</b><small>${T('المقهى منذ آخر جرد', 'Cafe since last count')}</small></div></div>`;
    const lotUi = cons && lots.length > 1 ? `<div class="sec">${T('من أي دفعة؟ (الأقدم أولًا)', 'Which lot? (oldest first)')}</div><div class="dm-lot">${lots.map((l, k) => `<button data-mlot="${esc(l.id)}" aria-pressed="${(M.lot || lots[0].id) === l.id}"><span class="dm-ic in">${k + 1}</span><span><bdi class="d">${esc(supName(l.sup))}</bdi> · <bdi>${dTxt(l.at)}</bdi><small>${T('باقي', 'Left')} ${fmt(l.rem)} ${uname(e.base)}${l.inv ? ' · ' + T('فاتورة', 'invoice') + ' <span class="d">' + esc(l.invNo || l.inv) + '</span>' : ''}</small></span></button>`).join('')}</div><div class="chips">${lots.map(l => l.sup).filter((v, i, A) => v && v.id !== 'roast' && v.id !== 'dal' && A.findIndex(x => x && x.id === v.id) === i).map(sp => `<button data-mscard="${esc(sp.id)}">${T('بطاقة', 'Card')}: ${esc(supName(sp))}</button>`).join('')}</div>` : '';
    const whereUi = tr ? routeUi(it) : dl ? locUi(src(it), 'msrc', T('من أين يُسلَّم؟', 'Deliver from which location?')) + `<div class="sec">${T('العميل', 'Customer')}</div>` + vCustPick() : locUi(M.loc, 'mloc', T('إلى أين تُضاف؟', 'Add to which location?'));
    const supUi = !inn ? '' : `<div class="sec">${T('المورد', 'Supplier')}</div><div class="chips">${sups().map(s => `<button data-msup="${esc(s.id)}" aria-pressed="${M.sup && M.sup.id === s.id}">${esc(EN() && s.en ? s.en : s.name)}${s.pending ? ' · ' + T('مؤقت', 'pending') : ''}</button>`).join('')}<button data-msup="__new" aria-pressed="${M.sup && M.sup.new}">${T('مورد جديد', 'New supplier')}</button></div>${M.sup && !M.sup.new && M.sup.id !== 'dal' ? `<button class="lnk" data-mscard="${esc(M.sup.id)}" style="padding:0">${T('بطاقة المورد', 'Supplier card')}: <span class="d">${esc(M.sup.name)}</span></button>` : ''}${M.sup && M.sup.new ? `<input id="msupn" placeholder="${T('اسم المورد الجديد (يُعرض للمالك لاعتماده)', 'New supplier name (the owner approves it)')}" value="${esc(M.sup.name || '')}">` : ''}`;
    const sign = inn ? '+' : dl || cons ? '−' : ''; const col = inn ? 'var(--ok)' : dl || cons ? 'var(--bad)' : '#0a6ccf';
    const saveLbl = inn ? T('سجّل الإضافة', 'Save addition') : dl ? T('سجّل التسليم', 'Save delivery') : T('سجّل النقل', 'Save transfer');
    return head + `<div class="grp"><div class="cell"><span class="dm-ic ${inn ? 'in' : dl ? 'out' : 'adj'}">${inn ? '+' : dl ? '−' : '⇄'}</span><div class="t"><b class="d">${esc(nm(it))}</b><small><span class="d">${esc(nm2(it))}</span> · <span class="d">DAL:${esc(it.s)}</span>${it.pending ? ' · <span style="color:var(--bad)">' + T('مؤقت · بانتظار فودكس', 'Temporary · waiting for Foodics') + '</span>' : ''}</small><small>${T('الإجمالي حسب الدفعات', 'Total from lots')}: <b style="font-weight:600">${B.total == null ? '—' : fmt(B.total) + ' ' + uname(e.base)}</b>${lots.length ? ' · ' + lots.length + ' ' + T('دفعة', 'lot(s)') : ''}</small></div><button class="lnk" data-ma="change">${T('صنف آخر', 'Change')}</button></div></div>
    ${balUi}
    ${M.inv && inn ? `<div class="dm-ban">${ico('doc', 20)}<div class="t"><b>${T('فاتورة', 'Invoice')} <span class="d">${esc(M.inv.supplier || '')}${M.inv.invoice_no ? ' · #' + esc(M.inv.invoice_no) : ''}</span></b>${M.inv.items ? `<span class="d">${esc(M.inv.items)}</span>` : ''}</div></div>` : ''}
    ${whereUi}${lotUi}${supUi}
    <div class="sec">${T('الوحدة', 'Unit')}</div>${C().chips(e, M.unit, 'mun')}
    <div class="dm-qty"><small>${T('الكمية', 'Quantity')}</small><b id="mqv">${esc(M.q || '0')}</b><small>${uname(M.unit)}</small></div>
    <div class="dm-num">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(k => `<button data-mk="${k}" aria-label="${k === '⌫' ? T('حذف', 'Delete') : k}">${k}</button>`).join('')}<button class="a" data-ma="addline">${T('أضف سطر', 'Add line')}</button></div>
    ${M.lines.length ? `<div class="sec">${T('الأسطر', 'Lines')}</div><div class="grp dm-ul">${M.lines.map((l, i) => `<div class="cell"><div class="t"><b>${fmt(l.n)} ${uname(l.u)}</b><small>= ${fmt(U().total(e, [l]))} ${uname(e.base)}</small></div><button class="lnk bad" data-mdel="${i}">${T('حذف', 'Delete')}</button></div>`).join('')}</div>` : ''}
    <div class="dm-tot"><small>${tr ? routeTxt(rt[0], rt[1]) : T('الإجمالي بالوحدة الأساسية', 'Total in base unit')}</small><b style="color:${col}">${sign}${fmt(tot)} ${uname(e.base)}</b></div>
    <input id="mnote" placeholder="${T('ملاحظة (اختياري)', 'Note (optional)')}" value="${esc(M.note || '')}">
    <button class="btn ${inn ? 'k' : ''}" data-ma="save" ${tot > 0 && !M.busy ? '' : 'disabled'}>${saveLbl}</button>
    ${it.pending ? `<button class="btn s" data-ma="tmplabel">${T('اطبع ملصقًا مؤقتًا', 'Print a temporary label')}</button>` : ''}`;
  }
  function list() {
    const q = M.q.trim().toLowerCase(); const L = (C().items || []).concat((pend().items || []).filter(x => !x.linked).map(x => M.pendItem(x.id))).filter(i => i.en.toLowerCase().includes(q) || i.ar.includes(M.q.trim()) || i.s.toLowerCase().includes(q)).slice(0, 12);
    return L.length ? `<div class="grp">${L.map(i => `<button class="cell" data-mopen="${esc(i.s)}"><span class="t"><b class="d">${esc(nm(i))}</b><small><span class="d">${esc(nm2(i))}</span> · <span class="d">${esc(i.s)}</span>${i.pending ? ' · ' + T('مؤقت', 'temporary') : ''}</small></span></button>`).join('')}</div>` : `<div class="grp"><div class="cell"><div class="t"><b>${T('لا نتائج', 'No results')}</b><small>${T('إن كان صنفًا جديدًا لم يُضف في فودكس بعد:', 'If it is a new item not yet in Foodics:')}</small></div>${M.mode === 'in' ? `<button class="lnk" data-ma="newitem">${T('صنف جديد', 'New item')}</button>` : ''}</div></div>`;
  }
  function vInvPick() {
    const ym = ymNow(); const L = (((D().invoices || {}).items) || []).filter(x => String(x.date || x.at || '').slice(0, 7) === ym);
    return `<div class="sec">${T('فواتير هذا الشهر', 'This month’s invoices')}</div>${L.length ? `<div class="grp">${L.map(x => `<button class="cell" data-minv="${esc(x.id)}"><span class="t"><b class="d">${esc(x.supplier || T('مورد غير معروف', 'Unknown supplier'))}</b><small>${x.invoice_no ? '<span class="d" dir="ltr">#' + esc(x.invoice_no) + '</span> · ' : ''}${dTxt(x.date)}${x.items ? ' · <span class="d">' + esc(String(x.items).slice(0, 80)) + '</span>' : ''}</small></span></button>`).join('')}</div>` : `<p class="note">${T('لا فواتير هذا الشهر.', 'No invoices this month.')}</p>`}<p class="note">${T('الفاتورة تُقرأ كوصف واحد للأصناف (بلا أسطر منفصلة)، فامسح كل صنف وأدخل الكمية المستلمة بوحدته.', 'The invoice is read as one items description (no separate lines), so scan each item and enter the received quantity in its unit.')}</p>`;
  }
  function vNewItem() {
    const n = M.newItem; const units = ['KG', 'Pcs', 'Liter', 'Box', 'Pack', 'Bottle', 'Roll'];
    return `<div class="grp"><div class="pad"><b style="font-weight:600">${T('صنف جديد (مؤقت)', 'New item (temporary)')}</b><p class="note" style="margin:4px 0 0">${T('يُسجَّل باسم مؤقت ويُطبع له ملصق «مؤقت». لا يُنشأ شيء في فودكس: المالك يضيفه هناك ثم يُربط من صفحة الوحدات.', 'Recorded under a temporary id with a “temporary” label. Nothing is created in Foodics: the owner adds it there, then it is linked on the Units page.')}</p>
      <label class="sub" style="display:block;margin:8px 0 0">${T('الاسم بالعربي', 'Arabic name')}</label><input id="mn-ar" value="${esc(n.ar || '')}" placeholder="${esc(n.hint || '')}">
      <label class="sub" style="display:block;margin:8px 0 0">${T('الاسم بالإنجليزي', 'English name')}</label><input id="mn-en" value="${esc(n.en || '')}">
      <label class="sub" style="display:block;margin:8px 0 0">${T('وحدة التخزين (كما ستكون في فودكس)', 'Storage unit (as it will be in Foodics)')}</label><select id="mn-u">${units.map(u => `<option value="${u}" ${n.u === u ? 'selected' : ''}>${u} · ${uname(U().baseOf({ u }))}</option>`).join('')}</select>
      <div class="err" id="mn-err"></div><button class="btn" data-ma="newsave" ${M.busy ? 'disabled' : ''}>${T('أنشئ الصنف المؤقت', 'Create temporary item')}</button><button class="btn g" data-ma="newx">${T('إلغاء', 'Cancel')}</button></div></div>`;
  }
  /* ---------- اختيار العميل للتسليم ---------- */
  function vCustPick() {
    const q = M.cq.trim(); const L = custs().filter(c => !q || String(c.name || '').includes(q) || String(c.id).includes(q)).slice(0, 12); const TY = { cafe: T('مقهى', 'Cafe'), person: T('فرد', 'Individual'), shop: T('متجر', 'Shop') };
    return `<div class="search">${ico('search', 18)}<input id="mcq" placeholder="${T('ابحث عن العميل بالاسم', 'Search customer by name')}" value="${esc(M.cq)}"></div>
    <div class="grp">${L.map(c => `<div class="cell" style="padding-inline-end:8px"><button class="cell" data-mcust="${esc(c.id)}" aria-pressed="${!!(M.cust && !M.cust.new && String(M.cust.id) === String(c.id))}" style="padding:0;min-height:0;flex:1;${M.cust && !M.cust.new && String(M.cust.id) === String(c.id) ? 'color:var(--acc-ink);font-weight:600' : ''}"><span class="t"><b class="d">${esc(c.name)}</b><small>${TY[c.type] || ''}${c.pending ? (c.type ? ' · ' : '') + T('جديد · بانتظار المالك', 'new · pending owner') : ''}${(c.phone_m || c.phone) ? ' · <span dir="ltr">' + esc(c.phone_m || String(c.phone).replace(/\D/g, '').replace(/^(\d{0,3})\d*(\d{3})$/, (m, x, y) => x + '•••••' + y)) + '</span>' : ''}</small></span></button><button class="lnk" data-mccard="${esc(c.id)}">${T('بطاقة', 'Card')}</button></div>`).join('')}<button class="cell" data-mcust="__new" aria-pressed="${!!(M.cust && M.cust.new)}"><span class="t"><b>${T('عميل جديد', 'New customer')}</b><small>${T('يُسجَّل بانتظار اعتماد المالك', 'Recorded pending the owner’s approval')}</small></span></button></div>
    ${M.cust && M.cust.new ? `<input id="mcustn" placeholder="${T('اسم العميل الجديد', 'New customer name')}" value="${esc(M.cust.name || '')}">` : ''}`;
  }
  /* ---------- البطاقات (مورد / عميل / المحمصة): المكوّن المشترك dal-cards.js، نسخة الفريق بلا أسعار ---------- */
  function cardOpts() { return { lang: EN() ? 'en' : 'ar', staff: true, items: C().items || [], moves: moves(), pend: pend(), docs: docsL(), canPrint: can('move', 'view'), canSign: can('move', 'edit'), back: { href: '#', label: T('رجوع', 'Back'), data: 1 } }; }
  function vCard() {
    const K = CK(); if (!K) return `<p class="note">${T('جارٍ التحميل…', 'Loading…')}</p>`; const k = M.card.kind, id = M.card.id; const o = cardOpts();
    if (k === 'sup') { const sp = sups().find(x => x.id === id) || (() => { const l = moves().find(x => x.t === 'in' && x.sup && x.sup.id === id); return l ? l.sup : null; })(); if (!sp) return `<p class="note">${T('مورد غير معروف.', 'Unknown supplier.')}</p>`; return K.render(K.supplier(Object.assign(o, { sup: sp }))); }
    if (k === 'cust') { const c = custOf(id) || (() => { const m = moves().find(x => x.t === 'out' && x.cust && String(x.cust.id) === String(id)); return m ? m.cust : null; })(); if (!c) return `<p class="note">${T('عميل غير معروف.', 'Unknown customer.')}</p>`; return K.render(K.customer(Object.assign(o, { cust: c }))); }
    if (k === 'dal') { const al = ((D().alerts_stock || {}).items) || []; return K.render(K.roastery(Object.assign(o, { roastLog: ((D().roast_log || {}).list) || [], units: C().units || {}, alerts: al, users: ((D().staff_names || {}).users) || [] }))); }
    return '';
  }
  /* ---------- المستندات: إعادة الطباعة وسجل الحركة لفترة ---------- */
  function vDocs() {
    const K = CK(); if (!K) return `<p class="note">${T('جارٍ التحميل…', 'Loading…')}</p>`; const o = cardOpts(); const docsL = ((D().docs_out || {}).items) || []; const today = K.dayIso(new Date().toISOString()); const f = M.df;
    const form = `<div class="sec">${T('سجل الحركة لفترة', 'Movement log for a period')}</div><div class="grp"><div class="dk-from"><label>${T('من', 'From')}<input type="date" id="mdf-from" value="${esc(f.from || today)}"></label><label>${T('إلى', 'To')}<input type="date" id="mdf-to" value="${esc(f.to || today)}"></label></div><div class="dk-from"><label>${T('الصنف (اختياري)', 'Item (optional)')}<select id="mdf-item"><option value="">${T('الكل', 'All')}</option>${(C().items || []).map(i => `<option value="${esc(i.s)}" ${f.item === i.s ? 'selected' : ''}>${esc(nm(i))}</option>`).join('')}</select></label><label>${T('المورد (اختياري)', 'Supplier (optional)')}<select id="mdf-sup"><option value="">${T('الكل', 'All')}</option>${sups().filter(x => x.id !== 'dal').map(x => `<option value="${esc(x.id)}" ${f.sup === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label><label>${T('العميل (اختياري)', 'Customer (optional)')}<select id="mdf-cust"><option value="">${T('الكل', 'All')}</option>${custs().map(x => `<option value="${esc(x.id)}" ${f.cust === String(x.id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label><label>${T('الموقع (اختياري)', 'Location (optional)')}<select id="mdf-loc"><option value="">${T('الكل', 'Any')}</option>${U().LOCS.map(k => `<option value="${k}" ${f.loc === k ? 'selected' : ''}>${LN(k)}</option>`).join('')}</select></label></div><div class="pad" style="padding-top:0"><button class="btn k" data-ma="movpdf" ${M.busy ? 'disabled' : ''}>${ico('doc')}${T('أنشئ سجل الحركة PDF', 'Create the movement log PDF')}</button><button class="btn s" data-ma="printscreen">${T('اطبع هذه الشاشة', 'Print this screen')}</button></div></div>`;
    return K.render(K.docs(Object.assign(o, { docs: docsL, back: null, actions: [{ id: 'dalcard', label: T('بطاقة المحمصة', 'Roastery card'), kind: 'soft' }] }))) + form;
  }
  // طلب PDF من الخادم وفتحه: نفتح التبويب قبل الانتظار حتى لا يمنعه المتصفح
  async function printDoc(body) {
    if (M.busy) return; M.busy = true; const w = window.open('about:blank', '_blank'); rr();
    try { const r = await fetch((window.DALSRV || '') + '/staff/doc', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('dal-staff-tok') || '') }, body: JSON.stringify(Object.assign({ lang: EN() ? 'en' : 'ar' }, body)) });
      if (!r.ok) { let e = 'HTTP ' + r.status; try { e = (await r.json()).err || e; } catch (x) {} throw new Error(e); }
      const no = r.headers.get('x-dal-doc') || ''; const b = await r.blob(); const u = URL.createObjectURL(b);
      if (w && !w.closed) w.location = u; else { const a = document.createElement('a'); a.href = u; a.download = (no || 'dal-doc') + '.pdf'; a.click(); }
      window.DALTOAST(T('جاهز: ', 'Ready: ') + no); if (!body.no) try { const d = await window.DALAPI('/staff/docs?names=docs_out'); if (d.ok) D().docs_out = d.docs.docs_out; } catch (e) {} setTimeout(() => URL.revokeObjectURL(u), 120000); }
    catch (e) { if (w && !w.closed) w.close(); window.DALTOAST(T('تعذّرت الطباعة: ', 'Could not print: ') + (e.message === 'Failed to fetch' ? T('لا اتصال بالخادم — استخدم «اطبع هذه الشاشة»', 'Server unreachable — use “Print this screen”') : e.message)); }
    M.busy = false; rr();
  }
  M.printDoc = printDoc;
  /* ---------- السجل ---------- */

  function vLog(inline) {
    const L = moves().filter(x => day(x.at) === day(Date.now())); const me = window.DALME ? (window.DALME() || {}).name : '';
    const rows = L.map(x => { const it = item(x.s) || { ar: x.s, en: x.s }; const e = entry(it) || { base: x.base }; const signed = x.doc && sigsOf(x.doc).length; const undo = (x.t === 'in' || x.t === 'out' || x.t === 'trf') && x.by === me && Date.now() - new Date(x.at) < 5 * 60e3 && can('move', 'edit') && !signed;
      const lc = U().locs(x, L); const where = x.t === 'in' ? LN(lc.to) : x.cust ? '<span class="d">' + esc(x.cust.name) + '</span>' : x.batch && x.t === 'out' ? LN(lc.from) : lc.from && lc.to ? routeTxt(lc.from, lc.to) : '';
      const what = x.t === 'done' ? `<b>${T('خلصت دفعة', 'Lot finished')} <span class="d">${esc(supName(x.sup))}</span> ${T('من', 'of')} <span class="d">${esc(nm(it))}</span></b>` : x.t === 'adj' ? `<b>${T('فرق جرد', 'Count variance')} <span class="d">${esc(nm(it))}</span> ${x.n > 0 ? '+' : '−'}${fmt(Math.abs(x.n))} ${uname(x.base)}</b><small>${T('طُبّق على أحدث دفعة · يُراجع', 'Applied to the newest lot · flagged')}</small>` : `<b class="d">${esc(nm(it))}</b><small>${(x.lines || []).map(l => fmt(l.n) + ' ' + uname(l.u)).join(' + ')}${where ? ' · ' + where : ''}${x.sup ? ' · <span class="d">' + esc(supName(x.sup)) + '</span>' : ''}${x.inv ? ' · ' + T('فاتورة', 'invoice') + ' <span class="d">' + esc(x.invNo || x.inv) + '</span>' : ''}${x.batch ? ' · ' + (x.t === 'trf' ? T('نقل تلقائي للتحميص', 'automatic transfer for roasting') : T('تحميص', 'roast')) : ''}${x.alloc && x.alloc.length > 1 ? ' · ' + T('من ' + x.alloc.length + ' دفعات', 'from ' + x.alloc.length + ' lots') : ''}${x.un ? ' · <span style="color:var(--warn)">' + T('بلا دفعة', 'no lot') + ' ' + fmt(x.un) + '</span>' : ''}${x.short ? ' · <span style="color:var(--warn)">' + T('نقص بالموقع', 'location short') + ' ' + fmt(x.short) + '</span>' : ''}${x.doc ? ' · <span dir="ltr">' + esc(x.doc) + '</span> ' + sgBadge(sigsOf(x.doc)) : ''}</small>`;
      return `<div class="cell"><span class="dm-ic ${x.t === 'trf' ? 'adj' : x.t}">${x.t === 'out' ? '−' : x.t === 'in' ? '+' : x.t === 'trf' ? '⇄' : x.t === 'done' ? '0' : '±'}</span><div class="t">${what}<small>${hm(x.at)} · <span class="d">${esc(x.by || '')}</span></small></div>${x.t === 'in' || x.t === 'out' || x.t === 'trf' ? `<div class="v"><b style="color:${x.t === 'out' ? 'var(--bad)' : x.t === 'in' ? 'var(--ok)' : '#0a6ccf'}">${x.t === 'out' ? '−' : x.t === 'in' ? '+' : ''}${fmt(x.tot)}</b><small>${uname(e.base || x.base)}</small></div>` : ''}${undo ? `<button class="lnk" data-mundo="${esc(x.id)}">${T('تراجع', 'Undo')}</button>` : ''}</div>`; }).join('');
    return (inline ? '' : `<h1>${T('سجل الحركات', 'Movement log')}</h1><p class="note">${T('حركات اليوم بوقتها واسم الموظف. التراجع خلال 5 دقائق لمن سجّلها.', 'Today’s movements with time and name. Undo within 5 minutes by the same person.')}</p>`) + (rows ? `<div class="grp">${rows}</div>` : `<p class="note">${T('لا حركات اليوم.', 'No movements today.')}</p>`);
  }
  /* ---------- الوحدات ---------- */
  function vUnits() {
    const edit = can('units', 'edit'); const units = C().units || {}; const q = M.uq.trim().toLowerCase();
    const P = (pend().items || []).filter(x => !x.linked);
    const CAT = [['all', T('الكل', 'All')], ['Green Coffee', T('بن أخضر', 'Green')], ['Roasted Coffee', T('محمّص', 'Roasted')], ['Packaging', T('تغليف', 'Packaging')], ['other', T('أخرى', 'Other')]];
    const L = (C().items || []).filter(i => M.ucat === 'all' || (M.ucat === 'other' ? !/Green Coffee|Roasted Coffee|Packaging/.test(i.c) : i.c === M.ucat)).filter(i => !q || i.en.toLowerCase().includes(q) || i.ar.includes(M.uq.trim()) || i.s.toLowerCase().includes(q)).slice(0, 40);
    const pendUi = P.length && edit ? `<div class="grp" style="border:1px solid #f3c6a9"><div class="pad" style="padding-bottom:4px"><b style="font-weight:600;color:var(--bad)">${T('أصناف مؤقتة: أضفها في فودكس ثم اربطها', 'Temporary items: add them in Foodics, then link')}<span class="dm-badge">${P.length}</span></b><small class="sub" style="display:block;margin:2px 0 0">${T('بعد تحديث قائمة فودكس تظهر هنا للربط؛ تنتقل حركاتها ودفعاتها للرمز الحقيقي.', 'After the Foodics list is refreshed, link each one here; its movements and lots move to the real SKU.')}</small></div>${P.map(p => `<div class="dm-link"><div class="t" style="flex:1;min-width:0"><b class="d" style="display:block">${esc(p.ar)}</b><small style="color:var(--ink2)"><span class="d">${esc(p.en)}</span> · ${esc(p.u)} · <span class="d">${esc(p.id)}</span>${p.sup ? ' · <span class="d">' + esc(p.sup) + '</span>' : ''}</small></div></div><div class="dm-link"><select data-mlsel="${esc(p.id)}"><option value="">${T('اختر رمز فودكس', 'Choose the Foodics SKU')}</option>${(C().items || []).filter(i => U().baseOf(i) === U().baseOf(p)).map(i => `<option value="${esc(i.s)}">${esc(nm(i))} · ${esc(i.s)}</option>`).join('')}</select><button class="btn k" data-mlink="${esc(p.id)}">${T('ربط', 'Link')}</button></div>`).join('')}</div>` : (P.length ? `<p class="note">${P.length} ${T('صنف مؤقت بانتظار فودكس', 'temporary item(s) waiting for Foodics')}</p>` : '');
    const row = it => { const e = units[it.s] || U().defaults(it); const free = U().KEYS.filter(k => !e.lad.some(x => x[0] === k) && k !== 'g');
      return `<div class="sec"><span class="d">${esc(nm(it))}</span> · <span class="d">${esc(it.s)}</span></div><div class="grp" data-msku="${esc(it.s)}">${e.lad.map((x, i) => { const nxt = e.lad[i + 1]; const isB = x[0] === e.base; const sub = i > e.lad.findIndex(y => y[0] === e.base);
        return `<div class="dm-lad"><span class="dm-ic ${isB ? 'in' : ''}" style="${isB ? '' : 'background:var(--acc)'}">${i + 1}</span><span class="n">${uname(x[0])}${isB ? `<small style="display:block;font-weight:400;color:var(--ok)">${T('الوحدة الأساسية (فودكس)', 'Base unit (Foodics)')}</small>` : ''}</span>
        ${isB ? '' : sub ? `<span class="eq">1 ${uname(e.base)} = <input data-mf="${i}" inputmode="decimal" value="${x[1] == null ? '' : fmt(Math.round(1 / x[1] * 1000) / 1000)}" placeholder="${T('غير محدد', 'Not set')}" ${edit ? '' : 'disabled'}> ${uname(x[0])}</span>` : `<span class="eq">= <input data-mf="${i}" inputmode="decimal" value="${x[1] == null ? '' : fmt(x[1])}" placeholder="${T('غير محدد', 'Not set')}" ${edit ? '' : 'disabled'}> ${nxt ? uname(nxt[0]) : ''}${x[1] == null ? `<small style="color:var(--warn)">${T('غير محدد: لا تُستخدم حتى تُملأ', 'Not set: unusable until filled')}</small>` : ''}</span>`}
        ${edit && !isB ? `<button class="x" data-mrm="${i}" aria-label="${T('حذف الوحدة', 'Remove unit')}">${ico('x', 18)}</button>` : ''}</div>`; }).join('')}
        ${edit ? `<div class="dm-addu"><select data-madd-sel><option value="">${T('أضف وحدة أكبر…', 'Add a larger unit…')}</option>${free.map(k => `<option value="${k}">${uname(k)}</option>`).join('')}</select><button class="btn k" data-madd>${T('أضف', 'Add')}</button></div>` : ''}
        <div class="dm-min"><span>${T('الحد الأدنى', 'Minimum')}</span><input data-mmin inputmode="decimal" value="${e.min == null ? '' : fmt(e.min)}" placeholder="—" ${edit ? '' : 'disabled'}><span>${uname(e.base)}${e.min == null ? ' · ' + T('غير محدد', 'not set') : ''}</span></div></div>`; };
    const log = (C().unitsLog || []).slice(0, 20);
    return `<h1>${T('مفاتيح الوحدات', 'Unit keys')}</h1><p class="note">${edit ? T('لكل صنف سلّم وحدات: الأكبر فالأصغر، وكل وحدة كم تساوي من اللي تحتها. الوحدة الأساسية هي وحدة فودكس ولا تتغير. كل تعديل يُسجَّل باسمك ووقته.', 'Each item has a unit ladder, largest to smallest, and how many of the next unit each holds. The base unit is the Foodics unit and never changes. Every change is logged with your name and time.') : T('عرض فقط: التعديل للمالك ولمن عنده صلاحية «الوحدات · تعديل».', 'View only: editing is for the owner and staff with the Units edit permission.')}</p>
    ${pendUi}
    <div class="search">${ico('search', 18)}<input id="muq" placeholder="${T('ابحث بالاسم أو الرمز', 'Search name or SKU')}" value="${esc(M.uq)}"></div>
    <div class="chips">${CAT.map(c => `<button data-mucat="${c[0]}" aria-pressed="${M.ucat === c[0]}">${c[1]}</button>`).join('')}</div>
    ${L.map(row).join('') || `<p class="note">${T('لا نتائج.', 'No results.')}</p>`}
    ${log.length ? `<div class="sec">${T('آخر التعديلات', 'Recent changes')}</div><div class="grp">${log.map(x => `<div class="cell"><div class="t"><b class="d" style="font-size:14px">${esc(x.sku)}</b><small><span class="d" dir="ltr">${esc(x.change)}</span></small><small><span class="d">${esc(x.by)}</span> · ${dTxt(x.at)} ${hm(x.at)}</small></div></div>`).join('')}</div>` : ''}`;
  }
  /* ---------- حفظ ---------- */
  const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.')); return isFinite(x) ? x : null; };
  async function saveUnits(sku, lad, min) {
    try { const r = await window.DALAPI('/staff/units', { method: 'POST', body: JSON.stringify({ sku, lad, min }) }); if (!r.ok) throw new Error(r.err === 'factor' ? T('العامل لازم يكون أكبر من صفر', 'The factor must be greater than zero') : r.err === 'sub' ? T('الوحدة الأصغر لازم عاملها معروف', 'A sub-unit needs a known factor') : r.err || 'err');
      C().units = r.items; C().unitsLog = r.log || []; window.DALTOAST(T('حُفظ', 'Saved')); rr(); } catch (e) { window.DALTOAST(T('تعذّر الحفظ: ', 'Could not save: ') + e.message); rr(); }
  }
  function ladFromDom(grp) { const sku = grp.getAttribute('data-msku'); const it = item(sku); const e = (C().units || {})[sku] || U().defaults(it); const bi = e.lad.findIndex(x => x[0] === e.base);
    const lad = e.lad.map((x, i) => { if (x[0] === e.base) return [x[0], 1]; const f = grp.querySelector(`[data-mf="${i}"]`); const v = f ? num(f.value) : x[1]; return [x[0], v == null ? null : (i > bi ? 1 / v : v)]; }); const mi = grp.querySelector('[data-mmin]'); return { sku, lad, min: mi ? num(mi.value) : e.min }; }
  async function saveMove() {
    const it = item(M.cur); const e = entry(it); const lines = M.lines.concat(M.q && +M.q > 0 ? [{ n: +M.q, u: M.unit }] : []); if (!lines.length) return;
    const inn = M.mode === 'in', dl = M.mode === 'dlv', tr = M.mode === 'trf'; const body = { op: 'add', t: inn ? 'in' : tr ? 'trf' : 'out', s: it.s, lines, note: ((document.getElementById('mnote') || {}).value || '').trim() };
    if (inn) { body.to = M.loc; if (!M.sup) { window.DALTOAST(T('اختر المورد', 'Choose the supplier')); return; } if (M.sup.new) { const n = ((document.getElementById('msupn') || {}).value || '').trim(); if (!n) { window.DALTOAST(T('اكتب اسم المورد', 'Enter the supplier name')); return; } body.sup = { new: 1, name: n }; } else body.sup = { id: M.sup.id }; if (M.inv) body.inv = M.inv.id; }
    else { const lots = lotsOf(it.s); if (consumes(it) && lots.length > 1) body.lot = M.lot || lots[0].id;
      if (tr) { const rt = route(it); body.from = rt[0]; body.to = rt[1]; }
      else { body.from = src(it); if (!M.cust) { window.DALTOAST(T('اختر العميل', 'Choose the customer')); return; } body.dest = 'cust'; if (M.cust.new) { const n = ((document.getElementById('mcustn') || {}).value || '').trim(); if (!n) { window.DALTOAST(T('اكتب اسم العميل', 'Enter the customer name')); return; } body.cust = { new: 1, name: n }; } else body.cust = { id: M.cust.id }; } }
    M.busy = true; rr();
    try { const r = await window.DALAPI('/staff/move', { method: 'POST', body: JSON.stringify(body) }); if (!r.ok) throw new Error(r.err === 'sup' ? T('المورد غير معروف', 'Unknown supplier') : r.err === 'lines' ? T('وحدة غير محددة', 'Unit not set') : r.err === 'cust' ? T('العميل غير معروف', 'Unknown customer') : r.err === 'route' ? T('مسار النقل غير مسموح', 'Transfer route not allowed') : r.err || 'err');
      D().moves = r.moves; if (r.docs_out) D().docs_out = r.docs_out; if (r.doc) M.lastDoc = { no: r.doc.no, kind: r.doc.kind, name: (r.rec.cust && r.rec.cust.name) || (r.rec.sup && r.rec.sup.name) || '', from: r.rec.from, to: r.rec.to }; if (r.pending) D().pending_items = r.pending; if (r.alerts) D().alerts_stock = r.alerts;
      const rec = r.rec; const cons = !inn && rec.alloc; let msg = (inn ? T('أُضيف ', 'Added ') : rec.cust ? T('سُلّم ', 'Delivered ') : T('نُقل ', 'Transferred ')) + fmt(rec.tot) + ' ' + uname(rec.base) + ' · ' + nm(it);
      if (inn) msg += ' · ' + LN(rec.to || 'wh'); else if (tr) msg += ' · ' + routeTxt(rec.from, rec.to); else if (rec.from) msg += ' · ' + T('من ', 'from ') + LN(rec.from);
      if (cons && rec.alloc.length > 1) msg += ' · ' + T('قُسّم على ' + rec.alloc.length + ' دفعات', 'split across ' + rec.alloc.length + ' lots'); if (cons && rec.un) msg += ' · ' + T('بلا دفعة: ', 'no lot: ') + fmt(rec.un); if (rec.short) msg += ' · ' + T('تنبيه: رصيد ', 'Warning: ') + LN(rec.from) + T(' لا يغطي النقل، النقص ', ' balance does not cover it, short ') + fmt(rec.short);
      (r.events || []).forEach(ev => { if (ev.t === 'done') msg += ' · ' + T('خلصت دفعة ', 'lot finished: ') + supName(ev.sup); }); if (rec.cust) msg += ' · ' + rec.cust.name; if (rec.doc) msg += ' · ' + rec.doc;
      window.DALTOAST(msg); const keepInv = M.inv; reset(); M.inv = keepInv; M.note = ''; if (r.doc && window.DALSIGN && r.doc.kind !== 'trf') { M.sign = { no: r.doc.no }; M.pads = {}; } /* النقل الداخلي روتيني: يبقى التوقيع على بُعد ضغطة من الشريط أو قائمة المستندات، لا يفتح لوحة التوقيع بعد كل صنف */ } catch (e) { window.DALTOAST(T('تعذّر الحفظ: ', 'Could not save: ') + e.message); }
    M.busy = false; rr();
  }
  async function undo(id) { try { const r = await window.DALAPI('/staff/move', { method: 'POST', body: JSON.stringify({ op: 'del', id }) }); if (!r.ok) throw new Error(r.err === 'late' ? T('مضى أكثر من 5 دقائق', 'More than 5 minutes have passed') : r.err === 'signed' ? T('السند موقّع، لا يمكن التراجع', 'The note is signed; it cannot be undone') : r.err === 'used' ? T('سُحب من هذه الدفعة، لا يمكن التراجع', 'This lot has been drawn from; it cannot be undone') : r.err || 'err'); D().moves = r.moves; if (r.alerts) D().alerts_stock = r.alerts; window.DALTOAST(T('تم التراجع', 'Undone')); } catch (e) { window.DALTOAST(T('تعذّر: ', 'Failed: ') + e.message); } rr(); }
  async function newSave() {
    const ar = (document.getElementById('mn-ar') || {}).value || '', en = (document.getElementById('mn-en') || {}).value || '', u = (document.getElementById('mn-u') || {}).value; const err = document.getElementById('mn-err');
    if (!ar.trim() && !en.trim()) { if (err) err.textContent = T('اكتب الاسم', 'Enter the name'); return; }
    M.busy = true; rr();
    try { const r = await window.DALAPI('/staff/pending', { method: 'POST', body: JSON.stringify({ op: 'add', ar: ar.trim(), en: en.trim(), u, sup: M.sup && !M.sup.new ? { id: M.sup.id, name: M.sup.name } : undefined }) }); if (!r.ok) throw new Error(r.err || 'err');
      D().pending_items = r.pending; M.newItem = null; M.cur = r.item.id; M.unit = null; M.q = ''; M.lines = []; M.mode = 'in'; M.src = null; window.DALTOAST(T('أُنشئ صنف مؤقت: ', 'Temporary item created: ') + r.item.id); } catch (e) { window.DALTOAST(T('تعذّر: ', 'Failed: ') + e.message); }
    M.busy = false; rr();
  }
  async function link(id, sku) { if (!sku) { window.DALTOAST(T('اختر رمز فودكس', 'Choose the Foodics SKU')); return; } try { const r = await window.DALAPI('/staff/pending', { method: 'POST', body: JSON.stringify({ op: 'link', id, sku }) }); if (!r.ok) throw new Error(r.err === 'unit' ? T('وحدة فودكس تختلف عن وحدة الصنف المؤقت', 'The Foodics unit differs from the temporary item’s unit') : r.err || 'err'); D().pending_items = r.pending; if (r.moves) D().moves = r.moves; window.DALTOAST(T('رُبط', 'Linked')); } catch (e) { window.DALTOAST(T('تعذّر: ', 'Failed: ') + e.message); } rr(); }
  M.open = function (sku) { const it = item(sku); if (!it) { window.DALTOAST(T('ملصق غير معروف: ', 'Unknown label: ') + sku); return; } M.cur = sku; M.unit = null; M.q = ''; M.lines = []; M.lot = null; if (M.mode === 'in' && M.inv && !M.sup) { const s = sups().find(x => x.name && M.inv.supplier && (x.name === M.inv.supplier || M.inv.supplier.includes(x.name))); if (s) M.sup = s; } rr(); window.scrollTo(0, 0); };
  M.unknown = function (txt) { if (M.mode !== 'in') { window.DALTOAST(T('ملصق غير معروف: ', 'Unknown label: ') + txt); return; } M.newItem = { hint: txt.replace(/^DAL:/i, '') }; rr(); };

  /* ---------- الأحداث ---------- */
  document.addEventListener('click', async e => {
    if (!e.target.closest) return; const root = e.target.closest('.dm'); if (!root) return;
    let b;
    if (b = e.target.closest('[data-ms]')) { M.seg = b.getAttribute('data-ms'); M.card = null; M.sign = null; M.pads = {}; rr(); return; }
    if (b = e.target.closest('[data-mroute]')) { const r = b.getAttribute('data-mroute').split('-'); M.route = U().routeOk(r[0], r[1]) ? r : null; M.lot = null; rr(); return; }
    if (b = e.target.closest('[data-msrc]')) { M.src = b.getAttribute('data-msrc'); rr(); return; }
    if (b = e.target.closest('[data-mloc]')) { M.loc = b.getAttribute('data-mloc') === 'rs' ? 'rs' : 'wh'; rr(); return; }
    if (b = e.target.closest('[data-mcust]')) { const id = b.getAttribute('data-mcust'); M.cust = id === '__new' ? { new: 1, name: '' } : custOf(id); rr(); return; }
    if (b = e.target.closest('[data-mscard]')) { M.card = { kind: 'sup', id: b.getAttribute('data-mscard') }; rr(); window.scrollTo(0, 0); return; }
    if (b = e.target.closest('[data-mccard]')) { M.card = { kind: 'cust', id: b.getAttribute('data-mccard') }; rr(); window.scrollTo(0, 0); return; }
    if (b = e.target.closest('[data-mdoc]')) { printDoc({ no: b.getAttribute('data-mdoc') }); return; }
    if (b = e.target.closest('[data-msign]')) { M.sign = { no: b.getAttribute('data-msign') }; M.pads = {}; M.card = null; rr(); window.scrollTo(0, 0); return; }
    if (e.target.closest('.ds')) return;   // أزرار لوحة التوقيع تُعالج داخل الوحدة نفسها
    if (b = e.target.closest('[data-dkback]')) { e.preventDefault(); M.card = null; rr(); return; }
    if (b = e.target.closest('[data-dk]')) { const a = b.getAttribute('data-dk'); if (a === 'sign') { M.sign = { no: b.dataset.no }; M.pads = {}; M.card = null; rr(); window.scrollTo(0, 0); return; } if (a === 'doc') { const d = b.dataset; if (d.no) printDoc({ no: d.no }); else if (d.kind === 'mov') printDoc({ kind: 'mov', params: { from: d.from || '', to: d.to || '', sup: d.sup || undefined, supName: d.supname || undefined, cust: d.cust || undefined, custName: d.custname || undefined, loc: d.loc || undefined } }); else printDoc({ kind: d.kind, params: { move: d.move } }); } else if (a === 'dalcard') { M.card = { kind: 'dal', id: 'dal' }; rr(); window.scrollTo(0, 0); } return; }
    if (b = e.target.closest('[data-mm]')) { M.mode = b.getAttribute('data-mm'); M.lines = []; M.q = ''; M.lot = null; M.src = null; M.cust = null; rr(); return; }
    if (b = e.target.closest('[data-mopen]')) { M.q = ''; M.open(b.getAttribute('data-mopen')); return; }
    if (b = e.target.closest('[data-mun]')) { if (b.disabled) return; M.unit = b.getAttribute('data-mun'); rr(); return; }
    if (b = e.target.closest('[data-mlot]')) { M.lot = b.getAttribute('data-mlot'); rr(); return; }
    if (b = e.target.closest('[data-msup]')) { const id = b.getAttribute('data-msup'); M.sup = id === '__new' ? { new: 1, name: '' } : sups().find(x => x.id === id); rr(); return; }
    if (b = e.target.closest('[data-mk]')) { const k = b.getAttribute('data-mk'); if (k === '⌫') M.q = M.q.slice(0, -1); else if (k === '.') { if (!M.q.includes('.')) M.q += M.q ? '.' : '0.'; } else if (M.q.length < 8) M.q += k; rr(); return; }
    if (b = e.target.closest('[data-mdel]')) { M.lines.splice(+b.getAttribute('data-mdel'), 1); rr(); return; }
    if (b = e.target.closest('[data-mundo]')) { undo(b.getAttribute('data-mundo')); return; }
    if (b = e.target.closest('[data-minv]')) { const x = (((D().invoices || {}).items) || []).find(i => i.id === b.getAttribute('data-minv')); M.inv = x ? { id: x.id, supplier: x.supplier, invoice_no: x.invoice_no, items: x.items } : null; M.pick = null; rr(); return; }
    if (b = e.target.closest('[data-mucat]')) { M.ucat = b.getAttribute('data-mucat'); rr(); return; }
    if (b = e.target.closest('[data-mrm]')) { const g = b.closest('[data-msku]'); const L = ladFromDom(g); L.lad.splice(+b.getAttribute('data-mrm'), 1); saveUnits(L.sku, L.lad, L.min); return; }
    if (b = e.target.closest('[data-madd]')) { const g = b.closest('[data-msku]'); const sel = g.querySelector('[data-madd-sel]'); if (!sel.value) return; const L = ladFromDom(g); L.lad.unshift([sel.value, null]); saveUnits(L.sku, L.lad, L.min); return; }
    if (b = e.target.closest('[data-mlink]')) { const id = b.getAttribute('data-mlink'); const sel = root.querySelector(`[data-mlsel="${id}"]`); link(id, sel && sel.value); return; }
    b = e.target.closest('[data-ma]'); if (!b) return; const a = b.getAttribute('data-ma');
    if (a === 'scan') { C().scanFor(M.open); const run = C().scan; if (run) run.unknown = M.unknown; }
    else if (a === 'change') { reset(); rr(); }
    else if (a === 'addline') { if (M.q && +M.q > 0 && M.unit) { M.lines.push({ n: +M.q, u: M.unit }); M.q = ''; } rr(); }
    else if (a === 'save') saveMove();
    else if (a === 'inv') { M.pick = M.pick === 'inv' ? null : 'inv'; rr(); }
    else if (a === 'invx') { M.inv = null; rr(); }
    else if (a === 'newitem') { M.newItem = { hint: M.q.trim() }; M.mode = 'in'; rr(); }
    else if (a === 'newx') { M.newItem = null; rr(); }
    else if (a === 'newsave') newSave();
    else if (a === 'tmplabel') { const it = item(M.cur); if (it) C().labels(false, [it]); }
    else if (a === 'docx') { M.lastDoc = null; rr(); }
    else if (a === 'signsave') signSave();
    else if (a === 'signx') { M.sign = null; M.pads = {}; rr(); }
    else if (a === 'printscreen') window.print();
    else if (a === 'movpdf') { const v = id => (document.getElementById(id) || {}).value || ''; M.df = { from: v('mdf-from'), to: v('mdf-to'), item: v('mdf-item'), sup: v('mdf-sup'), cust: v('mdf-cust'), loc: v('mdf-loc') }; const sp = sups().find(x => x.id === M.df.sup); const cu = custOf(M.df.cust); printDoc({ kind: 'mov', params: { from: M.df.from, to: M.df.to, item: M.df.item || undefined, sup: M.df.sup || undefined, supName: sp ? sp.name : undefined, cust: M.df.cust || undefined, custName: cu ? cu.name : undefined, loc: M.df.loc || undefined } }); }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'mq') { M.q = e.target.value; clearTimeout(M.qt); M.qt = setTimeout(() => { const pos = e.target.selectionStart; rr(); const n = document.getElementById('mq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); }
    if (e.target.id === 'muq') { M.uq = e.target.value; clearTimeout(M.qt); M.qt = setTimeout(() => { const pos = e.target.selectionStart; rr(); const n = document.getElementById('muq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); }
    if (e.target.id === 'mnote') M.note = e.target.value; if (e.target.id === 'msupn' && M.sup) M.sup.name = e.target.value; if (e.target.id === 'mcustn' && M.cust) M.cust.name = e.target.value;
    if (e.target.id === 'mcq') { M.cq = e.target.value; clearTimeout(M.qt); M.qt = setTimeout(() => { const pos = e.target.selectionStart; rr(); const n = document.getElementById('mcq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); }
  });
  document.addEventListener('change', e => { const g = e.target.closest && e.target.closest('[data-msku]'); if (g && (e.target.hasAttribute('data-mf') || e.target.hasAttribute('data-mmin')) && can('units', 'edit')) { const L = ladFromDom(g); saveUnits(L.sku, L.lad, L.min); } });
})();
