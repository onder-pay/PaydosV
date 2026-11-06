// 🔔 Bildirimler modülü (Web Push: tur/müşteri linkine abone olan telefonlara bildirim)
import { auth } from '../lib/firebase.js';
import { formatDate, safeParseDate, safeParseJSON, safeParseObj } from '../lib/format.js';
import { trHas } from '../lib/turkish.js';
import { useEffect, useMemo, useState } from 'react';
import { bildirimCall } from '../lib/api.js';


// ===== 📣 Bildirimler: müşteri linkinden bildirime izin verenlere mesaj =====
// Sunucu: Firebase fonksiyonu "bildirim" (telegram-bot/functions/bildirim.js). Kampanya mesajı sadece kampanya
// onayı verenlere gider — bu kural sunucuda; buradaki sayılar sadece önizleme.
export const custKey = (c) => c._docId || String(c.id);

export const daysUntil = (ymd) => { const d = safeParseDate(ymd); return d ? Math.ceil((d - new Date()) / 86400000) : null; };

export const BILDIRIM_HEDEF = [
  ['all', 'Bildirim açık herkes'],
  ['schengen60', 'Schengen vizesi 60 gün içinde bitenler'],
  ['usa90', 'ABD vizesi 90 gün içinde bitenler'],
  ['passport6', 'Pasaportu 6 ay içinde bitenler'],
  ['pick', 'Seçtiğim müşteriler'],
  ['tour', 'Bir turun yolcuları'],
];

export function BildirimlerModule({ customers, tours = [], showToast, isMobile, fixedTour }) {
  const [stats, setStats] = useState(null);
  const [log, setLog] = useState([]);
  const [err, setErr] = useState('');
  const [type, setType] = useState('bilgi');
  const [hedef, setHedef] = useState(fixedTour ? 'tour' : 'all');
  const [tourSel, setTourSel] = useState(fixedTour ? String(fixedTour.id) : '');
  const selTour = fixedTour || tours.find(t => String(t.id) === tourSel) || null;
  // Turun yolcuları: rezervasyondaki müşteri → bildirim anahtarı (müşteri linki abonelikleri için)
  const tourKeys = useMemo(() => {
    const set = new Set();
    (selTour?.reservations || []).filter(r => !r.cancelled).forEach(r => {
      const c = customers.find(x => String(x.id) === String(r.customerId) || (x._docId && x._docId === String(r.customerId)));
      if (c) set.add(custKey(c));
    });
    return set;
  }, [selTour, customers]);
  const tourOpts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return tours.filter(t => !t.endDate || t.endDate >= today).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  }, [tours]);
  const [picked, setPicked] = useState([]);
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const toggleAuto = async () => {
    const on = !stats?.auto;
    try { await bildirimCall({ a: 'auto', on }); setStats(st => ({ ...st, auto: on })); showToast?.(on ? '⏰ Otomatik hatırlatma açıldı' : 'Otomatik hatırlatma kapatıldı', 'success'); }
    catch (e) { showToast?.('❌ ' + e.message, 'error'); }
  };
  const load = async () => {
    setErr('');
    try { const [s, l] = await Promise.all([bildirimCall({ a: 'stats' }), bildirimCall({ a: 'log' })]); setStats(s); setLog(l.items || []); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);
  const by = stats?.byCustomer || {};
  // Bildirimi açık müşteriler (CRM kartıyla eşleşen)
  const subCustomers = customers.filter(c => by[custKey(c)]);
  const matchHedef = (c) => {
    if (hedef === 'all') return true;
    if (hedef === 'pick') return picked.includes(custKey(c));
    if (hedef === 'tour') return tourKeys.has(custKey(c));
    if (hedef === 'schengen60') return safeParseJSON(c.schengenVisas).some(v => { const n = daysUntil(v.endDate); return n !== null && n >= 0 && n <= 60; });
    if (hedef === 'usa90') { const n = daysUntil(safeParseObj(c.usaVisa).endDate); return n !== null && n >= 0 && n <= 90; }
    if (hedef === 'passport6') return safeParseJSON(c.passports).some(p => { const n = daysUntil(p.expiryDate); return n !== null && n >= 0 && n <= 183; });
    return false;
  };
  const targets = subCustomers.filter(matchHedef);
  const devices = hedef === 'all'
    ? (type === 'kampanya' ? stats?.marketing || 0 : stats?.total || 0)
    : hedef === 'tour'
      // tur linkinden abone olanlar + bu yolcuların müşteri linki abonelikleri (tur aboneliği iki kez sayılmaz)
      ? (type === 'kampanya' ? targets.reduce((n, c) => n + by[custKey(c)].m, 0) : (stats?.byTour?.[String(selTour?.id)] || 0) + targets.reduce((n, c) => n + by[custKey(c)].n - (by[custKey(c)].t || 0), 0))
      : targets.reduce((n, c) => n + (type === 'kampanya' ? by[custKey(c)].m : by[custKey(c)].n), 0);
  const send = async () => {
    if (!title.trim() || !body.trim()) { showToast?.('Başlık ve mesaj yazın', 'warning'); return; }
    if (!devices) { showToast?.('Bu hedefte bildirim alacak cihaz yok', 'warning'); return; }
    if (!window.confirm(`${type === 'kampanya' ? '🎁 KAMPANYA' : 'ℹ️ Bilgilendirme'} bildirimi ${devices} cihaza gönderilsin mi?\n\n${title}\n${body}`)) return;
    setBusy(true);
    try {
      if (hedef === 'tour' && !selTour) { showToast?.('Tur seçin', 'warning'); setBusy(false); return; }
      const r = await bildirimCall({ a: 'send', type, title, body, url: url.trim(), customerIds: hedef === 'all' ? null : targets.map(custKey),
        ...(hedef === 'tour' ? { tourId: String(selTour.id), tourName: selTour.name || '' } : {}) });
      showToast?.(`📣 ${r.sent} cihaza gönderildi${r.failed ? ` · ${r.failed} ulaşmadı` : ''}`, r.sent ? 'success' : 'warning');
      setTitle(''); setBody(''); setUrl(''); load();
    } catch (e) { showToast?.('❌ Gönderilemedi: ' + e.message, 'error'); }
    setBusy(false);
  };
  const inp = { width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' };
  const lbl = { display: 'block', fontSize: '12px', color: '#94a3b8', margin: '14px 0 6px', fontWeight: 600 };
  const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: isMobile ? '16px' : '20px' };
  const pickList = subCustomers.filter(c => !q || trHas(`${c.firstName} ${c.lastName}`, q)).slice(0, 30);
  return (
    <div style={{ padding: fixedTour ? 0 : isMobile ? '16px' : '24px', maxWidth: '1100px' }}>
      {!fixedTour && <><h2 style={{ fontSize: '20px', margin: '0 0 6px' }}>📣 Bildirimler</h2>
      <p style={{ margin: '0 0 18px', fontSize: '13px', color: '#64748b' }}>Müşteri linkinden veya tur linkinden bildirime izin veren telefonlara mesaj gönderin. iPhone'da bildirim için linkin ana ekrana eklenmiş olması gerekir.</p></>}
      {err && <div style={{ ...card, borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5', marginBottom: '16px', fontSize: '13px' }}>Bildirim servisine ulaşılamadı: {err}. (Firebase fonksiyonu "bildirim" yüklü mü?)</div>}
      {!fixedTour && <>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: '12px', marginBottom: '18px' }}>
        {[['🔔', 'Bildirim açık cihaz', stats?.total, '#3b82f6'], ['🎁', 'Kampanya onaylı', stats?.marketing, '#f59e0b'], ['👥', 'Müşteri', subCustomers.length, '#10b981']].map(([i, l, v, c]) => (
          <div key={l} style={{ ...card, padding: '14px 16px' }}><div style={{ fontSize: '24px', fontWeight: 700, color: c }}>{stats ? v : '…'}</div><div style={{ fontSize: '12px', color: '#94a3b8' }}>{i} {l}</div></div>
        ))}
      </div>
      {/* ⏰ Otomatik hatırlatma — tarihler müşteri kartından (linkte görünen vize/pasaport bilgisiyle aynı) */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px', padding: '14px 18px', borderColor: stats?.auto ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)' }}>
        <span style={{ fontSize: '24px' }}>⏰</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '14px' }}>Otomatik vize ve pasaport hatırlatması</div>
          <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>Her gün 10:00'da: vize bitimine <b>60 · 30 · 7 gün</b>, pasaport bitimine <b>6 ay · 3 ay</b> kala müşteriye kendiliğinden bildirim gider. Her hatırlatma bir kez gönderilir. Bildirimi açık olan herkese gider (bilgilendirmedir, reklam içermez).</div>
        </div>
        <button onClick={toggleAuto} disabled={!stats} style={{ flex: 'none', padding: '8px 16px', borderRadius: '999px', cursor: 'pointer', fontWeight: 700, fontSize: '13px', border: 'none', color: '#fff', background: stats?.auto ? '#10b981' : '#475569', opacity: stats ? 1 : 0.5 }}>{stats ? (stats.auto ? '✓ Açık' : 'Kapalı') : '…'}</button>
      </div>
      </>}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: '16px', alignItems: 'start' }}>
        <div style={card}>
          <label style={{ ...lbl, marginTop: 0 }}>Tür</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[['bilgi', 'ℹ️ Bilgilendirme', 'Uçuş, otel, belge, tur duyurusu'], ['kampanya', '🎁 Kampanya', 'Sadece kampanya onayı verenlere']].map(([k, t, s]) => (
              <button key={k} onClick={() => setType(k)} style={{ flex: 1, minWidth: '180px', textAlign: 'left', padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', color: '#e8f1f8', background: type === k ? 'rgba(59,130,246,0.18)' : 'rgba(0,0,0,0.2)', border: `1px solid ${type === k ? '#3b82f6' : 'rgba(255,255,255,0.1)'}` }}>
                <div style={{ fontWeight: 700, fontSize: '13px' }}>{t}</div><div style={{ fontSize: '11px', color: '#94a3b8' }}>{s}</div>
              </button>
            ))}
          </div>
          {type === 'kampanya' && <div style={{ marginTop: '8px', fontSize: '11.5px', color: '#fbbf24' }}>Reklam/kampanya içeriğini "Bilgilendirme" olarak göndermeyin — onay vermeyen müşteriye ticari ileti yasal risktir.</div>}
          <label style={lbl}>Kime</label>
          {fixedTour ? <div style={{ ...inp, background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.35)' }}>🎫 {fixedTour.name} yolcuları</div> : (
          <select value={hedef} onChange={e => setHedef(e.target.value)} style={inp}>
            {BILDIRIM_HEDEF.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>)}
          {hedef === 'tour' && !fixedTour && (
            <select value={tourSel} onChange={e => setTourSel(e.target.value)} style={{ ...inp, marginTop: '8px' }}>
              <option value="">— Tur seçin —</option>
              {tourOpts.map(t => <option key={t.id} value={String(t.id)}>{t.name} · {formatDate(t.startDate)}</option>)}
            </select>
          )}
          {hedef === 'tour' && selTour && <div style={{ marginTop: '6px', fontSize: '11.5px', color: '#94a3b8' }}>Tur linkinden bildirimi açan yolcular + bu turdaki müşterilerin müşteri linki bildirimleri.</div>}
          {hedef === 'pick' && (
            <div style={{ marginTop: '8px' }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Müşteri ara (sadece bildirimi açık olanlar)" style={inp} />
              <div style={{ maxHeight: '180px', overflow: 'auto', marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {pickList.map(c => { const k = custKey(c), on = picked.includes(k); return (
                  <button key={k} onClick={() => setPicked(p => on ? p.filter(x => x !== k) : [...p, k])} style={{ padding: '5px 10px', borderRadius: '999px', fontSize: '12px', cursor: 'pointer', color: '#e8f1f8', background: on ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.05)', border: `1px solid ${on ? '#10b981' : 'rgba(255,255,255,0.12)'}` }}>
                    {on ? '✓ ' : ''}{c.firstName} {c.lastName}{by[k].m ? ' 🎁' : ''}
                  </button>); })}
                {!pickList.length && <span style={{ fontSize: '12px', color: '#64748b' }}>Bildirimi açık müşteri yok.</span>}
              </div>
            </div>
          )}
          <label style={lbl}>Başlık <span style={{ color: '#64748b', fontWeight: 400 }}>({title.length}/80)</span></label>
          <input value={title} maxLength={80} onChange={e => setTitle(e.target.value)} placeholder={type === 'kampanya' ? 'Kapadokya turunda erken rezervasyon' : 'Online check-in açıldı'} style={inp} />
          <label style={lbl}>Mesaj <span style={{ color: '#64748b', fontWeight: 400 }}>({body.length}/300)</span></label>
          <textarea value={body} maxLength={300} onChange={e => setBody(e.target.value)} rows={4} placeholder={type === 'kampanya' ? '15 Kasım\'a kadar %15 indirim. Detaylar için dokunun.' : 'Yarınki TK1032 uçuşunuz için online check-in açıldı.'} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
          <label style={lbl}>Dokununca açılacak sayfa <span style={{ color: '#64748b', fontWeight: 400 }}>(boşsa müşterinin kendi linki · sadece paydostur.com)</span></label>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://paydostur.com/..." style={inp} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '18px', flexWrap: 'wrap' }}>
            <button onClick={send} disabled={busy || !stats} style={{ padding: '11px 22px', borderRadius: '10px', border: 'none', cursor: busy ? 'wait' : 'pointer', fontWeight: 700, fontSize: '14px', color: '#fff', background: type === 'kampanya' ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#3b82f6,#2563eb)', opacity: busy || !stats ? 0.6 : 1 }}>{busy ? 'Gönderiliyor…' : '📣 Gönder'}</button>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>{stats ? <><b style={{ color: '#e8f1f8' }}>{devices}</b> cihaz{hedef !== 'all' && hedef !== 'tour' ? ` · ${targets.length} müşteri` : ''}</> : 'yükleniyor…'}</span>
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, marginBottom: '8px' }}>ÖNİZLEME</div>
          <div style={{ background: '#f8fafc', color: '#0f172a', borderRadius: '14px', padding: '12px 14px', display: 'flex', gap: '10px', boxShadow: '0 6px 20px rgba(0,0,0,0.3)' }}>
            <img src="/icons/icon-192.png" alt="" style={{ width: '36px', height: '36px', borderRadius: '8px', flex: 'none' }} />
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: '13.5px' }}>{title || 'Başlık'}</div><div style={{ fontSize: '12.5px', color: '#475569', wordBreak: 'break-word' }}>{body || 'Mesajınız burada görünür.'}</div></div>
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, margin: '20px 0 8px', display: 'flex', justifyContent: 'space-between' }}><span>SON GÖNDERİLENLER</span><button onClick={load} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '12px' }}>↻ Yenile</button></div>
          {log.length ? log.map(x => (
            <div key={x.id} style={{ padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}><b style={{ color: '#e8f1f8' }}>{x.type === 'kampanya' ? '🎁' : 'ℹ️'} {x.title}</b><span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{String(x.at || '').slice(0, 16).replace('T', ' ')}</span></div>
              <div style={{ color: '#94a3b8' }}>{x.sent}/{x.matched} cihaz · {x.by === 'otomatik' ? '⏰ otomatik' : String(x.by || '').split('@')[0]}</div>
            </div>
          )) : <div style={{ fontSize: '12px', color: '#64748b' }}>Henüz gönderim yok.</div>}
        </div>
      </div>
    </div>
  );
}
