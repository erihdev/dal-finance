"""تشفير ملف مالية دال للنشر على GitHub Pages.
- keygen: ينشئ زوج مفاتيح ECDH P-256، ويحفظ المفتاح العام في pub.json، ويغلّف المفتاح الخاص بكلمة المرور في keyring.json.
- app <artifact_dir>: يدمج index.html وكل ملفات js في صفحة واحدة ويشفّرها إلى app.enc.
- live <daily.json> <applicants.json> [hire_edits.json]: يدمج التعديلات ويشفّر بيانات المتابعة والمتقدمين إلى live.enc.
التشفير بالمفتاح العام فقط، فلا تحتاج المهمة المجدولة كلمة المرور."""
import sys, os, json, gzip, base64, re
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
b64 = lambda b: base64.b64encode(b).decode()
def seal(data: bytes, out: str):
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), base64.b64decode(json.load(open(os.path.join(R, 'pub.json')))['pub']))
    eph = ec.generate_private_key(ec.SECP256R1())
    shared = eph.exchange(ec.ECDH(), pub)
    h = hashes.Hash(hashes.SHA256()); h.update(shared); key = h.finalize()
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, gzip.compress(data, 9), None)
    epk = eph.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    json.dump({'epk': b64(epk), 'iv': b64(iv), 'ct': b64(ct)}, open(os.path.join(R, out), 'w'))
cmd = sys.argv[1]
if cmd == 'keygen':
    pw = sys.argv[2].encode()
    k = ec.generate_private_key(ec.SECP256R1())
    pk8 = k.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    salt, iv = os.urandom(16), os.urandom(12)
    wk = PBKDF2HMAC(hashes.SHA256(), 32, salt, 310000).derive(pw)
    json.dump({'salt': b64(salt), 'iv': b64(iv), 'iter': 310000, 'wrapped': b64(AESGCM(wk).encrypt(iv, pk8, None))}, open(os.path.join(R, 'keyring.json'), 'w'))
    json.dump({'pub': b64(k.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))}, open(os.path.join(R, 'pub.json'), 'w'))
elif cmd == 'app':
    d = sys.argv[2]; html = open(os.path.join(d, 'index.html'), encoding='utf-8').read()
    def inl(m):
        js = open(os.path.join(d, m.group(1)), encoding='utf-8').read().replace('</script', '<\\/script')
        return '<script>' + js
    html = re.sub(r'<script src="([a-z0-9_]+\.js)(?:\?v=\d+)?">', inl, html)
    seal(html.encode('utf-8'), 'app.enc')
elif cmd == 'live':
    app = json.load(open(sys.argv[3], encoding='utf-8'))
    # تعديلات وحذف المتقدمين من الملف (live/hire_edits) إن وُجدت
    if len(sys.argv) > 4 and os.path.exists(sys.argv[4]):
        ed = json.load(open(sys.argv[4], encoding='utf-8'))
        dl, ee = ed.get('del') or {}, ed.get('e') or {}
        app['items'] = [dict(r, **ee.get(r.get('id'), {})) for r in app.get('items', []) if r.get('id') not in dl]
    doc = {'daily': json.load(open(sys.argv[2], encoding='utf-8')), 'applicants': app}
    seal(json.dumps(doc, ensure_ascii=False).encode('utf-8'), 'live.enc')
