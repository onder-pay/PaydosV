// Tur şehirleri ve restoran önerileri (Google Maps bağlantısından ad/adres okuma)

// ===== TAVSİYELER: şehir bazlı tavsiye restoranlar (Firestore: tavsiyeler/<şehir-anahtarı>) =====
// Bir şehir bir kez girilir; o şehre giden her turun linki (/b/) açıldığında güncel haliyle okur — tekrar paylaşım gerekmez.
// Şehir anahtarı: "Bakü" / "Baku" / "BAKU" → "baku" (belgeler.html'deki cityKey ile aynı olmalı)
export const cityKey = (s) => String(s || '').trim().toLocaleLowerCase('tr-TR')
  .replace(/[çğıöşü]/g, ch => ({ 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' }[ch]))
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// Tur şehri birden fazla olabilir: "Milano, Venedik" / "Paris - Brüksel"
export const tourCities = (str) => String(str || '').split(/\s*(?:,|\/|;|\s[-–—]\s|\+)\s*/).map(x => x.trim()).filter(Boolean);

export const EMPTY_REST = { name: '', cuisine: '', price: '', note: '', address: '', loc: '', mapsUrl: '' };

// Google Maps linkinden / "41.01, 28.97" metninden konum çıkar. Kısa linkler (maps.app.goo.gl) tarayıcıdan açılamadığı için
// koordinat çıkmaz ama link olduğu gibi saklanır ve müşteri sayfasında doğrudan açılır.
export const parseMapsInput = (raw) => {
  const t = String(raw || '').trim();
  if (!t) return null;
  const num = (a, b) => { const la = parseFloat(a), lo = parseFloat(b); return isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? `${la.toFixed(6)},${lo.toFixed(6)}` : ''; };
  let m = t.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  if (m) return { loc: num(m[1], m[2]), mapsUrl: '', name: '' };
  let url; try { url = new URL(t); } catch { return null; }
  if (!/(^|\.)(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl|g\.co)$/i.test(url.hostname)) return null;
  const d = decodeURIComponent(t);
  let loc = '';
  if ((m = d.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/))) loc = num(m[1], m[2]);
  else if ((m = d.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/))) loc = num(m[1], m[2]);
  else if ((m = d.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/))) loc = num(m[1], m[2]);
  const nm = (d.match(/\/place\/([^/@?]+)/) || [])[1];
  return { loc, mapsUrl: url.href, name: nm ? nm.replace(/\+/g, ' ').trim() : '' };
};
