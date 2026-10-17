/* إشعارات الجوال: Web Push إلى تطبيق دال نفسه (المثبّت على الشاشة الرئيسية).
   الاشتراكات في live/push_subs يكتبها التطبيق من زر «تفعيل الإشعارات». لا توجد قناة أخرى. */
'use strict';
const E = process.env;
const APP = E.APP_URL || 'https://erihdev.github.io/dal-finance/';
let sent = 0, lastErr = '', recent = [];
let webpush = null;
try { if (E.VAPID_PUBLIC && E.VAPID_PRIVATE) { webpush = require('web-push'); webpush.setVapidDetails(E.VAPID_SUBJECT || 'mailto:dal@dalksa.com', E.VAPID_PUBLIC, E.VAPID_PRIVATE); } } catch (e) { lastErr = 'init ' + e.message; }

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
  // lv: bad = عاجل، warn = مهم، غير ذلك عادي
  async function push({ title, msg, lv, tag, click }) {
    try {
      if (E.PUSH_OFF === '1' || !webpush) return;
      const key = (title || '') + '|' + (msg || ''); if (recent.includes(key)) return; recent = recent.concat(key).slice(-200);   // لا تكرار
      const S = await loadSubs(); const ids = Object.keys(S); if (!ids.length) { lastErr = 'no subs'; return; }
      const payload = JSON.stringify({ title: String(title || 'دال').slice(0, 120), body: String(msg || '').slice(0, 900), url: click || APP, tag: tag || 'dal', lv: lv || 'info' });
      for (const id of ids) {
        const s = S[id] && S[id].sub; if (!s || !s.endpoint) continue;
        try { await webpush.sendNotification(s, payload, { TTL: 6 * 3600, urgency: lv === 'bad' ? 'high' : 'normal' }); sent++; }
        catch (e) { const code = e && e.statusCode; lastErr = (code || '') + ' ' + String(e.body || e.message || e).slice(0, 100); if (code === 404 || code === 410) await dropSub(id); }
      }
    } catch (e) { lastErr = String(e.message || e).slice(0, 160); }
  }
  return { push, reloadSubs: () => loadSubs(true), status: () => ({ web: !!webpush, subs: subs ? Object.keys(subs).length : null, sent, lastErr }) };
}
module.exports = { setup };
