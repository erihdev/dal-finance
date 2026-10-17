/* إيميل المحمصة → تطبيق دال (قراءة فقط).
   يُنشأ في script.google.com وأنت داخل حساب إيميل المحمصة.
   الإعداد مرة واحدة: Project Settings → Script Properties → أضف:
     DAL_KEY   = مفتاح دال (نفس الموجود في Railway)
   ثم شغّل الدالة setup مرة واحدة ووافق على صلاحية قراءة Gmail. */
var ENDPOINT = 'https://browser-production-10fb.up.railway.app/mail';

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkMail').timeBased().everyMinutes(5).create();
  checkMail(true);   // أول تشغيل: يحفظ الموجود بدون إشعارات
}

function checkMail(seedOnly) {
  var P = PropertiesService.getScriptProperties();
  var key = P.getProperty('DAL_KEY'); if (!key) throw new Error('أضف DAL_KEY في Script Properties');
  var seen = JSON.parse(P.getProperty('SEEN') || '{}'), now = Date.now(), out = [];
  var threads = GmailApp.search('in:inbox newer_than:2d -category:promotions -category:social', 0, 30);
  threads.forEach(function (th) {
    var ms = th.getMessages(), m = ms[ms.length - 1], id = m.getId();
    if (seen[id]) return; seen[id] = now;
    var from = m.getFrom(), name = from.replace(/<.*>/, '').replace(/"/g, '').trim(), email = (from.match(/<(.+)>/) || [, from])[1];
    out.push({ id: id, subject: m.getSubject(), from: name, email: email,
      summary: m.getPlainBody().replace(/\s+/g, ' ').slice(0, 220),
      when: Utilities.formatDate(m.getDate(), 'Asia/Riyadh', 'd/M h:mm a') });
  });
  for (var k in seen) if (seen[k] < now - 30 * 864e5) delete seen[k];
  P.setProperty('SEEN', JSON.stringify(seen));
  if (seedOnly === true || !out.length) return;
  UrlFetchApp.fetch(ENDPOINT, { method: 'post', contentType: 'application/json', headers: { 'x-dal-key': key },
    payload: JSON.stringify({ mails: out }), muteHttpExceptions: true });
}
