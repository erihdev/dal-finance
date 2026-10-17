/* مرفقات رسائل واتساب الخاصة: نحمّل الصورة/الملف/الصوت من WAHA ونحفظه في متصفح دال بمعرّف عشوائي،
   فيظهر في بطاقة الرد الجاهز بالتطبيق قبل أن ترد. قراءة فقط: لا يُرسل شيء لأي أحد. */
'use strict';
const E = process.env, crypto = require('crypto');
const BROWSER = (E.BROWSER_URL || 'http://browser.railway.internal:8080').replace(/\/$/, '');
const PUBLIC = (E.BROWSER_PUBLIC || 'https://browser-production-10fb.up.railway.app').replace(/\/$/, '');
const MAX = 15e6;
let saved = 0, lastErr = '';

function kindOf(mime) { return /image/.test(mime) ? 'img' : /video/.test(mime) ? 'vid' : /audio|ogg|opus/.test(mime) ? 'aud' : 'file'; }

function setup({ waha, key }) {
  const known = new Map();   // معرّف ثابت → {u,k,n} (ذاكرة التشغيل)
  const msgId = p => String(p.id && (p.id._serialized || p.id.id || p.id) || '');
  // يرجع {u,k,n} أو null. ref (معرّف الرسالة) يثبّت الرابط لنفس المرفق عبر إعادات التشغيل، فلا يُقرأ مرتين
  async function save(url, mime, name, ref) {
    try {
      if (!url) return null;
      const id = ref ? crypto.createHash('sha256').update(String(ref)).digest('hex').slice(0, 32) : crypto.randomBytes(16).toString('hex');
      if (ref && known.has(id)) return known.get(id);
      // WAHA يكتب رابط الملف على localhost؛ نأخذ المسار فقط ونطلبه من عنوان WAHA الداخلي
      let r; try { r = await waha(String(url).replace(/^https?:\/\/[^/]+/, ''), true); } catch (e) { throw new Error('waha-fetch ' + e.message); }
      if (!r.ok) throw new Error('media ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer()); if (!buf.length || buf.length > MAX) return null;
      mime = mime || r.headers.get('content-type') || 'application/octet-stream';
      const w = await fetch(BROWSER + '/wa/media/ingest', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dal-key': key },
        body: JSON.stringify({ id, mime, name: name || '', b64: buf.toString('base64') }) }).catch(e => { throw new Error('ingest-fetch ' + e.message); });
      if (!w.ok) throw new Error('ingest ' + w.status);
      saved++; const mf = { u: PUBLIC + '/wa/m/' + id, k: kindOf(mime), n: String(name || '').slice(0, 80) };
      if (ref) known.set(id, mf);
      return mf;
    } catch (e) { lastErr = String(e.message || e).slice(0, 160); console.log('wamedia', lastErr); return null; }
  }
  const fromPayload = p => save(p.media && p.media.url, p.media && p.media.mimetype, (p.media && p.media.filename) || (p._data && p._data.filename) || '', msgId(p));
  return { save, fromPayload, status: () => ({ saved, lastErr }) };
}
module.exports = { setup };
