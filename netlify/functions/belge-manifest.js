// Netlify Function: belge-manifest
// Müşteri belge linki (/b/<kod>) ana ekrana "uygulama" olarak eklenebilsin diye kişiye özel web app manifest.
// start_url ve scope o müşterinin linkidir; ad şehir/tur adından gelir (Firestore paylasimlar/<kod>).
// Ad, PIN gerektirmeyen "meta" çağrısıyla Firebase fonksiyonu "belge"den okunur (paylasimlar herkese kapalı); kod doğrulanır.

const BELGE_API = process.env.BELGE_API_URL || 'https://europe-west1-paydos-crm.cloudfunctions.net/belge';

exports.handler = async (event) => {
  const code = String((event.queryStringParameters || {}).k || '');
  if (!/^[A-Za-z0-9-]{8,60}$/.test(code)) return { statusCode: 400, body: 'Geçersiz kod' };

  let city = '', tour = '';
  try {
    const r = await fetch(BELGE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: code, a: 'meta' }) });
    if (r.ok) {
      const j = await r.json();
      city = j.city || '';
      tour = j.tourName || '';
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
    background_color: '#FF4141', // açılış ekranı: logonun kırmızısı
    theme_color: '#0b1020',
    lang: 'tr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify(manifest),
  };
};
