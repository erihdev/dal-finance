/* الردود الجاهزة اللحظية: لكل رسالة خاصة جديدة يكتب Claude رداً مقترحاً خلال دقيقة، ويُضاف إلى live/inbox.
   الصدق: (1) ملف حقائق هو المرجع الوحيد، (2) قوالب ثابتة للحالات المتكررة، (3) مدقق يرفض أي رقم غير موجود في الحقائق أو في كلام العميل،
   (4) لا يُرسل شيء — ضيف الله يراجع ويرسل بنفسه. */
'use strict';
const E = process.env;
const MODEL = E.MODEL || 'claude-sonnet-5-5', KEY = E.ANTHROPIC_API_KEY;
const MAX_DAY = +E.MAX_DRAFTS_DAY || 150, WAIT = (+E.DRAFT_WAIT_SEC || 45) * 1000;
const pending = new Map(); let day = '', used = 0, factsCache = { at: 0, text: '' }, lastErr = '';
const SAFE = 'هلا والله، وصلتنا رسالتك ونرجع لك بالتفاصيل اليوم إن شاء الله.';
const T_PRICE = 'هلا والله، يسعدنا تعاملك مع محمصة دال. مرفق لك قائمة أسعار الجملة لمحاصيلنا، والسعر يقل كل ما زادت الكمية. كم الكمية اللي تحتاجها تقريباً، وفي أي مدينة؟';
const T_JOB_CV = 'هلا {n}، شكراً على اهتمامك بمحمصة دال. وصلتنا سيرتك وبنراجعها، ونتواصل معك إذا فيه شاغر يناسبك.';
const T_JOB = 'هلا {n}، شكراً على اهتمامك بمحمصة دال. ممكن ترسل لنا سيرتك الذاتية، ومدينتك، وخبرتك في القهوة أو الكاشير؟';
const STATIC = `محمصة دال (مؤسسة دال تسعة للتجارة) — صبيا، طريق الملك عبدالعزيز، حي المروج. جوال 0599363888، إيميل dal@dalksa.com.
قائمة أسعار الجملة سبتمبر 2026 (شاملة الضريبة، ريال للكيلو، عبوة 1 كجم): السعر / من 5 كجم خصم 10٪ / من 20 كجم خصم 15٪ / من 50 كجم خصم 20٪.
أكياس 250 جرام: بطيخ وعنب 85 ريال، بوبيان وكيندر وكاندي وجوز الهند 65 ريال، شلشلي ولويس 55 ريال؛ خصم 15٪ من 5 كجم، 30٪ من 10 كجم، 40٪ من 20 كجم.
لا توجد في الحقائق معلومات عن: مدة التوصيل، رسوم الشحن، أوقات الدوام، الدفع الآجل، العينات المجانية — أي سؤال عنها يحتاج ضيف الله.`;

const norm = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
// الموظفون (من متغير STAFF_JSON في Railway، لا من الكود): رقم → {n: الاسم، r: الوظيفة، s: الدوام كما في علو، en: يرد بالإنجليزي}
let STAFF = {}; try { STAFF = JSON.parse(E.STAFF_JSON || '{}'); } catch (e) {}
const staffOf = ph => STAFF[String(ph || '').replace(/\D/g, '').replace(/^0(?=5)/, '966').replace(/^(?=5\d{8}$)/, '966')] || null;
const nums = s => (norm(s).match(/\d+(?:[.,]\d+)*/g) || []).map(x => x.replace(/,/g, '')).map(x => String(+x));

async function facts(gas) {
  if (Date.now() - factsCache.at < 10 * 60e3 && factsCache.text) return factsCache.text;
  let lines = [];
  try {
    const r = await gas({ op: 'get', paths: ['live/stock', 'live/stock_state'] });
    const sk = (r.docs['live/stock'] || {}).data || {}, st = (r.docs['live/stock_state'] || {}).data || {};
    for (const it of sk.items || []) {
      const s = (st.st && st.st[it.id]) || it.st;
      const lab = { in: 'متوفر', low: 'متوفر بكمية قليلة', soon: 'قريباً (يمكن الحجز)', out: 'غير متوفر حالياً' }[s] || 'غير معروف';
      lines.push(`- ${it.name} (${it.o || ''}): ${lab}` + (s === 'out' ? '' : ' — ' + (it.sell || []).map(x => x[0] + ' ' + x[1] + ' ريال').join('، ')));
    }
  } catch (e) { lines.push('- (تعذّرت قراءة المحاصيل الآن: لا تذكر توفر أي محصول)'); }
  factsCache = { at: Date.now(), text: STATIC + '\nالمحاصيل الآن:\n' + lines.join('\n') };
  return factsCache.text;
}

async function claude(system, user) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2500, system, messages: [{ role: 'user', content: user }] }),
  });
  const j = await r.json(); if (!r.ok) throw new Error('claude ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  return (j.content || []).map(c => c.text || '').join('');
}

async function claudeBlocks(system, blocks, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 400, thinking: { type: 'between_tools' }, system, messages: [{ role: 'user', content: blocks }] }),   // وصف مباشر بلا تفكير مسبق (كان يستهلك الحد الأقصى)
  });
  const j = await r.json(); if (!r.ok) throw new Error('claude ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  return (j.content || []).map(c => c.text || '').join('').trim();
}
// قراءة الصور والملفات التي يرسلها العميل قبل كتابة الرد: وصف قصير يدخل في سياق المحادثة
const SYS_MEDIA = `هذا مرفق أرسله شخص في واتساب لمحمصة دال. صفه في سطر أو سطرين بالعربية بما يفيد كتابة الرد:
- إيصال تحويل/دفع: المبلغ، التاريخ، اسم المستلم أو البنك إن ظهر. لا تكتب أي رقم حساب أو IBAN أو رقم هوية.
- منتج أو كيس بن: اسمه ومحصوله إن ظهر، أو وصفه.
- سيرة ذاتية: الاسم، المدينة، سنوات الخبرة، آخر عمل.
- فاتورة أو عرض سعر: الجهة والإجمالي والتاريخ.
- لقطة شاشة: ما تعرضه باختصار (تطبيق، رسالة خطأ، طلب…).
- غير ذلك: ما هو. لا تخمّن ما لا يظهر. أعد الوصف فقط بلا مقدمات.`;
const mediaDesc = new Map();   // رابط المرفق → وصفه (ذاكرة التشغيل)
async function describeMedia(mf) {
  if (!mf || !mf.u) return '';
  if (mediaDesc.has(mf.u)) return mediaDesc.get(mf.u);
  if (mf.k === 'aud') { mediaDesc.set(mf.u, 'رسالة صوتية (لا تُقرأ آليًا)'); return mediaDesc.get(mf.u); }
  if (mf.k === 'vid') { mediaDesc.set(mf.u, 'فيديو (لا يُقرأ آليًا)'); return mediaDesc.get(mf.u); }
  let d = '';
  try {
    const r = await fetch(mf.u); if (!r.ok) throw new Error('fetch ' + r.status);
    const mime = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(); const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 8e6) throw new Error('كبير');
    const b64 = buf.toString('base64'); let block = null;
    if (/^image\/(jpeg|png|webp|gif)$/.test(mime)) block = { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
    else if (mime === 'application/pdf') block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
    if (!block) { d = 'ملف ' + (mf.n || mime || '') + ' (نوع لا يُقرأ آليًا)'; }
    else d = await claudeBlocks(SYS_MEDIA, [block, { type: 'text', text: 'صف هذا المرفق' + (mf.n ? ' (اسم الملف: ' + mf.n + ')' : '') + '.' }], 300);
  } catch (e) { d = ''; lastErr = 'media ' + String(e.message || e).slice(0, 80); }
  d = String(d || '').replace(/\s+/g, ' ').slice(0, 300);
  if (d) mediaDesc.set(mf.u, d);
  return d;
}

const SYS = `أنت تكتب مسودة رد واتساب لصاحب محمصة دال (ضيف الله) على رسالة عميل أو مورد أو متقدم لوظيفة. هو يراجعها ويرسلها بنفسه.
قواعد صارمة:
1) استخدم فقط المعلومات الموجودة في «الحقائق» أو في كلام الطرف الآخر. ممنوع أي سعر أو رقم أو موعد أو وعد أو معلومة غير موجودة فيهما.
2) إن احتاج الرد معلومة غير موجودة (شحن، وقت توصيل، دفع آجل، خصم خاص، محصول غير مذكور...) فاكتب رداً مبدئياً قصيراً بدون تفاصيل، وضع المطلوب من ضيف الله في owner.
2ب) ما بين [مرفق: …] هو وصف صورة أو ملف أرسله الطرف الآخر وقد قُرئ فعلاً: اعتمد عليه كأنه جزء من كلامه (إيصال تحويل بمبلغ كذا = وصل التحويل، سيرة ذاتية = وصلت سيرته…). لا تطلب منه ما ظهر في المرفق.
3) لهجة سعودية مهذبة ومختصرة، سطران إلى أربعة. لا تذكر أنك ذكاء اصطناعي.
4) لا تعرض محصولاً حالته «غير متوفر حالياً». ولا تذكر ويست أرسي أو سومطرا.
5) إن لم تحتج الرسالة رداً (شكر، تأكيد، ملصق، تحية عابرة انتهت) فاجعل reply=false.
6) إن كانت «الحقائق» تقول إن المرسل موظف في دال: kind=موظف، خاطبه باسمه الأول، وأجب عن الدوام والإجازة من جدوله المذكور بوضوح (الأيام والساعات). إن ذكر أن تطبيق علو يعرض غير ذلك فأكّد له جدوله الصحيح وضع في owner «راجع جدوله في علو». إن لم يُذكر جدوله فلا تخمّن وضعه في owner. إن قيل «يرد بالإنجليزي» فاكتب الرد بإنجليزية بسيطة.
أعد JSON فقط بهذا الشكل بلا أي نص آخر:
{"reply":true,"kind":"قائمة أسعار|سعر محدد|وظيفة|عميل|مورد|موظف|حساب|أخرى","ask":"سطر واحد بما يطلبه","draft":"نص الرد","owner":"ما يحتاجه ضيف الله أو فارغ"}
- «قائمة أسعار»: يطلب قائمة/أسعار الجملة عموماً. «سعر محدد»: يسأل عن سعر محصول أو كمية محددة — أجبه من الحقائق بالسعر المطابق للكمية.`;

function setup({ gas, getBuf, lastErrRef, push = async () => {}, waha = null, wm = null }) {
  const histMedia = new Map();   // معرّف الرسالة → مرفقها المحفوظ
  const SESSION = E.WAHA_SESSION || 'default';
  // سجل المحادثة من WAHA نفسه: فيه ردود ضيف الله من الجوال حتى لو ما وصلت للناقل كحدث
  async function history(ph) {
    if (!waha || !ph) return [];
    try {
      const ms = await waha(`/api/${SESSION}/chats/${encodeURIComponent(ph + '@c.us')}/messages?limit=15&downloadMedia=true`);
      const out = [];
      for (const m of (Array.isArray(ms) ? ms : [])) {
        const id = String(m.id && (m.id._serialized || m.id) || ''); if (!id) continue;
        let mf;
        if (!m.fromMe && m.hasMedia && wm) { if (histMedia.has(id)) mf = histMedia.get(id); else { mf = await wm.fromPayload(m); histMedia.set(id, mf || null); } }
        const x = String(m.body || '').trim() || (m.hasMedia ? '📎 مرفق' : ''); if (!x) continue;
        out.push({ id, t: (+m.timestamp || 0) * 1000, me: !!m.fromMe, ph, x, mf: mf || undefined });
      }
      return out;
    } catch (e) { return []; }
  }
  // بطاقة «لم يُرد» لهذه الدردشة تصير «تم الرد» (ردّ بنفسه، أو آخر رسالة لا تحتاج رداً)
  async function markReplied(ph, chat, note) {
    try {
      const r = await gas({ op: 'get', paths: ['live/inbox'] }); const d = (r.docs['live/inbox'] || {}).data; if (!d || !Array.isArray(d.items)) return;
      let ch = false; for (const it of d.items) if (it.st === 'new' && ((ph && it.phone === ph) || it.chat === chat)) { it.st = 'sent'; it.su = new Date().toISOString(); it.p = note; ch = true; }
      if (ch) { d.at = new Date().toISOString(); await gas({ op: 'set', path: 'live/inbox', data: d }); }
    } catch (e) { lastErr = 'mark ' + e.message; }
  }
  async function run(key, quiet) {
    pending.delete(key);
    if (!KEY) return;
    const today = new Date().toISOString().slice(0, 10); if (today !== day) { day = today; used = 0; }
    if (used >= MAX_DAY) { lastErr = 'حد الردود اليومي'; return; }
    const fromBuf = getBuf().filter(m => !m.g && (m.ph || m.chat) === key);
    const ph0 = (fromBuf.find(m => m.ph) || {}).ph || (/^\d{9,15}$/.test(key) ? key : '');
    const hist = await history(ph0);
    const dup = (a, b) => a.id === b.id || (a.me === b.me && Math.abs(a.t - b.t) < 3000 && a.x === b.x);
    for (const b of fromBuf) if (!b.mf && b.md) { const h = hist.find(x => x.mf && dup(b, x)); if (h) b.mf = h.mf; }   // مرفق ضاع من الذاكرة (إعادة تشغيل) نأخذه من سجل WAHA
    const msgs = fromBuf.concat(hist.filter(h => !fromBuf.some(b => dup(b, h)))).sort((a, b) => a.t - b.t).slice(-15);
    if (!msgs.length) return; const last = msgs[msgs.length - 1];
    if (last.me) { await markReplied(ph0, last.chat || (fromBuf[0] || {}).chat, 'تم الرد'); return; }     // ردّ بنفسه
    if (!last.chat) last.chat = (fromBuf[0] || {}).chat || key; if (!last.ph) last.ph = ph0;
    const st = staffOf(last.ph), name = st ? st.n : last.chat;
    for (const m of msgs) if (!m.me && m.mf && !m.mf.d) { const d = await describeMedia(m.mf); if (d) m.mf.d = d; }   // نقرأ الصور والملفات أولًا
    const conv = msgs.map(m => (m.me ? 'ضيف الله' : name) + ': ' + m.x + (m.mf && m.mf.d ? ' [مرفق: ' + m.mf.d + ']' : '')).join('\n');
    const F = (await facts(gas)) + (st ? `\n\nالمرسل موظف في دال: ${st.n} — ${st.r}.${st.s ? ' جدوله المسجّل في علو: ' + st.s + '.' : ' جدوله غير مسجّل عندي.'}${st.en ? ' يرد بالإنجليزي.' : ''}` : '');
    let out;
    for (let a = 0; a < 2 && !out; a++) {
      let raw = '';
      try { used++; raw = await claude(SYS, `الحقائق:\n${F}\n\nالمحادثة (آخر رسائل، الأحدث في الأسفل):\n${conv}`);
        out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
      catch (e) { lastErr = 'draft ' + e.message + ' :: ' + raw.slice(0, 160); }
    }
    if (!out) return;
    if (out.reply === false) { await markReplied(last.ph, last.chat, 'لا يحتاج رد'); return; }
    let draft = String(out.draft || '').trim(), attach = '', owner = String(out.owner || '').trim(), checked = 'قالب';
    const first = name.split(' ')[0];
    if (st) out.kind = 'موظف';   // موظف معروف: لا قوالب عملاء ولا وظائف
    if (out.kind === 'قائمة أسعار') { draft = T_PRICE; attach = 'wholesale'; out.kind = 'عرض سعر'; }
    else if (out.kind === 'وظيفة') draft = (msgs.some(m => !m.me && m.md) ? T_JOB_CV : T_JOB).replace('{n}', first);
    else {   // المدقق: كل رقم في الرد يجب أن يكون في الحقائق أو في كلام الطرف الآخر
      checked = 'مدقق';
      const fN = nums(F), cN = nums(conv).filter(x => +x > 0 && +x <= 1000);
      const ok = new Set(fN.concat(nums(conv)));
      for (const a of fN) for (const b of cN) { const v = Math.round(+a * +b * 100) / 100; ok.add(String(v)); }   // سعر × كمية ذكرها العميل
      const bad = nums(draft).filter(n => !ok.has(n));
      if (bad.length || !draft) { owner = (owner ? owner + '؛ ' : '') + 'الرد المقترح ذكر أرقاماً غير موجودة في الحقائق (' + bad.join('، ') + ') فاستبدلته برد مبدئي'; draft = SAFE; checked = 'مدقق: رُفض'; }
    }
    const when = 'اليوم ' + new Date(last.t).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' });
    if (out.kind === 'سعر محدد') out.kind = 'عرض سعر';
    const item = { id: 'live-' + last.id, mid: last.id, src: 'live', kind: out.kind || 'أخرى', from: name, chat: last.chat, phone: last.ph || '', when, at: new Date(last.t).toISOString(),
      ask: String(out.ask || '').slice(0, 200), draft, attach, st: 'new', su: new Date().toISOString(),
      media: msgs.some(m => !m.me && m.mf) ? msgs.filter(m => !m.me && m.mf).slice(-6).map(m => m.mf) : undefined,   // صور وملفات العميل
      p: owner ? 'يحتاج منك: ' + owner : 'رد جاهز لحظي (' + checked + ')' };
    for (let i = 0; i < 3; i++) {
      try {
        const r = await gas({ op: 'get', paths: ['live/inbox'] }); const d = (r.docs['live/inbox'] || {}).data || { items: [] };
        const old = (d.items || []).filter(x => x.src === 'live' && x.chat === last.chat && x.st === 'new');
        if (!item.media) { const om = old.find(x => x.media); if (om) item.media = om.media; }   // نحتفظ بمرفقات البطاقة السابقة
        d.items = (d.items || []).filter(x => !old.includes(x));   // بند حي واحد لكل دردشة لم يُرد عليها
        if (d.items.some(x => x.mid === item.mid)) return;
        d.items.push(item); d.at = new Date().toISOString();
        await gas({ op: 'set', path: 'live/inbox', data: d });
        if (!quiet) { const ph = String(item.phone || '').replace(/\D/g, ''); push({ title: 'رسالة من ' + name, msg: (item.ask || '') + (owner ? '\nيحتاج منك: ' + owner : '') + (draft ? '\n↩︎ ' + String(draft).slice(0, 400) : ''), lv: owner ? 'warn' : 'info', tag: 'wa-' + (ph || last.chat), click: ph ? 'https://wa.me/' + ph + '?text=' + encodeURIComponent(draft || '') : undefined }); } return;
      } catch (e) { lastErr = 'inbox ' + e.message; await new Promise(r => setTimeout(r, 4000)); }
    }
  }
  return {
    onMessage(m) {
      if (m.g || !KEY) return; const key = m.ph || m.chat;
      clearTimeout(pending.get(key));
      if (m.me) { pending.delete(key); return; }          // ردّ ضيف الله يلغي المسودة المنتظرة
      pending.set(key, setTimeout(() => run(key).catch(e => { lastErr = String(e.message || e); }), WAIT));
    },
    status() { return { model: MODEL, enabled: !!KEY, used, max: MAX_DAY, lastErr }; },
    // مراجعة البطاقات المفتوحة: ما رُد عليه يُعلَّم، والباقي يُعاد صياغته بالسياق الكامل (بلا إشعارات)
    async recheck() {
      const r = await gas({ op: 'get', paths: ['live/inbox'] }); const d = (r.docs['live/inbox'] || {}).data; if (!d || !Array.isArray(d.items)) return 0;
      for (const it of d.items) for (const m of (it.media || [])) if (m && m.u && m.d && !mediaDesc.has(m.u)) mediaDesc.set(m.u, m.d);   // أوصاف قُرئت سابقًا: لا نقرأها مرة أخرى
      const keys = [...new Set(d.items.filter(x => x.st === 'new' && x.phone).map(x => x.phone))]; let n = 0;
      for (const k of keys) { await run(k, true).catch(e => { lastErr = 'recheck ' + e.message; }); n++; }
      console.log('recheck: chats', n, lastErr || '');
      try { const r2 = await gas({ op: 'get', paths: ['live/inbox'] }); const d2 = (r2.docs['live/inbox'] || {}).data || {}; const its = d2.items || [];   // تحقق: حالة البطاقات بعد المراجعة
        const c = {}; for (const it of its) c[it.st] = (c[it.st] || 0) + 1; console.log('inbox after recheck:', JSON.stringify(c));
        for (const it of its) { const sf = staffOf(it.phone); if (sf && it.st !== 'done') console.log('staff card:', sf.n, '|', it.st, '|', it.kind, '|', String(it.p || '').slice(0, 60), '|', String(it.draft || '').slice(0, 80).replace(/\n/g, ' ')); } } catch (e) { console.log('verify ERR', e.message); }
      return n;
    },
  };
}
module.exports = { setup, nums, norm };
