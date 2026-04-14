import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
// Firebase + localStorage CRM
import jsPDF from 'jspdf';
import { db } from './lib/firebase';
import { collection, doc, setDoc, getDoc, getDocs, writeBatch, deleteDoc, onSnapshot, query, orderBy, limit, where, Timestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.slice(0, 9);
};

// Pasaport No'dan türü otomatik tespit
const detectPassportType = (passportNo) => {
  if (!passportNo) return null;
  const first = passportNo.toUpperCase()[0];
  if (first === 'U') return 'Bordo Pasaport (Umuma Mahsus)';
  if (first === 'S') return 'Yeşil Pasaport (Hususi)';
  if (first === 'Z') return 'Gri Pasaport (Hizmet)';
  if (first === 'D') return 'Siyah Pasaport (Diplomatik)';
  return null;
};

const countryCodeMap = { TUR:'Türkiye',DEU:'Almanya',FRA:'Fransa',GBR:'İngiltere',USA:'Amerika Birleşik Devletleri',NLD:'Hollanda',BEL:'Belçika',AUT:'Avusturya',CHE:'İsviçre',ITA:'İtalya',ESP:'İspanya',PRT:'Portekiz',GRC:'Yunanistan',SWE:'İsveç',NOR:'Norveç',DNK:'Danimarka',FIN:'Finlandiya',POL:'Polonya',CZE:'Çekya',HUN:'Macaristan',ROU:'Romanya',BGR:'Bulgaristan',HRV:'Hırvatistan',RUS:'Rusya',UKR:'Ukrayna',AZE:'Azerbaycan',KAZ:'Kazakistan',SAU:'Suudi Arabistan',ARE:'Birleşik Arap Emirlikleri',IRN:'İran',IRQ:'Irak',SYR:'Suriye',JOR:'Ürdün',LBN:'Lübnan',EGY:'Mısır',MAR:'Fas',TUN:'Tunus',ALB:'Arnavutluk',MKD:'Kuzey Makedonya',SRB:'Sırbistan',BIH:'Bosna Hersek',MNE:'Karadağ',GEO:'Gürcistan',ARM:'Ermenistan',CHN:'Çin',JPN:'Japonya',KOR:'Güney Kore',IND:'Hindistan',PAK:'Pakistan',BGD:'Bangladeş',IDN:'Endonezya',MYS:'Malezya',THA:'Tayland',VNM:'Vietnam',PHL:'Filipinler',BRA:'Brezilya',ARG:'Arjantin',MEX:'Meksika',CAN:'Kanada',AUS:'Avustralya',NZL:'Yeni Zelanda',ZAF:'Güney Afrika',NGA:'Nijerya',ETH:'Etiyopya',KEN:'Kenya' };
const isoToCountry = (code) => code ? (countryCodeMap[code.toUpperCase()] || code) : '';

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
function StatCard({ value, label, color, onClick, sublabel }) { return (<div onClick={onClick} style={{ background: `${color}15`, border: `1px solid ${color}30`, borderRadius: '12px', padding: '16px', cursor: onClick ? 'pointer' : 'default', minHeight: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}><div style={{ fontSize: '28px', fontWeight: '700', color }}>{value}</div><div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>{label}</div>{sublabel && <div style={{ fontSize: '10px', color, marginTop: '4px' }}>{sublabel}</div>}</div>); }
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

function DashboardModule({ customers, isMobile, onNavigate }) {
  const [showBirthdays, setShowBirthdays] = useState(false);
  const [modal, setModal] = useState(null); // {title, color, list, renderItem}
  // Schengen vizesi olanlar
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
        <StatCard value={customers.length} label="Toplam Müşteri" color="#3b82f6"
          sublabel="→ Tüm müşteriler"
          onClick={() => setModal({ title: '👥 Tüm Müşteriler', color: '#3b82f6', list: customers,
            renderItem: c => `${c.firstName} ${c.lastName}` })} />
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
                      <div style={{ fontWeight: '600', fontSize: '14px' }}>🎂 {c.firstName} {c.lastName}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.phone || '—'} · {getAge(c.birthDate)} yaşında</div>
                    </div>
                    {c.phone && (
                      <a href={`https://wa.me/90${c.phone?.replace(/\D/g,'').replace(/^(90|0)/,'')}`} target="_blank" rel="noreferrer" style={{ background: 'rgba(37,211,102,0.2)', border: 'none', borderRadius: '8px', color: '#25d366', padding: '6px 10px', fontSize: '12px', textDecoration: 'none', cursor: 'pointer' }}>💬 Kutla</a>
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

function CustomerModule({ customers, setCustomers, isMobile, appSettings, showToast, addToUndo, openCustomerId, onOpenCustomerHandled, onBack }) {
  const [activeTab, setActiveTab] = useState('search');
  const [showForm, setShowForm] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiImages, setAiImages] = useState([]); // [{type, base64, preview, mediaType}]
  const [cropModal, setCropModal] = useState(null); // {type, src, rotation}
  const cropCanvasRef = useRef(null);
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const cropDragRef = useRef(null);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [formData, setFormData] = useState({});
  const [detailTab, setDetailTab] = useState('info');
  const [imagePreview, setImagePreview] = useState({ show: false, src: '', title: '' });
  const [showResults, setShowResults] = useState(false);
  const fileInputRef = useRef(null);

  // Dashboard'dan müşteri profili aç
  useEffect(() => {
    if (openCustomerId) {
      const customer = customers.find(c => c.id === openCustomerId);
      if (customer) {
        setSelectedCustomer(customer);
        setDetailTab('info');
      }
      onOpenCustomerHandled?.();
    }
  }, [openCustomerId]);

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

  // Görseli 300KB altına sıkıştır
  const compressImage = (dataUrl, maxKB = 300) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let quality = 0.92;
        let scale = 1;
        const attempt = (q, s) => {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * s);
          canvas.height = Math.round(img.height * s);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const result = canvas.toDataURL('image/jpeg', q);
          const kb = Math.round((result.length * 3) / 4 / 1024);
          if (kb <= maxKB || q <= 0.3) { resolve(result); return; }
          // Önce quality düşür, sonra boyutu küçült
          if (q > 0.4) attempt(q - 0.15, s);
          else attempt(0.4, s - 0.15);
        };
        attempt(quality, scale);
      };
      img.src = dataUrl;
    });
  };

  const handleImageUpload = (callback) => async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert('Dosya boyutu 10MB\'dan büyük olamaz'); return; }
    try {
      // Önce base64'e çevir
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onloadend = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      // 300KB'ı geçiyorsa sıkıştır
      const kb = Math.round(file.size / 1024);
      const compressed = kb > 300 ? await compressImage(dataUrl, 300) : dataUrl;
      const finalKb = Math.round((compressed.length * 3) / 4 / 1024);
      if (finalKb > 300) {
        const ok = window.confirm(`Görsel ${finalKb}KB — 300KB limitini geçiyor. Daha da küçültülsün mü?`);
        if (!ok) return;
        const smaller = await compressImage(dataUrl, 250);
        callback(smaller);
        return;
      }
      callback(compressed);
    } catch (err) {
      console.warn('Görsel işleme hatası:', err.message);
    }
  };

  const handleSubmit = async () => {
    if (!formData.firstName || !formData.lastName) {
      alert('Ad ve Soyad alanları zorunludur!');
      setFormTab('info');
      return;
    }

    // TC Kimlik eşsizlik kontrolü
    if (formData.tcKimlik && formData.tcKimlik.length === 11) {
      const dup = customers.find(c =>
        c.tcKimlik === formData.tcKimlik &&
        c.id !== editingCustomer?.id
      );
      if (dup) {
        alert(`Bu TC Kimlik No zaten kayıtlı:\n${dup.firstName} ${dup.lastName}`);
        setFormTab('info');
        return;
      }
    }

    // === TARİH VALİDASYONU ===
    const today = new Date(); today.setHours(0,0,0,0);

    // Pasaport kontrolleri
    for (const p of passports) {
      if (!p.passportNo && !p.expiryDate) continue; // boş slot
      if (p.issueDate && p.expiryDate) {
        const issue = safeParseDate(p.issueDate);
        const expiry = safeParseDate(p.expiryDate);
        if (issue && expiry && expiry <= issue) {
          alert(`Pasaport #${p.passportNo || '?'}: Geçerlilik tarihi veriliş tarihinden sonra olmalıdır!`);
          setFormTab('passport'); return;
        }
      }
      if (p.expiryDate) {
        const expiry = safeParseDate(p.expiryDate);
        if (expiry && expiry < today) {
          alert(`Pasaport #${p.passportNo || '?'}: Süresi dolmuş pasaport kaydedilemez! Geçerlilik: ${formatDate(p.expiryDate)}`);
          setFormTab('passport'); return;
        }
      }
    }

    // Schengen vize kontrolleri
    for (const v of schengenVisas) {
      if (!v.country && !v.startDate && !v.endDate) continue; // boş slot
      if (v.startDate && v.endDate) {
        const start = safeParseDate(v.startDate);
        const end = safeParseDate(v.endDate);
        if (start && end && end <= start) {
          alert(`Schengen (${v.country || '?'}): Bitiş tarihi başlangıç tarihinden sonra olmalıdır!`);
          setFormTab('schengen'); return;
        }
      }
      if (v.endDate) {
        const end = safeParseDate(v.endDate);
        if (end && end < today) {
          alert(`Schengen (${v.country || '?'}): Süresi dolmuş vize kaydedilemez! Bitiş: ${formatDate(v.endDate)}`);
          setFormTab('schengen'); return;
        }
      }
    }

    // ABD vize kontrolü
    if (usaVisa.startDate && usaVisa.endDate) {
      const start = safeParseDate(usaVisa.startDate);
      const end = safeParseDate(usaVisa.endDate);
      if (start && end && end <= start) {
        alert('ABD Vizesi: Bitiş tarihi başlangıç tarihinden sonra olmalıdır!');
        setFormTab('usa'); return;
      }
    }
    if (usaVisa.endDate) {
      const end = safeParseDate(usaVisa.endDate);
      if (end && end < today) {
        alert(`ABD Vizesi: Süresi dolmuş vize kaydedilemez! Bitiş: ${formatDate(usaVisa.endDate)}`);
        setFormTab('usa'); return;
      }
    }

    // Doğum tarihi — gelecekte olamaz
    if (formData.birthDate) {
      const birth = safeParseDate(formData.birthDate);
      if (birth && birth > today) {
        alert('Doğum tarihi gelecekte olamaz!');
        setFormTab('info'); return;
      }
    }
    // === VALİDASYON SONU ===
    
    const now = new Date().toISOString();
    const fullData = {
      ...formData,
      passports: passports,
      schengenVisas: schengenVisas,
      usaVisa: usaVisa
    };
    
    if (editingCustomer) {
      const auditData = { lastEditedAt: now };
      const updated = customers.map(c => c.id === editingCustomer.id ? { ...c, ...fullData, ...auditData } : c);
      setCustomers(updated);
      // ⚡ Pasaport/vize'yi direkt Firestore'a yaz (debouncedSave bunları atlar)
      try {
        const docId = editingCustomer._docId || String(editingCustomer.id);
        await setDoc(doc(db, 'customers', docId), {
          ...fullData,
          ...auditData,
          passports: JSON.stringify(passports),
          schengenVisas: JSON.stringify(schengenVisas),
          usaVisa: JSON.stringify(usaVisa)
        }, { merge: true });
      } catch (err) { console.error('Firestore kayıt hatası:', err); }
    } else {
      const newCustomer = { ...fullData, id: generateUniqueId(), createdAt: now.split('T')[0], lastEditedAt: now, verified: true };
      setCustomers([...customers, newCustomer]);
      try {
        await setDoc(doc(db, 'customers', String(newCustomer.id)), {
          ...newCustomer,
          passports: JSON.stringify(passports),
          schengenVisas: JSON.stringify(schengenVisas),
          usaVisa: JSON.stringify(usaVisa)
        });
      } catch (err) { console.error('Firestore kayıt hatası:', err); }
    }
    showToast?.('✅ Kaydedildi', 'success');
  };

  const handlePassportSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const updatedCustomer = { ...selectedCustomer, passports };
    const updated = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);
    setCustomers(updated);
    setSelectedCustomer(updatedCustomer);
    setShowPassportModal(false);
    try {
      const docId = selectedCustomer._docId || String(selectedCustomer.id);
      await setDoc(doc(db, 'customers', docId), { passports: JSON.stringify(passports) }, { merge: true });
    } catch(e) { console.error('Pasaport kayıt hatası:', e); }
  };

  const handleSchengenSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const updatedCustomer = { ...selectedCustomer, schengenVisas };
    const updated = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);
    setCustomers(updated);
    setSelectedCustomer(updatedCustomer);
    setShowSchengenModal(false);
    try {
      const docId = selectedCustomer._docId || String(selectedCustomer.id);
      await setDoc(doc(db, 'customers', docId), { schengenVisas: JSON.stringify(schengenVisas) }, { merge: true });
    } catch(e) { console.error('Schengen kayıt hatası:', e); }
  };

  const handleUsaSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const updatedCustomer = { ...selectedCustomer, usaVisa };
    const updated = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);
    setCustomers(updated);
    setSelectedCustomer(updatedCustomer);
    setShowUsaModal(false);
    try {
      const docId = selectedCustomer._docId || String(selectedCustomer.id);
      await setDoc(doc(db, 'customers', docId), { usaVisa: JSON.stringify(usaVisa) }, { merge: true });
    } catch(e) { console.error('ABD vize kayıt hatası:', e); }
  };

  const deleteCustomer = async (id) => {
    if (!confirm('Silmek istediğinize emin misiniz?')) return;
    const cust = customers.find(c => c.id === id);
    setCustomers(customers.filter(c => c.id !== id));
    if (selectedCustomer?.id === id) setSelectedCustomer(null);
    try { const docId = cust?._docId || String(id); await deleteDoc(doc(db, 'customers', docId)); } catch(e) { console.warn('Firestore silme hatası:', e.message); }
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
                {/* 2'li grid: bilgiler üstte, fotoğraf altta */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={labelStyle}>Uyruk</label>
                      <input type="text" value={passport.nationality || 'Türkiye'} onChange={e => updatePassport(passport.id, 'nationality', e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Pasaport No</label>
                      <input type="text" value={passport.passportNo || ''}
                        onChange={e => { const pNo = formatPassportNo(e.target.value); const dt = detectPassportType(pNo); updatePassport(passport.id, 'passportNo', pNo); if (dt) updatePassport(passport.id, 'passportType', dt); }}
                        placeholder="U12345678" maxLength="9"
                        style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '2px', fontFamily: 'monospace' }} />
                    </div>
                    <DateInput label="Veriliş" value={passport.issueDate || ''} onChange={v => updatePassport(passport.id, 'issueDate', v)} />
                    <DateInput label="Geçerlilik" value={passport.expiryDate || ''} onChange={v => updatePassport(passport.id, 'expiryDate', v)} />
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Pasaport Türü</label>
                      <select value={passport.passportType || ''} onChange={e => updatePassport(passport.id, 'passportType', e.target.value)} style={{ ...selectStyle, padding: '10px', fontSize: '13px', width: '100%' }}>
                        {passportTypes.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Fotoğraf altta - tam genişlik */}
                  {passport.image ? (
                    <div>
                      <img src={passport.image} alt="Pasaport"
                        onClick={() => setImagePreview({ show: true, src: passport.image, title: `Pasaport - ${passport.passportNo || ''}` })}
                        style={{ width: '100%', aspectRatio: '125/90', objectFit: 'cover', borderRadius: '10px', border: '2px solid rgba(59,130,246,0.4)', cursor: 'zoom-in', display: 'block' }} />
                      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <button type="button" onClick={async () => {
                          if (!passport.image) { showToast?.('Önce görsel ekleyin', 'error'); return; }
                          showToast?.('AI pasaport okuyor...', 'info');
                          try {
                            const b64 = passport.image.startsWith('data:') ? passport.image.split(',')[1] : passport.image;
                            const apiKey = appSettings?.claudeApiKey;
                            const resp = await fetch(apiKey ? 'https://api.anthropic.com/v1/messages' : '/.netlify/functions/claude-proxy', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } : {}) },
                              body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 500, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text: 'Bu pasaport. SADECE JSON: {"passportNo":"","issueDate":"YYYY-MM-DD","expiryDate":"YYYY-MM-DD","birthPlace":"","nationality":"TUR"}. nationality 3 harfli ISO kodu.' }] }] })
                            });
                            const data = await resp.json();
                            const parsed = JSON.parse((data.content?.[0]?.text || '').replace(/```json|```/g, '').trim());
                            if (parsed.passportNo) updatePassport(passport.id, 'passportNo', parsed.passportNo);
                            if (parsed.issueDate) updatePassport(passport.id, 'issueDate', parsed.issueDate);
                            if (parsed.expiryDate) updatePassport(passport.id, 'expiryDate', parsed.expiryDate);
                            if (parsed.passportNo) { const t = detectPassportType(parsed.passportNo); if (t) updatePassport(passport.id, 'passportType', t); }
                            if (parsed.nationality) updatePassport(passport.id, 'nationality', isoToCountry(parsed.nationality));
                            if (parsed.birthPlace) setFormData(fd => ({ ...fd, birthPlace: parsed.birthPlace }));
                            showToast?.('Pasaport okundu', 'success');
                          } catch(err) { showToast?.('AI okuma başarısız', 'error'); }
                        }} style={{ flex: 1, padding: '8px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', color: '#8b5cf6', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                          🤖 AI ile Oku
                        </button>
                        <label style={{ flex: 1, textAlign: 'center', padding: '8px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: '#3b82f6', fontWeight: '600' }}>
                          🔄 Değiştir
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: (img) => updatePassport(passport.id, 'image', img) }); reader.readAsDataURL(file); } }} />
                        </label>
                        <button type="button" onClick={() => updatePassport(passport.id, 'image', '')}
                          style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>× Kaldır</button>
                      </div>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', aspectRatio: '125/90', background: 'rgba(59,130,246,0.06)', border: '2px dashed rgba(59,130,246,0.25)', borderRadius: '10px', cursor: 'pointer', gap: '6px' }}>
                      <span style={{ fontSize: '28px' }}>📷</span>
                      <span style={{ fontSize: '12px', color: '#3b82f6', fontWeight: '600' }}>Pasaport Görseli Ekle</span>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: (img) => updatePassport(passport.id, 'image', img) }); reader.readAsDataURL(file); } }} />
                    </label>
                  )}
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
                {/* Dikey: bilgiler üstte, görsel altta */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                  {/* Görsel altta - tam genişlik */}
                  {visa.image ? (
                    <div>
                      <img src={visa.image} alt="Vize"
                        onClick={() => setImagePreview({ show: true, src: visa.image, title: `Schengen - ${visa.country || ''}` })}
                        style={{ width: '100%', aspectRatio: '125/90', objectFit: 'cover', borderRadius: '10px', border: '2px solid rgba(16,185,129,0.3)', cursor: 'zoom-in', display: 'block' }} />
                      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <button type="button" onClick={async () => {
                          if (!visa.image) return;
                          showToast?.('AI vize okuyor...', 'info');
                          try {
                            const b64 = visa.image.startsWith('data:') ? visa.image.split(',')[1] : visa.image;
                            const apiKey = appSettings?.claudeApiKey;
                            const resp = await fetch(apiKey ? 'https://api.anthropic.com/v1/messages' : '/.netlify/functions/claude-proxy', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } : {}) },
                              body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 300, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text: 'Bu Schengen vizesi. SADECE JSON: {"country":"Almanya","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}' }] }] })
                            });
                            const data = await resp.json();
                            const parsed = JSON.parse((data.content?.[0]?.text || '').replace(/```json|```/g, '').trim());
                            setSchengenVisas(schengenVisas.map(v => v.id === visa.id ? { ...v, ...(parsed.country && { country: parsed.country }), ...(parsed.startDate && { startDate: parsed.startDate }), ...(parsed.endDate && { endDate: parsed.endDate }) } : v));
                            showToast?.('Vize okundu', 'success');
                          } catch(err) { showToast?.('AI okuma başarısız', 'error'); }
                        }} style={{ flex: 1, padding: '8px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', color: '#8b5cf6', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                          🤖 AI ile Oku
                        </button>
                        <label style={{ flex: 1, textAlign: 'center', padding: '8px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: '#10b981', fontWeight: '600' }}>
                          🔄 Değiştir
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: (img) => setSchengenVisas(schengenVisas.map(v => v.id === visa.id ? {...v, image: img} : v)) }); reader.readAsDataURL(file); } }} />
                        </label>
                        <button type="button" onClick={() => setSchengenVisas(schengenVisas.map(v => v.id === visa.id ? {...v, image: ''} : v))}
                          style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>× Kaldır</button>
                      </div>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', aspectRatio: '125/90', background: 'rgba(16,185,129,0.06)', border: '2px dashed rgba(16,185,129,0.25)', borderRadius: '10px', cursor: 'pointer', gap: '6px' }}>
                      <span style={{ fontSize: '28px' }}>📷</span>
                      <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '600' }}>Vize Görseli Ekle</span>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: (img) => setSchengenVisas(schengenVisas.map(v => v.id === visa.id ? {...v, image: img} : v)) }); reader.readAsDataURL(file); } }} />
                    </label>
                  )}
                </div>
              </div>
            ))}

            {/* Vize Ekle Butonu */}
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
              {/* Dikey: bilgiler üstte, görsel altta */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <DateInput label="Başlangıç" value={usaVisa.startDate || ''} onChange={v => setUsaVisa({...usaVisa, startDate: v})} />
                  <DateInput label="Bitiş" value={usaVisa.endDate || ''} onChange={v => setUsaVisa({...usaVisa, endDate: v})} />
                </div>
                {usaVisa.image ? (
                  <div>
                    <img src={usaVisa.image} alt="ABD Vizesi"
                      onClick={() => setImagePreview({ show: true, src: usaVisa.image, title: 'ABD Vizesi' })}
                      style={{ width: '100%', aspectRatio: '125/90', objectFit: 'cover', borderRadius: '10px', border: '2px solid rgba(139,92,246,0.3)', cursor: 'zoom-in', display: 'block' }} />
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                      <label style={{ flex: 1, textAlign: 'center', padding: '8px', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: '#8b5cf6', fontWeight: '600' }}>
                        🔄 Değiştir
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: (img) => setUsaVisa({...usaVisa, image: img}) }); reader.readAsDataURL(file); } }} />
                      </label>
                      <button type="button" onClick={() => setUsaVisa({...usaVisa, image: ''})}
                        style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>× Kaldır</button>
                    </div>
                  </div>
                ) : (
                  <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', aspectRatio: '125/90', background: 'rgba(139,92,246,0.06)', border: '2px dashed rgba(139,92,246,0.25)', borderRadius: '10px', cursor: 'pointer', gap: '6px' }}>
                    <span style={{ fontSize: '28px' }}>📷</span>
                    <span style={{ fontSize: '12px', color: '#8b5cf6', fontWeight: '600' }}>Vize Görseli Ekle</span>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: (img) => setUsaVisa({...usaVisa, image: img}) }); reader.readAsDataURL(file); } }} />
                  </label>
                )}
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
            <button onClick={() => { setSelectedCustomer(null); setDetailTab('info'); if (onBack) onBack(); }} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 16px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px' }}>← Geri</button>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#ffffff', fontWeight: '600' }}>{c.verified !== true ? '⚠️ ' : '✓ '}{c.firstName} {c.lastName}</h2>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>{c.phone}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={async () => {
              const newVerified = c.verified !== true;
              const updated = customers.map(x => x.id === c.id ? {...x, verified: newVerified} : x);
              setCustomers(updated);
              setSelectedCustomer({...c, verified: newVerified});
              try {
                const docId = c._docId || String(c.id);
                await setDoc(doc(db, 'customers', docId), { verified: newVerified }, { merge: true });
              } catch(e) { console.warn('verified kayıt hatası', e); }
            }} style={{ background: c.verified === true ? 'rgba(16,185,129,0.2)' : 'rgba(234,179,8,0.2)', border: `1px solid ${c.verified === true ? 'rgba(16,185,129,0.4)' : 'rgba(234,179,8,0.4)'}`, borderRadius: '10px', padding: '10px 16px', color: c.verified === true ? '#10b981' : '#eab308', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>
              {c.verified === true ? '✓ Kontrol Edildi' : '⚠️ Kontrol Et'}
            </button>
            <button onClick={() => { setSelectedCustomer(null); openEditForm(c); }} style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>✏️ Düzenle</button>
          </div>
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

              {/* Kayıt Bilgileri */}
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '12px', padding: '14px 16px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                {c.createdAt && <div><span style={{ fontSize: '10px', color: '#475569' }}>Oluşturulma: </span><span style={{ fontSize: '11px', color: '#64748b' }}>{formatDate(c.createdAt)}</span></div>}
                {c.lastEditedAt && <div><span style={{ fontSize: '10px', color: '#475569' }}>Son Güncelleme: </span><span style={{ fontSize: '11px', color: '#64748b' }}>{new Date(c.lastEditedAt).toLocaleDateString('tr-TR')}</span></div>}
                <div><span style={{ fontSize: '10px', color: '#475569' }}>Durum: </span><span style={{ fontSize: '11px', color: c.verified !== true ? '#eab308' : '#10b981', fontWeight: '600' }}>{c.verified === true ? '✓ Doğrulandı' : '⚠️ Kontrol Bekliyor'}</span></div>
              </div>

              {/* Dinamik Alanlar */}
              {appSettings?.personalDetailsFields?.filter(f => !['Doğum Tarihi', 'İkametgah İli'].includes(f)).length > 0 && (() => {
                const extraFields = appSettings.personalDetailsFields.filter(f => !['Doğum Tarihi', 'İkametgah İli'].includes(f));
                const hasValues = extraFields.some(f => {
                  const k = f.toLowerCase().replace(/\s+/g, '_').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c');
                  return c[k];
                });
                if (!hasValues) return null;
                return (
                  <div style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.02) 100%)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(245,158,11,0.15)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>📋</div>
                      <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', fontWeight: '600' }}>Ek Bilgiler</h3>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {extraFields.map((field, idx) => {
                        const k = field.toLowerCase().replace(/\s+/g, '_').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c');
                        return c[k] ? <InfoBox key={idx} label={field} value={c[k]} /> : null;
                      })}
                    </div>
                  </div>
                );
              })()}
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
                <>
                  {cPassports.map((p, idx) => (
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <InfoBox label="Pasaport No" value={p.passportNo} />
                          <InfoBox label="Veriliş Tarihi" value={formatDate(p.issueDate)} />
                          <InfoBox label="Geçerlilik Tarihi" value={formatDate(p.expiryDate)} highlight={p.expiryDate && getDaysLeft(p.expiryDate) <= 180} />
                        </div>
                        {p.image && (
                          <img src={p.image} alt="Pasaport"
                            onClick={() => setImagePreview({ show: true, src: p.image, title: `Pasaport - ${p.passportNo}` })}
                            style={{ width: '100%', aspectRatio: '125/90', objectFit: 'cover', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.3)', cursor: 'zoom-in', display: 'block' }} />
                        )}
                      </div>
                    </div>
                  ))}
                  <button onClick={async () => {
                    if (!window.confirm('Tüm pasaport bilgilerini silmek istediğinizden emin misiniz?')) return;
                    const updated = customers.map(x => x.id === c.id ? {...x, passports: []} : x);
                    setCustomers(updated);
                    setSelectedCustomer({...c, passports: []});
                    try { await setDoc(doc(db, 'customers', c._docId || String(c.id)), { passports: '[]' }, { merge: true }); } catch(e) {}
                    showToast('Pasaport bilgileri temizlendi', 'warning');
                  }} style={{ padding: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                    🗑️ Tüm Pasaport Bilgilerini Temizle
                  </button>
                </>
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
                <>
                  {cSchengen.map((v, idx) => (
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <InfoBox label="Başlangıç" value={formatDate(v.startDate)} />
                          <InfoBox label="Bitiş" value={formatDate(v.endDate)} highlight={v.endDate && getDaysLeft(v.endDate) <= 90} />
                        </div>
                        {v.image && (
                          <img src={v.image} alt="Vize"
                            onClick={() => setImagePreview({ show: true, src: v.image, title: `Schengen - ${v.country}` })}
                            style={{ width: '100%', aspectRatio: '125/90', objectFit: 'cover', borderRadius: '10px', border: '1px solid rgba(16,185,129,0.3)', cursor: 'zoom-in', display: 'block' }} />
                        )}
                      </div>
                    </div>
                  ))}
                  <button onClick={async () => {
                    if (!window.confirm('Tüm Schengen vize bilgilerini silmek istediğinizden emin misiniz?')) return;
                    const empty = [{ id: 1, country: '', startDate: '', endDate: '', image: '' }];
                    const updated = customers.map(x => x.id === c.id ? {...x, schengenVisas: empty} : x);
                    setCustomers(updated);
                    setSelectedCustomer({...c, schengenVisas: empty});
                    try { await setDoc(doc(db, 'customers', c._docId || String(c.id)), { schengenVisas: JSON.stringify(empty) }, { merge: true }); } catch(e) {}
                    showToast('Schengen vize bilgileri temizlendi', 'warning');
                  }} style={{ padding: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                    🗑️ Tüm Schengen Bilgilerini Temizle
                  </button>
                </>
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
                <>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <InfoBox label="Vize Başlangıç" value={formatDate(cUsa.startDate)} />
                        <InfoBox label="Vize Bitiş" value={formatDate(cUsa.endDate)} highlight={cUsa.endDate && getDaysLeft(cUsa.endDate) <= 30} />
                      </div>
                      {cUsa.image && (
                        <img src={cUsa.image} alt="ABD Vizesi" onClick={() => setImagePreview({ show: true, src: cUsa.image, title: 'ABD Vizesi' })} style={{ width: '100%', aspectRatio: '125/90', objectFit: 'cover', borderRadius: '10px', border: '1px solid rgba(139,92,246,0.3)', cursor: 'zoom-in', display: 'block' }} />
                      )}
                    </div>
                  </div>
                  <button onClick={async () => {
                    if (!window.confirm('ABD vize bilgilerini silmek istediğinizden emin misiniz?')) return;
                    const empty = {};
                    const updated = customers.map(x => x.id === c.id ? {...x, usaVisa: empty} : x);
                    setCustomers(updated);
                    setSelectedCustomer({...c, usaVisa: empty});
                    try { await setDoc(doc(db, 'customers', c._docId || String(c.id)), { usaVisa: '{}' }, { merge: true }); } catch(e) {}
                    showToast('ABD vize bilgileri temizlendi', 'warning');
                  }} style={{ padding: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                    🗑️ ABD Vize Bilgilerini Temizle
                  </button>
                </>
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
      <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: c.verified !== true ? 'rgba(234,179,8,0.04)' : 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '12px', border: c.verified !== true ? '1px solid rgba(234,179,8,0.25)' : '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{c.verified !== true ? '⚠️ ' : ''}{c.firstName} {c.lastName}</h3>
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{c.phone} {c.city && `• ${c.city}`}</p>
            {c.sector && <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#94a3b8' }}>{c.sector}</p>}
          </div>
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {c.verified !== false && <span style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '4px', background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>✓</span>}
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
          <button onClick={() => { setAiText(''); setAiResult(null); setAiImages([]); setShowAiModal(true); }} style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', padding: '8px 12px', color: '#8b5cf6', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>🤖 AI</button>
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
      {/* Kırpma / Döndürme Modalı */}
      {cropModal && (() => {
        const OUT_W = 500, OUT_H = 360;
        const FRAME_W = 500, FRAME_H = 360;
        const rot = cropModal.rotation;

        const applyCrop = () => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = OUT_W; canvas.height = OUT_H;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, OUT_W, OUT_H);
            ctx.save();
            ctx.translate(OUT_W / 2 + cropPos.x * (OUT_W / FRAME_W), OUT_H / 2 + cropPos.y * (OUT_H / FRAME_H));
            ctx.rotate((rot * Math.PI) / 180);
            ctx.scale(cropZoom, cropZoom);
            ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
            ctx.restore();
            const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
            if (cropModal.onSave) {
              // Pasaport/vize düzenleme formundan açıldı → Storage'a yükle
              cropModal.onSave(dataUrl);
            } else {
              // AI Quick Add'den açıldı → aiImages state'e ekle
              setAiImages(prev => [...prev.filter(i => i.type !== cropModal.type), { type: cropModal.type, base64: dataUrl.split(',')[1], preview: dataUrl, mediaType: 'image/jpeg' }]);
            }
            setCropModal(null); setCropPos({ x: 0, y: 0 }); setCropZoom(1);
          };
          img.src = cropModal.src;
        };

        const handleMouseDown = (e) => {
          e.preventDefault();
          const startX = e.clientX - cropPos.x, startY = e.clientY - cropPos.y;
          cropDragRef.current = { startX, startY };
          const onMove = (e) => { if (!cropDragRef.current) return; setCropPos({ x: e.clientX - cropDragRef.current.startX, y: e.clientY - cropDragRef.current.startY }); };
          const onUp = () => { cropDragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        };

        const handleTouchStart = (e) => {
          e.preventDefault();
          if (e.touches.length === 2) {
            // Pinch başlıyor
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const startDist = Math.hypot(dx, dy);
            const startZoom = cropZoom;
            const onMove = (e) => {
              if (e.touches.length !== 2) return;
              const dx2 = e.touches[0].clientX - e.touches[1].clientX;
              const dy2 = e.touches[0].clientY - e.touches[1].clientY;
              const newDist = Math.hypot(dx2, dy2);
              const ratio = newDist / startDist;
              setCropZoom(Math.min(5, Math.max(0.2, startZoom * ratio)));
            };
            const onEnd = () => { window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onEnd); };
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onEnd);
            return;
          }
          if (e.touches.length !== 1) return;
          const t = e.touches[0];
          const startX = t.clientX - cropPos.x, startY = t.clientY - cropPos.y;
          cropDragRef.current = { startX, startY };
          const onMove = (e) => { if (!cropDragRef.current || e.touches.length !== 1) return; const t = e.touches[0]; setCropPos({ x: t.clientX - cropDragRef.current.startX, y: t.clientY - cropDragRef.current.startY }); };
          const onEnd = () => { cropDragRef.current = null; window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onEnd); };
          window.addEventListener('touchmove', onMove, { passive: false });
          window.addEventListener('touchend', onEnd);
        };

        const handleWheel = (e) => { e.preventDefault(); setCropZoom(z => Math.min(5, Math.max(0.2, z - e.deltaY * 0.003))); };

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600, padding: '16px' }}>
            <div style={{ background: '#0c1929', borderRadius: '16px', padding: '16px', width: '100%', maxWidth: '560px', border: '1px solid rgba(59,130,246,0.4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontWeight: '700', fontSize: '15px', color: '#e8f1f8' }}>✂️ Kırp & Hizala</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    <span style={{ color: '#3b82f6' }}>Sürükle</span>: taşı &nbsp;|&nbsp; <span style={{ color: '#3b82f6' }}>2 Parmak</span>: yakınlaştır &nbsp;|&nbsp; 125×90
                  </div>
                </div>
                <button onClick={() => { setCropModal(null); setCropPos({ x: 0, y: 0 }); setCropZoom(1); }} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', width: '32px', height: '32px', color: '#94a3b8', cursor: 'pointer', fontSize: '16px' }}>✕</button>
              </div>

              {/* Kırpma alanı — overflow:hidden = çerçeve */}
              <div
                style={{ position: 'relative', width: '100%', aspectRatio: '125/90', background: '#000', borderRadius: '8px', overflow: 'hidden', marginBottom: '10px', cursor: 'grab', touchAction: 'none', border: '2px solid rgba(59,130,246,0.7)' }}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                onWheel={handleWheel}
              >
                <img
                  src={cropModal.src}
                  alt="crop"
                  draggable={false}
                  style={{
                    position: 'absolute', top: '50%', left: '50%',
                    transform: `translate(-50%, -50%) translate(${cropPos.x}px, ${cropPos.y}px) rotate(${rot}deg) scale(${cropZoom})`,
                    maxWidth: 'none', maxHeight: 'none',
                    userSelect: 'none', pointerEvents: 'none',
                    transformOrigin: 'center',
                  }}
                />
                {/* üçte-üç grid çizgileri */}
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)', backgroundSize: '33.33% 33.33%' }} />
              </div>

              {/* Zoom slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <button onClick={() => setCropZoom(z => Math.max(0.2, z - 0.1))} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '6px', color: '#e8f1f8', cursor: 'pointer', width: '28px', height: '28px', fontSize: '16px' }}>−</button>
                <input type="range" min="0.2" max="5" step="0.05" value={cropZoom}
                  onChange={e => setCropZoom(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#3b82f6' }} />
                <button onClick={() => setCropZoom(z => Math.min(5, z + 0.1))} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '6px', color: '#e8f1f8', cursor: 'pointer', width: '28px', height: '28px', fontSize: '16px' }}>+</button>
                <span style={{ fontSize: '11px', color: '#64748b', minWidth: '38px' }}>{Math.round(cropZoom * 100)}%</span>
                <button onClick={() => { setCropPos({ x: 0, y: 0 }); setCropZoom(1); }} style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: '6px', color: '#94a3b8', cursor: 'pointer', fontSize: '11px' }}>Sıfırla</button>
              </div>

              {/* Döndür */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                <button onClick={() => { setCropModal(p => ({ ...p, rotation: (p.rotation - 90 + 360) % 360 })); setCropPos({ x: 0, y: 0 }); setCropZoom(1); }}
                  style={{ flex: 1, padding: '9px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>↺ Sol</button>
                <button onClick={() => { setCropModal(p => ({ ...p, rotation: (p.rotation + 90) % 360 })); setCropPos({ x: 0, y: 0 }); setCropZoom(1); }}
                  style={{ flex: 1, padding: '9px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>↻ Sağ</button>
                <button onClick={() => { setCropModal(p => ({ ...p, rotation: (p.rotation + 180) % 360 })); setCropPos({ x: 0, y: 0 }); setCropZoom(1); }}
                  style={{ flex: 1, padding: '9px', background: 'rgba(100,116,139,0.15)', border: '1px solid rgba(100,116,139,0.3)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>🔄 180°</button>
              </div>

              <button onClick={applyCrop}
                style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '10px', color: 'white', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                ✅ Onayla ve Kullan
              </button>
            </div>
          </div>
        );
      })()}

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

      {/* 🤖 AI HIZLI MÜŞTERI EKLEME MODALI */}
      {showAiModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: '20px' }}>
          <div style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '580px', maxHeight: '90vh', overflowY: 'auto', border: '1px solid rgba(139,92,246,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#8b5cf6' }}>🤖 AI Hızlı Müşteri Ekle</h3>
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#64748b' }}>Metin girin veya belge fotoğrafı yükleyin, AI otomatik ayrıştırsın</p>
              </div>
              <button onClick={() => setShowAiModal(false)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', width: '32px', height: '32px', color: '#94a3b8', cursor: 'pointer', fontSize: '16px' }}>✕</button>
            </div>

            {/* Görsel Yükleme Bölümü */}
            <div style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>📷 Belge Fotoğrafı Yükle (isteğe bağlı)</div>
              {[
                { type: 'passport', label: 'Pasaport', icon: '🛂', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.35)' },
                { type: 'schengen', label: 'Schengen Vize', icon: '📋', color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.35)' },
                { type: 'usa', label: 'ABD Vize', icon: '📋', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.35)' },
              ].map(({ type, label, icon, color, bg, border }) => {
                const img = aiImages.find(i => i.type === type);
                return (
                  <div key={type} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px', background: bg, border: `2px ${img ? 'solid' : 'dashed'} ${img ? color : border}`, borderRadius: '12px' }}>
                    {img ? (
                      <div style={{ position: 'relative', width: '100%' }}>
                        <img src={img.preview} alt={label} style={{ width: '100%', maxHeight: '120px', objectFit: 'contain', borderRadius: '8px', background: '#0a1628' }} />
                        <button type="button" onClick={() => setAiImages(prev => prev.filter(i => i.type !== type))}
                          style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: '50%', width: '22px', height: '22px', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>×</button>
                        <div style={{ textAlign: 'center', marginTop: '6px', fontSize: '11px', color: color }}>✅ {label} yüklendi</div>
                      </div>
                    ) : (
                      <>
                        <span style={{ fontSize: '28px' }}>{icon}</span>
                        <span style={{ fontSize: '13px', color: color, fontWeight: '600' }}>{label} Yükle</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <label style={{ padding: '8px 14px', background: `${color}30`, borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: color, fontWeight: '600' }}>
                            📸 Kamera
                            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                              onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { setCropModal({ type, src: ev.target.result, rotation: 0, label }); }; r.readAsDataURL(f); e.target.value = ''; }} />
                          </label>
                          <label style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.08)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: '#94a3b8', fontWeight: '500' }}>
                            📁 Dosya
                            <input type="file" accept="image/*" style={{ display: 'none' }}
                              onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { setCropModal({ type, src: ev.target.result, rotation: 0, label }); }; r.readAsDataURL(f); e.target.value = ''; }} />
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {aiResult && (
              <div style={{ marginTop: '16px', padding: '16px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '12px' }}>
                <h4 style={{ margin: '0 0 12px', fontSize: '13px', color: '#10b981' }}>✅ AI Sonucu — Kontrol edin:</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                  {[
                    ['Ad', aiResult.firstName], ['Soyad', aiResult.lastName],
                    ['TC Kimlik', aiResult.tcKimlik], ['Telefon', aiResult.phone],
                    ['E-posta', aiResult.email], ['Doğum Tarihi', aiResult.birthDate ? formatDate(aiResult.birthDate) : ''],
                    ['Doğum Yeri', aiResult.birthPlace], ['İl', aiResult.city],
                    ['Firma', aiResult.companyName], ['Sektör', aiResult.sector],
                  ].filter(([,v]) => v).map(([k,v]) => (
                    <div key={k} style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 8px', borderRadius: '6px' }}>
                      <div style={{ fontSize: '10px', color: '#64748b' }}>{k}</div>
                      <div style={{ color: '#e8f1f8', fontWeight: '500' }}>{v}</div>
                    </div>
                  ))}
                </div>
                {aiResult._passports?.length > 0 && (
                  <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(59,130,246,0.1)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#3b82f6', marginBottom: '4px' }}>🛂 Pasaport</div>
                    {aiResult._passports.map((p, i) => <div key={i} style={{ fontSize: '11px', color: '#94a3b8' }}>{p.passportNo} — {formatDate(p.expiryDate)}</div>)}
                  </div>
                )}
                {aiResult._schengen?.some(v => v.country) && (
                  <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(16,185,129,0.1)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#10b981', marginBottom: '4px' }}>🇪🇺 Schengen</div>
                    {aiResult._schengen.filter(v => v.country).map((v, i) => <div key={i} style={{ fontSize: '11px', color: '#94a3b8' }}>{v.country}: {formatDate(v.startDate)} – {formatDate(v.endDate)}</div>)}
                  </div>
                )}
                {aiResult._usaVisa?.endDate && (
                  <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(139,92,246,0.1)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#8b5cf6', marginBottom: '4px' }}>🇺🇸 ABD Vizesi</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>{formatDate(aiResult._usaVisa.startDate)} – {formatDate(aiResult._usaVisa.endDate)}</div>
                  </div>
                )}
                {aiResult._duplicate ? (
                  /* AYNI PASAPORT / TC → zaten var */
                  <div style={{ marginTop: '12px', padding: '16px', background: 'rgba(245,158,11,0.1)', border: '2px solid rgba(245,158,11,0.4)', borderRadius: '12px' }}>
                    <div style={{ fontSize: '14px', color: '#f59e0b', fontWeight: '700', marginBottom: '6px' }}>⚠️ Bu kayıt zaten mevcut!</div>
                    <div style={{ fontSize: '12px', color: '#e8f1f8', marginBottom: '12px' }}>{aiResult._duplicate}</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => {
                        const c = aiResult._duplicateCustomer || customers.find(c => c.tcKimlik === aiResult.tcKimlik || safeParseJSON(c.passports).some(p => aiResult._passports?.some(ap => ap.passportNo === p.passportNo)));
                        if (c) { setShowAiModal(false); setAiText(''); setAiResult(null); setAiImages([]); setTimeout(() => setSelectedCustomer(c), 100); }
                      }} style={{ flex: 1, padding: '10px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>
                        👤 Müşteriyi Aç
                      </button>
                      <button onClick={() => setAiResult(null)} style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>↩ Tekrar</button>
                    </div>
                  </div>
                ) : aiResult._addPassportTo ? (
                  /* AYNI TC AMA FARKLI PASAPORT → 2. pasaport ekle */
                  <div style={{ marginTop: '12px', padding: '16px', background: 'rgba(59,130,246,0.1)', border: '2px solid rgba(59,130,246,0.35)', borderRadius: '12px' }}>
                    <div style={{ fontSize: '14px', color: '#3b82f6', fontWeight: '700', marginBottom: '6px' }}>📎 Mevcut müşteriye yeni pasaport eklenecek</div>
                    <div style={{ fontSize: '12px', color: '#e8f1f8', marginBottom: '4px' }}>{aiResult._dupTcMsg}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '12px' }}>Yeni pasaport: {aiResult._passports?.map(p => p.passportNo).join(', ')}</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => {
                        const existing = aiResult._addPassportTo;
                        const existingPassports = safeParseJSON(existing.passports);
                        const newPassports = [...existingPassports, ...(aiResult._passports || [])];
                        const updated = { ...existing, passports: newPassports, verified: false, lastEditedAt: new Date().toISOString() };
                        setCustomers(prev => prev.map(c => c.id === existing.id ? updated : c));
                        showToast?.(`✅ ${existing.firstName} ${existing.lastName} — yeni pasaport eklendi`, 'success');
                        setShowAiModal(false); setAiText(''); setAiResult(null); setAiImages([]);
                        setTimeout(() => setSelectedCustomer(updated), 100);
                      }} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '8px', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}>
                        📎 Pasaportu Ekle
                      </button>
                      <button onClick={() => setAiResult(null)} style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>↩ Tekrar</button>
                    </div>
                  </div>
                ) : (
                  /* YENİ MÜŞTERİ — kaydet */
                  <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '12px' }}>
                    <div style={{ fontSize: '13px', color: '#10b981', fontWeight: '600', marginBottom: '8px' }}>✅ Yeni müşteri — sisteme kayıt edilecek</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => {
                        const now = new Date().toISOString();
                        const newCust = {
                          ...aiResult,
                          id: generateUniqueId(),
                          createdAt: now.split('T')[0],
                          lastEditedAt: now,
                          verified: false,
                          passports: aiResult._passports || [],
                          schengenVisas: aiResult._schengen || [{ id: 1, country: '', startDate: '', endDate: '', image: '' }],
                          usaVisa: aiResult._usaVisa || {},
                        };
                        delete newCust._passports; delete newCust._schengen; delete newCust._usaVisa; delete newCust._duplicate;
                        setCustomers(prev => [newCust, ...prev]);
                        showToast?.('✅ Müşteri eklendi — kontrol edilmesi gerekiyor', 'success');
                        setShowAiModal(false);
                        setAiText(''); setAiResult(null); setAiImages([]);
                      }} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '8px', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                        ✅ Yeni Müşteri Ekle
                      </button>
                      <button onClick={() => setAiResult(null)} style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>
                        ↩ Tekrar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!aiResult && (
              <button
                onClick={async () => {
                  if (!aiText.trim() && aiImages.length === 0) { showToast?.('Metin girin veya belge fotoğrafı yükleyin', 'error'); return; }
                  setAiLoading(true);
                  try {
                    const systemPrompt = `Sen bir Türk seyahat acentesi CRM sistemi için belge okuma asistanısın.
Pasaport ve vize görsellerinden / metinden bilgileri çıkar. SADECE JSON döndür, başka hiçbir şey yazma.

JSON formatı:
{
  "firstName": "", "lastName": "", "tcKimlik": "11 hane",
  "phone": "+90 5XX formatında", "email": "",
  "birthDate": "YYYY-MM-DD", "birthPlace": "", "city": "",
  "companyName": "", "sector": "", "notes": "",
  "_passports": [{"passportNo": "U1234567", "issueDate": "YYYY-MM-DD", "expiryDate": "YYYY-MM-DD", "passportType": "Bordo Pasaport (Umuma Mahsus)", "nationality": "Türkiye"}],
  "_schengen": [{"country": "", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "visaNo": ""}],
  "_usaVisa": {"startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "visaNo": ""}
}

Pasaport tipi: S=Yeşil Pasaport (Hususi), U=Bordo Pasaport (Umuma Mahsus), Z=Gri Pasaport (Hizmet).
Tarihler YYYY-MM-DD. TC Kimlik 11 hane. Pasaport No genellikle 1 harf + 7 rakam.`;

                    const apiKey = appSettings?.claudeApiKey;
                    const model = appSettings?.claudeModel || 'claude-sonnet-4-20250514';

                    const userContent = [];
                    for (const img of aiImages) {
                      userContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 } });
                      userContent.push({ type: 'text', text: `Bu görsel ${img.type === 'passport' ? 'pasaport' : img.type === 'schengen' ? 'Schengen vize' : 'ABD vizesi'} belgesidir.` });
                    }
                    if (aiText.trim()) userContent.push({ type: 'text', text: aiText });
                    const msgContent = userContent.length === 1 && userContent[0].type === 'text' ? userContent[0].text : userContent;

                    let resp;
                    if (apiKey) {
                      resp = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
                        body: JSON.stringify({ model, max_tokens: 1500, system: systemPrompt, messages: [{ role: 'user', content: msgContent }] })
                      });
                    } else {
                      resp = await fetch('/.netlify/functions/claude-proxy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model, max_tokens: 1500, system: systemPrompt, messages: [{ role: 'user', content: msgContent }] })
                      });
                    }
                    if (!resp.ok) {
                      const errText = await resp.text();
                      throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
                    }
                    const data = await resp.json();
                    if (!data.content?.[0]?.text) {
                      throw new Error(apiKey ? 'API yanıt boş geldi' : 'Netlify proxy çalışmıyor. Ayarlar → Claude API Key girin veya Netlify\'da CLAUDE_API_KEY env var ekleyin.');
                    }
                    const parsed = JSON.parse((data.content[0].text).replace(/```json|```/g, '').trim());

                    // ── Akıllı mükerrer kontrol ──
                    // 1. Pasaport No eşleşmesi — aynı pasaport = kesinlikle aynı kişi, ekleme
                    let dupByPassport = null;
                    if (parsed._passports?.length) {
                      for (const p of parsed._passports) {
                        if (!p.passportNo) continue;
                        const dup = customers.find(c => safeParseJSON(c.passports).some(cp => cp.passportNo === p.passportNo));
                        if (dup) { dupByPassport = { customer: dup, passportNo: p.passportNo }; break; }
                      }
                    }
                    // 2. TC Kimlik eşleşmesi
                    const dupByTc = parsed.tcKimlik ? customers.find(c => c.tcKimlik === parsed.tcKimlik) : null;

                    if (dupByPassport) {
                      // Aynı pasaport No → zaten var
                      parsed._duplicate = `${dupByPassport.customer.firstName} ${dupByPassport.customer.lastName} — Pasaport No (${dupByPassport.passportNo}) zaten kayıtlı`;
                      parsed._duplicateCustomer = dupByPassport.customer;
                    } else if (dupByTc && parsed._passports?.length) {
                      // Aynı TC ama farklı pasaport No → 2. pasaport ekle
                      parsed._addPassportTo = dupByTc;
                      parsed._dupTcMsg = `${dupByTc.firstName} ${dupByTc.lastName} (TC: ${parsed.tcKimlik}) — Yeni pasaport bu kişiye eklenecek`;
                    } else if (dupByTc) {
                      parsed._duplicate = `${dupByTc.firstName} ${dupByTc.lastName} — TC Kimlik (${parsed.tcKimlik}) zaten kayıtlı`;
                      parsed._duplicateCustomer = dupByTc;
                    }

                    if (parsed._schengen) parsed._schengen = parsed._schengen.map((v, i) => ({ ...v, id: i + 1 }));
                    setAiResult(parsed);
                  } catch(err) {
                    console.error('AI hata:', err);
                    showToast?.('AI ayrıştırma başarısız: ' + err.message, 'error');
                  } finally {
                    setAiLoading(false);
                  }
                }}
                disabled={aiLoading}
                style={{ width: '100%', marginTop: '12px', padding: '14px', background: aiLoading ? 'rgba(139,92,246,0.3)' : 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '700', fontSize: '14px', cursor: aiLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                {aiLoading ? '⏳ AI okuyor...' : '🤖 AI ile Oku'}
              </button>
            )}
          </div>
        </div>
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

function AttachmentSettingsPanel({ appSettings, setAppSettings, showToast }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const attachments = appSettings?.attachments || [];

  const allVisaTypes = useMemo(() => {
    const durations = appSettings?.visaDurations || {};
    const types = [];
    Object.entries(durations).forEach(([catId, items]) => {
      if (Array.isArray(items)) {
        items.forEach(item => {
          const name = typeof item === 'string' ? item : item.name;
          if (name) types.push(name);
        });
      }
    });
    return types;
  }, [appSettings?.visaDurations]);

  const uploadFile = async (file) => {
    if (!file) return;
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) { showToast?.('Dosya 10MB\'dan büyük olamaz', 'error'); return; }
    setUploading(true);
    try {
      const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const storage = getStorage();
      const path = `mail-attachments/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      const newAtt = { id: Date.now().toString(), name: file.name, url, path, size: file.size, linkedTypes: [] };
      setAppSettings({ ...appSettings, attachments: [...attachments, newAtt] });
      showToast?.(`✅ ${file.name} yüklendi`, 'success');
    } catch (err) {
      showToast?.(`❌ Yükleme hatası: ${err.message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (att) => {
    if (!confirm(`"${att.name}" dosyasını silmek istiyor musunuz?`)) return;
    try {
      const { getStorage, ref, deleteObject } = await import('firebase/storage');
      const storage = getStorage();
      await deleteObject(ref(storage, att.path));
    } catch (e) { /* storage'dan silinemediyse devam et */ }
    setAppSettings({ ...appSettings, attachments: attachments.filter(a => a.id !== att.id) });
    showToast?.('Dosya silindi', 'info');
  };

  const toggleLinkedType = (attId, typeName) => {
    const updated = attachments.map(a => {
      if (a.id !== attId) return a;
      const linked = a.linkedTypes || [];
      return { ...a, linkedTypes: linked.includes(typeName) ? linked.filter(t => t !== typeName) : [...linked, typeName] };
    });
    setAppSettings({ ...appSettings, attachments: updated });
  };

  const formatSize = (bytes) => bytes < 1024*1024 ? `${(bytes/1024).toFixed(0)} KB` : `${(bytes/1024/1024).toFixed(1)} MB`;

  const [expandedId, setExpandedId] = useState(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Yükleme alanı */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) uploadFile(f); }}
        style={{ border: `2px dashed ${dragOver ? '#a855f7' : 'rgba(168,85,247,0.3)'}`, borderRadius: '16px', padding: '32px', textAlign: 'center', background: dragOver ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)', transition: 'all 0.2s', cursor: 'pointer' }}
        onClick={() => document.getElementById('attFileInput').click()}
      >
        <input id="attFileInput" type="file" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) uploadFile(e.target.files[0]); e.target.value=''; }} />
        {uploading ? (
          <div style={{ color: '#a855f7', fontSize: '14px' }}>⏳ Yükleniyor...</div>
        ) : (
          <>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📎</div>
            <div style={{ fontSize: '14px', color: '#a855f7', fontWeight: '600' }}>Dosya yükle</div>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>Tıkla veya sürükle-bırak • PDF, Word, Excel • Max 10MB</div>
          </>
        )}
      </div>

      {/* Dosya listesi */}
      {attachments.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#475569', fontSize: '13px', padding: '20px' }}>
          Henüz dosya yüklenmemiş
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h3 style={{ fontSize: '14px', color: '#94a3b8' }}>📁 Yüklü Dosyalar ({attachments.length})</h3>
          {attachments.map(att => (
            <div key={att.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', overflow: 'hidden' }}>
              {/* Dosya başlığı */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px' }}>
                <span style={{ fontSize: '20px' }}>
                  {att.name.endsWith('.pdf') ? '📄' : att.name.match(/\.(doc|docx)$/) ? '📝' : att.name.match(/\.(xls|xlsx)$/) ? '📊' : '📎'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: '#e8f1f8', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</div>
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                    {att.size ? formatSize(att.size) : ''} •{' '}
                    <span style={{ color: att.linkedTypes?.length > 0 ? '#10b981' : '#f59e0b' }}>
                      {att.linkedTypes?.length > 0 ? `${att.linkedTypes.length} vize türüne bağlı` : 'Bağlantı yok'}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button onClick={() => window.open(att.url, '_blank')}
                    style={{ padding: '6px 10px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', color: '#60a5fa', cursor: 'pointer', fontSize: '11px' }}>
                    👁 Görüntüle
                  </button>
                  <button onClick={() => setExpandedId(expandedId === att.id ? null : att.id)}
                    style={{ padding: '6px 10px', background: 'rgba(168,85,247,0.2)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: '6px', color: '#c084fc', cursor: 'pointer', fontSize: '11px' }}>
                    🔗 Bağla
                  </button>
                  <button onClick={() => removeAttachment(att)}
                    style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#f87171', cursor: 'pointer', fontSize: '11px' }}>
                    🗑
                  </button>
                </div>
              </div>

              {/* Vize türü bağlama paneli */}
              {expandedId === att.id && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '14px 16px', background: 'rgba(168,85,247,0.04)' }}>
                  <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>
                    Bu dosyanın hangi vize türlerine otomatik ek olarak gönderileceğini seçin:
                  </p>
                  {allVisaTypes.length === 0 ? (
                    <p style={{ fontSize: '12px', color: '#475569' }}>Vize Ayarları'nda önce vize türü ekleyin.</p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {allVisaTypes.map(typeName => {
                        const linked = att.linkedTypes?.includes(typeName);
                        return (
                          <button key={typeName} onClick={() => toggleLinkedType(att.id, typeName)}
                            style={{ padding: '6px 10px', borderRadius: '6px', border: `1px solid ${linked ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.1)'}`, background: linked ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.03)', color: linked ? '#c084fc' : '#64748b', cursor: 'pointer', fontSize: '11px', fontWeight: linked ? '600' : '400' }}>
                            {linked ? '✓ ' : ''}{typeName}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MailSettingsPanel({ appSettings, setAppSettings, showToast }) {
  const allVisaTypes = useMemo(() => {
    const durations = appSettings?.visaDurations || {};
    const types = [];
    const catLabels = { schengen: '🇪🇺 Schengen', usa: '🇺🇸 Amerika', russia: '🇷🇺 Rusya', uk: '🇬🇧 İngiltere', uae: '🇦🇪 BAE', china: '🇨🇳 Çin' };
    Object.entries(durations).forEach(([catId, items]) => {
      if (Array.isArray(items)) {
        items.forEach(item => {
          const name = typeof item === 'string' ? item : item.name;
          if (name) types.push({ key: name, label: name, cat: catLabels[catId] || catId });
        });
      }
    });
    return types;
  }, [appSettings?.visaDurations]);

  const [activeKey, setActiveKey] = useState(allVisaTypes[0]?.key || '');
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTypes = allVisaTypes.filter(t =>
    t.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.cat.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const currentTemplate = appSettings?.emailTemplates?.[activeKey] || { subject: '', body: '' };

  const updateTemplate = (field, value) => {
    setAppSettings({
      ...appSettings,
      emailTemplates: {
        ...(appSettings.emailTemplates || {}),
        [activeKey]: { ...currentTemplate, [field]: value }
      }
    });
  };

  const sendTest = async () => {
    if (!testEmail.trim()) return;
    setTestSending(true);
    const result = await sendVisaEmail({
      visa: { id: 'TEST001', categoryId: 'schengen', country: 'Test', visaDuration: activeKey, customerEmail: testEmail },
      customer: { firstName: 'Test', lastName: 'Müşteri', email: testEmail },
      appSettings
    });
    setTestSending(false);
    if (result.ok) showToast?.('✅ Test maili gönderildi', 'success');
    else showToast?.(`❌ Hata: ${result.error}`, 'error');
  };

  const hasTemplate = (key) => {
    const t = appSettings?.emailTemplates?.[key];
    return t && (t.subject || t.body);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ background: 'rgba(20,184,166,0.08)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(20,184,166,0.2)' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '15px', color: '#14b8a6' }}>⚙️ SMTP Yapılandırması</h3>
        <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>SMTP bilgileri Netlify Environment Variables olarak saklanır.</p>
        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '10px', padding: '14px', fontFamily: 'monospace', fontSize: '12px', color: '#94a3b8', lineHeight: 1.8 }}>
          <div><span style={{ color: '#14b8a6' }}>SMTP_HOST</span> = smtp.yandex.com</div>
          <div><span style={{ color: '#14b8a6' }}>SMTP_PORT</span> = 465</div>
          <div><span style={{ color: '#14b8a6' }}>SMTP_USER</span> = vize@paydostur.com</div>
          <div><span style={{ color: '#14b8a6' }}>SMTP_PASS</span> = ••••••••••••</div>
          <div><span style={{ color: '#14b8a6' }}>SMTP_FROM</span> = vize@paydostur.com</div>
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#e8f1f8' }}>🤖 Otomatik Mail Gönderimi</h3>
            <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Yeni vize başvurusu oluşturulunca müşteriye otomatik bilgilendirme maili gönder</p>
          </div>
          <div onClick={() => setAppSettings({ ...appSettings, autoEmailOnVisa: !appSettings?.autoEmailOnVisa })}
            style={{ width: '48px', height: '26px', borderRadius: '13px', cursor: 'pointer', background: appSettings?.autoEmailOnVisa !== false ? '#14b8a6' : 'rgba(255,255,255,0.1)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: '3px', left: appSettings?.autoEmailOnVisa !== false ? '25px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
          </div>
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#e8f1f8' }}>✉️ Vize Türü Bazlı Mail Şablonları</h3>
        <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>
          Her vize türü için ayrı şablon. Vize Ayarları'nda yeni tür eklenince burada otomatik görünür.<br/>
          Değişkenler:{" "}
          {['{isim}','{ulke}','{tarih}','{ref_no}','{vize_turu}'].map(v => (
            <code key={v} style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 5px', borderRadius: '4px', fontSize: '11px', marginRight: '4px' }}>{v}</code>
          ))}
        </p>
        {allVisaTypes.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '13px' }}>⚠️ Henüz vize türü eklenmemiş. Vize Ayarları bölümünden ekleyin.</p>
        ) : (
          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="🔍 Tür ara..."
                style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '12px' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '380px', overflowY: 'auto' }}>
                {filteredTypes.map(t => (
                  <button key={t.key} onClick={() => setActiveKey(t.key)}
                    style={{ padding: '10px 12px', border: `1px solid ${activeKey === t.key ? 'rgba(20,184,166,0.5)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '8px', background: activeKey === t.key ? 'rgba(20,184,166,0.15)' : 'rgba(255,255,255,0.03)', color: activeKey === t.key ? '#14b8a6' : '#94a3b8', cursor: 'pointer', textAlign: 'left', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontWeight: activeKey === t.key ? '600' : '400' }}>{t.label}</span>
                    <span style={{ fontSize: '10px', color: '#475569' }}>{t.cat}</span>
                    <span style={{ fontSize: '10px', color: hasTemplate(t.key) ? '#10b981' : '#f59e0b' }}>{hasTemplate(t.key) ? '✓ Şablon var' : '⚠ Şablon yok'}</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {activeKey ? (
                <>
                  <div style={{ padding: '10px 14px', background: 'rgba(20,184,166,0.08)', borderRadius: '8px', border: '1px solid rgba(20,184,166,0.2)' }}>
                    <span style={{ fontSize: '13px', color: '#14b8a6', fontWeight: '600' }}>✏️ {activeKey}</span>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>📌 Mail Konusu</label>
                    <input value={currentTemplate.subject} onChange={e => updateTemplate('subject', e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' }} placeholder="Mail konusu..." />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>📝 Mail İçeriği</label>
                    <textarea value={currentTemplate.body} onChange={e => updateTemplate('body', e.target.value)} rows={14}
                      style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.6', boxSizing: 'border-box' }} placeholder="Mail içeriği..." />
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#475569', fontSize: '13px' }}>← Soldan bir vize türü seçin</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#e8f1f8' }}>🧪 Test Maili Gönder</h3>
        <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>Seçili şablonu ({activeKey || 'seçilmedi'}) test etmek için bir adrese gönder</p>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="test@ornek.com"
            style={{ flex: 1, padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px' }} />
          <button onClick={sendTest} disabled={testSending || !testEmail.trim() || !activeKey}
            style={{ padding: '10px 18px', background: testSending ? 'rgba(20,184,166,0.3)' : 'linear-gradient(135deg, #14b8a6, #0d9488)', border: 'none', borderRadius: '8px', color: 'white', cursor: testSending ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '13px', whiteSpace: 'nowrap' }}>
            {testSending ? '⏳ Gönderiliyor...' : '📤 Test Gönder'}
          </button>
        </div>
      </div>
    </div>
  );
}

async function sendVisaEmail({ visa, customer, appSettings }) {
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
    const html = `<pre style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${bodyText}</pre>`;

    // Vize türüne bağlı ekleri bul
    const allAttachments = appSettings?.attachments || [];
    const linkedAttachments = allAttachments.filter(a => a.linkedTypes?.includes(vize_turu));

    const resp = await fetch('/.netlify/functions/send-mail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject,
        html,
        text: bodyText,
        attachments: linkedAttachments.map(a => ({ filename: a.name, url: a.url }))
      })
    });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data.error || 'Gönderim hatası' };
    return { ok: true, attachmentCount: linkedAttachments.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function VisaModule({ customers, visaApplications, setVisaApplications, isMobile, onNavigateToCustomers, appSettings, showToast, addToUndo, creditCards }) {
  const [activeTab, setActiveTab] = useState('calendar');
  const [showForm, setShowForm] = useState(false);
  const [formStep, setFormStep] = useState('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [visaSearchQuery, setVisaSearchQuery] = useState('');
  const [visaStatusFilter, setVisaStatusFilter] = useState('all');
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
  const visaStatuses = appSettings?.visaStatuses?.length > 0
    ? appSettings.visaStatuses
    : ['Evrak Topluyor', 'Evrak Tamamlandı', 'Randevu Alındı', 'Başvuru Yapıldı', 'Sonuç Bekliyor', 'Onaylandı', 'Reddedildi', 'Ödenmedi'];

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
  const filteredVisaApplications = visaApplications.filter(v => {
    const matchSearch = visaSearchQuery.length < 2 || (
      v.customerName?.toLowerCase().includes(visaSearchQuery.toLowerCase()) ||
      v.customerPhone?.includes(visaSearchQuery) ||
      v.country?.toLowerCase().includes(visaSearchQuery.toLowerCase()) ||
      v.pnr?.toLowerCase().includes(visaSearchQuery.toLowerCase())
    );
    const matchStatus = visaStatusFilter === 'all' ? true
      : visaStatusFilter === '__odenmedi__' ? (!v.paymentStatus || v.paymentStatus === 'Ödenmedi')
      : v.status === visaStatusFilter;
    return matchSearch && matchStatus;
  });

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
      label: '',
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
    const fullPhone = '90' + phone.replace(/^(90|0)/, '');
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
    const fullPhone = '90' + phone.replace(/^(90|0)/, '');
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
    if (!formData.visaType && !formData.visaDuration) {
      showToast?.('Vize türü seçiniz', 'error');
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

        // Otomatik mail gönder
        if (appSettings?.autoEmailOnVisa !== false) {
          const customer = customers?.find(c =>
            c.id === formData.customerId ||
            `${c.firstName} ${c.lastName}`.trim() === formData.customerName
          );
          sendVisaEmail({ visa: newVisa, customer, appSettings }).then(result => {
            if (result.ok) showToast?.('📧 Müşteriye bilgilendirme maili gönderildi', 'success');
            else if (result.error !== 'Müşteri e-postası yok') showToast?.(`⚠️ Mail: ${result.error}`, 'warning');
          });
        }
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

    // Firestore'dan sil
    try {
      const docId = visaToDelete._docId || visaToDelete.id?.toString();
      if (docId) await deleteDoc(doc(db, 'visa_applications', docId));
    } catch(e) { console.warn('Firestore visa silme hatası:', e.message); }
    
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
              {/* Vize Türü — Ayarlardan Otomatik */}
              {(() => {
                const cat = selectedCategory.id; // 'schengen', 'usa' vs
                const types = appSettings?.visaDurations?.[cat] || [];
                if (types.length === 0) return (
                  <div style={{ padding: '16px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '10px' }}>
                    <p style={{ margin: 0, fontSize: '12px', color: '#f59e0b' }}>⚠️ Henüz vize türü eklenmemiş. Ayarlar → Vize Türleri ve Fiyatları bölümünden ekleyin.</p>
                  </div>
                );
                return (
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
                      Vize Türü * {formData.visaDuration && <span style={{ color: selectedCategory.color }}>✓ {formData.visaDuration}</span>}
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                      {types.map((d, idx) => {
                        const name = typeof d === 'string' ? d : d.name;
                        const price = typeof d === 'object' ? d.price : 0;
                        const currency = typeof d === 'object' ? (d.currency || '€') : '€';
                        const selected = formData.visaDuration === name;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setFormData({ ...formData, visaDuration: name, visaPrice: price, visaCurrency: currency })}
                            style={{
                              padding: '12px 10px', textAlign: 'left',
                              background: selected ? `${selectedCategory.color}25` : 'rgba(255,255,255,0.05)',
                              border: selected ? `2px solid ${selectedCategory.color}` : '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '10px', color: selected ? selectedCategory.color : '#e8f1f8',
                              cursor: 'pointer', fontSize: '12px', fontWeight: selected ? '700' : '400',
                              display: 'flex', flexDirection: 'column', gap: '3px'
                            }}
                          >
                            <span>{selectedCategory.icon} {name}</span>
                            {price > 0 && <span style={{ fontSize: '11px', opacity: 0.7 }}>{price} {currency}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

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

              {/* PNR + Etiket */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>PNR / Referans No</label>
                  <input type="text" value={formData.pnr || ''} onChange={e => setFormData({...formData, pnr: e.target.value})} placeholder="Randevu PNR numarası" style={{ width: '100%', padding: '12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#ffffff', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Etiket</label>
                  <input type="text" value={formData.label || ''} onChange={e => setFormData({...formData, label: e.target.value})} placeholder="Örn: VIP, Acil..." style={{ width: '100%', padding: '12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#ffffff', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
              </div>

              {/* Ödeme Durumu + Kredi Kartı */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Vize Ücreti</label>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  {paymentStatuses.map(ps => (
                    <button key={ps} type="button" onClick={() => setFormData({...formData, paymentStatus: ps})} style={{ flex: 1, padding: '10px', background: formData.paymentStatus === ps ? (ps === 'Ödendi' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)') : 'rgba(255,255,255,0.05)', border: formData.paymentStatus === ps ? `2px solid ${ps === 'Ödendi' ? '#10b981' : '#ef4444'}` : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: formData.paymentStatus === ps ? (ps === 'Ödendi' ? '#10b981' : '#ef4444') : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: formData.paymentStatus === ps ? '600' : '400' }}>
                      {ps === 'Ödendi' ? '✓' : '✗'} {ps}
                    </button>
                  ))}
                </div>
                {creditCards && creditCards.length > 0 && (
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>💳 Ödeme Kartı</label>
                    <select value={formData.paymentCardId || ''} onChange={e => setFormData({...formData, paymentCardId: e.target.value})} style={{ width: '100%', padding: '10px 12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}>
                      <option value="">— Kart seçiniz —</option>
                      {creditCards.map(card => (
                        <option key={card.id} value={card.id}>💳 {card.cardName} {card.bank ? `(${card.bank})` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Durum - Butonlar - Dinamik */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Başvuru Durumu</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {(appSettings?.visaStatuses || ['Evrak Topluyor', 'Evrak Tamamlandı', 'Randevu Alındı', 'Başvuru Yapıldı', 'Sonuç Bekliyor', 'Onaylandı', 'Reddedildi', 'Ödenmedi']).map(s => (
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
                <button type="button" onClick={() => { const phone = formData.customerPhone?.replace(/\D/g, ''); if (phone) window.open(`https://wa.me/90${phone.replace(/^(90|0)/,'')}`, '_blank'); }} style={{ padding: '12px', background: 'rgba(37,211,102,0.2)', border: '1px solid rgba(37,211,102,0.3)', borderRadius: '8px', color: '#25d366', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                  💬 WhatsApp
                </button>
                <button type="button" onClick={() => { if (formData.customerEmail) window.open(`mailto:${formData.customerEmail}`, '_blank'); else alert('E-posta adresi bulunamadı'); }} style={{ padding: '12px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                  📧 E-posta
                </button>
                <button type="button" onClick={async () => {
                  if (!formData.customerEmail) { showToast?.('Müşterinin e-posta adresi yok', 'error'); return; }
                  const visa = {
                    id: editingVisa?.id || Date.now().toString(),
                    categoryId: selectedCategory?.id || 'schengen',
                    country: formData.country || '',
                    visaDuration: formData.visaDuration || formData.visaType || '',
                    customerEmail: formData.customerEmail
                  };
                  const customer = customers?.find(c => c.id === formData.customerId) || {
                    firstName: (formData.customerName || '').split(' ')[0],
                    lastName: (formData.customerName || '').split(' ').slice(1).join(' '),
                    email: formData.customerEmail
                  };
                  showToast?.('📧 Bilgi maili gönderiliyor...', 'info');
                  const result = await sendVisaEmail({ visa, customer, appSettings });
                  if (result.ok) showToast?.('📧 Bilgi maili gönderildi', 'success');
                  else showToast?.(`❌ Mail gönderilemedi: ${result.error}`, 'error');
                }} style={{ padding: '12px', background: 'rgba(20,184,166,0.2)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: '8px', color: '#14b8a6', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                  📨 Bilgi Maili
                </button>
              </div>

              {/* Randevu Bilgisi Gönder */}
              {formData.appointmentDate && (
                <button type="button" onClick={() => {
                  if (!formData.customerPhone) { alert('Telefon numarası bulunamadı!'); return; }
                  let message = appSettings?.whatsappTemplate || 'Randevu: {tarih} {saat}';
                  message = message.replace('{isim}', formData.customerName || '').replace('{ulke}', formData.country || '').replace('{tarih}', formatDate(formData.appointmentDate) || '').replace('{saat}', formData.appointmentTime || '-').replace('{pnr}', formData.pnr || '-');
                  const phone = formData.customerPhone.replace(/\D/g, '');
                  const fullPhone = '90' + phone.replace(/^(90|0)/, '');
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

      {/* Durum Filtresi + Takvim/Hatırlatmalar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Takvim ve Hatırlatmalar küçük butonlar */}
        <button onClick={() => { setActiveTab('calendar'); setVisaStatusFilter('all'); }}
          style={{ padding: '8px 12px', background: activeTab === 'calendar' ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.06)', border: activeTab === 'calendar' ? '1px solid rgba(245,158,11,0.4)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: activeTab === 'calendar' ? '#f59e0b' : '#64748b', cursor: 'pointer', fontSize: '14px' }} title="Takvim">
          📅
        </button>
        <button onClick={() => { setActiveTab('reminders'); setVisaStatusFilter('all'); }}
          style={{ padding: '8px 12px', background: activeTab === 'reminders' ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.06)', border: activeTab === 'reminders' ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: activeTab === 'reminders' ? '#ef4444' : '#64748b', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
          ⏰ {upcomingReminders.length > 0 && <span style={{ background: '#ef4444', borderRadius: '50%', padding: '1px 5px', fontSize: '10px', marginLeft: '4px' }}>{upcomingReminders.length}</span>}
        </button>
        {/* Ayırıcı */}
        <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.1)' }} />
        {/* Durum filtre butonları */}
        <button onClick={() => { setActiveTab('all'); setVisaStatusFilter('all'); }}
          style={{ padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '600', border: 'none', background: activeTab === 'all' && visaStatusFilter === 'all' ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.05)', color: activeTab === 'all' && visaStatusFilter === 'all' ? '#3b82f6' : '#64748b' }}>
          Tümü ({visaApplications.length})
        </button>
        {visaStatuses.map(s => (
          <button key={s} onClick={() => { setActiveTab('all'); setVisaStatusFilter(s); }}
            style={{ padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '600', border: 'none', background: activeTab === 'all' && visaStatusFilter === s ? `${getStatusColor(s)}30` : 'rgba(255,255,255,0.05)', color: activeTab === 'all' && visaStatusFilter === s ? getStatusColor(s) : '#64748b' }}>
            {s} ({visaApplications.filter(v => v.status === s).length})
          </button>
        ))}
        <button onClick={() => { setActiveTab('all'); setVisaStatusFilter('__odenmedi__'); }}
          style={{ padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '600', border: 'none', background: visaStatusFilter === '__odenmedi__' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.05)', color: visaStatusFilter === '__odenmedi__' ? '#ef4444' : '#64748b' }}>
          💸 Ödenmedi ({visaApplications.filter(v => !v.paymentStatus || v.paymentStatus === 'Ödenmedi').length})
        </button>
      </div>

      {/* TAKVİM */}
      {activeTab === 'calendar' && (
        <div style={{ maxWidth: '900px' }}>
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
function ToursModule({ tours, setTours, customers, isMobile, showToast, addToUndo, appSettings, onNavigateToCustomer }) {
  const [showForm, setShowForm] = useState(false);
  const [showReservationForm, setShowReservationForm] = useState(false);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [selectedTour, setSelectedTour] = useState(null);
  const [editingTour, setEditingTour] = useState(null);
  const [editingReservation, setEditingReservation] = useState(null);
  const [roomingTour, setRoomingTour] = useState(null);
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

  const deleteTour = async (tour) => {
    if (window.confirm(`"${tour.name}" turunu silmek istediğinizden emin misiniz?`)) {
      const old = [...tours];
      setTours(tours.filter(t => t.id !== tour.id));
      showToast('Tur silindi', 'success');
      addToUndo(() => setTours(old), 'Tur silme');
      try {
        const docId = tour._docId || String(tour.id);
        await deleteDoc(doc(db, 'tours', docId));
      } catch(e) { console.warn('Tur Firestore silme hatası:', e.message); }
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
      tourPrice: tour.prices?.doubleRoom?.amount || 0,
      currency: tour.prices?.doubleRoom?.currency || '€',
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
      // Pasaport — en son geçerli pasaport
      const passports = safeParseJSON(customer.passports);
      const validPassport = passports.find(p => p.passportNo && getDaysLeft(p.expiryDate) > 0) || passports[0];

      // Vize durumu — tur ülkesi Schengen mi?
      const isSchengen = schengenCountries.includes(selectedTour?.country);
      let hasVisa = false;
      let visaEndDate = '';
      if (isSchengen) {
        const visas = safeParseJSON(customer.schengenVisas);
        const validVisa = visas.find(v => v.endDate && getDaysLeft(v.endDate) > 0);
        if (validVisa) { hasVisa = true; visaEndDate = validVisa.endDate; }
      } else if (selectedTour?.country === 'Amerika Birleşik Devletleri' || selectedTour?.country === 'ABD') {
        const usaVisa = typeof customer.usaVisa === 'string' ? JSON.parse(customer.usaVisa || '{}') : (customer.usaVisa || {});
        if (usaVisa.endDate && getDaysLeft(usaVisa.endDate) > 0) { hasVisa = true; visaEndDate = usaVisa.endDate; }
      }

      setReservationData({
        ...reservationData,
        customerId: custId,
        customerName: customer.name || `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
        customerPhone: customer.phone || '',
        customerEmail: customer.email || '',
        company: customer.companyName || customer.company || '',
        passport: validPassport?.passportNo || '',
        hasVisa,
        visaEndDate,
      });
    }
  };

  const handleRoomTypeChange = (e) => {
    const roomType = e.target.value;
    setReservationData({ ...reservationData, roomType });
  };

  const openEditReservation = (tour, res) => {
    setSelectedTour(tour);
    setEditingReservation(res);
    setReservationData({ ...res });
    setShowReservationForm(true);
  };

  const saveReservation = () => {
    if (!reservationData.customerId || !reservationData.customerName) {
      showToast('Lütfen müşteri seçin', 'error');
      return;
    }

    let updatedTours;
    if (editingReservation) {
      // Düzenleme modu
      updatedTours = tours.map(t => {
        if (t.id === selectedTour.id) {
          return { ...t, reservations: t.reservations.map(r => r.id === editingReservation.id ? { ...reservationData, id: r.id, sNo: r.sNo } : r) };
        }
        return t;
      });
      showToast('Rezervasyon güncellendi', 'success');
    } else {
      // Yeni ekleme
      const newReservation = { ...reservationData, id: Date.now(), sNo: (selectedTour.reservations?.length || 0) + 1 };
      updatedTours = tours.map(t => {
        if (t.id === selectedTour.id) {
          return { ...t, reservations: [...(t.reservations || []), newReservation] };
        }
        return t;
      });
      showToast('Rezervasyon eklendi', 'success');
    }

    setTours(updatedTours);
    setSelectedTour(updatedTours.find(t => t.id === selectedTour.id));
    setShowReservationForm(false);
    setEditingReservation(null);
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
        r.roomType || "-",
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
      {!selectedTour && <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="🔍 Tur ara (isim, ülke, şehir)..."
          style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }}
        />
      </div>}

      {/* Tabs */}
      {!selectedTour && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
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
      </div>}

      {/* Tours Grid — sadece liste, selectedTour yokken */}
      {!selectedTour && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
          {filteredTours.map(tour => {
            const activeRes = tour.reservations?.filter(r => !r.cancelled).length || 0;
            const totalRes = tour.reservations?.length || 0;
            return (
              <div key={tour.id} onClick={() => setSelectedTour(tour)}
                style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '14px', padding: '20px', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', transition: 'border-color 0.2s, background 0.2s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.4)'; e.currentTarget.style.background = 'rgba(245,158,11,0.04)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#ffffff', lineHeight: '1.3', flex: 1, paddingRight: '8px' }}>{tour.name}</h3>
                  <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', flexShrink: 0, fontWeight: '600',
                    background: tour.status === 'Aktif' ? 'rgba(34,197,94,0.2)' : tour.status === 'Tamamlandı' ? 'rgba(59,130,246,0.2)' : 'rgba(239,68,68,0.2)',
                    color: tour.status === 'Aktif' ? '#22c55e' : tour.status === 'Tamamlandı' ? '#3b82f6' : '#ef4444'
                  }}>{tour.status}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>🌍 {tour.country}{tour.city ? ` — ${tour.city}` : ''}</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>📅 {formatDate(tour.startDate)} → {formatDate(tour.endDate)}</div>
                  <div style={{ fontSize: '13px', color: activeRes > 0 ? '#f59e0b' : '#64748b', fontWeight: activeRes > 0 ? '600' : '400' }}>
                    👥 {activeRes} aktif rezervasyon{totalRes !== activeRes ? ` (${totalRes - activeRes} iptal)` : ''}
                  </div>
                  {tour.pdfUrl && <div style={{ fontSize: '11px', color: '#3b82f6' }}>📄 Program PDF mevcut</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TUR DETAY — tam sayfa, selectedTour varken */}
      {selectedTour && (() => {
        const tour = tours.find(t => t.id === selectedTour.id) || selectedTour;
        const activeRes = tour.reservations?.filter(r => !r.cancelled) || [];
        const cancelledRes = tour.reservations?.filter(r => r.cancelled) || [];
        return (
          <div>
            {/* Detay Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <button onClick={() => setSelectedTour(null)} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 16px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px' }}>← Geri</button>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>{tour.name}</h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>🌍 {tour.country}{tour.city ? ` — ${tour.city}` : ''} &nbsp;|&nbsp; 📅 {formatDate(tour.startDate)} → {formatDate(tour.endDate)}</p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {tour.pdfUrl && <button onClick={() => window.open(tour.pdfUrl, '_blank')} style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>📄 PDF</button>}
                <button onClick={() => exportToExcel(tour)} style={{ padding: '8px 14px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', color: '#10b981', cursor: 'pointer', fontSize: '12px' }}>📥 Excel</button>
                <button onClick={() => setRoomingTour(roomingTour?.id === tour.id ? null : tour)} style={{ padding: '8px 14px', background: roomingTour?.id === tour.id ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', color: '#8b5cf6', cursor: 'pointer', fontSize: '12px' }}>🏨 Odalama</button>
                <button onClick={() => openReservationForm(tour)} style={{ padding: '8px 14px', background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', color: '#22c55e', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>➕ Rezervasyon</button>
                <button onClick={() => { openEditForm(tour); setSelectedTour(null); }} style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', color: '#f59e0b', cursor: 'pointer', fontSize: '12px' }}>✏️ Düzenle</button>
                <button onClick={() => { deleteTour(tour); setSelectedTour(null); }} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🗑️</button>
              </div>
            </div>

            {/* Rezervasyon İstatistikleri */}

            {/* Özet */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
              {(() => {
                const totalBedel = activeRes.reduce((s, r) => s + (r.tourPrice || 0), 0);
                const totalOdenen = activeRes.reduce((s, r) => s + (r.payment1 || 0) + (r.payment2 || 0) + (r.payment3 || 0), 0);
                const totalOdenmemis = totalBedel - totalOdenen;
                const cur = activeRes[0]?.currency || '€';
                return [
                  { label: 'Aktif Rezervasyon', value: activeRes.length, color: '#10b981', suffix: '' },
                  { label: 'İptal', value: cancelledRes.length, color: '#ef4444', suffix: '' },
                  { label: 'Toplam Ödenen', value: totalOdenen.toLocaleString('tr'), color: '#10b981', suffix: ` ${cur}` },
                  { label: 'Ödenmemiş', value: totalOdenmemis > 0 ? totalOdenmemis.toLocaleString('tr') : '0', color: totalOdenmemis > 0 ? '#ef4444' : '#64748b', suffix: ` ${cur}` },
                ];
              })().map(s => (
                <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '12px', textAlign: 'center', border: `1px solid ${s.color}20` }}>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: s.color }}>{s.value}{s.suffix}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Rezervasyon Tablosu */}
            {(tour.reservations?.length || 0) === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', background: 'rgba(255,255,255,0.02)', borderRadius: '12px' }}>
                <p style={{ fontSize: '32px', margin: '0 0 10px' }}>📋</p>
                <p>Henüz rezervasyon yok</p>
                <button onClick={() => openReservationForm(tour)} style={{ marginTop: '12px', padding: '10px 20px', background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', color: '#22c55e', cursor: 'pointer', fontSize: '13px' }}>➕ İlk Rezervasyonu Ekle</button>
              </div>
            ) : (() => {
              const aktifRes = tour.reservations.filter(r => !r.cancelled);
              const iptalRes = tour.reservations.filter(r => r.cancelled);

              const renderRow = (res) => {
                const totalPaid = (res.payment1 || 0) + (res.payment2 || 0) + (res.payment3 || 0);
                const fullyPaid = totalPaid >= (res.tourPrice || 0);

                        // Vize Durumu Hesaplama
                        const getVisaStatus = () => {
                          // Tur ülkesi Schengen mi?
                          const isSchengen = schengenCountries.includes(tour.country);
                          if (!isSchengen) return null; // Schengen değilse gösterme

                          // Müşteriyi customers listesinden bul
                          const customer = customers.find(c =>
                            `${c.firstName} ${c.lastName}`.toLowerCase() === res.customerName?.toLowerCase()
                          );
                          if (!customer) return { label: 'Müşteri Bulunamadı', color: '#64748b', bg: 'rgba(100,116,139,0.2)' };

                          const visas = safeParseJSON(customer.schengenVisas);
                          const validVisa = visas.find(v => {
                            if (!v.endDate || !v.country) return false;
                            const days = getDaysLeft(v.endDate);
                            return days !== null && days > 0;
                          });

                          if (!validVisa) {
                            // Süresi bitmiş vize var mı?
                            const expiredVisa = visas.find(v => v.endDate && getDaysLeft(v.endDate) !== null && getDaysLeft(v.endDate) <= 0);
                            if (expiredVisa) return { label: `Süresi Doldu (${formatDate(expiredVisa.endDate)})`, color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
                            return { label: 'Vize Yok', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
                          }

                          // Tur tarihine kadar vize geçerli mi?
                          const tourEndDate = tour.endDate;
                          if (tourEndDate) {
                            const visaExpiry = getDaysLeft(validVisa.endDate);
                            const tourDays = getDaysLeft(tourEndDate);
                            if (visaExpiry !== null && tourDays !== null && visaExpiry < tourDays) {
                              return { label: `Tur Tarihinde Bitiyor (${formatDate(validVisa.endDate)})`, color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
                            }
                          }

                          const daysLeft = getDaysLeft(validVisa.endDate);
                          if (daysLeft !== null && daysLeft <= 90) {
                            return { label: `Var — ${daysLeft} gün`, color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
                          }
                          return { label: `Var (${validVisa.country})`, color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
                        };

                        const visaStatus = getVisaStatus();

                        return (
                          <tr key={res.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: res.cancelled ? 0.45 : 1, background: res.cancelled ? 'rgba(239,68,68,0.03)' : 'transparent' }}>
                            <td style={{ padding: '10px 12px', fontWeight: '600', textDecoration: res.cancelled ? 'line-through' : 'none' }}>
                              <span
                                onClick={() => {
                                  const found = customers.find(c =>
                                    `${c.firstName} ${c.lastName}`.toLowerCase() === res.customerName?.toLowerCase()
                                  );
                                  if (found && onNavigateToCustomer) onNavigateToCustomer(found);
                                }}
                                style={{ cursor: 'pointer', color: '#93c5fd', textDecoration: 'underline dotted', textUnderlineOffset: '3px' }}
                                title="Profili aç"
                              >
                                {res.customerName}
                              </span>
                              {res.cancelled && <span style={{ fontSize: '9px', color: '#ef4444', marginLeft: '4px', display: 'block', textDecoration: 'none' }}>İPTAL</span>}
                            </td>
                            <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: '11px' }}>
                              {res.roomType || '-'}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {visaStatus ? (
                                <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', background: visaStatus.bg, color: visaStatus.color, fontWeight: '600', whiteSpace: 'nowrap' }}>
                                  {visaStatus.label}
                                </span>
                              ) : (
                                <span style={{ color: '#475569', fontSize: '10px' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', color: '#f59e0b', fontWeight: '600', whiteSpace: 'nowrap' }}>
                              {res.tourPrice > 0 ? `${res.tourPrice} ${res.currency || '€'}` : '-'}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {res.tourPrice > 0 ? (
                                <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', fontWeight: '600', background: fullyPaid ? 'rgba(16,185,129,0.15)' : totalPaid > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.1)', color: fullyPaid ? '#10b981' : totalPaid > 0 ? '#f59e0b' : '#ef4444' }}>
                                  {fullyPaid ? '✓ Ödendi' : totalPaid > 0 ? `${totalPaid} ${res.currency || '€'}` : 'Ödenmedi'}
                                </span>
                              ) : <span style={{ color: '#475569', fontSize: '11px' }}>—</span>}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button onClick={() => openEditReservation(tour, res)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '14px' }} title="Düzenle">✏️</button>
                                {res.cancelled ? (
                                  <button onClick={() => { const u = tours.map(t => t.id === tour.id ? {...t, reservations: t.reservations.map(r => r.id === res.id ? {...r, cancelled: false, cancelledAt: null} : r)} : t); setTours(u); setSelectedTour(u.find(t => t.id === tour.id)); showToast('Rezervasyon geri alındı', 'success'); }} style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', fontSize: '14px' }} title="Geri Al">↩</button>
                                ) : (
                                  <button onClick={() => { if (window.confirm(`${res.customerName} rezervasyonunu iptal etmek istiyor musunuz?`)) { const u = tours.map(t => t.id === tour.id ? {...t, reservations: t.reservations.map(r => r.id === res.id ? {...r, cancelled: true, cancelledAt: new Date().toISOString()} : r)} : t); setTours(u); setSelectedTour(u.find(t => t.id === tour.id)); showToast('Rezervasyon iptal edildi', 'warning'); } }} style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: '14px' }} title="İptal Et">⊘</button>
                                )}
                                <button onClick={() => { if (window.confirm('Bu rezervasyonu kalıcı sil?')) { const u = tours.map(t => t.id === tour.id ? {...t, reservations: t.reservations.filter(r => r.id !== res.id)} : t); setTours(u); setSelectedTour(u.find(t => t.id === tour.id)); showToast('Rezervasyon silindi', 'info'); } }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px' }} title="Sil">×</button>
                              </div>
                            </td>
                          </tr>
                        );
                      };

              return (
                <>
                  {/* AKTİF REZERVASYONLAR */}
                  {aktifRes.length > 0 && (
                    <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', marginBottom: '12px' }}>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', minWidth: '500px' }}>
                          <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                              {['Ad Soyad', 'Oda Tipi', 'Vize Durumu', 'Tur Bedeli', 'Ödeme', ''].map(h => (
                                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: '600', fontSize: '11px' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {aktifRes.map(res => renderRow(res))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* İPTAL EDİLEN REZERVASYONLAR */}
                  {iptalRes.length > 0 && (
                    <div style={{ background: 'rgba(239,68,68,0.03)', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(239,68,68,0.15)' }}>
                      <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: '700' }}>⊘ İptal Edilenler ({iptalRes.length})</span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>— Kararınız değişirse geri alabilirsiniz</span>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', minWidth: '500px' }}>
                          <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(239,68,68,0.1)' }}>
                              {['Ad Soyad', 'Oda Tipi', 'Vize Durumu', 'Tur Bedeli', 'Ödeme', ''].map(h => (
                                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: '600', fontSize: '11px' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {iptalRes.map(res => renderRow(res))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Odalama Bölümü */}
            {roomingTour?.id === tour.id && (tour.reservations || []).filter(r => !r.cancelled).length > 0 && (() => {
              const reservations = (tour.reservations || []).filter(r => !r.cancelled);
              const roomTypes = {}; const assigned = new Set();
              reservations.forEach(r => {
                if (assigned.has(r.id)) return;
                const type = r.roomType || "-" || r.roomType || '-';
                if (!roomTypes[type]) roomTypes[type] = [];
                const room = [r]; assigned.add(r.id);
                if (r.roommate) { const m = reservations.find(x => !assigned.has(x.id) && x.customerName === r.roommate); if (m) { room.push(m); assigned.add(m.id); } }
                if (r.roommate3) { const m = reservations.find(x => !assigned.has(x.id) && x.customerName === r.roommate3); if (m) { room.push(m); assigned.add(m.id); } }
                roomTypes[type].push(room);
              });
              const totalRooms = Object.values(roomTypes).reduce((s, r) => s + r.length, 0);
              return (
                <div style={{ marginTop: '12px', padding: '16px', background: 'rgba(139,92,246,0.05)', borderRadius: '12px', border: '1px solid rgba(139,92,246,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ margin: 0, fontSize: '14px', color: '#8b5cf6' }}>🏨 Odalama ({totalRooms} oda)</h4>
                    <button onClick={() => {
                      const rows = [['Oda No','Oda Tipi','Kişi 1','Kişi 2','Kişi 3']];
                      let n = 1;
                      Object.entries(roomTypes).forEach(([t, rooms]) => rooms.forEach(room => rows.push([n++, t, room[0]?.customerName||'', room[1]?.customerName||'', room[2]?.customerName||''])));
                      const ws = XLSX.utils.aoa_to_sheet(rows);
                      ws['!cols'] = [{wch:8},{wch:18},{wch:25},{wch:25},{wch:25}];
                      const wb = XLSX.utils.book_new();
                      XLSX.utils.book_append_sheet(wb, ws, 'Odalama');
                      XLSX.writeFile(wb, `${tour.name}_Odalama.xlsx`);
                    }} style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
                  </div>
                  {Object.entries(roomTypes).map(([type, rooms]) => (
                    <div key={type} style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '12px', color: '#f59e0b', fontWeight: '600', marginBottom: '6px', padding: '4px 8px', background: 'rgba(245,158,11,0.1)', borderRadius: '6px', display: 'inline-block' }}>{type} ({rooms.length} oda)</div>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
                        {rooms.map((room, i) => (
                          <div key={i} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px' }}>Oda {i+1}</div>
                            {room.map((p, j) => <div key={j} style={{ fontSize: '12px', color: '#e8f1f8', padding: '2px 0' }}>👤 {p.customerName}</div>)}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        );
      })()}


      {filteredTours.length === 0 && !selectedTour && (
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
                
                {(appSettings?.roomTypes?.length ? appSettings.roomTypes : ['Çift Kişilik', 'Tek Kişilik', 'İlave Yatak']).map((roomType) => {
                  const key = roomType.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                  return (
                  <div key={key} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 80px', gap: '8px', marginBottom: '10px', alignItems: 'end' }}>
                    <div>
                      <label style={{...labelStyle, fontSize: '11px'}}>{roomType}</label>
                    </div>
                    <div>
                      <input
                        type="number"
                        value={formData.prices?.[key]?.amount ?? 0}
                        onChange={e => setFormData({
                          ...formData,
                          prices: {
                            ...formData.prices,
                            [key]: {...(formData.prices?.[key] || { amount: 0, currency: '€' }), amount: Number(e.target.value)}
                          }
                        })}
                        placeholder="0"
                        style={{...inputStyle, padding: '8px'}}
                      />
                    </div>
                    <div>
                      <select
                        value={formData.prices?.[key]?.currency ?? '€'}
                        onChange={e => setFormData({
                          ...formData,
                          prices: {
                            ...formData.prices,
                            [key]: {...(formData.prices?.[key] || { amount: 0, currency: '€' }), currency: e.target.value}
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
                  );
                })}
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

              {/* Tur Programı PDF */}
              <div>
                <label style={labelStyle}>📄 Tur Programı PDF</label>
                {formData.pdfUrl ? (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '10px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '20px' }}>📄</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', color: '#10b981', fontWeight: '600' }}>PDF Yüklendi</div>
                      <div style={{ fontSize: '10px', color: '#64748b', wordBreak: 'break-all' }}>{formData.pdfUrl.split('/').pop()?.split('?')[0] || 'dosya.pdf'}</div>
                    </div>
                    <button type="button" onClick={() => window.open(formData.pdfUrl, '_blank')} style={{ padding: '6px 10px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px' }}>👁️</button>
                    <button type="button" onClick={() => setFormData({...formData, pdfUrl: ''})} style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}>🗑️</button>
                  </div>
                ) : (
                  <div>
                    <input type="file" accept=".pdf" id="tourPdfInput" style={{ display: 'none' }} onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 10 * 1024 * 1024) { showToast('PDF max 10MB olabilir', 'error'); return; }
                      showToast('PDF yükleniyor...', 'info');
                      try {
                        const storage = getStorage();
                        const storageRef = ref(storage, `tour-pdfs/${Date.now()}_${file.name}`);
                        await uploadBytes(storageRef, file);
                        const url = await getDownloadURL(storageRef);
                        setFormData(prev => ({...prev, pdfUrl: url}));
                        showToast('PDF yüklendi!', 'success');
                      } catch(err) {
                        console.error('PDF yükleme hatası:', err);
                        showToast('PDF yüklenemedi: ' + err.message, 'error');
                      }
                    }} />
                    <button type="button" onClick={() => document.getElementById('tourPdfInput').click()} style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.03)', border: '2px dashed rgba(255,255,255,0.15)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>
                      📤 PDF Seç & Yükle (max 10MB)
                    </button>
                  </div>
                )}
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
        <div onClick={() => { setShowReservationForm(false); setEditingReservation(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', maxWidth: '700px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '18px' }}>
              {editingReservation ? '✏️ Rezervasyon Düzenle' : '➕ Rezervasyon Ekle'} — {selectedTour.name}
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
                      {(appSettings?.roomTypes?.length > 0
                        ? appSettings.roomTypes
                        : ['Single', 'Double', 'Twin', 'Triple']
                      ).map(rt => (
                        <option key={rt} value={rt}>{rt}</option>
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
                      <label style={labelStyle}>Vize Durumu</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', paddingTop: '4px' }}>
                        {schengenCountries.includes(selectedTour?.country) || selectedTour?.country?.includes('Amerika') ? (
                          <span style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '6px', fontWeight: '600',
                            background: reservationData.hasVisa ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.15)',
                            color: reservationData.hasVisa ? '#10b981' : '#ef4444',
                            border: `1px solid ${reservationData.hasVisa ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.25)'}` }}>
                            {reservationData.hasVisa ? `✅ Var${reservationData.visaEndDate ? ` (${formatDate(reservationData.visaEndDate)})` : ''}` : '❌ Yok'}
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#475569' }}>— Gerekli değil</span>
                        )}
                        <input type="checkbox" checked={reservationData.hasVisa}
                          onChange={e => setReservationData({...reservationData, hasVisa: e.target.checked})}
                          id="hasVisa" style={{ marginLeft: '4px' }} />
                        <label htmlFor="hasVisa" style={{ fontSize: '11px', color: '#64748b', cursor: 'pointer' }}>Elle düzenle</label>
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
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                      <div>
                        <label style={labelStyle}>
                          Tur Ücreti
                          {reservationData.discount > 0 && reservationData.basePrice > 0 && (
                            <span style={{ marginLeft: '6px', fontSize: '10px', color: '#64748b', textDecoration: 'line-through' }}>
                              {reservationData.basePrice} {reservationData.currency}
                            </span>
                          )}
                        </label>
                        <input
                          type="number"
                          value={reservationData.tourPrice}
                          onChange={e => {
                            const val = Number(e.target.value);
                            // Tur ücreti değişince basePrice sıfırla, indirim 0 yap
                            setReservationData({...reservationData, tourPrice: val, basePrice: val, discount: 0});
                          }}
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>İndirim</label>
                        <input
                          type="number"
                          value={reservationData.discount || ''}
                          onChange={e => {
                            const discount = Number(e.target.value) || 0;
                            // basePrice her zaman sabit kalır — ilk kez ayarlanıyorsa tourPrice'tan al
                            const base = reservationData.basePrice > 0 ? reservationData.basePrice : (reservationData.tourPrice || 0);
                            const netPrice = Math.max(0, base - discount);
                            setReservationData({...reservationData, discount, basePrice: base, tourPrice: netPrice});
                          }}
                          placeholder="0"
                          style={{ ...inputStyle, borderColor: reservationData.discount > 0 ? 'rgba(16,185,129,0.5)' : undefined }}
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

                    <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {reservationData.discount > 0 && (
                        <div style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.08)', borderRadius: '6px', fontSize: '12px', color: '#10b981' }}>
                          🏷️ İndirim: -{reservationData.discount} {reservationData.currency} &nbsp;|&nbsp; Net Fiyat: <strong>{reservationData.tourPrice} {reservationData.currency}</strong>
                        </div>
                      )}
                      <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: '6px', fontSize: '13px', color: '#22c55e' }}>
                        Toplam Ödeme: {(reservationData.payment1 + reservationData.payment2 + reservationData.payment3).toFixed(2)} {reservationData.currency}
                      </div>
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
                <button onClick={() => { setShowReservationForm(false); setEditingReservation(null); }} style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '14px' }}>
                  İptal
                </button>
                <button onClick={saveReservation} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #22c55e, #16a34a)', border: 'none', borderRadius: '10px', color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>
                  {editingReservation ? '✏️ Güncelle' : '💾 Kaydet'}
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
      
      window.open(`https://wa.me/90${phone.replace(/^(90|0)/,'')}?text=${encodeURIComponent(message)}`, '_blank');
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
                <button onClick={async () => { if (window.confirm(`"${quote.subject}" belgesini silmek istediğinizden emin misiniz?`)) { setQuotes(prev => prev.filter(q => q.id !== quote.id)); showToast?.('Belge silindi', 'warning'); try { const docId = quote._docId || quote.id?.toString(); if (docId) await deleteDoc(doc(db, 'quotes', docId)); } catch(e) { console.warn('Firestore quote silme hatası:', e.message); } } }} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>🗑️</button>
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
                      {agency.name} <span style={{ fontSize: '11px', opacity: 0.6 }}>↗</span>
                    </a>
                  ) : (
                    <span style={{ fontSize: '14px', color: '#f59e0b', fontWeight: '700' }}>{agency.name}</span>
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

// DS-160 AMERİKA VİZE MODÜLÜ
function DS160Module({ isMobile, showToast, appSettings, setAppSettings }) {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedApp, setSelectedApp] = useState(null);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  const ds160Url = appSettings?.ds160SiteUrl || 'https://ds160-paydos.netlify.app';

  useEffect(() => {
    const loadApplications = async () => {
      setLoading(true);
      try {
        // Veriler paydos named DB'sinde
        const snap = await getDocs(collection(db, 'ds160_applications'));
        let items = snap.docs.map(d => {
          const data = d.data();
          // Alanları normalize et - DS-160 sitesi farklı field isimleri kullanıyor
          return {
            _docId: d.id,
            ...data,
            // Ekran için normalize edilmiş alanlar
            _name: data.customerName || `${data.formData?.name || ''} ${data.formData?.surname || ''}`.trim() || 'İsimsiz',
            _phone: data.customerPhone || data.formData?.phone || '',
            _email: data.customerEmail || data.formData?.email || '',
            _status: data.status === 'draft' ? 'Beklemede' : (data.status || 'Beklemede'),
            _tcKimlik: data.tcKimlik || data.formData?.tcKimlik || '',
            _passportNo: data.passportNo || data.formData?.passportNo || '',
          };
        });
        items.sort((a, b) => {
          const ta = a.createdAt?.seconds || a.createdAt || '';
          const tb = b.createdAt?.seconds || b.createdAt || '';
          return tb > ta ? 1 : -1;
        });
        setApplications(items);
      } catch (e) {
        console.error('DS-160 yükleme hatası:', e);
        showToast?.(`DS-160 yüklenemedi: ${e.message}`, 'error');
      } finally {
        setLoading(false);
      }
    };
    loadApplications();
  }, []);

  const statusColors = {
    'Beklemede': '#f59e0b',
    'draft': '#f59e0b',
    'İnceleniyor': '#3b82f6',
    'Tamamlandı': '#10b981',
    'Reddedildi': '#ef4444',
    'İptal': '#64748b'
  };

  const filtered = applications.filter(a => {
    const q = searchQuery.toLowerCase();
    const matchQ = !q ||
      (a._name || '').toLowerCase().includes(q) ||
      (a._email || '').toLowerCase().includes(q) ||
      (a._phone || '').includes(q) ||
      (a._tcKimlik || '').includes(q);
    const matchS = statusFilter === 'all' || a._status === statusFilter || a.status === statusFilter;
    return matchQ && matchS;
  });

  const statuses = ['all', 'Beklemede', 'İnceleniyor', 'Tamamlandı', 'Reddedildi', 'İptal'];

  return (
    <div style={{ padding: isMobile ? '16px' : '24px', maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            🇺🇸 Amerika Vize Başvuruları
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>DS-160 formu gönderen müşteriler</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={() => setShowUrlModal(true)} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '8px 14px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>
            ⚙️ Site URL
          </button>
          <button onClick={() => window.open(ds160Url, '_blank')} style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '8px', padding: '8px 14px', color: 'white', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
            🔗 DS-160 Sitesi
          </button>
          <button onClick={() => {
            navigator.clipboard.writeText(ds160Url);
            showToast?.('Link kopyalandı!', 'success');
          }} style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', padding: '8px 14px', color: '#10b981', cursor: 'pointer', fontSize: '12px' }}>
            📋 Link Kopyala
          </button>
        </div>
      </div>

      {/* Site Link Banner */}
      <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '12px', padding: '12px 16px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🌐</span>
          <div>
            <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>DS-160 Başvuru Sayfası</p>
            <p style={{ margin: 0, fontSize: '13px', color: '#3b82f6', fontWeight: '600' }}>{ds160Url}</p>
          </div>
        </div>
        <button onClick={() => {
          navigator.clipboard.writeText(ds160Url);
          showToast?.('Link kopyalandı!', 'success');
        }} style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '8px 16px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
          📋 Kopyala
        </button>
      </div>

      {/* Arama + Filtre */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="🔍 Ad, e-posta, telefon ile ara..."
          style={{ flex: 1, minWidth: '200px', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '13px', outline: 'none' }}
        />
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {statuses.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{
              padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: '600', border: 'none',
              background: statusFilter === s ? (s === 'all' ? '#f59e0b' : statusColors[s] || '#f59e0b') : 'rgba(255,255,255,0.05)',
              color: statusFilter === s ? 'white' : '#94a3b8'
            }}>
              {s === 'all' ? `Tümü (${applications.length})` : s}
            </button>
          ))}
        </div>
      </div>

      {/* İstatistik Kartları */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: 'Toplam', value: applications.length, color: '#3b82f6' },
          { label: 'Beklemede', value: applications.filter(a => a.status === 'Beklemede' || !a.status).length, color: '#f59e0b' },
          { label: 'İnceleniyor', value: applications.filter(a => a.status === 'İnceleniyor').length, color: '#3b82f6' },
          { label: 'Tamamlandı', value: applications.filter(a => a.status === 'Tamamlandı').length, color: '#10b981' },
        ].map(stat => (
          <div key={stat.label} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${stat.color}30`, borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: '700', color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Liste */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
          <p>Yükleniyor...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🇺🇸</div>
          <p style={{ fontSize: '16px', fontWeight: '600', color: '#94a3b8' }}>
            {applications.length === 0 ? 'Henüz başvuru yok' : 'Arama sonucu bulunamadı'}
          </p>
          <p style={{ fontSize: '13px', marginTop: '8px' }}>
            {applications.length === 0 ? `DS-160 linkini paylaşın: ${ds160Url}` : 'Farklı bir arama deneyin'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(app => {
            const status = app._status || 'Beklemede';
            const statusColor = statusColors[status] || '#f59e0b';
            const createdAt = app.createdAt?.toDate ? app.createdAt.toDate() : app.createdAt ? new Date(app.createdAt.seconds ? app.createdAt.seconds * 1000 : app.createdAt) : null;

            // Tamamlanma yüzdesi — dolu alan sayısına göre
            const formData = app.formData || {};
            const allFields = Object.values(formData).filter(v => v !== null && v !== undefined && v !== '');
            const totalExpected = 40; // DS-160 formunda yaklaşık toplam alan
            const filledCount = allFields.length;
            const completionPct = Math.min(100, Math.round((filledCount / totalExpected) * 100));
            const pctColor = completionPct >= 80 ? '#10b981' : completionPct >= 40 ? '#f59e0b' : '#ef4444';

            return (
              <div key={app._docId} onClick={() => setSelectedApp(selectedApp?._docId === app._docId ? null : app)}
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.2s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>🇺🇸</div>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '14px', color: '#ffffff' }}>
                        {app._name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        {app._email && <span>{app._email}</span>}
                        {app._phone && <span style={{ marginLeft: '8px' }}>📞 {app._phone}</span>}
                      </div>
                      {createdAt && (
                        <div style={{ fontSize: '10px', color: '#475569', marginTop: '2px' }}>
                          📅 {createdAt.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {/* Tamamlanma yüzdesi */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '60px', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${completionPct}%`, height: '100%', background: pctColor, borderRadius: '3px', transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ fontSize: '11px', color: pctColor, fontWeight: '600', minWidth: '32px' }}>{completionPct}%</span>
                      </div>
                      <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', background: `${statusColor}20`, color: statusColor, border: `1px solid ${statusColor}30` }}>
                        {status}
                      </span>
                      {/* Sil butonu */}
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        if (!window.confirm(`${app._name} başvurusunu silmek istiyor musunuz?`)) return;
                        try {
                          await deleteDoc(doc(db, 'ds160_applications', app._docId));
                          setApplications(prev => prev.filter(a => a._docId !== app._docId));
                          if (selectedApp?._docId === app._docId) setSelectedApp(null);
                          showToast?.('Başvuru silindi', 'info');
                        } catch(err) { showToast?.('Silme başarısız', 'error'); }
                      }} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', padding: '4px 8px', fontSize: '13px' }} title="Sil">
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Detail */}
                {selectedApp?._docId === app._docId && (() => {
                  // PDF için field order (form doldurma sırasına göre)
                  const fieldOrder = [
                    // KİŞİSEL BİLGİLER
                    'firstName','lastName','maidenSurname','gender','maritalStatus',
                    'birthDate','birthPlace','birthCountry','nationality','otherNationality',
                    'tcKimlik','homeAddress','homeZip','homePhone','phone','email',
                    // PASAPORT BİLGİLERİ
                    'passportType','passportNo','passportNumber','passportCity',
                    'passportIssueDate','passportExpiry','passportExpDate',
                    'oldPassport','lostPassport','travelHistory',
                    // SEYAHAT VE DİĞER BİLGİLER
                    'visaType','arrivalDate','departureDate','stayDuration',
                    'usAddress','usPhone','usEmail','tripPayer',
                    'hasCompanion','companionName','companionRelation','companionPhone','companionEmail',
                    'inviterName','inviterRelation',
                    // DAHA ÖNCE AMERİKA
                    'beenToUS','usArrivalDate','usDepartureDate',
                    'hadUSVisa','usVisaDate','visaNumber','sameVisaCategory',
                    'hadFingerprint','visaLost','visaCancelled','visaRefused','refusalReason',
                    'greencardPetition',
                    // AİLE BİLGİSİ
                    'fatherName','fatherBirth','fatherBirthPlace','fatherNationality',
                    'motherName','motherBirth','motherBirthPlace','motherMaidenName','motherNationality',
                    'parentInUS',
                    'relativeInUS','relativeInUSName','relativeRelation','relativeUSCitizen',
                    'relativeAddress','relativePhone','relativeEmail',
                    'relative2Name','relative2Relation','relative2USCitizen',
                    'relative2Address','relative2Phone','relative2Email',
                    // EŞ BİLGİLERİ
                    'spouseName','spouseMaidenName','spouseBirthPlace','spouseBirthDate',
                    'divorceCount','exSpouseName','exSpouseBirth',
                    'marriageDate','divorceDate','divorceReason',
                    'exSpouse2Name','exSpouse2Birth','marriageDate2','divorceDate2','divorceReason2',
                    // İŞ HAYATI
                    'occupation','jobDescription','monthlySalary',
                    'employerName','employerAddress','employerZip','employerPhone','employerCity','employerDistrict',
                    'jobStartDate',
                    'prevEmployerName','prevEmployerAddress','prevEmployerPhone',
                    'prevJobStartDate','prevJobEndDate',
                    // EĞİTİM
                    'schoolName','schoolAddress','educationField','educationStartEnd',
                    // DİĞER
                    'militaryService','militaryRank','militaryStart','militaryEnd','languages',
                    // SOSYAL MEDYA
                    'facebook','instagram','twitter','linkedin','youtube',
                    'reddit','pinterest','tumblr','vk','weibo','myspace',
                    // GÜVENLİK SORULARI
                    'sec_drugs','sec_laundering','sec_trafficking','sec_prostitution',
                    'sec_terrorism','sec_genocide','sec_torture','sec_violence',
                    'sec_assassin','sec_military','sec_spy','sec_disorder',
                    'sec_arrested','sec_disease','sec_deported'
                  ];
                  const fieldNames = {
                    // Kişisel
                    firstName:'Ad', lastName:'Soyad', maidenSurname:'Evlenmeden Önceki Soyadı',
                    gender:'Cinsiyet', maritalStatus:'Medeni Durum',
                    birthDate:'Doğum Tarihi', birthPlace:'Doğum Yeri', birthCity:'Doğum Şehri',
                    birthCountry:'Doğum Ülkesi', nationality:'Uyruk', otherNationality:'Diğer Uyruk',
                    tcKimlik:'TC Kimlik No', homeAddress:'İkamet Adresi', homeZip:'Posta Kodu',
                    homePhone:'Ev Telefonu', homeCity:'İkamet Şehri', homeDistrict:'İkamet İlçesi',
                    phone:'Cep Telefonu', otherPhone:'Diğer Telefon', email:'E-posta', otherEmail:'Diğer E-posta',
                    // Pasaport
                    passportType:'Pasaport Türü', passportNo:'Pasaport No', passportNumber:'Pasaport No',
                    passportCity:'Pasaportu Veren Yer', passportIssueDate:'Pasaport Veriliş Tarihi',
                    passportExpiry:'Pasaport Geçerlilik Tarihi', passportExpDate:'Pasaport Geçerlilik Tarihi',
                    oldPassport:'Eski Pasaport Var mı', lostPassport:'Pasaport Kayıp/Çalıntı mı',
                    travelHistory:'Son 5 Yılda Seyahat Edilen Ülkeler',
                    // Seyahat
                    visaType:'Seyahat Amacı', arrivalDate:'Varış Tarihi', departureDate:'Dönüş Tarihi',
                    stayDuration:'Kalış Süresi', usAddress:'ABD\'de Kalacak Yer Adresi',
                    usPhone:'ABD\'deki Yerin Telefonu', usEmail:'ABD\'deki Yerin E-postası',
                    tripPayer:'Seyahati Kim Karşılıyor',
                    hasCompanion:'Eşlik Eden Var mı', companionName:'Eşlik Edenin Adı Soyadı',
                    companionRelation:'Eşlik Edenin Yakınlık Derecesi',
                    companionPhone:'Eşlik Edenin Telefonu', companionEmail:'Eşlik Edenin E-postası',
                    inviterName:'Davet Eden Kişi', inviterRelation:'Davet Eden ile Bağ',
                    // Önceki ABD
                    beenToUS:'Daha Önce ABD\'de Bulundu mu', usArrivalDate:'ABD\'ye Gidiş Tarihi',
                    usDepartureDate:'ABD\'den Dönüş Tarihi', hadUSVisa:'Daha Önce ABD Vizesi Aldı mı',
                    usVisaDate:'Önceki Vize Veriliş Tarihi', visaNumber:'Vize Numarası',
                    sameVisaCategory:'Aynı Vize Kategorisine mi Başvuruyor',
                    hadFingerprint:'Daha Önce Parmak İzi Alındı mı', visaLost:'Vize Kayıp/Çalıntı mı',
                    visaCancelled:'Vize İptal Edildi mi', visaRefused:'Vize Reddi Var mı',
                    refusalReason:'Red Sebebi', greencardPetition:'Greencard Başvurusu',
                    // Aile
                    fatherName:'Babanın Adı Soyadı', fatherBirth:'Babanın Doğum Tarihi',
                    fatherBirthPlace:'Babanın Doğum Yeri', fatherNationality:'Babanın Vatandaşlığı',
                    fatherInUS:'Babası ABD\'de mi',
                    motherName:'Annenin Adı Soyadı', motherBirth:'Annenin Doğum Tarihi',
                    motherBirthPlace:'Annenin Doğum Yeri', motherMaidenName:'Annenin Kızlık Soyadı',
                    motherNationality:'Annenin Vatandaşlığı', motherInUS:'Annesi ABD\'de mi',
                    parentInUS:'Anne veya Baba ABD\'de mi',
                    relativeInUS:'ABD\'de Birinci Derece Akraba Var mı',
                    relativeInUSName:'Akrabanın Adı Soyadı', relativeRelation:'Yakınlık Derecesi',
                    relativeUSCitizen:'ABD Vatandaşı mı', relativeAddress:'Akrabanın Adresi',
                    relativePhone:'Akrabanın Telefonu', relativeEmail:'Akrabanın E-postası',
                    relative2Name:'2. Akrabanın Adı Soyadı', relative2Relation:'2. Akrabanın Yakınlık Derecesi',
                    relative2USCitizen:'2. Akraba ABD Vatandaşı mı', relative2Address:'2. Akrabanın Adresi',
                    relative2Phone:'2. Akrabanın Telefonu', relative2Email:'2. Akrabanın E-postası',
                    // Eş
                    spouseName:'Eşin Adı Soyadı', spouseMaidenName:'Eşin Kızlık Soyadı',
                    spouseBirthPlace:'Eşin Doğum Yeri', spouseBirthDate:'Eşin Doğum Tarihi',
                    divorceCount:'Boşanma Sayısı', exSpouseName:'Eski Eşin Adı Soyadı',
                    exSpouseBirth:'Eski Eşin Doğum Tarihi/Yeri', marriageDate:'Evlenme Tarihi',
                    divorceDate:'Boşanma Tarihi', divorceReason:'Boşanma Sebebi',
                    exSpouse2Name:'2. Eski Eşin Adı Soyadı', exSpouse2Birth:'2. Eski Eşin Doğum Tarihi/Yeri',
                    marriageDate2:'2. Evlenme Tarihi', divorceDate2:'2. Boşanma Tarihi',
                    divorceReason2:'2. Boşanma Sebebi',
                    // İş
                    occupation:'Meslek', jobDescription:'İşyerindeki Görev', monthlySalary:'Aylık Net Kazanç',
                    employerName:'İşyeri Adı', employerAddress:'İşyeri Adresi', employerZip:'İşyeri Posta Kodu',
                    employerPhone:'İş Telefonu', employerCity:'İşyeri Şehri', employerDistrict:'İşyeri İlçesi',
                    jobStartDate:'İşe Başlama Tarihi',
                    prevEmployerName:'Önceki İşyeri Adı', prevEmployerAddress:'Önceki İşyeri Adresi',
                    prevEmployerPhone:'Önceki İşyeri Telefonu',
                    prevJobStartDate:'Önceki İşe Başlama Tarihi', prevJobEndDate:'Önceki İşten Ayrılma Tarihi',
                    // Eğitim
                    schoolName:'Okul Adı', schoolAddress:'Okul Adresi',
                    educationField:'Bölüm', educationLevel:'Eğitim Seviyesi',
                    educationStartEnd:'Başlangıç ve Bitiş Tarihi',
                    // Diğer
                    militaryService:'Askerlik Yapıldı mı', militaryRank:'Rütbe',
                    militaryStart:'Askerlik Başlangıç Tarihi', militaryEnd:'Askerlik Bitiş Tarihi',
                    languages:'Konuşulan Diller',
                    // Sosyal medya
                    facebook:'Facebook', instagram:'Instagram', twitter:'Twitter',
                    linkedin:'LinkedIn', youtube:'YouTube', reddit:'Reddit',
                    pinterest:'Pinterest', tumblr:'Tumblr', vk:'VKontakte',
                    weibo:'Sina Weibo', myspace:'MySpace',
                    // Güvenlik
                    sec_drugs:'Uyuşturucu', sec_laundering:'Kara Para Aklaması',
                    sec_trafficking:'İnsan Ticareti', sec_prostitution:'Fuhuş',
                    sec_terrorism:'Terör', sec_genocide:'Soykırım', sec_torture:'İşkence',
                    sec_violence:'Şiddet', sec_assassin:'Suikast', sec_military:'Yabancı Askeri Hizmet',
                    sec_spy:'Casusluk', sec_disorder:'Akıl Hastalığı',
                    sec_arrested:'Tutuklanma', sec_disease:'Bulaşıcı Hastalık', sec_deported:'Sınır Dışı',
                    // Genel
                    fullNameTr:'Tam Ad', givenName:'Ad (Pasaporttaki)', surname:'Soyad',
                    permanentResident:'Daimi Oturum İzni', securityQuestion:'Güvenlik Sorusu',
                    immigrationPetition:'Göçmenlik Başvurusu'
                  };
                  const tr = k => fieldNames[k] || k;
                  return (
                  <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    {/* Durum Güncelle + PDF */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>Durum Güncelle:</div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {['Beklemede', 'İnceleniyor', 'Tamamlandı', 'Reddedildi', 'İptal'].map(s => (
                            <button key={s} onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await setDoc(doc(db, 'ds160_applications', app._docId), { status: s }, { merge: true });
                                setApplications(prev => prev.map(a => a._docId === app._docId ? {...a, status: s, _status: s} : a));
                                setSelectedApp({...app, status: s, _status: s});
                                showToast?.(`Durum "${s}" olarak güncellendi`, 'success');
                              } catch(err) { showToast?.('Güncelleme başarısız', 'error'); }
                            }} style={{
                              padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '600', border: 'none',
                              background: app._status === s ? `${statusColors[s]}40` : 'rgba(255,255,255,0.05)',
                              color: app._status === s ? statusColors[s] : '#94a3b8',
                              outline: app._status === s ? `1px solid ${statusColors[s]}60` : 'none'
                            }}>
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* PDF İndir */}
                      <button onClick={(e) => {
                        e.stopPropagation();
                        const tr = k => fieldNames[k] || k;

                        // Bölüm başlıklarını tanımla
                        const sections = [
                          { title: 'KİSİSEL BILGILER', keys: ['firstName','lastName','maidenSurname','gender','maritalStatus','birthDate','birthPlace','birthCountry','nationality','otherNationality','tcKimlik','homeAddress','homeZip','homePhone','phone','email'] },
                          { title: 'PASAPORT BILGILERI', keys: ['passportType','passportNo','passportNumber','passportCity','passportIssueDate','passportExpiry','passportExpDate','oldPassport','lostPassport','travelHistory'] },
                          { title: 'SEYAHAT VE DIGER BILGILER', keys: ['visaType','arrivalDate','departureDate','stayDuration','usAddress','usPhone','usEmail','tripPayer','hasCompanion','companionName','companionRelation','companionPhone','companionEmail','inviterName','inviterRelation'] },
                          { title: 'DAHA ONCE AMERIKADA BULUNDUNUZ MU?', keys: ['beenToUS','usArrivalDate','usDepartureDate','hadUSVisa','usVisaDate','visaNumber','sameVisaCategory','hadFingerprint','visaLost','visaCancelled','visaRefused','refusalReason','greencardPetition'] },
                          { title: 'AILE BILGISI', keys: ['fatherName','fatherBirth','fatherBirthPlace','fatherNationality','motherName','motherBirth','motherBirthPlace','motherMaidenName','motherNationality','parentInUS','relativeInUS','relativeInUSName','relativeRelation','relativeUSCitizen','relativeAddress','relativePhone','relativeEmail','relative2Name','relative2Relation','relative2USCitizen','relative2Address','relative2Phone','relative2Email'] },
                          { title: 'ES HAKKINDA BILGILER', keys: ['spouseName','spouseMaidenName','spouseBirthPlace','spouseBirthDate','divorceCount','exSpouseName','exSpouseBirth','marriageDate','divorceDate','divorceReason','exSpouse2Name','exSpouse2Birth','marriageDate2','divorceDate2','divorceReason2'] },
                          { title: 'IS HAYATINIZ', keys: ['occupation','jobDescription','monthlySalary','employerName','employerAddress','employerZip','employerPhone','jobStartDate','prevEmployerName','prevEmployerAddress','prevEmployerPhone','prevJobStartDate','prevJobEndDate'] },
                          { title: 'EN SON MEZUN OLUNAN OKUL', keys: ['schoolName','schoolAddress','educationField','educationStartEnd'] },
                          { title: 'DIGER BILGILER', keys: ['militaryService','militaryRank','militaryStart','militaryEnd','languages'] },
                          { title: 'SOSYAL MEDYA BILGILERI', keys: ['facebook','instagram','twitter','linkedin','youtube','reddit','pinterest','tumblr','vk','weibo','myspace'] },
                          { title: 'GUVENLIK SORULARI', keys: ['sec_drugs','sec_laundering','sec_trafficking','sec_prostitution','sec_terrorism','sec_genocide','sec_torture','sec_violence','sec_assassin','sec_military','sec_spy','sec_disorder','sec_arrested','sec_disease','sec_deported'] },
                        ];

                        const doc2 = new jsPDF();
                        // Başlık
                        doc2.setFillColor(26, 58, 92);
                        doc2.rect(0, 0, 210, 32, 'F');
                        doc2.setFontSize(14); doc2.setTextColor(255);
                        doc2.text('AMERIKA BILGI FORMU - DS-160', 15, 13);
                        doc2.setFontSize(8); doc2.setTextColor(180);
                        doc2.text('ASAGIDA BELIRTILEN BILGILER DS-160 ONLINE FORMUNUZ ICINDIR', 15, 21);
                        doc2.setFontSize(9); doc2.setTextColor(200);
                        const nameClean = (app._name||'').replace(/[İı]/g,i=>i==='İ'?'I':'i').replace(/[ğ]/g,'g').replace(/[Ğ]/g,'G').replace(/[ş]/g,'s').replace(/[Ş]/g,'S').replace(/[ü]/g,'u').replace(/[Ü]/g,'U').replace(/[ö]/g,'o').replace(/[Ö]/g,'O').replace(/[ç]/g,'c').replace(/[Ç]/g,'C');
                        doc2.text(`Basvuran: ${nameClean}   |   ${new Date().toLocaleDateString('tr-TR')}`, 15, 28);

                        const clean = (s) => String(s||'').replace(/[İı]/g,x=>x==='İ'?'I':'i').replace(/[ğ]/g,'g').replace(/[Ğ]/g,'G').replace(/[ş]/g,'s').replace(/[Ş]/g,'S').replace(/[ü]/g,'u').replace(/[Ü]/g,'U').replace(/[ö]/g,'o').replace(/[Ö]/g,'O').replace(/[ç]/g,'c').replace(/[Ç]/g,'C');

                        let y = 40;
                        let rowIdx = 0;

                        // Üst bilgiler
                        const topRows = [
                          ['Ad Soyad', app._name], ['Telefon', app._phone],
                          ['E-posta', app._email], ['TC Kimlik', app._tcKimlik], ['Pasaport No', app._passportNo]
                        ].filter(r => r[1]);

                        doc2.setFontSize(8);
                        topRows.forEach(([k, v]) => {
                          if (y > 275) { doc2.addPage(); y = 15; }
                          const bg = rowIdx % 2 === 0 ? [245, 248, 255] : [255, 255, 255];
                          doc2.setFillColor(...bg); doc2.rect(15, y-4, 180, 8, 'F');
                          doc2.setTextColor(80,80,80); doc2.setFont(undefined,'bold');
                          doc2.text(clean(k), 17, y+1);
                          doc2.setTextColor(30,30,30); doc2.setFont(undefined,'normal');
                          const lines = doc2.splitTextToSize(clean(v), 125);
                          doc2.text(lines, 72, y+1);
                          y += Math.max(8, lines.length * 5);
                          rowIdx++;
                        });

                        // Bölüm bölüm yaz
                        sections.forEach(section => {
                          const sectionRows = section.keys
                            .filter(k => app.formData?.[k] && String(app.formData[k]).trim())
                            .map(k => [tr(k), app.formData[k]]);

                          if (sectionRows.length === 0) return;

                          // Bölüm başlığı
                          if (y > 265) { doc2.addPage(); y = 15; }
                          doc2.setFillColor(26, 58, 92);
                          doc2.rect(15, y-2, 180, 9, 'F');
                          doc2.setFontSize(8); doc2.setTextColor(255); doc2.setFont(undefined,'bold');
                          doc2.text(section.title, 17, y+4);
                          y += 12; rowIdx = 0;

                          sectionRows.forEach(([k, v]) => {
                            if (y > 275) { doc2.addPage(); y = 15; }
                            const bg = rowIdx % 2 === 0 ? [245, 248, 255] : [255, 255, 255];
                            doc2.setFillColor(...bg); doc2.rect(15, y-4, 180, 8, 'F');
                            doc2.setFontSize(8); doc2.setTextColor(80,80,80); doc2.setFont(undefined,'bold');
                            doc2.text(clean(k), 17, y+1);
                            doc2.setTextColor(30,30,30); doc2.setFont(undefined,'normal');
                            const lines = doc2.splitTextToSize(clean(v), 125);
                            doc2.text(lines, 72, y+1);
                            y += Math.max(8, lines.length * 5);
                            rowIdx++;
                          });
                        });

                        // fieldOrder'da olmayan ekstra alanlar
                        const allOrderedKeys = sections.flatMap(s => s.keys);
                        const extraRows = Object.entries(app.formData || {})
                          .filter(([k,v]) => !allOrderedKeys.includes(k) && typeof v === 'string' && v.trim() && !k.startsWith('_'))
                          .map(([k,v]) => [tr(k), v]);

                        if (extraRows.length > 0) {
                          if (y > 265) { doc2.addPage(); y = 15; }
                          doc2.setFillColor(26, 58, 92);
                          doc2.rect(15, y-2, 180, 9, 'F');
                          doc2.setFontSize(8); doc2.setTextColor(255); doc2.setFont(undefined,'bold');
                          doc2.text('DIGER', 17, y+4);
                          y += 12; rowIdx = 0;
                          extraRows.forEach(([k, v]) => {
                            if (y > 275) { doc2.addPage(); y = 15; }
                            const bg = rowIdx % 2 === 0 ? [245, 248, 255] : [255, 255, 255];
                            doc2.setFillColor(...bg); doc2.rect(15, y-4, 180, 8, 'F');
                            doc2.setFontSize(8); doc2.setTextColor(80,80,80); doc2.setFont(undefined,'bold');
                            doc2.text(clean(k), 17, y+1);
                            doc2.setTextColor(30,30,30); doc2.setFont(undefined,'normal');
                            const lines = doc2.splitTextToSize(clean(v), 125);
                            doc2.text(lines, 72, y+1);
                            y += Math.max(8, lines.length * 5);
                            rowIdx++;
                          });
                        }

                        doc2.save(`DS160_${(app._name||'belge').replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')}.pdf`);
                      }} style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap' }}>
                        📄 PDF İndir
                      </button>
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        const email = app._email;
                        if (!email) { showToast?.('Müşterinin e-posta adresi yok', 'error'); return; }
                        const visa = { id: app._id || app.id || Date.now().toString(), categoryId: 'usa', country: 'Amerika', visaDuration: 'B1/B2 Turistik ve Ticari', customerEmail: email };
                        const customer = { firstName: (app._name||'').split(' ')[0], lastName: (app._name||'').split(' ').slice(1).join(' '), email };
                        showToast?.('📧 Mail gönderiliyor...', 'info');
                        const result = await sendVisaEmail({ visa, customer, appSettings });
                        if (result.ok) showToast?.(`📧 Mail gönderildi: ${email}`, 'success');
                        else showToast?.(`❌ Mail gönderilemedi: ${result.error}`, 'error');
                      }} style={{ padding: '8px 14px', background: 'rgba(20,184,166,0.2)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: '8px', color: '#14b8a6', cursor: 'pointer', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap' }}>
                        📧 Mail Gönder
                      </button>
                    </div>
                  </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* URL Ayar Modal */}
      {showUrlModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '480px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>⚙️ DS-160 Site URL Ayarı</h3>
            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Site URL</label>
            <input
              value={urlInput || ds160Url}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="https://ds160-paydos.netlify.app"
              style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => setShowUrlModal(false)} style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer' }}>İptal</button>
              <button onClick={() => {
                const newUrl = urlInput.trim() || ds160Url;
                setAppSettings(prev => ({...prev, ds160SiteUrl: newUrl}));
                showToast?.('URL kaydedildi', 'success');
                setShowUrlModal(false);
              }} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '8px', color: '#0c1929', fontWeight: '700', cursor: 'pointer' }}>💾 Kaydet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// AYARLAR MODÜLÜ
function SettingsModule({ users, setUsers, currentUser, setCurrentUser, isMobile, appSettings, setAppSettings, showToast }) {
  const [activeTab, setActiveTab] = useState('users');
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
  const [newRoomType, setNewRoomType] = useState('');

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
        <button onClick={() => setActiveTab('users')} style={{ padding: '12px 16px', background: activeTab === 'users' || activeTab === 'profile' || activeTab === 'password' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'users' || activeTab === 'profile' || activeTab === 'password' ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'users' || activeTab === 'profile' || activeTab === 'password' ? '#10b981' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'users' || activeTab === 'profile' || activeTab === 'password' ? '600' : '400' }}>
          👥 Kullanıcılar
        </button>
        {isAdmin && (
          <>
            <button onClick={() => setActiveTab('visaSettings')} style={{ padding: '12px 16px', background: activeTab === 'visaSettings' ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'visaSettings' ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'visaSettings' ? '#8b5cf6' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'visaSettings' ? '600' : '400' }}>
              🌍 Vize Ayarları
            </button>
            <button onClick={() => setActiveTab('statusManagement')} style={{ padding: '12px 16px', background: activeTab === 'statusManagement' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'statusManagement' ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'statusManagement' ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'statusManagement' ? '600' : '400' }}>
              📊 Durum Yönetimi
            </button>
            <button onClick={() => setActiveTab('musteri')} style={{ padding: '12px 16px', background: activeTab === 'musteri' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'musteri' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'musteri' ? '#ef4444' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'musteri' ? '600' : '400' }}>
              🤖 Müşteri
            </button>
            <button onClick={() => setActiveTab('tourSettings')} style={{ padding: '12px 16px', background: activeTab === 'tourSettings' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'tourSettings' ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'tourSettings' ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'tourSettings' ? '600' : '400' }}>
              🎫 Turlar
            </button>
            <button onClick={() => setActiveTab('mailSettings')} style={{ padding: '12px 16px', background: activeTab === 'mailSettings' ? 'rgba(20,184,166,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'mailSettings' ? '1px solid rgba(20,184,166,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'mailSettings' ? '#14b8a6' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'mailSettings' ? '600' : '400' }}>
              📧 Mail Ayarları
            </button>
            <button onClick={() => setActiveTab('attachmentSettings')} style={{ padding: '12px 16px', background: activeTab === 'attachmentSettings' ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'attachmentSettings' ? '1px solid rgba(168,85,247,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'attachmentSettings' ? '#a855f7' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'attachmentSettings' ? '600' : '400' }}>
              📎 Dosya Ekleri
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

          {/* Vize Başvuru Durumları */}
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#10b981' }}>📋 Vize Başvuru Durumları</h3>
            <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>Vize başvuru sürecinde kullanılan durum etiketleri</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {(appSettings?.visaStatuses || []).map((status, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16,185,129,0.15)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.3)' }}>
                  <span style={{ fontSize: '12px', color: '#10b981' }}>{status}</span>
                  <button onClick={() => setAppSettings({ ...appSettings, visaStatuses: appSettings.visaStatuses.filter((_, i) => i !== idx) })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="text" value={newVisaStatus} onChange={e => setNewVisaStatus(e.target.value)}
                placeholder="Yeni durum (örn: Belgeler Eksik)"
                style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '12px' }}
                onKeyDown={e => { if (e.key === 'Enter' && newVisaStatus.trim()) { setAppSettings({ ...appSettings, visaStatuses: [...(appSettings.visaStatuses || []), newVisaStatus.trim()] }); setNewVisaStatus(''); } }}
              />
              <button onClick={() => { if (newVisaStatus.trim()) { setAppSettings({ ...appSettings, visaStatuses: [...(appSettings.visaStatuses || []), newVisaStatus.trim()] }); setNewVisaStatus(''); } }}
                style={{ padding: '8px 12px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '12px' }}>➕</button>
            </div>
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

          {/* Vize Başvuru Durumları artık Vize Ayarları sekmesinde */}

        </div>
      )}

      {/* MÜŞTERİ — Telegram Bot + AI API Key */}
      {activeTab === 'musteri' && isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Telegram Bot */}
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg, #0088cc, #006ba6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>✈️</div>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', fontWeight: '600' }}>Telegram Bot</h3>
                <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>@paydoscrm_bot — Müşteri bildirimleri ve sorgular</p>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Bot Token</label>
                <input
                  type="password"
                  value={appSettings?.telegramBotToken || ''}
                  onChange={e => setAppSettings({ ...appSettings, telegramBotToken: e.target.value })}
                  placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ"
                  style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '13px' }}
                />
                <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#475569' }}>BotFather'dan alınan token. Firebase Functions bu değeri okur.</p>
              </div>
              <div>
                <label style={labelStyle}>Telegram Chat ID (Bildirim Grubu)</label>
                <input
                  type="text"
                  value={appSettings?.telegramChatId || ''}
                  onChange={e => setAppSettings({ ...appSettings, telegramChatId: e.target.value })}
                  placeholder="-1001234567890"
                  style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '13px' }}
                />
                <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#475569' }}>Bildirimlerin gönderileceği grup veya kanal ID'si.</p>
              </div>
              <div style={{ padding: '12px', background: 'rgba(0,136,204,0.1)', borderRadius: '10px', border: '1px solid rgba(0,136,204,0.2)' }}>
                <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>
                  ℹ️ Bu değerler <strong style={{ color: '#94a3b8' }}>Firestore → app_settings</strong> koleksiyonuna kaydedilir. Firebase Cloud Functions bu alanları okuyarak çalışır.
                </p>
              </div>
            </div>
          </div>

          {/* AI API Key */}
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>🤖</div>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', fontWeight: '600' }}>AI (Claude API)</h3>
                <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>AI Quick Add ve Telegram bot AI özellikleri için</p>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Anthropic API Key</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="password"
                    value={appSettings?.claudeApiKey || ''}
                    onChange={e => setAppSettings({ ...appSettings, claudeApiKey: e.target.value })}
                    placeholder="sk-ant-api03-..."
                    style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '13px', flex: 1 }}
                  />
                  {appSettings?.claudeApiKey && (
                    <button onClick={() => setAppSettings({ ...appSettings, claudeApiKey: '' })}
                      style={{ padding: '0 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}>
                      🗑️
                    </button>
                  )}
                </div>
                <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#475569' }}>
                  console.anthropic.com'dan alınan API anahtarı. Buraya girilince 🤖 AI Quick Add doğrudan kullanır.
                </p>
              </div>
              <div style={{ padding: '12px', background: appSettings?.claudeApiKey ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)', borderRadius: '10px', border: `1px solid ${appSettings?.claudeApiKey ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}` }}>
                <p style={{ margin: 0, fontSize: '11px', color: appSettings?.claudeApiKey ? '#10b981' : '#f59e0b' }}>
                  {appSettings?.claudeApiKey
                    ? '✅ API Key kayıtlı — AI Quick Add aktif'
                    : '⚠️ API Key girilmedi — AI Quick Add çalışmaz. Netlify env var olarak da ekleyebilirsiniz: CLAUDE_API_KEY'}
                </p>
              </div>
              <div>
                <label style={labelStyle}>AI Modeli</label>
                <select
                  value={appSettings?.claudeModel || 'claude-sonnet-4-20250514'}
                  onChange={e => setAppSettings({ ...appSettings, claudeModel: e.target.value })}
                  style={selectStyle}
                >
                  <option value="claude-sonnet-4-20250514">Claude Sonnet 4 (Önerilen)</option>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (Hızlı/Ucuz)</option>
                </select>
              </div>
            </div>
          </div>

          {/* DS-160 Site URL */}
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>🇺🇸</div>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', fontWeight: '600' }}>DS-160 Site URL</h3>
                <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>Amerika vize başvuru formu sitesi</p>
              </div>
            </div>
            <input
              type="text"
              value={appSettings?.ds160SiteUrl || 'https://ds160-paydos.netlify.app'}
              onChange={e => setAppSettings({ ...appSettings, ds160SiteUrl: e.target.value })}
              placeholder="https://ds160-paydos.netlify.app"
              style={{ ...inputStyle }}
            />
          </div>

        </div>
      )}

      {/* PROFİLİM */}
      {activeTab === 'users' && (
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
      {activeTab === 'users' && (
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
      {/* 🎫 TUR AYARLARI — Oda Tipleri */}
      {activeTab === 'tourSettings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#f59e0b' }}>🛏️ Oda Tipleri</h3>
            <p style={{ margin: '0 0 16px', fontSize: '11px', color: '#64748b' }}>Rezervasyon formunda görünecek oda tiplerini yönetin. Örn: Single, Double, Twin, Triple, Suite</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {(appSettings?.roomTypes || ['Single', 'Double', 'Twin', 'Triple']).map((rt, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(245,158,11,0.15)', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: '600' }}>{rt}</span>
                  <button onClick={() => setAppSettings({ ...appSettings, roomTypes: (appSettings.roomTypes || ['Single', 'Double', 'Twin', 'Triple']).filter((_, i) => i !== idx) })}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="text" value={newRoomType} onChange={e => setNewRoomType(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newRoomType.trim()) { setAppSettings({ ...appSettings, roomTypes: [...(appSettings.roomTypes || []), newRoomType.trim()] }); setNewRoomType(''); } }}
                placeholder="Oda tipi ekle (örn: Suite, Aile Odası...)"
                style={{ flex: 1, padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px' }} />
              <button onClick={() => { if (newRoomType.trim()) { setAppSettings({ ...appSettings, roomTypes: [...(appSettings.roomTypes || []), newRoomType.trim()] }); setNewRoomType(''); } }}
                style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
                ➕ Ekle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIL AYARLARI */}
      {activeTab === 'mailSettings' && isAdmin && (
        <MailSettingsPanel appSettings={appSettings} setAppSettings={setAppSettings} showToast={showToast} />
      )}

      {/* DOSYA EKLERİ */}
      {activeTab === 'attachmentSettings' && isAdmin && (
        <AttachmentSettingsPanel appSettings={appSettings} setAppSettings={setAppSettings} showToast={showToast} />
      )}

    </div>
  );
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeModule, setActiveModule] = useState('dashboard');
  const [prevModule, setPrevModule] = useState(null);
  const navigateTo = (mod) => { setPrevModule(activeModule); setActiveModule(mod); };
  const navigateBack = () => { if (prevModule) { setActiveModule(prevModule); setPrevModule(null); } else setActiveModule('dashboard'); };
  const [openCustomerId, setOpenCustomerId] = useState(null); // dashboard'dan müşteriye git
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
    visaStatuses: ['Evrak Topluyor', 'Evrak Tamamlandı', 'Randevu Alındı', 'Başvuru Yapıldı', 'Sonuç Bekliyor', 'Onaylandı', 'Reddedildi', 'Ödenmedi'],
    roomTypes: ['Single', 'Double', 'Twin', 'Triple', 'Suite'],
    bankInfo: {
      bankName: 'Ziraat Bankası',
      accountName: 'PAYDOS TURİZM',
      iban: 'TR00 0000 0000 0000 0000 0000 00',
      swift: 'TCZBTR2AXXX'
    },
    emailTemplates: {},
    autoEmailOnVisa: true,
    attachments: []
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
  // Login persistence
  useEffect(() => {
    const loggedIn = localStorage.getItem('paydos_logged_in');
    const savedUser = localStorage.getItem('paydos_current_user');
    if (loggedIn === 'true' && savedUser) {
      try { setCurrentUser(JSON.parse(savedUser)); setIsLoggedIn(true); } catch(e) {}
    }
  }, []);

  // localStorage'dan yükle - EN ÖNCE (hızlı cache)
  useEffect(() => { const saved = localStorage.getItem('paydos_customers'); if (saved) { try { setCustomers(JSON.parse(saved)); } catch(e) {} } }, []);
  useEffect(() => { const saved = localStorage.getItem('paydos_visa_applications'); if (saved) { try { setVisaApplications(JSON.parse(saved)); } catch(e) {} } }, []);
  useEffect(() => {
    const saved = localStorage.getItem('paydos_app_settings');
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        if (settings.visaDurations) {
          Object.keys(settings.visaDurations).forEach(country => {
            const durations = settings.visaDurations[country];
            if (durations && durations.length > 0 && typeof durations[0] === 'string') {
              settings.visaDurations[country] = durations.map(name => ({ name, price: 0, currency: country === 'usa' ? '$' : country === 'uk' ? '£' : '€' }));
            }
          });
        }
        setAppSettings(settings);
      } catch(e) {}
    }
  }, []);
  useEffect(() => { const saved = localStorage.getItem('paydos_tours'); if (saved) { try { setTours(JSON.parse(saved)); } catch(e) {} } }, []);
  useEffect(() => { const saved = localStorage.getItem('paydos_agencies'); if (saved) { try { setAgencies(JSON.parse(saved)); } catch(e) {} } }, []);
  useEffect(() => { const saved = localStorage.getItem('paydos_credit_cards'); if (saved) { try { setCreditCards(JSON.parse(saved)); } catch(e) {} } }, []);
  useEffect(() => { const saved = localStorage.getItem('paydos_quotes'); if (saved) { try { setQuotes(JSON.parse(saved)); } catch(e) {} } }, []);
  useEffect(() => { const saved = localStorage.getItem('paydos_users'); if (saved) { try { setUsers(JSON.parse(saved)); } catch(e) {} } }, []);

  // 🔥 FIRESTORE'DAN YÜKLE — tam veri
  const firestoreLoaded = useRef(false);
  useEffect(() => {
    if (firestoreLoaded.current) return;
    firestoreLoaded.current = true;

    const unsubs = [];

    // Küçük koleksiyonlar: tam gerçek zamanlı dinleme
    const smallCollections = [
      { name: 'visa_applications', setter: setVisaApplications },
      { name: 'tours', setter: setTours },
      { name: 'agencies', setter: setAgencies },
      { name: 'credit_cards', setter: setCreditCards },
      { name: 'quotes', setter: setQuotes },
      { name: 'users', setter: setUsers }
    ];

    for (const col of smallCollections) {
      const unsub = onSnapshot(collection(db, col.name), (snapshot) => {
        if (snapshot.empty) { col.setter([]); return; }
        const items = snapshot.docs.map(d => ({ ...d.data(), _docId: d.id }));
        col.setter(items);
        try { localStorage.setItem(`paydos_${col.name}`, JSON.stringify(items)); } catch(e) {}
      }, (e) => console.warn(`${col.name} dinleme hatası:`, e.message));
      unsubs.push(unsub);
    }

    // Customers: ilk yükleme getDocs, sonra değişen kayıtları onSnapshot ile yakala
    const loadCustomers = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'customers'));
        if (!snapshot.empty) {
          let items = snapshot.docs.map(d => ({ ...d.data(), _docId: d.id }));
          items = items.filter(c => c.firstName || c.lastName);
          // Pasaport tipi düzeltme
          items = items.map(c => {
            try {
              const pList = typeof c.passports === 'string' ? JSON.parse(c.passports || '[]') : (c.passports || []);
              if (!Array.isArray(pList)) return c;
              let changed = false;
              const fixed = pList.map(p => {
                if (!p.passportNo) return p;
                const first = p.passportNo.toUpperCase()[0];
                const detected = first === 'U' ? 'Bordo Pasaport (Umuma Mahsus)' : first === 'S' ? 'Yeşil Pasaport (Hususi)' : first === 'Z' ? 'Gri Pasaport (Hizmet)' : null;
                if (detected && p.passportType !== detected) { changed = true; return { ...p, passportType: detected }; }
                return p;
              });
              if (changed) {
                const docId = c._docId || String(c.id);
                setDoc(doc(db, 'customers', docId), { passports: JSON.stringify(fixed) }, { merge: true }).catch(()=>{});
                return { ...c, passports: fixed };
              }
            } catch(e) {}
            return c;
          });
          setCustomers(items);
          try {
            const lite = items.map(c => {
              const obj = { ...c };
              try { const p = typeof obj.passports === 'string' ? JSON.parse(obj.passports) : obj.passports; if (Array.isArray(p)) obj.passports = JSON.stringify(p.map(x => ({ ...x, image: (x.image||'').startsWith('http') ? x.image : '' }))); } catch(e) {}
              try { const v = typeof obj.schengenVisas === 'string' ? JSON.parse(obj.schengenVisas) : obj.schengenVisas; if (Array.isArray(v)) obj.schengenVisas = JSON.stringify(v.map(x => ({ ...x, image: (x.image||'').startsWith('http') ? x.image : '' }))); } catch(e) {}
              try { const u = typeof obj.usaVisa === 'string' ? JSON.parse(obj.usaVisa) : obj.usaVisa; if (u) obj.usaVisa = JSON.stringify({ ...u, image: (u.image||'').startsWith('http') ? u.image : '' }); } catch(e) {}
              return obj;
            });
            localStorage.setItem('paydos_customers', JSON.stringify(lite));
          } catch(e) {}
        }
      } catch(e) { console.warn('customers yüklenemedi:', e.message); }
    };
    loadCustomers();

    // Customers için gerçek zamanlı: sadece son 2 dakikada değişen kayıtları dinle
    const twoMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 1000));
    const recentCustomersQuery = query(
      collection(db, 'customers'),
      where('updatedAt', '>=', twoMinutesAgo.toDate().toISOString())
    );
    const custUnsub = onSnapshot(recentCustomersQuery, (snapshot) => {
      if (snapshot.empty) return;
      snapshot.docChanges().forEach(change => {
        const data = { ...change.doc.data(), _docId: change.doc.id };
        if (change.type === 'added' || change.type === 'modified') {
          setCustomers(prev => {
            const exists = prev.find(c => c._docId === data._docId || String(c.id) === String(data.id));
            if (exists) return prev.map(c => (c._docId === data._docId || String(c.id) === String(data.id)) ? data : c);
            return [...prev, data];
          });
        } else if (change.type === 'removed') {
          setCustomers(prev => prev.filter(c => c._docId !== data._docId));
        }
      });
    }, (e) => console.warn('customers realtime hatası:', e.message));
    unsubs.push(custUnsub);

    // App settings
    const settingsUnsub = onSnapshot(collection(db, 'app_settings'), (snapshot) => {
      if (!snapshot.empty) {
        const settingsDoc = snapshot.docs[0].data();
        if (settingsDoc) {
          setAppSettings(prev => ({ ...prev, ...settingsDoc }));
          try { localStorage.setItem('paydos_app_settings', JSON.stringify(settingsDoc)); } catch(e) {}
        }
      }
    }, (e) => console.warn('app_settings dinleme hatası:', e.message));
    unsubs.push(settingsUnsub);

    // Cleanup: bileşen unmount olunca dinleyicileri kapat
    return () => unsubs.forEach(u => u());
  }, []);

  // 🔥 FIRESTORE'A KAYDET — debounced
  const saveTimers = useRef({});
  const initialLoadDone = useRef(false);
  useEffect(() => { const t = setTimeout(() => { initialLoadDone.current = true; }, 5000); return () => clearTimeout(t); }, []);

  const debouncedSave = useCallback((key, collectionName, data, isSettings = false) => {
    if (!initialLoadDone.current) return;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      try {
        if (isSettings) {
          const snapshot = await getDocs(collection(db, collectionName));
          const docId = snapshot.empty ? 'main' : snapshot.docs[0].id;
          await setDoc(doc(db, collectionName, docId), data, { merge: true });
        } else {
          // Müşteriler için silme sync YAPMA (4000+ kayıt çok pahalı - silme deleteDoc ile yapılıyor)
          if (collectionName !== 'customers') {
            const snapshot = await getDocs(collection(db, collectionName));
            const currentIds = new Set(data.map(item => (item._docId || item.id?.toString())));
            let delBatch = writeBatch(db);
            let delCount = 0;
            for (const fsDoc of snapshot.docs) {
              if (!currentIds.has(fsDoc.id)) {
                delBatch.delete(fsDoc.ref);
                delCount++;
                if (delCount >= 400) { await delBatch.commit(); delBatch = writeBatch(db); delCount = 0; }
              }
            }
            if (delCount > 0) await delBatch.commit();
          }
          // State'teki kayıtları kaydet
          let batch = writeBatch(db);
          let count = 0;
          for (const item of data) {
            const docId = item._docId || item.id?.toString() || Date.now().toString();
            const saveData = { ...item };
            delete saveData._docId;
            if (collectionName === 'customers') {
              delete saveData.passports;
              delete saveData.schengenVisas;
              delete saveData.usaVisa;
            }
            batch.set(doc(db, collectionName, docId), saveData, { merge: true });
            count++;
            if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
          }
          if (count > 0) await batch.commit();
        }
        try {
          if (collectionName === 'customers') {
            const lite = data.map(c => {
              const obj = { ...c };
              try { const p = typeof obj.passports === 'string' ? JSON.parse(obj.passports) : obj.passports; if (Array.isArray(p)) obj.passports = JSON.stringify(p.map(x => ({ ...x, image: (x.image||'').startsWith('http') ? x.image : '' }))); } catch(e) {}
              try { const v = typeof obj.schengenVisas === 'string' ? JSON.parse(obj.schengenVisas) : obj.schengenVisas; if (Array.isArray(v)) obj.schengenVisas = JSON.stringify(v.map(x => ({ ...x, image: (x.image||'').startsWith('http') ? x.image : '' }))); } catch(e) {}
              try { const u = typeof obj.usaVisa === 'string' ? JSON.parse(obj.usaVisa) : obj.usaVisa; if (u) obj.usaVisa = JSON.stringify({ ...u, image: (u.image||'').startsWith('http') ? u.image : '' }); } catch(e) {}
              return obj;
            });
            localStorage.setItem(`paydos_${key}`, JSON.stringify(lite));
          } else {
            localStorage.setItem(`paydos_${key}`, JSON.stringify(data));
          }
        } catch(e) {}
      } catch(e) { console.error(`Firestore ${collectionName} kayıt hatası:`, e.message); }
    }, 3000);
  }, []);

  useEffect(() => { debouncedSave('customers', 'customers', customers); }, [customers]);
  useEffect(() => { debouncedSave('visa_applications', 'visa_applications', visaApplications); }, [visaApplications]);
  useEffect(() => { debouncedSave('tours', 'tours', tours); }, [tours]);
  useEffect(() => { debouncedSave('agencies', 'agencies', agencies); }, [agencies]);
  useEffect(() => { debouncedSave('credit_cards', 'credit_cards', creditCards); }, [creditCards]);
  useEffect(() => { debouncedSave('quotes', 'quotes', quotes); }, [quotes]);
  useEffect(() => { debouncedSave('users', 'users', users); }, [users]);
  useEffect(() => { debouncedSave('app_settings', 'app_settings', appSettings, true); }, [appSettings]);
  const handleLogin = (user) => { setIsLoggedIn(true); setCurrentUser(user); localStorage.setItem('paydos_logged_in', 'true'); localStorage.setItem('paydos_current_user', JSON.stringify(user)); };
  const handleLogout = () => { setIsLoggedIn(false); setCurrentUser(null); localStorage.removeItem('paydos_logged_in'); localStorage.removeItem('paydos_current_user'); };

  if (!isLoggedIn) return <LoginScreen onLogin={handleLogin} users={users} />;
  if (isLoading) return (<div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0c1929 0%, #1a3a5c 50%, #0d2137 100%)' }}><div style={{ textAlign: 'center' }}><div style={{ fontSize: '48px', marginBottom: '16px' }}>✈️</div><p style={{ color: '#94a3b8' }}>Yükleniyor...</p></div></div>);

  const menuItems = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' }, 
    { id: 'customers', icon: '👥', label: 'Müşteriler' },
    { id: 'visa', icon: '🌍', label: 'Vize' },
    { id: 'ds160', icon: '🇺🇸', label: 'Amerika Vize' },
    { id: 'tours', icon: '🎫', label: 'Turlar' },
    { id: 'quotes', icon: '📄', label: 'Teklif & Proforma' },
    { id: 'agencies', icon: '🏢', label: 'Acentelikler' },
    { id: 'cards', icon: '💳', label: 'Kredi Kartları' },
    { id: 'settings', icon: '⚙️', label: 'Ayarlar' }
  ];

  const renderModule = () => {
    switch (activeModule) {
      case 'dashboard': return <DashboardModule customers={customers} isMobile={isMobile} onNavigate={(customer) => { setOpenCustomerId(customer.id); setActiveModule('customers'); }} />;
      case 'customers': return <CustomerModule customers={customers} setCustomers={setCustomers} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} appSettings={appSettings} openCustomerId={openCustomerId} onOpenCustomerHandled={() => setOpenCustomerId(null)} onBack={navigateBack} />;
      case 'visa': return <VisaModule customers={customers} visaApplications={visaApplications} setVisaApplications={setVisaApplications} isMobile={isMobile} onNavigateToCustomers={() => setActiveModule('customers')} appSettings={appSettings} showToast={showToast} addToUndo={addToUndo} creditCards={creditCards} />;
      case 'ds160': return <DS160Module isMobile={isMobile} showToast={showToast} appSettings={appSettings} setAppSettings={setAppSettings} />;
      case 'tours': return <ToursModule tours={tours} setTours={setTours} customers={customers} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} appSettings={appSettings} onNavigateToCustomer={(c) => { setOpenCustomerId(c.id); navigateTo('customers'); }} />;
      case 'quotes': return <QuotesModule quotes={quotes} setQuotes={setQuotes} customers={customers} isMobile={isMobile} showToast={showToast} />;
      case 'agencies': return <AgenciesModule agencies={agencies} setAgencies={setAgencies} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} />;
      case 'cards': return <CreditCardsModule creditCards={creditCards} setCreditCards={setCreditCards} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} />;
      case 'settings': return <SettingsModule users={users} setUsers={setUsers} currentUser={currentUser} setCurrentUser={setCurrentUser} isMobile={isMobile} appSettings={appSettings} setAppSettings={setAppSettings} showToast={showToast} />;
      default: return <DashboardModule customers={customers} isMobile={isMobile} onNavigate={(customer) => { setOpenCustomerId(customer.id); setActiveModule('customers'); }} />;
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
        <nav style={{ flex: 1, padding: '16px 12px', overflowY: 'auto' }}>{menuItems.map((item, idx) => (<button key={item.id} onClick={() => { setActiveModule(item.id); if (isMobile) setSidebarOpen(false); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', marginBottom: '3px', background: activeModule === item.id ? 'rgba(245,158,11,0.15)' : 'transparent', border: activeModule === item.id ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent', borderRadius: '10px', color: activeModule === item.id ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: activeModule === item.id ? '600' : '400' }}><span style={{ fontSize: '16px' }}>{item.icon}</span>{item.label}{!isMobile && <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#64748b' }}>⌘{idx+1}</span>}</button>))}</nav>
        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}><div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}><div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '14px' }}>{currentUser?.name?.[0] || 'U'}</div><div><p style={{ margin: 0, fontSize: '13px', fontWeight: '600' }}>{currentUser?.name}</p><p style={{ margin: 0, fontSize: '10px', color: '#64748b' }}>{currentUser?.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}</p></div></div><button onClick={handleLogout} style={{ width: '100%', padding: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🚪 Çıkış Yap</button></div>
      </aside>
      <main style={{ marginLeft: isMobile ? 0 : '260px', minHeight: '100vh' }}>
        {isMobile && <header style={{ position: 'sticky', top: 0, background: 'rgba(12,25,41,0.95)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 50 }}><button onClick={() => setSidebarOpen(true)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#e8f1f8', cursor: 'pointer', fontSize: '18px' }}>☰</button><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '24px' }}>✈️</span><span style={{ fontWeight: '700' }}>Paydos</span></div><div style={{ width: '40px' }} /></header>}
        {renderModule()}
      </main>
    </div>
  );
}
