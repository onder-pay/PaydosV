// Netlify Function: musteri-manifest
// Müşteri linki (/m/<kod>, kurumsal, turdan bağımsız) ana ekrana "uygulama" olarak eklenebilsin diye kişiye özel manifest.
// Veri okumaz (müşteri linki PIN korumalı); ad sabit "Paydos · Belgelerim". Tur linkinin manifesti ayrıdır (belge-manifest).

exports.handler = async (event) => {
  const code = String((event.queryStringParameters || {}).k || '');
  if (!/^[A-Za-z0-9-]{8,60}$/.test(code)) return { statusCode: 400, body: 'Geçersiz kod' };
  const manifest = {
    name: 'Paydos · Belgelerim',
    short_name: 'Belgelerim',
    description: 'Biletleriniz, otel ve vize belgeleriniz',
    start_url: `/m/${code}`,
    scope: `/m/${code}`,
    id: `/m/${code}`,
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
