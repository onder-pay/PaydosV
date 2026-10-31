// Tarih, telefon, kimlik ve JSON yardımcıları (React'tan bağımsız)

export const formatDate = (d) => { if (!d) return '-'; if (typeof d !== 'string') d = String(d); if (/^\d{4}-\d{2}-\d{2}T/.test(d)) d = d.slice(0, 10); if (d.includes('-')) return d.split('-').reverse().join('.'); if (d.includes('.')) return d; return d; };

export const safeParseTags = (val) => { if (!val) return []; if (Array.isArray(val)) return val.filter(t => t && typeof t === 'string'); if (typeof val === 'string') return val.split(',').map(t => t.trim()).filter(Boolean); return []; };

export const safeParseActivities = (val) => { if (!val) return []; if (Array.isArray(val)) return val; if (typeof val === 'string') { try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch { return []; } } return []; };

export const safeParseJSON = (val) => { if (!val) return []; if (Array.isArray(val)) return val; if (typeof val === 'string') { try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch { return []; } } return []; };

export const safeParseObj = (val) => { if (!val) return {}; if (typeof val === 'object') return val; try { const o = JSON.parse(val); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

export const safeParseDate = (dateStr) => { if (!dateStr || typeof dateStr !== 'string') return null; const parts = dateStr.split('-'); if (parts.length !== 3) return null; const [year, month, day] = parts.map(Number); if (isNaN(year) || isNaN(month) || isNaN(day)) return null; const date = new Date(year, month - 1, day, 12, 0, 0); if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null; return date; };

export const getDaysLeft = (dateStr) => { const date = safeParseDate(dateStr); if (!date) return null; const today = new Date(); today.setHours(0, 0, 0, 0); date.setHours(0, 0, 0, 0); return Math.ceil((date - today) / (1000 * 60 * 60 * 24)); };

export const formatWhatsAppPhone = (phone) => {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  // Telefon alanına yanlışlıkla TC yazılmışsa (11 hane, 0 ile başlamaz, TC algoritması tutar) WhatsApp'a TC gitmesin
  if (digits.length === 11 && !digits.startsWith('0') && isValidTc(digits)) return '';
  if (digits.startsWith('00')) return digits.slice(2);   // 0049... uluslararası önek
  if (digits.startsWith('90')) return digits;            // +90 5XX...
  if (digits.startsWith('0')) return '90' + digits.slice(1); // 05XX... (yerel)
  if (digits.length <= 10) return '90' + digits;          // 5XX XXX XX XX
  return digits;                                          // yabancı numara (+49, +44 ...) — olduğu gibi
};

// WhatsApp mesaj linki. wa.me yönlendirmesi 4 baytlık emojileri (📱 🔒 📄 🤝…) "�" yapıyor;
// doğrudan WhatsApp adresi kullanılır: telefonda api.whatsapp.com, bilgisayarda web.whatsapp.com.
export const waUrl = (phone, text) => {
  const p = String(phone || '').replace(/\D/g, '');
  const mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  return `${mobile ? 'https://api.whatsapp.com/send' : 'https://web.whatsapp.com/send'}?${p ? `phone=${p}&` : ''}text=${encodeURIComponent(text || '')}`;
};

export const generateUniqueId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

// Telefon formatla: +90 5XX XXX XX XX
export const formatPhoneNumber = (value) => {
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

// Ekranda telefon: TR cep numarası ise "+90 5XX XXX XX XX", değilse olduğu gibi (kayıt değişmez)
export const showPhone = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('90') && d.length === 12) d = d.slice(2); if (d.startsWith('0') && d.length === 11) d = d.slice(1); return /^5\d{9}$/.test(d) ? formatPhoneNumber(d) : String(v || ''); };

// Pasaport No formatla: İlk harf büyük, 9 karakter
export const formatPassportNo = (value) => {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return '';
  const letter = cleaned[0].match(/[A-Z]/) ? cleaned[0] : '';
  if (!letter) return cleaned.slice(0, 1); // harf girilene kadar bekle
  const digits = cleaned.slice(1).replace(/[^0-9]/g, '').slice(0, 7);
  return letter + digits;
};

// Türkçe + büyük/küçük harf duyarsız normalize (arama için): Önder=Onder=ÖNDER
// Tarih alanı "gg.aa.yyyy" native input'unda yıl anormal (1900 öncesi / 2100 sonrası) girilirse yakalar
export const isSaneDate = (iso) => {
  if (!iso) return true; // boş tarih ayrı yerde zorunlu kontrolü yapılıyor
  const m = String(iso).match(/^(\d{4})-\d{2}-\d{2}$/);
  if (!m) return false;
  const y = parseInt(m[1], 10);
  return y >= 1900 && y <= 2100;
};

// TC Kimlik No algoritma kontrolü (11 hane, 0 ile başlamaz, 10. ve 11. hane kontrol basamakları)
export const isValidTc = (tc) => {
  const t = String(tc || '').trim();
  if (!/^[1-9]\d{10}$/.test(t)) return false;
  const d = t.split('').map(Number);
  const d10 = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10;
  return ((d10 + 10) % 10) === d[9] && d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
};

// Kur çevirisi (TCMB TL kurlarıyla çapraz): 1 birim `sale` para birimi kaç birim `pay` eder. Bilinmiyorsa 0.
// rates: { EUR: 50.1, USD: 43.2, ... } (1 birim yabancı para = ? TL — /.netlify/functions/kur)
const CUR_CODE = { '€': 'EUR', '$': 'USD', '£': 'GBP', '₺': 'TRY' };
export const crossRate = (pay, sale, rates) => {
  if (pay === sale) return 1;
  const tl = (c) => (c === '₺' ? 1 : (rates?.[CUR_CODE[c]] || 0));
  const a = tl(sale), b = tl(pay);
  return a && b ? a / b : 0;
};
// Ödemelerin satış para birimindeki toplamı: ödemede elle girilen kur (o.rate) önce, yoksa günün kuru.
// unknown: kuru bulunamayan ödeme var mı (o zaman toplam eksik olabilir)
export const paidInSale = (list, saleCur, rates) => (list || []).reduce((acc, o) => {
  const a = parseFloat(o.amount) || 0;
  if (!a) return acc;
  const r = parseFloat(String(o.rate || '').replace(',', '.')) || crossRate(o.currency || saleCur, saleCur, rates);
  if (!r) return { ...acc, unknown: true };
  return { ...acc, total: acc.total + a / r };
}, { total: 0, unknown: false });
