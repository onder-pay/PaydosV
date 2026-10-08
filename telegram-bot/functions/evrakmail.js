// ===== Vize: otomatik evrak mailleri =====
// 1) Başvuru "Atama Bekliyor" olunca → CRM'deki vize türü şablonu (Ayarlar → Vize Türü Bazlı Mail Şablonları) + bağlı ekler.
// 2) Randevu tarihi girilince (Schengen) → süreli evraklar listesi, randevuya göre hesaplanmış tarihlerle.
//    Randevu değişirse yeni tarihle tekrar gönderilir.
// 15 dakikada bir çalışır. Aynı mail iki kez gitmez (visa_applications.evrakMailAt / sureliMailFor).
// E-postası olmayan başvuru bekletilir: vizeci e-postayı ekleyince sonraki turda gider; gruba bir kez haber verilir.
// İlk çalışmada mevcut birikmiş kayıtlara mail gitmez, sessizce işaretlenir (app_settings/main.evrakMailBasladi).
// Açma/kapama: app_settings.autoEmailOnVisa (Atama Bekliyor maili) ve autoSureliMail (süreli evrak maili).
// Kapalıyken gelen başvurular "kapalıyken atlandı" diye işaretlenir — tekrar açınca geriye dönük mail yağmaz.
// Başvuru bazında: visa_applications.autoMailOff === true ise o başvuruya otomatik mail gitmez.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
if (!admin.apps.length) admin.initializeApp();
const { getFirestore } = require('firebase-admin/firestore');

const STATUS = 'Atama Bekliyor';
const TZ = 'Europe/Istanbul';
const MAIL_LOGO_URL = 'https://crm.paydostur.com/icons/paydos-wordmark.png';
const ALLOWED_ATTACHMENT_HOSTS = ['firebasestorage.googleapis.com', 'storage.googleapis.com'];

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const titleTr = (s) => String(s || '').toLocaleLowerCase('tr-TR').replace(/(^|[\s-])(\S)/g, (m, a, b) => a + b.toLocaleUpperCase('tr-TR'));
const istDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); // YYYY-MM-DD
const trDate = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || ''); };
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const closed = (v) => /onay|red|iptal/.test(String(v.status || '').toLocaleLowerCase('tr-TR'));

// CRM'deki mailHtml ile aynı görünüm
const mailHtml = (bodyText) => `<div style="background:#f4f5f7;padding:24px 12px"><div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
<div style="padding:18px 24px;border-bottom:3px solid #FF4141"><img src="${MAIL_LOGO_URL}" alt="Paydos Turizm" width="150" height="58" style="display:block;width:150px;height:58px;border:0"></div>
<pre style="margin:0;padding:22px 24px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;white-space:pre-wrap;">${bodyText}</pre>
<div style="padding:12px 24px;background:#fafafa;border-top:1px solid #eee;font-family:Arial,sans-serif;font-size:11px;color:#6b7280">Paydos Turizm · 0 258 263 71 76 · www.paydostur.com</div></div></div>`;

const custName = (v, cust) => titleTr(`${cust?.firstName || ''} ${cust?.lastName || ''}`.trim() || v.customerName || '');

// 1. aşama: CRM şablonu (sendVisaEmail ile aynı kurallar)
const buildTemplateMail = (v, cust, settings) => {
  const vize_turu = v.visaDuration || v.visaType || '';
  const catId = v.categoryId || v.category || 'schengen';
  const templates = settings.emailTemplates || {};
  const t = templates[vize_turu] || templates[catId];
  if (!t || (!t.subject && !t.body)) return null;
  const isim = custName(v, cust);
  const rep = (str) => String(str || '')
    .replace(/{isim}/g, isim)
    .replace(/{ulke}/g, v.country || catId)
    .replace(/{tarih}/g, trDate(istDate()))
    .replace(/{saat}/g, v.appointmentTime || '')
    .replace(/{ref_no}/g, String(v.id || '').slice(-8).toUpperCase() || '-')
    .replace(/{vize_turu}/g, vize_turu);
  const text = rep(t.body);
  const attachments = (settings.attachments || []).filter(a => a && a.url && a.linkedTypes?.includes(vize_turu)).map(a => ({ filename: a.name, url: a.url }));
  return { subject: rep(t.subject), text, html: mailHtml(text), attachments }; // CRM test maili ile birebir (şablon HTML'i olduğu gibi)
};

// 2. aşama: süreli evraklar (Schengen) — randevu tarihine göre hesaplanır
const buildSureliMail = (v, cust, today) => {
  const appt = String(v.appointmentDate || '').slice(0, 10);
  const from14 = addDays(appt, -14);
  const sonGun = addDays(appt, -1);
  const ticari = /ticari|fuar|iş/i.test(`${v.visaDuration || ''} ${v.visaType || ''}`);
  const al14 = from14 <= today ? 'bugünden itibaren alabilirsiniz' : `${trDate(from14)} tarihinden ÖNCE ALMAYINIZ`;
  const items = [
    `• SGK hizmet dökümü (e-Devlet, barkodlu) — ${al14}. Randevudan en fazla 14 gün önce alınmış olmalı.`,
    `• Banka hesap dökümü (son 4 ay, kaşeli/onaylı) — ${al14}. 14 gün geçerlidir.`,
    ...(ticari ? [`• Oda kaydı faaliyet belgesi — ${trDate(addMonths(appt, -3))} tarihinden sonra alınmış olmalı (son 3 ay).`] : []),
    `• Maaş bordrosu (çalışanlar için) — son 3 ay: ${trDate(addMonths(appt, -3))} sonrası dönemler.`,
    `• Biyometrik fotoğraf — ${trDate(addMonths(appt, -6))} tarihinden sonra çekilmiş olmalı (son 6 ay).`,
    `• Seyahat sağlık sigortası — tüm seyahat tarihlerini kapsamalı.`,
  ];
  const ulke = v.country || 'Schengen';
  const text = `Sayın ${custName(v, cust)},

${ulke} vize randevunuz ${v.appointmentTime ? `${trDate(appt)} tarihinde saat ${v.appointmentTime} için` : `${trDate(appt)} tarihine`} alınmıştır.

Aşağıdaki belgelerin geçerlilik süresi sınırlıdır. Erken alınan belge konsoloslukta kabul edilmez; lütfen tarihlere dikkat ediniz:

${items.join('\n')}

Tüm belgeler en geç ${trDate(sonGun)} tarihinde hazır olmalıdır.

Sorularınız için bize ulaşabilirsiniz.
Paydos Turizm`;
  return { subject: `${ulke} vize randevunuz ${trDate(appt)} — süreli evraklar`, text, html: mailHtml(esc(text)), attachments: [] };
};

const sendMail = async (smtp, { to, subject, text, html, attachments }) => {
  const port = parseInt(String(smtp.port || '465').trim(), 10);
  const transporter = nodemailer.createTransport({ host: smtp.host.trim(), port, secure: port === 465, auth: { user: smtp.user.trim(), pass: String(smtp.pass) } });
  const files = [];
  for (const a of attachments || []) {
    try {
      const u = new URL(a.url);
      if (u.protocol !== 'https:' || !ALLOWED_ATTACHMENT_HOSTS.includes(u.hostname)) continue;
      const r = await fetch(a.url);
      if (r.ok) files.push({ filename: a.filename || 'ek', content: Buffer.from(await r.arrayBuffer()) });
    } catch (e) { console.warn('[evrakmail] ek indirilemedi:', a.filename, e.message); }
  }
  const from = validEmail(smtp.from) ? smtp.from.trim() : smtp.user.trim();
  return transporter.sendMail({ from, to, subject, text, html, attachments: files.length ? files : undefined });
};

const tg = async (token, chatId, text) => {
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), parse_mode: 'HTML', disable_web_page_preview: true }) });
  } catch (e) { console.warn('[evrakmail] telegram:', e.message); }
};

// Döner: { atama, sureli, epostaYok, sablonYok }
const processEvrakMails = async ({ db, send = sendMail, notify = tg } = {}) => {
  const settingsRef = db.collection('app_settings').doc('main');
  const settings = (await settingsRef.get()).data() || {};
  const res = { atama: 0, sureli: 0, epostaYok: [], sablonYok: [], hata: [] };
  const atamaOn = settings.autoEmailOnVisa !== false;
  const sureliOn = settings.autoSureliMail !== false;
  const smtp = settings.smtpVisa || {};
  // Açıkken SMTP yoksa hiçbir şey işaretleme — SMTP girilince bekleyenler gider
  if ((atamaOn || sureliOn) && (!smtp.host || !smtp.user || !smtp.pass)) { console.log('[evrakmail] Vize SMTP ayarı eksik (Ayarlar → Vize SMTP)'); return res; }
  const firstRun = !settings.evrakMailBasladi;
  const today = istDate();
  const now = new Date().toISOString();
  const custCache = new Map();
  const getCust = async (v) => {
    const id = v.customerId != null ? String(v.customerId) : '';
    if (!id) return null;
    if (!custCache.has(id)) { try { const d = await db.collection('customers').doc(id).get(); custCache.set(id, d.exists ? d.data() : null); } catch { custCache.set(id, null); } }
    return custCache.get(id);
  };
  const emailOf = (v, cust) => [cust?.email, v.customerEmail].map(e => String(e || '').trim()).find(validEmail) || '';

  // 1) Atama Bekliyor → şablon maili
  const s1 = await db.collection('visa_applications').where('status', '==', STATUS).get();
  for (const d of s1.docs) {
    const v = { id: d.id, ...d.data() };
    if (v.evrakMailAt || v.autoMailOff) continue;
    if (firstRun || !atamaOn) { await d.ref.set({ evrakMailAt: firstRun ? 'ilk-kurulum-atlandi' : 'kapali-atlandi' }, { merge: true }); continue; }
    const cust = await getCust(v);
    const to = emailOf(v, cust);
    if (!to) { if (!v.evrakMailEpostaYokAt) { res.epostaYok.push(custName(v, cust)); await d.ref.set({ evrakMailEpostaYokAt: now }, { merge: true }); } continue; }
    const mail = buildTemplateMail(v, cust, settings);
    if (!mail) { if (!v.evrakMailSablonYokAt) { res.sablonYok.push(v.visaDuration || v.visaType || v.categoryId || '?'); await d.ref.set({ evrakMailSablonYokAt: now }, { merge: true }); } continue; }
    try { await send(smtp, { to, ...mail }); await d.ref.set({ evrakMailAt: now, evrakMailTo: to }, { merge: true }); res.atama++; }
    catch (e) { res.hata.push(`${custName(v, cust)}: ${e.message}`); }
  }

  // 2) Randevu girilmiş Schengen başvuruları → süreli evrak maili (randevu değişirse yeniden)
  const s2 = await db.collection('visa_applications').where('appointmentDate', '>=', today).get();
  for (const d of s2.docs) {
    const v = { id: d.id, ...d.data() };
    const appt = String(v.appointmentDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appt) || v.sureliMailFor === appt || closed(v)) continue;
    if ((v.categoryId || v.category || 'schengen') !== 'schengen' || v.autoMailOff) continue;
    if (firstRun || !sureliOn) { await d.ref.set({ sureliMailFor: appt, sureliMailAt: firstRun ? 'ilk-kurulum-atlandi' : 'kapali-atlandi' }, { merge: true }); continue; }
    const cust = await getCust(v);
    const to = emailOf(v, cust);
    if (!to) { if (v.sureliEpostaYokFor !== appt) { res.epostaYok.push(`${custName(v, cust)} (randevu ${trDate(appt)})`); await d.ref.set({ sureliEpostaYokFor: appt }, { merge: true }); } continue; }
    try { await send(smtp, { to, ...buildSureliMail(v, cust, today) }); await d.ref.set({ sureliMailFor: appt, sureliMailAt: now, sureliMailTo: to }, { merge: true }); res.sureli++; }
    catch (e) { res.hata.push(`${custName(v, cust)}: ${e.message}`); }
  }

  if (firstRun) await settingsRef.set({ evrakMailBasladi: now }, { merge: true });

  // Gruba özet (sadece bir şey olduysa)
  const lines = [];
  if (res.atama) lines.push(`📧 Evrak maili gönderildi: <b>${res.atama}</b> kişi`);
  if (res.sureli) lines.push(`⏳ Süreli evrak maili gönderildi: <b>${res.sureli}</b> kişi`);
  if (res.epostaYok.length) lines.push(`⚠️ E-postası olmadığı için mail gidemedi — CRM'e e-posta ekleyin, sonraki turda gider:\n${res.epostaYok.map(n => `• ${esc(n)}`).join('\n')}`);
  if (res.sablonYok.length) lines.push(`⚠️ Şablonu olmayan vize türü (Ayarlar → Vize Türü Bazlı Mail Şablonları):\n${[...new Set(res.sablonYok)].map(n => `• ${esc(n)}`).join('\n')}`);
  if (res.hata.length) lines.push(`❌ Gönderilemedi (tekrar denenecek):\n${res.hata.slice(0, 10).map(n => `• ${esc(n)}`).join('\n')}`);
  if (lines.length) await notify(settings.telegramBotToken, settings.telegramVizeGrupId, lines.join('\n\n'));
  return res;
};

exports.processEvrakMails = processEvrakMails;
exports.buildSureliMail = buildSureliMail;

exports.vizeEvrakMail = functions
  .region('europe-west1')
  .pubsub.schedule('*/15 8-20 * * *').timeZone(TZ)
  .onRun(async () => {
    const r = await processEvrakMails({ db: getFirestore('paydos') });
    console.log('[evrakmail]', JSON.stringify({ atama: r.atama, sureli: r.sureli, epostaYok: r.epostaYok.length, sablonYok: r.sablonYok.length, hata: r.hata.length }));
    return null;
  });
