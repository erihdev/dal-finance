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

const SYS = `أنت تكتب مسودة رد واتساب لصاحب محمصة دال (ضيف الله) على رسالة عميل أو مورد أو متقدم لوظيفة. هو يراجعها ويرسلها بنفسه.
قواعد صارمة:
1) استخدم فقط المعلومات الموجودة في «الحقائق» أو في كلام الطرف الآخر. ممنوع أي سعر أو رقم أو موعد أو وعد أو معلومة غير موجودة فيهما.
2) إن احتاج الرد معلومة غير موجودة (شحن، وقت توصيل، دفع آجل، خصم خاص، محصول غير مذكور...) فاكتب رداً مبدئياً قصيراً بدون تفاصيل، وضع المطلوب من ضيف الله في owner.
3) لهجة سعودية مهذبة ومختصرة، سطران إلى أربعة. لا تذكر أنك ذكاء اصطناعي.
4) لا تعرض محصولاً حالته «غير متوفر حالياً». ولا تذكر ويست أرسي أو سومطرا.
5) إن لم تحتج الرسالة رداً (شكر، تأكيد، ملصق، تحية عابرة انتهت) فاجعل reply=false.
أعد JSON فقط بهذا الشكل بلا أي نص آخر:
{"reply":true,"kind":"قائمة أسعار|سعر محدد|وظيفة|عميل|مورد|موظف|حساب|أخرى","ask":"سطر واحد بما يطلبه","draft":"نص الرد","owner":"ما يحتاجه ضيف الله أو فارغ"}
- «قائمة أسعار»: يطلب قائمة/أسعار الجملة عموماً. «سعر محدد»: يسأل عن سعر محصول أو كمية محددة — أجبه من الحقائق بالسعر المطابق للكمية.`;

function setup({ gas, getBuf, lastErrRef, push = async () => {} }) {
  async function run(key) {
    pending.delete(key);
    if (!KEY) return;
    const today = new Date().toISOString().slice(0, 10); if (today !== day) { day = today; used = 0; }
    if (used >= MAX_DAY) { lastErr = 'حد الردود اليومي'; return; }
    const msgs = getBuf().filter(m => !m.g && (m.ph || m.chat) === key).sort((a, b) => a.t - b.t).slice(-15);
    if (!msgs.length) return; const last = msgs[msgs.length - 1]; if (last.me) return;     // ردّ بنفسه
    const name = last.chat;
    const conv = msgs.map(m => (m.me ? 'ضيف الله' : name) + ': ' + m.x).join('\n');
    const F = await facts(gas);
    let out;
    for (let a = 0; a < 2 && !out; a++) {
      let raw = '';
      try { used++; raw = await claude(SYS, `الحقائق:\n${F}\n\nالمحادثة (آخر رسائل، الأحدث في الأسفل):\n${conv}`);
        out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
      catch (e) { lastErr = 'draft ' + e.message + ' :: ' + raw.slice(0, 160); }
    }
    if (!out) return;
    if (!out || out.reply === false) return;
    let draft = String(out.draft || '').trim(), attach = '', owner = String(out.owner || '').trim(), checked = 'قالب';
    const first = name.split(' ')[0];
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
    const item = { id: 'live-' + last.id, mid: last.id, src: 'live', kind: out.kind || 'أخرى', from: name, chat: name, phone: last.ph || '', when, at: new Date(last.t).toISOString(),
      ask: String(out.ask || '').slice(0, 200), draft, attach, st: 'new', su: new Date().toISOString(),
      p: owner ? 'يحتاج منك: ' + owner : 'رد جاهز لحظي (' + checked + ')' };
    for (let i = 0; i < 3; i++) {
      try {
        const r = await gas({ op: 'get', paths: ['live/inbox'] }); const d = (r.docs['live/inbox'] || {}).data || { items: [] };
        d.items = (d.items || []).filter(x => !(x.src === 'live' && x.chat === name && x.st === 'new'));   // بند حي واحد لكل دردشة لم يُرد عليها
        if (d.items.some(x => x.mid === item.mid)) return;
        d.items.push(item); d.at = new Date().toISOString();
        await gas({ op: 'set', path: 'live/inbox', data: d });
        push({ title: 'رسالة من ' + name, msg: (item.ask || '') + (owner ? '\nيحتاج منك: ' + owner : '\nالرد الجاهز في التطبيق'), lv: owner ? 'warn' : 'info', tag: 'incoming_envelope' }); return;
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
  };
}
module.exports = { setup, nums, norm };
