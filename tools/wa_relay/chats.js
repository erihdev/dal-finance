/* صندوق واتساب الكامل في تطبيق دال:
   1) أرشيف 30 يوماً لكل دردشة (خاص وقروبات، كل الرقم) في live/wa_c_<مفتاح> + فهرس المحادثات live/wa_chats.
   2) صندوق الإرسال: التطبيق يكتب ردّ المالك في live/wa_out (بضغطته هو فقط)، وهنا يُرسل عبر WAHA وتُكتب الحالة في live/wa_out_st.
      لا يُرسل شيء لم يكتبه المالك من التطبيق، ولا يُعاد إرسال رسالة، ولا تُرسل رسالة قديمة (> 15 دقيقة). WA_SEND=0 يوقف الإرسال كلياً.
   3) طلب تاريخ دردشة (live/wa_req): يُجلب من WAHA آخر 30 يوماً عند فتحها لأول مرة. */
'use strict';
const E = process.env;
const KEEP = (+E.CHAT_DAYS || 30) * 864e5, PER = +E.CHAT_MAX || 1500, IDX_MAX = +E.CHAT_IDX_MAX || 1500;
const SEND_ON = E.WA_SEND !== '0', SEND_TTL = 15 * 60e3, SEND_RATE = 20;

function setup({ gas, waha, wahaPost, session, chatName, whoOf, pnOf, digits, wm, exclude }) {
  const keyOf = cid => 'wa_c_' + (/@g\.us$/.test(cid) ? 'g' : 'p') + digits(cid);
  const idx = new Map();          // key → {k,id,name,g,ph,lt,lx,lme,lw,it:[...]}
  const arch = new Map();         // key → {msgs:[], loaded, dirty, timer}
  let idxLoaded = false, idxDirty = false, idxTimer = null, lastErr = '', sent = 0, sendErr = 0, writes = 0;

  async function getDoc(p) { const r = await gas({ op: 'get', paths: [p] }); const d = r.docs && r.docs[p]; return d && d.data; }
  async function loadIdx() {
    if (idxLoaded) return;
    try { const d = await getDoc('live/wa_chats'); for (const c of (d && d.chats) || []) if (c && c.k && !idx.has(c.k)) idx.set(c.k, c); idxLoaded = true; }
    catch (e) { lastErr = 'idx-load ' + e.message; throw e; }
  }
  async function loadArch(k) {
    let a = arch.get(k); if (a && a.loaded) return a;
    if (!a) { a = { msgs: [], loaded: false, dirty: false, timer: null }; arch.set(k, a); }
    const d = await getDoc('live/' + k); const old = (d && Array.isArray(d.msgs)) ? d.msgs : [];
    const ids = new Set(a.msgs.map(m => m.id)); for (const m of old) if (!ids.has(m.id)) a.msgs.push(m);
    a.loaded = true; return a;
  }
  function trim(msgs) { const cut = Date.now() - KEEP; return msgs.filter(m => m.t >= cut).sort((x, y) => x.t - y.t).slice(-PER); }

  function touchIdx(k, meta, m) {
    const c = idx.get(k) || { k, id: meta.id, name: meta.name, g: meta.g, ph: meta.ph, lt: 0, it: [] };
    if (meta.name) c.name = meta.name; c.id = meta.id; c.g = meta.g; c.ph = meta.ph;
    if (m && m.t >= (c.lt || 0)) { c.lt = m.t; c.lx = String(m.x || '').slice(0, 120); c.lme = !!m.me; c.lw = m.me ? '' : (m.g ? String(m.from || '').slice(0, 40) : ''); }
    if (m && !m.me && !(c.it || []).includes(m.t)) { c.it = (c.it || []).concat(m.t).sort((a, b) => a - b).slice(-40); }
    idx.set(k, c); idxDirty = true; clearTimeout(idxTimer); idxTimer = setTimeout(flushIdx, 4000);
  }
  async function flushIdx() {
    if (!idxDirty) return; if (!idxLoaded) { try { await loadIdx(); } catch (e) { idxTimer = setTimeout(flushIdx, 20000); return; } }
    idxDirty = false;
    const cut = Date.now() - KEEP;
    const chats = [...idx.values()].filter(c => (c.lt || 0) >= cut || c.pin).sort((a, b) => (b.lt || 0) - (a.lt || 0)).slice(0, IDX_MAX)
      .map(c => Object.assign({}, c, { it: (c.it || []).filter(t => t >= cut) }));
    try { await gas({ op: 'set', path: 'live/wa_chats', data: { at: new Date().toISOString(), n: chats.length, chats } }); writes++; }
    catch (e) { lastErr = 'idx ' + e.message; idxDirty = true; idxTimer = setTimeout(flushIdx, 30000); }
  }
  function schedChat(k, meta) {
    const a = arch.get(k); a.dirty = true; a.meta = meta; clearTimeout(a.timer); a.timer = setTimeout(() => flushChat(k), 3500);
  }
  async function flushChat(k) {
    const a = arch.get(k); if (!a || !a.dirty) return;
    if (!a.loaded) { try { await loadArch(k); } catch (e) { a.timer = setTimeout(() => flushChat(k), 20000); return; } }
    a.dirty = false; a.msgs = trim(a.msgs);
    const m = a.meta || {};
    try { await gas({ op: 'set', path: 'live/' + k, data: { at: new Date().toISOString(), k, id: m.id, name: m.name, g: m.g, ph: m.ph, n: a.msgs.length, msgs: a.msgs } }); writes++; }
    catch (e) { lastErr = 'chat ' + e.message; a.dirty = true; a.timer = setTimeout(() => flushChat(k), 30000); }
  }

  // رسالة جديدة (من الويب هوك) بعد تحويلها لشكل الأرشيف
  function add(cid, meta, m) {
    if (!cid || !m || !m.id) return;
    const k = keyOf(cid); meta = Object.assign({ id: cid, g: /@g\.us$/.test(cid), ph: /@g\.us$/.test(cid) ? '' : digits(cid) }, meta);
    let a = arch.get(k); if (!a) { a = { msgs: [], loaded: false, dirty: false, timer: null }; arch.set(k, a); }
    const i = a.msgs.findIndex(x => x.id === m.id); if (i >= 0) a.msgs[i] = Object.assign({}, a.msgs[i], m); else a.msgs.push(m);
    schedChat(k, meta); touchIdx(k, meta, m);
  }

  // تحويل رسالة WAHA (من سجل الدردشة) لشكل الأرشيف
  const label = p => { const t = (p.media && p.media.mimetype) || (p._data && p._data.type) || ''; return /image/.test(t) ? '📷 صورة' : /video/.test(t) ? '🎥 فيديو' : /audio|ptt/.test(t) ? '🎤 رسالة صوتية' : /sticker/.test(t) ? 'ملصق' : /document|pdf|application/.test(t) ? '📄 ملف' + (p._data && p._data.fileName ? ' ' + p._data.fileName : '') : '📎 مرفق'; };
  async function fromWaha(p, isGroup) {
    const id = String(p.id && (p.id._serialized || p.id.id || p.id) || ''); if (!id) return null;
    const me = !!p.fromMe; const x = String(p.body || '').trim() || (p.hasMedia ? label(p) : ''); if (!x) return null;
    const pushName = (p._data && (p._data.pushName || p._data.notifyName)) || p.notifyName || '';
    const from = me ? 'أنت' : isGroup ? await whoOf(String(p.participant || p.author || ''), pushName) : '';
    return { id, t: (+p.timestamp || 0) * 1000, me, x: x.slice(0, 2000), from: from || undefined, q: p.replyTo && p.replyTo.body ? String(p.replyTo.body).slice(0, 160) : undefined, md: p.hasMedia ? 1 : undefined, ack: p.ack != null ? p.ack : undefined };
  }

  // تاريخ دردشة من WAHA (آخر 30 يوماً) — عند أول فتح من التطبيق
  const filled = new Set();
  async function backfill(cid, limit) {
    const isGroup = /@g\.us$/.test(cid); const k = keyOf(cid);
    const name = await chatName(cid, isGroup, '');
    if (exclude(name, cid)) return { k, n: 0, skipped: true };
    let ms = []; try { ms = await waha(`/api/${session}/chats/${encodeURIComponent(cid)}/messages?limit=${Math.min(limit || 300, 1000)}&downloadMedia=false`); } catch (e) { lastErr = 'backfill ' + e.message; throw e; }
    const a = await loadArch(k); const have = new Set(a.msgs.map(m => m.id)); const cut = Date.now() - KEEP; let n = 0;
    for (const p of (Array.isArray(ms) ? ms : [])) { if ((+p.timestamp || 0) * 1000 < cut) continue; const m = await fromWaha(p, isGroup); if (!m || have.has(m.id)) continue; a.msgs.push(m); have.add(m.id); n++; }
    const meta = { id: cid, name, g: isGroup, ph: isGroup ? '' : digits(cid) };
    // المرفقات القديمة: نجلب آخر 30 مرفقًا (آخر 14 يومًا) ونحفظها في متصفح دال لتظهر في التطبيق
    if (wm) { const mcut = Date.now() - 14 * 864e5; const need = a.msgs.filter(m => m.md && !m.mf && !m.mfTry && m.t > mcut).sort((x, y) => y.t - x.t).slice(0, 30);
      for (const m of need) { m.mfTry = 1; try { const full = await waha(`/api/${session}/chats/${encodeURIComponent(cid)}/messages/${encodeURIComponent(m.id)}?downloadMedia=true`); const mf = full && full.hasMedia ? await wm.fromPayload(full) : null; if (mf) m.mf = mf; } catch (e) { lastErr = 'media ' + String(e.message || e).slice(0, 80); } } }
    a.msgs = trim(a.msgs); a.dirty = true; a.meta = meta; await flushChat(k);
    const last = a.msgs[a.msgs.length - 1]; if (last) touchIdx(k, meta, last); else touchIdx(k, meta, null);
    filled.add(k); return { k, n };
  }

  // كل الدردشات من WAHA (لتظهر في القائمة حتى بلا رسالة جديدة)
  let ovBusy = false, ovAt = 0;
  async function overview() {
    if (ovBusy) return; ovBusy = true;
    try {
      await loadIdx();
      let chats = []; try { chats = await waha(`/api/${session}/chats/overview?limit=500&offset=0`); } catch (e) { try { chats = await waha(`/api/${session}/chats?limit=500&offset=0&sortBy=conversationTimestamp&sortOrder=desc`); } catch (e2) { lastErr = 'overview ' + e2.message; } }
      const cut = Date.now() - KEEP;
      for (const c of Array.isArray(chats) ? chats : []) {
        let cid = String(c.id && (c.id._serialized || c.id) || ''); if (!cid || /status@broadcast|@newsletter|@broadcast/.test(cid)) continue;
        cid = await pnOf(cid); const isGroup = /@g\.us$/.test(cid);
        const lm = c.lastMessage || {}; const t = ((+lm.timestamp || +c.conversationTimestamp || +c.timestamp || 0)) * 1000; if (t && t < cut) continue;
        const name = c.name || await chatName(cid, isGroup, ''); if (exclude(name, cid)) continue;
        const k = keyOf(cid); const meta = { id: cid, name, g: isGroup, ph: isGroup ? '' : digits(cid) };
        const cur = idx.get(k);
        if (!cur || (t && t > (cur.lt || 0))) touchIdx(k, meta, t ? { t, x: String(lm.body || '').trim() || (lm.hasMedia ? '📎 مرفق' : ''), me: !!lm.fromMe, g: isGroup, from: '' } : null);
        else if (name && cur.name !== name) { cur.name = name; idxDirty = true; }
      }
      if (idxDirty) await flushIdx(); ovAt = Date.now();
    } finally { ovBusy = false; }
  }

  // طلبات التطبيق: تاريخ دردشة
  const doneReq = new Set();
  async function pollReq() {
    try {
      const d = await getDoc('live/wa_req'); const items = (d && d.items) || [];
      for (const r of items) { if (!r || !r.id || doneReq.has(r.id)) continue; doneReq.add(r.id); if (Date.now() - (+r.at || 0) > 10 * 60e3) continue;
        try { await backfill(String(r.cid || ''), r.limit); } catch (e) { } }
    } catch (e) { lastErr = 'req ' + e.message; }
  }

  // صندوق الإرسال
  const st = new Map(); let stLoaded = false, stDirty = false, recent = [];
  async function loadSt() { if (stLoaded) return; const d = await getDoc('live/wa_out_st'); for (const [id, v] of Object.entries((d && d.items) || {})) st.set(id, v); stLoaded = true; }
  async function saveSt() {
    if (!stDirty) return; stDirty = false; const cut = Date.now() - 3 * 864e5; const items = {};
    for (const [id, v] of st) if ((v.at || 0) >= cut) items[id] = v;
    try { await gas({ op: 'set', path: 'live/wa_out_st', data: { at: new Date().toISOString(), items } }); } catch (e) { stDirty = true; lastErr = 'out-st ' + e.message; }
  }
  let outBusy = false;
  async function pollOut() {
    if (outBusy) return; outBusy = true;
    try {
      await loadSt(); const d = await getDoc('live/wa_out'); const items = (d && d.items) || [];
      for (const it of items) {
        if (!it || !it.id || st.has(it.id)) continue;
        const age = Date.now() - (+it.at || 0); const cid = String(it.cid || ''); const text = String(it.text || '');
        const bad = !/@(c\.us|g\.us)$/.test(cid) ? 'chat' : !text.trim() ? 'empty' : text.length > 4000 ? 'long' : it.by !== 'owner' ? 'by' : age > SEND_TTL ? 'expired' : age < -60e3 ? 'clock' : '';
        if (bad) { st.set(it.id, { st: 'err', err: bad, at: Date.now() }); stDirty = true; continue; }
        if (!SEND_ON) { st.set(it.id, { st: 'err', err: 'off', at: Date.now() }); stDirty = true; continue; }
        recent = recent.filter(t => Date.now() - t < 60e3); if (recent.length >= SEND_RATE) break;
        st.set(it.id, { st: 'sending', at: Date.now() }); stDirty = true; await saveSt();   // يُسجَّل قبل الإرسال: لا إعادة أبداً حتى لو تعطل الخادم
        try {
          const body = { session, chatId: cid, text }; if (it.reply) body.reply_to = String(it.reply);
          const r = await wahaPost('/api/sendText', body); recent.push(Date.now()); sent++;
          const wid = String(r && (r.id && (r.id._serialized || r.id.id || r.id)) || (r && r.key && r.key.id) || '');
          st.set(it.id, { st: 'sent', wid, at: Date.now() }); stDirty = true;
          const isGroup = /@g\.us$/.test(cid); const name = await chatName(cid, isGroup, '');
          add(cid, { name }, { id: wid || ('out:' + it.id), t: Date.now(), me: true, x: text.slice(0, 2000), from: 'أنت', q: it.q ? String(it.q).slice(0, 160) : undefined, out: it.id });
        } catch (e) { sendErr++; st.set(it.id, { st: 'err', err: String(e.message || e).slice(0, 120), at: Date.now() }); stDirty = true; }
      }
      await saveSt();
    } catch (e) { lastErr = 'out ' + e.message; }
    finally { outBusy = false; }
  }

  function start() {
    setTimeout(() => overview().catch(e => { lastErr = 'overview ' + e.message; }), 45e3);
    setInterval(() => overview().catch(() => {}), 30 * 60e3);
    setInterval(pollOut, +E.OUT_POLL_MS || 4000);
    setInterval(pollReq, +E.REQ_POLL_MS || 6000);
  }
  async function flushAll() { await flushIdx(); for (const k of arch.keys()) await flushChat(k); await saveSt(); }
  return { add, keyOf, backfill, overview, pollOut, pollReq, start, flushAll, fromWaha,
    status: () => ({ chats: idx.size, open: arch.size, writes, sent, sendErr, sendOn: SEND_ON, ovAt, lastErr }) };
}
module.exports = { setup };
