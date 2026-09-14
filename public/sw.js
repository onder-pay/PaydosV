// Paydos CRM — Service Worker
// Amaç: uygulama kabuğunu (HTML/JS/CSS) önbelleğe alıp hızlı açılış ve
// internet kesildiğinde temel çalışma sağlamak.
// NOT: Firestore verileri buradan geçmez; onlar Firebase SDK'sının kendi
// önbelleğinde ve localStorage'da tutulur.

const CACHE = 'paydos-crm-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.json'];

// Kurulumda uygulama kabuğunu önbelleğe al
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// Yeni sürüm gelince eski önbellekleri temizle
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Firebase / Google / harici API çağrılarına dokunma — hep ağdan gitsin
  if (url.origin !== self.location.origin) return;
  if (/firestore|googleapis|firebaseio|identitytoolkit|gstatic/.test(url.hostname)) return;

  // Sayfa gezinmesi: önce ağ, olmazsa önbellekten index.html (SPA)
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Statik dosyalar (JS/CSS/ikon): önce önbellek, arkada güncelle
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
