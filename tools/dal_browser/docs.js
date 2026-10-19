/* مستندات دال المطبوعة (PDF): سجل الحركة، سند الاستلام، سند التسليم، سند النقل الداخلي.
   ترقيم متسلسل في live/docs_out (REC-2026-0001 / DLV-2026-0001 / MOV-2026-0001 / TRF-2026-0001) ويُعاد طبع أي مستند من بياناته المحفوظة بالرقم نفسه.
   التاريخ ميلادي بتوقيت الرياض مع اسم اليوم بالعربي أو الإنجليزي. الخط IBM Plex Sans Arabic مضمّن من مجلد fonts (لا اعتماد على خطوط النظام).
   لا أسعار ولا مبالغ في أي مستند: الكميات ووحداتها فقط. */
'use strict';
const fs = require('fs'), path = require('path');
const DALU = require('./units-core');
const WD = { ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
const MN = { ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'], en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] };
const KSA = 3 * 3600e3;
// {date:'18 أكتوبر 2026', day:'الأحد', time:'14:05', iso:'2026-10-18', full:'الأحد 18 أكتوبر 2026'} بتوقيت الرياض
function fmtDay(at, lang) {
  const L = lang === 'en' ? 'en' : 'ar'; const t = at ? new Date(at) : new Date(); if (isNaN(t)) return { date: String(at || ''), day: '', time: '', iso: '', full: String(at || '') };
  const d = new Date(t.getTime() + KSA); const iso = d.toISOString().slice(0, 10);
  const date = d.getUTCDate() + ' ' + MN[L][d.getUTCMonth()] + ' ' + d.getUTCFullYear(); const day = WD[L][d.getUTCDay()];
  return { date, day, time: d.toISOString().slice(11, 16), iso, full: day + ' ' + date };
}
const dayIso = at => new Date(new Date(at).getTime() + KSA).toISOString().slice(0, 10);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = v => v == null || v === '' || isNaN(+v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });
// حذف أي مبلغ من نص حر (وصف أصناف الفاتورة، وصف طلب): «5,000 ريال» / «SAR 120» / «ر.س 80.5» → «—». النص يُعرض للموظف وفي السندات
const AMT = /(?:\b(?:SAR|SR)\s*\d[\d,.]*|\d[\d,.]*\s*(?:SAR|SR|ريالاً|ريالات|ريال|ر\.س|هللات|هلل[ةه])(?![A-Za-zء-يٮ-ۓ])|(?:ريال|ر\.س)\s*\d[\d,.]*)/gi;   // \b لا يعمل مع العربية: حدّ الكلمة بنظرة أمامية على الحروف فقط (الفاصلة العربية ليست حرفًا)
const scrubAmounts = s => s == null ? s : String(s).replace(AMT, '—');
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = { rec: ['REC', 'سند استلام', 'Receipt note'], dlv: ['DLV', 'سند تسليم', 'Delivery note'], mov: ['MOV', 'سجل الحركة', 'Movement log'], trf: ['TRF', 'سند نقل داخلي', 'Internal transfer note'], xrc: ['XRC', 'سند استلام بن عميل', 'Customer coffee receipt'], xdl: ['XDL', 'سند تسليم بن محمّص', 'Roasted coffee delivery note'] };
const locName = (k, lang) => DALU.locName(k, lang === 'en');
// الرقم التالي: يعدّل doc في مكانه ويرجع الرقم
function docNext(doc, kind, at) {
  const K = KINDS[kind]; if (!K) throw new Error('kind'); const y = dayIso(at || new Date().toISOString()).slice(0, 4); const key = K[0] + '-' + y;
  doc.seq = doc.seq || {}; const n = (doc.seq[key] || 0) + 1; doc.seq[key] = n; return key + '-' + String(n).padStart(4, '0');
}
const DOCS_CAP = 2000;
// معاملات كل نوع مستند كما تُحفظ في الفهرس: حقول معروفة، نصوص قصيرة، لا شيء آخر من طلب العميل
const PARAMS = { mov: ['from', 'to', 'item', 'sup', 'supName', 'cust', 'custName', 'loc'], rec: ['move', 'inv'], dlv: ['move', 'moves'], trf: ['move'], xrc: ['x'], xdl: ['x'] };
function pickParams(kind, p) { const out = {}; p = p && typeof p === 'object' ? p : {}; for (const k of PARAMS[kind] || []) { const v = p[k]; if (v == null || v === '') continue; out[k] = k === 'moves' ? (Array.isArray(v) ? v.slice(0, 50).map(x => String(x).slice(0, 40)) : []) : String(v).slice(0, 80); } return out; }
// يضيف مستندًا للفهرس: {no, kind, at, by, params, ref, title}
function docAdd(doc, kind, params, who, at, ref) {
  const st = Object.assign({ seq: {}, items: [] }, doc || {}); st.seq = Object.assign({}, st.seq); st.items = (st.items || []).slice();
  const no = docNext(st, kind, at); const it = { no, kind, at, by: who, params: params || {}, ref: ref || {} }; st.items.unshift(it); st.items = st.items.slice(0, DOCS_CAP); st.at = at; return { st, item: it };
}
/* ---------- بناء بيانات المستند من المستندات الحية ---------- */
function nameOf(s, items, pend, lang) { const it = (items || []).find(i => i.s === s); if (it) return lang === 'en' ? it.en : it.ar; const p = pend && (pend.items || []).find(x => x.id === s); if (p) return (lang === 'en' ? p.en : p.ar) + (lang === 'en' ? ' (temporary)' : ' (مؤقت)'); return s; }
const uname = (k, lang) => DALU.name(k, lang === 'en');
const linesTxt = (rec, lang) => (rec.lines || []).map(l => num(l.n) + ' ' + uname(l.u, lang)).join(' + ');
const supName = (s, lang) => !s ? '' : (s.id === 'dal' && lang === 'en' ? 'Dal (in-house)' : s.id === 'roast' && lang === 'en' ? 'Dal roasting' : (s.name || s.id));
function typeOf(x, lang) { const en = lang === 'en'; if (x.t === 'in') return x.batch ? (en ? 'Roasting' : 'تحميص') : (en ? 'Add' : 'إضافة'); if (x.t === 'trf') return x.batch ? (en ? 'Auto transfer' : 'نقل تلقائي') : (en ? 'Transfer' : 'نقل'); if (x.t === 'out') return x.cust ? (en ? 'Delivery' : 'تسليم') : x.batch ? (en ? 'Roasting' : 'تحميص') : (en ? 'Transfer' : 'نقل'); if (x.t === 'done') return en ? 'Lot finished' : 'خلصت دفعة'; if (x.t === 'adj') return en ? 'Count variance' : 'فرق جرد'; return x.t; }
// سجل الحركة: من/إلى (YYYY-MM-DD بتوقيت الرياض) + فلتر صنف/مورد/عميل/موقع اختياري (loc: wh|rs|cafe — الحركة التي مصدرها أو وجهتها ذلك الموقع)
function buildMov(params, D, lang) {
  const list = ((D.moves || {}).list) || []; const from = String(params.from || '').slice(0, 10), to = String(params.to || '').slice(0, 10);
  if ((from && !ISO_DAY.test(from)) || (to && !ISO_DAY.test(to)) || (from && to && from > to)) throw new Error('params');   // التاريخان YYYY-MM-DD ومن ≤ إلى
  const loc = String(params.loc || ''); if (loc && !DALU.isLoc(loc)) throw new Error('params');
  const rows = list.filter(x => { const d = dayIso(x.at); if (from && d < from) return false; if (to && d > to) return false;
    if (params.item && x.s !== params.item) return false;
    if (loc) { const l = DALU.locs(x, list); if (l.from !== loc && l.to !== loc) return false; }
    if (params.sup && !((x.sup && x.sup.id === params.sup) || (x.alloc || []).some(a => { const l = list.find(y => y.id === a.lot); return l && l.sup && l.sup.id === params.sup; }))) return false;
    if (params.cust && !(x.cust && (x.cust.id === params.cust || x.cust.name === params.cust))) return false; return true; }).sort((a, b) => a.at.localeCompare(b.at));
  const lotOf = id => list.find(y => y.id === id);
  return { kind: 'mov', from, to, filter: { item: params.item ? nameOf(params.item, D.items, D.pending_items, lang) : '', sup: params.supName || '', cust: params.custName || '', loc: loc ? locName(loc, lang) : '' }, n: rows.length,
    rows: rows.map(x => { const f = fmtDay(x.at, lang); const L = DALU.locs(x, list); const who = x.t === 'out' && x.cust ? x.cust.name : x.t === 'in' ? supName(x.sup, lang) : x.t === 'done' ? supName(x.sup, lang) : (x.alloc || []).map(a => { const l = lotOf(a.lot); return l ? supName(l.sup, lang) : a.lot; }).filter((v, i, A) => A.indexOf(v) === i).join('، ');
      return { date: f.date, day: f.day, time: f.time, type: typeOf(x, lang), t: x.t, item: nameOf(x.s, D.items, D.pending_items, lang), lines: x.t === 'adj' ? (x.n > 0 ? '+' : '−') + num(Math.abs(x.n)) + ' ' + uname(x.base, lang) : linesTxt(x, lang), tot: x.t === 'in' || x.t === 'out' || x.t === 'trf' ? (x.t === 'out' ? '−' : x.t === 'trf' ? '' : '+') + num(x.tot) + ' ' + uname(x.base, lang) : '', from: L.from ? locName(L.from, lang) : '', to: L.to ? locName(L.to, lang) : (x.cust ? (lang === 'en' ? 'Customer' : 'عميل') : ''), who, by: x.by || '', inv: x.invNo || x.inv || '', doc: x.doc || '' }; }) };
}
// سند نقل داخلي: حركة نقل واحدة {move} — trf (مستودع ↔ محمصة) أو سحب إلى المقهى
function buildTrf(params, D, lang) {
  const list = ((D.moves || {}).list) || []; const m = params.move && list.find(x => x.id === params.move && DALU.isTrf(x)); if (!m) throw new Error('nf');
  const f = fmtDay(m.at, lang); const L = DALU.locs(m, list); const lotOf = id => list.find(y => y.id === id);
  const lots = (m.alloc || []).map(a => { const l = lotOf(a.lot); return l ? (l.batch ? (lang === 'en' ? 'roasted ' : 'تحميص ') : supName(l.sup, lang) + ' ') + fmtDay(l.at, lang).date + ' · ' + num(a.n) : a.lot; });
  return { kind: 'trf', at: m.at, date: f.date, day: f.day, time: f.time, from: L.from, to: L.to, fromName: locName(L.from, lang), toName: locName(L.to, lang), by: m.by || '', note: m.note || '', auto: !!m.batch, short: m.short ? num(m.short) : '',
    items: [{ item: nameOf(m.s, D.items, D.pending_items, lang), sku: m.s, lines: linesTxt(m, lang), tot: num(m.tot) + ' ' + uname(m.base, lang), lots: lots.join(' / '), un: m.un ? num(m.un) : '' }] };
}
// سند استلام: دفعة واحدة {move} أو كل دفعات فاتورة {inv}
function buildRec(params, D, lang) {
  const list = ((D.moves || {}).list) || []; let recs = [], inv = null;
  if (params.move) { const m = list.find(x => x.id === params.move && x.t === 'in'); if (!m) throw new Error('nf'); recs = [m]; if (m.inv) inv = (((D.invoices || {}).items) || []).find(i => i.id === m.inv) || null; }
  else if (params.inv) { inv = (((D.invoices || {}).items) || []).find(i => i.id === params.inv) || null; recs = list.filter(x => x.t === 'in' && x.inv === params.inv).sort((a, b) => a.at.localeCompare(b.at)); if (!recs.length && !inv) throw new Error('nf'); }
  else throw new Error('params');
  const first = recs[0]; const at = first ? first.at : (inv && (inv.at || inv.date)) || new Date().toISOString(); const f = fmtDay(at, lang);
  return { kind: 'rec', at, date: f.date, day: f.day, time: f.time, supplier: first ? supName(first.sup, lang) : (inv && inv.supplier) || '', pending: !!(first && first.sup && first.sup.pending),
    invoice: inv ? { no: inv.invoice_no || '', date: inv.date ? fmtDay(inv.date + 'T12:00:00Z', lang).date : '', items: scrubAmounts(inv.items || '') } : (first && first.inv ? { no: first.invNo || first.inv, date: '', items: '' } : null),
    by: first ? first.by : '', items: recs.map(m => ({ item: nameOf(m.s, D.items, D.pending_items, lang), sku: m.s, lines: linesTxt(m, lang), tot: num(m.tot) + ' ' + uname(m.base, lang), lot: m.id, note: m.note || '' })) };
}
// سند تسليم: حركة سحب واحدة لعميل {move} أو عدة {moves:[...]}
function buildDlv(params, D, lang) {
  const list = ((D.moves || {}).list) || []; const ids = params.moves || (params.move ? [params.move] : []); const recs = ids.map(id => list.find(x => x.id === id && x.t === 'out' && x.cust)).filter(Boolean);
  if (!recs.length) throw new Error('nf'); const first = recs[0]; const f = fmtDay(first.at, lang); const cu = first.cust || {};
  const lotOf = id => list.find(y => y.id === id);
  return { kind: 'dlv', at: first.at, date: f.date, day: f.day, time: f.time, customer: cu.name || '', custType: cu.type || '', pending: !!cu.pending, by: first.by || '', note: first.note || '',
    items: recs.map(m => { const it = (D.items || []).find(i => i.s === m.s); const lots = (m.alloc || []).map(a => { const l = lotOf(a.lot); return l ? (l.batch ? (lang === 'en' ? 'roasted ' : 'تحميص ') : supName(l.sup, lang) + ' ') + fmtDay(l.at, lang).date + ' · ' + num(a.n) : a.lot; });
      return { item: nameOf(m.s, D.items, D.pending_items, lang), origin: it ? (lang === 'en' ? it.en : it.ar) : m.s, cat: it ? it.c : '', lines: linesTxt(m, lang), tot: num(m.tot) + ' ' + uname(m.base, lang), lots: lots.join(' / '), un: m.un ? num(m.un) : '' }; }) };
}
// سندا تحميص العملاء: استلام بن أخضر من العميل (xrc) أو تسليم محمّص له (xdl) — سجل واحد {x} من live/roast_ext، مع رصيده بعد الحركة (بلا أسعار أبداً)
function buildX(kind, params, D, lang) {
  const XR = require('./xroast'); const doc = XR.normalize(D.roast_ext || {}); const x = params.x && doc.list.find(y => y.id === params.x && y.t === (kind === 'xrc' ? 'in' : 'out')); if (!x) throw new Error('nf');
  const f = fmtDay(x.at, lang); const upTo = Object.assign({}, doc, { list: doc.list.filter(y => y.at <= x.at) }); const B = XR.balances(upTo, x.cust.id); const F = (B && B.coffees[x.coffee]) || { green: 0, roasted: 0 };
  return { kind, at: x.at, date: f.date, day: f.day, time: f.time, customer: x.cust.name, coffee: x.coffee, kg: num(kind === 'xrc' ? x.g : x.kg), packs: kind === 'xrc' ? (x.sacks ? num(x.sacks) : '') : (x.bags ? num(x.bags) : ''), by: x.by || '', note: x.n || '', over: x.over ? num(x.over) : '', green: num(F.green), roasted: num(F.roasted) };
}
function build(kind, params, D, lang) { if (kind === 'mov') return buildMov(params, D, lang); if (kind === 'rec') return buildRec(params, D, lang); if (kind === 'dlv') return buildDlv(params, D, lang); if (kind === 'trf') return buildTrf(params, D, lang); if (kind === 'xrc' || kind === 'xdl') return buildX(kind, params, D, lang); throw new Error('kind'); }
/* ---------- التوقيع الإلكتروني ----------
   يُحفظ على سجل المستند في live/docs_out: sigs:[{role, name, png (base64 بلا بادئة), at, by, ua, hash}] حيث hash = sha256(docNo + role + name + at + png).
   الأدوار: سند استلام rcv «المستلم (دال)» و sup «مندوب المورد»؛ سند تسليم dlv «المسلّم (دال)» و cust «المستلم (العميل)»؛ سند نقل داخلي snd «المسلّم» و rcv «المستلم»؛ appr «اعتماد» للمالك فقط على أي مستند.
   دور الموظف «الخاص» بكل نوع (rec: rcv، dlv: dlv، trf: snd) يحمل اسم حساب الدخول دائمًا؛ الدور الآخر يُكتب اسمه (الطرف المقابل على جوال الموظف).
   توقيع واحد لكل دور؛ بعده يُقفل الدور، ويُقفل محتوى المستند (لا تراجع عن حركته).
   التخزين: الفهرس مقسّم بالسنة live/docs_out_<YYYY> (سقف 2000 سجل لكل سنة، يُهيَّأ أول مرة من الفهرس القديم live/docs_out الذي يبقى للقراءة المتوافقة)،
   وصور التواقيع خارج الفهرس في live/sigs_<YYYY> مفهرسة برقم المستند ثم الدور {png, ua}؛ الفهرس يحمل {role, name, at, by, hash, sigRef} فقط.
   عند أول توقيع يُجمَّد محتوى المستند المعروض (snap بالعربي والإنجليزي) ويُطبع منه دائمًا، فربط صنف مؤقت برمز فودكس لاحقًا لا يغيّر مستندًا موقّعًا. */
const LEGACY = 'live/docs_out';
const docsPath = y => 'live/docs_out_' + y, sigsPath = y => 'live/sigs_' + y;
const yearOfNo = no => (String(no || '').match(/^[A-Z]{3}-(\d{4})-/) || [])[1] || null;
const yearOfAt = at => dayIso(at || new Date().toISOString()).slice(0, 4);
// تهيئة فهرس سنة من الفهرس القديم: سجلات تلك السنة وتسلسلها (حتى لا يتكرر رقم بعد التقسيم)
function docsSeed(legacy, year) { const L = legacy || {}; const seq = {}; for (const [k, v] of Object.entries(L.seq || {})) if (k.endsWith('-' + year)) seq[k] = v; return { seq, items: (L.items || []).filter(x => yearOfNo(x.no) === String(year)), at: L.at }; }
// القراءة المتوافقة: سجلات فهرس السنة ثم ما في الفهرس القديم ولم يُنقل (بالرقم)، الأحدث أولًا
function docsMerge(st, legacy) { const seen = new Set(((st && st.items) || []).map(x => x.no)); return ((st && st.items) || []).concat(((legacy && legacy.items) || []).filter(x => !seen.has(x.no))).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))); }
const docsFind = (st, legacy, no) => ((st && st.items) || []).find(x => x.no === no) || ((legacy && legacy.items) || []).find(x => x.no === no) || null;
const crypto = require('crypto');
const SIG_ROLES = { rec: ['rcv', 'sup', 'appr'], dlv: ['dlv', 'cust', 'appr'], trf: ['snd', 'rcv', 'appr'], mov: ['appr'], xrc: ['rcv', 'cust', 'appr'], xdl: ['dlv', 'cust', 'appr'] }, OWNER_ROLES = ['appr'], OWN_ROLE = { rec: 'rcv', dlv: 'dlv', trf: 'snd', xrc: 'rcv', xdl: 'dlv' }, STAFF_ROLES = ['rcv', 'dlv', 'snd'];   // دور الموظف نفسه لكل نوع: الاسم من حساب الدخول دائمًا، لا من الطلب
const SIG_LABEL = { rcv: ['المستلم (دال)', 'Received by (Dal)'], sup: ['مندوب المورد', 'Supplier representative'], dlv: ['المسلّم (دال)', 'Delivered by (Dal)'], cust: ['المستلم (العميل)', 'Received by (customer)'], snd: ['المسلّم', 'Handed over by'], appr: ['اعتماد المالك', 'Owner approval'] };
const TRF_LABEL = { rcv: ['المستلم', 'Received by'] };   // في سند النقل «المستلم» موظف دال في الموقع الآخر، لا «(دال)» ولا عميل
const XRC_LABEL = { cust: ['مندوب العميل (المسلّم)', 'Customer representative (handed over)'] };   // في استلام بن العميل: العميل هو المسلّم
const sigLabel = (role, lang, kind) => ((kind === 'trf' && TRF_LABEL[role]) || (kind === 'xrc' && XRC_LABEL[role]) || SIG_LABEL[role] || [role, role])[lang === 'en' ? 1 : 0];
const PNG_MAX = 40 * 1024;   // طول سلسلة data URL كاملة
// يتحقق من صورة التوقيع: data:image/png;base64 صالحة ≤ 40 كيلوبايت وترويسة PNG حقيقية؛ يرجع base64 بلا بادئة
function sigPng(v) {
  const s = String(v || ''); if (s.length > PNG_MAX) throw new Error('png'); const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(s); if (!m || m[1].length < 40 || m[1].length % 4) throw new Error('png');
  const head = Buffer.from(m[1].slice(0, 16), 'base64'); if (head.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('png'); return m[1];
}
const sigHash = (no, role, name, at, png) => crypto.createHash('sha256').update(no + role + name + at + png).digest('hex');
const sigOf = (item, role) => (item && item.sigs || []).find(s => s.role === role) || null;
const isSigned = (docs, no) => !!(docs && (docs.items || []).find(x => x.no === no && x.sigs && x.sigs.length));
// يضيف توقيعًا: يرجع {st, item, sig} أو يرمي nf | role | forbidden | dup | png | name. who: اسم الموقّع الحسابي (للسجل)، by: معرّف الدخول، owner: صلاحية المالك
function sigAdd(docs, no, j, who, by, ua, now, owner) {
  const st = Object.assign({ seq: {}, items: [] }, docs || {}); st.items = (st.items || []).slice(); const i = st.items.findIndex(x => x.no === String(no || '')); if (i < 0) throw new Error('nf');
  const it = st.items[i]; const role = String(j.role || ''); if (!(SIG_ROLES[it.kind] || []).includes(role)) throw new Error('role'); if (OWNER_ROLES.includes(role) && !owner) throw new Error('forbidden');
  if (sigOf(it, role)) throw new Error('dup'); const png = sigPng(j.png); const name = String(OWN_ROLE[it.kind] === role || j.name == null ? who : j.name).trim().slice(0, 80); if (!name) throw new Error('name');
  const y = yearOfNo(it.no) || yearOfAt(it.at); const entry = { role, name, at: now, by: String(by || '').slice(0, 40), hash: sigHash(it.no, role, name, now, png), sigRef: sigsPath(y).slice(5) + ':' + it.no + ':' + role };
  const sig = Object.assign({}, entry, { png, ua: String(ua || '').replace(/\s+/g, ' ').slice(0, 80) });
  st.items[i] = Object.assign({}, it, { sigs: (it.sigs || []).concat([entry]) }); st.at = now; return { st, item: st.items[i], sig, year: y };
}
// مخزن الصور: {at, items: {docNo: {role: {png, ua}}}} ؛ يضيف صورة توقيع ويرجع المستند الجديد
function sigsPut(sdoc, no, sig, now) { const st = Object.assign({ items: {} }, sdoc || {}); st.items = Object.assign({}, st.items); st.items[no] = Object.assign({}, st.items[no] || {}, { [sig.role]: { png: sig.png, ua: sig.ua } }); st.at = now; return st; }
// يدمج صور التواقيع من المخزن في سجل المستند (للطباعة ولعرض المالك)
function sigMerge(item, sdoc) { if (!item || !item.sigs || !item.sigs.length) return item; const m = (sdoc && sdoc.items && sdoc.items[item.no]) || {}; return Object.assign({}, item, { sigs: item.sigs.map(s => { const x = m[s.role]; return x ? Object.assign({}, s, { png: x.png, ua: x.ua }) : s; }) }); }
// تجميد المحتوى عند أول توقيع: نسخة معروضة بالعربي والإنجليزية من بيانات المستند كما هي الآن
function snapOf(item, D) { return { ar: build(item.kind, item.params, D, 'ar'), en: build(item.kind, item.params, D, 'en'), at: new Date().toISOString() }; }
const docData = (item, D, lang) => (item.snap && item.snap[lang === 'en' ? 'en' : 'ar']) || build(item.kind, item.params, D, lang);
// نسخة الموظف من سجل المستند: بيانات التواقيع بلا صور إلا توقيعه هو (by = معرّف دخوله)
function sigStrip(item, byId) { if (!item || !item.sigs) return item; const o = Object.assign({}, item, { sigs: item.sigs.map(s => s.by === byId && s.png ? s : { role: s.role, name: s.name, at: s.at, by: s.by, hash: s.hash }) }); delete o.snap; return o; }
function sigVerify(no, s) { return !!(s && s.hash === sigHash(no, s.role, s.name, s.at, s.png)); }
/* ---------- قالب HTML (A4) ---------- */
let FONT_CSS = null;
function fontCss() {
  if (FONT_CSS != null) return FONT_CSS; const dir = path.join(__dirname, 'fonts'); const face = (file, w, range) => { try { const b = fs.readFileSync(path.join(dir, file)).toString('base64'); return `@font-face{font-family:'Plex';font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b}) format('woff2');unicode-range:${range}}`; } catch (e) { return ''; } };
  const AR = 'U+0600-06FF,U+0750-077F,U+0870-08FF,U+200C-200E,U+2010-2011,U+FB50-FDFF,U+FE70-FEFC', LA = 'U+0000-00FF,U+2000-206F,U+20AC,U+2212';
  FONT_CSS = face('plex-ar-400.woff2', 400, AR) + face('plex-latin-400.woff2', 400, LA) + face('plex-ar-600.woff2', 600, AR) + face('plex-latin-600.woff2', 600, LA); return FONT_CSS;
}
const L = (lang, ar, en) => lang === 'en' ? en : ar;
function html(doc, meta, lang) {
  const en = lang === 'en'; const K = KINDS[doc.kind]; const title = en ? K[2] : K[1]; const gen = fmtDay(meta.printedAt || new Date().toISOString(), lang);
  const head = `<!doctype html><html lang="${en ? 'en' : 'ar'}" dir="${en ? 'ltr' : 'rtl'}"><head><meta charset="utf-8"><title>${esc(meta.no || title)}</title><style>${fontCss()}
  @page{size:A4${doc.kind === 'mov' ? ' landscape' : ''};margin:14mm 12mm 16mm}*{box-sizing:border-box}html,body{margin:0;font-family:'Plex',system-ui,sans-serif;color:#1d1d1f;font-size:11.5pt;line-height:1.55}
  .hd{display:flex;align-items:center;gap:14px;border-bottom:1.5px solid #1d1d1f;padding-bottom:10px;margin-bottom:12px}.hd img{width:46px;height:46px;border-radius:10px}.hd .t{flex:1}.hd h1{font-size:19pt;margin:0;font-weight:600}.hd .s{color:#6e6e73;font-size:10pt}
  .no{text-align:${en ? 'right' : 'left'};font-variant-numeric:tabular-nums}.no b{display:block;font-size:14pt;direction:ltr;unicode-bidi:embed}.no small{color:#6e6e73;font-size:9.5pt;display:block}
  .kv{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;margin:8px 0 12px;font-size:10.5pt}.kv div{display:flex;gap:8px;border-bottom:1px solid #e5e5ea;padding:4px 0}.kv span{color:#6e6e73;min-width:96px}.kv b{font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:10pt;margin:6px 0 10px}th{text-align:start;font-weight:600;color:#6e6e73;border-bottom:1.5px solid #1d1d1f;padding:5px 6px;font-size:9.5pt}td{border-bottom:1px solid #e5e5ea;padding:5px 6px;vertical-align:top}tr{page-break-inside:avoid}
  td.n{font-variant-numeric:tabular-nums;white-space:nowrap}td.n .mut{white-space:normal}.out{color:#d70015}.in{color:#248a3d}.mut{color:#6e6e73}
  .sig{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:28px;page-break-inside:avoid}.sig.c3{grid-template-columns:1fr 1fr 1fr;gap:16px}.sig.c1{grid-template-columns:1fr 1fr}.sig>div{border-top:1px solid #1d1d1f;padding-top:6px;font-size:10pt;color:#6e6e73}.sig b{display:block;color:#1d1d1f;font-weight:600;margin-bottom:26px}
  .sig .sg b{margin-bottom:4px}.sig .sg img{display:block;max-height:58px;max-width:100%;margin:2px 0 4px}.sig .sn{color:#1d1d1f;font-weight:600;font-size:10.5pt}.sig .sd{font-size:9pt}.sig .sh{font-size:8.5pt;direction:ltr;unicode-bidi:embed;text-align:${en ? 'left' : 'right'};font-family:ui-monospace,Menlo,monospace;color:#8e8e93}.sig .sv{display:inline-block;font-size:8.5pt;color:#248a3d;border:1px solid #248a3d;border-radius:5px;padding:0 5px;margin-top:3px}
  .ft{position:fixed;bottom:0;inset-inline:0;font-size:8.5pt;color:#6e6e73;border-top:1px solid #e5e5ea;padding-top:4px}.ft .r{display:flex;justify-content:space-between}.ft .sgl{font-weight:600;color:#1d1d1f;margin-bottom:2px}.warn{background:#fff4e0;color:#9a5b00;border-radius:8px;padding:6px 10px;font-size:10pt;margin:6px 0}
  .empty{color:#6e6e73;padding:18px 0;text-align:center}
  </style></head><body>`;
  const logo = meta.logo ? `<img src="${meta.logo}" alt="">` : '';
  const hd = `<div class="hd">${logo}<div class="t"><h1>${esc(title)}</h1><div class="s">${L(lang, 'محمصة دال', 'Dal Coffee Roasters')}</div></div><div class="no"><b>${esc(meta.no || '')}</b><small>${esc(L(lang, 'تاريخ المستند', 'Document date'))}: ${esc(doc.day ? doc.day + ' ' + doc.date : gen.full)}</small></div></div>`;
  const sigs = Array.isArray(meta.sigs) ? meta.sigs : []; const sg = role => sigs.find(s => s.role === role);
  const ft = `<div class="ft">${sigs.length ? `<div class="sgl">${esc(L(lang, 'موقّع إلكترونياً عبر تطبيق دال', 'Signed electronically via the Dal app'))} · <span dir="ltr">${esc(meta.no || '')}</span></div>` : ''}<div class="r"><span>${esc(meta.no || '')} · ${esc(L(lang, 'طُبع', 'Printed'))} ${esc(gen.full)} ${gen.time}${meta.by ? ' · ' + esc(meta.by) : ''}${meta.reprint ? ' · ' + esc(L(lang, 'إعادة طباعة', 'Reprint')) : ''}</span><span>${esc(L(lang, 'الكميات بوحداتها، بلا أسعار', 'Quantities in their units, no prices'))}</span></div></div>`;
  // صندوق توقيع: موقّع (صورة + اسم + يوم/تاريخ/وقت الرياض + أول 10 من البصمة) أو فارغ (الاسم والتوقيع)
  const sigBox = (role, blank) => { const s = sg(role); const label = sigLabel(role, lang, doc.kind); if (!s) return `<div><b>${esc(label)}</b>${esc(blank || L(lang, 'الاسم والتوقيع', 'Name and signature'))}</div>`;
    const f = fmtDay(s.at, lang); return `<div class="sg"><b>${esc(label)}</b><img src="data:image/png;base64,${esc(s.png)}" alt=""><div class="sn">${esc(s.name)}</div><div class="sd">${esc(f.full)} · ${f.time}</div><div class="sh">${esc(String(s.hash || '').slice(0, 10))}</div><span class="sv">${esc(L(lang, 'موقّع إلكترونياً', 'Signed electronically'))}</span></div>`; };
  const sigGrid = roles => { const R = roles.concat(sg('appr') && !roles.includes('appr') ? ['appr'] : []); return `<div class="sig ${R.length === 3 ? 'c3' : R.length === 1 ? 'c1' : ''}">${R.map(r => sigBox(r)).join('')}</div>`; };
  let body = '';
  if (doc.kind === 'mov') {
    const per = (doc.from || doc.to) ? (doc.from ? fmtDay(doc.from + 'T12:00:00Z', lang).full : '…') + ' → ' + (doc.to ? fmtDay(doc.to + 'T12:00:00Z', lang).full : '…') : L(lang, 'كل الحركات', 'All movements');
    body = `<div class="kv"><div><span>${L(lang, 'الفترة', 'Period')}</span><b>${esc(per)}</b></div><div><span>${L(lang, 'عدد الحركات', 'Movements')}</span><b>${doc.n}</b></div>${doc.filter.item ? `<div><span>${L(lang, 'الصنف', 'Item')}</span><b>${esc(doc.filter.item)}</b></div>` : ''}${doc.filter.sup ? `<div><span>${L(lang, 'المورد', 'Supplier')}</span><b>${esc(doc.filter.sup)}</b></div>` : ''}${doc.filter.cust ? `<div><span>${L(lang, 'العميل', 'Customer')}</span><b>${esc(doc.filter.cust)}</b></div>` : ''}${doc.filter.loc ? `<div><span>${L(lang, 'الموقع', 'Location')}</span><b>${esc(doc.filter.loc)}</b></div>` : ''}</div>` +
      (doc.rows.length ? `<table><thead><tr><th>${L(lang, 'التاريخ', 'Date')}</th><th>${L(lang, 'اليوم', 'Day')}</th><th>${L(lang, 'الوقت', 'Time')}</th><th>${L(lang, 'النوع', 'Type')}</th><th>${L(lang, 'الصنف', 'Item')}</th><th>${L(lang, 'الأسطر', 'Lines')}</th><th>${L(lang, 'الإجمالي', 'Total')}</th><th>${L(lang, 'من', 'From')}</th><th>${L(lang, 'إلى', 'To')}</th><th>${L(lang, 'الدفعة / المورد / العميل', 'Lot / supplier / customer')}</th><th>${L(lang, 'الموظف', 'Staff')}</th></tr></thead><tbody>${doc.rows.map(r => `<tr><td class="n">${esc(r.date)}</td><td>${esc(r.day)}</td><td class="n">${esc(r.time)}</td><td class="${r.t === 'out' ? 'out' : r.t === 'in' ? 'in' : 'mut'}">${esc(r.type)}</td><td>${esc(r.item)}</td><td class="n">${esc(r.lines)}</td><td class="n ${r.t}">${esc(r.tot)}</td><td>${esc(r.from || '—')}</td><td>${esc(r.to || '—')}</td><td>${esc(r.who)}${r.inv ? ` <span class="mut">${L(lang, 'فاتورة', 'inv.')} ${esc(r.inv)}</span>` : ''}${r.doc ? `<div class="mut" dir="ltr" style="text-align:${en ? 'left' : 'right'}">${esc(r.doc)}</div>` : ''}</td><td>${esc(r.by)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${L(lang, 'لا حركات في هذه الفترة.', 'No movements in this period.')}</div>`) + sigGrid(['appr']);
  } else if (doc.kind === 'rec') {
    body = `<div class="kv"><div><span>${L(lang, 'المورد', 'Supplier')}</span><b>${esc(doc.supplier)}${doc.pending ? ' <span class="mut">(' + L(lang, 'مورد جديد بانتظار الاعتماد', 'new supplier, pending approval') + ')</span>' : ''}</b></div><div><span>${L(lang, 'تاريخ الاستلام', 'Received on')}</span><b>${esc(doc.day + ' ' + doc.date)} · ${doc.time}</b></div>` +
      (doc.invoice ? `<div><span>${L(lang, 'مرجع الفاتورة', 'Invoice ref.')}</span><b dir="ltr">${esc(doc.invoice.no || '—')}</b></div><div><span>${L(lang, 'تاريخ الفاتورة', 'Invoice date')}</span><b>${esc(doc.invoice.date || '—')}</b></div>` : `<div><span>${L(lang, 'مرجع الفاتورة', 'Invoice ref.')}</span><b>—</b></div>`) + `<div><span>${L(lang, 'استلمه', 'Received by')}</span><b>${esc(doc.by)}</b></div></div>` +
      (doc.items.length ? `<table><thead><tr><th>#</th><th>${L(lang, 'الصنف', 'Item')}</th><th>${L(lang, 'الكمية بوحداتها', 'Quantity in units')}</th><th>${L(lang, 'الإجمالي بالوحدة الأساسية', 'Total in base unit')}</th><th>${L(lang, 'رقم الدفعة', 'Lot id')}</th></tr></thead><tbody>${doc.items.map((it, i) => `<tr><td class="n">${i + 1}</td><td>${esc(it.item)}<div class="mut" dir="ltr">DAL:${esc(it.sku)}</div>${it.note ? `<div class="mut">${esc(it.note)}</div>` : ''}</td><td class="n">${esc(it.lines)}</td><td class="n in">${esc(it.tot)}</td><td class="n mut">${esc(it.lot)}</td></tr>`).join('')}</tbody></table>` : `<div class="warn">${L(lang, 'لم تُسجَّل أصناف مستلمة لهذه الفاتورة بعد في تطبيق الفريق.', 'No received items have been recorded for this invoice yet.')}</div>`) +
      (doc.invoice && doc.invoice.items ? `<div class="mut" style="font-size:9.5pt">${L(lang, 'وصف الأصناف في الفاتورة', 'Items as described on the invoice')}: ${esc(doc.invoice.items)}</div>` : '') +
      sigGrid(['rcv', 'sup']);
  } else if (doc.kind === 'dlv') {
    body = `<div class="kv"><div><span>${L(lang, 'العميل', 'Customer')}</span><b>${esc(doc.customer)}${doc.pending ? ' <span class="mut">(' + L(lang, 'عميل جديد', 'new customer') + ')</span>' : ''}</b></div><div><span>${L(lang, 'تاريخ التسليم', 'Delivered on')}</span><b>${esc(doc.day + ' ' + doc.date)} · ${doc.time}</b></div><div><span>${L(lang, 'سلّمه', 'Delivered by')}</span><b>${esc(doc.by)}</b></div>${doc.note ? `<div><span>${L(lang, 'ملاحظة', 'Note')}</span><b>${esc(doc.note)}</b></div>` : ''}</div>` +
      `<table><thead><tr><th>#</th><th>${L(lang, 'المحصول / الصنف', 'Origin / item')}</th><th>${L(lang, 'الكمية', 'Quantity')}</th><th>${L(lang, 'الإجمالي', 'Total')}</th><th>${L(lang, 'الدفعة', 'Lot / batch')}</th></tr></thead><tbody>${doc.items.map((it, i) => `<tr><td class="n">${i + 1}</td><td>${esc(it.item)}</td><td class="n">${esc(it.lines)}</td><td class="n out">${esc(it.tot)}</td><td class="n mut">${esc(it.lots || '—')}${it.un ? ' · ' + L(lang, 'بلا دفعة', 'no lot') + ' ' + esc(it.un) : ''}</td></tr>`).join('')}</tbody></table>` +
      sigGrid(['dlv', 'cust']);
  } else if (doc.kind === 'trf') {
    body = `<div class="kv"><div><span>${L(lang, 'من', 'From')}</span><b>${esc(doc.fromName)}</b></div><div><span>${L(lang, 'إلى', 'To')}</span><b>${esc(doc.toName)}</b></div><div><span>${L(lang, 'تاريخ النقل', 'Transferred on')}</span><b>${esc(doc.day + ' ' + doc.date)} · ${doc.time}</b></div><div><span>${L(lang, 'سجّله', 'Recorded by')}</span><b>${esc(doc.by)}</b></div>${doc.note ? `<div><span>${L(lang, 'ملاحظة', 'Note')}</span><b>${esc(doc.note)}</b></div>` : ''}${doc.auto ? `<div><span>${L(lang, 'النوع', 'Type')}</span><b>${L(lang, 'نقل تلقائي للتحميص', 'Automatic transfer for roasting')}</b></div>` : ''}</div>` +
      `<table><thead><tr><th>#</th><th>${L(lang, 'الصنف', 'Item')}</th><th>${L(lang, 'الكمية بوحداتها', 'Quantity in units')}</th><th>${L(lang, 'الإجمالي بالوحدة الأساسية', 'Total in base unit')}</th><th>${L(lang, 'الدفعة', 'Lot / batch')}</th></tr></thead><tbody>${doc.items.map((it, i) => `<tr><td class="n">${i + 1}</td><td>${esc(it.item)}<div class="mut" dir="ltr">DAL:${esc(it.sku)}</div></td><td class="n">${esc(it.lines)}</td><td class="n">${esc(it.tot)}</td><td class="n mut">${esc(it.lots || '—')}${it.un ? ' · ' + L(lang, 'بلا دفعة', 'no lot') + ' ' + esc(it.un) : ''}</td></tr>`).join('')}</tbody></table>` +
      (doc.short ? `<div class="warn">${L(lang, 'رصيد الموقع المصدر لم يغطِّ الكمية، النقص: ', 'The source location did not cover the quantity; shortfall: ')}${esc(doc.short)}</div>` : '') +
      sigGrid(['snd', 'rcv']);
  } else if (doc.kind === 'xrc' || doc.kind === 'xdl') {
    const rc = doc.kind === 'xrc';
    body = `<div class="kv"><div><span>${L(lang, 'العميل', 'Customer')}</span><b>${esc(doc.customer)}</b></div><div><span>${rc ? L(lang, 'تاريخ الاستلام', 'Received on') : L(lang, 'تاريخ التسليم', 'Delivered on')}</span><b>${esc(doc.day + ' ' + doc.date)} · ${doc.time}</b></div><div><span>${L(lang, 'المحصول', 'Coffee')}</span><b>${esc(doc.coffee)}</b></div><div><span>${rc ? L(lang, 'استلمه', 'Received by') : L(lang, 'سلّمه', 'Delivered by')}</span><b>${esc(doc.by)}</b></div>${doc.note ? `<div><span>${L(lang, 'ملاحظة', 'Note')}</span><b>${esc(doc.note)}</b></div>` : ''}</div>` +
      `<table><thead><tr><th>#</th><th>${L(lang, 'البيان', 'Description')}</th><th>${L(lang, 'الوزن (كجم)', 'Weight (kg)')}</th><th>${rc ? L(lang, 'عدد الخيش', 'Sacks') : L(lang, 'عدد الأكياس', 'Bags')}</th></tr></thead><tbody><tr><td class="n">1</td><td>${rc ? L(lang, 'بن أخضر من العميل للتحميص', 'Green coffee from the customer, for roasting') : L(lang, 'بن محمّص من بن العميل نفسه', "Roasted coffee from the customer's own beans")} · ${esc(doc.coffee)}</td><td class="n ${rc ? 'in' : 'out'}">${esc(doc.kg)}</td><td class="n">${esc(doc.packs || '—')}</td></tr></tbody></table>` +
      `<div class="kv"><div><span>${L(lang, 'أخضر للعميل عندنا بعد هذه الحركة', 'Customer green held by us after this')}</span><b>${esc(doc.green)} ${L(lang, 'كجم', 'kg')}</b></div><div><span>${L(lang, 'محمّص جاهز له عندنا بعدها', 'Roasted ready for them after this')}</span><b>${esc(doc.roasted)} ${L(lang, 'كجم', 'kg')}</b></div></div>` +
      (doc.over ? `<div class="warn">${rc ? '' : L(lang, 'الكمية المسلّمة أكثر من المحمّص المسجّل له بـ ', 'Delivered quantity exceeds the roasted coffee recorded for them by ') + esc(doc.over) + ' ' + L(lang, 'كجم', 'kg')}</div>` : '') +
      `<p class="mut" style="font-size:9.5pt">${L(lang, 'بن العميل لا يختلط ببن دال ولا يدخل في مخزونها. الأوزان بالكيلو كما وُزنت عند الاستلام/التسليم.', "The customer's coffee is kept apart from Dal's own stock. Weights in kg as weighed at handover.")}</p>` +
      sigGrid(rc ? ['rcv', 'cust'] : ['dlv', 'cust']);
  }
  return head + hd + body + ft + '</body></html>';
}
/* ---------- تحويل HTML إلى PDF: متصفح كروميوم مقفول (headless) يُفتح عند الحاجة ويُغلق بعد دقيقة خمول ---------- */
let PB = null, pbTimer = null, pbLaunching = null;
async function browser() {
  if (PB) return PB; if (pbLaunching) return pbLaunching;
  pbLaunching = (async () => { const { chromium } = require('playwright'); const o = { headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'] }; if (process.env.PDF_CHROME) o.executablePath = process.env.PDF_CHROME; PB = await chromium.launch(o); PB.on('disconnected', () => { PB = null; }); return PB; })().finally(() => { pbLaunching = null; });
  return pbLaunching;
}
async function renderPdf(htmlStr) {
  const b = await browser(); const p = await b.newPage(); try { await p.setContent(htmlStr, { waitUntil: 'load' }); await p.evaluate(() => document.fonts ? document.fonts.ready : null); const pdf = await p.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }); return pdf; }
  finally { await p.close().catch(() => {}); clearTimeout(pbTimer); pbTimer = setTimeout(() => { if (PB) { PB.close().catch(() => {}); PB = null; } }, 60e3); }
}
async function closeBrowser() { clearTimeout(pbTimer); if (PB) { await PB.close().catch(() => {}); PB = null; } }
module.exports = { fmtDay, dayIso, KINDS, docNext, docAdd, build, html, renderPdf, closeBrowser, typeOf, scrubAmounts, pickParams, SIG_ROLES, OWNER_ROLES, OWN_ROLE, STAFF_ROLES, sigLabel, sigPng, sigHash, sigAdd, sigStrip, sigOf, isSigned, sigVerify, PNG_MAX, LEGACY, docsPath, sigsPath, yearOfNo, yearOfAt, docsSeed, docsMerge, docsFind, sigsPut, sigMerge, snapOf, docData };
