/* العقل التسويقي — جهة التنفيذ (في متصفح دال السحابي) — قراءة الذكاء + بوابة الاعتماد.
   1) قراءة «الذكاء» من التبويبات الدائمة كل 30 دقيقة → live/mk_intel (أرقام مجمّعة فقط، بلا أسماء ولا جوالات):
      بول أب: الأكثر مبيعاً، الإيرادات، عدد الطلبات، وصول الحملات. بونات: أعداد شرائح الولاء وعملاء يوم الميلاد.
   2) بوابة الاعتماد: لا يُنفَّذ أي مقترح إلا إذا وُجد له قرار «approve» في live/mk_dec كتبه المالك من التطبيق.
      النتيجة في live/mk_runs (مستند منفصل حتى لا يتصادم مع العقل الذي يكتب live/mk_props).
      المنفّذات لكل منصة تُفعَّل واحدة واحدة بعد تعلّم نموذج الإرسال واختباره مع المالك على عميل واحد،
      وكل منصة تحتاج أيضاً متغير تشغيل صريح MK_SEND_<PLATFORM>=1 — بدونهما الحالة «جاهز، والتنفيذ لهذه المنصة لم يُفعّل بعد». */
'use strict';
module.exports = function mkExec(d) {
  const { E, gas, keep } = d; const viewing = d.viewing || (() => false);
  const S = { intelAt: null, intelErr: null, runs: 0, last: null, err: null };
  const get = async p => { const r = await gas({ op: 'get', paths: ['live/' + p] }); return ((r.docs || {})['live/' + p] || {}).data || null; };
  const set = (p, data) => gas({ op: 'set', path: 'live/' + p, data });
  const num = s => { const n = parseFloat(String(s || '').replace(/[^\d.]/g, '')); return isFinite(n) ? n : null; };

  // ---------- 1) الذكاء ----------
  async function pullupIntel(p) {
    const txt = async u => { await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); for (let i = 0; i < 10; i++) { await p.waitForTimeout(1500); const t = await p.evaluate(() => (document.querySelector('main') || document.body).innerText).catch(() => ''); if (t.length > 300 && !/جارٍ التحميل/.test(t.slice(0, 200))) return t; } return ''; };
    const out = {};
    const t = await txt('https://pullupme.io/dashboard');
    const m = (re) => { const x = t.match(re); return x ? x[1] : null; };
    out.revenue = num(m(/الإيرادات\s*\n\s*([\d.,]+)/)); out.orders = num(m(/إجمالي الطلبات\s*\n\s*(\d+)/)); out.prepMin = num(m(/معدل وقت التحضير\s*\n\s*(\d+)/));
    const bs = t.split('الأكثر مبيعاً')[1] || ''; const rows = []; const re = /\n\s*\d+\s*\n([^\n]+)\n\s*دخل\s*([\d.,]+)\s*\n\s*(\d+)\s*\n\s*مباع/g; let r; while ((r = re.exec(bs)) && rows.length < 10) rows.push({ item: r[1].trim(), revenue: num(r[2]), qty: +r[3] });
    out.top = rows;
    const mt = await txt('https://pullupme.io/dashboard/marketing');
    out.reach = { total: num((mt.match(/(\d+)\s*\n\s*الوصول المتوقع/) || [])[1]), lock: num((mt.match(/(\d+)\s*\n\s*على شاشة القفل/) || [])[1]), inApp: num((mt.match(/(\d+)\s*\n\s*داخل التطبيق فقط/) || [])[1]) };
    await p.goto('https://pullupme.io/dashboard', { waitUntil: 'commit', timeout: 45000 }).catch(() => {});
    return out;
  }
  async function bonatIntel(p) {
    await p.goto('https://store.bonat.io/customers', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    let t = ''; for (let i = 0; i < 10; i++) { await p.waitForTimeout(1500); t = await p.evaluate(() => document.body.innerText).catch(() => ''); if (/شرائح الولاء/.test(t) && /عملاء يوم الميلاد/.test(t)) break; }
    const seg = (name) => { const i = t.indexOf(name); if (i < 0) return null; const n = t.slice(i, i + 260).match(/جميع العملاء\s*\n\s*(\d+)/); return n ? +n[1] : null; };
    const out = { segments: { vip: seg('العملاء المميزون'), loyal: seg('العملاء الاوفياء'), regular: seg('العملاء الدائمين'), lost: seg('العملاء المفقودين'), potential: seg('العملاء المحتملين') } };
    const nw = t.slice(t.indexOf('العملاء الجدد')).match(/الشهر الحالي\s*\n\s*(\d+)/); out.segments.newThisMonth = nw ? +nw[1] : null;
    const bi = t.indexOf('عملاء يوم الميلاد'); if (bi >= 0) { const b = t.slice(bi, bi + 300); out.birthday = { all: num((b.match(/جميع العملاء\s*\n\s*(\d+)/) || [])[1]), thisMonth: num((b.match(/الشهر الحالي\s*\n\s*(\d+)/) || [])[1]) }; }
    const li = t.indexOf('العملاء المفقودين'); if (li >= 0) { const b = t.slice(li, li + 400); out.lostBuckets = { m3: num((b.match(/اخر 3 شهور\s*\n\s*(\d+)/) || [])[1]), m3to6: num((b.match(/3 - 6 شهور\s*\n\s*(\d+)/) || [])[1]), m6plus: num((b.match(/اكثر من 6 شهور\s*\n\s*(\d+)/) || [])[1]) }; }
    await p.goto('https://store.bonat.io/', { waitUntil: 'commit', timeout: 45000 }).catch(() => {});
    return out;
  }
  async function intel() {
    if (!keep || !gas || viewing()) return; const doc = { at: new Date().toISOString() };
    try { doc.pullup = await keep.withPage('pullup', pullupIntel); } catch (e) { doc.pullupErr = String(e.message || e).slice(0, 80); }
    try { doc.bonat = await keep.withPage('bonat', bonatIntel); } catch (e) { doc.bonatErr = String(e.message || e).slice(0, 80); }
    try { await set('mk_intel', doc); S.intelAt = doc.at; S.intelErr = doc.pullupErr || doc.bonatErr || null; } catch (e) { S.intelErr = String(e.message || e).slice(0, 80); }
  }

  // ---------- 2) بوابة الاعتماد والتنفيذ ----------
  const ADAPTERS = {   // كل منفّذ يُفعَّل بعد تعلّم نموذج الإرسال في المنصة واختباره مع المالك
    bonat: null, pullup: null, salla: null, foodics: null,
  };
  async function poll() {
    if (!gas) return;
    try {
      const [props, dec, runs0] = await Promise.all([get('mk_props'), get('mk_dec'), get('mk_runs')]);
      const items = (props && props.items) || [], D = (dec && dec.items) || {}, runs = Object.assign({}, (runs0 && runs0.items) || {});
      let ch = false;
      for (const p of items) {
        const dd = D[p.id]; if (!dd || dd.act !== 'approve') continue;   // لا اعتماد = لا تنفيذ
        const done = runs[p.id]; if (done && done.decAt === dd.at) continue;   // نُفّذ هذا الاعتماد بعينه
        const ad = ADAPTERS[p.platform]; const on = E['MK_SEND_' + String(p.platform || '').toUpperCase()] === '1';
        let r;
        if (!ad || !on) r = { status: 'not_wired', msg: 'اعتمدتَ المقترح. التنفيذ في ' + (p.platformName || p.platform) + ' لم يُفعّل بعد — ننفّذه يدوياً أو بعد تفعيل المنفّذ.' };
        else { try { r = await ad(p, dd); } catch (e) { r = { status: 'failed', msg: String(e.message || e).slice(0, 160) }; } }
        runs[p.id] = Object.assign({ decAt: dd.at, at: new Date().toISOString() }, r); ch = true; S.runs++;
      }
      if (ch) await set('mk_runs', { at: new Date().toISOString(), items: runs });
      S.last = new Date().toISOString(); S.err = null;
    } catch (e) { S.err = String(e.message || e).slice(0, 100); }
  }
  return {
    start() { setTimeout(intel, 60e3); setInterval(intel, 30 * 60e3); setInterval(poll, 20e3); },
    intel, poll, ADAPTERS,
    status() { return Object.assign({}, S, { wired: Object.keys(ADAPTERS).filter(k => ADAPTERS[k] && E['MK_SEND_' + k.toUpperCase()] === '1') }); },
  };
};
