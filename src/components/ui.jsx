// Ortak ekran parçaları: form stilleri, bildirim (Toast), tarih seçici, kart/modal kutuları
import { useState, useEffect } from 'react';
import { travelCheck, TC_ICON, TC_COLOR } from '../lib/travel.js';
import { formatDate } from '../lib/format.js';

export const labelStyle = { display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: '500' };

export const inputStyle = { width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };

export const selectStyle = { width: '100%', padding: '10px 12px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };

// Açılamayan belge görseli boş kalmasın — alt metni kırmızı uyarı olarak görünür
export const onDocImgError = (e) => { const t = e.currentTarget; t.style.minHeight = '60px'; t.style.background = 'rgba(239,68,68,0.12)'; t.style.color = '#ef4444'; t.style.fontSize = '12px'; };

export function TravelCheckBox({ c, trip, compact }) {
  if (!c) return null;
  const r = travelCheck(c, trip);
  const worst = r.items.some(i => i.level === 'err') ? 'err' : r.items.some(i => i.level === 'warn') ? 'warn' : 'ok';
  return (
    <div style={{ marginTop: compact ? '4px' : '8px', padding: compact ? '5px 8px' : '8px 12px', borderRadius: '8px', background: `${TC_COLOR[worst]}14`, border: `1px solid ${TC_COLOR[worst]}40`, fontSize: compact ? '11px' : '12px', lineHeight: 1.6 }}>
      {!compact && <div style={{ fontWeight: 700, color: '#e8f1f8', marginBottom: '2px' }}>🛂 Pasaport & vize kontrolü{r.country ? ` · ${r.country}` : ''}{r.start ? ` · ${formatDate(r.start)}${r.end && r.end !== r.start ? ' – ' + formatDate(r.end) : ''}` : ''}</div>}
      {r.items.map((i, k) => <div key={k} style={{ color: TC_COLOR[i.level] }}>{TC_ICON[i.level]} {i.msg}</div>)}
    </div>
  );
}

// Toast Component
// Her bildirim kendi zamanlayıcısıyla da kapanır (üst bileşenin zamanlayıcısı kaçsa bile ekranda kalmasın)
export function ToastAutoClose({ id, ms, onClose }) {
  useEffect(() => { const t = setTimeout(() => onClose(id), ms + 500); return () => clearTimeout(t); }, [id]);
  return null;
}

export function Toast({ toasts, removeToast }) {
  return (
    // Sağ altta dikdörtgen kutular — üstteki butonları (➕ Rezervasyon vb.) ve formların alt Kaydet çubuğunu kapatmasın
    <div style={{ position: 'fixed', bottom: '110px', right: '20px', zIndex: 9999, display: 'flex', flexDirection: 'column-reverse', gap: '10px', maxWidth: 'calc(100vw - 40px)' }}>
      {toasts.map(toast => (
        <div key={toast.id} onClick={() => removeToast(toast.id)} style={{
          padding: '14px 18px',
          borderRadius: '6px',
          borderLeft: '5px solid rgba(255,255,255,0.55)',
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
          width: '340px',
          maxWidth: '100%',
          boxSizing: 'border-box',
          animation: 'slideIn 0.3s ease',
          fontSize: '14px',
          fontWeight: '500'
        }}>
          <span style={{ fontSize: '18px' }}>
            {toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'}
          </span>
          <ToastAutoClose id={toast.id} ms={toast.undo ? 8000 : 4000} onClose={removeToast} />
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
          <button onClick={(e) => { e.stopPropagation(); removeToast(toast.id); }} aria-label="Kapat" title="Kapat" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 0 0 4px' }}>✕</button>
        </div>
      ))}
      <style>{`@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}

// Loading Button Component
export function LoadingButton({ onClick, loading, disabled, children, style, ...props }) {
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

export function CalendarPicker({ label, value, onChange, minYear = 1920, maxYear = 2035, maxDate = null, minDate = null }) {
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

export function BirthDateInput({ label, value, onChange }) {
  return <CalendarPicker label={label} value={value} onChange={onChange} minYear={1920} maxYear={new Date().getFullYear()} maxDate={new Date().toISOString().split('T')[0]} />;
}

export function DateInput({ label, value, onChange }) {
  return <CalendarPicker label={label} value={value} onChange={onChange} minYear={2020} maxYear={2040} />;
}

export function FormInput({ label, ...p }) { return (<div><label style={labelStyle}>{label}</label><input {...p} style={inputStyle} /></div>); }

export function StatCard({ value, label, color, onClick, sublabel }) { return (<div onClick={onClick} style={{ background: `${color}15`, border: `1px solid ${color}30`, borderRadius: '12px', padding: '16px', cursor: onClick ? 'pointer' : 'default', minHeight: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}><div style={{ fontSize: '28px', fontWeight: '700', color }}>{value}</div><div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>{label}</div>{sublabel && <div style={{ fontSize: '10px', color, marginTop: '4px' }}>{sublabel}</div>}</div>); }

export function Modal({ children, onClose, title }) { return (<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: '20px' }}><div style={{ background: 'linear-gradient(180deg, #0f2744 0%, #0c1929 100%)', borderRadius: '12px', width: '100%', maxWidth: '400px', maxHeight: '85vh', overflow: 'auto', border: '1px solid rgba(255,255,255,0.1)' }}><div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ margin: 0, fontSize: '15px', flex: 1 }}>{title}</h3><button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', color: '#94a3b8', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button></div><div style={{ padding: '14px 16px' }}>{children}</div></div></div>); }

export function InfoBox({ label, value, highlight }) { return (<div style={{ background: highlight ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '8px', border: highlight ? '1px solid rgba(245,158,11,0.2)' : 'none' }}><p style={{ fontSize: '10px', color: highlight ? '#f59e0b' : '#64748b', marginBottom: '2px', textTransform: 'uppercase' }}>{label}</p><p style={{ fontSize: '12px', margin: 0, color: value ? (highlight ? '#f59e0b' : '#e8f1f8') : '#64748b' }}>{value || '-'}</p></div>); }
