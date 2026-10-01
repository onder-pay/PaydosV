// ===== Belge linki API (PIN korumalı) =====
// Müşteri linki sayfası (crm.paydostur.com/m/<kod>) veriyi doğrudan Firestore'dan değil buradan alır.
// Müşteri linklerinde (kind: 'customer') ilk açılışta müşteri 4 haneli PIN belirler; sonraki açılışlarda PIN sorulur.
// PIN müşteri kartına da yazılır (customers/<id>.linkPin) — kaybederse acenta söyleyebilir / sıfırlayabilir.
// Sadece müşteri linkleri (kind: 'customer'); tur linkleri bu fonksiyonla hiç ilgilenmez (eskisi gibi /b/ sayfası, PIN'siz).
// 5 yanlış denemede 15 dakika kilit. Firestore kuralında müşteri dokümanları herkese kapatılınca PIN atlanamaz.
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
// Müşteri kartından pasaport/vize bitiş tarihleri — link her açıldığında güncel okunur (CRM'de yenilenince link de güncellenir).
// Sadece tarih ve tür gider; pasaport numarası, görsel vb. GİTMEZ (KVKK).
const parseArr = (v) => { if (Array.isArray(v)) return v; if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } } return []; };
const parseObj = (v) => { if (v && typeof v === 'object' && !Array.isArray(v)) return v; if (typeof v === 'string') { try { const p = JSON.parse(v); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch { return {}; } } return {}; };
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const byEndDesc = (k) => (a, b) => String(b[k]).localeCompare(String(a[k]));
const validityOf = (c) => {
  const out = [];
  const pp = parseArr(c.passports).filter(p => isYmd(p.expiryDate)).sort(byEndDesc('expiryDate'))[0];
  if (pp) out.push({ kind: 'passport', label: 'Pasaport', sub: String(pp.passportType || '').replace(/\s*\(.*\)\s*$/, ''), until: pp.expiryDate });
  const sv = parseArr(c.schengenVisas).filter(v => v && v.country && isYmd(v.endDate)).sort(byEndDesc('endDate'))[0];
  if (sv) out.push({ kind: 'visa', label: 'Schengen vizesi', sub: String(sv.country || ''), until: sv.endDate });
  const us = parseObj(c.usaVisa);
  if (isYmd(us.endDate)) out.push({ kind: 'visa', label: 'ABD vizesi', sub: '', until: us.endDate });
  return out;
};
const withValidity = async (db, d) => {
  const pub = publicData(d);
  if (d.customerDocId) {
    try { const c = await db.collection('customers').doc(String(d.customerDocId)).get(); if (c.exists) pub.validity = validityOf(c.data() || {}); }
    catch (e) { console.warn('[belge] geçerlilik okunamadı', e.message); }
  }
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

    // Tur linkleri buradan verilmez
    if (d.kind !== 'customer') return res.status(404).json({ state: 'notfound' });

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
      return res.json({ state: 'ok', data: await withValidity(db, d) });
    }

    // Kilitli mi?
    if (d.pinLockUntil && Date.now() < d.pinLockUntil) {
      return res.status(429).json({ state: 'locked', name, minutes: Math.ceil((d.pinLockUntil - Date.now()) / 60000) });
    }
    if (action !== 'unlock') return res.json({ state: 'pin', name });

    if (/^\d{4}$/.test(pin) && hashPin(d.pinSalt, pin) === d.pinHash) {
      if (d.pinFails) await ref.set({ pinFails: 0, pinLockUntil: 0 }, { merge: true });
      return res.json({ state: 'ok', data: await withValidity(db, d) });
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
