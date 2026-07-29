// Netlify Function: send-mail
// Konum: netlify/functions/send-mail.js
// Gerekli env değişkenleri (Netlify → Site configuration → Environment variables):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Not: package.json'a "nodemailer" bağımlılığı eklenmeli.

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
    const { to, from, subject, html, text, attachments } = JSON.parse(event.body || '{}');

    if (!to || !subject) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'to ve subject zorunlu' }) };
    }

    const port = parseInt(process.env.SMTP_PORT || '465', 10);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // 465 -> SSL, 587 -> STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Ekleri (varsa) URL'den indirilebilir bağlantı olarak ilet
    let mailAttachments;
    if (Array.isArray(attachments) && attachments.length) {
      mailAttachments = attachments
        .filter(a => a && a.url)
        .map(a => ({ filename: a.filename || 'ek', path: a.url }));
    }

    const info = await transporter.sendMail({
      // from parametresi gelirse onu kullan (örn. tur@paydostur.com),
      // gelmezse varsayılan SMTP_FROM'a düş
      from: from || process.env.SMTP_FROM || process.env.SMTP_USER,
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
