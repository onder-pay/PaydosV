// ===== 🧾 iDATA teslim fişi (gruba atılan fotoğraf) =====
// Fişte: BAŞVURU TAKİP NO (S4092386), başvuru/seyahat tarihi, ad, soyad, pasaport no. Bot:
//   1) kişiyi bulur: pasaport no → müşteri kartı; yoksa ad-soyad (Türkçe harf duyarsız)
//   2) o kişinin AÇIK vize başvurusunu bulur (tek başvuru olmalı; birden çoksa başvuru tarihine en yakını, yine belirsizse yazmaz)
//   3) başvuruya yazar: takipNo, fiş görseli (idataFisUrl), muhtemel seyahat tarihi (boşsa). Ücret YAZILMAZ, durum DEĞİŞMEZ.
// Takip no yazılınca iDATA'nın "Bilgilendirme <no>" mailleri (pasaport geldi / teslim edildi) bu başvuruyla eşleşir (gelenmail.js).
const { normTr, titleCaseTr, dmy } = require('./tr');

const parseArr = (v) => { if (Array.isArray(v)) return v; try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const closed = (v) => /onay|red|iptal/.test(normTr(v.status));
const full = (c) => `${c.firstName || ''} ${c.lastName || ''}`;
const nameKey = (s) => normTr(s).split(/\s+/).filter(Boolean).sort().join(' ');
const ymdOk = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ''));

const normalizeFis = (json) => {
  const takip = String(json.takipNo || '').toUpperCase().replace(/\s+/g, '');
  return { ...json, takipNo: takip, passportNo: String(json.passportNo || '').toUpperCase().replace(/\s+/g, '') };
};

const handleIdataFis = async ({ db, json, b64, toStorage }) => {
  const j = normalizeFis(json);
  const kim = titleCaseTr(`${j.firstName || ''} ${j.lastName || ''}`.trim()) || '—';
  const head = `🧾 *iDATA teslim fişi*\n👤 ${kim}${j.passportNo ? ` · 📘 ${j.passportNo}` : ''}\n🔢 Takip no: *${j.takipNo || '?'}*${ymdOk(j.basvuruTarihi) ? `\n📅 Başvuru: ${dmy(j.basvuruTarihi)}` : ''}${ymdOk(j.seyahatTarihi) ? ` · Seyahat: ${dmy(j.seyahatTarihi)}` : ''}`;
  if (!/^[A-Z]?\d{5,10}$/.test(j.takipNo)) return `${head}\n\n⚠️ Başvuru takip numarası okunamadı — kaydedilmedi. Fişi düz ve net çekip tekrar gönderin.`;

  // 1) Müşteri
  const custs = (await db.collection('customers').get()).docs.map(d => ({ ...d.data(), _docId: d.id }));
  let cs = j.passportNo ? custs.filter(c => parseArr(c.passports).some(p => String(p.passportNo || '').toUpperCase() === j.passportNo)) : [];
  if (!cs.length && j.firstName && j.lastName) cs = custs.filter(c => nameKey(full(c)) === nameKey(`${j.firstName} ${j.lastName}`));
  const ids = new Set(cs.flatMap(c => [String(c._docId), c.id != null ? String(c.id) : '']).filter(Boolean));

  // 2) Açık başvuru (müşteri bağlantısı; müşteri yoksa başvurudaki ad)
  const visas = (await db.collection('visa_applications').get()).docs.map(d => ({ ...d.data(), _ref: d.ref }));
  const sameTakip = visas.filter(v => v.takipNo && String(v.takipNo).replace(/\D/g, '') === j.takipNo.replace(/\D/g, ''));
  let cand = sameTakip.length === 1 ? sameTakip
    : visas.filter(v => !closed(v) && (ids.size ? ids.has(String(v.customerId)) : nameKey(v.customerName) === nameKey(`${j.firstName} ${j.lastName}`)));
  if (cand.length > 1 && ymdOk(j.basvuruTarihi)) {
    const t = new Date(j.basvuruTarihi).getTime();
    const dist = (v) => { const d = String(v.appointmentDate || v.applicationDate || '').slice(0, 10); return ymdOk(d) ? Math.abs(new Date(d).getTime() - t) : Infinity; };
    const best = Math.min(...cand.map(dist));
    const near = cand.filter(v => dist(v) === best && best <= 3 * 86400000); // randevu günü ±3 gün
    if (near.length === 1) cand = near;
  }
  if (cand.length !== 1) {
    const why = !cs.length && !cand.length ? 'CRM\'de bu kişi bulunamadı' : cand.length ? `${cand.length} açık başvuru var, hangisi olduğu belli değil` : 'açık vize başvurusu bulunamadı';
    return `${head}\n\n⚠️ ${why} — kaydedilmedi. Takip numarasını başvurunun "Başvuru Takip No" alanına elle girin.`;
  }
  const v = cand[0];

  // 3) Yaz — fiş görseli saklanır (pasaport bu fişle teslim alınır)
  const url = await toStorage(b64, `idatafis_${j.takipNo}`);
  const patch = { takipNo: j.takipNo, idataFisUrl: url, idataFisAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (ymdOk(j.seyahatTarihi) && !v.travelStart) patch.travelStart = j.seyahatTarihi;
  const eski = v.takipNo && String(v.takipNo) !== j.takipNo ? `\n🔄 önceki takip no: ${v.takipNo}` : '';
  await v._ref.set(patch, { merge: true });
  return `${head}\n\n✅ *${titleCaseTr(v.customerName || kim)}* başvurusuna işlendi (${v.visaDuration || v.country || 'vize'}${v.status ? `, ${v.status}` : ''})\n📎 Fiş görüntüsü saklandı${patch.travelStart ? `\n✈️ Muhtemel seyahat: ${dmy(patch.travelStart)}` : ''}${eski}\nℹ️ Pasaport iDATA'ya gelince/teslim edilince mailden otomatik haber verilir.`;
};

module.exports = { handleIdataFis, normalizeFis };
