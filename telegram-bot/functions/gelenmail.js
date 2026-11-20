// ===== Vize: gelen kutusunu okuma (vize@paydostur.com) =====
// 15 dakikada bir IMAP ile gelen kutusuna bakar. Mailler SİLİNMEZ, okundu işaretlenmez.
// 1) iDATA randevu maili (gönderen idata.com.tr): tablodaki AD SOYAD / PNR / OFİS / RANDEVU TARİHİ okunur.
//    İsim + ülke TEK bir açık başvuruyla birebir eşleşirse randevu ve PNR başvuruya yazılır, durum "Atama Bekliyor" ise "Evrak Topluyor" olur;
//    eşleşmezse yalnız gruba haber verilir.
//    Müşteriye randevu mailini evrakmail.js gönderir (randevu tarihi yazılan her başvuruya, en geç 15 dk içinde;
//    app_settings.autoSureliMail === false ise ya da başvuruda autoMailOff varsa gitmez).
// Test: grupta /mailtest → son 5 mail okunur, ne yapılacağı yazılır; HİÇBİR ŞEY kaydedilmez, müşteriye mail gitmez
//    (örnek randevu maili acentenin kendi adresine gider). Okuma kapalıyken de çalışır.
// 2) Müşteriden gelen mail: gönderen adresi CRM'deki müşteri e-postasıyla eşleşirse gruba "mail geldi" bildirimi. Ek KAYDEDİLMEZ.
// 3) Tanınmayan gönderen: yalnız bildirilir. Otomatik/toplu mailler (noreply, bülten) ve iDATA doğrulama kodları sessizce geçilir.
// Ayar: app_settings/main.imapVisa = { on, host, port } — kullanıcı/şifre Vize SMTP'den (smtpVisa) alınır.
// İlk çalışmada kutudaki eski mailler işlenmez; yalnız o andan sonra gelenler okunur.
// Okuma konumu bot_state/imapVisa'da durur (app_settings/main'i CRM bütün olarak yazdığı için orada tutulmaz — eski konumla ezilirdi).
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
if (!admin.apps.length) admin.initializeApp();
const { getFirestore } = require('firebase-admin/firestore');
const { normTr, titleCaseTr, normEmail, dmy, trHas, statusLabels } = require('./tr'); // Türkçe karakter kuralı (CLAUDE.md)
const { sendMail, buildRandevuMail } = require('./evrakmail');

const TZ = 'Europe/Istanbul';
const MAX_PER_RUN = 25;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const closed = (v) => /onay|red|iptal/.test(normTr(v.status));
const istDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// ---- iDATA randevu maili ----
const stripTags = (s) => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();
const DATE_RE = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/;
const TIME_RE = /(\d{1,2}):(\d{2})/;
// PNR: harf + rakam karışık (SDPU3JPFTE9) ya da iDATA'nın "SDP" ile başlayan rakamsız kodu (SDPRPTZGYDU).
// Rakamsız ve SDP'siz büyük harf kelime ("STANDART") PNR sayılmaz.
const PNR_RE = /^(?=[A-Z0-9]{6,16}$)(?:(?=.*\d)(?=.*[A-Z])|SDP[A-Z0-9]{5,})/;

const rowFromCells = (cells) => {
  const pi = cells.findIndex(c => PNR_RE.test(c));
  const di = cells.findIndex(c => DATE_RE.test(c));
  if (pi < 1 || di < 0 || di <= pi) return null;
  const dm = DATE_RE.exec(cells[di]);
  const tm = TIME_RE.exec(cells.slice(di).join(' ').replace(DATE_RE, ' '));
  const mid = cells.slice(pi + 1, di);
  const name = cells.slice(0, pi).join(' ').replace(/\s+/g, ' ').trim();
  if (name.length < 3 || /\d/.test(name)) return null;
  return {
    name, pnr: cells[pi], purpose: mid[0] || '', office: mid[1] || '', serviceType: mid[2] || '',
    appointmentDate: `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`,
    appointmentTime: tm ? `${tm[1].padStart(2, '0')}:${tm[2]}` : '',
  };
};

// Döner: [{ name, pnr, purpose, office, serviceType, appointmentDate (YYYY-AA-GG), appointmentTime }]
const parseIdataMail = ({ html, text } = {}) => {
  const rows = [];
  const add = (r) => { if (r && !rows.some(x => x.pnr === r.pnr)) rows.push(r); };
  // 1) HTML tablo satırları
  for (const tr of String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(stripTags).filter(Boolean);
    if (cells.length >= 4) add(rowFromCells(cells));
  }
  if (rows.length) return rows;
  // 2) Düz metin: başlık satırından sonraki hücreler (sekme / satır / 2+ boşlukla ayrılmış)
  const t = String(text || '');
  const m = /RANDEVU\s+TAR[İI]H[İI]/.exec(t.toLocaleUpperCase('tr-TR')); // görüntülenen başlık; eşleşme konumu için
  if (!m) return rows;
  const cells = t.slice(m.index + m[0].length).split(/\t|\r?\n|\s{2,}/).map(s => s.trim()).filter(Boolean);
  let buf = [];
  for (const c of cells) {
    if (/^(secilen|randevunuzu|sayin)/.test(normTr(c))) break;
    buf.push(c);
    if (DATE_RE.test(c)) {
      if (!TIME_RE.test(c.replace(DATE_RE, ' '))) continue; // saat ayrı hücrede olabilir
      add(rowFromCells(buf)); buf = [];
    } else if (/^\d{1,2}:\d{2}$/.test(c) && buf.some(x => DATE_RE.test(x))) { add(rowFromCells(buf)); buf = []; }
  }
  if (buf.length) add(rowFromCells(buf));
  return rows;
};

const nameKey = (s) => normTr(s).split(/\s+/).filter(Boolean).sort().join(' ');
const words = (s) => normTr(s).split(/[^a-z]+/).filter(Boolean);
// Tek harf farkı (eksik/fazla/değişik): "sarkaya" ~ "sarikaya"
const lev1 = (a, b) => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
};
const wordEq = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && lev1(a, b));
// Kısa addaki her kelime (en az 2) uzun adda karşılık bulur: ikinci ad / ek soyad / tek harf yazım farkı
const nameNear = (a, b) => {
  const A = words(a), B = words(b);
  const [s, l] = A.length <= B.length ? [A, B] : [B, A];
  if (s.length < 2) return false;
  const used = new Set();
  return s.every(w => { const k = l.findIndex((x, j) => !used.has(j) && wordEq(w, x)); if (k < 0) return false; used.add(k); return true; });
};
const countryOk = (v, purpose) => !v.country || !purpose || purpose.includes(normTr(v.country)) || normTr(v.country).includes(purpose.split(/\s*-\s*/)[0]);
// Eşleşme sırası: aynı PNR → isim birebir (kelime sırası serbest) → isim yakın (ikinci ad, ek soyad, tek harf farkı).
// Her adımda ülke uyumlu + kapanmamış başvurular. Yakın eşleşmede dönen dizide .yakin = true (bildirimde belirtilir).
// Yazma yalnız TEK aday varsa yapılır (çağıran taraf); birden çok adayda hiçbir şey yazılmaz.
const matchVisas = (row, visas) => {
  const samePnr = visas.filter(v => v.pnr && String(v.pnr).trim().toUpperCase() === row.pnr);
  if (samePnr.length === 1) return samePnr;
  const key = nameKey(row.name);
  const purpose = normTr(row.purpose);
  const open = visas.filter(v => !closed(v) && countryOk(v, purpose));
  const exact = open.filter(v => nameKey(v.customerName) === key);
  if (exact.length) return exact;
  const near = open.filter(v => nameNear(v.customerName, row.name));
  near.yakin = true;
  return near;
};
// Eşleşme yoksa: aynı ülkede ad ya da soyadı tutan açık başvurular (en çok 3) — gruba "benzer" diye gösterilir
const similarVisas = (row, visas) => {
  const W = words(row.name).filter(w => w.length >= 3), purpose = normTr(row.purpose);
  return visas.filter(v => !closed(v) && countryOk(v, purpose) && words(v.customerName).some(x => W.some(w => wordEq(w, x)))).slice(0, 3);
};

// ---- Gönderen sınıflandırma ----
const isIdataSender = (addr) => /(^|[@.])idata\.com\.tr$/.test(addr);
// iDATA'nın doğrulama kodu mailleri (randevu alırken gelen tek kullanımlık kod) bildirilmez
const isIdataCode = (m) => isIdataSender(m.from) && (/^verify@/.test(m.from) || /dogrulama kodu|verification code|verifizierungscode/.test(normTr(m.subject)));
const isAutoMail = (m) => isIdataCode(m) || /no-?reply|mailer-daemon|postmaster|bounce|newsletter|bulten|notification/.test(m.from)
  || !!m.listUnsubscribe || /bulk|junk|list/.test(String(m.precedence || '')) || (m.autoSubmitted && !/^no$/i.test(m.autoSubmitted));

// ---- IMAP ----
// Döner: { uidValidity, lastUid, mails: [{ uid, from, fromName, subject, text, html, attachments:[{filename,size}], ... }] }
const fetchInbox = async ({ host, port, user, pass }, state) => {
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');
  const client = new ImapFlow({ host, port, secure: port === 993, auth: { user, pass }, logger: false });
  await client.connect();
  const out = { uidValidity: '', lastUid: 0, mails: [] };
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      out.uidValidity = String(client.mailbox.uidValidity);
      const newest = Number(client.mailbox.uidNext) - 1;
      const fresh = !state.lastUid || String(state.uidValidity || '') !== out.uidValidity;
      const uids = [];
      if (state.testLast) { // test: konuma bakmadan son N mail
        const total = Number(client.mailbox.exists) || 0;
        out.toplam = total;
        if (total) for await (const msg of client.fetch(`${Math.max(1, total - state.testLast + 1)}:*`, { uid: true })) uids.push(msg.uid);
      } else {
        if (fresh) { out.lastUid = newest; return out; } // ilk kurulum: eskiler işlenmez
        out.lastUid = Number(state.lastUid);
        if (newest <= out.lastUid) return out;
        for await (const msg of client.fetch(`${out.lastUid + 1}:*`, { uid: true }, { uid: true })) if (msg.uid > out.lastUid) uids.push(msg.uid);
      }
      uids.sort((a, b) => a - b);
      for (const uid of uids.slice(0, MAX_PER_RUN)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        out.lastUid = uid;
        if (!msg || !msg.source) continue;
        const p = await simpleParser(msg.source);
        const f = (p.from && p.from.value && p.from.value[0]) || {};
        out.mails.push({
          uid, from: normEmail(f.address), fromName: f.name || '', subject: p.subject || '', text: p.text || '', html: typeof p.html === 'string' ? p.html : '',
          attachments: (p.attachments || []).filter(a => a.contentDisposition !== 'inline').map(a => ({ filename: a.filename || 'ek', size: a.size || 0 })),
          listUnsubscribe: p.headers.get('list-unsubscribe'), precedence: p.headers.get('precedence'), autoSubmitted: p.headers.get('auto-submitted'),
        });
      }
    } finally { lock.release(); }
  } finally { try { await client.logout(); } catch { /* bağlantı zaten kapalı */ } }
  return out;
};

const tg = async (token, chatId, text) => {
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), parse_mode: 'HTML', disable_web_page_preview: true }) });
  } catch (e) { console.warn('[gelenmail] telegram:', e.message); }
};

// Döner: { okunan, randevu, eslesmeyen, musteri, taninmayan, atlanan, hata }
const processInbox = async ({ db, fetchMails = fetchInbox, notify = tg, send = sendMail, test = false, chatId = '' } = {}) => {
  const settingsRef = db.collection('app_settings').doc('main');
  const settings = (await settingsRef.get()).data() || {};
  const cfg = settings.imapVisa || {};
  const smtp = settings.smtpVisa || {};
  const stateRef = db.collection('bot_state').doc('imapVisa');
  const st = (await stateRef.get()).data() || {};
  const res = { okunan: 0, randevu: 0, randevuMail: 0, eslesmeyen: 0, musteri: 0, taninmayan: 0, atlanan: 0, hata: '' };
  if (!test && cfg.on !== true) return res;
  const target = test ? chatId : settings.telegramVizeGrupId;
  const randevuMailOn = settings.autoSureliMail !== false;
  const host = String(cfg.host || '').trim();
  const user = String(cfg.user || smtp.user || '').trim();
  const pass = String(cfg.pass || smtp.pass || '');
  const port = parseInt(String(cfg.port || '993').trim(), 10) || 993;
  if (!host || !user || !pass) {
    console.log('[gelenmail] IMAP ayarı eksik (Ayarlar → Vize mail → Gelen kutusu)');
    if (test) await notify(settings.telegramBotToken, target, `🧪 Test yapılamadı: ${!host ? 'IMAP sunucusu girilmemiş (Ayarlar → Vize mail → Gelen Kutusunu Oku)' : 'Vize SMTP kullanıcı/şifresi girilmemiş'}.`);
    return res;
  }

  let box;
  try { box = await fetchMails({ host, port, user, pass }, test ? { testLast: 5 } : { lastUid: st.lastUid, uidValidity: st.uidValidity }); }
  catch (e) {
    res.hata = e.message || String(e);
    if (!test) { const { logError, flushErrors } = require('./syslog'); logError('gelenmail', `Gelen kutusu okunamadı: ${res.hata}`, db); await flushErrors(); }
    // Aynı hata her 15 dakikada gruba yazılmasın: günde bir kez
    if (test) await notify(settings.telegramBotToken, target, `🧪 ❌ Gelen kutusuna bağlanılamadı (${esc(user)} @ ${esc(host)}:${port}): ${esc(res.hata)}`);
    else if (st.hataGun !== istDate()) {
      await stateRef.set({ hataGun: istDate() }, { merge: true });
      await notify(settings.telegramBotToken, settings.telegramVizeGrupId, `❌ Gelen kutusu okunamadı (${esc(user)}): ${esc(res.hata)}\nAyarlar → Vize mail → Gelen kutusu bilgilerini kontrol edin.`);
    }
    return res;
  }

  const lines = [];
  let visas = null;
  const loadVisas = async () => {
    if (!visas) visas = (await db.collection('visa_applications').get()).docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
    return visas;
  };
  const custByEmail = async (addr) => {
    if (!addr) return null;
    const s = await db.collection('customers').where('email', '==', addr).limit(1).get();
    if (!s.empty) { const c = s.docs[0].data(); return titleCaseTr(`${c.firstName || ''} ${c.lastName || ''}`.trim()); }
    const v = await db.collection('visa_applications').where('customerEmail', '==', addr).limit(1).get();
    return v.empty ? null : titleCaseTr(v.docs[0].data().customerName || '');
  };
  const now = new Date().toISOString();
  const custCache = new Map();
  const getCust = async (v) => {
    const id = v.customerId != null ? String(v.customerId) : '';
    if (!id) return null;
    if (!custCache.has(id)) { try { const d = await db.collection('customers').doc(id).get(); custCache.set(id, d.exists ? d.data() : null); } catch { custCache.set(id, null); } }
    return custCache.get(id);
  };

  for (const m of box.mails) {
    res.okunan++;
    try {
      const rows = parseIdataMail(m);
      if (rows.length) {
        const trusted = isIdataSender(m.from);
        for (const row of rows) {
          const info = `${esc(row.purpose || 'iDATA')}${row.office ? `, ${esc(row.office)}` : ''} — <b>${dmy(row.appointmentDate)}${row.appointmentTime ? ` ${row.appointmentTime}` : ''}</b>, PNR <code>${esc(row.pnr)}</code>`;
          const hits = matchVisas(row, await loadVisas());
          if ((trusted || test) && hits.length === 1) {
            const v = hits[0];
            const old = v.appointmentDate && (String(v.appointmentDate).slice(0, 10) !== row.appointmentDate || (v.appointmentTime || '') !== row.appointmentTime)
              ? ` (önceki: ${dmy(String(v.appointmentDate).slice(0, 10))}${v.appointmentTime ? ` ${v.appointmentTime}` : ''})` : '';
            const patch = { pnr: row.pnr, appointmentDate: row.appointmentDate, appointmentTime: row.appointmentTime, idataMailAt: now };
            if (row.office) patch.idataOffice = row.office;
            if (!v.processor) patch.processor = 'İdata';
            // Randevu atandı: "Atama Bekliyor" (ya da "Randevu Bekliyor") → "Evrak Topluyor". Başka durumdaki başvurunun durumuna dokunulmaz.
            // Hedef etiket Ayarlar'daki yazımıyla ("EVRAK TOPLUYOR" vb.) yazılır.
            let durumNote = '';
            if (trHas(v.status, 'atama bekliyor', 'randevu bekliyor')) {
              const lbls = statusLabels(settings, 'Evrak Topluyor');
              patch.status = lbls.find(x => x !== 'Evrak Topluyor') || 'Evrak Topluyor';
              patch.updatedAt = now;
              durumNote = `\n🔄 durum: ${esc(v.status)} → ${esc(patch.status)}${test ? ' (olurdu)' : ''}`;
            }
            // Randevu mailini evrakmail.js gönderir; burada yalnız ne olacağı yazılır. Testte örnek mail acentenin kendi adresine gider.
            let mailNote = '';
            const cust = await getCust(v);
            const custTo = [cust?.email, v.customerEmail].map(normEmail).find(validEmail) || '';
            if (!randevuMailOn) mailNote = 'randevu maili kapalı (Ayarlar)';
            else if (v.autoMailOff) mailNote = 'bu başvuruda otomatik mail kapalı';
            else if (!custTo) mailNote = '⚠️ müşterinin e-postası yok, randevu maili gitmez';
            else if (!test) mailNote = `randevu maili 15 dakika içinde gider: ${esc(custTo)}`;
            if (test && randevuMailOn) {
              try {
                await send(smtp, { to: user, ...buildRandevuMail({ ...v, ...patch }, cust, istDate(), settings.randevuMailTemplate, settings) });
                res.randevuMail++;
                mailNote = `${mailNote ? `${mailNote}\n✉️ ` : `gerçekte müşteriye giderdi: ${esc(custTo)}\n✉️ `}örnek randevu maili ${esc(user)} adresine gönderildi (müşteriye gitmedi)`;
              } catch (e) { mailNote = `❌ örnek randevu maili gönderilemedi: ${esc(e.message)}`; }
            }
            if (!test) { await v.ref.set(patch, { merge: true }); Object.assign(v, patch); }
            res.randevu++;
            const yakin = hits.yakin ? `\n🔎 isim birebir değil: iDATA'da "${esc(titleCaseTr(row.name))}", CRM'de "${esc(titleCaseTr(v.customerName))}" — doğru kişi mi kontrol edin` : '';
            lines.push(`📅 <b>${esc(titleCaseTr(v.customerName))}</b> ${test ? 'randevusu başvuruya işlenirdi' : 'randevusu başvuruya işlendi'}${old}\n${info}${yakin}${durumNote}\n✉️ ${mailNote}${test && !trusted ? '\n⚠️ Bu mail iDATA adresinden gelmedi (iletilmiş); gerçek çalışmada işlenmez, yalnız bildirilir.' : ''}`);
          } else {
            res.eslesmeyen++;
            const why = !trusted ? 'mail iDATA adresinden gelmedi (iletilmiş olabilir)' : hits.length ? `${hits.length} başvuru eşleşti` : 'eşleşen açık başvuru yok';
            const benzer = hits.length ? hits.slice(0, 3) : similarVisas(row, await loadVisas());
            const benzerTxt = benzer.length ? `\n${hits.length ? 'Eşleşenler' : 'Benzer adlı açık başvurular'}: ${benzer.map(v => `${esc(titleCaseTr(v.customerName))} (${esc(v.visaDuration || v.country || '')}${v.status ? `, ${esc(v.status)}` : ''})`).join(' · ')}` : '';
            lines.push(`⚠️ <b>${esc(titleCaseTr(row.name))}</b> iDATA randevusu — ${why}, elle girin\n${info}${benzerTxt}`);
          }
        }
        continue;
      }
      // iDATA'nın randevu maili gibi görünüp tablosu okunamayan mail sessizce geçilmez (ör. rakamsız PNR yüzünden atlanıyordu)
      if (isIdataSender(m.from) && !isIdataCode(m) && /randevu|termin/.test(normTr(m.subject)) && /\bpnr\b/.test(normTr(`${m.text || ''} ${stripTags(m.html)}`))) {
        res.eslesmeyen++;
        lines.push(`⚠️ iDATA randevu maili okunamadı — elle kontrol edin: ${esc((m.subject || '').slice(0, 120))}`);
        continue;
      }
      if (isAutoMail(m)) { res.atlanan++; if (test) lines.push(`➖ Otomatik/toplu mail, geçilirdi: ${esc(m.from)} — ${esc((m.subject || '').slice(0, 80))}`); continue; }
      const ek = m.attachments.length ? `, ${m.attachments.length} ek` : '';
      const konu = esc((m.subject || '(konu yok)').slice(0, 120));
      const who = await custByEmail(m.from);
      if (who) { res.musteri++; lines.push(`📩 <b>${esc(who)}</b> mail gönderdi: ${konu}${ek}`); }
      else if (isIdataSender(m.from)) { res.taninmayan++; lines.push(`📨 iDATA bildirimi (randevu tablosu yok): ${konu}${ek}`); } // ör. iptal / değişiklik maili
      else { res.taninmayan++; lines.push(`✉️ Tanınmayan gönderen ${esc(m.fromName ? `${m.fromName} ` : '')}&lt;${esc(m.from)}&gt;: ${konu}${ek}`); }
    } catch (e) { console.warn('[gelenmail] mail işlenemedi uid', m.uid, e.message); }
  }

  if (!test && res.eslesmeyen) { const { logError, flushErrors } = require('./syslog'); logError('gelenmail', `iDATA randevusu başvuruyla eşleşmedi (${res.eslesmeyen} randevu)`, db); await flushErrors(); }
  if (test) {
    const head = `🧪 <b>TEST — hiçbir şey kaydedilmedi, müşteriye mail gitmedi</b>\n✅ Bağlantı tamam: ${esc(user)} (kutuda ${box.toplam ?? '?'} mail, son ${box.mails.length} tanesi okundu)\nOtomatik okuma: ${cfg.on === true ? 'AÇIK' : 'KAPALI'} · Randevu maili: ${randevuMailOn ? 'AÇIK' : 'KAPALI'}`;
    await notify(settings.telegramBotToken, target, `${head}\n\n${lines.length ? lines.join('\n\n') : 'Son maillerde işlenecek bir şey yok.'}`);
    return res;
  }
  await stateRef.set({ lastUid: box.lastUid, uidValidity: box.uidValidity, sonOkuma: now, hataGun: '' }, { merge: true });
  if (lines.length) await notify(settings.telegramBotToken, settings.telegramVizeGrupId, `📬 <b>${esc(user)}</b>\n\n${lines.join('\n\n')}`);
  return res;
};

exports.parseIdataMail = parseIdataMail;
exports.matchVisas = matchVisas;
exports.similarVisas = similarVisas;
exports.processInbox = processInbox;

exports.vizeGelenMail = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .pubsub.schedule('5-59/15 8-20 * * *').timeZone(TZ)
  .onRun(async () => {
    const r = await processInbox({ db: getFirestore('paydos') });
    console.log('[gelenmail]', JSON.stringify(r));
    return null;
  });
