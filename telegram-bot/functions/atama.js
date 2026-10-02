// ===== Vize: günlük Telegram grup duyuruları =====
// 09:30 — "Bugün başvuru yapılacaklar": vizecinin 10:00'da İdata/VFS'te yapacağı başvurular (CRM'deki "...Başvuru Yapılacak"
//          durumundakiler; ileri tarihli olanlar tarihi gelene kadar listeye girmez — CRM'deki kuralla aynı). "/bugun" ile elle.
// Vizeci her gün 10:00'da İdata/VFS başvurularını yapar; başvurusu yapılanlar CRM'de "Atama Bekliyor" olur.
// 11:30 ve 17:00 (hafta içi, İstanbul): o zamana kadar o zamana kadar yeni "Atama Bekliyor"a geçenleri
// gruba tek mesajla yazar. Aynı kişi iki kez yazılmaz (visa_applications.atamaDuyuruAt).
// Grup: bot grupta "/grup" yazılarak kaydedilir (app_settings/main.telegramVizeGrupId). "/atama" ile beklemeden hemen yazdırılır.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
if (!admin.apps.length) admin.initializeApp();
const { getFirestore } = require('firebase-admin/firestore');

const STATUS = 'Atama Bekliyor';
const TZ = 'Europe/Istanbul';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const titleTr = (s) => String(s || '').toLocaleLowerCase('tr-TR').replace(/(^|[\s-])(\S)/g, (m, a, b) => a + b.toLocaleUpperCase('tr-TR'));
const istDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); // YYYY-MM-DD
const istLabel = (d = new Date()) => new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: 'numeric', month: 'long', weekday: 'long' }).format(d);

const tg = async (token, method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
};

// Yeni "Atama Bekliyor"ları bulur, gruba yazar, duyuruldu diye işaretler. Döner: yazılan kişi sayısı.
// İlk çalışmada eski birikmiş kayıtlar gruba dökülmesin: sadece bugün güncellenenler yazılır, eskiler sessizce işaretlenir.
const announceAtama = async ({ db, token, chatId }) => {
  const settingsRef = db.collection('app_settings').doc('main');
  const settings = (await settingsRef.get()).data() || {};
  const firstRun = !settings.atamaDuyuruBasladi;
  const today = istDate();
  const snap = await db.collection('visa_applications').where('status', '==', STATUS).get();
  const fresh = [], silent = [];
  snap.forEach(d => {
    const v = d.data() || {};
    if (v.atamaDuyuruAt) return;
    const touchedToday = String(v.updatedAt || '').slice(0, 10) === today || istDate(new Date(v.updatedAt || 0)) === today;
    if (firstRun && !touchedToday) silent.push(d.ref); else fresh.push({ ref: d.ref, v });
  });
  const now = new Date().toISOString();
  if (fresh.length) {
    fresh.sort((a, b) => String(a.v.customerName || '').localeCompare(String(b.v.customerName || ''), 'tr'));
    const lines = fresh.map((x, i) => {
      const v = x.v;
      const tur = [v.country, v.visaDuration || v.visaType].filter(Boolean).join(' · ');
      const ek = [v.idataOffice, v.pnr ? `PNR ${v.pnr}` : ''].filter(Boolean).join(' · ');
      return `${i + 1}. <b>${esc(titleTr(v.customerName || '—'))}</b>${tur ? ` — ${esc(tur)}` : ''}${ek ? `\n     <i>${esc(ek)}</i>` : ''}`;
    });
    const text = `🟣 <b>Başvurusu yapılanlar</b> — ${esc(istLabel())}\nDurum: <b>Atama bekliyor</b>\n\n${lines.join('\n')}\n\nToplam <b>${fresh.length}</b> kişi.`;
    // Telegram mesaj sınırı 4096 karakter: uzunsa parçala
    const chunks = []; let cur = '';
    text.split('\n').forEach(l => { if ((cur + '\n' + l).length > 3800) { chunks.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l; });
    if (cur) chunks.push(cur);
    for (const c of chunks) {
      const r = await tg(token, 'sendMessage', { chat_id: chatId, text: c, parse_mode: 'HTML', disable_web_page_preview: true });
      if (!r.ok) throw new Error('Telegram: ' + (r.description || 'gönderilemedi'));
    }
  }
  // İşaretle (gönderim başarılıysa) — 400'lük parçalar halinde
  const all = [...fresh.map(x => x.ref), ...silent];
  for (let i = 0; i < all.length; i += 400) {
    const b = db.batch();
    all.slice(i, i + 400).forEach(ref => b.set(ref, { atamaDuyuruAt: now }, { merge: true }));
    await b.commit();
  }
  if (firstRun) await settingsRef.set({ atamaDuyuruBasladi: now }, { merge: true });
  return fresh.length;
};

const loadCfg = async () => {
  const db = getFirestore('paydos');
  const d = (await db.collection('app_settings').doc('main').get()).data() || {};
  return { db, token: d.telegramBotToken || '', groupId: d.telegramVizeGrupId || '' };
};

// CRM'deki durum adları ayarlardan değişebilir: adında "başvuru yapılacak" geçen durum esas alınır
const findTodoStatus = (statuses) => {
  const list = (Array.isArray(statuses) ? statuses : []).map(x => typeof x === 'string' ? x : (x && (x.name || x.label)) || '').filter(Boolean);
  return list.find(x => /başvuru\s*yapılacak/i.test(x.toLocaleLowerCase('tr-TR'))) || list.find(x => /yapılacak/i.test(x.toLocaleLowerCase('tr-TR'))) || '';
};
// İleri tarihli (CRM visaFutureDate ile aynı): işlem tarihi bugünden sonra ve henüz PNR/randevu yok
const isFuture = (v, today) => !!v.processDate && String(v.processDate) > today && !v.pnr && !v.appointmentDate;

const announceTodo = async ({ db, token, chatId }) => {
  const settings = (await db.collection('app_settings').doc('main').get()).data() || {};
  const status = findTodoStatus(settings.visaStatuses);
  if (!status) throw new Error('CRM durumlarında "Başvuru Yapılacak" bulunamadı (Ayarlar → Vize durumları)');
  const today = istDate();
  const snap = await db.collection('visa_applications').where('status', '==', status).get();
  const list = [], later = [];
  snap.forEach(d => { const v = d.data() || {}; (isFuture(v, today) ? later : list).push(v); });
  list.sort((a, b) => String(a.customerName || '').localeCompare(String(b.customerName || ''), 'tr'));
  const lines = list.map((v, i) => {
    const tur = [v.country, v.visaDuration || v.visaType].filter(Boolean).join(' · ');
    return `${i + 1}. <b>${esc(titleTr(v.customerName || '—'))}</b>${tur ? ` — ${esc(tur)}` : ''}`;
  });
  const head = `📝 <b>Bugün başvuru yapılacaklar</b> — ${esc(istLabel())}`;
  const text = list.length
    ? `${head}\n\n${lines.join('\n')}\n\nToplam <b>${list.length}</b> kişi.${later.length ? `\n<i>İleri tarihli ${later.length} başvuru, tarihi gelince listeye girer.</i>` : ''}`
    : `${head}\n\nBugün başvurusu yapılacak kimse yok. ✅${later.length ? `\n<i>İleri tarihli ${later.length} başvuru bekliyor.</i>` : ''}`;
  const chunks = []; let cur = '';
  text.split('\n').forEach(l => { if ((cur + '\n' + l).length > 3800) { chunks.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l; });
  if (cur) chunks.push(cur);
  for (const c of chunks) {
    const r = await tg(token, 'sendMessage', { chat_id: chatId, text: c, parse_mode: 'HTML', disable_web_page_preview: true });
    if (!r.ok) throw new Error('Telegram: ' + (r.description || 'gönderilemedi'));
  }
  return list.length;
};

exports.announceAtama = announceAtama;
exports.announceTodo = announceTodo;

exports.vizeBugunDuyuru = functions
  .region('europe-west1')
  .pubsub.schedule('30 9 * * 1-5').timeZone(TZ)
  .onRun(async () => {
    const { db, token, groupId } = await loadCfg();
    if (!token || !groupId) { console.log('[bugun] token veya grup yok — grupta /grup yazın'); return null; }
    const n = await announceTodo({ db, token, chatId: groupId });
    console.log('[bugun] 09:30 listesi:', n);
    return null;
  });

exports.vizeAtamaDuyuru = functions
  .region('europe-west1')
  .pubsub.schedule('30 11 * * 1-5').timeZone(TZ)
  .onRun(async () => {
    const { db, token, groupId } = await loadCfg();
    if (!token || !groupId) { console.log('[atama] token veya grup yok — grupta /grup yazın'); return null; }
    const n = await announceAtama({ db, token, chatId: groupId });
    console.log('[atama] 11:30 duyurusu:', n);
    return null;
  });

// Öğleden sonra yapılan / geç işlenen başvurular için ikinci tur (yeni yoksa mesaj atılmaz)
exports.vizeAtamaDuyuruAksam = functions
  .region('europe-west1')
  .pubsub.schedule('0 17 * * 1-5').timeZone(TZ)
  .onRun(async () => {
    const { db, token, groupId } = await loadCfg();
    if (!token || !groupId) return null;
    const n = await announceAtama({ db, token, chatId: groupId });
    console.log('[atama] 17:00 duyurusu:', n);
    return null;
  });
