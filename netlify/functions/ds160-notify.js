// Netlify Function: ds160-notify
// Müşteri DS-160 formunu gönderince ofise (vize@paydostur.com) bilgi maili atar.
//
// Güvenlik: Form girişsiz doldurulduğu için istek kimliksizdir. Bu yüzden:
//  - Alıcı sabittir (DS160_NOTIFY_TO env, yoksa vize@paydostur.com) — dışarıdan değiştirilemez.
//  - Mail içeriği istekten değil, Firestore'daki başvurudan okunur; başvuru gerçekten
//    tamamlanmış (done=true) olmalıdır.
//  - Her başvuru için tek mail: gönderimden sonra notifiedAt yazılır, varsa tekrar gönderilmez.
//
// SMTP bilgileri Netlify env'den okunur: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM

const nodemailer = require('nodemailer');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'paydos-crm';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'paydos';
const NOTIFY_TO = process.env.DS160_NOTIFY_TO || 'vize@paydostur.com';
const CRM_URL = process.env.CRM_URL || 'https://crm.paydostur.com';

const docUrl = (id) =>
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/ds160_applications/${encodeURIComponent(id)}`;

const str = (fields, key) => (fields && fields[key] && (fields[key].stringValue ?? fields[key].integerValue ?? fields[key].doubleValue)) || '';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let id;
  try { id = JSON.parse(event.body || '{}').id; } catch { return json(400, { error: 'Geçersiz JSON' }); }
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(id)) return json(400, { error: 'Geçersiz başvuru kimliği' });

  // 1) Başvuruyu Firestore'dan oku (kurallar ds160_applications için tekil okumaya izin veriyor)
  let fields;
  try {
    const resp = await fetch(docUrl(id));
    if (resp.status === 404) return json(404, { error: 'Başvuru bulunamadı' });
    if (!resp.ok) return json(502, { error: `Başvuru okunamadı (${resp.status})` });
    fields = (await resp.json()).fields || {};
  } catch (e) {
    return json(502, { error: 'Başvuru okunamadı: ' + e.message });
  }

  if (!(fields.done && fields.done.booleanValue === true)) return json(409, { error: 'Başvuru henüz tamamlanmamış' });
  if (fields.notifiedAt) return json(200, { ok: true, skipped: 'Bu başvuru için bildirim zaten gönderilmiş' });

  // 2) Maili gönder
  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return json(500, { error: 'SMTP env değişkenleri eksik (SMTP_HOST / SMTP_USER / SMTP_PASS)' });
  const port = parseInt(process.env.SMTP_PORT || '465', 10);

  const name = str(fields, 'customerName') || 'İsimsiz';
  const phone = str(fields, 'customerPhone');
  const email = str(fields, 'customerEmail');
  const progress = str(fields, 'progress');
  const rows = [['Ad Soyad', name], ['Telefon', phone], ['E-posta', email], ['Doluluk', progress ? `%${progress}` : ''], ['Başvuru No', id]]
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:6px 12px;color:#64748b">${esc(k)}</td><td style="padding:6px 12px;font-weight:600">${esc(v)}</td></tr>`)
    .join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">
    <h2 style="color:#1e3a5c;margin:0 0 12px">🇺🇸 Yeni DS-160 başvurusu tamamlandı</h2>
    <table style="border-collapse:collapse;background:#f8fafc;border-radius:8px">${rows}</table>
    <p style="margin:16px 0 0">Detaylar ve PDF için: <a href="${esc(CRM_URL)}">${esc(CRM_URL)}</a> → 🇺🇸 Amerika Vize</p>
  </div>`;
  const text = `Yeni DS-160 başvurusu tamamlandı\n\nAd Soyad: ${name}\nTelefon: ${phone}\nE-posta: ${email}\nBaşvuru No: ${id}\n\nCRM: ${CRM_URL} → Amerika Vize`;

  try {
    const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || user,
      to: NOTIFY_TO,
      replyTo: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
      subject: `DS-160 tamamlandı: ${name}`,
      text,
      html,
    });
  } catch (e) {
    return json(500, { error: 'Mail gönderilemedi: ' + e.message });
  }

  // 3) Tekrar gönderimi önlemek için işaretle (başarısız olsa da mail gitti; hata döndürme)
  try {
    await fetch(`${docUrl(id)}?updateMask.fieldPaths=notifiedAt`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { notifiedAt: { stringValue: new Date().toISOString() } } }),
    });
  } catch { /* yoksay */ }

  return json(200, { ok: true });
};
