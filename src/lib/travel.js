// Seyahat kontrolü: pasaport geçerliliği (6 ay kuralı), yeşil pasaport muafiyeti, gidilen ülkeye göre vize/pasaport uyarıları
import { trHas, normalizeTr } from './turkish.js';
import { formatDate, safeParseJSON, safeParseDate, safeParseObj } from './format.js';
import { VIZE_DURUM, IATA_COUNTRY, PLACE_COUNTRY, schengenCountries, EU_FREE_COUNTRIES, nationalityCountry, isTurkishNationality } from './data.js';

// Pasaport, seyahat bitiş tarihinden itibaren en az 6 ay geçerli olmalı (yeşil pasaport dahil herkes için).
export const PASSPORT_MIN_MONTHS = 6;

// 🌐 Yabancı pasaport: uyruğu Türkiye olmayan pasaport. Türk pasaportu kuralları (yeşil pasaport, Dışişleri vize tablosu) bunlara uygulanmaz.
export const isForeignPassport = (p) => !!p && !isTurkishNationality(p.nationality);
// Yeşil (hususi) Türk pasaportu mu: türü "yeşil" ya da numarası S ile başlayan TÜRK pasaportu (yabancı pasaport no'su da S ile başlayabilir)
export const isGreenPassport = (p) => !!p && !isForeignPassport(p) && (trHas(p.passportType, 'yesil') || /^s/.test(normalizeTr(p.passportNo)));
// Müşterinin, verilen tarihe kadar geçerli AB/AEA/İsviçre pasaportu (bitişi girilmemişse de sayılır) → { country } ya da null
export const euCitizen = (c, untilYmd) => {
  const until = untilYmd || new Date().toISOString().slice(0, 10);
  const p = safeParseJSON(c?.passports).find(x => x && isForeignPassport(x) && EU_FREE_COUNTRIES.includes(nationalityCountry(x.nationality)) && (!/^\d{4}-\d{2}-\d{2}$/.test(x.expiryDate || '') || x.expiryDate >= until));
  return p ? { country: nationalityCountry(p.nationality) } : null;
};
// Müşterinin yalnız yabancı pasaportu varsa uyruğu (Türk pasaportu da varsa '')
export const foreignOnly = (c) => { const l = safeParseJSON(c?.passports).filter(p => p && (p.passportNo || p.expiryDate)); return l.length && l.every(isForeignPassport) ? nationalityCountry(l[0].nationality) : ''; };

// Yeşil (hususi) pasaport muafiyeti ancak pasaport bu kurala uyuyorsa. Birden fazla yeşil pasaportta en geç biten esas.
// Döner: { green, ok, exp (Date|null), reason: 'ok'|'nodate'|'expires'|'months' }
export const greenPassportStatus = (passports, tourEndStr) => {
  const greens = (passports || []).filter(isGreenPassport);
  if (!greens.length) return { green: false, ok: false, exp: null, reason: '' };
  const exp = greens.map(p => safeParseDate(p.expiryDate)).filter(Boolean).sort((a, b) => b - a)[0] || null;
  if (!exp) return { green: true, ok: false, exp: null, reason: 'nodate' };
  const end = safeParseDate(tourEndStr) || new Date();
  const need = new Date(end); need.setMonth(need.getMonth() + PASSPORT_MIN_MONTHS);
  if (exp < end) return { green: true, ok: false, exp, reason: 'expires' };
  if (exp < need) return { green: true, ok: false, exp, reason: 'months' };
  return { green: true, ok: true, exp, reason: 'ok' };
};

// Herhangi bir pasaport (en geç biteni) seyahat bitişi + 6 ay kuralına uyuyor mu?
// Döner: { exp (Date|null), reason: 'ok'|'nodate'|'expires'|'months'|'none' }
export const passportValidityFor = (passports, tourEndStr) => {
  const list = (passports || []).filter(p => p.passportNo || p.expiryDate);
  if (!list.length) return { exp: null, reason: 'none' };
  const exp = list.map(p => safeParseDate(p.expiryDate)).filter(Boolean).sort((a, b) => b - a)[0] || null;
  if (!exp) return { exp: null, reason: 'nodate' };
  const end = safeParseDate(tourEndStr) || new Date();
  const need = new Date(end); need.setMonth(need.getMonth() + PASSPORT_MIN_MONTHS);
  if (exp < end) return { exp, reason: 'expires' };
  if (exp < need) return { exp, reason: 'months' };
  return { exp, reason: 'ok' };
};

// Yeşil (hususi) pasaport o ülkede vizeden muaf mı? Dışişleri tablosundaki (VIZE_DURUM) 'y' alanından;
// tabloda olmayan ülkede eski davranış: Schengen ise muaf. (ABD, İngiltere, Kanada vb. yeşil pasaporta da vize ister.)
export const greenExemptIn = (country) => {
  const d = country && VIZE_DURUM[country];
  if (d && d.y && d.y !== '?') return d.y === 'muaf' || d.y === 'yurtici';
  return schengenCountries.includes(country);
};

export const foldUp = (t) => String(t || '').toLocaleUpperCase('tr-TR').replace(/[ÇĞİÖŞÜ]/g, ch => ({ Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' }[ch])).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ');

export const countryFromPlace = (...texts) => {
  const t = ' ' + foldUp(texts.filter(Boolean).join(' , ')) + ' ';
  let best = null;
  PLACE_COUNTRY.forEach(([w, c]) => { const i = t.lastIndexOf(' ' + w + ' '); if (i >= 0 && (!best || i > best[0] || (i === best[0] && w.length > best[2]))) best = [i, c, w.length]; });
  return best ? best[1] : '';
};

// Dışişleri — pasaportun asgari geçerlilik süresi (tüm pasaport türleri), ay (0 = kalış süresince geçerli yeterli).
// Kaynak: mfa.gov.tr "Resmi pasaport" tablosu (PDF, Ekim 2026). Almanya: 1 aydan uzun seyahatte 12 ay (kodda).
export const PASAPORT_MIN_AY = {"Amerika Birleşik Devletleri":6,"Afganistan":6,"Almanya":3,"Andorra":3,"Angola":6,"Arjantin":6,"Arnavutluk":6,"Avusturya":3,"Avustralya":6,"Azerbaycan":1,"BAE":6,"Bahreyn":6,"Bangladeş":6,"Barbados":6,"Belarus":6,"Belçika":3,"Belize":6,"Benin":6,"Birleşik Krallık":6,"Bolivya":6,"Bosna Hersek":6,"Botsvana":6,"Brezilya":6,"Bulgaristan":3,"Burundi":6,"Butan":6,"Cabo Verde":6,"Cezayir":6,"Cibuti":6,"Çad":6,"Çekya":3,"Çin Halk Cumhuriyeti":3,"Danimarka":3,"Doğu Timor":6,"Dominik Cumhuriyeti":6,"Dominika":6,"El Salvador":6,"Endonezya":6,"Eritre":6,"Ermenistan":6,"Estonya":3,"Fas":3,"Fiji":3,"Fildişi Sahili":3,"Filipinler":6,"Finlandiya":3,"Fransa":3,"Gabon":6,"Gana":6,"Grenada":6,"Gine Bissau":6,"Guatemala":6,"Guyana":6,"Güney Afrika":1,"Gürcistan":0,"Haiti":6,"Hırvatistan":3,"Hindistan":6,"Hollanda":3,"Honduras":6,"Irak":6,"İran":6,"İrlanda":6,"İspanya":4,"İsrail":6,"İsveç":3,"İsviçre":3,"İtalya":3.5,"İzlanda":3,"Japonya":3,"Kamboçya":6,"Kamerun":6,"Kanada":0,"Katar":6,"Kazakistan":6,"Kenya":6,"Kırgızistan":6,"Kiribati":6,"KKTC":6,"Kolombiya":0,"Kongo":0,"Kongo Demokratik Cumhuriyeti":6,"Güney Kore":3,"Kuzey Kore":0,"Kosta Rika":3,"Kuveyt":6,"Küba":0,"Laos":6,"Lesotho":6,"Letonya":3,"Liberya":6,"Libya":6,"Liechtenstein":3,"Litvanya":3,"Lübnan":3,"Lüksemburg":3,"Macaristan":6,"Madagaskar":6,"Kuzey Makedonya":6,"Malavi":6,"Maldivler":6,"Malezya":6,"Malta":6,"Mauritius":6,"Meksika":6,"Mısır":6,"Mikronezya":4,"Moğolistan":12,"Moldova":6,"Monako":3,"Moritanya":6,"Mozambik":6,"Myanmar":6,"Namibya":6,"Nauru":6,"Nepal":6,"Nijer":6,"Nijerya":6,"Nikaragua":6,"Norveç":3,"Orta Afrika Cumhuriyeti":0,"Özbekistan":6,"Palau":6,"Pakistan":6,"Panama":6,"Papua Yeni Gine":6,"Paraguay":6,"Polonya":3,"Portekiz":3,"Romanya":6,"Rusya":6,"Senegal":6,"Sırbistan":6,"Sierra Leone":6,"Singapur":6,"Slovakya":3,"Slovenya":4,"Solomon Adaları":6,"Sri Lanka":6,"Sudan":6,"Surinam":6,"Suriye":4,"Suudi Arabistan":6,"Esvatini":0,"Şili":6,"Tacikistan":6,"Tayland":6,"Tayvan":6,"Togo":0,"Tonga":6,"Trinidad-Tobago":0,"Tunus":6,"Tuvalu":6,"Türkmenistan":6,"Ukrayna":1,"Uruguay":6,"Ürdün":6,"Vanuatu":6,"Venezuela":6,"Vietnam":6,"Yemen":6,"Yeni Zelanda":3,"Yunanistan":3,"Zambiya":6,"Zimbabve":6,"Umman":6,"Etiyopya":6,"Antigua-Barbuda":6,"Bağımsız Samoa":6,"Brunei":6,"Ekvador":6,"St. Kitts ve Nevis":6,"Marshall Adaları":3,"Cook Adaları":0};

export const SHORT_COUNTRY = { 'Çin Halk Cumhuriyeti': 'Çin', 'Amerika Birleşik Devletleri': 'ABD', 'Birleşik Krallık': 'İngiltere', 'BAE': 'BAE (Dubai)' };

// c: CRM müşteri kaydı · trip: { startDate, endDate, country, flights:[{ to, ymd }], hotelCheckIn, hotelCheckOut, hotelName, hotelAddress }
// Döner: { country, start, end, items: [{ level: 'ok'|'warn'|'err'|'info', msg }] }
export const travelCheck = (c, trip = {}) => {
  const flights = (trip.flights || []).filter(Boolean).slice().sort((a, b) => String(a.ymd).localeCompare(String(b.ymd)));
  const abroad = flights.map(f => IATA_COUNTRY[String(f.to || '').toUpperCase()]).filter(x => x && x !== 'Türkiye');
  const hotelCountry = countryFromPlace(trip.hotelName, trip.hotelAddress);
  const country = abroad[0] || (hotelCountry && hotelCountry !== 'Türkiye' ? hotelCountry : '') || (trip.country && trip.country !== 'Türkiye' ? trip.country : '');
  const dates = [trip.startDate, trip.endDate, trip.hotelCheckIn, trip.hotelCheckOut, ...flights.map(f => f.ymd)].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
  const start = dates[0] || '', end = dates[dates.length - 1] || '';
  const items = [];
  if (!end) return { country, start, end, items: [{ level: 'info', msg: 'Seyahat tarihi okunamadı — pasaport/vize kontrolü yapılamadı' }] };
  const passports = safeParseJSON(c.passports);
  // Pasaport: ülkeye göre asgari geçerlilik (Dışişleri tablosu), tabloda yoksa 6 ay
  const list = passports.filter(p => p && (p.passportNo || p.expiryDate));
  const best = list.filter(p => safeParseDate(p.expiryDate)).sort((a, b) => String(b.expiryDate).localeCompare(String(a.expiryDate)))[0];
  if (!list.length) items.push({ level: 'warn', msg: 'CRM\'de pasaport kaydı yok — lütfen müşteri ile vize ve pasaport durumunu görüşün' });
  else if (!best) items.push({ level: 'warn', msg: 'Pasaport bitiş tarihi CRM\'de girilmemiş' });
  else {
    const expD = safeParseDate(best.expiryDate), endD = safeParseDate(end), exp = formatDate(best.expiryDate);
    const plus = (m) => { const d = new Date(endD); d.setMonth(d.getMonth() + Math.floor(m)); if (m % 1) d.setDate(d.getDate() + 15); return d; };
    // Ülkeye göre asgari süre (Dışişleri pasaport asgari geçerlilik tablosu) — tüm pasaport türleri için. Tabloda yoksa 6 ay.
    const tripDays = start ? Math.round((endD - safeParseDate(start)) / 86400000) : 0;
    let need = PASAPORT_MIN_AY[country];
    if (country === 'Almanya' && tripDays > 30) need = 12;
    if (need === undefined) need = 6;
    const needTxt = need >= 12 ? `${need / 12} yıl` : need % 1 ? `${Math.floor(need)} ay 15 gün` : `${need} ay`;
    if (expD < endD) items.push({ level: 'err', msg: `Pasaport seyahat bitmeden doluyor (${exp})` });
    else if (need > 0 && expD < plus(need)) items.push({ level: 'err', msg: `Pasaport dönüşten sonra en az ${needTxt} geçerli olmalı${country ? ' (' + (SHORT_COUNTRY[country] || country) + ')' : ''} — bitiş ${exp}` });
    else items.push({ level: 'ok', msg: `Pasaport uygun (${exp})` });
  }
  // CRM'de sadece Schengen ve ABD vizesi tutuluyor → yalnız bunlar kontrol edilir; diğer ülkelerde sadece hatırlatma
  const isSch = schengenCountries.includes(country);
  const isUsa = country === 'Amerika Birleşik Devletleri';
  const green = greenPassportStatus(passports, end).green;
  // 🌐 Yabancı pasaport: AB vatandaşı Schengen'de vizesiz; diğer durumlarda Türk pasaportu tablosu geçerli değil
  const eu = euCitizen(c, end), fo = foreignOnly(c);
  if (isSch && eu) { items.push({ level: 'ok', msg: `${country}: ${eu.country} vatandaşı — Schengen vizesi gerekmiyor` }); return { country, start, end, items }; }
  if (fo) { items.push({ level: 'warn', msg: `Yabancı pasaport (${fo}): vize kuralı Türk pasaportuna göre değil — ${SHORT_COUNTRY[country] || country || 'gidilen ülke'} için ayrıca kontrol ediniz` }); return { country, start, end, items }; }
  if (!isSch && !isUsa) {
    // Diğer ülkeler: CRM'de vizesi tutulmuyor → Dışişleri tablosuna göre vizesiz / vizeli bilgisi
    const rule = country && VIZE_DURUM[country];
    const st = rule ? (green ? rule.y : rule.b) : '';
    const ad = SHORT_COUNTRY[country] || country;
    if (st === 'muaf' || st === 'yurtici') items.push({ level: 'ok', msg: `${ad} vizesiz gidilebilir${green ? ' (yeşil pasaport)' : ''}` });
    else if (st === 'tabi') items.push({ level: 'warn', msg: `${ad} vizeli — lütfen vize durumunu kontrol ediniz` });
    else items.push({ level: 'warn', msg: `${ad ? ad + ': ' : ''}Lütfen vize durumunu kontrol ediniz` });
    return { country, start, end, items };
  }
  const covers = (v) => v && /^\d{4}-\d{2}-\d{2}$/.test(v.endDate || '') && v.endDate >= end && (!v.startDate || v.startDate <= start);
  if (isSch && green && greenExemptIn(country)) items.push({ level: 'ok', msg: `${country}: yeşil pasaportla vize gerekmiyor` });
  else if (isSch) {
    const vs = safeParseJSON(c.schengenVisas).filter(v => v && v.endDate);
    const ok = vs.find(covers);
    const last = vs.sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)))[0];
    if (ok) items.push({ level: 'ok', msg: `Schengen vizesi var (${ok.country || ''} · ${formatDate(ok.endDate)} bitiş)` });
    else if (last) items.push({ level: 'err', msg: `Schengen vizesi seyahati kapsamıyor (${last.country || ''} · ${formatDate(last.startDate)} – ${formatDate(last.endDate)})` });
    else items.push({ level: 'err', msg: `${country} Schengen vizesi gerektirir — CRM'de Schengen vizesi yok` });
  } else {
    const u = safeParseObj(c.usaVisa);
    if (covers(u)) items.push({ level: 'ok', msg: `ABD vizesi var (${formatDate(u.endDate)} bitiş)` });
    else items.push({ level: 'err', msg: u.endDate ? `ABD vizesi seyahati kapsamıyor (${formatDate(u.endDate)} bitiş)` : 'ABD vizesi gerekir — CRM\'de ABD vizesi yok' });
  }
  return { country, start, end, items };
};

export const TC_ICON = { ok: '✅', warn: '⚠️', err: '❌', info: 'ℹ️' };

export const TC_COLOR = { ok: '#10b981', warn: '#f59e0b', err: '#ef4444', info: '#94a3b8' };

// 🖐️ Schengen parmak izi (biyometri): verildiği tarihten itibaren 59 ay geçerli; bu sürede yeni başvuruda tekrar alınmaz.
// Müşteri kaydında: fingerprint 'var' | 'yok', fingerprintDate 'YYYY-AA-GG'.
export const FINGERPRINT_MONTHS = 59;
export const fingerprintStatus = (c) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(c?.fingerprintDate || '')) ? c.fingerprintDate : '';
  if (!d) return { state: c?.fingerprint === 'yok' ? 'none' : c?.fingerprint === 'var' ? 'nodate' : 'unknown' };
  const [y, m, dd] = d.split('-').map(Number);
  const u = new Date(y, m - 1 + FINGERPRINT_MONTHS, dd);
  const until = `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, '0')}-${String(u.getDate()).padStart(2, '0')}`;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((u - t) / 86400000);
  return { state: daysLeft > 0 ? 'valid' : 'expired', date: d, until, daysLeft };
};
// Kısa yazı + renk (liste rozeti ve kutu başlığı)
export const fingerprintLabel = (c) => {
  const f = fingerprintStatus(c);
  if (f.state === 'valid') return { f, color: f.daysLeft < 183 ? '#f59e0b' : '#10b981', text: `🖐️ Parmak izi var · son geçerlilik ${formatDate(f.until)}` };
  if (f.state === 'expired') return { f, color: '#ef4444', text: `🖐️ Parmak izi süresi doldu (${formatDate(f.until)}) — randevuda yeniden alınır` };
  if (f.state === 'nodate') return { f, color: '#f59e0b', text: '🖐️ Parmak izi var · verildiği tarih girilmemiş' };
  if (f.state === 'none') return { f, color: '#ef4444', text: '🖐️ Parmak izi yok — randevuda alınacak' };
  return { f, color: '#64748b', text: '🖐️ Parmak izi bilgisi girilmemiş' };
};

// 🪪 Oturma izni (müşteri kaydında residencePermits): geçerli bir Schengen ülkesi oturma izni Schengen'e vizesiz giriş sağlar.
export const residencePermitsOf = (c) => safeParseJSON(c?.residencePermits).filter(r => r && (r.country || r.permitNo));
// untilYmd tarihine kadar geçerli Schengen ülkesi oturma izni (en geç biten) — yoksa null
export const schengenResidence = (c, untilYmd) => residencePermitsOf(c)
  .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.expiryDate || '') && r.expiryDate >= (untilYmd || new Date().toISOString().slice(0, 10)) && schengenCountries.some(k => normalizeTr(k) === normalizeTr(r.country)))
  .sort((a, b) => String(b.expiryDate).localeCompare(String(a.expiryDate)))[0] || null;
