// ===== Müşteri linki bildirimleri (Web Push) =====
// Müşteri linkinde (crm.paydostur.com/m/<kod>) "Bildirimleri aç" ile telefon abone olur; CRM'deki
// "📣 Bildirimler" ekranından mesaj gönderilir. Firebase Cloud Messaging yerine standart Web Push (VAPID):
// ek kurulum yok — anahtar çifti ilk çağrıda üretilip Firestore'da (_private/vapid) saklanır.
//
// İki ayrı izin (6563 / KVKK): seyahat bildirimi (uçuş, otel, belge) ve KAMPANYA onayı. Kampanya mesajları
// sadece kampanya kutusunu kendisi işaretleyenlere gider (sunucu zorlar; CRM'den atlanamaz).
// Abonelik PIN ile yapılır (link PIN'li); tur linkleri bu fonksiyona hiç dokunmaz.
//
// İşlemler (POST JSON, a=…):
//   key                      → VAPID açık anahtar (herkese açık)
//   sub   {k, pin, sub, marketing} → abone ol / kampanya onayını güncelle (PIN gerekli)
//   status {endpoint}        → bu cihaz abone mi, kampanya onayı var mı
//   unsub {endpoint}         → aboneliği sil
//   stats / send / log / auto → sadece CRM (Authorization: Bearer <Firebase ID token>)
//
// Otomatik hatırlatma (bildirimOtomatik, her gün 10:00): bildirimi açık müşterinin Schengen/ABD vizesi
// 60·30·7 gün, pasaportu 6 ay·3 ay kala bilgilendirme bildirimi. Tarihler müşteri kartından (linkte görünen
// bilgilerle aynı). Her eşik bir kez gönderilir (bildirim_auto/<müşteri>). CRM'den açılıp kapatılır.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const webpush = require('web-push');
if (!admin.apps.length) admin.initializeApp();
const { getFirestore } = require('firebase-admin/firestore');

const CODE_RE = /^[A-Za-z0-9-]{8,60}$/;
const ALLOWED = [/^https:\/\/crm\.paydostur\.com$/, /^https:\/\/(www\.)?paydostur\.com$/, /^https:\/\/[a-z0-9-]+--paydosv\.netlify\.app$/, /^https:\/\/paydosv\.netlify\.app$/, /^http:\/\/localhost(:\d+)?$/];
const SITE = 'https://crm.paydostur.com';
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;

const hashPin = (salt, pin) => crypto.createHash('sha256').update(`${salt}:${pin}`).digest('hex');
const subId = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 40);
const validSub = (s) => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000
  && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string' && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
// Bildirime dokununca açılacak adres: kendi sitemiz dışında bir yere gönderilmez
const VAPID_SUBJECT = 'mailto:info@paydostur.com';
const safeUrl = (u, fallback) => (/^https:\/\/((www\.)?paydostur\.com|crm\.paydostur\.com)(\/|$)/.test(String(u || '')) ? String(u) : fallback);

let vapidCache = null;
const getVapid = async (db) => {
  if (vapidCache) return vapidCache;
  const ref = db.collection('_private').doc('vapid');
  vapidCache = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists && s.data().publicKey && s.data().privateKey) return s.data();
    const k = webpush.generateVAPIDKeys();
    const v = { publicKey: k.publicKey, privateKey: k.privateKey, createdAt: new Date().toISOString() };
    tx.set(ref, v);
    return v;
  });
  return vapidCache;
};

// Abonelik dokümanlarına gönder; telefonu bırakılmış (404/410) abonelikleri siler
const pushTo = async (db, docs, payloadOf) => {
  const v = await getVapid(db);
  const opts = { TTL: 3 * 24 * 3600, vapidDetails: { subject: VAPID_SUBJECT, publicKey: v.publicKey, privateKey: v.privateKey } };
  let sent = 0, failed = 0, removed = 0;
  for (let i = 0; i < docs.length; i += 50) {
    await Promise.all(docs.slice(i, i + 50).map(async (s) => {
      const x = s.data();
      try { await webpush.sendNotification({ endpoint: x.endpoint, keys: x.keys }, JSON.stringify(payloadOf(x)), opts); sent++; }
      catch (e) {
        failed++;
        if (e.statusCode === 404 || e.statusCode === 410) { await s.ref.delete().catch(() => {}); removed++; }
        else console.warn('[bildirim] gönderilemedi', e.statusCode, e.body || e.message);
      }
    }));
  }
  return { sent, failed, removed };
};
const autoOn = async (db) => { const s = await db.collection('_private').doc('bildirim_ayar').get(); return !s.exists || s.data().otoHatirlatma !== false; };

const staffUser = async (req) => {
  const h = req.get('authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!t) return null;
  try { const d = await admin.auth().verifyIdToken(t); return d.email || d.uid; } catch { return null; }
};

exports.bildirim = functions.region('europe-west1').https.onRequest(async (req, res) => {
  const origin = req.get('origin') || '';
  if (ALLOWED.some(re => re.test(origin))) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin'); }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });

  const p = req.body || {};
  const a = String(p.a || '');
  try {
    const db = getFirestore('paydos');
    const subs = db.collection('push_subs');

    if (a === 'key') return res.json({ key: (await getVapid(db)).publicKey });

    if (a === 'status' || a === 'unsub') {
      if (typeof p.endpoint !== 'string' || !p.endpoint) return res.status(400).json({ error: 'endpoint' });
      const ref = subs.doc(subId(p.endpoint));
      if (a === 'unsub') { await ref.delete(); return res.json({ ok: true }); }
      const s = await ref.get();
      return res.json({ subscribed: s.exists, marketing: s.exists && !!s.data().marketing });
    }

    if (a === 'sub') {
      const code = String(p.k || ''), pin = String(p.pin || '');
      if (!CODE_RE.test(code) || !validSub(p.sub)) return res.status(400).json({ error: 'Geçersiz istek' });
      const lref = db.collection('paylasimlar').doc(code);
      const snap = await lref.get();
      if (!snap.exists || snap.data().kind !== 'customer') return res.status(404).json({ error: 'notfound' });
      const d = snap.data();
      // PIN, belge API'siyle aynı kurallar (kilit dahil) — bildirim üzerinden PIN denenemez
      if (!d.pinHash) return res.status(401).json({ error: 'pin' });
      if (d.pinLockUntil && Date.now() < d.pinLockUntil) return res.status(429).json({ error: 'locked' });
      if (!/^\d{4}$/.test(pin) || hashPin(d.pinSalt, pin) !== d.pinHash) {
        const fails = (d.pinFails || 0) + 1, lock = fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0;
        await lref.set({ pinFails: lock ? 0 : fails, pinLockUntil: lock }, { merge: true });
        return res.status(401).json({ error: 'pin' });
      }
      const ref = subs.doc(subId(p.sub.endpoint));
      const prev = await ref.get();
      const now = new Date().toISOString();
      const marketing = !!p.marketing;
      const wasMarketing = prev.exists && !!prev.data().marketing;
      await ref.set({
        kind: 'customer', code, customerId: String(d.customerDocId || ''), customerName: String(d.customerName || ''),
        endpoint: p.sub.endpoint, keys: { p256dh: p.sub.keys.p256dh, auth: p.sub.keys.auth },
        marketing,
        // Onay kaydı: ne zaman verildi / geri çekildi (ispat için saklanır)
        ...(marketing && !wasMarketing ? { marketingAt: now } : {}),
        ...(!marketing && wasMarketing ? { marketingOffAt: now } : {}),
        ua: String(req.get('user-agent') || '').slice(0, 200),
        createdAt: prev.exists ? (prev.data().createdAt || now) : now, updatedAt: now,
      }, { merge: true });
      return res.json({ ok: true, marketing });
    }

    // ---- CRM işlemleri ----
    const who = await staffUser(req);
    if (!who) return res.status(401).json({ error: 'Giriş gerekli' });

    if (a === 'stats') {
      const all = await subs.get();
      const by = {};
      all.forEach(s => { const x = s.data(); const k = x.customerId || ''; by[k] = by[k] || { n: 0, m: 0, name: x.customerName || '' }; by[k].n++; if (x.marketing) by[k].m++; });
      return res.json({ total: all.size, marketing: all.docs.filter(s => s.data().marketing).length, byCustomer: by, auto: await autoOn(db) });
    }

    if (a === 'auto') {
      await db.collection('_private').doc('bildirim_ayar').set({ otoHatirlatma: !!p.on, by: who, at: new Date().toISOString() }, { merge: true });
      return res.json({ auto: !!p.on });
    }

    if (a === 'log') {
      const l = await db.collection('bildirim_log').orderBy('at', 'desc').limit(30).get();
      return res.json({ items: l.docs.map(x => ({ id: x.id, ...x.data() })) });
    }

    if (a === 'send') {
      const type = p.type === 'kampanya' ? 'kampanya' : 'bilgi';
      const title = String(p.title || '').trim().slice(0, 80), body = String(p.body || '').trim().slice(0, 300);
      if (!title || !body) return res.status(400).json({ error: 'Başlık ve mesaj gerekli' });
      const ids = Array.isArray(p.customerIds) ? new Set(p.customerIds.map(String)) : null;
      const all = await subs.get();
      const targets = all.docs.filter(s => { const x = s.data(); return (!ids || ids.has(x.customerId)) && (type !== 'kampanya' || x.marketing); });
      const { sent, failed, removed } = await pushTo(db, targets, (x) => ({ title, body, url: safeUrl(p.url, `${SITE}/m/${x.code}`), tag: type }));
      await db.collection('bildirim_log').add({ at: new Date().toISOString(), by: who, type, title, body, url: p.url || '', target: ids ? ids.size : 'all', matched: targets.length, sent, failed, removed });
      return res.json({ matched: targets.length, sent, failed, removed });
    }

    return res.status(400).json({ error: 'Bilinmeyen işlem' });
  } catch (e) {
    console.error('[bildirim] hata', e);
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ===== Otomatik vize / pasaport hatırlatması =====
const { validityOf } = require('./belge');
const DAY = 86400000;
const trDate = (ymd) => ymd.split('-').reverse().join('.');
const daysLeft = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / DAY); };
const STEPS = { visa: [7, 30, 60], passport: [90, 183] };
const whenTxt = (n) => n === 0 ? 'bugün' : n < 31 ? `${n} gün sonra` : `${Math.round(n / 30)} ay sonra`;
const reminderOf = (v, n) => v.kind === 'passport'
  ? { title: `Pasaportunuz ${whenTxt(n)} bitiyor`, body: `Pasaportunuzun bitiş tarihi ${trDate(v.until)}. Vize başvurularında pasaportun seyahat sonrası en az 6 ay geçerli olması istenir; yenilemeyi unutmayın.` }
  : { title: `${v.label}${v.sub ? ` (${v.sub})` : ''} ${whenTxt(n)} bitiyor`, body: `Vizenizin bitiş tarihi ${trDate(v.until)}. Yeni bir seyahat planınız varsa yenileme için Paydos Turizm'e yazabilirsiniz.` };

const runAuto = async (db) => {
  if (!(await autoOn(db))) return { off: true };
  const all = await db.collection('push_subs').get();
  const byCust = {};
  all.docs.forEach(s => { const c = s.data().customerId; if (c) (byCust[c] = byCust[c] || []).push(s); });
  let sent = 0, reminders = 0;
  for (const [cid, docs] of Object.entries(byCust)) {
    const cs = await db.collection('customers').doc(cid).get();
    if (!cs.exists) continue;
    const aref = db.collection('bildirim_auto').doc(cid);
    const done = (await aref.get()).data()?.sent || {};
    const mark = {};
    for (const v of validityOf(cs.data() || {})) {
      const n = daysLeft(v.until);
      if (n < 0) continue;
      const steps = STEPS[v.kind === 'passport' ? 'passport' : 'visa'];
      const step = steps.find(s => n <= s); // en küçük uygun eşik — ilk çalışmada birden çok mesaj gitmesin
      if (step === undefined) continue;
      const key = `${v.kind}:${v.label}:${v.until}:${step}`;
      if (done[key]) continue;
      const msg = reminderOf(v, n);
      const r = await pushTo(db, docs, (x) => ({ ...msg, url: `${SITE}/m/${x.code}`, tag: `oto-${v.kind}` }));
      // Bu ve daha büyük eşikler bir daha gönderilmez
      steps.filter(s => s >= step).forEach(s => { mark[`${v.kind}:${v.label}:${v.until}:${s}`] = new Date().toISOString(); });
      sent += r.sent; reminders++;
      await db.collection('bildirim_log').add({ at: new Date().toISOString(), by: 'otomatik', type: 'bilgi', title: msg.title, body: msg.body, url: '', target: 1, matched: docs.length, sent: r.sent, failed: r.failed, removed: r.removed });
    }
    if (Object.keys(mark).length) await aref.set({ sent: mark }, { merge: true });
  }
  return { reminders, sent };
};
exports.runAuto = runAuto;

exports.bildirimOtomatik = functions
  .region('europe-west1')
  .pubsub.schedule('0 10 * * *').timeZone('Europe/Istanbul')
  .onRun(async () => {
    const r = await runAuto(getFirestore('paydos'));
    console.log('[bildirim] otomatik hatırlatma', JSON.stringify(r));
    return null;
  });
