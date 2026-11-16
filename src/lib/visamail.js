// ===== Vize mailleri (CRM) — bilgilendirme ve randevu maili metni + gönderim =====
// Metinler bot telegram-bot/functions/evrakmail.js (buildTemplateMail / buildRandevuMail / mailSubject) ile BİREBİR aynı kurallarla
// üretilir: otomatik giden mail ile elle gönderilen aynı görünür. Birini değiştirirseniz ötekini de değiştirin.
import { titleCaseTr, trHas, normalizeTr, normEmail } from './turkish.js';
import { RANDEVU_MAIL_DEFAULT, VISA_EMAIL } from './data.js';
import { mailHtml, sendMailRequest } from './api.js';

const TZ = 'Europe/Istanbul';
export const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const trDate = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || ''); };
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const trDateDay = (ymd) => `${trDate(ymd)} ${GUNLER[new Date(`${ymd}T12:00:00Z`).getUTCDay()]}`; // "26.11.2026 Perşembe"
const istDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const isoDay = (x) => /^\d{4}-\d{2}-\d{2}T/.test(String(x || '')) ? istDate(new Date(x)) : '';
// Evrak son teslim tarihleri (bot evrakmail.js evrakDeadlines ile aynı):
//  süresiz: Atama Bekliyor gününden (= ilk bilgilendirme mailinin günü) itibaren 10 gün
//  süreli: randevu atandığı günden (= ilk randevu mailinin günü) itibaren 2 gün; randevu 14 günden uzaksa süre randevuya 14 gün
//  kala başlar (süreli evrak daha önce alınamaz); randevudan bir gün öncesini geçmez.
export const evrakDeadlines = (v, today = istToday()) => {
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
const pick = (x, def) => (String(x || '').trim() ? String(x) : def);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

export const evrakLinkOf = (v) => { const l = String(v?.evrakLink || '').trim(); return /^https:\/\/\S+$/.test(l) ? l : ''; };
const isSchengen = (v) => (v.categoryId || v.category || 'schengen') === 'schengen';
const custName = (v, cust) => titleCaseTr(`${cust?.firstName || ''} ${cust?.lastName || ''}`.trim() || v.customerName || '');

// Konu her vize mailinde aynı: "Ad Soyad - Ülke Vize türü Vize Başvurusu" (bot mailSubject ile aynı).
// Tür ülkeyi içeriyorsa ülke yinelenmez; türün sonundaki "Vize" atılır ("Turistik Vize" → "… Turistik Vize Başvurusu").
export const visaMailSubject = (v, cust) => {
  const tur = titleCaseTr(String(v.visaDuration || v.visaType || '').trim());
  const ulke = titleCaseTr(String(v.country || '').trim());
  const w = tur.split(' ').filter(Boolean);
  if (w.length && /^vize(si)?$/.test(normalizeTr(w[w.length - 1]))) w.pop();
  const konu = [ulke && !trHas(tur, ulke) ? ulke : '', w.join(' ')].filter(Boolean).join(' ');
  const isim = custName(v, cust);
  return `${isim ? `${isim} - ` : ''}${konu ? `${konu} ` : ''}Vize Başvurusu`;
};

// Müşterinin e-postası (müşteri kartı önce)
export const visaMailTo = (v, cust) => [cust?.email, v?.customerEmail].map(normEmail).find(validEmail) || '';

// {vize_ucreti}: başvurudaki satış fiyatı; yoksa Ayarlar'daki tür fiyatı. "250 €" biçiminde, yoksa boş (bot visaFee ile aynı)
export const visaFee = (v, appSettings) => {
  let price = parseFloat(v.visaPrice || v.price) || 0, cur = v.visaCurrency || v.currency || '';
  if (!price) {
    const name = normalizeTr(v.visaDuration || v.visaType || '');
    const list = (appSettings?.visaDurations || {})[v.categoryId || v.category || 'schengen'] || [];
    const t = list.find(d => d && typeof d === 'object' && normalizeTr(d.name) === name);
    if (t) { price = parseFloat(t.price) || 0; cur = t.currency || ''; }
  }
  return price > 0 ? `${price.toLocaleString('tr-TR')} ${cur || '€'}` : '';
};

// 1. aşama — bilgilendirme maili: vize türü şablonu + bağlı ekler + evrak linki. Döner { subject, text, attachments } ya da { error }
export const buildInfoMail = (v, cust, appSettings) => {
  const vize_turu = v.visaDuration || v.visaType || '';
  const catId = v.categoryId || v.category || 'schengen';
  const templates = appSettings?.emailTemplates || {};
  const t = templates[vize_turu] || templates[catId];
  if (!t || (!t.subject && !t.body)) return { error: `"${vize_turu || catId}" için bilgilendirme şablonu yok (Ayarlar → Vize Türü Bazlı Mail Şablonları)` };
  const link = evrakLinkOf(v);
  const rep = (str) => String(str || '')
    .replace(/{isim}/g, custName(v, cust))
    .replace(/{ulke}/g, v.country || catId)
    .replace(/{tarih}/g, trDate(istToday()))
    .replace(/{saat}/g, v.appointmentTime || '')
    .replace(/{ref_no}/g, String(v.id || '').slice(-8).toUpperCase() || '-')
    .replace(/{vize_turu}/g, vize_turu)
    .replace(/{vize_ucreti}/g, visaFee(v, appSettings))
    .replace(/{suresiz_son_tarih}/g, evrakDeadlines(v).suresiz_son_tarih)
    .replace(/{evrak_linki}/g, link);
  const linkEk = link && !/{evrak_linki}/.test(String(t.body || '')) ? `\n\nEvraklarınızı aşağıdaki bağlantıdan yükleyebilirsiniz:\n${link}\nBağlantı çalışmazsa lütfen evraklarınızı bu maile cevap olarak gönderiniz.` : '';
  const attachments = (appSettings?.attachments || []).filter(a => a && a.url && a.linkedTypes?.includes(vize_turu)).map(a => ({ filename: a.name, url: a.url }));
  return { subject: visaMailSubject(v, cust), text: rep(t.body) + linkEk, attachments };
};

// 3. aşama — randevu maili: randevu bilgisi + Schengen'de süreli/süresiz evraklar. Döner { subject, text, attachments } ya da { error }
export const buildRandevuMail = (v, cust, appSettings, today = istToday()) => {
  const appt = String(v.appointmentDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appt)) return { error: 'Randevu tarihi girilmemiş' };
  const tpl = appSettings?.randevuMailTemplate;
  // Türkçe karakter kuralı: "ALMANYA TİCARİ" /ticari/i ile tanınmaz — önce ASCII küçük harfe indir
  const ticari = /ticari|fuar|\bis\b/.test(normalizeTr(`${v.visaDuration || ''} ${v.visaType || ''}`));
  const from14 = addDays(appt, -14);
  const sv = {
    on_dort_gun: from14 <= today ? 'bugünden itibaren alabilirsiniz' : `${trDate(from14)} tarihinden ÖNCE ALMAYINIZ`,
    uc_ay: trDate(addMonths(appt, -3)), alti_ay: trDate(addMonths(appt, -6)), son_gun: trDate(addDays(appt, -1)),
    ...evrakDeadlines(v, today),
  };
  const link = evrakLinkOf(v);
  const cond = (x) => String(x || '').replace(/\r\n/g, '\n').split('\n')
    .filter(l => { const m = /^\s*\[(ticari|link|linkyok)\]/.exec(l); return !m || (m[1] === 'ticari' ? ticari : m[1] === 'link' ? !!link : !link); })
    .map(l => l.replace(/^\s*\[(ticari|link|linkyok)\]\s*/, '')).join('\n');
  const block = (x) => !isSchengen(v) ? '' : cond(x).replace(/\{(on_dort_gun|uc_ay|alti_ay|son_gun|sureli_son_tarih|suresiz_son_tarih)\}/g, (m, k) => sv[k]).trim();
  const office = String(v.idataOffice || '').trim();
  const vals = {
    isim: custName(v, cust), ulke: v.country || 'Vize', tarih: trDate(appt), saat: v.appointmentTime || '',
    ofis: office ? (v.processor && !trHas(office, v.processor) ? `${trHas(v.processor, 'idata') ? 'iDATA' : v.processor} ${office}` : office) : '',
    pnr: String(v.pnr || '').trim(), sureli_son_tarih: sv.sureli_son_tarih, suresiz_son_tarih: sv.suresiz_son_tarih, sureli_evraklar: block(pick(tpl?.sureli, RANDEVU_MAIL_DEFAULT.sureli)), suresiz_evraklar: block(tpl?.suresiz), evrak_linki: link,
  };
  const KEYS = /\{(isim|ulke|tarih|saat|ofis|pnr|sureli_evraklar|suresiz_evraklar|evrak_linki|sureli_son_tarih|suresiz_son_tarih)\}/g;
  const fill = (str) => String(str).replace(KEYS, (m, k) => vals[k]);
  const emptyKey = (line) => (line.match(KEYS) || []).some(k => !vals[k.slice(1, -1)]);
  const text = cond(pick(tpl?.body, RANDEVU_MAIL_DEFAULT.body)).split('\n')
    .filter(l => !(emptyKey(l) && /^[^:{}]{0,30}:?[^:{}]{0,12}(\{\w+\}\s*)+$/.test(l.trim())))
    .map(fill).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { subject: visaMailSubject(v, cust), text, attachments: [] };
};

// Elle gönderim — Vize SMTP, yanıt adresi vize@. Metin düz yazıdır; şablonda HTML etiketi varsa olduğu gibi bırakılır (otomatik mailde de öyle).
export const sendVisaMail = async ({ to, subject, text, attachments = [], appSettings }) => {
  const addr = normEmail(to);
  if (!validEmail(addr)) throw new Error('Geçerli bir e-posta adresi girin');
  if (!String(subject || '').trim()) throw new Error('Konu boş olamaz');
  if (!String(text || '').trim()) throw new Error('Mail metni boş olamaz');
  const body = /<[a-z][\s\S]*>/i.test(text) ? text : esc(text);
  const resp = await sendMailRequest({
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: addr, subject: subject.trim(), html: mailHtml(body, VISA_EMAIL), text, attachments, replyTo: VISA_EMAIL, smtp: appSettings?.smtpVisa }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Gönderim hatası (${resp.status})`);
  return addr;
};
