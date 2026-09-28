// Belge linki (/b/<kod>) için service worker: ana ekrana eklenebilirlik + internetsiz açılış.
// Sayfa ve belge listesi (Firestore cevabı) önce ağdan alınır, olmazsa son kayıtlı kopya gösterilir
// (yurt dışında roaming kapalıyken de uçuş/belge listesi görünür). PDF'ler başka alan adında olduğu
// için burada saklanmaz — onlar için "İndir" kullanılmalı.
const CACHE = 'paydos-belge-v1';
const SHELL = ['/belgeler.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

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
  // /b/<kod> sayfası → belgeler.html (tek kabuk)
  if (e.request.mode === 'navigate' && url.origin === location.origin && url.pathname.startsWith('/b/')) {
    e.respondWith(networkFirst(e.request, '/belgeler.html'));
    return;
  }
  // Belge listesi (Firestore REST, sadece paylasimlar)
  if (url.hostname === 'firestore.googleapis.com' && url.pathname.includes('/documents/paylasimlar/')) {
    e.respondWith(networkFirst(e.request));
    return;
  }
  // İkonlar
  if (url.origin === location.origin && url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
  }
});
