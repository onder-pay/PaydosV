// ===== 🛂 Telegram grubunda pasaport görseli isteme =====
// /pasaport Ad Soyad      → müşterinin (en son) pasaport görseli dosya olarak gruba gelir; birden çok eşleşmede seçme düğmeleri
// /turpasaport Tur adı    → turdaki yolcuların pasaportları 10'arlı dosya grupları halinde; görseli olmayanlar sonda yazılır
// Yalnız bot erişimi olan (kayıtlı) gruplarda çalışır — erişim kontrolü index.js'te (botAccess).
const { titleCaseTr, normTr, dmy } = require('./tr');

const tg = async (token, method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
};
// Dosyalı Telegram çağrısı (multipart). files: [{ field, name, buf, mime }]
const tgUpload = async (token, method, fields, files) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, typeof v === 'string' ? v : JSON.stringify(v)));
  files.forEach(f => fd.append(f.field, new Blob([f.buf], { type: f.mime }), f.name));
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: fd });
  return r.json();
};

const parseArr = (v) => { if (Array.isArray(v)) return v; try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
// Müşterinin en son (bitişi en geç) görselli pasaportu
const passportOf = (c) => {
  const pp = parseArr(c && c.passports).filter(p => p && p.image && (/^https:\/\//.test(p.image) || /^data:image\//.test(p.image)));
  pp.sort((a, b) => String(b.expiryDate || '').localeCompare(String(a.expiryDate || '')));
  return pp[0] || null;
};
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
const fileOf = async (img) => {
  if (/^data:/.test(img)) {
    const m = img.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) throw new Error('bozuk görsel');
    return { buf: Buffer.from(m[2], 'base64'), mime: m[1] };
  }
  const r = await fetch(img);
  if (!r.ok) throw new Error('görsel indirilemedi (' + r.status + ')');
  return { buf: Buffer.from(await r.arrayBuffer()), mime: (r.headers.get('content-type') || 'image/jpeg').split(';')[0] };
};
// Dosya adı ASCII (Telegram'da ve bilgisayarda sorunsuz)
const fileName = (s) => normTr(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'pasaport';
const fullName = (c) => titleCaseTr(`${c.firstName || ''} ${c.lastName || ''}`.trim());

let cache = null; // aynı çağrıda müşteriler bir kez okunur
const allCustomers = async (db) => {
  if (cache && Date.now() - cache.at < 60000) return cache.list;
  const snap = await db.collection('customers').get();
  const list = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  cache = { at: Date.now(), list };
  return list;
};
// İsim araması: yazılan her kelime ad-soyadın bir kelimesinin başı olmalı ("ond tas" → Önder Taşçı)
const searchCustomers = (list, q) => {
  const qw = normTr(q).split(/\s+/).filter(Boolean);
  if (!qw.length) return [];
  return list.filter(c => {
    const w = normTr(`${c.firstName || ''} ${c.lastName || ''}`).split(/\s+/).filter(Boolean);
    return qw.every(x => w.some(y => y.startsWith(x)));
  });
};

const sendPassport = async ({ token, chatId, cust, replyTo }) => {
  const p = passportOf(cust);
  if (!p) { await tg(token, 'sendMessage', { chat_id: chatId, text: `ℹ️ ${fullName(cust)} için kayıtlı pasaport görseli yok.`, reply_to_message_id: replyTo }); return false; }
  const { buf, mime } = await fileOf(p.image);
  const r = await tgUpload(token, 'sendDocument', { chat_id: String(chatId), caption: `🛂 ${fullName(cust)}${p.passportNo ? ` · ${p.passportNo}` : ''}${p.expiryDate ? ` · bitiş ${dmy(p.expiryDate)}` : ''}`, ...(replyTo ? { reply_to_message_id: String(replyTo) } : {}) },
    [{ field: 'document', name: `${fileName(fullName(cust))}_pasaport.${EXT[mime] || 'jpg'}`, buf, mime }]);
  if (!r.ok) throw new Error(r.description || 'gönderilemedi');
  return true;
};

// /pasaport <isim>
const handlePasaport = async ({ db, token, chatId, query, replyTo }) => {
  if (!query) { await tg(token, 'sendMessage', { chat_id: chatId, text: 'Kullanım: /pasaport Ad Soyad\nÖrnek: /pasaport önder taşçı' }); return; }
  const hits = searchCustomers(await allCustomers(db), query);
  if (!hits.length) { await tg(token, 'sendMessage', { chat_id: chatId, text: `🔍 "${query}" ile eşleşen müşteri yok.`, reply_to_message_id: replyTo }); return; }
  if (hits.length === 1) { await sendPassport({ token, chatId, cust: hits[0], replyTo }); return; }
  if (hits.length > 8) { await tg(token, 'sendMessage', { chat_id: chatId, text: `🔍 ${hits.length} müşteri eşleşti — soyadı da yazın.`, reply_to_message_id: replyTo }); return; }
  const rows = hits.map(c => [{ text: `${passportOf(c) ? '🛂' : '▫️'} ${fullName(c)}${c.birthDate ? ` (${dmy(c.birthDate)})` : ''}`, callback_data: `pp|c|${c._docId}` }]);
  await tg(token, 'sendMessage', { chat_id: chatId, text: 'Hangi müşteri?', reply_to_message_id: replyTo, reply_markup: { inline_keyboard: rows } });
};

// Turdaki yolcular → müşteri kaydı (id / doküman id / isim)
const tourPeople = (tour, customers) => (tour.reservations || []).filter(r => !r.cancelled).map(r => {
  const id = String(r.customerId || '');
  const c = (id && customers.find(x => String(x.id) === id || x._docId === id)) || customers.find(x => normTr(`${x.firstName || ''} ${x.lastName || ''}`) === normTr(r.customerName || ''));
  return { name: titleCaseTr(r.customerName || (c ? `${c.firstName} ${c.lastName}` : '?')), c };
});
const sendTourPassports = async ({ db, token, chatId, tour }) => {
  const people = tourPeople(tour, await allCustomers(db));
  const withImg = people.filter(x => x.c && passportOf(x.c));
  const missing = people.filter(x => !(x.c && passportOf(x.c))).map(x => x.name);
  if (!withImg.length) { await tg(token, 'sendMessage', { chat_id: chatId, text: `ℹ️ ${tour.name}: pasaport görseli olan yolcu yok.` }); return; }
  await tg(token, 'sendMessage', { chat_id: chatId, text: `🛂 ${tour.name} — ${withImg.length} pasaport gönderiliyor…` });
  const fail = [];
  for (let i = 0; i < withImg.length; i += 10) {
    const part = withImg.slice(i, i + 10);
    const files = [], media = [];
    for (let k = 0; k < part.length; k++) {
      const { name, c } = part[k], p = passportOf(c);
      try {
        const { buf, mime } = await fileOf(p.image);
        const f = `f${k}`;
        files.push({ field: f, name: `${String(i + k + 1).padStart(2, '0')}_${fileName(name)}.${EXT[mime] || 'jpg'}`, buf, mime });
        media.push({ type: 'document', media: `attach://${f}`, caption: `${i + k + 1}. ${name}${p.passportNo ? ` · ${p.passportNo}` : ''}${p.expiryDate ? ` · bitiş ${dmy(p.expiryDate)}` : ''}` });
      } catch (e) { fail.push(name); }
    }
    if (!media.length) continue;
    // Tek dosya media group olamaz (en az 2) → sendDocument
    const r = media.length === 1
      ? await tgUpload(token, 'sendDocument', { chat_id: String(chatId), caption: media[0].caption }, [{ ...files[0], field: 'document' }])
      : await tgUpload(token, 'sendMediaGroup', { chat_id: String(chatId), media }, files);
    if (!r.ok) fail.push(...part.map(x => x.name));
  }
  const notes = [missing.length ? `Görseli olmayan (${missing.length}): ${missing.join(', ')}` : '', fail.length ? `Gönderilemeyen (${fail.length}): ${fail.join(', ')}` : ''].filter(Boolean);
  await tg(token, 'sendMessage', { chat_id: chatId, text: `✅ ${tour.name}: ${withImg.length - fail.length} pasaport gönderildi.${notes.length ? '\n' + notes.join('\n') : ''}` });
};

// /turpasaport <tur adı> — yazılmazsa yaklaşan/devam eden turlar listelenir
const handleTurPasaport = async ({ db, token, chatId, query, replyTo }) => {
  const snap = await db.collection('tours').get();
  const today = new Date().toISOString().slice(0, 10);
  let tours = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  if (query) {
    const qw = normTr(query).split(/\s+/).filter(Boolean);
    tours = tours.filter(t => qw.every(x => normTr(`${t.name || ''} ${t.city || ''} ${t.country || ''}`).includes(x)));
  } else tours = tours.filter(t => String(t.endDate || t.startDate || '') >= today);
  tours.sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')));
  if (!tours.length) { await tg(token, 'sendMessage', { chat_id: chatId, text: query ? `🔍 "${query}" ile eşleşen tur yok.` : 'ℹ️ Yaklaşan tur yok. Kullanım: /turpasaport Tur adı', reply_to_message_id: replyTo }); return; }
  if (tours.length === 1 && query) { await sendTourPassports({ db, token, chatId, tour: tours[0] }); return; }
  const rows = tours.slice(0, 10).map(t => [{ text: `${t.name || 'Tur'} · ${dmy(t.startDate)} (${(t.reservations || []).filter(r => !r.cancelled).length} kişi)`, callback_data: `pp|t|${t._docId}` }]);
  await tg(token, 'sendMessage', { chat_id: chatId, text: 'Hangi turun pasaportları?', reply_to_message_id: replyTo, reply_markup: { inline_keyboard: rows } });
};

// Düğme: pp|c|<müşteri doc id> · pp|t|<tur doc id>
const handleCallback = async ({ db, token, chatId, parts }) => {
  if (parts[1] === 'c') {
    const d = await db.collection('customers').doc(String(parts[2])).get();
    if (!d.exists) { await tg(token, 'sendMessage', { chat_id: chatId, text: '❌ Müşteri bulunamadı.' }); return; }
    await sendPassport({ token, chatId, cust: { ...d.data(), _docId: d.id } });
  } else if (parts[1] === 't') {
    const d = await db.collection('tours').doc(String(parts[2])).get();
    if (!d.exists) { await tg(token, 'sendMessage', { chat_id: chatId, text: '❌ Tur bulunamadı.' }); return; }
    await sendTourPassports({ db, token, chatId, tour: { ...d.data(), _docId: d.id } });
  }
};

module.exports = { handlePasaport, handleTurPasaport, handleCallback, searchCustomers, passportOf, tourPeople };
