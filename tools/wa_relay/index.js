/* ناقل واتساب دال: يستقبل الرسائل من WAHA (قراءة فقط) ويكتبها في قاعدة جوال دال (Apps Script) في live/wa_live.
   لا يرسل أي رسالة لأي أحد. يحتفظ بآخر 48 ساعة (حتى 600 رسالة). */
'use strict';
const http = require('http');
const E = process.env;
const GAS = E.GAS_URL, KEY = E.DAL_KEY, SECRET = E.RELAY_SECRET || '';
const WAHA = (E.WAHA_URL || 'http://waha.railway.internal:3000').replace(/\/$/, ''), WKEY = E.WAHA_API_KEY || '';
const SESSION = E.WAHA_SESSION || 'default';
const KEEP_MS = (+E.KEEP_HOURS || 48) * 3600e3, MAX = +E.MAX_MSGS || 600;
const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const GROUPS = list(E.INCLUDE_GROUPS);           // فارغ = كل المجموعات
const EXCLUDE = list(E.EXCLUDE_CHATS);          // أسماء أو أرقام لا تُنقل أبدًا (عائلة، مجتمعات...)
let buf = [], dirty = false, timer = null, firstAt = 0, lastErr = '', lastOk = 0;
const names = new Map();

async function gas(o) {
  o.k = KEY;
  const r = await fetch(GAS, { method: 'POST', body: JSON.stringify(o), redirect: 'follow', headers: { 'Content-Type': 'text/plain' } });
  const j = await r.json(); if (!j.ok) throw new Error('gas ' + j.err); return j;
}
async function waha(path) {
  const r = await fetch(WAHA + path, { headers: { 'X-Api-Key': WKEY, Accept: 'application/json' } });
  if (!r.ok) throw new Error('waha ' + r.status); return r.json();
}
async function chatName(cid, isGroup, fallback) {
  const c = names.get(cid); if (c && Date.now() - c.at < 6 * 3600e3) return c.n;
  let n = '';
  try {
    if (isGroup) { const g = await waha(`/api/${SESSION}/groups/${encodeURIComponent(cid)}`); n = g.subject || g.name || (g.groupMetadata && g.groupMetadata.subject) || ''; }
    else { const k = await waha(`/api/contacts?session=${SESSION}&contactId=${encodeURIComponent(cid)}`); n = k.name || k.pushname || k.pushName || ''; }
  } catch (e) { }
  n = n || fallback || cid.split('@')[0];
  names.set(cid, { n, at: Date.now() }); return n;
}
const pnCache = new Map();
async function pnOf(jid) {   // واتساب يستخدم معرّفات @lid بدل الرقم؛ نحوّلها لرقم الجوال
  if (!/@lid$/.test(jid)) return jid;
  if (pnCache.has(jid)) return pnCache.get(jid);
  let pn = '';
  try { const r = await waha(`/api/${SESSION}/lids/${encodeURIComponent(jid)}`); pn = r.pn || r.phoneNumber || ''; } catch (e) { }
  pn = pn ? pn.replace('@s.whatsapp.net', '@c.us') : jid; pnCache.set(jid, pn); return pn;
}
const digits = s => String(s || '').split('@')[0].replace(/\D/g, '');
function mediaLabel(p) {
  const m = (p.media && p.media.mimetype) || (p._data && p._data.type) || '';
  if (/image/.test(m)) return '📷 صورة'; if (/video/.test(m)) return '🎥 فيديو'; if (/audio|ptt/.test(m)) return '🎤 رسالة صوتية';
  if (/pdf|document|application/.test(m)) return '📄 ملف' + (p._data && p._data.fileName ? ' ' + p._data.fileName : '');
  if (/sticker/.test(m)) return 'ملصق'; return '📎 مرفق';
}
async function onMsg(p) {
  const me = !!p.fromMe; let cid = String(me ? p.to : p.from || ''); cid = await pnOf(cid);
  if (!cid || /status@broadcast|@newsletter|@broadcast/.test(cid)) return;
  const isGroup = cid.endsWith('@g.us');
  const pushName = (p._data && (p._data.pushName || p._data.notifyName)) || p.notifyName || '';
  const chat = await chatName(cid, isGroup, isGroup ? '' : pushName);
  if (EXCLUDE.some(x => x === chat || x === digits(cid))) return;
  if (isGroup && GROUPS.length && !GROUPS.includes(chat)) return;
  const text = String(p.body || '').trim() || (p.hasMedia ? mediaLabel(p) : '');
  if (!text) return;
  const id = String(p.id && (p.id._serialized || p.id.id || p.id) || cid + ':' + p.timestamp);
  if (buf.some(x => x.id === id)) return;
  buf.push({ id, t: (+p.timestamp || Date.now() / 1000) * 1000, chat, g: isGroup, ph: isGroup ? '' : digits(cid),
    from: me ? 'أنت' : (isGroup ? (pushName || digits(await pnOf(String(p.participant || p.author || '')))) : chat), me, x: text.slice(0, 700),
    q: p.replyTo && p.replyTo.body ? String(p.replyTo.body).slice(0, 160) : undefined, md: p.hasMedia ? 1 : undefined });
  schedule();
}
function schedule() {
  dirty = true; if (!firstAt) firstAt = Date.now();
  clearTimeout(timer);
  timer = setTimeout(flush, Date.now() - firstAt > 15000 ? 0 : 5000);
}
async function flush() {
  if (!dirty) return; dirty = false; firstAt = 0;
  const cut = Date.now() - KEEP_MS;
  buf = buf.filter(m => m.t >= cut).sort((a, b) => a.t - b.t).slice(-MAX);
  try { await gas({ op: 'set', path: 'live/wa_live', data: { at: new Date().toISOString(), n: buf.length, msgs: buf } }); lastOk = Date.now(); lastErr = ''; }
  catch (e) { lastErr = String(e.message || e); dirty = true; setTimeout(flush, 30000); }
}
async function seed() {
  try { const r = await gas({ op: 'get', paths: ['live/wa_live'] }); const d = r.docs['live/wa_live']; if (d && d.data && Array.isArray(d.data.msgs)) buf = d.data.msgs; } catch (e) { lastErr = 'seed ' + e.message; }
}
const srv = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, n: buf.length, lastOk, lastErr })); }
  if (req.method !== 'POST' || !req.url.startsWith('/hook')) { res.writeHead(404); return res.end(); }
  if (SECRET && req.headers['x-relay-secret'] !== SECRET) { res.writeHead(401); return res.end(); }
  let b = ''; req.on('data', c => { b += c; if (b.length > 2e6) req.destroy(); });
  req.on('end', async () => {
    res.writeHead(200); res.end('ok');
    try { const j = JSON.parse(b || '{}'); if (/^message(\.any)?$/.test(j.event) && j.payload) await onMsg(j.payload); } catch (e) { lastErr = 'hook ' + e.message; }
  });
});
seed().finally(() => srv.listen(+E.PORT || 8080, E.HOST || '::', () => console.log('relay up')));
process.on('SIGTERM', async () => { await flush(); process.exit(0); });
