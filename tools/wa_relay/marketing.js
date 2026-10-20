/* العقل التسويقي — جهة التفكير (خدمة relay، فيها مفتاح Claude).
   يقرأ: المنتجات وتكاليفها (live/foodics)، ذكاء المنصات (live/mk_intel: الأكثر مبيعاً في بول أب، شرائح بونات وعملاء يوم الميلاد)،
   التقويم التسويقي، معرفة أدوات كل منصة، وقرارات المالك السابقة (live/mk_dec) ليتعلم مما رُفض.
   يكتب: مقترحات في live/mk_props بالحالة «بانتظار الاعتماد» فقط. لا يرسل شيئاً لأي منصة أبداً — التنفيذ في متصفح دال بعد ضغط المالك «اعتماد ونشر».
   يعمل يومياً 9 صباحاً بتوقيت الرياض، وعند طلب المالك من التطبيق (live/mk_req). */
'use strict';
const E = process.env;
const MODEL = E.MK_MODEL || E.MODEL || 'claude-sonnet-5-5', AKEY = E.ANTHROPIC_API_KEY;

// أدوات كل منصة كما تحققنا منها من لوحات دال (20 أكتوبر 2026). ما ليس هنا لا يُقترح.
const KNOW = {
  bonat: { name: 'بونات', verified: true, actions: {
    gift: 'هدية لعملاء: نوعها (كوب قهوة مجاني | خصم نسبة % مع حد أعلى | خصم مبلغ ثابت)، تنطبق على الطلب أو منتجات محددة، صلاحية (3 أيام | أسبوع | أسبوعان | شهر)، عنوان عربي وإنجليزي حتى 70 حرفاً، قوالب (مرحباً، شكراً، افتقدناك، تعويض، مخصص)، المستهدفون: جميع العملاء أو عملاء محددون أو شريحة، إرسال الآن أو جدولة.' },
    segments: 'المميزون (أكثر من زيارة أسبوعياً)، الأوفياء (زيارة كل أسبوعين على الأقل)، الدائمون (مرة شهرياً على الأقل)، الجدد (آخر شهر)، المفقودون (لم يزر منذ شهر وأكثر من 5 زيارات؛ آخر 3 شهور / 3–6 / أكثر من 6)، المحتملون (لم يزر منذ شهر و5 زيارات أو أقل)، عملاء يوم الميلاد (هذا الشهر).',
    notes: 'نقطة لكل ريال، صلاحية النقاط سنة. الرسائل التسويقية SMS في بونات تحتاج ترقية الباقة — لا تقترحها.' },
  pullup: { name: 'بول أب', verified: true, actions: {
    push: 'إشعار بث: نص عربي ونص إنجليزي، استهداف (الكل | عملاء مختارون | الجنس | أقل عدد طلبات | العمر من-إلى)، وجهة الضغط (المتجر | المنيو | العروض | رابط). يصل على شاشة القفل لجزء فقط من المشتركين والبقية داخل التطبيق.',
    offer: 'عرض/إعلان داخل التطبيق لجميع العملاء أو مستخدمين محددين، منه منتج مجاني هدية. العروض تمر بموافقة بول أب.',
    ad: 'إعلان كاروسيل مدفوع أعلى التطبيق، صورة 16:7، 299 ريال للمنطقة أو 399 ريال شامل لكل 10 أيام (تحويل بنكي) — لا تقترحه إلا لمناسبة كبيرة واذكر التكلفة.' },
    notes: 'تطبيق طلب مسبق واستلام. معدل النقر التاريخي ~2–3%؛ أفضل حملة سابقة: بوكس اليوم الوطني (3.3%).' },
  salla: { name: 'سلة', verified: true, actions: {
    coupon: 'كوبون خصم في المتجر الإلكتروني (حبوب القهوة وبوكسات).',
    promo: 'عروض ترويجية (اشترِ X واحصل على Y، خصم على تصنيف).',
    campaign: 'حملة رسائل نصية وإشعارات تطبيق لعملاء المتجر (متاحة في باقة برو).',
    reminders: 'تذكير السلات المتروكة وتذكيرات إعادة الشراء.' },
    notes: 'المتجر يبيع الحبوب 250 غ والبوكسات؛ دورة شراء الحبوب أبطأ من الكافيه.' },
};
// التقويم (تواريخ تقديرية للهجري حسب أم القرى)
const CAL = [
  ['2026-11-27', 'الجمعة البيضاء'], ['2027-02-08', 'بداية رمضان (تقديري)'], ['2027-02-22', 'يوم التأسيس'], ['2027-03-09', 'عيد الفطر (تقديري)'],
  ['2027-03-11', 'يوم العلم'], ['2027-05-16', 'عيد الأضحى (تقديري)'], ['2027-09-23', 'اليوم الوطني'], ['2027-10-01', 'اليوم العالمي للقهوة'],
];
const RULES = `قواعد لا تُكسر:
- لا تستخدم علم المملكة ولا شعار الدولة ولا صور أو أسماء القيادة في أي نص أو تصميم (حتى في اليوم الوطني ويوم التأسيس ويوم العلم).
- لا تقترح التعاقد مع مؤثر إلا بترخيص «موثوق».
- اقترح فقط أدوات موجودة في معرفة المنصات المرفقة؛ لا تخترع ميزة.
- كل مقترح يجب أن يستند إلى دليل من البيانات المرفقة (منتج، رقم، شريحة، مناسبة) واذكره في why.
- الأسعار والتكاليف من بيانات فودكس المرفقة فقط؛ إن لم توجد التكلفة فاكتب null ولا تخمّن.
- النص العربي سعودي بسيط ودافئ، والإنجليزي طبيعي؛ العناوين قصيرة (حتى 40 حرفاً)، والإشعار حتى 120 حرفاً.
- لا تكرر مقترحاً بنفس الفكرة موجوداً في «المقترحات الحالية»، وتعلّم من «المرفوضة».`;
const SYS = `أنت مسؤول التسويق في «محمصة دال للقهوة المختصة» (صبيا، جازان). تجهّز مقترحات حملات جاهزة ليعتمدها المالك بضغطة، ثم تُنفَّذ في المنصة.
${RULES}
سلّم عبر الأداة submit_proposals بهذا الشكل: {"proposals":[{"key":"معرّف قصير ثابت للفكرة بالإنجليزية","kind":"birthday|winback|occasion|product|loyalty|cart","title":"عنوان المقترح للمالك","platform":"bonat|pullup|salla","action":"gift|push|offer|coupon|promo|campaign","audience":{"segment":"اسم الشريحة كما في المنصة","label":"وصف للمالك","est":عدد تقديري أو null},"offer":{"type":"free_item|percent|fixed|none","item":"اسم المنتج كما في فودكس أو null","value":رقم أو null,"max":رقم أو null,"expires":"3d|1w|2w|1m|null"},"copy":{"title_ar":"","title_en":"","body_ar":"","body_en":""},"creative":{"headline_ar":"","headline_en":"","sub_ar":"","sub_en":"","product":"اسم المنتج للصورة أو null","sizes":["1080x1920","1080x1350","1680x735"]},"schedule":"now أو تاريخ ووقت مقترح YYYY-MM-DD HH:mm","why":["دليل 1","دليل 2"],"cost":{"per_unit_sar":رقم أو null,"est_units":رقم أو null,"est_total_sar":رقم أو null,"note":"افتراضك"}}]}
استدعِ الأداة submit_proposals مرة واحدة فقط ولا تكتب نصاً خارجها. أعد من 3 إلى 6 مقترحات متنوعة (منصات وأهداف مختلفة)، الأقوى أولاً.`;

function setup({ gas }) {
  const get = async p => { const r = await gas({ op: 'get', paths: ['live/' + p] }); return ((r.docs || {})['live/' + p] || {}).data || null; };
  const set = (p, data) => gas({ op: 'set', path: 'live/' + p, data });
  const S = { at: null, n: 0, err: null, lastReq: 0, busy: false };
  async function claude(user) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': AKEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, system: SYS, messages: [{ role: 'user', content: user }],
        tools: [{ name: 'submit_proposals', description: 'سلّم المقترحات بالشكل المحدد في التعليمات', input_schema: { type: 'object', properties: { proposals: { type: 'array', items: { type: 'object' } } }, required: ['proposals'] } }] }) });   // مخرجات منظّمة: لا أخطاء JSON من علامات التنصيص في النص العربي
    const j = await r.json(); if (!r.ok) throw new Error('claude ' + r.status + ' ' + JSON.stringify(j).slice(0, 160));
    const tu = (j.content || []).find(c => c.type === 'tool_use'); if (tu) return tu.input || {};
    const raw = (j.content || []).map(c => c.text || '').join(''); return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));   // احتياط إن لم يستخدم الأداة
  }
  const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  async function run(reason) {
    if (S.busy || !AKEY || !gas) return; S.busy = true;
    try {
      const [fx, intel, props0, dec] = await Promise.all([get('foodics'), get('mk_intel'), get('mk_props'), get('mk_dec')]);
      const props = (props0 && props0.items) || [], D = (dec && dec.items) || {};
      const pending = props.filter(p => !D[p.id]);
      if (pending.length >= 8 && reason !== 'request') { S.err = 'pending-full'; return; }
      const P = ((fx && fx.con && fx.con.products) || []).map(p => ({ name: p[0], cat: p[1], price: p[2], cost: p[3], margin: p[2] && p[3] ? Math.round((p[2] / 1.15 - p[3]) / (p[2] / 1.15) * 100) : null }));
      const t = today(); const soon = CAL.filter(c => c[0] >= t && (Date.parse(c[0]) - Date.parse(t)) / 864e5 <= 45).map(c => c[1] + ' ' + c[0]);
      const rejected = props.filter(p => D[p.id] && D[p.id].act === 'reject').slice(-10).map(p => p.title + (D[p.id].note ? ' — سبب الرفض: ' + D[p.id].note : ''));
      const user = `اليوم ${t}.
المناسبات خلال 45 يوماً: ${soon.join('، ') || 'لا يوجد'}.
معرفة المنصات: ${JSON.stringify(KNOW)}
ذكاء المنصات (مجمّع، قُرئ ${intel && intel.at || '—'}): ${JSON.stringify({ pullup: intel && intel.pullup && Object.assign({}, intel.pullup, { images: undefined }), bonat: intel && intel.bonat })}
منتجات لها صورة في منيو بول أب (اختر creative.product منها حرفياً بالاسم العربي ليظهر المنتج في التصميم): ${JSON.stringify(((intel && intel.pullup && intel.pullup.images) || []).map(x => x.ar).filter(Boolean))}
منتجات فودكس (الاسم، التصنيف، السعر شامل الضريبة، التكلفة، الهامش%): ${JSON.stringify(P.slice(0, 120))}
المقترحات الحالية بانتظار الاعتماد: ${JSON.stringify(pending.map(p => p.title))}
المرفوضة مؤخراً: ${JSON.stringify(rejected)}`;
      const out = await claude(user);
      { const L0 = out.proposals || []; console.log('mk raw', typeof out.proposals, L0.length, JSON.stringify(L0.map(x => [x && x.key, x && x.platform])).slice(0, 300), JSON.stringify(out).slice(0, 200)); if (typeof out.proposals === 'string') { try { out.proposals = JSON.parse(out.proposals); } catch (e) {} } }
      const now = new Date().toISOString(); const keys = new Set(props.filter(p => !D[p.id] || D[p.id].act !== 'reject').map(p => p.key));
      const fresh = (out.proposals || []).filter(x => x && x.key && !keys.has(x.key) && KNOW[x.platform]).map((x, i) => Object.assign({}, x, {
        id: 'MK' + Date.now().toString(36) + i, at: now, platformName: KNOW[x.platform].name, by: 'claude', reason: reason || 'daily' }));
      if (fresh.length) await set('mk_props', { at: now, items: props.concat(fresh).slice(-200) });
      S.at = now; S.n += fresh.length; S.err = null;
    } catch (e) { S.err = String(e.message || e).slice(0, 160); }
    finally { S.busy = false; console.log('mk run', reason, JSON.stringify({ n: S.n, err: S.err })); set('mk_status', Object.assign({}, S, { reason })).catch(() => {}); }
  }
  async function checkReq() { try { const r = await get('mk_req'); const ts = (r && r.ts) || 0; if (!S.init) { S.init = true; S.lastReq = ts; return; } if (ts && ts !== S.lastReq) { S.lastReq = ts; console.log('mk request', ts); await run('request'); } } catch (e) { console.log('mk req err', e.message); } }   // أول قراءة بعد التشغيل تحفظ آخر طلب فقط
  function daily() { const k = new Date(Date.now() + 3 * 3600e3); if (k.getUTCHours() === 9 && k.getUTCMinutes() < 10) run('daily'); }
  return { start() { setTimeout(checkReq, 30e3); setInterval(checkReq, 30e3); setInterval(daily, 10 * 60e3); }, run, status: () => Object.assign({}, S), KNOW, CAL };
}
module.exports = { setup, KNOW, CAL };
