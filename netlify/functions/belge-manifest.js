// Netlify Function: belge-manifest
// Müşteri belge linki (/b/<kod>) ana ekrana "uygulama" olarak eklenebilsin diye kişiye özel web app manifest.
// start_url ve scope o müşterinin linkidir; ad şehir/tur adından gelir (Firestore paylasimlar/<kod>).
// Girişsiz okunur (kurallar paylasimlar için tekil okumaya izin veriyor); kod doğrulanır.

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'paydos-crm';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'paydos';

exports.handler = async (event) => {
  const code = String((event.queryStringParameters || {}).k || '');
  if (!/^[A-Za-z0-9]{8,40}$/.test(code)) return { statusCode: 400, body: 'Geçersiz kod' };

  let city = '', tour = '';
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/paylasimlar/${code}`);
    if (r.ok) {
      const f = (await r.json()).fields || {};
      city = f.city?.stringValue || '';
      tour = f.tourName?.stringValue || '';
    }
  } catch { /* ad bulunamazsa varsayılan ad kullanılır */ }

  const name = city ? `Paydos · ${city}` : (tour || 'Paydos Turizm');
  const manifest = {
    name,
    short_name: (city || 'Paydos').slice(0, 12),
    description: tour ? `${tour} — seyahat belgeleriniz` : 'Seyahat belgeleriniz',
    start_url: `/b/${code}`,
    scope: `/b/${code}`,
    id: `/b/${code}`,
    display: 'standalone',
    background_color: '#0b1020',
    theme_color: '#0b1020',
    lang: 'tr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify(manifest),
  };
};
