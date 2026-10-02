// Müşteri linki (/m/<kod>) için service worker (tur linkinin belge-sw.js'inden ayrı): ana ekrana eklenebilirlik + internetsiz açılış.
// Sayfa önce ağdan alınır, olmazsa son kayıtlı kopya gösterilir. PDF'ler başka alan adında olduğu
// için burada saklanmaz — onlar için "İndir" kullanılmalı.
const CACHE = 'paydos-musteri-v1';
const SHELL = ['/musteri.html', '/icons/logo.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const networkFirst = async (req, cacheKey) => {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(cacheKey || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(cacheKey || req);
    if (hit) return hit;
    throw err;
  }
};

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // /m/<kod> sayfası → musteri.html (tek kabuk)
  if (e.request.mode === 'navigate' && url.origin === location.origin && url.pathname.startsWith('/m/')) {
    e.respondWith(networkFirst(e.request, '/musteri.html'));
    return;
  }
  // Belge verisi PIN'li API'den (POST) gelir; SW saklamaz — internetsizken sayfa son veriyi telefondan gösterir.
  // Hava / konum / kur — yurt dışında internet yokken son bilinen değer gösterilsin
  if (/(^|\.)open-meteo\.com$/.test(url.hostname) || url.hostname === 'open.er-api.com' || (url.origin === location.origin && url.pathname === '/.netlify/functions/kur')) {
    e.respondWith(networkFirst(e.request));
    return;
  }
  // İkonlar
  if (url.origin === location.origin && url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
  }
});
