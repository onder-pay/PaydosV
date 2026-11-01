import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { formatDate, formatWhatsAppPhone, generateUniqueId, waUrl } from '../lib/format.js';
import { titleCaseTr } from '../lib/turkish.js';
import { useEffect, useState } from 'react';
// 📢 Duyurular modülü (tur/müşteri linklerinde görünen duyurular)

// ===== 📢 Duyurular: müşteri ve tur linklerinde görünen görselli pano =====
// Firestore duyurular/<id> (herkes okur, CRM yazar) · görsel Storage duyurular/<id>.jpg (1600px'e küçültülür).
// Hedef: tüm linkler / sadece tur linkleri / sadece müşteri linkleri / tek bir tur. Tarih aralığı dışında görünmez.
export const DUYURU_HEDEF = [['all', 'Tüm linkler'], ['tour', 'Sadece tur linkleri'], ['customer', 'Sadece müşteri linkleri'], ['onetour', 'Belirli bir tur']];

export const shrinkImage = (file, max = 1600) => new Promise((ok, no) => {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    c.toBlob(b => b ? ok(b) : no(new Error('görsel işlenemedi')), 'image/jpeg', 0.85);
  };
  img.onerror = () => { URL.revokeObjectURL(url); no(new Error('görsel açılamadı')); };
  img.src = url;
});

// scope: 'customer' (müşteri linkleri) · 'tours' (tüm tur linkleri) · 'onetour' (fixedTour) · yoksa hepsi
export function DuyurularModule({ tours = [], showToast, isMobile, currentUser, scope, fixedTour, embedded }) {
  const defTarget = scope === 'customer' ? 'customer' : scope === 'tours' ? 'tour' : scope === 'onetour' ? 'onetour' : 'all';
  const empty = { title: '', text: '', link: '', target: defTarget, tourId: fixedTour ? String(fixedTour.id) : '', start: '', end: '', active: true };
  const inScope = (d) => !scope || (scope === 'customer' ? ['customer', 'all'].includes(d.target) : scope === 'tours' ? ['tour', 'all'].includes(d.target) : d.target === 'onetour' && String(d.tourId) === String(fixedTour?.id));
  const [list, setList] = useState(null);
  const [form, setForm] = useState(null); // düzenlenen duyuru
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const load = () => getDocs(collection(db, 'duyurular')).then(q => setList(q.docs.map(d => ({ id: d.id, ...d.data() })).filter(inScope).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))))).catch(e => { setList([]); showToast?.('Duyurular okunamadı: ' + e.message, 'error'); });
  useEffect(() => { load(); }, [scope, fixedTour?.id]);
  // 👁 Görülme takibi: duyurular/<id>/gorulme/<linkKodu> (linkteki kart ekrana gelince / tıklanınca sunucu yazar)
  const [seen, setSeen] = useState({}); // { duyuruId: [{ id: linkKodu, name, firstSeenAt, clickCount }] }
  const [seenOpen, setSeenOpen] = useState(null);
  useEffect(() => {
    if (!list?.length) return;
    let off = false;
    Promise.all(list.map(d => getDocs(collection(db, 'duyurular', d.id, 'gorulme')).then(q => [d.id, q.docs.map(x => ({ id: x.id, ...x.data() }))]).catch(() => [d.id, null])))
      .then(rows => { if (!off) setSeen(Object.fromEntries(rows)); });
    return () => { off = true; };
  }, [list]);
  const audienceOf = (d) => {
    if (d.target !== 'onetour') return null; // tüm linkler için payda bilinmez — sadece görenler sayılır
    const t = tours.find(x => String(x.id) === String(d.tourId)) || (fixedTour && String(fixedTour.id) === String(d.tourId) ? fixedTour : null);
    return t ? (t.reservations || []).filter(r => !r.cancelled && r.shareToken) : null;
  };
  const pick = (f) => { if (!f || !/^image\//.test(f.type)) { showToast?.('Görsel dosyası seçin (JPG, PNG)', 'warning'); return; } setFile(f); setPreview(URL.createObjectURL(f)); };
  const upd = (p) => setForm(f => ({ ...f, ...p }));
  const save = async () => {
    if (!form.title.trim() && !file && !form.image) { showToast?.('Başlık ya da görsel ekleyin', 'warning'); return; }
    if (form.link && !/^https:\/\//.test(form.link.trim())) { showToast?.('Bağlantı https:// ile başlamalı', 'warning'); return; }
    if (form.target === 'onetour' && !form.tourId) { showToast?.('Turu seçin', 'warning'); return; }
    setBusy(true);
    try {
      const id = form.id || generateUniqueId();
      let image = form.image || '', imagePath = form.imagePath || '';
      if (file) {
        const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
        imagePath = `duyurular/${id}-${Date.now()}.jpg`;
        const r = ref(getStorage(), imagePath);
        await uploadBytes(r, await shrinkImage(file), { contentType: 'image/jpeg' });
        image = await getDownloadURL(r);
      }
      const tour = form.target === 'onetour' ? (tours.find(t => String(t.id) === String(form.tourId)) || (fixedTour && String(fixedTour.id) === String(form.tourId) ? fixedTour : null)) : null;
      await setDoc(doc(db, 'duyurular', id), {
        title: form.title.trim(), text: form.text.trim(), link: form.link.trim(), image, imagePath,
        target: form.target, tourId: tour ? String(tour.id) : '', tourName: tour?.name || '',
        start: form.start || '', end: form.end || '', active: !!form.active,
        createdAt: form.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), by: currentUser?.name || '',
      });
      // Tek tur hedefinde eski tur linklerine tur kimliği yaz (sayfa duyuruyu bununla eşleştirir)
      if (tour) await Promise.all((tour.reservations || []).filter(r => !r.cancelled && r.shareToken).map(r => setDoc(doc(db, 'paylasimlar', r.shareToken), { tourId: String(tour.id) }, { merge: true }).catch(() => {})));
      // Görsel değiştiyse eskisini sil
      if (file && form.imagePath && form.imagePath !== imagePath) { try { const { getStorage, ref, deleteObject } = await import('firebase/storage'); await deleteObject(ref(getStorage(), form.imagePath)); } catch (e) { /* yok */ } }
      const where = form.target === 'customer' ? 'müşteri linklerine' : form.target === 'all' ? 'müşteri ve tur linklerine' : tour ? `${tour.name} tur linklerine` : 'bütün tur linklerine';
      showToast?.(`📢 Duyuru ${where} gönderildi`, 'success');
      setForm(null); setFile(null); setPreview(''); load();
    } catch (e) { showToast?.('❌ Kaydedilemedi: ' + e.message, 'error'); }
    setBusy(false);
  };
  const toggle = async (d) => { await setDoc(doc(db, 'duyurular', d.id), { active: !d.active }, { merge: true }); load(); };
  const remove = async (d) => {
    if (!window.confirm(`"${d.title || 'Duyuru'}" silinsin mi? Linklerden hemen kalkar.`)) return;
    await deleteDoc(doc(db, 'duyurular', d.id));
    if (d.imagePath) { try { const { getStorage, ref, deleteObject } = await import('firebase/storage'); await deleteObject(ref(getStorage(), d.imagePath)); } catch (e) { /* yok */ } }
    load();
  };
  const today = new Date().toISOString().slice(0, 10);
  const stateOf = (d) => !d.active ? ['Kapalı', '#64748b'] : d.start && d.start > today ? ['Planlı', '#f59e0b'] : d.end && d.end < today ? ['Süresi bitti', '#64748b'] : ['Yayında', '#10b981'];
  const inp = { width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' };
  const lbl = { display: 'block', fontSize: '12px', color: '#94a3b8', margin: '12px 0 6px', fontWeight: 600 };
  const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: isMobile ? '14px' : '18px' };
  const activeTours = tours.filter(t => !t.endDate || t.endDate >= today).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  const img = preview || form?.image;
  return (
    <div style={{ padding: embedded ? 0 : isMobile ? '16px' : '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px', flexWrap: 'wrap' }}>
        {embedded ? <h3 style={{ fontSize: '16px', margin: 0, flex: 1 }}>📢 Duyurular</h3> : <h2 style={{ fontSize: '20px', margin: 0, flex: 1 }}>📢 Duyurular</h2>}
        {!form && <button onClick={() => { setForm({ ...empty }); setFile(null); setPreview(''); }} style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg,#3b82f6,#2563eb)' }}>➕ Yeni duyuru</button>}
      </div>
      {!embedded && <p style={{ margin: '0 0 18px', fontSize: '13px', color: '#64748b' }}>Görsel yüklerseniz linkte sadece görsel (afiş) görünür, dokununca bağlantı açılır. Görsel yoksa başlık + metin "Ana ekrana ekleyin" kartı gibi görünür. Kaydedince linkler bir sonraki açılışta günceldir.</p>}
      {embedded && <div style={{ height: '12px' }} />}
      {form && (
        <div style={{ ...card, marginBottom: '18px', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '18px' }}>
          <div>
            <label onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', minHeight: '220px', borderRadius: '12px', border: `2px dashed ${drag ? '#3b82f6' : 'rgba(255,255,255,0.18)'}`, background: drag ? 'rgba(59,130,246,0.08)' : 'rgba(0,0,0,0.2)', cursor: 'pointer', overflow: 'hidden' }}>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
              {img ? <img src={img} alt="" style={{ width: '100%', maxHeight: '360px', objectFit: 'contain' }} />
                : <><span style={{ fontSize: '40px' }}>🖼️</span><b style={{ fontSize: '14px' }}>Görseli sürükleyin ya da tıklayın</b><span style={{ fontSize: '12px', color: '#64748b' }}>Afiş, kampanya görseli… (otomatik küçültülür)</span></>}
            </label>
            {img && <button onClick={() => { setFile(null); setPreview(''); upd({ image: '', imagePath: form.imagePath }); }} style={{ marginTop: '6px', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>Görseli kaldır</button>}
          </div>
          <div>
            <label style={{ ...lbl, marginTop: 0 }}>Başlık</label>
            <input value={form.title} maxLength={80} onChange={e => upd({ title: e.target.value })} placeholder="Kapadokya balon turu — erken rezervasyon" style={inp} />
            <label style={lbl}>Metin <span style={{ color: '#64748b', fontWeight: 400 }}>(isteğe bağlı)</span></label>
            <textarea value={form.text} maxLength={400} rows={3} onChange={e => upd({ text: e.target.value })} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
            <label style={lbl}>Bağlantı <span style={{ color: '#64748b', fontWeight: 400 }}>(isteğe bağlı — kartta "Aç" butonu)</span></label>
            <input value={form.link} onChange={e => upd({ link: e.target.value })} placeholder="https://paydostur.com/..." style={inp} />
            {/* Hangi linke gidecek: müşteri linki / tur linki (tüm turlar ya da tek tur) / ikisi de */}
            <label style={lbl}>Hangi linke gidecek?</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
              {[['customer', '📱 Müşteri linki'], ['tour', '🎫 Tur linki'], ['all', '📱+🎫 İkisine de']].map(([k, t]) => {
                const on = k === 'tour' ? ['tour', 'onetour'].includes(form.target) : form.target === k;
                return <button key={k} type="button" onClick={() => upd(k === 'tour' ? { target: form.tourId ? 'onetour' : 'tour' } : { target: k })} style={{ padding: '10px 6px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '12.5px', color: on ? '#fff' : '#94a3b8', background: on ? 'rgba(59,130,246,0.25)' : 'rgba(0,0,0,0.2)', border: `1px solid ${on ? '#3b82f6' : 'rgba(255,255,255,0.12)'}` }}>{t}</button>;
              })}
            </div>
            {['tour', 'onetour'].includes(form.target) && (
              <select value={form.target === 'onetour' ? form.tourId : ''} onChange={e => upd(e.target.value ? { target: 'onetour', tourId: e.target.value } : { target: 'tour', tourId: '' })} style={{ ...inp, marginTop: '8px' }}>
                <option value="">🌐 Bütün turların linklerine</option>
                {(fixedTour && !activeTours.some(t => String(t.id) === String(fixedTour.id)) ? [fixedTour, ...activeTours] : activeTours).map(t => <option key={t.id} value={String(t.id)}>{t.name} · {formatDate(t.startDate)}</option>)}
              </select>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div><label style={lbl}>Başlangıç</label><input type="date" value={form.start} onChange={e => upd({ start: e.target.value })} style={inp} /></div>
              <div><label style={lbl}>Bitiş</label><input type="date" value={form.end} onChange={e => upd({ end: e.target.value })} style={inp} /></div>
            </div>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px', fontSize: '13px' }}><input type="checkbox" checked={form.active} onChange={e => upd({ active: e.target.checked })} /> Yayında</label>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={save} disabled={busy} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', cursor: busy ? 'wait' : 'pointer', fontWeight: 700, color: '#fff', background: '#10b981', opacity: busy ? 0.6 : 1 }}>{busy ? 'Kaydediliyor…' : '💾 Kaydet'}</button>
              <button onClick={() => { setForm(null); setFile(null); setPreview(''); }} style={{ padding: '12px 18px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)', background: 'none', color: '#e8f1f8', cursor: 'pointer' }}>Vazgeç</button>
            </div>
          </div>
        </div>
      )}
      {list === null ? <div style={{ color: '#64748b' }}>Yükleniyor…</div> : !list.length ? <div style={{ ...card, color: '#64748b', fontSize: '13px' }}>Henüz duyuru yok.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '12px', alignItems: 'start' }}>
          {list.map(d => { const [st, sc] = stateOf(d); return (
            <div key={d.id} style={{ ...card, padding: 0, overflow: 'hidden', opacity: st === 'Yayında' ? 1 : 0.7 }}>
              {d.image && <img src={d.image} alt="" style={{ width: '100%', height: '160px', objectFit: 'cover', display: 'block' }} />}
              <div style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: sc }}>● {st}</span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>· {d.target === 'onetour' ? d.tourName || 'Tek tur' : (DUYURU_HEDEF.find(x => x[0] === d.target) || [])[1]}</span>
                </div>
                <b style={{ fontSize: '14px' }}>{d.title || '(başlıksız)'}</b>
                {(d.start || d.end) && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{d.start ? formatDate(d.start) : '…'} → {d.end ? formatDate(d.end) : '…'}</div>}
                {(() => {
                  const sv = seen[d.id];
                  if (sv === undefined) return null;
                  if (sv === null) return <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>👁 Görülme bilgisi okunamadı</div>;
                  const aud = audienceOf(d);
                  const seenIds = new Set(sv.filter(x => x.firstSeenAt).map(x => x.id));
                  const clicks = sv.filter(x => x.clickCount > 0).length;
                  const unseen = aud ? aud.filter(r => !seenIds.has(r.shareToken)) : [];
                  const open = seenOpen === d.id;
                  return (
                    <div style={{ marginTop: '8px', fontSize: '12px' }}>
                      <button onClick={() => setSeenOpen(open ? null : d.id)} style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '6px 10px', color: '#93c5fd', cursor: 'pointer', fontSize: '12px', width: '100%', textAlign: 'left' }}>
                        👁 {aud ? `${aud.filter(r => seenIds.has(r.shareToken)).length}/${aud.length}` : seenIds.size} gördü · 👆 {clicks} tıkladı{aud && unseen.length ? ` · ${unseen.length} görmedi` : ''} <span style={{ float: 'right' }}>{open ? '▲' : '▼'}</span>
                      </button>
                      {open && (
                        <div style={{ marginTop: '6px', maxHeight: '260px', overflowY: 'auto', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '6px 8px' }}>
                          {aud && unseen.length > 0 && <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 700, margin: '4px 0' }}>Görmeyenler ({unseen.length})</div>}
                          {aud && unseen.map(r => {
                            const ph = formatWhatsAppPhone(r.customerPhone || '');
                            const txt = `Merhaba ${titleCaseTr(r.customerName || '')}, tur linkinize yeni bir duyuru eklendi: ${d.title || ''}\n${window.location.origin}/b/${r.shareToken}`;
                            return (
                              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <span>{titleCaseTr(r.customerName || '')}</span>
                                {ph ? <a href={waUrl(ph, txt)} target="_blank" rel="noopener noreferrer" style={{ color: '#22c55e', textDecoration: 'none', fontSize: '12px' }}>💬 Hatırlat</a> : <span style={{ color: '#64748b', fontSize: '11px' }}>telefon yok</span>}
                              </div>
                            );
                          })}
                          {seenIds.size > 0 && <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 700, margin: '8px 0 4px' }}>Görenler ({seenIds.size})</div>}
                          {sv.filter(x => x.firstSeenAt).sort((a, b) => String(b.firstSeenAt).localeCompare(String(a.firstSeenAt))).map(x => (
                            <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: '#94a3b8', fontSize: '11px' }}>
                              <span style={{ color: '#e8f1f8' }}>{titleCaseTr(x.name || 'İsimsiz link')}{x.clickCount > 0 ? ' 👆' : ''}</span>
                              <span>{new Date(x.firstSeenAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          ))}
                          {!seenIds.size && !(aud && unseen.length) && <div style={{ color: '#64748b', fontSize: '11px', padding: '4px 0' }}>Henüz gören yok</div>}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                  <button onClick={() => { setForm({ ...empty, ...d }); setFile(null); setPreview(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={{ flex: 1, padding: '7px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', background: 'none', color: '#e8f1f8', cursor: 'pointer', fontSize: '12px' }}>✏️ Düzenle</button>
                  <button onClick={() => toggle(d)} style={{ flex: 1, padding: '7px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', background: 'none', color: '#e8f1f8', cursor: 'pointer', fontSize: '12px' }}>{d.active ? '⏸ Kapat' : '▶ Yayınla'}</button>
                  <button onClick={() => remove(d)} style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.35)', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🗑</button>
                </div>
              </div>
            </div>); })}
        </div>
      )}
    </div>
  );
}
