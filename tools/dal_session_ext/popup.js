const SERVER = 'https://browser-production-10fb.up.railway.app';
const SITES = [
  { k: 'foodics', name: 'فودكس', domains: ['foodics.com'], origins: ['https://console.foodics.com', 'https://accounting.foodics.com'] },
  { k: 'retm', name: 'رتم', domains: ['retm.sa'], origins: ['https://retm.sa'] },
  { k: 'bonat', name: 'بونات', domains: ['bonat.io'], origins: ['https://store.bonat.io', 'https://dashboard-api.bonat.io'] },
  { k: 'olu', name: 'علو', domains: ['olu.sa'], origins: ['https://hr.olu.sa'] },
  { k: 'salla', name: 'سلة', domains: ['salla.sa'], origins: ['https://s.salla.sa'], apiHost: 'api.salla.dev' },
];
const $ = id => document.getElementById(id);
chrome.storage.local.get('pw').then(r => { if (r.pw) $('pw').value = r.pw; });
// التقاط كوكي التصريح المخفي (HttpOnly/مقسّم) من ترويسة الطلب الحقيقية التي يرسلها المتصفح
const HDR = {};   // host -> "name=val; name2=val2" (ترويسة Cookie)
const HDRA = {};  // host -> "Bearer ..." (ترويسة Authorization، مثل سلة)
function watchHeaders(hostPatterns) {
  const listener = d => {
    const host = new URL(d.url).host;
    const c = (d.requestHeaders || []).find(x => x.name.toLowerCase() === 'cookie'); if (c && c.value) HDR[host] = c.value;
    const a = (d.requestHeaders || []).find(x => x.name.toLowerCase() === 'authorization'); if (a && a.value && /^bearer /i.test(a.value)) HDRA[host] = a.value;
  };
  try { chrome.webRequest.onBeforeSendHeaders.addListener(listener, { urls: hostPatterns }, ['requestHeaders', 'extraHeaders']); } catch (e) {}
  return () => { try { chrome.webRequest.onBeforeSendHeaders.removeListener(listener); } catch (e) {} };
}
async function openBriefly(origin, waitMs) {   // يفتح الموقع لحظات ليُصدر طلباته (فتلتقط الترويسة) ثم يغلقه
  const tmp = await chrome.tabs.create({ url: origin + '/', active: false });
  await new Promise(ok => { const f = (id, i) => { if (id === tmp.id && i.status === 'complete') { chrome.tabs.onUpdated.removeListener(f); ok(); } }; chrome.tabs.onUpdated.addListener(f); setTimeout(ok, 15000); });
  await new Promise(ok => setTimeout(ok, waitMs || 7000));
  await chrome.tabs.remove(tmp.id).catch(() => {});
}
function cookiesFromHeader(host, hdr, topLevelSite) {   // يحوّل ترويسة Cookie إلى كائنات كوكي للخادم (بلا إظهار القيم)
  if (!hdr) return [];
  return hdr.split(/;\s*/).map(p => { const i = p.indexOf('='); return i < 0 ? null : { name: p.slice(0, i), value: p.slice(i + 1), domain: host, hostOnly: true, path: '/', secure: true, sameSite: 'no_restriction', expirationDate: Math.floor(Date.now() / 1000) + 180 * 86400, partitionKey: { topLevelSite } }; }).filter(Boolean);
}
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
  $('out').textContent = 'جارٍ النقل… (قد يفتح بونات لحظة ثم يُغلق)';
  // نراقب ترويسات بونات وسلة، ثم نفتح الموقعين لحظة لالتقاط مفاتيح الدخول المخفية
  const stop = watchHeaders(['*://dashboard-api.bonat.io/*', '*://store.bonat.io/*', '*://api.salla.dev/*', '*://s.salla.sa/*']);
  try { await openBriefly('https://store.bonat.io', 8000); } catch (e) {}
  try { await openBriefly('https://s.salla.sa', 8000); } catch (e) {}
  const payload = { sites: {}, authHeaders: {} }; const lines = [];
  for (const s of SITES) {
    let cookies = [], seen = new Set();   // نجمع الكوكيز بالنطاق والعنوان والكوكيز المقسّمة (CHIPS) لكل خدمة
    const add = arr => { for (const c of arr || []) { const id = c.name + '@' + c.domain + c.path + '|' + (c.partitionKey ? (c.partitionKey.topLevelSite || JSON.stringify(c.partitionKey)) : ''); if (!seen.has(id)) { seen.add(id); cookies.push(c); } } };
    const tops = [...new Set(s.domains.map(d => 'https://' + d).concat(s.origins))];   // مفاتيح التقسيم المحتملة
    for (const d of s.domains) { try { add(await chrome.cookies.getAll({ domain: d })); } catch (e) {} }
    for (const o of s.origins) { try { add(await chrome.cookies.getAll({ url: o + '/' })); } catch (e) {} }
    for (const t of tops) {
      for (const d of s.domains) { try { add(await chrome.cookies.getAll({ domain: d, partitionKey: { topLevelSite: t } })); } catch (e) {} }
      for (const o of s.origins) { try { add(await chrome.cookies.getAll({ url: o + '/', partitionKey: { topLevelSite: t } })); } catch (e) {} }
    }
    if (s.k === 'bonat') { add(cookiesFromHeader('dashboard-api.bonat.io', HDR['dashboard-api.bonat.io'], 'https://bonat.io')); add(cookiesFromHeader('store.bonat.io', HDR['store.bonat.io'], 'https://bonat.io')); }
    const storage = {};
    for (const o of s.origins) { try { const st = await storageOf(o); if (st) storage[o] = st; } catch (e) {} }
    payload.sites[s.k] = { cookies, storage };
    let tk = '';
    if (s.k === 'bonat') { try { tk = JSON.parse(((storage['https://store.bonat.io'] || {}).local || {}).user || '{}').token ? ' · مفتاح الدخول ✓' : ' · ⚠️ لا يوجد مفتاح دخول (افتح بونات وسجّل دخولك)'; } catch (e) { tk = ' · ⚠️'; } }
    if (s.apiHost && HDRA[s.apiHost]) { payload.authHeaders[s.apiHost] = HDRA[s.apiHost]; tk = ' · مفتاح الواجهة ✓'; }
    else if (s.apiHost) tk = ' · ⚠️ افتح ' + s.name + ' وسجّل دخولك';
    lines.push(`${s.name}: ${cookies.length} كوكي${Object.keys(storage).length ? ' + تخزين' : ''}${tk}`);
  }
  try {
    const r = await fetch(SERVER + '/import', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa('dal:' + pw) }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.err || r.status);
    $('out').innerHTML = '✅ انتقلت الجلسات:<br>' + lines.join('<br>') + '<br><br>نتيجة الفحص بعد دقيقة تقريباً تظهر في تطبيق دال.';
  } catch (e) { $('out').textContent = '❌ تعذّر النقل: ' + e.message + ' — تأكد من الرمز.'; }
  finally { stop(); }
};
