import { collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useEffect, useRef, useState } from 'react';
import { cityKey, tourCities } from '../lib/tourcity.js';
import { claudeRequest } from '../lib/api.js';
// 🏆 Tur yarışması (canlı bilgi yarışması) penceresi

// ===== 🏆 Tur bilgi yarışması (canlı) =====
// Rehber CRM'den yönetir; yolcular tur linkinden (/b/<kod>) katılır ve cevaplar. Firestore:
//   yarisma/<şehir>                      — soru bankası { city, questions: [{ q, o: [4 şık], a: doğru şık }] } (sadece CRM)
//   yarisma_oturum/<turId>               — canlı oturum (herkes okur; doğru cevap sadece "reveal"de yazılır)
//   yarisma_oturum/<turId>/gizli/sorular — oturumun soruları + cevapları (sadece CRM)
//   yarisma_oturum/<turId>/players/<link kodu> — oyuncu { name, answers: { i: { c, at } }, score, last }
// Puan sunucu saatine göre hesaplanır: doğru cevap 500–1000 (hızlı olan çok alır), süre bitince 0.
export const YARISMA_SURE = 20; // saniye

export const yarismaPuan = (ms, limitMs) => (ms > limitMs + 1500 ? 0 : Math.round(500 + 500 * Math.max(0, 1 - ms / limitMs)));

export const validQ = (x) => x && String(x.q || '').trim() && Array.isArray(x.o) && x.o.length === 4 && x.o.every(s => String(s || '').trim()) && x.a >= 0 && x.a < 4;

export const SIK_RENK = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981'];

export function YarismaModal({ tour, onClose, showToast, isMobile }) {
  const cities = tourCities(tour.city);
  const [city, setCity] = useState(cities[0] || tour.country || '');
  const key = cityKey(city);
  const [bank, setBank] = useState(null);
  const [edit, setEdit] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const sid = String(tour.id);
  const [ses, setSes] = useState(undefined);
  const [players, setPlayers] = useState([]);
  const [now, setNow] = useState(Date.now());
  const qsRef = useRef(null);
  const revealing = useRef(false);
  useEffect(() => { setBank(null); getDoc(doc(db, 'yarisma', key)).then(s => setBank(s.exists() ? (s.data().questions || []) : [])).catch(() => setBank([])); }, [key]);
  useEffect(() => {
    const u1 = onSnapshot(doc(db, 'yarisma_oturum', sid), s => setSes(s.exists() ? s.data() : null), () => setSes(null));
    const u2 = onSnapshot(collection(db, 'yarisma_oturum', sid, 'players'), q => setPlayers(q.docs.map(d => ({ id: d.id, ...d.data() }))), () => {});
    return () => { u1(); u2(); };
  }, [sid]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const live = ses && ses.status !== 'closed';
  // Sayfa yenilenirse oturumun soruları gizli kopyadan geri gelir
  useEffect(() => { if (live && !qsRef.current) getDoc(doc(db, 'yarisma_oturum', sid, 'gizli', 'sorular')).then(s => { if (s.exists()) qsRef.current = s.data().questions || []; }).catch(() => {}); }, [live, sid]);

  const saveBank = async (qs) => {
    try { await setDoc(doc(db, 'yarisma', key), { city, questions: qs, updatedAt: new Date().toISOString() }); setBank(qs); showToast?.('Sorular kaydedildi', 'success'); }
    catch (e) { showToast?.('❌ Kaydedilemedi: ' + e.message, 'error'); }
  };
  const genAI = async () => {
    setAiBusy(true);
    try {
      const prompt = `${city}${tour.country ? ` (${tour.country})` : ''} gezisindeki Türk tur grubu için otobüste oynanacak 10 soruluk eğlenceli bilgi yarışması hazırla.
- Türkçe, kolay-orta zorluk: tarih, ünlü yapılar, yemek, kültur, gündelik ilginç bilgiler.
- Sadece KESİN doğru olduğundan emin olduğun bilgiler; şüpheli olanı sorma. Tarih/sayı sorularında şıklar birbirinden belirgin farklı olsun.
- Her soruda 4 şık, tek doğru. Doğru şıkkın yeri sorudan soruya değişsin. Soru en fazla 120, şık en fazla 40 karakter.
SADECE JSON dizi döndür: [{"q":"soru","o":["şık1","şık2","şık3","şık4"],"a":0}]  (a = doğru şıkkın sırası, 0-3)`;
      const resp = await claudeRequest({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      const m = (data.content?.[0]?.text || '').match(/\[[\s\S]*\]/);
      if (!m) throw new Error('yanıt okunamadı');
      const qs = JSON.parse(m[0]).map(x => ({ q: String(x.q || ''), o: (x.o || []).slice(0, 4).map(String), a: Number(x.a) })).filter(validQ);
      if (!qs.length) throw new Error('geçerli soru yok');
      setBank(b => [...(b || []), ...qs]); setEdit(true);
      showToast?.(`🤖 ${qs.length} soru eklendi — kontrol edip Kaydet'e basın`, 'success');
    } catch (e) { showToast?.('Soru üretilemedi: ' + e.message, 'error'); }
    setAiBusy(false);
  };

  const openGame = async () => {
    const qs = (bank || []).filter(validQ);
    if (!qs.length) { showToast?.('Önce soru ekleyin', 'warning'); return; }
    try {
      // Tur linklerine tur kimliği (eski linklerde yok) — yolcunun sayfası yarışmayı buradan bulur
      const toks = (tour.reservations || []).filter(r => !r.cancelled && r.shareToken).map(r => r.shareToken);
      await Promise.all(toks.map(t => setDoc(doc(db, 'paylasimlar', t), { tourId: sid }, { merge: true }).catch(() => {})));
      const old = await getDocs(collection(db, 'yarisma_oturum', sid, 'players'));
      if (old.size) { const b = writeBatch(db); old.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
      await setDoc(doc(db, 'yarisma_oturum', sid, 'gizli', 'sorular'), { questions: qs });
      qsRef.current = qs;
      await setDoc(doc(db, 'yarisma_oturum', sid), { status: 'lobby', title: `${city} Bilgi Yarışması`, tourName: tour.name || '', total: qs.length, qIndex: -1, limit: YARISMA_SURE, q: null, correct: null, top: [], createdAt: serverTimestamp() });
      if (!toks.length) showToast?.('Bu turda henüz paylaşılmış tur linki yok — yolcular katılamaz', 'warning');
    } catch (e) { showToast?.('❌ Açılamadı: ' + e.message, 'error'); }
  };
  const ask = async (i) => {
    const qs = qsRef.current || [];
    if (!qs[i]) return;
    revealing.current = false;
    await setDoc(doc(db, 'yarisma_oturum', sid), { status: 'q', qIndex: i, q: { text: qs[i].q, o: qs[i].o }, correct: null, qStartedAt: serverTimestamp() }, { merge: true });
  };
  const ranked = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const reveal = async () => {
    if (revealing.current || ses?.status !== 'q') return;
    revealing.current = true;
    if (!qsRef.current) { const g = await getDoc(doc(db, 'yarisma_oturum', sid, 'gizli', 'sorular')).catch(() => null); qsRef.current = g?.exists() ? g.data().questions || [] : []; }
    const i = ses.qIndex, qs = qsRef.current, correct = qs[i]?.a;
    const start = ses.qStartedAt?.toMillis?.() || 0, limitMs = (ses.limit || YARISMA_SURE) * 1000;
    const b = writeBatch(db);
    const next = players.map(p => {
      const an = p.answers?.[i];
      const pts = an && an.c === correct && an.at?.toMillis && start ? yarismaPuan(an.at.toMillis() - start, limitMs) : 0;
      b.update(doc(db, 'yarisma_oturum', sid, 'players', p.id), { score: (p.score || 0) + pts, last: pts });
      return { name: p.name, score: (p.score || 0) + pts };
    }).sort((x, y) => y.score - x.score);
    await b.commit();
    const last = i >= qs.length - 1;
    await setDoc(doc(db, 'yarisma_oturum', sid), { status: last ? 'end' : 'reveal', correct, top: next.slice(0, last ? 10 : 5) }, { merge: true });
  };
  const closeGame = async () => { if (window.confirm('Yarışma kapatılsın mı? Yolcuların ekranından kalkar.')) await setDoc(doc(db, 'yarisma_oturum', sid), { status: 'closed' }, { merge: true }); };

  // Soru açıkken: süre bitince ya da herkes cevaplayınca otomatik cevabı göster
  const i = ses?.qIndex ?? -1;
  const answered = ses?.status === 'q' ? players.filter(p => p.answers?.[i]).length : 0;
  const startMs = ses?.qStartedAt?.toMillis?.();
  const left = ses?.status === 'q' && startMs ? Math.max(0, Math.ceil(((ses.limit || YARISMA_SURE) * 1000 - (now - startMs)) / 1000)) : null;
  useEffect(() => { if (ses?.status === 'q' && ((left === 0) || (players.length && answered === players.length))) reveal(); }, [left, answered, ses?.status]);

  const box = { background: '#0f2137', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', width: '100%', maxWidth: '760px', maxHeight: '92vh', overflow: 'auto', padding: isMobile ? '16px' : '22px', color: '#e8f1f8' };
  const btn = (bg) => ({ padding: '10px 18px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '14px', color: '#fff', background: bg });
  const inp = { width: '100%', padding: '8px 10px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' };
  const qs = qsRef.current || [];
  const setQ = (k, patch) => setBank(b => b.map((x, j) => j === k ? { ...x, ...patch } : x));
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}>
      <div onClick={e => e.stopPropagation()} style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, flex: 1, fontSize: '18px' }}>🏆 Bilgi Yarışması <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 400 }}>— {tour.name}</span></h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}>✕</button>
        </div>

        {ses === undefined ? <div style={{ color: '#94a3b8' }}>Yükleniyor…</div> : !live ? (
          <>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '12px', lineHeight: 1.5 }}>Yarışmayı açınca yolcuların tur linkinde <b>"Canlı yarışma — Katıl"</b> çıkar. Siz soruları buradan tek tek gönderirsiniz; her soru {YARISMA_SURE} saniye. Hızlı ve doğru cevaplayan çok puan alır.</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
              {cities.length > 1 && <select value={city} onChange={e => setCity(e.target.value)} style={{ ...inp, width: 'auto' }}>{cities.map(c => <option key={c}>{c}</option>)}</select>}
              <b style={{ fontSize: '14px' }}>📍 {city || '—'} soruları: {bank ? bank.filter(validQ).length : '…'}</b>
              <span style={{ flex: 1 }} />
              <button onClick={genAI} disabled={aiBusy || !city} style={btn('linear-gradient(135deg,#8b5cf6,#6d28d9)')}>{aiBusy ? '⏳ Üretiliyor…' : '🤖 10 soru üret'}</button>
              <button onClick={() => setEdit(e => !e)} style={btn('rgba(255,255,255,0.12)')}>{edit ? 'Listeyi kapat' : '✏️ Soruları düzenle'}</button>
            </div>
            {edit && bank && (
              <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '10px', marginBottom: '12px' }}>
                {bank.map((x, k) => (
                  <div key={k} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <b style={{ fontSize: '12px', color: '#64748b', width: '22px' }}>{k + 1}.</b>
                      <input value={x.q} onChange={e => setQ(k, { q: e.target.value })} placeholder="Soru" style={inp} />
                      <button onClick={() => setBank(b => b.filter((_, j) => j !== k))} title="Sil" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>🗑</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '6px', margin: '6px 0 0 28px' }}>
                      {[0, 1, 2, 3].map(o => (
                        <label key={o} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <input type="radio" checked={x.a === o} onChange={() => setQ(k, { a: o })} title="Doğru cevap" />
                          <input value={x.o?.[o] || ''} onChange={e => { const oo = [...(x.o || ['', '', '', ''])]; oo[o] = e.target.value; setQ(k, { o: oo }); }} placeholder={`Şık ${o + 1}`} style={{ ...inp, borderColor: x.a === o ? '#10b981' : 'rgba(255,255,255,0.12)' }} />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button onClick={() => setBank(b => [...b, { q: '', o: ['', '', '', ''], a: 0 }])} style={btn('rgba(255,255,255,0.12)')}>➕ Soru ekle</button>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => saveBank(bank.filter(validQ))} style={btn('#10b981')}>💾 Kaydet</button>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>Yuvarlak = doğru cevap. Yapay zekâ sorularını mutlaka kontrol edin; eksik doldurulan soru kaydedilmez.</div>
              </div>
            )}
            <button onClick={openGame} disabled={!bank || !bank.filter(validQ).length} style={{ ...btn('linear-gradient(135deg,#f59e0b,#d97706)'), width: '100%', padding: '14px', fontSize: '16px', opacity: bank && bank.filter(validQ).length ? 1 : 0.5 }}>🏆 Yarışmayı aç ({bank ? bank.filter(validQ).length : 0} soru)</button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
              <span style={{ padding: '4px 10px', borderRadius: '999px', background: 'rgba(16,185,129,0.15)', color: '#10b981', fontSize: '12px', fontWeight: 700 }}>● CANLI</span>
              <b>{ses.title}</b>
              <span style={{ color: '#94a3b8', fontSize: '13px' }}>👥 {players.length} oyuncu</span>
              <span style={{ flex: 1 }} />
              <button onClick={closeGame} style={btn('rgba(239,68,68,0.25)')}>Yarışmayı kapat</button>
            </div>
            {ses.status === 'lobby' && (
              <div>
                <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Yolcular tur linkinden katılıyor. Herkes gelince başlatın.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '40px', marginBottom: '14px' }}>
                  {players.map(p => <span key={p.id} style={{ padding: '6px 12px', borderRadius: '999px', background: 'rgba(59,130,246,0.15)', fontSize: '13px' }}>{p.name}</span>)}
                  {!players.length && <span style={{ color: '#64748b', fontSize: '13px' }}>Henüz katılan yok…</span>}
                </div>
                <button onClick={() => ask(0)} disabled={!qs.length} style={{ ...btn('#10b981'), width: '100%', padding: '14px', fontSize: '16px' }}>▶ 1. soruyu gönder</button>
              </div>
            )}
            {(ses.status === 'q' || ses.status === 'reveal') && ses.q && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#94a3b8', marginBottom: '6px' }}>
                  <span>Soru {i + 1} / {ses.total}</span>
                  {ses.status === 'q' ? <span>⏱ <b style={{ color: '#fbbf24', fontSize: '16px' }}>{left ?? '…'}</b> sn · ✋ {answered}/{players.length} cevapladı</span> : <span>✅ Cevap gösterildi</span>}
                </div>
                <div style={{ fontSize: '18px', fontWeight: 700, margin: '6px 0 12px' }}>{ses.q.text}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                  {ses.q.o.map((o, k) => {
                    const n = players.filter(p => p.answers?.[i]?.c === k).length;
                    const ok = ses.status === 'reveal' && ses.correct === k;
                    return <div key={k} style={{ padding: '12px', borderRadius: '10px', background: ses.status === 'reveal' ? (ok ? '#10b981' : 'rgba(255,255,255,0.05)') : SIK_RENK[k], fontWeight: 600, fontSize: '14px', display: 'flex', justifyContent: 'space-between' }}><span>{ok ? '✓ ' : ''}{o}</span>{ses.status === 'reveal' && <span>{n}</span>}</div>;
                  })}
                </div>
                {ses.status === 'q'
                  ? <button onClick={reveal} style={{ ...btn('#3b82f6'), width: '100%' }}>Cevabı şimdi göster</button>
                  : <button onClick={() => ask(i + 1)} style={{ ...btn('#10b981'), width: '100%', padding: '14px', fontSize: '16px' }}>▶ {i + 2}. soruyu gönder</button>}
              </div>
            )}
            {(ses.status === 'reveal' || ses.status === 'end') && (
              <div style={{ marginTop: '14px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 700, marginBottom: '6px' }}>{ses.status === 'end' ? '🏁 SONUÇ' : 'SIRALAMA'}</div>
                {ranked.slice(0, ses.status === 'end' ? 10 : 5).map((p, k) => (
                  <div key={p.id} style={{ display: 'flex', gap: '10px', padding: '8px 10px', borderRadius: '8px', background: k === 0 ? 'rgba(245,158,11,0.15)' : 'transparent', fontSize: '14px' }}>
                    <b style={{ width: '28px' }}>{['🥇', '🥈', '🥉'][k] || k + 1 + '.'}</b><span style={{ flex: 1 }}>{p.name}</span>
                    {ses.status === 'reveal' && p.last ? <span style={{ color: '#10b981', fontSize: '12px' }}>+{p.last}</span> : null}<b>{p.score || 0}</b>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
