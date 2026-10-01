// ===== Belge linki API (PIN korumalı) =====
// Müşteri belge sayfası (crm.paydostur.com/b/<kod>) veriyi doğrudan Firestore'dan değil buradan alır.
// Müşteri linklerinde (kind: 'customer') ilk açılışta müşteri 4 haneli PIN belirler; sonraki açılışlarda PIN sorulur.
// PIN müşteri kartına da yazılır (customers/<id>.linkPin) — kaybederse acenta söyleyebilir / sıfırlayabilir.
// Tur linkleri (PIN'siz) eskisi gibi açık döner. 5 yanlış denemede 15 dakika kilit.
// Firestore kuralında paylasimlar herkese kapatılınca PIN atlanamaz (veri sadece bu fonksiyondan çıkar).
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
if (!admin.apps.length) admin.initializeApp();
const { getFirestore } = require('firebase-admin/firestore');

const CODE_RE = /^[A-Za-z0-9-]{8,60}$/;
const ALLOWED = [/^https:\/\/crm\.paydostur\.com$/, /^https:\/\/(www\.)?paydostur\.com$/, /^https:\/\/[a-z0-9-]+--paydosv\.netlify\.app$/, /^https:\/\/paydosv\.netlify\.app$/, /^http:\/\/localhost(:\d+)?$/];
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;

const hashPin = (salt, pin) => crypto.createHash('sha256').update(`${salt}:${pin}`).digest('hex');
// Gizli alanları müşteriye gönderme
const publicData = (d) => {
  const { pinHash, pinSalt, pinFails, pinLockUntil, customerDocId, ...pub } = d || {};
  return pub;
};
const firstName = (n) => String(n || '').trim().split(/\s+/).slice(0, -1).join(' ') || String(n || '').trim();

exports.belge = functions.region('europe-west1').https.onRequest(async (req, res) => {
  const origin = req.get('origin') || '';
  if (ALLOWED.some(re => re.test(origin))) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin'); }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  const p = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const code = String(p.k || '');
  const action = String(p.a || 'get');
  const pin = String(p.pin || '');
  if (!CODE_RE.test(code)) return res.status(400).json({ state: 'error', error: 'Geçersiz bağlantı' });

  try {
    const db = getFirestore('paydos');
    const ref = db.collection('paylasimlar').doc(code);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ state: 'notfound' });
    const d = snap.data();

    // Ana ekran manifesti için sadece başlık bilgisi (PIN gerekmez)
    if (action === 'meta') return res.json({ state: 'meta', city: d.city || '', tourName: d.tourName || '' });

    // Tur linkleri ve PIN'siz eski linkler: açık
    if (d.kind !== 'customer') return res.json({ state: 'ok', data: publicData(d) });

    const name = firstName(d.customerName);

    // PIN henüz yok → müşteri belirler
    if (!d.pinHash) {
      if (action !== 'setpin') return res.json({ state: 'setpin', name });
      if (!/^\d{4}$/.test(pin)) return res.status(400).json({ state: 'setpin', name, error: 'PIN 4 rakam olmalı' });
      const salt = crypto.randomBytes(8).toString('hex');
      // Aynı anda iki kişi belirlemeye çalışırsa ilk gelen kazanır
      const ok = await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        if (cur.data()?.pinHash) return false;
        tx.set(ref, { pinHash: hashPin(salt, pin), pinSalt: salt, pinFails: 0, pinLockUntil: 0, pinSetAt: new Date().toISOString() }, { merge: true });
        return true;
      });
      if (!ok) return res.json({ state: 'pin', name });
      if (d.customerDocId) {
        await db.collection('customers').doc(String(d.customerDocId)).set({ linkPin: pin, linkPinSetAt: new Date().toISOString() }, { merge: true }).catch(e => console.warn('[belge] müşteri kartına PIN yazılamadı', e.message));
      }
      return res.json({ state: 'ok', data: publicData(d) });
    }

    // Kilitli mi?
    if (d.pinLockUntil && Date.now() < d.pinLockUntil) {
      return res.status(429).json({ state: 'locked', name, minutes: Math.ceil((d.pinLockUntil - Date.now()) / 60000) });
    }
    if (action !== 'unlock') return res.json({ state: 'pin', name });

    if (/^\d{4}$/.test(pin) && hashPin(d.pinSalt, pin) === d.pinHash) {
      if (d.pinFails) await ref.set({ pinFails: 0, pinLockUntil: 0 }, { merge: true });
      return res.json({ state: 'ok', data: publicData(d) });
    }
    const fails = (d.pinFails || 0) + 1;
    const lock = fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0;
    await ref.set({ pinFails: lock ? 0 : fails, pinLockUntil: lock }, { merge: true });
    if (lock) return res.status(429).json({ state: 'locked', name, minutes: 15 });
    return res.status(401).json({ state: 'pin', name, error: 'wrong', left: MAX_FAILS - fails });
  } catch (e) {
    console.error('[belge] hata', e);
    return res.status(500).json({ state: 'error', error: 'Sunucu hatası' });
  }
});
