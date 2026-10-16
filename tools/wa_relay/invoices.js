/* صندوق الفواتير: كل صورة/PDF يُرسل في قروب المشتريات (أو يُرفع من التطبيق) يُقرأ بالذكاء الاصطناعي،
   تُفحص شروط الفاتورة الضريبية (زاتكا) ثم يُحفظ الملف في متصفح دال السحابي ويُضاف للفهرس live/invoices.
   لا يُرسل شيء لأحد. */
'use strict';
const E = process.env;
const KEY = E.ANTHROPIC_API_KEY, MODEL = E.INVOICE_MODEL || 'claude-sonnet-4-5';
const BROWSER = (E.BROWSER_URL || 'http://browser.railway.internal:8080').replace(/\/$/, '');
const DAL_VAT = E.DAL_VAT || '312248097700003', DAL_NAME = /دال|dal/i;
const CHATS = String(E.INVOICE_CHATS || 'مشتريات,Purchase').split(',').map(s => s.trim()).filter(Boolean);
let lastErr = '', n = 0;

const SYS = `أنت مدقق فواتير لمحمصة دال (مؤسسة دال تسعة للتجارة، الرقم الضريبي ${DAL_VAT}). أمامك صورة أو ملف فاتورة من مورد.
استخرج الحقول التالية حرفيًا كما هي في الفاتورة (null إن لم توجد)، وأخرج JSON فقط:
{"is_invoice":true/false,"kind":"فاتورة ضريبية|فاتورة ضريبية مبسطة|عرض سعر|إيصال|سند|أخرى","supplier":"اسم البائع","supplier_vat":"الرقم الضريبي للبائع (15 رقمًا)","supplier_cr":"السجل التجاري إن وجد","invoice_no":"","date":"YYYY-MM-DD","buyer":"اسم المشتري كما كُتب","buyer_vat":"الرقم الضريبي للمشتري إن وجد","net":0,"vat":0,"total":0,"currency":"SAR","qr":true/false,"items":"وصف مختصر للأصناف (سطر)","paid":"مدفوعة|غير مدفوعة|غير واضح","notes":"ملاحظات قصيرة"}
الأرقام بالأرقام الإنجليزية. لا تخمّن قيمًا غير موجودة.`;

function checks(x) {
  const miss = [];
  if (!x.supplier) miss.push('اسم المورد');
  if (!/^3\d{13}3$/.test(String(x.supplier_vat || '').replace(/\D/g, ''))) miss.push('الرقم الضريبي للمورد (15 رقمًا)');
  if (!x.invoice_no) miss.push('رقم الفاتورة');
  if (!x.date) miss.push('التاريخ');
  if (x.total == null) miss.push('الإجمالي');
  if (x.vat == null) miss.push('مبلغ الضريبة');
  if (x.kind === 'فاتورة ضريبية') { if (!DAL_NAME.test(x.buyer || '')) miss.push('اسم المشتري (دال)'); if (String(x.buyer_vat || '').replace(/\D/g, '') !== DAL_VAT) miss.push('الرقم الضريبي لدال'); }
  if (!x.qr) miss.push('رمز QR');
  if (x.kind === 'عرض سعر' || x.kind === 'إيصال') miss.push('ليست فاتورة ضريبية (' + x.kind + ')');
  return miss;
}

async function extract(b64, mime) {
  const isPdf = /pdf/i.test(mime);
  const content = [isPdf ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } } : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }, { type: 'text', text: 'استخرج بيانات الفاتورة. JSON فقط.' }];
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: SYS, messages: [{ role: 'user', content }] }) });
  const j = await r.json(); if (!r.ok) throw new Error('api ' + r.status + ' ' + JSON.stringify(j).slice(0, 120));
  const t = (j.content || []).map(c => c.text || '').join(''); const m = t.match(/\{[\s\S]*\}/); if (!m) throw new Error('no-json');
  return JSON.parse(m[0]);
}

async function processInvoice(b64, mime, meta) {   // meta: {chat, from, name, src:'wa'|'app', t}
  const x = await extract(b64, mime);
  const miss = x.is_invoice === false ? ['ليست فاتورة'] : checks(x);
  const rec = Object.assign({ id: meta.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), at: new Date().toISOString(), src: meta.src || 'wa', chat: meta.chat || '', from: meta.from || '', name: meta.name || '', mime,
    status: miss.length ? 'ناقصة' : 'مكتملة', missing: miss, sent: false }, x);
  // تخزين الملف والفهرس في متصفح دال السحابي
  const r = await fetch(BROWSER + '/invoice/ingest', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dal-key': E.DAL_KEY || '' }, body: JSON.stringify({ rec, b64 }) });
  if (!r.ok) throw new Error('browser ' + r.status);
  n++; return rec;
}

function wantsChat(chatName) { return CHATS.some(c => String(chatName || '').includes(c)); }

async function onMedia(p, chatName, from, waha) {   // من ناقل واتساب: p = payload الرسالة
  try {
    if (!wantsChat(chatName)) return;
    const mime = (p.media && p.media.mimetype) || ''; if (!/image\/(jpeg|png|webp)|pdf/i.test(mime)) return;
    let url = p.media && p.media.url; if (!url) return;
    const r = await waha(url, true); if (!r.ok) throw new Error('media ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 12e6) return;
    const id = String(p.id && (p.id._serialized || p.id.id || p.id) || Date.now()).replace(/[^A-Za-z0-9_-]/g, '').slice(-24);
    await processInvoice(buf.toString('base64'), /pdf/i.test(mime) ? 'application/pdf' : mime.toLowerCase(), { id, chat: chatName, from, name: (p._data && p._data.fileName) || '', src: 'wa' });
  } catch (e) { lastErr = String(e.message || e).slice(0, 200); }
}

module.exports = { process: processInvoice, onMedia, status: () => ({ n, lastErr, model: MODEL, enabled: !!KEY }) };
