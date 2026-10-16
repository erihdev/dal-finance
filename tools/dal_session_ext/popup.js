const SERVER = 'https://browser-production-10fb.up.railway.app';
const SITES = [
  { k: 'foodics', name: 'فودكس', domains: ['foodics.com'], origins: ['https://console.foodics.com', 'https://accounting.foodics.com'] },
  { k: 'retm', name: 'رتم', domains: ['retm.sa'], origins: ['https://retm.sa'] },
  { k: 'bonat', name: 'بونات', domains: ['bonat.io'], origins: ['https://store.bonat.io'] },
  { k: 'olu', name: 'علو', domains: ['olu.sa'], origins: ['https://hr.olu.sa'] },
];
const $ = id => document.getElementById(id);
chrome.storage.local.get('pw').then(r => { if (r.pw) $('pw').value = r.pw; });
async function storageOf(origin) {   // localStorage/sessionStorage من تبويب مفتوح لنفس الموقع (بعض المنصات تحفظ الدخول هناك)
  let tabs = await chrome.tabs.query({ url: origin + '/*' }), tmp = null;
  if (!tabs.length) {   // لا يوجد تبويب مفتوح: نفتحه بالخلفية لحظات ثم نغلقه
    tmp = await chrome.tabs.create({ url: origin + '/', active: false });
    await new Promise(ok => { const f = (id, i) => { if (id === tmp.id && i.status === 'complete') { chrome.tabs.onUpdated.removeListener(f); ok(); } }; chrome.tabs.onUpdated.addListener(f); setTimeout(ok, 15000); });
    await new Promise(ok => setTimeout(ok, 2500));
    tabs = [tmp];
  }
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: () => ({ local: Object.assign({}, localStorage), session: Object.assign({}, sessionStorage) }) });
    return r && r.result;
  } finally { if (tmp) chrome.tabs.remove(tmp.id).catch(() => {}); }
}
$('go').onclick = async () => {
  const pw = $('pw').value.trim(); if (!pw) { $('out').textContent = 'اكتب الرمز أولاً'; return; }
  await chrome.storage.local.set({ pw });
  $('out').textContent = 'جارٍ النقل…';
  const payload = { sites: {} }; const lines = [];
  for (const s of SITES) {
    let cookies = [];
    for (const d of s.domains) cookies = cookies.concat(await chrome.cookies.getAll({ domain: d }));
    const storage = {};
    for (const o of s.origins) { try { const st = await storageOf(o); if (st) storage[o] = st; } catch (e) {} }
    payload.sites[s.k] = { cookies, storage };
    let tk = '';
    if (s.k === 'bonat') { try { tk = JSON.parse(((storage['https://store.bonat.io'] || {}).local || {}).user || '{}').token ? ' · مفتاح الدخول ✓' : ' · ⚠️ لا يوجد مفتاح دخول (افتح بونات وسجّل دخولك)'; } catch (e) { tk = ' · ⚠️'; } }
    lines.push(`${s.name}: ${cookies.length} كوكي${Object.keys(storage).length ? ' + تخزين' : ''}${tk}`);
  }
  try {
    const r = await fetch(SERVER + '/import', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa('dal:' + pw) }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.err || r.status);
    $('out').innerHTML = '✅ انتقلت الجلسات:<br>' + lines.join('<br>') + '<br><br>نتيجة الفحص بعد دقيقة تقريباً تظهر في تطبيق دال.';
  } catch (e) { $('out').textContent = '❌ تعذّر النقل: ' + e.message + ' — تأكد من الرمز.'; }
};
