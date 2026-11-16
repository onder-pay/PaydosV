// ===== Vize: otomatik evrak mailleri =====
// 1) Başvuru "Atama Bekliyor" olunca → CRM'deki vize türü şablonu (Ayarlar → Vize Türü Bazlı Mail Şablonları) + bağlı ekler.
// 2) Randevu tarihi girilince (elle ya da iDATA mailinden, her kategori) → randevu maili; Schengen'de süreli evraklar listesi aynı mailde.
//    Randevu değişirse yeni tarihle tekrar gönderilir.
// 15 dakikada bir çalışır. Aynı mail iki kez gitmez (visa_applications.evrakMailAt / sureliMailFor).
// E-postası olmayan başvuru bekletilir: vizeci e-postayı ekleyince sonraki turda gider; gruba bir kez haber verilir.
// İlk çalışmada mevcut birikmiş kayıtlara mail gitmez, sessizce işaretlenir (app_settings/main.evrakMailBasladi).
// Açma/kapama: app_settings.autoEmailOnVisa (Atama Bekliyor maili) ve autoSureliMail (randevu maili).
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
const { titleCaseTr: titleTr, normTr, trHas, normEmail, statusLabels } = require('./tr'); // Türkçe karakter kuralı (CLAUDE.md)
const istDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); // YYYY-MM-DD
const trDate = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || ''); };
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const trDateDay = (ymd) => `${trDate(ymd)} ${GUNLER[new Date(`${ymd}T12:00:00Z`).getUTCDay()]}`; // "26.11.2026 Perşembe"
const isoDay = (x) => /^\d{4}-\d{2}-\d{2}T/.test(String(x || '')) ? istDate(new Date(x)) : '';
// Evrak son teslim tarihleri (CRM src/lib/visamail.js evrakDeadlines ile aynı):
//  süresiz evraklar: Atama Bekliyor gününden (= ilk bilgilendirme mailinin günü) itibaren 10 gün
//  süreli evraklar: randevu atandığı günden (= ilk randevu mailinin günü) itibaren 2 gün. Süreli evrak randevudan en fazla
//  14 gün önce alınabildiği için randevu 14 günden uzaksa süre "randevuya 14 gün kala"dan başlar; randevudan bir gün öncesini geçmez.
const evrakDeadlines = (v, today) => {
  const suresiz = addDays(isoDay(v.evrakMailAt) || today, 10);
  const appt = String(v.appointmentDate || '').slice(0, 10);
  let sureli = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(appt)) {
    const atandi = (v.sureliMailFor === appt && isoDay(v.sureliMailAt)) || today;
    const from14 = addDays(appt, -14);
    sureli = addDays(atandi > from14 ? atandi : from14, 2);
    const last = addDays(appt, -1);
    if (sureli > last) sureli = last;
  }
  return { suresiz_son_tarih: trDateDay(suresiz), sureli_son_tarih: sureli ? trDateDay(sureli) : '' };
};
const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const closed = (v) => /onay|red|iptal/.test(normTr(v.status)); // 'IPTAL' tr-lower'da 'ıptal' olurdu

// Vize işlemlerinin acente adresi (CRM data.js VISA_EMAIL ile aynı): yanıt adresi ve alt bilgi
const VISA_EMAIL = 'vize@paydostur.com';
// CRM'deki mailHtml ile aynı görünüm
const mailHtml = (bodyText) => `<div style="background:#f4f5f7;padding:24px 12px"><div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
<div style="padding:18px 24px;border-bottom:3px solid #FF4141"><img src="${MAIL_LOGO_URL}" alt="Paydos Turizm" width="150" height="58" style="display:block;width:150px;height:58px;border:0"></div>
<pre style="margin:0;padding:22px 24px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;white-space:pre-wrap;">${bodyText}</pre>
<div style="padding:12px 24px;background:#fafafa;border-top:1px solid #eee;font-family:Arial,sans-serif;font-size:11px;color:#6b7280">Paydos Turizm · 0 258 263 71 76 · www.paydostur.com · <a href="mailto:${VISA_EMAIL}" style="color:#6b7280">${VISA_EMAIL}</a></div></div></div>`;

const custName = (v, cust) => titleTr(`${cust?.firstName || ''} ${cust?.lastName || ''}`.trim() || v.customerName || '');

// Konu her vize mailinde aynı kalıp: "Ad Soyad - Ülke - Vize türü" (şablondaki konu kullanılmaz; CRM sendVisaEmail ile aynı).
// Vize türü ülkeyi zaten içeriyorsa ("ALMANYA TİCARİ") ülke yinelenmez.
const mailSubject = (v, cust) => {
  const tur = titleTr(String(v.visaDuration || v.visaType || '').trim());
  const ulke = titleTr(String(v.country || '').trim());
  return [custName(v, cust), ulke && !trHas(tur, ulke) ? ulke : '', tur].filter(Boolean).join(' - ') || 'Vize başvurunuz';
};

// {vize_ucreti}: başvurudaki satış fiyatı (vize türü seçilince gelir); yoksa Ayarlar'daki tür fiyatı. "250 €" biçiminde, yoksa boş.
// CRM src/lib/visamail.js visaFee ile aynı.
const visaFee = (v, settings) => {
  let price = parseFloat(v.visaPrice || v.price) || 0, cur = v.visaCurrency || v.currency || '';
  if (!price) {
    const name = normTr(v.visaDuration || v.visaType || '');
    const list = (settings?.visaDurations || {})[v.categoryId || v.category || 'schengen'] || [];
    const t = list.find(d => d && typeof d === 'object' && normTr(d.name) === name);
    if (t) { price = parseFloat(t.price) || 0; cur = t.currency || ''; }
  }
  return price > 0 ? `${price.toLocaleString('tr-TR')} ${cur || '€'}` : '';
};

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
    .replace(/{vize_turu}/g, vize_turu)
    .replace(/{vize_ucreti}/g, visaFee(v, settings))
    .replace(/{suresiz_son_tarih}/g, evrakDeadlines(v, istDate()).suresiz_son_tarih)
    .replace(/{evrak_linki}/g, evrakLinkOf(v));
  // Vize Evrak yükleme linki: şablonda {evrak_linki} yoksa metnin sonuna kendiliğinden eklenir (CRM sendVisaEmail ile aynı metin)
  const link = evrakLinkOf(v);
  const linkEk = link && !/{evrak_linki}/.test(String(t.body || '')) ? `\n\nEvraklarınızı aşağıdaki bağlantıdan yükleyebilirsiniz:\n${link}\nBağlantı çalışmazsa lütfen evraklarınızı bu maile cevap olarak gönderiniz.` : '';
  const text = rep(t.body) + linkEk;
  const attachments = (settings.attachments || []).filter(a => a && a.url && a.linkedTypes?.includes(vize_turu)).map(a => ({ filename: a.name, url: a.url }));
  return { subject: mailSubject(v, cust), text, html: mailHtml(text), attachments }; // CRM test maili ile birebir (şablon HTML'i olduğu gibi)
};

// 2. aşama: randevu maili — randevu bilgisi (tarih, saat, ofis, PNR) + Schengen'de süreli evraklar, TEK mailde.
// Şablon Ayarlar → Vize mail → Randevu Maili Şablonu (app_settings.randevuMailTemplate = { body, sureli, suresiz }); boş alan varsayılana düşer.
// Varsayılanlar CRM src/lib/data.js RANDEVU_MAIL_DEFAULT ile birebir aynı olmalı.
// Alanlar: {isim} {ulke} {tarih} {saat} {ofis} {pnr} {sureli_evraklar} {suresiz_evraklar} (ikisi de yalnız Schengen) {sureli_son_tarih} {suresiz_son_tarih};
// süreli bölümde: {on_dort_gun} {uc_ay} {alti_ay} {son_gun}.
// {evrak_linki}: başvurudaki Vize Evrak yükleme linki (visa_applications.evrakLink). "[link]" ile başlayan satır yalnız link varsa,
// "[linkyok]" ile başlayan yalnız link yoksa çıkar.
// Değeri boş alanın yalnız etiketten oluşan satırı ("Saat: {saat}") atılır. "[ticari]" ile başlayan satır yalnız ticari/fuar vizesinde çıkar.
const RANDEVU_MAIL_DEFAULT = {
  body: `Sayın {isim},

{ulke} vize randevunuz alınmıştır.

Tarih: {tarih}
Saat: {saat}
Yer: {ofis}
PNR: {pnr}

Lütfen randevu saatinden en az 15 dakika önce, pasaportunuz ve evraklarınızın tamamı ile birlikte ofiste hazır bulununuz.

{sureli_evraklar}

{suresiz_evraklar}

[link] Evraklarınızı aşağıdaki bağlantıdan yükleyebilirsiniz:
[link] {evrak_linki}
[link] Bağlantı çalışmazsa lütfen evraklarınızı bu maile cevap olarak gönderiniz.
[linkyok] Evraklarınızı bu maile cevap olarak gönderebilirsiniz.

Sorularınız için bize ulaşabilirsiniz.
Paydos Turizm`,
  sureli: `SÜRELİ EVRAKLAR
Aşağıdaki belgelerin geçerlilik süresi sınırlıdır. Erken alınan belge konsoloslukta kabul edilmez; lütfen tarihlere dikkat ediniz:

• SGK hizmet dökümü (e-Devlet, barkodlu) — {on_dort_gun}. Randevudan en fazla 14 gün önce alınmış olmalı.
• Banka hesap dökümü (son 4 ay, kaşeli/onaylı) — {on_dort_gun}. 14 gün geçerlidir.
[ticari] • Oda kaydı faaliyet belgesi — {uc_ay} tarihinden sonra alınmış olmalı (son 3 ay).
• Maaş bordrosu (çalışanlar için) — son 3 ay: {uc_ay} sonrası dönemler.
• Biyometrik fotoğraf — {alti_ay} tarihinden sonra çekilmiş olmalı (son 6 ay).
• Seyahat sağlık sigortası — tüm seyahat tarihlerini kapsamalı.

📅 Süreli evrakların son teslim tarihi: {sureli_son_tarih}`,
  suresiz: '', // süresiz evraklar: acente Ayarlar'dan yazar; boşsa bölüm mailde yer almaz
};
// Vize Evrak yükleme linki: yalnız https ve boşluksuz ise kullanılır
const evrakLinkOf = (v) => { const l = String(v.evrakLink || '').trim(); return /^https:\/\/\S+$/.test(l) ? l : ''; };
const isSchengen = (v) => (v.categoryId || v.category || 'schengen') === 'schengen';
const pick = (x, def) => (String(x || '').trim() ? String(x) : def);
const buildRandevuMail = (v, cust, today, tpl) => {
  const appt = String(v.appointmentDate || '').slice(0, 10);
  // Türkçe karakter kuralı: "ALMANYA TİCARİ" /ticari/i ile tanınmaz (İ≠i) — önce ASCII küçük harfe indir
  const ticari = /ticari|fuar|\bis\b/.test(normTr(`${v.visaDuration || ''} ${v.visaType || ''}`));
  const from14 = addDays(appt, -14);
  const sv = {
    on_dort_gun: from14 <= today ? 'bugünden itibaren alabilirsiniz' : `${trDate(from14)} tarihinden ÖNCE ALMAYINIZ`,
    uc_ay: trDate(addMonths(appt, -3)), alti_ay: trDate(addMonths(appt, -6)), son_gun: trDate(addDays(appt, -1)),
    ...evrakDeadlines(v, today),
  };
  const link = evrakLinkOf(v);
  // Satır başı koşulları: [ticari] [link] [linkyok]
  const cond = (x) => String(x || '').replace(/\r\n/g, '\n').split('\n')
    .filter(l => { const m = /^\s*\[(ticari|link|linkyok)\]/.exec(l); return !m || (m[1] === 'ticari' ? ticari : m[1] === 'link' ? !!link : !link); })
    .map(l => l.replace(/^\s*\[(ticari|link|linkyok)\]\s*/, '')).join('\n');
  const block = (x) => !isSchengen(v) ? '' : cond(x).replace(/\{(on_dort_gun|uc_ay|alti_ay|son_gun|sureli_son_tarih|suresiz_son_tarih)\}/g, (m, k) => sv[k]).trim();
  const sureli = block(pick(tpl?.sureli, RANDEVU_MAIL_DEFAULT.sureli));
  const suresiz = block(tpl?.suresiz);
  const office = String(v.idataOffice || '').trim();
  const vals = {
    isim: custName(v, cust), ulke: v.country || 'Vize', tarih: trDate(appt), saat: v.appointmentTime || '',
    ofis: office ? (v.processor && !trHas(office, v.processor) ? `${trHas(v.processor, 'idata') ? 'iDATA' : v.processor} ${office}` : office) : '', pnr: String(v.pnr || '').trim(), sureli_evraklar: sureli, suresiz_evraklar: suresiz, evrak_linki: link,
    sureli_son_tarih: sv.sureli_son_tarih, suresiz_son_tarih: sv.suresiz_son_tarih,
  };
  const KEYS = /\{(isim|ulke|tarih|saat|ofis|pnr|sureli_evraklar|suresiz_evraklar|evrak_linki|sureli_son_tarih|suresiz_son_tarih)\}/g;
  const fill = (str) => String(str).replace(KEYS, (m, k) => vals[k]);
  const emptyKey = (line) => (line.match(KEYS) || []).some(k => !vals[k.slice(1, -1)]);
  const text = cond(pick(tpl?.body, RANDEVU_MAIL_DEFAULT.body)).split('\n')
    .filter(l => !(emptyKey(l) && /^[^:{}]{0,30}:?[^:{}]{0,12}(\{\w+\}\s*)+$/.test(l.trim())))
    .map(fill).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { subject: mailSubject(v, cust), text, html: mailHtml(esc(text)), attachments: [] };
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
  return transporter.sendMail({ from, to, replyTo: VISA_EMAIL, subject, text, html, attachments: files.length ? files : undefined });
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
  const res = { atama: 0, sureli: 0, epostaYok: [], sablonYok: [], hata: [], kisiler: [] }; // kisiler: { tur: 'bilgi'|'randevu', ad, ok, neden }
  const kisi = (tur, ad, ok, neden = '') => res.kisiler.push({ tur, ad, ok, neden });
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
  const emailOf = (v, cust) => [cust?.email, v.customerEmail].map(normEmail).find(validEmail) || ''; // 'İnfo@' → 'info@'

  // 1) Atama Bekliyor → şablon maili
  const s1 = await db.collection('visa_applications').where('status', 'in', statusLabels(settings, STATUS)).get(); // yazım farkı (ATAMA BEKLİYOR) da yakalanır
  for (const d of s1.docs) {
    const v = { id: d.id, ...d.data() };
    if (v.evrakMailAt || v.autoMailOff) continue;
    if (firstRun || !atamaOn) { await d.ref.set({ evrakMailAt: firstRun ? 'ilk-kurulum-atlandi' : 'kapali-atlandi' }, { merge: true }); continue; }
    const cust = await getCust(v);
    const to = emailOf(v, cust);
    if (!to) { if (!v.evrakMailEpostaYokAt) { res.epostaYok.push(custName(v, cust)); kisi('bilgi', custName(v, cust), false, 'e-posta yok'); await d.ref.set({ evrakMailEpostaYokAt: now }, { merge: true }); } continue; }
    const mail = buildTemplateMail(v, cust, settings);
    if (!mail) { if (!v.evrakMailSablonYokAt) { const tur = v.visaDuration || v.visaType || v.categoryId || '?'; res.sablonYok.push(tur); kisi('bilgi', custName(v, cust), false, `şablon yok: ${tur}`); await d.ref.set({ evrakMailSablonYokAt: now }, { merge: true }); } continue; }
    try { await send(smtp, { to, ...mail }); await d.ref.set({ evrakMailAt: now, evrakMailTo: to }, { merge: true }); res.atama++; kisi('bilgi', custName(v, cust), true); }
    catch (e) { res.hata.push(`${custName(v, cust)}: ${e.message}`); kisi('bilgi', custName(v, cust), false, `hata: ${e.message} — tekrar denenecek`); }
  }

  // 2) Randevusu girilmiş başvurular → randevu maili (randevu değişirse yeniden)
  // Eskiden yalnız Schengen'e gidiyordu: geçişte mevcut diğer kategori randevularına toplu mail gitmesin diye bir kez sessizce işaretlenir.
  const stateRef = db.collection('bot_state').doc('evrakMail');
  const gecis = !firstRun && !((await stateRef.get()).data() || {}).randevuTumKategori;
  const s2 = await db.collection('visa_applications').where('appointmentDate', '>=', today).get();
  for (const d of s2.docs) {
    const v = { id: d.id, ...d.data() };
    const appt = String(v.appointmentDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appt) || v.sureliMailFor === appt || closed(v)) continue;
    if (v.autoMailOff) continue;
    if (gecis && !isSchengen(v)) { await d.ref.set({ sureliMailFor: appt, sureliMailAt: 'gecis-atlandi' }, { merge: true }); continue; }
    if (firstRun || !sureliOn) { await d.ref.set({ sureliMailFor: appt, sureliMailAt: firstRun ? 'ilk-kurulum-atlandi' : 'kapali-atlandi' }, { merge: true }); continue; }
    const cust = await getCust(v);
    const to = emailOf(v, cust);
    if (!to) { if (v.sureliEpostaYokFor !== appt) { res.epostaYok.push(`${custName(v, cust)} (randevu ${trDate(appt)})`); kisi('randevu', `${custName(v, cust)} (randevu ${trDate(appt)})`, false, 'e-posta yok'); await d.ref.set({ sureliEpostaYokFor: appt }, { merge: true }); } continue; }
    try { await send(smtp, { to, ...buildRandevuMail(v, cust, today, settings.randevuMailTemplate) }); await d.ref.set({ sureliMailFor: appt, sureliMailAt: now, sureliMailTo: to }, { merge: true }); res.sureli++; kisi('randevu', `${custName(v, cust)} (randevu ${trDate(appt)})`, true); }
    catch (e) { res.hata.push(`${custName(v, cust)}: ${e.message}`); kisi('randevu', `${custName(v, cust)} (randevu ${trDate(appt)})`, false, `hata: ${e.message} — tekrar denenecek`); }
  }

  // Haftalık özet için sistem hata kaydı (isim yazılmaz)
  if (res.hata.length || res.epostaYok.length || res.sablonYok.length) {
    const { logError, flushErrors } = require('./syslog');
    for (const h of res.hata) logError('evrakmail', `Mail gönderilemedi: ${String(h).split(': ').slice(1).join(': ') || h}`, db);
    if (res.epostaYok.length) logError('evrakmail', `E-postası olmadığı için mail gidemedi (${res.epostaYok.length} başvuru)`, db);
    for (const t of new Set(res.sablonYok)) logError('evrakmail', `Şablonu olmayan vize türü: ${t}`, db);
    await flushErrors();
  }
  if (firstRun) await settingsRef.set({ evrakMailBasladi: now }, { merge: true });
  if (firstRun || gecis) await stateRef.set({ randevuTumKategori: now }, { merge: true });

  // Gruba özet (sadece bir şey olduysa)
  const lines = [];
  // Kişi kişi: adın yanında gönderildi / gönderilemedi (+ neden)
  const satir = (k) => `• ${esc(k.ad)} — ${k.ok ? '✅ gönderildi' : `❌ gönderilemedi (${esc(k.neden)})`}`;
  for (const [tur, baslik] of [['bilgi', '📧 Bilgilendirme maili'], ['randevu', '📅 Randevu maili']]) {
    const ks = res.kisiler.filter(k => k.tur === tur);
    if (!ks.length) continue;
    const n = ks.filter(k => k.ok).length;
    lines.push(`<b>${baslik}</b> — ${n} gönderildi${ks.length - n ? `, ${ks.length - n} gönderilemedi` : ''}\n${[...ks.filter(k => k.ok), ...ks.filter(k => !k.ok)].slice(0, 40).map(satir).join('\n')}${ks.length > 40 ? `\n… ve ${ks.length - 40} kişi daha` : ''}`);
  }
  const notlar = [];
  if (res.epostaYok.length) notlar.push('E-postası olmayanlara CRM\'de e-posta ekleyin; sonraki turda gider.');
  if (res.sablonYok.length) notlar.push(`Şablonu olmayan tür: ${[...new Set(res.sablonYok)].map(esc).join(', ')} (Ayarlar → Vize Mail Ayarları). Şablon yazılınca sonraki turda gider.`);
  if (notlar.length) lines.push(`ℹ️ ${notlar.join('\n')}`);
  if (lines.length) await notify(settings.telegramBotToken, settings.telegramVizeGrupId, lines.join('\n\n'));
  return res;
};

exports.processEvrakMails = processEvrakMails;
exports.sendMail = sendMail;
exports.mailHtml = mailHtml;
exports.buildRandevuMail = buildRandevuMail;
exports.RANDEVU_MAIL_DEFAULT = RANDEVU_MAIL_DEFAULT;
exports.istDate = istDate;
exports.mailSubject = mailSubject;
exports.buildTemplateMail = buildTemplateMail;
exports.visaFee = visaFee;
exports.evrakDeadlines = evrakDeadlines;

exports.vizeEvrakMail = functions
  .region('europe-west1')
  .pubsub.schedule('*/15 8-20 * * *').timeZone(TZ)
  .onRun(async () => {
    const r = await processEvrakMails({ db: getFirestore('paydos') });
    console.log('[evrakmail]', JSON.stringify({ atama: r.atama, sureli: r.sureli, epostaYok: r.epostaYok.length, sablonYok: r.sablonYok.length, hata: r.hata.length }));
    return null;
  });
