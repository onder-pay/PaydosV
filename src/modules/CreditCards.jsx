// CreditCards modülü
import { normalizeTr, trUpper } from '../lib/turkish.js';
import { useState } from 'react';


// KREDİ KARTLARI MODÜLÜ
export function CreditCardsModule({ creditCards, setCreditCards, isMobile, showToast, addToUndo }) {
  const [showForm, setShowForm] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [formData, setFormData] = useState({
    cardName: '', cardNumber: '', expiryDate: '', cvv: '', cardHolder: '', bank: '', cardType: 'Kredi Kartı', limit: '', notes: ''
  });

  const emptyForm = { cardName: '', cardNumber: '', expiryDate: '', cvv: '', cardHolder: '', bank: '', cardType: 'Kredi Kartı', limit: '', notes: '' };

  const openNewForm = () => {
    setFormData(emptyForm);
    setEditingCard(null);
    setShowForm(true);
  };

  const openEditForm = (card) => {
    setFormData(card);
    setEditingCard(card);
    setShowForm(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.cardName || !formData.cardNumber) {
      alert('Kart adı ve numara zorunludur!');
      return;
    }

    if (editingCard) {
      const updated = creditCards.map(c => c.id === editingCard.id ? { ...formData, id: editingCard.id, updatedAt: new Date().toISOString() } : c);
      setCreditCards(updated);
      showToast?.('Kart güncellendi', 'success');
    } else {
      const newCard = { ...formData, id: Date.now(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      setCreditCards([...creditCards, newCard]);
      showToast?.('Kart eklendi', 'success');
    }
    setShowForm(false);
    setFormData(emptyForm);
  };

  const deleteCard = (id) => {
    if (!confirm('Bu kartı silmek istediğinizden emin misiniz?')) return;
    const card = creditCards.find(c => c.id === id);
    const updated = creditCards.filter(c => c.id !== id);
    setCreditCards(updated);
    showToast?.('Kart silindi', 'info', () => {
        setCreditCards([...updated, card].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
        showToast?.('Kart geri yüklendi', 'success');
    });
  };

  const filteredCards = searchQuery.length >= 1
    ? creditCards.filter(c =>
        normalizeTr(c.cardName).includes(normalizeTr(searchQuery)) ||
        c.cardNumber?.includes(searchQuery) ||
        normalizeTr(c.cardHolder).includes(normalizeTr(searchQuery)) ||
        normalizeTr(c.bank).includes(normalizeTr(searchQuery))
      )
    : creditCards;

  const labelStyle = { fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' };
  const inputStyle = { width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' };

  if (showForm) {
    return (
      <div style={{ padding: '20px', minHeight: '100vh' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '20px', color: '#ffffff' }}>{editingCard ? '✏️ Kart Düzenle' : '➕ Yeni Kredi Kartı'}</h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>Kredi/Banka kartı bilgileri</p>
            </div>
            <button onClick={() => { setShowForm(false); setFormData(emptyForm); }} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', padding: '10px 16px', color: '#e8f1f8', cursor: 'pointer' }}>✕ Kapat</button>
          </div>

          <form onSubmit={handleSubmit} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={labelStyle}>Kart Adı *</label>
                <input type="text" value={formData.cardName} onChange={e => setFormData({...formData, cardName: e.target.value})} placeholder="Örn: İş Bankası Platinum" style={inputStyle} required />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={labelStyle}>Kart Numarası *</label>
                  <input type="text" value={formData.cardNumber} onChange={e => setFormData({...formData, cardNumber: e.target.value.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim()})} placeholder="0000 0000 0000 0000" maxLength="19" style={{...inputStyle, fontFamily: 'monospace', letterSpacing: '2px'}} required />
                </div>

                <div>
                  <label style={labelStyle}>Kart Sahibi</label>
                  <input type="text" value={formData.cardHolder} onChange={e => setFormData({...formData, cardHolder: trUpper(e.target.value)})} placeholder="AD SOYAD" style={{...inputStyle, textTransform: 'uppercase'}} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={labelStyle}>Son Kullanma (AA/YY)</label>
                  <input type="text" value={formData.expiryDate} onChange={e => {
                    let val = e.target.value.replace(/\D/g, '');
                    if (val.length >= 2) val = val.slice(0,2) + '/' + val.slice(2,4);
                    setFormData({...formData, expiryDate: val});
                  }} placeholder="12/28" maxLength="5" style={{...inputStyle, fontFamily: 'monospace'}} />
                </div>

                <div>
                  <label style={labelStyle}>CVV</label>
                  <input type="text" value={formData.cvv} onChange={e => setFormData({...formData, cvv: e.target.value.replace(/\D/g, '').slice(0,3)})} placeholder="000" maxLength="3" style={{...inputStyle, fontFamily: 'monospace', letterSpacing: '3px'}} />
                </div>

                <div>
                  <label style={labelStyle}>Kart Tipi</label>
                  <select value={formData.cardType} onChange={e => setFormData({...formData, cardType: e.target.value})} style={inputStyle}>
                    <option value="Kredi Kartı">Kredi Kartı</option>
                    <option value="Banka Kartı">Banka Kartı</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={labelStyle}>Banka</label>
                  <input type="text" value={formData.bank} onChange={e => setFormData({...formData, bank: e.target.value})} placeholder="Banka adı" style={inputStyle} />
                </div>

                <div>
                  <label style={labelStyle}>Limit (₺)</label>
                  <input type="number" value={formData.limit} onChange={e => setFormData({...formData, limit: e.target.value})} placeholder="0" style={inputStyle} />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Notlar</label>
                <textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="Ek bilgiler..." style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} />
              </div>

              <button type="submit" style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '700', fontSize: '16px', cursor: 'pointer' }}>
                💾 {editingCard ? 'Güncelle' : 'Kaydet'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', color: '#ffffff' }}>💳 Kredi Kartları</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>{creditCards.length} kayıtlı kart</p>
        </div>
        <button onClick={openNewForm} style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>➕ Yeni Kart</button>
      </div>

      {creditCards.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 Kart adı, numara, banka veya kart sahibi ile ara..."
              style={{ width: '100%', padding: '12px 40px 12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '18px' }}>×</button>
            )}
          </div>
          {searchQuery.length >= 1 && (
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#64748b' }}>{filteredCards.length} sonuç bulundu</p>
          )}
        </div>
      )}

      {filteredCards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>💳</div>
          <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#ffffff' }}>
            {searchQuery.length >= 1 ? 'Sonuç bulunamadı' : 'Henüz kart eklenmemiş'}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            {searchQuery.length >= 1 ? 'Farklı bir arama terimi deneyin' : 'Kredi/banka kartı bilgilerini eklemek için "Yeni Kart" butonuna tıklayın'}
          </p>
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden' }}>
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '200px 180px 150px 150px 120px 100px 80px', gap: '16px', padding: '16px 20px', background: 'rgba(16,185,129,0.1)', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '12px', fontWeight: '600', color: '#10b981' }}>
              <div>KART ADI</div>
              <div>KART NO</div>
              <div>KART SAHİBİ</div>
              <div>BANKA</div>
              <div>SÜRE</div>
              <div>CVV</div>
              <div style={{ textAlign: 'center' }}>İŞLEM</div>
            </div>
          )}
          
          <div style={{ maxHeight: isMobile ? 'none' : '600px', overflowY: 'auto' }}>
            {filteredCards.map((card, idx) => (
              <div key={card.id} style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: isMobile ? '1fr' : '200px 180px 150px 150px 120px 100px 80px', gap: '16px', padding: '16px 20px', borderBottom: idx < filteredCards.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)', alignItems: 'center' }}>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Kart Adı</span>}
                  <span style={{ fontSize: '14px', color: '#10b981', fontWeight: '600' }}>{card.cardName}</span>
                  {card.cardType && <span style={{ fontSize: '10px', color: '#64748b' }}>{card.cardType}</span>}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: isMobile ? '12px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Kart Numarası</span>}
                  <span style={{ fontSize: '13px', color: '#e8f1f8', fontFamily: 'monospace', letterSpacing: '1px' }}>
                    {card.cardNumber || '-'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: isMobile ? '12px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Kart Sahibi</span>}
                  <span style={{ fontSize: '13px', color: '#e8f1f8' }}>
                    {card.cardHolder || '-'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: isMobile ? '12px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Banka</span>}
                  <span style={{ fontSize: '13px', color: '#e8f1f8' }}>
                    {card.bank || '-'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: isMobile ? '12px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Son Kullanma</span>}
                  <span style={{ fontSize: '13px', color: '#e8f1f8', fontFamily: 'monospace' }}>
                    {card.expiryDate || '-'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: isMobile ? '12px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>CVV:</span>}
                  <span style={{ fontSize: '13px', color: '#e8f1f8', fontFamily: 'monospace', letterSpacing: '2px' }}>
                    {card.cvv || '-'}
                  </span>
                  {card.cvv && (
                    <button onClick={() => navigator.clipboard.writeText(card.cvv)} style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', padding: '4px 8px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px' }}>📋</button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: isMobile ? 'flex-start' : 'center', marginTop: isMobile ? '12px' : '0' }}>
                  <button onClick={() => openEditForm(card)} style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '8px 12px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px', fontWeight: '500' }}>✏️</button>
                  <button onClick={() => deleteCard(card.id)} style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '8px 12px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '500' }}>🗑️</button>
                </div>

                {card.notes && (
                  <div style={{ gridColumn: isMobile ? '1' : '1 / -1', marginTop: '12px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '12px', color: '#94a3b8', borderLeft: '3px solid rgba(16,185,129,0.5)' }}>
                    <strong style={{ color: '#10b981' }}>Not:</strong> {card.notes}
                  </div>
                )}

                {card.limit && (
                  <div style={{ gridColumn: isMobile ? '1' : '1 / -1', marginTop: '8px', fontSize: '12px', color: '#64748b' }}>
                    💰 Limit: <strong style={{ color: '#10b981' }}>{Number(card.limit).toLocaleString('tr-TR')} ₺</strong>
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
