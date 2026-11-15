// ===== Haftalık sistem özeti (e-posta) =====
// Her pazartesi 09:10: son 7 günün işlem logu (activity_logs) + vize mail/randevu sayıları tek mailde yöneticiye gider.
// Alıcı: app_settings.sistemOzetMail (boşsa varsayılan). Kapatma: app_settings.sistemOzetOn === false.
// Gönderim Vize SMTP'siyle (smtpVisa) yapılır. Elle: vize grubunda /ozet.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const { getFirestore } = require('firebase-admin/firestore');
const { sendMail, mailHtml } = require('./evrakmail');
const { normTr, normEmail, dmy } = require('./tr'); // Türkçe karakter kuralı (CLAUDE.md)
const { logError, flushErrors } = require('./syslog');

const TZ = 'Europe/Istanbul';
const OZET_MAIL_DEFAULT = 'onder@paydostur.com';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const isIso = (x) => /^\d{4}-\d{2}-\d{2}T/.test(String(x || ''));
const KAYNAK = { bot: 'Telegram botu', evrakmail: 'Otomatik vize mailleri', gelenmail: 'Gelen kutusu okuma', ekran: 'CRM ekran uyarısı', js: 'CRM program hatası', ozet: 'Haftalık özet' };
const ISLEM = { create: 'oluşturuldu', delete: 'silindi', status: 'durum değişti' };

// Aynı hatanın farklı isim/sayı içeren halleri tek satırda toplansın: sayılar ve tırnak içleri atılır
const errKey = (s) => normTr(s).replace(/"[^"]*"|'[^']*'/g, '…').replace(/\d+/g, '#').replace(/\s+/g, ' ').slice(0, 90);

// Döner: { text, subject, hata, islem } — yalnız sayılar ve hata metinleri; müşteri adı yazılmaz
const buildOzet = async ({ db, now = new Date(), days = 7 }) => {
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const logs = (await db.collection('activity_logs').where('time', '>=', since).get()).docs.map(d => d.data());
  const errs = logs.filter(l => l.action === 'error');
  const acts = logs.filter(l => l.action !== 'error');

  // İşlemler: modül × işlem
  const byMod = new Map();
  for (const l of acts) { const k = `${l.modul || 'Diğer'} ${ISLEM[l.action] || l.action || ''}`.trim(); byMod.set(k, (byMod.get(k) || 0) + 1); }
  const byUser = new Map();
  for (const l of acts) { const k = l.userName || 'Bilinmiyor'; byUser.set(k, (byUser.get(k) || 0) + 1); }

  // Hatalar: kaynak → aynı hata grupları
  const groups = new Map();
  for (const e of errs) {
    const src = e.kaynak || 'bot'; const k = `${src}|${errKey(e.detay)}`;
    const g = groups.get(k) || { src, n: 0, ornek: String(e.detay || '').slice(0, 160) };
    g.n++; groups.set(k, g);
  }
  const errList = [...groups.values()].sort((a, b) => b.n - a.n);

  // Vize akışı
  const cnt = async (field) => { try { return (await db.collection('visa_applications').where(field, '>=', since).get()).docs.filter(d => isIso(d.data()[field])).length; } catch { return null; } };
  const [yeni, bilgiMail, randevuMail, idata] = await Promise.all([cnt('createdAt'), cnt('evrakMailAt'), cnt('sureliMailAt'), cnt('idataMailAt')]);
  const n = (x) => x == null ? '?' : String(x);

  const top = (m, k = 12) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  const aralik = `${dmy(ymd(new Date(now.getTime() - days * 86400000)))} – ${dmy(ymd(now))}`;
  const L = [];
  L.push(`Paydos CRM haftalık özet (${aralik})`, '');
  L.push('VİZE AKIŞI', `• Yeni başvuru: ${n(yeni)}`, `• Bilgilendirme maili gönderilen: ${n(bilgiMail)}`, `• iDATA mailinden işlenen randevu: ${n(idata)}`, `• Randevu maili gönderilen: ${n(randevuMail)}`, '');
  L.push(`HATALAR VE UYARILAR (toplam ${errs.length})`);
  if (!errList.length) L.push('• Bu hafta kayıtlı hata yok.');
  for (const g of errList.slice(0, 20)) L.push(`• ${g.n} kez — ${KAYNAK[g.src] || g.src}: ${g.ornek}`);
  if (errList.length > 20) L.push(`• … ve ${errList.length - 20} farklı hata daha`);
  L.push('', `İŞLEMLER (toplam ${acts.length})`);
  if (!acts.length) L.push('• Kayıtlı işlem yok.');
  for (const [k, v] of top(byMod)) L.push(`• ${k}: ${v}`);
  if (byUser.size) { L.push('', 'KULLANICI BAZINDA'); for (const [k, v] of top(byUser, 8)) L.push(`• ${k}: ${v} işlem`); }
  L.push('', 'En çok tekrar eden hata, ilk düzeltilmesi gerekendir. Ayrıntı: CRM → İşlemler.');
  return { subject: `Paydos CRM haftalık özet — ${aralik}`, text: L.join('\n'), hata: errs.length, islem: acts.length };
};

// Döner: { ok, to, hata?, error? }
const sendOzet = async ({ db, send = sendMail, now, force = false }) => {
  const settings = (await db.collection('app_settings').doc('main').get()).data() || {};
  if (!force && settings.sistemOzetOn === false) return { ok: false, error: 'kapalı' };
  const to = [settings.sistemOzetMail, OZET_MAIL_DEFAULT].map(normEmail).find(validEmail);
  const smtp = [settings.smtpVisa, settings.smtp].find(s => s && s.host && s.user && s.pass);
  if (!smtp) return { ok: false, to, error: 'SMTP ayarı yok (Ayarlar → Vize SMTP)' };
  const o = await buildOzet({ db, now });
  await send(smtp, { to, subject: o.subject, text: o.text, html: mailHtml(esc(o.text)), attachments: [] });
  return { ok: true, to, hata: o.hata, islem: o.islem };
};

exports.buildOzet = buildOzet;
exports.sendOzet = sendOzet;
exports.haftalikOzet = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 120 })
  .pubsub.schedule('10 9 * * 1').timeZone(TZ)
  .onRun(async () => {
    const db = getFirestore('paydos');
    try { const r = await sendOzet({ db }); console.log('[ozet]', JSON.stringify(r)); if (!r.ok && r.error !== 'kapalı') logError('ozet', `Özet gönderilemedi: ${r.error}`, db); }
    catch (e) { console.error('[ozet]', e); logError('ozet', `Özet gönderilemedi: ${e.message}`, db); }
    await flushErrors();
    return null;
  });
