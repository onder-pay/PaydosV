// ===== Türkçe karakter kuralı (bkz. kök dizindeki CLAUDE.md) — bot fonksiyonlarının ortak yardımcıları =====
// CRM'deki (src/App.jsx) normalizeTr / titleCaseTr / nameForSave / normEmail ile birebir aynı davranır.

// Karşılaştırma / arama: iki taraf da ASCII küçük harf ("İptal", "IPTAL", "Müşteri İptal Etti" → "...iptal...")
const normTr = (x) => String(x == null ? '' : x)
  .replace(/[İIı]/g, 'i').replace(/[Ğğ]/g, 'g').replace(/[Üü]/g, 'u')
  .replace(/[Şş]/g, 's').replace(/[Öö]/g, 'o').replace(/[Çç]/g, 'c')
  .toLowerCase().replace(/̇/g, '').trim();
const trHas = (text, ...words) => { const t = normTr(text); return words.some(w => t.includes(normTr(w))); };

// İsim / şehir gösterimi: yazı İ/I ayrımı yapıyorsa (İ ya da ı varsa) I → ı; yapmıyorsa (MRZ "ISMAIL", Excel "MERIÇ") I = i
const TR_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;
const TR_DOTTED = /[İı]/;
const titleCaseTr = (s) => {
  if (!s) return '';
  const str = String(s);
  const lower = TR_DOTTED.test(str) ? str.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase() : str.toLowerCase();
  return lower.replace(/\u0307/g, '').replace(/(^|[\s\-'])(\p{L})/gu, (m, sep, ch) => sep + (ch === 'i' ? 'İ' : ch.toLocaleUpperCase('tr-TR')));
};
// Kayda yazılacak isim: İ/ı ayrımı olmayan BÜYÜK harfli ve I içeren isim olduğu gibi kalır (I'nın i mi ı mı olduğu bilinemez)
const nameForSave = (s) => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (!TR_DOTTED.test(t) && /I/.test(t) && t === t.toLocaleUpperCase('tr-TR')) return t;
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

// Ad + soyad BİRLİKTE: belgede bir yerde İ/ı varsa (ör. "MELİH KANSIZ") o belge İ/ı ayrımı yapıyordur → soyaddaki I da ı'dır
// ("Melih Kansız"). Ayrı ayrı nameForSave soyadı "KANSIZ" diye bırakıyordu.
const namePairForSave = (first, last) => {
  const f = String(first || '').trim().replace(/\s+/g, ' '), l = String(last || '').trim().replace(/\s+/g, ' ');
  if (f && l && TR_DOTTED.test(`${f} ${l}`)) {
    const w = titleCaseTr(`${f} ${l}`).split(' '), n = f.split(' ').length;
    return [w.slice(0, n).join(' '), w.slice(n).join(' ')];
  }
  return [nameForSave(f), nameForSave(l)];
};
module.exports = { normTr, trHas, titleCaseTr, nameForSave, namePairForSave, normEmail, statusLabels, TR_LETTERS, TR_DOTTED };
