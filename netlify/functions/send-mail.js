// Netlify Function: send-mail
// Konum: netlify/functions/send-mail.js
//
// SMTP bilgileri iki kaynaktan gelebilir:
//   1) İstek gövdesindeki "smtp" objesi (CRM → Ayarlar → Mail Ayarları'ndan girilen)
//   2) Netlify Environment Variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM)
// Öncelik: gövdeden gelen dolu alanlar; boş olanlar env'e düşer.
//
// package.json'a "nodemailer" bağımlılığı gereklidir.

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { to, from, subject, html, text, attachments, smtp } = JSON.parse(event.body || '{}');

    if (!to || !subject) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'to ve subject zorunlu' }) };
    }

    const s = smtp || {};
    // Gövdeden gelen değer varsa onu, yoksa env'i kullan
    const host = (s.host && s.host.trim()) || process.env.SMTP_HOST;
    const port = parseInt((s.port && String(s.port).trim()) || process.env.SMTP_PORT || '465', 10);
    const user = (s.user && s.user.trim()) || process.env.SMTP_USER;
    const pass = (s.pass && String(s.pass)) || process.env.SMTP_PASS;
    const defaultFrom = (s.from && s.from.trim()) || process.env.SMTP_FROM || user;

    if (!host || !user || !pass) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'SMTP bilgileri eksik (host/user/pass). Ayarlar → Mail Ayarları veya Netlify env kontrol edin.' }) };
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 -> SSL, 587 -> STARTTLS
      auth: { user, pass },
    });

    // Ekleri sunucuda indir, indirilemeyenleri atla (mail yine gitsin)
    let mailAttachments = [];
    const attachWarnings = [];
    if (Array.isArray(attachments) && attachments.length) {
      for (const a of attachments) {
        if (!a || !a.url) continue;
        try {
          const resp = await fetch(a.url);
          if (!resp.ok) { attachWarnings.push(`${a.filename || 'ek'}: indirilemedi (${resp.status})`); continue; }
          const buf = Buffer.from(await resp.arrayBuffer());
          mailAttachments.push({ filename: a.filename || 'ek', content: buf });
        } catch (e) {
          attachWarnings.push(`${a.filename || 'ek'}: ${e.message}`);
        }
      }
    }

    // Gelen from geçerli bir e-posta mı? Değilse (örn. ".com" eksik) defaultFrom kullan
    const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
    const finalFrom = validEmail(from) ? from.trim() : defaultFrom;

    const info = await transporter.sendMail({
      from: finalFrom,
      to,
      subject,
      text: text || '',
      html: html || undefined,
      attachments: mailAttachments.length ? mailAttachments : undefined,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, messageId: info.messageId, attachmentWarnings: attachWarnings.length ? attachWarnings : undefined }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Gönderim hatası' }),
    };
  }
};
