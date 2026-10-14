#!/usr/bin/env python3
"""مزامنة مستندات live بين قاعدة الملف التفاعلي (claude.ai) وقاعدة جوال دال (Google Apps Script).
الاستخدام: python3 -I dal_sync.py <مجلد مستندات الملف: فيه live/*.json> <مجلد الإخراج>
- يرفع إلى قاعدة الجوال كل ما كتبته المتابعة (daily, inbox, rt, foodics, applicants).
- يدمج ما يعدّله ضيف الله من الجهتين (inbox_state, rt_state, hire_edits, slow) ويكتب النسخة المدمجة في الجهتين.
- يكتب في مجلد الإخراج ملفات المستندات التي يجب تحديثها في الملف التفاعلي (out/<doc>.json)."""
import sys, os, json, urllib.request
API = 'https://script.google.com/macros/s/AKfycbwwIBl-P1g1zKXncj5xID5Ut7BliQ9p_9FIpZ0mnTLdI7txRw8vtexSpLKMpp-e6FSq/exec'
KEY = os.environ['DAL_KEY']
PUSH = ['daily', 'inbox', 'rt', 'foodics', 'applicants']
MERGE = ['inbox_state', 'rt_state', 'hire_edits', 'slow']

def call(o):
    o['k'] = KEY
    req = urllib.request.Request(API, data=json.dumps(o, ensure_ascii=False).encode('utf-8'), headers={'Content-Type': 'text/plain'})
    with urllib.request.urlopen(req, timeout=90) as r:
        res = json.loads(r.read().decode('utf-8'))
    if not res.get('ok'): raise SystemExit('Apps Script: ' + str(res.get('err')))
    return res

def load(d, name):
    p = os.path.join(d, 'live', name + '.json')
    if not os.path.exists(p): return None
    x = json.load(open(p, encoding='utf-8'))
    return x.get('data', x) if isinstance(x, dict) and set(x.keys()) <= {'data', 'version', 'id'} else x

def ts(x):
    if not isinstance(x, dict): return ''
    return str(x.get('updated') or x.get('at') or '')

def merge_s(a, b):
    """دمج خرائط s: لكل مفتاح الأحدث حسب at، وإن تعذّر فنسخة الجوال."""
    out = dict(a or {})
    for k, v in (b or {}).items():
        if k not in out or ts(v) >= ts(out[k]): out[k] = v
    return out

def merge(name, art, gas):
    if art is None: return gas
    if gas is None: return art
    if name == 'slow':
        return gas if ts(gas) > ts(art) else art
    if name in ('inbox_state', 'rt_state'):
        m = dict(art); m.update({k: v for k, v in gas.items() if k not in ('s', 'add')})
        m['s'] = merge_s(art.get('s'), gas.get('s'))
        if name == 'rt_state':
            ids = {}
            for r in (art.get('add') or []) + (gas.get('add') or []): ids[r.get('id')] = r
            m['add'] = list(ids.values())
        return m
    return gas if ts(gas) > ts(art) else art   # hire_edits

def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    paths = ['live/' + n for n in PUSH + MERGE]
    remote = call({'op': 'get', 'paths': paths})['docs']
    changed_art = []
    for n in PUSH:
        a = load(src, n)
        if a is not None and a != (remote.get('live/' + n) or {}).get('data'):
            call({'op': 'set', 'path': 'live/' + n, 'data': a}); print('رُفع إلى الجوال:', n)
    for n in MERGE:
        a, g = load(src, n), (remote.get('live/' + n) or {}).get('data')
        m = merge(n, a, g)
        if m is None: continue
        if m != g: call({'op': 'set', 'path': 'live/' + n, 'data': m}); print('حُدّث في الجوال:', n)
        if m != a:
            json.dump(m, open(os.path.join(out, n + '.json'), 'w', encoding='utf-8'), ensure_ascii=False)
            changed_art.append(n)
    print('يُكتب في الملف التفاعلي:', ' '.join(changed_art) or 'لا شيء')

if __name__ == '__main__':
    main()
