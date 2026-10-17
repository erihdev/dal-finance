/* ملفات القروبات: كل صورة أو PDF أو ملف (إكسل، وورد، نص) يُرسل في قروبات دال يُفتح ويُقرأ ويُلخَّص ويُصنَّف،
   ويُحفظ في live/gfiles (يظهر في التطبيق صفحة «ملفات القروبات»)، ويدخل ملخصه في سياق قراءة القروب.
   قراءة فقط: لا يُرسل شيء لأحد. الفيديو والصوت يُسجَّلان بلا قراءة. */
'use strict';
const E = process.env;
const MODEL = E.MODEL || 'claude-sonnet-5-5', KEY = E.ANTHROPIC_API_KEY;
const MAX_ITEMS = +E.GFILES_MAX || 300, KEEP_DAYS = +E.GFILES_DAYS || 120, MAX_BYTES = 15e6, MAX_TEXT = 14000;
const ksa = d => new Date(d.getTime() + 3 * 3600e3);
const ymd = d => ksa(d).toISOString().slice(0, 10);
const hm = t => new Date(t).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' });
let lastErr = '', n = 0, busy = Promise.resolve();

const TYPES = ['إيصال تحويل', 'فاتورة', 'عرض سعر', 'كشف حساب', 'تقرير', 'جدول دوام', 'عقد', 'سيرة ذاتية', 'مستند رسمي', 'تصميم', 'صورة', 'لقطة شاشة', 'فيديو', 'صوت', 'أخرى'];
const SYS = `أنت أمين سجل ملفات محمصة دال (مؤسسة دال تسعة للتجارة، صبيا). صاحبها ضيف الله، شريكه عبدالله (يتولى البنك والتحويلات)، مدير التشغيل Jobert (هريرا)، والمحاسبون «شركة حساب».
أمامك ملف أُرسل في قروب واتساب داخلي. اقرأه كاملًا ثم أعد JSON فقط بهذا الشكل:
{"type":"واحد فقط من: ${TYPES.join(' | ')}","title":"عنوان من 3 إلى 8 كلمات يميّز هذا الملف عن غيره","summary":"سطران إلى أربعة فقط (حتى 400 حرف): ما في الملف بالضبط (الجهة، البنود، المبالغ، التواريخ) وما يهم صاحب المحمصة فيه؛ في كشوف الحساب والتقارير الطويلة اكتفِ بالإجماليات والفترة لا تفاصيل كل سطر","party":"الجهة أو الشخص الذي يخصه الملف (مورد، موظف، بنك، جهة حكومية) أو فارغ","amount":الإجمالي رقمًا بلا فواصل أو null,"currency":"SAR","date":"تاريخ المستند نفسه YYYY-MM-DD أو null","ref":"رقم الفاتورة أو مرجع العملية أو فارغ","to":"المستفيد في التحويل أو فارغ","action":"ما يحتاجه ضيف الله من هذا الملف إن وُجد (اعتماد، مراجعة، رد، إرسال للمحاسب) أو فارغ","lv":"bad إن كان عاجلًا أو فيه إنذار أو مخالفة أو مبلغ كبير غير معتاد؛ warn إن كان يحتاج تصرّفًا منه؛ info غير ذلك","tags":["3 إلى 6 كلمات مفتاحية قصيرة"]}
قواعد: لا تخمّن ما لا يظهر في الملف. الأرقام بالأرقام الإنجليزية. ممنوع كتابة أي رقم حساب أو IBAN أو رقم هوية أو رقم بطاقة (اكتفِ بآخر 4 أرقام إن لزم). لا تذكر أي مبالغ نقدية للحمّاص. إن كان الملف صورة لمنتج أو مكان أو تصميم فصفه باختصار. نص التعليق المرافق للملف (إن وُجد) يساعدك على الفهم لكنه ليس محتوى الملف.`;

function kindOf(mime, name) {
  mime = String(mime || '').toLowerCase(); const ext = (String(name || '').match(/\.([a-z0-9]{2,5})$/i) || [, ''])[1].toLowerCase();
  if (/^image\/(jpeg|png|webp|gif)/.test(mime)) return 'img';
  if (/pdf/.test(mime) || ext === 'pdf') return 'pdf';
  if (/spreadsheet|ms-excel|csv/.test(mime) || /^(xlsx|xls|csv)$/.test(ext)) return 'xls';
  if (/wordprocessing|msword/.test(mime) || /^(docx|doc)$/.test(ext)) return 'doc';
  if (/^text\//.test(mime) || /^(txt|md|json)$/.test(ext)) return 'txt';
  if (/^video\//.test(mime)) return 'vid';
  if (/^audio\//.test(mime) || /ogg|opus/.test(mime)) return 'aud';
  return 'file';
}

async function claudeBlocks(blocks, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 900, thinking: { type: 'between_tools' }, system: SYS, messages: [{ role: 'user', content: blocks }] }),   // بلا تفكير مسبق: الإجابة JSON مباشرة
  });
  const j = await r.json(); if (!r.ok) throw new Error('claude ' + r.status + ' ' + JSON.stringify(j).slice(0, 160));
  const raw = (j.content || []).map(c => c.text || '').join('');
  if (raw.indexOf('{') < 0) throw new Error('no-json ' + (j.stop_reason || '') + ' ' + raw.slice(0, 80));
  return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
}
const scrub = s => String(s).replace(/\bSA\s?\d[\d\s]{18,}\d\b/gi, '[IBAN محذوف]').replace(/@\d{10,}/g, '@').replace(/\b\d{10,}\b/g, '[رقم محذوف]');   // أرقام الهوية والحسابات لا تُحفظ أبدًا
const normType = t => { t = String(t || ''); return TYPES.find(x => x === t) || TYPES.find(x => t.includes(x)) || (/صورة|photo/i.test(t) ? 'صورة' : 'أخرى'); };

// نص الملفات غير المرئية: إكسل → CSV لكل ورقة، وورد → نص
function textOf(buf, k) {
  if (k === 'xls') { const X = require('xlsx'); const wb = X.read(buf, { type: 'buffer' }); let out = '';
    for (const sn of wb.SheetNames) { out += `\n=== ورقة: ${sn} ===\n` + X.utils.sheet_to_csv(wb.Sheets[sn], { blankrows: false }); if (out.length > MAX_TEXT) break; }
    return out.slice(0, MAX_TEXT); }
  if (k === 'doc') return require('mammoth').extractRawText({ buffer: buf }).then(r => String(r.value || '').slice(0, MAX_TEXT));
  return buf.toString('utf8').slice(0, MAX_TEXT);
}

function setup({ gas, waha, wm, addDaily = async () => {}, touch = () => {} }) {
  let known = 0;   // أكبر عدد بنود رأيناه: إن عاد المستند أصغر بكثير فالقراءة ناقصة، لا نكتب فوقه
  const get = async () => { const r = await gas({ op: 'get', paths: ['live/gfiles'] }); if (!r || !r.docs) throw new Error('gfiles read: no docs');
    const doc = r.docs['live/gfiles']; if (!doc) { if (known) throw new Error('gfiles read: missing'); return { items: [] }; }   // المستند غير موجود فعلًا
    const d = doc.data; if (!d || !Array.isArray(d.items)) throw new Error('gfiles read: empty doc');   // قراءة فارغة لمستند موجود: لا نكتب فوقه أبدًا
    if (+d.n && d.items.length < +d.n * 0.6) throw new Error('gfiles read: partial ' + d.items.length + '/' + d.n);
    if (known > 20 && d.items.length < known * 0.6) throw new Error('gfiles read: shrank ' + d.items.length + '/' + known);
    known = Math.max(known, d.items.length); return d; };
  async function read(mf, buf, mime, cap) {   // mf: {u,k,n}
    const k = kindOf(mime, mf.n);
    const capTxt = cap ? `\n\nالتعليق المرافق: «${String(cap).slice(0, 300)}»` : '';
    if (k === 'vid' || k === 'aud') return { type: k === 'vid' ? 'فيديو' : 'صوت', title: (cap ? String(cap).slice(0, 60) : (k === 'vid' ? 'مقطع فيديو' : 'رسالة صوتية')), summary: (k === 'vid' ? 'فيديو' : 'صوت') + ' (لا يُقرأ آليًا)' + (cap ? ' — التعليق: ' + String(cap).slice(0, 200) : ''), lv: 'info', tags: [] };
    let blocks;
    if (k === 'img') blocks = [{ type: 'image', source: { type: 'base64', media_type: mime.split(';')[0], data: buf.toString('base64') } }, { type: 'text', text: 'اقرأ هذه الصورة وصنّفها.' + (mf.n ? ' (اسم الملف: ' + mf.n + ')' : '') + capTxt }];
    else if (k === 'pdf') blocks = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }, { type: 'text', text: 'اقرأ هذا الملف وصنّفه.' + (mf.n ? ' (اسم الملف: ' + mf.n + ')' : '') + capTxt }];
    else if (k === 'xls' || k === 'doc' || k === 'txt') { let t = ''; try { t = await textOf(buf, k); } catch (e) { t = ''; }
      if (!t.trim()) return { type: 'أخرى', title: mf.n || 'ملف', summary: 'ملف ' + (mf.n || '') + ' تعذّرت قراءة محتواه آليًا', lv: 'info', tags: [] };
      blocks = [{ type: 'text', text: `اسم الملف: ${mf.n || ''}\nمحتوى الملف:\n${t}${capTxt}\n\nاقرأه وصنّفه.` }]; }
    else return { type: 'أخرى', title: mf.n || 'ملف', summary: 'ملف من نوع ' + (mime || 'غير معروف') + ' لا يُقرأ آليًا', lv: 'info', tags: [] };
    const x = await claudeBlocks(blocks, 1600);
    return {
      type: normType(x.type), title: String(x.title || mf.n || 'ملف').slice(0, 90), summary: String(x.summary || '').replace(/\s+/g, ' ').slice(0, 500),
      party: String(x.party || '').slice(0, 80), amount: x.amount == null || isNaN(+x.amount) ? null : +x.amount, cur: String(x.currency || 'SAR').slice(0, 5),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(x.date || '')) ? x.date : null, ref: String(x.ref || '').slice(0, 60), to: String(x.to || '').slice(0, 80),
      action: String(x.action || '').slice(0, 200), lv: ['bad', 'warn', 'info'].includes(x.lv) ? x.lv : 'info', tags: (Array.isArray(x.tags) ? x.tags : []).map(t => String(t).slice(0, 30)).slice(0, 6),
    };
  }
  // يحمّل المرفق من WAHA (الرابط على localhost → المسار فقط) ويحفظه في متصفح دال ويقرؤه
  async function process(p, meta, quiet, pre) {   // meta: {mid, t, chat, from, me, cap}؛ pre: {buf,mime} إن حُمّل مسبقًا
    const url = p.media && p.media.url; if (!url && !pre) return null;
    if ((p._data && p._data.type === 'sticker') || p.type === 'sticker' || (p._data && p._data.isSticker) || /image\/webp/i.test((p.media && p.media.mimetype) || '')) return null;   // الملصقات (webp) لا تهم
    let dl = pre || null; if (!dl) { try { dl = await wm.download(url, p.media && p.media.mimetype); } catch (e) { lastErr = 'dl ' + String(e.message || e).slice(0, 100); } }
    if (!dl || dl.buf.length > MAX_BYTES) return null;
    const { buf, mime } = dl;
    const mf = await wm.put(buf, mime, wm.nameOf(p), wm.msgId(p)); if (!mf) return null;
    let x; try { x = await read(mf, buf, mime, meta.cap); } catch (e) { lastErr = 'read ' + String(e.message || e).slice(0, 120); x = { type: kindOf(mime, mf.n) === 'img' ? 'صورة' : 'أخرى', title: mf.n || 'ملف', summary: 'تعذّرت القراءة الآلية: ' + String(e.message || e).slice(0, 80), lv: 'info', tags: [] }; }
    const it = Object.assign({ id: 'gf-' + String(meta.mid).replace(/[^A-Za-z0-9_@.-]/g, '').slice(-40), mid: meta.mid, at: new Date(meta.t).toISOString(), d: ymd(new Date(meta.t)), s: hm(meta.t),
      chat: meta.chat, from: meta.from, me: !!meta.me, fn: mf.n || '', mime: mime.split(';')[0], k: mf.k, u: mf.u, cap: String(meta.cap || '').slice(0, 200) }, x);
    for (const k of ['title', 'summary', 'party', 'to', 'ref', 'action', 'cap']) if (it[k]) it[k] = scrub(it[k]);   // شبكة أمان: لا أرقام هوية أو حسابات
    it.tags = (it.tags || []).map(scrub);
    await save(it);
    if (!quiet && it.lv !== 'info') await addDaily([{ src: 'ملفات', t: `${it.chat}: ${it.from} أرسل ${it.type} — ${it.title}${it.amount ? ' (' + it.amount + ' ' + it.cur + ')' : ''}${it.action ? ' · ' + it.action : ''}`, s: it.s, lv: it.lv, k: 'gf:' + it.mid }]);
    n++; return it;
  }
  function save(it) {   // بند واحد لكل رسالة؛ الأحدث أولًا؛ نقرأ قبل الكتابة حتى لا نمسح ما كُتب أثناء القراءة؛ ثلاث محاولات
    busy = busy.then(async () => {
      for (let a = 0; a < 3; a++) {
        try {
          const d = await get(); d.items = (d.items || []).filter(x => x.mid !== it.mid); d.items.unshift(it);
          const cut = ymd(new Date(Date.now() - KEEP_DAYS * 864e5)); d.items = d.items.filter(x => (x.d || '') >= cut).slice(0, MAX_ITEMS);
          d.at = new Date().toISOString(); d.n = d.items.length; await gas({ op: 'set', path: 'live/gfiles', data: d }); return;
        } catch (e) { lastErr = 'save ' + String(e.message || e).slice(0, 120); await new Promise(r => setTimeout(r, 3000 * (a + 1))); }
      }
    });
    return busy;
  }
  // رسالة قروب فيها مرفق وصلت الآن: نقرؤها في الخلفية ثم نلحق الملخص برسالة الذاكرة ليراه قارئ القروب
  function onMedia(p, m) {
    process(p, { mid: m.id, t: m.t, chat: m.chat, from: m.from, me: m.me, cap: p.body }, false)
      .then(it => { if (!it) return; m.mf = { u: it.u, k: it.k, n: it.fn }; m.gf = { type: it.type, title: it.title, summary: it.summary, amount: it.amount, ref: it.ref, to: it.to, action: it.action }; touch(m); })
      .catch(e => { lastErr = 'media ' + String(e.message || e).slice(0, 120); });
  }
  // قراءة ما سبق في قروب (مرة واحدة عند الطلب): كل مرفق في آخر N رسالة لم يُسجَّل بعد.
  // WAHA يحذف الملف المحمَّل بعد ~3 دقائق، لذلك نعيد طلب القائمة كل دفعة صغيرة ونحمّل ملفاتها فورًا ثم نقرؤها
  let bf = null;   // حالة آخر قراءة سابقة
  async function backfill(cid, limit, chat, whoOf, since) {
    if (bf && bf.running) throw new Error('backfill running');
    bf = { chat, total: 0, done: 0, skip: 0, fail: 0, running: true, at: new Date().toISOString() };
    const midOf = p => String(p.id && (p.id._serialized || p.id) || '');
    const list = async () => (await waha(`/api/${E.WAHA_SESSION || 'default'}/chats/${encodeURIComponent(cid)}/messages?limit=${Math.min(300, limit || 100)}&downloadMedia=true`));
    try {
      const cur = (await get()).items || [];
      const have = new Set(cur.filter(x => !/^تعذّرت القراءة/.test(x.summary || '')).map(x => x.mid));   // ما فشلت قراءته سابقًا يُعاد
      let L = (await list()).filter(p => p.hasMedia && midOf(p)).sort((a, b) => a.timestamp - b.timestamp);
      const todo = L.filter(p => !have.has(midOf(p)) && (!since || (+p.timestamp || 0) * 1000 >= since)); bf.skip = L.length - todo.length; bf.total = L.length;
      const PAR = 4;   // أربعة ملفات تُقرأ معًا
      for (let i = 0; i < todo.length; i += PAR) {
        const chunk = todo.slice(i, i + PAR);
        if (i) { const fresh = new Map((await list()).map(p => [midOf(p), p])); for (const p of chunk) { const f = fresh.get(midOf(p)); if (f && f.media) p.media = f.media; } }   // روابط جديدة لهذه الدفعة
        const got = await Promise.all(chunk.map(async p => { try { const st = await wm.stored(p); if (st) return [p, st]; return [p, p.media && p.media.url ? await wm.download(p.media.url, p.media.mimetype) : null]; } catch (e) { lastErr = 'dl ' + String(e.message || e).slice(0, 80); return [p, null]; } }));   // التحميل أولًا وبسرعة
        await Promise.all(got.map(async ([p, d]) => {
          if (!d) { bf.fail++; return; }
          const mid = midOf(p), me = !!p.fromMe, from = me ? 'أنت' : await whoOf(String(p.participant || p.author || (p._data && p._data.author) || ''), (p._data && (p._data.notifyName || p._data.pushName)) || '');
          const it = await process(p, { mid, t: (+p.timestamp || 0) * 1000, chat, from, me, cap: p.body }, true, d).catch(() => null); if (it) bf.done++; else bf.fail++;
        }));
      }
    } finally { bf.running = false; console.log('gfiles backfill', JSON.stringify(bf)); }
    return bf;
  }
  // ملف من تصدير محادثة واتساب (للأشهر التي انتهت روابطها): {chat, from, t, name, mime, b64}
  async function ingest(o) {
    const buf = Buffer.from(String(o.b64 || ''), 'base64'); if (!buf.length) throw new Error('empty');
    const mid = 'export:' + String(o.chat || '') + ':' + String(o.name || '');
    const cur = (await get()).items || []; if (cur.some(x => x.mid === mid && !/^تعذّرت القراءة/.test(x.summary || ''))) return { skip: true };
    const p = { id: mid, _data: { filename: String(o.name || '').replace(/^\d{8}-/, '') } };
    const it = await process(p, { mid, t: +o.t || Date.now(), chat: String(o.chat || ''), from: String(o.from || ''), me: false, cap: '' }, true, { buf, mime: String(o.mime || 'application/octet-stream') });
    return it ? { ok: true, type: it.type, title: it.title } : { ok: false };
  }
  return { onMedia, backfill, read, ingest, status: () => ({ n, lastErr, model: MODEL, bf }) };
}
module.exports = { setup, kindOf };
