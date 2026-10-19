const $ = id => document.getElementById(id);
chrome.storage.local.get(['pw', 'auto']).then(r => { if (r.pw) $('pw').value = r.pw; const a = r.auto; $('auto').textContent = a ? ('النقل التلقائي: آخر مرة ' + new Date(a.at).toLocaleTimeString('ar-SA', { hour: 'numeric', minute: '2-digit' }) + (a.ok ? ' ✓' : ' ✗ ' + (a.err || ''))) : 'النقل التلقائي يبدأ بعد أول نقل يدوي، كل 30 دقيقة.'; });
$('go').onclick = async () => {
  const pw = $('pw').value.trim(); if (!pw) { $('out').textContent = 'اكتب الرمز أولاً'; return; }
  await chrome.storage.local.set({ pw });
  $('out').textContent = 'جارٍ النقل… (قد يفتح بونات وسلة وتمارا لحظة ثم تُغلق)';
  const L = d => onHdr(d); try { chrome.webRequest.onBeforeSendHeaders.addListener(L, { urls: HOSTS }, ['requestHeaders', 'extraHeaders']); } catch (e) {}
  try {
    try { await openBriefly('https://store.bonat.io', 8000); } catch (e) {}
    try { await openBriefly('https://s.salla.sa', 8000); } catch (e) {}
    try { await openBriefly('https://partners.tamara.co/#/invoices/list', 9000); } catch (e) {}
    const { payload, lines } = await collect(false);
    await sendSessions(pw, payload);
    await chrome.storage.local.set({ auto: { at: Date.now(), ok: true } });
    $('out').innerHTML = '✅ انتقلت الجلسات:<br>' + lines.join('<br>') + '<br><br>ومن الآن تنتقل تلقائياً كل 30 دقيقة ما دام كروم مفتوحاً.';
  } catch (e) { $('out').textContent = '❌ تعذّر النقل: ' + e.message + ' — تأكد من الرمز.'; }
  finally { try { chrome.webRequest.onBeforeSendHeaders.removeListener(L); } catch (e) {} }
};
