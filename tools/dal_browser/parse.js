/* تحويل نص لوحات رتم وفودكس إلى أرقام كما هي حرفياً (بلا ذكاء اصطناعي، بلا تقدير). */
'use strict';
const num = s => { const v = parseFloat(String(s).replace(/[٬,]/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))); return isNaN(v) ? null : v; };
function table(text, header) {
  const i = text.indexOf(header); if (i < 0) return [];
  const rows = [];
  for (const line of text.slice(i + header.length).split('\n').slice(1)) {
    const c = line.split('\t'); if (c.length < 3) { if (rows.length) break; else continue; }
    rows.push([c[0].trim(), num(c[1]), num(c[2])]);
  }
  return rows;
}
function retm(text) {
  if (!text || text.indexOf('الايرادات') < 0) return null;
  const m = {}, y = {};
  const L = { revenue: 'الايرادات', invoices: 'الفواتير', customers: 'العملاء', discounts: 'الخصومات', avg: 'متوسط الفاتورة', items: 'المنتجات بالفاتورة' };
  for (const [k, lab] of Object.entries(L)) {
    const re = new RegExp(lab + '\\s*\\n\\s*([\\d.,]+)\\s*\\n+\\s*امس\\s*\\n+\\s*([\\d.,]+)');
    const r = text.match(re); if (r) { m[k] = num(r[1]); y[k] = num(r[2]); }
  }
  if (m.revenue == null) return null;
  return Object.assign(m, { yesterday: y,
    payments: table(text, 'طريقة الدفع\tالكمية\tالقيمة'), categories: table(text, 'التصنيف\tالكمية\tالقيمة'),
    products: table(text, 'صنف\tالكمية\tالقيمة'), orderTypes: table(text, 'نوع الطلب\tالكمية\tالقيمة') });
}
function foodics(text) {
  if (!text || text.indexOf('صافي المبيعات') < 0) return null;
  const o = {}; const L = { orders: 'الطلبات', net: 'صافي المبيعات', paid: 'صافي المدفوعات', returns: 'مبلغ الإرجاع', discounts: 'مبلغ الخصم' };
  const dm = text.match(/(\d{4}-\d{2}-\d{2})/); if (dm) o.date = dm[1];
  for (const [k, lab] of Object.entries(L)) { const r = text.match(new RegExp(lab + '\\s*\\n\\s*عرض التقرير\\s*\\n[^\\d\\n]*([\\d.,]+)')); if (r) o[k] = num(r[1]); }
  return o;
}
module.exports = { retm, foodics };
