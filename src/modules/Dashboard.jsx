// 📊 Ana sayfa (Dashboard) modülü
import { StatCard } from '../components/ui';
import { formatWhatsAppPhone, getDaysLeft, safeParseDate, safeParseJSON, safeParseObj } from '../lib/format.js';
import { titleCaseTr, trHas } from '../lib/turkish.js';
import { useState } from 'react';
import { BulkDocInbox, userShortcuts } from '../components/shared';


export function DashboardModule({ customers, setCustomers, appSettings, showToast, isMobile, onNavigate, onGo, currentUser }) {
  const [inboxFiles, setInboxFiles] = useState(null); // 📤 sürükle-bırak ile gelen dosyalar → Belge Yükle penceresi
  const [dragOn, setDragOn] = useState(false);
  const [showBirthdays, setShowBirthdays] = useState(false);
  const [modal, setModal] = useState(null); // {title, color, list, renderItem}
  // Bugün eklenen müşteriler
  const todayStr = new Date().toISOString().split('T')[0];
  const todayAdded = customers.filter(c => c.createdAt && String(c.createdAt).startsWith(todayStr));
  // Schengen vizesi olanlar
  // Schengen vizesi olanlar
  const withSchengen = customers.filter(c => {
    const visas = safeParseJSON(c.schengenVisas);
    return visas.some(v => v.country && v.endDate);
  });
  // USA vizesi olanlar
  const withUsa = customers.filter(c => {
    const visa = safeParseObj(c.usaVisa);
    return visa.endDate;
  });
  // Pasaportu 6 ay içinde bitecekler
  const expiringPassports = customers.filter(c => {
    const pList = safeParseJSON(c.passports);
    return pList.some(p => {
      const days = getDaysLeft(p.expiryDate);
      return days !== null && days > 0 && days <= 180;
    });
  });
  // Yeşil Pasaportlu Olanlar (passportType veya pasaport no S ile başlıyor)
  const withGreenPassport = customers.filter(c => {
    const pList = safeParseJSON(c.passports);
    return pList.some(p =>
      trHas(p.passportType, 'yesil') || // 'Yeşil'/'Yesil' (bot eskiden ş'siz yazdı)
      (p.passportNo && p.passportNo.toUpperCase().startsWith('S'))
    );
  });
  // Bugün doğum günü olanlar
  const todayBirthdays = customers.filter(c => {
    if (!c.birthDate) return false;
    const today = new Date();
    const birth = safeParseDate(c.birthDate);
    if (!birth) return false;
    return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
  });
  // Bu hafta doğum günü olanlar
  const weekBirthdays = customers.filter(c => {
    if (!c.birthDate) return false;
    const today = new Date();
    const birth = safeParseDate(c.birthDate);
    if (!birth) return false;
    const thisYear = today.getFullYear();
    const bday = new Date(thisYear, birth.getMonth(), birth.getDate());
    const diff = (bday - today) / (1000 * 60 * 60 * 24);
    return diff > 0 && diff <= 7;
  });

  // Bugün Eklenen / Güncellenen Kayıtlar
  const todayActivities = (() => {
    const today = new Date();
    const isToday = (val) => {
      if (!val) return false;
      const d = val instanceof Date ? val : new Date(val);
      if (!d || isNaN(d.getTime())) return false;
      return d.getDate() === today.getDate() &&
             d.getMonth() === today.getMonth() &&
             d.getFullYear() === today.getFullYear();
    };
    const activities = [];
    customers.forEach(c => {
      const name = `${c.firstName || ''} ${c.lastName || ''}`.trim();
      if (!name) return;

      // Yeni müşteri (createdAt bugün)
      const isNewCustomer = isToday(c.createdAt);
      if (isNewCustomer) {
        activities.push({ icon: '👤', text: `${name} müşteri olarak eklendi`, time: c.createdAt });
      }

      // Pasaport (createdAt veya addedAt veya issueDate bugünse)
      safeParseJSON(c.passports).forEach(p => {
        const passTime = p.createdAt || p.addedAt;
        if (isToday(passTime)) {
          activities.push({ icon: '📘', text: `${name} pasaportu eklendi (${p.passportNo || '?'})`, time: passTime });
        }
      });

      // Schengen vize
      safeParseJSON(c.schengenVisas).forEach(v => {
        const vTime = v.createdAt || v.addedAt;
        if (isToday(vTime)) {
          const country = v.country ? ` (${v.country})` : '';
          activities.push({ icon: '🇪🇺', text: `${name} Schengen vizesi${country} eklendi`, time: vTime });
        }
      });

      // ABD vize
      const usaVisa = typeof c.usaVisa === 'string' ? (() => { try { return JSON.parse(c.usaVisa); } catch { return {}; } })() : (c.usaVisa || {});
      if (usaVisa && isToday(usaVisa.createdAt || usaVisa.addedAt)) {
        activities.push({ icon: '🇺🇸', text: `${name} ABD vizesi eklendi`, time: usaVisa.createdAt || usaVisa.addedAt });
      }

      // Yeni müşteri olmadığı halde bugün güncellenmiş - generic kayıt
      if (!isNewCustomer && isToday(c.updatedAt || c.lastEditedAt)) {
        // Yukarıdaki pasaport/vize aktiviteleri yoksa bu güncellemeyi göster
        const alreadyListed = activities.some(a => a.text.includes(name));
        if (!alreadyListed) {
          activities.push({ icon: '✏️', text: `${name} kaydı güncellendi`, time: c.updatedAt || c.lastEditedAt });
        }
      }
    });
    // En son üstte
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));
    return activities;
  })();

  const getAge = (birthDate) => {
    const birth = safeParseDate(birthDate);
    if (!birth) return '';
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  };

  return (
    <div style={{ padding: isMobile ? '16px' : '24px' }}>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>📊 Dashboard</h2>
      {/* ⚡ Hızlı işlemler: tıklayınca ilgili modülde yeni kayıt formu açılır */}
      {onGo && (() => {
        // Amerika vize: kişiye özel DS-160 linki doğrudan panoya
        const ds160Link = () => {
          const raw = String(appSettings?.ds160SiteUrl || 'https://ds160-paydos.netlify.app').trim();
          const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
          const link = `${url}${url.includes('?') ? '&' : '?'}id=${'a' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36)}`;
          navigator.clipboard.writeText(link).then(() => showToast?.('🇺🇸 Yeni DS-160 linki kopyalandı — müşteriye gönderin', 'success'), () => window.prompt('Linki kopyalayın:', link));
        };
        const items = userShortcuts(currentUser);
        if (!items.length) return null;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
            {items.map(({ id, mod, act, url, icon, label, color }) => (
              <button key={id} onClick={() => url ? window.open(url, '_blank', 'noopener') : act === 'link' ? ds160Link() : onGo(mod, act)} title={act === 'link' ? 'Müşteriye özel yeni DS-160 linki kopyalar' : label}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: isMobile ? '8px 12px' : '9px 14px', background: `${color}1a`, border: `1px solid ${color}55`, borderRadius: '999px', color: '#e8f1f8', cursor: 'pointer', fontSize: isMobile ? '12px' : '13px', fontWeight: 600, whiteSpace: 'nowrap', transition: 'background .12s, border-color .12s' }}
                onMouseEnter={e => { e.currentTarget.style.background = `${color}33`; e.currentTarget.style.borderColor = color; }}
                onMouseLeave={e => { e.currentTarget.style.background = `${color}1a`; e.currentTarget.style.borderColor = `${color}55`; }}>
                <span style={{ fontSize: '15px', lineHeight: 1 }}>{icon}</span>{label}
              </button>
            ))}
          </div>
        );
      })()}
      {inboxFiles && <BulkDocInbox customers={customers} setCustomers={setCustomers} appSettings={appSettings} showToast={showToast} initialFiles={inboxFiles} onClose={() => setInboxFiles(null)} />}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <StatCard value={customers.length} label="Toplam Müşteri" color="#3b82f6"
          sublabel={todayAdded.length > 0 ? `+${todayAdded.length} bugün eklendi` : null} />
        <StatCard value={withSchengen.length} label="Schengen Vizeli" color="#10b981"
          sublabel="→ Listele"
          onClick={() => setModal({ title: '🇪🇺 Schengen Vizeli', color: '#10b981', list: withSchengen,
            renderItem: c => `${c.firstName} ${c.lastName}` })} />
        <StatCard value={withUsa.length} label="ABD Vizeli" color="#8b5cf6"
          sublabel="→ Listele"
          onClick={() => setModal({ title: '🇺🇸 ABD Vizeli', color: '#8b5cf6', list: withUsa,
            renderItem: c => `${c.firstName} ${c.lastName}` })} />
        <StatCard value={expiringPassports.length} label="Pasaport Uyarı" color="#ef4444"
          sublabel="→ 6 ay içinde bitenler"
          onClick={() => setModal({ title: '⚠️ Pasaport Uyarısı (6 ay)', color: '#ef4444', list: expiringPassports,
            renderItem: c => { const p = safeParseJSON(c.passports).find(x=>{const d=getDaysLeft(x.expiryDate);return d!==null&&d>0&&d<=180;}); return `${c.firstName} ${c.lastName} (${getDaysLeft(p?.expiryDate)} gün)`; } })} />
        <StatCard value={withGreenPassport.length} label="Yeşil Pasaport" color="#059669"
          sublabel="→ Listele"
          onClick={() => setModal({ title: '🟢 Yeşil Pasaport', color: '#059669', list: withGreenPassport,
            renderItem: c => `${c.firstName} ${c.lastName}` })} />
        <div onClick={() => setShowBirthdays(true)} style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '12px', padding: '16px', cursor: 'pointer', minHeight: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#f59e0b' }}>🎂 {todayBirthdays.length}</div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Bugün Doğanlar</div>
          <div style={{ fontSize: '10px', color: '#f59e0b', marginTop: '4px' }}>🎉 Tıkla ve gör!</div>
        </div>
      </div>
      {/* 📤 Belge yükle: bilet / biniş kartı / otel / vize PDF'lerini sürükle-bırak; isimden müşteri bulunur, müşteri linkine eklenir */}
      <label
        onDragEnter={e => { e.preventDefault(); setDragOn(true); }}
        onDragOver={e => { e.preventDefault(); if (!dragOn) setDragOn(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOn(false); }}
        onDrop={e => { e.preventDefault(); setDragOn(false); const f = Array.from(e.dataTransfer.files || []); if (f.length) setInboxFiles(f); }}
        style={{ display: 'flex', alignItems: 'center', gap: '22px', padding: isMobile ? '28px 18px' : '44px 36px', minHeight: isMobile ? '150px' : '190px', marginBottom: '24px', borderRadius: '16px', cursor: 'pointer',
          border: `2px dashed ${dragOn ? '#60a5fa' : 'rgba(59,130,246,0.4)'}`, background: dragOn ? 'rgba(59,130,246,0.16)' : 'rgba(59,130,246,0.06)', transition: 'background .15s, border-color .15s' }}>
        <div style={{ fontSize: isMobile ? '48px' : '64px' }}>{dragOn ? '📥' : '📤'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? '18px' : '22px', fontWeight: 700, color: '#60a5fa' }}>{dragOn ? 'Bırakın, belgeler okunsun' : 'Belge yükle — sürükleyip bırakın'}</div>
          <div style={{ fontSize: isMobile ? '13px' : '14px', color: '#94a3b8', marginTop: '6px', lineHeight: 1.5 }}>Uçak bileti, biniş kartı, otel, vize… PDF'teki isimden müşteri bulunur ve müşteri linkine eklenir. Toplu bilet PDF'i kişilere ayrılır.</div>
        </div>
        {!isMobile && <span style={{ padding: '13px 24px', borderRadius: '12px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff', fontWeight: 700, fontSize: '15px', whiteSpace: 'nowrap' }}>Dosya seç</span>}
        <input type="file" multiple accept="application/pdf,image/*" style={{ display: 'none' }} onChange={e => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) setInboxFiles(f); }} />
      </label>

      {/* Generic Liste Modal */}
      {modal && (
        <div onClick={() => setModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'linear-gradient(135deg, #0f2744, #1a3a5c)', borderRadius: '16px', border: `1px solid ${modal.color}30`, padding: '24px', width: '100%', maxWidth: '520px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: modal.color }}>{modal.title} ({modal.list.length})</h3>
              <button onClick={() => setModal(null)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', padding: '6px 12px', fontSize: '14px' }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {modal.list.length === 0 ? (
                <p style={{ color: '#64748b', textAlign: 'center', padding: '20px' }}>Kayıt yok</p>
              ) : modal.list.map((c, i) => (
                <div key={c.id || i}
                  onClick={() => { setModal(null); onNavigate?.(c); }}
                  style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', marginBottom: '6px', fontSize: '13px', color: '#e8f1f8', borderLeft: `3px solid ${modal.color}40`, cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                >
                  <span style={{ marginRight: '8px', fontSize: '11px', color: '#64748b' }}>→</span>
                  {modal.renderItem(c)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Doğum Günü Modal */}
      {showBirthdays && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setShowBirthdays(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'linear-gradient(135deg, #0f2744, #1a3a5c)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.15)', padding: '24px', width: isMobile ? '95%' : '500px', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>🎂 Doğum Günleri</h3>
              <button onClick={() => setShowBirthdays(false)} style={{ background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', padding: '6px 12px', fontSize: '14px' }}>✕</button>
            </div>

            {/* Bugün Doğanlar */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '14px', fontWeight: '600', color: '#f59e0b', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>🎉 Bugün ({todayBirthdays.length})</div>
              {todayBirthdays.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: '13px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>Bugün doğum günü olan müşteri yok</p>
              ) : (
                todayBirthdays.map(c => (
                  <div key={c.id} onClick={() => { setShowBirthdays(false); onNavigate?.(c); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px', marginBottom: '6px', cursor: 'pointer' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '14px' }}>🎂 {titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.phone || '—'} · {getAge(c.birthDate)} yaşında</div>
                    </div>
                    {c.phone && (
                      <a href={`https://wa.me/${formatWhatsAppPhone(c.phone)}`} target="_blank" rel="noreferrer" style={{ background: 'rgba(37,211,102,0.2)', border: 'none', borderRadius: '8px', color: '#25d366', padding: '6px 10px', fontSize: '12px', textDecoration: 'none', cursor: 'pointer' }}>💬 Kutla</a>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Bu Hafta Doğacaklar */}
            <div>
              <div style={{ fontSize: '14px', fontWeight: '600', color: '#3b82f6', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>📅 Bu Hafta ({weekBirthdays.length})</div>
              {weekBirthdays.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: '13px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>Bu hafta doğum günü olan müşteri yok</p>
              ) : (
                weekBirthdays.map(c => {
                  const birth = safeParseDate(c.birthDate);
                  const bday = birth ? `${birth.getDate()}/${birth.getMonth()+1}` : '';
                  return (
                    <div key={c.id} onClick={() => { setShowBirthdays(false); onNavigate?.(c); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '10px', marginBottom: '6px', cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '14px' }}>{titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>{bday} · {c.phone || '—'} · {getAge(c.birthDate)} yaşında</div>
                      </div>
                      {c.phone && (
                        <a href={`https://wa.me/${formatWhatsAppPhone(c.phone)}`} target="_blank" rel="noreferrer" style={{ background: 'rgba(37,211,102,0.15)', border: 'none', borderRadius: '8px', color: '#25d366', padding: '6px 10px', fontSize: '12px', textDecoration: 'none', cursor: 'pointer' }}>💬 WA</a>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
