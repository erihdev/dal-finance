#!/usr/bin/env python3
"""قاعدة بيانات مالية دال (المصدر الوحيد): مستندات live/* في Google Apps Script، يقرؤها تطبيق الجوال ويكتب فيها.
الاستخدام (المفتاح في متغير البيئة DAL_KEY):
  dal_db.py list                                  أسماء المستندات وإصداراتها
  dal_db.py get <doc> [<doc>...] --out <مجلد>      يحفظ كل مستند في <مجلد>/<doc>.json بالشكل {"data":…, "v":…}
  dal_db.py set <doc> <ملف.json> [--if-v <v>]     يستبدل المستند (الملف إما البيانات نفسها أو {"data":…})
  dal_db.py update <doc> <ملف.json>               يدمج الحقول في المستند
--if-v: إن تغيّر المستند منذ قراءتك (إصدار مختلف) يُرفض الحفظ ويخرج بالرمز 3 — أعد القراءة وادمج ثم احفظ."""
import sys, os, json, urllib.request
API = 'https://script.google.com/macros/s/AKfycbwwIBl-P1g1zKXncj5xID5Ut7BliQ9p_9FIpZ0mnTLdI7txRw8vtexSpLKMpp-e6FSq/exec'

def call(o):
    o['k'] = os.environ['DAL_KEY']
    req = urllib.request.Request(API, data=json.dumps(o, ensure_ascii=False).encode('utf-8'), headers={'Content-Type': 'text/plain'})
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.loads(r.read().decode('utf-8'))
    if not res.get('ok'): sys.exit('Apps Script: ' + str(res.get('err')))
    return res

def body(path):
    x = json.load(open(path, encoding='utf-8'))
    return x['data'] if isinstance(x, dict) and set(x) <= {'data', 'v', 'version', 'id'} and 'data' in x else x

def main(a):
    if not a: sys.exit(__doc__)
    op = a[0]
    if op == 'list':
        for k, v in sorted(call({'op': 'list'})['list'].items()): print(k.replace('live/', ''), v)
    elif op == 'get':
        out = a[a.index('--out') + 1] if '--out' in a else '.'
        docs = [d for d in a[1:] if d != '--out' and d != out]
        os.makedirs(out, exist_ok=True)
        res = call({'op': 'get', 'paths': ['live/' + d for d in docs]})['docs']
        for d in docs:
            r = res.get('live/' + d) or {'data': None, 'v': 0}
            json.dump({'data': r.get('data'), 'v': r.get('v', 0)}, open(os.path.join(out, d + '.json'), 'w', encoding='utf-8'), ensure_ascii=False)
            print(d, 'v=%s' % r.get('v', 0), 'موجود' if r.get('data') is not None else 'غير موجود')
    elif op in ('set', 'update'):
        d, f = a[1], a[2]
        if '--if-v' in a:
            want = int(a[a.index('--if-v') + 1])
            cur = int((call({'op': 'get', 'paths': ['live/' + d]})['docs'].get('live/' + d) or {}).get('v') or 0)
            if cur != want:
                print('تعارض: المستند %s تغيّر (الإصدار الآن %s وقرأت %s). أعد القراءة وادمج.' % (d, cur, want)); sys.exit(3)
        v = call({'op': op, 'path': 'live/' + d, 'data': body(f)})['v']
        print(d, 'حُفظ v=%s' % v)
    else: sys.exit(__doc__)

if __name__ == '__main__': main(sys.argv[1:])
