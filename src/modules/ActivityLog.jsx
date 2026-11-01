import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useEffect, useState } from 'react';
// ActivityLog modülü

export function ActivityLogModule({ isMobile, showToast, currentUser }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modulFilter, setModulFilter] = useState('all');
  const [gunFilter, setGunFilter] = useState('7'); // 1 | 7 | 30 | all

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'activity_logs'), (snap) => {
      const arr = snap.docs.map(d => d.data()).sort((a, b) => new Date(b.time) - new Date(a.time));
      setLogs(arr);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const moduller = [...new Set(logs.map(l => l.modul).filter(Boolean))];
  const simdi = Date.now();
  const gunMs = { '1': 86400000, '7': 604800000, '30': 2592000000 };
  const filtreli = logs.filter(l => {
    if (modulFilter !== 'all' && l.modul !== modulFilter) return false;
    if (gunFilter !== 'all') { const fark = simdi - new Date(l.time).getTime(); if (fark > (gunMs[gunFilter] || Infinity)) return false; }
    return true;
  });

  const actionInfo = (a) => {
    if (a === 'create') return { ikon: '➕', renk: '#10b981', et: 'Oluşturuldu' };
    if (a === 'delete') return { ikon: '🗑️', renk: '#ef4444', et: 'Silindi' };
    if (a === 'status') return { ikon: '🔄', renk: '#f59e0b', et: 'Durum değişti' };
    return { ikon: '📌', renk: '#94a3b8', et: a };
  };
  const modulIkon = (m) => ({ 'Müşteri': '👥', 'Vize': '🌍', 'Amerika Vize': '🇺🇸', 'Tur': '🎫', 'Pasaport': '📘', 'Otel': '🏨', 'Teklif': '📄', 'Ödeme': '💵' }[m] || '📋');
  const zaman = (t) => { const d = new Date(t); const bugun = new Date(); const dun = new Date(Date.now() - 86400000); const saat = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); if (d.toDateString() === bugun.toDateString()) return `Bugün ${saat}`; if (d.toDateString() === dun.toDateString()) return `Dün ${saat}`; return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) + ` ${saat}`; };

  const inS = { padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#e8f1f8', fontSize: '13px', cursor: 'pointer', outline: 'none' };

  return (
    <div style={{ padding: isMobile ? '16px' : '24px', maxWidth: '900px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '20px', margin: '0 0 6px', color: '#fff' }}>📋 İşlemler</h2>
      <p style={{ fontSize: '13px', color: '#94a3b8', margin: '0 0 18px' }}>Sistemde yapılan işlemler — kim, ne zaman, ne yaptı.</p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select value={gunFilter} onChange={e => setGunFilter(e.target.value)} style={inS}>
          <option value="1" style={{ background: '#0c1929' }}>Bugün</option>
          <option value="7" style={{ background: '#0c1929' }}>Son 7 gün</option>
          <option value="30" style={{ background: '#0c1929' }}>Son 30 gün</option>
          <option value="all" style={{ background: '#0c1929' }}>Tümü</option>
        </select>
        <select value={modulFilter} onChange={e => setModulFilter(e.target.value)} style={inS}>
          <option value="all" style={{ background: '#0c1929' }}>Tüm modüller</option>
          {moduller.map(m => <option key={m} value={m} style={{ background: '#0c1929' }}>{modulIkon(m)} {m}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#64748b', alignSelf: 'center' }}>{filtreli.length} kayıt</span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Yükleniyor...</div>
      ) : filtreli.length === 0 ? (
        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '14px', padding: '40px', textAlign: 'center' }}>
          <span style={{ fontSize: '42px' }}>📋</span>
          <p style={{ color: '#64748b', marginTop: '12px' }}>Bu aralıkta işlem kaydı yok.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {filtreli.map((l, i) => {
            const ai = actionInfo(l.action);
            return (
              <div key={l.id || i} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '11px 14px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '16px', flexShrink: 0 }}>{modulIkon(l.modul)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '13px', color: '#e8f1f8', fontWeight: '500' }}>
                    <span style={{ color: ai.renk, fontWeight: '700' }}>{ai.et}</span>
                    {l.detay ? <span> — {l.detay}</span> : ''}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    {l.modul} · <span style={{ color: '#93c5fd' }}>{l.userName}</span> · {zaman(l.time)}
                  </div>
                </div>
                <span style={{ fontSize: '15px', flexShrink: 0 }}>{ai.ikon}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
