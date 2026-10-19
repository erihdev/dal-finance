importScripts('sync.js');
chrome.webRequest.onBeforeSendHeaders.addListener(d => { onHdr(d); saveHdr(); }, { urls: HOSTS }, ['requestHeaders', 'extraHeaders']);
const ensure = () => chrome.alarms.create('dalsync', { delayInMinutes: 1, periodInMinutes: 30 });
chrome.runtime.onInstalled.addListener(ensure); chrome.runtime.onStartup.addListener(ensure);
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== 'dalsync') return;
  const { pw } = await chrome.storage.local.get('pw'); if (!pw) return;
  try { const { payload } = await collect(true); await sendSessions(pw, payload); await chrome.storage.local.set({ auto: { at: Date.now(), ok: true } }); }
  catch (e) { await chrome.storage.local.set({ auto: { at: Date.now(), ok: false, err: String(e.message || e).slice(0, 60) } }); }
});
