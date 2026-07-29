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

    // Ekleri (varsa) URL üzerinden ilet
    let mailAttachments;
    if (Array.isArray(attachments) && attachments.length) {
      mailAttachments = attachments
        .filter(a => a && a.url)
        .map(a => ({ filename: a.filename || 'ek', path: a.url }));
    }

    const info = await transporter.sendMail({
      // İstekte from varsa (örn. tur@paydostur.com) onu kullan, yoksa varsayılan
      from: from || defaultFrom,
      to,
      subject,
      text: text || '',
      html: html || undefined,
      attachments: mailAttachments,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, messageId: info.messageId }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Gönderim hatası' }),
    };
  }
};
