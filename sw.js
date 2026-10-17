/* عامل الخدمة لتطبيق دال: إشعارات الجوال فقط (لا تخزين للصفحات حتى لا يعلق التطبيق على نسخة قديمة). */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'دال';
  const opts = { body: d.body || '', tag: d.tag || 'dal-' + Date.now(), renotify: true, data: { url: d.url || './' }, icon: 'icon-192.png', badge: 'icon-192.png', dir: 'rtl', lang: 'ar' };
  e.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if (c.url.indexOf(self.registration.scope) === 0) { if (c.navigate) c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
