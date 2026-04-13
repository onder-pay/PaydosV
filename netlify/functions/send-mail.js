const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const { to, subject, html, text, attachments = [] } = JSON.parse(event.body);

    if (!to || !subject || (!html && !text)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'to, subject ve html/text zorunludur' }) };
    }

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587');
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || 'vize@paydostur.com';

    if (!smtpHost || !smtpUser || !smtpPass) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'SMTP ayarları eksik' }) };
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
      tls: { rejectUnauthorized: false }
    });

    // Ekleri URL'den indir
    const mailAttachments = [];
    for (const att of attachments) {
      if (!att.url || !att.filename) continue;
      try {
        const resp = await fetch(att.url);
        if (!resp.ok) continue;
        const buffer = await resp.arrayBuffer();
        mailAttachments.push({ filename: att.filename, content: Buffer.from(buffer) });
      } catch (e) {
        console.warn('Ek indirilemedi:', att.filename, e.message);
      }
    }

    const info = await transporter.sendMail({
      from: `"Paydos Turizm" <${smtpFrom}>`,
      to,
      subject,
      text: text || '',
      html: html || text || '',
      attachments: mailAttachments
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, messageId: info.messageId, attachmentCount: mailAttachments.length })
    };

  } catch (err) {
    console.error('Mail gönderim hatası:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
