/* إشعارات الجوال.
   الأساس: Web Push إلى تطبيق دال نفسه (المثبّت على الشاشة الرئيسية) — الاشتراكات في live/push_subs يكتبها التطبيق من زر «تفعيل الإشعارات».
   الاحتياط: ntfy (NTFY_TOPIC) إن لم يوجد أي اشتراك بعد. */
'use strict';
const E = process.env;
const SERVER = (E.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
const APP = E.APP_URL || 'https://erihdev.github.io/dal-finance/';
let topic = E.NTFY_TOPIC || '', sent = 0, lastErr = '', recent = [], webSent = 0, webErr = '';
let webpush = null;
try { if (E.VAPID_PUBLIC && E.VAPID_PRIVATE) { webpush = require('web-push'); webpush.setVapidDetails(E.VAPID_SUBJECT || 'mailto:dal@dalksa.com', E.VAPID_PUBLIC, E.VAPID_PRIVATE); } } catch (e) { webErr = 'init ' + e.message; }

function setup({ gas }) {
  let subs = null, subsAt = 0;
  async function loadSubs(force) {
    if (!force && subs && Date.now() - subsAt < 5 * 60e3) return subs;
    try { const r = await gas({ op: 'get', paths: ['live/push_subs'] }); const d = ((r.docs || {})['live/push_subs'] || {}).data || {}; subs = d.subs || {}; subsAt = Date.now(); }
    catch (e) { subs = subs || {}; }
    return subs;
  }
  async function dropSub(id) {   // اشتراك منتهٍ (الجهاز ألغى الإذن أو حُذف التطبيق)
    try { const r = await gas({ op: 'get', paths: ['live/push_subs'] }); const d = ((r.docs || {})['live/push_subs'] || {}).data || { subs: {} }; d.subs = d.subs || {}; if (d.subs[id]) { delete d.subs[id]; d.at = new Date().toISOString(); await gas({ op: 'set', path: 'live/push_subs', data: d }); } subs = d.subs; } catch (e) {}
  }
  async function ensure() {
    if (topic) return topic;
    const r = await gas({ op: 'get', paths: ['live/push'] }); const d = ((r.docs || {})['live/push'] || {}).data || {};
    if (d.topic) return (topic = d.topic);
    d.topic = 'dal-' + require('crypto').randomBytes(12).toString('hex'); d.server = SERVER; d.at = new Date().toISOString();
    await gas({ op: 'set', path: 'live/push', data: d }); return (topic = d.topic);
  }
  async function viaWeb(n) {
    if (!webpush) return 0;
    const S = await loadSubs(); const ids = Object.keys(S); if (!ids.length) return 0;
    const payload = JSON.stringify({ title: n.title, body: n.msg, url: n.click || APP, tag: n.tag || 'dal', lv: n.lv || 'info' });
    let ok = 0;
    for (const id of ids) {
      const s = S[id] && S[id].sub; if (!s || !s.endpoint) continue;
      try { await webpush.sendNotification(s, payload, { TTL: 6 * 3600, urgency: n.lv === 'bad' ? 'high' : 'normal' }); ok++; webSent++; }
      catch (e) { const code = e && e.statusCode; webErr = (code || '') + ' ' + String(e.body || e.message || e).slice(0, 100); if (code === 404 || code === 410) await dropSub(id); }
    }
    return ok;
  }
  // lv: bad = عاجل، warn = مهم، غير ذلك عادي
  async function push({ title, msg, lv, tag, click }) {
    try {
      if (E.PUSH_OFF === '1') return;
      const key = (title || '') + '|' + (msg || ''); if (recent.includes(key)) return; recent = recent.concat(key).slice(-200);   // لا تكرار
      const n = { title: String(title || 'دال').slice(0, 120), msg: String(msg || '').slice(0, 900), lv, tag, click };
      if (await viaWeb(n)) { sent++; return; }
      const t = await ensure(); if (!t) return;
      const r = await fetch(SERVER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        topic: t, title: n.title, message: n.msg, priority: lv === 'bad' ? 5 : lv === 'warn' ? 4 : 3, tags: tag ? [tag] : [], click: click || APP }) });
      if (!r.ok) throw new Error('ntfy ' + r.status); sent++;
    } catch (e) { lastErr = String(e.message || e).slice(0, 160); }
  }
  return { push, ensure, reloadSubs: () => loadSubs(true), status: () => ({ server: SERVER, hasTopic: !!topic, sent, lastErr, web: !!webpush, webSubs: subs ? Object.keys(subs).length : null, webSent, webErr }) };
}
module.exports = { setup };
