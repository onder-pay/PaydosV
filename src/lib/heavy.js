// Ağır kütüphaneler (Excel, PDF, Türkçe PDF fontu) ilk açılışı yavaşlatmasın diye ayrı parçada.
// Uygulama açıldıktan hemen sonra arka planda yüklenir (preloadHeavy); kodun geri kalanı eskisi gibi
// XLSX.utils… / new jsPDF() diye senkron kullanır. Yüklenmeden tıklanırsa anlaşılır bir hata verir.
let _xlsx = null, _jsPDF = null, _font = null, _loading = null;

const notReady = () => new Error('Excel/PDF modülü yükleniyor — birkaç saniye sonra tekrar deneyin');

export const preloadHeavy = () => {
  if (!_loading) {
    _loading = Promise.all([import('xlsx'), import('jspdf'), import('../dejavuFont')])
      .then(([x, j, f]) => { _xlsx = x; _jsPDF = j.default || j.jsPDF; _font = f; })
      .catch(e => { _loading = null; console.warn('[heavy] yüklenemedi:', e.message); throw e; });
  }
  return _loading;
};

export const XLSX = new Proxy({}, { get: (_, k) => { if (!_xlsx) { preloadHeavy().catch(() => {}); throw notReady(); } return _xlsx[k]; } });

// new jsPDF(...) → gerçek jsPDF belgesi (yapıcı nesne döndürdüğü için new ile de çalışır)
export function jsPDF(...args) { if (!_jsPDF) { preloadHeavy().catch(() => {}); throw notReady(); } return new _jsPDF(...args); }

// Türkçe font (yüklenmemişse null → PDF ASCII yedeğe düşer)
export const dejavuFont = () => _font;
