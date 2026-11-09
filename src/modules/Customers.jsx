// 👥 Müşteriler modülü
import { BirthDateInput, DateInput, FormInput, InfoBox, Modal, inputStyle, labelStyle, onDocImgError, selectStyle, TravelCheckBox } from '../components/ui';
import { BulkDocInbox, visaAppBelongsTo, CUST_DOC_TYPES, customerLinkSlug, docTypeOf, publishCustomerLink, pdfUrlText, FingerprintBox } from '../components/shared';
import { XLSX } from '../lib/heavy.js';
import { canonPassportType, isoToCountry, passportTypes, placeTr, schengenCountries, turkishProvinces, tourCountries } from '../lib/data.js';
import { claudeRequest, logActivity } from '../lib/api.js';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, setDoc, writeBatch, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { extraFieldVal, fieldKeyLegacy, fieldKeyTr, nameForSave, normEmail, normalizeTr, titleCaseTr, trHas, asciiTr, namePairForSave } from '../lib/turkish.js';
import { formatDate, formatPassportNo, formatWhatsAppPhone, generateUniqueId, getDaysLeft, isSaneDate, isValidTc, safeParseActivities, safeParseDate, safeParseJSON, safeParseObj, safeParseTags, showPhone, waUrl } from '../lib/format.js';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { useEffect, useRef, useState, useMemo } from 'react';
import { detectFlights, detectHotel, nameCheck, sameFlight } from '../lib/docparse.js';
import { pdfFileText } from '../lib/pdf.js';
import { passportImageOf, downloadUrl } from '../lib/files.js';
import { residencePermitsOf } from '../lib/travel.js';


export function CustomerModule({ customers, setCustomers, tours = [], visaApplications = [], isMobile, appSettings, showToast, addToUndo, openCustomerId, onOpenCustomerHandled, onBack, currentUser, quickAction, onQuickActionDone, onGo }) {
  // 🖱️ Sağ tık / uzun bas menüsü: { x, y, c }  ·  tura ekle için tur seçici
  const [ctxMenu, setCtxMenu] = useState(null);
  const [tourPickFor, setTourPickFor] = useState(null); // tek müşteri ya da { many: [müşteriler] }
  const [selIds, setSelIds] = useState([]); // arama sonuçlarında çoklu seçim (ör. aynı firmadan 5 kişi)
  // 📣 Ticari ileti (kampanya bildirimi) yazılı onayı: işaretliyse müşteri linkinde kampanya kutusu işaretli gelir, müşteri kaldırabilir
  const setKampanyaOnay = async (list, on) => {
    const val = on ? { at: new Date().toISOString(), by: currentUser?.name || currentUser?.email || '' } : null;
    const ids = new Set(list.map(c => c.id));
    setCustomers(prev => prev.map(c => ids.has(c.id) ? { ...c, kampanyaOnay: val } : c));
    try {
      let b = writeBatch(db), n = 0;
      for (const c of list) { b.set(doc(db, 'customers', c._docId || String(c.id)), { kampanyaOnay: on ? val : deleteField() }, { merge: true }); if (++n >= 400) { await b.commit(); b = writeBatch(db); n = 0; } }
      if (n) await b.commit();
      showToast?.(on ? `📣 ${list.length} müşteriye yazılı kampanya onayı işlendi` : `Kampanya onayı kaldırıldı (${list.length})`, 'success');
    } catch (e) { showToast?.('Kaydedilemedi: ' + e.message, 'error'); }
  };
  const toggleSel = (id) => setSelIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const [tourPickQ, setTourPickQ] = useState('');
  const longPressRef = useRef(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close); window.addEventListener('scroll', close, true); window.addEventListener('resize', close); window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); window.removeEventListener('keydown', onKey); };
  }, [ctxMenu]);
  const openCtx = (e, c) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, c }); };
  const ctxHandlers = (c) => ({
    onContextMenu: (e) => openCtx(e, c),
    onTouchStart: (e) => { const t = e.touches[0]; const x = t.clientX, y = t.clientY; clearTimeout(longPressRef.current); longPressRef.current = setTimeout(() => { longPressRef.current = 'fired'; setCtxMenu({ x, y, c }); }, 550); },
    onTouchMove: () => { if (longPressRef.current !== 'fired') clearTimeout(longPressRef.current); },
    onTouchEnd: (e) => { if (longPressRef.current === 'fired') { e.preventDefault(); longPressRef.current = null; } else clearTimeout(longPressRef.current); },
  });
  const [activeTab, setActiveTab] = useState('search');
  const [dateRangeFrom, setDateRangeFrom] = useState('');
  const [dateRangeTo, setDateRangeTo] = useState('');
  const [dateRangeVisa, setDateRangeVisa] = useState('both'); // 'schengen' | 'usa' | 'both'
  const [showForm, setShowForm] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiImages, setAiImages] = useState([]); // [{type, base64, preview, mediaType}]
  const [cropModal, setCropModal] = useState(null); // {type, src, rotation}
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const cropDragRef = useRef(null);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  // Müşteri detayı açılınca tam kaydı (görseller dahil) sunucudan oku — liste önbellekten gelmiş olabilir
  const selectedKey = selectedCustomer ? (selectedCustomer._docId || String(selectedCustomer.id)) : null;
  useEffect(() => {
    if (!selectedKey) return;
    let cancelled = false;
    getDoc(doc(db, 'customers', selectedKey)).then(snap => {
      if (cancelled || !snap.exists()) return;
      const full = { ...snap.data(), _docId: snap.id };
      setSelectedCustomer(prev => (prev && (prev._docId || String(prev.id)) === selectedKey ? { ...prev, ...full } : prev));
    }).catch(e => console.warn('Müşteri detayı okunamadı:', e.message));
    return () => { cancelled = true; };
  }, [selectedKey]);
  const [formData, setFormData] = useState({});
  const [detailTab, setDetailTab] = useState('info');
  const [shareCust, setShareCust] = useState(null); // 🔗 Müşteri linki penceresi
  const [showDocInbox, setShowDocInbox] = useState(false); // 📤 Toplu belge yükleme
  const [showDupScan, setShowDupScan] = useState(false); // 🔍 Mükerrer / TC kontrolü
  const [timelineNote, setTimelineNote] = useState(''); // Geçmiş sekmesi elle not girişi
  const [imagePreview, setImagePreview] = useState({ show: false, src: '', title: '' });
  const [aiSaving, setAiSaving] = useState(false); // AI hızlı ekle: görseller yüklenirken çift tıklamayı engelle
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
    const visa = safeParseObj(c.usaVisa);
    return visa.endDate;
  });

  // USA vizesi 1 ay içinde bitecekler
  const usaExpiring = customers.filter(c => {
    const visa = safeParseObj(c.usaVisa);
    if (!visa.endDate) return false;
    const days = getDaysLeft(visa.endDate);
    return days !== null && days > 0 && days <= 30;
  });

  // Girilen tarih aralığında vizesi GEÇERLİ olan müşteriler (kesişim)
  const dateRangeMatches = (() => {
    if (!dateRangeFrom || !dateRangeTo) return [];
    const from = dateRangeFrom, to = dateRangeTo;
    const overlaps = (start, end) => !!start && !!end && start <= to && end >= from;
    return customers.filter(c => {
      if (dateRangeVisa !== 'usa') {
        if (safeParseJSON(c.schengenVisas).some(v => overlaps(v.startDate, v.endDate))) return true;
      }
      if (dateRangeVisa !== 'schengen') {
        let visa = {};
        try { visa = safeParseObj(c.usaVisa); } catch(e) {}
        if (overlaps(visa.issueDate || visa.startDate, visa.endDate)) return true;
      }
      return false;
    });
  })();

  // Yeşil Pasaportlu Olanlar (passportType veya pasaport no S ile başlıyor)
  const withGreenPassport = customers.filter(c => {
    const pList = safeParseJSON(c.passports);
    return pList.some(p =>
      trHas(p.passportType, 'yesil') || // 'Yeşil'/'Yesil' (bot eskiden ş'siz yazdı)
      (p.passportNo && p.passportNo.toUpperCase().startsWith('S'))
    );
  });

  // Filtreleme fonksiyonu
  // 🔍 Tek kutu akıllı arama: her kelime ad, soyad, TC, telefon, e-posta, doğum yeri, TK no, firma veya
  // pasaport no'dan birinde geçmeli ("ahmet öner" → ikisi de). Rakamlar telefon/TC/pasaport'ta rakam olarak aranır.
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const qTokens = normalizeTr(q).split(/\s+/).filter(t => t.length >= (/^\d+$/.test(t) ? 3 : 2));
  const hasActiveFilter = qTokens.length > 0 || !!filters.city || !!filters.sector;
  const digitsOf = (v) => String(v || '').replace(/\D/g, '');
  const filtered = !hasActiveFilter ? [] : customers.filter(c => {
    if (filters.city && normalizeTr(c.city || '') !== normalizeTr(filters.city)) return false;
    if (filters.sector && c.sector !== filters.sector) return false;
    if (!qTokens.length) return true;
    const text = normalizeTr([c.firstName, c.lastName, c.email, c.birthPlace || c.dogum_yeri, c.tkMemberNo || c.tk_uyelik_no, c.companyName || c.company, c.tcKimlik,
      ...safeParseJSON(c.passports).map(pp => pp.passportNo)].filter(Boolean).join(' '));
    const nums = [digitsOf(c.phone), digitsOf(c.phone).replace(/^(90|0)/, ''), digitsOf(c.tcKimlik)].filter(Boolean).join(' ');
    return qTokens.every(t => text.includes(t) || (/^\d+$/.test(t) && nums.includes(t.replace(/^(90|0)/, ''))));
  }).sort((a, b) => {
    // Adı/soyadı aranan kelimeyle başlayanlar önce
    const st = (c) => qTokens.some(t => normalizeTr(c.firstName || '').startsWith(t) || normalizeTr(c.lastName || '').startsWith(t)) ? 0 : 1;
    return st(a) - st(b) || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'tr');
  });
  const clearFilters = () => {
    setQ('');
    setFilters({ firstName: '', lastName: '', tcKimlik: '', phone: '', email: '', birthDate: '', birthPlace: '', city: '', tkMemberNo: '', sector: '', companyName: '' });
  };

  // Excel Export
  // visaKind: 'schengen' | 'usa' → vize ülkesi / başlangıç / bitiş sütunları eklenir
  const visaCols = (c, visaKind) => {
    if (visaKind === 'range') {
      // Tarih aralığı sekmesi: aralıkla kesişen vizeyi yaz (Schengen önce, sonra ABD)
      const ov = (a, b) => !!a && !!b && a <= dateRangeTo && b >= dateRangeFrom;
      const sv = dateRangeVisa !== 'usa' ? safeParseJSON(c.schengenVisas).filter(v => ov(v.startDate, v.endDate)).sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)))[0] : null;
      if (sv) return visaCols({ schengenVisas: JSON.stringify([sv]) }, 'schengen');
      return visaCols(c, 'usa');
    }
    if (visaKind === 'usa') {
      const u = safeParseObj(c.usaVisa);
      const left = getDaysLeft(u.endDate);
      return { 'Vize Ülkesi': 'ABD', 'Vize Başlangıç': formatDate(u.issueDate || u.startDate), 'Vize Bitiş': formatDate(u.endDate), 'Kalan Gün': left > 0 ? left : 'Doldu' };
    }
    if (visaKind === 'schengen') {
      const vs = safeParseJSON(c.schengenVisas).filter(v => v.country || v.endDate);
      // Ana vize: geçerli olanlardan en geç biteni, yoksa en son biten
      const sorted = [...vs].sort((a, b) => String(b.endDate || '').localeCompare(String(a.endDate || '')));
      const main = sorted[0] || {};
      const left = getDaysLeft(main.endDate);
      const others = sorted.slice(1).map(v => `${v.country || '?'} ${formatDate(v.startDate)}–${formatDate(v.endDate)}`).join('; ');
      return { 'Vize Ülkesi': main.country || '', 'Vize Başlangıç': formatDate(main.startDate), 'Vize Bitiş': formatDate(main.endDate), 'Kalan Gün': left > 0 ? left : (main.endDate ? 'Doldu' : ''), 'Diğer Vizeler': others };
    }
    return {};
  };
  const exportToExcel = (data, filename, visaKind) => {
    const exportData = data.map(c => ({
      'Ad': c.firstName || '',
      'Soyad': c.lastName || '',
      ...visaCols(c, visaKind),
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
          email: normEmail(row['E-posta'] || row['Email'] || row['email'] || ''),
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

        // Firestore'a yaz (customers otomatik senkronize edilmiyor — yazılmazsa sayfa yenilenince kaybolur)
        const now = new Date().toISOString();
        const toSave = newCustomers.map(c => ({ ...c, _docId: String(c.id), updatedAt: now, verified: false,
          firstName: nameForSave(c.firstName), lastName: nameForSave(c.lastName),
          passports: '[]', schengenVisas: '[]', usaVisa: '{}' }));
        for (let i = 0; i < toSave.length; i += 400) {
          const batch = writeBatch(db);
          toSave.slice(i, i + 400).forEach(c => { const { _docId, ...data } = c; batch.set(doc(db, 'customers', _docId), data); });
          await batch.commit();
        }
        setCustomers(prev => [...prev, ...toSave]);

        alert(`${toSave.length} müşteri başarıyla eklendi!`);
        setShowExcelModal(false);
      } catch (err) {
        console.error(err);
        alert('Excel içe aktarılamadı: ' + err.message);
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const resetForm = () => { 
    setFormData({ ...emptyForm, id: generateUniqueId() }); 
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

  // ⚡ Dashboard kısayolu: modül açılınca istenen formu hemen aç
  useEffect(() => { if (!quickAction) return; if (quickAction === 'new') openNewForm(); onQuickActionDone?.(); }, [quickAction]);
  
  // Düzenleme her zaman sunucudaki TAM kayıttan açılır. Telefonda toplu yükleme yarıda kalınca
  // CRM görselleri silinmiş önbellek kopyasıyla çalışıyordu; o kopyayla kaydetmek görselleri
  // Firestore'dan kalıcı olarak siliyordu.
  const openEditForm = async (customerArg) => {
    let customer = customerArg;
    try {
      const snap = await getDoc(doc(db, 'customers', customerArg._docId || String(customerArg.id)));
      if (snap.exists()) customer = { ...customerArg, ...snap.data(), _docId: snap.id };
    } catch (e) {
      showToast?.('❌ Sunucuya ulaşılamadı — görselleri kaybetmemek için düzenleme açılmadı. Bağlantıyı kontrol edip tekrar deneyin.', 'error');
      return;
    }
    setEditingCustomer(customer); 
    setFormData({ ...emptyForm, ...customer, birthPlace: customer.birthPlace || customer.dogum_yeri || '', tkMemberNo: customer.tkMemberNo || customer.tk_uyelik_no || '', tags: safeParseTags(customer.tags), activities: safeParseActivities(customer.activities) }); 
    // Pasaport bilgilerini yükle
    const savedPassports = safeParseJSON(customer.passports);
    setPassports(savedPassports.length > 0 ? savedPassports.map(p => ({ ...p, passportType: p.passportType ? canonPassportType(p.passportType) : p.passportType })) : [{ ...emptyPassport, id: generateUniqueId() }]);
    // Schengen bilgilerini yükle
    const savedSchengen = safeParseJSON(customer.schengenVisas).filter(v => v.country);
    setSchengenVisas(savedSchengen.length > 0 ? savedSchengen : [{ id: 1, country: '', startDate: '', endDate: '', image: '' }]);
    // USA bilgilerini yükle
    const savedUsa = safeParseObj(customer.usaVisa);
    setUsaVisa({ startDate: savedUsa.startDate || '', endDate: savedUsa.endDate || '', image: savedUsa.image || '' });
    setFormTab('info');
    setShowForm(true); 
  };

  const addPassport = () => {
    setPassports([...passports, { ...emptyPassport, id: generateUniqueId() }]);
  };

  const removePassport = (id) => {
    if (passports.length <= 1) return;
    setPassports(passports.filter(p => p.id !== id));
  };

  // Fonksiyonel güncelleme: görsel yüklemesi bitince eski (kapanıştaki) liste ile diğer alanlar ezilmesin
  const updatePassport = (id, field, value) => {
    setPassports(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  // === Firebase Storage yükleme (base64 -> Storage URL) ===
  // Devam eden görsel yüklemeleri — bitmeden kaydedilirse görsel kayboluyordu (yavaş mobil bağlantı)
  const [pendingUploads, setPendingUploads] = useState(0);
  const uploadDocImage = async (imageData, customerId, fileName) => {
    if (!imageData || imageData.startsWith('http')) return imageData;   // zaten URL
    if (!imageData.startsWith('data:')) return imageData;               // beklenmedik format
    setPendingUploads(n => n + 1);
    try {
      const storage = getStorage();
      const blob = await (await fetch(imageData)).blob();
      // Dosya adına zaman damgası: aynı ada yazınca URL değişmiyor, telefon eski görseli önbellekten gösteriyordu
      const stamped = fileName.replace(/(\.[a-z0-9]+)?$/i, (ext) => `_${Date.now()}${ext || '.jpg'}`);
      const sRef = ref(storage, `documents/${customerId}/${stamped}`);
      await uploadBytes(sRef, blob, { contentType: blob.type || 'image/jpeg' });
      return await getDownloadURL(sRef);
    } finally {
      setPendingUploads(n => Math.max(0, n - 1));
    }
  };
  // AI hızlı ekle: okunan belge fotoğraflarını Storage'a yükle (önceden fotoğraf okunup atılıyordu,
  // müşteride pasaport görseli hiç olmuyordu). Yüklenemeyen görsel atlanır — base64 kayda yazılmaz
  // (Firestore 1MB sınırını aşıp tüm kaydı bozabilir).
  const uploadAiImage = async (type, customerId, fileName) => {
    const img = aiImages.find(i => i.type === type);
    if (!img?.preview) return '';
    try { return await uploadDocImage(img.preview, customerId, fileName); }
    catch (e) { showToast?.(`⚠️ ${type === 'passport' ? 'Pasaport' : type === 'usa' ? 'ABD vize' : 'Schengen'} görseli yüklenemedi: ${e.message}`, 'warning'); return ''; }
  };

  // OCR için: URL ise indirip base64'e çevir, base64 ise olduğu gibi ver
  const imageToBase64 = async (imageData) => {
    if (!imageData) return '';
    if (imageData.startsWith('data:')) return imageData.split(',')[1];
    const blob = await (await fetch(imageData)).blob();
    return await new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  };

  // Toplu isim düzeltme: BÜYÜK/karışık isimleri titleCaseTr ile düzelt (bir kez çalıştırılır)
  // TEK SEFERLİK: kayıtlara gömülü (base64) belge görsellerini Storage'a taşı. Telegram botu görselleri
  // müşteri kaydının içine yazıyordu; bu yüzden müşteri listesi onlarca MB oluyor, telefonda yükleme yarıda
  // kalıp görseller görünmüyordu. Taşınan görselin yerine Storage adresi yazılır; görsel silinmez.
  const [migrating, setMigrating] = useState(null); // { done, total, moved, failed }
  const migrateEmbeddedImages = async () => {
    if (migrating) return;
    if (!window.confirm('Müşteri kayıtlarına gömülü tüm belge görselleri Storage\'a taşınacak.\n\n• Görseller silinmez, sadece yeri değişir.\n• Bilgisayardan ve iyi bağlantıyla çalıştırın, bitene kadar sayfayı kapatmayın.\n• Firestore yedeklemesi açık değilse önce onu açın.\n\nDevam edilsin mi?')) return;
    const ids = customers.map(c => c._docId || String(c.id)).filter(Boolean);
    const st = { done: 0, total: ids.length, moved: 0, failed: 0 };
    setMigrating({ ...st });
    const moveImg = async (obj, custId, name) => {
      if (!obj || typeof obj.image !== 'string' || !obj.image.startsWith('data:')) return obj;
      const url = await uploadDocImage(obj.image, custId, name);
      st.moved++;
      return { ...obj, image: url };
    };
    for (const id of ids) {
      try {
        const snap = await getDoc(doc(db, 'customers', id));
        if (snap.exists()) {
          const d = snap.data();
          const raw = `${d.passports || ''}${d.schengenVisas || ''}${typeof d.usaVisa === 'string' ? d.usaVisa : JSON.stringify(d.usaVisa || {})}`;
          if (raw.includes('data:image')) {
            const pp = await Promise.all(safeParseJSON(d.passports).map((x, i) => moveImg(x, id, `pasaport_${x.id || i}.jpg`)));
            const sv = await Promise.all(safeParseJSON(d.schengenVisas).map((x, i) => moveImg(x, id, `schengen_${x.id || i}.jpg`)));
            const us = await moveImg(safeParseObj(d.usaVisa), id, 'abd_vize.jpg');
            await setDoc(doc(db, 'customers', id), { passports: JSON.stringify(pp), schengenVisas: JSON.stringify(sv), usaVisa: JSON.stringify(us) }, { merge: true });
          }
        }
      } catch (e) { st.failed++; console.warn('Görsel taşıma hatası', id, e.message); }
      st.done++;
      if (st.done % 10 === 0 || st.done === st.total) setMigrating({ ...st });
    }
    setMigrating(null);
    showToast?.(`🖼️ ${st.moved} görsel Storage'a taşındı${st.failed ? `, ${st.failed} müşteride hata (tekrar çalıştırılabilir)` : ''}`, st.failed ? 'warning' : 'success');
  };

  const fixAllNames = async () => {
    const needsFix = customers.filter(c => {
      const fn = nameForSave(c.firstName || ''), ln = nameForSave(c.lastName || '');
      return (fn !== (c.firstName || '') || ln !== (c.lastName || '')) && (c.firstName || c.lastName);
    });
    if (needsFix.length === 0) { showToast?.('Düzeltilecek isim yok — hepsi düzgün ✓', 'success'); return; }
    if (!window.confirm(`${needsFix.length} müşterinin adı düzeltilecek (örn: "${needsFix[0].firstName} ${needsFix[0].lastName}" → "${nameForSave(needsFix[0].firstName)} ${nameForSave(needsFix[0].lastName)}").\n\nDevam edilsin mi?`)) return;
    const now = new Date().toISOString();
    const idOf = (c) => c._docId || String(c.id);
    const fixedMap = {};
    needsFix.forEach(c => { fixedMap[idOf(c)] = { firstName: nameForSave(c.firstName || ''), lastName: nameForSave(c.lastName || '') }; });
    setCustomers(prev => prev.map(c => fixedMap[idOf(c)] ? { ...c, ...fixedMap[idOf(c)], updatedAt: now } : c));
    let ok = 0, fail = 0;
    for (const c of needsFix) {
      try { await setDoc(doc(db, 'customers', idOf(c)), { ...fixedMap[idOf(c)], updatedAt: now }, { merge: true }); ok++; }
      catch (e) { fail++; }
    }
    showToast?.(`${ok} isim düzeltildi${fail ? `, ${fail} başarısız` : ''}`, fail ? 'warning' : 'success');
  };

  const handleSubmit = async () => {
    if (pendingUploads > 0) {
      showToast?.('⏳ Görsel yükleniyor, birkaç saniye sonra tekrar Kaydet\'e basın', 'warning');
      return;
    }
    if (!formData.firstName || !formData.lastName) {
      alert('Ad ve Soyad alanları zorunludur!');
      setFormTab('info');
      return;
    }

    // TC Kimlik opsiyonel — ama girildiyse eşsiz olmalı (aynı TC iki müşteride olamaz)
    if (formData.tcKimlik && formData.tcKimlik.trim()) {
      const tcDup = customers.find(c =>
        c.tcKimlik === formData.tcKimlik.trim() &&
        (c._docId ? c._docId !== editingCustomer?._docId : String(c.id) !== String(editingCustomer?.id))
      );
      if (tcDup) {
        showToast?.(sameCustName(tcDup, formData)
          ? `❌ Bu TC Kimlik No zaten kayıtlı: ${tcDup.firstName} ${tcDup.lastName} — mükerrer kayıt açmayın`
          : `❌ Bu TC başka isimle kayıtlı: ${titleCaseTr(`${tcDup.firstName || ''} ${tcDup.lastName || ''}`)}. TC eşsizdir — TC veya isimde hata var, kontrol ediniz.`, 'error');
        setFormTab('info');
        return;
      }
      if (!isValidTc(formData.tcKimlik) && !window.confirm(`TC Kimlik No geçersiz görünüyor (${formData.tcKimlik.trim()}): 11 hane ve doğrulama basamakları tutmuyor.\n\nYine de kaydedilsin mi?`)) {
        setFormTab('info');
        return;
      }
    }

    // === TARİH VALİDASYONU ===
    // Not: Süresi dolmuş pasaport/vize kaydı engellenmez — geçmiş vizeler başvurularda istenen
    // bilgidir ve eski kontrol, vizesi bitmiş müşterinin hiçbir bilgisinin güncellenmesine izin vermiyordu.
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
      firstName: nameForSave(formData.firstName || ''),
      lastName: nameForSave(formData.lastName || ''),
      passports: JSON.stringify(Array.isArray(passports) ? passports : []),
      schengenVisas: JSON.stringify(Array.isArray(schengenVisas) ? schengenVisas : []),
      usaVisa: usaVisa
    };
    
    let saveError = null;
    if (editingCustomer) {
      const auditData = { lastEditedAt: now, updatedAt: now };
      const updated = customers.map(c => (c._docId && editingCustomer._docId ? c._docId === editingCustomer._docId : String(c.id) === String(editingCustomer.id)) ? { ...c, ...fullData, ...auditData } : c);
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
      } catch (err) { console.error('Firestore kayıt hatası:', err); saveError = err; }
    } else {
      const newId = formData.id || generateUniqueId();
      const newCustomer = { ...fullData, id: newId, _docId: newId, createdAt: now.split('T')[0], lastEditedAt: now, updatedAt: now, verified: true };
      setCustomers([...customers, newCustomer]);
      try {
        await setDoc(doc(db, 'customers', newId), {
          ...newCustomer,
          passports: JSON.stringify(Array.isArray(passports) ? passports : []),
          schengenVisas: JSON.stringify(Array.isArray(schengenVisas) ? schengenVisas : []),
          usaVisa: JSON.stringify(usaVisa || {})
        });
      } catch (err) { console.error('Firestore kayıt hatası:', err); saveError = err; }
    }
    if (saveError) {
      // Önceden hata olsa da "Kaydedildi" deniyordu; kayıt sadece bu cihazda kalıyor, diğer cihazlara hiç gitmiyordu
      const big = /exceeds the maximum|too large|1048576|maximum size/i.test(saveError.message || '');
      showToast?.(big ? '❌ Kaydedilemedi: kayıt çok büyük (görseller sunucuya yüklenemedi). Görselleri tekrar yükleyin.' : '❌ Sunucuya kaydedilemedi: ' + (saveError.code || saveError.message), 'error');
      return;
    }
    showToast?.('✅ Kaydedildi', 'success');
    logActivity(editingCustomer ? 'status' : 'create', 'Müşteri', `${titleCaseTr(fullData.firstName)} ${titleCaseTr(fullData.lastName)}`.trim(), currentUser);
    // Kaydet sonrası: formu kapat, düzenlenen müşterinin detayında kal (listeye düşme)
    if (editingCustomer) {
      const savedId = editingCustomer._docId || editingCustomer.id;
      const savedCust = customers.find(c => (c._docId || c.id) === savedId);
      if (savedCust) setSelectedCustomer({ ...savedCust, ...fullData });
    }
    setShowForm(false);
    resetForm();
  };

  // Müşteriyi Firestore doküman kimliğiyle (_docId) eşleştirerek siler. Eskiden yalnızca c.id ile
  // eşleşiyordu; id alanı olmayan eski kayıtlarda yanlış kaydı silebilir / listeyi boşaltabilirdi.
  const deleteCustomer = async (cust) => {
    if (!cust) return;
    if (!confirm('Silmek istediğinize emin misiniz?')) return;
    const key = cust._docId || (cust.id != null ? String(cust.id) : null);
    if (!key) { showToast?.('Müşteri kimliği bulunamadı, silinemedi', 'error'); return; }
    const same = (c) => (c._docId || (c.id != null ? String(c.id) : null)) === key;
    setCustomers(prev => prev.filter(c => !same(c)));
    if (selectedCustomer && same(selectedCustomer)) setSelectedCustomer(null);
    logActivity('delete', 'Müşteri', `${titleCaseTr(cust.firstName)} ${titleCaseTr(cust.lastName)}`.trim(), currentUser);
    try { await deleteDoc(doc(db, 'customers', key)); }
    catch (e) { showToast?.('❌ Firestore\'dan silinemedi: ' + e.message, 'error'); }
  };

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
                <FormInput label="TC Kimlik No" value={formData.tcKimlik || ''} onChange={e => setFormData({...formData, tcKimlik: e.target.value})} maxLength="11" placeholder="11 haneli TC kimlik numarası (opsiyonel)" />
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>Telefon *</label>
                    {(() => {
                      const phoneVal = formData.phone || '+90 ';
                      const codeMatch = phoneVal.match(/^(\+\d{1,4})\s*/);
                      const curCode = codeMatch ? codeMatch[1] : '+90';
                      const curNum = phoneVal.replace(/^\+\d{1,4}\s*/, '');
                      const codes = [
                        ['🇹🇷 +90','+90'],['🇩🇪 +49','+49'],['🇬🇧 +44','+44'],['🇺🇸 +1','+1'],
                        ['🇫🇷 +33','+33'],['🇮🇹 +39','+39'],['🇳🇱 +31','+31'],['🇦🇹 +43','+43'],
                        ['🇨🇭 +41','+41'],['🇧🇪 +32','+32'],['🇪🇸 +34','+34'],['🇬🇷 +30','+30'],
                        ['🇷🇺 +7','+7'],['🇦🇪 +971','+971'],['🇸🇦 +966','+966'],['🇺🇦 +380','+380']
                      ];
                      return (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <select value={curCode} onChange={e => setFormData({...formData, phone: e.target.value + ' ' + curNum})} style={{ ...inputStyle, width: '95px', flexShrink: 0, paddingLeft: '8px', paddingRight: '4px' }}>
                            {codes.map(([label, val]) => <option key={val} value={val} style={{ background: '#0d1f33' }}>{label}</option>)}
                          </select>
                          <input
                            type="tel"
                            value={curNum}
                            onChange={e => setFormData({...formData, phone: curCode + ' ' + e.target.value.replace(/[^\d ]/g, '')})}
                            placeholder="5XX XXX XX XX"
                            style={{ ...inputStyle, flex: 1 }}
                          />
                        </div>
                      );
                    })()}
                  </div>
                  <FormInput label="E-posta" type="email" value={formData.email || ''} onChange={e => setFormData({...formData, email: normEmail(e.target.value)})} placeholder="ornek@email.com" />
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
                      // Bilinen alanlar müşteri kaydındaki gerçek anahtara bağlanır (eskiden 'dogum_yeri' / 'tk_uyelik_no'
                      // diye ayrı alana yazıyordu: formda boş görünüyor, girilen değer detaya/PDF'e hiç gitmiyordu)
                      const KNOWN_FIELD_KEYS = { 'Doğum Yeri': 'birthPlace', 'TK Üyelik No': 'tkMemberNo' };
                      if (KNOWN_FIELD_KEYS[field]) {
                        const k = KNOWN_FIELD_KEYS[field];
                        return <FormInput key={idx} label={field} value={formData[k] || ''} onChange={e => setFormData({...formData, [k]: e.target.value})} placeholder={field} />;
                      }
                      // Diğer alanlar için generic input - field ismini key olarak kullan
                      const fieldKey = fieldKeyTr(field), oldKey = fieldKeyLegacy(field);
                      return <FormInput key={idx} label={field} value={extraFieldVal(formData, field) || ''} onChange={e => { const n = { ...formData, [fieldKey]: e.target.value }; if (oldKey !== fieldKey) delete n[oldKey]; setFormData(n); }} placeholder={field} />;
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
                      {(appSettings?.sectors || []).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <CompanyPicker value={formData.companyName || ''} onChange={v => setFormData({...formData, companyName: v})} />
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
                        placeholder="U1234567" maxLength="8"
                        style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '2px', fontFamily: 'monospace', borderColor: passport.passportNo && validatePassportNo(passport.passportNo) ? '#ef4444' : undefined }} />
                      {passport.passportNo && validatePassportNo(passport.passportNo) && (
                        <div style={{ fontSize: '10px', color: '#ef4444', marginTop: '3px' }}>{validatePassportNo(passport.passportNo)}</div>
                      )}
                    </div>
                    <DateInput label="Veriliş" value={passport.issueDate || ''} onChange={v => updatePassport(passport.id, 'issueDate', v)} />
                    <DateInput label="Geçerlilik" value={passport.expiryDate || ''} onChange={v => updatePassport(passport.id, 'expiryDate', v)} />
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Pasaport Türü</label>
                      <select value={canonPassportType(passport.passportType || '')} onChange={e => updatePassport(passport.id, 'passportType', e.target.value)} style={{ ...selectStyle, padding: '10px', fontSize: '13px', width: '100%' }}>
                        {passportTypes.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Fotoğraf altta - tam genişlik */}
                  {passport.image ? (
                    <div>
                      <img src={passport.image} alt="Pasaport ⚠️ görsel açılamadı — tekrar yükleyin"
                            onError={onDocImgError}
                        onClick={() => setImagePreview({ show: true, src: passport.image, title: `Pasaport - ${passport.passportNo || ''}` })}
                        style={{ width: '100%', aspectRatio: '125/90', objectFit: 'cover', borderRadius: '10px', border: '2px solid rgba(59,130,246,0.4)', cursor: 'zoom-in', display: 'block' }} />
                      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <button type="button" onClick={async () => {
                          if (!passport.image) { showToast?.('Önce görsel ekleyin', 'error'); return; }
                          showToast?.('AI pasaport okuyor...', 'info');
                          try {
                            const b64 = await imageToBase64(passport.image);
                            const resp = await claudeRequest({
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 500, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text: 'Bu bir pasaport görüntüsü. SADECE şu JSON: {"passportNo":"","issueDate":"YYYY-MM-DD","expiryDate":"YYYY-MM-DD","birthDate":"YYYY-MM-DD","birthPlace":"","tcKimlik":"","nationality":"TUR"}. birthPlace = DOĞUM YERİ / PLACE OF BIRTH alanındaki şehir/ilçe (Türk pasaportunda Doğum tarihi alanının yakınında, BÜYÜK harfle yazılı il/ilçe adı, ör. DENIZLI, KARŞIYAKA; mutlaka oku, sadece hiç görünmüyorsa boş bırak). birthDate = DOĞUM TARİHİ / DATE OF BIRTH. tcKimlik = TC KİMLİK NO / PERSONAL NO (11 hane). nationality 3 harfli ISO kodu. Okunamayan alanı boş bırak.' }] }] })
                            });
                            const data = await resp.json();
                            const parsed = JSON.parse((data.content?.[0]?.text || '').replace(/```json|```/g, '').trim());
                            if (parsed.passportNo) {
                              const formattedNo = formatPassportNo(parsed.passportNo);
                              const validationErr = validatePassportNo(formattedNo);
                              if (validationErr) {
                                showToast?.(`⚠️ AI geçersiz pasaport no okudu: ${parsed.passportNo} — kaydedilmedi`, 'warning');
                              } else {
                                updatePassport(passport.id, 'passportNo', formattedNo);
                                const t = detectPassportType(formattedNo);
                                if (t) updatePassport(passport.id, 'passportType', t);
                              }
                            }
                            if (parsed.nationality) updatePassport(passport.id, 'nationality', isoToCountry(parsed.nationality));
                            // Veriliş / bitiş tarihi de pasaporta yazılır (önceden okunuyor ama kaydedilmiyordu)
                            const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && isSaneDate(d);
                            if (okDate(parsed.issueDate)) updatePassport(passport.id, 'issueDate', parsed.issueDate);
                            if (okDate(parsed.expiryDate)) updatePassport(passport.id, 'expiryDate', parsed.expiryDate);
                            if (parsed.birthPlace) setFormData(fd => ({ ...fd, birthPlace: placeTr(parsed.birthPlace) }));
                            if (parsed.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.birthDate)) setFormData(fd => ({ ...fd, birthDate: parsed.birthDate }));
                            if (parsed.tcKimlik && /^\d{11}$/.test(parsed.tcKimlik)) setFormData(fd => ({ ...fd, tcKimlik: fd.tcKimlik || parsed.tcKimlik }));
                            // Ne okunduğu / okunamadığı açıkça söylenir
                            const got = [parsed.passportNo && 'no', okDate(parsed.expiryDate) && 'bitiş', parsed.birthDate && 'doğum tarihi', parsed.birthPlace && 'doğum yeri', parsed.tcKimlik && 'TC'].filter(Boolean);
                            showToast?.(`Pasaport okundu (${got.join(', ') || 'alan yok'})${parsed.birthPlace ? '' : ' — ⚠️ doğum yeri okunamadı, elle girin'}`, parsed.birthPlace ? 'success' : 'warning');
                          } catch(err) { showToast?.('AI okuma başarısız', 'error'); }
                        }} style={{ flex: 1, padding: '8px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', color: '#8b5cf6', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                          🤖 AI ile Oku
                        </button>
                        <label style={{ flex: 1, textAlign: 'center', padding: '8px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: '#3b82f6', fontWeight: '600' }}>
                          🔄 Değiştir
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: async (img) => { try { const url = await uploadDocImage(img, formData.id, `pasaport_${passport.id}.jpg`); updatePassport(passport.id, 'image', url); } catch(err){ showToast?.('Görsel yüklenemedi: '+err.message,'error'); updatePassport(passport.id, 'image', img); } } }); reader.readAsDataURL(file); } }} />
                        </label>
                        <button type="button" onClick={() => updatePassport(passport.id, 'image', '')}
                          style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>× Kaldır</button>
                      </div>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', aspectRatio: '125/90', background: 'rgba(59,130,246,0.06)', border: '2px dashed rgba(59,130,246,0.25)', borderRadius: '10px', cursor: 'pointer', gap: '6px' }}>
                      <span style={{ fontSize: '28px' }}>📷</span>
                      <span style={{ fontSize: '12px', color: '#3b82f6', fontWeight: '600' }}>Pasaport Görseli Ekle</span>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: async (img) => { try { const url = await uploadDocImage(img, formData.id, `pasaport_${passport.id}.jpg`); updatePassport(passport.id, 'image', url); } catch(err){ showToast?.('Görsel yüklenemedi: '+err.message,'error'); updatePassport(passport.id, 'image', img); } } }); reader.readAsDataURL(file); } }} />
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
                      <img src={visa.image} alt="Vize ⚠️ görsel açılamadı — tekrar yükleyin" onError={onDocImgError}
                        onClick={() => setImagePreview({ show: true, src: visa.image, title: `Schengen - ${visa.country || ''}` })}
                        style={{ width: '100%', aspectRatio: '125/90', objectFit: 'cover', borderRadius: '10px', border: '2px solid rgba(16,185,129,0.3)', cursor: 'zoom-in', display: 'block' }} />
                      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <button type="button" onClick={async () => {
                          if (!visa.image) return;
                          showToast?.('AI vize okuyor...', 'info');
                          try {
                            const b64 = await imageToBase64(visa.image);
                            const resp = await claudeRequest({
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 300, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text: 'Bu Schengen vizesi. SADECE JSON: {"country":"Almanya","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}' }] }] })
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
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: async (img) => { try { const url = await uploadDocImage(img, formData.id, `schengen_${visa.id}.jpg`); setSchengenVisas(prev => prev.map(v => v.id === visa.id ? {...v, image: url} : v)); } catch(err){ showToast?.('Görsel yüklenemedi: '+err.message,'error'); setSchengenVisas(prev => prev.map(v => v.id === visa.id ? {...v, image: img} : v)); } } }); reader.readAsDataURL(file); } }} />
                        </label>
                        <button type="button" onClick={() => setSchengenVisas(schengenVisas.map(v => v.id === visa.id ? {...v, image: ''} : v))}
                          style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>× Kaldır</button>
                      </div>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', aspectRatio: '125/90', background: 'rgba(16,185,129,0.06)', border: '2px dashed rgba(16,185,129,0.25)', borderRadius: '10px', cursor: 'pointer', gap: '6px' }}>
                      <span style={{ fontSize: '28px' }}>📷</span>
                      <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '600' }}>Vize Görseli Ekle</span>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: async (img) => { try { const url = await uploadDocImage(img, formData.id, `schengen_${visa.id}.jpg`); setSchengenVisas(prev => prev.map(v => v.id === visa.id ? {...v, image: url} : v)); } catch(err){ showToast?.('Görsel yüklenemedi: '+err.message,'error'); setSchengenVisas(prev => prev.map(v => v.id === visa.id ? {...v, image: img} : v)); } } }); reader.readAsDataURL(file); } }} />
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
                    <img src={usaVisa.image} alt="ABD Vizesi ⚠️ görsel açılamadı — tekrar yükleyin" onError={onDocImgError}
                      onClick={() => setImagePreview({ show: true, src: usaVisa.image, title: 'ABD Vizesi' })}
                      style={{ width: '100%', aspectRatio: '125/90', objectFit: 'cover', borderRadius: '10px', border: '2px solid rgba(139,92,246,0.3)', cursor: 'zoom-in', display: 'block' }} />
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                      <label style={{ flex: 1, textAlign: 'center', padding: '8px', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: '#8b5cf6', fontWeight: '600' }}>
                        🔄 Değiştir
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: async (img) => { try { const url = await uploadDocImage(img, formData.id, `abd_vize.jpg`); setUsaVisa(prev => ({...prev, image: url})); } catch(err){ showToast?.('Görsel yüklenemedi: '+err.message,'error'); setUsaVisa(prev => ({...prev, image: img})); } } }); reader.readAsDataURL(file); } }} />
                      </label>
                      <button type="button" onClick={() => setUsaVisa({...usaVisa, image: ''})}
                        style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>× Kaldır</button>
                    </div>
                  </div>
                ) : (
                  <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', aspectRatio: '125/90', background: 'rgba(139,92,246,0.06)', border: '2px dashed rgba(139,92,246,0.25)', borderRadius: '10px', cursor: 'pointer', gap: '6px' }}>
                    <span style={{ fontSize: '28px' }}>📷</span>
                    <span style={{ fontSize: '12px', color: '#8b5cf6', fontWeight: '600' }}>Vize Görseli Ekle</span>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setCropModal({ type: 'passport', src: reader.result, rotation: 0, onSave: async (img) => { try { const url = await uploadDocImage(img, formData.id, `abd_vize.jpg`); setUsaVisa(prev => ({...prev, image: url})); } catch(err){ showToast?.('Görsel yüklenemedi: '+err.message,'error'); setUsaVisa(prev => ({...prev, image: img})); } } }); reader.readAsDataURL(file); } }} />
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
    const cUsa = safeParseObj(c.usaVisa);
    const hasGreenPassport = cPassports.some(p =>
      trHas(p.passportType, 'yesil') || // 'Yeşil'/'Yesil' (bot eskiden ş'siz yazdı)
      (p.passportNo && p.passportNo.toUpperCase().startsWith('S'))
    );

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(180deg, #0a1628 0%, #132742 50%, #0a1628 100%)', zIndex: 300, overflow: 'auto' }}>
        {/* Header */}
        <div style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, rgba(10,22,40,0.98) 0%, rgba(10,22,40,0.95) 100%)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: isMobile ? '12px 14px' : '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '10px' : '16px', flex: 1, minWidth: 0 }}>
            <button onClick={() => { setSelectedCustomer(null); setDetailTab('info'); if (onBack) onBack(); }} style={{ flex: 'none', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: isMobile ? '10px 12px' : '10px 16px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px' }}>{isMobile ? '←' : '← Geri'}</button>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: isMobile ? '16px' : '18px', color: '#ffffff', fontWeight: '600', lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{c.verified !== true ? '⚠️ ' : '✓ '}{titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</h2>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>{showPhone(c.phone)}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: isMobile ? '6px' : '8px', flex: 'none' }}>
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
              {isMobile ? (c.verified === true ? '✓' : '⚠️ Kontrol') : c.verified === true ? '✓ Kontrol Edildi' : '⚠️ Kontrol Et'}
            </button>
            <button onClick={() => setShareCust(c)} style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '10px', padding: '10px 14px', color: '#22c55e', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }} title="Bilet, otel belgesi, vize… tek linkte gönder">🔗 {isMobile ? 'Link' : 'Müşteri Linki'}</button>
            {!isMobile && <button onClick={() => { setSelectedCustomer(null); openEditForm(c); }} style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>✏️ Düzenle</button>}
          </div>
        </div>

        <LinkPinBar key={c._docId || c.id} c={c} showToast={showToast} />

        {/* Tab Navigation */}
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '16px' }}>
            {[
              { id: 'info', icon: '📋', label: 'Bilgiler', color: '#f59e0b' },
              { id: 'passport', icon: '🛂', label: 'Pasaport', color: '#3b82f6', count: cPassports.length },
              { id: 'schengen', icon: '🇪🇺', label: hasGreenPassport ? 'Muaf ✓' : 'Schengen', color: '#10b981', count: hasGreenPassport ? null : cSchengen.length },
              { id: 'usa', icon: '🇺🇸', label: 'ABD', color: '#8b5cf6', count: cUsa.endDate ? 1 : 0 },
              { id: 'timeline', icon: '📅', label: 'Geçmiş', color: '#a78bfa' }
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
                <span>{tab.label} {tab.count != null && `(${tab.count})`}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: isMobile ? '14px' : '20px', paddingBottom: '130px' }}>
          {/* KİŞİSEL BİLGİLER */}
          {detailTab === 'info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {(() => {
                // ---- Özet verileri ----
                const today = new Date().toISOString().slice(0, 10);
                const pp = [...cPassports].filter(p => p.passportNo || p.expiryDate).sort((a, b) => String(b.expiryDate || '').localeCompare(String(a.expiryDate || '')))[0];
                const ppDays = pp?.expiryDate ? getDaysLeft(pp.expiryDate) : null;
                const ppColor = !pp ? '#64748b' : ppDays == null ? '#f59e0b' : ppDays < 0 ? '#ef4444' : ppDays <= 180 ? '#ef4444' : ppDays <= 365 ? '#f59e0b' : '#10b981';
                const ppNote = !pp ? 'Pasaport eklenmemiş' : ppDays == null ? 'Geçerlilik tarihi yok' : ppDays < 0 ? 'Süresi dolmuş' : `${ppDays} gün kaldı`;
                const myApps = (visaApplications || []).filter(v => visaAppBelongsTo(v, c, customers))
                  .sort((a, b) => String(b.createdAt || b.applicationDate || '').localeCompare(String(a.createdAt || a.applicationDate || '')));
                const lastApp = myApps[0];
                const lastSch = [...cSchengen].sort((a, b) => String(b.endDate || '').localeCompare(String(a.endDate || '')))[0];
                const myTours = (tours || []).filter(t => (t.reservations || []).some(r => String(r.customerId) === String(c.id) && !r.cancelled))
                  .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')));
                const nextTour = myTours.find(t => (t.endDate || t.startDate || '') >= today);
                const lastTour = myTours[myTours.length - 1];
                const age = (() => { const d = safeParseDate(c.birthDate); if (!d) return null; const n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return a >= 0 && a < 130 ? a : null; })();

                const fields = [
                  ['TC Kimlik', c.tcKimlik],
                  ['Doğum', c.birthDate ? `${formatDate(c.birthDate)}${age != null ? ` · ${age} yaş` : ''}` : ''],
                  ['Doğum Yeri', placeTr(c.birthPlace || c.dogum_yeri)],
                  ['İkametgah', placeTr(c.city)],
                  ['Firma', titleCaseTr(c.companyName)],
                  ['Sektör', c.sector],
                  ['TK Üyelik', c.tkMemberNo || c.tk_uyelik_no],
                  ['E-posta', normEmail(c.email)],
                ].filter(([, v]) => v && v !== '-');
                const missing = [!c.tcKimlik && 'TC', !c.birthDate && 'doğum tarihi', !c.email && 'e-posta', !cPassports.length && 'pasaport'].filter(Boolean);

                const chip = { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', textDecoration: 'none', cursor: 'pointer', border: '1px solid', whiteSpace: 'nowrap' };
                const card = (color) => ({ textAlign: 'left', background: `linear-gradient(135deg, ${color}1f 0%, ${color}08 100%)`, border: `1px solid ${color}40`, borderRadius: '14px', padding: '14px 16px', cursor: 'pointer', color: '#e8f1f8', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, fontFamily: 'inherit' });
                const cardHead = { fontSize: '11px', color: '#94a3b8', fontWeight: '600', letterSpacing: '0.3px', display: 'flex', justifyContent: 'space-between', gap: '8px' };
                const big = { fontSize: '15px', fontWeight: '700', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
                const small = { fontSize: '12px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

                const dups = findLikelyDuplicates(c, customers);
                // Müşteri linkinden (Profil) kendi düzelttiği bilgiler — son 30 gün
                const SELF_TR = { phone: 'Telefon', email: 'E-posta', city: 'İkamet ili', tkMemberNo: 'Miles&Smiles no' };
                const selfEdits = (Array.isArray(c.selfEdits) ? c.selfEdits : []).filter(e => e && String(e.at || '') >= new Date(Date.now() - 30 * 86400000).toISOString()).slice(-5).reverse();
                const ko = c.kampanyaOnay && typeof c.kampanyaOnay === 'object' ? c.kampanyaOnay : null;
                return (<>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '8px 12px', background: ko ? 'rgba(168,85,247,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${ko ? 'rgba(168,85,247,0.35)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '10px', fontSize: '12.5px' }}>
                    <span>📣 Kampanya bildirimi onayı (yazılı): <b style={{ color: ko ? '#c084fc' : '#94a3b8' }}>{ko ? `Var · ${formatDate(ko.at)}${ko.by ? ` · ${ko.by}` : ''}` : 'Yok'}</b></span>
                    <button onClick={() => { if (ko ? window.confirm('Kampanya onayı kaldırılsın mı?') : window.confirm('Bu müşteriden yazılı ticari ileti (kampanya) onayı alındı mı?')) setKampanyaOnay([c], !ko); }} style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', background: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '12px' }}>{ko ? 'Kaldır' : 'Onay alındı'}</button>
                  </div>
                  {selfEdits.length > 0 && (
                    <div style={{ padding: '10px 14px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: '12px', fontSize: '12px', color: '#bfdbfe' }}>
                      <div style={{ fontWeight: '700', marginBottom: '4px' }}>📝 Müşteri bilgilerini linkten kendisi güncelledi</div>
                      {selfEdits.map((e, i) => (
                        <div key={i} style={{ color: '#94a3b8' }}>{formatDate(e.at)} · <b style={{ color: '#e8f1f8' }}>{SELF_TR[e.field] || e.field}</b>: <s>{e.old || '—'}</s> → <span style={{ color: '#e8f1f8' }}>{e.new || '(silindi)'}</span></div>
                      ))}
                    </div>
                  )}
                  {c.tcKimlik && !isValidTc(c.tcKimlik) && (
                    <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '12px', fontSize: '13px', color: '#fca5a5', fontWeight: '600' }}>⚠️ TC Kimlik No geçersiz görünüyor ({c.tcKimlik}) — 11 hane/doğrulama tutmuyor, kontrol ediniz.</div>
                  )}
                  {dups.length > 0 && (
                    <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ fontSize: '13px', color: '#fca5a5', fontWeight: '700' }}>{dups.some(d => isValidTc(c.tcKimlik) && String(d.tcKimlik || '').trim() === String(c.tcKimlik).trim() && !sameCustName(d, c)) ? '🚨 Aynı TC başka isimle kayıtlı — TC eşsizdir, TC veya isimde hata var, kontrol ediniz' : `⚠️ Olası mükerrer kayıt — aynı kişi ${dups.length + 1} kez kayıtlı olabilir`}</div>
                      {dups.map(d => (
                        <div key={d._docId || d.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '12px', color: '#e8f1f8' }}>
                          <span style={{ flex: 1, minWidth: '180px' }}>{titleCaseTr(`${d.firstName || ''} ${d.lastName || ''}`)} · TC {d.tcKimlik || '—'} · Pasaport {safeParseJSON(d.passports).map(p => p.passportNo).filter(Boolean).join(', ') || '—'}{d.createdAt ? ` · ${formatDate(d.createdAt)}` : ''}</span>
                          <button type="button" onClick={() => { setDetailTab('info'); setSelectedCustomer(d); }} style={{ padding: '6px 12px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', color: '#60a5fa', cursor: 'pointer', fontWeight: '600', fontSize: '12px', fontFamily: 'inherit' }}>Aç</button>
                        </div>
                      ))}
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>Doğru kaydı tutun; vize başvurusunu ona bağlayıp hatalı kaydı silin.</div>
                    </div>
                  )}
                  {/* Hızlı işlemler */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {c.phone && <a href={`https://wa.me/${formatWhatsAppPhone(c.phone)}`} target="_blank" rel="noopener noreferrer" style={{ ...chip, background: 'rgba(37,211,102,0.15)', borderColor: 'rgba(37,211,102,0.35)', color: '#25d366' }}>💬 {showPhone(c.phone)}</a>}
                    {c.phone && <a href={`tel:${String(c.phone).replace(/[^\d+]/g, '')}`} style={{ ...chip, background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.12)', color: '#e8f1f8' }}>📞 Ara</a>}
                    {c.email && <a href={`mailto:${c.email}`} style={{ ...chip, background: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.3)', color: '#60a5fa' }}>✉️ E-posta</a>}
                    {c.tcKimlik && <button type="button" onClick={() => { try { navigator.clipboard.writeText(String(c.tcKimlik)); showToast('TC kopyalandı', 'success'); } catch { /* izin yok */ } }} style={{ ...chip, background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.12)', color: '#e8f1f8', fontFamily: 'inherit' }}>📋 TC kopyala</button>}
                  </div>

                  {/* Özet kartları — tıklayınca ilgili sekmeye geçer */}
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
                    <button type="button" onClick={() => setDetailTab('passport')} style={card(ppColor)}>
                      <div style={cardHead}><span>🛂 PASAPORT</span>{cPassports.length > 1 && <span>{cPassports.length} adet</span>}</div>
                      <div style={big}>{pp ? `${trHas(pp.passportType, 'yesil') ? '🟢 Yeşil' : trHas(pp.passportType, 'gri') ? 'Gri' : pp.passportType?.includes('Siyah') ? 'Siyah' : 'Bordo'} · ${pp.passportNo || '—'}` : '—'}</div>
                      <div style={{ ...small, color: ppColor, fontWeight: '600' }}>{pp?.expiryDate ? `Bitiş ${formatDate(pp.expiryDate)} · ` : ''}{ppNote}</div>
                    </button>
                    <button type="button" onClick={() => setDetailTab(lastApp ? 'timeline' : 'schengen')} style={card(lastApp ? '#f59e0b' : hasGreenPassport ? '#10b981' : '#64748b')}>
                      <div style={cardHead}><span>📑 VİZE</span>{myApps.length > 0 && <span>{myApps.length} başvuru</span>}</div>
                      {lastApp ? (<>
                        <div style={big}>{lastApp.country || 'Başvuru'}{lastApp.visaDuration ? ` · ${lastApp.visaDuration}` : ''}</div>
                        <div style={{ ...small, color: '#fbbf24', fontWeight: '600' }}>{lastApp.status || 'Durum yok'}{lastApp.appointmentDate ? ` · Randevu ${formatDate(lastApp.appointmentDate)}` : ''}</div>
                      </>) : hasGreenPassport ? (<>
                        <div style={big}>Schengen muaf</div>
                        <div style={small}>Yeşil pasaport</div>
                      </>) : lastSch ? (<>
                        <div style={big}>{lastSch.country} vizesi</div>
                        <div style={{ ...small, color: getDaysLeft(lastSch.endDate) >= 0 ? '#10b981' : '#94a3b8' }}>{lastSch.endDate ? `Bitiş ${formatDate(lastSch.endDate)}${getDaysLeft(lastSch.endDate) < 0 ? ' · süresi dolmuş' : ''}` : 'Tarih yok'}</div>
                      </>) : (<>
                        <div style={big}>—</div>
                        <div style={small}>Başvuru veya vize kaydı yok</div>
                      </>)}
                    </button>
                    <button type="button" onClick={() => setDetailTab('timeline')} style={card(nextTour ? '#10b981' : '#64748b')}>
                      <div style={cardHead}><span>✈️ TUR</span>{myTours.length > 0 && <span>{myTours.length} tur</span>}</div>
                      {nextTour || lastTour ? (<>
                        <div style={big}>{(nextTour || lastTour).name || 'Tur'}</div>
                        <div style={{ ...small, color: nextTour ? '#10b981' : '#94a3b8', fontWeight: nextTour ? '600' : '400' }}>{nextTour ? ((nextTour.startDate || '') <= today ? 'Devam ediyor · ' : 'Yaklaşan · ') : 'Son tur · '}{formatDate((nextTour || lastTour).startDate)}{(nextTour || lastTour).country ? ` · ${(nextTour || lastTour).country}` : ''}</div>
                      </>) : (<>
                        <div style={big}>—</div>
                        <div style={small}>Tur kaydı yok</div>
                      </>)}
                    </button>
                  </div>

                  {/* Kişisel bilgiler — sadece dolu alanlar */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '14px 16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px 18px' }}>
                      {fields.map(([k, v]) => (
                        <div key={k} style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>{k}</div>
                          <div style={{ fontSize: '14px', color: '#e8f1f8', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: k === 'Firma' || k === 'E-posta' ? 'normal' : 'nowrap', wordBreak: 'break-word' }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {missing.length > 0 && (
                      <button type="button" onClick={() => { setSelectedCustomer(null); openEditForm(c); }} style={{ marginTop: '12px', background: 'rgba(245,158,11,0.08)', border: '1px dashed rgba(245,158,11,0.35)', borderRadius: '8px', padding: '6px 10px', color: '#f59e0b', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                        ⚠️ Eksik: {missing.join(', ')} — tamamla
                      </button>
                    )}
                  </div>

                  {c.notes && (
                    <div style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: '14px', padding: '12px 16px' }}>
                      <div style={{ fontSize: '11px', color: '#a78bfa', fontWeight: '600', marginBottom: '4px' }}>📝 NOTLAR</div>
                      <div style={{ fontSize: '13px', color: '#e8f1f8', whiteSpace: 'pre-wrap' }}>{c.notes}</div>
                    </div>
                  )}

                  <div style={{ fontSize: '11px', color: '#475569', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                    {c.createdAt && <span>Oluşturulma: {formatDate(c.createdAt)}</span>}
                    {c.lastEditedAt && <span>Son güncelleme: {new Date(c.lastEditedAt).toLocaleDateString('tr-TR')}</span>}
                  </div>
                </>);
              })()}

              {/* Dinamik Alanlar */}
              {appSettings?.personalDetailsFields?.filter(f => !['Doğum Tarihi', 'İkametgah İli', 'Doğum Yeri'].includes(f)).length > 0 && (() => {
                const extraFields = appSettings.personalDetailsFields.filter(f => !['Doğum Tarihi', 'İkametgah İli', 'Doğum Yeri'].includes(f));
                const hasValues = extraFields.some(f => {
                  return extraFieldVal(c, f);
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
                        const val = extraFieldVal(c, field);
                        return val ? <InfoBox key={idx} label={field} value={val} /> : null;
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
                          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: trHas(p.passportType, 'yesil') ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #3b82f6, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', color: 'white', fontWeight: '700' }}>{idx + 1}</div>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '14px', color: trHas(p.passportType, 'yesil') ? '#10b981' : '#3b82f6', fontWeight: '600' }}>{p.passportType || 'Pasaport'}</h4>
                            <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>{p.nationality || 'Türkiye'}</p>
                          </div>
                        </div>
                        {p.expiryDate && getDaysLeft(p.expiryDate) <= 180 && getDaysLeft(p.expiryDate) > 0 && (
                          <span style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '8px', background: 'rgba(239,68,68,0.2)', color: '#ef4444', fontWeight: '600' }}>⚠️ {getDaysLeft(p.expiryDate)} gün</span>
                        )}
                      </div>
                      <div style={{ display: isMobile ? 'flex' : 'grid', flexDirection: 'column', gridTemplateColumns: 'minmax(0, 1fr) 320px', alignItems: 'start', gap: '12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <InfoBox label="Pasaport No" value={p.passportNo} />
                          <InfoBox label="Veriliş Tarihi" value={formatDate(p.issueDate)} />
                          <InfoBox label="Geçerlilik Tarihi" value={formatDate(p.expiryDate)} highlight={p.expiryDate && getDaysLeft(p.expiryDate) <= 180} />
                        </div>
                        {p.image && (
                          <div>
                            <img src={p.image} alt="Pasaport ⚠️ görsel açılamadı — tekrar yükleyin"
                              onError={onDocImgError}
                              onClick={() => setImagePreview({ show: true, src: p.image, title: `Pasaport - ${p.passportNo}`, file: `${c.firstName || ''} ${c.lastName || ''} Pasaport ${p.passportNo || ''}` })}
                              style={{ width: '100%', aspectRatio: '125/90', objectFit: 'cover', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.3)', cursor: 'zoom-in', display: 'block' }} />
                            <button type="button" onClick={() => downloadUrl(p.image, `${c.firstName || ''} ${c.lastName || ''} Pasaport ${p.passportNo || ''}`).catch(e => showToast('İndirilemedi: ' + e.message, 'error'))}
                              style={{ marginTop: '6px', width: '100%', padding: '7px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: '8px', color: '#60a5fa', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>⬇️ Pasaportu indir</button>
                          </div>
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
              <FingerprintBox c={customers.find(x => x.id === c.id) || c} showToast={showToast} />
              <ResidencePermits c={customers.find(x => x.id === c.id) || c} showToast={showToast} onImage={(src, title, file) => setImagePreview({ show: true, src, title, file })} />
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
                      <div style={{ display: isMobile ? 'flex' : 'grid', flexDirection: 'column', gridTemplateColumns: 'minmax(0, 1fr) 320px', alignItems: 'start', gap: '12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <InfoBox label="Başlangıç" value={formatDate(v.startDate)} />
                          <InfoBox label="Bitiş" value={formatDate(v.endDate)} highlight={v.endDate && getDaysLeft(v.endDate) <= 90} />
                        </div>
                        {v.image && (
                          <img src={v.image} alt="Vize ⚠️ görsel açılamadı — tekrar yükleyin" onError={onDocImgError}
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
                    <div style={{ display: isMobile ? 'flex' : 'grid', flexDirection: 'column', gridTemplateColumns: 'minmax(0, 1fr) 320px', alignItems: 'start', gap: '12px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <InfoBox label="Vize Başlangıç" value={formatDate(cUsa.startDate)} />
                        <InfoBox label="Vize Bitiş" value={formatDate(cUsa.endDate)} highlight={cUsa.endDate && getDaysLeft(cUsa.endDate) <= 30} />
                      </div>
                      {cUsa.image && (
                        <img src={cUsa.image} alt="ABD Vizesi ⚠️ görsel açılamadı — tekrar yükleyin" onError={onDocImgError} onClick={() => setImagePreview({ show: true, src: cUsa.image, title: 'ABD Vizesi' })} style={{ width: '100%', aspectRatio: '125/90', objectFit: 'cover', borderRadius: '10px', border: '1px solid rgba(139,92,246,0.3)', cursor: 'zoom-in', display: 'block' }} />
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
          {detailTab === 'timeline' && (() => {
            // Otomatik olayları topla
            const events = [];
            if (c.createdAt) events.push({ icon: '👤', color: '#3b82f6', title: 'Müşteri kaydı oluşturuldu', time: c.createdAt });
            // Pasaportlar
            safeParseJSON(c.passports).forEach(p => {
              if (p.addedAt || p.createdAt) events.push({ icon: '📘', color: '#3b82f6', title: `Pasaport eklendi${p.passportNo ? ` (${p.passportNo})` : ''}`, time: p.addedAt || p.createdAt });
            });
            // Schengen vizeleri
            safeParseJSON(c.schengenVisas).filter(v => v.country).forEach(v => {
              if (v.createdAt || v.addedAt) events.push({ icon: '🇪🇺', color: '#10b981', title: `Schengen vizesi eklendi${v.country ? ` — ${v.country}` : ''}`, time: v.createdAt || v.addedAt });
            });
            // ABD vizesi
            const usa = c.usaVisa ? (typeof c.usaVisa === 'string' ? (() => { try { return JSON.parse(c.usaVisa || '{}'); } catch { return {}; } })() : c.usaVisa) : {};
            if (usa && (usa.createdAt || usa.addedAt)) events.push({ icon: '🇺🇸', color: '#8b5cf6', title: 'ABD vizesi eklendi', time: usa.createdAt || usa.addedAt });
            // Vize başvuruları (visa_applications) — bu müşteriye ait olanlar
            (visaApplications || []).filter(v => visaAppBelongsTo(v, c, customers)).forEach(v => {
              const yer = v.country ? ` — ${v.country}` : '';
              const tur = v.visaDuration ? ` (${v.visaDuration})` : '';
              events.push({ icon: '🛂', color: '#f59e0b', title: `Vize başvurusu${yer}${tur}${v.status ? ` · ${v.status}` : ''}`, time: v.createdAt || v.applicationDate });
            });
            // Turlar — bu müşterinin rezervasyonu olan turlar
            (tours || []).forEach(t => {
              const rez = (t.reservations || []).filter(r => String(r.customerId) === String(c.id) && !r.cancelled);
              if (rez.length > 0) {
                events.push({ icon: '🎫', color: '#10b981', title: `${t.name || 'Tur'} turuna katıldı`, time: t.startDate || t.createdAt });
              }
            });
            // Elle eklenen notlar (activities)
            const manualActs = safeParseJSON(c.activities);
            manualActs.forEach(a => {
              if (a && a.text) events.push({ icon: a.icon || '📌', color: '#a78bfa', title: a.text, time: a.time || a.createdAt, manual: true, id: a.id });
            });
            // Tarihe göre sırala (yeni → eski)
            events.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

            const addNote = async () => {
              const txt = (timelineNote || '').trim();
              if (!txt) { showToast('Not boş olamaz', 'warning'); return; }
              const acts = safeParseJSON(c.activities);
              const newAct = { id: generateUniqueId(), icon: '📌', text: txt, time: new Date().toISOString() };
              const updated = [...acts, newAct];
              const nc = { ...c, activities: JSON.stringify(updated) };
              setCustomers(prev => prev.map(x => x.id === c.id ? nc : x));
              setSelectedCustomer(nc);
              setTimelineNote('');
              try { await setDoc(doc(db, 'customers', c._docId || String(c.id)), { activities: JSON.stringify(updated) }, { merge: true }); } catch (e) {}
              showToast('Not eklendi', 'success');
            };
            const delNote = async (noteId) => {
              const acts = safeParseJSON(c.activities).filter(a => a.id !== noteId);
              const nc = { ...c, activities: JSON.stringify(acts) };
              setCustomers(prev => prev.map(x => x.id === c.id ? nc : x));
              setSelectedCustomer(nc);
              try { await setDoc(doc(db, 'customers', c._docId || String(c.id)), { activities: JSON.stringify(acts) }, { merge: true }); } catch (e) {}
              showToast('Not silindi', 'warning');
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Not ekleme */}
                <div style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: '14px', padding: '14px' }}>
                  <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#a78bfa', fontWeight: '600' }}>➕ Not / Aktivite Ekle</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input value={timelineNote} onChange={e => setTimelineNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNote(); }} placeholder="Örn: Tarkan konser turuna katıldı" style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={addNote} style={{ padding: '0 18px', background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)', border: 'none', borderRadius: '10px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '700', flexShrink: 0 }}>Ekle</button>
                  </div>
                </div>
                {/* Timeline */}
                {events.length === 0 ? (
                  <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                    <span style={{ fontSize: '48px' }}>📅</span>
                    <p style={{ color: '#64748b', marginTop: '12px' }}>Henüz kayıtlı işlem yok</p>
                  </div>
                ) : (
                  <div style={{ position: 'relative', paddingLeft: '28px' }}>
                    {/* Dikey çizgi */}
                    <div style={{ position: 'absolute', left: '10px', top: '8px', bottom: '8px', width: '2px', background: 'rgba(255,255,255,0.1)' }} />
                    {events.map((ev, i) => (
                      <div key={i} style={{ position: 'relative', marginBottom: '14px' }}>
                        <div style={{ position: 'absolute', left: '-24px', top: '2px', width: '22px', height: '22px', borderRadius: '50%', background: `${ev.color}22`, border: `2px solid ${ev.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' }}>{ev.icon}</div>
                        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <p style={{ margin: 0, fontSize: '13px', color: '#e8f1f8', fontWeight: '500' }}>{ev.title}</p>
                            <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{ev.time ? new Date(ev.time).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}</p>
                          </div>
                          {ev.manual && <button onClick={() => delNote(ev.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', flexShrink: 0 }} title="Notu sil">🗑️</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Bottom Action Buttons */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0a1628', borderTop: '1px solid rgba(255,255,255,0.08)', padding: isMobile ? '10px 14px calc(10px + env(safe-area-inset-bottom))' : '14px 20px', zIndex: 5 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <button onClick={() => { setSelectedCustomer(null); openEditForm(c); }} style={{ padding: '14px', background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <span>✏️</span> Düzenle
            </button>
            <button onClick={() => deleteCustomer(c)} style={{ padding: '14px', background: '#2a1520', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', color: '#ef4444', fontWeight: '600', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <span>🗑️</span> Sil
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Müşteri Kartı Render
  const renderCustomerCard = (c, selectable) => {
    const cPassports = safeParseJSON(c.passports);
    const cSchengen = safeParseJSON(c.schengenVisas).filter(v => v.country);
    const cUsa = safeParseObj(c.usaVisa);
    const expiringP = cPassports.find(p => { const d = getDaysLeft(p.expiryDate); return d !== null && d > 0 && d <= 180; });
    
    return (
      <div key={c.id} onClick={() => setSelectedCustomer(c)} {...ctxHandlers(c)} title="Sağ tık: vize başvurusu / tura ekle" style={{ background: c.verified !== true ? 'rgba(234,179,8,0.04)' : 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '12px', border: c.verified !== true ? '1px solid rgba(234,179,8,0.25)' : '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', minWidth: 0 }}>
            {selectable && <input type="checkbox" checked={selIds.includes(c.id)} onClick={e => e.stopPropagation()} onChange={() => toggleSel(c.id)} aria-label="Seç" style={{ width: '18px', height: '18px', marginTop: '1px', accentColor: '#f59e0b', flex: 'none', cursor: 'pointer' }} />}
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{c.verified !== true ? '⚠️ ' : ''}{titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</h3>
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{c.phone} {c.city && `• ${c.city}`}</p>
            {(c.companyName || c.sector) && <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#94a3b8' }}>{[c.companyName, c.sector].filter(Boolean).join(' · ')}</p>}
          </div>
          </div>
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {c.verified === true && <span style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '4px', background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>✓</span>}
            {cPassports.length > 0 && <span style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '4px', background: 'rgba(59,130,246,0.2)', color: '#3b82f6' }}>🛂 {cPassports.length}</span>}
            {cSchengen.length > 0 && <span style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '4px', background: 'rgba(16,185,129,0.2)', color: '#10b981' }}>🇪🇺 {cSchengen.length}</span>}
            {cUsa.endDate && <span style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '4px', background: 'rgba(139,92,246,0.2)', color: '#8b5cf6' }}>🇺🇸</span>}
            {expiringP && <span style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '4px', background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>⚠️ {getDaysLeft(expiringP.expiryDate)}g</span>}
          </div>
        </div>
      </div>
    );
  };

  const ctxItem = { display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#e8f1f8', padding: '10px 14px', fontSize: '13px', cursor: 'pointer', borderRadius: '6px' };
  const todayYmd = new Date().toISOString().slice(0, 10);
  const pickTours = tourPickFor ? tours
    .filter(t => !t.deleted && (t.endDate || t.startDate || '9999') >= todayYmd)
    .filter(t => { const q = tourPickQ.trim(); return !q || trHas(`${t.name || ''} ${t.country || ''} ${t.city || ''}`, q); })
    .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))) : [];
  const custInTour = (t, c) => (t.reservations || []).some(r => !r.cancelled && String(r.customerId) === String(c.id));

  return (
    <div style={{ padding: isMobile ? '16px' : '24px' }}>
      {ctxMenu && (
        <div onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()} style={{ position: 'fixed', left: Math.min(ctxMenu.x, window.innerWidth - 230), top: Math.min(ctxMenu.y, window.innerHeight - 190), zIndex: 3000, width: '220px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', padding: '6px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
          <div style={{ padding: '6px 14px 8px', fontSize: '11px', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleCaseTr(ctxMenu.c.firstName)} {titleCaseTr(ctxMenu.c.lastName)}</div>
          <button style={ctxItem} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'} onMouseLeave={e => e.currentTarget.style.background = 'none'} onClick={() => { const c = ctxMenu.c; setCtxMenu(null); onGo?.('visa', { type: 'visaFor', customer: c }); }}>📑 Vize başvurusu yap</button>
          <button style={ctxItem} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'} onMouseLeave={e => e.currentTarget.style.background = 'none'} onClick={() => { setTourPickFor(ctxMenu.c); setTourPickQ(''); setCtxMenu(null); }}>🎫 Tura ekle</button>
          <button style={{ ...ctxItem, color: '#94a3b8' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'} onMouseLeave={e => e.currentTarget.style.background = 'none'} onClick={() => { const c = ctxMenu.c; setCtxMenu(null); setSelectedCustomer(c); }}>👤 Müşteri kartını aç</button>
        </div>
      )}
      {selIds.length > 0 && (() => {
        const selCusts = selIds.map(id => customers.find(c => c.id === id)).filter(Boolean);
        return (
          <div style={{ position: 'fixed', left: isMobile ? '8px' : '50%', right: isMobile ? '8px' : 'auto', transform: isMobile ? 'none' : 'translateX(-50%)', bottom: isMobile ? '12px' : '24px', zIndex: 2500, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '10px 12px', background: '#0f2744', border: '1px solid rgba(245,158,11,0.5)', borderRadius: '14px', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b', marginRight: '4px' }} title={selCusts.map(c => `${titleCaseTr(c.firstName)} ${titleCaseTr(c.lastName)}`).join(', ')}>{selCusts.length} kişi seçili</span>
            <button onClick={() => { setTourPickFor({ many: selCusts }); setTourPickQ(''); }} style={{ padding: '8px 12px', borderRadius: '9px', border: 'none', background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#0c1929', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>🎫 Tura ekle</button>
            <button onClick={() => { setSelIds([]); onGo?.('visa', { type: 'visaForMany', customers: selCusts }); }} style={{ padding: '8px 12px', borderRadius: '9px', border: '1px solid rgba(59,130,246,0.5)', background: 'rgba(59,130,246,0.15)', color: '#93c5fd', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>📑 Vize başvurusu</button>
            <button onClick={() => { if (window.confirm(`Seçilen ${selCusts.length} müşteriden yazılı ticari ileti (kampanya) onayı alındı mı?\n\nOnaylarsanız müşteri linkinde kampanya bildirimi varsayılan açık gelir; müşteri istediğinde kapatır.`)) setKampanyaOnay(selCusts, true); }} title="Yazılı kampanya onayı işle" style={{ padding: '8px 12px', borderRadius: '9px', border: '1px solid rgba(168,85,247,0.45)', background: 'none', color: '#c084fc', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>📣 Kampanya onayı</button>
            <button onClick={() => exportToExcel(selCusts, `Secili_Musteriler_${new Date().toLocaleDateString('tr')}`)} style={{ padding: '8px 12px', borderRadius: '9px', border: '1px solid rgba(16,185,129,0.4)', background: 'none', color: '#10b981', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>📥 Excel</button>
            <button onClick={() => setSelIds([])} aria-label="Seçimi temizle" style={{ padding: '8px 10px', borderRadius: '9px', border: '1px solid rgba(255,255,255,0.15)', background: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>✕</button>
          </div>
        );
      })()}
      {tourPickFor && (
        <div onClick={() => setTourPickFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f2744', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '14px', width: '100%', maxWidth: '480px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 18px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '16px' }}>🎫 Tura ekle</h3>
                <button onClick={() => setTourPickFor(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }}>✕</button>
              </div>
              <p style={{ margin: '4px 0 10px', fontSize: '12px', color: '#94a3b8' }}>{tourPickFor.many ? `Seçilen ${tourPickFor.many.length} kişi` : `${titleCaseTr(tourPickFor.firstName)} ${titleCaseTr(tourPickFor.lastName)}`} hangi tura eklensin?</p>
              <input autoFocus value={tourPickQ} onChange={e => setTourPickQ(e.target.value)} placeholder="Tur ara..." style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px' }} />
            </div>
            <div style={{ overflowY: 'auto', padding: '8px' }}>
              {pickTours.length === 0 && <p style={{ textAlign: 'center', color: '#64748b', fontSize: '13px', padding: '20px' }}>Yaklaşan tur yok</p>}
              {pickTours.map(t => {
                const many = tourPickFor.many;
                const already = many ? many.filter(c => custInTour(t, c)).length : 0;
                const inT = many ? already === many.length : custInTour(t, tourPickFor);
                return (
                <button key={t.id} disabled={inT} onClick={() => {
                  const c = tourPickFor; setTourPickFor(null);
                  if (c.many) { setSelIds([]); onGo?.('tours', { type: 'resForMany', tourId: t.id, customers: c.many }); }
                  else onGo?.('tours', { type: 'resFor', tourId: t.id, customer: c });
                }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '10px 12px', marginBottom: '6px', color: '#e8f1f8', cursor: inT ? 'not-allowed' : 'pointer', opacity: inT ? 0.5 : 1 }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>{t.name}</span>
                    <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8' }}>{formatDate(t.startDate)}{t.endDate ? ` – ${formatDate(t.endDate)}` : ''} · {(t.reservations || []).filter(r => !r.cancelled).length} kişi</span>
                  </span>
                  <span style={{ fontSize: '11px', color: inT ? '#10b981' : '#3b82f6', whiteSpace: 'nowrap' }}>{inT ? '✓ zaten kayıtlı' : many && already ? `${many.length - already} kişi eklenecek →` : 'Seç →'}</span>
                </button>
              ); })}
            </div>
          </div>
        </div>
      )}
      {/* Başlık: ad + toplam, sağda tek ana eylem (Yeni) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
        <h2 style={{ fontSize: '20px', margin: 0, display: 'flex', alignItems: 'baseline', gap: '8px' }}>👥 Müşteriler <span style={{ fontSize: '13px', fontWeight: 500, color: '#64748b' }}>{customers.length.toLocaleString('tr-TR')}</span></h2>
        <button onClick={openNewForm} style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', padding: '10px 18px', color: '#0c1929', fontWeight: '700', cursor: 'pointer', fontSize: '14px', whiteSpace: 'nowrap' }}>➕ Yeni</button>
      </div>
      {/* İkincil işlemler: eşit, küçük düğmeler — telefonda tek satır, yana kayar */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px', marginBottom: '12px', scrollbarWidth: 'none' }}>
        {[
          ['🔄', 'Yenile', '#60a5fa', async () => {
            showToast?.('🔄 Yenileniyor...', 'info');
            try {
              const snapshot = await getDocs(collection(db, 'customers'));
              const items = snapshot.docs.map(d => ({ ...d.data(), _docId: d.id })).filter(c => c.firstName || c.lastName);
              setCustomers(items);
              showToast?.(`✅ ${items.length} müşteri yüklendi`, 'success');
            } catch (e) { showToast?.('❌ Yenileme hatası: ' + e.message, 'error'); }
          }, 'Müşterileri sunucudan yeniden yükle'],
          ['📊', 'Excel', '#34d399', () => setShowExcelModal(true), 'Excel içe / dışa aktar'],
          ['🤖', 'AI ile ekle', '#a78bfa', () => { setAiText(''); setAiResult(null); setAiImages([]); setShowAiModal(true); }, 'Metin veya pasaport görselinden müşteri ekle'],
          ['📤', 'Belge yükle', '#4ade80', () => setShowDocInbox(true), 'Bilet, biniş kartı, otel belgesi… isimden müşteriyi bulup linkine ekler'],
          ['🔍', 'Mükerrer / TC', '#f87171', () => setShowDupScan(true), 'Aynı TC farklı isim, aynı pasaport, mükerrer kayıt ve geçersiz TC\'leri listeler'],
        ].map(([ic, label, color, fn, title]) => (
          <button key={label} onClick={fn} title={title} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color, cursor: 'pointer', fontSize: '12.5px', fontWeight: 600, whiteSpace: 'nowrap' }}>
            <span>{ic}</span>{label}
          </button>
        ))}
      </div>

      {/* Sekmeler: tek satır çip, sayılar rozet — telefonda yana kayar */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px', marginBottom: '14px', scrollbarWidth: 'none' }}>
        {[
          ['search', '🔍', 'Arama', null, '#f59e0b'],
          ['expiring', '⚠️', 'Pasaport', expiringPassports.length, '#ef4444'],
          ['birthday', '🎂', 'Doğum günü', todayBirthdays.length, '#f472b6'],
          ['schengen', '🇪🇺', 'Schengen', withSchengen.length, '#10b981'],
          ['schengenExpiring', '⏰', 'Sch. 3 ay', schengenExpiring.length, '#eab308'],
          ['usa', '🇺🇸', 'ABD', withUsa.length, '#8b5cf6'],
          ['usaExpiring', '⏰', 'ABD 1 ay', usaExpiring.length, '#ef4444'],
          ['greenPassport', '🟢', 'Yeşil pas.', withGreenPassport.length, '#059669'],
          ['dateRange', '📅', 'Vize tarih', dateRangeFrom && dateRangeTo ? dateRangeMatches.length : null, '#06b6d4'],
        ].map(([key, ic, label, n, color]) => {
          const on = activeTab === key;
          return (
            <button key={key} onClick={() => setActiveTab(key)} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '999px', cursor: 'pointer', fontSize: '13px', fontWeight: on ? 700 : 500, whiteSpace: 'nowrap',
              background: on ? `${color}26` : 'rgba(255,255,255,0.04)', border: `1px solid ${on ? color + '80' : 'rgba(255,255,255,0.1)'}`, color: on ? color : '#cbd5e1' }}>
              <span>{ic}</span>{label}
              {n != null && <span style={{ fontSize: '11px', fontWeight: 700, padding: '1px 7px', borderRadius: '999px', background: n > 0 && key !== 'search' ? `${color}33` : 'rgba(255,255,255,0.08)', color: n > 0 ? (on ? color : '#e2e8f0') : '#64748b' }}>{n}</span>}
            </button>
          );
        })}
      </div>

      {/* VİZE TARİH ARALIĞI SEKMESİ */}
      {activeTab === 'dateRange' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: '10px', padding: '14px' }}>
            <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#06b6d4', fontWeight: '600' }}>📅 Bu tarih aralığında vizesi GEÇERLİ olanları bul</p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
              <div>
                <label style={labelStyle}>Başlangıç</label>
                <input type="date" value={dateRangeFrom} onChange={e => setDateRangeFrom(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Bitiş</label>
                <input type="date" value={dateRangeTo} min={dateRangeFrom || undefined} onChange={e => setDateRangeTo(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Vize Tipi</label>
                <select value={dateRangeVisa} onChange={e => setDateRangeVisa(e.target.value)} style={selectStyle}>
                  <option value="both">Schengen + ABD</option>
                  <option value="schengen">Sadece Schengen</option>
                  <option value="usa">Sadece ABD</option>
                </select>
              </div>
            </div>
          </div>

          {(!dateRangeFrom || !dateRangeTo) ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '30px' }}>Başlangıç ve bitiş tarihi girin</p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: '12px', color: '#06b6d4' }}>{dateRangeMatches.length} müşteri — {formatDate(dateRangeFrom)} – {formatDate(dateRangeTo)} arası vizesi geçerli</p>
                {dateRangeMatches.length > 0 && (
                  <button onClick={() => exportToExcel(dateRangeMatches, `Vize_Gecerli_${dateRangeFrom}_${dateRangeTo}`, 'range')} style={{ padding: '6px 12px', background: 'rgba(6,182,212,0.2)', border: 'none', borderRadius: '6px', color: '#06b6d4', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
                )}
              </div>
              {dateRangeMatches.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#64748b', padding: '30px' }}>Bu aralıkta vizesi geçerli müşteri yok</p>
              ) : (
                dateRangeMatches.map(c => {
                  const sch = safeParseJSON(c.schengenVisas).find(v => v.startDate && v.endDate && v.startDate <= dateRangeTo && v.endDate >= dateRangeFrom);
                  let usa = {}; try { usa = safeParseObj(c.usaVisa); } catch(e) {}
                  const usaOk = (usa.issueDate || usa.startDate) && usa.endDate && (usa.issueDate || usa.startDate) <= dateRangeTo && usa.endDate >= dateRangeFrom;
                  return (
                    <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: 'rgba(6,182,212,0.08)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(6,182,212,0.2)', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</h3>
                          <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>{c.phone}</p>
                        </div>
                        <div style={{ textAlign: 'right', fontSize: '10px' }}>
                          {sch && <div style={{ color: '#10b981' }}>🇪🇺 {sch.country} · {formatDate(sch.endDate)}</div>}
                          {usaOk && <div style={{ color: '#8b5cf6' }}>🇺🇸 ABD · {formatDate(usa.endDate)}</div>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      )}

      {/* ARAMA SEKMESİ — tek kutu, yazdıkça sonuç */}
      {activeTab === 'search' && (
        <>
          <div style={{ position: 'relative', marginBottom: '8px' }}>
            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px', opacity: 0.7, pointerEvents: 'none' }}>🔍</span>
            <input value={q} onChange={e => setQ(e.target.value)} autoFocus={!isMobile} placeholder="Ad, soyad, TC, telefon, pasaport, e-posta…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '14px 44px 14px 42px', fontSize: '16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', color: '#e8f1f8', outline: 'none' }} />
            {(q || filters.city || filters.sector) && (
              <button onClick={clearFilters} aria-label="Temizle" style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', width: '30px', height: '30px', borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#cbd5e1', cursor: 'pointer', fontSize: '14px' }}>✕</button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '12px' }}>
            <button onClick={() => setShowFilters(v => !v)} style={{ background: (filters.city || filters.sector) ? 'rgba(245,158,11,0.15)' : 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '5px 10px', color: (filters.city || filters.sector) ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>
              ⚙️ Filtre{(filters.city || filters.sector) ? ` (${[filters.city, filters.sector].filter(Boolean).join(', ')})` : ''} {showFilters ? '▲' : '▼'}
            </button>
            {hasActiveFilter && <span style={{ color: '#94a3b8' }}>{filtered.length} sonuç</span>}
            {hasActiveFilter && filtered.length > 0 && (
              <button onClick={() => exportToExcel(filtered, `Musteri_Arama_${new Date().toLocaleDateString('tr')}`)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(16,185,129,0.35)', borderRadius: '8px', padding: '5px 10px', color: '#10b981', cursor: 'pointer', fontSize: '12px' }}>📥 Excel</button>
            )}
          </div>
          {showFilters && (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '220px 220px', gap: '8px', marginBottom: '12px' }}>
              <select value={filters.city} onChange={e => setFilters({ ...filters, city: e.target.value })} style={selectStyle}>
                <option value="">İkamet ili: Tümü</option>
                {turkishProvinces.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={filters.sector} onChange={e => setFilters({ ...filters, sector: e.target.value })} style={selectStyle}>
                <option value="">Sektör: Tümü</option>
                {(appSettings?.sectors || []).map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          )}

          {hasActiveFilter ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filtered.length === 0
                ? <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>"{q}" ile eşleşen müşteri yok</p>
                : (<>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#94a3b8', cursor: 'pointer', padding: '0 4px' }}>
                      <input type="checkbox" checked={filtered.slice(0, 150).every(c => selIds.includes(c.id))}
                        onChange={e => { const ids = filtered.slice(0, 150).map(c => c.id); setSelIds(p => e.target.checked ? [...new Set([...p, ...ids])] : p.filter(x => !ids.includes(x))); }}
                        style={{ width: '16px', height: '16px', accentColor: '#f59e0b' }} />
                      Tümünü seç ({Math.min(filtered.length, 150)})
                    </label>
                    {filtered.slice(0, 150).map(c => renderCustomerCard(c, true))}
                  </>)}
              {filtered.length > 150 && <p style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', padding: '8px' }}>İlk 150 sonuç gösteriliyor — aramayı daraltın (ör. ad + soyad)</p>}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '36px 16px', color: '#64748b', fontSize: '13px', lineHeight: 1.7 }}>
              Yazmaya başlayın — sonuçlar anında gelir.<br />
              <span style={{ fontSize: '12px' }}>Örnek: <i>ahmet öner</i> · <i>0532 111</i> · <i>U4137</i> · <i>gedik</i></span>
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
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</h3>
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
                    <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>🎂 {titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</h3>
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
              <button onClick={() => exportToExcel(withSchengen, `Schengen_Vizeli_${new Date().toLocaleDateString('tr')}`, 'schengen')} style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.2)', border: 'none', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
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
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</h3>
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
              <button onClick={() => exportToExcel(schengenExpiring, `Schengen_Uyari_${new Date().toLocaleDateString('tr')}`, 'schengen')} style={{ padding: '6px 12px', background: 'rgba(234,179,8,0.2)', border: 'none', borderRadius: '6px', color: '#eab308', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
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
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</h3>
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
              <button onClick={() => exportToExcel(withUsa, `ABD_Vizeli_${new Date().toLocaleDateString('tr')}`, 'usa')} style={{ padding: '6px 12px', background: 'rgba(139,92,246,0.2)', border: 'none', borderRadius: '6px', color: '#8b5cf6', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
            )}
          </div>
          {withUsa.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>ABD vizesi olan müşteri yok</p>
          ) : (
            withUsa.map(c => {
              const visa = safeParseObj(c.usaVisa);
              return (
                <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: 'rgba(139,92,246,0.1)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(139,92,246,0.2)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</h3>
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
              <button onClick={() => exportToExcel(usaExpiring, `ABD_Uyari_${new Date().toLocaleDateString('tr')}`, 'usa')} style={{ padding: '6px 12px', background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}>📥 Excel</button>
            )}
          </div>
          {usaExpiring.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>1 ay içinde ABD vizesi bitecek müşteri yok 🎉</p>
          ) : (
            usaExpiring.map(c => {
              const visa = safeParseObj(c.usaVisa);
              return (
                <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: 'rgba(239,68,68,0.1)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</h3>
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
              const greenPassport = pList.find(p => trHas(p.passportType, 'yesil'));
              return (
                <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: 'rgba(5,150,105,0.1)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(5,150,105,0.2)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</h3>
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

            <div style={{ background: 'rgba(167,139,250,0.1)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(167,139,250,0.2)' }}>
              <h4 style={{ margin: '0 0 6px', fontSize: '13px', color: '#a78bfa' }}>🔧 İsimleri Düzelt</h4>
              <p style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '10px' }}>BÜYÜK harfle veya karışık yazılmış ad-soyadları düzgün biçime çevirir (örn: "MEHMET AKKÖSE" → "Mehmet Akköse"). Tüm müşterilerde bir kez çalıştırın.</p>
              <button onClick={fixAllNames} style={{ width: '100%', padding: '10px', background: 'rgba(167,139,250,0.2)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: '8px', color: '#a78bfa', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>🔧 İsimleri Düzelt</button>
            </div>
            {currentUser?.role === 'admin' && (
            <div style={{ background: 'rgba(245,158,11,0.1)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(245,158,11,0.25)' }}>
              <h4 style={{ margin: '0 0 6px', fontSize: '13px', color: '#f59e0b' }}>🖼️ Görselleri Storage'a Taşı</h4>
              <p style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '10px' }}>Telegram botunun müşteri kaydına gömdüğü pasaport/vize görsellerini Storage'a taşır. Liste hafifler, telefonda görseller düzgün açılır. Tek seferlik; tekrar çalıştırmak zararsızdır.</p>
              <button onClick={migrateEmbeddedImages} disabled={!!migrating} style={{ width: '100%', padding: '10px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', color: '#f59e0b', cursor: migrating ? 'wait' : 'pointer', fontSize: '12px', fontWeight: '600' }}>
                {migrating ? `⏳ ${migrating.done}/${migrating.total} müşteri — ${migrating.moved} görsel taşındı` : '🖼️ Görselleri Taşı'}
              </button>
            </div>
            )}
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
                {aiResult._tcWarn && (
                  <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '10px', fontSize: '12px', color: '#fca5a5', fontWeight: '600' }}>⚠️ {aiResult._tcWarn}</div>
                )}
                {aiResult._likelyDup && (
                  <div style={{ marginTop: '12px', padding: '12px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '200px', fontSize: '12px', color: '#fca5a5' }}>
                      <b>⚠️ Olası mükerrer:</b> {titleCaseTr(`${aiResult._likelyDup.firstName || ''} ${aiResult._likelyDup.lastName || ''}`)} — aynı ad-soyad ve doğum tarihi zaten kayıtlı{aiResult._likelyDup.tcKimlik ? ` (TC ${aiResult._likelyDup.tcKimlik})` : ''}. TC/pasaport no yanlış okunmuş olabilir, eklemeden önce kontrol edin.
                    </div>
                    <button type="button" onClick={() => { const c = aiResult._likelyDup; setShowAiModal(false); setAiText(''); setAiResult(null); setAiImages([]); setTimeout(() => setSelectedCustomer(c), 100); }} style={{ padding: '8px 12px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', color: '#60a5fa', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>👤 Mevcut kaydı aç</button>
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
                      <button disabled={aiSaving} onClick={async () => {
                        let existing = aiResult._addPassportTo;
                        // Mevcut pasaportları sunucudan oku — önbellek kopyasında görseller silinmiş olabilir
                        try {
                          const snap = await getDoc(doc(db, 'customers', existing._docId || String(existing.id)));
                          if (snap.exists()) existing = { ...existing, ...snap.data(), _docId: snap.id };
                        } catch (e) { showToast?.('❌ Sunucuya ulaşılamadı, tekrar deneyin', 'error'); return; }
                        const existingPassports = safeParseJSON(existing.passports);
                        const now = new Date().toISOString();
                        const custId = existing._docId || String(existing.id);
                        setAiSaving(true);
                        const added = (aiResult._passports || []).map(p => ({ ...p, id: p.id || generateUniqueId(), createdAt: p.createdAt || now }));
                        if (added[0]) { const url = await uploadAiImage('passport', custId, `pasaport_${added[0].id}.jpg`); if (url) added[0].image = url; }
                        setAiSaving(false);
                        const newPassports = [...existingPassports, ...added];
                        // Pasaporttan okunan kişisel bilgiler: kartta boşsa doldur, doluysa dokunma
                        const filled = {};
                        if (aiResult.birthPlace && !existing.birthPlace) filled.birthPlace = placeTr(aiResult.birthPlace);
                        if (aiResult.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(aiResult.birthDate) && !existing.birthDate) filled.birthDate = aiResult.birthDate;
                        if (aiResult.tcKimlik && /^\d{11}$/.test(aiResult.tcKimlik) && !existing.tcKimlik) filled.tcKimlik = aiResult.tcKimlik;
                        const patch = { ...filled, passports: JSON.stringify(newPassports), verified: false, lastEditedAt: now, updatedAt: now };
                        const updated = { ...existing, ...patch };
                        setCustomers(prev => prev.map(c => c.id === existing.id ? updated : c));
                        setDoc(doc(db, 'customers', existing._docId || String(existing.id)), patch, { merge: true })
                          .catch(err => showToast?.('❌ Pasaport kaydedilemedi: ' + err.message, 'error'));
                        const extra = [filled.birthPlace && 'doğum yeri', filled.birthDate && 'doğum tarihi', filled.tcKimlik && 'TC'].filter(Boolean);
                        showToast?.(`✅ ${existing.firstName} ${existing.lastName} — yeni pasaport eklendi${extra.length ? ` (+ ${extra.join(', ')})` : ''}`, 'success');
                        setShowAiModal(false); setAiText(''); setAiResult(null); setAiImages([]);
                        setTimeout(() => setSelectedCustomer(updated), 100);
                      }} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '8px', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}>
                        {aiSaving ? '⏳ Görsel yükleniyor...' : '📎 Pasaportu Ekle'}
                      </button>
                      <button onClick={() => setAiResult(null)} style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>↩ Tekrar</button>
                    </div>
                  </div>
                ) : (
                  /* YENİ MÜŞTERİ — kaydet */
                  <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '12px' }}>
                    <div style={{ fontSize: '13px', color: '#10b981', fontWeight: '600', marginBottom: '8px' }}>✅ Yeni müşteri — sisteme kayıt edilecek</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button disabled={aiSaving} onClick={async () => {
                        // TC kimlik eşsizlik kontrolü
                        if (aiResult.tcKimlik) {
                          const dup = customers.find(c => c.tcKimlik === aiResult.tcKimlik);
                          if (dup) {
                            showToast?.(`❌ Bu TC Kimlik No zaten kayıtlı: ${dup.firstName} ${dup.lastName}`, 'error');
                            return;
                          }
                        }
                        const now = new Date().toISOString();
                        const newCustId = generateUniqueId();
                        setAiSaving(true);
                        let aiPassports = (aiResult._passports || []).map(p => ({ ...p, id: p.id || generateUniqueId() }));
                        const ppUrl = await uploadAiImage('passport', newCustId, `pasaport_${aiPassports[0]?.id || 'ai'}.jpg`);
                        if (ppUrl) { if (aiPassports.length === 0) aiPassports = [{ ...emptyPassport, id: generateUniqueId() }]; aiPassports[0] = { ...aiPassports[0], image: ppUrl }; }
                        let aiSchengen = (aiResult._schengen && aiResult._schengen.length > 0) ? aiResult._schengen : [{ id: 1, country: '', startDate: '', endDate: '', image: '' }];
                        const scUrl = await uploadAiImage('schengen', newCustId, `schengen_${aiSchengen[0].id || 1}.jpg`);
                        if (scUrl) aiSchengen = [{ ...aiSchengen[0], image: scUrl }, ...aiSchengen.slice(1)];
                        const usUrl = await uploadAiImage('usa', newCustId, 'abd_vize.jpg');
                        const aiUsa = aiResult._usaVisa || (usUrl ? {} : null);
                        if (aiUsa && usUrl) aiUsa.image = usUrl;
                        setAiSaving(false);
                        const newCust = {
                          ...aiResult,
                          id: newCustId,
                          createdAt: now,
                          updatedAt: now,
                          lastEditedAt: now,
                          verified: false,
                          passports: aiPassports.map(p => ({ ...p, createdAt: p.createdAt || now })),
                          schengenVisas: aiSchengen.map(v => (v.country ? { ...v, createdAt: v.createdAt || now } : v)),
                          usaVisa: aiUsa ? { ...aiUsa, createdAt: aiUsa.createdAt || now } : {},
                        };
                        delete newCust._passports; delete newCust._schengen; delete newCust._usaVisa; delete newCust._duplicate; delete newCust._likelyDup; delete newCust._tcWarn;
                        delete newCust._duplicateCustomer; delete newCust._addPassportTo; delete newCust._dupTcMsg;
                        newCust.firstName = nameForSave(newCust.firstName || '');
                        newCust.lastName = nameForSave(newCust.lastName || '');
                        if (newCust.email) newCust.email = normEmail(newCust.email);
                        newCust.passports = JSON.stringify(newCust.passports);
                        newCust.schengenVisas = JSON.stringify(newCust.schengenVisas);
                        newCust.usaVisa = JSON.stringify(newCust.usaVisa);
                        newCust._docId = newCust.id;
                        setCustomers(prev => [newCust, ...prev]);
                        { const { _docId, ...saveData } = newCust;
                          setDoc(doc(db, 'customers', _docId), saveData)
                            .catch(err => showToast?.('❌ Müşteri kaydedilemedi: ' + err.message, 'error')); }
                        showToast?.('✅ Müşteri eklendi — kontrol edilmesi gerekiyor', 'success');
                        setShowAiModal(false);
                        setAiText(''); setAiResult(null); setAiImages([]);
                      }} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '8px', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                        {aiSaving ? '⏳ Görseller yükleniyor...' : '✅ Yeni Müşteri Ekle'}
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
              <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
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
birthPlace: pasaporttaki DOĞUM YERİ / PLACE OF BIRTH alanı (il/ilçe, büyük harfle yazılır, ör. DENIZLI). Pasaport görseli varsa mutlaka oku.
Tarihler YYYY-MM-DD. TC Kimlik 11 hane. Pasaport No genellikle 1 harf + 7 rakam.`;

                    const savedModel = appSettings?.claudeModel;
                    const model = (!savedModel || savedModel === 'claude-sonnet-4-20250514') ? 'claude-sonnet-4-6' : savedModel;

                    const userContent = [];
                    for (const img of aiImages) {
                      userContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 } });
                      userContent.push({ type: 'text', text: `Bu görsel ${img.type === 'passport' ? 'pasaport' : img.type === 'schengen' ? 'Schengen vize' : 'ABD vizesi'} belgesidir.` });
                    }
                    if (aiText.trim()) userContent.push({ type: 'text', text: aiText });
                    const msgContent = userContent.length === 1 && userContent[0].type === 'text' ? userContent[0].text : userContent;

                    const resp = await claudeRequest({
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ model, max_tokens: 1500, system: systemPrompt, messages: [{ role: 'user', content: msgContent }] })
                    });
                    if (!resp.ok) {
                      const errText = await resp.text();
                      throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
                    }
                    const data = await resp.json();
                    if (!data.content?.[0]?.text) {
                      throw new Error('Netlify proxy çalışmıyor. CLAUDE_API_KEY env var Netlify\'da tanımlı mı kontrol edin.');
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
                    const dupByTc = parsed.tcKimlik ? customers.find(c => String(c.tcKimlik || '').trim() === String(parsed.tcKimlik).trim()) : null;
                    if (parsed.tcKimlik && !isValidTc(parsed.tcKimlik)) parsed._tcWarn = `TC Kimlik No geçersiz görünüyor (${parsed.tcKimlik}) — yanlış okunmuş olabilir, kontrol ediniz.`;

                    if (dupByPassport) {
                      // Aynı pasaport No → zaten var
                      parsed._duplicate = `${dupByPassport.customer.firstName} ${dupByPassport.customer.lastName} — Pasaport No (${dupByPassport.passportNo}) zaten kayıtlı`;
                      parsed._duplicateCustomer = dupByPassport.customer;
                    } else if (dupByTc && !sameCustName(dupByTc, parsed)) {
                      // TC eşsizdir: aynı TC farklı isim = TC ya da isim hatalı
                      parsed._duplicate = `Bu TC (${parsed.tcKimlik}) başka isimle kayıtlı: ${titleCaseTr(`${dupByTc.firstName || ''} ${dupByTc.lastName || ''}`)}. TC eşsizdir — TC veya isim yanlış okunmuş olabilir, kontrol ediniz.`;
                      parsed._duplicateCustomer = dupByTc;
                    } else if (dupByTc && parsed._passports?.length) {
                      // Aynı TC ama farklı pasaport No → 2. pasaport ekle
                      parsed._addPassportTo = dupByTc;
                      parsed._dupTcMsg = `${dupByTc.firstName} ${dupByTc.lastName} (TC: ${parsed.tcKimlik}) — Yeni pasaport bu kişiye eklenecek`;
                    } else if (dupByTc) {
                      parsed._duplicate = `${dupByTc.firstName} ${dupByTc.lastName} — TC Kimlik (${parsed.tcKimlik}) zaten kayıtlı`;
                      parsed._duplicateCustomer = dupByTc;
                    }

                    if (!parsed._duplicate && !parsed._addPassportTo) {
                      const likely = findLikelyDuplicates({ firstName: parsed.firstName, lastName: parsed.lastName, birthDate: parsed.birthDate }, customers)[0];
                      if (likely) parsed._likelyDup = likely;
                    }
                    if (parsed._schengen) parsed._schengen = parsed._schengen.map((v, i) => ({ ...v, id: i + 1 }));
                    setAiResult(parsed);
                  } catch(err) {
                    console.error('AI hata:', err);
                    let errMsg = 'AI okuma başarısız';
                    if (err.message.includes('401') || err.message.includes('403')) errMsg = 'API anahtarı geçersiz. Ayarlar → Claude API Key kontrol edin.';
                    else if (err.message.includes('429')) errMsg = 'Çok fazla istek. Lütfen bekleyip tekrar deneyin.';
                    else if (err.message.includes('500') || err.message.includes('529')) errMsg = 'AI servisi şu an meşgul. Birkaç saniye sonra tekrar deneyin.';
                    else if (err.message.includes('JSON')) errMsg = 'AI yanıtı işlenemedi. Lütfen tekrar deneyin.';
                    else if (err.message.includes('proxy')) errMsg = 'Bağlantı sorunu. Sayfayı yenileyip tekrar deneyin.';
                    else errMsg = 'AI okuma başarısız: ' + (err.message || '').slice(0, 180);
                    showToast?.(errMsg, 'error');
                  } finally {
                    setAiLoading(false);
                  }
                }}
                disabled={aiLoading}
                style={{ flex: 1, marginTop: '12px', padding: '14px', background: aiLoading ? 'rgba(139,92,246,0.3)' : 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '700', fontSize: '14px', cursor: aiLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                {aiLoading ? '⏳ AI okuyor...' : '🤖 AI ile Oku'}
              </button>
              {aiLoading && (
                <button onClick={() => setAiLoading(false)}
                  style={{ marginTop: '12px', padding: '14px 18px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', color: '#ef4444', fontWeight: '700', fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  ✕ İptal
                </button>
              )}
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && renderFullPageForm()}
      {selectedCustomer && renderFullPageDetail()}
      {showDupScan && <DuplicateScanModal customers={customers} onOpen={(c) => { setDetailTab('info'); setSelectedCustomer(c); }} onClose={() => setShowDupScan(false)}
        onPatch={async (c, patch, opt = {}) => {
          const id = c._docId || String(c.id);
          setCustomers(prev => prev.map(x => (x._docId || String(x.id)) === id ? { ...x, ...patch } : x));
          try { await setDoc(doc(db, 'customers', id), { ...patch, updatedAt: new Date().toISOString() }, { merge: true }); if (!opt.silent) showToast?.(patch.firstName ? `✓ ${patch.firstName} ${patch.lastName} olarak düzeltildi` : 'Listeden çıkarıldı', 'success'); }
          catch (e) { showToast?.('❌ Kaydedilemedi: ' + e.message, 'error'); }
        }} />}
      {showDocInbox && <BulkDocInbox customers={customers} setCustomers={setCustomers} appSettings={appSettings} showToast={showToast} onClose={() => setShowDocInbox(false)} />}
      {shareCust && <CustomerShareModal customer={shareCust} appSettings={appSettings} showToast={showToast} onClose={() => setShareCust(null)}
        onSaved={(patch) => {
          setCustomers(prev => prev.map(x => x.id === shareCust.id ? { ...x, ...patch } : x));
          setSelectedCustomer(sc => sc && sc.id === shareCust.id ? { ...sc, ...patch } : sc);
          setShareCust(sc => sc ? { ...sc, ...patch } : sc);
        }} />}

      {/* Image Preview */}
      {imagePreview.show && (
        <div onClick={() => setImagePreview({ show: false, src: '', title: '' })} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: '20px' }}>
          <div style={{ maxWidth: '90%', maxHeight: '90%' }}>
            <p style={{ color: 'white', textAlign: 'center', marginBottom: '10px', fontSize: '14px' }}>{imagePreview.title}</p>
            <img src={imagePreview.src} alt={imagePreview.title} style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '8px' }} />
            <div style={{ textAlign: 'center', marginTop: '10px' }}>
              <button type="button" onClick={e => { e.stopPropagation(); downloadUrl(imagePreview.src, imagePreview.file || imagePreview.title || 'gorsel').catch(err => showToast('İndirilemedi: ' + err.message, 'error')); }}
                style={{ padding: '8px 18px', background: '#2563eb', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>⬇️ İndir</button>
            </div>
            <p style={{ color: '#64748b', textAlign: 'center', marginTop: '10px', fontSize: '12px' }}>Kapatmak için tıklayın</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function CompanyPicker({ value, onChange }) {
  const [q, setQ] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setQ(value || ''); }, [value]);

  const ensure = async () => {
    if (list || loading) return;
    setLoading(true); setErr('');
    try { setList(await loadCompanies()); }
    catch (e) { setErr('Liste yüklenemedi — elle yazabilirsiniz'); }
    finally { setLoading(false); }
  };
  const results = useMemo(() => {
    if (!list || !q.trim() || q.trim().length < 2) return [];
    const nq = normalizeTr(q);
    const out = [];
    for (let i = 0; i < list.length && out.length < 30; i++) {
      if (normalizeTr(list[i][0]).includes(nq)) out.push(list[i]);
    }
    return out;
  }, [list, q]);
  const exact = list && q.trim() && list.some(c => normalizeTr(c[0]) === normalizeTr(q));

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: '500' }}>Firma</label>
      <input
        value={q}
        onFocus={() => { setOpen(true); ensure(); }}
        onChange={e => { setQ(e.target.value); onChange(e.target.value); setOpen(true); ensure(); }}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        placeholder="Firma adı yazın — listeden seçin veya elle girin"
        style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }}
      />
      {open && q.trim().length >= 2 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: '4px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', maxHeight: '260px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {loading && <div style={{ padding: '10px 12px', fontSize: '12px', color: '#64748b' }}>⏳ Firma listesi yükleniyor...</div>}
          {err && <div style={{ padding: '10px 12px', fontSize: '12px', color: '#f59e0b' }}>{err}</div>}
          {!loading && results.map((c, i) => (
            <div key={i} onMouseDown={() => { onChange(c[0]); setQ(c[0]); setOpen(false); }}
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '12px', color: '#e8f1f8' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {c[0]}
              {c[1] && <span style={{ color: '#64748b', marginLeft: '6px' }}>· Sicil {c[1]}</span>}
            </div>
          ))}
          {!loading && !err && results.length === 0 && <div style={{ padding: '8px 12px', fontSize: '12px', color: '#64748b' }}>Listede bulunamadı</div>}
          {!loading && !exact && q.trim().length >= 2 && (
            <div onMouseDown={() => { onChange(q.trim()); setOpen(false); }}
              style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '12px', color: '#10b981', fontWeight: '600', background: 'rgba(16,185,129,0.08)', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              ➕ "{q.trim()}" olarak ekle (listede yok)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CustomerShareModal({ customer, onClose, onSaved, appSettings, showToast }) {
  const c = customer;
  const saved = useMemo(() => safeParseObj(c.shareTrip), [c.shareTrip]);
  const [trip, setTrip] = useState(() => ({ title: '', city: '', country: '', startDate: '', endDate: '', hotelName: '', hotelAddress: '', flights: [], docs: [], ...saved }));
  const [busy, setBusy] = useState('');
  const [ready, setReady] = useState(null); // { link, text, phone }
  const [docType, setDocType] = useState(0);
  const [editMode, setEditMode] = useState(false); // yolculuk/uçuş/otel alanları normalde gizli (belgelerden okunur)
  const token = useRef(c.shareToken || customerLinkSlug(c));
  const up = (patch) => setTrip(t => ({ ...t, ...patch }));
  const inS = { width: '100%', boxSizing: 'border-box', padding: '9px 10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', colorScheme: 'dark' };
  const lbl = { display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' };
  const sec = { fontSize: '12px', fontWeight: 700, color: '#f59e0b', margin: '14px 0 8px', letterSpacing: '0.5px' };
  const narrow = window.innerWidth < 560;

  const addFiles = async (files) => {
    const list = Array.from(files || []).filter(f => f.size <= 15 * 1024 * 1024);
    if (!list.length) { showToast?.('Dosya seçilmedi (en fazla 15MB)', 'error'); return; }
    setBusy('Yükleniyor…');
    try {
      const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const added = [], found = [], nameWarn = [];
      let hotelFound = null, hotelDocId = '';
      for (const f of list) {
        // Tür belgenin içeriğinden (bilet / biniş kartı / otel…); tanınamazsa seçili tür
        const isPdf = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
        let txt = '';
        if (isPdf) { try { txt = await pdfFileText(f); } catch (e) { /* metin yok */ } }
        const auto = txt ? docTypeOf(txt) : 6;
        const [icon, label] = CUST_DOC_TYPES[auto !== 6 ? auto : docType];
        const docId = generateUniqueId();
        const safe = asciiTr(f.name).replace(/[^\w.\-]+/g, '_').slice(-80);
        const path = `paylasim/${token.current}/${Date.now()}_${safe}`;
        const r = ref(getStorage(), path);
        await uploadBytes(r, f, { contentType: f.type || 'application/octet-stream' });
        added.push({ id: docId, icon, label, url: await getDownloadURL(r), path, name: f.name, addedAt: new Date().toISOString() });
        if (txt) {
          if (icon === '✈️') found.push(...detectFlights(txt).map(x => ({ ...x, docId })));
          if (icon === '🏨') { const h = detectHotel(txt); if (h) { hotelFound = h; hotelDocId = docId; } }
          const k = nameCheck(c, txt); if (k.level === 'warn' || k.level === 'err') nameWarn.push(`${f.name}: ${k.msg}`);
        }
      }
      setTrip(t => {
        const fl = [...(t.flights || [])];
        found.forEach(x => { if (!fl.some(y => sameFlight(y, x))) fl.push(x); });
        fl.sort((a, b) => String(a.ymd).localeCompare(String(b.ymd)));
        const patch = { docs: [...(t.docs || []), ...added], flights: fl };
        if (hotelFound) {
          if (hotelFound.name) patch.hotelName = hotelFound.name;
          if (hotelFound.address) patch.hotelAddress = hotelFound.address;
          if (hotelFound.checkIn) { patch.hotelCheckIn = hotelFound.checkIn; patch.hotelCheckOut = hotelFound.checkOut || ''; }
          patch.hotelDocId = hotelDocId;
          if (hotelFound.checkIn && !t.startDate) patch.startDate = hotelFound.checkIn;
          if (hotelFound.checkOut && !t.endDate) patch.endDate = hotelFound.checkOut;
        }
        // Uçuşlar bulunduysa boş alanları doldur: tarih aralığı ve varış şehri
        if (fl.length) {
          if (!t.startDate) patch.startDate = fl[0].ymd;
          if (!t.endDate) patch.endDate = fl[fl.length - 1].ymd;
          if (!t.city) patch.city = fl[0].toCity;
          if (!t.title) patch.title = `${fl[0].fromCity} → ${fl[0].toCity}`;
        }
        return { ...t, ...patch };
      });
      showToast?.(`📎 ${added.length} belge eklendi${found.length ? ` · ${found.length} uçuş bulundu` : ''}${hotelFound ? ' · otel bilgisi okundu' : ''}`, 'success');
      if (nameWarn.length) setTimeout(() => showToast?.(`İsim kontrolü — ${nameWarn.join(' | ')}`, 'warning'), 400);
    } catch (e) { showToast?.('❌ Yüklenemedi: ' + e.message, 'error'); }
    finally { setBusy(''); }
  };
  const removeDoc = async (d) => {
    const next = tripWithoutDoc(trip, d);
    const lost = (trip.flights || []).length - next.flights.length;
    if (!window.confirm(`"${d.label}" belgesi linkten kaldırılsın mı?${lost ? `\n\nBu belgeden okunan ${lost} uçuş da linkten kalkar.` : ''}${trip.hotelName && !next.hotelName ? '\nOtel bilgisi de kalkar.' : ''}`)) return;
    setTrip(next);
    // Link hemen güncellensin (dosya silindikten sonra linkte kırık belge kalmasın)
    if (c.shareToken || (next.docs || []).length || (next.flights || []).length) {
      try {
        await publishCustomerLink(c, next, token.current, appSettings);
        onSaved?.({ shareToken: token.current, shareTrip: JSON.stringify(next) });
        showToast?.('Belge linkten kaldırıldı', 'success');
      } catch (e) { showToast?.('❌ Link güncellenemedi: ' + e.message, 'error'); return; }
    }
    try { const { getStorage, ref, deleteObject } = await import('firebase/storage'); if (d.path) await deleteObject(ref(getStorage(), d.path)).catch(() => {}); } catch (e) {}
  };
  // Tür değişince belgeyi yeniden oku (otel / bilet bilgisi)
  const changeDocType = async (d, t) => {
    up({ docs: trip.docs.map(x => x.id === d.id ? { ...x, label: t[1], icon: t[0] } : x) });
    if (t[0] !== '🏨' && t[0] !== '✈️') return;
    try {
      const txt = await pdfUrlText(d.url);
      if (t[0] === '🏨') {
        const h = detectHotel(txt);
        if (!h) { showToast?.('Otel bilgisi okunamadı — gerekirse "Elle düzelt"', 'warning'); return; }
        setTrip(tt => ({ ...tt, hotelName: h.name || tt.hotelName, hotelAddress: h.address || tt.hotelAddress, hotelCheckIn: h.checkIn || tt.hotelCheckIn, hotelCheckOut: h.checkOut || tt.hotelCheckOut, hotelDocId: d.id,
          startDate: tt.startDate || h.checkIn || '', endDate: tt.endDate || h.checkOut || '' }));
        showToast?.('🏨 Otel bilgisi okundu', 'success');
      } else {
        const fl = detectFlights(txt).map(x => ({ ...x, docId: d.id }));
        if (!fl.length) return;
        setTrip(tt => { const all = [...(tt.flights || [])]; fl.forEach(x => { if (!all.some(y => sameFlight(y, x))) all.push(x); }); all.sort((a, b) => String(a.ymd).localeCompare(String(b.ymd))); return { ...tt, flights: all }; });
        showToast?.(`✈️ ${fl.length} uçuş okundu`, 'success');
      }
    } catch (e) { showToast?.('Belge yeniden okunamadı: ' + e.message, 'warning'); }
  };
  const setFlight = (i, patch) => up({ flights: trip.flights.map((f, k) => k === i ? { ...f, ...patch } : f) });

  const save = async () => {
    // Belgesiz de verilebilir: müşteri profilini, pasaport/vize sürelerini ve duyuruları görür; belgeler sonra eklenir
    setBusy('Kaydediliyor…');
    try {
      const { link, text } = await publishCustomerLink(c, trip, token.current, appSettings);
      onSaved?.({ shareToken: token.current, shareTrip: JSON.stringify(trip) });
      setReady({ link, text, phone: c.phone || '' });
    } catch (e) { showToast?.('❌ Kaydedilemedi: ' + e.message, 'error'); }
    finally { setBusy(''); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f2744', border: '1px solid rgba(34,197,94,0.35)', borderRadius: '14px', padding: '18px', width: '100%', maxWidth: '560px', maxHeight: '92vh', overflowY: 'auto', color: '#e8f1f8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>🔗 Müşteri Linki — {titleCaseTr(c.firstName)} {titleCaseTr(c.lastName)}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '22px', cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#64748b' }}>Bilet, otel belgesi, vize… tek linkte. Belge ekledikçe aynı link güncellenir.{c.shareToken ? ' Bu müşterinin linki daha önce oluşturuldu.' : ''} 🔐 Müşteri ilk açılışta kendi 4 haneli PIN'ini belirler; PIN müşteri kartında görünür.</p>

        {ready ? (
          <div style={{ marginTop: '14px' }}>
            <label style={lbl}>✏️ Gönderilecek mesaj</label>
            <textarea value={ready.text} onChange={e => setReady({ ...ready, text: e.target.value })} rows={7} style={{ ...inS, lineHeight: 1.45, fontFamily: 'inherit', resize: 'vertical' }} />
            <label style={{ ...lbl, marginTop: '8px' }}>📱 WhatsApp numarası (müşteri veya firma yetkilisi)</label>
            <input value={ready.phone} onChange={e => setReady({ ...ready, phone: e.target.value })} placeholder="+90 5xx xxx xx xx" style={inS} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
              <a href={waUrl(formatWhatsAppPhone(ready.phone) || '', ready.text)} target="_blank" rel="noopener noreferrer" style={{ padding: '12px', background: 'linear-gradient(135deg, #22c55e, #16a34a)', borderRadius: '10px', color: '#fff', fontWeight: 700, textAlign: 'center', textDecoration: 'none' }}>💬 WhatsApp'tan gönder</a>
              <button onClick={async () => { try { await navigator.clipboard.writeText(ready.text); showToast?.('Mesaj kopyalandı', 'success'); } catch { showToast?.('Kopyalanamadı', 'error'); } }} style={{ padding: '10px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer' }}>📋 Mesajı kopyala</button>
              <button onClick={() => window.open(ready.link, '_blank')} style={{ padding: '10px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>👁️ Müşterinin göreceği sayfayı aç</button>
              <button onClick={() => setReady(null)} style={{ padding: '8px', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '12px' }}>← Belgelere geri dön</button>
            </div>
          </div>
        ) : (<>
          <div style={sec}>BELGELER</div>
          {(trip.docs || []).map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', marginBottom: '6px', fontSize: '13px' }}>
              <span>{d.icon}</span>
              <select value={d.label} onChange={e => { const t = CUST_DOC_TYPES.find(x => x[1] === e.target.value); changeDocType(d, t); }} style={{ ...inS, width: 'auto', padding: '4px 6px', fontSize: '12px' }}>
                {CUST_DOC_TYPES.map(([, l]) => <option key={l} value={l} style={{ background: '#0c1929' }}>{l}</option>)}
              </select>
              <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, color: '#94a3b8', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name || 'belge'}</a>
              <button onClick={() => removeDoc(d)} title="Linkten kaldır" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>🗑</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={docType} onChange={e => setDocType(+e.target.value)} style={{ ...inS, width: 'auto' }}>
              {CUST_DOC_TYPES.map(([i, l], k) => <option key={l} value={k} style={{ background: '#0c1929' }}>{i} {l}</option>)}
            </select>
            <label style={{ padding: '9px 14px', background: 'rgba(59,130,246,0.18)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', color: '#60a5fa', cursor: busy ? 'wait' : 'pointer', fontSize: '13px', fontWeight: 600 }}>
              {busy || '📎 Dosya ekle (PDF / görsel)'}
              <input type="file" multiple accept="application/pdf,image/*" disabled={!!busy} style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            </label>
          </div>

          {/* Belgelerden okunanlar — elle giriş gerekmez; nadiren yanlış okunursa "Elle düzelt" */}
          <div style={sec}>LİNKTE GÖRÜNECEK <span style={{ color: '#64748b', fontWeight: 400 }}>(belgelerden otomatik okunur)</span></div>
          <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', fontSize: '12.5px', lineHeight: 1.7, color: '#cbd5e1' }}>
            {(trip.flights || []).length
              ? (trip.flights || []).map((f, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ flex: 1 }}>✈️ <b>{f.code}</b> · {f.ymd ? formatDate(f.ymd) : 'tarih yok'} · {f.from || '?'} {f.dep || ''} → {f.to || '?'} {f.arr || ''}</span><button onClick={() => up({ flights: trip.flights.filter((_, k) => k !== i) })} title="Bu uçuşu linkten çıkar (kaydedince)" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🗑</button></div>)
              : <div style={{ color: '#64748b' }}>✈️ Uçuş yok — bilet yüklenince otomatik eklenir</div>}
            {trip.hotelName
              ? <div>🏨 <b>{trip.hotelName}</b>{trip.hotelCheckIn ? ` · ${formatDate(trip.hotelCheckIn)}${trip.hotelCheckOut ? ' – ' + formatDate(trip.hotelCheckOut) : ''}` : ''}{trip.hotelAddress ? <span style={{ color: '#94a3b8' }}> · {trip.hotelAddress}</span> : ''}</div>
              : <div style={{ color: '#64748b' }}>🏨 Otel yok — otel giriş belgesi yüklenince otomatik eklenir</div>}
          </div>
          {((trip.flights || []).length > 0 || trip.hotelCheckIn) && <TravelCheckBox c={c} trip={trip} />}
          <button onClick={() => setEditMode(v => !v)} style={{ marginTop: '8px', padding: '6px 12px', background: 'none', border: '1px dashed rgba(255,255,255,0.18)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>{editMode ? '▲ Elle düzeltmeyi kapat' : '✏️ Elle düzelt (yanlış okunduysa)'}</button>
          {editMode && (<>
          <div style={sec}>YOLCULUK</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Başlık</label><input value={trip.title} onChange={e => up({ title: e.target.value })} placeholder="Örn. Frankfurt İş Seyahati" style={inS} /></div>
            <div><label style={lbl}>Şehir</label><input value={trip.city} onChange={e => up({ city: e.target.value })} placeholder="Frankfurt" style={inS} /></div>
            <div><label style={lbl}>Ülke</label>
              <select value={trip.country} onChange={e => up({ country: e.target.value })} style={inS}>
                <option value="" style={{ background: '#0c1929' }}>Seçin…</option>
                {tourCountries.map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}
              </select></div>
            <div><label style={lbl}>Gidiş</label><input type="date" value={trip.startDate} onChange={e => up({ startDate: e.target.value })} style={inS} /></div>
            <div><label style={lbl}>Dönüş</label><input type="date" value={trip.endDate} onChange={e => up({ endDate: e.target.value })} style={inS} /></div>
          </div>

          <div style={sec}>UÇUŞLAR <span style={{ color: '#64748b', fontWeight: 400 }}>(biletten otomatik bulunur — linkte canlı takip)</span></div>
          {(trip.flights || []).map((f, i) => (
            <div key={i} style={narrow
              ? { display: 'grid', gridTemplateColumns: '1fr 1fr auto', gridTemplateAreas: '"c d x" "f t x"', gap: '6px', marginBottom: '12px', alignItems: 'center' }
              : { display: 'grid', gridTemplateColumns: '80px 1fr 1fr 1fr auto', gridTemplateAreas: '"c d f t x"', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
              <input value={f.code} onChange={e => setFlight(i, { code: e.target.value.toUpperCase() })} placeholder="TK1590" style={{ ...inS, gridArea: 'c' }} />
              <input type="date" value={f.ymd || ''} onChange={e => setFlight(i, { ymd: e.target.value })} style={{ ...inS, gridArea: 'd' }} />
              <input value={`${f.from || ''}${f.dep ? ' ' + f.dep : ''}`} onChange={e => { const [a, b] = e.target.value.split(' '); setFlight(i, { from: (a || '').toUpperCase().slice(0, 3), dep: b || '' }); }} placeholder="Kalkış: IST 08:30" style={{ ...inS, gridArea: 'f' }} />
              <input value={`${f.to || ''}${f.arr ? ' ' + f.arr : ''}`} onChange={e => { const [a, b] = e.target.value.split(' '); setFlight(i, { to: (a || '').toUpperCase().slice(0, 3), arr: b || '' }); }} placeholder="Varış: FRA 10:45" style={{ ...inS, gridArea: 't' }} />
              <button onClick={() => up({ flights: trip.flights.filter((_, k) => k !== i) })} style={{ gridArea: 'x', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>🗑</button>
            </div>
          ))}
          <button onClick={() => up({ flights: [...(trip.flights || []), { code: '', ymd: trip.startDate || '', from: '', to: '', dep: '', arr: '' }] })} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.06)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>＋ Uçuş ekle</button>

          <div style={sec}>OTEL <span style={{ color: '#64748b', fontWeight: 400 }}>(linkte adres + yol tarifi)</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <input value={trip.hotelName} onChange={e => up({ hotelName: e.target.value })} placeholder="Otel adı" style={inS} />
            <input value={trip.hotelAddress} onChange={e => up({ hotelAddress: e.target.value })} placeholder="Adres" style={inS} />
            <div><label style={lbl}>Otel giriş</label><input type="date" value={trip.hotelCheckIn || ''} onChange={e => up({ hotelCheckIn: e.target.value })} style={inS} /></div>
            <div><label style={lbl}>Otel çıkış</label><input type="date" value={trip.hotelCheckOut || ''} onChange={e => up({ hotelCheckOut: e.target.value })} style={inS} /></div>
          </div>

          </>)}

          <button onClick={save} disabled={!!busy} style={{ width: '100%', marginTop: '16px', padding: '12px', background: 'linear-gradient(135deg, #22c55e, #16a34a)', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: busy ? 'wait' : 'pointer' }}>
            {busy || (c.shareToken ? '💾 Kaydet ve linki güncelle' : '🔗 Linki oluştur')}
          </button>
        </>)}
      </div>
    </div>
  );
}

// 🔍 Mükerrer / TC kontrolü — tüm müşterileri tarar
export function DuplicateScanModal({ customers, onOpen, onClose, onPatch }) {
  const [tab, setTab] = useState('tcName');
  const data = useMemo(() => {
    const nm = (c) => normalizeTr(`${c.firstName || ''} ${c.lastName || ''}`).replace(/\s+/g, ' ');
    const group = (keyFn) => {
      const m = new Map();
      (customers || []).forEach(c => { const k = keyFn(c); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(c); });
      return [...m.entries()].filter(([, arr]) => arr.length > 1);
    };
    const byTc = group(c => { const t = String(c.tcKimlik || '').trim(); return t.length >= 6 ? t : ''; });
    const tcName = byTc.filter(([, arr]) => new Set(arr.map(nm)).size > 1);
    const tcSame = byTc.filter(([, arr]) => new Set(arr.map(nm)).size === 1);
    const pp = new Map();
    (customers || []).forEach(c => safeParseJSON(c.passports).forEach(p => { const k = String(p.passportNo || '').trim().toUpperCase().replace(/\s/g, ''); if (k.length < 6) return; if (!pp.has(k)) pp.set(k, new Set()); pp.get(k).add(c); }));
    const passport = [...pp.entries()].filter(([, set]) => set.size > 1).map(([k, set]) => [k, [...set]]);
    const nameBirth = group(c => (c.birthDate && nm(c) ? `${nm(c)}|${c.birthDate}` : ''));
    const badTc = (customers || []).filter(c => String(c.tcKimlik || '').trim() && !isValidTc(c.tcKimlik));
    // 🔤 Şüpheli isim: eski isim düzeltme Türkçe harfsiz BÜYÜK isimde (MRZ/Excel) her I'yı ı yaptı ("ISMAIL" → "Ismaıl").
    // İzi: isimde ı var ama başka hiçbir Türkçe harf (ç ğ ö ş ü İ) yok. "Yılmaz Kaya" gibi doğru isimler de çıkar → elle karar.
    const oddName = (customers || []).filter(c => {
      if (c.nameOk) return false;
      const full = `${c.firstName || ''} ${c.lastName || ''}`;
      return /ı/.test(full) && !/[iİ]/.test(full); // eski kod her I'yı ı yaptı: hiç i/İ kalmayan ı'lı isim ("Merıç Emıroglu")
    });
    // 🔤 Türkçe harfsiz isim (Excel/MRZ'den gelmiş olabilir: "Ferhat Akbiyik") ama pasaport görseli var → pasaporttan doğru yazım okunabilir
    const asciiName = (customers || []).filter(c => {
      if (c.nameOk || c.nameReadAt) return false;
      const full = `${c.firstName || ''} ${c.lastName || ''}`;
      return full.trim() && !/[çğıöşüÇĞİÖŞÜ]/.test(full) && passportImageOf(c);
    });
    return { tcName, tcSame, passport, nameBirth, badTc, oddName, asciiName };
  }, [customers]);
  const tabs = [
    ['tcName', '🚨 Aynı TC, farklı isim', data.tcName.length],
    ['tcSame', 'Aynı TC, aynı isim', data.tcSame.length],
    ['passport', 'Aynı pasaport no', data.passport.length],
    ['nameBirth', 'Aynı ad + doğum', data.nameBirth.length],
    ['badTc', 'Geçersiz TC', data.badTc.length],
    ['oddName', '🔤 Şüpheli isim (ı)', data.oddName.length],
    ['asciiName', '🔡 Türkçe harfsiz isim', data.asciiName.length],
  ];
  // 📷 Pasaporttan isim okuma: kayıtlı pasaport görselindeki SOYADI/ADI Türkçe harfleriyle okunur. Okunan isim kayıttakiyle
  // harf farkı dışında aynıysa (normalizeTr) düzeltilir; farklıysa dokunulmaz, elle kontrol için gösterilir.
  const [readState, setReadState] = useState({}); // id → { busy, msg, ok }
  const [bulk, setBulk] = useState(null); // { done, total, fixed, stop }
  const bulkStop = useRef(false);
  const keyOf = (c) => c._docId || String(c.id);
  const readFromPassport = async (c, silent) => {
    const img = passportImageOf(c);
    if (!img) { setReadState(st => ({ ...st, [keyOf(c)]: { msg: 'Pasaport görseli yok', ok: false } })); return 'nopp'; }
    setReadState(st => ({ ...st, [keyOf(c)]: { busy: true } }));
    try {
      const m = String(img).match(/^data:(image\/[a-z+]+);base64,(.+)$/);
      const source = m ? { type: 'base64', media_type: m[1], data: m[2] } : { type: 'url', url: img };
      const resp = await claudeRequest({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 200, messages: [{ role: 'user', content: [
        { type: 'image', source },
        { type: 'text', text: 'Bu bir pasaport (veya kimlik kartı) görseli. "SOYADI / SURNAME" ve "ADI / NAME" (kimlikte "Soyadı / Surname", "Adı / Given Name(s)") alanlarını göründüğü gibi, Türkçe harfleriyle (İ, ı, Ş, Ğ, Ü, Ö, Ç) BÜYÜK harfle oku. MRZ satırını (< işaretli alt satırlar) KULLANMA. Birden fazla ad varsa hepsi firstName. SADECE JSON: {"firstName":"","lastName":""}' }] }] }) });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j?.error || ('HTTP ' + resp.status));
      const txt = (j.content || []).map(x => x.text || '').join('');
      const o = JSON.parse((txt.match(/\{[\s\S]*\}/) || ['{}'])[0]);
      const [fn, ln] = namePairForSave(o.firstName || '', o.lastName || '');
      if (!fn || !ln) throw new Error('İsim okunamadı');
      const same = normalizeTr(`${fn} ${ln}`) === normalizeTr(`${c.firstName || ''} ${c.lastName || ''}`);
      if (!same) { setReadState(st => ({ ...st, [keyOf(c)]: { msg: `Pasaportta "${fn} ${ln}" yazıyor — kayıttan farklı, elle kontrol edin`, ok: false } })); return 'diff'; }
      const changed = fn !== c.firstName || ln !== c.lastName;
      await onPatch?.(c, { ...(changed ? { firstName: fn, lastName: ln } : {}), nameOk: true, nameReadAt: new Date().toISOString() }, { silent });
      setReadState(st => ({ ...st, [keyOf(c)]: { msg: changed ? `✓ ${fn} ${ln}` : '✓ Pasaportla aynı', ok: true } }));
      return changed ? 'fixed' : 'same';
    } catch (e) {
      setReadState(st => ({ ...st, [keyOf(c)]: { msg: '❌ ' + (e.message || 'okunamadı').slice(0, 80), ok: false } }));
      return 'err';
    }
  };
  // Toplu: sırayla, 2,2 sn arayla (Claude vekil sunucusu dakikada 30 istek kabul eder); en fazla 50 kişi / tıklama
  const readAll = async (list) => {
    const todo = list.filter(c => passportImageOf(c) && !readState[keyOf(c)]?.ok).slice(0, 50);
    if (!todo.length) return;
    bulkStop.current = false;
    let fixed = 0;
    setBulk({ done: 0, total: todo.length, fixed: 0 });
    for (let i = 0; i < todo.length; i++) {
      if (bulkStop.current) break;
      const r = await readFromPassport(todo[i], true);
      if (r === 'fixed') fixed++;
      setBulk({ done: i + 1, total: todo.length, fixed });
      if (i < todo.length - 1) await new Promise(res => setTimeout(res, 2200));
    }
    setBulk(b => b && { ...b, finished: true });
  };
  const readBtn = (c) => {
    const st = readState[keyOf(c)];
    if (!passportImageOf(c)) return <span style={{ fontSize: '11px', color: '#64748b' }}>pasaport görseli yok</span>;
    return <>
      <button type="button" disabled={st?.busy || bulk && !bulk.finished} onClick={() => readFromPassport(c, false)} title="Kayıtlı pasaport görselinden isim Türkçe harfleriyle okunur" style={{ padding: '5px 10px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', borderRadius: '8px', color: '#c084fc', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>{st?.busy ? '⏳ Okunuyor…' : '📷 Pasaporttan oku'}</button>
      {st?.msg && <span style={{ fontSize: '11.5px', color: st.ok ? '#34d399' : '#fbbf24', flexBasis: '100%' }}>{st.msg}</span>}
    </>;
  };
  const bulkBar = (list, label) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '8px 0 12px', padding: '10px 12px', background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: '10px', fontSize: '12.5px' }}>
      {!bulk || bulk.finished
        ? <button type="button" onClick={() => readAll(list)} disabled={!list.some(c => passportImageOf(c))} style={{ padding: '7px 14px', background: 'linear-gradient(135deg,#a855f7,#7c3aed)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '12.5px' }}>📷 {label} ({Math.min(50, list.filter(c => passportImageOf(c) && !readState[keyOf(c)]?.ok).length)})</button>
        : <button type="button" onClick={() => { bulkStop.current = true; }} style={{ padding: '7px 14px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', color: '#fca5a5', fontWeight: 700, cursor: 'pointer', fontSize: '12.5px' }}>⏹ Durdur</button>}
      {bulk && <span style={{ color: '#e8f1f8' }}>{bulk.done}/{bulk.total} okundu · <b style={{ color: '#34d399' }}>{bulk.fixed} düzeltildi</b>{bulk.finished ? ' · bitti' : ''}</span>}
      <span style={{ color: '#94a3b8' }}>Kayıtlı pasaport görselinden okunur; isim harf farkı dışında aynıysa düzeltilir, farklıysa dokunulmaz. Tıklama başına en fazla 50 kişi (~2 dk).</span>
    </div>
  );
  // Önerilen düzeltme: ı → i, Türkçe harfsiz isim kuralıyla yeniden yaz ("Ismaıl Gedıkoglu" → "İsmail Gedikoglu")
  const fixName = (x) => titleCaseTr(String(x || '').replace(/ı/g, 'i'));
  const ppList = (c) => safeParseJSON(c.passports).map(p => p.passportNo).filter(Boolean).join(', ');
  const row = (c) => (
    <div key={c._docId || c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', fontSize: '12px', color: '#e8f1f8', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: '200px' }}><b>{titleCaseTr(`${c.firstName || ''} ${c.lastName || ''}`)}</b> · TC {c.tcKimlik || '—'}{c.tcKimlik && !isValidTc(c.tcKimlik) ? ' ⚠️' : ''} · Doğum {c.birthDate ? formatDate(c.birthDate) : '—'} · Pasaport {ppList(c) || '—'}{c.createdAt ? ` · Kayıt ${formatDate(c.createdAt)}` : ''}</span>
      <button type="button" onClick={() => onOpen(c)} style={{ padding: '5px 12px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', color: '#60a5fa', cursor: 'pointer', fontWeight: '600', fontSize: '12px', fontFamily: 'inherit' }}>Aç</button>
    </div>
  );
  const groups = (tab === 'badTc' || tab === 'oddName' || tab === 'asciiName') ? null : data[tab];
  const oddRow = (c) => {
    const fn = fixName(c.firstName), ln = fixName(c.lastName);
    return (
      <div key={c._docId || c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', fontSize: '12.5px', color: '#e8f1f8', flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ flex: 1, minWidth: '220px' }}>
          <span style={{ color: '#fca5a5' }}>{c.firstName} {c.lastName}</span> <span style={{ color: '#64748b' }}>→</span> <b style={{ color: '#86efac' }}>{fn} {ln}</b>
          {c.tcKimlik ? <span style={{ color: '#64748b' }}> · TC {c.tcKimlik}</span> : null}
        </span>
        {readBtn(c)}
        <button type="button" onClick={() => onPatch?.(c, { firstName: fn, lastName: ln, nameOk: true })} style={{ padding: '5px 10px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: '8px', color: '#34d399', cursor: 'pointer', fontSize: '12px' }}>✓ Düzelt</button>
        <button type="button" onClick={() => onPatch?.(c, { nameOk: true })} title="İsim zaten doğru (ör. Yılmaz) — listeden çıkar" style={{ padding: '5px 10px', background: 'none', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#cbd5e1', cursor: 'pointer', fontSize: '12px' }}>Doğru, dokunma</button>
        <button type="button" onClick={() => onOpen(c)} style={{ padding: '5px 10px', background: 'none', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', color: '#60a5fa', cursor: 'pointer', fontSize: '12px' }}>Aç</button>
      </div>
    );
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f1d2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', width: '100%', maxWidth: '900px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: '700', color: '#fff' }}>🔍 Mükerrer / TC Kontrolü</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>{(customers || []).length} müşteri tarandı · TC eşsizdir: aynı TC farklı isimde ise TC veya isim hatalıdır</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '22px', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: '6px', padding: '12px 20px', flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {tabs.map(([id, label, n]) => (
            <button key={id} type="button" onClick={() => setTab(id)} style={{ padding: '7px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', border: '1px solid', borderColor: tab === id ? '#f59e0b' : 'rgba(255,255,255,0.12)', background: tab === id ? 'rgba(245,158,11,0.15)' : 'transparent', color: n ? (tab === id ? '#fbbf24' : '#e8f1f8') : '#64748b' }}>{label} ({n})</button>
          ))}
        </div>
        <div style={{ padding: '8px 20px 20px', overflowY: 'auto' }}>
          {tab === 'oddName'
            ? (data.oddName.length ? <>
                <div style={{ fontSize: '12px', color: '#94a3b8', margin: '8px 0', lineHeight: 1.5 }}>Eski isim düzeltmesi Türkçe harfsiz BÜYÜK yazılmış isimlerde (pasaport MRZ, Excel) her I'yı ı yaptı: "ISMAIL" → "Ismaıl". Bu listede ı geçen ama hiç i/İ geçmeyen isimler var — <b>Yılmaz, Kılıç</b> gibi gerçekten ı'lı isimler de çıkar. Önerilen yazım doğruysa <b>Düzelt</b>, isim zaten doğruysa <b>Doğru, dokunma</b>. İkisi de kaydı listeden çıkarır.</div>
                {bulkBar(data.oddName, 'Pasaportu olanların hepsini oku')}
                {data.oddName.map(oddRow)}
              </> : <div style={{ padding: '30px', textAlign: 'center', color: '#10b981' }}>✅ Şüpheli isim yok</div>)
            : tab === 'asciiName'
            ? (data.asciiName.length ? <>
                <div style={{ fontSize: '12px', color: '#94a3b8', margin: '8px 0', lineHeight: 1.5 }}>İsmi hiç Türkçe harf içermeyen ama pasaport görseli kayıtlı müşteriler (Excel/MRZ'den gelmiş olabilir: "Ferhat Akbiyik"). Pasaporttan okununca doğru yazım ("Akbıyık") kaydedilir; zaten doğruysa listeden çıkar.</div>
                {bulkBar(data.asciiName, 'Hepsini pasaporttan oku')}
                {data.asciiName.map(c => (
                  <div key={keyOf(c)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', fontSize: '12.5px', color: '#e8f1f8', flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ flex: 1, minWidth: '220px' }}><b>{c.firstName} {c.lastName}</b>{c.tcKimlik ? <span style={{ color: '#64748b' }}> · TC {c.tcKimlik}</span> : null}</span>
                    {readBtn(c)}
                    <button type="button" onClick={() => onOpen(c)} style={{ padding: '5px 10px', background: 'none', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', color: '#60a5fa', cursor: 'pointer', fontSize: '12px' }}>Aç</button>
                  </div>
                ))}
              </> : <div style={{ padding: '30px', textAlign: 'center', color: '#10b981' }}>✅ Kontrol edilecek isim yok</div>)
            : tab === 'badTc'
            ? (data.badTc.length ? <><div style={{ fontSize: '12px', color: '#94a3b8', margin: '8px 0' }}>11 hane değil ya da TC doğrulama basamakları tutmuyor — yanlış girilmiş/okunmuş olabilir.</div>{data.badTc.map(row)}</> : <div style={{ padding: '30px', textAlign: 'center', color: '#10b981' }}>✅ Sorun yok</div>)
            : (groups.length ? groups.map(([k, arr]) => (
              <div key={k} style={{ marginTop: '12px', padding: '10px 14px', background: tab === 'tcName' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${tab === 'tcName' ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '10px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600' }}>{tab === 'passport' ? `Pasaport ${k}` : tab === 'nameBirth' ? 'Aynı ad-soyad + doğum tarihi' : `TC ${k}`} · {arr.length} kayıt</div>
                {arr.map(row)}
              </div>
            )) : <div style={{ padding: '30px', textAlign: 'center', color: '#10b981' }}>✅ Sorun yok</div>)}
        </div>
      </div>
    </div>
  );
}

export function LinkPinBar({ c, showToast }) {
  const docId = c._docId || String(c.id);
  const [live, setLive] = useState({ linkPin: c.linkPin || '', shareToken: c.shareToken || '' });
  const [show, setShow] = useState(false);
  useEffect(() => onSnapshot(doc(db, 'customers', docId), snap => {
    const d = snap.data() || {};
    setLive({ linkPin: d.linkPin || '', shareToken: d.shareToken || '' });
  }, () => {}), [docId]);
  if (!live.shareToken) return null;
  const setPin = async (pin) => {
    const now = new Date().toISOString();
    const ref = doc(db, 'paylasimlar', live.shareToken);
    if (pin) {
      const salt = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('');
      await setDoc(ref, { pinHash: await sha256Hex(`${salt}:${pin}`), pinSalt: salt, pinFails: 0, pinLockUntil: 0, pinSetAt: now }, { merge: true });
    } else {
      await setDoc(ref, { pinHash: deleteField(), pinSalt: deleteField(), pinFails: 0, pinLockUntil: 0 }, { merge: true });
    }
    await setDoc(doc(db, 'customers', docId), { linkPin: pin || '', linkPinSetAt: pin ? now : '' }, { merge: true });
  };
  const reset = async () => {
    if (!window.confirm('PIN sıfırlansın mı? Müşteri linki bir sonraki açışında yeni PIN belirleyecek.')) return;
    try { await setPin(''); showToast?.('PIN sıfırlandı — müşteri yeni PIN belirleyecek', 'success'); } catch (e) { showToast?.('PIN sıfırlanamadı: ' + e.message, 'error'); }
  };
  const give = async () => {
    const pin = (window.prompt('Müşteriye verilecek 4 haneli PIN:', '') || '').trim();
    if (!pin) return;
    if (!/^\d{4}$/.test(pin)) { showToast?.('PIN 4 rakam olmalı', 'error'); return; }
    try { await setPin(pin); setShow(true); showToast?.('PIN kaydedildi', 'success'); } catch (e) { showToast?.('PIN kaydedilemedi: ' + e.message, 'error'); }
  };
  const btn = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '6px 10px', color: '#cbd5e1', cursor: 'pointer', fontSize: '12px' };
  return (
    <div style={{ margin: '12px 20px 0', padding: '10px 14px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '13px', color: '#94a3b8' }}>🔐 Link PIN:</span>
      {live.linkPin
        ? <b onClick={() => setShow(v => !v)} title="Göster / gizle" style={{ fontSize: '16px', letterSpacing: '4px', color: '#22c55e', cursor: 'pointer', fontFamily: 'monospace' }}>{show ? live.linkPin : '••••'}</b>
        : <span style={{ fontSize: '12px', color: '#eab308' }}>henüz belirlenmedi — müşteri linki ilk açtığında kendisi belirleyecek</span>}
      <span style={{ flex: 1 }} />
      {live.linkPin && <button onClick={() => setShow(v => !v)} style={btn}>{show ? '🙈 Gizle' : '👁 Göster'}</button>}
      <button onClick={give} style={btn}>✏️ PIN ver</button>
      {live.linkPin && <button onClick={reset} style={{ ...btn, color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' }}>↺ Sıfırla</button>}
    </div>
  );
}

// Pasaport No'dan türü otomatik tespit
export const detectPassportType = (passportNo) => {
  if (!passportNo) return null;
  const first = passportNo.toUpperCase()[0];
  if (first === 'U') return 'Bordo Pasaport (Umuma Mahsus)';
  if (first === 'S') return 'Yeşil Pasaport (Hususi)';
  if (first === 'Z') return 'Gri Pasaport (Hizmet)';
  if (first === 'D') return 'Siyah Pasaport (Diplomatik)';
  return null;
};

// Olası mükerrer müşteriler: aynı TC, aynı pasaport no, ya da aynı ad-soyad + doğum tarihi (OCR TC/pasaport no'yu yanlış okusa bile yakalar)
export const findLikelyDuplicates = (c, customers) => {
  if (!c) return [];
  const nm = (s) => normalizeTr(s).replace(/\s+/g, ' ');
  const key = (x) => x._docId || String(x.id);
  const full = nm(`${c.firstName || ''} ${c.lastName || ''}`);
  const tc = String(c.tcKimlik || '').trim();
  const ppNos = new Set(safeParseJSON(c.passports || c._passports).map(p => String(p.passportNo || '').trim().toUpperCase()).filter(Boolean));
  return (customers || []).filter(x => {
    if (c.id != null && (key(x) === key(c) || String(x.id) === String(c.id))) return false;
    if (tc.length === 11 && String(x.tcKimlik || '').trim() === tc) return true;
    if (ppNos.size && safeParseJSON(x.passports).some(p => ppNos.has(String(p.passportNo || '').trim().toUpperCase()))) return true;
    return !!full && !!c.birthDate && x.birthDate === c.birthDate && nm(`${x.firstName || ''} ${x.lastName || ''}`) === full;
  });
};

export const sameCustName = (a, b) => {
  const nm = (x) => normalizeTr(`${x?.firstName || ''} ${x?.lastName || ''}`).replace(/\s+/g, ' ');
  return nm(a) === nm(b);
};

export const validatePassportNo = (passportNo) => {
  if (!passportNo) return null;
  const regex = /^[A-Z][0-9]{7,8}$/;
  if (!regex.test(passportNo)) return '❌ Pasaport no 1 harf + 7-8 rakam olmalı (örn: U1234567)';
  return null; // geçerli
};

export const loadCompanies = async () => {
  if (_companyCache) return _companyCache;
  const r = await fetch('/companies.json');
  if (!r.ok) throw new Error('Firma listesi yüklenemedi');
  _companyCache = await r.json();
  return _companyCache;
};

// Müşteri linki PIN'i: müşteri ilk açılışta kendisi belirler, sunucu (Firebase fonksiyonu "belge") kartımıza linkPin olarak yazar.
// Kaybederse buradan söyleriz; "Sıfırla" ile müşteri yeniden belirler, "PIN ver" ile biz koyarız.
// Hash biçimi sunucuyla aynı: sha256("<salt>:<pin>") hex.
export const sha256Hex = async (str) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)))).map(b => b.toString(16).padStart(2, '0')).join('');

// Belge linkten kaldırılınca ondan okunan bilgiler de kalkar: uçuşlar (docId) ve otel (hotelDocId).
// Eski kayıtlarda kaynak bilgisi yok: o türden hiç belge kalmadıysa kaynaksız uçuş/otel de temizlenir.
export const tripWithoutDoc = (trip, d) => {
  const docs = (trip.docs || []).filter(x => x.id !== d.id);
  const noTicketLeft = !docs.some(x => x.icon === '✈️' || x.icon === '🛫' || x.icon === '🛬');
  const flights = (trip.flights || []).filter(f => f.docId ? f.docId !== d.id : !(noTicketLeft && d.icon === '✈️'));
  const t = { ...trip, docs, flights };
  const noHotelLeft = !docs.some(x => x.icon === '🏨');
  if ((trip.hotelDocId && trip.hotelDocId === d.id) || (!trip.hotelDocId && d.icon === '🏨' && noHotelLeft)) {
    Object.assign(t, { hotelName: '', hotelAddress: '', hotelCheckIn: '', hotelCheckOut: '', hotelDocId: '' });
  }
  // Tarih/şehir/başlık kalan uçuş/otelden yeniden
  if (flights.length) {
    t.startDate = flights[0].ymd || t.startDate; t.endDate = flights[flights.length - 1].ymd || t.endDate;
    t.city = flights[0].toCity || t.city; t.title = `${flights[0].fromCity || ''} → ${flights[0].toCity || ''}`.trim();
  } else if (t.hotelCheckIn) { t.startDate = t.hotelCheckIn; t.endDate = t.hotelCheckOut || t.hotelCheckIn; t.title = t.hotelName || ''; }
  else if (!flights.length && !t.hotelName) { t.startDate = ''; t.endDate = ''; t.city = ''; t.title = ''; }
  return t;
};

// === Firma seçici: DTO üye listesinden arar, yoksa elle eklemeye izin verir ===
export let _companyCache = null;

// 🪪 Oturma izinleri (bot "oturma izni" kartını okuyup kaydeder): ülke, kart no, tür, bitiş; görsel ve indirme. Geçerli
// Schengen ülkesi oturma izni olan müşteri Schengen turlarında "vize gerekmez" sayılır.
function ResidencePermits({ c, showToast, onImage }) {
  const list = residencePermitsOf(c);
  if (!list.length) return null;
  const remove = async (id) => {
    if (!window.confirm('Bu oturma izni kaydı silinsin mi?')) return;
    try { await setDoc(doc(db, 'customers', c._docId || String(c.id)), { residencePermits: JSON.stringify(list.filter(x => x.id !== id)), updatedAt: new Date().toISOString() }, { merge: true }); showToast?.('Oturma izni silindi', 'warning'); }
    catch (e) { showToast?.('Silinemedi: ' + e.message, 'error'); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {list.map(r => {
        const left = r.expiryDate ? getDaysLeft(r.expiryDate) : null;
        const schengen = schengenCountries.some(k => normalizeTr(k) === normalizeTr(r.country));
        const col = left === null ? '#94a3b8' : left <= 0 ? '#ef4444' : left < 183 ? '#f59e0b' : '#10b981';
        const name = `${c.firstName || ''} ${c.lastName || ''} Oturma izni ${r.country || ''}`;
        return (
          <div key={r.id} style={{ background: 'rgba(5,150,105,0.08)', border: `1px solid ${col}55`, borderRadius: '14px', padding: '14px 16px', display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#e8f1f8' }}>🪪 Oturma izni · {r.country || 'Ülke ?'}{r.category ? <span style={{ fontWeight: 400, color: '#94a3b8' }}> · {r.category}</span> : null}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Kart no: {r.permitNo || '—'}{r.issueDate ? ` · Veriliş ${formatDate(r.issueDate)}` : ''}</div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: col, marginTop: '4px' }}>
                {r.expiryDate ? (left <= 0 ? `Süresi doldu (${formatDate(r.expiryDate)})` : `Bitiş ${formatDate(r.expiryDate)} · ${left} gün`) : 'Bitiş tarihi yok'}
                {schengen && left > 0 ? ' · Schengen\'e vizesiz giriş' : ''}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                {r.image && <button type="button" onClick={() => downloadUrl(r.image, name).catch(e => showToast?.('İndirilemedi: ' + e.message, 'error'))} style={{ padding: '5px 10px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: '8px', color: '#60a5fa', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>⬇️ İndir</button>}
                <button type="button" onClick={() => remove(r.id)} style={{ padding: '5px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}>🗑 Sil</button>
              </div>
            </div>
            {r.image && <img src={r.image} alt="Oturma izni" onError={onDocImgError} onClick={() => onImage?.(r.image, `Oturma izni - ${r.country || ''}`, name)} style={{ width: '160px', maxWidth: '100%', aspectRatio: '85/54', objectFit: 'cover', borderRadius: '8px', cursor: 'zoom-in', border: '1px solid rgba(255,255,255,0.15)' }} />}
          </div>
        );
      })}
    </div>
  );
}
