// Pasaport MRZ (TD3, 2 satır × 44) okuma ve doğrulama. AI görsel alanları okur; MRZ'yi yalnız mrz1/mrz2'ye kopyalar.
// Burada kontrol basamağı tutan alanlar kesin kabul edilir: bitiş tarihi (her pasaport), yabancı pasaportta ad/soyad, uyruk, numara.
const W = [7, 3, 1];
const val = (ch) => ch === '<' ? 0 : /\d/.test(ch) ? +ch : ch.charCodeAt(0) - 55;
const check = (s) => String(s.split('').reduce((t, ch, i) => t + val(ch) * W[i % 3], 0) % 10);
const clean = (s) => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '');
const ymd = (yymmdd, future) => {
  if (!/^\d{6}$/.test(yymmdd)) return '';
  const yy = +yymmdd.slice(0, 2), mm = yymmdd.slice(2, 4), dd = yymmdd.slice(4, 6);
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return '';
  const now = new Date().getFullYear() % 100;
  const year = future ? 2000 + yy : (yy > now ? 1900 + yy : 2000 + yy); // bitiş: 20YY; doğum: gelecekte olamaz
  return `${year}-${mm}-${dd}`;
};
// Ülke kodu (MRZ) → CRM'deki ülke adı. Almanya MRZ'de "D" yazar.
const COUNTRY = { TUR: 'Türkiye', D: 'Almanya', DEU: 'Almanya', BEL: 'Belçika', NLD: 'Hollanda', FRA: 'Fransa', AUT: 'Avusturya', CHE: 'İsviçre', ITA: 'İtalya', ESP: 'İspanya', PRT: 'Portekiz', GRC: 'Yunanistan',
  SWE: 'İsveç', NOR: 'Norveç', DNK: 'Danimarka', FIN: 'Finlandiya', POL: 'Polonya', CZE: 'Çekya', HUN: 'Macaristan', ROU: 'Romanya', BGR: 'Bulgaristan', HRV: 'Hırvatistan', IRL: 'İrlanda', LUX: 'Lüksemburg',
  SVK: 'Slovakya', SVN: 'Slovenya', EST: 'Estonya', LVA: 'Letonya', LTU: 'Litvanya', MLT: 'Malta', CYP: 'Kıbrıs', ISL: 'İzlanda', LIE: 'Liechtenstein', GBR: 'İngiltere', USA: 'Amerika Birleşik Devletleri',
  RUS: 'Rusya', UKR: 'Ukrayna', AZE: 'Azerbaycan', KAZ: 'Kazakistan', GEO: 'Gürcistan', IRN: 'İran', IRQ: 'Irak', SYR: 'Suriye', CHN: 'Çin', CAN: 'Kanada', AUS: 'Avustralya', SRB: 'Sırbistan', BIH: 'Bosna Hersek',
  MKD: 'Kuzey Makedonya', ALB: 'Arnavutluk', MNE: 'Karadağ', UZB: 'Özbekistan', TKM: 'Türkmenistan', KGZ: 'Kırgızistan' };
const countryOf = (code) => { const c = String(code || '').replace(/</g, '').toUpperCase(); return COUNTRY[c] || c; };

// Döner: null (okunamadı) ya da { code, country, foreign, lastName, firstName, passportNo, noOk, birthDate, birthOk, expiryDate, expiryOk, gender }
const parseMrz = (l1, l2) => {
  const a = clean(l1), b = clean(l2);
  if (!/^P[A-Z<]/.test(a) || a.length < 30 || b.length < 28) return null;
  const code = a.slice(2, 5).replace(/</g, '');
  const [sur, giv = ''] = a.slice(5).split('<<');
  const words = (s) => s.split('<').filter(Boolean).join(' ');
  const no = b.slice(0, 9), exp = b.slice(21, 27), birth = b.slice(13, 19);
  return {
    code, country: countryOf(code), foreign: !!code && code !== 'TUR',
    lastName: words(sur || ''), firstName: words(giv.replace(/<+$/, '')),
    passportNo: no.replace(/</g, ''), noOk: check(no) === b[9],
    birthDate: ymd(birth, false), birthOk: check(birth) === b[19],
    expiryDate: ymd(exp, true), expiryOk: check(exp) === b[27],
    gender: b[20] === 'F' ? 'F' : b[20] === 'M' ? 'M' : ''
  };
};

const fold = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z]+/g, ' ').trim();
// AI'ın pasaport JSON'unu MRZ ile düzeltir (json'u değiştirir). Döner: yapılan düzeltmelerin kısa listesi.
const applyMrz = (json) => {
  const m = parseMrz(json.mrz1, json.mrz2);
  delete json.mrz1; delete json.mrz2;
  if (!m) return [];
  const fixes = [];
  // Bitiş tarihi: kontrol basamağı tutuyorsa MRZ kesindir (AI veriliş tarihine yıl ekleyip tahmin edebiliyor)
  if (m.expiryOk && m.expiryDate && json.expiryDate !== m.expiryDate) { fixes.push(`bitiş ${json.expiryDate || '-'} → ${m.expiryDate}`); json.expiryDate = m.expiryDate; }
  if (m.foreign) {
    json.nationality = m.country;
    json.foreign = true;
    // Yabancı pasaportta alan etiketleri başka dilde: soyad/ad MRZ'den. Görselden okunan aynı isimse (aksanlı yazım) o kalır.
    if (m.lastName && fold(json.lastName) !== fold(m.lastName)) { fixes.push(`soyad ${json.lastName || '-'} → ${m.lastName}`); json.lastName = m.lastName; }
    if (m.firstName && fold(json.firstName) !== fold(m.firstName) && !fold(json.firstName).startsWith(fold(m.firstName))) { fixes.push(`ad ${json.firstName || '-'} → ${m.firstName}`); json.firstName = m.firstName; }
    if (m.noOk && m.passportNo && json.passportNo !== m.passportNo) { fixes.push(`no ${json.passportNo || '-'} → ${m.passportNo}`); json.passportNo = m.passportNo; }
    if (m.birthOk && m.birthDate && !json.birthDate) json.birthDate = m.birthDate;
    json.tcKimlik = '';
  }
  return fixes;
};

module.exports = { parseMrz, applyMrz, countryOf };
