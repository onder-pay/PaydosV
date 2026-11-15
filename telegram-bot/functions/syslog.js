// ===== Sistem hata kaydı =====
// Bot ve zamanlanmış görevlerde oluşan hatalar CRM'in işlem loguna (activity_logs, action: 'error') yazılır;
// haftalık özet (ozet.js) bunları sayar. Kayıt yazımı asıl işi asla bozmaz.
// Not: burada initializeApp ÇAĞRILMAZ — index.js kendi başlatmasını koşulsuz yapıyor; önce burada başlatılırsa bot yüklenirken çöker.
const { getFirestore } = require('firebase-admin/firestore');

const pending = new Set();
// kaynak: 'bot' | 'evrakmail' | 'gelenmail' | 'ozet' …  — msg: kısa hata metni (kişisel veri yazmayın)
const logError = (kaynak, msg, db) => {
  try {
    const id = `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const p = (db || getFirestore('paydos')).collection('activity_logs').doc(id).set({
      id, action: 'error', modul: 'Sistem', detay: String(msg || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      kaynak: String(kaynak || 'bot'), userName: 'Bot', userEmail: '', time: new Date().toISOString(),
    }).catch(() => {}).finally(() => pending.delete(p));
    pending.add(p);
    return p;
  } catch { return Promise.resolve(); }
};
// Fonksiyon bitmeden bekleyen kayıtların yazılmasını bekler
const flushErrors = () => Promise.all([...pending]).catch(() => {});

module.exports = { logError, flushErrors };
