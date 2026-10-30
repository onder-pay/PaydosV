// Türkçe metin yardımcıları — kural ve örnekler: CLAUDE.md

// Font yüklenemezse yedek: Türkçe karakterleri ASCII'ye indirger (standart PDF fontları desteklemez)
export const asciiTr = (text) => (text == null ? '' : String(text))
  .replace(/ı/g, 'i').replace(/İ/g, 'I').replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
  .replace(/ü/g, 'u').replace(/Ü/g, 'U').replace(/ş/g, 's').replace(/Ş/g, 'S')
  .replace(/ö/g, 'o').replace(/Ö/g, 'O').replace(/ç/g, 'c').replace(/Ç/g, 'C');

// ===== TÜRKÇE KARAKTER KURALI (bkz. CLAUDE.md) =====
// 1) KARŞILAŞTIRMA / ARAMA / EŞLEŞTİRME: iki taraf da normalizeTr → ASCII küçük harf ("İptal","IPTAL","iptal" → "iptal").
//    Asla düz toLowerCase/toUpperCase ya da /.../i ile Türkçe metin karşılaştırma: JS "İ"↔"i" eşlemez, "I"→"i" yapar.
// 2) GÖSTERİM: büyük/küçük harf trUpper / trLower (tr-TR yerel ayarı), isimler titleCaseTr.
// 3) KAYIT: kullanıcının yazdığı Türkçe harfler olduğu gibi saklanır; ASCII sadece dış sistem gerektirirse (MRZ, dosya adı, PDF yedek font).
export const normalizeTr = (s) => (s == null ? '' : String(s))
  .replace(/[İIı]/g, 'i').replace(/[Ğğ]/g, 'g').replace(/[Üü]/g, 'u')
  .replace(/[Şş]/g, 's').replace(/[Öö]/g, 'o').replace(/[Çç]/g, 'c')
  .toLowerCase().replace(/\u0307/g, '').trim(); // \u0307: "İ".toLowerCase() artığı birleşik nokta

export const trUpper = (s) => (s == null ? '' : String(s)).toLocaleUpperCase('tr-TR');

export const trLower = (s) => (s == null ? '' : String(s)).toLocaleLowerCase('tr-TR');

// Metin, verilen kelimelerden birini içeriyor mu (Türkçe/İngilizce harf ve büyük-küçük farkı yok sayılır)
export const trHas = (text, ...words) => { const t = normalizeTr(text); return words.some(w => t.includes(normalizeTr(w))); };

// E-posta: Türkçe klavyede "İ"/"ı" ile yazılsa da ASCII küçük harf ("İnfo@" → "info@")
export const normEmail = (s) => String(s || '').trim().replace(/[İIı]/g, 'i').toLowerCase().replace(/\u0307/g, '');

// Ayarlardaki özel alan adı → müşteri kaydındaki anahtar. Eski kod "İ"yi "i̇" (noktalı) yazıyordu: okurken ikisine de bakılır.
export const fieldKeyTr = (field) => normalizeTr(field).replace(/\s+/g, '_');

export const fieldKeyLegacy = (field) => String(field).toLowerCase().replace(/\s+/g, '_').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c');

export const extraFieldVal = (obj, field) => obj?.[fieldKeyTr(field)] ?? obj?.[fieldKeyLegacy(field)];

// Sadece görüntüleme için: "ONDER TASCI" / "önder taşçı" -> "Önder Taşçı" (Türkçe imla, i/İ ayrımına dikkat eder)
// İsim/şehir gösterimi. Yazı İ ile I'yı AYIRIYORSA (içinde İ ya da ı varsa) I → ı ("YILMAZ ŞAHİN" → "Yılmaz Şahin").
// Ayırmıyorsa (MRZ/ASCII Excel "ISMAIL GEDIKOGLU", ya da "MERIÇ EMIROGLU" gibi Ç'li ama İ'siz) I = i kabul edilir
// ("Ismaıl" / "Merıç" gibi bozuk sonuç üretilmez). Kayıtta bu belirsiz isimler değiştirilmez: bkz. nameForSave.
export const TR_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;

export const TR_DOTTED = /[İı]/; // yazan İ/I ayrımını yapıyor mu

export const titleCaseTr = (s) => {
  if (!s) return '';
  const str = String(s);
  const lower = TR_DOTTED.test(str) ? str.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase() : str.toLowerCase();
  return lower.replace(/\u0307/g, '').replace(/(^|[\s\-'])(\p{L})/gu, (m, sep, ch) => sep + (ch === 'i' ? 'İ' : ch.toLocaleUpperCase('tr-TR')));
};

// Kayda yazılacak isim: İ/ı ayrımı olmayan BÜYÜK harfli ve I içeren isim ("ISMAIL", "MERIÇ") olduğu gibi kalır — tahminle bozulmaz.
export const nameForSave = (s) => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (!TR_DOTTED.test(t) && /I/.test(t) && t === trUpper(t)) return t;
  return titleCaseTr(t);
};

// Ad + soyad BİRLİKTE: belgede bir yerde İ/ı varsa (ör. "MELİH KANSIZ") o belge İ/ı ayrımı yapıyordur → soyaddaki I da ı'dır
// ("Melih Kansız"). Ayrı ayrı nameForSave soyadı "KANSIZ" diye bırakıyordu.
export const namePairForSave = (first, last) => {
  const f = String(first || '').trim().replace(/\s+/g, ' '), l = String(last || '').trim().replace(/\s+/g, ' ');
  if (f && l && TR_DOTTED.test(`${f} ${l}`)) {
    const w = titleCaseTr(`${f} ${l}`).split(' '), n = f.split(' ').length;
    return [w.slice(0, n).join(' '), w.slice(n).join(' ')];
  }
  return [nameForSave(f), nameForSave(l)];
};
