import { auth, db } from './firebase.js';
import { doc, setDoc } from 'firebase/firestore';
import { generateUniqueId } from './format.js';
// Sunucu çağrıları: Claude proxy, mail gönderimi (oturum jetonuyla), işlem logu

// send-mail fonksiyonunu çağırır. Firebase oturum jetonu (ID token) gönderilir;
// sunucu jetonu doğrulamadan mail atmaz (aksi halde fonksiyon herkese açık bir spam rölesi olur).
// CRM'den Claude proxy çağrısı — giriş token'ı ile (girişsiz istekler sunucuda kısıtlıdır)
export const claudeRequest = async ({ headers = {}, ...opts }) => {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
  return fetch('/.netlify/functions/claude-proxy', { ...opts, headers: { ...headers, Authorization: `Bearer ${token}` } });
};

// Müşteri maillerinin gövdesi — beyaz kart + üstte Paydos logosu. Mail istemcileri göreli yolu çözemez, adres tam olmalı.
export const MAIL_LOGO_URL = 'https://crm.paydostur.com/icons/paydos-wordmark.png';

export const mailHtml = (bodyText) => `<div style="background:#f4f5f7;padding:24px 12px"><div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
<div style="padding:18px 24px;border-bottom:3px solid #FF4141"><img src="${MAIL_LOGO_URL}" alt="Paydos Turizm" width="150" height="58" style="display:block;width:150px;height:58px;border:0"></div>
<pre style="margin:0;padding:22px 24px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;white-space:pre-wrap;">${bodyText}</pre>
<div style="padding:12px 24px;background:#fafafa;border-top:1px solid #eee;font-family:Arial,sans-serif;font-size:11px;color:#6b7280">Paydos Turizm · 0 258 263 71 76 · www.paydostur.com</div></div></div>`;

export const sendMailRequest = async ({ headers = {}, ...opts }) => {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
  return fetch('/.netlify/functions/send-mail', { ...opts, headers: { ...headers, Authorization: `Bearer ${token}` } });
};

// İŞLEM LOGU — önemli işlemleri activity_logs koleksiyonuna yazar.
// user: currentUser objesi (name içerir). Sessiz çalışır, hata olsa akışı bozmaz.
export const logActivity = async (action, modul, detay, user, extra = {}) => {
  try {
    const id = generateUniqueId();
    await setDoc(doc(db, 'activity_logs', id), {
      id,
      action,                                   // 'create' | 'delete' | 'status'
      modul,                                    // 'Müşteri' | 'Vize' | 'Tur' | 'Pasaport' ...
      detay: detay || '',                       // "Ahmet Yılmaz" gibi
      userName: user?.name || user?.email || 'Bilinmiyor',
      userEmail: user?.email || '',
      time: new Date().toISOString(),
      ...extra
    });
  } catch (e) { /* log yazımı akışı bozmaz */ }
};
