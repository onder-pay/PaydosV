// 🔗 Tur linki, müşteri linki ve duyurular sekmeleri
import { BildirimlerModule } from './Bildirimler';
import { DuyurularModule } from './Duyurular';
import { YarismaModal } from './Yarisma';
import { db } from '../lib/firebase.js';
import { doc, getDoc } from 'firebase/firestore';
import { formatDate } from '../lib/format.js';
import { titleCaseTr, trHas } from '../lib/turkish.js';
import { useEffect, useState } from 'react';
import { TavsiyelerModal } from '../components/shared';


// ===== 📱 Müşteri Linki (sol menü): tüm müşteri linkleri için duyuru + bildirim =====
export function MusteriLinkiModule({ customers, tours, showToast, isMobile, currentUser, bare }) {
  const [tab, setTab] = useState('duyuru');
  const tb = (k, t) => <button onClick={() => setTab(k)} style={{ padding: '9px 16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '13px', color: tab === k ? '#fff' : '#94a3b8', background: tab === k ? 'rgba(59,130,246,0.25)' : 'transparent', border: `1px solid ${tab === k ? '#3b82f6' : 'rgba(255,255,255,0.1)'}` }}>{t}</button>;
  return (
    <div>
      <div style={{ padding: bare ? (isMobile ? '0 16px' : '0 24px') : isMobile ? '16px 16px 0' : '24px 24px 0' }}>
        {!bare && <h2 style={{ fontSize: '20px', margin: '0 0 4px' }}>📱 Müşteri Linki</h2>}
        <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#64748b' }}>Bütün müşteri linklerinde (/m/) görünenler. Tek müşterinin belgeleri için müşteri kartındaki "Müşteri Linki" butonunu kullanın.</p>
        <div style={{ display: 'flex', gap: '8px' }}>{tb('duyuru', '📢 Duyurular')}{tb('bildirim', '📣 Bildirimler')}</div>
      </div>
      {tab === 'duyuru'
        ? <div style={{ padding: isMobile ? '16px' : '20px 24px' }}><DuyurularModule scope="customer" embedded tours={tours} showToast={showToast} isMobile={isMobile} currentUser={currentUser} /></div>
        : <BildirimlerModule customers={customers} tours={tours} showToast={showToast} isMobile={isMobile} />}
    </div>
  );
}

// ===== 🎫 Tur Linki (sol menü): tur seçilir → o turun duyuruları, yarışma, tavsiyeler, link durumu =====
export function TurLinkiModule({ tours = [], customers = [], showToast, isMobile, currentUser, bare }) {
  const [bildirimAc, setBildirimAc] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [sel, setSel] = useState('');
  const [q, setQ] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [yarisma, setYarisma] = useState(false);
  const [tavsiye, setTavsiye] = useState(false);
  const list = tours.filter(t => showOld || !t.endDate || t.endDate >= today)
    .filter(t => !q || trHas(`${t.name} ${t.city} ${t.country}`, q))
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  const tour = sel && sel !== 'all' ? tours.find(t => String(t.id) === sel) : null;
  const res = tour ? (tour.reservations || []).filter(r => !r.cancelled) : [];
  const shared = res.filter(r => r.shareToken).length;
  // 📲 Ana ekrana ekleyenler: link ana ekran simgesinden açılınca sunucu paylasimlar/<kod>.appFirstAt yazar
  const [appStats, setAppStats] = useState(null); // { tourId, rows: [{ name, at }] }
  const [appOpen, setAppOpen] = useState(false);
  useEffect(() => {
    setAppOpen(false);
    if (!tour) { setAppStats(null); return; }
    let off = false;
    const toks = res.filter(r => r.shareToken);
    Promise.all(toks.map(r => getDoc(doc(db, 'paylasimlar', r.shareToken)).then(x => x.exists() && (x.data()?.appFirstAt || x.data()?.installedAt) ? { name: r.customerName, at: x.data().appFirstAt || x.data().installedAt } : null).catch(() => null)))
      .then(rows => { if (!off) setAppStats({ tourId: tour.id, rows: rows.filter(Boolean) }); });
    return () => { off = true; };
  }, [tour?.id]);
  const item = (key, title, sub, on) => (
    <button key={key} onClick={() => setSel(key)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', color: '#e8f1f8', background: on ? 'rgba(245,158,11,0.15)' : 'transparent', border: `1px solid ${on ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.06)'}`, marginBottom: '6px' }}>
      <div style={{ fontWeight: 700, fontSize: '13px' }}>{title}</div><div style={{ fontSize: '11.5px', color: '#94a3b8' }}>{sub}</div>
    </button>
  );
  const btn = (bg, bc, c) => ({ padding: '10px 16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '13px', background: bg, border: `1px solid ${bc}`, color: c });
  return (
    <div style={{ padding: bare ? (isMobile ? '0 16px 16px' : '0 24px 24px') : isMobile ? '16px' : '24px' }}>
      {!bare && <h2 style={{ fontSize: '20px', margin: '0 0 4px' }}>🎫 Tur Linki</h2>}
      <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#64748b' }}>Tur seçin: o turun yolcularının linkinde (/b/) görünecek duyurular, canlı yarışma ve şehir tavsiyeleri.</p>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '280px 1fr', gap: '16px', alignItems: 'start' }}>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '12px', maxHeight: isMobile ? '260px' : '75vh', overflow: 'auto' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tur ara…" style={{ width: '100%', padding: '8px 10px', marginBottom: '8px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' }} />
          {item('all', '🌐 Tüm tur linkleri', 'Her turda görünecek duyurular', sel === 'all')}
          {list.map(t => item(String(t.id), t.name, `${t.city || t.country || ''} · ${formatDate(t.startDate)}${t.startDate <= today && (!t.endDate || t.endDate >= today) ? ' · 🟢 devam ediyor' : ''}`, sel === String(t.id)))}
          {!list.length && <div style={{ fontSize: '12px', color: '#64748b', padding: '6px' }}>Tur yok.</div>}
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', color: '#94a3b8', marginTop: '6px' }}><input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} /> Biten turları da göster</label>
        </div>
        <div>
          {!sel && <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: '14px', padding: '40px 20px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>{isMobile ? '↑ Yukarıdan' : '← Soldan'} bir tur seçin</div>}
          {sel === 'all' && <DuyurularModule key="all" scope="tours" embedded tours={tours} showToast={showToast} isMobile={isMobile} currentUser={currentUser} />}
          {tour && (
            <>
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
                <div style={{ fontSize: '17px', fontWeight: 700 }}>{tour.name}</div>
                <div style={{ fontSize: '12.5px', color: '#94a3b8', margin: '2px 0 12px' }}>🌍 {tour.country}{tour.city ? ` — ${tour.city}` : ''} · 📅 {formatDate(tour.startDate)} → {formatDate(tour.endDate)} · 🔗 {shared}/{res.length} yolcuya link gönderildi</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={() => setYarisma(true)} style={btn('rgba(245,158,11,0.15)', 'rgba(245,158,11,0.45)', '#fbbf24')}>🏆 Canlı yarışma</button>
                  <button onClick={() => setTavsiye(true)} style={btn('rgba(249,115,22,0.12)', 'rgba(249,115,22,0.4)', '#fb923c')}>⭐ {tour.city || 'Şehir'} tavsiyeleri</button>
                  <button onClick={() => setBildirimAc(o => !o)} style={btn('rgba(59,130,246,0.15)', 'rgba(59,130,246,0.45)', '#93c5fd')}>📣 Yolculara bildirim {bildirimAc ? '▲' : '▼'}</button>
                </div>
                {appStats && appStats.tourId === tour.id && shared > 0 && (
                  <div style={{ marginTop: '10px', fontSize: '12.5px' }}>
                    <button onClick={() => setAppOpen(o => !o)} disabled={!appStats.rows.length} style={{ background: 'none', border: 'none', padding: 0, color: '#93c5fd', cursor: appStats.rows.length ? 'pointer' : 'default', fontSize: '12.5px' }}>
                      📲 {appStats.rows.length}/{shared} yolcu linki ana ekrana ekleyip kullandı{appStats.rows.length ? (appOpen ? ' ▲' : ' ▼') : ''}
                    </button>
                    {appOpen && (
                      <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {appStats.rows.sort((a, b) => String(a.at).localeCompare(String(b.at))).map((r, i) => (
                          <span key={i} title={new Date(r.at).toLocaleString('tr-TR')} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '10px', background: 'rgba(59,130,246,0.15)', color: '#bfdbfe' }}>{titleCaseTr(r.name || '')}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {shared < res.length && <div style={{ fontSize: '12px', color: '#fbbf24', marginTop: '10px' }}>{res.length - shared} yolcuya henüz tur linki gönderilmedi (Turlar → bu tur → yolcunun 🔗 butonu).</div>}
              </div>
              {bildirimAc && <div style={{ marginBottom: '16px' }}><BildirimlerModule key={'b' + tour.id} fixedTour={tour} customers={customers} tours={tours} showToast={showToast} isMobile={isMobile} /></div>}
              <DuyurularModule key={tour.id} scope="onetour" fixedTour={tour} embedded tours={tours} showToast={showToast} isMobile={isMobile} currentUser={currentUser} />
              {yarisma && <YarismaModal tour={tour} onClose={() => setYarisma(false)} showToast={showToast} isMobile={isMobile} />}
              {tavsiye && <TavsiyelerModal focusCity={tour.city || ''} onClose={() => setTavsiye(false)} showToast={showToast} isMobile={isMobile} currentUser={currentUser} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== 📢 Duyurular (sol menü, tek bölüm): içinde iki sekme — Müşteri Linki | Tur Linki =====
export function LinkDuyuruModule({ customers, tours, showToast, isMobile, currentUser }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('paydos_duyuru_tab') || 'musteri'; } catch (e) { return 'musteri'; } });
  const go = (k) => { setTab(k); try { localStorage.setItem('paydos_duyuru_tab', k); } catch (e) { /* yok */ } };
  const tb = (k, t) => <button onClick={() => go(k)} style={{ flex: isMobile ? 1 : 'none', padding: '11px 20px', cursor: 'pointer', fontWeight: 700, fontSize: '14px', background: 'none', border: 'none', borderBottom: `3px solid ${tab === k ? '#f59e0b' : 'transparent'}`, color: tab === k ? '#fff' : '#94a3b8' }}>{t}</button>;
  return (
    <div>
      <div style={{ padding: isMobile ? '16px 16px 0' : '24px 24px 0' }}>
        <h2 style={{ fontSize: '20px', margin: '0 0 10px' }}>📢 Duyurular</h2>
        <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '16px' }}>{tb('musteri', '📱 Müşteri Linki')}{tb('tur', '🎫 Tur Linki')}</div>
      </div>
      {tab === 'musteri'
        ? <MusteriLinkiModule bare customers={customers} tours={tours} showToast={showToast} isMobile={isMobile} currentUser={currentUser} />
        : <TurLinkiModule bare tours={tours} customers={customers} showToast={showToast} isMobile={isMobile} currentUser={currentUser} />}
    </div>
  );
}
