// ===== Duyuru görülme takibi =====
// Müşteri / tur linkindeki duyuru kartı ekrana gelince ("seen") ya da tıklanınca ("click") buraya bildirilir.
// Kayıt: duyurular/<duyuruId>/gorulme/<linkKodu> — kişi başı tek belge (ilk/son görülme, sayaçlar).
// Sadece gerçek bir paylaşım kodu (paylasimlar/<kod>) ve var olan bir duyuru için yazılır; konum/cihaz bilgisi tutulmaz.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const CODE_RE = /^[A-Za-z0-9-]{8,60}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const ALLOWED = [/^https:\/\/crm\.paydostur\.com$/, /^https:\/\/(www\.)?paydostur\.com$/, /^https:\/\/[a-z0-9-]+--paydosv\.netlify\.app$/, /^https:\/\/paydosv\.netlify\.app$/, /^http:\/\/localhost(:\d+)?$/];

const handle = async (db, body) => {
  const k = String(body.k || ''), d = String(body.d || ''), e = body.e === 'click' ? 'click' : 'seen';
  if (!CODE_RE.test(k) || !ID_RE.test(d)) return { ok: false, status: 400 };
  const [ps, ds] = await Promise.all([db.collection('paylasimlar').doc(k).get(), db.collection('duyurular').doc(d).get()]);
  if (!ps.exists || !ds.exists) return { ok: false, status: 404 };
  const p = ps.data() || {};
  const ref = db.collection('duyurular').doc(d).collection('gorulme').doc(k);
  const cur = await ref.get();
  const now = new Date().toISOString();
  const patch = {
    name: String(p.customerName || ''), tourId: String(p.tourId || ''), kind: p.kind === 'customer' ? 'customer' : 'tour',
    lastSeenAt: now, seenCount: FieldValue.increment(e === 'seen' ? 1 : 0),
  };
  if (!cur.exists || !cur.data()?.firstSeenAt) patch.firstSeenAt = now;
  if (e === 'click') { patch.clickCount = FieldValue.increment(1); patch.lastClickAt = now; }
  await ref.set(patch, { merge: true });
  return { ok: true, status: 200 };
};

exports.duyuruGor = functions.region('europe-west1').https.onRequest(async (req, res) => {
  const origin = req.get('origin') || '';
  if (ALLOWED.some(re => re.test(origin))) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin'); }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('');
  // Sayfa önbelleksiz/preflight'sız göndersin diye text/plain gelir
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (Buffer.isBuffer(body)) { try { body = JSON.parse(body.toString('utf8')); } catch { body = {}; } }
  try {
    const r = await handle(getFirestore('paydos'), body || {});
    return res.status(r.status).json({ ok: r.ok });
  } catch (e) {
    console.error('[duyuruGor]', e.message);
    return res.status(500).json({ ok: false });
  }
});
exports._handle = handle; // test
