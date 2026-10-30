// Bilet, biniş kartı ve otel belgesi metninden bilgi okuma: uçuşlar, tarihler, otel, yolcu adı eşleştirme
import { asciiTr, titleCaseTr } from './turkish.js';

// Biniş kartı metninden uçuş zamanı sıralama anahtarı (YYYYMMDDHHMM) — bacakları doğru sıraya koymak için
export const BP_MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12, OCA: 1, SUB: 2, ŞUB: 2, NIS: 4, NİS: 4, HAZ: 6, TEM: 7, AGU: 8, AĞU: 8, EYL: 9, EKI: 10, EKİ: 10, KAS: 11, ARA: 12 };

export const flightSortKey = (text) => {
  const t = String(text || '').toUpperCase();
  let y = 0, mo = 0, d = 0, m;
  if ((m = t.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = t.match(/\b(\d{1,2})\s?([A-ZÇĞİÖŞÜ]{3})\s?(20\d{2}|\d{2})?\b/g))) {
    for (const x of m) { const k = x.match(/(\d{1,2})\s?([A-ZÇĞİÖŞÜ]{3})\s?(\d{2,4})?/); if (k && BP_MONTHS[k[2]]) { d = +k[1]; mo = BP_MONTHS[k[2]]; y = k[3] ? (k[3].length === 2 ? 2000 + +k[3] : +k[3]) : new Date().getFullYear(); break; } }
  }
  if (!mo) return '';
  const tm = t.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${y}${p2(mo)}${p2(d)}${tm ? p2(tm[1]) + tm[2] : '0000'}`;
};

// İsim eşleştirme için sadeleştir: Türkçe → ASCII, büyük harf, harf dışı → boşluk
export const nameWords = (text) => {
  const words = new Set();
  asciiTr(text).toUpperCase().replace(/[^A-Z]+/g, ' ').split(' ').filter(Boolean).forEach(w => {
    words.add(w);
    // Uçak biletlerinde "YILMAZ/AHMETMR" gibi unvan bitişik yazılabiliyor
    const m = w.match(/^([A-Z]{2,}?)(MRS|MR|MS|MISS|MSTR|CHD|INF)$/);
    if (m) words.add(m[1]);
  });
  return words;
};

// Bilet PDF metninden uçuşları çıkar: "Ankara (ESB) Baku (GYD) VF-577 14/10/2026 12:15 15:30"
// ===== Belgeden bilgi okuma: otel giriş belgesi + isim kontrolü =====
// PDF metni tek satır gelir (satır sonu yok) → etiketlerden sonra gelen değer, bir sonraki etikete kadar alınır.
export const AYLAR_TR_EN = { ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, oca: 1, sub: 2, nis: 4, haz: 6, tem: 7, agu: 8, eyl: 9, eki: 10, kas: 11, ara: 12,
  januar: 1, februar: 2, marz: 3, mai: 5, juni: 6, juli: 7, oktober: 10, dezember: 12 };

// Metindeki tarihleri sırasıyla bulur → [{ ymd, idx }]
export const datesIn = (text) => {
  const t = asciiTr(String(text || '')).toLowerCase();
  const out = [];
  const ok = (y, m, d) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  const push = (y, m, d, idx) => { if (ok(y, m, d)) out.push({ ymd: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, idx }); };
  let m;
  const r1 = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g; while ((m = r1.exec(t))) push(+m[3], +m[2], +m[1], m.index);
  const r2 = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g; while ((m = r2.exec(t))) push(+m[1], +m[2], +m[3], m.index);
  const r3 = /\b(\d{1,2})\.?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/g; while ((m = r3.exec(t))) { const mo = AYLAR_TR_EN[m[2]]; if (mo) push(+m[3], mo, +m[1], m.index); }
  const r4 = /\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g; while ((m = r4.exec(t))) { const mo = AYLAR_TR_EN[m[1]]; if (mo) push(+m[3], mo, +m[2], m.index); }
  return out.sort((a, b) => a.idx - b.idx);
};

export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);

// Otel giriş belgesi / voucher / rezervasyon onayı → { name, address, checkIn, checkOut } (bulunamayan alan boş)
export const detectHotel = (text) => {
  const raw = String(text || '').replace(/\s+/g, ' ');
  if (!raw.trim()) return null;
  const low = asciiTr(raw).toLowerCase();
  // /i bayrağı "İ"yi "i" saymaz (Türkçe karakter kuralı) → i geçen Türkçe etiketlerde [iİı] sınıfı ("GİRİŞ", "ŞEHİR", "MİSAFİR")
  const STOPW = 'address|adres|adresse|check|g[iİı]r[iİı][sş]|[cç][ıiİ]k[ıiİ][sş]|arrival|departure|tel|telefon|phone|e-?mail|www|room|oda|booking|rezervasyon|reservation|confirmation|guest|m[iİı]saf[iİı]r|nights?|gece|city|[sş]eh[iİı]r|country|[uü]lke';
  const STOP = '(?=\\s+(?:' + STOPW + ')(?![a-zçğıöşü])|\\s{2,}|$)';
  const grab = (re) => { const m = raw.match(re); return m ? m[1].replace(/[\s,;:|-]+$/, '').trim() : ''; };
  let name = grab(new RegExp('(?:hotel\\s*name|otel\\s*ad[ıi]|property(?:\\s*name)?|accommodation|konaklama\\s*yeri|hotel|otel)\\s*[:：]\\s*(.{3,80}?)' + STOP, 'i'));
  if (!name) {
    const m = raw.match(/((?:[A-ZÇĞİÖŞÜ][\wÇĞİÖŞÜçğıöşü&'.-]*\s){0,4}(?:Hotel|HOTEL|Otel|OTEL|Resort|RESORT|Suites?|SUITES?|Hostel|Palace|PALACE)(?:\s(?:[A-ZÇĞİÖŞÜ][\wÇĞİÖŞÜçğıöşü&'.-]*)){0,4})/);
    if (m && m[1].trim().split(/\s+/).length >= 2) name = m[1].trim();
  }
  // Sona yapışan etiket kelimelerini at ("… City Hotel Address")
  const stopEnd = new RegExp('\\s+(?:' + STOPW + ')$', 'i');
  for (let k = 0; k < 3 && stopEnd.test(name); k++) name = name.replace(stopEnd, '');
  name = name.replace(/\s+(?:\*+|★+)\s*$/, '').trim().slice(0, 80);
  const address = grab(new RegExp('(?:address|adres|adresse|anschrift)\\s*[:：]?\\s*(.{6,120}?)' + STOP, 'i')).slice(0, 120);
  // Giriş / çıkış: etiketten sonraki ilk tarih (en fazla 80 karakter ileride)
  const all = datesIn(raw);
  const after = (re) => { const m = re.exec(low); if (!m) return ''; const d = all.find(x => x.idx >= m.index && x.idx - m.index < 80); return d ? d.ymd : ''; };
  let checkIn = after(/check[\s-]?in|giris(?:\s*tarihi)?|arrival(?:\s*date)?|anreise|varis\s*tarihi/);
  let checkOut = after(/check[\s-]?out|cikis(?:\s*tarihi)?|departure(?:\s*date)?|abreise|ayrilis/);
  if (!checkIn || !checkOut || daysBetween(checkIn, checkOut) <= 0) {
    // Etiket yoksa: belgedeki ardışık tarih çifti (1–60 gece)
    for (let i = 0; i < all.length - 1 && !(checkIn && checkOut && daysBetween(checkIn, checkOut) > 0); i++) {
      for (let j = i + 1; j < all.length; j++) { const n = daysBetween(all[i].ymd, all[j].ymd); if (n >= 1 && n <= 60) { checkIn = all[i].ymd; checkOut = all[j].ymd; break; } }
    }
  }
  if (!(checkIn && checkOut && daysBetween(checkIn, checkOut) > 0)) { checkIn = checkIn || ''; checkOut = ''; }
  if (!name && !checkIn) return null;
  return { name, address, checkIn, checkOut };
};

// Levenshtein (kısa kelimeler için)
export const lev = (a, b) => {
  if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
};

// Belgedeki isim, müşterinin CRM'deki (pasaporttaki) adıyla aynı mı? Türkçe karaktersiz yazım hata sayılmaz (TAŞÇI = TASCI).
// Döner: { level: 'ok' | 'warn' | 'err' | 'none', msg }
export const nameCheck = (c, text) => {
  if (!c) return { level: 'none', msg: '' };
  if (!String(text || '').trim()) return { level: 'none', msg: 'Görsel — isim kontrol edilemedi, gözle bakın' };
  const docW = [...nameWords(text)];
  const doc = new Set(docW);
  const toks = (s) => asciiTr(String(s || '')).toUpperCase().replace(/[^A-Z]+/g, ' ').split(' ').filter(w => w.length > 1);
  const firsts = toks(c.firstName), lasts = toks(c.lastName);
  const check = (t) => {
    if (doc.has(t)) return { ok: true };
    // Bitişik yazım: "ONDERMR", "AHMETCAN" (iki ad birleşik)
    if (docW.some(w => w.length > t.length && w.length - t.length <= 12 && (w.startsWith(t) || w.endsWith(t)))) return { ok: true };
    let best = null;
    docW.forEach(w => { if (Math.abs(w.length - t.length) > 2) return; const d = lev(w, t); if (!best || d < best.d) best = { w, d }; });
    const lim = t.length >= 6 ? 2 : t.length >= 4 ? 1 : 0;
    if (best && best.d > 0 && best.d <= lim) return { typo: best.w };
    return { missing: true };
  };
  const errs = [], warns = [];
  lasts.forEach(t => { const r = check(t); if (r.typo) warns.push(`soyad "${r.typo}" yazılmış, CRM'de "${t}"`); else if (r.missing) errs.push(`soyad "${t}" belgede yok`); });
  firsts.forEach((t, i) => { const r = check(t); if (r.typo) warns.push(`ad "${r.typo}" yazılmış, CRM'de "${t}"`); else if (r.missing) (i === 0 ? errs : warns).push(i === 0 ? `ad "${t}" belgede yok` : `ikinci ad "${t}" belgede yok`); });
  if (errs.length) return { level: 'err', msg: '⛔ ' + errs.join(' · ') + ' — belge bu kişiye ait olmayabilir' };
  if (warns.length) return { level: 'warn', msg: '⚠️ ' + warns.join(' · ') };
  return { level: 'ok', msg: '✓ İsim belgeyle aynı' };
};

export const NAMECHK_COLOR = { ok: '#10b981', warn: '#f59e0b', err: '#ef4444', none: '#94a3b8' };

// Yedek uçuş okuyucu (farklı havayolu formatları): uçuş kodunu bul, çevresinde havalimanı kodları + tarih + saat ara
export const AIRPORTS = new Set(('IST SAW ESB ADB AYT DLM BJV GZP TZX GZT ADA COV ASR VAN ERZ ERC DIY SZF KYA MLX EZS NAV HTY KCM KSY MQM BAL BGG GNY NKT IGD AJI KFS ONQ SFQ USQ YEI EDO CKZ TEQ DNZ ISE MSR OGU NOP VAS TJK KCO AOE AFY BZI YKO RZV GKD KZR CII BDM BXN SXZ ECN '
  + 'GYD NAJ TBS BUS EVN ALA NQZ TSE TAS SKD FRU DYU ASB FRA MUC BER DUS CGN HAM STR HAJ NUE LEJ DTM FMM CDG ORY NCE LYS MRS BSL LHR LGW STN LTN MAN BHX EDI DUB AMS EIN RTM BRU CRL LUX '
  + 'FCO CIA MXP BGY LIN VCE BLQ NAP PSA FLR BCN MAD AGP PMI VLC LIS OPO VIE ZRH GVA CPH ARN OSL HEL PRG BUD WAW KRK OTP SOF BEG SKP TIA SJJ LJU ZAG ATH SKG LCA ECN KBP '
  + 'DXB DWC AUH SHJ DOH BAH KWI MCT JED RUH DMM MED CAI HRG SSH TLV AMM BEY TUN ALG CMN RAK JFK EWR LAX ORD MIA IAD BOS YYZ YUL PEK PKX PVG CAN HKG ICN NRT HND BKK SIN KUL DEL BOM').split(' '));

export const detectFlightsLoose = (text) => {
  const raw = String(text || '').replace(/\s+/g, ' ');
  const out = [], seen = new Set();
  const re = /\b(TK|PC|VF|XQ|XC|J2|LH|AF|KL|BA|EK|QR|FZ|EY|W6|FR|U2|SU|A3|OS|LX|LO|KC|HY|G9|SV|MS|RJ|AZ|IB|VY|TP|SK|AY|PS|ZF|DE|EW)\s?-?\s?(\d{2,4})\b/g;
  let m;
  while ((m = re.exec(raw))) {
    const code = m[1] + m[2];
    const win = raw.slice(Math.max(0, m.index - 220), m.index + 260);
    const rel = m.index - Math.max(0, m.index - 220);
    // Havalimanı kodları: önce parantez içi "(ESB)", yoksa bilinen kodlar
    let iatas = [...win.matchAll(/\(([A-Z]{3})\)/g)].map(x => ({ c: x[1], i: x.index }));
    if (iatas.length < 2) iatas = [...win.matchAll(/\b([A-Z]{3})\b/g)].map(x => ({ c: x[1], i: x.index })).filter(x => AIRPORTS.has(x.c));
    // Önce uçuş kodundan SONRA gelen ilk iki farklı havalimanı (dönüş uçuşu öncekinin kodlarını almasın); yetmezse en yakınlar
    const firstTwo = (list) => { const u = []; list.forEach(x => { if (u.length < 2 && !u.some(y => y.c === x.c)) u.push(x); }); return u; };
    let pair = firstTwo(iatas.filter(x => x.i > rel));
    if (pair.length < 2) {
      const uniq = []; iatas.forEach(x => { if (!uniq.some(y => y.c === x.c)) uniq.push(x); });
      pair = uniq.map(x => ({ ...x, d: Math.abs(x.i - rel) })).sort((a, b) => a.d - b.d).slice(0, 2).sort((a, b) => a.i - b.i);
    }
    if (pair.length < 2) continue;
    const ds = datesIn(win);
    const dd = ds.filter(x => x.idx > rel).sort((a, b) => a.idx - b.idx)[0] || ds.sort((a, b) => Math.abs(a.idx - rel) - Math.abs(b.idx - rel))[0];
    if (!dd) continue;
    const times = [...win.slice(rel).matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)].map(x => x[0]);
    const key = code + dd.ymd; if (seen.has(key)) continue; seen.add(key);
    const cityBefore = (iata) => { const mm = win.match(new RegExp("([A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü'-]{2,25})\\s*\\(" + iata + "\\)")); return mm ? mm[1] : ''; };
    out.push({ code, ymd: dd.ymd, fromCity: cityBefore(pair[0].c), from: pair[0].c, toCity: cityBefore(pair[1].c), to: pair[1].c, dep: times[0] || '', arr: times[1] || '' });
  }
  return out;
};

// Uçuş numarası olmayan belgeler (ör. THY koltuk/ek hizmet onayı): "İzmir (ADB) - Guangzhou (CAN) 16 Ekim 2026 21:50 … 16:50"
export const AIRLINE_NAMES = [[/T[üu]rk Hava Yollar[ıi]|Turkish Airlines|\bTHY\b/i, 'THY'], [/Pegasus/i, 'Pegasus'], [/\bAJet\b/i, 'AJet'], [/SunExpress/i, 'SunExpress'], [/Lufthansa/i, 'Lufthansa'], [/Azerbaijan Airlines|AZAL/i, 'AZAL']];

export const detectFlightsRoute = (text) => {
  const raw = String(text || '').replace(/\s+/g, ' ');
  const airline = (AIRLINE_NAMES.find(([re]) => re.test(raw)) || [])[1] || '';
  const re = /([A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü.'-]{1,25}(?: [A-Za-zÇĞİÖŞÜçğıöşü.'-]{2,25}){0,2})\s*\(([A-Z]{3})\)\s*[-–—>]+\s*([A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü.'-]{1,25}(?: [A-Za-zÇĞİÖŞÜçğıöşü.'-]{2,25}){0,2})\s*\(([A-Z]{3})\)/g;
  const ms = [...raw.matchAll(re)];
  const out = [], seen = new Set();
  ms.forEach((m, k) => {
    const start = m.index + m[0].length;
    const seg = raw.slice(start, Math.min(k + 1 < ms.length ? ms[k + 1].index : raw.length, start + 220));
    const d = datesIn(seg)[0];
    if (!d || d.idx > 40) return;
    const times = [...seg.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)].map(x => x[0]);
    const cm = seg.match(/\b(TK|PC|VF|XQ|J2|LH|AJ)\s?-?\s?(\d{2,4})\b/);
    const key = m[2] + m[4] + d.ymd; if (seen.has(key)) return; seen.add(key);
    const last = (x) => String(x).trim().split(/\s+/).pop();
    out.push({ code: cm ? cm[1] + cm[2] : '', airline, ymd: d.ymd, fromCity: last(m[1]), from: m[2], toCity: last(m[3]), to: m[4], dep: times[0] || '', arr: times[1] || '' });
  });
  return out;
};

// Acente / GDS e-bilet tablosu (THY ve çoğu havayolu): "SOFIA/SOF ISTANBUL/IST TK 1032 H 05-10 15:50 05-10 17:20"
// Tarihte yıl yok → bilet düzenlenme tarihinden ("02OCT26" / "02EKİM26"); uçuş ayı daha önceyse ertesi yıl
export const MON3 = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12, OCA: 1, SUB: 2, NIS: 4, MAY_: 5, HAZ: 6, TEM: 7, AGU: 8, EYL: 9, EKI: 10, KAS: 11, ARA: 12 };

export const detectFlightsGDS = (text) => {
  const raw = String(text || '').replace(/\s+/g, ' ');
  const up = asciiTr(raw).toUpperCase();
  let issueY = new Date().getFullYear(), issueM = new Date().getMonth() + 1;
  const im = up.match(/\b(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|OCAK|SUBAT|MART|NISAN|MAYIS|HAZIRAN|TEMMUZ|AGUSTOS|EYLUL|EKIM|KASIM|ARALIK)(\d{2})\b/);
  if (im) { issueY = 2000 + +im[3]; issueM = MON3[im[2].slice(0, 3)] || issueM; }
  // Şehir: en az 2 harfli kelimeler (önceki satırın sonundaki "W C" gibi tek harfler karışmasın)
  const re = /\*?([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ'.-]{1,24}(?: [A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ'.-]{1,24}){0,2})\/([A-Z]{3})\s+\*?([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ'.-]{1,24}(?: [A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ'.-]{1,24}){0,2})\/([A-Z]{3})\s+([A-Z0-9]{2})\s+(\d{1,4})\s+[A-Z]\s+(\d{2})-?(\d{2}|[A-Z]{3})\s+(\d{1,2}:?\d{2})\s+(?:(\d{2})-?(\d{2}|[A-Z]{3})\s+)?(\d{1,2}:?\d{2})/g;
  const out = [], seen = new Set();
  let m;
  const tm = (t) => t.includes(':') ? t : t.slice(0, -2) + ':' + t.slice(-2);
  while ((m = re.exec(raw))) {
    const d = +m[7], mo = /\d/.test(m[8]) ? +m[8] : (MON3[asciiTr(m[8]).toUpperCase()] || 0);
    if (!mo || d < 1 || d > 31) continue;
    const y = mo < issueM - 1 ? issueY + 1 : issueY;
    const ymd = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const code = m[5] + m[6];
    if (seen.has(code + ymd)) continue; seen.add(code + ymd);
    // Biletteki şehirler ASCII büyük harf: Türkçe küçültme "SOFIA"yı "Sofıa" yapmasın
    const tc = (x) => titleCaseTr(x.trim());
    const arrNext = !!(m[10] && (+m[10] !== d || m[11] !== m[8])); // varış tarihi kalkıştan farklı → (+1)
    out.push({ code, ymd, fromCity: tc(m[1]), from: m[2], toCity: tc(m[3]), to: m[4], dep: tm(m[9]), arr: tm(m[12]), ...(arrNext ? { arrNext } : {}) });
  }
  return out;
};

export const detectFlights = (text) => {
  const strict = detectFlightsStrict(text);
  if (strict.length) return strict;
  const gds = detectFlightsGDS(text);
  if (gds.length) return gds;
  const loose = detectFlightsLoose(text);
  return loose.length ? loose : detectFlightsRoute(text);
};

// Aynı uçuş mu? (numara yoksa güzergah + tarih)
export const sameFlight = (a, b) => a.ymd === b.ymd && (a.code && b.code ? a.code === b.code : a.from === b.from && a.to === b.to);

export const detectFlightsStrict = (text) => {
  const out = [], seen = new Set();
  const re = /([A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü .'-]{1,30}?)\s*\(([A-Z]{3})\)\s+([A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü .'-]{1,30}?)\s*\(([A-Z]{3})\)\s+([A-Z0-9]{2})\s?-?\s?(\d{1,4})\s+(\d{2})[/.](\d{2})[/.](\d{4})\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})/g;
  let m;
  while ((m = re.exec(String(text || '').replace(/\s+/g, ' ')))) {
    const code = `${m[5]}${m[6]}`, ymd = `${m[9]}-${m[8]}-${m[7]}`;
    if (seen.has(code + ymd)) continue; seen.add(code + ymd);
    // Şehir adının önüne PDF başlıkları ("ARRIVAL TIME Varış Saati Ankara") karışabiliyor → son kelime
    const city = (x) => String(x).trim().split(/\s+/).pop();
    out.push({ code, ymd, fromCity: city(m[1]), from: m[2], toCity: city(m[3]), to: m[4], dep: m[10], arr: m[11] });
  }
  return out;
};
