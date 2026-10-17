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
let NAMES = {}; try { NAMES = JSON.parse(E.NAMES_JSON || '{}'); } catch (e) {}   // أسماء عرض لأرقام غير محفوظة في الجوال (شريك، محاسب...): رقم → اسم
const pusher = require('./push').setup({ gas: o => gas(o) });
const wm = require('./wamedia').setup({ waha: (a, b) => waha(a, b), key: KEY });
const drafter = require('./drafter').setup({ gas: o => gas(o), getBuf: () => buf, push: pusher.push, waha: (a, b) => waha(a, b), wm });
const invoices = require('./invoices');
const jobsMod = require('./jobs');
const jobs = jobsMod.setup({ gas: o => gas(o), getBuf: () => buf, push: pusher.push, waha: (a, b) => waha(a, b) });
const gfiles = require('./gfiles').setup({ gas: o => gas(o), waha: (a, b) => waha(a, b), wm, addDaily: l => jobs.addDaily(l), touch: m => jobs.touch(m) });
let buf = [], dirty = false, timer = null, firstAt = 0, lastErr = '', lastOk = 0;
const names = new Map();

async function gas(o) {
  o.k = KEY;
  const r = await fetch(GAS, { method: 'POST', body: JSON.stringify(o), redirect: 'follow', headers: { 'Content-Type': 'text/plain' } });
  const j = await r.json(); if (!j.ok) throw new Error('gas ' + j.err); return j;
}
async function waha(path, raw) {
  const url = /^https?:/.test(path) ? path : WAHA + path;
  const r = await fetch(url, { headers: { 'X-Api-Key': WKEY, Accept: raw ? '*/*' : 'application/json' } });
  if (raw) return r;
  if (!r.ok) throw new Error('waha ' + r.status); return r.json();
}
async function chatName(cid, isGroup, fallback) {
  const c = names.get(cid); if (c && Date.now() - c.at < 6 * 3600e3) return c.n;
  let n = '';
  try {
    if (isGroup) { const g = await waha(`/api/${SESSION}/groups/${encodeURIComponent(cid)}`); n = g.subject || g.name || (g.groupMetadata && g.groupMetadata.subject) || ''; }
    else { const k = await waha(`/api/contacts?session=${SESSION}&contactId=${encodeURIComponent(cid)}`); n = k.name || k.pushname || k.pushName || ''; }
  } catch (e) { }
  if (/^[+\d∙•·.\s()-]+$/.test(n)) n = '';   // «+966∙∙∙∙∙∙∙17»: ليس اسمًا محفوظًا بل رقم مموّه
  n = n || NAMES[digits(cid)] || fallback || cid.split('@')[0];
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
// اسم عضو القروب كما هو محفوظ في جهات اتصال الجوال (أدق من اسم العرض الذي يختاره هو)، وإلا اسم العرض، وإلا رقمه
async function whoOf(jid, pushName) { if (!jid) return pushName || ''; const pn = await pnOf(String(jid)); return chatName(pn, false, pushName || '') || digits(pn); }
// رقم حساب المحمصة نفسه (حتى لا نحسب رسائلي الصادرة على اسمي أنا): من WAHA عند التشغيل
let SELF = '';
async function loadSelf() { for (let i = 0; i < 10 && !SELF; i++) { try { const s = await waha(`/api/sessions/${SESSION}`); const id = s && s.me && (s.me.id || s.me.jid || ''); SELF = digits(id); if (SELF) console.log('self ok'); } catch (e) {} if (!SELF) await new Promise(ok => setTimeout(ok, 20000)); } }
loadSelf();
let shapeLogged = false;
function chatIdOf(p, me) {   // معرّف الدردشة: للرسائل الصادرة قد يغيب p.to في بعض محركات WAHA
  const cands = me ? [p.to, p.chatId, p._data && p._data.to, p._data && p._data.key && p._data.key.remoteJid, p.from] : [p.from, p.chatId];
  for (const c of cands) { const v = typeof c === 'string' ? c : (c && (c._serialized || c.id)); if (!v || v === 'undefined') continue; if (me && SELF && digits(v) === SELF && !/@g\.us$/.test(v)) continue; return String(v); }
  if (me && !shapeLogged) { shapeLogged = true; console.log('fromMe shape:', Object.keys(p).join(','), '_data:', Object.keys(p._data || {}).join(',')); }
  return '';
}
function mediaLabel(p) {
  const m = (p.media && p.media.mimetype) || (p._data && p._data.type) || '';
  if (/image/.test(m)) return '📷 صورة'; if (/video/.test(m)) return '🎥 فيديو'; if (/audio|ptt/.test(m)) return '🎤 رسالة صوتية';
  if (/pdf|document|application/.test(m)) return '📄 ملف' + (p._data && p._data.fileName ? ' ' + p._data.fileName : '');
  if (/sticker/.test(m)) return 'ملصق'; return '📎 مرفق';
}
async function onMsg(p) {
  const me = !!p.fromMe; let cid = chatIdOf(p, me); if (!cid) return; cid = await pnOf(cid);
  if (!cid || /status@broadcast|@newsletter|@broadcast/.test(cid)) return;
  const isGroup = cid.endsWith('@g.us');
  const pushName = (p._data && (p._data.pushName || p._data.notifyName)) || p.notifyName || '';
  const chat = await chatName(cid, isGroup, (isGroup || me) ? '' : pushName);   // pushName في رسالتي الصادرة هو اسمي أنا
  if (EXCLUDE.some(x => x === chat || x === digits(cid))) return;
  if (isGroup && GROUPS.length && !GROUPS.includes(chat)) return;
  if (isGroup && !jobsMod.isDal(chat)) return;   // قروبات غير دال (منتديات، عائلة): لا تُحفظ ولا تُتابع إطلاقًا
  const who = me ? 'أنت' : (isGroup ? await whoOf(String(p.participant || p.author || ''), pushName) : chat);
  if (p.hasMedia && isGroup) invoices.onMedia(p, chat, who, waha);
  const text = String(p.body || '').trim() || (p.hasMedia ? mediaLabel(p) : '');
  const mf = !isGroup && !me && p.hasMedia ? await wm.fromPayload(p) : null;   // المرفق يظهر في بطاقة الرد بالتطبيق
  if (!text) return;
  const id = String(p.id && (p.id._serialized || p.id.id || p.id) || cid + ':' + p.timestamp);
  if (buf.some(x => x.id === id)) return;
  buf.push({ id, t: (+p.timestamp || Date.now() / 1000) * 1000, chat, g: isGroup, ph: isGroup ? '' : digits(cid),
    from: who, me, x: text.slice(0, 700),
    q: p.replyTo && p.replyTo.body ? String(p.replyTo.body).slice(0, 160) : undefined, md: p.hasMedia ? 1 : undefined, mf: mf || undefined });
  schedule();
  const m = buf[buf.length - 1];
  try { drafter.onMessage(m); } catch (e) { lastErr = 'drafter ' + e.message; }
  try { jobs.onMessage(m); } catch (e) { lastErr = 'jobs ' + e.message; }
  if (isGroup && p.hasMedia && jobsMod.isDal(chat)) gfiles.onMedia(p, m);   // ملفات القروبات: تُقرأ وتُصنَّف في الخلفية
}
function schedule() {
  dirty = true; if (!firstAt) firstAt = Date.now();
  clearTimeout(timer);
  timer = setTimeout(flush, Date.now() - firstAt > 15000 ? 0 : 5000);
}
async function flush() {
  if (!dirty || !seeded) { if (!seeded) setTimeout(flush, 15000); return; } dirty = false; firstAt = 0;
  const cut = Date.now() - KEEP_MS;
  buf = buf.filter(m => m.t >= cut).sort((a, b) => a.t - b.t).slice(-MAX);
  try { await gas({ op: 'set', path: 'live/wa_live', data: { at: new Date().toISOString(), n: buf.length, msgs: buf } }); lastOk = Date.now(); lastErr = ''; }
  catch (e) { lastErr = String(e.message || e); dirty = true; setTimeout(flush, 30000); }
}
let seeded = false;
async function seed() {   // لا نكتب فوق الأرشيف قبل قراءته (حتى لا يضيع عند إعادة التشغيل)؛ نعيد المحاولة حتى تنجح ثم ندمج
  for (let i = 0; i < 20 && !seeded; i++) {
    try { const r = await gas({ op: 'get', paths: ['live/wa_live'] }); const d = r.docs && r.docs['live/wa_live']; const old = (d && d.data && Array.isArray(d.data.msgs)) ? d.data.msgs : [];
      const ids = new Set(buf.map(m => m.id)); for (const m of old) if (!ids.has(m.id) && !(m.me && !m.g && !m.ph) && !(m.g && !jobsMod.isDal(m.chat))) buf.push(m); seeded = true; if (buf.length) schedule();   // نُسقط رسائلي الصادرة القديمة بلا رقم (كانت تُنسب لاسمي)
      const day = Date.now() - 864e5, pv = buf.filter(m => !m.g && m.t > day); console.log('seed: private last 24h — mine', pv.filter(m => m.me).length, 'theirs', pv.filter(m => !m.me).length); }   // تشخيص: هل تصل ردودي؟
    catch (e) { lastErr = 'seed ' + e.message; await new Promise(ok => setTimeout(ok, 15000)); }
  }
}

// عملاء الواتس: كل محادثة فردية (لا مجموعات ولا المستبعَدين) من WAHA → live/cust_wa مرة يوميًا وعند الطلب
let waBusy = false, lastCustReq = 0;
async function syncWaCustomers() {
  if (waBusy) return; waBusy = true;
  try {
    const rows = []; const seen = new Set();
    let chats = [];
    try { chats = await waha(`/api/${SESSION}/chats/overview?limit=5000&offset=0`); } catch (e) { try { chats = await waha(`/api/${SESSION}/chats?limit=5000&offset=0`); } catch (e2) { } }
    for (const c of (chats || [])) {
      let id = String(c.id && (c.id._serialized || c.id) || ''); if (!id || /@g\.us|@newsletter|@broadcast|status@/.test(id)) continue;
      id = await pnOf(id); const ph = digits(id); if (!ph) continue;
      const name = c.name || c.pushname || (c.lastMessage && c.lastMessage._data && c.lastMessage._data.notifyName) || '';
      if (EXCLUDE.some(x => x === name || x === ph)) continue;
      const lm = c.lastMessage || {}; const t = lm.timestamp ? new Date((+lm.timestamp) * 1000).toISOString().slice(0, 10) : '';
      if (seen.has(ph)) continue; seen.add(ph);
      rows.push([name, ph, t, lm.fromMe ? 1 : 0]);
    }
    let contacts = [];
    try { contacts = await waha(`/api/contacts/all?session=${SESSION}&limit=10000`); } catch (e) { }
    for (const k of (contacts || [])) {
      const id = String(k.id && (k.id._serialized || k.id) || ''); if (/@g\.us|@lid/.test(id)) continue; const ph = digits(id); if (!ph || seen.has(ph)) continue;
      const name = k.name || k.pushname || k.pushName || ''; if (!name || EXCLUDE.some(x => x === name || x === ph)) continue;
      seen.add(ph); rows.push([name, ph, '', 0]);
    }
    rows.sort((a, b) => String(b[2]).localeCompare(String(a[2])));
    await gas({ op: 'set', path: 'live/cust_wa', data: { at: new Date().toISOString(), n: rows.length, cols: ['name', 'phone', 'last', 'lastMe'], rows } });
    console.log('wa customers', rows.length);
  } catch (e) { lastErr = 'cust ' + e.message; }
  finally { waBusy = false; }
}
async function checkCustReq() { try { const r = await gas({ op: 'get', paths: ['live/cust_req'] }); const d = r.docs && r.docs['live/cust_req']; const q = d && d.data; if (q && q.ts && q.ts !== lastCustReq) { lastCustReq = q.ts; await syncWaCustomers(); } } catch (e) { } }
setInterval(checkCustReq, 600000); setInterval(syncWaCustomers, 24 * 3600e3); setTimeout(syncWaCustomers, 60000);
const srv = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/cust') { syncWaCustomers(); res.writeHead(200); return res.end('ok'); }
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, n: buf.length, lastOk, lastErr, drafts: drafter.status(), invoices: invoices.status(), jobs: jobs.status(), push: pusher.status(), media: wm.status(), gfiles: gfiles.status() })); }
  if (req.method === 'POST' && req.url === '/gfiles/dedupe') {   // تنظيف المكرر في سجل الملفات (بمفتاح)
    if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); }
    gfiles.dedupe().then(r => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); }).catch(e => { res.writeHead(500); res.end(String(e.message)); }); return;
  }
  if (req.method === 'POST' && req.url === '/gfiles/ingest') {   // ملف من تصدير محادثة (بمفتاح)
    if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); }
    let body = ''; req.on('data', c => { body += c; if (body.length > 40e6) req.destroy(); });
    req.on('end', () => { (async () => { const r = await gfiles.ingest(JSON.parse(body || '{}')); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); })().catch(e => { res.writeHead(500); res.end(String(e.message || e)); }); });
    return;
  }
  if (req.method === 'POST' && req.url.startsWith('/gfiles/backfill')) {   // قراءة ملفات قروب سابقة (مرة واحدة): ?cid=<معرّف القروب>&limit=N
    if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); }
    const Q = new URL(req.url, 'http://x').searchParams; const cid = Q.get('cid') || '';
    if (!/@g\.us$/.test(cid)) { res.writeHead(400); return res.end('cid'); }
    (async () => { const chat = await chatName(cid, true, ''); gfiles.backfill(cid, +Q.get('limit') || 100, chat, whoOf, Date.parse(Q.get('since') || '') || 0).catch(e => console.log('gfiles backfill ERR', e.message)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ started: true, chat })); })()
      .catch(e => { res.writeHead(500); res.end(String(e.message)); });
    return;
  }
  if (req.method === 'POST' && /^\/jobs\/(slow|rt|remind)$/.test(req.url)) {   // تشغيل يدوي للتجربة
    if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); }
    const k = req.url.split('/').pop(); ({ slow: jobs.runSlow, rt: jobs.runRt, remind: jobs.runReminders })[k]().then(() => { res.writeHead(200); res.end('ok'); }).catch(e => { res.writeHead(500); res.end(String(e.message)); });
    return;
  }
  if (req.method === 'POST' && req.url === '/mail') {   // من متصفح دال: رسائل إيميل المحمصة الجديدة → المهام اليومية + إشعار
    if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); }
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', async () => { try {
      const j = JSON.parse(b || '{}'); const SKIP = /security alert|sign[- ]?in|تسجيل الدخول|تنبيه أمني|verification code|رمز التحقق|password|كلمة المرور|no-reply@accounts\.google\.com/i;
      const IMP = /فاتورة|invoice|statement|كشف|payment|سداد|دفع|تحويل|transfer|زاتكا|zatca|ضريب|vat|عرض سعر|quotation|order|طلب|عقد|contract|إنذار|مخالفة/i;
      const items = (j.mails || []).filter(m => m && m.id && !SKIP.test((m.subject || '') + ' ' + (m.email || ''))).slice(0, 20)
        .map(m => ({ src: 'الإيميل', t: ((m.from || m.email || '') + ': ' + (m.subject || '(بلا عنوان)')).slice(0, 200) + (m.summary ? ' — ' + String(m.summary).slice(0, 140) : ''), s: m.when || '', lv: IMP.test((m.subject || '') + ' ' + (m.summary || '')) ? 'warn' : 'info', k: 'mail:' + m.id }));
      await jobs.addDaily(items); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, n: items.length }));
    } catch (e) { res.writeHead(500); res.end(String(e.message)); } });
    return;
  }
  if (req.method === 'POST' && req.url === '/media/backfill') {   // مرفقات البطاقات المفتوحة الحالية
    if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); }
    backfillMedia().then(n => { res.writeHead(200); res.end(JSON.stringify({ ok: true, n })); }).catch(e => { res.writeHead(500); res.end(String(e.message)); });
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/debug/who')) {   // تشخيص: معرّف @lid → رقم → اسم جهة الاتصال المحفوظ
    if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); }
    const jid = String(new URL(req.url, 'http://x').searchParams.get('jid') || '');
    (async () => { const pn = await pnOf(jid); let k = null; try { k = await waha(`/api/contacts?session=${SESSION}&contactId=${encodeURIComponent(pn)}`); } catch (e) { k = { err: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jid, pn, name: k && (k.name || ''), pushname: k && (k.pushname || k.pushName || ''), err: k && k.err })); })().catch(e => { res.writeHead(500); res.end(String(e.message)); });
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/debug/hist')) {   // تشخيص: ما يعيده WAHA لدردشة خاصة (مرفقات؟) وما في الذاكرة
    if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); }
    const Q = new URL(req.url, 'http://x').searchParams; const ph = String(Q.get('ph') || '').replace(/\D/g, ''); const cid = Q.get('cid') || (ph + '@c.us'); const lim = Math.min(300, +Q.get('limit') || 15);
    waha(`/api/${E.WAHA_SESSION || 'default'}/chats/${encodeURIComponent(cid)}/messages?limit=${lim}&downloadMedia=${Q.get('dl') === '0' ? 'false' : 'true'}`).then(ms => {
      const h = (Array.isArray(ms) ? ms : []).map(m => ({ id: String(m.id && (m.id._serialized || m.id) || '').slice(-12), t: new Date((+m.timestamp || 0) * 1000).toISOString().slice(5, 16), me: !!m.fromMe, from: String(m.participant || m.author || (m._data && m._data.author) || '').slice(0, 24), name: String((m._data && (m._data.notifyName || m._data.pushName)) || '').slice(0, 24), media: !!m.hasMedia, url: !!(m.media && m.media.url), mime: (m.media && m.media.mimetype) || '', fn: String((m.media && m.media.filename) || (m._data && m._data.filename) || '').slice(0, 40), err: (m.media && m.media.error) || '', x: String(m.body || '').slice(0, 40) }));
      const b = buf.filter(m => !m.g && m.ph === ph).map(m => ({ id: m.id.slice(-12), t: new Date(m.t).toISOString().slice(5, 16), me: m.me, md: !!m.md, mf: !!m.mf, d: !!(m.mf && m.mf.d), x: String(m.x || '').slice(0, 30) }));
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ waha: h, buf: b }));
    }).catch(e => { res.writeHead(500); res.end(String(e.message)); });
    return;
  }
  if (req.method === 'POST' && req.url === '/push/test') {   // إشعار تجربة
    if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); }
    pusher.reloadSubs().then(() => pusher.push({ title: 'دال', msg: 'تجربة الإشعارات ✅ ' + new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' }), lv: 'info', tag: 'white_check_mark' })).then(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(pusher.status())); });
    return;
  }
  if (req.method === 'POST' && req.url === '/invoice/process') {   // من متصفح دال (رفع يدوي من التطبيق): يقرأ ويفحص ويحفظ
    if (!KEY || req.headers['x-dal-key'] !== KEY) { res.writeHead(401); return res.end(); }
    let b = ''; req.on('data', c => { b += c; if (b.length > 20e6) req.destroy(); });
    req.on('end', async () => { try { const j = JSON.parse(b || '{}'); const rec = await invoices.process(j.b64, j.mime, Object.assign({ src: 'app' }, j.meta || {})); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rec })); } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, err: String(e.message || e) })); } });
    return;
  }
  if (req.method !== 'POST' || !req.url.startsWith('/hook')) { res.writeHead(404); return res.end(); }
  if (SECRET && req.headers['x-relay-secret'] !== SECRET) { res.writeHead(401); return res.end(); }
  let b = ''; req.on('data', c => { b += c; if (b.length > 2e6) req.destroy(); });
  req.on('end', async () => {
    res.writeHead(200); res.end('ok');
    try { const j = JSON.parse(b || '{}'); if (/^message(\.any)?$/.test(j.event) && j.payload) await onMsg(j.payload); } catch (e) { lastErr = 'hook ' + e.message; }
  });
});
srv.listen(+E.PORT || 8080, E.HOST || '::', () => console.log('relay up'));
seed();
process.on('SIGTERM', async () => { await flush(); process.exit(0); });

// مرفقات البطاقات المفتوحة التي وصلت قبل تفعيل حفظ المرفقات: نجلبها من WAHA مرة واحدة
async function backfillMedia() {
  const r = await gas({ op: 'get', paths: ['live/inbox'] }); const d = (r.docs['live/inbox'] || {}).data; if (!d || !Array.isArray(d.items)) return 0;
  let n = 0;
  for (const it of d.items) {
    if (it.st === 'done' || it.media || it.mck || !it.phone) continue;
    let ms = []; try { ms = await waha(`/api/${SESSION}/chats/${encodeURIComponent(it.phone + '@c.us')}/messages?limit=20&downloadMedia=true`); } catch (e) { console.log('backfill chat', it.phone.slice(-4), e.message); continue; }
    const since = (Date.parse(it.at || 0) || 0) - 2 * 864e5; const out = [];
    for (const m of (Array.isArray(ms) ? ms : []).sort((a, b) => a.timestamp - b.timestamp)) {
      if (m.fromMe || !m.hasMedia || m.timestamp * 1000 < since) continue;
      const f = await wm.fromPayload(m); if (f) out.push(f);
    }
    if (out.length) { it.media = out.slice(-6); n++; } else if (!(Array.isArray(ms) ? ms : []).some(m => !m.fromMe && m.hasMedia && m.timestamp * 1000 >= since)) it.mck = 1;
  }
  console.log('backfill media: cards', n, JSON.stringify(wm.status()));
  if (n || d.items.some(x => x.mck)) {   // نعيد القراءة قبل الكتابة حتى لا نمسح تغييرات حدثت أثناء التحميل
    const r2 = await gas({ op: 'get', paths: ['live/inbox'] }); const d2 = (r2.docs['live/inbox'] || {}).data || { items: [] };
    const by = new Map(d.items.filter(x => x.media || x.mck).map(x => [x.id, x]));
    for (const it of d2.items || []) { const o = by.get(it.id); if (o && !it.media) { if (o.media) it.media = o.media; else it.mck = 1; } }
    d2.at = new Date().toISOString(); await gas({ op: 'set', path: 'live/inbox', data: d2 });
  }
  return n;
}
setTimeout(() => drafter.recheck().catch(e => console.log('recheck ERR', e.message)), 150e3);   // بعد التشغيل: البطاقات المفتوحة بالسياق الكامل
const bf = () => backfillMedia().catch(e => { lastErr = 'backfill ' + e.message; console.log('backfill ERR', e.message); });
setTimeout(bf, 60e3); setInterval(bf, 30 * 60e3);
setTimeout(() => gfiles.dedupe().catch(() => {}), 90e3); setInterval(() => gfiles.dedupe().catch(() => {}), 24 * 3600e3);   // تنظيف المكرر بعد التشغيل ويوميًا

