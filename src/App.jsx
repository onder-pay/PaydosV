import { useState, useRef, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
// Firebase + localStorage CRM
import jsPDF from 'jspdf';
import { db } from './lib/firebase';
import { collection, addDoc, getDocs, query, orderBy } from 'firebase/firestore';
import 'jspdf-autotable';

const defaultCustomers = [];
const defaultVisaApplications = [];
const defaultTours = [];
const defaultHotels = [];
const defaultHotelReservations = [];
const defaultUsers = [{ id: 1, email: 'onder@paydostur.com', password: '123456', name: 'Önder', role: 'admin' }];

const turkishProvinces = ['Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya', 'Artvin', 'Aydın', 'Balıkesir', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari', 'Hatay', 'Isparta', 'Mersin', 'İstanbul', 'İzmir', 'Kars', 'Kastamonu', 'Kayseri', 'Kırklareli', 'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak', 'Aksaray', 'Bayburt', 'Karaman', 'Kırıkkale', 'Batman', 'Şırnak', 'Bartın', 'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye', 'Düzce'];
const sectors = ['Adalet ve Güvenlik', 'Ağaç İşleri, Kağıt ve Kağıt Ürünleri', 'Bilişim Teknolojileri', 'Cam, Çimento ve Toprak', 'Çevre', 'Devlet Memuru', 'Eğitim', 'Elektrik ve Elektronik', 'Enerji', 'Finans', 'Gıda', 'İnşaat', 'İş ve Yönetim', 'Kimya, Petrol, Lastik ve Plastik', 'Kültür, Sanat ve Tasarım', 'Maden', 'Makine', 'Medya, İletişim ve Yayıncılık', 'Metal', 'Otomotiv', 'Sağlık ve Sosyal Hizmetler', 'Spor ve Rekreasyon', 'Tarım, Avcılık ve Balıkçılık', 'Tekstil, Hazır Giyim, Deri', 'Ticaret (Satış ve Pazarlama)', 'Toplumsal ve Kişisel Hizmetler', 'Turizm, Konaklama, Yiyecek-İçecek Hizmetleri', 'Ulaştırma, Lojistik ve Haberleşme'];
const passportTypes = ['Bordo Pasaport (Umuma Mahsus)', 'Yeşil Pasaport (Hususi)', 'Gri Pasaport (Hizmet)', 'Siyah Pasaport (Diplomatik)'];
const schengenCountries = ['Almanya', 'Avusturya', 'Belçika', 'Çekya', 'Danimarka', 'Estonya', 'Finlandiya', 'Fransa', 'Hırvatistan', 'Hollanda', 'İspanya', 'İsveç', 'İsviçre', 'İtalya', 'İzlanda', 'Letonya', 'Liechtenstein', 'Litvanya', 'Lüksemburg', 'Macaristan', 'Malta', 'Norveç', 'Polonya', 'Portekiz', 'Slovakya', 'Slovenya', 'Yunanistan'];
const visaStatuses = ['Evrak Topluyor', 'Evrak Tamamlandı', 'Evraklar Gönderildi', 'E-posta Gönderildi', 'Randevu Bekliyor', 'Başvuru Yapıldı', 'Sonuç Bekliyor', 'Müşteri İptal Etti'];
const tourStatuses = ['Planlama', 'Açık', 'Dolu', 'Devam Ediyor', 'Tamamlandı', 'İptal'];
const mealPlans = ['Sadece Oda', 'Oda + Kahvaltı', 'Yarım Pansiyon', 'Tam Pansiyon', 'Her Şey Dahil'];
const currencies = ['€ Euro', '$ Dolar', '₺ TL', '£ Sterlin'];

const labelStyle = { display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: '500' };
const inputStyle = { width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };
const selectStyle = { width: '100%', padding: '10px 12px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };
const dateSelectStyle = { padding: '10px 6px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', outline: 'none' };

const isValidEmail = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const formatDate = (d) => { if (!d) return '-'; if (typeof d !== 'string') d = String(d); if (d.includes('-')) return d.split('-').reverse().join('.'); if (d.includes('.')) return d; return d; };
const safeParseTags = (val) => { if (!val) return []; if (Array.isArray(val)) return val.filter(t => t && typeof t === 'string'); if (typeof val === 'string') return val.split(',').map(t => t.trim()).filter(Boolean); return []; };
const safeParseActivities = (val) => { if (!val) return []; if (Array.isArray(val)) return val; if (typeof val === 'string') { try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch { return []; } } return []; };
const safeParseJSON = (val) => { if (!val) return []; if (Array.isArray(val)) return val; if (typeof val === 'string') { try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch { return []; } } return []; };
const safeParseDate = (dateStr) => { if (!dateStr || typeof dateStr !== 'string') return null; const parts = dateStr.split('-'); if (parts.length !== 3) return null; const [year, month, day] = parts.map(Number); if (isNaN(year) || isNaN(month) || isNaN(day)) return null; const date = new Date(year, month - 1, day, 12, 0, 0); if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null; return date; };
const safeParseNumber = (val) => { if (!val) return 0; const cleaned = String(val).replace(/[€$£₺\s]/g, '').replace(',', '.'); const num = parseFloat(cleaned); return isNaN(num) ? 0 : num; };
const getDaysLeft = (dateStr) => { const date = safeParseDate(dateStr); if (!date) return null; const today = new Date(); today.setHours(0, 0, 0, 0); date.setHours(0, 0, 0, 0); return Math.ceil((date - today) / (1000 * 60 * 60 * 24)); };
const generateUniqueId = () => Date.now() + Math.random();

// Telefon formatla: +90 5XX XXX XX XX
const formatPhoneNumber = (value) => {
  let cleaned = value.replace(/\D/g, '');
  // 90 ile başlıyorsa kaldır
  if (cleaned.startsWith('90')) cleaned = cleaned.slice(2);
  // 0 ile başlıyorsa kaldır
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  // Max 10 hane
  cleaned = cleaned.slice(0, 10);
  // Format: XXX XXX XX XX
  let formatted = '';
  if (cleaned.length > 0) formatted += cleaned.slice(0, 3);
  if (cleaned.length > 3) formatted += ' ' + cleaned.slice(3, 6);
  if (cleaned.length > 6) formatted += ' ' + cleaned.slice(6, 8);
  if (cleaned.length > 8) formatted += ' ' + cleaned.slice(8, 10);
  return formatted ? '+90 ' + formatted : '+90 5';
};

// Pasaport No formatla: İlk harf büyük, 9 karakter
const formatPassportNo = (value) => {
  // Boşluk ve özel karakterleri temizle
  let cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  if (cleaned.length === 0) return '';
  
  // İlk karakter HARF olmalı
  let firstChar = cleaned[0];
  if (!/[A-Z]/.test(firstChar)) {
    // İlk karakter harf değilse, ilk harfi bul veya boş dön
    const firstLetterMatch = cleaned.match(/[A-Z]/);
    if (!firstLetterMatch) return '';
    firstChar = firstLetterMatch[0];
    cleaned = cleaned.replace(firstChar, ''); // Harfi çıkar
  } else {
    cleaned = cleaned.slice(1); // İlk harfi ayır
  }
  
  // Geriye kalan sadece RAKAM olmalı (8 hane)
  const numbers = cleaned.replace(/[^0-9]/g, '').slice(0, 8);
  
  return firstChar + numbers;
};

// Toast Component
function Toast({ toasts, removeToast }) {
  return (
    <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {toasts.map(toast => (
        <div key={toast.id} onClick={() => removeToast(toast.id)} style={{
          padding: '14px 20px',
          borderRadius: '12px',
          background: toast.type === 'success' ? 'linear-gradient(135deg, #10b981, #059669)' : 
                      toast.type === 'error' ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 
                      toast.type === 'warning' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 
                      'linear-gradient(135deg, #3b82f6, #2563eb)',
          color: 'white',
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          minWidth: '250px',
          maxWidth: '400px',
          animation: 'slideIn 0.3s ease',
          fontSize: '14px',
          fontWeight: '500'
        }}>
          <span style={{ fontSize: '18px' }}>
            {toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'}
          </span>
          <span style={{ flex: 1 }}>{toast.message}</span>
          {toast.undo && (
            <button onClick={(e) => { e.stopPropagation(); toast.undo(); removeToast(toast.id); }} style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 12px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600'
            }}>↩️ Geri Al</button>
          )}
        </div>
      ))}
      <style>{`@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}

// Loading Button Component
function LoadingButton({ onClick, loading, disabled, children, style, ...props }) {
  return (
    <button 
      onClick={onClick} 
      disabled={loading || disabled}
      style={{
        ...style,
        opacity: (loading || disabled) ? 0.6 : 1,
        cursor: (loading || disabled) ? 'not-allowed' : 'pointer',
        position: 'relative'
      }}
      {...props}
    >
      {loading ? (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <span style={{ 
            width: '16px', 
            height: '16px', 
            border: '2px solid rgba(255,255,255,0.3)', 
            borderTop: '2px solid white', 
            borderRadius: '50%', 
            animation: 'spin 0.8s linear infinite' 
          }} />
          İşleniyor...
        </span>
      ) : children}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}

// Form Error Component
function FormError({ error }) {
  if (!error) return null;
  return (
    <p style={{ 
      margin: '4px 0 0', 
      fontSize: '11px', 
      color: '#ef4444',
      display: 'flex',
      alignItems: 'center',
      gap: '4px'
    }}>
      ⚠️ {error}
    </p>
  );
}

function CalendarPicker({ label, value, onChange, minYear = 1920, maxYear = 2035, maxDate = null, minDate = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => {
    if (value) {
      const parts = value.split('-');
      return { year: parseInt(parts[0]), month: parseInt(parts[1]) - 1 };
    }
    return { year: new Date().getFullYear(), month: new Date().getMonth() };
  });
  
  const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const days = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
  
  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => {
    const day = new Date(year, month, 1).getDay();
    return day === 0 ? 6 : day - 1;
  };
  
  const formatDisplay = (val) => {
    if (!val) return '';
    const parts = val.split('-');
    if (parts.length !== 3) return val;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  };
  
  const handleSelect = (day) => {
    const dateStr = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onChange(dateStr);
    setIsOpen(false);
  };
  
  const prevMonth = () => {
    setViewDate(prev => {
      if (prev.month === 0) return { year: prev.year - 1, month: 11 };
      return { ...prev, month: prev.month - 1 };
    });
  };
  
  const nextMonth = () => {
    setViewDate(prev => {
      if (prev.month === 11) return { year: prev.year + 1, month: 0 };
      return { ...prev, month: prev.month + 1 };
    });
  };
  
  const isDateDisabled = (day) => {
    const date = new Date(viewDate.year, viewDate.month, day);
    if (maxDate && date > new Date(maxDate)) return true;
    if (minDate && date < new Date(minDate)) return true;
    return false;
  };
  
  const isToday = (day) => {
    const today = new Date();
    return viewDate.year === today.getFullYear() && viewDate.month === today.getMonth() && day === today.getDate();
  };
  
  const isSelected = (day) => {
    if (!value) return false;
    const parts = value.split('-');
    return parseInt(parts[0]) === viewDate.year && parseInt(parts[1]) - 1 === viewDate.month && parseInt(parts[2]) === day;
  };
  
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  const daysInMonth = getDaysInMonth(viewDate.year, viewDate.month);
  const firstDay = getFirstDayOfMonth(viewDate.year, viewDate.month);
  const calendarDays = Array.from({ length: 42 }, (_, i) => {
    const day = i - firstDay + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });

  return (
    <div style={{ position: 'relative' }}>
      <label style={labelStyle}>{label}</label>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ ...inputStyle, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span style={{ color: value ? '#e8f1f8' : '#64748b' }}>{formatDisplay(value) || 'Tarih seçin'}</span>
        <span style={{ fontSize: '14px' }}>📅</span>
      </div>
      
      {isOpen && (
        <>
          <div onClick={() => setIsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 400 }} />
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '12px', padding: '12px', zIndex: 401, boxShadow: '0 10px 40px rgba(0,0,0,0.5)', minWidth: '280px' }}>
            {/* Header - Month/Year Select */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <button type="button" onClick={prevMonth} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', width: '32px', height: '32px', color: '#e8f1f8', cursor: 'pointer', fontSize: '16px' }}>‹</button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select 
                  value={viewDate.month} 
                  onChange={e => setViewDate({ ...viewDate, month: parseInt(e.target.value) })}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', padding: '6px 8px', color: '#e8f1f8', fontSize: '13px', cursor: 'pointer' }}
                >
                  {months.map((m, i) => <option key={i} value={i} style={{ background: '#0f2744' }}>{m}</option>)}
                </select>
                <select 
                  value={viewDate.year} 
                  onChange={e => setViewDate({ ...viewDate, year: parseInt(e.target.value) })}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', padding: '6px 8px', color: '#e8f1f8', fontSize: '13px', cursor: 'pointer' }}
                >
                  {years.map(y => <option key={y} value={y} style={{ background: '#0f2744' }}>{y}</option>)}
                </select>
              </div>
              <button type="button" onClick={nextMonth} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', width: '32px', height: '32px', color: '#e8f1f8', cursor: 'pointer', fontSize: '16px' }}>›</button>
            </div>
            
            {/* Day Headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
              {days.map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: '11px', color: '#64748b', padding: '4px', fontWeight: '600' }}>{d}</div>
              ))}
            </div>
            
            {/* Calendar Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
              {calendarDays.map((day, i) => (
                <div key={i}>
                  {day && (
                    <button
                      type="button"
                      onClick={() => !isDateDisabled(day) && handleSelect(day)}
                      disabled={isDateDisabled(day)}
                      style={{
                        width: '100%',
                        aspectRatio: '1',
                        border: 'none',
                        borderRadius: '8px',
                        background: isSelected(day) ? 'linear-gradient(135deg, #f59e0b, #d97706)' : isToday(day) ? 'rgba(59,130,246,0.3)' : 'transparent',
                        color: isSelected(day) ? '#0c1929' : isDateDisabled(day) ? '#4a5568' : '#e8f1f8',
                        cursor: isDateDisabled(day) ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                        fontWeight: isSelected(day) || isToday(day) ? '600' : '400',
                        transition: 'all 0.15s'
                      }}
                    >
                      {day}
                    </button>
                  )}
                </div>
              ))}
            </div>
            
            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <button 
                type="button"
                onClick={() => { const t = new Date(); handleSelect(t.getDate()); setViewDate({ year: t.getFullYear(), month: t.getMonth() }); }}
                style={{ flex: 1, padding: '8px', background: 'rgba(59,130,246,0.2)', border: 'none', borderRadius: '6px', color: '#3b82f6', fontSize: '11px', cursor: 'pointer' }}
              >
                Bugün
              </button>
              <button 
                type="button"
                onClick={() => { onChange(''); setIsOpen(false); }}
                style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '6px', color: '#ef4444', fontSize: '11px', cursor: 'pointer' }}
              >
                Temizle
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BirthDateInput({ label, value, onChange }) {
  return <CalendarPicker label={label} value={value} onChange={onChange} minYear={1920} maxYear={new Date().getFullYear()} maxDate={new Date().toISOString().split('T')[0]} />;
}

function DateInput({ label, value, onChange }) {
  return <CalendarPicker label={label} value={value} onChange={onChange} minYear={2020} maxYear={2040} />;
}

function FormInput({ label, ...p }) { return (<div><label style={labelStyle}>{label}</label><input {...p} style={inputStyle} /></div>); }
function StatCard({ value, label, color }) { return (<div style={{ background: `${color}15`, border: `1px solid ${color}30`, borderRadius: '10px', padding: '14px' }}><div style={{ fontSize: '22px', fontWeight: '700', color }}>{value}</div><div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{label}</div></div>); }
function Modal({ children, onClose, title }) { return (<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: '20px' }}><div style={{ background: 'linear-gradient(180deg, #0f2744 0%, #0c1929 100%)', borderRadius: '12px', width: '100%', maxWidth: '400px', maxHeight: '85vh', overflow: 'auto', border: '1px solid rgba(255,255,255,0.1)' }}><div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ margin: 0, fontSize: '15px', flex: 1 }}>{title}</h3><button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', color: '#94a3b8', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button></div><div style={{ padding: '14px 16px' }}>{children}</div></div></div>); }
function InfoBox({ label, value, highlight }) { return (<div style={{ background: highlight ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '8px', border: highlight ? '1px solid rgba(245,158,11,0.2)' : 'none' }}><p style={{ fontSize: '10px', color: highlight ? '#f59e0b' : '#64748b', marginBottom: '2px', textTransform: 'uppercase' }}>{label}</p><p style={{ fontSize: '12px', margin: 0, color: value ? (highlight ? '#f59e0b' : '#e8f1f8') : '#64748b' }}>{value || '-'}</p></div>); }

function LoginScreen({ onLogin, users }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    setError('');
    if (!email) { setError('E-posta adresi gerekli'); return; }
    if (!password) { setError('Şifre gerekli'); return; }
    setLoading(true);
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (user) { onLogin(user); } else { setError('E-posta veya şifre hatalı'); }
    setLoading(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0c1929 0%, #1a3a5c 50%, #0d2137 100%)', fontFamily: "'Segoe UI', sans-serif", padding: '20px' }}>
      <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '40px', width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>✈️</div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#e8f1f8', fontWeight: '700' }}>Paydos Turizm</h1>
          <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#94a3b8' }}>Giriş yapın</p>
        </div>
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '16px' }}><label style={labelStyle}>E-posta Adresi</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ornek@paydos.com" style={{ ...inputStyle, padding: '12px 14px', fontSize: '15px' }} /></div>
          <div style={{ marginBottom: '20px' }}><label style={labelStyle}>Şifre</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" style={{ ...inputStyle, padding: '12px 14px', fontSize: '15px' }} /></div>
          {error && <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '10px', marginBottom: '16px', fontSize: '12px', color: '#ef4444', textAlign: 'center' }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ width: '100%', padding: '14px', background: loading ? 'rgba(245,158,11,0.5)' : 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', color: '#0c1929', fontWeight: '700', fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer' }}>{loading ? 'Giriş yapılıyor...' : '🔓 Giriş Yap'}</button>
        </form>
      </div>
    </div>
  );
}

function DashboardModule({ customers, isMobile }) {
  const [showBirthdays, setShowBirthdays] = useState(false);
  // Schengen vizesi olanlar
  const withSchengen = customers.filter(c => {
    const visas = safeParseJSON(c.schengenVisas);
    return visas.some(v => v.country && v.endDate);
  });
  // USA vizesi olanlar
  const withUsa = customers.filter(c => {
    const visa = c.usaVisa ? (typeof c.usaVisa === 'string' ? JSON.parse(c.usaVisa || '{}') : c.usaVisa) : {};
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
  // Yeşil Pasaportlu Olanlar
  const withGreenPassport = customers.filter(c => {
    const pList = safeParseJSON(c.passports);
    return pList.some(p => p.passportType === 'Yeşil Pasaport (Hususi)');
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
      <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>📊 Dashboard</h2>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <StatCard value={customers.length} label="Toplam Müşteri" color="#3b82f6" />
        <StatCard value={withSchengen.length} label="Schengen Vizeli" color="#10b981" />
        <StatCard value={withUsa.length} label="ABD Vizeli" color="#8b5cf6" />
        <StatCard value={expiringPassports.length} label="Pasaport Uyarı" color="#ef4444" />
        <StatCard value={withGreenPassport.length} label="Yeşil Pasaport" color="#059669" />
        <div onClick={() => setShowBirthdays(true)} style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '12px', padding: '16px', cursor: 'pointer', transition: 'all 0.2s' }}>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#f59e0b' }}>🎂 {todayBirthdays.length}</div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Bugün Doğanlar</div>
          {todayBirthdays.length > 0 && <div style={{ fontSize: '10px', color: '#f59e0b', marginTop: '4px' }}>🎉 Tıkla ve gör!</div>}
        </div>
      </div>

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
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px', marginBottom: '6px' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '14px' }}>🎂 {c.firstName} {c.lastName}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.phone || '—'} · {getAge(c.birthDate)} yaşında</div>
                    </div>
                    {c.phone && (
                      <a href={`https://wa.me/90${c.phone?.replace(/\D/g,'').replace(/^0/,'')}`} target="_blank" rel="noreferrer" style={{ background: 'rgba(37,211,102,0.2)', border: 'none', borderRadius: '8px', color: '#25d366', padding: '6px 10px', fontSize: '12px', textDecoration: 'none', cursor: 'pointer' }}>💬 Kutla</a>
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
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '10px', marginBottom: '6px' }}>
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '14px' }}>{c.firstName} {c.lastName}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>{bday} · {c.phone || '—'} · {getAge(c.birthDate)} yaşında</div>
                      </div>
                      {c.phone && (
                        <a href={`https://wa.me/90${c.phone?.replace(/\D/g,'').replace(/^0/,'')}`} target="_blank" rel="noreferrer" style={{ background: 'rgba(37,211,102,0.15)', border: 'none', borderRadius: '8px', color: '#25d366', padding: '6px 10px', fontSize: '12px', textDecoration: 'none', cursor: 'pointer' }}>💬 WA</a>
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

function CustomerModule({ customers, setCustomers, isMobile, appSettings }) {
  const [activeTab, setActiveTab] = useState('search');
  const [showForm, setShowForm] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [formData, setFormData] = useState({});
  const [detailTab, setDetailTab] = useState('info');
  const [imagePreview, setImagePreview] = useState({ show: false, src: '', title: '' });
  const [showResults, setShowResults] = useState(false);
  const fileInputRef = useRef(null);

  // Arama filtreleri
  const [filters, setFilters] = useState({
    firstName: '', lastName: '', tcKimlik: '', phone: '', email: '',
    birthDate: '', birthPlace: '', city: '', tkMemberNo: '', sector: '', companyName: ''
  });

  // Pasaport state
  const [passports, setPassports] = useState([]);
  const emptyPassport = { id: '', nationality: 'Türkiye', passportType: 'Bordo Pasaport (Umuma Mahsus)', passportNo: '', issueDate: '', expiryDate: '', image: '' };

  // Schengen state (5 adet)
  const [schengenVisas, setSchengenVisas] = useState([
    { id: 1, country: '', startDate: '', endDate: '', image: '' }
  ]);

  // USA state
  const [usaVisa, setUsaVisa] = useState({ startDate: '', endDate: '', image: '' });
  const [formTab, setFormTab] = useState('info');

  const emptyForm = { 
    firstName: '', lastName: '', tcKimlik: '', phone: '', email: '', 
    birthDate: '', birthPlace: '', city: '', tkMemberNo: '', 
    sector: '', companyName: '', notes: '', tags: [], activities: [],
    passports: [], schengenVisas: [], usaVisa: {}
  };

  // === YENİ HESAPLAMALAR ===
  
  // Pasaportu 6 ay içinde bitecek müşteriler
  const expiringPassports = customers.filter(c => {
    const pList = safeParseJSON(c.passports);
    return pList.some(p => {
      const days = getDaysLeft(p.expiryDate);
      return days !== null && days > 0 && days <= 180;
    });
  });

  // Bugün doğum günü olanlar
  const todayBirthdays = customers.filter(c => {
    if (!c.birthDate) return false;
    const today = new Date();
    const birth = safeParseDate(c.birthDate);
    if (!birth) return false;
    return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
  });

  // Schengen vizesi olanlar
  const withSchengen = customers.filter(c => {
    const visas = safeParseJSON(c.schengenVisas);
    return visas.some(v => v.country && v.endDate);
  });

  // Schengen vizesi 3 ay içinde bitecekler
  const schengenExpiring = customers.filter(c => {
    const visas = safeParseJSON(c.schengenVisas);
    return visas.some(v => {
      if (!v.endDate) return false;
      const days = getDaysLeft(v.endDate);
      return days !== null && days > 0 && days <= 90;
    });
  });

  // USA vizesi olanlar
  const withUsa = customers.filter(c => {
    const visa = c.usaVisa ? (typeof c.usaVisa === 'string' ? JSON.parse(c.usaVisa || '{}') : c.usaVisa) : {};
    return visa.endDate;
  });

  // USA vizesi 1 ay içinde bitecekler
  const usaExpiring = customers.filter(c => {
    const visa = c.usaVisa ? (typeof c.usaVisa === 'string' ? JSON.parse(c.usaVisa || '{}') : c.usaVisa) : {};
    if (!visa.endDate) return false;
    const days = getDaysLeft(visa.endDate);
    return days !== null && days > 0 && days <= 30;
  });

  // Yeşil Pasaportlu Olanlar
  const withGreenPassport = customers.filter(c => {
    const pList = safeParseJSON(c.passports);
    return pList.some(p => p.passportType === 'Yeşil Pasaport (Hususi)');
  });

  // Filtreleme fonksiyonu
  const hasActiveFilter = Object.values(filters).some(v => v && v.trim() !== '');
  
  const filtered = customers.filter(c => {
    if (!hasActiveFilter) return false;
    
    const matchField = (field, value) => {
      if (!value || value.trim() === '') return true;
      const fieldVal = c[field] || '';
      return fieldVal.toLowerCase().includes(value.toLowerCase());
    };

    return matchField('firstName', filters.firstName) &&
           matchField('lastName', filters.lastName) &&
           matchField('tcKimlik', filters.tcKimlik) &&
           matchField('phone', filters.phone) &&
           matchField('email', filters.email) &&
           matchField('birthDate', filters.birthDate) &&
           matchField('birthPlace', filters.birthPlace) &&
           matchField('city', filters.city) &&
           matchField('tkMemberNo', filters.tkMemberNo) &&
           matchField('sector', filters.sector) &&
           matchField('companyName', filters.companyName);
  });

  const clearFilters = () => {
    setFilters({ firstName: '', lastName: '', tcKimlik: '', phone: '', email: '', birthDate: '', birthPlace: '', city: '', tkMemberNo: '', sector: '', companyName: '' });
    setShowResults(false);
  };

  const handleSearch = () => {
    if (hasActiveFilter) setShowResults(true);
  };

  // Excel Export
  const exportToExcel = (data, filename) => {
    const exportData = data.map(c => ({
      'Ad': c.firstName || '',
      'Soyad': c.lastName || '',
      'TC Kimlik': c.tcKimlik || '',
      'Telefon': c.phone || '',
      'E-posta': c.email || '',
      'Doğum Tarihi': formatDate(c.birthDate),
      'Doğum Yeri': c.birthPlace || '',
      'İkametgah İli': c.city || '',
      'TK Üyelik No': c.tkMemberNo || '',
      'Sektör': c.sector || '',
      'Firma': c.companyName || '',
      'Notlar': c.notes || ''
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Müşteriler');
    XLSX.writeFile(wb, `${filename}.xlsx`);
  };

  // Excel Import
  const handleExcelImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws);
        
        const newCustomers = data.map(row => ({
          id: generateUniqueId(),
          firstName: row['Ad'] || row['ad'] || row['AD'] || '',
          lastName: row['Soyad'] || row['soyad'] || row['SOYAD'] || '',
          tcKimlik: String(row['TC Kimlik'] || row['TC'] || row['tc'] || ''),
          phone: String(row['Telefon'] || row['telefon'] || row['TEL'] || ''),
          email: row['E-posta'] || row['Email'] || row['email'] || '',
          birthDate: row['Doğum Tarihi'] || '',
          birthPlace: row['Doğum Yeri'] || '',
          city: row['İkametgah İli'] || row['İl'] || row['Şehir'] || '',
          tkMemberNo: row['TK Üyelik No'] || row['TK No'] || '',
          sector: row['Sektör'] || '',
          companyName: row['Firma'] || row['Şirket'] || '',
          notes: row['Notlar'] || row['Not'] || '',
          createdAt: new Date().toISOString().split('T')[0],
          tags: [],
          activities: [],
          passports: [],
          schengenVisas: [],
          usaVisa: {}
        })).filter(c => c.firstName || c.lastName);

        if (newCustomers.length === 0) {
          alert('Excel dosyasında geçerli müşteri bulunamadı!');
          return;
        }

        setCustomers([...customers, ...newCustomers]);
        
        for (const c of newCustomers) {
        }
        
        alert(`${newCustomers.length} müşteri başarıyla eklendi!`);
        setShowExcelModal(false);
      } catch (err) {
        console.error(err);
        alert('Excel dosyası okunamadı!');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const resetForm = () => { 
    setFormData(emptyForm); 
    setEditingCustomer(null); 
    setFormTab('info');
    setPassports([{ ...emptyPassport, id: generateUniqueId() }]);
    setSchengenVisas([{ id: 1, country: '', startDate: '', endDate: '', image: '' }]);
    setUsaVisa({ startDate: '', endDate: '', image: '' });
  };
  
  const openNewForm = () => { 
    resetForm(); 
    setShowForm(true); 
  };
  
  const openEditForm = (customer) => { 
    setEditingCustomer(customer); 
    setFormData({ ...emptyForm, ...customer, tags: safeParseTags(customer.tags), activities: safeParseActivities(customer.activities) }); 
    // Pasaport bilgilerini yükle
    const savedPassports = safeParseJSON(customer.passports);
    setPassports(savedPassports.length > 0 ? savedPassports : [{ ...emptyPassport, id: generateUniqueId() }]);
    // Schengen bilgilerini yükle
    const savedSchengen = safeParseJSON(customer.schengenVisas).filter(v => v.country);
    setSchengenVisas(savedSchengen.length > 0 ? savedSchengen : [{ id: 1, country: '', startDate: '', endDate: '', image: '' }]);
    // USA bilgilerini yükle
    const savedUsa = customer.usaVisa ? (typeof customer.usaVisa === 'string' ? JSON.parse(customer.usaVisa) : customer.usaVisa) : {};
    setUsaVisa({ startDate: savedUsa.startDate || '', endDate: savedUsa.endDate || '', image: savedUsa.image || '' });
    setFormTab('info');
    setShowForm(true); 
  };

  const openPassportModal = (customer) => {
    setSelectedCustomer(customer);
    const savedPassports = safeParseJSON(customer.passports);
    setPassports(savedPassports.length > 0 ? savedPassports : [{ ...emptyPassport, id: generateUniqueId() }]);
    setShowPassportModal(true);
  };

  const openSchengenModal = (customer) => {
    setSelectedCustomer(customer);
    const saved = safeParseJSON(customer.schengenVisas).filter(v => v.country);
    setSchengenVisas(saved.length > 0 ? saved : [{ id: 1, country: '', startDate: '', endDate: '', image: '' }]);
    setShowSchengenModal(true);
  };

  const openUsaModal = (customer) => {
    setSelectedCustomer(customer);
    const saved = customer.usaVisa ? (typeof customer.usaVisa === 'string' ? JSON.parse(customer.usaVisa) : customer.usaVisa) : {};
    setUsaVisa({ startDate: saved.startDate || '', endDate: saved.endDate || '', image: saved.image || '' });
    setShowUsaModal(true);
  };

  const addPassport = () => {
    setPassports([...passports, { ...emptyPassport, id: generateUniqueId() }]);
  };

  const removePassport = (id) => {
    if (passports.length <= 1) return;
    setPassports(passports.filter(p => p.id !== id));
  };

  const updatePassport = (id, field, value) => {
    setPassports(passports.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleImageUpload = (callback) => (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { alert('Dosya boyutu 2MB\'dan küçük olmalı'); return; }
      const reader = new FileReader();
      reader.onloadend = () => callback(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!formData.firstName || !formData.lastName || !formData.phone) {
      alert('Ad, Soyad ve Telefon alanları zorunludur!');
      setFormTab('info');
      return;
    }
    
    const now = new Date().toISOString();
    const fullData = {
      ...formData,
      passports: passports,
      schengenVisas: schengenVisas,
      usaVisa: usaVisa
    };
    
    if (editingCustomer) {
      const updated = customers.map(c => c.id === editingCustomer.id ? { ...c, ...fullData } : c);
      setCustomers(updated);
      try { /* Firebase sync placeholder */ } catch (err) { console.error(err); }
    } else {
      const newCustomer = { ...fullData, id: generateUniqueId(), createdAt: now.split('T')[0] };
      setCustomers([...customers, newCustomer]);
      try { /* Firebase sync placeholder */ } catch (err) { console.error(err); }
    }
    setShowForm(false);
    resetForm();
  };

  const handlePassportSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const dataToSave = { passports: JSON.stringify(passports) };
    const updatedCustomer = { ...selectedCustomer, passports };
    const updated = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);
    setCustomers(updated);
    setSelectedCustomer(updatedCustomer);
    setShowPassportModal(false);
  };

  const handleSchengenSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const dataToSave = { schengen_visas: JSON.stringify(schengenVisas) };
    const updatedCustomer = { ...selectedCustomer, schengenVisas };
    const updated = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);
    setCustomers(updated);
    setSelectedCustomer(updatedCustomer);
    setShowSchengenModal(false);
  };

  const handleUsaSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const dataToSave = { usa_visa: JSON.stringify(usaVisa) };
    const updatedCustomer = { ...selectedCustomer, usaVisa };
    const updated = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);
    setCustomers(updated);
    setSelectedCustomer(updatedCustomer);
    setShowUsaModal(false);
  };

  const deleteCustomer = async (id) => {
    if (!confirm('Silmek istediğinize emin misiniz?')) return;
    setCustomers(customers.filter(c => c.id !== id));
    if (selectedCustomer?.id === id) setSelectedCustomer(null);
  };

  const mainTabStyle = (active) => ({
    flex: 1, padding: '10px 8px', background: active ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)',
    border: active ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: active ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '11px', fontWeight: active ? '600' : '400',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px'
  });

  const tabStyle = (active) => ({
    flex: 1, padding: '8px', background: active ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)',
    border: active ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: active ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '11px', fontWeight: active ? '600' : '400'
  });

  const ImageUploadBox = ({ label, value, onUpload, onClear, small }) => (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: small ? '8px' : '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
      {value ? (
        <div style={{ position: 'relative' }}>
          <img src={value} alt={label} style={{ width: '100%', height: small ? '50px' : '70px', objectFit: 'cover', borderRadius: '4px', cursor: 'pointer' }} onClick={() => setImagePreview({ show: true, src: value, title: label })} />
          <button type="button" onClick={onClear} style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: '50%', width: '18px', height: '18px', color: 'white', cursor: 'pointer', fontSize: '10px' }}>✕</button>
        </div>
      ) : (
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: small ? '50px' : '60px', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '4px', cursor: 'pointer', color: '#64748b', fontSize: '10px' }}>
          📷 {label}
          <input type="file" accept="image/*" onChange={onUpload} style={{ display: 'none' }} />
        </label>
      )}
    </div>
  );

  // TAM SAYFA FORM - Müşteri Ekleme/Düzenleme
  const renderFullPageForm = () => (
    <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(180deg, #0a1628 0%, #132742 50%, #0a1628 100%)', zIndex: 300, overflow: 'auto' }}>
      {/* Header */}
      <div style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, rgba(10,22,40,0.98) 0%, rgba(10,22,40,0.95) 100%)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => { setShowForm(false); resetForm(); }} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 16px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s' }}>
            <span>←</span> Geri
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#ffffff', fontWeight: '600' }}>{editingCustomer ? 'Müşteri Düzenle' : 'Yeni Müşteri'}</h2>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>{editingCustomer ? 'Bilgileri güncelleyin' : 'Müşteri bilgilerini girin'}</p>
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ display: 'flex', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '16px' }}>
          {[
            { id: 'info', icon: '👤', label: 'Kişisel', color: '#f59e0b' },
            { id: 'passport', icon: '🛂', label: 'Pasaport', color: '#3b82f6' },
            { id: 'schengen', icon: '🇪🇺', label: 'Schengen', color: '#10b981' },
            { id: 'usa', icon: '🇺🇸', label: 'ABD', color: '#8b5cf6' }
          ].map((tab, idx) => (
            <button 
              key={tab.id}
              onClick={() => setFormTab(tab.id)} 
              style={{ 
                flex: 1, 
                padding: '14px 8px', 
                background: formTab === tab.id ? `linear-gradient(135deg, ${tab.color}20, ${tab.color}10)` : 'transparent',
                border: formTab === tab.id ? `1px solid ${tab.color}40` : '1px solid transparent',
                borderRadius: '12px', 
                color: formTab === tab.id ? tab.color : '#64748b', 
                cursor: 'pointer', 
                fontSize: '12px', 
                fontWeight: formTab === tab.id ? '600' : '500',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s'
              }}
            >
              <span style={{ fontSize: '20px' }}>{tab.icon}</span>
              <span>{tab.label}</span>
              {formTab === tab.id && <div style={{ width: '20px', height: '3px', background: tab.color, borderRadius: '2px', marginTop: '2px' }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Form Content */}
      <div style={{ padding: '20px', paddingBottom: '120px' }}>
        {/* KİŞİSEL BİLGİLER */}
        {formTab === 'info' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Temel Bilgiler Card */}
            <div style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.02) 100%)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(245,158,11,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>👤</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', fontWeight: '600' }}>Temel Bilgiler</h3>
                  <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Ad, soyad ve iletişim bilgileri</p>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <FormInput label="Ad *" value={formData.firstName || ''} onChange={e => setFormData({...formData, firstName: e.target.value})} placeholder="Adı girin" />
                  <FormInput label="Soyad *" value={formData.lastName || ''} onChange={e => setFormData({...formData, lastName: e.target.value})} placeholder="Soyadı girin" />
                </div>
                <FormInput label="TC Kimlik No" value={formData.tcKimlik || ''} onChange={e => setFormData({...formData, tcKimlik: e.target.value})} maxLength="11" placeholder="11 haneli TC kimlik numarası" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>Telefon *</label>
                    <input 
                      type="tel" 
                      value={formData.phone || '+90 5'} 
                      onChange={e => setFormData({...formData, phone: formatPhoneNumber(e.target.value)})} 
                      placeholder="+90 5XX XXX XX XX"
                      style={inputStyle}
                    />
                  </div>
                  <FormInput label="E-posta" type="email" value={formData.email || ''} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="ornek@email.com" />
                </div>
              </div>
            </div>

            {/* Kişisel Detaylar Card - Dinamik */}
            <div style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.02) 100%)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(59,130,246,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>📍</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', fontWeight: '600' }}>Kişisel Detaylar</h3>
                  <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Doğum ve ikamet bilgileri</p>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Dinamik alanları göster */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {(appSettings?.personalDetailsFields || ['Doğum Tarihi', 'Doğum Yeri', 'İkametgah İli', 'TK Üyelik No']).map((field, idx) => {
                    if (field === 'Doğum Tarihi') {
                      return <BirthDateInput key={idx} label="Doğum Tarihi" value={formData.birthDate || ''} onChange={v => setFormData({...formData, birthDate: v})} />;
                    } else if (field === 'İkametgah İli') {
                      return (
                        <div key={idx}>
                          <label style={labelStyle}>İkametgah İli</label>
                          <select value={formData.city || ''} onChange={e => setFormData({...formData, city: e.target.value})} style={selectStyle}>
                            <option value="">İl seçin</option>
                            {turkishProvinces.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      );
                    } else {
                      // Diğer alanlar için generic input - field ismini key olarak kullan
                      const fieldKey = field.toLowerCase().replace(/\s+/g, '_').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c');
                      return <FormInput key={idx} label={field} value={formData[fieldKey] || ''} onChange={e => setFormData({...formData, [fieldKey]: e.target.value})} placeholder={field} />;
                    }
                  })}
                </div>
              </div>
            </div>

            {/* İş Bilgileri Card */}
            <div style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.02) 100%)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(16,185,129,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>💼</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', fontWeight: '600' }}>İş Bilgileri</h3>
                  <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Meslek ve firma bilgileri</p>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>Sektör</label>
                    <select value={formData.sector || ''} onChange={e => setFormData({...formData, sector: e.target.value})} style={selectStyle}>
                      <option value="">Sektör seçin</option>
                      {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <FormInput label="Firma" value={formData.companyName || ''} onChange={e => setFormData({...formData, companyName: e.target.value})} placeholder="Firma adı" />
                </div>
                <div>
                  <label style={labelStyle}>Notlar</label>
                  <textarea value={formData.notes || ''} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="Müşteri hakkında notlar..." style={{ ...inputStyle, minHeight: '100px', resize: 'vertical' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PASAPORT BİLGİLERİ */}
        {formTab === 'passport' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: 'rgba(59,130,246,0.1)', borderRadius: '12px', padding: '12px 16px', border: '1px solid rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>💡</span>
              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Müşterinin birden fazla pasaportu varsa hepsini ekleyebilirsiniz.</p>
            </div>
            
            {passports.map((passport, idx) => (
              <div key={passport.id} style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(59,130,246,0.03) 100%)', padding: '16px', borderRadius: '16px', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: 'white', fontWeight: '700' }}>{idx + 1}</div>
                    <h4 style={{ margin: 0, fontSize: '13px', color: '#3b82f6', fontWeight: '600' }}>Pasaport #{idx + 1}</h4>
                  </div>
                  {passports.length > 1 && (
                    <button type="button" onClick={() => removePassport(passport.id)} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', padding: '6px 10px', color: '#ef4444', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
                  )}
                </div>
                {/* Yatay düzen: Sol form, sağ görsel */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: '16px', alignItems: 'start' }}>
                  {/* Sol: Form alanları */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <FormInput label="Uyruk" value={passport.nationality || 'Türkiye'} onChange={e => updatePassport(passport.id, 'nationality', e.target.value)} />
                      <div>
                        <label style={labelStyle}>Pasaport Türü</label>
                        <select value={passport.passportType || ''} onChange={e => updatePassport(passport.id, 'passportType', e.target.value)} style={{ ...selectStyle, padding: '8px 10px', fontSize: '13px' }}>
                          {passportTypes.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={labelStyle}>Pasaport No (9 hane, ilk karakter harf)</label>
                      <input 
                        type="text" 
                        value={passport.passportNo || ''} 
                        onChange={e => updatePassport(passport.id, 'passportNo', formatPassportNo(e.target.value))}
                        placeholder="U12345678"
                        maxLength="9"
                        style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '2px', fontFamily: 'monospace' }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <DateInput label="Veriliş" value={passport.issueDate || ''} onChange={v => updatePassport(passport.id, 'issueDate', v)} />
                      <DateInput label="Geçerlilik" value={passport.expiryDate || ''} onChange={v => updatePassport(passport.id, 'expiryDate', v)} />
                    </div>
                  </div>
                  {/* Sağ: Görsel - Tıkla Büyüt */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: '#94a3b8' }}>Pasaport Görseli</label>
                    {passport.image ? (
                      <div style={{ position: 'relative' }}>
                        <img 
                          src={passport.image} 
                          alt="Pasaport" 
                          onClick={() => setImagePreview({ show: true, src: passport.image, title: `Pasaport #${idx + 1} - ${passport.passportNo || 'Görsel'}` })}
                          style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '10px', border: '2px solid rgba(59,130,246,0.3)', cursor: 'zoom-in' }} 
                        />
                        <div style={{ position: 'absolute', bottom: '6px', left: '6px', background: 'rgba(0,0,0,0.7)', padding: '4px 8px', borderRadius: '6px', fontSize: '10px', color: 'white' }}>🔍 Büyütmek için tıkla</div>
                        <button type="button" onClick={(e) => { e.stopPropagation(); updatePassport(passport.id, 'image', ''); }} style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: '50%', width: '24px', height: '24px', color: 'white', cursor: 'pointer', fontSize: '12px' }}>×</button>
                      </div>
                    ) : (
                      <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '140px', background: 'rgba(59,130,246,0.1)', border: '2px dashed rgba(59,130,246,0.3)', borderRadius: '10px', cursor: 'pointer' }}>
                        <span style={{ fontSize: '32px', marginBottom: '6px' }}>📷</span>
                        <span style={{ fontSize: '11px', color: '#3b82f6', fontWeight: '500' }}>Pasaport Yükle</span>
                        <input type="file" accept="image/*" onChange={handleImageUpload((img) => updatePassport(passport.id, 'image', img))} style={{ display: 'none' }} />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            <button type="button" onClick={addPassport} style={{ width: '100%', padding: '14px', background: 'transparent', border: '2px dashed rgba(59,130,246,0.4)', borderRadius: '12px', color: '#3b82f6', fontSize: '13px', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>+</span> Pasaport Ekle
            </button>
          </div>
        )}

        {/* SCHENGEN VİZESİ */}
        {formTab === 'schengen' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: 'rgba(16,185,129,0.1)', borderRadius: '12px', padding: '12px 16px', border: '1px solid rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>🇪🇺</span>
              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Mevcut veya geçmiş Schengen vizelerini ekleyebilirsiniz.</p>
            </div>
            
            {schengenVisas.map((visa, idx) => (
              <div key={visa.id} style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(16,185,129,0.03) 100%)', padding: '16px', borderRadius: '14px', border: '1px solid rgba(16,185,129,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: 'white', fontWeight: '700' }}>{idx + 1}</div>
                    <span style={{ fontSize: '13px', color: '#10b981', fontWeight: '600' }}>Schengen Vizesi #{idx + 1}</span>
                  </div>
                  {schengenVisas.length > 1 && (
                    <button type="button" onClick={() => setSchengenVisas(schengenVisas.filter(v => v.id !== visa.id))} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', padding: '6px 10px', color: '#ef4444', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
                  )}
                </div>
                {/* Yatay düzen: Sol form, sağ görsel - BÜYÜK */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '16px', alignItems: 'start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <label style={labelStyle}>Verildiği Ülke</label>
                      <select value={visa.country || ''} onChange={e => setSchengenVisas(schengenVisas.map(v => v.id === visa.id ? {...v, country: e.target.value} : v))} style={selectStyle}>
                        <option value="">Ülke seçin</option>
                        {schengenCountries.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <DateInput label="Başlangıç" value={visa.startDate || ''} onChange={v => setSchengenVisas(schengenVisas.map(vs => vs.id === visa.id ? {...vs, startDate: v} : vs))} />
                      <DateInput label="Bitiş" value={visa.endDate || ''} onChange={v => setSchengenVisas(schengenVisas.map(vs => vs.id === visa.id ? {...vs, endDate: v} : vs))} />
                    </div>
                  </div>
                  {/* Sağ: Görsel - Tıkla Büyüt */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: '#94a3b8' }}>Vize Görseli</label>
                    {visa.image ? (
                      <div style={{ position: 'relative' }}>
                        <img 
                          src={visa.image} 
                          alt="Vize" 
                          onClick={() => setImagePreview({ show: true, src: visa.image, title: `Schengen Vizesi #${idx + 1} - ${visa.country || 'Görsel'}` })}
                          style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '10px', border: '2px solid rgba(16,185,129,0.3)', cursor: 'zoom-in' }} 
                        />
                        <div style={{ position: 'absolute', bottom: '6px', left: '6px', background: 'rgba(0,0,0,0.7)', padding: '4px 8px', borderRadius: '6px', fontSize: '10px', color: 'white' }}>🔍 Büyüt</div>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setSchengenVisas(schengenVisas.map(v => v.id === visa.id ? {...v, image: ''} : v)); }} style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: '50%', width: '24px', height: '24px', color: 'white', cursor: 'pointer', fontSize: '12px' }}>×</button>
                      </div>
                    ) : (
                      <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '120px', background: 'rgba(16,185,129,0.1)', border: '2px dashed rgba(16,185,129,0.3)', borderRadius: '10px', cursor: 'pointer' }}>
                        <span style={{ fontSize: '28px', marginBottom: '6px' }}>📷</span>
                        <span style={{ fontSize: '11px', color: '#10b981', fontWeight: '500' }}>Vize Yükle</span>
                        <input type="file" accept="image/*" onChange={handleImageUpload((img) => setSchengenVisas(schengenVisas.map(v => v.id === visa.id ? {...v, image: img} : v)))} style={{ display: 'none' }} />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Vize Ekle Butonu - Sınırsız */}
            <button type="button" onClick={() => setSchengenVisas([...schengenVisas, { id: Date.now(), country: '', startDate: '', endDate: '', image: '' }])} style={{ width: '100%', padding: '14px', background: 'transparent', border: '2px dashed rgba(16,185,129,0.4)', borderRadius: '12px', color: '#10b981', fontSize: '13px', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>+</span> Schengen Vizesi Ekle
            </button>
          </div>
        )}

        {/* ABD VİZESİ */}
        {formTab === 'usa' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(139,92,246,0.04) 100%)', padding: '16px', borderRadius: '14px', border: '1px solid rgba(139,92,246,0.25)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🇺🇸</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '14px', color: '#ffffff', fontWeight: '600' }}>Amerika Vizesi</h3>
                  <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>ABD vize bilgilerini girin</p>
                </div>
              </div>
              {/* Yatay düzen: Sol form, sağ görsel */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: '16px', alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <DateInput label="Vize Başlangıç" value={usaVisa.startDate || ''} onChange={v => setUsaVisa({...usaVisa, startDate: v})} />
                    <DateInput label="Vize Bitiş" value={usaVisa.endDate || ''} onChange={v => setUsaVisa({...usaVisa, endDate: v})} />
                  </div>
                </div>
                {/* Sağ: Görsel - Tıkla Büyüt */}
                <div>
                  <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Vize Görseli</label>
                  {usaVisa.image ? (
                    <div style={{ position: 'relative' }}>
                      <img 
                        src={usaVisa.image} 
                        alt="ABD Vizesi" 
                        onClick={() => setImagePreview({ show: true, src: usaVisa.image, title: 'ABD Vizesi' })}
                        style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '10px', border: '2px solid rgba(139,92,246,0.3)', cursor: 'zoom-in' }} 
                      />
                      <div style={{ position: 'absolute', bottom: '6px', left: '6px', background: 'rgba(0,0,0,0.7)', padding: '4px 8px', borderRadius: '6px', fontSize: '10px', color: 'white' }}>🔍 Büyüt</div>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setUsaVisa({...usaVisa, image: ''}); }} style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: '50%', width: '24px', height: '24px', color: 'white', cursor: 'pointer', fontSize: '12px' }}>×</button>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '120px', background: 'rgba(139,92,246,0.1)', border: '2px dashed rgba(139,92,246,0.3)', borderRadius: '10px', cursor: 'pointer' }}>
                      <span style={{ fontSize: '28px', marginBottom: '6px' }}>📷</span>
                      <span style={{ fontSize: '11px', color: '#8b5cf6', fontWeight: '500' }}>Vize Yükle</span>
                      <input type="file" accept="image/*" onChange={handleImageUpload((img) => setUsaVisa({...usaVisa, image: img}))} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Save Button */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'linear-gradient(180deg, rgba(10,22,40,0) 0%, rgba(10,22,40,0.95) 20%, rgba(10,22,40,1) 100%)', padding: '20px', paddingTop: '40px' }}>
        <button onClick={handleSubmit} style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', border: 'none', borderRadius: '14px', color: '#0c1929', fontWeight: '700', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 4px 20px rgba(245,158,11,0.3)' }}>
          <span>💾</span> {editingCustomer ? 'Değişiklikleri Kaydet' : 'Müşteriyi Kaydet'}
        </button>
      </div>
    </div>
  );

  // TAM SAYFA DETAY - Müşteri Görüntüleme
  const renderFullPageDetail = () => {
    if (!selectedCustomer) return null;
    const c = selectedCustomer;
    const cPassports = safeParseJSON(c.passports);
    const cSchengen = safeParseJSON(c.schengenVisas).filter(v => v.country);
    const cUsa = c.usaVisa ? (typeof c.usaVisa === 'string' ? JSON.parse(c.usaVisa || '{}') : c.usaVisa) : {};
    const hasGreenPassport = cPassports.some(p => p.passportType === 'Yeşil Pasaport (Hususi)');

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(180deg, #0a1628 0%, #132742 50%, #0a1628 100%)', zIndex: 300, overflow: 'auto' }}>
        {/* Header */}
        <div style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, rgba(10,22,40,0.98) 0%, rgba(10,22,40,0.95) 100%)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button onClick={() => { setSelectedCustomer(null); setDetailTab('info'); }} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 16px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px' }}>← Geri</button>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#ffffff', fontWeight: '600' }}>{c.firstName} {c.lastName}</h2>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>{c.phone}</p>
            </div>
          </div>
          <button onClick={() => { setSelectedCustomer(null); openEditForm(c); }} style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>✏️ Düzenle</button>
        </div>

        {/* Tab Navigation */}
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '16px' }}>
            {[
              { id: 'info', icon: '📋', label: 'Bilgiler', color: '#f59e0b' },
              { id: 'passport', icon: '🛂', label: 'Pasaport', color: '#3b82f6', count: cPassports.length },
              { id: 'schengen', icon: '🇪🇺', label: hasGreenPassport ? 'Muaf ✓' : 'Schengen', color: '#10b981', count: hasGreenPassport ? null : cSchengen.length },
              { id: 'usa', icon: '🇺🇸', label: 'ABD', color: '#8b5cf6', count: cUsa.endDate ? 1 : 0 }
            ].map((tab) => (
              <button 
                key={tab.id}
                onClick={() => setDetailTab(tab.id)} 
                style={{ 
                  flex: 1, 
                  padding: '12px 8px', 
                  background: detailTab === tab.id ? `linear-gradient(135deg, ${tab.color}20, ${tab.color}10)` : 'transparent',
                  border: detailTab === tab.id ? `1px solid ${tab.color}40` : '1px solid transparent',
                  borderRadius: '12px', 
                  color: detailTab === tab.id ? tab.color : '#64748b', 
                  cursor: 'pointer', 
                  fontSize: '12px', 
                  fontWeight: detailTab === tab.id ? '600' : '500',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span style={{ fontSize: '18px' }}>{tab.icon}</span>
                <span>{tab.label} {tab.count !== undefined && `(${tab.count})`}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '20px', paddingBottom: '100px' }}>
          {/* KİŞİSEL BİLGİLER */}
          {detailTab === 'info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* İletişim */}
              <div style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.02) 100%)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(245,158,11,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>📞</div>
                  <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', fontWeight: '600' }}>İletişim Bilgileri</h3>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <a href={`https://wa.me/90${c.phone?.replace(/\D/g, '').replace(/^0/, '')}`} target="_blank" rel="noopener noreferrer" style={{ background: 'rgba(37,211,102,0.15)', padding: '12px', borderRadius: '10px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid rgba(37,211,102,0.3)' }}>
                      <span style={{ fontSize: '20px' }}>📱</span>
                      <div>
                        <p style={{ margin: 0, fontSize: '10px', color: '#94a3b8' }}>WhatsApp</p>
                        <p style={{ margin: 0, fontSize: '13px', color: '#25d366', fontWeight: '600' }}>{c.phone || '-'}</p>
                      </div>
                    </a>
                    {c.email ? (
                      <a href={`mailto:${c.email}`} style={{ background: 'rgba(59,130,246,0.15)', padding: '12px', borderRadius: '10px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid rgba(59,130,246,0.3)' }}>
                        <span style={{ fontSize: '20px' }}>✉️</span>
                        <div>
                          <p style={{ margin: 0, fontSize: '10px', color: '#94a3b8' }}>E-posta</p>
                          <p style={{ margin: 0, fontSize: '13px', color: '#3b82f6', fontWeight: '600' }}>{c.email}</p>
                        </div>
                      </a>
                    ) : (
                      <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '20px' }}>✉️</span>
                        <div>
                          <p style={{ margin: 0, fontSize: '10px', color: '#94a3b8' }}>E-posta</p>
                          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>-</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Kimlik Bilgileri */}
              <div style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.02) 100%)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(59,130,246,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🪪</div>
                  <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', fontWeight: '600' }}>Kimlik Bilgileri</h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <InfoBox label="TC Kimlik No" value={c.tcKimlik} />
                  <InfoBox label="TK Üyelik No" value={c.tkMemberNo} />
                  <InfoBox label="Doğum Tarihi" value={formatDate(c.birthDate)} />
                  <InfoBox label="Doğum Yeri" value={c.birthPlace} />
                  <InfoBox label="İkametgah İli" value={c.city} />
                </div>
              </div>

              {/* İş Bilgileri */}
              <div style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.02) 100%)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(16,185,129,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>💼</div>
                  <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', fontWeight: '600' }}>İş Bilgileri</h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <InfoBox label="Sektör" value={c.sector} />
                  <InfoBox label="Firma" value={c.companyName} />
                </div>
                {c.notes && (
                  <div style={{ marginTop: '10px' }}>
                    <InfoBox label="Notlar" value={c.notes} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PASAPORT */}
          {detailTab === 'passport' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {cPassports.length === 0 ? (
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                  <span style={{ fontSize: '48px' }}>🛂</span>
                  <p style={{ color: '#64748b', marginTop: '12px' }}>Pasaport bilgisi eklenmemiş</p>
                  <button onClick={() => openEditForm(c)} style={{ marginTop: '12px', padding: '10px 20px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '10px', color: '#3b82f6', cursor: 'pointer', fontSize: '13px' }}>➕ Pasaport Ekle</button>
                </div>
              ) : (
                cPassports.map((p, idx) => (
                  <div key={p.id || idx} style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(59,130,246,0.03) 100%)', padding: '20px', borderRadius: '16px', border: '1px solid rgba(59,130,246,0.2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: p.passportType?.includes('Yeşil') ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #3b82f6, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', color: 'white', fontWeight: '700' }}>{idx + 1}</div>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '14px', color: p.passportType?.includes('Yeşil') ? '#10b981' : '#3b82f6', fontWeight: '600' }}>{p.passportType || 'Pasaport'}</h4>
                          <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>{p.nationality || 'Türkiye'}</p>
                        </div>
                      </div>
                      {p.expiryDate && getDaysLeft(p.expiryDate) <= 180 && getDaysLeft(p.expiryDate) > 0 && (
                        <span style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '8px', background: 'rgba(239,68,68,0.2)', color: '#ef4444', fontWeight: '600' }}>⚠️ {getDaysLeft(p.expiryDate)} gün</span>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <InfoBox label="Pasaport No" value={p.passportNo} />
                      <InfoBox label="Veriliş Tarihi" value={formatDate(p.issueDate)} />
                      <InfoBox label="Geçerlilik Tarihi" value={formatDate(p.expiryDate)} highlight={p.expiryDate && getDaysLeft(p.expiryDate) <= 180} />
                    </div>
                    {p.image && (
                      <div style={{ marginTop: '12px' }}>
                        <img src={p.image} alt="Pasaport" onClick={() => setImagePreview({ show: true, src: p.image, title: `Pasaport - ${p.passportNo}` })} style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '10px', cursor: 'pointer' }} />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* SCHENGEN */}
          {detailTab === 'schengen' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {hasGreenPassport ? (
                <div style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(16,185,129,0.05) 100%)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(16,185,129,0.3)', textAlign: 'center' }}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', margin: '0 auto 16px' }}>✓</div>
                  <h3 style={{ margin: '0 0 8px', fontSize: '18px', color: '#10b981', fontWeight: '600' }}>Schengen Vizesi Muafiyeti</h3>
                  <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#94a3b8' }}>Bu müşteri <strong style={{ color: '#10b981' }}>Yeşil Pasaport</strong> sahibi olduğu için Schengen ülkelerine vizesiz seyahat edebilir.</p>
                  <div style={{ background: 'rgba(16,185,129,0.1)', borderRadius: '10px', padding: '12px', display: 'inline-block' }}>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>📋 90 gün içinde toplam 90 gün kalış hakkı</p>
                  </div>
                </div>
              ) : cSchengen.length === 0 ? (
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                  <span style={{ fontSize: '48px' }}>🇪🇺</span>
                  <p style={{ color: '#64748b', marginTop: '12px' }}>Schengen vizesi eklenmemiş</p>
                  <button onClick={() => openEditForm(c)} style={{ marginTop: '12px', padding: '10px 20px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '10px', color: '#10b981', cursor: 'pointer', fontSize: '13px' }}>➕ Vize Ekle</button>
                </div>
              ) : (
                cSchengen.map((v, idx) => (
                  <div key={v.id || idx} style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(16,185,129,0.03) 100%)', padding: '20px', borderRadius: '16px', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '24px' }}>🇪🇺</span>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '14px', color: '#10b981', fontWeight: '600' }}>{v.country}</h4>
                          <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Schengen Vizesi</p>
                        </div>
                      </div>
                      {v.endDate && getDaysLeft(v.endDate) > 0 && getDaysLeft(v.endDate) <= 90 && (
                        <span style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '8px', background: 'rgba(234,179,8,0.2)', color: '#eab308', fontWeight: '600' }}>⏰ {getDaysLeft(v.endDate)} gün</span>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <InfoBox label="Başlangıç" value={formatDate(v.startDate)} />
                      <InfoBox label="Bitiş" value={formatDate(v.endDate)} highlight={v.endDate && getDaysLeft(v.endDate) <= 90} />
                    </div>
                    {v.image && (
                      <div style={{ marginTop: '12px' }}>
                        <img src={v.image} alt="Vize" onClick={() => setImagePreview({ show: true, src: v.image, title: `Schengen - ${v.country}` })} style={{ width: '100%', height: '100px', objectFit: 'cover', borderRadius: '10px', cursor: 'pointer' }} />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ABD */}
          {detailTab === 'usa' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {!cUsa.endDate ? (
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                  <span style={{ fontSize: '48px' }}>🇺🇸</span>
                  <p style={{ color: '#64748b', marginTop: '12px' }}>ABD vizesi eklenmemiş</p>
                  <button onClick={() => openEditForm(c)} style={{ marginTop: '12px', padding: '10px 20px', background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '10px', color: '#8b5cf6', cursor: 'pointer', fontSize: '13px' }}>➕ Vize Ekle</button>
                </div>
              ) : (
                <div style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(139,92,246,0.04) 100%)', padding: '24px', borderRadius: '16px', border: '1px solid rgba(139,92,246,0.25)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>🇺🇸</div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '16px', color: '#ffffff', fontWeight: '600' }}>Amerika Vizesi</h3>
                        <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>ABD B1/B2 Turist Vizesi</p>
                      </div>
                    </div>
                    {cUsa.endDate && getDaysLeft(cUsa.endDate) > 0 && getDaysLeft(cUsa.endDate) <= 30 && (
                      <span style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '8px', background: 'rgba(239,68,68,0.2)', color: '#ef4444', fontWeight: '600' }}>⚠️ {getDaysLeft(cUsa.endDate)} gün</span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <InfoBox label="Vize Başlangıç" value={formatDate(cUsa.startDate)} />
                    <InfoBox label="Vize Bitiş" value={formatDate(cUsa.endDate)} highlight={cUsa.endDate && getDaysLeft(cUsa.endDate) <= 30} />
                  </div>
                  {cUsa.image && (
                    <div style={{ marginTop: '16px' }}>
                      <img src={cUsa.image} alt="ABD Vizesi" onClick={() => setImagePreview({ show: true, src: cUsa.image, title: 'ABD Vizesi' })} style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '12px', cursor: 'pointer' }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Action Buttons */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'linear-gradient(180deg, rgba(10,22,40,0) 0%, rgba(10,22,40,0.95) 20%, rgba(10,22,40,1) 100%)', padding: '20px', paddingTop: '40px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <button onClick={() => { setSelectedCustomer(null); openEditForm(c); }} style={{ padding: '14px', background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <span>✏️</span> Düzenle
            </button>
            <button onClick={() => { if(confirm('Bu müşteriyi silmek istediğinize emin misiniz?')) { deleteCustomer(c.id); setSelectedCustomer(null); } }} style={{ padding: '14px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', color: '#ef4444', fontWeight: '600', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <span>🗑️</span> Sil
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Müşteri Kartı Render
  const renderCustomerCard = (c) => {
    const cPassports = safeParseJSON(c.passports);
    const cSchengen = safeParseJSON(c.schengenVisas).filter(v => v.country);
    const cUsa = c.usaVisa ? (typeof c.usaVisa === 'string' ? JSON.parse(c.usaVisa || '{}') : c.usaVisa) : {};
    const expiringP = cPassports.find(p => { const d = getDaysLeft(p.expiryDate); return d !== null && d > 0 && d <= 180; });
    
    return (
      <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{c.firstName} {c.lastName}</h3>
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{c.phone} {c.city && `• ${c.city}`}</p>
            {c.sector && <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#94a3b8' }}>{c.sector}</p>}
          </div>
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {cPassports.length > 0 && <span style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '4px', background: 'rgba(59,130,246,0.2)', color: '#3b82f6' }}>🛂 {cPassports.length}</span>}
            {cSchengen.length > 0 && <span style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '4px', background: 'rgba(16,185,129,0.2)', color: '#10b981' }}>🇪🇺 {cSchengen.length}</span>}
            {cUsa.endDate && <span style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '4px', background: 'rgba(139,92,246,0.2)', color: '#8b5cf6' }}>🇺🇸</span>}
            {expiringP && <span style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '4px', background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>⚠️ {getDaysLeft(expiringP.expiryDate)}g</span>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: isMobile ? '16px' : '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '20px', margin: 0 }}>👥 Müşteriler ({customers.length})</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowExcelModal(true)} style={{ background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', padding: '8px 12px', color: '#10b981', cursor: 'pointer', fontSize: '12px' }}>📊 Excel</button>
          <button onClick={openNewForm} style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: '#0c1929', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>➕ Yeni</button>
        </div>
      </div>

      {/* Ana Sekmeler - Satır 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '8px' }}>
        <button onClick={() => { setActiveTab('search'); setShowResults(false); }} style={mainTabStyle(activeTab === 'search')}>
          <span style={{ fontSize: '14px' }}>🔍</span>
          <span>Arama</span>
        </button>
        <button onClick={() => setActiveTab('expiring')} style={mainTabStyle(activeTab === 'expiring')}>
          <span style={{ fontSize: '14px' }}>⚠️</span>
          <span>Pasaport ({expiringPassports.length})</span>
        </button>
        <button onClick={() => setActiveTab('birthday')} style={mainTabStyle(activeTab === 'birthday')}>
          <span style={{ fontSize: '14px' }}>🎂</span>
          <span>Doğum Günü ({todayBirthdays.length})</span>
        </button>
        <button onClick={() => setActiveTab('schengen')} style={{ ...mainTabStyle(activeTab === 'schengen'), background: activeTab === 'schengen' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'schengen' ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.1)', color: activeTab === 'schengen' ? '#10b981' : '#94a3b8' }}>
          <span style={{ fontSize: '14px' }}>🇪🇺</span>
          <span>Schengen ({withSchengen.length})</span>
        </button>
      </div>

      {/* Ana Sekmeler - Satır 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '16px' }}>
        <button onClick={() => setActiveTab('schengenExpiring')} style={{ ...mainTabStyle(activeTab === 'schengenExpiring'), background: activeTab === 'schengenExpiring' ? 'rgba(234,179,8,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'schengenExpiring' ? '1px solid rgba(234,179,8,0.3)' : '1px solid rgba(255,255,255,0.1)', color: activeTab === 'schengenExpiring' ? '#eab308' : '#94a3b8' }}>
          <span style={{ fontSize: '14px' }}>🇪🇺⏰</span>
          <span>Sch. 3ay ({schengenExpiring.length})</span>
        </button>
        <button onClick={() => setActiveTab('usa')} style={{ ...mainTabStyle(activeTab === 'usa'), background: activeTab === 'usa' ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'usa' ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(255,255,255,0.1)', color: activeTab === 'usa' ? '#8b5cf6' : '#94a3b8' }}>
          <span style={{ fontSize: '14px' }}>🇺🇸</span>
          <span>ABD ({withUsa.length})</span>
        </button>
        <button onClick={() => setActiveTab('usaExpiring')} style={{ ...mainTabStyle(activeTab === 'usaExpiring'), background: activeTab === 'usaExpiring' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'usaExpiring' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.1)', color: activeTab === 'usaExpiring' ? '#ef4444' : '#94a3b8' }}>
          <span style={{ fontSize: '14px' }}>🇺🇸⏰</span>
          <span>ABD 1ay ({usaExpiring.length})</span>
        </button>
        <button onClick={() => setActiveTab('greenPassport')} style={{ ...mainTabStyle(activeTab === 'greenPassport'), background: activeTab === 'greenPassport' ? 'rgba(5,150,105,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'greenPassport' ? '1px solid rgba(5,150,105,0.3)' : '1px solid rgba(255,255,255,0.1)', color: activeTab === 'greenPassport' ? '#059669' : '#94a3b8' }}>
          <span style={{ fontSize: '14px' }}>🟢</span>
          <span>Yeşil Pas. ({withGreenPassport.length})</span>
        </button>
      </div>

      {/* ARAMA SEKMESİ */}
      {activeTab === 'search' && (
        <>
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '12px', marginBottom: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '8px' }}>
              <FormInput label="Ad" value={filters.firstName} onChange={e => setFilters({...filters, firstName: e.target.value})} placeholder="Ad ara..." />
              <FormInput label="Soyad" value={filters.lastName} onChange={e => setFilters({...filters, lastName: e.target.value})} placeholder="Soyad ara..." />
              <FormInput label="TC Kimlik" value={filters.tcKimlik} onChange={e => setFilters({...filters, tcKimlik: e.target.value})} placeholder="TC ara..." />
              <FormInput label="Telefon" value={filters.phone} onChange={e => setFilters({...filters, phone: e.target.value})} placeholder="Telefon ara..." />
              <FormInput label="E-posta" value={filters.email} onChange={e => setFilters({...filters, email: e.target.value})} placeholder="E-posta ara..." />
              <FormInput label="Doğum Yeri" value={filters.birthPlace} onChange={e => setFilters({...filters, birthPlace: e.target.value})} placeholder="Doğum yeri ara..." />
              <div>
                <label style={labelStyle}>İkametgah İli</label>
                <select value={filters.city} onChange={e => setFilters({...filters, city: e.target.value})} style={selectStyle}>
                  <option value="">Tümü</option>
                  {turkishProvinces.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <FormInput label="TK Üyelik No" value={filters.tkMemberNo} onChange={e => setFilters({...filters, tkMemberNo: e.target.value})} placeholder="TK No ara..." />
              <div>
                <label style={labelStyle}>Sektör</label>
                <select value={filters.sector} onChange={e => setFilters({...filters, sector: e.target.value})} style={selectStyle}>
                  <option value="">Tümü</option>
                  {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <FormInput label="Firma" value={filters.companyName} onChange={e => setFilters({...filters, companyName: e.target.value})} placeholder="Firma ara..." />
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button onClick={handleSearch} disabled={!hasActiveFilter} style={{ flex: 1, padding: '10px', background: hasActiveFilter ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', color: hasActiveFilter ? 'white' : '#64748b', fontWeight: '600', cursor: hasActiveFilter ? 'pointer' : 'not-allowed', fontSize: '13px' }}>🔍 Ara ({hasActiveFilter ? filtered.length : 0} sonuç)</button>
              <button onClick={clearFilters} style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '13px' }}>✕ Temizle</button>
              {showResults && filtered.length > 0 && (
                <button onClick={() => exportToExcel(filtered, `Musteri_Arama_${new Date().toLocaleDateString('tr')}`)} style={{ padding: '10px 16px', background: 'rgba(16,185,129,0.2)', border: 'none', borderRadius: '8px', color: '#10b981', cursor: 'pointer', fontSize: '13px' }}>📥 Excel</button>
              )}
            </div>
          </div>

          {/* Arama Sonuçları */}
          {showResults && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filtered.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>Arama kriterlerine uygun müşteri bulunamadı</p>
              ) : (
                filtered.map(c => renderCustomerCard(c))
              )}
            </div>
          )}
          
          {!showResults && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
              <p style={{ fontSize: '14px' }}>Yukarıdaki filtrelerden en az birini doldurup "Ara" butonuna tıklayın</p>
            </div>
          )}
        </>
      )}

      {/* PASAPORT UYARI SEKMESİ */}
      {activeTab === 'expiring' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <p style={{ fontSize: '12px', color: '#f59e0b' }}>⚠️ 6 ay içinde pasaportu bitecek müşteriler</p>
            {expiringPassports.length > 0 && (
              <button onClick={() => exportToExcel(expiringPassports, `Pasaport_Uyari_${new Date().toLocaleDateString('tr')}`)} style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.2)', border: 'none', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
            )}
          </div>
          {expiringPassports.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>6 ay içinde pasaportu bitecek müşteri yok 🎉</p>
          ) : (
            expiringPassports.map(c => {
              const pList = safeParseJSON(c.passports);
              const expP = pList.find(p => { const d = getDaysLeft(p.expiryDate); return d !== null && d > 0 && d <= 180; });
              return (
                <div key={c.id} style={{ background: 'rgba(239,68,68,0.1)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div onClick={() => setSelectedCustomer(c)} style={{ cursor: 'pointer' }}>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{c.firstName} {c.lastName}</h3>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{c.phone}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(239,68,68,0.3)', color: '#ef4444', fontWeight: '600' }}>{getDaysLeft(expP?.expiryDate)} gün kaldı</span>
                      <p style={{ margin: '4px 0 0', fontSize: '10px', color: '#94a3b8' }}>Bitiş: {formatDate(expP?.expiryDate)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* DOĞUM GÜNÜ SEKMESİ */}
      {activeTab === 'birthday' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <p style={{ fontSize: '12px', color: '#f59e0b' }}>🎂 Bugün doğum günü olanlar</p>
            {todayBirthdays.length > 0 && (
              <button onClick={() => exportToExcel(todayBirthdays, `Dogum_Gunu_${new Date().toLocaleDateString('tr')}`)} style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.2)', border: 'none', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
            )}
          </div>
          {todayBirthdays.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>Bugün doğum günü olan müşteri yok</p>
          ) : (
            todayBirthdays.map(c => (
              <div key={c.id} style={{ background: 'rgba(245,158,11,0.1)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(245,158,11,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div onClick={() => setSelectedCustomer(c)} style={{ cursor: 'pointer' }}>
                    <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>🎂 {c.firstName} {c.lastName}</h3>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{c.phone}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '11px', color: '#f59e0b' }}>Doğum Günün Kutlu Olsun!</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* SCHENGEN VİZESİ OLANLAR */}
      {activeTab === 'schengen' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <p style={{ fontSize: '12px', color: '#10b981' }}>🇪🇺 Schengen vizesi olan müşteriler</p>
            {withSchengen.length > 0 && (
              <button onClick={() => exportToExcel(withSchengen, `Schengen_Vizeli_${new Date().toLocaleDateString('tr')}`)} style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.2)', border: 'none', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
            )}
          </div>
          {withSchengen.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>Schengen vizesi olan müşteri yok</p>
          ) : (
            withSchengen.map(c => {
              const visas = safeParseJSON(c.schengenVisas).filter(v => v.country);
              const activeVisa = visas.find(v => getDaysLeft(v.endDate) > 0);
              return (
                <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: 'rgba(16,185,129,0.1)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(16,185,129,0.2)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{c.firstName} {c.lastName}</h3>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{c.phone}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {activeVisa && (
                        <>
                          <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(16,185,129,0.3)', color: '#10b981', fontWeight: '600' }}>{activeVisa.country}</span>
                          <p style={{ margin: '4px 0 0', fontSize: '10px', color: '#94a3b8' }}>Bitiş: {formatDate(activeVisa.endDate)}</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* SCHENGEN 3 AY İÇİNDE BİTECEK */}
      {activeTab === 'schengenExpiring' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <p style={{ fontSize: '12px', color: '#eab308' }}>🇪🇺⏰ 3 ay içinde Schengen vizesi bitecek müşteriler</p>
            {schengenExpiring.length > 0 && (
              <button onClick={() => exportToExcel(schengenExpiring, `Schengen_Uyari_${new Date().toLocaleDateString('tr')}`)} style={{ padding: '6px 12px', background: 'rgba(234,179,8,0.2)', border: 'none', borderRadius: '6px', color: '#eab308', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
            )}
          </div>
          {schengenExpiring.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>3 ay içinde Schengen vizesi bitecek müşteri yok 🎉</p>
          ) : (
            schengenExpiring.map(c => {
              const visas = safeParseJSON(c.schengenVisas);
              const expVisa = visas.find(v => { const d = getDaysLeft(v.endDate); return d !== null && d > 0 && d <= 90; });
              return (
                <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: 'rgba(234,179,8,0.1)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(234,179,8,0.2)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{c.firstName} {c.lastName}</h3>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{c.phone} • {expVisa?.country}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(234,179,8,0.3)', color: '#eab308', fontWeight: '600' }}>{getDaysLeft(expVisa?.endDate)} gün kaldı</span>
                      <p style={{ margin: '4px 0 0', fontSize: '10px', color: '#94a3b8' }}>Bitiş: {formatDate(expVisa?.endDate)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ABD VİZESİ OLANLAR */}
      {activeTab === 'usa' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <p style={{ fontSize: '12px', color: '#8b5cf6' }}>🇺🇸 ABD vizesi olan müşteriler</p>
            {withUsa.length > 0 && (
              <button onClick={() => exportToExcel(withUsa, `ABD_Vizeli_${new Date().toLocaleDateString('tr')}`)} style={{ padding: '6px 12px', background: 'rgba(139,92,246,0.2)', border: 'none', borderRadius: '6px', color: '#8b5cf6', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
            )}
          </div>
          {withUsa.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>ABD vizesi olan müşteri yok</p>
          ) : (
            withUsa.map(c => {
              const visa = c.usaVisa ? (typeof c.usaVisa === 'string' ? JSON.parse(c.usaVisa || '{}') : c.usaVisa) : {};
              return (
                <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: 'rgba(139,92,246,0.1)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(139,92,246,0.2)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{c.firstName} {c.lastName}</h3>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{c.phone}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(139,92,246,0.3)', color: '#8b5cf6', fontWeight: '600' }}>🇺🇸 ABD</span>
                      <p style={{ margin: '4px 0 0', fontSize: '10px', color: '#94a3b8' }}>Bitiş: {formatDate(visa.endDate)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ABD 1 AY İÇİNDE BİTECEK */}
      {activeTab === 'usaExpiring' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <p style={{ fontSize: '12px', color: '#ef4444' }}>🇺🇸⏰ 1 ay içinde ABD vizesi bitecek müşteriler</p>
            {usaExpiring.length > 0 && (
              <button onClick={() => exportToExcel(usaExpiring, `ABD_Uyari_${new Date().toLocaleDateString('tr')}`)} style={{ padding: '6px 12px', background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
            )}
          </div>
          {usaExpiring.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>1 ay içinde ABD vizesi bitecek müşteri yok 🎉</p>
          ) : (
            usaExpiring.map(c => {
              const visa = c.usaVisa ? (typeof c.usaVisa === 'string' ? JSON.parse(c.usaVisa || '{}') : c.usaVisa) : {};
              return (
                <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: 'rgba(239,68,68,0.1)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{c.firstName} {c.lastName}</h3>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{c.phone}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(239,68,68,0.3)', color: '#ef4444', fontWeight: '600' }}>{getDaysLeft(visa.endDate)} gün kaldı</span>
                      <p style={{ margin: '4px 0 0', fontSize: '10px', color: '#94a3b8' }}>Bitiş: {formatDate(visa.endDate)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* YEŞİL PASAPORT SEKMESİ */}
      {activeTab === 'greenPassport' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <p style={{ fontSize: '12px', color: '#059669' }}>🟢 Yeşil Pasaport (Hususi) sahibi müşteriler</p>
            {withGreenPassport.length > 0 && (
              <button onClick={() => exportToExcel(withGreenPassport, `Yesil_Pasaport_${new Date().toLocaleDateString('tr')}`)} style={{ padding: '6px 12px', background: 'rgba(5,150,105,0.2)', border: 'none', borderRadius: '6px', color: '#059669', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
            )}
          </div>
          {withGreenPassport.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>Yeşil Pasaport sahibi müşteri yok</p>
          ) : (
            withGreenPassport.map(c => {
              const pList = safeParseJSON(c.passports);
              const greenPassport = pList.find(p => p.passportType === 'Yeşil Pasaport (Hususi)');
              return (
                <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: 'rgba(5,150,105,0.1)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(5,150,105,0.2)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{c.firstName} {c.lastName}</h3>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{c.phone}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(5,150,105,0.3)', color: '#059669', fontWeight: '600' }}>🟢 Yeşil</span>
                      {greenPassport?.passportNo && (
                        <p style={{ margin: '4px 0 0', fontSize: '10px', color: '#94a3b8' }}>No: {greenPassport.passportNo}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Excel Modal */}
      {showExcelModal && (
        <Modal title="📊 Excel İşlemleri" onClose={() => setShowExcelModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: 'rgba(16,185,129,0.1)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(16,185,129,0.2)' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#10b981' }}>📥 Excel'den Yükle</h4>
              <p style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '10px' }}>Excel dosyanızda şu sütunlar olmalı: Ad, Soyad, TC Kimlik, Telefon, E-posta, Doğum Tarihi, Doğum Yeri, İkametgah İli, TK Üyelik No, Sektör, Firma, Notlar</p>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleExcelImport} style={{ display: 'none' }} />
              <button onClick={() => fileInputRef.current?.click()} style={{ width: '100%', padding: '10px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', color: '#10b981', cursor: 'pointer', fontSize: '12px' }}>📂 Dosya Seç</button>
            </div>
            
            <div style={{ background: 'rgba(59,130,246,0.1)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.2)' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#3b82f6' }}>📤 Excel'e Aktar</h4>
              <button onClick={() => exportToExcel(customers, `Tum_Musteriler_${new Date().toLocaleDateString('tr')}`)} style={{ width: '100%', padding: '10px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px' }}>📥 Tüm Müşterileri İndir ({customers.length})</button>
            </div>
          </div>
        </Modal>
      )}

      {showForm && renderFullPageForm()}
      {selectedCustomer && renderFullPageDetail()}

      {/* Image Preview */}
      {imagePreview.show && (
        <div onClick={() => setImagePreview({ show: false, src: '', title: '' })} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: '20px' }}>
          <div style={{ maxWidth: '90%', maxHeight: '90%' }}>
            <p style={{ color: 'white', textAlign: 'center', marginBottom: '10px', fontSize: '14px' }}>{imagePreview.title}</p>
            <img src={imagePreview.src} alt={imagePreview.title} style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '8px' }} />
            <p style={{ color: '#64748b', textAlign: 'center', marginTop: '10px', fontSize: '12px' }}>Kapatmak için tıklayın</p>
          </div>
        </div>
      )}
    </div>
  );
}

// VİZE MODÜLÜ
function VisaModule({ customers, visaApplications, setVisaApplications, isMobile, onNavigateToCustomers, appSettings, showToast, addToUndo }) {
  const [activeTab, setActiveTab] = useState('calendar');
  const [showForm, setShowForm] = useState(false);
  const [formStep, setFormStep] = useState('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [visaSearchQuery, setVisaSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [dayDetailModal, setDayDetailModal] = useState(null);
  const [editingVisa, setEditingVisa] = useState(null);
  const [formData, setFormData] = useState({});
  const [checklist, setChecklist] = useState({ passportValid: null, passportCondition: null, addressChecked: null });
  const [selectedVisa, setSelectedVisa] = useState(null);

  const paymentStatuses = ['Ödenmedi', 'Ödendi'];

  // Vize kategorileri - durations appSettings'ten alınır
  const visaCategories = [
    { id: 'schengen', label: 'Schengen', icon: '🇪🇺', color: '#10b981', countries: ['Almanya', 'Fransa', 'İtalya', 'İspanya', 'Hollanda', 'Belçika', 'Avusturya', 'Yunanistan', 'Portekiz', 'Polonya', 'Çekya', 'Macaristan', 'İsviçre', 'Danimarka', 'İsveç', 'Norveç', 'Finlandiya'], durations: null },
    { id: 'usa', label: 'Amerika', icon: '🇺🇸', color: '#3b82f6', countries: ['Amerika Birleşik Devletleri'], durations: appSettings?.visaDurations?.usa || null },
    { id: 'russia', label: 'Rusya', icon: '🇷🇺', color: '#ef4444', countries: ['Rusya'], durations: appSettings?.visaDurations?.russia || null },
    { id: 'uk', label: 'İngiltere', icon: '🇬🇧', color: '#8b5cf6', countries: ['İngiltere'], durations: appSettings?.visaDurations?.uk || null },
    { id: 'uae', label: 'BAE', icon: '🇦🇪', color: '#f59e0b', countries: ['Birleşik Arap Emirlikleri'], durations: appSettings?.visaDurations?.uae || null },
    { id: 'china', label: 'Çin', icon: '🇨🇳', color: '#dc2626', countries: ['Çin'], durations: appSettings?.visaDurations?.china || null },
    { id: 'other', label: 'Diğer', icon: '🌍', color: '#64748b', countries: ['Kanada', 'Avustralya', 'Japonya', 'Hindistan', 'Güney Kore', 'Brezilya', 'Meksika', 'Diğer'], durations: null }
  ];

  const visaTypes = ['Ticari', 'Turistik', 'Aile/Arkadaş Ziyareti', 'Fuar Katılımcı', 'Tedavi', 'Eğitim', 'Transit', 'Diğer'];
  const visaStatuses = ['Evrak Topluyor', 'Evrak Tamamlandı', 'Randevu Alındı', 'Başvuru Yapıldı', 'Sonuç Bekliyor', 'Onaylandı', 'Reddedildi'];

  // Hex to RGBA helper
  const hexToRgb = (hex) => {
    const colorMap = {
      '#10b981': '16,185,129',
      '#3b82f6': '59,130,246',
      '#ef4444': '239,68,68',
      '#8b5cf6': '139,92,246',
      '#f59e0b': '245,158,11',
      '#dc2626': '220,38,38',
      '#64748b': '100,116,139'
    };
    return colorMap[hex] || '100,116,139';
  };

  // Vize başvuruları arama/filtreleme
  const filteredVisaApplications = visaSearchQuery.length >= 2
    ? visaApplications.filter(v =>
        v.customerName?.toLowerCase().includes(visaSearchQuery.toLowerCase()) ||
        v.customerPhone?.includes(visaSearchQuery) ||
        v.country?.toLowerCase().includes(visaSearchQuery.toLowerCase()) ||
        v.pnr?.toLowerCase().includes(visaSearchQuery.toLowerCase())
      )
    : visaApplications;

  // Excel export fonksiyonu
  const exportToExcel = () => {
    if (visaApplications.length === 0) {
      showToast?.('Export edilecek vize başvurusu yok', 'warning');
      return;
    }
    const data = visaApplications.map(v => ({
      'Müşteri Adı': v.customerName || '',
      'Telefon': v.customerPhone || '',
      'Kategori': getCategoryInfo(v.category)?.label || v.category || '',
      'Ülke': v.country || '',
      'Vize Türü': v.visaType || '',
      'Vize Süresi': v.visaDuration || '',
      'Başvuru Tarihi': formatDate(v.applicationDate) || '',
      'Randevu Tarihi': formatDate(v.appointmentDate) || '',
      'Randevu Saati': v.appointmentTime || '',
      'PNR': v.pnr || '',
      'İşlem': v.processor || '',
      'Ödeme Durumu': v.paymentStatus || '',
      'Durum': v.status || '',
      'Notlar': v.notes || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vize Başvuruları');
    XLSX.writeFile(wb, `vize-basvurulari-${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.(`${visaApplications.length} başvuru Excel'e aktarıldı`, 'success');
  };

  // Arama sonuçları (form için müşteri arama)
  const searchResults = searchQuery.length >= 2 
    ? customers.filter(c => 
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.phone?.includes(searchQuery)
      ).slice(0, 10)
    : [];

  // 10 gün ve altı randevular
  const upcomingReminders = visaApplications.filter(v => {
    if (!v.appointmentDate) return false;
    const days = getDaysLeft(v.appointmentDate);
    return days !== null && days >= 0 && days <= 10;
  }).sort((a, b) => new Date(a.appointmentDate) - new Date(b.appointmentDate));

  // Takvim
  const today = new Date();
  const [calendarMonth, setCalendarMonth] = useState(today.getMonth());
  const [calendarYear, setCalendarYear] = useState(today.getFullYear());

  const getMonthDays = (year, month) => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];
    const startPadding = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    for (let i = 0; i < startPadding; i++) days.push({ day: null, date: null });
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      const dateStr = date.toISOString().split('T')[0];
      const appointments = visaApplications.filter(v => v.appointmentDate === dateStr);
      days.push({ day: d, date: dateStr, appointments });
    }
    return days;
  };

  const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const month1Days = getMonthDays(calendarYear, calendarMonth);
  const month2Year = calendarMonth === 11 ? calendarYear + 1 : calendarYear;
  const month2Month = calendarMonth === 11 ? 0 : calendarMonth + 1;
  const month2Days = getMonthDays(month2Year, month2Month);

  const resetForm = () => {
    setFormStep('search');
    setSearchQuery('');
    setSelectedCustomer(null);
    setSelectedCategory(null);
    setChecklist({ passportValid: null, passportCondition: null, addressChecked: null });
    setFormData({});
    setEditingVisa(null);
  };

  const openNewForm = () => { resetForm(); setShowForm(true); };

  const selectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setFormStep('checklist');
  };

  const handleChecklistNext = () => {
    if (checklist.passportValid !== 'yes') {
      alert('⚠️ Pasaport geçerlilik tarihi uygun değil!\n\nSeyahat dönüş tarihinden itibaren 6 ay geçerli olmalı.');
      return;
    }
    if (checklist.passportCondition !== 'no') {
      alert('⚠️ Pasaportta yırtık/çizik var!\n\nBaşvuru yapılamaz, yeni pasaport gerekli.');
      return;
    }
    if (checklist.addressChecked !== 'yes') {
      alert('⚠️ İkametgah adresi kontrol edilmeli!\n\nBölge ayrımı önemli, doğru konsolosluk belirlenmeli.');
      return;
    }
    setFormStep('category');
  };

  const selectCategory = (cat) => {
    setSelectedCategory(cat);
    setFormStep('details');
    const today = new Date().toISOString().split('T')[0];
    setFormData({
      customerId: selectedCustomer.id,
      customerName: `${selectedCustomer.firstName} ${selectedCustomer.lastName}`,
      customerPhone: selectedCustomer.phone,
      customerEmail: selectedCustomer.email || '',
      category: cat.id,
      country: '',
      visaType: '',
      applicationDate: today,
      appointmentDate: '',
      appointmentTime: '',
      pnr: '',
      processor: appSettings?.processors?.[0] || 'Paydos',
      paymentStatus: 'Ödenmedi',
      status: 'Evrak Topluyor',
      notes: '',
      price: '',
      cost: '',
      currency: '€'
    });
  };

  const sendWhatsAppReminder = (visa) => {
    if (!visa.appointmentDate || !visa.customerPhone) {
      alert('Randevu tarihi veya telefon numarası eksik!');
      return;
    }
    let message = appSettings?.whatsappTemplate || 'Randevu bilgileriniz: {tarih}';
    message = message
      .replace('{isim}', visa.customerName || '')
      .replace('{ulke}', visa.country || '')
      .replace('{tarih}', formatDate(visa.appointmentDate) || '')
      .replace('{saat}', visa.appointmentTime || '')
      .replace('{pnr}', visa.pnr || '-');
    
    const phone = visa.customerPhone.replace(/\D/g, '');
    const fullPhone = phone.startsWith('90') ? phone : `90${phone}`;
    window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const sendEmail = (visa) => {
    if (!visa.customerEmail) {
      alert('Müşteri e-posta adresi bulunamadı!');
      return;
    }
    const subject = `${visa.country} Vize Randevu Bilgisi`;
    const body = `Sayın ${visa.customerName},\n\n${visa.country} vize randevunuz ${formatDate(visa.appointmentDate)} tarihinde${visa.appointmentTime ? ` saat ${visa.appointmentTime}` : ''} için alınmıştır.\n\nPNR: ${visa.pnr || '-'}\n\nPaydos Turizm`;
    window.open(`mailto:${visa.customerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
  };

  const sendWhatsApp = (visa) => {
    const phone = visa.customerPhone?.replace(/\D/g, '');
    if (!phone) return;
    const fullPhone = phone.startsWith('90') ? phone : `90${phone}`;
    window.open(`https://wa.me/${fullPhone}`, '_blank');
  };

  const generateProforma = async (visa) => {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      
      // Logo ve Header
      doc.setFontSize(20);
      doc.setTextColor(15, 23, 42);
      doc.text('PAYDOS TURİZM', 105, 20, { align: 'center' });
      
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text('Proforma Fatura', 105, 28, { align: 'center' });
      
      // Müşteri Bilgileri
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text('Müşteri Bilgileri', 20, 45);
      
      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85);
      doc.text(`Ad Soyad: ${visa.customerName}`, 20, 55);
      doc.text(`Telefon: ${visa.customerPhone || '-'}`, 20, 62);
      doc.text(`Tarih: ${new Date().toLocaleDateString('tr-TR')}`, 20, 69);
      
      // Vize Detayları
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text('Vize Detayları', 20, 85);
      
      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85);
      doc.text(`Ülke: ${visa.country}`, 20, 95);
      doc.text(`Vize Türü: ${visa.visaDuration || visa.visaType}`, 20, 102);
      
      if (visa.applicationDate) {
        doc.text(`Başvuru Tarihi: ${formatDate(visa.applicationDate)}`, 20, 109);
      }
      
      if (visa.appointmentDate) {
        doc.text(`Randevu Tarihi: ${formatDate(visa.appointmentDate)} ${visa.appointmentTime || ''}`, 20, 116);
      }
      
      if (visa.pnr) {
        doc.text(`PNR: ${visa.pnr}`, 20, 123);
      }
      
      // Fiyat Tablosu
      doc.setFillColor(248, 250, 252);
      doc.rect(20, 140, 170, 10, 'F');
      
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text('Hizmet', 25, 146);
      doc.text('Fiyat', 170, 146, { align: 'right' });
      
      // Fiyat satırı
      const price = visa.visaPrice || 0;
      const currency = visa.visaCurrency || '€';
      const serviceName = visa.visaDuration || visa.visaType || 'Vize Hizmeti';
      
      doc.setTextColor(51, 65, 85);
      doc.text(serviceName, 25, 158);
      doc.text(`${price} ${currency}`, 170, 158, { align: 'right' });
      
      // Toplam
      doc.setDrawColor(226, 232, 240);
      doc.line(20, 165, 190, 165);
      
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text('TOPLAM', 25, 175);
      doc.text(`${price} ${currency}`, 170, 175, { align: 'right' });
      
      // Ödeme Durumu
      doc.setFontSize(9);
      if (visa.paymentStatus === 'Ödendi') {
        doc.setTextColor(16, 185, 129);
        doc.text('✓ ÖDENDİ', 25, 185);
      } else {
        doc.setTextColor(239, 68, 68);
        doc.text('✗ ÖDENMEDİ', 25, 185);
      }
      
      // Banka Bilgileri
      const bankInfo = appSettings?.bankInfo;
      if (bankInfo && bankInfo.iban) {
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        doc.text('Banka Bilgileri', 20, 205);
        
        doc.setFontSize(9);
        doc.setTextColor(51, 65, 85);
        let yPos = 213;
        
        if (bankInfo.bankName) {
          doc.text(`Banka: ${bankInfo.bankName}`, 20, yPos);
          yPos += 6;
        }
        
        if (bankInfo.accountName) {
          doc.text(`Hesap Sahibi: ${bankInfo.accountName}`, 20, yPos);
          yPos += 6;
        }
        
        doc.text(`IBAN: ${bankInfo.iban}`, 20, yPos);
        yPos += 6;
        
        if (bankInfo.swift) {
          doc.text(`SWIFT: ${bankInfo.swift}`, 20, yPos);
        }
      }
      
      // Notlar
      if (visa.notes) {
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.text('Notlar', 20, 250);
        
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        const lines = doc.splitTextToSize(visa.notes, 170);
        doc.text(lines, 20, 257);
      }
      
      // Footer
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text('Bu proforma fatura bilgilendirme amaçlıdır.', 105, 280, { align: 'center' });
      doc.text('Paydos Turizm - www.paydostur.com', 105, 285, { align: 'center' });
      
      // PDF'i indir
      doc.save(`Proforma_${visa.customerName}_${new Date().toLocaleDateString('tr-TR')}.pdf`);
      
      showToast?.('Proforma başarıyla indirildi', 'success');
    } catch (error) {
      console.error('Proforma oluşturma hatası:', error);
      showToast?.('Proforma oluşturulamadı', 'error');
    }
  };

  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!formData.country || !formData.visaType) {
      showToast?.('Ülke ve vize türü seçiniz', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingVisa) {
        const oldVisa = visaApplications.find(v => v.id === editingVisa.id);
        const updated = visaApplications.map(v => v.id === editingVisa.id ? { ...formData, id: editingVisa.id } : v);
        setVisaApplications(updated);
        addToUndo?.({ type: 'update', undo: () => setVisaApplications(visaApplications.map(v => v.id === editingVisa.id ? oldVisa : v)) });
        showToast?.('Vize başvurusu güncellendi', 'success');
      } else {
        const newVisa = { ...formData, id: generateUniqueId(), createdAt: new Date().toISOString() };
        setVisaApplications([...visaApplications, newVisa]);
        addToUndo?.({ type: 'create', undo: () => setVisaApplications(prev => prev.filter(v => v.id !== newVisa.id)) });
        showToast?.(`${formData.customerName} için vize başvurusu oluşturuldu`, 'success');
      }
      setShowForm(false);
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const deleteVisa = async (id) => {
    const visaToDelete = visaApplications.find(v => v.id === id);
    if (!visaToDelete) return;
    
    setVisaApplications(visaApplications.filter(v => v.id !== id));
    setSelectedVisa(null);
    
    // Undo ile geri alınabilir toast
    showToast?.(`${visaToDelete.customerName} başvurusu silindi`, 'warning', () => {
      setVisaApplications(prev => [...prev, visaToDelete]);
    });
    
  };

  const openEditVisa = (visa) => {
    const customer = customers.find(c => c.id === visa.customerId);
    const cat = visaCategories.find(c => c.id === visa.category);
    setSelectedCustomer(customer);
    setSelectedCategory(cat);
    setFormData(visa);
    setEditingVisa(visa);
    setFormStep('details');
    setShowForm(true);
  };

  const getStatusColor = (status) => ({
    'Evrak Topluyor': '#f59e0b', 'Evrak Tamamlandı': '#3b82f6', 'Randevu Alındı': '#8b5cf6',
    'Başvuru Yapıldı': '#6366f1', 'Sonuç Bekliyor': '#14b8a6', 'Onaylandı': '#10b981', 'Reddedildi': '#ef4444'
  }[status] || '#94a3b8');

  const getCategoryInfo = (catId) => visaCategories.find(c => c.id === catId) || visaCategories[5];

  // Takvim renderı
  const renderCalendar = (days, monthName, year) => (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#f59e0b', textAlign: 'center' }}>{monthName} {year}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', fontSize: '10px' }}>
        {['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'].map(d => (
          <div key={d} style={{ textAlign: 'center', color: '#64748b', padding: '4px', fontWeight: '600' }}>{d}</div>
        ))}
        {days.map((d, idx) => {
          const isToday = d.date === today.toISOString().split('T')[0];
          const hasAppointments = d.appointments?.length > 0;
          return (
            <div 
              key={idx} 
              onClick={() => hasAppointments && setDayDetailModal({ date: d.date, appointments: d.appointments })}
              style={{ 
                textAlign: 'center', padding: '4px 2px', borderRadius: '6px', minHeight: '32px',
                background: hasAppointments ? 'rgba(245,158,11,0.2)' : 'transparent',
                border: isToday ? '2px solid #f59e0b' : '1px solid transparent',
                color: d.day ? '#e8f1f8' : 'transparent',
                cursor: hasAppointments ? 'pointer' : 'default',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <span style={{ fontWeight: isToday ? '700' : '400' }}>{d.day || ''}</span>
              {hasAppointments && (
                <span style={{ fontSize: '8px', color: '#f59e0b', marginTop: '1px' }}>
                  {d.appointments.length > 2 ? `${d.appointments.length} randevu` : d.appointments.map(a => a.customerName?.split(' ')[0]).join(', ')}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // FORM RENDER
  const renderForm = () => (
    <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(180deg, #0a1628 0%, #132742 50%, #0a1628 100%)', zIndex: 300, overflow: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, background: 'rgba(10,22,40,0.98)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
        <button onClick={() => {
          console.log('Geri tıklandı, mevcut step:', formStep);
          if (formStep === 'search') {
            // Adım 1'deyse formu kapat
            console.log('Adım 1, kapatılıyor');
            resetForm();
            setShowForm(false);
          } else if (formStep === 'checklist') {
            // Adım 2'deyse Adım 1'e dön
            console.log('Adım 2 → 1');
            setSelectedCustomer(null);
            setChecklist({ passportValid: null, passportCondition: null, addressChecked: null });
            setFormStep('search');
          } else if (formStep === 'category') {
            // Adım 3'teyse Adım 2'ye dön
            console.log('Adım 3 → 2');
            setSelectedCategory(null);
            setFormData({});
            setFormStep('checklist');
          } else if (formStep === 'details') {
            // Adım 4'teyse Adım 3'e dön
            console.log('Adım 4 → 3');
            setFormData({});
            setFormStep('category');
          }
        }} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 16px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px' }}>← Geri</button>
        <h2 style={{ margin: 0, fontSize: '16px', color: '#ffffff' }}>{editingVisa ? '✏️ Vize Düzenle' : '🌍 Yeni Vize Başvurusu'}</h2>
        <div style={{ width: '70px' }}></div>
      </div>

      <div style={{ padding: '20px', paddingBottom: '100px' }}>
        {/* ADIM 1: MÜŞTERİ ARA */}
        {formStep === 'search' && (
          <div>
            <div style={{ background: 'rgba(59,130,246,0.1)', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(59,130,246,0.2)' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#3b82f6' }}>📋 Adım 1/4: Müşteri Seçimi</p>
            </div>
            
            <input
              type="text"
              placeholder="🔍 Müşteri ara (ad, soyad veya telefon)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '14px', marginBottom: '16px', boxSizing: 'border-box' }}
            />

            {searchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {searchResults.map(c => (
                  <div key={c.id} onClick={() => selectCustomer(c)} style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
                    <h4 style={{ margin: 0, fontSize: '14px' }}>{c.firstName} {c.lastName}</h4>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>{c.phone} • {c.city || '-'}</p>
                  </div>
                ))}
              </div>
            )}

            {searchQuery.length >= 2 && searchResults.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px' }}>
                <p style={{ color: '#64748b', marginBottom: '16px' }}>Müşteri bulunamadı</p>
                <button onClick={onNavigateToCustomers} style={{ padding: '12px 24px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', color: '#0c1929', fontWeight: '600', cursor: 'pointer' }}>
                  ➕ Yeni Müşteri Ekle
                </button>
              </div>
            )}

            {searchQuery.length < 2 && (
              <p style={{ textAlign: 'center', color: '#64748b', padding: '30px' }}>En az 2 karakter girin</p>
            )}
          </div>
        )}

        {/* ADIM 2: KONTROL LİSTESİ */}
        {formStep === 'checklist' && selectedCustomer && (
          <div>
            <div style={{ background: 'rgba(245,158,11,0.1)', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(245,158,11,0.2)' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#f59e0b' }}>📋 Adım 2/4: Kontrol Listesi</p>
              <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#94a3b8' }}>Müşteri: <strong style={{ color: '#fff' }}>{selectedCustomer.firstName} {selectedCustomer.lastName}</strong></p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Soru 1 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <p style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: '600' }}>🛂 Pasaportun geçerlilik tarihini kontrol ettiniz mi?</p>
                <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>Seyahat dönüş tarihinden itibaren 6 ay geçerli olmalı.</p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setChecklist({...checklist, passportValid: 'yes'})} style={{ flex: 1, padding: '12px', background: checklist.passportValid === 'yes' ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.05)', border: checklist.passportValid === 'yes' ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: checklist.passportValid === 'yes' ? '#10b981' : '#94a3b8', cursor: 'pointer', fontWeight: '600' }}>✓ Evet, Geçerli</button>
                  <button onClick={() => setChecklist({...checklist, passportValid: 'no'})} style={{ flex: 1, padding: '12px', background: checklist.passportValid === 'no' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.05)', border: checklist.passportValid === 'no' ? '2px solid #ef4444' : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: checklist.passportValid === 'no' ? '#ef4444' : '#94a3b8', cursor: 'pointer', fontWeight: '600' }}>✗ Hayır</button>
                </div>
              </div>

              {/* Soru 2 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <p style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: '600' }}>📄 Pasaportta yırtık veya çizik var mı?</p>
                <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>Hasarlı pasaportla başvuru yapılamaz.</p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setChecklist({...checklist, passportCondition: 'yes'})} style={{ flex: 1, padding: '12px', background: checklist.passportCondition === 'yes' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.05)', border: checklist.passportCondition === 'yes' ? '2px solid #ef4444' : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: checklist.passportCondition === 'yes' ? '#ef4444' : '#94a3b8', cursor: 'pointer', fontWeight: '600' }}>✗ Evet, Var</button>
                  <button onClick={() => setChecklist({...checklist, passportCondition: 'no'})} style={{ flex: 1, padding: '12px', background: checklist.passportCondition === 'no' ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.05)', border: checklist.passportCondition === 'no' ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: checklist.passportCondition === 'no' ? '#10b981' : '#94a3b8', cursor: 'pointer', fontWeight: '600' }}>✓ Hayır, Temiz</button>
                </div>
              </div>

              {/* Soru 3 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <p style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: '600' }}>📍 İkametgah adresini kontrol ettiniz mi?</p>
                <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>Bölge ayrımı var, doğru konsolosluk belirlenmeli.</p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setChecklist({...checklist, addressChecked: 'yes'})} style={{ flex: 1, padding: '12px', background: checklist.addressChecked === 'yes' ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.05)', border: checklist.addressChecked === 'yes' ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: checklist.addressChecked === 'yes' ? '#10b981' : '#94a3b8', cursor: 'pointer', fontWeight: '600' }}>✓ Evet, Kontrol Ettim</button>
                  <button onClick={() => setChecklist({...checklist, addressChecked: 'no'})} style={{ flex: 1, padding: '12px', background: checklist.addressChecked === 'no' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.05)', border: checklist.addressChecked === 'no' ? '2px solid #ef4444' : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: checklist.addressChecked === 'no' ? '#ef4444' : '#94a3b8', cursor: 'pointer', fontWeight: '600' }}>✗ Hayır</button>
                </div>
              </div>
            </div>

            <button onClick={handleChecklistNext} disabled={!checklist.passportValid || !checklist.passportCondition || !checklist.addressChecked} style={{ width: '100%', marginTop: '24px', padding: '16px', background: (checklist.passportValid && checklist.passportCondition && checklist.addressChecked) ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '12px', color: (checklist.passportValid && checklist.passportCondition && checklist.addressChecked) ? '#0c1929' : '#64748b', fontWeight: '700', fontSize: '15px', cursor: (checklist.passportValid && checklist.passportCondition && checklist.addressChecked) ? 'pointer' : 'not-allowed' }}>
              Devam Et →
            </button>
          </div>
        )}

        {/* ADIM 3: VİZE KATEGORİSİ SEÇ */}
        {formStep === 'category' && (
          <div>
            <div style={{ background: 'rgba(139,92,246,0.1)', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(139,92,246,0.2)' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#8b5cf6' }}>📋 Adım 3/4: Vize Türü Seçimi</p>
              <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#94a3b8' }}>Müşteri: <strong style={{ color: '#fff' }}>{selectedCustomer?.firstName} {selectedCustomer?.lastName}</strong></p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {visaCategories.map(cat => (
                <button key={cat.id} onClick={() => selectCategory(cat)} style={{ padding: '20px', background: `rgba(${hexToRgb(cat.color)},0.15)`, border: `1px solid ${cat.color}40`, borderRadius: '12px', cursor: 'pointer', textAlign: 'center' }}>
                  <span style={{ fontSize: '32px', display: 'block', marginBottom: '8px' }}>{cat.icon}</span>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: cat.color }}>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ADIM 4: DETAYLAR */}
        {formStep === 'details' && selectedCategory && (
          <div>
            <div style={{ background: `rgba(${hexToRgb(selectedCategory.color)},0.1)`, padding: '16px', borderRadius: '12px', marginBottom: '20px', border: `1px solid ${selectedCategory.color}30` }}>
              <p style={{ margin: 0, fontSize: '13px', color: selectedCategory.color }}>{selectedCategory.icon} Adım 4/4: {selectedCategory.label} Vize Detayları</p>
              <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#94a3b8' }}>Müşteri: <strong style={{ color: '#fff' }}>{selectedCustomer?.firstName} {selectedCustomer?.lastName}</strong></p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Ülke Seçimi - Butonlar */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Ülke * {formData.country && <span style={{ color: '#10b981' }}>✓ {formData.country}</span>}</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', maxHeight: '180px', overflowY: 'auto', padding: '4px' }}>
                  {selectedCategory.countries.map(c => (
                    <button key={c} type="button" onClick={() => setFormData({...formData, country: c})} style={{ padding: '10px 8px', background: formData.country === c ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.05)', border: formData.country === c ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: formData.country === c ? '#10b981' : '#e8f1f8', cursor: 'pointer', fontSize: '12px', fontWeight: formData.country === c ? '600' : '400' }}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Vize Türü (ayarlardan gelen) */}
              {selectedCategory?.durations && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Vize Türü * {formData.visaDuration && <span style={{ color: selectedCategory.color }}>✓ {formData.visaDuration}</span>}</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                    {selectedCategory.durations.map((d, idx) => {
                      const duration = typeof d === 'string' ? d : d.name;
                      const price = typeof d === 'object' ? d.price : 0;
                      const currency = typeof d === 'object' ? d.currency : '€';
                      return (
                        <button 
                          key={idx} 
                          type="button" 
                          onClick={() => setFormData({
                            ...formData, 
                            visaDuration: duration,
                            visaPrice: price,
                            visaCurrency: currency
                          })} 
                          style={{ 
                            padding: '12px 8px', 
                            background: formData.visaDuration === duration ? `${selectedCategory.color}30` : 'rgba(255,255,255,0.05)', 
                            border: formData.visaDuration === duration ? `2px solid ${selectedCategory.color}` : '1px solid rgba(255,255,255,0.1)', 
                            borderRadius: '8px', 
                            color: formData.visaDuration === duration ? selectedCategory.color : '#e8f1f8', 
                            cursor: 'pointer', 
                            fontSize: '11px', 
                            fontWeight: formData.visaDuration === duration ? '600' : '400',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            textAlign: 'left'
                          }}
                        >
                          <span>{selectedCategory.icon} {duration}</span>
                          {price > 0 && <span style={{ fontSize: '10px', opacity: 0.7 }}>{price} {currency}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Başvuru Tarihi ve İşlem */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Başvuru Tarihi</label>
                  <input type="date" value={formData.applicationDate || ''} onChange={e => setFormData({...formData, applicationDate: e.target.value})} style={{ width: '100%', padding: '12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#ffffff', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>İşlem</label>
                  <select value={formData.processor || ''} onChange={e => setFormData({...formData, processor: e.target.value})} style={{ width: '100%', padding: '12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#ffffff', fontSize: '14px' }}>
                    {(appSettings?.processors || ['Paydos', 'İdata', 'Oğuz']).map(p => <option key={p} value={p} style={{ background: '#ffffff', color: '#000000' }}>{p}</option>)}
                  </select>
                </div>
              </div>

              {/* Randevu Tarihi ve Saati */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Randevu Tarihi</label>
                  <input type="date" value={formData.appointmentDate || ''} onChange={e => setFormData({...formData, appointmentDate: e.target.value})} style={{ width: '100%', padding: '12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#ffffff', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Randevu Saati</label>
                  <input type="time" value={formData.appointmentTime || ''} onChange={e => setFormData({...formData, appointmentTime: e.target.value})} style={{ width: '100%', padding: '12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#ffffff', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
              </div>

              {/* PNR */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>PNR / Referans No</label>
                <input type="text" value={formData.pnr || ''} onChange={e => setFormData({...formData, pnr: e.target.value})} placeholder="Randevu PNR numarası" style={{ width: '100%', padding: '12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#ffffff', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>

              {/* Ödeme Durumu */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Vize Ücreti</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {paymentStatuses.map(ps => (
                    <button key={ps} type="button" onClick={() => setFormData({...formData, paymentStatus: ps})} style={{ flex: 1, padding: '10px', background: formData.paymentStatus === ps ? (ps === 'Ödendi' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)') : 'rgba(255,255,255,0.05)', border: formData.paymentStatus === ps ? `2px solid ${ps === 'Ödendi' ? '#10b981' : '#ef4444'}` : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: formData.paymentStatus === ps ? (ps === 'Ödendi' ? '#10b981' : '#ef4444') : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: formData.paymentStatus === ps ? '600' : '400' }}>
                      {ps === 'Ödendi' ? '✓' : '✗'} {ps}
                    </button>
                  ))}
                </div>
              </div>

              {/* Durum - Butonlar - Dinamik */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Başvuru Durumu</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {(appSettings?.visaStatuses || ['Evrak Topluyor', 'Evrak Tamamlandı', 'Randevu Alındı', 'Başvuru Yapıldı', 'Sonuç Bekliyor', 'Onaylandı', 'Reddedildi']).map(s => (
                    <button key={s} type="button" onClick={() => setFormData({...formData, status: s})} style={{ padding: '8px 12px', background: formData.status === s ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.05)', border: formData.status === s ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: formData.status === s ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '11px', fontWeight: formData.status === s ? '600' : '400' }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notlar */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Notlar</label>
                <textarea value={formData.notes || ''} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="Ek notlar..." style={{ width: '100%', padding: '12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#ffffff', fontSize: '14px', minHeight: '80px', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>

              {/* İletişim Butonları */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button type="button" onClick={() => { const phone = formData.customerPhone?.replace(/\D/g, ''); if (phone) window.open(`https://wa.me/90${phone}`, '_blank'); }} style={{ padding: '12px', background: 'rgba(37,211,102,0.2)', border: '1px solid rgba(37,211,102,0.3)', borderRadius: '8px', color: '#25d366', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                  💬 WhatsApp
                </button>
                <button type="button" onClick={() => { if (formData.customerEmail) window.open(`mailto:${formData.customerEmail}`, '_blank'); else alert('E-posta adresi bulunamadı'); }} style={{ padding: '12px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                  📧 E-posta
                </button>
              </div>

              {/* Randevu Bilgisi Gönder */}
              {formData.appointmentDate && (
                <button type="button" onClick={() => {
                  if (!formData.customerPhone) { alert('Telefon numarası bulunamadı!'); return; }
                  let message = appSettings?.whatsappTemplate || 'Randevu: {tarih} {saat}';
                  message = message.replace('{isim}', formData.customerName || '').replace('{ulke}', formData.country || '').replace('{tarih}', formatDate(formData.appointmentDate) || '').replace('{saat}', formData.appointmentTime || '-').replace('{pnr}', formData.pnr || '-');
                  const phone = formData.customerPhone.replace(/\D/g, '');
                  const fullPhone = phone.startsWith('90') ? phone : `90${phone}`;
                  window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(message)}`, '_blank');
                }} style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg, #25d366, #128c7e)', border: 'none', borderRadius: '10px', color: 'white', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                  📱 Randevu Bilgisi Gönder (WhatsApp)
                </button>
              )}
            </div>

            <LoadingButton 
              onClick={handleSubmit} 
              loading={saving}
              style={{ width: '100%', marginTop: '24px', padding: '16px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '700', fontSize: '15px' }}
            >
              {editingVisa ? '💾 Değişiklikleri Kaydet' : '✅ Başvuruyu Kaydet'}
            </LoadingButton>

            {/* Proforma İndir - Sadece düzenleme modunda */}
            {editingVisa && (
              <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button 
                  type="button"
                  onClick={() => generateProforma(formData)}
                  style={{ 
                    padding: '14px', 
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)', 
                    border: 'none', 
                    borderRadius: '10px', 
                    color: 'white', 
                    cursor: 'pointer', 
                    fontWeight: '600', 
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  📄 Proforma İndir
                </button>
                <button 
                  type="button"
                  onClick={() => sendProformaWhatsApp(formData)}
                  style={{ 
                    padding: '14px', 
                    background: 'linear-gradient(135deg, #25d366, #128c7e)', 
                    border: 'none', 
                    borderRadius: '10px', 
                    color: 'white', 
                    cursor: 'pointer', 
                    fontWeight: '600', 
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  💬 Proforma Gönder
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ padding: isMobile ? '16px' : '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '20px', margin: 0 }}>🌍 Vize Başvuruları ({visaApplications.length})</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={exportToExcel} style={{ background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '10px', padding: '10px 16px', color: '#10b981', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>📥 Excel</button>
          <button onClick={openNewForm} style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: '#0c1929', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>➕ Yeni Başvuru</button>
        </div>
      </div>

      {/* Arama Kutusu */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={visaSearchQuery}
            onChange={e => setVisaSearchQuery(e.target.value)}
            placeholder="🔍 Müşteri adı, telefon, ülke veya PNR ile ara..."
            style={{ width: '100%', padding: '12px 16px', paddingRight: visaSearchQuery ? '40px' : '16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }}
          />
          {visaSearchQuery && (
            <button onClick={() => setVisaSearchQuery('')} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '18px' }}>×</button>
          )}
        </div>
        {visaSearchQuery.length >= 2 && (
          <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#64748b' }}>
            {filteredVisaApplications.length} sonuç bulundu
          </p>
        )}
      </div>

      {/* Sekmeler */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
        <button onClick={() => setActiveTab('calendar')} style={{ padding: '12px', background: activeTab === 'calendar' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'calendar' ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'calendar' ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'calendar' ? '600' : '400' }}>
          📅 Takvim
        </button>
        <button onClick={() => setActiveTab('reminders')} style={{ padding: '12px', background: activeTab === 'reminders' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'reminders' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'reminders' ? '#ef4444' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'reminders' ? '600' : '400' }}>
          ⏰ Hatırlatmalar ({upcomingReminders.length})
        </button>
        <button onClick={() => setActiveTab('all')} style={{ padding: '12px', background: activeTab === 'all' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'all' ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'all' ? '#3b82f6' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'all' ? '600' : '400' }}>
          📋 Tüm Başvurular
        </button>
      </div>

      {/* TAKVİM */}
      {activeTab === 'calendar' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <button onClick={() => { if (calendarMonth === 0) { setCalendarMonth(11); setCalendarYear(calendarYear - 1); } else { setCalendarMonth(calendarMonth - 1); } }} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#e8f1f8', cursor: 'pointer' }}>←</button>
            <span style={{ fontSize: '14px', color: '#94a3b8' }}>{calendarYear}</span>
            <button onClick={() => { if (calendarMonth === 11) { setCalendarMonth(0); setCalendarYear(calendarYear + 1); } else { setCalendarMonth(calendarMonth + 1); } }} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#e8f1f8', cursor: 'pointer' }}>→</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }}>
            {renderCalendar(month1Days, monthNames[calendarMonth], calendarYear)}
            {renderCalendar(month2Days, monthNames[month2Month], month2Year)}
          </div>
        </div>
      )}

      {/* HATIRLATMALAR */}
      {activeTab === 'reminders' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {upcomingReminders.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>10 gün içinde randevu yok 🎉</p>
          ) : (
            upcomingReminders.map(v => {
              const cat = getCategoryInfo(v.category);
              const daysLeft = getDaysLeft(v.appointmentDate);
              return (
                <div key={v.id} onClick={() => setSelectedVisa(v)} style={{ background: daysLeft <= 3 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.1)', padding: '14px', borderRadius: '10px', border: daysLeft <= 3 ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(245,158,11,0.2)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px' }}>{cat.icon} {v.customerName}</h4>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>{formatDate(v.appointmentDate)} {v.appointmentTime && `• ${v.appointmentTime}`}</p>
                      <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#64748b' }}>{v.country} - {v.visaType}</p>
                    </div>
                    <span style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '8px', background: daysLeft <= 3 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)', color: daysLeft <= 3 ? '#ef4444' : '#f59e0b', fontWeight: '600' }}>
                      {daysLeft === 0 ? 'BUGÜN!' : `${daysLeft} gün`}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TÜM BAŞVURULAR */}
      {activeTab === 'all' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredVisaApplications.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>{visaSearchQuery ? 'Sonuç bulunamadı' : 'Henüz başvuru yok'}</p>
          ) : (
            filteredVisaApplications.map(v => {
              const cat = getCategoryInfo(v.category);
              return (
                <div key={v.id} onClick={() => setSelectedVisa(v)} style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px' }}>{cat.icon} {v.customerName}</h4>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>{v.country} - {v.visaType} {v.visaDuration && `(${v.visaDuration})`}</p>
                      {v.appointmentDate && <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#64748b' }}>📅 {formatDate(v.appointmentDate)} {v.pnr && `• PNR: ${v.pnr}`}</p>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      <span style={{ fontSize: '10px', padding: '4px 8px', borderRadius: '6px', background: `${getStatusColor(v.status)}20`, color: getStatusColor(v.status) }}>{v.status}</span>
                      {v.paymentStatus && <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: v.paymentStatus === 'Ödendi' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: v.paymentStatus === 'Ödendi' ? '#10b981' : '#ef4444' }}>{v.paymentStatus}</span>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* FORM */}
      {showForm && renderForm()}

      {/* GÜN DETAY MODAL */}
      {dayDetailModal && (
        <div onClick={() => setDayDetailModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '20px', maxWidth: '400px', width: '100%', maxHeight: '80vh', overflow: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>📅 {formatDate(dayDetailModal.date)}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {dayDetailModal.appointments.map(v => {
                const cat = getCategoryInfo(v.category);
                return (
                  <div key={v.id} onClick={() => { setDayDetailModal(null); setSelectedVisa(v); }} style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '10px', cursor: 'pointer' }}>
                    <h4 style={{ margin: 0, fontSize: '14px' }}>{cat.icon} {v.customerName}</h4>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>{v.appointmentTime || '-'} • {v.country}</p>
                    <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: `${getStatusColor(v.status)}20`, color: getStatusColor(v.status) }}>{v.status}</span>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setDayDetailModal(null)} style={{ width: '100%', marginTop: '16px', padding: '12px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '10px', color: '#e8f1f8', cursor: 'pointer' }}>Kapat</button>
          </div>
        </div>
      )}

      {/* BAŞVURU DETAY MODAL */}
      {selectedVisa && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', maxWidth: '500px', width: '100%', margin: '20px auto', position: 'relative' }}>
            {/* Close button */}
            <button 
              onClick={() => setSelectedVisa(null)} 
              style={{ 
                position: 'absolute', 
                top: '16px', 
                right: '16px', 
                background: 'rgba(239,68,68,0.2)', 
                border: '1px solid rgba(239,68,68,0.3)', 
                borderRadius: '8px', 
                width: '32px', 
                height: '32px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                color: '#ef4444', 
                cursor: 'pointer', 
                fontSize: '20px',
                lineHeight: 1
              }}
            >
              ×
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '20px', paddingRight: '40px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '20px' }}>{getCategoryInfo(selectedVisa.category).icon} {selectedVisa.customerName}</h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>{selectedVisa.customerPhone}</p>
              </div>
              <span style={{ fontSize: '11px', padding: '6px 12px', borderRadius: '8px', background: `${getStatusColor(selectedVisa.status)}20`, color: getStatusColor(selectedVisa.status), fontWeight: '600' }}>{selectedVisa.status}</span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#64748b' }}>Ülke</p>
                  <p style={{ margin: '2px 0 0', fontSize: '14px' }}>{selectedVisa.country}</p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#64748b' }}>Vize Türü</p>
                  <p style={{ margin: '2px 0 0', fontSize: '14px' }}>{selectedVisa.visaType}</p>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#64748b' }}>Başvuru Tarihi</p>
                  <p style={{ margin: '2px 0 0', fontSize: '14px' }}>{formatDate(selectedVisa.applicationDate) || '-'}</p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#64748b' }}>İşlem</p>
                  <p style={{ margin: '2px 0 0', fontSize: '14px' }}>{selectedVisa.processor || '-'}</p>
                </div>
              </div>
              {selectedVisa.appointmentDate && (
                <div style={{ background: 'rgba(59,130,246,0.1)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#3b82f6' }}>📅 Randevu</p>
                  <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: '600' }}>{formatDate(selectedVisa.appointmentDate)} {selectedVisa.appointmentTime && `• ${selectedVisa.appointmentTime}`}</p>
                  {selectedVisa.pnr && <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>PNR: {selectedVisa.pnr}</p>}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{ background: `rgba(${selectedVisa.paymentStatus === 'Ödendi' ? '16,185,129' : '239,68,68'},0.1)`, padding: '10px', borderRadius: '8px' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#64748b' }}>Vize Ücreti</p>
                  <p style={{ margin: '2px 0 0', fontSize: '14px', color: selectedVisa.paymentStatus === 'Ödendi' ? '#10b981' : '#ef4444' }}>{selectedVisa.paymentStatus || 'Ödenmedi'}</p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#64748b' }}>Durum</p>
                  <p style={{ margin: '2px 0 0', fontSize: '14px', color: getStatusColor(selectedVisa.status) }}>{selectedVisa.status}</p>
                </div>
              </div>
              {selectedVisa.notes && (
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#64748b' }}>Notlar</p>
                  <p style={{ margin: '2px 0 0', fontSize: '13px' }}>{selectedVisa.notes}</p>
                </div>
              )}
            </div>

            {/* İletişim Butonları */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
              <button onClick={() => sendWhatsApp(selectedVisa)} style={{ padding: '10px', background: 'rgba(37,211,102,0.2)', border: '1px solid rgba(37,211,102,0.3)', borderRadius: '8px', color: '#25d366', cursor: 'pointer', fontSize: '12px' }}>💬 WhatsApp</button>
              <button onClick={() => sendEmail(selectedVisa)} style={{ padding: '10px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px' }}>📧 E-posta</button>
              <button onClick={() => generateProforma(selectedVisa)} style={{ padding: '10px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', color: '#f59e0b', cursor: 'pointer', fontSize: '12px' }}>📄 Proforma</button>
            </div>

            {/* Randevu Bilgisi Gönder */}
            {selectedVisa.appointmentDate && (
              <button onClick={() => sendWhatsAppReminder(selectedVisa)} style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg, #25d366, #128c7e)', border: 'none', borderRadius: '10px', color: 'white', cursor: 'pointer', fontWeight: '600', fontSize: '13px', marginBottom: '12px' }}>
                📱 Randevu Bilgisi Gönder (WhatsApp)
              </button>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => { setSelectedVisa(null); openEditVisa(selectedVisa); }} style={{ flex: 1, padding: '12px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '10px', color: '#3b82f6', cursor: 'pointer', fontWeight: '600' }}>✏️ Düzenle</button>
              <button onClick={() => deleteVisa(selectedVisa.id)} style={{ flex: 1, padding: '12px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', color: '#ef4444', cursor: 'pointer', fontWeight: '600' }}>🗑️ Sil</button>
            </div>
            <button onClick={() => setSelectedVisa(null)} style={{ width: '100%', marginTop: '8px', padding: '12px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '10px', color: '#e8f1f8', cursor: 'pointer' }}>Kapat</button>
          </div>
        </div>
      )}
    </div>
  );
}

// TUR MODÜLÜ - TAM VERSİYON
function ToursModule({ tours, setTours, customers, isMobile, showToast, addToUndo }) {
  const [showForm, setShowForm] = useState(false);
  const [showReservationForm, setShowReservationForm] = useState(false);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [selectedTour, setSelectedTour] = useState(null);
  const [editingTour, setEditingTour] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const [formData, setFormData] = useState({
    name: '',
    country: '',
    city: '',
    startDate: '',
    endDate: '',
    prices: {
      doubleRoom: { amount: 0, currency: '€' },
      singleRoom: { amount: 0, currency: '€' },
      extraBed: { amount: 0, currency: '€' },
      baby: { amount: 0, currency: '€' },
      child1: { amount: 0, currency: '€' },
      child2: { amount: 0, currency: '€' }
    },
    status: 'Aktif',
    reservations: []
  });

  const [reservationData, setReservationData] = useState({
    customerId: '',
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    company: '',
    roomType: 'doubleRoom',
    roommate: '',
    roommate3: '',
    hasChild: false,
    passport: '',
    hasVisa: false,
    visaEndDate: '',
    tourPrice: 0,
    currency: '€',
    payment1: 0,
    payment2: 0,
    payment3: 0,
    notes: ''
  });

  const roomTypeLabels = {
    doubleRoom: 'İki Kişilik Oda',
    singleRoom: 'Tek Kişilik Oda',
    extraBed: 'İlave Yatak',
    baby: 'Bebek (0-1,99)',
    child1: '1.Çocuk (7-11,99)',
    child2: '2.Çocuk (2-6,99)'
  };

  const filteredTours = tours.filter(tour => {
    const matchesSearch = !searchQuery || 
      tour.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tour.country?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tour.city?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = filterStatus === 'all' || tour.status === filterStatus;
    
    return matchesSearch && matchesStatus;
  });

  const openNewForm = () => {
    setFormData({
      name: '',
      country: '',
      city: '',
      startDate: '',
      endDate: '',
      prices: {
        doubleRoom: { amount: 0, currency: '€' },
        singleRoom: { amount: 0, currency: '€' },
        extraBed: { amount: 0, currency: '€' },
        baby: { amount: 0, currency: '€' },
        child1: { amount: 0, currency: '€' },
        child2: { amount: 0, currency: '€' }
      },
      status: 'Aktif',
      reservations: []
    });
    setEditingTour(null);
    setShowForm(true);
  };

  const openEditForm = (tour) => {
    setFormData({...tour});
    setEditingTour(tour);
    setShowForm(true);
  };

  const saveTour = () => {
    if (!formData.name || !formData.country || !formData.startDate || !formData.endDate) {
      showToast('Lütfen zorunlu alanları doldurun', 'error');
      return;
    }

    if (editingTour) {
      const updated = tours.map(t => t.id === editingTour.id ? {...formData, id: editingTour.id} : t);
      setTours(updated);
      showToast('Tur güncellendi', 'success');
    } else {
      const newTour = {...formData, id: Date.now(), reservations: []};
      setTours([...tours, newTour]);
      showToast('Tur eklendi', 'success');
    }
    setShowForm(false);
  };

  const deleteTour = (tour) => {
    if (window.confirm(`"${tour.name}" turunu silmek istediğinizden emin misiniz?`)) {
      const old = [...tours];
      setTours(tours.filter(t => t.id !== tour.id));
      showToast('Tur silindi', 'success');
      addToUndo(() => setTours(old), 'Tur silme');
    }
  };

  const openReservationForm = (tour) => {
    setSelectedTour(tour);
    setReservationData({
      customerId: '',
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      company: '',
      roomType: 'doubleRoom',
      roommate: '',
      roommate3: '',
      hasChild: false,
      passport: '',
      hasVisa: false,
      visaEndDate: '',
      tourPrice: tour.prices.doubleRoom.amount,
      currency: tour.prices.doubleRoom.currency,
      payment1: 0,
      payment2: 0,
      payment3: 0,
      notes: ''
    });
    setShowReservationForm(true);
  };

  const handleCustomerSelect = (e) => {
    const custId = e.target.value;
    
    if (custId === 'new') {
      // Yeni müşteri ekleme modunu aç
      setReservationData({
        ...reservationData,
        customerId: 'new',
        customerName: '',
        customerPhone: '',
        customerEmail: '',
        company: ''
      });
      setShowNewCustomerForm(true);
      return;
    }
    
    setShowNewCustomerForm(false);
    const customer = customers.find(c => c.id == custId);
    if (customer) {
      setReservationData({
        ...reservationData,
        customerId: custId,
        customerName: customer.name || '',
        customerPhone: customer.phone || '',
        customerEmail: customer.email || '',
        company: customer.company || ''
      });
    }
  };

  const handleRoomTypeChange = (e) => {
    const roomType = e.target.value;
    const price = selectedTour.prices[roomType];
    setReservationData({
      ...reservationData,
      roomType,
      tourPrice: price.amount,
      currency: price.currency
    });
  };

  const saveReservation = () => {
    if (!reservationData.customerId || !reservationData.customerName) {
      showToast('Lütfen müşteri seçin', 'error');
      return;
    }

    const newReservation = {
      ...reservationData,
      id: Date.now(),
      sNo: (selectedTour.reservations?.length || 0) + 1
    };

    const updatedTours = tours.map(t => {
      if (t.id === selectedTour.id) {
        return {
          ...t,
          reservations: [...(t.reservations || []), newReservation]
        };
      }
      return t;
    });

    setTours(updatedTours);
    showToast('Rezervasyon eklendi', 'success');
    setShowReservationForm(false);
  };

  const deleteReservation = (tourId, reservationId) => {
    if (window.confirm('Bu rezervasyonu silmek istediğinizden emin misiniz?')) {
      const updatedTours = tours.map(t => {
        if (t.id === tourId) {
          return {
            ...t,
            reservations: t.reservations.filter(r => r.id !== reservationId)
          };
        }
        return t;
      });
      setTours(updatedTours);
      showToast('Rezervasyon silindi', 'success');
    }
  };

  const exportToExcel = (tour) => {
    const ws_data = [
      ['TUR BİLGİLERİ'],
      ['Tur Adı:', tour.name],
      ['Ülke:', tour.country],
      ['Şehir:', tour.city],
      ['Başlangıç:', formatDate(tour.startDate)],
      ['Bitiş:', formatDate(tour.endDate)],
      [''],
      ['REZERVASYONLAR'],
      ['S.No', 'Firma', 'Ad Soyad', 'Tel No', 'E-mail', 'Oda Tipi', 'Oda Arkadaşı', '3.Oda Arkadaşı', 'Çocuk', 'Pasaport', 'Vize', 'Vize Bitiş Tar', 'Tur Ücreti', 'Para Birimi', '1.Ödeme', '2.Ödeme', '3.Ödeme', 'Toplam Ödeme', 'Notlar']
    ];

    tour.reservations?.forEach(r => {
      const totalPayment = (r.payment1 || 0) + (r.payment2 || 0) + (r.payment3 || 0);
      ws_data.push([
        r.sNo,
        r.company || '',
        r.customerName,
        r.customerPhone,
        r.customerEmail,
        roomTypeLabels[r.roomType],
        r.roommate || '',
        r.roommate3 || '',
        r.hasChild ? 'Evet' : 'Hayır',
        r.passport || '',
        r.hasVisa ? 'Var' : 'Yok',
        r.visaEndDate || '',
        r.tourPrice,
        r.currency,
        r.payment1 || 0,
        r.payment2 || 0,
        r.payment3 || 0,
        totalPayment,
        r.notes || ''
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rezervasyonlar');
    XLSX.writeFile(wb, `${tour.name}_Rezervasyonlar.xlsx`);
    showToast('Excel dosyası indirildi', 'success');
  };

  return (
    <div style={{ padding: isMobile ? '16px' : '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '20px', margin: 0 }}>🎫 Turlar ({tours.length})</h2>
        <button onClick={openNewForm} style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: '#0c1929', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
          ➕ Yeni Tur
        </button>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="🔍 Tur ara (isim, ülke, şehir)..."
          style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }}
        />
      </div>

      {/* Tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
        {['all', 'Aktif', 'Tamamlandı', 'İptal'].map(status => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            style={{
              padding: '12px',
              background: filterStatus === status ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)',
              border: filterStatus === status ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px',
              color: filterStatus === status ? '#f59e0b' : '#94a3b8',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: filterStatus === status ? '600' : '400'
            }}
          >
            {status === 'all' ? '📅 Tümü' : status}
          </button>
        ))}
      </div>

      {/* Tours Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(350px, 1fr))', gap: '16px' }}>
        {filteredTours.map(tour => (
          <div key={tour.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>{tour.name}</h3>
              <span style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '8px', background: tour.status === 'Aktif' ? 'rgba(34,197,94,0.2)' : tour.status === 'Tamamlandı' ? 'rgba(59,130,246,0.2)' : 'rgba(239,68,68,0.2)', color: tour.status === 'Aktif' ? '#22c55e' : tour.status === 'Tamamlandı' ? '#3b82f6' : '#ef4444' }}>
                {tour.status}
              </span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                🌍 {tour.country} - {tour.city}
              </div>
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                📅 {formatDate(tour.startDate)} - {formatDate(tour.endDate)}
              </div>
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                👥 {tour.reservations?.length || 0} Rezervasyon
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={() => openReservationForm(tour)} style={{ flex: 1, padding: '8px', background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', color: '#22c55e', cursor: 'pointer', fontSize: '12px' }}>
                ➕ Rezervasyon
              </button>
              <button onClick={() => setSelectedTour(selectedTour?.id === tour.id ? null : tour)} style={{ flex: 1, padding: '8px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px' }}>
                📋 Detay
              </button>
              <button onClick={() => openEditForm(tour)} style={{ padding: '8px 12px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', color: '#f59e0b', cursor: 'pointer', fontSize: '12px' }}>
                ✏️
              </button>
              <button onClick={() => deleteTour(tour)} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>
                🗑️
              </button>
            </div>

            {/* Rezervasyon Detayları */}
            {selectedTour?.id === tour.id && tour.reservations?.length > 0 && (
              <div style={{ marginTop: '16px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px' }}>📋 Rezervasyonlar</h4>
                  <button onClick={() => exportToExcel(tour)} style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px' }}>
                    📥 Excel
                  </button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                        <th style={{ padding: '8px', textAlign: 'left', color: '#64748b' }}>S.No</th>
                        <th style={{ padding: '8px', textAlign: 'left', color: '#64748b' }}>Ad Soyad</th>
                        <th style={{ padding: '8px', textAlign: 'left', color: '#64748b' }}>Oda Tipi</th>
                        <th style={{ padding: '8px', textAlign: 'left', color: '#64748b' }}>Ücret</th>
                        <th style={{ padding: '8px', textAlign: 'left', color: '#64748b' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tour.reservations.map(res => (
                        <tr key={res.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '8px' }}>{res.sNo}</td>
                          <td style={{ padding: '8px' }}>{res.customerName}</td>
                          <td style={{ padding: '8px' }}>{roomTypeLabels[res.roomType]}</td>
                          <td style={{ padding: '8px' }}>{res.tourPrice} {res.currency}</td>
                          <td style={{ padding: '8px' }}>
                            <button onClick={() => deleteReservation(tour.id, res.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px' }}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredTours.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
          <p style={{ fontSize: '48px', margin: '0 0 16px' }}>🎫</p>
          <p style={{ margin: 0 }}>Henüz tur eklenmemiş</p>
        </div>
      )}

      {/* Tur Formu Modal */}
      {showForm && (
        <div onClick={() => setShowForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '18px' }}>
              {editingTour ? '✏️ Tur Düzenle' : '➕ Yeni Tur'}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={labelStyle}>Tur Adı *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="örn: Dubai GULFOOD 2025"
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={labelStyle}>Ülke *</label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={e => setFormData({...formData, country: e.target.value})}
                    placeholder="örn: BAE"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Şehir *</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={e => setFormData({...formData, city: e.target.value})}
                    placeholder="örn: Dubai"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={labelStyle}>Başlangıç Tarihi *</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={e => setFormData({...formData, startDate: e.target.value})}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Bitiş Tarihi *</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={e => setFormData({...formData, endDate: e.target.value})}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '10px' }}>
                <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: '#f59e0b' }}>💰 Fiyatlandırma</h4>
                
                {Object.entries({
                  doubleRoom: 'İki Kişilik Oda Kişi Başı',
                  singleRoom: 'Tek Kişilik Oda',
                  extraBed: 'İlave Yatak',
                  baby: 'Bebek (0-1,99 Yaş)',
                  child1: '1.Çocuk (7-11,99 Yaş)',
                  child2: '2.Çocuk (2-6,99 Yaş)'
                }).map(([key, label]) => (
                  <div key={key} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 80px', gap: '8px', marginBottom: '10px', alignItems: 'end' }}>
                    <div>
                      <label style={{...labelStyle, fontSize: '11px'}}>{label}</label>
                    </div>
                    <div>
                      <input
                        type="number"
                        value={formData.prices[key].amount}
                        onChange={e => setFormData({
                          ...formData,
                          prices: {
                            ...formData.prices,
                            [key]: {...formData.prices[key], amount: Number(e.target.value)}
                          }
                        })}
                        placeholder="0"
                        style={{...inputStyle, padding: '8px'}}
                      />
                    </div>
                    <div>
                      <select
                        value={formData.prices[key].currency}
                        onChange={e => setFormData({
                          ...formData,
                          prices: {
                            ...formData.prices,
                            [key]: {...formData.prices[key], currency: e.target.value}
                          }
                        })}
                        style={{...selectStyle, padding: '8px'}}
                      >
                        <option value="€">€</option>
                        <option value="$">$</option>
                        <option value="£">£</option>
                        <option value="₺">₺</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <label style={labelStyle}>Durum</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData({...formData, status: e.target.value})}
                  style={selectStyle}
                >
                  <option value="Aktif">Aktif</option>
                  <option value="Tamamlandı">Tamamlandı</option>
                  <option value="İptal">İptal</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '14px' }}>
                  İptal
                </button>
                <button onClick={saveTour} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', color: '#0c1929', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>
                  💾 Kaydet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rezervasyon Formu Modal */}
      {showReservationForm && selectedTour && (
        <div onClick={() => setShowReservationForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', maxWidth: '700px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '18px' }}>
              ➕ Rezervasyon Ekle - {selectedTour.name}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={labelStyle}>Müşteri Seç *</label>
                <select
                  value={reservationData.customerId}
                  onChange={handleCustomerSelect}
                  style={selectStyle}
                >
                  <option value="">Müşteri seçin...</option>
                  <option value="new" style={{ color: '#22c55e', fontWeight: '600' }}>➕ Yeni Müşteri Ekle</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {reservationData.customerId === 'new' && (
                <>
                  <div style={{ padding: '12px', background: 'rgba(34,197,94,0.1)', borderRadius: '8px', marginBottom: '8px' }}>
                    <p style={{ margin: 0, fontSize: '12px', color: '#22c55e' }}>✏️ Yeni müşteri bilgilerini girin</p>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>Ad Soyad *</label>
                      <input 
                        type="text" 
                        value={reservationData.customerName} 
                        onChange={e => setReservationData({...reservationData, customerName: e.target.value})}
                        placeholder="Ad Soyad"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Telefon *</label>
                      <input 
                        type="text" 
                        value={reservationData.customerPhone} 
                        onChange={e => setReservationData({...reservationData, customerPhone: e.target.value})}
                        placeholder="5XX XXX XX XX"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>E-mail</label>
                      <input 
                        type="email" 
                        value={reservationData.customerEmail} 
                        onChange={e => setReservationData({...reservationData, customerEmail: e.target.value})}
                        placeholder="email@example.com"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Firma</label>
                      <input 
                        type="text" 
                        value={reservationData.company} 
                        onChange={e => setReservationData({...reservationData, company: e.target.value})}
                        placeholder="Firma adı"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </>
              )}

              {reservationData.customerId && reservationData.customerId !== 'new' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>Ad Soyad</label>
                      <input type="text" value={reservationData.customerName} readOnly style={{...inputStyle, background: 'rgba(255,255,255,0.02)'}} />
                    </div>
                    <div>
                      <label style={labelStyle}>Telefon</label>
                      <input type="text" value={reservationData.customerPhone} readOnly style={{...inputStyle, background: 'rgba(255,255,255,0.02)'}} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>E-mail</label>
                      <input type="text" value={reservationData.customerEmail} readOnly style={{...inputStyle, background: 'rgba(255,255,255,0.02)'}} />
                    </div>
                    <div>
                      <label style={labelStyle}>Firma</label>
                      <input type="text" value={reservationData.company} readOnly style={{...inputStyle, background: 'rgba(255,255,255,0.02)'}} />
                    </div>
                  </div>
                </>
              )}

              {reservationData.customerId && (
                <>
                  <div>
                    <label style={labelStyle}>Oda Tipi</label>
                    <select
                      value={reservationData.roomType}
                      onChange={handleRoomTypeChange}
                      style={selectStyle}
                    >
                      {Object.entries(roomTypeLabels).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>Oda Arkadaşı</label>
                      <input
                        type="text"
                        value={reservationData.roommate}
                        onChange={e => setReservationData({...reservationData, roommate: e.target.value})}
                        placeholder="Oda arkadaşı adı"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>3. Oda Arkadaşı</label>
                      <input
                        type="text"
                        value={reservationData.roommate3}
                        onChange={e => setReservationData({...reservationData, roommate3: e.target.value})}
                        placeholder="3. kişi adı"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={reservationData.hasChild}
                      onChange={e => setReservationData({...reservationData, hasChild: e.target.checked})}
                      id="hasChild"
                    />
                    <label htmlFor="hasChild" style={{ fontSize: '13px', color: '#94a3b8', cursor: 'pointer' }}>Çocuk var</label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>Pasaport No</label>
                      <input
                        type="text"
                        value={reservationData.passport}
                        onChange={e => setReservationData({...reservationData, passport: e.target.value})}
                        placeholder="Pasaport numarası"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Vize</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', height: '40px' }}>
                        <input
                          type="checkbox"
                          checked={reservationData.hasVisa}
                          onChange={e => setReservationData({...reservationData, hasVisa: e.target.checked})}
                          id="hasVisa"
                        />
                        <label htmlFor="hasVisa" style={{ fontSize: '13px', color: '#94a3b8', cursor: 'pointer' }}>Vize var</label>
                      </div>
                    </div>
                  </div>

                  {reservationData.hasVisa && (
                    <div>
                      <label style={labelStyle}>Vize Bitiş Tarihi</label>
                      <input
                        type="date"
                        value={reservationData.visaEndDate}
                        onChange={e => setReservationData({...reservationData, visaEndDate: e.target.value})}
                        style={inputStyle}
                      />
                    </div>
                  )}

                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '10px' }}>
                    <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: '#f59e0b' }}>💰 Ödeme Bilgileri</h4>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '12px' }}>
                      <div>
                        <label style={labelStyle}>Tur Ücreti</label>
                        <input
                          type="number"
                          value={reservationData.tourPrice}
                          onChange={e => setReservationData({...reservationData, tourPrice: Number(e.target.value)})}
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Para Birimi</label>
                        <select
                          value={reservationData.currency}
                          onChange={e => setReservationData({...reservationData, currency: e.target.value})}
                          style={selectStyle}
                        >
                          <option value="€">€</option>
                          <option value="$">$</option>
                          <option value="£">£</option>
                          <option value="₺">₺</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                      <div>
                        <label style={labelStyle}>1. Ödeme</label>
                        <input
                          type="number"
                          value={reservationData.payment1}
                          onChange={e => setReservationData({...reservationData, payment1: Number(e.target.value)})}
                          placeholder="0"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>2. Ödeme</label>
                        <input
                          type="number"
                          value={reservationData.payment2}
                          onChange={e => setReservationData({...reservationData, payment2: Number(e.target.value)})}
                          placeholder="0"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>3. Ödeme</label>
                        <input
                          type="number"
                          value={reservationData.payment3}
                          onChange={e => setReservationData({...reservationData, payment3: Number(e.target.value)})}
                          placeholder="0"
                          style={inputStyle}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: '12px', padding: '8px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: '6px', fontSize: '13px', color: '#22c55e' }}>
                      Toplam Ödeme: {(reservationData.payment1 + reservationData.payment2 + reservationData.payment3).toFixed(2)} {reservationData.currency}
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>Notlar</label>
                    <textarea
                      value={reservationData.notes}
                      onChange={e => setReservationData({...reservationData, notes: e.target.value})}
                      placeholder="Özel notlar..."
                      style={{...inputStyle, minHeight: '80px', resize: 'vertical'}}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button onClick={() => setShowReservationForm(false)} style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '14px' }}>
                  İptal
                </button>
                <button onClick={saveReservation} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #22c55e, #16a34a)', border: 'none', borderRadius: '10px', color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>
                  💾 Kaydet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// TEKLİF & PROFORMA MODÜLÜ
function QuotesModule({ quotes, setQuotes, customers, isMobile, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [viewingQuote, setViewingQuote] = useState(null);
  const [filterType, setFilterType] = useState('all'); // all, teklif, proforma
  const [searchQuery, setSearchQuery] = useState('');
  const [formStep, setFormStep] = useState('type'); // type, customer, details
  const [formData, setFormData] = useState({
    type: '', // 'teklif' veya 'proforma'
    customer: null,
    subject: '',
    optionDate: '',
    currency: 'EUR',
    items: [{ service: '', description: '', quantity: 1, unitPrice: 0 }],
    subtotal: 0,
    vatIncluded: false,
    vatRate: 20,
    discount: 0,
    total: 0,
    notes: ''
  });
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');

  const emptyForm = {
    type: '', customer: null, subject: '', optionDate: '', currency: 'EUR',
    items: [{ service: '', description: '', quantity: 1, unitPrice: 0 }],
    subtotal: 0, vatIncluded: false, vatRate: 20, discount: 0, total: 0, notes: ''
  };

  const calculateTotal = () => {
    const subtotal = formData.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const vatAmount = formData.vatIncluded ? (subtotal * formData.vatRate / 100) : 0;
    const total = subtotal + vatAmount - formData.discount;
    setFormData({ ...formData, subtotal, total });
  };

  const generatePDF = (quote) => {
    try {
      const doc = new jsPDF();
      
      // Türkçe karakter çevirme fonksiyonu
      const toTurkishChars = (text) => {
        if (!text) return '';
        return text
          .replace(/ı/g, 'i').replace(/İ/g, 'I')
          .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
          .replace(/ü/g, 'u').replace(/Ü/g, 'U')
          .replace(/ş/g, 's').replace(/Ş/g, 'S')
          .replace(/ö/g, 'o').replace(/Ö/g, 'O')
          .replace(/ç/g, 'c').replace(/Ç/g, 'C');
      };
      
      // Logo ve Başlık
      doc.setFontSize(20);
      doc.setTextColor(220, 53, 69);
      doc.text('Paydos Tur', 20, 20);
      
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text('Paydos Turizm Ve Seyahat Acentaligi Sanayi Ve Ticaret Limited Sirketi', 20, 28);
      doc.text('Mehmetcik Mahallesi Ulus Caddesi No: 124/1 Denizli / Turkiye', 20, 33);
    doc.text('Tax: Pamukkale VD 7230433632 | Tel: 0 258 263 71 76', 20, 38);
    
    // Teklif/Proforma Başlık
    doc.setFontSize(24);
    doc.setTextColor(220, 53, 69);
    doc.text(quote.type === 'teklif' ? 'TEKLIF' : 'PROFORMA FATURA', 150, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(quote.number, 150, 28);
    
    // Bilgiler
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text('TARIH', 20, 50);
    doc.text('OPSIYON TARIHI', 70, 50);
    doc.text('PARA BIRIMI', 120, 50);
    doc.text('HAZIRLAYAN', 150, 50);
    
    doc.setTextColor(0);
    doc.text(new Date(quote.createdAt).toLocaleDateString('tr-TR'), 20, 56);
    doc.text(quote.optionDate ? new Date(quote.optionDate).toLocaleDateString('tr-TR') : '-', 70, 56);
    doc.text(quote.currency, 120, 56);
    doc.text(toTurkishChars(quote.createdBy || 'Onder Tasci'), 150, 56);
    
    // Konu
    doc.setTextColor(60);
    doc.text('KONU', 20, 66);
    doc.setTextColor(0);
    doc.text(toTurkishChars(quote.subject), 20, 72);
    
    // Müşteri Bilgileri
    doc.setFontSize(12);
    doc.setTextColor(220, 53, 69);
    doc.text('MUSTERI BILGILERI', 20, 85);
    
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text('Firma / Ad Soyad', 20, 93);
    if (quote.type === 'proforma') {
      doc.text('Vergi Dairesi', 110, 93);
    } else {
      doc.text('Yetkili Kisi', 110, 93);
    }
    
    doc.setTextColor(0);
    doc.text(toTurkishChars(`${quote.customer.firstName} ${quote.customer.lastName}`), 20, 99);
    doc.text('-', 110, 99);
    
    doc.setTextColor(60);
    doc.text('Telefon', 20, 107);
    doc.text('E-posta', 110, 107);
    
    doc.setTextColor(0);
    doc.text(quote.customer.phone || '-', 20, 113);
    doc.text(quote.customer.email || '-', 110, 113);
    
    // Hizmet Kalemleri Tablosu
    doc.setFontSize(12);
    doc.setTextColor(220, 53, 69);
    doc.text('HIZMET KALEMLERI', 20, 126);
    
    const tableData = quote.items.map(item => [
      item.service,
      item.description,
      item.quantity.toString(),
      item.unitPrice.toFixed(2),
      (item.quantity * item.unitPrice).toFixed(2)
    ]);
    
    // Manuel tablo çizimi (autoTable yerine)
    let currentY = 132;
    
    // Tablo başlığı
    doc.setFillColor(31, 41, 55);
    doc.rect(20, currentY, 170, 8, 'F');
    doc.setFontSize(9);
    doc.setTextColor(255);
    doc.text('HIZMET', 22, currentY + 5);
    doc.text('ACIKLAMA', 62, currentY + 5);
    doc.text('ADET', 125, currentY + 5);
    doc.text('BIRIM', 145, currentY + 5);
    doc.text('TOPLAM', 170, currentY + 5);
    currentY += 8;
    
    // Tablo satırları
    doc.setTextColor(0);
    quote.items.forEach((item, idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(245, 245, 245);
        doc.rect(20, currentY, 170, 7, 'F');
      }
      doc.text(toTurkishChars(item.service.substring(0, 15)), 22, currentY + 5);
      doc.text(toTurkishChars(item.description.substring(0, 25)), 62, currentY + 5);
      doc.text(item.quantity.toString(), 130, currentY + 5);
      doc.text(item.unitPrice.toFixed(2), 150, currentY + 5);
      doc.text((item.quantity * item.unitPrice).toFixed(2), 175, currentY + 5);
      currentY += 7;
    });
    
    // Hesaplamalar
    const finalY = currentY + 10;
    
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text('Ara Toplam:', 130, finalY);
    doc.setTextColor(0);
    doc.text(`${quote.subtotal.toFixed(2)} ${quote.currency}`, 180, finalY, { align: 'right' });
    
    if (quote.vatIncluded) {
      doc.setTextColor(60);
      doc.text(`KDV (${quote.vatRate}%):`, 130, finalY + 6);
      doc.setTextColor(0);
      doc.text(`${(quote.subtotal * quote.vatRate / 100).toFixed(2)} ${quote.currency}`, 180, finalY + 6, { align: 'right' });
    }
    
    if (quote.discount > 0) {
      doc.setTextColor(60);
      doc.text('Indirim:', 130, finalY + (quote.vatIncluded ? 12 : 6));
      doc.setTextColor(0);
      doc.text(`-${quote.discount.toFixed(2)} ${quote.currency}`, 180, finalY + (quote.vatIncluded ? 12 : 6), { align: 'right' });
    }
    
    // Toplam
    const totalY = finalY + (quote.vatIncluded ? 18 : 12) + (quote.discount > 0 ? 6 : 0);
    doc.setFillColor(220, 53, 69);
    doc.rect(120, totalY - 5, 70, 12, 'F');
    doc.setFontSize(12);
    doc.setTextColor(255);
    doc.text('TOPLAM:', 130, totalY + 2);
    doc.text(`${quote.total.toFixed(2)} ${quote.currency}`, 180, totalY + 2, { align: 'right' });
    
    // Banka Bilgileri (Sadece Proforma için)
    if (quote.type === 'proforma') {
      const bankY = totalY + 15;
      doc.setFontSize(11);
      doc.setTextColor(220, 53, 69);
      doc.text('BANKA BILGILERI', 20, bankY);
      
      doc.setFontSize(9);
      doc.setTextColor(60);
      doc.text('Garanti Bankasi A.S. - Denizli Cinar Subesi (781)', 20, bankY + 6);
      doc.text('Hesap Sahibi: Paydos Turizm Seyahat ve Acenteligi San. Tic. Ltd. Sti.', 20, bankY + 11);
      
      doc.setTextColor(0);
      doc.text('IBAN (TL):', 20, bankY + 18);
      doc.text('TR40 0006 2000 7810 0006 2962 46', 50, bankY + 18);
      
      doc.text('IBAN (EUR):', 20, bankY + 23);
      doc.text('TR73 0006 2000 7810 0009 0910 95', 50, bankY + 23);
      
      doc.text('IBAN (USD):', 20, bankY + 28);
      doc.text('TR46 0006 2000 7810 0009 0910 96', 50, bankY + 28);
    }
    
    // Notlar
    if (quote.notes) {
      const notesY = quote.type === 'proforma' ? totalY + 50 : totalY + 15;
      doc.setFontSize(11);
      doc.setTextColor(220, 53, 69);
      doc.text('NOTLAR', 20, notesY);
      
      doc.setFontSize(9);
      doc.setTextColor(0);
      const splitNotes = doc.splitTextToSize(toTurkishChars(quote.notes), 170);
      doc.text(splitNotes, 20, notesY + 6);
    }
    
    // Footer
    doc.setFontSize(8);
    doc.setTextColor(100);
    const footerText = quote.type === 'teklif' 
      ? '• Bu teklif opsiyon tarihine kadar gecerlidir. • Fiyatlar doviz kuruna gore degisiklik gosterebilir.'
      : 'Bu proforma fatura bilgi amaclidir ve yasal belge niteligi tasimaz.';
    doc.text(footerText, 105, 285, { align: 'center' });
    doc.text('www.paydosturizm.com', 105, 290, { align: 'center' });
    
    return doc;
    } catch (error) {
      console.error('PDF oluşturma hatası:', error);
      throw new Error('PDF oluşturulamadı: ' + error.message);
    }
  };

  const downloadPDF = (quote) => {
    try {
      console.log('PDF oluşturuluyor...', quote);
      const doc = generatePDF(quote);
      doc.save(`${quote.number}.pdf`);
      showToast?.('PDF indirildi', 'success');
    } catch (error) {
      console.error('PDF oluşturma hatası:', error);
      showToast?.('PDF oluşturma hatası: ' + error.message, 'error');
    }
  };

  const sendWhatsApp = async (quote) => {
    try {
      console.log('WhatsApp gönderiliyor...', quote);
      const message = `Merhaba ${quote.customer.firstName},\n\n${quote.type === 'teklif' ? 'Teklifiniz' : 'Proforma faturanız'} hazır.\n\nBelge No: ${quote.number}\nToplam: ${quote.total.toFixed(2)} ${quote.currency}`;
      
      const phone = quote.customer.phone?.replace(/\D/g, '');
      if (!phone) {
        showToast?.('Müşterinin telefon numarası yok!', 'error');
        return;
      }
      
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
      showToast?.('WhatsApp açıldı', 'success');
    } catch (error) {
      console.error('WhatsApp hatası:', error);
      showToast?.('WhatsApp hatası: ' + error.message, 'error');
    }
  };

  const sendEmail = (quote) => {
    try {
      console.log('E-posta gönderiliyor...', quote);
      const subject = `${quote.type === 'teklif' ? 'Teklif' : 'Proforma Fatura'} - ${quote.subject}`;
      const body = `Merhaba ${quote.customer.firstName} ${quote.customer.lastName},\n\n${quote.type === 'teklif' ? 'Teklifiniz' : 'Proforma faturanız'} ektedir.\n\nBelge No: ${quote.number}\nToplam: ${quote.total.toFixed(2)} ${quote.currency}\n\nİyi günler dileriz.\n\nPaydos Turizm`;
      
      if (!quote.customer.email) {
        showToast?.('Müşterinin e-posta adresi yok!', 'error');
        return;
      }
      
      window.location.href = `mailto:${quote.customer.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      showToast?.('E-posta istemcisi açıldı', 'success');
    } catch (error) {
      console.error('E-posta hatası:', error);
      showToast?.('E-posta hatası: ' + error.message, 'error');
    }
  };

  const addItem = () => {
    setFormData({ ...formData, items: [...formData.items, { service: '', description: '', quantity: 1, unitPrice: 0 }] });
  };

  const removeItem = (index) => {
    if (formData.items.length > 1) {
      setFormData({ ...formData, items: formData.items.filter((_, i) => i !== index) });
    }
  };

  const updateItem = (index, field, value) => {
    const updated = formData.items.map((item, i) => i === index ? { ...item, [field]: value } : item);
    setFormData({ ...formData, items: updated });
  };

  const resetForm = () => {
    setFormData(emptyForm);
    setFormStep('type');
    setShowForm(false);
    setSearchQuery('');
  };

  const handleSave = () => {
    if (!formData.type || !formData.customer || !formData.subject) {
      alert('Tür, müşteri ve konu zorunludur!');
      return;
    }

    const newQuote = {
      ...formData,
      id: Date.now(),
      number: `${formData.type === 'teklif' ? 'TKL' : 'PF'}-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${String(quotes.length + 1).padStart(3, '0')}`,
      createdAt: new Date().toISOString(),
      createdBy: 'Önder Taşcı'
    };

    setQuotes([...quotes, newQuote]);
    showToast?.(`${formData.type === 'teklif' ? 'Teklif' : 'Proforma'} oluşturuldu`, 'success');
    resetForm();
  };

  const searchResults = customerSearchQuery.length >= 2
    ? customers.filter(c =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
        c.phone?.includes(customerSearchQuery) ||
        c.email?.toLowerCase().includes(customerSearchQuery.toLowerCase())
      ).slice(0, 10)
    : [];

  const filteredQuotes = quotes
    .filter(q => filterType === 'all' || q.type === filterType)
    .filter(q => 
      searchQuery.length < 2 || 
      q.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `${q.customer?.firstName} ${q.customer?.lastName}`.toLowerCase().includes(searchQuery.toLowerCase())
    );

  useEffect(() => {
    calculateTotal();
  }, [formData.items, formData.vatIncluded, formData.vatRate, formData.discount]);

  // Görüntüleme Modal
  if (viewingQuote) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(180deg, #0a1628 0%, #132742 50%, #0a1628 100%)', zIndex: 300, overflow: 'auto' }}>
        <div style={{ position: 'sticky', top: 0, background: 'rgba(10,22,40,0.98)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
          <button onClick={() => setViewingQuote(null)} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 16px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px' }}>← Geri</button>
          <h2 style={{ margin: 0, fontSize: '16px', color: '#ffffff' }}>{viewingQuote.type === 'teklif' ? '📝 Teklif' : '💰 Proforma'}</h2>
          <div style={{ width: '70px' }}></div>
        </div>

        <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
            {/* Header Info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: '20px', color: '#ffffff' }}>{viewingQuote.subject}</h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Belge No: {viewingQuote.number}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#64748b' }}>Müşteri</p>
                <p style={{ margin: 0, fontSize: '14px', color: '#e8f1f8', fontWeight: '600' }}>{viewingQuote.customer.firstName} {viewingQuote.customer.lastName}</p>
              </div>
            </div>

            {/* İtemler */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: '#94a3b8' }}>Hizmet Kalemleri</h4>
              {viewingQuote.items.map((item, idx) => (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 3fr 80px 100px 100px', gap: '12px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', marginBottom: '8px' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Hizmet</span>
                    <span style={{ fontSize: '13px', color: '#e8f1f8' }}>{item.service}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Açıklama</span>
                    <span style={{ fontSize: '13px', color: '#e8f1f8' }}>{item.description}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Adet</span>
                    <span style={{ fontSize: '13px', color: '#e8f1f8' }}>{item.quantity}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Birim</span>
                    <span style={{ fontSize: '13px', color: '#e8f1f8' }}>{item.unitPrice.toFixed(2)}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Toplam</span>
                    <span style={{ fontSize: '13px', color: '#10b981', fontWeight: '600' }}>{(item.quantity * item.unitPrice).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '20px', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: '#94a3b8' }}>Ara Toplam:</span>
                <span style={{ fontSize: '14px', color: '#e8f1f8' }}>{viewingQuote.subtotal.toFixed(2)} {viewingQuote.currency}</span>
              </div>
              {viewingQuote.vatIncluded && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#94a3b8' }}>KDV ({viewingQuote.vatRate}%):</span>
                  <span style={{ fontSize: '14px', color: '#f59e0b' }}>+{(viewingQuote.subtotal * viewingQuote.vatRate / 100).toFixed(2)} {viewingQuote.currency}</span>
                </div>
              )}
              {viewingQuote.discount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#94a3b8' }}>İndirim:</span>
                  <span style={{ fontSize: '14px', color: '#ef4444' }}>-{viewingQuote.discount.toFixed(2)} {viewingQuote.currency}</span>
                </div>
              )}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px', marginTop: '12px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '16px', color: '#ffffff', fontWeight: '700' }}>TOPLAM:</span>
                <span style={{ fontSize: '20px', color: '#10b981', fontWeight: '700' }}>{viewingQuote.total.toFixed(2)} {viewingQuote.currency}</span>
              </div>
            </div>

            {viewingQuote.notes && (
              <div style={{ marginTop: '20px', padding: '16px', background: 'rgba(59,130,246,0.1)', borderRadius: '12px', border: '1px solid rgba(59,130,246,0.2)' }}>
                <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#3b82f6', fontWeight: '600' }}>Notlar:</p>
                <p style={{ margin: 0, fontSize: '13px', color: '#e8f1f8', whiteSpace: 'pre-wrap' }}>{viewingQuote.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Buttons */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(10,22,40,0.98)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '16px 20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button onClick={() => downloadPDF(viewingQuote)} style={{ flex: 1, minWidth: '140px', padding: '14px', background: 'linear-gradient(135deg, #ef4444, #dc2626)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>📄 PDF İndir</button>
          <button onClick={() => sendWhatsApp(viewingQuote)} style={{ flex: 1, minWidth: '140px', padding: '14px', background: 'linear-gradient(135deg, #25d366, #128c7e)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>📱 WhatsApp</button>
          <button onClick={() => sendEmail(viewingQuote)} style={{ flex: 1, minWidth: '140px', padding: '14px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>✉️ E-posta</button>
        </div>
      </div>
    );
  }

  if (showForm) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(180deg, #0a1628 0%, #132742 50%, #0a1628 100%)', zIndex: 300, overflow: 'auto' }}>
        {/* Header */}
        <div style={{ position: 'sticky', top: 0, background: 'rgba(10,22,40,0.98)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
          <button onClick={resetForm} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 16px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px' }}>← İptal</button>
          <h2 style={{ margin: 0, fontSize: '16px', color: '#ffffff' }}>📄 Yeni {formData.type === 'teklif' ? 'Teklif' : 'Proforma'}</h2>
          <div style={{ width: '70px' }}></div>
        </div>

        <div style={{ padding: '20px', paddingBottom: '100px' }}>
          {/* ADIM 1: TÜR SEÇİMİ */}
          {formStep === 'type' && (
            <div>
              <div style={{ background: 'rgba(59,130,246,0.1)', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(59,130,246,0.2)' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#3b82f6' }}>📋 Adım 1/3: Tür Seçimi</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: '16px' }}>
                <button onClick={() => { setFormData({ ...formData, type: 'teklif' }); setFormStep('customer'); }} style={{ padding: '40px', background: 'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0.05) 100%)', border: '2px solid rgba(59,130,246,0.3)', borderRadius: '16px', cursor: 'pointer', textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>📝</div>
                  <div style={{ fontSize: '18px', fontWeight: '600', color: '#3b82f6', marginBottom: '8px' }}>TEKLİF</div>
                  <div style={{ fontSize: '13px', color: '#64748b' }}>Fiyat teklifi hazırla</div>
                </button>

                <button onClick={() => { setFormData({ ...formData, type: 'proforma' }); setFormStep('customer'); }} style={{ padding: '40px', background: 'linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(16,185,129,0.05) 100%)', border: '2px solid rgba(16,185,129,0.3)', borderRadius: '16px', cursor: 'pointer', textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>💰</div>
                  <div style={{ fontSize: '18px', fontWeight: '600', color: '#10b981', marginBottom: '8px' }}>PROFORMA FATURA</div>
                  <div style={{ fontSize: '13px', color: '#64748b' }}>Ön fatura oluştur</div>
                </button>
              </div>
            </div>
          )}

          {/* ADIM 2: MÜŞTERİ SEÇİMİ */}
          {formStep === 'customer' && (
            <div>
              <div style={{ background: 'rgba(139,92,246,0.1)', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(139,92,246,0.2)' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#8b5cf6' }}>📋 Adım 2/3: Müşteri Seçimi</p>
                <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#94a3b8' }}>Tür: <strong style={{ color: '#fff' }}>{formData.type === 'teklif' ? 'Teklif' : 'Proforma Fatura'}</strong></p>
              </div>

              <input
                type="text"
                placeholder="🔍 Müşteri ara (ad, soyad, telefon, e-posta)..."
                value={customerSearchQuery}
                onChange={e => setCustomerSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '14px', marginBottom: '16px', boxSizing: 'border-box' }}
              />

              {searchResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {searchResults.map(customer => (
                    <div key={customer.id} onClick={() => { setFormData({ ...formData, customer }); setFormStep('details'); }} style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: '600', color: '#e8f1f8' }}>{customer.firstName} {customer.lastName}</p>
                          <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>{customer.phone} • {customer.email}</p>
                        </div>
                        <span style={{ fontSize: '20px' }}>→</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {customerSearchQuery.length < 2 && (
                <p style={{ textAlign: 'center', color: '#64748b', padding: '30px' }}>En az 2 karakter girin</p>
              )}
            </div>
          )}

          {/* ADIM 3: DETAYLAR */}
          {formStep === 'details' && formData.customer && (
            <div>
              <div style={{ background: 'rgba(16,185,129,0.1)', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(16,185,129,0.2)' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#10b981' }}>📋 Adım 3/3: Detaylar</p>
                <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#94a3b8' }}>Müşteri: <strong style={{ color: '#fff' }}>{formData.customer.firstName} {formData.customer.lastName}</strong></p>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '100px' }}>
                {/* Konu ve Tarih */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 200px 120px', gap: '12px', marginBottom: '20px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Konu *</label>
                    <input type="text" value={formData.subject} onChange={e => setFormData({ ...formData, subject: e.target.value })} placeholder="Örn: Almanya Vize Başvurusu" style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Opsiyon Tarihi</label>
                    <input type="date" value={formData.optionDate} onChange={e => setFormData({ ...formData, optionDate: e.target.value })} style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Para Birimi</label>
                    <select value={formData.currency} onChange={e => setFormData({ ...formData, currency: e.target.value })} style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px' }}>
                      <option value="EUR">EUR (€)</option>
                      <option value="USD">USD ($)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="TRY">TRY (₺)</option>
                    </select>
                  </div>
                </div>

                {/* Hizmet Kalemleri */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: '#ffffff' }}>Hizmet Kalemleri</h4>
                  {formData.items.map((item, idx) => (
                    <div key={idx} style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '10px', marginBottom: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 3fr 80px 120px 120px 40px', gap: '10px', alignItems: 'end' }}>
                        <div>
                          <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Hizmet</label>
                          <input type="text" value={item.service} onChange={e => updateItem(idx, 'service', e.target.value)} placeholder="Vize" style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' }} />
                        </div>

                        <div>
                          <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Açıklama</label>
                          <input type="text" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} placeholder="Detaylar" style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' }} />
                        </div>

                        <div>
                          <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Adet</label>
                          <input type="number" value={item.quantity} onChange={e => updateItem(idx, 'quantity', Number(e.target.value))} min="1" style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' }} />
                        </div>

                        <div>
                          <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Birim Fiyat</label>
                          <input type="number" value={item.unitPrice} onChange={e => updateItem(idx, 'unitPrice', Number(e.target.value))} min="0" step="0.01" style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' }} />
                        </div>

                        <div>
                          <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Toplam</label>
                          <div style={{ padding: '10px', background: 'rgba(16,185,129,0.1)', borderRadius: '6px', fontSize: '13px', color: '#10b981', fontWeight: '600', textAlign: 'right' }}>
                            {(item.quantity * item.unitPrice).toFixed(2)}
                          </div>
                        </div>

                        <button onClick={() => removeItem(idx)} disabled={formData.items.length === 1} style={{ padding: '10px', background: formData.items.length === 1 ? 'rgba(100,116,139,0.1)' : 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '6px', color: formData.items.length === 1 ? '#64748b' : '#ef4444', cursor: formData.items.length === 1 ? 'not-allowed' : 'pointer', fontSize: '16px' }}>🗑️</button>
                      </div>
                    </div>
                  ))}

                  <button onClick={addItem} style={{ width: '100%', padding: '12px', background: 'rgba(59,130,246,0.1)', border: '1px dashed rgba(59,130,246,0.3)', borderRadius: '10px', color: '#3b82f6', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>➕ Kalem Ekle</button>
                </div>

                {/* Hesaplamalar */}
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>Ara Toplam:</span>
                    <span style={{ fontSize: '14px', color: '#e8f1f8', fontWeight: '600' }}>{formData.subtotal.toFixed(2)} {formData.currency}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <label style={{ fontSize: '13px', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input type="checkbox" checked={formData.vatIncluded} onChange={e => setFormData({ ...formData, vatIncluded: e.target.checked })} />
                        KDV Dahil
                      </label>
                      {formData.vatIncluded && (
                        <input type="number" value={formData.vatRate} onChange={e => setFormData({ ...formData, vatRate: Number(e.target.value) })} min="0" max="100" style={{ width: '60px', padding: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '12px' }} />
                      )}
                    </div>
                    {formData.vatIncluded && <span style={{ fontSize: '14px', color: '#f59e0b', fontWeight: '600' }}>+{(formData.subtotal * formData.vatRate / 100).toFixed(2)} {formData.currency}</span>}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>İndirim:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input type="number" value={formData.discount} onChange={e => setFormData({ ...formData, discount: Number(e.target.value) })} min="0" step="0.01" style={{ width: '100px', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '13px', textAlign: 'right' }} />
                      <span style={{ fontSize: '13px', color: '#e8f1f8' }}>{formData.currency}</span>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '16px', color: '#ffffff', fontWeight: '700' }}>TOPLAM:</span>
                    <span style={{ fontSize: '20px', color: '#10b981', fontWeight: '700' }}>{formData.total.toFixed(2)} {formData.currency}</span>
                  </div>
                </div>

                {/* Notlar */}
                <div style={{ marginTop: '20px' }}>
                  <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Notlar</label>
                  <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Ek açıklamalar..." style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', minHeight: '80px', resize: 'vertical', boxSizing: 'border-box' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        {formStep === 'details' && (
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(10,22,40,0.98)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '16px 20px', display: 'flex', gap: '12px' }}>
            <button onClick={handleSave} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>💾 Kaydet</button>
            <button style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg, #25d366, #128c7e)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>📱 WhatsApp</button>
            <button style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>✉️ E-posta</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', color: '#ffffff' }}>📄 Teklif & Proforma</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>{filteredQuotes.length} / {quotes.length} kayıt</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>➕ Yeni Oluştur</button>
      </div>

      {/* Filtre Butonları */}
      {quotes.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button onClick={() => setFilterType('all')} style={{ padding: '10px 20px', background: filterType === 'all' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'rgba(255,255,255,0.05)', border: filterType === 'all' ? 'none' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: filterType === 'all' ? 'white' : '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
              📋 Tümü ({quotes.length})
            </button>
            <button onClick={() => setFilterType('teklif')} style={{ padding: '10px 20px', background: filterType === 'teklif' ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)' : 'rgba(255,255,255,0.05)', border: filterType === 'teklif' ? 'none' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: filterType === 'teklif' ? 'white' : '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
              📝 Teklifler ({quotes.filter(q => q.type === 'teklif').length})
            </button>
            <button onClick={() => setFilterType('proforma')} style={{ padding: '10px 20px', background: filterType === 'proforma' ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.05)', border: filterType === 'proforma' ? 'none' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: filterType === 'proforma' ? 'white' : '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
              💰 Proformalar ({quotes.filter(q => q.type === 'proforma').length})
            </button>
          </div>

          {/* Arama */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 Konu, müşteri adı veya belge numarası ile ara..."
              style={{ width: '100%', padding: '12px 40px 12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '18px' }}>×</button>
            )}
          </div>
        </div>
      )}

      {filteredQuotes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
          <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#ffffff' }}>
            {quotes.length === 0 ? 'Henüz teklif/proforma oluşturulmamış' : 'Sonuç bulunamadı'}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            {quotes.length === 0 ? 'Yeni bir teklif veya proforma oluşturmak için "Yeni Oluştur" butonuna tıklayın' : 'Farklı bir arama terimi deneyin'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {filteredQuotes.map(quote => (
            <div key={quote.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '18px' }}>{quote.type === 'teklif' ? '📝' : '💰'}</span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>{quote.number}</span>
              </div>
              <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#ffffff' }}>{quote.subject}</h3>
              <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#64748b' }}>{quote.customer.firstName} {quote.customer.lastName}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'rgba(16,185,129,0.1)', borderRadius: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', color: '#10b981' }}>Toplam</span>
                <span style={{ fontSize: '16px', color: '#10b981', fontWeight: '700' }}>{quote.total.toFixed(2)} {quote.currency}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => setViewingQuote(quote)} style={{ flex: '1 1 auto', padding: '8px', background: 'rgba(59,130,246,0.2)', border: 'none', borderRadius: '6px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>👁️ Görüntüle</button>
                <button onClick={() => downloadPDF(quote)} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>📄</button>
                <button onClick={() => sendWhatsApp(quote)} style={{ padding: '8px 12px', background: 'rgba(37,211,102,0.2)', border: 'none', borderRadius: '6px', color: '#25d366', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>📱</button>
                <button onClick={() => sendEmail(quote)} style={{ padding: '8px 12px', background: 'rgba(59,130,246,0.2)', border: 'none', borderRadius: '6px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>✉️</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// KREDİ KARTLARI MODÜLÜ
function CreditCardsModule({ creditCards, setCreditCards, isMobile, showToast, addToUndo }) {
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
    showToast?.('Kart silindi', 'info', {
      label: '↩️ Geri Al',
      action: () => {
        setCreditCards([...updated, card].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
        showToast?.('Kart geri yüklendi', 'success');
      }
    });
  };

  const filteredCards = searchQuery.length >= 2
    ? creditCards.filter(c =>
        c.cardName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.cardNumber?.includes(searchQuery) ||
        c.cardHolder?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.bank?.toLowerCase().includes(searchQuery.toLowerCase())
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
                  <input type="text" value={formData.cardHolder} onChange={e => setFormData({...formData, cardHolder: e.target.value.toUpperCase()})} placeholder="AD SOYAD" style={{...inputStyle, textTransform: 'uppercase'}} />
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
          {searchQuery.length >= 2 && (
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#64748b' }}>{filteredCards.length} sonuç bulundu</p>
          )}
        </div>
      )}

      {filteredCards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>💳</div>
          <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#ffffff' }}>
            {searchQuery.length >= 2 ? 'Sonuç bulunamadı' : 'Henüz kart eklenmemiş'}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            {searchQuery.length >= 2 ? 'Farklı bir arama terimi deneyin' : 'Kredi/banka kartı bilgilerini eklemek için "Yeni Kart" butonuna tıklayın'}
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

// ACENTELİKLER MODÜLÜ
function AgenciesModule({ agencies, setAgencies, isMobile, showToast, addToUndo }) {
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
    showToast?.('Acentelik silindi', 'info', {
      label: '↩️ Geri Al',
      action: () => {
        setAgencies([...updated, agency].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
        showToast?.('Acentelik geri yüklendi', 'success');
      }
    });
  };

  const filteredAgencies = searchQuery.length >= 2
    ? agencies.filter(a =>
        a.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.link?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.institutionCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.userCode?.toLowerCase().includes(searchQuery.toLowerCase())
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
          {searchQuery.length >= 2 && (
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#64748b' }}>{filteredAgencies.length} sonuç bulundu</p>
          )}
        </div>
      )}

      {/* Liste - Tablo Görünümü */}
      {filteredAgencies.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏢</div>
          <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#ffffff' }}>
            {searchQuery.length >= 2 ? 'Sonuç bulunamadı' : 'Henüz acentelik eklenmemiş'}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            {searchQuery.length >= 2 ? 'Farklı bir arama terimi deneyin' : 'Kayıtlı sistem bilgilerini eklemek için "Yeni Acentelik" butonuna tıklayın'}
          </p>
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden' }}>
          {/* Table Header */}
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 150px 200px 150px 80px', gap: '16px', padding: '16px 20px', background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '12px', fontWeight: '600', color: '#f59e0b' }}>
              <div>ACENTE ADI</div>
              <div>LİNK</div>
              <div>KURUM KODU</div>
              <div>KULLANICI</div>
              <div>ŞİFRE</div>
              <div style={{ textAlign: 'center' }}>İŞLEM</div>
            </div>
          )}
          
          {/* Table Rows */}
          <div style={{ maxHeight: isMobile ? 'none' : '600px', overflowY: 'auto' }}>
            {filteredAgencies.map((agency, idx) => (
              <div key={agency.id} style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: isMobile ? '1fr' : '200px 1fr 150px 200px 150px 80px', gap: '16px', padding: '16px 20px', borderBottom: idx < filteredAgencies.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)', alignItems: 'center' }}>
                
                {/* Acente Adı */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Acente Adı</span>}
                  <span style={{ fontSize: '14px', color: '#f59e0b', fontWeight: '600' }}>{agency.name}</span>
                </div>

                {/* Link */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: isMobile ? '12px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Link</span>}
                  {agency.link ? (
                    <a href={agency.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: '#3b82f6', textDecoration: 'none', wordBreak: 'break-all', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      🔗 {agency.link}
                    </a>
                  ) : (
                    <span style={{ fontSize: '13px', color: '#64748b' }}>-</span>
                  )}
                </div>

                {/* Kurum Kodu */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: isMobile ? '12px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Kurum Kodu</span>}
                  <span style={{ fontSize: '13px', color: '#e8f1f8', fontFamily: 'monospace', letterSpacing: '1px' }}>
                    {agency.institutionCode || '-'}
                  </span>
                </div>

                {/* Kullanıcı */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: isMobile ? '12px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Kullanıcı Kodu / E-mail</span>}
                  <span style={{ fontSize: '13px', color: '#e8f1f8', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {agency.userCode || '-'}
                  </span>
                </div>

                {/* Şifre */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: isMobile ? '12px' : '0' }}>
                  {isMobile && <span style={{ fontSize: '11px', color: '#64748b' }}>Şifre</span>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: '#e8f1f8', fontFamily: 'monospace', letterSpacing: '2px' }}>
                      {agency.password || '-'}
                    </span>
                    {agency.password && (
                      <button onClick={() => navigator.clipboard.writeText(agency.password)} style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', padding: '4px 8px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px' }}>📋</button>
                    )}
                  </div>
                </div>

                {/* İşlemler */}
                <div style={{ display: 'flex', gap: '8px', justifyContent: isMobile ? 'flex-start' : 'center', marginTop: isMobile ? '12px' : '0' }}>
                  <button onClick={() => openEditForm(agency)} style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '8px 12px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px', fontWeight: '500' }}>✏️</button>
                  <button onClick={() => deleteAgency(agency.id)} style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '8px 12px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '500' }}>🗑️</button>
                </div>

                {/* Notlar (varsa) */}
                {agency.notes && (
                  <div style={{ gridColumn: isMobile ? '1' : '1 / -1', marginTop: '12px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '12px', color: '#94a3b8', borderLeft: '3px solid rgba(245,158,11,0.5)' }}>
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

// AYARLAR MODÜLÜ
function SettingsModule({ users, setUsers, currentUser, setCurrentUser, isMobile, appSettings, setAppSettings }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userFormData, setUserFormData] = useState({});
  const [passwordData, setPasswordData] = useState({ current: '', new: '', confirm: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [newProcessor, setNewProcessor] = useState('');
  const [newPersonalField, setNewPersonalField] = useState('');
  const [newVisaStatus, setNewVisaStatus] = useState('');
  const [newDuration, setNewDuration] = useState({ category: 'usa', value: '', price: 0, currency: '€' });

  const isAdmin = currentUser?.role === 'admin';

  const resetUserForm = () => {
    setUserFormData({ name: '', email: '', password: '', role: 'user' });
    setEditingUser(null);
  };

  const openNewUserForm = () => {
    resetUserForm();
    setShowUserForm(true);
  };

  const openEditUser = (user) => {
    setEditingUser(user);
    setUserFormData({ ...user, password: '' });
    setShowUserForm(true);
  };

  const handleUserSubmit = async (e) => {
    e.preventDefault();
    if (!userFormData.name || !userFormData.email) {
      alert('Ad ve e-posta zorunlu');
      return;
    }

    if (editingUser) {
      const updateData = { name: userFormData.name, email: userFormData.email, role: userFormData.role };
      if (userFormData.password) updateData.password = userFormData.password;
      
      const updated = users.map(u => u.id === editingUser.id ? { ...u, ...updateData } : u);
      setUsers(updated);
      
      // Eğer kendi profilini güncelliyorsa currentUser'ı da güncelle
      if (currentUser.id === editingUser.id) {
        const updatedCurrentUser = { ...currentUser, ...updateData };
        setCurrentUser(updatedCurrentUser);
        localStorage.setItem('paydos_current_user', JSON.stringify(updatedCurrentUser));
      }
      
    } else {
      if (!userFormData.password) {
        alert('Yeni kullanıcı için şifre zorunlu');
        return;
      }
      const newUser = { ...userFormData, id: generateUniqueId(), createdAt: new Date().toISOString() };
      setUsers([...users, newUser]);
    }
    
    setShowUserForm(false);
    resetUserForm();
  };

  const deleteUser = async (id) => {
    if (id === currentUser.id) {
      alert('Kendi hesabınızı silemezsiniz!');
      return;
    }
    if (!confirm('Bu kullanıcıyı silmek istediğinize emin misiniz?')) return;
    setUsers(users.filter(u => u.id !== id));
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (passwordData.current !== currentUser.password) {
      setPasswordError('Mevcut şifre yanlış!');
      return;
    }
    if (passwordData.new.length < 4) {
      setPasswordError('Yeni şifre en az 4 karakter olmalı');
      return;
    }
    if (passwordData.new !== passwordData.confirm) {
      setPasswordError('Yeni şifreler eşleşmiyor!');
      return;
    }

    const updated = users.map(u => u.id === currentUser.id ? { ...u, password: passwordData.new } : u);
    setUsers(updated);
    
    const updatedCurrentUser = { ...currentUser, password: passwordData.new };
    setCurrentUser(updatedCurrentUser);
    localStorage.setItem('paydos_current_user', JSON.stringify(updatedCurrentUser));
    
    
    setPasswordSuccess('Şifre başarıyla değiştirildi!');
    setPasswordData({ current: '', new: '', confirm: '' });
    setTimeout(() => setPasswordSuccess(''), 3000);
  };

  return (
    <div style={{ padding: isMobile ? '16px' : '24px' }}>
      <h2 style={{ fontSize: '20px', margin: '0 0 16px' }}>⚙️ Ayarlar</h2>

      {/* Sekmeler */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button onClick={() => setActiveTab('profile')} style={{ padding: '12px 16px', background: activeTab === 'profile' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'profile' ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'profile' ? '#3b82f6' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'profile' ? '600' : '400' }}>
          👤 Profil
        </button>
        <button onClick={() => setActiveTab('password')} style={{ padding: '12px 16px', background: activeTab === 'password' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'password' ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'password' ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'password' ? '600' : '400' }}>
          🔐 Şifre
        </button>
        {isAdmin && (
          <>
            <button onClick={() => setActiveTab('users')} style={{ padding: '12px 16px', background: activeTab === 'users' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'users' ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'users' ? '#10b981' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'users' ? '600' : '400' }}>
              👥 Kullanıcılar
            </button>
            <button onClick={() => setActiveTab('visaSettings')} style={{ padding: '12px 16px', background: activeTab === 'visaSettings' ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'visaSettings' ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'visaSettings' ? '#8b5cf6' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'visaSettings' ? '600' : '400' }}>
              🌍 Vize Ayarları
            </button>
            <button onClick={() => setActiveTab('statusManagement')} style={{ padding: '12px 16px', background: activeTab === 'statusManagement' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'statusManagement' ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'statusManagement' ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'statusManagement' ? '600' : '400' }}>
              📊 Durum Yönetimi
            </button>
          </>
        )}
      </div>

      {/* VİZE AYARLARI */}
      {activeTab === 'visaSettings' && isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* İşlemciler */}
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#3b82f6' }}>👨‍💼 İşlemciler</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {(appSettings?.processors || []).map((p, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(59,130,246,0.15)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(59,130,246,0.3)' }}>
                  <span style={{ fontSize: '12px', color: '#3b82f6' }}>{p}</span>
                  <button onClick={() => setAppSettings({ ...appSettings, processors: appSettings.processors.filter((_, i) => i !== idx) })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="text" value={newProcessor} onChange={e => setNewProcessor(e.target.value)} placeholder="Yeni işlemci" style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '12px' }} onKeyPress={e => { if (e.key === 'Enter' && newProcessor.trim()) { setAppSettings({ ...appSettings, processors: [...(appSettings.processors || []), newProcessor.trim()] }); setNewProcessor(''); } }} />
              <button onClick={() => { if (newProcessor.trim()) { setAppSettings({ ...appSettings, processors: [...(appSettings.processors || []), newProcessor.trim()] }); setNewProcessor(''); } }} style={{ padding: '8px 12px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '12px' }}>➕</button>
            </div>
          </div>

          {/* WhatsApp Mesaj Şablonu */}
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#10b981' }}>💬 WhatsApp Mesaj Şablonu</h3>
            <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>
              Kullanılabilir değişkenler: {'{isim}'}, {'{ulke}'}, {'{tarih}'}, {'{saat}'}, {'{pnr}'}
            </p>
            <textarea
              value={appSettings?.whatsappTemplate || ''}
              onChange={e => setAppSettings({ ...appSettings, whatsappTemplate: e.target.value })}
              placeholder="WhatsApp mesaj şablonunuzu yazın..."
              style={{ 
                width: '100%', 
                minHeight: '150px', 
                padding: '12px', 
                background: 'rgba(255,255,255,0.05)', 
                border: '1px solid rgba(255,255,255,0.1)', 
                borderRadius: '8px', 
                color: '#e8f1f8', 
                fontSize: '12px',
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
            />
          </div>

        </div>
      )}

      {/* 🌍 VİZE AYARLARI */}
      {activeTab === 'visaSettings' && isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b', fontWeight: '500' }}>
            Vize başvuruları için tüm ayarları buradan yönetebilirsiniz
          </p>

          {/* WhatsApp Mesaj Şablonu */}
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#10b981' }}>💬 WhatsApp Mesaj Şablonu</h3>
            <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>
              Kullanılabilir değişkenler: {'{isim}'}, {'{ulke}'}, {'{tarih}'}, {'{saat}'}, {'{pnr}'}
            </p>
            <textarea
              value={appSettings?.whatsappTemplate || ''}
              onChange={e => setAppSettings({ ...appSettings, whatsappTemplate: e.target.value })}
              placeholder="WhatsApp mesaj şablonunuzu yazın..."
              style={{ 
                width: '100%', 
                minHeight: '150px', 
                padding: '12px', 
                background: 'rgba(255,255,255,0.05)', 
                border: '1px solid rgba(255,255,255,0.1)', 
                borderRadius: '8px', 
                color: '#e8f1f8', 
                fontSize: '12px',
                fontFamily: 'inherit',
                resize: 'vertical',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Vize Türleri */}
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#8b5cf6' }}>🕒 Vize Türleri ve Fiyatları</h3>
            <p style={{ margin: '0 0 16px', fontSize: '11px', color: '#64748b' }}>Her ülke için vize türlerini ve fiyatlarını yönetin</p>
            
            <div style={{ display: 'grid', gap: '12px' }}>
              <details open style={{ background: 'rgba(34,197,94,0.05)', borderRadius: '10px', border: '1px solid rgba(34,197,94,0.2)', padding: '12px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: '600', color: '#22c55e', fontSize: '14px', marginBottom: '10px', listStyle: 'none' }}>
                  <span style={{ marginRight: '8px' }}>🇪🇺</span>
                  Schengen ({(appSettings?.visaDurations?.schengen || []).length} tür)
                </summary>
                <div style={{ paddingLeft: '26px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                    {(appSettings?.visaDurations?.schengen || []).map((d, idx) => {
                      const name = typeof d === 'string' ? d : d.name;
                      const price = typeof d === 'object' ? d.price : 0;
                      const currency = typeof d === 'object' ? d.currency : '€';
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(34,197,94,0.15)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(34,197,94,0.3)' }}>
                          <span style={{ fontSize: '11px', color: '#22c55e' }}>
                            {name} {price > 0 && `• ${price} ${currency}`}
                          </span>
                          <button onClick={() => setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, schengen: appSettings.visaDurations.schengen.filter((_, i) => i !== idx) } })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <input 
                      type="text" 
                      value={newDuration.category === 'schengen' ? newDuration.value : ''} 
                      onChange={e => setNewDuration({ ...newDuration, category: 'schengen', value: e.target.value })} 
                      placeholder="Vize türü" 
                      style={{ flex: '1 1 120px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} 
                    />
                    <input 
                      type="number" 
                      value={newDuration.category === 'schengen' ? (newDuration.price || '') : ''} 
                      onChange={e => setNewDuration({ ...newDuration, category: 'schengen', price: Number(e.target.value) })} 
                      placeholder="Fiyat" 
                      style={{ width: '70px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} 
                    />
                    <select 
                      value={newDuration.category === 'schengen' ? (newDuration.currency || '€') : '€'} 
                      onChange={e => setNewDuration({ ...newDuration, category: 'schengen', currency: e.target.value })}
                      style={{ width: '50px', padding: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }}
                    >
                      <option value="€">€</option>
                      <option value="$">$</option>
                      <option value="£">£</option>
                      <option value="₺">₺</option>
                    </select>
                    <button 
                      onClick={() => { 
                        if (newDuration.value && newDuration.value.trim()) { 
                          const newItem = {
                            name: newDuration.value.trim(),
                            price: newDuration.price || 0,
                            currency: newDuration.currency || '€'
                          };
                          setAppSettings({ 
                            ...appSettings, 
                            visaDurations: { 
                              ...appSettings.visaDurations, 
                              schengen: [...(appSettings.visaDurations?.schengen || []), newItem] 
                            } 
                          }); 
                          setNewDuration({ category: '', value: '', price: 0, currency: '€' }); 
                        } 
                      }} 
                      style={{ padding: '6px 10px', background: 'linear-gradient(135deg, #22c55e, #16a34a)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}
                    >
                      ➕
                    </button>
                  </div>
                </div>
              </details>

              <details style={{ background: 'rgba(239,68,68,0.05)', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)', padding: '12px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: '600', color: '#ef4444', fontSize: '14px', listStyle: 'none' }}>
                  <span style={{ marginRight: '8px' }}>🇷🇺</span>
                  Rusya ({(appSettings?.visaDurations?.russia || []).length} tür)
                </summary>
                <div style={{ paddingLeft: '26px', marginTop: '10px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                    {(appSettings?.visaDurations?.russia || []).map((d, idx) => {
                      const name = typeof d === 'string' ? d : d.name;
                      const price = typeof d === 'object' ? d.price : 0;
                      const currency = typeof d === 'object' ? d.currency : '€';
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(239,68,68,0.15)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.3)' }}>
                          <span style={{ fontSize: '11px', color: '#ef4444' }}>
                            {name} {price > 0 && `• ${price} ${currency}`}
                          </span>
                          <button onClick={() => setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, russia: appSettings.visaDurations.russia.filter((_, i) => i !== idx) } })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <input 
                      type="text" 
                      value={newDuration.category === 'russia' ? newDuration.value : ''} 
                      onChange={e => setNewDuration({ ...newDuration, category: 'russia', value: e.target.value })} 
                      placeholder="Vize türü" 
                      style={{ flex: '1 1 120px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} 
                    />
                    <input 
                      type="number" 
                      value={newDuration.category === 'russia' ? (newDuration.price || '') : ''} 
                      onChange={e => setNewDuration({ ...newDuration, category: 'russia', price: Number(e.target.value) })} 
                      placeholder="Fiyat" 
                      style={{ width: '70px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} 
                    />
                    <select 
                      value={newDuration.category === 'russia' ? (newDuration.currency || '€') : '€'} 
                      onChange={e => setNewDuration({ ...newDuration, category: 'russia', currency: e.target.value })}
                      style={{ width: '50px', padding: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }}
                    >
                      <option value="€">€</option>
                      <option value="$">$</option>
                      <option value="£">£</option>
                      <option value="₺">₺</option>
                    </select>
                    <button 
                      onClick={() => { 
                        if (newDuration.value && newDuration.value.trim()) { 
                          const newItem = { name: newDuration.value.trim(), price: newDuration.price || 0, currency: newDuration.currency || '€' };
                          setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, russia: [...(appSettings.visaDurations?.russia || []), newItem] } }); 
                          setNewDuration({ category: '', value: '', price: 0, currency: '€' }); 
                        } 
                      }} 
                      style={{ padding: '6px 10px', background: 'linear-gradient(135deg, #ef4444, #dc2626)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}
                    >
                      ➕
                    </button>
                  </div>
                </div>
              </details>

              <details style={{ background: 'rgba(245,158,11,0.05)', borderRadius: '10px', border: '1px solid rgba(245,158,11,0.2)', padding: '12px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: '600', color: '#f59e0b', fontSize: '14px', listStyle: 'none' }}>
                  <span style={{ marginRight: '8px' }}>🇦🇪</span>
                  BAE (Dubai) ({(appSettings?.visaDurations?.uae || []).length} tür)
                </summary>
                <div style={{ paddingLeft: '26px', marginTop: '10px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                    {(appSettings?.visaDurations?.uae || []).map((d, idx) => {
                      const name = typeof d === 'string' ? d : d.name;
                      const price = typeof d === 'object' ? d.price : 0;
                      const currency = typeof d === 'object' ? d.currency : '$';
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(245,158,11,0.15)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.3)' }}>
                          <span style={{ fontSize: '11px', color: '#f59e0b' }}>
                            {name} {price > 0 && `• ${price} ${currency}`}
                          </span>
                          <button onClick={() => setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, uae: appSettings.visaDurations.uae.filter((_, i) => i !== idx) } })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <input type="text" value={newDuration.category === 'uae' ? newDuration.value : ''} onChange={e => setNewDuration({ ...newDuration, category: 'uae', value: e.target.value })} placeholder="Vize türü" style={{ flex: '1 1 120px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} />
                    <input type="number" value={newDuration.category === 'uae' ? (newDuration.price || '') : ''} onChange={e => setNewDuration({ ...newDuration, category: 'uae', price: Number(e.target.value) })} placeholder="Fiyat" style={{ width: '70px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} />
                    <select value={newDuration.category === 'uae' ? (newDuration.currency || '$') : '$'} onChange={e => setNewDuration({ ...newDuration, category: 'uae', currency: e.target.value })} style={{ width: '50px', padding: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }}>
                      <option value="€">€</option>
                      <option value="$">$</option>
                      <option value="£">£</option>
                      <option value="₺">₺</option>
                    </select>
                    <button onClick={() => { if (newDuration.value && newDuration.value.trim()) { const newItem = { name: newDuration.value.trim(), price: newDuration.price || 0, currency: newDuration.currency || '$' }; setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, uae: [...(appSettings.visaDurations?.uae || []), newItem] } }); setNewDuration({ category: '', value: '', price: 0, currency: '€' }); } }} style={{ padding: '6px 10px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>➕</button>
                  </div>
                </div>
              </details>

              <details style={{ background: 'rgba(59,130,246,0.05)', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.2)', padding: '12px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: '600', color: '#3b82f6', fontSize: '14px', listStyle: 'none' }}>
                  <span style={{ marginRight: '8px' }}>🇺🇸</span>
                  Amerika ({(appSettings?.visaDurations?.usa || []).length} tür)
                </summary>
                <div style={{ paddingLeft: '26px', marginTop: '10px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                    {(appSettings?.visaDurations?.usa || []).map((d, idx) => {
                      const name = typeof d === 'string' ? d : d.name;
                      const price = typeof d === 'object' ? d.price : 0;
                      const currency = typeof d === 'object' ? d.currency : '$';
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(59,130,246,0.15)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(59,130,246,0.3)' }}>
                          <span style={{ fontSize: '11px', color: '#3b82f6' }}>
                            {name} {price > 0 && `• ${price} ${currency}`}
                          </span>
                          <button onClick={() => setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, usa: appSettings.visaDurations.usa.filter((_, i) => i !== idx) } })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <input type="text" value={newDuration.category === 'usa' ? newDuration.value : ''} onChange={e => setNewDuration({ ...newDuration, category: 'usa', value: e.target.value })} placeholder="Vize türü" style={{ flex: '1 1 120px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} />
                    <input type="number" value={newDuration.category === 'usa' ? (newDuration.price || '') : ''} onChange={e => setNewDuration({ ...newDuration, category: 'usa', price: Number(e.target.value) })} placeholder="Fiyat" style={{ width: '70px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} />
                    <select value={newDuration.category === 'usa' ? (newDuration.currency || '$') : '$'} onChange={e => setNewDuration({ ...newDuration, category: 'usa', currency: e.target.value })} style={{ width: '50px', padding: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }}>
                      <option value="€">€</option>
                      <option value="$">$</option>
                      <option value="£">£</option>
                      <option value="₺">₺</option>
                    </select>
                    <button onClick={() => { if (newDuration.value && newDuration.value.trim()) { const newItem = { name: newDuration.value.trim(), price: newDuration.price || 0, currency: newDuration.currency || '$' }; setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, usa: [...(appSettings.visaDurations?.usa || []), newItem] } }); setNewDuration({ category: '', value: '', price: 0, currency: '€' }); } }} style={{ padding: '6px 10px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>➕</button>
                  </div>
                </div>
              </details>

              <details style={{ background: 'rgba(139,92,246,0.05)', borderRadius: '10px', border: '1px solid rgba(139,92,246,0.2)', padding: '12px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: '600', color: '#8b5cf6', fontSize: '14px', listStyle: 'none' }}>
                  <span style={{ marginRight: '8px' }}>🇬🇧</span>
                  İngiltere ({(appSettings?.visaDurations?.uk || []).length} tür)
                </summary>
                <div style={{ paddingLeft: '26px', marginTop: '10px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                    {(appSettings?.visaDurations?.uk || []).map((d, idx) => {
                      const name = typeof d === 'string' ? d : d.name;
                      const price = typeof d === 'object' ? d.price : 0;
                      const currency = typeof d === 'object' ? d.currency : '£';
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(139,92,246,0.15)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(139,92,246,0.3)' }}>
                          <span style={{ fontSize: '11px', color: '#8b5cf6' }}>
                            {name} {price > 0 && `• ${price} ${currency}`}
                          </span>
                          <button onClick={() => setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, uk: appSettings.visaDurations.uk.filter((_, i) => i !== idx) } })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <input type="text" value={newDuration.category === 'uk' ? newDuration.value : ''} onChange={e => setNewDuration({ ...newDuration, category: 'uk', value: e.target.value })} placeholder="Vize türü" style={{ flex: '1 1 120px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} />
                    <input type="number" value={newDuration.category === 'uk' ? (newDuration.price || '') : ''} onChange={e => setNewDuration({ ...newDuration, category: 'uk', price: Number(e.target.value) })} placeholder="Fiyat" style={{ width: '70px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} />
                    <select value={newDuration.category === 'uk' ? (newDuration.currency || '£') : '£'} onChange={e => setNewDuration({ ...newDuration, category: 'uk', currency: e.target.value })} style={{ width: '50px', padding: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }}>
                      <option value="€">€</option>
                      <option value="$">$</option>
                      <option value="£">£</option>
                      <option value="₺">₺</option>
                    </select>
                    <button onClick={() => { if (newDuration.value && newDuration.value.trim()) { const newItem = { name: newDuration.value.trim(), price: newDuration.price || 0, currency: newDuration.currency || '£' }; setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, uk: [...(appSettings.visaDurations?.uk || []), newItem] } }); setNewDuration({ category: '', value: '', price: 0, currency: '€' }); } }} style={{ padding: '6px 10px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>➕</button>
                  </div>
                </div>
              </details>

              <details style={{ background: 'rgba(239,68,68,0.05)', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)', padding: '12px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: '600', color: '#ef4444', fontSize: '14px', listStyle: 'none' }}>
                  <span style={{ marginRight: '8px' }}>🇨🇳</span>
                  Çin ({(appSettings?.visaDurations?.china || []).length} tür)
                </summary>
                <div style={{ paddingLeft: '26px', marginTop: '10px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                    {(appSettings?.visaDurations?.china || []).map((d, idx) => {
                      const name = typeof d === 'string' ? d : d.name;
                      const price = typeof d === 'object' ? d.price : 0;
                      const currency = typeof d === 'object' ? d.currency : '€';
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(239,68,68,0.15)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.3)' }}>
                          <span style={{ fontSize: '11px', color: '#ef4444' }}>
                            {name} {price > 0 && `• ${price} ${currency}`}
                          </span>
                          <button onClick={() => setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, china: appSettings.visaDurations.china.filter((_, i) => i !== idx) } })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <input type="text" value={newDuration.category === 'china' ? newDuration.value : ''} onChange={e => setNewDuration({ ...newDuration, category: 'china', value: e.target.value })} placeholder="Vize türü" style={{ flex: '1 1 120px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} />
                    <input type="number" value={newDuration.category === 'china' ? (newDuration.price || '') : ''} onChange={e => setNewDuration({ ...newDuration, category: 'china', price: Number(e.target.value) })} placeholder="Fiyat" style={{ width: '70px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} />
                    <select value={newDuration.category === 'china' ? (newDuration.currency || '€') : '€'} onChange={e => setNewDuration({ ...newDuration, category: 'china', currency: e.target.value })} style={{ width: '50px', padding: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }}>
                      <option value="€">€</option>
                      <option value="$">$</option>
                      <option value="£">£</option>
                      <option value="₺">₺</option>
                    </select>
                    <button onClick={() => { if (newDuration.value && newDuration.value.trim()) { const newItem = { name: newDuration.value.trim(), price: newDuration.price || 0, currency: newDuration.currency || '€' }; setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, china: [...(appSettings.visaDurations?.china || []), newItem] } }); setNewDuration({ category: '', value: '', price: 0, currency: '€' }); } }} style={{ padding: '6px 10px', background: 'linear-gradient(135deg, #ef4444, #dc2626)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>➕</button>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* 📊 DURUM YÖNETİMİ */}
      {activeTab === 'statusManagement' && isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Kişisel Alan Bilgileri */}
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#8b5cf6' }}>📝 Kişisel Alan Bilgileri</h3>
            <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>
              Müşteri formunda toplanan kişisel bilgi alanları
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {(appSettings?.personalDetailsFields || []).map((field, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(139,92,246,0.15)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(139,92,246,0.3)' }}>
                  <span style={{ fontSize: '12px', color: '#8b5cf6' }}>{field}</span>
                  <button onClick={() => setAppSettings({ ...appSettings, personalDetailsFields: appSettings.personalDetailsFields.filter((_, i) => i !== idx) })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                value={newPersonalField} 
                onChange={e => setNewPersonalField(e.target.value)} 
                placeholder="Yeni alan (örn: Meslek)" 
                style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '12px' }} 
                onKeyPress={e => { 
                  if (e.key === 'Enter' && newPersonalField.trim()) { 
                    setAppSettings({ ...appSettings, personalDetailsFields: [...(appSettings.personalDetailsFields || []), newPersonalField.trim()] }); 
                    setNewPersonalField(''); 
                  } 
                }} 
              />
              <button 
                onClick={() => { 
                  if (newPersonalField.trim()) { 
                    setAppSettings({ ...appSettings, personalDetailsFields: [...(appSettings.personalDetailsFields || []), newPersonalField.trim()] }); 
                    setNewPersonalField(''); 
                  } 
                }} 
                style={{ padding: '8px 12px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '12px' }}
              >
                ➕
              </button>
            </div>
          </div>

          {/* Vize Başvuru Durumları */}
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#10b981' }}>📋 Vize Başvuru Durumları</h3>
            <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>
              Vize başvuru sürecinde kullanılan durum etiketleri
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {(appSettings?.visaStatuses || []).map((status, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16,185,129,0.15)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.3)' }}>
                  <span style={{ fontSize: '12px', color: '#10b981' }}>{status}</span>
                  <button onClick={() => setAppSettings({ ...appSettings, visaStatuses: appSettings.visaStatuses.filter((_, i) => i !== idx) })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                value={newVisaStatus} 
                onChange={e => setNewVisaStatus(e.target.value)} 
                placeholder="Yeni durum (örn: Belgeler Eksik)" 
                style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '12px' }} 
                onKeyPress={e => { 
                  if (e.key === 'Enter' && newVisaStatus.trim()) { 
                    setAppSettings({ ...appSettings, visaStatuses: [...(appSettings.visaStatuses || []), newVisaStatus.trim()] }); 
                    setNewVisaStatus(''); 
                  } 
                }} 
              />
              <button 
                onClick={() => { 
                  if (newVisaStatus.trim()) { 
                    setAppSettings({ ...appSettings, visaStatuses: [...(appSettings.visaStatuses || []), newVisaStatus.trim()] }); 
                    setNewVisaStatus(''); 
                  } 
                }} 
                style={{ padding: '8px 12px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '12px' }}
              >
                ➕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PROFİLİM */}
      {activeTab === 'profile' && (
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '24px' }}>
              {currentUser?.name?.[0] || 'U'}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px' }}>{currentUser?.name}</h3>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>{currentUser?.email}</p>
              <span style={{ display: 'inline-block', marginTop: '8px', fontSize: '11px', padding: '4px 12px', borderRadius: '20px', background: currentUser?.role === 'admin' ? 'rgba(139,92,246,0.2)' : 'rgba(59,130,246,0.2)', color: currentUser?.role === 'admin' ? '#8b5cf6' : '#3b82f6' }}>
                {currentUser?.role === 'admin' ? '👑 Yönetici' : '👤 Kullanıcı'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '14px', borderRadius: '10px' }}>
              <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>Ad Soyad</p>
              <p style={{ margin: '4px 0 0', fontSize: '15px' }}>{currentUser?.name}</p>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '14px', borderRadius: '10px' }}>
              <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>E-posta</p>
              <p style={{ margin: '4px 0 0', fontSize: '15px' }}>{currentUser?.email}</p>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '14px', borderRadius: '10px' }}>
              <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>Rol</p>
              <p style={{ margin: '4px 0 0', fontSize: '15px' }}>{currentUser?.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}</p>
            </div>
          </div>

          <button onClick={() => openEditUser(currentUser)} style={{ width: '100%', marginTop: '20px', padding: '14px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>
            ✏️ Profili Düzenle
          </button>
        </div>
      )}

      {/* ŞİFRE DEĞİŞTİR */}
      {activeTab === 'password' && (
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>🔐</div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px' }}>Şifre Değiştir</h3>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>Hesap güvenliğiniz için şifrenizi düzenli değiştirin</p>
            </div>
          </div>

          {passwordError && (
            <div style={{ background: 'rgba(239,68,68,0.15)', padding: '12px', borderRadius: '10px', marginBottom: '16px', border: '1px solid rgba(239,68,68,0.3)' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#ef4444' }}>❌ {passwordError}</p>
            </div>
          )}

          {passwordSuccess && (
            <div style={{ background: 'rgba(16,185,129,0.15)', padding: '12px', borderRadius: '10px', marginBottom: '16px', border: '1px solid rgba(16,185,129,0.3)' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#10b981' }}>✅ {passwordSuccess}</p>
            </div>
          )}

          <form onSubmit={handlePasswordChange}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Mevcut Şifre *</label>
                <input type="password" value={passwordData.current} onChange={e => setPasswordData({...passwordData, current: e.target.value})} placeholder="••••••••" style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }} required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Yeni Şifre *</label>
                <input type="password" value={passwordData.new} onChange={e => setPasswordData({...passwordData, new: e.target.value})} placeholder="••••••••" style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }} required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Yeni Şifre Tekrar *</label>
                <input type="password" value={passwordData.confirm} onChange={e => setPasswordData({...passwordData, confirm: e.target.value})} placeholder="••••••••" style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }} required />
              </div>
              <button type="submit" style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', color: '#0c1929', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                🔐 Şifreyi Değiştir
              </button>
            </div>
          </form>
        </div>
      )}

      {/* KULLANICILAR (Sadece Admin) */}
      {activeTab === 'users' && isAdmin && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <p style={{ margin: 0, fontSize: '14px', color: '#94a3b8' }}>Toplam {users.length} kullanıcı</p>
            <button onClick={openNewUserForm} style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
              ➕ Yeni Kullanıcı
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {users.map(user => (
              <div key={user.id} style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: user.id === currentUser.id ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: user.role === 'admin' ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)' : 'linear-gradient(135deg, #3b82f6, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '16px' }}>
                      {user.name?.[0] || 'U'}
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px' }}>
                        {user.name}
                        {user.id === currentUser.id && <span style={{ marginLeft: '8px', fontSize: '10px', color: '#f59e0b' }}>(Sen)</span>}
                      </h4>
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>{user.email}</p>
                    </div>
                  </div>
                  <span style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '20px', background: user.role === 'admin' ? 'rgba(139,92,246,0.2)' : 'rgba(59,130,246,0.2)', color: user.role === 'admin' ? '#8b5cf6' : '#3b82f6' }}>
                    {user.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button onClick={() => openEditUser(user)} style={{ flex: 1, padding: '8px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px' }}>✏️ Düzenle</button>
                  {user.id !== currentUser.id && (
                    <button onClick={() => deleteUser(user.id)} style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🗑️ Sil</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KULLANICI FORM MODAL */}
      {showUserForm && (
        <div onClick={() => setShowUserForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '100%', maxHeight: '80vh', overflow: 'auto' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '18px' }}>{editingUser ? '✏️ Kullanıcı Düzenle' : '➕ Yeni Kullanıcı'}</h3>
            
            <form onSubmit={handleUserSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Ad Soyad *</label>
                  <input type="text" value={userFormData.name || ''} onChange={e => setUserFormData({...userFormData, name: e.target.value})} placeholder="Ad Soyad" style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }} required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>E-posta *</label>
                  <input type="email" value={userFormData.email || ''} onChange={e => setUserFormData({...userFormData, email: e.target.value})} placeholder="email@ornek.com" style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }} required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>{editingUser ? 'Yeni Şifre (boş bırakılırsa değişmez)' : 'Şifre *'}</label>
                  <input type="password" value={userFormData.password || ''} onChange={e => setUserFormData({...userFormData, password: e.target.value})} placeholder="••••••••" style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }} {...(!editingUser && { required: true })} />
                </div>
                {isAdmin && editingUser?.id !== currentUser.id && (
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Rol</label>
                    <select value={userFormData.role || 'user'} onChange={e => setUserFormData({...userFormData, role: e.target.value})} style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px' }}>
                      <option value="user">Kullanıcı</option>
                      <option value="admin">Yönetici</option>
                    </select>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button type="button" onClick={() => setShowUserForm(false)} style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '10px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px' }}>İptal</button>
                  <button type="submit" style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>
                    {editingUser ? '💾 Kaydet' : '➕ Ekle'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeModule, setActiveModule] = useState('dashboard');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [customers, setCustomers] = useState(defaultCustomers);
  const [visaApplications, setVisaApplications] = useState([]);
  const [tours, setTours] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [creditCards, setCreditCards] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [users, setUsers] = useState(defaultUsers);
  const [isLoading, setIsLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [appSettings, setAppSettings] = useState({
    processors: ['Paydos', 'İdata', 'Oğuz'],
    whatsappTemplate: 'Sayın {isim},\n\n{ulke} vize randevunuz {tarih} tarihinde saat {saat} için alınmıştır.\n\nPNR: {pnr}\n\nLütfen randevu tarihinden 7 gün önce evraklarınızı hazırlayıp bize teslim etmeniz gerekmektedir.\n\nPaydos Turizm',
    visaPrices: {
      schengen: { cost: 0, price: 0, currency: '€' },
      usa: { cost: 0, price: 0, currency: '$' },
      russia: { cost: 0, price: 0, currency: '€' },
      uk: { 
        '6 Ay Standart': { cost: 0, price: 0, currency: '£' },
        '2 Yıl Standart': { cost: 0, price: 0, currency: '£' },
        '5 Yıl Standart': { cost: 0, price: 0, currency: '£' },
        '10 Yıl Standart': { cost: 0, price: 0, currency: '£' }
      },
      uae: { cost: 0, price: 0, currency: '$' },
      other: { cost: 0, price: 0, currency: '€' }
    },
    visaDurations: {
      schengen: [
        {name: 'Turistik Vize', price: 0, currency: '€'},
        {name: 'Ticari Vize', price: 0, currency: '€'},
        {name: 'Aile/Arkadaş Ziyareti', price: 0, currency: '€'}
      ],
      usa: [
        {name: 'B1/B2 Turistik ve Ticari', price: 0, currency: '$'}
      ],
      russia: [
        {name: 'E-Vize Tek Girişli', price: 0, currency: '€'}
      ],
      uk: [
        {name: '6 Ay Standart', price: 0, currency: '£'},
        {name: '2 Yıl Standart', price: 0, currency: '£'},
        {name: '5 Yıl Standart', price: 0, currency: '£'},
        {name: '10 Yıl Standart', price: 0, currency: '£'}
      ],
      uae: [
        {name: '14 Günlük Vize', price: 0, currency: '$'},
        {name: '30 Günlük Tek Giriş', price: 0, currency: '$'},
        {name: '30 Günlük Çok Girişli', price: 0, currency: '$'},
        {name: '60 Günlük Tek Giriş', price: 0, currency: '$'},
        {name: '60 Günlük Çok Girişli', price: 0, currency: '$'},
        {name: '96 Saat (Transit) Vize', price: 0, currency: '$'},
        {name: '30 Günlük GCC Vatandaşları', price: 0, currency: '$'}
      ],
      china: [
        {name: 'Turistik Vize', price: 0, currency: '€'},
        {name: 'Ticari Vize', price: 0, currency: '€'},
        {name: 'Transit Vize', price: 0, currency: '€'}
      ]
    },
    personalDetailsFields: ['Doğum Tarihi', 'Doğum Yeri', 'İkametgah İli', 'TK Üyelik No'],
    visaStatuses: ['Evrak Topluyor', 'Evrak Tamamlandı', 'Randevu Alındı', 'Başvuru Yapıldı', 'Sonuç Bekliyor', 'Onaylandı', 'Reddedildi'],
    bankInfo: {
      bankName: 'Ziraat Bankası',
      accountName: 'PAYDOS TURİZM',
      iban: 'TR00 0000 0000 0000 0000 0000 00',
      swift: 'TCZBTR2AXXX'
    }
  });

  // Toast fonksiyonları
  const showToast = useCallback((message, type = 'info', undo = null) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type, undo }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), undo ? 8000 : 4000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Undo fonksiyonu
  const addToUndo = useCallback((action) => {
    setUndoStack(prev => [...prev.slice(-9), action]);
  }, []);

  const performUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const lastAction = undoStack[undoStack.length - 1];
    if (lastAction) {
      lastAction.undo();
      setUndoStack(prev => prev.slice(0, -1));
      showToast('İşlem geri alındı', 'success');
    }
  }, [undoStack, showToast]);

  // Klavye kısayolları
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl/Cmd + Z = Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
      }
      // Ctrl/Cmd + 1-7 = Modül değiştir
      if ((e.ctrlKey || e.metaKey) && ['1', '2', '3', '4', '5', '6', '7'].includes(e.key)) {
        e.preventDefault();
        const modules = ['dashboard', 'customers', 'visa', 'quotes', 'agencies', 'cards', 'settings'];
        setActiveModule(modules[parseInt(e.key) - 1]);
        showToast(`${['Dashboard', 'Müşteriler', 'Vize', 'Teklif & Proforma', 'Acentelikler', 'Kredi Kartları', 'Ayarlar'][parseInt(e.key) - 1]} açıldı`, 'info');
      }
      // Escape = Sidebar kapat
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [performUndo, sidebarOpen, showToast]);

  useEffect(() => { const handleResize = () => setIsMobile(window.innerWidth < 768); window.addEventListener('resize', handleResize); return () => window.removeEventListener('resize', handleResize); }, []);
  useEffect(() => { const loggedIn = localStorage.getItem('paydos_logged_in'); const savedUser = localStorage.getItem('paydos_current_user'); if (loggedIn === 'true' && savedUser) { try { setCurrentUser(JSON.parse(savedUser)); setIsLoggedIn(true); } catch (e) { console.error(e); } } }, []);
  
  // localStorage'dan yükle - EN ÖNCE
  useEffect(() => { const saved = localStorage.getItem('paydos_customers'); if (saved) { try { setCustomers(JSON.parse(saved)); } catch (e) { console.error(e); } } }, []);
  useEffect(() => { const saved = localStorage.getItem('paydos_visa_applications'); if (saved) { try { setVisaApplications(JSON.parse(saved)); } catch (e) { console.error(e); } } }, []);
  useEffect(() => { 
    const saved = localStorage.getItem('paydos_app_settings'); 
    if (saved) { 
      try { 
        const settings = JSON.parse(saved);
        
        // MIGRATION: String array → Object array
        if (settings.visaDurations) {
          Object.keys(settings.visaDurations).forEach(country => {
            const durations = settings.visaDurations[country];
            if (durations && durations.length > 0 && typeof durations[0] === 'string') {
              // Eski format: string array
              settings.visaDurations[country] = durations.map(name => ({
                name: name,
                price: 0,
                currency: country === 'usa' ? '$' : country === 'uk' ? '£' : '€'
              }));
              console.log(`✅ Migrated ${country}: ${durations.length} items`);
            }
          });
        }
        
        setAppSettings(settings);
      } catch (e) { 
        console.error(e); 
      } 
    } 
  }, []);
  useEffect(() => { const saved = localStorage.getItem('paydos_agencies'); if (saved) { try { setAgencies(JSON.parse(saved)); } catch (e) { console.error(e); } } }, []);
  useEffect(() => { const saved = localStorage.getItem('paydos_credit_cards'); if (saved) { try { setCreditCards(JSON.parse(saved)); } catch (e) { console.error(e); } } }, []);
  useEffect(() => { const saved = localStorage.getItem('paydos_quotes'); if (saved) { try { setQuotes(JSON.parse(saved)); } catch (e) { console.error(e); } } }, []);
  
  // Firebase/localStorage veri yükleme tamamlandı
  
  // localStorage'a kaydet - değiştiğinde
  useEffect(() => { localStorage.setItem('paydos_customers', JSON.stringify(customers)); }, [customers]);
  useEffect(() => { localStorage.setItem('paydos_visa_applications', JSON.stringify(visaApplications)); }, [visaApplications]);
  useEffect(() => { localStorage.setItem('paydos_app_settings', JSON.stringify(appSettings)); }, [appSettings]);
  useEffect(() => { localStorage.setItem('paydos_agencies', JSON.stringify(agencies)); }, [agencies]);
  useEffect(() => { localStorage.setItem('paydos_credit_cards', JSON.stringify(creditCards)); }, [creditCards]);
  useEffect(() => { localStorage.setItem('paydos_quotes', JSON.stringify(quotes)); }, [quotes]);




  const handleLogin = (user) => { setIsLoggedIn(true); setCurrentUser(user); localStorage.setItem('paydos_logged_in', 'true'); localStorage.setItem('paydos_current_user', JSON.stringify(user)); };
  const handleLogout = () => { setIsLoggedIn(false); setCurrentUser(null); localStorage.removeItem('paydos_logged_in'); localStorage.removeItem('paydos_current_user'); };

  if (!isLoggedIn) return <LoginScreen onLogin={handleLogin} users={users} />;
  if (isLoading) return (<div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0c1929 0%, #1a3a5c 50%, #0d2137 100%)' }}><div style={{ textAlign: 'center' }}><div style={{ fontSize: '48px', marginBottom: '16px' }}>✈️</div><p style={{ color: '#94a3b8' }}>Yükleniyor...</p></div></div>);

  const menuItems = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' }, 
    { id: 'customers', icon: '👥', label: 'Müşteriler' },
    { id: 'visa', icon: '🌍', label: 'Vize' },
    { id: 'tours', icon: '🎫', label: 'Turlar' },
    { id: 'quotes', icon: '📄', label: 'Teklif & Proforma' },
    { id: 'agencies', icon: '🏢', label: 'Acentelikler' },
    { id: 'cards', icon: '💳', label: 'Kredi Kartları' },
    { id: 'settings', icon: '⚙️', label: 'Ayarlar' }
  ];

  const renderModule = () => {
    switch (activeModule) {
      case 'dashboard': return <DashboardModule customers={customers} isMobile={isMobile} />;
      case 'customers': return <CustomerModule customers={customers} setCustomers={setCustomers} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} appSettings={appSettings} />;
      case 'visa': return <VisaModule customers={customers} visaApplications={visaApplications} setVisaApplications={setVisaApplications} isMobile={isMobile} onNavigateToCustomers={() => setActiveModule('customers')} appSettings={appSettings} showToast={showToast} addToUndo={addToUndo} />;
      case 'tours': return <ToursModule tours={tours} setTours={setTours} customers={customers} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} />;
      case 'quotes': return <QuotesModule quotes={quotes} setQuotes={setQuotes} customers={customers} isMobile={isMobile} showToast={showToast} />;
      case 'agencies': return <AgenciesModule agencies={agencies} setAgencies={setAgencies} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} />;
      case 'cards': return <CreditCardsModule creditCards={creditCards} setCreditCards={setCreditCards} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} />;
      case 'settings': return <SettingsModule users={users} setUsers={setUsers} currentUser={currentUser} setCurrentUser={setCurrentUser} isMobile={isMobile} appSettings={appSettings} setAppSettings={setAppSettings} showToast={showToast} />;
      default: return <DashboardModule customers={customers} isMobile={isMobile} />;
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0c1929 0%, #1a3a5c 50%, #0d2137 100%)', color: '#e8f1f8', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {/* Toast Bildirimleri */}
      <Toast toasts={toasts} removeToast={removeToast} />
      
      {/* Klavye Kısayolları Bilgisi */}
      {!isMobile && (
        <div style={{ position: 'fixed', bottom: '20px', left: '280px', fontSize: '10px', color: '#64748b', zIndex: 50 }}>
          ⌨️ Ctrl+1-7: Modül | Ctrl+Z: Geri Al
        </div>
      )}
      
      {isMobile && sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100 }} />}
      <aside style={{ position: 'fixed', left: isMobile ? (sidebarOpen ? 0 : '-280px') : 0, top: 0, bottom: 0, width: '260px', background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(10px)', borderRight: '1px solid rgba(255,255,255,0.1)', zIndex: 200, transition: 'left 0.3s ease', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}><div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><span style={{ fontSize: '32px' }}>✈️</span><div><h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>Paydos</h1><p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Turizm CRM</p></div></div></div>
        <nav style={{ flex: 1, padding: '16px 12px' }}>{menuItems.map((item, idx) => (<button key={item.id} onClick={() => { setActiveModule(item.id); if (isMobile) setSidebarOpen(false); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', marginBottom: '4px', background: activeModule === item.id ? 'rgba(245,158,11,0.15)' : 'transparent', border: activeModule === item.id ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent', borderRadius: '10px', color: activeModule === item.id ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '14px', fontWeight: activeModule === item.id ? '600' : '400' }}><span style={{ fontSize: '18px' }}>{item.icon}</span>{item.label}{!isMobile && <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#64748b' }}>⌘{idx+1}</span>}</button>))}</nav>
        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}><div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}><div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '14px' }}>{currentUser?.name?.[0] || 'U'}</div><div><p style={{ margin: 0, fontSize: '13px', fontWeight: '600' }}>{currentUser?.name}</p><p style={{ margin: 0, fontSize: '10px', color: '#64748b' }}>{currentUser?.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}</p></div></div><button onClick={handleLogout} style={{ width: '100%', padding: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🚪 Çıkış Yap</button></div>
      </aside>
      <main style={{ marginLeft: isMobile ? 0 : '260px', minHeight: '100vh' }}>
        {isMobile && <header style={{ position: 'sticky', top: 0, background: 'rgba(12,25,41,0.95)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 50 }}><button onClick={() => setSidebarOpen(true)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#e8f1f8', cursor: 'pointer', fontSize: '18px' }}>☰</button><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '24px' }}>✈️</span><span style={{ fontWeight: '700' }}>Paydos</span></div><div style={{ width: '40px' }} /></header>}
        {renderModule()}
      </main>
    </div>
  );
}
