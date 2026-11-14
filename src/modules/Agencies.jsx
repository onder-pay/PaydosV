// 🏢 Acentelikler modülü
import { normalizeTr, titleCaseTr, trHas } from '../lib/turkish.js';
import { useState } from 'react';


// ACENTELİKLER MODÜLÜ
export function AgenciesModule({ agencies, setAgencies, isMobile, showToast, addToUndo }) {
  const [showForm, setShowForm] = useState(false);
  const [editingAgency, setEditingAgency] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [formData, setFormData] = useState({
    name: '', link: '', institutionCode: '', userCode: '', password: '', notes: ''
  });

  const emptyForm = { name: '', link: '', institutionCode: '', userCode: '', password: '', notes: '' };

  const openNewForm = () => {
    setFormData(emptyForm);
    setEditingAgency(null);
    setShowForm(true);
  };

  const openEditForm = (agency) => {
    setFormData(agency);
    setEditingAgency(agency);
    setShowForm(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name || !formData.link) {
      alert('Acente adı ve link zorunludur!');
      return;
    }

    if (editingAgency) {
      const updated = agencies.map(a => a.id === editingAgency.id ? { ...formData, id: editingAgency.id, updatedAt: new Date().toISOString() } : a);
      setAgencies(updated);
      showToast?.('Acentelik güncellendi', 'success');
    } else {
      const newAgency = { ...formData, id: Date.now(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      setAgencies([...agencies, newAgency]);
      showToast?.('Acentelik eklendi', 'success');
    }
    setShowForm(false);
    setFormData(emptyForm);
  };

  const deleteAgency = (id) => {
    if (!confirm('Bu acenteliği silmek istediğinizden emin misiniz?')) return;
    const agency = agencies.find(a => a.id === id);
    const updated = agencies.filter(a => a.id !== id);
    setAgencies(updated);
    showToast?.('Acentelik silindi', 'info', () => {
        setAgencies([...updated, agency].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
        showToast?.('Acentelik geri yüklendi', 'success');
    });
  };

  const filteredAgencies = searchQuery.length >= 1
    ? agencies.filter(a =>
        normalizeTr(a.name).includes(normalizeTr(searchQuery)) ||
        trHas(a.link, searchQuery) ||
        trHas(a.institutionCode, searchQuery) ||
        trHas(a.userCode, searchQuery)
      )
    : agencies;

  const labelStyle = { fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' };
  const inputStyle = { width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' };

  if (showForm) {
    return (
      <div style={{ padding: '20px', minHeight: '100vh' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '20px', color: '#ffffff' }}>{editingAgency ? '✏️ Acentelik Düzenle' : '➕ Yeni Acentelik'}</h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>Kayıtlı sistem/kurum bilgileri</p>
            </div>
            <button onClick={() => { setShowForm(false); setFormData(emptyForm); }} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', padding: '10px 16px', color: '#e8f1f8', cursor: 'pointer' }}>✕ Kapat</button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={labelStyle}>Acente/Kurum Adı *</label>
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Örn: VFS Global, TLScontact" style={inputStyle} required />
              </div>

              <div>
                <label style={labelStyle}>Link/URL *</label>
                <input type="url" value={formData.link} onChange={e => setFormData({...formData, link: e.target.value})} placeholder="https://example.com" style={inputStyle} required />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={labelStyle}>Kurum Kodu</label>
                  <input type="text" value={formData.institutionCode} onChange={e => setFormData({...formData, institutionCode: e.target.value})} placeholder="Varsa kurum kodu" style={inputStyle} />
                </div>

                <div>
                  <label style={labelStyle}>Kullanıcı Kodu / E-mail</label>
                  <input type="text" value={formData.userCode} onChange={e => setFormData({...formData, userCode: e.target.value})} placeholder="Kullanıcı adı veya e-posta" style={inputStyle} />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Şifre</label>
                <input type="text" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} placeholder="••••••••" style={inputStyle} />
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#64748b' }}>⚠️ Şifre düz metin olarak saklanır, güvenlik için dikkatli olun</p>
              </div>

              <div>
                <label style={labelStyle}>Notlar</label>
                <textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="Ek bilgiler, hatırlatmalar..." style={{ ...inputStyle, minHeight: '100px', resize: 'vertical' }} />
              </div>

              <button type="submit" style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', border: 'none', borderRadius: '12px', color: '#0c1929', fontWeight: '700', fontSize: '16px', cursor: 'pointer' }}>
                💾 {editingAgency ? 'Güncelle' : 'Kaydet'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', color: '#ffffff' }}>🏢 Acentelikler</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>{agencies.length} kayıtlı sistem</p>
        </div>
        <button onClick={openNewForm} style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: '#0c1929', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>➕ Yeni Acentelik</button>
      </div>

      {/* Arama */}
      {agencies.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 Acente adı, link, kurum kodu veya kullanıcı ile ara..."
              style={{ width: '100%', padding: '12px 40px 12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '18px' }}>×</button>
            )}
          </div>
          {searchQuery.length >= 1 && (
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#64748b' }}>{filteredAgencies.length} sonuç bulundu</p>
          )}
        </div>
      )}

      {/* Liste - Tablo Görünümü */}
      {filteredAgencies.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏢</div>
          <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#ffffff' }}>
            {searchQuery.length >= 1 ? 'Sonuç bulunamadı' : 'Henüz acentelik eklenmemiş'}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            {searchQuery.length >= 1 ? 'Farklı bir arama terimi deneyin' : 'Kayıtlı sistem bilgilerini eklemek için "Yeni Acentelik" butonuna tıklayın'}
          </p>
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden' }}>
          {/* Table Header */}
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '220px 120px 160px 220px 180px 100px', gap: '12px', padding: '14px 20px', background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '11px', fontWeight: '700', color: '#f59e0b', letterSpacing: '0.5px' }}>
              <div>ACENTE ADI</div>
              <div>KURUM KODU</div>
              <div>KULLANICI</div>
              <div>ŞİFRE</div>
              <div>LİNK</div>
              <div style={{ textAlign: 'center' }}>İŞLEM</div>
            </div>
          )}
          
          {/* Table Rows */}
          <div style={{ maxHeight: isMobile ? 'none' : '600px', overflowY: 'auto' }}>
            {filteredAgencies.map((agency, idx) => (
              <div key={agency.id} style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: isMobile ? '1fr' : '220px 120px 160px 220px 180px 100px', gap: '12px', padding: '14px 20px', borderBottom: idx < filteredAgencies.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', alignItems: 'center' }}>
                
                {/* Acente Adı — tıklayınca linke gider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Acente Adı</span>}
                  {agency.link ? (
                    <a href={agency.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: '14px', color: '#f59e0b', fontWeight: '700', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {titleCaseTr(agency.name)} <span style={{ fontSize: '11px', opacity: 0.6 }}>↗</span>
                    </a>
                  ) : (
                    <span style={{ fontSize: '14px', color: '#f59e0b', fontWeight: '700' }}>{titleCaseTr(agency.name)}</span>
                  )}
                </div>

                {/* Kurum Kodu */}
                <div style={{ marginTop: isMobile ? '10px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Kurum Kodu</span>}
                  <span style={{ fontSize: '13px', color: '#e8f1f8', fontFamily: 'monospace' }}>{agency.institutionCode || <span style={{color:'#475569'}}>—</span>}</span>
                </div>

                {/* Kullanıcı */}
                <div style={{ marginTop: isMobile ? '8px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Kullanıcı</span>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#e8f1f8', fontFamily: 'monospace', wordBreak: 'break-all' }}>{agency.userCode || <span style={{color:'#475569'}}>—</span>}</span>
                    {agency.userCode && <button onClick={() => { navigator.clipboard.writeText(agency.userCode); showToast('Kullanıcı kopyalandı', 'success'); }} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '4px', padding: '2px 6px', color: '#64748b', cursor: 'pointer', fontSize: '10px', flexShrink: 0 }}>📋</button>}
                  </div>
                </div>

                {/* Şifre */}
                <div style={{ marginTop: isMobile ? '8px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Şifre</span>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '13px', color: '#e8f1f8', fontFamily: 'monospace', letterSpacing: '1px', wordBreak: 'break-all' }}>{agency.password || <span style={{color:'#475569'}}>—</span>}</span>
                    {agency.password && <button onClick={() => { navigator.clipboard.writeText(agency.password); showToast('Şifre kopyalandı', 'success'); }} style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '4px', padding: '2px 8px', color: '#3b82f6', cursor: 'pointer', fontSize: '10px', flexShrink: 0 }}>📋</button>}
                  </div>
                </div>

                {/* Link kopyala */}
                <div style={{ marginTop: isMobile ? '8px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Link</span>}
                  {agency.link ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '11px', color: '#3b82f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }} title={agency.link}>{agency.link.replace(/^https?:\/\//, '')}</span>
                      <button onClick={() => { navigator.clipboard.writeText(agency.link); showToast('Link kopyalandı', 'success'); }} style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '4px', padding: '2px 8px', color: '#10b981', cursor: 'pointer', fontSize: '10px', flexShrink: 0 }}>📋</button>
                    </div>
                  ) : <span style={{color:'#475569', fontSize:'13px'}}>—</span>}
                </div>

                {/* İşlemler */}
                <div style={{ display: 'flex', gap: '6px', justifyContent: isMobile ? 'flex-start' : 'center', marginTop: isMobile ? '12px' : '0' }}>
                  <button onClick={() => openEditForm(agency)} style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '7px 10px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px' }}>✏️</button>
                  <button onClick={() => deleteAgency(agency.id)} style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '7px 10px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🗑️</button>
                </div>

                {/* Notlar */}
                {agency.notes && (
                  <div style={{ gridColumn: isMobile ? '1' : '1 / -1', marginTop: '10px', padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '12px', color: '#94a3b8', borderLeft: '3px solid rgba(245,158,11,0.4)' }}>
                    <strong style={{ color: '#f59e0b' }}>Not:</strong> {agency.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
