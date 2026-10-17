/* مهام لحظية بدل «متابعة دال كل ساعة» (قراءة فقط، لا ترسل أي رسالة لأي أحد):
   1) قروب «DAL & SLOW»  → بطاقات خيش جديدة في live/slow (src «wa» فقط، لا تلمس بطاقات ضيف الله).
   2) قروب «Roasting Tracking» → طلبات/احتياجات/أخضر/تحميص في live/rt.
   3) حالة الردود الجاهزة في live/inbox: ردّ ضيف الله → sent، ردّ الطرف الآخر بعدها → followup.
   4) تذكيرات المواعيد → live/daily (open + notified) مرة واحدة لكل تذكير في يومه.
   الاستخراج من القروبات بـ Claude بمخرجات JSON صارمة؛ أي بند بلا دليل نصي من الرسائل يُرفض. */
'use strict';
const E = process.env;
const MODEL = E.JOBS_MODEL || E.MODEL || 'claude-sonnet-5-5', AKEY = E.ANTHROPIC_API_KEY;
const SLOW_GROUP = E.SLOW_GROUP || 'DAL & SLOW', RT_GROUP = E.RT_GROUP || 'Roasting Tracking';
const WAIT = (+E.GROUP_WAIT_SEC || 90) * 1000;
let lastErr = '', runs = { slow: 0, rt: 0, inbox: 0, remind: 0 };
const timers = {};

const ksa = (d = new Date()) => new Date(d.getTime() + 3 * 3600e3);          // توقيت الرياض بلا مكتبات
const ymd = d => ksa(d).toISOString().slice(0, 10);
const stamp = t => ksa(new Date(t)).toISOString().slice(0, 16).replace(/\D/g, '');   // YYYYMMDDHHmm
const AR_M = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const arDate = d => { const k = ksa(d); return k.getUTCDate() + ' ' + AR_M[k.getUTCMonth()]; };

async function claude(system, user) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': AKEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, system, messages: [{ role: 'user', content: user }] }),
  });
  const j = await r.json(); if (!r.ok) throw new Error('claude ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  const raw = (j.content || []).map(c => c.text || '').join('');
  return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
}

let STAFF = {}; try { STAFF = JSON.parse(E.STAFF_JSON || '{}'); } catch (e) {}
const SESSION = E.WAHA_SESSION || 'default';
const digitsOf = s => String(s || '').replace(/\D/g, '');
const isDal = n => /dal|دال|hesab|حساب|lofan|لوفان|roast|تحميص|مشتريات|مورد/i.test(String(n)) || (E.DAL_GROUPS || '').split(',').map(x => x.trim()).includes(String(n));   // قروبات المحمصة فقط (لا المنتديات العامة)
// ملخص ملف قُرئ (من سجل ملفات القروبات) يدخل في سياق القراءة بدل «📷 صورة»
const gfTxt = g => g ? ` [ملف مقروء: ${g.type} — ${g.title}: ${g.summary}${g.amount != null ? ' | المبلغ ' + g.amount : ''}${g.to ? ' | المستفيد ' + g.to : ''}${g.ref ? ' | المرجع ' + g.ref : ''}]` : '';
function setup({ gas, getBuf, push = async () => {}, waha = null }) {
  const get = async p => { const r = await gas({ op: 'get', paths: ['live/' + p] }); return ((r.docs || {})['live/' + p] || {}).data; };
  const set = (p, data) => gas({ op: 'set', path: 'live/' + p, data });
  const groupMsgs = name => getBuf().filter(m => m.g && m.chat === name).sort((a, b) => a.t - b.t);
  const conv = ms => ms.map(m => `[${m.id}] ${ymd(new Date(m.t))} ${ksa(new Date(m.t)).toISOString().slice(11, 16)} ${m.from}: ${m.x}${gfTxt(m.gf)}${m.q ? ' (ردًا على: ' + m.q + ')' : ''}`).join('\n');

  // ---------- 1) سلو ----------
  const SYS_SLOW = `تقرأ رسائل قروب واتساب «DAL & SLOW». سلو تُحضر خيش بن أخضر لمحمصة دال لتحميصه.
المطلوب فقط: الخيش الجديد الذي وصل/سُلِّم للمحمصة (مثل «تم تسليم 4 خيش اثيوبي بوكو»).
لكل رسالة فيها وصول خيش أعد بنداً واحداً: {"mid":"معرّف الرسالة بين القوسين","n":عدد الخيش,"o":"المحصول بالعربية كما ذُكر","g":الوزن بالكيلو إن ذُكر صراحة وإلا null,"from":"المرسل","quote":"نص الرسالة حرفياً"}
وأي شيء آخر مهم (تحميص، تسليم محمّص بوزن، تحويل أو دفع، جدولة) ضعه في notes: {"mid":"…","t":"سطر قصير بما ظهر"}.
لا تخترع أرقاماً أو محاصيل. إن لم يوجد شيء فأعد قوائم فارغة. أعد JSON فقط: {"arrivals":[],"notes":[]}`;
  async function runSlow() {
    const ms = groupMsgs(SLOW_GROUP).filter(m => !m.me || /خيش|تسليم/.test(m.x)); if (!ms.length || !AKEY) return;
    const out = await claude(SYS_SLOW, conv(ms.slice(-40)));
    const byId = new Map(ms.map(m => [m.id, m]));
    const doc = (await get('slow')) || { cards: [], price: null };
    doc.cards = doc.cards || []; let added = 0;
    for (const a of out.arrivals || []) {
      const m = byId.get(a.mid); if (!m || !a.quote || !m.x.includes(String(a.quote).slice(0, 12))) continue;   // دليل نصي إلزامي
      const n = Math.max(1, Math.min(20, parseInt(a.n, 10) || 1)), base = 'wa-' + stamp(m.t);
      if (doc.cards.some(c => String(c.id).startsWith(base))) continue;                                          // لا تكرار لنفس الرسالة
      for (let i = 1; i <= n; i++) {
        const g = a.g && +a.g > 0 && +a.g < 100 ? +a.g : 60;
        doc.cards.push({ id: base + '-' + i, d: ymd(new Date(m.t)), o: String(a.o || 'غير محدد'), g, r: null, b: null, gas: 0, st: 'in', paid: null, src: 'wa',
          note: `وصلت ${arDate(new Date(m.t))} (رسالة ${m.from}).` + (a.g ? '' : ' الوزن 60 كجم افتراضي — عدّله') });
        added++;
      }
    }
    if (added) { doc.updated = new Date().toISOString(); await set('slow', doc); }
    await addDaily((out.notes || []).filter(x => byId.has(x.mid)).map(x => ({ src: 'سلو', t: String(x.t).slice(0, 200), s: hm(byId.get(x.mid).t), lv: 'info', k: 'slow:' + x.mid }))
      .concat(added ? [{ src: 'سلو', t: `وصل ${added} خيش جديد — أُضيف في صفحة سلو`, s: hm(Date.now()), lv: 'warn', k: 'slowadd:' + Date.now() }] : []));
    runs.slow++;
  }

  // ---------- 2) التحميص ----------
  const SYS_RT = `تقرأ رسائل قروب واتساب «Roasting Tracking» لمحمصة دال (ضيف الله، هريرا، والحمّاص).
استخرج فقط ما ذُكر صراحة، كل بند مع mid (معرّف الرسالة بين القوسين):
- orders: طلبات تحميص لعملاء آخرين {"mid","name","phone":"أرقام فقط أو فارغ","kg":رقم أو null,"bean","price":رقم أو null,"st":"in|roast|out","note"}
- needs: احتياجات المحمصة (أكياس، كراتين، صيانة، استكرات…) {"mid","item","qty","who","note","done":true/false}
- green: بن أخضر وصل لدال {"mid","origin","kg":رقم أو null,"from","note"}
- roasts: جدول التحميص وسجلاته {"mid","origin","g":رقم أو null,"r":رقم أو null,"done":true/false,"note"}
- updates: تحديث لبند سابق (تم التحميص، تم التسليم، وصلت) {"ref":"وصف قصير للبند","st":"roast|out" أو "done":true,"mid"}
ممنوع ذكر أي مبالغ نقدية للحمّاص، وممنوع أرقام هوية أو حسابات أو IBAN. لا تخترع. أعد JSON فقط: {"orders":[],"needs":[],"green":[],"roasts":[],"updates":[]}`;
  async function runRt() {
    const ms = groupMsgs(RT_GROUP); if (!ms.length || !AKEY) return;
    const doc = (await get('rt')) || {};
    for (const k of ['orders', 'needs', 'green', 'roasts']) doc[k] = doc[k] || [];
    const recent = ms.slice(-50);
    const out = await claude(SYS_RT, 'البنود الموجودة حالياً (لا تكررها):\n' + JSON.stringify({ orders: doc.orders.slice(-15), needs: doc.needs.slice(-15) }) + '\n\nالرسائل:\n' + conv(recent));
    const byId = new Map(recent.map(m => [m.id, m])); let n = 0;
    const put = (k, pre, x) => {
      const m = byId.get(x.mid); if (!m) return; const id = pre + stamp(m.t) + '-' + (doc[k].filter(y => String(y.id).startsWith(pre + stamp(m.t))).length + 1);
      if (doc[k].some(y => y.mid === x.mid && JSON.stringify(y).includes(String(x.item || x.name || x.origin || '')))) return;
      const it = Object.assign({}, x, { id, mid: x.mid, d: ymd(new Date(m.t)) }); delete it.quote; doc[k].push(it); n++;
    };
    (out.orders || []).forEach(x => put('orders', 'o', x)); (out.needs || []).forEach(x => put('needs', 'n', x));
    (out.green || []).forEach(x => put('green', 'g', x)); (out.roasts || []).forEach(x => put('roasts', 'r', x));
    const ups = (out.updates || []).filter(u => byId.has(u.mid));
    if (n || ups.length) { doc.at = new Date().toISOString(); await set('rt', doc); }
    await addDaily((out.orders || []).filter(x => byId.has(x.mid)).map(x => ({ src: 'التحميص', t: `طلب تحميص: ${x.name || ''} ${x.kg ? x.kg + ' كجم' : ''} ${x.bean || ''}`.trim(), s: hm(byId.get(x.mid).t), lv: 'warn', k: 'rt:' + x.mid }))
      .concat(ups.map(u => ({ src: 'التحميص', t: 'تحديث: ' + String(u.ref).slice(0, 150) + (u.st ? ' → ' + ({ roast: 'في المحمصة', out: 'سُلّم' }[u.st] || u.st) : u.done ? ' → تم' : ''), s: hm(byId.get(u.mid).t), lv: 'info', k: 'rtu:' + u.mid }))));
    runs.rt++;
  }

  // ---------- 2ب) بقية القروبات (التشغيل، حساب، الموردون...): ما يحتاج قرار ضيف الله + أحداث اليوم ----------
  const SYS_G = `تقرأ رسائل قروب واتساب يخص محمصة دال (صاحبها ضيف الله). المطلوب:
- open: ما يحتاج تصرّفًا أو قرارًا من ضيف الله تحديدًا (اعتماد، دفع، رد مطلوب منه، موافقة، مستند يطلبه أحد منه). {"mid":"معرّف الرسالة","t":"سطر واحد: من يطلب وماذا، بالأرقام إن ذُكرت","lv":"bad إن كان عاجلًا أو فيه موعد قريب وإلا warn"}
- items: أحداث جديرة بالذكر في القروب (تم تسليم، أُرسل ملف مهم، تم دفع، مشكلة تشغيل) {"mid":"…","t":"سطر قصير: من وماذا"}
قواعد: لا تخترع. ما لم يُذكر صراحة لا يُكتب. تجاهل التحيات والملصقات والصور بلا سياق. لا تذكر أي مبالغ نقدية للحمّاص. لا أرقام هوية أو حسابات بنكية.
ما بين [ملف مقروء: …] هو محتوى ملف أُرسل في القروب وقد قُرئ فعلًا؛ اعتمد عليه. الملفات نفسها مسجّلة تلقائيًا في سجل الملفات، فلا تضع في items «أُرسل ملف» إلا إن كان فيه حدث مهم.
ما كتبه ضيف الله نفسه ليس «مطلوبًا منه». أعد JSON فقط: {"open":[],"items":[]}`;
  const gLast = {};   // آخر معرّف عولج لكل قروب حتى لا نعيد قراءة الرسائل نفسها
  async function runGroup(name) {
    const all = groupMsgs(name); if (!all.length || !AKEY) return;
    const idx = gLast[name] ? all.findIndex(m => m.id === gLast[name]) : -1;
    const fresh = all.slice(idx + 1).filter(m => !m.me && (idx >= 0 || m.t > Date.now() - 2 * 3600e3));   // بعد إعادة التشغيل: آخر ساعتين فقط
    if (!fresh.length) { gLast[name] = all[all.length - 1].id; return; }
    const ctx = all.slice(Math.max(0, idx + 1 - 10));   // سياق قصير قبل الجديد
    const out = await claude(SYS_G, 'القروب: ' + name + '\nالرسائل الجديدة هي ذوات المعرّفات: ' + fresh.map(m => m.id).join(', ') + '\n\n' + conv(ctx));
    gLast[name] = all[all.length - 1].id;
    const byId = new Map(fresh.map(m => [m.id, m]));
    const opens = (out.open || []).filter(x => byId.has(x.mid)).map(x => ({ t: `${name}: ${String(x.t).slice(0, 200)}`, who: 'ضيف الله', since: arDate(new Date(byId.get(x.mid).t)), lv: x.lv === 'bad' ? 'bad' : 'warn', k: 'wao:' + x.mid }));
    await addOpen(opens);
    await addDaily((out.items || []).filter(x => byId.has(x.mid)).map(x => ({ src: 'واتساب', t: `${name}: ${String(x.t).slice(0, 200)}`, s: hm(byId.get(x.mid).t), lv: 'info', k: 'wa:' + x.mid })));
    runs.groups = (runs.groups || 0) + 1;
  }
  let openBusy = Promise.resolve();
  function addOpen(list) {   // بنود «ينتظر تصرّفًا» بلا تكرار (بالمفتاح k)، مع إشعار
    if (!list.length) return Promise.resolve();
    openBusy = openBusy.then(async () => {
      const d = (await get('daily')) || {}; d.open = d.open || [];
      const keys = new Set(d.open.map(x => x.k).filter(Boolean)); const fresh = list.filter(x => !keys.has(x.k)); if (!fresh.length) return;
      d.open = fresh.concat(d.open).slice(0, 80); d.at = new Date().toISOString(); await set('daily', d);
      for (const x of fresh) push({ title: 'يحتاج قرارك', msg: x.t, lv: x.lv, tag: 'pushpin' });
    }).catch(e => { lastErr = 'open ' + e.message; });
    return openBusy;
  }

  // ---------- 2ج) سجل العملاء التفصيلي (live/customers): طلبات وتحويلات وحقائق كل عميل من محادثته الخاصة ----------
  const SYS_C = `تقرأ محادثة واتساب خاصة بين محمصة دال (ضيف الله) وشخص. المطلوب تحديث سجل هذا الشخص كعميل.
أعد JSON فقط:
{"customer":true|false, "name":"اسمه إن ظهر وإلا فارغ", "type":"cafe|person|shop|unk", "city":"إن ذُكرت وإلا فارغ",
 "orders":[{"mid":"معرّف الرسالة","what":"ماذا طلب","kg":رقم أو null,"amount":رقم أو null,"st":"طلب|مؤكد|سُلّم"}],
 "transfers":[{"mid":"…","amount":رقم}],
 "asks":[{"mid":"…","text":"ما سأله أو طلبه باختصار"}],
 "facts":["حقيقة قصيرة مؤكدة من المحادثة"]}
customer=true فقط إذا كان يشتري أو يسأل عن بن/منتج/سعر/طلب/تحميص/كود خصم. المتقدم لوظيفة أو المورد أو الموظف أو الإعلانات: customer=false.
لا تخترع. ما لم يُذكر صراحة لا يُكتب. type بلا دليل = unk. لا أرقام هوية أو حسابات أو IBAN. اعتمد فقط على الرسائل الجديدة (معرّفاتها مذكورة) وخذ القديم كسياق.`;
  async function history(ph, n) {
    if (!waha || !ph) return [];
    try { const ms = await waha(`/api/${SESSION}/chats/${encodeURIComponent(ph + '@c.us')}/messages?limit=${n || 20}&downloadMedia=false`);
      return (Array.isArray(ms) ? ms : []).map(m => ({ id: String(m.id && (m.id._serialized || m.id) || ''), t: (+m.timestamp || 0) * 1000, me: !!m.fromMe, ph, from: m.fromMe ? 'أنت' : ph, x: String(m.body || '').trim() || (m.hasMedia ? '📎 مرفق' : '') })).filter(m => m.id && m.x); }
    catch (e) { return []; }
  }
  const supPhones = async () => { try { const d = await get('suppliers'); const set = new Set(); for (const sp of (d && d.list) || []) { if (sp.phone) set.add(digitsOf(sp.phone)); for (const c of sp.contacts || []) for (const m of String(c).match(/\+?\d[\d\s]{8,}/g) || []) set.add(digitsOf(m)); } return set; } catch (e) { return new Set(); } };
  const cLast = {};
  async function runCustomer(ph) {
    if (!ph || STAFF[ph]) return;
    if ((await supPhones()).has(ph)) return runSupplier(ph);
    if (!AKEY) return;
    const fromBuf = getBuf().filter(m => !m.g && m.ph === ph);
    const hist = await history(ph, 25);
    const dup = (a, b) => a.id === b.id || (a.me === b.me && Math.abs(a.t - b.t) < 3000 && a.x === b.x);
    const all = fromBuf.concat(hist.filter(h => !fromBuf.some(b => dup(b, h)))).sort((a, b) => a.t - b.t);
    if (!all.length) return;
    const idx = cLast[ph] ? all.findIndex(m => m.id === cLast[ph]) : -1;
    const fresh = all.slice(idx + 1).filter(m => !m.me && (idx >= 0 || m.t > Date.now() - (+E.CU_BOOT_HOURS || 6) * 3600e3));
    if (!fresh.length) { cLast[ph] = all[all.length - 1].id; return; }
    const doc = (await get('customers')) || { list: [] }; doc.list = doc.list || [];
    let rec = doc.list.find(c => digitsOf(c.id) === ph || digitsOf(c.phone) === ph);
    const chatName = (fromBuf.find(m => !m.me) || {}).chat || ph;
    const ctx = rec ? `سجله الحالي: الاسم ${rec.name || '—'}، النوع ${rec.type || 'unk'}، المدينة ${rec.city || '—'}، آخر طلبات: ${JSON.stringify((rec.orders || []).slice(-4).map(o => [o.d, o.what, o.kg, o.amount, o.st]))}، حقائق: ${JSON.stringify((rec.facts || []).slice(-6))}` : 'لا سجل سابق له.';
    const out = await claude(SYS_C, `${ctx}\nاسم الدردشة: ${chatName}\nالرسائل الجديدة هي ذوات المعرّفات: ${fresh.map(m => m.id).join(', ')}\n\n${conv(all.slice(-25).map(m => Object.assign({}, m, { from: m.me ? 'ضيف الله' : chatName })))}`);
    cLast[ph] = all[all.length - 1].id;
    if (!rec && !out.customer) return;
    const byId = new Map(fresh.map(m => [m.id, m])); const last = all[all.length - 1]; const now = new Date().toISOString();
    if (!rec) { rec = { id: ph, phone: ph, chat: chatName, name: String(out.name || chatName).slice(0, 60), type: out.type || 'unk', city: String(out.city || ''), returning: false, orders: [], transfers: [], facts: [], asks: [], first_date: ymd(new Date(fresh[0].t)), src: 'live' }; doc.list.push(rec); }
    if (out.name && !rec.name) rec.name = String(out.name).slice(0, 60);
    if (out.type && out.type !== 'unk' && (!rec.type || rec.type === 'unk')) rec.type = out.type;
    if (out.city && !rec.city) rec.city = String(out.city).slice(0, 40);
    rec.orders = rec.orders || []; rec.transfers = rec.transfers || []; rec.facts = rec.facts || []; rec.asks = rec.asks || [];
    const oid = mid => 'wa-' + stamp(byId.get(mid).t);
    for (const o of out.orders || []) if (byId.has(o.mid) && !rec.orders.some(x => x.id === oid(o.mid))) rec.orders.push({ id: oid(o.mid), d: ymd(new Date(byId.get(o.mid).t)), what: String(o.what || '').slice(0, 160), kg: o.kg == null ? null : +o.kg, amount: o.amount == null ? null : +o.amount, st: String(o.st || 'طلب').slice(0, 40), src: 'واتساب' });
    for (const t of out.transfers || []) if (byId.has(t.mid) && t.amount && !rec.transfers.some(x => x.id === oid(t.mid))) rec.transfers.push({ id: oid(t.mid), d: ymd(new Date(byId.get(t.mid).t)), amount: +t.amount, src: 'إيصال في واتساب' });
    for (const a of out.asks || []) if (byId.has(a.mid) && a.text) rec.asks.push({ d: ymd(new Date(byId.get(a.mid).t)), text: String(a.text).slice(0, 160) });
    for (const f of out.facts || []) { const t = String(f).slice(0, 160); if (t && !rec.facts.includes(t)) rec.facts.push(t); }
    rec.asks = rec.asks.slice(-20); rec.facts = rec.facts.slice(-24);
    if (rec.orders.length > 1 || rec.transfers.length) rec.returning = true;
    rec.last_date = ymd(new Date(last.t)); rec.last_from = last.me ? 'me' : 'them'; rec.unanswered = !last.me; rec.updated = now;
    doc.at = now; await set('customers', doc); runs.customers = (runs.customers || 0) + 1;
    const nOrd = (out.orders || []).filter(o => byId.has(o.mid)).length;
    if (nOrd) await addDaily([{ src: 'العملاء', t: `${rec.name}: طلب جديد — ${String(out.orders[0].what || '').slice(0, 100)}`, s: hm(last.t), lv: 'warn', k: 'cu:' + fresh[fresh.length - 1].id }]);
  }
  async function markCustomerReplied(ph, t) {   // ردّ ضيف الله: بلا نموذج ذكي
    try { const doc = await get('customers'); if (!doc || !Array.isArray(doc.list)) return; const rec = doc.list.find(c => digitsOf(c.id) === ph || digitsOf(c.phone) === ph); if (!rec || rec.last_from === 'me') return;
      rec.last_from = 'me'; rec.unanswered = false; rec.last_date = ymd(new Date(t)); doc.at = new Date().toISOString(); await set('customers', doc); } catch (e) { lastErr = 'cu-me ' + e.message; }
  }

  // ---------- 2د) ملفات الموردين (live/suppliers): ملفات ورسائل المورد تُضاف لملفه ----------
  const sLast = {};
  async function runSupplier(ph) {
    const doc = await get('suppliers'); if (!doc || !Array.isArray(doc.list)) return;
    const sp = doc.list.find(x => digitsOf(x.phone) === ph || (x.contacts || []).some(c => (String(c).match(/\+?\d[\d\s]{8,}/g) || []).some(m => digitsOf(m) === ph))); if (!sp) return;
    const ms = getBuf().filter(m => !m.g && m.ph === ph).sort((a, b) => a.t - b.t);
    const idx = sLast[ph] ? ms.findIndex(m => m.id === sLast[ph]) : -1;
    const fresh = ms.slice(idx + 1).filter(m => idx >= 0 || m.t > Date.now() - 6 * 3600e3); if (!fresh.length) return;
    sLast[ph] = ms[ms.length - 1].id;
    sp.files = sp.files || []; sp.chat = Array.isArray(sp.chat) ? sp.chat : []; let n = 0;
    for (const m of fresh) {
      const d = ymd(new Date(m.t)), who = m.me ? 'أنت' : 'هو (' + (m.chat || '') + ')';
      if (m.mf && m.mf.k !== 'aud') { const name = m.mf.n || (m.mf.k === 'img' ? 'صورة' : 'ملف'); if (!sp.files.some(f => f.d === d && f.name === name)) { sp.files.push({ d, name, by: m.chat || who, u: m.mf.u }); n++; } }
      if (m.x && !/^📎|^📷|^🎤|^🎥/.test(m.x)) { sp.chat.push({ d, who, t: String(m.x).slice(0, 160) }); n++; }
      if (!m.me) sp.last = d;
    }
    sp.chat = sp.chat.slice(-60); if (!n) return;
    doc.at = new Date().toISOString(); await set('suppliers', doc); runs.suppliers = (runs.suppliers || 0) + 1;
    const inc = fresh.filter(m => !m.me); if (inc.length) await addDaily([{ src: 'الموردون', t: `${sp.name}: ${inc.some(m => m.mf) ? 'أرسل ملفًا' : 'رسالة جديدة'} — ${String(inc[inc.length - 1].x || '').slice(0, 90)}`, s: hm(inc[inc.length - 1].t), lv: 'info', k: 'sup:' + inc[inc.length - 1].id }]);
  }

  // ---------- 3) حالة الردود الجاهزة ----------
  let inboxBusy = Promise.resolve();
  function onPrivate(m) {
    inboxBusy = inboxBusy.then(async () => {
      const d = await get('inbox'); if (!d || !Array.isArray(d.items)) return;
      let ch = false; const now = new Date().toISOString();
      for (const it of d.items) {
        if (it.st === 'done') continue;
        const same = (it.phone && m.ph && it.phone === m.ph) || it.chat === m.chat; if (!same) continue;
        const itT = Date.parse(it.at || it.su || 0) || 0; if (m.t <= itT) continue;
        if (!m.me && m.mf) { it.media = (it.media || []).concat(m.mf).slice(-6); ch = true; }   // مرفق جديد من العميل
        if (m.me && it.st === 'new') { it.st = 'sent'; it.su = now; it.p = 'تم الرد ' + hm(m.t); ch = true; }
        else if (!m.me && it.st === 'sent') { it.st = 'followup'; it.su = now; it.p = 'ردّ: ' + String(m.x).slice(0, 140); ch = true; push({ title: 'ردّ من ' + (it.from || it.chat), msg: String(m.x).slice(0, 300), lv: 'warn', tag: 'wa-' + (it.phone || it.chat), click: it.phone ? 'https://wa.me/' + String(it.phone).replace(/\D/g, '') : undefined }); }
      }
      if (ch) { d.at = now; await set('inbox', d); runs.inbox++; }
    }).catch(e => { lastErr = 'inbox ' + e.message; });
  }

  // ---------- 4) تذكيرات المواعيد ----------
  const DATES = [   // [مفتاح، تاريخ الموعد، النص، أيام التنبيه قبله]
    ['vat-2026Q3', '2026-10-31', 'إقرار ضريبة القيمة المضافة (الربع الثالث) آخر موعد 31 أكتوبر', [14, 3]],
    ['vat-2026Q4', '2027-01-31', 'إقرار ضريبة القيمة المضافة (الربع الرابع) آخر موعد 31 يناير', [14, 3]],
    ['vat-2027Q1', '2027-04-30', 'إقرار ضريبة القيمة المضافة (الربع الأول) آخر موعد 30 أبريل', [14, 3]],
    ['vat-2027Q2', '2027-07-31', 'إقرار ضريبة القيمة المضافة (الربع الثاني) آخر موعد 31 يوليو', [14, 3]],
    ['bonat-renew', '2027-08-12', 'تجديد بونات 12 أغسطس 2027', [14, 3]],
    ['foodics-renew', '2027-09-24', 'تجديد فودكس 24 سبتمبر 2027', [14, 3]],
    ['glass-inv', '2026-10-29', 'مهلة الفاتورة الضريبية لعازل الزجاج 29 أكتوبر', [2, 0]],
    ['claude-key', '2026-11-08', 'جدّد مفتاح Claude في Railway (خدمة relay)', [0]],
  ];
  function dueReminders(now = new Date()) {
    const today = ymd(now), k = ksa(now), day = k.getUTCDate(), h = k.getUTCHours();
    const last = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 0)).getUTCDate();
    const out = [];
    if (day === last && h >= 18) out.push(['cash-' + today, 'اليوم نهاية الشهر: إيداع نقد الصندوق من عبدالله', 'warn']);
    if (day === 1 || day === 8) out.push(['hesab-bag-' + today, 'حقيبة الشهر الماضي إلى حساب قبل يوم 10', 'warn']);
    if (day === 3) out.push(['cash-check-' + today, 'تأكد من إيداع نقد نهاية الشهر الماضي', 'warn']);
    if (day === 1 && today < '2027-02-01') out.push(['einv-' + today, 'الفاتورة الإلكترونية (الربط في فودكس المحاسبي) موعدها 1 فبراير 2027', 'info']);
    for (const [key, due, t, before] of DATES) for (const b of before) {
      const at = new Date(Date.parse(due + 'T00:00:00Z') - b * 864e5).toISOString().slice(0, 10);
      if (at === today) out.push([key + '-' + b, t + (b ? ` (باقي ${b} يوم)` : ' (اليوم)'), b <= 3 ? 'bad' : 'warn']);
    }
    return out;
  }
  async function runReminders() {
    const due = dueReminders(); if (!due.length) return;
    const d = (await get('daily')) || {}; d.open = d.open || []; d.notified = d.notified || {};
    let ch = false;
    for (const [key, t, lv] of due) {
      if (d.notified[key]) continue;
      d.notified[key] = ymd(new Date()); d.open.push({ t, who: 'المواعيد', since: arDate(new Date()), lv, k: key }); ch = true; push({ title: 'تذكير موعد', msg: t, lv, tag: 'alarm_clock' });
    }
    if (!ch) return;
    const cut = ymd(new Date(Date.now() - 60 * 864e5)); for (const [k, v] of Object.entries(d.notified)) if (v < cut) delete d.notified[k];
    d.at = new Date().toISOString(); await set('daily', d); runs.remind++;
  }

  // ---------- مشترك ----------
  const hm = t => new Date(t).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' });
  let dailyBusy = Promise.resolve();
  function addDaily(items) {
    if (!items.length) return Promise.resolve();
    dailyBusy = dailyBusy.then(async () => {
      const d = (await get('daily')) || {}; d.items = d.items || [];
      const keys = new Set(d.items.map(x => x.k).filter(Boolean)); const fresh = items.filter(x => !keys.has(x.k)); if (!fresh.length) return;
      d.items = fresh.concat(d.items).slice(0, 120); d.at = new Date().toISOString(); await set('daily', d);
      for (const x of fresh) if (x.lv && x.lv !== 'info') push({ title: x.src || 'دال', msg: x.t, lv: x.lv, tag: x.src === 'الإيميل' ? 'email' : 'bell' });   // الإشعار للمهم فقط؛ العادي يظهر في التطبيق
    }).catch(e => { lastErr = 'daily ' + e.message; });
    return dailyBusy;
  }
  const debounce = (k, fn) => { clearTimeout(timers[k]); timers[k] = setTimeout(() => fn().catch(e => { lastErr = k + ' ' + e.message; }), WAIT); };
  setInterval(() => runReminders().catch(e => { lastErr = 'remind ' + e.message; }), 30 * 60e3);
  setTimeout(() => runReminders().catch(e => { lastErr = 'remind ' + e.message; }), 90e3);

  function onMessage(m) {
    if (m.g && m.chat === SLOW_GROUP) debounce('slow', runSlow);
    else if (m.g && m.chat === RT_GROUP) debounce('rt', runRt);
    else if (m.g) { if (!m.me && isDal(m.chat)) debounce('g:' + m.chat, () => runGroup(m.chat)); }
    else { onPrivate(m); if (m.ph && !STAFF[m.ph]) { if (m.me) markCustomerReplied(m.ph, m.t); else debounce('cu:' + m.ph, () => runCustomer(m.ph)); } }
  }
  return {
    onMessage,
    touch(m) { if (m.g) onMessage(m); },   // قُرئ ملف في القروب: نؤجل قراءة القروب حتى يدخل ملخصه في السياق
    runSlow, runRt, runReminders, dueReminders, addDaily, addOpen, runGroup, runCustomer, runSupplier,
    status() { return { model: MODEL, enabled: !!AKEY, runs, lastErr }; },
  };
}
module.exports = { setup, isDal };
