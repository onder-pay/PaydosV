const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const crypto = require('crypto');
const genId = () => crypto.randomUUID();
// Türkçe uyumlu isim düzeltme: "MEHMET AKKÖSE" → "Mehmet Akköse", "İSMAİL" → "İsmail"
const titleCaseTr = (s) => {
  if (!s) return '';
  const lower = String(s).replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  return lower.replace(/(^|[\s\-'])(\p{L})/gu, (m, sep, ch) => sep + (ch === 'i' ? 'İ' : ch.toLocaleUpperCase('tr-TR')));
};

// Schengen ülke adlarını Türkçe'ye çevir (AI'ın okuduğu dil ne olursa olsun)
const normalizeCountry = (raw) => {
  if (!raw) return '';
  const s = String(raw).toUpperCase().replace(/[^A-ZÄÖÜÇĞİŞÖÜÁÉÍÓÚÑÅÆØÉÈÊËÔÌÒ\s\/\-]/g, ' ').trim();
  const map = [
    { tr: 'Almanya',      keys: ['DEUTSCHLAND', 'GERMANY', 'ALLEMAGNE'] },
    { tr: 'Fransa',       keys: ['FRANCE', 'FRANKREICH', 'FRANCIA'] },
    { tr: 'İsviçre',      keys: ['SCHWEIZ', 'SUISSE', 'SVIZZERA', 'SWITZERLAND', 'SVIZRA'] },
    { tr: 'İtalya',       keys: ['ITALIA', 'ITALY', 'ITALIE', 'ITALIEN'] },
    { tr: 'İspanya',      keys: ['ESPAÑA', 'ESPANA', 'SPAIN', 'ESPAGNE', 'SPANIEN'] },
    { tr: 'Belçika',      keys: ['BELGIQUE', 'BELGIE', 'BELGIUM', 'BELGIEN'] },
    { tr: 'Hollanda',     keys: ['NEDERLAND', 'NETHERLANDS', 'PAYS-BAS', 'PAYS BAS', 'NIEDERLANDE'] },
    { tr: 'Avusturya',    keys: ['ÖSTERREICH', 'OSTERREICH', 'AUSTRIA', 'AUTRICHE'] },
    { tr: 'Yunanistan',   keys: ['ELLAS', 'HELLAS', 'GREECE', 'GRÈCE', 'GRECE', 'GRIECHENLAND'] },
    { tr: 'Polonya',      keys: ['POLSKA', 'POLAND', 'POLOGNE', 'POLEN'] },
    { tr: 'Macaristan',   keys: ['MAGYARORSZÁG', 'MAGYARORSZAG', 'HUNGARY', 'HONGRIE', 'UNGARN'] },
    { tr: 'Çekya',        keys: ['ČESKO', 'CESKO', 'CZECH', 'TCHEQUE', 'TCHÈQUE', 'TSCHECHIEN'] },
    { tr: 'Slovakya',     keys: ['SLOVENSKO', 'SLOVAKIA', 'SLOVAQUIE', 'SLOWAKEI'] },
    { tr: 'Slovenya',     keys: ['SLOVENIJA', 'SLOVENIA', 'SLOVÉNIE', 'SLOVENIE', 'SLOWENIEN'] },
    { tr: 'Hırvatistan',  keys: ['HRVATSKA', 'CROATIA', 'CROATIE', 'KROATIEN'] },
    { tr: 'Portekiz',     keys: ['PORTUGAL'] },
    { tr: 'Norveç',       keys: ['NORGE', 'NORWAY', 'NORVÈGE', 'NORVEGE', 'NORWEGEN'] },
    { tr: 'İsveç',        keys: ['SVERIGE', 'SWEDEN', 'SUÈDE', 'SUEDE', 'SCHWEDEN'] },
    { tr: 'Finlandiya',   keys: ['SUOMI', 'FINLAND', 'FINLANDE', 'FINNLAND'] },
    { tr: 'Danimarka',    keys: ['DANMARK', 'DENMARK', 'DANEMARK', 'DÄNEMARK'] },
    { tr: 'İzlanda',      keys: ['ÍSLAND', 'ISLAND', 'ICELAND', 'ISLANDE'] },
    { tr: 'Estonya',      keys: ['EESTI', 'ESTONIA', 'ESTONIE', 'ESTLAND'] },
    { tr: 'Letonya',      keys: ['LATVIJA', 'LATVIA', 'LETTONIE', 'LETTLAND'] },
    { tr: 'Litvanya',     keys: ['LIETUVA', 'LITHUANIA', 'LITUANIE', 'LITAUEN'] },
    { tr: 'Lüksemburg',   keys: ['LUXEMBOURG', 'LUXEMBURG'] },
    { tr: 'Malta',        keys: ['MALTA'] },
    { tr: 'Bulgaristan',  keys: ['BULGARIA', 'BULGARIE', 'BULGARIEN', 'BĂLGARIJA', 'BALGARIJA'] },
    { tr: 'Romanya',      keys: ['ROMANIA', 'ROUMANIE', 'RUMÄNIEN', 'RUMANIEN'] },
    { tr: 'Liechtenstein',keys: ['LIECHTENSTEIN'] }
  ];
  for (const { tr, keys } of map) {
    if (keys.some(k => s.includes(k))) return tr;
  }
  // Eşleşmedi - "/" varsa ilk parçayı al, başharfler küçük olsun
  const firstPart = s.split('/')[0].trim();
  if (!firstPart) return raw;
  return firstPart.charAt(0) + firstPart.slice(1).toLowerCase();
};
admin.initializeApp();

// Belge görselini Firebase Storage'a yükler, CRM'in açacağı indirme adresini döner.
// Önceden görsel base64 olarak müşteri kaydına gömülüyordu: kayıtlar şişiyor, CRM telefonda
// görselleri gösteremiyordu. Yükleme başarısız olursa eski davranış (gömme) — görsel kaybolmasın.
const toStorage = async (b64, name) => {
  try {
    const bucket = admin.storage().bucket();
    const path = `documents/telegram/${name}_${Date.now()}_${genId().slice(0, 8)}.jpg`;
    const token = genId();
    await bucket.file(path).save(Buffer.from(b64, 'base64'), {
      contentType: 'image/jpeg',
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  } catch (e) {
    console.error('Storage yükleme hatası:', e.message);
    return `data:image/jpeg;base64,${b64}`;
  }
};

// ========== VİZEEVRAK (ikinci Firebase projesi: vize-evrak-f472b) ==========
let _vizeEvrakDb = null;
const getVizeEvrakDb = () => {
  if (_vizeEvrakDb) return _vizeEvrakDb;
  try {
    const raw = process.env.VIZE_EVRAK_SA;
    if (!raw) { console.error('[VİZEEVRAK] VIZE_EVRAK_SA secret yok'); return null; }
    const sa = JSON.parse(raw);
    const existing = admin.apps.find(a => a && a.name === 'vizeevrak');
    const app2 = existing || admin.initializeApp({ credential: admin.credential.cert(sa) }, 'vizeevrak');
    _vizeEvrakDb = app2.firestore();
    return _vizeEvrakDb;
  } catch (e) { console.error('[VİZEEVRAK] bağlantı hatası:', e.message); return null; }
};

const VE_SABIT_FORMLAR = [
  { id: "kvkk", ad: "KVKK / GDPR Aydınlatma Formu" },
  { id: "imza_formu", ad: "İmza Formu (VIS Onay Sayfası)" },
  { id: "erisebilirlik", ad: "Erişilebilirlik ve Temsil Formu" },
  { id: "vekaletname", ad: "Yetkilendirme / Vekâletname" },
  { id: "kisisel_bilgiler", ad: "Kişisel Bilgiler Formu" },
];
const VE_COCUK_EK = [
  { id: "cocuk_formlar", ad: "Anne ve baba imzalı başvuru formu, ek form ve vekâlet sayfaları" },
  { id: "muvafakatname", ad: "Her iki ebeveynden noter onaylı muvafakatname" },
  { id: "ogrenci_belgesi", ad: "Barkodlu öğrenci belgesi" },
  { id: "pasaport", ad: "Pasaport aslı" },
  { id: "biyometrik_foto", ad: "2 adet biyometrik fotoğraf (3,5x4,5 cm)" },
  { id: "nufus_kayit_cocuk", ad: "Çocuğa ait tam vukuatlı nüfus kayıt örneği (tüm aile)" },
  { id: "ikametgah_cocuk", ad: "Çocuğa ait yerleşim yeri (ikametgâh) belgesi" },
  { id: "dilekce_cocuk", ad: "Vize talep dilekçesi" },
  { id: "refakatci_evrak", ad: "Sadece çocuk vize alacaksa: refakat edecek velinin pasaport + vize fotokopisi" },
  { id: "velayet_karari", ad: "Boşanmış ailelerde: velayet mahkeme kararı" },
];
const VE_TEMEL = [
  { id: "pasaport_g", ad: "Pasaport (son 10 yıl içinde alınmış, 2 boş sayfa)" },
  { id: "biyometrik_foto_g", ad: "Biyometrik fotoğraf (2 adet, son 6 ay)" },
  { id: "basvuru_formu_g", ad: "Vize başvuru formu (imzalı)" },
  { id: "seyahat_sigortasi_g", ad: "Seyahat sağlık sigortası (min. 30.000 EUR)" },
  { id: "ucak_rezervasyon_g", ad: "Gidiş-dönüş uçak rezervasyonu" },
  { id: "konaklama_g", ad: "Konaklama belgesi / otel rezervasyonu" },
];
const VE_AMAC_EK = {
  turistik: [{ id: "banka_ekstresi_g", ad: "Son 3 aylık banka hesap dökümü" }],
};
const VE_TICARI = {
  sirket_sahibi_ortagi: {
    basvuru_sahibi: [
      { id: "pasaport", ad: "Pasaport aslı + eski pasaport ve işlenmiş sayfaların fotokopisi", not: "Kadınların pasaportunda güncel soy isim zorunlu." },
      { id: "biyometrik_foto", ad: "2 adet biyometrik fotoğraf (son 6 ay, 3,5x4,5 cm, beyaz fon)" },
      { id: "davetiye_fuar", ad: "Ticari davetiye (antetli, kaşeli, imzalı) VEYA fuar giriş bileti/davetiyesi VEYA fuar katılım sözleşmesi", not: "3 seçenekten biri mutlaka olmalı. Davette firmanın HRB faaliyet belgesi de yer almalı." },
      { id: "imza_sirkuleri", ad: "İmza sirküleri fotokopisi" },
      { id: "oda_kaydi", ad: "Oda kaydı faaliyet belgesi (son 3 ay veya güncel)" },
      { id: "vergi_levhasi", ad: "Vergi levhası (güncel) fotokopisi" },
      { id: "ticaret_sicil", ad: "Ticaret sicil gazetesi (hisse payını gösteren) fotokopisi" },
      { id: "sgk_dokumu", ad: "SGK hizmet dökümü (karekodlu/barkodlu, e-Devlet)", not: "14 gün geçerli." },
      { id: "nufus_kayit", ad: "Nüfus kayıt örneği (Nüfus Aile: Evet-Evet, tam vukuatlı)" },
      { id: "nufus_kayit_kizlik", ad: "Evli kadınlarda ayrıca kızlık soyadıyla nüfus kayıt örneği" },
      { id: "ikametgah", ad: "Yerleşim yeri (ikametgâh) belgesi (e-Devlet)" },
      { id: "iletisim", ad: "Güncel adres, telefon, e-posta bilgileri" },
    ],
    acente: [
      { id: "dilekce", ad: "Vize talep dilekçesi (antetli, kaşeli, imzalı)", not: "Görev, seyahat tarihleri, amaç, vize süresi ve masraf karşılama belirtilmeli." },
      { id: "banka_ekstresi", ad: "Şirket + başvuru sahibi banka hesap dökümü (son 4 ay, yüksek bakiye, onaylı)", not: "14 gün geçerli." },
    ],
    paydos_tur: [
      { id: "seyahat_sigortasi", ad: "Schengen seyahat sağlık sigortası" },
      { id: "fuar_bileti_ek", ad: "Fuar barkodlu giriş bileti (davetiye yoksa)", not: "Fuar bileti ekstra ücretlidir." },
      { id: "ucak_rezervasyon", ad: "Uçak rezervasyon çıktısı" },
      { id: "otel_rezervasyon", ad: "Otel rezervasyon çıktısı", not: "Aile katılıyorsa veya davetiye yoksa gerekli." },
    ],
  },
  sigortali_calisan: {
    basvuru_sahibi: [
      { id: "pasaport", ad: "Pasaport aslı + eski pasaport ve işlenmiş sayfaların fotokopisi", not: "Kadınların pasaportunda güncel soy isim zorunlu." },
      { id: "biyometrik_foto", ad: "2 adet biyometrik fotoğraf (son 6 ay, 3,5x4,5 cm, beyaz fon)" },
      { id: "davetiye_fuar", ad: "Ticari davetiye (antetli, kaşeli, imzalı) VEYA fuar katılım sözleşmesi/bileti" },
      { id: "imza_sirkuleri", ad: "İşvereni firmanın imza sirküleri fotokopisi" },
      { id: "oda_kaydi", ad: "İşvereni firmanın oda kaydı faaliyet belgesi (son 3 ay/güncel)" },
      { id: "vergi_levhasi", ad: "İşvereni firmanın vergi levhası fotokopisi" },
      { id: "ticaret_sicil", ad: "İşvereni firmanın ticaret sicil gazetesi fotokopisi" },
      { id: "ssk_giris", ad: "SSK işe giriş bildirgesi (karekodlu/barkodlu, e-Devlet)" },
      { id: "sgk_dokumu", ad: "SGK hizmet dökümü (karekodlu/barkodlu, e-Devlet)", not: "14 gün geçerli." },
      { id: "nufus_kayit", ad: "Nüfus kayıt örneği (Nüfus Aile: Evet-Evet, tam vukuatlı)" },
      { id: "nufus_kayit_kizlik", ad: "Evli kadınlarda ayrıca kızlık soyadıyla nüfus kayıt örneği" },
      { id: "ikametgah", ad: "Yerleşim yeri (ikametgâh) belgesi (e-Devlet)" },
      { id: "iletisim", ad: "Güncel adres, telefon, e-posta bilgileri" },
    ],
    acente: [
      { id: "dilekce", ad: "Vize talep dilekçesi (antetli, kaşeli, imzalı)" },
      { id: "maas_bordrosu", ad: "Son 3 aylık maaş bordrosu (kaşeli, imzalı)", not: "Yeni işe başlandıysa maaş yazısı veya sözleşme aslı+fotokopi." },
      { id: "banka_ekstresi", ad: "Şirket (ticari) veya şahsi (turistik) banka hesap dökümü (son 4 ay)", not: "14 gün geçerli." },
    ],
    paydos_tur: [
      { id: "seyahat_sigortasi", ad: "Schengen seyahat sağlık sigortası" },
      { id: "fuar_bileti_ek", ad: "Fuar barkodlu giriş bileti (davetiye yoksa)" },
      { id: "ucak_rezervasyon", ad: "Uçak rezervasyon çıktısı" },
      { id: "otel_rezervasyon", ad: "Otel rezervasyon çıktısı", not: "Aile katılıyorsa veya davetiye yoksa gerekli." },
    ],
  },
  emekli: {
    basvuru_sahibi: [
      { id: "pasaport", ad: "Pasaport aslı + eski pasaport ve işlenmiş sayfaların fotokopisi", not: "Kadınların pasaportunda güncel soy isim zorunlu." },
      { id: "biyometrik_foto", ad: "2 adet biyometrik fotoğraf (son 6 ay, 3,5x4,5 cm, beyaz fon)" },
      { id: "davetiye_orijinal", ad: "Turistik davetiye (orijinal belge)", not: "Davet edenin telefonu dosyaya not düşülmeli, ayrıca dilekçe eklenmeli." },
      { id: "emeklilik_belgesi", ad: "Emeklilik belgesi (karekodlu/barkodlu, e-Devlet)" },
      { id: "emekli_maas", ad: "Son 4 aylık banka onaylı emekli maaş dökümü" },
      { id: "banka_ekstresi", ad: "Kişisel banka hesap dökümü (son 4 ay, yüksek bakiye, onaylı)", not: "14 gün geçerli." },
      { id: "nufus_kayit", ad: "Nüfus kayıt örneği (Nüfus Aile: Evet-Evet, tam vukuatlı)" },
      { id: "nufus_kayit_kizlik", ad: "Evli kadınlarda ayrıca kızlık soyadıyla nüfus kayıt örneği" },
      { id: "ikametgah", ad: "Yerleşim yeri (ikametgâh) belgesi (e-Devlet)" },
      { id: "iletisim", ad: "Güncel adres, telefon, e-posta bilgileri" },
    ],
    acente: [
      { id: "dilekce", ad: "Konsolosluğa hitaben imzalı dilekçe (seyahat tarihleri ve amacı belirtilmeli)" },
      { id: "banka_ekstresi2", ad: "Banka onaylı hesap dökümü (son 4 ay)", not: "14 gün geçerli." },
    ],
    paydos_tur: [
      { id: "seyahat_sigortasi", ad: "Schengen seyahat sağlık sigortası" },
      { id: "ucak_rezervasyon", ad: "Uçak rezervasyon çıktısı" },
      { id: "otel_rezervasyon", ad: "Otel rezervasyon çıktısı", not: "Davetiye yoksa gerekli." },
    ],
  },
  ev_hanimi_bekar: {
    basvuru_sahibi: [
      { id: "pasaport", ad: "Pasaport aslı + eski pasaport ve işlenmiş sayfaların fotokopisi", not: "Kadınların pasaportunda güncel soy isim zorunlu." },
      { id: "biyometrik_foto", ad: "2 adet biyometrik fotoğraf (son 6 ay, 3,5x4,5 cm, beyaz fon)" },
      { id: "davetiye_orijinal", ad: "Turistik davetiye (orijinal belge)", not: "Davet edenin telefonu dosyaya not düşülmeli." },
      { id: "banka_ekstresi_yakin", ad: "Varsa yakınına ait son 4 aylık yüksek bakiyeli banka dökümü (sponsorluk)" },
      { id: "banka_ekstresi", ad: "Kişisel banka hesap dökümü (son 4 ay, yüksek bakiye, onaylı)", not: "14 gün geçerli." },
      { id: "nufus_kayit", ad: "Nüfus kayıt örneği (Nüfus Aile: Evet-Evet, tam vukuatlı)" },
      { id: "nufus_kayit_kizlik", ad: "Evli kadınlarda ayrıca kızlık soyadıyla nüfus kayıt örneği" },
      { id: "ikametgah", ad: "Yerleşim yeri (ikametgâh) belgesi (e-Devlet)" },
      { id: "iletisim", ad: "Güncel adres, telefon, e-posta bilgileri" },
    ],
    acente: [
      { id: "dilekce", ad: "Konsolosluğa hitaben imzalı dilekçe (seyahat tarihleri ve amacı belirtilmeli)" },
      { id: "banka_ekstresi2", ad: "Banka onaylı hesap dökümü (son 4 ay)", not: "14 gün geçerli." },
    ],
    paydos_tur: [
      { id: "seyahat_sigortasi", ad: "Schengen seyahat sağlık sigortası" },
      { id: "ucak_rezervasyon", ad: "Uçak rezervasyon çıktısı" },
      { id: "otel_rezervasyon", ad: "Otel rezervasyon çıktısı", not: "Davetiye yoksa gerekli." },
    ],
  },
};
const veEvrakGruplariGetir = (amacId, tipId, resitDegil = false) => {
  if (amacId === "ticari" && VE_TICARI[tipId]) {
    const k = VE_TICARI[tipId];
    const gruplar = [
      { kaynak: "basvuru_sahibi", evraklar: k.basvuru_sahibi },
      { kaynak: "acente", evraklar: [...VE_SABIT_FORMLAR, ...k.acente] },
      { kaynak: "paydos_tur", evraklar: k.paydos_tur },
    ];
    if (resitDegil) gruplar.push({ kaynak: "cocuk_ek", evraklar: VE_COCUK_EK });
    return gruplar;
  }
  const ekAmac = VE_AMAC_EK[amacId] || [];
  return [{ kaynak: "genel", evraklar: [...VE_TEMEL, ...ekAmac] }];
};
const VE_AMACLAR = { ticari: "Ticari / İş / Fuar", turistik: "Turistik" };
const VE_TIPLER = {
  sirket_sahibi_ortagi: "Şirket Sahibi / Ortağı / Şahsi İş Yeri Sahibi",
  sigortali_calisan: "Sigortalı Çalışan",
  emekli: "Emekli",
  ev_hanimi_bekar: "Ev Hanımı / Bekar (Çalışmayan)",
};
const vizeEvrakBasvuruOlustur = async ({ amacId, tipId, adSoyad, telefon, email, tcNo, not, resitDegil }) => {
  const vdb = getVizeEvrakDb();
  if (!vdb) throw new Error('vizeevrak baglantisi yok (secret eksik olabilir)');
  const id = genId();
  const gruplar = veEvrakGruplariGetir(amacId, tipId, !!resitDegil);
  const evrakListesi = gruplar.flatMap(grup =>
    grup.evraklar.map(e => ({ ...e, kaynak: grup.kaynak, durum: "bekliyor", dosyaUrl: null, vizeciNotu: "" }))
  );
  const { FieldValue } = require('firebase-admin/firestore');
  await vdb.collection('basvurular').doc(id).set({
    id,
    amac: { id: amacId, ad: VE_AMACLAR[amacId] || amacId },
    tip: { id: tipId, ad: VE_TIPLER[tipId] || tipId },
    parmakIzi: "bilinmiyor",
    bilgiler: { adSoyad: adSoyad || "", telefon: telefon || "", email: email || "", tcNo: tcNo || "", not: not || "", resitDegil: !!resitDegil },
    evrakListesi,
    olusturulmaTarihi: FieldValue.serverTimestamp(),
    durum: "aktif",
    kaynak: "Telegram Bot",
  });
  return id;
};

// ========== CONFIG ==========
const getConfig = async () => {
  let db;
  try { 
    const { getFirestore } = require('firebase-admin/firestore');
    db = getFirestore('paydos'); 
    console.log('DB: paydos named database');
  } catch(e) { 
    db = admin.firestore(); 
    console.log('DB: default database, error:', e.message);
  }
  try {
    const doc = await db.collection('app_settings').doc('main').get();
    if (doc.exists) {
      const d = doc.data();
      console.log('Config loaded: TOKEN=' + (d.telegramBotToken ? 'YES' : 'NO') + ' KEY=' + (d.aiApiKey ? 'YES' : 'NO'));
      return { KEY: d.aiApiKey || '', TOKEN: d.telegramBotToken || '', db };
    }
    console.log('Config: app_settings/main NOT FOUND');
  } catch(e) {}
  return { KEY: '', TOKEN: '', db };
};

// ========== HELPERS ==========
const tg = async (token, method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return r.json();
};

const dlPhoto = async (token, fid) => {
  const f = await tg(token, 'getFile', { file_id: fid });
  if (!f.ok) return null;
  const r = await fetch(`https://api.telegram.org/file/bot${token}/${f.result.file_path}`);
  return (await r.buffer()).toString('base64');
};

const toAscii = s => s ? s.replace(/ğ/g,'g').replace(/Ğ/g,'G').replace(/ü/g,'u').replace(/Ü/g,'U').replace(/ş/g,'s').replace(/Ş/g,'S').replace(/ı/g,'i').replace(/İ/g,'I').replace(/ö/g,'o').replace(/Ö/g,'O').replace(/ç/g,'c').replace(/Ç/g,'C') : '';

// MRZ formatından gerçek isme dön (UE→Ü, OE→Ö, AE→Ä, SS→ß)
// AI bazen MRZ'den "GUEL" gibi okur, asıl isim "GÜL" - bunu düzeltir
const fromMrz = (s) => {
  if (!s) return '';
  return s
    .replace(/UE/g, 'Ü').replace(/Ue/g, 'Ü').replace(/ue/g, 'ü')
    .replace(/OE/g, 'Ö').replace(/Oe/g, 'Ö').replace(/oe/g, 'ö')
    .replace(/AE/g, 'Ä').replace(/Ae/g, 'Ä').replace(/ae/g, 'ä')
    .replace(/SS/g, 'ß');
};

// MRZ ülke kodu sızması temizleyici
// MRZ formatı: P<TUR<SOYAD<<AD  →  bot bazen "TUR" ülke kodunu soyada ekler
// Örnek: gerçek soyad "OKCU" iken bot "TUROKCU" / "TÜROKÇU" okur
// Türk pasaportlarında ülke kodu TUR'dur. Soyad "TUR" ile başlayıp devamı
// 4+ harfse ülke kodu sızıntısıdır. TURGUT/TURAN/TURHAN gibi (devamı <4) korunur.
const stripCountryCode = (lastName, nationality) => {
  if (!lastName) return lastName;
  const isTr = !nationality || /tur|tr|türkiye|turkey/i.test(nationality);
  if (!isTr) return lastName;
  const ln = lastName.trim();
  const m = ln.match(/^T[UÜ]R(.+)$/i);
  if (m && m[1].length >= 4) {
    console.log(`[BOT] TUR ulke kodu temizlendi: "${ln}" -> "${m[1]}"`);
    return m[1];
  }
  return ln;
};

// Pasaporttaki yazılardan gelen geçersiz isim/soyad kelimelerini temizle
// Örn: "İMZA ATAMAZ", "UNABLE TO SIGN" (çocuk pasaportlarında imza alanı),
// "HOLDER SIGNATURE", "HAMILININ IMZASI" vb.
const INVALID_NAME_WORDS = [
  'ATAMAZ', 'IMZA', 'İMZA', 'IMZASI', 'İMZASI', 'UNABLE', 'SIGN', 'SIGNATURE',
  'HOLDER', 'HAMILININ', 'HAMILIN', 'REPUBLIC', 'TURKEY', 'CUMHURIYETI',
  'PASAPORT', 'PASSPORT', 'SURNAME', 'SOYADI', 'NAME', 'ADI', 'TYPE', 'TÜRÜ'
];
const cleanInvalidName = (name) => {
  if (!name) return name;
  const words = name.trim().split(/\s+/);
  const filtered = words.filter(w => {
    const u = toAscii(w).toUpperCase();
    return !INVALID_NAME_WORDS.some(bad => toAscii(bad).toUpperCase() === u);
  });
  const result = filtered.join(' ').trim();
  if (result !== name.trim()) {
    console.log(`[BOT] Gecersiz kelime temizlendi: "${name}" -> "${result}"`);
  }
  return result;
};

// İki ismin MRZ-uyumlu eşleşmesini kontrol et
// "GUEL" araması hem "GÜL" hem "GUL" ile eşleşmeli
const fuzzyNameMatch = (botName, customerName) => {
  if (!botName || !customerName) return false;
  // Tam ascii eşleşme (Türkçe karakterleri normalize ederek)
  const botAscii = toAscii(botName).toUpperCase();
  const custAscii = toAscii(customerName).toUpperCase();
  if (botAscii === custAscii) return true;
  // MRZ formatından gerçek isme çevir, sonra ascii karşılaştır
  const botFromMrz = toAscii(fromMrz(botName)).toUpperCase();
  if (botFromMrz === custAscii) return true;
  // Bazı kelimeler MRZ artığı diğerleri değil — kelime kelime karşılaştır
  const botWords = botAscii.split(/\s+/).filter(Boolean).sort();
  const custWords = custAscii.split(/\s+/).filter(Boolean).sort();
  if (botWords.length !== custWords.length) return false;
  return botWords.every((bw, i) => {
    const cw = custWords[i];
    if (bw === cw) return true;
    // GUEL → GUL (UE → U fallback)
    const bwSimple = bw.replace(/UE/g,'U').replace(/OE/g,'O').replace(/AE/g,'A');
    return bwSimple === cw;
  });
};

const namesMatch = (a, b) => {
  if (!a || !b) return false;
  return fuzzyNameMatch(a, b);
};

const detectPT = no => {
  if (!no) return 'Bordo Pasaport (Umuma Mahsus)';
  const f = no.trim()[0]?.toUpperCase();
  if (f === 'S') return 'Yesil Pasaport (Hususi)';
  if (f === 'G') return 'Gri Pasaport (Hizmet)';
  if (f === 'D') return 'Siyah Pasaport (Diplomatik)';
  return 'Bordo Pasaport (Umuma Mahsus)';
};

// ========== TARİH KONTROL ==========

const validateDates = (json, dtype) => {
  // Tüm tarih kısıtlamaları kaldırıldı — her belge kaydedilir
  return [];
};

// ========== AI ==========
let lastAiError = '';
const ai = async (key, msgs, max = 1000) => {
  lastAiError = '';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: max, messages: msgs })
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('AI API error:', r.status, err.slice(0, 200));
      let reason = 'API ' + r.status;
      try { const j = JSON.parse(err); if (j.error && j.error.message) reason += ': ' + j.error.message; } catch (e) {}
      if (r.status === 400 && /credit|balance/i.test(err)) reason = 'API kredisi bitmiş (400) — Anthropic bakiyesi yükleyin';
      else if (r.status === 401) reason = 'API anahtarı geçersiz (401) — anahtarı kontrol edin';
      else if (r.status === 404) reason = 'Model bulunamadı (404) — model adı güncel değil';
      else if (r.status === 429) reason = 'Rate limit (429) — biraz bekleyip tekrar deneyin';
      lastAiError = reason;
      return null;
    }
    const data = await r.json();
    const text = data.content?.[0]?.text || '';
    console.log('AI response:', text.slice(0, 100));
    return text;
  } catch(e) { console.error('AI fetch error:', e.message); lastAiError = 'Bağlantı hatası: ' + e.message; return null; }
};

const detectType = async (key, b64) => {
  // Detect adımını atla — direkt okumayı dene, JSON'dan tür anla
  const t = await ai(key, [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
    { type: 'text', text: `Sen bir seyahat acentesi CRM asistanisin. Bu gorselden bilgileri JSON olarak cikar. Sadece JSON yaz, baska hicbir sey yazma.

==================== EN ONEMLI KURAL ====================
MRZ SATIRINI KULLANMA. ASLA.
MRZ satiri = altta sik sik "<" karakteri geçen satirlar:
  P<TURCOBAN<<GUEL<<<<<<<<<<<<<<<<<<<<<<<<
  CD<<COBAN<<GUEL<<<<<<<<<<<<<<<<<<<<<<<<
  732310639TUR8801096F...
Bu satirlardan isim, soyad, pasaport no, tarih VS HICBIR SEY okuma.

GERCEK ISIMI BURDAN OKU:
- Schengen vize sticker'inda ORTADA, fotografin yaninda "SOYAD, AD" yazar (ornek: "COBAN, GÜL")
- Pasaportta ust kisimda "SOYADI / SURNAME" ve "ADI / NAME" satirlari vardir. SADECE BU IKI ALANI OKU.
- Bu alanlarda Turkçe karakter (Ü, Ö, Ç, Ş, Ğ, İ) AYNEN GORUNUR
- MRZ'de "GUEL" yazsa bile, gercekte gozle "GÜL" yazıyorsa, "GÜL" yaz
- MRZ'de "OEZ" yazsa bile, gercekte gozle "ÖZ" yazıyorsa, "ÖZ" yaz
- Eger gozle goremiyorsan bos birak, MRZ'ye düşme

!!! PASAPORT ICIN KRITIK UYARI !!!
- MRZ satiri "P<TUROKCU<<GOKCE" gibi gorunur. Burada "TUR" ULKE KODUDUR, soyadin parcasi DEGILDIR.
- Soyad "OKCU" dur, "TUROKCU" DEGIL. Asla ulke kodunu (TUR) soyada ekleme.
- Pasaport numarasi SAG USTTE "PASAPORT NO. / PASSPORT NO." yaninda yazar (ornek: U26243131). MRZ'deki numarayi DEGIL, bu ust sagdaki numarayi al.
- SOYADI alanini "SOYADI / SURNAME" yazisinin ALTINDAN, ADI alanini "ADI / NAME" yazisinin ALTINDAN oku.
- !!! IKI ON AD DURUMU !!! "ADI / NAME" alaninda BIRDEN FAZLA kelime olabilir (ornek: "SEDA GUCLU"). Bu kisinin IKI ON ADI demektir. HEPSI firstName'dir. Ornek: SOYADI=AGAC, ADI=SEDA GUCLU -> lastName="AĞAÇ", firstName="SEDA GÜÇLÜ". ADI alanindaki ikinci kelimeyi ASLA soyad yapma. Soyad SADECE "SOYADI / SURNAME" satirindaki kelimedir.
- Ozet: lastName HER ZAMAN "SOYADI / SURNAME" satirindan, firstName HER ZAMAN "ADI / NAME" satirindan (kac kelime olursa olsun hepsi) alinir.
- "IMZA ATAMAZ", "UNABLE TO SIGN", "HAMILININ IMZASI", "HOLDER'S SIGNATURE" yazilari IMZA ALANIDIR. Bunlar isim/soyad DEGILDIR, OKUMA. Cocuk pasaportlarinda imza yerine bu yazar.
- Eger SOYADI alanini net goremiyorsan bos birak, baska bir yazidan (imza, MRZ) ALMA.

Schengen vizede isim virgulle ayrilir: "COBAN, GÜL" -> lastName="COBAN", firstName="GÜL"
==========================================================

JSON formatlar:

Pasaport:
{"type":"passport","firstName":"","lastName":"","birthDate":"YYYY-MM-DD","birthPlace":"","nationality":"","passportNo":"","issueDate":"YYYY-MM-DD","expiryDate":"YYYY-MM-DD","gender":"","tcKimlik":""}

Schengen vize:
{"type":"schengen","firstName":"","lastName":"","passportNo":"","country":"","visaNumber":"","entryType":"","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","stayDuration":""}

ABD vize:
{"type":"usa","firstName":"","lastName":"","passportNo":"","issueDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}

==================== SCHENGEN VIZE ALANLARI ====================
- VIZE NUMARASI (visaNumber): Sag ust kosede VEYA dikey olarak solda kirmizi, 9 hane, "0" ile baslar (orn: 073232513).
  !!! DOGRULAMA: MRZ alt satirinin BASINDAKI ilk 9 rakam = vize numarasidir (orn MRZ "0732325130TUR..." -> vize no "073232513"). Gorselden okudugun numarayi bu 9 rakamla KARSILASTIR; farkliysa MRZ'deki 9 rakami kullan. (SADECE vize NUMARASI icin MRZ rakamlarina bakabilirsin; ISIM/SOYAD icin MRZ'ye ASLA bakma.)
- PASAPORT NO (passportNo): Sticker uzerinde "PASSPORT NO" / "Nr. de passeport" yaninda, harf+7-8 rakam (orn: U22793292)
  -> visaNumber ile KARISTIRMA, FARKLI alanlardir
- ULKE (country): Ust basligindaki ülke (orn: "DEUTSCHLAND/GERMANY/ALLEMAGNE")
- !!! TARIHLER (startDate / endDate) — EN COK HATA BURADA, DIKKAT !!!
  "SCHENGEN-STAATEN" / "ETATS SCHENGEN" yazisinin ALTINDA YAN YANA IKI TARIH vardir.
  SOLDAKI = startDate (baslangic), SAGDAKI = endDate (bitis). Ornek: "25-06-26   24-06-27" -> startDate=2026-06-25, endDate=2027-06-24.
  Bu iki tarihin arasinda/altinda genelde vize tipi (C/D), pasaport no ve "MULT" bulunur.
  !!! DOGUM TARIHINI ASLA startDate YAPMA. Vizede tek basina duran, dusuk yilli (orn 2003, 2008, 1989) bir tarih DOGUM tarihidir; vize tarihi DEGILDIR, onu KULLANMA.
  !!! startDate HER ZAMAN endDate'ten ONCEdir; ikisi genelde ayni yil veya 1 yil farklidir. Tek basina duran "duzenleme tarihi" (orn 04-06-26) de startDate DEGILDIR.
- KALIS SURESI (stayDuration): "DURATION OF STAY" / "DAUER" / "AUFENTHALT" yaninda sayi (orn: 90)
- GIRIS TIPI (entryType): "NUMBER OF ENTRIES" / "ANZAHL DER EINREISEN" yaninda (MULT / 1 / 2)
- !!! ISIM — SEHIR ADINI ISIM SANMA !!!
  Vizede fotografin yaninda "IZMIR", "ANKARA", "ISTANBUL", "BERLIN" gibi bir SEHIR adi gorebilirsin. Bu, vizeyi DUZENLEYEN yer/konsoloslektur (Ausstellungsort), ISIM DEGILDIR.
  Gercek isim HER ZAMAN "SOYAD, AD" formatinda VIRGULLUDUR (orn: "BAGCI, BÜSRA" -> lastName=BAĞCI, firstName=BÜŞRA). Virgullu isim satirini bul; virgulsuz tek kelime sehir adini ISIM olarak ALMA.

==================== TARIH FORMATI ====================
GG-AA-YY veya GG.AA.YY (orn: 22-06-26):
- YY 00-30 -> 20YY (26 -> 2026)
- YY 31-99 -> 19YY (95 -> 1995)
GG-AA-YYYY -> direkt kullan

==================== SANITY ====================
1. startDate ve endDate AYNI GUN OLAMAZ
2. Tarihler 2020 oncesi veya 2035 sonrasi sapkin demektir, tekrar bak
3. visaNumber ile passportNo aynı OLAMAZ
4. ISIM ALANLARINI MRZ'DEN OKUMA — gercekte gozle goremiyorsan bos birak
5. firstName veya lastName bir SEHIR adi (IZMIR, ANKARA, ISTANBUL, BERLIN...) ISE YANLISTIR — virgullu "SOYAD, AD" satirini tekrar bul
6. startDate, endDate'ten ONCE olmali. Degilse tarihleri karistirmissin, tekrar bak
7. startDate bir DOGUM tarihi gibi cok eski (orn 1989, 2003) ise YANLISTIR — vize baslangici "SCHENGEN-STAATEN" altindaki SOLDAKI tarihtir` }
  ]}], 500);
  if (!t) return { dtype: null, json: null };
  const m = t.replace(/```json|```/g, '').trim().match(/\{.*\}/s);
  if (!m) return { dtype: null, json: null };
  try {
    const json = JSON.parse(m[0]);
    const dtype = json.type === 'passport' ? 'passport' : json.type === 'schengen' ? 'schengen' : json.type === 'usa' ? 'usa' : (json.passportNo ? 'passport' : json.visaNumber ? 'schengen' : json.endDate ? 'usa' : null);
    console.log('Detected:', dtype, 'Name:', json.firstName, json.lastName);
    return { dtype, json };
  } catch(e) { console.error('JSON parse error:', e.message); return { dtype: null, json: null }; }
};


// Otomatik pasaport kırpma
const autoCrop = async (key, b64) => {
  const t = await ai(key, [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
    { type: 'text', text: 'Pasaport sayfasinin sinirlarini % ver. JSON: {"x":0,"y":0,"w":100,"h":100}' }
  ]}], 200);
  if (!t) return null;
  const m = t.replace(/```json|```/g, '').trim().match(/\{.*\}/s);
  if (!m) return null;
  try { const c = JSON.parse(m[0]); return (c.w > 30 && c.h > 30) ? c : null; } catch { return null; }
};

// Görseli Firestore'a yazmadan önce küçült — büyük base64 bellek taşmasına (OOM) yol açıyor
const shrinkImg = async (b64) => {
  try {
    const sharp = require('sharp');
    const buf = Buffer.from(b64, 'base64');
    const out = await sharp(buf)
      .rotate()
      .resize({ width: 1100, height: 1100, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70, mozjpeg: true })
      .toBuffer();
    const küçük = out.toString('base64');
    console.log(`[BOT] görsel küçültüldü: ${Math.round(b64.length/1024)}KB → ${Math.round(küçük.length/1024)}KB`);
    return küçük;
  } catch (e) { console.error('[BOT] görsel küçültülemedi:', e.message); return b64; }
};

const cropImg = async (b64, crop) => {
  try {
    const sharp = require('sharp');
    const buf = Buffer.from(b64, 'base64');
    const meta = await sharp(buf).metadata();
    const left = Math.max(0, Math.round(meta.width * crop.x / 100));
    const top = Math.max(0, Math.round(meta.height * crop.y / 100));
    const width = Math.min(meta.width - left, Math.round(meta.width * crop.w / 100));
    const height = Math.min(meta.height - top, Math.round(meta.height * crop.h / 100));
    if (width < 100 || height < 100) return b64;
    return (await sharp(buf).extract({ left, top, width, height })
      .resize({ width: 1200, height: Math.round(1200 * 88 / 125), fit: 'inside' })
      .jpeg({ quality: 75 }).toBuffer()).toString('base64');
  } catch { return b64; }
};

// ========== FIRESTORE SAVE ==========

// Pasaport bitişine 1 yıldan az kaldıysa / dolmuşsa uyarı metni
const passportExpiryWarn = (expiryDate) => {
  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return '';
  const exp = new Date(expiryDate + 'T00:00:00');
  if (isNaN(exp.getTime())) return '';
  const now = new Date(); now.setHours(0,0,0,0);
  const sixMonths = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());
  const oneYear = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  const days = Math.ceil((exp - now) / 86400000);
  if (exp < now) return `\n\n🔴 *DİKKAT: PASAPORT SÜRESİ DOLMUŞ!*\n📅 ${expiryDate}`;
  if (exp <= sixMonths) return `\n\n🔴 *UYARI: Pasaport bitişine 6 aydan az kaldı!*\n📅 ${expiryDate} (${days} gün) — Schengen için yetersiz, yenilenmeli.`;
  if (exp <= oneYear) return `\n\n⚠️ *UYARI: Pasaport bitişine 1 yıldan az kaldı!*\n📅 ${expiryDate} (${days} gün) — Vize başvurusu öncesi yenilenmesi önerilir.`;
  return '';
};

// Doğum yeri: pasaporttaki "DENIZLI" gibi büyük harfli ASCII yazımı 81 il listesiyle eşleştirip doğru yazar
// (CRM'deki placeTr ile aynı mantık). İl değilse (ilçe/yurt dışı) Türkçe başlık biçimine çevrilir.
const TR_ILLER = ['Adana','Adıyaman','Afyonkarahisar','Ağrı','Amasya','Ankara','Antalya','Artvin','Aydın','Balıkesir','Bilecik','Bingöl','Bitlis','Bolu','Burdur','Bursa','Çanakkale','Çankırı','Çorum','Denizli','Diyarbakır','Edirne','Elazığ','Erzincan','Erzurum','Eskişehir','Gaziantep','Giresun','Gümüşhane','Hakkari','Hatay','Isparta','Mersin','İstanbul','İzmir','Kars','Kastamonu','Kayseri','Kırklareli','Kırşehir','Kocaeli','Konya','Kütahya','Malatya','Manisa','Kahramanmaraş','Mardin','Muğla','Muş','Nevşehir','Niğde','Ordu','Rize','Sakarya','Samsun','Siirt','Sinop','Sivas','Tekirdağ','Tokat','Trabzon','Tunceli','Şanlıurfa','Uşak','Van','Yozgat','Zonguldak','Aksaray','Bayburt','Karaman','Kırıkkale','Batman','Şırnak','Bartın','Ardahan','Iğdır','Yalova','Karabük','Kilis','Osmaniye','Düzce'];
const PLACE_ALIAS = { afyon: 'Afyonkarahisar', maras: 'Kahramanmaraş', 'k.maras': 'Kahramanmaraş', urfa: 'Şanlıurfa', antep: 'Gaziantep', icel: 'Mersin', izmit: 'Kocaeli', adapazari: 'Sakarya', antakya: 'Hatay' };
const normTr = (x) => String(x || '').replace(/[İIı]/g, 'i').replace(/[Ğğ]/g, 'g').replace(/[Üü]/g, 'u').replace(/[Şş]/g, 's').replace(/[Öö]/g, 'o').replace(/[Çç]/g, 'c').toLowerCase().trim();
const placeTr = (x) => {
  if (!x) return '';
  const n = normTr(x);
  return TR_ILLER.find(p => normTr(p) === n) || PLACE_ALIAS[n] || titleCaseTr(String(x).trim());
};

const savePassport = async (db, custs, json, img) => {
  if (json.birthPlace) json.birthPlace = placeTr(json.birthPlace);
  const bpLine = json.birthPlace ? `\n📍 Doğum yeri: ${json.birthPlace}` : '';
  const ref = db.collection('customers');

  // İsim temizleme: "İMZA ATAMAZ" gibi geçersiz kelimeler + "TUR" ülke kodu
  if (json.firstName) json.firstName = cleanInvalidName(json.firstName);
  if (json.lastName) {
    json.lastName = cleanInvalidName(json.lastName);
    json.lastName = stripCountryCode(json.lastName, json.nationality);
  }

  const fn = titleCaseTr((json.firstName || '').trim()), ln = titleCaseTr((json.lastName || '').trim());

  // Müşteri bul: TC → pasaport no (isimle eşleştirme YOK — TC farklıysa farklı kişi)
  let cust = null;
  if (json.tcKimlik) cust = custs.find(c => c.tcKimlik === json.tcKimlik);
  if (!cust && json.passportNo) {
    cust = custs.find(c => {
      let p = []; try { p = JSON.parse(c.passports || '[]'); } catch {}
      return p.some(x => x.passportNo === json.passportNo);
    });
  }

  // Pasaport No tekrar kontrol
  if (json.passportNo) {
    const dup = custs.find(c => {
      if (cust && c.id === cust.id) return false;
      let p = []; try { p = JSON.parse(c.passports || '[]'); } catch {}
      return p.some(x => x.passportNo === json.passportNo);
    });
    if (dup) return { text: `⛔ Pasaport No "${json.passportNo}" zaten "${dup.firstName} ${dup.lastName}" kayıtlı!`, custId: null };
  }

  const pp = {
    id: genId(), nationality: json.nationality || 'Turkiye',
    passportType: detectPT(json.passportNo), passportNo: json.passportNo || '',
    issueDate: json.issueDate || '', expiryDate: json.expiryDate || '',
    image: await toStorage(img, 'pasaport'),
    createdAt: new Date().toISOString()
  };

  if (cust) {
    let ps = []; try { ps = JSON.parse(cust.passports || '[]'); } catch {}
    const i = ps.findIndex(p => p.passportNo && p.passportNo === json.passportNo);
    if (i >= 0) ps[i] = { ...ps[i], ...pp, id: ps[i].id }; else ps.unshift(pp);
    const custDocId2 = cust.id || cust._docId;
    if (!custDocId2) return { text: `⚠️ Müşteri ID bulunamadı`, custId: null };
    await ref.doc(custDocId2).set({
      birthDate: json.birthDate || cust.birthDate || '',
      birthPlace: json.birthPlace || cust.birthPlace || '',
      tcKimlik: json.tcKimlik || cust.tcKimlik || '',
      gender: json.gender || cust.gender || '',
      passports: JSON.stringify(ps),
      verified: false
    }, { merge: true });
    return { text: `✅ *Güncellendi*\n👤 ${cust.firstName} ${cust.lastName}\n📘 ${json.passportNo}${bpLine}${passportExpiryWarn(json.expiryDate)}`, custId: custDocId2, custName: `${cust.firstName} ${cust.lastName}`, custPhone: cust.phone || '', custEmail: cust.email || '' };
  } else {
    const id = genId();
    await ref.doc(String(id)).set({
      id, firstName: fn, lastName: ln,
      birthDate: json.birthDate || '', birthPlace: json.birthPlace || '',
      tcKimlik: json.tcKimlik || '', gender: json.gender || '',
      phone: '', email: '', city: '', sector: '', companyName: '', notes: '',
      tkMemberNo: '', tags: '[]', activities: '[]',
      passports: JSON.stringify([pp]), schengenVisas: '[]', usaVisa: '{}',
      verified: false, createdBy: 'Telegram Bot',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    return { text: `✅ *Yeni müşteri*\n👤 ${fn} ${ln}\n📘 ${json.passportNo}${bpLine}${passportExpiryWarn(json.expiryDate)}`, custId: String(id), custName: `${fn} ${ln}`, custPhone: '', custEmail: '' };
  }
};

// Vize görseli gelince müşterinin açık vize başvurusunu "Onay" durumuna geçirir.
// Açık = onay/red/iptal olmayan. Aynı türde (schengen/usa) birden fazla açık başvuru varsa önce ülkesi
// tutan, sonra en yeni olan seçilir. Onay durumu CRM Ayarlar → Vize Başvuru Durumları'ndan okunur.
// Başvuru bulunamazsa hiçbir şey değiştirmez; sonuç Telegram cevabına tek satır olarak eklenir.
const approveVisaApp = async (db, custDocId, categoryId, country) => {
  try {
    const trl = (x) => String(x || '').toLocaleLowerCase('tr-TR');
    const statuses = await getVisaStatuses(db);
    const target = statuses.find(st => /onay/.test(trl(st)));
    if (!target) return '';
    // CRM müşteri id'si sayı olarak da saklanmış olabilir
    const ids = [String(custDocId)];
    if (/^\d+$/.test(String(custDocId))) ids.push(Number(custDocId));
    const snap = await db.collection('visa_applications').where('customerId', 'in', ids).get();
    const open = snap.docs
      .map(d => ({ ref: d.ref, ...d.data() }))
      .filter(v => (v.categoryId || v.category || 'schengen') === categoryId)
      .filter(v => !/onay|red|iptal/.test(trl(v.status)));
    if (!open.length) return '\nℹ️ Açık vize başvurusu bulunamadı — durum değiştirilmedi.';
    // Ülke biliniyorsa sadece ülkesi tutan (ya da ülkesi boş) başvuru onaylanır — başka ülkenin
    // başvurusunu yanlışlıkla onaylamamak için
    const want = trl(country);
    const cands = want ? open.filter(v => !v.country || trl(v.country) === want) : open;
    if (!cands.length) return `\nℹ️ ${country} için açık başvuru yok (açık: ${open.map(v => v.country || '?').join(', ')}) — durum değiştirilmedi.`;
    cands.sort((a, b) => {
      const ca = want && trl(a.country) === want ? 1 : 0, cb = want && trl(b.country) === want ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    const v = cands[0];
    await v.ref.set({ status: target, approvedAt: new Date().toISOString(), approvedBy: 'Telegram Bot', updatedAt: new Date().toISOString() }, { merge: true });
    return `\n🎉 Vize başvurusu *${target}* durumuna alındı${v.country ? ` (${v.country})` : ''}`;
  } catch (e) {
    console.error('[BOT] Vize başvurusu onaylanamadı:', e.message);
    return '\n⚠️ Vize başvurusu durumu güncellenemedi — CRM\'den elle güncelleyin.';
  }
};

const saveSchengen = async (db, custs, json, img) => {
  const ref = db.collection('customers');

  // Ülke adını Türkçeye çevir
  json.country = normalizeCountry(json.country);

  // İsim temizleme: geçersiz kelimeler + "TUR" ülke kodu
  if (json.firstName) json.firstName = cleanInvalidName(json.firstName);
  if (json.lastName) {
    json.lastName = cleanInvalidName(json.lastName);
    json.lastName = stripCountryCode(json.lastName, 'TUR');
  }

  // İsim MRZ formatından gelmişse Türkçeye çevir (GUEL → GÜL, OEZ → ÖZ)
  // Ama riskli — gerçekten "UE" içeren isim olabilir. Sadece tam kelimeler için.
  // Önce müşteri eşleşmesi denenecek, bulamazsa orijinal halini koru.
  const rawFirst = json.firstName || '';
  const rawLast = json.lastName || '';

  // ===== Sanity check - AI hatalarını yakala =====
  const warnings = [];
  if (json.visaNumber && json.passportNo && json.visaNumber === json.passportNo) {
    warnings.push('⚠️ Vize No ve Pasaport No aynı okundu (AI karıştırmış olabilir)');
  }
  if (json.startDate && json.endDate && json.startDate === json.endDate) {
    warnings.push(`⚠️ Giriş ve çıkış tarihi aynı: ${json.startDate}`);
  }
  const checkYear = (d, label) => {
    if (!d) return;
    const y = parseInt(d.substring(0, 4));
    if (y < 2020 || y > 2035) warnings.push(`⚠️ ${label} yıl şüpheli: ${d}`);
  };
  checkYear(json.startDate, 'Giriş');
  checkYear(json.endDate, 'Çıkış');
  if (json.startDate && json.endDate && new Date(json.endDate) < new Date(json.startDate)) {
    warnings.push(`⚠️ Çıkış tarihi girişten önce: ${json.startDate} → ${json.endDate}`);
  }

  // Önce pasaport no ile bul, sonra isim
  let cust = null;
  if (json.passportNo) {
    cust = custs.find(c => {
      let p = []; try { p = JSON.parse(c.passports || '[]'); } catch {}
      return p.some(x => x.passportNo === json.passportNo);
    });
  }
  if (!cust) {
    const matches = custs.filter(c => namesMatch(`${json.firstName} ${json.lastName}`, `${c.firstName || ''} ${c.lastName || ''}`));
    if (matches.length === 1) cust = matches[0];
    else if (matches.length > 1) {
      const list = matches.map(m => `• ${m.firstName} ${m.lastName} (TC: ${m.tcKimlik || 'YOK'})`).join('\n');
      return `⚠️ "${json.firstName} ${json.lastName}" adında ${matches.length} müşteri var:\n${list}\n\nTC ile ayırt edilemiyor — önce pasaportu yükleyin.`;
    }
  }
  if (!cust) return `⚠️ "${json.firstName} ${json.lastName}" bulunamadı!\nÖnce pasaportu yükleyin.`;

  // Vize No tekrar kontrol
  if (json.visaNumber) {
    const dup = custs.find(c => {
      if (c.id === cust.id) return false;
      let v = []; try { v = JSON.parse(c.schengenVisas || '[]'); } catch {}
      return v.some(x => x.visaNumber === json.visaNumber);
    });
    if (dup) return `⛔ Vize No "${json.visaNumber}" zaten "${dup.firstName} ${dup.lastName}" kayıtlı!`;
  }

  let vs = []; try { vs = JSON.parse(cust.schengenVisas || '[]'); } catch {}
  // Vize kaydında isim olarak müşterinin kayıtlı (Türkçe) ismini kullan
  // AI MRZ'den "GUEL" okuduysa, müşteride "GÜL" yazıyor — Türkçesini koru
  const vd = {
    id: genId(), visaFirstName: cust.firstName || json.firstName || '', visaLastName: cust.lastName || json.lastName || '',
    country: json.country || '', visaNumber: json.visaNumber || '',
    entryType: json.entryType || '', startDate: json.startDate || '', endDate: json.endDate || '',
    stayDuration: json.stayDuration || '', image: await toStorage(img, 'schengen'),
    createdAt: new Date().toISOString()
  };
  const i = json.visaNumber ? vs.findIndex(v => v.visaNumber === json.visaNumber) : -1;
  if (i >= 0) vs[i] = { ...vs[i], ...vd, id: vs[i].id }; else vs.unshift(vd);
  const custDocId = cust.id || cust._docId;
  if (!custDocId) { console.error('Müşteri ID boş:', cust.firstName, cust.lastName); return `⚠️ Müşteri ID bulunamadı: ${cust.firstName} ${cust.lastName}`; }
  await ref.doc(custDocId).set({ schengenVisas: JSON.stringify(vs), verified: false }, { merge: true });
  let response = `✅ *Schengen vizesi eklendi*\n👤 ${cust.firstName} ${cust.lastName}\n🌍 ${json.country || '-'} | 🔢 ${json.visaNumber || '-'}\n📅 ${json.startDate || '?'} → ${json.endDate || '?'}`;
  if (json.entryType) response += `\n🚪 ${json.entryType} ${json.stayDuration ? `(${json.stayDuration} gün)` : ''}`;
  response += await approveVisaApp(db, custDocId, 'schengen', json.country);
  if (warnings.length > 0) response += `\n\n${warnings.join('\n')}\n\n👉 Vize bilgilerini CRM'den kontrol edin.`;
  return response;
};

const saveUsa = async (db, custs, json, img) => {
  const ref = db.collection('customers');
  let cust = null;
  if (json.passportNo) {
    cust = custs.find(c => {
      let p = []; try { p = JSON.parse(c.passports || '[]'); } catch {}
      return p.some(x => x.passportNo === json.passportNo);
    });
  }
  if (!cust) {
    const matches = custs.filter(c => namesMatch(`${json.firstName} ${json.lastName}`, `${c.firstName || ''} ${c.lastName || ''}`));
    if (matches.length === 1) cust = matches[0];
    else if (matches.length > 1) {
      const list = matches.map(m => `• ${m.firstName} ${m.lastName} (TC: ${m.tcKimlik || 'YOK'})`).join('\n');
      return `⚠️ "${json.firstName} ${json.lastName}" adında ${matches.length} müşteri var:\n${list}\n\nÖnce pasaportu yükleyin.`;
    }
  }
  if (!cust) return `⚠️ "${json.firstName} ${json.lastName}" bulunamadı!\nÖnce pasaportu yükleyin.`;

  const custDocId3 = cust.id || cust._docId;
  if (!custDocId3) return `⚠️ Müşteri ID bulunamadı`;
  await ref.doc(custDocId3).set({
    usaVisa: JSON.stringify({
      visaFirstName: json.firstName || '', visaLastName: json.lastName || '',
      issueDate: json.issueDate || '', endDate: json.endDate || '',
      image: await toStorage(img, 'abd_vize')
    }),
    verified: false
  }, { merge: true });
  const approved = await approveVisaApp(db, custDocId3, 'usa', ''); // ABD kategorisi zaten tek ülke
  return `✅ *ABD vizesi eklendi*\n👤 ${cust.firstName} ${cust.lastName}\n📅 Bitiş: ${json.endDate || '-'}${approved}`;
};

// ========== FORMAT ==========
const fmtPP = j => `🛂 ${j.firstName||''} *${j.lastName||''}* | ${j.passportNo||'-'} | ${detectPT(j.passportNo)}\n📅 ${j.expiryDate||'-'}${j.tcKimlik ? ` | 🆔 ${j.tcKimlik}` : ''}`;
const fmtSch = j => `🇪🇺 ${j.firstName||''} *${j.lastName||''}* | ${j.country||'-'} | ${j.visaNumber||'-'}\n📅 ${j.startDate||'-'} → ${j.endDate||'-'}`;
const fmtUsa = j => `🇺🇸 ${j.firstName||''} *${j.lastName||''}*\n📅 ${j.issueDate||'-'} → ${j.endDate||'-'}`;

// ========== VİZE BAŞVURUSU (Telegram butonlu akış) ==========
// Kategori tanımları — CRM'deki visaCategories ile birebir aynı id/label
const VISA_CATS = [
  { id: 'schengen', label: '🇪🇺 Schengen', country: '' },      // çok ülkeli — tür adından ülke çıkar
  { id: 'usa',      label: '🇺🇸 Amerika',  country: 'Amerika Birleşik Devletleri' },
  { id: 'russia',   label: '🇷🇺 Rusya',    country: 'Rusya' },
  { id: 'uk',       label: '🇬🇧 İngiltere', country: 'İngiltere' },
  { id: 'uae',      label: '🇦🇪 BAE',      country: 'Birleşik Arap Emirlikleri' },
  { id: 'china',    label: '🇨🇳 Çin',      country: 'Çin' },
  { id: 'other',    label: '🌍 Diğer',     country: '' }
];

// appSettings → visaDurations oku (CRM ile aynı Firestore)
// CRM config'i 'main' doc'una, ayarları 'app_settings' doc'una yazabiliyor — ikisini de dene
const getVisaDurations = async (db) => {
  try {
    // 1) config ile aynı doc: app_settings/main
    const m = await db.collection('app_settings').doc('main').get();
    if (m.exists && m.data()?.visaDurations) return m.data().visaDurations;
    // 2) app_settings/app_settings
    const a = await db.collection('app_settings').doc('app_settings').get();
    if (a.exists && a.data()?.visaDurations) return a.data().visaDurations;
    // 3) koleksiyondaki herhangi bir doc'ta visaDurations ara
    const snap = await db.collection('app_settings').get();
    for (const d of snap.docs) {
      if (d.data()?.visaDurations) return d.data().visaDurations;
    }
  } catch (e) { console.error('[BOT] visaDurations okunamadı:', e.message); }
  return {};
};

// appSettings → visaStatuses oku (Ayarlar → Vize Başvuru Durumları)
const getVisaStatuses = async (db) => {
  try {
    const m = await db.collection('app_settings').doc('main').get();
    if (m.exists && Array.isArray(m.data()?.visaStatuses) && m.data().visaStatuses.length) return m.data().visaStatuses;
    const a = await db.collection('app_settings').doc('app_settings').get();
    if (a.exists && Array.isArray(a.data()?.visaStatuses) && a.data().visaStatuses.length) return a.data().visaStatuses;
    const snap = await db.collection('app_settings').get();
    for (const d of snap.docs) {
      if (Array.isArray(d.data()?.visaStatuses) && d.data().visaStatuses.length) return d.data().visaStatuses;
    }
  } catch (e) { console.error('[BOT] visaStatuses okunamadı:', e.message); }
  return ['Evrak Topluyor']; // fallback
};

// Bir tür objesini normalize et (string veya {name, price, currency})
const normType = (d) => typeof d === 'string'
  ? { name: d, price: 0, currency: '€' }
  : { name: d.name || '', price: d.price || 0, currency: d.currency || '€' };

// Schengen tür adından ülkeyi çıkar ("Almanya Ticari" → "Almanya")
const countryFromTypeName = (name) => {
  const known = ['Almanya','Fransa','İtalya','İspanya','Hollanda','Belçika','Avusturya','Yunanistan','Portekiz','Polonya','Çekya','Macaristan','İsviçre','Danimarka','İsveç','Norveç','Finlandiya'];
  const up = String(name || '').toLocaleUpperCase('tr');
  for (const c of known) if (up.includes(c.toLocaleUpperCase('tr'))) return c;
  return '';
};

// ===== İleri tarihli başvuru: Telegram'da takvimden tarih seçimi =====
// CRM'deki "İleri Tarihte Başvuru" alanına (processDate) yazar; vizeci o güne kadar başvuruyu yapmaz.
const TR_AYLAR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const trToday = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtTr = (ymd) => { const [y, m, d] = String(ymd).split('-'); return `${d}.${m}.${y}`; };
// ym: 'YYYY-MM'. Geçmiş günler ve bugün seçilemez (ileri tarih = yarından itibaren)
// Telegram buton metni boş olamaz; görünmez karakter
const BLANK = '\u2800';
const calendarKb = (appId, ym) => {
  const now = trToday(); const todayYmd = ymdOf(now);
  const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); // varsayılan: yarının ayı (ay sonunda boş takvim açılmasın)
  let [y, m] = (ym || `${tmr.getFullYear()}-${tmr.getMonth() + 1}`).split('-').map(Number);
  const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
  const prev = new Date(y, m - 2, 1), next = new Date(y, m, 1);
  const pYm = `${prev.getFullYear()}-${prev.getMonth() + 1}`, nYm = `${next.getFullYear()}-${next.getMonth() + 1}`;
  const canPrev = prev.getFullYear() * 12 + prev.getMonth() >= now.getFullYear() * 12 + now.getMonth();
  const rows = [[
    { text: canPrev ? '‹' : BLANK, callback_data: canPrev ? `va|cal|${appId}|${pYm}` : 'va|noop' },
    { text: `${TR_AYLAR[m - 1]} ${y}`, callback_data: 'va|noop' },
    { text: '›', callback_data: `va|cal|${appId}|${nYm}` },
  ], ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'].map(t => ({ text: t, callback_data: 'va|noop' }))];
  let row = [], lead = (first.getDay() + 6) % 7; // pazartesi başlangıçlı
  for (let i = 0; i < lead; i++) row.push({ text: BLANK, callback_data: 'va|noop' });
  for (let d = 1; d <= days; d++) {
    const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    row.push(ymd > todayYmd ? { text: String(d), callback_data: `va|setd|${appId}|${ymd}` } : { text: '·', callback_data: 'va|noop' });
    if (row.length === 7) { rows.push(row); row = []; }
  }
  if (row.length) { while (row.length < 7) row.push({ text: BLANK, callback_data: 'va|noop' }); rows.push(row); }
  rows.push([{ text: '✖️ Vazgeç', callback_data: `va|fdx|${appId}` }]);
  return { inline_keyboard: rows };
};
const futureBtn = (appId, has) => ({ inline_keyboard: [[
  { text: has ? '📅 İleri tarihi değiştir' : '⏳ İleri tarihte başvurulacak', callback_data: `va|fd|${appId}` },
  ...(has ? [{ text: '🗑 İleri tarihi kaldır', callback_data: `va|clrd|${appId}` }] : [])
]] });

// visa_applications'a başvuru kaydet (CRM formData yapısıyla birebir)
const saveVisaApplication = async (db, cust, catId, typeObj, status) => {
  const cat = VISA_CATS.find(c => c.id === catId);
  const today = new Date().toISOString().split('T')[0];
  let country = cat?.country || '';
  if (catId === 'schengen') country = countryFromTypeName(typeObj.name) || '';
  const id = genId();
  const rec = {
    id,
    customerId: cust.id,
    customerName: cust.name || '',
    customerPhone: cust.phone || '',
    customerEmail: cust.email || '',
    category: catId,
    categoryId: catId,
    country,
    visaType: '',
    visaDuration: typeObj.name,
    visaPrice: typeObj.price || 0,
    visaCurrency: typeObj.currency || '€',
    applicationDate: today,
    appointmentDate: '',
    appointmentTime: '',
    pnr: '',
    label: '',
    processor: 'Paydos',
    paymentStatus: 'Ödenmedi',
    status: status || 'Evrak Topluyor',
    notes: '',
    price: typeObj.price || 0,
    cost: '',
    currency: typeObj.currency || '€',
    createdBy: 'Telegram Bot',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await db.collection('visa_applications').doc(String(id)).set(rec);
  return rec;
};

// Müşteriyi id ile getir (callback akışında)
const getCustomerById = async (db, custId) => {
  try {
    const doc = await db.collection('customers').doc(String(custId)).get();
    if (doc.exists) {
      const d = doc.data();
      return { id: doc.id, name: `${d.firstName || ''} ${d.lastName || ''}`.trim(), phone: d.phone || '', email: d.email || '' };
    }
  } catch (e) { console.error('[BOT] müşteri getirilemedi:', e.message); }
  return null;
};

// ========== WEBHOOK ==========
exports.telegramBot = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 120, memory: '1GB', secrets: ['VIZE_EVRAK_SA'] })
  .https.onRequest(async (req, res) => {
  let _chatId = null, _lmid = null, _token = null;
  try {
    const cfg = await getConfig();
    const T = cfg.TOKEN, K = cfg.KEY;
    _token = T;
    if (!T || !K) { console.log('MISSING CONFIG: TOKEN=' + (T ? 'YES' : 'NO') + ' KEY=' + (K ? 'YES' : 'NO')); return res.status(200).send('OK'); }

    // ===== CALLBACK QUERY (buton tıklamaları — vize başvurusu akışı) =====
    const cq = req.body?.callback_query;
    if (cq) {
      try {
        const data = cq.data || '';
        const cbChatId = cq.message?.chat?.id;
        const cbMsgId = cq.message?.message_id;
        const parts = data.split('|'); // format: va|<step>|<...>
        // Telegram'a "aldım" bildir (spinner kapansın)
        await tg(T, 'answerCallbackQuery', { callback_query_id: cq.id });

        if (parts[0] === 'va') {
          const step = parts[1];

          // 1) Pasaport sonrası "➕ Vize Başvurusu Ekle" → ülke seçimi göster
          if (step === 'cust') {
            const custId = parts[2];
            const rows = [];
            for (let i = 0; i < VISA_CATS.length; i += 2) {
              const row = [{ text: VISA_CATS[i].label, callback_data: `va|cat|${custId}|${VISA_CATS[i].id}` }];
              if (VISA_CATS[i + 1]) row.push({ text: VISA_CATS[i + 1].label, callback_data: `va|cat|${custId}|${VISA_CATS[i + 1].id}` });
              rows.push(row);
            }
            rows.push([{ text: '✖️ İptal', callback_data: `va|cancel|${custId}` }]);
            await tg(T, 'editMessageReplyMarkup', {
              chat_id: cbChatId, message_id: cbMsgId,
              reply_markup: { inline_keyboard: rows }
            });
            return res.status(200).send('OK');
          }

          // 2) Ülke seçildi → o kategorinin vize türlerini göster
          if (step === 'cat') {
            const custId = parts[2], catId = parts[3];
            const durations = await getVisaDurations(cfg.db);
            const types = (durations[catId] || []).map(normType).filter(t => t.name);
            if (!types.length) {
              await tg(T, 'editMessageReplyMarkup', {
                chat_id: cbChatId, message_id: cbMsgId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Geri', callback_data: `va|cust|${custId}` }]] }
              });
              await tg(T, 'sendMessage', { chat_id: cbChatId, text: '⚠️ Bu kategoride tanımlı vize türü yok. CRM → Ayarlar → Vize Türleri\'nden ekleyin.' });
              return res.status(200).send('OK');
            }
            // Türleri butona diz — callback data'da index taşı (isim uzun olabilir, 64 byte limiti)
            const rows = [];
            types.forEach((t, idx) => {
              rows.push([{ text: `${t.name} · ${t.price}${t.currency}`, callback_data: `va|type|${custId}|${catId}|${idx}` }]);
            });
            rows.push([{ text: '⬅️ Geri', callback_data: `va|cust|${custId}` }]);
            await tg(T, 'editMessageReplyMarkup', {
              chat_id: cbChatId, message_id: cbMsgId,
              reply_markup: { inline_keyboard: rows }
            });
            return res.status(200).send('OK');
          }

          // 3) Tür seçildi → Almanya Schengen ise TİP sor, değilse direkt durum
          if (step === 'type') {
            const custId = parts[2], catId = parts[3], typeIdx = parseInt(parts[4], 10);
            const durations = await getVisaDurations(cfg.db);
            const types = (durations[catId] || []).map(normType).filter(t => t.name);
            const typeObj = types[typeIdx];
            const isSchengen = catId === 'schengen' && typeObj;
            if (isSchengen) {
              // Tip (başvuru sahibi durumu) sor — vizeevrak evrak listesi için gerekli
              const tipler = [
                { id: 'sirket_sahibi_ortagi', ad: 'Şirket Sahibi / Ortağı' },
                { id: 'sigortali_calisan', ad: 'Sigortalı Çalışan' },
                { id: 'emekli', ad: 'Emekli' },
                { id: 'ev_hanimi_bekar', ad: 'Ev Hanımı / Bekar (Çalışmayan)' },
              ];
              const rows = tipler.map((t, i) => [{ text: t.ad, callback_data: `va|tip|${custId}|${catId}|${typeIdx}|${i}` }]);
              rows.push([{ text: '⬅️ Geri', callback_data: `va|cat|${custId}|${catId}` }]);
              await tg(T, 'editMessageReplyMarkup', { chat_id: cbChatId, message_id: cbMsgId, reply_markup: { inline_keyboard: rows } });
              await tg(T, 'sendMessage', { chat_id: cbChatId, text: '👤 Başvuru sahibinin durumu? (evrak listesi buna göre hazırlanır)' });
              return res.status(200).send('OK');
            }
            // Almanya değil → tip yok, direkt durum listesi (tipIdx=-1)
            const statuses = await getVisaStatuses(cfg.db);
            const rows = statuses.map((s, idx) => [{ text: s, callback_data: `va|save|${custId}|${catId}|${typeIdx}|${idx}|-1` }]);
            rows.push([{ text: '⬅️ Geri', callback_data: `va|cat|${custId}|${catId}` }]);
            await tg(T, 'editMessageReplyMarkup', { chat_id: cbChatId, message_id: cbMsgId, reply_markup: { inline_keyboard: rows } });
            return res.status(200).send('OK');
          }

          // 3b) Tip seçildi (Almanya) → durum listesi
          if (step === 'tip') {
            const custId = parts[2], catId = parts[3], typeIdx = parseInt(parts[4], 10), tipIdx = parseInt(parts[5], 10);
            const statuses = await getVisaStatuses(cfg.db);
            const rows = statuses.map((s, idx) => [{ text: s, callback_data: `va|save|${custId}|${catId}|${typeIdx}|${idx}|${tipIdx}` }]);
            rows.push([{ text: '⬅️ Geri', callback_data: `va|type|${custId}|${catId}|${typeIdx}` }]);
            await tg(T, 'editMessageReplyMarkup', { chat_id: cbChatId, message_id: cbMsgId, reply_markup: { inline_keyboard: rows } });
            return res.status(200).send('OK');
          }

          // 4) Durum seçildi → CRM'e kaydet (+ Almanya ise vizeevrak'a da)
          if (step === 'save') {
            const custId = parts[2], catId = parts[3], typeIdx = parseInt(parts[4], 10), statusIdx = parseInt(parts[5], 10), tipIdx = parseInt(parts[6] ?? '-1', 10);
            const durations = await getVisaDurations(cfg.db);
            const types = (durations[catId] || []).map(normType).filter(t => t.name);
            const typeObj = types[typeIdx];
            const statuses = await getVisaStatuses(cfg.db);
            const status = statuses[statusIdx] || 'Evrak Topluyor';
            const cust = await getCustomerById(cfg.db, custId);
            if (!cust || !typeObj) {
              await tg(T, 'sendMessage', { chat_id: cbChatId, text: '❌ Başvuru oluşturulamadı (müşteri/tür bulunamadı).' });
              return res.status(200).send('OK');
            }
            // Çift dokunma koruması: butonları hemen kaldır; aynı müşteri + aynı tür için son 2 dakikada
            // bot'un açtığı başvuru varsa ikinciyi açma (Telegram'da hızlı iki dokunuş iki kayıt oluşturuyordu)
            await tg(T, 'editMessageReplyMarkup', { chat_id: cbChatId, message_id: cbMsgId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
            try {
              const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
              const recent = await cfg.db.collection('visa_applications').where('customerId', '==', cust.id).get();
              const dup = recent.docs.map(d => d.data()).find(v => v.createdBy === 'Telegram Bot' && v.visaDuration === typeObj.name && String(v.createdAt || '') >= since);
              if (dup) {
                await tg(T, 'sendMessage', { chat_id: cbChatId, text: `ℹ️ ${cust.name} için "${typeObj.name}" başvurusu az önce zaten açıldı — tekrar açılmadı.` });
                return res.status(200).send('OK');
              }
            } catch (e) { console.warn('[BOT] tekrar kontrolü yapılamadı:', e.message); }
            const rec = await saveVisaApplication(cfg.db, cust, catId, typeObj, status);
            const catLabel = VISA_CATS.find(c => c.id === catId)?.label || catId;

            // Schengen (Almanya/İtalya/Fransa/Hollanda) → vizeevrak'a da başvuru aç
            let vizeEvrakMsg = '';
            const isSchengen = catId === 'schengen';
            if (isSchengen && tipIdx >= 0) {
              const TIP_IDS = ['sirket_sahibi_ortagi', 'sigortali_calisan', 'emekli', 'ev_hanimi_bekar'];
              const tipId = TIP_IDS[tipIdx] || 'sirket_sahibi_ortagi';
              const amacId = /turistik/i.test(typeObj.name) ? 'turistik' : 'ticari';
              try {
                const veId = await vizeEvrakBasvuruOlustur({
                  amacId, tipId,
                  adSoyad: cust.name || '',
                  telefon: cust.phone || '',
                  email: cust.email || '',
                  tcNo: cust.tcKimlik || '',
                  not: `Telegram bot — ${typeObj.name}`,
                  resitDegil: false,
                });
                vizeEvrakMsg = `\n\n📁 *Vize Evrak* başvurusu da oluşturuldu.\n🔗 Müşteri linki:\nvize.paydostur.com/#/yukle/${veId}`;
              } catch (e) {
                console.error('[VİZEEVRAK] başvuru hatası:', e);
                vizeEvrakMsg = `\n\n⚠️ Vize Evrak başvurusu oluşturulamadı: ${e.message}`;
              }
            }

            // Amerika vizesi → kişiye özel DS-160 formu linki üret (CRM'deki mantıkla aynı)
            if (catId === 'usa') {
              try {
                let ds160Url = 'https://ds160-paydos.netlify.app';
                try {
                  const s = await cfg.db.collection('app_settings').doc('main').get();
                  if (s.exists && s.data()?.ds160SiteUrl) ds160Url = s.data().ds160SiteUrl;
                } catch (e) {}
                const newId = 'a' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
                const link = `${ds160Url}${ds160Url.includes('?') ? '&' : '?'}id=${newId}`;
                vizeEvrakMsg += `\n\n🇺🇸 *DS-160 formu linki* (müşteriye gönderin):\n${link}`;
              } catch (e) {
                console.error('[DS160] link üretilemedi:', e.message);
              }
            }

            await tg(T, 'sendMessage', {
              chat_id: cbChatId,
              text: `✅ *Vize başvurusu oluşturuldu*\n👤 ${cust.name}\n${catLabel}${rec.country ? ` — ${rec.country}` : ''}\n📋 ${typeObj.name} · ${typeObj.price}${typeObj.currency}\n📌 Durum: ${status}\n\n_CRM → Vize Başvuruları'nda görünür._${vizeEvrakMsg}`,
              parse_mode: 'Markdown',
              reply_markup: futureBtn(rec.id, false)
            });
            return res.status(200).send('OK');
          }

          // Takvimde tıklanamayan hücreler
          if (step === 'noop') return res.status(200).send('OK');

          // ⏳ İleri tarih: takvimi aç / ay değiştir
          if (step === 'fd' || step === 'cal') {
            const appId = parts[2];
            await tg(T, 'editMessageReplyMarkup', { chat_id: cbChatId, message_id: cbMsgId, reply_markup: calendarKb(appId, step === 'cal' ? parts[3] : '') });
            return res.status(200).send('OK');
          }
          // Takvimden vazgeç → butonu geri getir
          if (step === 'fdx') {
            const appId = parts[2];
            let has = false; try { const d = await cfg.db.collection('visa_applications').doc(appId).get(); has = !!d.data()?.processDate; } catch (e) {}
            await tg(T, 'editMessageReplyMarkup', { chat_id: cbChatId, message_id: cbMsgId, reply_markup: futureBtn(appId, has) });
            return res.status(200).send('OK');
          }
          // Tarih seçildi → CRM'e yaz
          if (step === 'setd' || step === 'clrd') {
            const appId = parts[2], ymd = step === 'setd' ? parts[3] : '';
            if (step === 'setd' && !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return res.status(200).send('OK');
            const ref = cfg.db.collection('visa_applications').doc(appId);
            const snap = await ref.get();
            if (!snap.exists) { await tg(T, 'sendMessage', { chat_id: cbChatId, text: '❌ Başvuru bulunamadı (CRM\'den silinmiş olabilir).' }); return res.status(200).send('OK'); }
            await ref.set({ processDate: ymd, updatedAt: new Date().toISOString() }, { merge: true });
            await tg(T, 'editMessageReplyMarkup', { chat_id: cbChatId, message_id: cbMsgId, reply_markup: futureBtn(appId, !!ymd) });
            const who = snap.data()?.customerName || '';
            await tg(T, 'sendMessage', { chat_id: cbChatId, parse_mode: 'Markdown',
              text: ymd ? `⏳ *İleri tarihli başvuru*\n👤 ${who}\n📅 Başvuru *${fmtTr(ymd)}* tarihinde yapılacak.\n_Vizeci o güne kadar bu başvuruyu yapmaz._`
                        : `🗑 ${who} — ileri tarih kaldırıldı, başvuru normal sırada (ertesi iş günü) yapılacak.` });
            return res.status(200).send('OK');
          }

          // İptal
          if (step === 'cancel') {
            await tg(T, 'editMessageReplyMarkup', { chat_id: cbChatId, message_id: cbMsgId, reply_markup: { inline_keyboard: [] } });
            return res.status(200).send('OK');
          }
        }
      } catch (e) {
        console.error('[BOT] callback hatası:', e);
      }
      return res.status(200).send('OK');
    }

    const msg = req.body?.message;
    console.log('Webhook received:', msg ? ('chat:' + msg.chat?.id + ' photo:' + (msg.photo ? 'YES' : 'NO') + ' text:' + (msg.text || '-')) : 'NO MESSAGE');
    // ===== Grup komutları: /grup (vize duyuru grubunu kaydet), /bugun (bugün başvuru yapılacaklar), /atama (atama bekleyenler) =====
    const cmd = msg && typeof msg.text === 'string' ? (msg.text.trim().match(/^\/(grup|atama|bugun|bugün)(?:@\w+)?(?=\s|$)/i) || [])[1] : '';
    if (cmd) {
      const chat = msg.chat || {};
      const isGroup = chat.type === 'group' || chat.type === 'supergroup';
      const setRef = cfg.db.collection('app_settings').doc('main');
      const saved = String((await setRef.get()).data()?.telegramVizeGrupId || '');
      if (!isGroup) { await tg(T, 'sendMessage', { chat_id: chat.id, text: 'ℹ️ Bu komut vize grubunda kullanılır.' }); return res.status(200).send('OK'); }
      if (cmd.toLowerCase() === 'grup') {
        // Duyurular müşteri adı içerir: kayıtlı grup varken başka bir grup kendini kaydedemez (CRM/Firestore'dan silinmeli)
        if (saved && saved !== String(chat.id)) { await tg(T, 'sendMessage', { chat_id: chat.id, text: '⛔ Vize duyuruları başka bir gruba kayıtlı. Değiştirmek için yöneticiye başvurun.' }); return res.status(200).send('OK'); }
        await setRef.set({ telegramVizeGrupId: String(chat.id), telegramVizeGrupAdi: chat.title || '' }, { merge: true });
        await tg(T, 'sendMessage', { chat_id: chat.id, text: '✅ Bu grup vize duyuruları için kaydedildi.\nHafta içi her gün:\n• 09:30 — bugün başvuru yapılacaklar\n• 11:30 ve 17:00 — başvurusu yapılıp "Atama Bekliyor"a geçenler\nBeklemeden yazdırmak için: /bugun · /atama' });
        return res.status(200).send('OK');
      }
      if (saved !== String(chat.id)) { await tg(T, 'sendMessage', { chat_id: chat.id, text: 'ℹ️ Önce bu grubu kaydedin: /grup' }); return res.status(200).send('OK'); }
      try {
        const A = require('./atama');
        if (/^bug/i.test(cmd)) await A.announceTodo({ db: cfg.db, token: T, chatId: chat.id });
        else {
          const n = await A.announceAtama({ db: cfg.db, token: T, chatId: chat.id });
          if (!n) await tg(T, 'sendMessage', { chat_id: chat.id, text: 'ℹ️ Duyurulmamış yeni "Atama Bekliyor" başvuru yok.' });
        }
      } catch (e) {
        console.error('[BOT] /atama hatası:', e);
        await tg(T, 'sendMessage', { chat_id: chat.id, text: '❌ Liste hazırlanamadı: ' + e.message });
      }
      return res.status(200).send('OK');
    }
    if (!msg || !msg.photo) return res.status(200).send('OK');

    const chatId = msg.chat.id;
    _chatId = chatId;
    const sender = msg.from?.first_name || '';
    const photo = msg.photo[msg.photo.length - 1];

    // Loading
    const lm = await tg(T, 'sendMessage', {
      chat_id: chatId,
      text: `🤖 Okunuyor... _(${sender})_`,
      parse_mode: 'Markdown',
      reply_to_message_id: msg.message_id
    });
    const lmid = lm.result?.message_id;
    _lmid = lmid;

    // İndir
    const b64 = await dlPhoto(T, photo.file_id);
    if (!b64) {
      await tg(T, 'editMessageText', { chat_id: chatId, message_id: lmid, text: '❌ İndirilemedi.' });
      return res.status(200).send('OK');
    }
    console.log('Photo downloaded, size:', b64.length, 'bytes');

    // Tanı + Oku (tek adımda)
    const { dtype, json } = await detectType(K, b64);
    if (!dtype || !json) {
      await tg(T, 'editMessageText', { chat_id: chatId, message_id: lmid, text: lastAiError ? ('❌ Okunamadı.\nSebep: ' + lastAiError) : '❌ Tanınamadı. Pasaport veya vize yükleyin.' });
      return res.status(200).send('OK');
    }

    // Pasaport görseli — Firestore'a yazmadan önce küçültülür (büyük base64 OOM'a yol açıyordu)
    let finalImg = await shrinkImg(b64);

    // ⛔ Tarih kontrolü — hatalı veya süresi dolmuş belge reddet
    const dateErrors = validateDates(json, dtype);
    if (dateErrors.length > 0) {
      const typeLabel = dtype === 'passport' ? '🛂 Pasaport' : dtype === 'schengen' ? '🇪🇺 Schengen' : '🇺🇸 ABD Vize';
      await tg(T, 'editMessageText', {
        chat_id: chatId, message_id: lmid,
        text: `⛔ *TARİH HATASI — KAYDEDİLMEDİ*\n\n${typeLabel}\n👤 ${json.firstName || ''} ${json.lastName || ''}\n\n${dateErrors.map(e => `❌ ${e}`).join('\n')}\n\n💡 Lütfen CRM'den manuel kontrol edin.`,
        parse_mode: 'Markdown'
      });
      return res.status(200).send('OK');
    }

    // Kaydet - önce spesifik sorgu, bulunamazsa fallback
    let custs = [];
    try {
      if (json.passportNo) {
        const snap = await cfg.db.collection('customers').get();
        custs = snap.docs.map(d => ({ ...d.data(), id: d.id, _docId: d.id })).filter(c => {
          try {
            const pList = typeof c.passports === 'string' ? JSON.parse(c.passports) : c.passports;
            if (!Array.isArray(pList)) return false;
            return pList.some(p => p.passportNo === json.passportNo);
          } catch(e) { return false; }
        });
      }
      if (custs.length === 0 && json.tcKimlik) {
        const snap = await cfg.db.collection('customers').where('tcKimlik', '==', json.tcKimlik).get();
        custs = snap.docs.map(d => ({ ...d.data(), id: d.id, _docId: d.id }));
      }
      if (custs.length === 0 && json.firstName && json.lastName) {
        const snap = await cfg.db.collection('customers')
          .where('firstName', '==', json.firstName.toUpperCase())
          .where('lastName', '==', json.lastName.toUpperCase())
          .get();
        custs = snap.docs.map(d => ({ ...d.data(), id: d.id, _docId: d.id }));
      }
      if (custs.length === 0) {
        const snap = await cfg.db.collection('customers').get();
        custs = snap.docs.map(d => ({ ...d.data(), id: d.id, _docId: d.id }));
      }
    } catch(e) {
      console.error('[BOT] Sorgu hatası:', e);
      const snap = await cfg.db.collection('customers').get();
      custs = snap.docs.map(d => ({ ...d.data(), id: d.id, _docId: d.id }));
    }
    let result = '';
    let info = '';
    let passportCust = null; // pasaport kaydından dönen müşteri (buton için)

    if (dtype === 'passport') {
      info = fmtPP(json);
      const r = await savePassport(cfg.db, custs, json, finalImg);
      result = r.text;
      if (r.custId) passportCust = { id: r.custId, name: r.custName, phone: r.custPhone, email: r.custEmail };
    } else if (dtype === 'schengen') {
      info = fmtSch(json);
      result = await saveSchengen(cfg.db, custs, json, b64);
    } else {
      info = fmtUsa(json);
      result = await saveUsa(cfg.db, custs, json, b64);
    }

    // Sonuç — pasaportsa "Vize Başvurusu Ekle" butonu ekle (opsiyonel, zorlamaz)
    const editPayload = {
      chat_id: chatId,
      message_id: lmid,
      text: `${info}\n\n${result}`,
      parse_mode: 'Markdown'
    };
    if (passportCust) {
      editPayload.reply_markup = {
        inline_keyboard: [[
          { text: '➕ Vize Başvurusu Ekle', callback_data: `va|cust|${passportCust.id}` }
        ]]
      };
    }
    await tg(T, 'editMessageText', editPayload);

  } catch (e) {
    console.error('Bot hatası:', e);
    // "Okunuyor..." mesajı takılı kalmasın - hata mesajına çevir
    if (_token && _chatId && _lmid) {
      try {
        await tg(_token, 'editMessageText', {
          chat_id: _chatId, message_id: _lmid,
          text: '❌ İşlem sırasında bir hata oluştu. Lütfen fotoğrafı tekrar gönderin.\n\n(Hata: ' + (e.message || 'bilinmeyen').slice(0, 100) + ')'
        });
      } catch {}
    }
  }
  return res.status(200).send('OK');
});

// Belge linki API (PIN korumalı) — ayrı fonksiyon: npx firebase-tools deploy --only functions:belge
exports.belge = require('./belge').belge;
// Müşteri linki bildirimleri (Web Push) — CRM'deki 📣 Bildirimler ekranı
exports.bildirim = require('./bildirim').bildirim;
exports.bildirimOtomatik = require('./bildirim').bildirimOtomatik; // her gün 10:00 vize/pasaport bitiş hatırlatması
// Vize günlük grup duyuruları (09:30 yapılacaklar, 11:30 + 17:00 atama bekleyenler)
exports.vizeBugunDuyuru = require('./atama').vizeBugunDuyuru;
exports.vizeAtamaDuyuru = require('./atama').vizeAtamaDuyuru;
exports.vizeAtamaDuyuruAksam = require('./atama').vizeAtamaDuyuruAksam;
