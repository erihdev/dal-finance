/* إشعارات الجوال عبر ntfy (تطبيق ntfy على الجوال، مشترك في موضوع سري).
   الموضوع من NTFY_TOPIC، وإن لم يوجد يُنشأ موضوع عشوائي مرة واحدة ويُحفظ في live/push. */
'use strict';
const E = process.env;
const SERVER = (E.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
const APP = E.APP_URL || 'https://erihdev.github.io/dal-finance/';
let topic = E.NTFY_TOPIC || '', sent = 0, lastErr = '', recent = [];

function setup({ gas }) {
  async function ensure() {
    if (topic) return topic;
    const r = await gas({ op: 'get', paths: ['live/push'] }); const d = ((r.docs || {})['live/push'] || {}).data || {};
    if (d.topic) return (topic = d.topic);
    d.topic = 'dal-' + require('crypto').randomBytes(12).toString('hex'); d.server = SERVER; d.at = new Date().toISOString();
    await gas({ op: 'set', path: 'live/push', data: d }); return (topic = d.topic);
  }
  // lv: bad = عاجل، warn = مهم، غير ذلك عادي
  async function push({ title, msg, lv, tag, click }) {
    try {
      if (E.PUSH_OFF === '1') return;
      const t = await ensure();
      const key = (title || '') + '|' + (msg || ''); if (recent.includes(key)) return; recent = recent.concat(key).slice(-200);   // لا تكرار
      const r = await fetch(SERVER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        topic: t, title: String(title || 'دال').slice(0, 120), message: String(msg || '').slice(0, 900),
        priority: lv === 'bad' ? 5 : lv === 'warn' ? 4 : 3, tags: tag ? [tag] : [], click: click || APP }) });
      if (!r.ok) throw new Error('ntfy ' + r.status); sent++;
    } catch (e) { lastErr = String(e.message || e).slice(0, 160); }
  }
  return { push, ensure, status: () => ({ server: SERVER, hasTopic: !!topic, sent, lastErr }) };
}
module.exports = { setup };
