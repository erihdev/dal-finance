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
    await txt('https://pullupme.io/dashboard/menu');   // صور المنتجات: من منيو بول أب فقط (بقرار المالك)
    out.images = await p.evaluate(() => [...document.querySelectorAll('main img')].map(i => { const card = i.closest('div,li,article'); const ar = ((card && card.parentElement ? card.parentElement.innerText : '').split('\n').map(x => x.trim()).filter(Boolean)[0]) || ''; const u = String(i.currentSrc || i.src || ''); return /pullupme\.io\/uploads\//.test(u) ? { en: (i.alt || '').trim(), ar, url: u.split('?')[0] } : null; }).filter(Boolean)).catch(() => []);
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
  // ---------- منفّذ بونات: «إرسال هدية من قالب» في store.bonat.io/gifts ----------
  /* ما تم التحقق منه (20 أكتوبر 2026، قراءة فقط، بلا إرسال):
     - الإرسال يتم من قالب موجود: بطاقة القالب ← زر «إرسال هدية» ← درج «أرسل هدية من القالب».
     - الدرج: «جميع العملاء» | «عملاء محددون» (يفتح «إختر عملاء للإهداء»)، ثم «إرسال الآن» | «جدولة الإرسال»، وأسفله «إرسال هدية» (submit).
     - شاشة اختيار العملاء: شرائح الولاء (عميل جديد/مفقود/محتمل/مميز/وفي/دائم)، خانة «عملاء الميلاد» (تُرسل الهدية يوم ميلاد العميل فقط)،
       الجنس، العمر، المدن، الفروع، آخر زيارة، عملاء التطبيق، وقائمة مخصصة (بحث باسم/جوال + «إضافة أرقام»)، ثم «حفظ الاختيار».
     - إنشاء القالب (نسبة مئوية): عنوان القالب، قيمة الخصم %، الحد الأعلى، عنوان إنجليزي/عربي (70 حرفاً)، ينطبق على، الصلاحية، تعطيل إعادة الإهداء.
     لم يُتحقق منه بعد (لذلك يُرفض عمداً): واجهة تاريخ/وقت «جدولة الإرسال»، حقول إنشاء قالب «كوب قهوة/مبلغ ثابت»، وظيفة زر «إرسال الآن» داخل شاشة اختيار العملاء. */
  const BONAT_SEG = { new: 'عميل جديد', lost: 'عميل مفقود', potential: 'عميل محتمل', vip: 'عميل مميز', loyal: 'عميل وفي', regular: 'عميل دائم' };
  const BONAT_SEG_AR = { 'العملاء الجدد': 'new', 'الجدد': 'new', 'المفقودون': 'lost', 'العملاء المفقودين': 'lost', 'المحتملون': 'potential', 'العملاء المحتملين': 'potential', 'المميزون': 'vip', 'العملاء المميزون': 'vip', 'الأوفياء': 'loyal', 'العملاء الأوفياء': 'loyal', 'الدائمون': 'regular', 'العملاء الدائمين': 'regular' };
  const normPhone = s => { const d = String(s || '').replace(/\D/g, ''); return d.startsWith('966') ? '+' + d : d.startsWith('05') ? '+966' + d.slice(1) : d.startsWith('5') ? '+966' + d : d; };
  async function bonatGift(prop, dec) {
    const dry = E.MK_BONAT_DRY !== '0';                 // الافتراضي تجربة: يملأ ولا يضغط الإرسال النهائي إلا إذا MK_BONAT_DRY=0
    const test = normPhone(E.MK_BONAT_TEST_PHONE);      // حارس الاختبار: إن وُجد لا يُرسَل إلا إلى هذا الرقم
    const aud = prop.audience || {}, copy = prop.copy || {};
    if (prop.action !== 'gift') return { status: 'unsupported', msg: 'بونات: المنفّذ يدعم «هدية» فقط.' };
    if (prop.schedule && prop.schedule !== 'now') return { status: 'unsupported', msg: 'جدولة الإرسال في بونات لم يُتعلَّم نموذجها بعد — أرسل الآن أو جدول يدوياً.' };
    const phone = aud.phone ? normPhone(aud.phone) : null;
    const seg = BONAT_SEG_AR[aud.segment] || (BONAT_SEG[aud.segment] ? aud.segment : null);
    if (!phone && !seg && !aud.birthday) return { status: 'unsupported', msg: 'بونات: حدّد عميلاً (aud.phone) أو شريحة ولاء أو عملاء الميلاد.' };
    if (test && (!phone || phone !== test)) return { status: 'blocked', msg: 'وضع الاختبار: الإرسال مسموح لرقم الاختبار فقط.' };
    return keep.withPage('bonat', async p => {
      await p.goto('https://store.bonat.io/gifts', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await p.waitForSelector('text=قوالب الهدايا', { timeout: 20000 });
      // القالب: يُطابَق بعنوانه العربي حرفياً (لا إنشاء تلقائي لقوالب جديدة)
      const want = String(copy.title_ar || prop.templateTitle || '').trim();
      if (!want) return { status: 'needs_template', msg: 'لم يُحدَّد عنوان القالب (copy.title_ar).' };
      const card = p.locator('div').filter({ hasText: want }).filter({ has: p.getByRole('button', { name: 'إرسال هدية' }) }).last();
      if (!(await card.count())) return { status: 'needs_template', msg: 'لا يوجد قالب بعنوان «' + want + '» في بونات — يُنشأ يدوياً أولاً.' };
      await card.getByRole('button', { name: 'إرسال هدية' }).click();
      const drawer = p.getByRole('dialog').filter({ hasText: 'أرسل هدية من القالب' });
      await drawer.waitFor({ timeout: 10000 });
      if (phone || seg || aud.birthday) {
        await drawer.getByText('عملاء محددون').click();
        const pick = p.getByRole('dialog').filter({ hasText: 'إختر عملاء للإهداء' }).last();
        await pick.waitFor({ timeout: 10000 });
        if (seg) await pick.getByText(BONAT_SEG[seg] || seg, { exact: true }).click();
        if (aud.birthday) await pick.locator('label', { hasText: 'عملاء الميلاد' }).locator('input[type=checkbox]').check({ force: true });
        if (phone) {
          const inp = pick.getByRole('combobox', { name: 'select-customer-input' }); await inp.fill(phone.replace('+966', '0'));
          await p.waitForTimeout(1500);
          const hit = pick.locator('[role=option]').first(); if (!(await hit.count())) return { status: 'failed', msg: 'لم يُعثر على العميل برقم الاختبار في بونات.' };
          await hit.click();
        }
        await pick.getByRole('button', { name: 'حفظ الاختيار' }).click();
      } else await drawer.getByText('جميع العملاء').click();
      await drawer.getByText('إرسال الآن', { exact: true }).first().click();
      const send = drawer.getByRole('button', { name: 'إرسال هدية' });
      if (dry) return { status: 'dry_run', msg: 'تجربة: مُلئ نموذج بونات (قالب «' + want + '») ولم يُضغط الإرسال.' };
      await send.click(); await p.waitForTimeout(3000);
      return { status: 'sent', msg: 'أُرسلت الهدية من القالب «' + want + '».' };
    });
  }
  const ADAPTERS = {   // كل منفّذ يُفعَّل بعد تعلّم نموذج الإرسال في المنصة واختباره مع المالك
    bonat: bonatGift, pullup: null, salla: null, foodics: null,
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
