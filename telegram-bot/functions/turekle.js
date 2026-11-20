// ===== 🎫 Pasaport mesajından "Tura Ekle" =====
// tr|c|<müşteri>            → yaklaşan turlar listelenir
// tr|t|<müşteri>|<tur>      → oda tipi seçilir (ayarlardaki oda tipleri)
// tr|r|<müşteri>|<tur>|<i>  → rezervasyon eklenir (CRM'deki toplu "Tura ekle" ile aynı alanlar; fiyat turun o oda fiyatı)
// Turda zaten olan kişi tekrar eklenmez. Tur kaydı işlem (transaction) içinde güncellenir: aynı anda CRM'den yapılan ekleme silinmez.
const { normTr, dmy } = require('./tr');

const tg = async (token, method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
};
const parseArr = (v) => { if (Array.isArray(v)) return v; try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const parseObj = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v || '{}') || {}; } catch { return {}; } };
const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10); // İstanbul
const daysLeft = (ymd) => ymd ? Math.ceil((new Date(ymd + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000) : -1;

// CRM src/lib/data.js schengenCountries ile aynı
const SCHENGEN = ['Almanya', 'Avusturya', 'Belçika', 'Çekya', 'Danimarka', 'Estonya', 'Finlandiya', 'Fransa', 'Hırvatistan', 'Hollanda', 'İspanya', 'İsveç', 'İsviçre', 'İtalya', 'İzlanda', 'Letonya', 'Liechtenstein', 'Litvanya', 'Lüksemburg', 'Macaristan', 'Malta', 'Norveç', 'Polonya', 'Portekiz', 'Slovakya', 'Slovenya', 'Yunanistan'];

// CRM Tours.jsx tourPriceFor ile aynı mantık (kayıtlı fiyat anahtarları eski fonksiyonla üretilmiş — CLAUDE.md §4)
const tourPriceFor = (tour, rt) => {
  const p = tour?.prices || {};
  const genKey = String(rt).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const map = { Single: 'singleRoom', Tek: 'singleRoom', 'Tek Kişilik': 'singleRoom', Double: 'doubleRoom', 'Çift': 'doubleRoom', 'Çift Kişilik': 'doubleRoom',
    Twin: 'doubleRoom', Triple: 'tripleRoom', 'Üçlü': 'tripleRoom', Suite: 'suiteRoom', 'Süit': 'suiteRoom' };
  for (const k of [genKey, map[rt], rt, String(rt).toLowerCase(), `${String(rt).toLowerCase()}Room`].filter(Boolean)) if (p[k]?.amount > 0) return p[k];
  const EQ = { single: 'tek', double: 'ift', twin: 'ift', triple: 'uc', suite: 'suit' };
  let n = normTr(rt).replace(/\s+/g, '_');
  for (const [en, tr] of Object.entries(EQ)) { if (n.includes(en)) { n = tr; break; } }
  for (const [k, v] of Object.entries(p)) if (v?.amount > 0 && (normTr(k).includes(n) || n.includes(normTr(k)))) return v;
  return null;
};

const roomTypes = async (db) => {
  try { const s = (await db.collection('app_settings').doc('main').get()).data() || {}; if (Array.isArray(s.roomTypes) && s.roomTypes.length) return s.roomTypes.slice(0, 8); } catch { /* varsayılan */ }
  return ['Single', 'Double', 'Twin', 'Triple'];
};
const custName = (c) => (c.name || `${c.firstName || ''} ${c.lastName || ''}`).replace(/\s+/g, ' ').trim();
const inTour = (tour, c, docId) => (tour.reservations || []).some(r => !r.cancelled && (String(r.customerId) === String(c.id ?? docId) || String(r.customerId) === String(docId)));

const edit = (token, chatId, msgId, text, rows) => tg(token, 'editMessageText', { chat_id: chatId, message_id: msgId, text, parse_mode: 'Markdown', ...(rows ? { reply_markup: { inline_keyboard: rows } } : {}) });

const handleCallback = async ({ db, token, chatId, msgId, parts }) => {
  const [, step, custId, tourId, ri] = parts;
  const cd = await db.collection('customers').doc(String(custId)).get();
  if (!cd.exists) { await tg(token, 'sendMessage', { chat_id: chatId, text: '❌ Müşteri bulunamadı.' }); return; }
  const c = cd.data(), name = custName(c);
  const back = [{ text: '✖️ Vazgeç', callback_data: `tr|x|${custId}` }];

  if (step === 'x') { await tg(token, 'deleteMessage', { chat_id: chatId, message_id: msgId }); return; }

  if (step === 'c') {
    const snap = await db.collection('tours').get();
    const t0 = today();
    const tours = snap.docs.map(d => ({ ...d.data(), _docId: d.id }))
      .filter(t => String(t.endDate || t.startDate || '') >= t0 && !/iptal|pasif/.test(normTr(t.status || '')))
      .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))).slice(0, 12);
    if (!tours.length) { await tg(token, 'sendMessage', { chat_id: chatId, text: 'ℹ️ Yaklaşan tur yok — önce CRM\'de turu açın.' }); return; }
    const rows = tours.map(t => [{ text: `${inTour(t, c, custId) ? '✅ ' : ''}${t.name || 'Tur'} · ${dmy(t.startDate)} (${(t.reservations || []).filter(r => !r.cancelled).length} kişi)`, callback_data: `tr|t|${custId}|${t._docId}` }]);
    rows.push(back);
    const text = `🎫 *${name}* hangi tura eklensin?`;
    // "⬅️ Turlar" (tr|c|<müşteri>|e) aynı mesajı günceller; pasaport mesajındaki düğme yeni mesaj açar (pasaport mesajı kalsın)
    if (tourId === 'e') await edit(token, chatId, msgId, text, rows);
    else await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
    return;
  }

  const td = await db.collection('tours').doc(String(tourId)).get();
  if (!td.exists) { await edit(token, chatId, msgId, '❌ Tur bulunamadı.'); return; }
  const tour = td.data();
  if (inTour(tour, c, custId)) { await edit(token, chatId, msgId, `ℹ️ *${name}* zaten "${tour.name}" turunda kayıtlı.`); return; }
  const rts = await roomTypes(db);

  if (step === 't') {
    const rows = [];
    rts.forEach((rt, i) => { const p = tourPriceFor(tour, rt); const b = { text: `${rt}${p ? ` · ${p.amount} ${p.currency || ''}` : ''}`, callback_data: `tr|r|${custId}|${tourId}|${i}` }; if (i % 2) rows[rows.length - 1].push(b); else rows.push([b]); });
    rows.push([{ text: '⬅️ Turlar', callback_data: `tr|c|${custId}|e` }, ...back]);
    await edit(token, chatId, msgId, `🎫 *${name}* → "${tour.name}" (${dmy(tour.startDate)})\nOda tipi?`, rows);
    return;
  }

  if (step === 'r') {
    const rt = rts[+ri] || rts[0];
    const price = tourPriceFor(tour, rt) || Object.values(tour.prices || {}).find(x => x?.amount > 0);
    const passports = parseArr(c.passports);
    const pp = passports.find(x => x.passportNo && daysLeft(x.expiryDate) > 0) || passports[0];
    let hasVisa = false, visaEndDate = '';
    if (SCHENGEN.includes(tour.country)) { const v = parseArr(c.schengenVisas).find(x => x.endDate && daysLeft(x.endDate) > 0); if (v) { hasVisa = true; visaEndDate = v.endDate; } }
    else if (tour.country === 'Amerika Birleşik Devletleri' || tour.country === 'ABD') { const u = parseObj(c.usaVisa); if (u.endDate && daysLeft(u.endDate) > 0) { hasVisa = true; visaEndDate = u.endDate; } }
    const ref = db.collection('tours').doc(String(tourId));
    let added = false, count = 0;
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() || {};
      const list = cur.reservations || [];
      if (inTour(cur, c, custId)) return;
      const r = {
        id: Date.now(), sNo: list.length + 1,
        customerId: c.id ?? custId, customerName: name,
        customerPhone: c.phone || '', customerEmail: c.email || '', company: c.companyName || c.company || '',
        roomType: rt, roommate: '', roommate3: '', hasChild: false,
        passport: pp?.passportNo || '', hasVisa, visaEndDate,
        tourPrice: price?.amount || 0, currency: price?.currency || '€',
        payment1: 0, payment2: 0, payment3: 0, notes: '', createdAt: new Date().toISOString(), createdBy: 'Telegram',
      };
      tx.update(ref, { reservations: [...list, r] });
      added = true; count = list.filter(x => !x.cancelled).length + 1;
    });
    if (!added) { await edit(token, chatId, msgId, `ℹ️ *${name}* zaten "${tour.name}" turunda kayıtlı.`); return; }
    const visaLine = SCHENGEN.includes(tour.country) || /amerika|abd/.test(normTr(tour.country || '')) ? `\n${hasVisa ? `🛂 Vize var (bitiş ${dmy(visaEndDate)})` : '⚠️ Geçerli vizesi görünmüyor'}` : '';
    await edit(token, chatId, msgId, `✅ *${name}* "${tour.name}" turuna eklendi\n🛏 ${rt}${price ? ` · ${price.amount} ${price.currency || ''}` : ' · fiyat yok'}\n📘 ${pp?.passportNo || 'pasaport yok'}${visaLine}\n👥 Turda ${count} kişi — oda arkadaşı ve ödemeleri CRM'den girin.`,
      [[{ text: '👤 Müşteri kartı', url: `https://crm.paydostur.com/?musteri=${encodeURIComponent(custId)}` }]]);
  }
};

module.exports = { handleCallback, tourPriceFor };
