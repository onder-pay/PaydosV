// ===== Türkçe karakter kuralı (bkz. kök dizindeki CLAUDE.md) — bot fonksiyonlarının ortak yardımcıları =====
// CRM'deki (src/App.jsx) normalizeTr / titleCaseTr / nameForSave / normEmail ile birebir aynı davranır.

// Karşılaştırma / arama: iki taraf da ASCII küçük harf ("İptal", "IPTAL", "Müşteri İptal Etti" → "...iptal...")
const normTr = (x) => String(x == null ? '' : x)
  .replace(/[İIı]/g, 'i').replace(/[Ğğ]/g, 'g').replace(/[Üü]/g, 'u')
  .replace(/[Şş]/g, 's').replace(/[Öö]/g, 'o').replace(/[Çç]/g, 'c')
  .toLowerCase().replace(/̇/g, '').trim();
const trHas = (text, ...words) => { const t = normTr(text); return words.some(w => t.includes(normTr(w))); };

// İsim / şehir gösterimi: Türkçe harf varsa I → ı; hiç yoksa (MRZ "ISMAIL") I = i kabul edilir ("Ismaıl" üretilmez)
const TR_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;
const titleCaseTr = (s) => {
  if (!s) return '';
  const str = String(s);
  const lower = TR_LETTERS.test(str) ? str.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase() : str.toLowerCase();
  return lower.replace(/̇/g, '').replace(/(^|[\s\-'])(\p{L})/gu, (m, sep, ch) => sep + (ch === 'i' ? 'İ' : ch.toLocaleUpperCase('tr-TR')));
};
// Kayda yazılacak isim: Türkçe harfsiz BÜYÜK harfli ve I içeren isim olduğu gibi kalır (I'nın i mi ı mı olduğu bilinemez)
const nameForSave = (s) => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (!TR_LETTERS.test(t) && /I/.test(t) && t === t.toUpperCase()) return t;
  return titleCaseTr(t);
};
// E-posta: Türkçe klavyedeki "İ"/"ı" ile yazılsa da ASCII küçük harf
const normEmail = (s) => String(s || '').trim().replace(/[İIı]/g, 'i').toLowerCase().replace(/̇/g, '');

// Ayarlardaki vize durumları arasında, Türkçe harf/büyük-küçük farkı gözetmeden verilen etikete denk gelenler
// (Firestore 'in' sorgusu için; sabit yazım her zaman dahil). Örn. 'Atama Bekliyor' ↔ 'ATAMA BEKLİYOR' / 'Atama bekliyor'
const statusLabels = (settings, label) => {
  const list = (Array.isArray(settings?.visaStatuses) ? settings.visaStatuses : []).map(x => typeof x === 'string' ? x : (x && (x.name || x.label)) || '').filter(Boolean);
  return [...new Set([label, ...list.filter(x => normTr(x) === normTr(label))])].slice(0, 10);
};

module.exports = { normTr, trHas, titleCaseTr, nameForSave, normEmail, statusLabels, TR_LETTERS };
