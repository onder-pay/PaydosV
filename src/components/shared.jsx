// Birden çok modülün kullandığı ekran parçaları ve yardımcılar (App.jsx'ten ayrıldı)
import { EMPTY_REST, cityKey, parseMapsInput, tourCities } from '../lib/tourcity.js';
import { collection, deleteDoc, doc, getDocs, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { titleCaseTr, asciiTr, normalizeTr, trHas, trUpper, fullNameTr } from '../lib/turkish.js';
import { useEffect, useState, useMemo, useRef } from 'react';
import { NAMECHK_COLOR, detectFlights, detectHotel, nameCheck, nameWords, sameFlight } from '../lib/docparse.js';
import { TravelCheckBox, CustomerNameInput } from './ui';
import { formatDate, formatWhatsAppPhone, generateUniqueId, safeParseObj, waUrl } from '../lib/format.js';
import { pdfExtractPages, pdfPagesText, addCanvasPaged, loadHtml2Canvas, pdfFileText } from '../lib/pdf.js';
import { mailHtml, sendMailRequest } from '../lib/api.js';
import { DEFAULT_BANK } from '../lib/banks.js';
import { SOZLESME_SABIT, VIZE_DURUM } from '../lib/data.js';
import { jsPDF } from '../lib/heavy.js';
import { FINGERPRINT_MONTHS, fingerprintLabel } from '../lib/travel.js';


export function TavsiyelerModal({ onClose, showToast, isMobile, currentUser, focusCity, asPage }) {
  const [cities, setCities] = useState(null); // [{ key, city, country, restaurants, dirty }]
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCity, setNewCity] = useState({ city: '', country: '' });
  useEffect(() => {
    getDocs(collection(db, 'tavsiyeler')).then(snap => {
      const list = snap.docs.map(d => ({ key: d.id, city: d.data().city || d.id, country: d.data().country || '', restaurants: Array.isArray(d.data().restaurants) ? d.data().restaurants : [], dirty: false }))
        .sort((a, b) => a.city.localeCompare(b.city, 'tr'));
      setCities(list);
      const fk = tourCities(focusCity).map(cityKey)[0];
      if (fk && list.some(c => c.key === fk)) setSel(fk);
      else if (focusCity && tourCities(focusCity)[0]) setNewCity({ city: tourCities(focusCity)[0], country: '' });
      if (!fk || !list.some(c => c.key === fk)) setSel(list[0]?.key || '');
    }).catch(e => { setCities([]); showToast?.('Tavsiyeler okunamadı: ' + e.message, 'error'); });
  }, []);
  const cur = (cities || []).find(c => c.key === sel);
  const patchCur = (fn) => setCities(cs => cs.map(c => c.key === sel ? { ...fn(c), dirty: true } : c));
  const updR = (i, f, v) => patchCur(c => ({ ...c, restaurants: c.restaurants.map((r, j) => j === i ? { ...r, [f]: v } : r) }));
  const moveR = (i, d) => patchCur(c => { const n = [...c.restaurants]; const j = i + d; if (j < 0 || j >= n.length) return c; [n[i], n[j]] = [n[j], n[i]]; return { ...c, restaurants: n }; });
  const addCity = () => {
    const name = newCity.city.trim(); const key = cityKey(name);
    if (!key) { showToast?.('Şehir adı girin', 'warning'); return; }
    if ((cities || []).some(c => c.key === key)) { setSel(key); showToast?.('Bu şehir zaten var', 'info'); return; }
    setCities(cs => [...cs, { key, city: titleCaseTr(name), country: newCity.country.trim(), restaurants: [{ ...EMPTY_REST }], dirty: true }].sort((a, b) => a.city.localeCompare(b.city, 'tr')));
    setSel(key); setNewCity({ city: '', country: '' });
  };
  const save = async () => {
    if (!cur) return;
    const restaurants = cur.restaurants.map(r => ({ name: String(r.name || '').trim(), cuisine: String(r.cuisine || '').trim(), price: String(r.price || ''), note: String(r.note || '').trim(), address: String(r.address || '').trim(), loc: String(r.loc || '').trim(), mapsUrl: String(r.mapsUrl || '').trim() })).filter(r => r.name);
    setBusy(true);
    try {
      await setDoc(doc(db, 'tavsiyeler', cur.key), { city: cur.city, country: cur.country || '', restaurants, updatedAt: new Date().toISOString(), updatedBy: currentUser?.name || '' });
      setCities(cs => cs.map(c => c.key === cur.key ? { ...c, restaurants, dirty: false } : c));
      showToast?.(`${cur.city} kaydedildi — bu şehre giden tur linklerinde hemen görünür`, 'success');
    } catch (e) { showToast?.('Kaydedilemedi: ' + e.message, 'error'); }
    finally { setBusy(false); }
  };
  const removeCity = async () => {
    if (!cur || !window.confirm(`${cur.city} ve tüm tavsiyeleri silinsin mi?`)) return;
    try { await deleteDoc(doc(db, 'tavsiyeler', cur.key)); } catch (e) { showToast?.('Silinemedi: ' + e.message, 'error'); return; }
    const rest = cities.filter(c => c.key !== cur.key); setCities(rest); setSel(rest[0]?.key || '');
  };
  const close = () => { if (asPage) return; if ((cities || []).some(c => c.dirty) && !window.confirm('Kaydedilmemiş değişiklik var. Kapatılsın mı?')) return; onClose(); };
  // Sayfa modunda (sol menü) başka modüle geçerken kaydedilmemiş değişiklik uyarısı
  useEffect(() => {
    if (!asPage) return;
    const h = (e) => { if ((cities || []).some(c => c.dirty)) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [asPage, cities]);
  const fs = { padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#fff', fontSize: '13px', width: '100%', boxSizing: 'border-box' };
  const small = { padding: '6px 9px', background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '6px', color: '#94a3b8', cursor: 'pointer' };
  return (
    <div style={asPage ? { padding: isMobile ? '12px' : '24px' } : { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 3000, display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'center', padding: isMobile ? 0 : '20px' }} onClick={close}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f2744', border: '1px solid rgba(249,115,22,0.35)', borderRadius: isMobile && !asPage ? 0 : '16px', width: '100%', maxWidth: asPage ? '1100px' : '980px', margin: asPage ? '0 auto' : undefined, maxHeight: asPage ? (isMobile ? 'none' : 'calc(100vh - 48px)') : isMobile ? '100vh' : '88vh', minHeight: asPage && !isMobile ? '70vh' : undefined, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '17px' }}>⭐ Tavsiyeler</h3>
            <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#94a3b8' }}>Şehir bazlı tavsiye restoranlar. Turun şehriyle eşleşen tavsiyeler o turun linkinde otomatik görünür.</p>
          </div>
          {!asPage && <button onClick={close} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}>✕</button>}
        </div>
        {cities === null ? <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>⏳ Yükleniyor...</div> : (
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flex: 1, minHeight: 0 }}>
            {/* Şehirler */}
            <div style={{ width: isMobile ? 'auto' : '250px', borderRight: isMobile ? 'none' : '1px solid rgba(255,255,255,0.08)', borderBottom: isMobile ? '1px solid rgba(255,255,255,0.08)' : 'none', padding: '12px', overflowY: 'auto', flexShrink: 0, maxHeight: isMobile ? '34vh' : 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                <input value={newCity.city} onChange={e => setNewCity({ ...newCity, city: e.target.value })} onKeyDown={e => e.key === 'Enter' && addCity()} placeholder="Şehir (ör. Bakü)" style={fs} />
                <input value={newCity.country} onChange={e => setNewCity({ ...newCity, country: e.target.value })} onKeyDown={e => e.key === 'Enter' && addCity()} placeholder="Ülke (isteğe bağlı)" style={fs} />
                <button onClick={addCity} style={{ padding: '8px', background: 'rgba(249,115,22,0.18)', border: '1px solid rgba(249,115,22,0.4)', borderRadius: '8px', color: '#fb923c', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>+ Şehir ekle</button>
              </div>
              {cities.length === 0 && <div style={{ fontSize: '12px', color: '#64748b', padding: '6px' }}>Henüz şehir yok.</div>}
              {cities.map(c => (
                <button key={c.key} onClick={() => setSel(c.key)} style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: '6px', padding: '9px 10px', marginBottom: '4px', background: sel === c.key ? 'rgba(249,115,22,0.18)' : 'transparent', border: sel === c.key ? '1px solid rgba(249,115,22,0.4)' : '1px solid transparent', borderRadius: '8px', color: sel === c.key ? '#fb923c' : '#e8f1f8', cursor: 'pointer', fontSize: '13px', textAlign: 'left' }}>
                  <span>{c.city}{c.country ? <span style={{ color: '#64748b', fontSize: '11px' }}> · {c.country}</span> : ''}{c.dirty ? ' •' : ''}</span>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>{c.restaurants.filter(r => String(r.name || '').trim()).length} 🍽️</span>
                </button>
              ))}
            </div>
            {/* Seçili şehrin restoranları */}
            <div style={{ flex: 1, padding: '14px', overflowY: 'auto', minHeight: 0 }}>
              {!cur ? <div style={{ color: '#64748b', fontSize: '13px', padding: '20px' }}>Soldan bir şehir seçin veya yeni şehir ekleyin.</div> : (
                <>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
                    <input value={cur.city} onChange={e => patchCur(c => ({ ...c, city: e.target.value }))} style={{ ...fs, flex: 1, minWidth: '140px', fontWeight: '700', fontSize: '15px' }} title="Görünen şehir adı" />
                    <input value={cur.country} onChange={e => patchCur(c => ({ ...c, country: e.target.value }))} placeholder="Ülke" style={{ ...fs, width: '160px' }} />
                    <button onClick={removeCity} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🗑 Şehri sil</button>
                  </div>
                  <div style={{ fontSize: '13px', color: '#fb923c', fontWeight: '700', marginBottom: '8px' }}>🍽️ Tavsiye Edilen Restoranlar</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {cur.restaurants.map((r, i) => (
                      <div key={i} style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1.4fr 0.9fr', gap: '8px' }}>
                          <input value={r.name || ''} onChange={e => updR(i, 'name', e.target.value)} placeholder="Restoran adı *" style={{ ...fs, fontWeight: '600' }} />
                          <input value={r.cuisine || ''} onChange={e => updR(i, 'cuisine', e.target.value)} placeholder="Mutfak (ör. yerel, balık)" style={fs} />
                          <select value={r.price || ''} onChange={e => updR(i, 'price', e.target.value)} style={fs}>
                            <option value="">Fiyat —</option><option value="€">€ Uygun</option><option value="€€">€€ Orta</option><option value="€€€">€€€ Pahalı</option>
                          </select>
                        </div>
                        <textarea value={r.note || ''} onChange={e => updR(i, 'note', e.target.value)} placeholder="Tavsiye notu (ör. Plov meşhur, akşam rezervasyon önerilir)" rows={2} style={{ ...fs, marginTop: '8px', resize: 'vertical', fontFamily: 'inherit' }} />
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
                          <input value={r.address || ''} onChange={e => updR(i, 'address', e.target.value)} placeholder="Adres (boşsa haritada isimden bulunur)" style={{ ...fs, flex: 1 }} />
                          <button onClick={() => moveR(i, -1)} disabled={i === 0} title="Yukarı" style={small}>↑</button>
                          <button onClick={() => moveR(i, 1)} disabled={i === cur.restaurants.length - 1} title="Aşağı" style={small}>↓</button>
                          <button onClick={() => patchCur(c => ({ ...c, restaurants: c.restaurants.filter((_, j) => j !== i) }))} title="Sil" style={{ ...small, background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>🗑</button>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input key={`${i}-${r.mapsUrl || r.loc || ''}`} defaultValue={r.mapsUrl || r.loc || ''} placeholder="📍 Google Maps linki yapıştır (Paylaş → Bağlantıyı kopyala) veya 41.01, 28.97"
                            onBlur={e => {
                              const v = e.target.value.trim();
                              if (!v) { patchCur(c => ({ ...c, restaurants: c.restaurants.map((x, j) => j === i ? { ...x, loc: '', mapsUrl: '' } : x) })); return; }
                              const p = parseMapsInput(v);
                              if (!p) { showToast?.('Google Maps linki veya "enlem, boylam" girin', 'error'); return; }
                              patchCur(c => ({ ...c, restaurants: c.restaurants.map((x, j) => j === i ? { ...x, loc: p.loc, mapsUrl: p.mapsUrl, name: x.name || p.name } : x) }));
                              showToast?.(p.loc ? '📍 Konum alındı' : '📍 Link kaydedildi (kısa link — müşteri sayfasında doğrudan açılır)', 'success');
                            }} style={{ ...fs, flex: 1, minWidth: '220px' }} />
                          <button type="button" title="Şu an bulunduğum yeri konum olarak kaydet (yerindeyken)" onClick={() => {
                            if (!navigator.geolocation) { showToast?.('Bu cihaz konum vermiyor', 'error'); return; }
                            navigator.geolocation.getCurrentPosition(pos => {
                              const loc = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
                              patchCur(c => ({ ...c, restaurants: c.restaurants.map((x, j) => j === i ? { ...x, loc, mapsUrl: '' } : x) }));
                              showToast?.(`📍 Konum alındı (±${Math.round(pos.coords.accuracy)} m)`, 'success');
                            }, err => showToast?.('Konum alınamadı: ' + err.message, 'error'), { enableHighAccuracy: true, timeout: 15000 });
                          }} style={{ ...small, width: 'auto', padding: '0 10px', whiteSpace: 'nowrap' }}>📍 Buradayım</button>
                          {(r.loc || r.mapsUrl) && <a href={r.loc ? `https://www.google.com/maps/search/?api=1&query=${r.loc}` : r.mapsUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: '#34d399', whiteSpace: 'nowrap' }}>✓ {r.loc ? 'konum var' : 'link var'} · kontrol et</a>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', position: 'sticky', bottom: '-14px', background: '#0f2744', padding: '10px 0' }}>
                    <button onClick={() => patchCur(c => ({ ...c, restaurants: [...c.restaurants, { ...EMPTY_REST }] }))} style={{ padding: '10px 14px', background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.35)', borderRadius: '8px', color: '#fb923c', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>+ Restoran ekle</button>
                    <button onClick={save} disabled={busy || !cur.dirty} style={{ flex: 1, padding: '10px 14px', background: cur.dirty ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: cur.dirty ? '#fff' : '#64748b', cursor: busy ? 'wait' : cur.dirty ? 'pointer' : 'default', fontSize: '13px', fontWeight: '700' }}>{busy ? '⏳ Kaydediliyor...' : cur.dirty ? `💾 ${cur.city} kaydet` : '✓ Kaydedildi'}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function BulkDocInbox({ customers, setCustomers, appSettings, showToast, onClose, initialFiles }) {
  const [rows, setRows] = useState([]); // { key, file, pages, type, custIds:[], cands:[], flights:[], note }
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState(null); // [{ c, link, text, added }]
  const index = useMemo(() => buildNameIndex(customers), [customers]);
  const byId = useMemo(() => new Map((customers || []).map(c => [String(c.id), c])), [customers]);
  const nameOf = (c) => fullNameTr(c);
  const [addQ, setAddQ] = useState({}); // satır başına "+ müşteri ara" kutusu
  const setRow = (key, patch) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r));
  // Dashboard'a sürüklenip bırakılan dosyalar: pencere açılınca hemen okunur (bir kez)
  const startedRef = useRef(false);
  useEffect(() => { if (!startedRef.current && initialFiles && initialFiles.length) { startedRef.current = true; analyze(initialFiles); } }, []);

  const analyze = async (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.size <= 15 * 1024 * 1024);
    if (!files.length) return;
    setBusy('📖 Belgeler okunuyor…');
    const out = [];
    for (const [fi, file] of files.entries()) {
      const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
      if (!isPdf) { out.push({ key: `${fi}_${file.name}`, file, type: 6, custIds: [], cands: [], flights: [], note: 'Görsel — kişiyi seçin' }); continue; }
      try {
        const pages = await pdfPagesText(file);
        const per = pages.map(t => matchCustomers(index, nameWords(t)).map(c => String(c.id)));
        const owners = new Set(per.filter(ids => ids.length === 1).map(ids => ids[0]));
        if (pages.length > 1 && owners.size > 1) {
          // Kişi başı sayfalara böl; isimsiz devam sayfası önceki yolcuya
          let last = null;
          for (let i = 0; i < per.length; i++) { if (per[i].length === 1) last = per[i][0]; else if (!per[i].length && last) per[i] = [last]; }
          const groups = new Map();
          per.forEach((ids, i) => { if (ids.length === 1) groups.set(ids[0], [...(groups.get(ids[0]) || []), i]); });
          [...groups.entries()].forEach(([cid, pg], k) => {
            const txt = pg.map(i => pages[i]).join(' ');
            out.push({ key: `${fi}_${k}_${file.name}`, file, pages: pg, type: docTypeOf(txt), custIds: [cid], cands: [], flights: detectFlights(txt), hotel: detectHotel(txt), txt, note: '' });
          });
          const rest = per.map((ids, i) => ids.length === 1 ? -1 : i).filter(i => i >= 0);
          if (rest.length) out.push({ key: `${fi}_rest_${file.name}`, file, pages: rest, type: docTypeOf(rest.map(i => pages[i]).join(' ')), custIds: [], cands: [...new Set(rest.flatMap(i => per[i]))], flights: [], note: `${rest.length} sayfada kişi net değil — seçin` });
        } else {
          const all = pages.join(' ');
          const ids = matchCustomers(index, nameWords(all)).map(c => String(c.id));
          // Tek kişi → ona; birkaç kişi aynı sayfada (grup bileti/oda) → hepsine; hiç yoksa elle
          const many = ids.length > 1 && ids.length <= 12;
          out.push({ key: `${fi}_${file.name}`, file, type: docTypeOf(all), custIds: ids.length === 1 || many ? ids : [], cands: ids.length > 12 ? ids.slice(0, 12) : [], flights: detectFlights(all), hotel: detectHotel(all), txt: all,
            note: !pages.join('').trim() ? 'PDF\'de metin yok (taranmış) — kişiyi seçin' : !ids.length ? 'İsim bulunamadı — kişiyi seçin' : many ? 'Birden fazla kişi — kontrol edin' : '' });
        }
      } catch (e) { out.push({ key: `${fi}_${file.name}`, file, type: 6, custIds: [], cands: [], flights: [], note: 'PDF okunamadı — kişiyi seçin' }); }
    }
    setRows(rs => [...rs, ...out]);
    setBusy('');
  };

  const run = async () => {
    const todo = rows.filter(r => r.custIds.length);
    if (!todo.length) return;
    setBusy('⬆️ Yükleniyor…');
    try {
      const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      // Kişi başı: link (token) + mevcut yolculuk bilgisi
      const perCust = new Map();
      for (const r of todo) {
        const part = r.pages ? await pdfExtractPages(r.file, r.pages) : r.file;
        for (const cid of r.custIds) {
          const c = byId.get(cid); if (!c) continue;
          if (!perCust.has(cid)) perCust.set(cid, { c, token: c.shareToken || customerLinkSlug(c), trip: { title: '', city: '', country: '', startDate: '', endDate: '', hotelName: '', hotelAddress: '', flights: [], docs: [], ...safeParseObj(c.shareTrip) }, added: [] });
          const pc = perCust.get(cid);
          const safe = asciiTr(part.name).replace(/[^\w.\-]+/g, '_').slice(-80);
          const path = `paylasim/${pc.token}/${Date.now()}_${safe}`;
          const sr = ref(getStorage(), path);
          await uploadBytes(sr, part, { contentType: part.type || 'application/pdf' });
          const [icon, label] = CUST_DOC_TYPES[r.type];
          const newDocId = generateUniqueId();
          pc.trip.docs = [...(pc.trip.docs || []), { id: newDocId, icon, label, url: await getDownloadURL(sr), path, name: part.name, addedAt: new Date().toISOString() }];
          pc.added.push(`${icon} ${label}`);
          // Otel giriş belgesi → otel adı, adres, giriş/çıkış (en yeni belge esas)
          if (CUST_DOC_TYPES[r.type]?.[0] === '🏨' && r.hotel) {
            if (r.hotel.name) pc.trip.hotelName = r.hotel.name;
            if (r.hotel.address) pc.trip.hotelAddress = r.hotel.address;
            if (r.hotel.checkIn) { pc.trip.hotelCheckIn = r.hotel.checkIn; pc.trip.hotelCheckOut = r.hotel.checkOut || ''; }
            pc.trip.hotelDocId = newDocId;
            if (r.hotel.checkIn && !pc.trip.startDate) pc.trip.startDate = r.hotel.checkIn;
            if (r.hotel.checkOut && !pc.trip.endDate) pc.trip.endDate = r.hotel.checkOut;
          }
          // Uçuşlar + boş tarih/şehir/başlık
          const fl = [...(pc.trip.flights || [])];
          if (icon === '✈️') (r.flights || []).forEach(x => { if (!fl.some(y => sameFlight(y, x))) fl.push({ ...x, docId: newDocId }); });
          fl.sort((a, b) => String(a.ymd).localeCompare(String(b.ymd)));
          pc.trip.flights = fl;
          if (fl.length) {
            if (!pc.trip.startDate) pc.trip.startDate = fl[0].ymd;
            if (!pc.trip.endDate) pc.trip.endDate = fl[fl.length - 1].ymd;
            if (!pc.trip.city) pc.trip.city = fl[0].toCity;
            if (!pc.trip.title) pc.trip.title = `${fl[0].fromCity} → ${fl[0].toCity}`;
          }
        }
      }
      const results = [];
      for (const pc of perCust.values()) {
        const { link, text } = await publishCustomerLink(pc.c, pc.trip, pc.token, appSettings);
        results.push({ c: pc.c, link, text, added: pc.added, isNew: !pc.c.shareToken });
      }
      const patches = new Map(results.map(r => [String(r.c.id), { shareToken: r.link.split('/m/')[1], shareTrip: JSON.stringify(perCust.get(String(r.c.id)).trip) }]));
      setCustomers(prev => prev.map(c => patches.has(String(c.id)) ? { ...c, ...patches.get(String(c.id)) } : c));
      setDone(results);
      showToast?.(`✅ ${todo.length} belge ${results.length} müşterinin linkine eklendi`, 'success');
    } catch (e) { showToast?.('❌ Yükleme hatası: ' + e.message, 'error'); }
    finally { setBusy(''); }
  };

  const inS = { padding: '6px 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#e8f1f8', fontSize: '12px' };
  const ready = rows.filter(r => r.custIds.length).length;
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f2744', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '14px', padding: '18px', width: '100%', maxWidth: '720px', maxHeight: '92vh', overflowY: 'auto', color: '#e8f1f8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>📤 Belge Yükle — müşteri linklerine</h3>
          <button onClick={onClose} disabled={!!busy} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '22px', cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ margin: '4px 0 12px', fontSize: '11px', color: '#64748b' }}>Bilet, biniş kartı, otel belgesi… PDF'leri bırakın. İsimden müşteri, metinden belge türü bulunur; toplu PDF kişi başı bölünür. Kontrol edip yükleyin.</p>

        {done ? (<>
          <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>✅ {done.length} müşterinin linki güncellendi</div>
          {done.map(r => (
            <div key={r.c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', marginBottom: '6px' }}>
              <div style={{ flex: 1, minWidth: '160px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{nameOf(r.c)} {r.isNew && <span style={{ fontSize: '10px', color: '#22c55e' }}>· yeni link</span>}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>{r.added.join(', ')}</div>
              </div>
              <a href={waUrl(formatWhatsAppPhone(r.c.phone) || '', r.text)} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 12px', background: '#22c55e', borderRadius: '8px', color: '#fff', fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}>💬 Gönder</a>
              <button onClick={() => window.open(r.link, '_blank')} style={{ ...inS, cursor: 'pointer' }}>👁️</button>
            </div>
          ))}
          <p style={{ fontSize: '11px', color: '#64748b' }}>Linki daha önce gönderilmiş müşterilerde belge aynı linke eklendi — tekrar göndermek şart değil.</p>
          <button onClick={() => { setDone(null); setRows([]); }} style={{ ...inS, padding: '10px', width: '100%', cursor: 'pointer' }}>➕ Yeni belgeler yükle</button>
        </>) : (<>
          <label style={{ display: 'block', padding: '22px', border: '2px dashed rgba(59,130,246,0.45)', borderRadius: '12px', textAlign: 'center', cursor: busy ? 'wait' : 'pointer', background: 'rgba(59,130,246,0.06)' }}
            onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) analyze(e.dataTransfer.files); }}>
            <div style={{ fontSize: '28px' }}>📎</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#60a5fa' }}>{busy || 'PDF\'leri buraya sürükleyin veya seçin'}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Birden fazla dosya olabilir · toplu bilet PDF'i kişilere ayrılır</div>
            <input type="file" multiple accept="application/pdf,image/*" disabled={!!busy} style={{ display: 'none' }} onChange={e => { analyze(e.target.files); e.target.value = ''; }} />
          </label>

          {rows.length > 0 && <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {rows.map(r => (
              <div key={r.key} style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${r.custIds.length ? 'rgba(16,185,129,0.35)' : 'rgba(234,179,8,0.4)'}` }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={r.type} onChange={e => setRow(r.key, { type: +e.target.value })} style={inS}>
                    {CUST_DOC_TYPES.map(([i, l], k) => <option key={l} value={k} style={{ background: '#0c1929' }}>{i} {l}</option>)}
                  </select>
                  <span style={{ fontSize: '11px', color: '#94a3b8', flex: 1, minWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {r.file.name}{r.pages ? ` · s.${r.pages.map(p => p + 1).join(',')}` : ''}{r.flights?.length ? ` · ✈️ ${r.flights.map(f => f.code).join(', ')}` : ''}</span>
                  <button onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))} title="Çıkar" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>🗑</button>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' }}>
                  {r.custIds.map(id => { const c = byId.get(id); return c && (
                    <span key={id} style={{ display: 'inline-flex', flexDirection: 'column', background: 'rgba(16,185,129,0.15)', color: '#10b981', borderRadius: '10px', padding: '3px 8px', fontSize: '12px' }}>
                      <span>👤 {nameOf(c)}{c.shareToken ? '' : ' · yeni link'}
                      <button onClick={() => setRow(r.key, { custIds: r.custIds.filter(x => x !== id) })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', marginLeft: '4px' }}>×</button></span>
                      {(() => { const k = nameCheck(c, r.txt); return k.msg ? <span style={{ fontSize: '10.5px', color: NAMECHK_COLOR[k.level], fontWeight: k.level === 'ok' ? 400 : 600 }}>{k.msg}</span> : null; })()}
                      {['✈️', '🛫', '🛬', '🏨'].includes(CUST_DOC_TYPES[r.type]?.[0]) && (r.flights?.length || r.hotel?.checkIn) ? <TravelCheckBox compact c={c} trip={{ flights: r.flights, hotelCheckIn: r.hotel?.checkIn, hotelCheckOut: r.hotel?.checkOut, hotelName: r.hotel?.name, hotelAddress: r.hotel?.address, country: r.flights?.length ? '' : safeParseObj(c.shareTrip).country }} /> : null}
                    </span>); })}
                  {r.cands.filter(id => !r.custIds.includes(id)).map(id => { const c = byId.get(id); return c && (
                    <button key={id} onClick={() => setRow(r.key, { custIds: [...r.custIds, id] })} style={{ ...inS, cursor: 'pointer', color: '#fbbf24' }}>＋ {nameOf(c)}</button>); })}
                  <div style={{ width: '200px' }}><CustomerNameInput customers={customers} placeholder="+ müşteri ara…" value={addQ[r.key] || ''} label={nameOf} clearOnPick style={{ ...inS, width: '100%' }}
                    onChange={v => setAddQ(x => ({ ...x, [r.key]: v }))}
                    onPick={c => setRow(r.key, { custIds: r.custIds.includes(String(c.id)) ? r.custIds : [...r.custIds, String(c.id)] })} /></div>
                  {CUST_DOC_TYPES[r.type]?.[0] === '🏨' && (r.hotel ? <span style={{ fontSize: '11px', color: '#06b6d4' }}>🏨 {r.hotel.name || 'Otel adı okunamadı'}{r.hotel.checkIn ? ` · ${formatDate(r.hotel.checkIn)}${r.hotel.checkOut ? ' – ' + formatDate(r.hotel.checkOut) : ''}` : ' · tarih okunamadı'}</span> : <span style={{ fontSize: '11px', color: '#eab308' }}>🏨 Otel bilgisi okunamadı — belge yine linke eklenir</span>)}
                  {r.note && !r.custIds.length && <span style={{ fontSize: '11px', color: '#eab308' }}>⚠️ {r.note}</span>}
                  {r.note && r.custIds.length > 1 && <span style={{ fontSize: '11px', color: '#eab308' }}>⚠️ {r.note}</span>}
                </div>
              </div>
            ))}
            <button onClick={run} disabled={!!busy || !ready} style={{ marginTop: '6px', padding: '12px', background: ready ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
              {busy || `⬆️ ${ready} belgeyi müşteri linklerine yükle`}
            </button>
          </div>}
        </>)}
      </div>
    </div>
  );
}

export const userShortcuts = (u) => {
  const ids = Array.isArray(u?.shortcuts) ? u.shortcuts : DEFAULT_SHORTCUTS;
  return ids.map(id => SHORTCUTS.find(x => x.id === id)).filter(Boolean);
};

// ===== MÜŞTERİ LİNKİ: turdan bağımsız, her müşteriye kalıcı tek link (/m/<kod>, public/musteri.html) — tur linki (/b/) ayrı =====
// Kurumsal/bireysel satışlarda bilet, otel belgesi, vize vb. WhatsApp'a tek tek atmak yerine buradan gönderilir.
// Link tur linkiyle aynı sayfayı kullanır (belgeler, uçuş takibi, hava, kur, saat farkı, otel yol tarifi).
// Belgeler eklendikçe aynı link güncellenir; müşteriye yeniden göndermek gerekmez.
export const CUST_DOC_TYPES = [['✈️', 'Uçak Bileti'], ['🛫', 'Biniş Kartı'], ['🏨', 'Otel Belgesi'], ['🛂', 'Vize'], ['🛡️', 'Seyahat Sigortası'], ['🎫', 'Fuar / Etkinlik Bileti'], ['📄', 'Diğer']];

export const DEFAULT_SHORTCUTS = ['visa-new', 'cust-new', 'ds160-link', 'tour-new', 'offer-new', 'quote-new', 'contract-new', 'tavsiye'];

// ⚡ Dashboard kısayolları — her kullanıcı Ayarlar → Kısayollarım'dan kendi listesini seçer (users/<id>.shortcuts).
// act: modülde açılacak form (quickAction); null → sadece modüle git; 'link' → DS-160 linki kopyala; url → yeni sekme
export const SHORTCUTS = [
  { id: 'visa-new', mod: 'visa', act: 'new', icon: '🌍', label: 'Yeni Vize Başvurusu', color: '#10b981' },
  { id: 'cust-new', mod: 'customers', act: 'new', icon: '👤', label: 'Yeni Müşteri', color: '#3b82f6' },
  { id: 'ds160-link', mod: 'ds160', act: 'link', icon: '🇺🇸', label: 'Amerika Vize Linki', color: '#8b5cf6' },
  { id: 'tour-new', mod: 'tours', act: 'new', icon: '🎫', label: 'Yeni Tur', color: '#f59e0b' },
  { id: 'offer-new', mod: 'tours', act: 'offer', icon: '🧾', label: 'Yeni Tur Teklifi', color: '#e8912a' },
  { id: 'quote-new', mod: 'quotes', act: 'new', icon: '📄', label: 'Yeni Teklif / Proforma', color: '#ef4444' },
  { id: 'contract-new', mod: 'quotes', act: 'contract', icon: '📜', label: 'Yeni Sözleşme', color: '#6366f1' },
  { id: 'tavsiye', mod: 'tavsiyeler', act: null, icon: '⭐', label: 'Tavsiye Ekle', color: '#fb923c' },
  { id: 'go-customers', mod: 'customers', act: null, icon: '👥', label: 'Müşteriler', color: '#3b82f6' },
  { id: 'go-visa', mod: 'visa', act: null, icon: '🛂', label: 'Vize Başvuruları', color: '#10b981' },
  { id: 'go-ds160', mod: 'ds160', act: null, icon: '🗽', label: 'Amerika Vize (DS-160)', color: '#8b5cf6' },
  { id: 'go-tours', mod: 'tours', act: null, icon: '🧳', label: 'Turlar', color: '#f59e0b' },
  { id: 'go-hotels', mod: 'hotels', act: null, icon: '🏨', label: 'Oteller ve Uçuşlar', color: '#06b6d4' },
  { id: 'go-quotes', mod: 'quotes', act: null, icon: '🗂️', label: 'Teklif & Proforma', color: '#ef4444' },
  { id: 'go-duyuru', mod: 'linkduyuru', act: null, icon: '📢', label: 'Duyurular / Linkler', color: '#f59e0b' },
  { id: 'go-agencies', mod: 'agencies', act: null, icon: '🏢', label: 'Acentelikler', color: '#64748b' },
  { id: 'go-cards', mod: 'cards', act: null, icon: '💳', label: 'Kredi Kartları', color: '#a855f7' },
  { id: 'go-bank', mod: 'bankinfo', act: null, icon: '🏦', label: 'Banka Bilgileri', color: '#e8912a' },
  { id: 'go-log', mod: 'activitylog', act: null, icon: '📋', label: 'İşlemler', color: '#94a3b8' },
  { id: 'vizeevrak', mod: null, url: 'https://vize.paydostur.com/#/panel', icon: '📁', label: 'Vize Evrak Paneli', color: '#14b8a6' },
];

// Müşteri ad-soyad kelimeleri (eşleştirme dizini) — en az 2 kelime (tek kelimelik isimler yanlış eşleşir)
export const buildNameIndex = (customers) => (customers || []).map(c => ({ c, w: [...nameWords(`${c.firstName || ''} ${c.lastName || ''}`)].filter(x => x.length > 1) })).filter(x => x.w.length >= 2);

// Okunabilir müşteri linki: /m/onder-tasci-k7m2q — isim + 5 karakterlik gizli ek (≈33 milyon olasılık).
// Sadece isim olsaydı herkes başkasının adını yazıp belgelerine ulaşabilirdi (KVKK); ek bunu engeller.
export const customerLinkSlug = (c) => {
  const base = asciiTr(`${c.firstName || ''} ${c.lastName || ''}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'musteri';
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(5)), x => abc[x % abc.length]).join('');
  return `${base}-${tail}`;
};

// ===== TOPLU BELGE YÜKLEME (tek yükleme yeri) =====
// Biletçi/otelci bilet, biniş kartı, otel belgesi… PDF'lerini buraya bırakır. Sistem her sayfadaki yolcu adını
// tüm müşterilerle eşleştirir, belge türünü metinden tanır, çok sayfalı PDF'i kişi başı böler ve her kişinin
// müşteri linkine ekler (link yoksa oluşturur). Biletten uçuşlar ve tarihler de linke işlenir.
export const docTypeOf = (text) => {
  const t = asciiTr(String(text || '')).toUpperCase();
  if (/BOARDING\s*PASS|BINIS\s*KART|BOARDING\s*TIME|GATE\s*CLOSES/.test(t)) return 1;          // 🛫 Biniş Kartı
  // Bilet önce: uçak biletlerinde de "online check-in", bazen "hotel" reklamı geçer — otel sanılmasın
  const flightCode = /\b(?:TK|PC|VF|XQ|XC|J2|LH|AF|KL|BA|EK|QR|FZ|W6|FR|U2|SU|A3|OS|LX|LO|KC|HY|G9|SV|MS|RJ|AZ|IB|VY|TP|SK|AY)\s?\d{2,4}\b/.test(t);
  if (/E-?\s?TICKET|ELECTRONIC\s*TICKET|ELEKTRONIK\s*BILET|TICKET\s*(NUMBER|NO|DETAILS?)|BILET\s*(NUMARASI|BILGI|DETAY)|ITINERARY|ETKT|BOOKING\s*REF|REZERVASYON\s*KODU|\bPNR\b|PASSENGER|YOLCU\s*(ADI|BILGI)|FLIGHT\s*(NO|NUMBER|DETAILS?)|UCUS\s*(NO|BILGI|DETAY)|DEPARTURE\s*TIME|KALKIS\s*SAATI|BAGGAGE|BAGAJ/.test(t)
    && (flightCode || /FLIGHT|UCUS|AIRLINES?|HAVAYOLU|AIRPORT|HAVALIMANI|\([A-Z]{3}\)/.test(t))) return 0;      // ✈️ Uçak Bileti
  if (/HOTEL|OTEL|VOUCHER|ACCOMMODATION|KONAKLAMA|ROOM\s*TYPE|ODA\s*TIPI|GUEST\s*NAME|MISAFIR/.test(t)) return 2; // 🏨 Otel Belgesi
  if (flightCode && /FLIGHT|UCUS|AIRLINES?|HAVAYOLU|AIRPORT|HAVALIMANI|CHECK-?\s?IN/.test(t)) return 0; // ✈️ (etiketsiz bilet)
  if (/INSURANCE|SIGORTA|POLICE\s*NO|POLICY\s*(NUMBER|NO)/.test(t)) return 4;                    // 🛡️ Sigorta
  if (/\bVISA\b|\bVIZE\b|SCHENGEN/.test(t)) return 3;                                           // 🛂 Vize
  return 6;                                                                                       // 📄 Diğer
};

// Metindeki kelimelere göre müşterileri bul; en çok kelimesi tutan(lar) döner
export const matchCustomers = (index, words) => {
  const hits = index.filter(x => x.w.every(w => words.has(w)) || (x.w.length >= 3 && words.has(x.w[0]) && words.has(x.w[x.w.length - 1])));
  if (hits.length < 2) return hits.map(h => h.c);
  const score = (h) => h.w.filter(w => words.has(w)).length;
  const max = Math.max(...hits.map(score));
  return hits.filter(h => score(h) === max).map(h => h.c);
};

// Müşteri linkini yayınla: paylasimlar/<kod> + müşteri kartına shareToken/shareTrip. Hem tek tek (Müşteri Linki)
// hem toplu belge yüklemede kullanılır. Döner: { link, text } (WhatsApp mesajı şablondan)
export const publishCustomerLink = async (c, trip, token, appSettings) => {
      const name = fullNameTr(c);
      const fl = (trip.flights || []).filter(f => /^[A-Z0-9]{2}\d{1,4}$/.test(String(f.code || '').toUpperCase().replace(/[\s-]/g, '')) || (!f.code && f.from && f.to && f.ymd));
      const flights = fl.map((f, i) => ({
        dir: fl.length === 2 ? (i === 0 ? 'Gidiş' : 'Dönüş') : 'Uçuş',
        code: String(f.code || '').toUpperCase().replace(/[\s-]/g, ''), airline: f.airline || '',
        date: f.ymd ? formatDate(f.ymd) : '', ymd: f.ymd || '', // ymd: linkte sıradaki uçuşu bulmak için
        dep: [f.fromCity, f.from].filter(Boolean).join(' ') + (f.dep ? ` · ${f.dep}` : ''),
        arr: [f.toCity, f.to].filter(Boolean).join(' ') + (f.arr ? ` · ${f.arr}${f.arrNext ? '(+1)' : ''}` : ''),
      }));
      // until: belgenin seyahat tarihi (biletteki son uçuş / otel çıkışı) — linkte tarihi geçenler "Geçmişim"e iner
      const untilOf = (d) => {
        const fy = (trip.flights || []).filter(f => d.id && f.docId === d.id && /^\d{4}-\d{2}-\d{2}$/.test(String(f.ymd || ''))).map(f => f.ymd).sort().pop();
        if (fy) return fy;
        if (d.id && trip.hotelDocId === d.id && /^\d{4}-\d{2}-\d{2}$/.test(String(trip.hotelCheckOut || ''))) return trip.hotelCheckOut;
        return '';
      };
      const docs = (trip.docs || []).map(d => ({ icon: d.icon, label: d.label, url: d.url, addedAt: d.addedAt || '', until: untilOf(d) })); // addedAt: linkte aya göre gruplama
      await setDoc(doc(db, 'paylasimlar', token), {
        kind: 'customer', customerName: name, tourName: trip.title || '', country: trip.country || '', city: trip.city || '',
        startDate: trip.startDate || '', endDate: trip.endDate || '', docs, flights,
        hotel: trip.hotelName ? { name: trip.hotelName, address: trip.hotelAddress || '', city: trip.city || '', country: trip.country || '', phone: '', checkIn: trip.hotelCheckIn || '', checkOut: trip.hotelCheckOut || '' } : null,
        contact: { phone: appSettings?.shareContact?.phone || '+90 258 263 71 76', whatsapp: appSettings?.shareContact?.whatsapp || '', instagram: appSettings?.shareContact?.instagram ?? 'paydostur', hours: appSettings?.shareContact?.hours || '' },
        customerDocId: c._docId || String(c.id), // PIN belirlenince sunucu müşteri kartına yazar (linkPin)
        updatedAt: new Date().toISOString(),
      }, { merge: true }); // merge: müşterinin belirlediği PIN güncellemede silinmesin
      const shareTrip = JSON.stringify(trip);
      await setDoc(doc(db, 'customers', c._docId || String(c.id)), { shareToken: token, shareTrip }, { merge: true });
      const link = `${window.location.origin}/m/${token}`;
      const belgeler = [...docs.map(d => d.label), ...(flights.length ? ['Uçuş Takibi'] : [])].filter((x, i, a) => a.indexOf(x) === i).join(', ');
      const tpl = (appSettings?.shareMessageTemplate || '').trim() || DEFAULT_SHARE_MSG;
      let text = tpl.replace(/\{isim\}/g, name).replace(/\{tur\}/g, trip.title || 'Seyahatiniz').replace(/\{belgeler\}/g, belgeler).replace(/\{link\}/g, link);
      if (!text.includes(link)) text += `\n${link}`;
  return { link, text };
};

// TUR MODÜLÜ - TAM VERSİYON
// Tur belge linki WhatsApp mesajı — Ayarlar > Tur'dan değiştirilebilir. {isim} {tur} {belgeler} {link}
export const DEFAULT_SHARE_MSG = 'Sayın {isim},\n\n{tur} için belgeleriniz ({belgeler}):\n{link}\n\nİyi yolculuklar dileriz.\nPaydos Turizm';

export async function sendVisaEmail({ visa, customer, appSettings }) {
  try {
    const vize_turu = visa.visaDuration || visa.visaType || '';
    const catId = visa.categoryId || 'schengen';
    const templates = appSettings?.emailTemplates || {};
    const template = templates[vize_turu] || templates[catId];
    if (!template || (!template.subject && !template.body)) return { ok: false, error: 'Şablon bulunamadı veya boş' };

    const email = customer?.email || visa?.customerEmail;
    if (!email) return { ok: false, error: 'Müşteri e-postası yok' };

    const isim = `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim() || visa.customerName || '';
    const tarih = new Date().toLocaleDateString('tr-TR');
    const ref_no = String(visa.id || '').slice(-8).toUpperCase() || '-';
    const ulke = visa.country || catId;

    const replace = (str) => str
      .replace(/{isim}/g, isim)
      .replace(/{ulke}/g, ulke)
      .replace(/{tarih}/g, tarih)
      .replace(/{saat}/g, '')
      .replace(/{ref_no}/g, ref_no)
      .replace(/{vize_turu}/g, vize_turu);

    const subject = replace(template.subject || '');
    const bodyText = replace(template.body || '');
    const html = mailHtml(bodyText);

    // Vize türüne bağlı ekleri bul
    const allAttachments = appSettings?.attachments || [];
    const linkedAttachments = allAttachments.filter(a => a.linkedTypes?.includes(vize_turu));

    const resp = await sendMailRequest({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject,
        html,
        text: bodyText,
        attachments: linkedAttachments.map(a => ({ filename: a.name, url: a.url })),
        smtp: appSettings?.smtpVisa
      })
    });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data.error || 'Gönderim hatası' };
    return { ok: true, attachmentCount: linkedAttachments.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ===== Vize maliyet kalemleri (kategori bazlı) =====
export const VISA_COST_CATEGORIES = [
  { id: 'schengen', label: 'Schengen', icon: '🇪🇺' },
  { id: 'russia', label: 'Rusya', icon: '🇷🇺' },
  { id: 'uae', label: 'BAE (Dubai)', icon: '🇦🇪' },
  { id: 'usa', label: 'Amerika', icon: '🇺🇸' },
  { id: 'uk', label: 'İngiltere', icon: '🇬🇧' },
  { id: 'china', label: 'Çin', icon: '🇨🇳' },
  { id: 'other', label: 'Diğer', icon: '🌍' }
];

// visaCostItems iki biçimde olabilir: eski düz dizi [...] veya kategori bazlı { schengen: [...], usa: [...] }
export const getVisaCostItems = (appSettings, category) => {
  const raw = appSettings?.visaCostItems;
  if (Array.isArray(raw)) return raw.length ? raw : DEFAULT_VISA_COST_ITEMS;
  const list = raw && raw[category || 'schengen'];
  return Array.isArray(list) && list.length ? list : DEFAULT_VISA_COST_ITEMS;
};

export const DEFAULT_VISA_COST_ITEMS = [
  { key: 'konsolosluk', label: 'Konsolosluk Bedeli' },
  { key: 'araci', label: 'Aracı Hizmet Bedeli' },
  { key: 'sigorta', label: 'Sigorta' },
  { key: 'vfs', label: 'iData / VFS Hiz. Bed.' },
  { key: 'koordinasyon', label: 'Koordinasyon' },
  { key: 'sms', label: 'SMS' },
  { key: 'kargo', label: 'Kargo' },
  { key: 'kdv', label: 'KDV' },
  { key: 'diger', label: 'Diğer' }
];

// ===== GLOBAL: TUR TEKLİFİ/PROGRAM HTML ÜRETİCİ (Quotes + Tours ortak) =====
// ===== TUR TEKLİFİ: yazdırılabilir şık HTML üretici =====
export const TR_AYLAR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

export const contractSure = (c) => {
  if (!c.startDate || !c.endDate) return '';
  const a = new Date(c.startDate + 'T00:00:00'), b = new Date(c.endDate + 'T00:00:00');
  const gece = Math.round((b - a) / 86400000);
  if (isNaN(gece) || gece < 0) return '';
  return `${gece} Gece ${gece + 1} Gündür`;
};

export const genContractHTML = (c, bankInfo) => {
  const BKS = (Array.isArray(bankInfo) ? bankInfo : [bankInfo]).filter(Boolean).map(b => ({ ...DEFAULT_BANK, ...b }));
  if (!BKS.length) BKS.push(DEFAULT_BANK);
  const e = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const P = (arr) => arr.map(x => `<p>${e(x)}</p>`).join('');
  const S = SOZLESME_SABIT;
  const secTitle = (t) => `<h2>${e(t)}</h2>`;
  const body = (arr) => P(arr.slice(1));
  const progHTML = (c.programDays || []).filter(d => (d.items||[]).some(i => (i.time||'').trim() || (i.text||'').trim()))
    .map(d => `<div class="pd"><b>${e(d.title)}</b> ${e(d.date)}${(d.place||'').trim() ? ` — <b>${e(d.place)}</b>` : ''}<br>${(d.items||[]).filter(i => (i.time||'').trim() || (i.text||'').trim()).map(i => `${i.time ? `<b>${e(i.time)}</b> — ` : ''}${e(i.text)}`).join('<br>')}</div>`).join('');
  const ppRows = (c.passports || []).filter(p => p.name || p.no).map(p =>
    `<tr><td>${e(p.name)}</td><td>${e(p.no)}</td><td>${e(trTarih(p.issueDate) || p.issueDate)}</td><td>${e(trTarih(p.expiryDate) || p.expiryDate)}</td><td>${e(p.birthPlace)}</td></tr>`).join('');
  const katRows = (c.katilimcilar || []).filter(k => k.name).map((k, i) =>
    `<p><b>KATILIMCI ${i+1}</b><br>- AD/SOYAD: ${e(k.name)}<br>- T.C. KİMLİK NO: ${e(k.tc)}<br>- ADRES: ${e(k.address)}<br>- İLETİŞİM: ${e(k.phone)}</p>`).join('');
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>Paket Tur Sözleşmesi</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:9.5px;line-height:1.45;color:#1a1a1a;padding:16px;max-width:820px;margin:0 auto;background:#fff}
h1{text-align:center;font-size:16px;color:#0c2340;margin-bottom:2px}
.sub{text-align:center;font-size:9px;color:#666;margin-bottom:10px}
h2{background:#0c2340;color:#fff;font-size:11px;padding:5px 9px;margin:12px 0 6px;border-left:4px solid #e8912a;border-radius:2px}
p{margin:0 0 4px;text-align:justify}
table{width:100%;border-collapse:collapse;margin:6px 0}
th,td{border:1px solid #bbb;padding:4px 6px;font-size:9px;text-align:left;vertical-align:top}
th{background:#eef3f8;font-weight:700;color:#0c2340}
.info th{width:32%;background:#f4f7fa}
.pd{margin:3px 0;padding-left:6px;border-left:2px solid #e8912a}
.sig{margin-top:18px;display:flex;gap:30px}
.sig div{flex:1;border-top:1px solid #666;padding-top:4px;font-size:9px}
.hl{background:#fffbe6}
</style></head><body>
<h1>PAKET TUR SÖZLEŞMESİ</h1>
<div class="sub">6502 Sayılı Tüketicinin Korunması Hakkında Kanun ve Paket Tur Sözleşmeleri Yönetmeliği kapsamında düzenlenmiştir.</div>

<h2>1) TARAFLAR</h2>
<p><b>1.1. DÜZENLEYİCİ:</b> PAYDOS TURİZM SEYAHAT ACENTALIĞI SANAYİ VE TİCARET LİMİTED ŞİRKETİ<br>
Mehmetçik Mah. Ulus Cad. No:124/1 Pamukkale / DENİZLİ · Tel: 0 258 263 71 76 · info@paydostur.com</p>
<p><b>1.2. TÜKETİCİ:</b><br>- AD/SOYAD: ${e(c.tuketici.name)}${c.tuketici.company ? `<br>- FİRMA: ${e(c.tuketici.company)}` : ''}<br>- T.C. KİMLİK NO: ${e(c.tuketici.tc)}<br>- ADRES: ${e(c.tuketici.address)}<br>- İLETİŞİM BİLGİLERİ (Telefon–Faks–E-mail): ${e(c.tuketici.phone)}${c.tuketici.email ? ' · ' + e(c.tuketici.email) : ''}</p>
${katRows}
<p>Tüketici, yukarıda belirtilen katılımcılar adına işbu sözleşmeye taraf olduğunu, ön bilgilendirme formu ve broşürün kendisine verildiğini kabul ve beyan eder. Kimlik ve iletişim bilgilerinin hatalı bildirilmesinden doğan neticelerden (havayolu cezası, vize sorunu vb.) Düzenleyici sorumlu değildir.</p>
${ppRows ? `<p><b>1.3. PASAPORT BİLGİLERİ</b></p><table><tr><th>Ad Soyad</th><th>Pasaport No</th><th>Veriliş</th><th>Geçerlilik</th><th>Doğum Yeri</th></tr>${ppRows}</table>` : ''}

${secTitle(S.m2[0])}${body(S.m2)}

<h2>3) PAKET TUR NİTELİKLERİ ve SÜRESİ</h2>
<p><b>3.1.</b> Paket tur <b>${e(trTarih(c.startDate))}</b> hareket tarihi <b>${e(trTarih(c.endDate))}</b> dönüş tarihi olmak üzere toplam <b>${e(contractSure(c))}</b>. Paket turun başlangıç ve bitiş yeri <b>${e(c.baslangicYeri)}</b>'dir. (24 saat dilimi olarak belirtilmiştir.)</p>
<table class="info">
<tr><th>DURAKLAMA YERLERİ ve GÜZERGAH</th><td>${e(c.guzergah)}</td></tr>
<tr><th>KONAKLAMA TARİHLERİ, TÜRÜ, YERİ, NİTELİĞİ, SINIFI, SÜRESİ</th><td>${e(c.konaklama)}</td></tr>
<tr><th>YEMEK PLANI</th><td>${e(c.yemekPlani)}</td></tr>
<tr><th>ULAŞIM ARAÇLARININ TÜRÜ, YOLCULUĞUN SINIFI, HAREKET VE DÖNÜŞ TARİHLERİ, SAATLERİ VE YERLERİ</th><td>${e(c.ulasim)}${progHTML ? `<div style="margin-top:5px">${progHTML}</div>` : ''}</td></tr>
<tr><th>YOLCULUKLA İLGİLİ BELİRLİ YER TAHSİSİ VARSA BU YER İLE İLGİLİ BİLGİ</th><td>${e(c.yerTahsisi)}</td></tr>
<tr><th>ARA KONAKLAMA YERİ, TARİHİ VE AKTARMA BİLGİLERİ</th><td>${e(c.araKonaklama)}</td></tr>
<tr><th>PASAPORT GENEL BİLGİLERİ</th><td>
• T.C. yeşil pasaportu ile seyahat edecek misafirlerimizin, eğer pasaportlarının alınış tarihi 10 yıldan eski ise; pasaportlarını yenilemeleri gereklidir. Aksi halde gidecekleri ülkeye kabul edilmeyebilirler ve/veya Türkiye'den havayolu firması tarafından uçuşları gerçekleştirilmeyebilir. Böyle bir durumda sorumluluk yolcuya aittir, Acente hiçbir şekilde sorumluluk yüklenemez.<br>
• Yırtık, yıpranmış, ıslanmış ve/veya benzeri tahribat(lar)a uğramış pasaportlar nedeniyle ziyaret edilecek ülke sınır kapısında gümrük polisi ile sorun yaşanmaması adına; anılan pasaportların yenilenmesi ve T.C. vatandaşlarına vize uygulayan bir ülke ise ilgili vizenin yeni pasaportta olması gerekmektedir. Aksi durumda sorumluluk yolcuya aittir.<br>
• Acente Yolcu ile konsolosluk arasında aracı konumundadır. Konsolosluk gerekli gördüğü durumlarda vize vermeme hakkına sahiptir. Yolcunun vize alamaması ile ilgili olarak Acente'nin hiçbir sorumluluğu yoktur. Acente sadece aracı kurum görevini üstlenmektedir. Şahsi vize başvurularında Acente'nin herhangi bir yaptırımı ve sorumluluğu bulunmamaktadır. Tüketiciler bu şartları kabul ederek tura kayıt yaptırmışlardır.
</td></tr>
<tr><th>VİZE ŞARTLARI</th><td><b>${e(c.vizeSarti)}</b><br>
Vize gereken turlarımız için misafirlerimizin ilgili ülke konsolosluklarına şahsen başvuru ile ya da acenta vize departmanı aracılığı ile vize almaları gerekmektedir. Vize başvurusu için tur bitiş tarihi itibariyle en az 6 ay geçerli pasaport ile acentamızdan temin edebileceğiniz, vize için gerekli evraklar listesinde belirtilen belgeler gerekmektedir. Yeşil pasaport ve T.C. dışında herhangi bir ülke pasaport sahipleri için vize uygulaması olup olmadığını lütfen ilgili konsolosluk veya bakanlıklardan teyit ediniz. Vizeler seyahat başlangıcından önce Türkiye'deki ilgili konsolosluklardan alınmak zorundadır. Giriş yapılan ülkenin sınır kapılarında vize alınamaz. Vize alınmış olması o ülkeye giriş yapılabileceği anlamına gelmez. Pasaport polisi sizi ülkeye sokmama yetkisine sahiptir. Böyle bir durumda sorumluluk yolcuya aittir, Acenta hiçbir şekilde sorumluluk yüklenemez.
</td></tr>
<tr><th>YAŞ VE SAĞLIK ŞARTLARI</th><td>${e(c.yasSarti)} ${e(c.asiSarti)}${c.iklimNot ? '<br>' + e(c.iklimNot) : ''}</td></tr>
</table>

<h2>4) SÖZLEŞME FİYATI</h2>
<p><b>4.1.</b> Sözleşme, vergiler ile tüketiciye verilen broşürde yer alan ve fiyata dahil olan tüm hizmetler dahil 2 kişilik odada kişi başı <b>${e(c.fiyatDouble)} ${e(c.paraBirimi)}</b>'dır. Tek kişi konaklama <b>${e(c.fiyatSingle)} ${e(c.paraBirimi)}</b>'dır. (Yurtdışı turlarda Fiyat Etiketi Yönetmeliği uyarınca fiyatların "TL" yazılması konusunda muafiyet bulunmaktadır.) Bunlar haricindeki turlar ve diğer hizmetler ekstra ücrete tabidir.</p>

${secTitle(S.m5[0])}${body(S.m5)}

${secTitle(S.m6[0])}${P(S.m6.slice(1))}

<h2>7) ÖDEME PLANI VE ŞEKLİ</h2>
<p>Paket Turun ödemesi nakit veya hesaba havale/EFT şeklinde yapılabilir.</p>
<p>Vize işlemlerine ait ödemeler peşin olarak pasaport teslim edildiği tarihte yapılacaktır. Vize ücreti ödenmeden vize başvurusu yapılmayacaktır.</p>
<p class="hl"><b>${e(trTarih(c.onOdeme))}</b> ön ödeme günüdür. <b>${e(trTarih(c.sonOdeme))}</b> son ödeme günüdür. Ödeme belirtilen tarihlere kadar yapılmaz ise tur kaydı otomatik olarak iptal edilir.</p>
<p><b>Banka Hesap Numaraları</b></p>
<table>${BKS.map(BK => {
    const CURN = { TL: 'TÜRK LİRASI', EUR: 'EURO', USD: 'USD', GBP: 'GBP', CHF: 'CHF' };
    const accs = (Array.isArray(BK.accounts) && BK.accounts.length ? BK.accounts : []).filter(a => a.iban);
    return accs.map(a => `<tr><th>${e(trUpper(BK.bankName||''))} ${e(trUpper(BK.branch||''))} — ${CURN[a.currency] || e(a.currency)} HESABI</th><td>Şube Kodu: ${e(BK.branchCode)} · SWIFT: ${e(BK.swift)}<br>IBAN: ${e(a.iban)}${a.accountNo ? `<br>Hesap No: ${e(a.accountNo)}` : ''}</td></tr>`).join('');
  }).join('')}</table>

${c.ozelTalepler ? secTitle(S.m8[0]) + body(S.m8) : ''}
${secTitle(S.m9[0])}${body(S.m9)}
${secTitle(S.m10[0])}${body(S.m10)}
${secTitle(S.m12[0])}${body(S.m12)}
${secTitle(S.m13[0])}${body(S.m13)}
${secTitle(S.m14[0])}${body(S.m14)}

<div class="sig"><div><b>TÜKETİCİ</b><br>${e(c.tuketici.name)}<br>İmza</div><div><b>PAYDOS TURİZM</b><br>Önder TAŞÇI<br>İmza / Kaşe</div></div>
</body></html>`;
};

export const genOfferHTML = (o) => {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const flightCard = (f, label) => {
    const legs = (f.legs || []).filter(l => l.airline || l.dep || l.arr);
    if (!legs.length) return '';
    const ld = legDates({ ...f, legs }); // gece yarısını geçen aktarma bacağı ertesi gün
    return `
    <div class="fcard">
      <div class="fhead">${esc(label)} <span class="fdate">${esc(f.date)}</span>${legs.length > 1 ? '<span class="conn">Aktarmalı</span>' : ''}</div>
      ${legs.map((l, i) => `
        <div class="fleg">
          ${legs.length > 1 ? `<div class="flegno">${i + 1}. Bacak${ld[i] && ld[i] !== f.date ? ` · ${esc(ld[i])}` : ''}</div>` : ''}
          ${l.airline ? `<div class="frow"><span>Havayolu</span> <b>${esc(l.airline)}</b></div>` : ''}
          ${l.dep ? `<div class="frow"><span>Kalkış</span> <b>${esc(l.dep)}</b></div>` : ''}
          ${l.arr ? `<div class="frow"><span>Varış</span> <b>${esc(l.arr)}</b></div>` : ''}
          ${l.plane ? `<div class="frow"><span>Uçak</span> <b>${esc(l.plane)}</b></div>` : ''}
        </div>`).join('')}
    </div>`;
  };
  const daysHTML = o.days.map((d,i) => `
    <div class="drow">
      <div class="dleft"><div class="dtitle">${esc(d.title)}</div><div class="ddate">${esc(d.date)}</div></div>
      <div class="dright ${i%2?'alt':''}">${(d.place||'').trim()?`<div class="dplace">${esc(d.place)}</div>`:''}${d.items.filter(x=>(x.time||'').trim()||(x.text||'').trim()).map(x=>`<div class="ditem"><span class="dot">●</span> ${x.time?`<b class="tm">${esc(x.time)}</b> — `:''}${esc(x.text)}</div>`).join('')}</div>
    </div>`).join('');
  const priceCell = (v, cur) => v ? `<b>${esc(v)}</b> <s>${esc(cur)}</s>` : '<span class="dash">—</span>';
  const hotelsHTML = o.hotels.map(h => `
    <div class="hcard">
      <div class="hhead">${esc(h.name)} <span class="stars">${esc(h.stars)}</span>${h.note?`<div class="hnote">${esc(h.note)}</div>`:''}</div>
      <table class="ptable">
        <tr>
          <th>İki Kişilik Oda<br><small>Kişi Başı</small></th>
          <th>Tek Kişilik Oda</th>
          <th>İlave Yatak</th>
          <th class="kid">Bebek<br><small>0 – 1,99 Yaş</small></th>
          <th class="kid">1.Çocuk<br><small>7,00 – 11,99 Yaş</small></th>
          <th class="kid">2.Çocuk<br><small>2,00 – 6,99 Yaş</small></th>
        </tr>
        <tr>
          <td>${priceCell(h.priceDouble, h.currency)}</td>
          <td>${priceCell(h.priceSingle, h.currency)}</td>
          <td>${priceCell(h.priceExtraBed, h.currency)}</td>
          <td>${priceCell(h.priceBaby, h.currency)}</td>
          <td>${priceCell(h.priceChild1, h.currency)}</td>
          <td>${priceCell(h.priceChild2, h.currency)}</td>
        </tr>
      </table>
    </div>`).join('');
  const incHTML = o.included.filter(x=>x.trim()).map(x=>`<div class="sitem"><span class="ok">✔</span> ${esc(x)}</div>`).join('');
  const excHTML = o.excluded.filter(x=>x.trim()).map(x=>`<div class="sitem"><span class="no">✘</span> ${esc(x)}</div>`).join('');
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>${esc(o.title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'Segoe UI',Arial,sans-serif;color:#1c2b3a;font-size:12px;padding:14px;max-width:820px;margin:0 auto}
.band{background:#14508c;color:#fff;font-weight:700;font-size:13px;padding:7px 12px;border-radius:4px;border-left:5px solid #e8912a;margin:14px 0 8px}
.band.navy{background:#0c2340}
.header{background:#0c2340;color:#fff;border-radius:6px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;border-top:5px solid #e8912a}
.header .brand{font-size:11px;color:#bcd0e6;font-weight:700;letter-spacing:1px}
.header h1{font-size:22px;margin:4px 0}
.header .sub{font-size:12px;color:#bcd0e6}
.header .r{text-align:right}
.header .date{color:#e8912a;font-weight:700;font-size:15px}
.header .meta{color:#bcd0e6;font-size:11px}
.two{display:flex;gap:12px}
.two>*{flex:1}
.fcard{background:#eef3f8;border-radius:5px;overflow:hidden;border:1px solid #d5e0ec}
.fhead{background:#14508c;color:#fff;font-weight:700;padding:6px 10px}.fhead .fdate{color:#bcd0e6;font-weight:400;font-size:11px}
.frow{padding:4px 10px;border-bottom:1px solid #dbe4ee}.frow span{color:#5a6b7b}
.conn{background:#e8912a;color:#fff;font-size:9px;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:700}
.fleg{border-bottom:2px solid #d5e0ec}.fleg:last-child{border-bottom:none}
.flegno{background:#dce7f2;color:#14508c;font-size:9px;font-weight:700;padding:2px 10px}
.drow{display:flex;border:1px solid #d5e0ec;border-bottom:none}
.drow:last-child{border-bottom:1px solid #d5e0ec}
.dplace{font-weight:700;color:#0c2340;margin-bottom:3px}.dleft{background:#0c2340;color:#fff;width:90px;padding:8px 10px;flex-shrink:0}.dtitle{font-weight:700}.ddate{color:#f0d9b8;font-size:10px}
.dright{padding:8px 12px;flex:1;background:#fff}.dright.alt{background:#eef3f8}
.ditem{padding:2px 0}.dot{color:#e8912a}.tm{color:#0c2340}
.hcard{background:#eef3f8;border-radius:5px;overflow:hidden;border:1px solid #d5e0ec}
.hhead{background:#14508c;color:#fff;font-weight:700;padding:7px 10px}.stars{color:#f0d9b8}.hnote{font-size:10px;color:#bcd0e6;font-weight:400}
.ptable{width:100%;border-collapse:collapse;background:#fff}
.ptable th{background:#eef3f8;color:#0c2340;font-size:10px;font-weight:700;padding:5px 4px;border:1px solid #d5e0ec;text-align:center;line-height:1.25}
.ptable th small{font-weight:400;color:#5a6b7b;font-size:9px}
.ptable th.kid{background:#e3f0fb;color:#14508c}
.ptable td{text-align:center;padding:8px 4px;border:1px solid #d5e0ec}
.ptable td b{font-size:15px;color:#0c2340}.ptable td s{color:#5a6b7b;text-decoration:none;font-size:9px}
.dash{color:#b8c4d0}
.hstack{display:flex;flex-direction:column;gap:10px}
.scol{background:#eef3f8;border-radius:5px;overflow:hidden;border:1px solid #d5e0ec}
.shead{color:#fff;font-weight:700;padding:6px 10px}.shead.g{background:#1f9d63}.shead.r{background:#c0392b}
.sitem{padding:4px 10px;border-bottom:1px solid #dbe4ee}.ok{color:#1f9d63;font-weight:700}.no{color:#c0392b;font-weight:700}
.foot{background:#0c2340;color:#fff;border-radius:6px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #e8912a;margin-top:16px}
.foot .r{text-align:right}.foot .ph{color:#e8912a;font-weight:700}.foot small{color:#bcd0e6}
.note{color:#5a6b7b;font-size:11px;margin-top:6px}
@media print{body{padding:0}}
</style></head><body>
<div class="header">
  <div><div class="brand">✈ PAYDOS TURİZM</div><h1>${esc(o.title)}</h1><div class="sub">${esc(o.subtitle)}</div></div>
  <div class="r"><div class="date">${esc(offerDateRange(o))}</div><div class="meta">${esc(offerDuration(o))}${offerLocation(o)?' · '+esc(offerLocation(o)):''}</div></div>
</div>
${(flightCard(o.flightOut,'GİDİŞ')||flightCard(o.flightRet,'DÖNÜŞ'))?`<div class="band">✈ UÇUŞ BİLGİLERİ</div><div class="two">${flightCard(o.flightOut,'GİDİŞ')}${flightCard(o.flightRet,'DÖNÜŞ')}</div>`:''}
${o.days.some(d=>d.items.some(x=>(x.time||'').trim()||(x.text||'').trim()))?`<div class="band navy">◆ GÜNLÜK PROGRAM</div>${daysHTML}`:''}
${o.hotels.some(h=>h.name)?`<div class="band">★ OTEL SEÇENEKLERİ</div><div class="hstack">${hotelsHTML}</div>`:''}
${o.extraNote?`<div class="note">${esc(o.extraNote)}</div>`:''}
${(o.included.some(x=>x.trim())||o.excluded.some(x=>x.trim()))?`<div class="band navy">◆ HİZMET KAPSAMI</div><div class="two"><div class="scol"><div class="shead g">FİYATA DAHİL</div>${incHTML}</div><div class="scol"><div class="shead r">DAHİL DEĞİL</div>${excHTML}</div></div>`:''}
<div class="foot"><div><b>Paydos Turizm Seyahat Acentalığı</b><br><small>Mehmetçik Mah. Ulus Cad. No:124/1 Pamukkale / Denizli</small></div><div class="r"><div class="ph">0 258 263 71 76</div><small>info@paydostur.com · www.paydostur.com</small></div></div>
</body></html>`;
};

export const parseTrDate = (s) => {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { d: new Date(+m[1], +m[2] - 1, +m[3]), iso: true };
  m = t.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return { d: new Date(+m[3], +m[2] - 1, +m[1]), iso: false, dotted: true };
  m = t.match(/(\d{1,2})\s*([A-Za-zÇĞİÖŞÜçğıöşü]+)\s*(\d{4})?/); // "21 Mart" ve "21Mart"
  if (m) {
    const mi = TR_AYLAR.findIndex(a => normalizeTr(a) === normalizeTr(m[2]));
    if (mi >= 0) return { d: new Date(m[3] ? +m[3] : new Date().getFullYear(), mi, +m[1]), iso: false, year: !!m[3], weekday: TR_GUNLER.some(g => trHas(t, g)) };
  }
  return null;
};

// Teklif güncellenince: daha önce paylaşılmış rezervasyon linklerindeki (/b/) Tur Programı PDF'i, uçuşlar ve tarihler yenilenir
export const refreshTourShareLinks = async (tour) => {
  const tokens = [...new Set((tour.reservations || []).filter(r => !r.cancelled && r.shareToken).map(r => r.shareToken))];
  if (!tokens.length) return 0;
  const p = tour.offerData ? await makeTourProgramPdf(tour, true) : null;
  const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  let n = 0;
  for (const token of tokens) {
    try {
      const snap = await getDoc(doc(db, 'paylasimlar', token));
      if (!snap.exists()) continue;
      const d = snap.data() || {};
      if (d.tourId && String(d.tourId) !== String(tour.id)) continue;
      let docs = Array.isArray(d.docs) ? d.docs.filter(x => x.label !== 'Tur Programı') : [];
      // Bilet/biniş kartları rezervasyondaki güncel hâliyle
      const res = (tour.reservations || []).find(r => !r.cancelled && r.shareToken === token);
      const flights = resFlightList(tour, res);
      if (res) { const L = new Set(RES_LINK_DOCS.map(x => x[2])); docs = [...docs.filter(x => !L.has(x.label)), ...RES_LINK_DOCS.filter(([f]) => res[f]).map(([f, icon, label]) => ({ icon, label, url: res[f] }))]; }
      if (p) {
        const r = ref(getStorage(), `paylasim/${token}/tur-programi.pdf`);
        await uploadBytes(r, p.blob, { contentType: 'application/pdf' });
        docs = [{ icon: '🗺️', label: 'Tur Programı', url: await getDownloadURL(r) }, ...docs];
      } else if (tour.pdfUrl) docs = [{ icon: '🗺️', label: 'Tur Programı', url: tour.pdfUrl }, ...docs];
      await setDoc(doc(db, 'paylasimlar', token), { docs, flights, tourName: tour.name || '', startDate: tour.startDate || '', endDate: tour.endDate || '', country: tour.country || '', city: tour.city || '', updatedAt: new Date().toISOString() }, { merge: true });
      n++;
    } catch (e) { console.warn('[link güncelle]', token, e.message); }
  }
  return n;
};

export const vizeSartiBul = (ulke) => {
  const d = VIZE_DURUM[ulke];
  if (!d) return { metin: '', bilinmiyor: true, detay: '' };
  if (d.b === 'yurtici') return { metin: 'Vize şartı bulunmamaktadır.', bilinmiyor: false, detay: d.t };
  if (d.b === 'tabi') return { metin: `${ulke} Vizesi Şartı bulunmaktadır.`, bilinmiyor: false, detay: d.t };
  if (d.b === 'muaf') return { metin: 'Vize şartı bulunmamaktadır.', bilinmiyor: false, detay: d.t };
  return { metin: '', bilinmiyor: true, detay: d.t };
};

export const hhmm = (s) => { const m = String(s || '').match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/); return m ? +m[1] * 60 + +m[2] : null; };

// Rezervasyona sonradan yüklenen/silinen bilet ve biniş kartları, daha önce paylaşılmış linke (/b/) de yansısın.
// Link paylaşıldığı andaki belgelerin kopyasını tutar; bu yalnız rezervasyon belgelerini yeniler (program/otel aynı kalır).
export const RES_LINK_DOCS = [
  ['flightTicketUrl', '✈️', 'Uçak Bileti'], ['boardingOutUrl', '🛫', 'Gidiş Biniş Kartı'],
  ['boardingRetUrl', '🛬', 'Dönüş Biniş Kartı'], ['fuarTicketUrl', '🎫', 'Fuar Giriş Bileti'],
];

// Uçuş takibi: tekliften gelen uçuşların numarası ("Turkish Airlines (TK 1856)" → TK1856)
// Aktarmalı uçuşta her bacağın kendi günü: önceki bacağın varışından önce kalkan bacak (gece yarısını geçen
// aktarma) ya da "+1" ile varan bacaktan sonraki bacak ertesi güne kayar. Teklifte yön başına tek tarih var.
export const TR_GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export const legDates = (f) => {
  const legs = f?.legs || [], p = parseTrDate(f?.date);
  if (!p) return legs.map(() => f?.date || '');
  let shift = 0, prevArr = null;
  return legs.map(l => {
    const dep = hhmm(l.dep), arr = hhmm(l.arr);
    if (prevArr != null && dep != null && dep < prevArr) shift++;
    const out = shift ? fmtLike(p, new Date(p.d.getFullYear(), p.d.getMonth(), p.d.getDate() + shift)) : (f.date || '');
    if (dep != null && arr != null && (/\+\s?1/.test(String(l.arr)) || arr < dep)) shift++;
    prevArr = arr;
    return out;
  });
};

// Tur programı PDF'i (teklif verisinden) — Turlar, toplu mail ve link güncellemesi ortak kullanır
export const makeTourProgramPdf = async (tour, returnBlob = false) => {
  const o = tour.offerData;
  if (!o) throw new Error('Bu turda program bilgisi yok (tekliften aktarılmadı)');
  let holder = null;
  try {
    const html2canvas = await loadHtml2Canvas();
    const full = genOfferHTML(o);
    const b = full.match(/<body>([\s\S]*)<\/body>/), st = full.match(/<style>([\s\S]*?)<\/style>/);
    holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;background:#fff;z-index:-1';
    holder.innerHTML = `<style>${st ? st[1] : ''}</style>${b ? b[1] : ''}`;
    document.body.appendChild(holder);
    await new Promise(r => setTimeout(r, 320));
    const canvas = await html2canvas(holder, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const pdf = new jsPDF('p', 'mm', 'a4');
    addCanvasPaged(pdf, canvas, 0.92);
    const ad = (tour.name || 'Tur_Programi').replace(/[^\wğüşıöçĞÜŞİÖÇ ]/g, '').replace(/\s+/g, '_');
    if (returnBlob) return { name: `${ad}_Program.pdf`, blob: pdf.output('blob') };
    pdf.save(`${ad}.pdf`);
    return null;
  } finally { if (holder) document.body.removeChild(holder); }
};

export const resFlightList = (tour, res) => {
  const tf = [...(res?.ticketFlights || [])].sort((a, b) => `${a.ymd} ${a.dep}`.localeCompare(`${b.ymd} ${b.dep}`));
  if (!tf.length) return offerFlightList(tour?.offerData);
  const ms = (ymd) => new Date(ymd + 'T00:00:00').getTime();
  return tf.map((f, i) => {
    // Yön: turun başlangıcına mı bitişine mi yakın (tarih yoksa sıranın ilk yarısı gidiş)
    const dir = tour?.startDate && tour?.endDate
      ? (Math.abs(ms(f.ymd) - ms(tour.startDate)) <= Math.abs(ms(f.ymd) - ms(tour.endDate)) ? 'Gidiş' : 'Dönüş')
      : (i < tf.length / 2 ? 'Gidiş' : 'Dönüş');
    const [y, mo, d] = f.ymd.split('-').map(Number), dt = new Date(y, mo - 1, d);
    const pt = (city, iata, t) => [city, iata].filter(Boolean).join(' ') + (t ? ` · ${t}` : '');
    return { dir, code: f.code.replace(/^([A-Z0-9]{2})0+(?=\d)/, '$1'), ymd: f.ymd, date: `${d} ${TR_AYLAR[mo - 1]} ${y} ${TR_GUNLER[dt.getDay()]}`, dep: pt(f.fromCity, f.from, f.dep), arr: pt(f.toCity, f.to, f.arr) + (f.arr && f.arrNext ? '(+1)' : '') };
  });
};

export const fmtLike = (p, d) => {
  if (p.iso) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (p.dotted) return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  return `${d.getDate()} ${TR_AYLAR[d.getMonth()]}${p.year ? ' ' + d.getFullYear() : ''}${p.weekday ? ' ' + TR_GUNLER[d.getDay()] : ''}`;
};

export const offerFlightList = (o) => {
  const flights = [];
  [[o?.flightOut, 'Gidiş'], [o?.flightRet, 'Dönüş']].forEach(([f, dir]) => {
    const dates = legDates(f);
    (f?.legs || []).forEach((l, i) => {
      const m = String(l.airline || '').toUpperCase().match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?-?(\d{1,4})\b/);
      if (m) flights.push({ dir, code: `${m[1]}${m[2]}`, date: dates[i] || f.date || '', dep: l.dep || '', arr: l.arr || '' });
    });
  });
  return flights;
};

export const offerDateRange = (o) => {
  if (!o.startDate) return '';
  const [y1,m1,d1] = o.startDate.split('-').map(Number);
  if (!o.endDate) return `${d1} ${TR_AYLAR[m1-1]} ${y1}`;
  const [y2,m2,d2] = o.endDate.split('-').map(Number);
  if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${TR_AYLAR[m1-1]} ${y1}`;
  if (y1 === y2) return `${d1} ${TR_AYLAR[m1-1]} – ${d2} ${TR_AYLAR[m2-1]} ${y1}`;
  return `${d1} ${TR_AYLAR[m1-1]} ${y1} – ${d2} ${TR_AYLAR[m2-1]} ${y2}`;
};

export const offerDuration = (o) => {
  if (!o.startDate || !o.endDate) return '';
  const a = new Date(o.startDate + 'T00:00:00'), b = new Date(o.endDate + 'T00:00:00');
  const nights = Math.round((b - a) / 86400000);
  if (isNaN(nights) || nights < 0) return '';
  return `${nights + 1} Gün${nights > 0 ? ` / ${nights} Gece` : ''}`;
};

export const offerLocation = (o) => (o.destinations || []).filter(d => d.country || d.city)
  .map(d => [d.city, d.country].filter(Boolean).join(', ')).join(' · ');

// ===== SÖZLEŞME: paylaşılan üreticiler (QuotesModule + ToursModule) =====
export const trTarih = (iso) => { if (!iso) return ''; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };

// Vize başvurusu bu müşteriye mi ait? customerId (id/_docId) önce; ID yoksa ya da hiçbir müşteriye denk gelmiyorsa ad-soyad ile eşleştir
export const visaAppBelongsTo = (v, c, customers) => {
  if (!v || !c) return false;
  const vid = v.customerId != null && v.customerId !== '' ? String(v.customerId) : '';
  if (vid && (vid === String(c.id) || (c._docId && vid === String(c._docId)))) return true;
  const nm = (s) => normalizeTr(s).replace(/\s+/g, ' ');
  const full = nm(`${c.firstName || ''} ${c.lastName || ''}`);
  if (!full) return false;
  // Başka bir müşteriye bağlıysa: o müşteri aynı isimde (mükerrer kayıt, ör. Aktekin/Aktekın) ise yine göster
  const linked = vid ? (customers || []).find(x => vid === String(x.id) || (x._docId && vid === String(x._docId))) : null;
  if (linked) return nm(`${linked.firstName || ''} ${linked.lastName || ''}`) === full;
  return nm(v.customerName || '') === full;
};

// Linkteki bir belgeyi (URL'den) yeniden oku — tür sonradan değiştirilince
export const pdfUrlText = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error('indirilemedi'); const b = await r.blob(); return pdfFileText(new File([b], 'belge.pdf', { type: 'application/pdf' })); };

// Müşteri linkine (/m/) turun linkini ekle: müşteri sonra tekrar tura katılırsa eski simgeden açınca yeni turunu görür
export const addTourToCustomerLink = async (mToken, tour, bToken) => {
  if (!mToken || !bToken || !tour) return;
  const ref0 = doc(db, 'paylasimlar', mToken);
  const snap = await getDoc(ref0);
  if (!snap.exists()) return;
  // Turun (ya da yolcunun kendi biletindeki) uçuşlar müşteri linkinde "Sıradaki uçuş"ta da görünsün
  const res = (tour.reservations || []).find(r => !r.cancelled && r.shareToken === bToken);
  const y0 = +String(tour.startDate || '').slice(0, 4) || new Date().getFullYear();
  const flights = resFlightList(tour, res).map(f => {
    let ymd = f.ymd || '';
    if (!ymd) { const p = parseTrDate(f.date); if (p) { const d = p.year ? p.d : new Date(y0, p.d.getMonth(), p.d.getDate()); ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; } }
    return { dir: f.dir || '', code: f.code, ymd, date: f.date || '', dep: f.dep || '', arr: f.arr || '' };
  });
  const entry = { token: bToken, tourId: String(tour.id), name: tour.name || '', city: tour.city || '', country: tour.country || '', startDate: tour.startDate || '', endDate: tour.endDate || '', flights };
  const list = (Array.isArray(snap.data()?.tours) ? snap.data().tours : []).filter(t => t && t.token !== bToken);
  const old = (snap.data()?.tours || []).find(t => t && t.token === bToken);
  const unread = (snap.data()?.docs || []).some(d => d && !d.until && !d.untilChecked && ['✈️', '🛫', '🛬'].includes(d.icon));
  if (old && JSON.stringify(old) === JSON.stringify(entry) && !unread) return;
  const tours = [...list, entry].sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))).slice(0, 12);
  // Tarihi bilinmeyen bilet/biniş kartı: PDF'teki uçuşlardan seyahat tarihi (until) okunur → bitmişse linkte "Geçmişim"e iner
  const docs = Array.isArray(snap.data()?.docs) ? snap.data().docs : [];
  let docsChanged = false;
  const docs2 = [];
  for (const d of docs) {
    if (d && !d.until && !d.untilChecked && ['✈️', '🛫', '🛬'].includes(d.icon) && /^https:\/\//.test(d.url || '')) {
      const ymd = (await ticketFlightsOf(d.url)).map(x => x.ymd).filter(Boolean).sort().pop();
      docs2.push(ymd ? { ...d, until: ymd } : { ...d, untilChecked: true }); docsChanged = true;
    } else docs2.push(d);
  }
  await setDoc(ref0, docsChanged ? { tours, docs: docs2 } : { tours }, { merge: true });
};

// Yolcunun kendi uçak biletinden okunan uçuşlar (res.ticketFlights). Tur linkinde turun teklifindeki uçuşlar yerine
// bunlar gösterilir: İstanbul'dan katılan yolcuya turun İzmir/Denizli bağlantıları çıkmasın.
export const ticketFlightsOf = async (url) => {
  try {
    return detectFlights(await pdfUrlText(url)).filter(f => f.code && f.ymd).map(f => ({ code: f.code, ymd: f.ymd, fromCity: f.fromCity || '', from: f.from || '', toCity: f.toCity || '', to: f.to || '', dep: f.dep || '', arr: f.arr || '', arrNext: !!f.arrNext }));
  } catch (e) { return []; } // görsel/okunamayan bilet: turun uçuşları gösterilir
};

// OTEL MODÜLÜ
// ✍️ Otel rezervasyonuna elle eklenen kalemler: münferit uçuş ve transfer (gidiş / dönüş ayrı).
// Her biri: metin + alış (opsiyonel) + satış. Otel fiyatına (price) eklenmez; proformaya ayrı satır olarak girer.
export const RES_EXTRA_DEFS = [
  { key: 'flightOut', kind: 'flight', dir: 'Gidiş', icon: '✈️', name: 'Gidiş uçuşu' },
  { key: 'flightRet', kind: 'flight', dir: 'Dönüş', icon: '✈️', name: 'Dönüş uçuşu' },
  { key: 'transferOut', kind: 'transfer', dir: 'Gidiş', icon: '🚐', name: 'Gidiş transferi', def: 'Havalimanı → Otel' },
  { key: 'transferRet', kind: 'transfer', dir: 'Dönüş', icon: '🚐', name: 'Dönüş transferi', def: 'Otel → Havalimanı' },
];

export const resExtraSum = (r) => resExtras(r).reduce((t, x) => t + x.price, 0);

// 👥 Uçuşlar kişi bazında ayrılmışsa (flightSplit): her kişinin elle yazılan uçuşu ayrı kalem (adet 1, kendi fiyatı) — r.personFlights
export const resExtras = (r) => {
  const split = !!r?.flightSplit && Array.isArray(r?.personFlights);
  const per = split ? r.personFlights.flatMap(p => RES_EXTRA_DEFS.filter(d => d.kind === 'flight').map(d => {
    const s = d.key === 'flightOut' ? 'out' : 'ret';
    const text = String(p?.[s + 'Text'] || '').trim();
    if (!text) return null;
    const unitBuy = parseFloat(p[s + 'Buy']) || 0, unitPrice = parseFloat(p[s + 'Price']) || 0;
    return { ...d, key: `${d.key}-${normalizeTr(p.name).replace(/[^a-z0-9]+/g, '_')}`, name: `${d.name} · ${p.name}`, person: p.name, text, qty: 1, unitBuy, unitPrice, buy: unitBuy, price: unitPrice };
  }).filter(Boolean)) : [];
  return [...per, ...RES_EXTRA_DEFS
    .filter(d => !(split && d.kind === 'flight'))
    .filter(d => d.kind === 'flight' ? String(r?.[d.key] || '').trim() : r?.[d.key + 'On'])
    .map(d => {
      const qty = d.kind === 'flight' ? resPax(r) : 1;
      const unitBuy = parseFloat(r?.[d.key + 'Buy']) || 0, unitPrice = parseFloat(r?.[d.key + 'Price']) || 0;
      return { ...d, text: String(r?.[d.key] || '').trim() || d.def || '', qty, unitBuy, unitPrice, buy: unitBuy * qty, price: unitPrice * qty };
    })];
};

export const resPax = (r) => {
  const named = 1 + (r?.guestNames || []).filter(x => x && String(x).trim()).length;
  const g = parseInt(r?.guests) || 0;
  return Math.max(named, g > 1 ? g : roomTypePax(r?.roomType));
};

// Uçak bileti fiyatı KİŞİ BAŞI girilir → odadaki kişi sayısıyla çarpılır (Twin 2 kişi: 400 € × 2). Transfer araç başı (toplam).
// Kişi sayısı: yazılan oda arkadaşları → "Kişi Sayısı" alanı → oda tipi (Twin/Double 2, Triple 3); eski kayıtlarda alan 1 kalmış olabilir
export const roomTypePax = (rt) => { const t = normalizeTr(rt); return /single|tek ki/.test(t) ? 1 : /triple|uclu|3 ki/.test(t) ? 3 : /quad|dortlu|4 ki/.test(t) ? 4 : 2; };

// 🖐️ Parmak izi kutusu (müşteri kartı Schengen sekmesi + Schengen vize formu): Var/Yok + verildiği tarih, 59 ay geçerlilik.
// Müşteri kaydına doğrudan yazar (customers/<doc>); liste dinleyicisi ekranı günceller.
export function FingerprintBox({ c, showToast, compact }) {
  const [busy, setBusy] = useState(false);
  if (!c) return null;
  const { f, color, text } = fingerprintLabel(c);
  const save = async (patch) => {
    setBusy(true);
    try { await setDoc(doc(db, 'customers', c._docId || String(c.id)), { ...patch, updatedAt: new Date().toISOString() }, { merge: true }); showToast?.('🖐️ Parmak izi bilgisi kaydedildi', 'success'); }
    catch (e) { showToast?.('Kaydedilemedi: ' + e.message, 'error'); }
    setBusy(false);
  };
  const on = c.fingerprint === 'var' || !!f.date;
  const btn = (act, col) => ({ padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', border: `1px solid ${act ? col : 'rgba(255,255,255,0.15)'}`, background: act ? `${col}22` : 'rgba(255,255,255,0.04)', color: act ? col : '#94a3b8' });
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}55`, borderRadius: compact ? '10px' : '14px', padding: compact ? '10px 12px' : '14px 16px', marginTop: compact ? '10px' : 0 }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color }}>{text}</div>
      {f.state === 'valid' && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>Verildi {formatDate(f.date)} · {FINGERPRINT_MONTHS} ay geçerli · {f.daysLeft > 60 ? `${Math.floor(f.daysLeft / 30)} ay kaldı` : `${f.daysLeft} gün kaldı`}</div>}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' }}>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>Parmak izi:</span>
        <button type="button" disabled={busy} onClick={() => save({ fingerprint: 'var' })} style={btn(on, '#10b981')}>Var</button>
        <button type="button" disabled={busy} onClick={() => save({ fingerprint: 'yok', fingerprintDate: '' })} style={btn(c.fingerprint === 'yok' && !f.date, '#ef4444')}>Yok</button>
        {on && <>
          <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '6px' }}>Verildiği tarih:</span>
          <input type="date" defaultValue={f.date || ''} key={f.date || 'bos'} disabled={busy} onBlur={e => { const v = e.target.value; if (v !== (f.date || '') && /^(19|20)\d{2}-\d{2}-\d{2}$/.test(v) && v <= new Date().toISOString().slice(0, 10)) save({ fingerprint: 'var', fingerprintDate: v }); }}
            style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#fff', fontSize: '12px' }} />
        </>}
      </div>
    </div>
  );
}
