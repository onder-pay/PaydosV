// 🌍 Vize modülü
import { LoadingButton, inputStyle, selectStyle } from '../components/ui';
import { PAYMENT_METHODS, VIZE_DURUM } from '../lib/data.js';
import { VISA_COST_CATEGORIES, getVisaCostItems, sendVisaEmail, visaAppBelongsTo, FingerprintBox } from '../components/shared';
import { XLSX } from '../lib/heavy.js';
import { db } from '../lib/firebase.js';
import { deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore';
import { formatDate, formatWhatsAppPhone, generateUniqueId, getDaysLeft, isValidTc, safeParseJSON, visaPaidStatus, waUrl } from '../lib/format.js';
import { getActiveBanks } from '../lib/banks.js';
import { htmlToPdfDownload } from '../lib/pdf.js';
import { logActivity } from '../lib/api.js';
import { normalizeTr, titleCaseTr, trHas, fullNameTr } from '../lib/turkish.js';
import { useEffect, useState } from 'react';
import { fingerprintStatus } from '../lib/travel.js';


export function VisaModule({ customers, visaApplications, setVisaApplications, isMobile, onNavigateToCustomers, onOpenCustomer, onNavigateHome, appSettings, setAppSettings, showToast, addToUndo, creditCards, currentUser, quickAction, onQuickActionDone }) {
  const [activeTab, setActiveTab] = useState('calendar');
  const [showForm, setShowForm] = useState(false);
  const [formStep, setFormStep] = useState('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [visaSearchQuery, setVisaSearchQuery] = useState('');
  const [visaStatusFilter, setVisaStatusFilter] = useState('all');
  const [visaCountryFilter, setVisaCountryFilter] = useState('all');
  const [visaSort, setVisaSort] = useState('appointmentDesc'); // sıralama: başvuru/randevu tarihi
  // Toplu seçim: birden çok başvuruyu seçip ödeme/durum güncelle
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelected = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds([]); };
  const bulkUpdateVisas = async (patch, label) => {
    const ids = new Set(selectedIds);
    const targets = visaApplications.filter(v => ids.has(v.id));
    if (!targets.length || bulkBusy) return;
    if (isCancelStatus(patch.status)) {
      const r = askCancelReason(`${targets.length} başvuru`);
      if (!r) { if (r !== null) showToast?.('İptal sebebi girmeden durum değiştirilemez', 'warning'); return; }
      patch = { ...patch, cancelReason: r, cancelledAt: new Date().toISOString() };
    }
    if (!window.confirm(`${targets.length} başvuru "${label}" olarak işaretlenecek. Devam edilsin mi?`)) return;
    setBulkBusy(true);
    const before = targets.map(v => ({ ...v }));
    const now = new Date().toISOString();
    try {
      // Firestore'a tek seferde yaz (400'lük gruplar)
      for (let i = 0; i < targets.length; i += 400) {
        const batch = writeBatch(db);
        targets.slice(i, i + 400).forEach(v => batch.set(doc(db, 'visa_applications', v._docId || String(v.id)), { ...patch, updatedAt: now }, { merge: true }));
        await batch.commit();
      }
      setVisaApplications(prev => prev.map(v => ids.has(v.id) ? { ...v, ...patch } : v));
      addToUndo?.({ type: 'update', undo: () => {
        const map = new Map(before.map(v => [v.id, v]));
        setVisaApplications(prev => prev.map(v => map.get(v.id) || v));
      } });
      logActivity('status', 'Vize', `${targets.length} başvuru → ${label} (toplu)`, currentUser);
      showToast?.(`✅ ${targets.length} başvuru "${label}" yapıldı`, 'success');
      exitSelectMode();
    } catch (e) {
      showToast?.('❌ Toplu güncelleme başarısız: ' + e.message, 'error');
    } finally { setBulkBusy(false); }
  };
  const [idataInfoModal, setIdataInfoModal] = useState(null); // {visa, customer} — iDATA hazır bilgi paneli
  // Bir vize başvurusundan görünen ülke etiketini çöz (filtre + dropdown ortak kullanır)
  const extractVisaCountry = (v) => {
    const catLabel = { schengen: 'Schengen', usa: 'Amerika', russia: 'Rusya', uk: 'İngiltere', uae: 'BAE', china: 'Çin', other: 'Diğer' };
    if (v.country && v.country.trim()) {
      const c = v.country.trim();
      const cn = normalizeTr(c);
      if (/amerika|birlesik devlet|\babd\b|\busa\b/.test(cn)) return 'Amerika';
      if (/birlesik krallik|ingiltere|united kingdom/.test(cn)) return 'İngiltere';
      if (/birlesik arap|\bb\.?a\.?e\.?\b|\buae\b/.test(cn)) return 'BAE';
      return c;
    }
    const cid = v.categoryId || v.category;
    if (cid && cid !== 'schengen' && cid !== 'other' && catLabel[cid]) return catLabel[cid];
    const txt = `${v.visaDuration || ''} ${v.visaType || ''}`;
    const known = Object.keys(VIZE_DURUM).slice().sort((a, b) => b.length - a.length);
    // Kelime sınırıyla eşleştir: kısa ülke adları (Mali, Gana, Çad...) başka kelimelerin içinde yakalanmasın
    const words = ` ${normalizeTr(txt).replace(/[^a-z0-9]+/g, ' ')} `;
    const match = known.find(c => words.includes(` ${normalizeTr(c).replace(/[^a-z0-9]+/g, ' ').trim()} `));
    if (match) return trHas(match, 'amerika', 'birlesik devlet') ? 'Amerika' : match;
    if (cid && catLabel[cid]) return catLabel[cid];
    return '';
  };
  const [showIdataModal, setShowIdataModal] = useState(false);
  const [idataText, setIdataText] = useState('');
  const [idataParsed, setIdataParsed] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [relinkQ, setRelinkQ] = useState('');
  const findVisaCust = (id) => (id == null || id === '') ? null : (customers || []).find(c => String(c.id) === String(id) || (c._docId && c._docId === String(id))) || null;
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
    { id: 'russia', label: 'Rusya', icon: '🇷🇺', color: '#ef4444', countries: ['Rusya'], durations: appSettings?.visaDurations?.russia || null },
    { id: 'uae', label: 'BAE', icon: '🇦🇪', color: '#f59e0b', countries: ['Birleşik Arap Emirlikleri'], durations: appSettings?.visaDurations?.uae || null },
    { id: 'usa', label: 'Amerika', icon: '🇺🇸', color: '#3b82f6', countries: ['Amerika Birleşik Devletleri'], durations: appSettings?.visaDurations?.usa || null },
    { id: 'uk', label: 'İngiltere', icon: '🇬🇧', color: '#8b5cf6', countries: ['İngiltere'], durations: appSettings?.visaDurations?.uk || null },
    { id: 'china', label: 'Çin', icon: '🇨🇳', color: '#dc2626', countries: ['Çin'], durations: appSettings?.visaDurations?.china || null },
    { id: 'other', label: 'Diğer', icon: '🌍', color: '#64748b', countries: ['Kanada', 'Avustralya', 'Japonya', 'Hindistan', 'Güney Kore', 'Brezilya', 'Meksika', 'Diğer'], durations: null }
  ];

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
    const matchSearch = visaSearchQuery.length < 1 || (
      normalizeTr(v.customerName).includes(normalizeTr(visaSearchQuery)) ||
      v.customerPhone?.includes(visaSearchQuery) ||
      normalizeTr(v.country).includes(normalizeTr(visaSearchQuery)) ||
      normalizeTr(v.pnr).includes(normalizeTr(visaSearchQuery)) ||
      normalizeTr(v.label).includes(normalizeTr(visaSearchQuery))
    );
    const matchStatus = visaStatusFilter === 'all' ? true
      : visaStatusFilter === '__ileri__' ? !!visaFutureDate(v)
      : visaStatusFilter === '__odenmedi__' ? (!v.paymentStatus || v.paymentStatus === 'Ödenmedi')
      // Durum bölümlerinde ileri tarihli başvuru, tarihi gelene kadar görünmez (vizeci "Başvuru Yapılacak"a
      // bakıyor; 18 Ekim'e ayarlanan kayıt o sabah kendiliğinden bu bölüme düşer). "Tümü" ve "İleri tarihli"de görünür.
      : v.status === visaStatusFilter && !visaFutureDate(v);
    const matchCountry = visaCountryFilter === 'all' ? true : extractVisaCountry(v) === visaCountryFilter;
    return matchSearch && matchStatus && matchCountry;
  }).sort((a, b) => {
    const ts = (d) => d ? new Date(d).getTime() || 0 : 0;
    switch (visaSort) {
      case 'appointmentAsc': {
        // Randevusu olmayanlar en sona
        const x = ts(a.appointmentDate), y = ts(b.appointmentDate);
        if (!x && !y) return 0; if (!x) return 1; if (!y) return -1;
        return x - y;
      }
      case 'applicationDesc': return ts(b.applicationDate) - ts(a.applicationDate);
      case 'applicationAsc': {
        const x = ts(a.applicationDate), y = ts(b.applicationDate);
        if (!x && !y) return 0; if (!x) return 1; if (!y) return -1;
        return x - y;
      }
      case 'nameAsc': return (a.customerName || '').localeCompare(b.customerName || '', 'tr');
      case 'appointmentDesc':
      default: return ts(b.appointmentDate) - ts(a.appointmentDate);
    }
  });

  // Excel export fonksiyonu
  // ====== iDATA RANDEVU MAİLİ PARSER ======
  // İsim normalize (eşleştirme için): büyük harf, Türkçe→ascii, fazla boşluk temizle
  const normName = (s) => (s || '')
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I').replace(/I/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
    .replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

  const parseIdataText = (text) => {
    if (!text || !text.trim()) { setIdataParsed([]); return; }
    const lines = text.split('\n');
    const rows = [];
    // PNR pattern: SDP + 7-9 alfanumerik (SDPYKATUGMF) veya genel 3harf+8+
    const pnrRe = /\b([A-Z]{2,4}[A-Z0-9]{6,10})\b/;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      // Başlık satırını atla
      if (/ad\s*soyad|pnr|gidis|randevu tarihi/.test(normalizeTr(line)) && !pnrRe.test(line.replace(/PNR/i,''))) continue;
      const m = line.match(pnrRe);
      if (!m) continue;
      const pnr = m[1];
      // PNR öncesi = isim
      const beforePnr = line.substring(0, m.index).trim();
      // PNR sonrası: gidiş amacı, ofis, hizmet, randevu durumu (tab veya 2+ boşluk ayrımı)
      const afterPnr = line.substring(m.index + pnr.length).trim();
      const afterParts = afterPnr.split(/\t|\s{2,}/).map(s => s.trim()).filter(Boolean);
      // Randevu tarihi + saati (DD/MM/YYYY ve HH:MM) — sütun sırasından bağımsız regex
      const dm = afterPnr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      const tm = afterPnr.match(/(\d{1,2}):(\d{2})/);
      const apptDate = dm ? `${dm[3]}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}` : '';
      const apptTime = tm ? `${tm[1].padStart(2,'0')}:${tm[2]}` : '';
      // Tarih/saat parçalarını sütunlardan çıkar ki amaç/ofis/hizmet/durum temiz kalsın
      const cleanParts = afterParts.filter(p => !/\d{1,2}\/\d{1,2}\/\d{4}/.test(p) && !/^\d{1,2}:\d{2}$/.test(p));
      // İsim: PNR öncesi tüm harf içeren parçaları birleştir (ad+soyad ayrı sütun/tab olabilir)
      const nameParts = beforePnr.split(/\t|\s{2,}/).map(s => s.trim()).filter(Boolean);
      const letterParts = nameParts.filter(p => /[A-Za-zĞÜŞİÖÇğüşıöçÂÎÛâîû]/.test(p));
      let name = (letterParts.length ? letterParts.join(' ') : beforePnr).replace(/\s+/g, ' ').trim();
      if (!name || name.length < 3) continue;
      rows.push({
        name: name,
        pnr: pnr,
        purpose: cleanParts[0] || '',
        office: cleanParts[1] || '',
        serviceType: cleanParts[2] || '',
        appointmentDate: apptDate,
        appointmentTime: apptTime,
        appointmentStatus: cleanParts.slice(3).join(' ') || '',
        matchedCustomer: null,
        matchedVisa: null
      });
    }

    // CRM müşterileri + vize başvurularıyla eşleştir
    rows.forEach(row => {
      const target = normName(row.name);
      // Önce vize başvurularında müşteri adı eşleşmesi
      let bestVisa = null, bestScore = 0;
      visaApplications.forEach(v => {
        const vName = normName(v.customerName || '');
        if (!vName) return;
        let score = 0;
        if (vName === target) score = 100;
        else {
          // Kelime bazlı eşleşme (isim sırası farklı olabilir)
          const tWords = target.split(' ').filter(Boolean);
          const vWords = vName.split(' ').filter(Boolean);
          const common = tWords.filter(w => vWords.includes(w)).length;
          // Alt küme durumu için min'e göre de hesapla (örn 2 kelime CRM'de 3 kelimenin parçası)
          const byMax = Math.max(tWords.length, vWords.length);
          const byMin = Math.min(tWords.length, vWords.length);
          const scoreMax = byMax > 0 ? (common / byMax) * 100 : 0;
          const scoreMin = byMin > 0 ? (common / byMin) * 100 : 0;
          // En az 2 ortak kelime varsa alt küme skorunu da değerlendir (tek ortak kelime yeterli değil)
          score = (common >= 2) ? Math.max(scoreMax, scoreMin * 0.9) : scoreMax;
        }
        if (score > bestScore) { bestScore = score; bestVisa = v; }
      });
      if (bestVisa && bestScore >= 60) {
        row.matchedVisa = bestVisa;
        row.matchScore = Math.round(bestScore);
      }
    });

    setIdataParsed(rows);
  };

  const applyIdataMatches = () => {
    const toApply = idataParsed.filter(r => r.matchedVisa);
    if (toApply.length === 0) {
      showToast?.('Eşleşen başvuru yok', 'warning');
      return;
    }
    const updated = visaApplications.map(v => {
      const match = toApply.find(r => r.matchedVisa && r.matchedVisa.id === v.id);
      if (!match) return v;
      return {
        ...v,
        pnr: match.pnr,
        processor: v.processor || 'İdata',
        idataOffice: match.office || v.idataOffice,
        appointmentDate: match.appointmentDate || v.appointmentDate,
        appointmentTime: match.appointmentTime || v.appointmentTime,
        // Randevu durumu "Atama Bekliyor" ise statüyü güncelle
        status: trHas(match.appointmentStatus, 'atama bekliyor') ? 'Atama Bekliyor' : (trHas(match.appointmentStatus, 'bekliyor') ? 'Randevu Bekliyor' : v.status),
        idataStatus: match.appointmentStatus || ''
      };
    });
    setVisaApplications(updated);
    // ⚡ Anında Firestore'a yaz (onSnapshot çakışmasını önle)
    (async () => {
      try {
        const batch = writeBatch(db);
        const now = new Date().toISOString();
        toApply.forEach(r => {
          const v = updated.find(x => x.id === r.matchedVisa.id);
          if (!v) return;
          const docId = v._docId || String(v.id);
          const sd = { ...v, updatedAt: now };
          delete sd._docId;
          batch.set(doc(db, 'visa_applications', docId), sd, { merge: true });
        });
        await batch.commit();
      } catch(e) { console.warn('iDATA Firestore yazma hatası:', e.message); }
    })();
    showToast?.(`✅ ${toApply.length} başvuruya PNR işlendi`, 'success');
    setShowIdataModal(false);
    setIdataText('');
    setIdataParsed([]);
  };

  const exportToExcel = () => {
    if (visaApplications.length === 0) {
      showToast?.('Export edilecek vize başvurusu yok', 'warning');
      return;
    }
    // Tüm kategorilerdeki maliyet kalemlerinin birleşimi (anahtar bazında tekil) — her biri ayrı sütun
    const costItems = [];
    VISA_COST_CATEGORIES.forEach(k => getVisaCostItems(appSettings, k.id).forEach(it => {
      if (!costItems.some(x => x.key === it.key)) costItems.push(it);
    }));

    const data = visaApplications.map(v => {
      const costs = v.costs || {};
      const satisCur = v.visaCurrency || v.currency || '€';
      const costCur = v.costCurrency || satisCur;
      // Maliyet kalemleri: her biri "tutar para birimi" olarak ayrı sütun
      const maliyetSutunlari = {};
      const toplamPB = {};
      costItems.forEach(f => {
        const tutar = parseFloat(costs[f.key]) || 0;
        maliyetSutunlari[f.label] = tutar ? `${tutar} ${costCur}` : '';
      });
      Object.assign(toplamPB, sumVisaCosts(v));
      // Ödemeler
      const odemeler = safeParseJSON(v.payments);
      const odemeToplam = {};
      odemeler.forEach(o => { const a = parseFloat(o.amount) || 0; if (!a) return; const c = o.currency || '€'; odemeToplam[c] = (odemeToplam[c] || 0) + a; });
      const indirim = parseFloat(v.visaDiscount) || 0;
      const satis = (parseFloat(v.visaPrice || v.price) || 0) - indirim;

      return {
        'Müşteri Adı': v.customerName || '',
        // Kayıtta boşsa müşteri kartından / "Almanya Ticari" gibi vize süresi yazısından tamamla
        'Telefon': v.customerPhone || (customers || []).find(c => String(c.id) === String(v.customerId))?.phone || '',
        'Kategori': getCategoryInfo(v.category)?.label || v.category || '',
        'Ülke': extractVisaCountry(v) || '',
        'Vize Türü': v.visaType || (() => {
          const ulke = extractVisaCountry(v);
          // Tür adından ülkeyi at ("Italya Ticari" − "İtalya" → "Ticari"): normalizeTr uzunluğu korur, aynı konumdan kesilir
          const vd = String(v.visaDuration || ''), at = ulke ? normalizeTr(vd).indexOf(normalizeTr(ulke)) : -1;
          const rest = (at >= 0 ? vd.slice(0, at) + vd.slice(at + normalizeTr(ulke).length) : vd).replace(/\s+/g, ' ').trim();
          return rest && rest !== v.visaDuration ? rest : '';
        })(),
        'Vize Süresi': v.visaDuration || '',
        'Başvuru Tarihi': formatDate(v.applicationDate) || '',
        'Randevu Tarihi': formatDate(v.appointmentDate) || '',
        'Randevu Saati': v.appointmentTime || '',
        'PNR': v.pnr || '',
        'İşlem': v.processor || '',
        'Ödeme Durumu': v.paymentStatus || '',
        'Durum': v.status || '',
        ...maliyetSutunlari,
        'İndirim': indirim ? `${indirim} ${satisCur}` : '',
        'Vize Bedeli (Satış)': satis ? `${satis.toFixed(2)} ${satisCur}` : '',
        'Toplam Maliyet': Object.entries(toplamPB).map(([c, val]) => `${val.toFixed(2)} ${c}`).join(' · '),
        'Tahsil Edilen': Object.entries(odemeToplam).map(([c, val]) => `${val.toFixed(2)} ${c}`).join(' · '),
        'Kâr / Zarar': (() => {
          const tumPB = [...new Set([...Object.keys(odemeToplam), ...Object.keys(toplamPB)])];
          if (tumPB.length === 0) return '';
          return tumPB.map(c => {
            const d = (odemeToplam[c] || 0) - (toplamPB[c] || 0);
            return `${d >= 0 ? '+' : ''}${d.toFixed(2)} ${c}`;
          }).join(' · ');
        })(),
        'Ödeme Detayı': odemeler.filter(o => parseFloat(o.amount)).map(o => `${o.amount} ${o.currency || '€'} (${o.date ? formatDate(o.date) : '-'}${o.method ? ' ' + o.method : ''}${o.note ? ' ' + o.note : ''})`).join(' | '),
        'Notlar': v.notes || ''
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vize Başvuruları');
    XLSX.writeFile(wb, `vize-basvurulari-${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.(`${visaApplications.length} başvuru Excel'e aktarıldı`, 'success');
  };

  // Arama sonuçları (form için müşteri arama)
  const searchResults = searchQuery.length >= 1 
    ? customers.filter(c => 
        normalizeTr(`${c.firstName} ${c.lastName}`).includes(normalizeTr(searchQuery)) ||
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
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
    setRelinkQ('');
    setSelectedCategory(null);
    setChecklist({ passportValid: null, passportCondition: null, addressChecked: null });
    // Maliyet varsayılanları kategori seçilince (selectCategory) uygulanır
    setFormData({});
    setEditingVisa(null);
  };

  // 👥 Toplu vize başvurusu (Müşteriler'de çoklu seçim → "Vize başvurusu"): kategori + tür bir kez seçilir,
  // herkese aynı türde "ilk durum" başvurusu açılır; kişiye özel bilgiler (randevu, PNR…) sonra tek tek girilir.
  // "Müşteri İptal Etti" (iptal içeren her durum) seçilince sebep zorunlu — boş bırakılırsa durum değişmez
  const isCancelStatus = (st) => trHas(st, 'iptal'); // /iptal/i "İptal"i tanımaz (İ≠I) — bkz. Türkçe karakter kuralı
  const askCancelReason = (who, prev = '') => {
    const r = window.prompt(`${who ? who + ' — ' : ''}İptal sebebi nedir? (zorunlu)`, prev || '');
    return r === null ? null : r.trim();
  };
  const [bulkVisa, setBulkVisa] = useState(null); // { custs, cat, type, country, skip: [id], busy }
  const openVisaOf = (c, countryName) => visaApplications.filter(v => visaAppBelongsTo(v, c, customers)).find(v => {
    if (/iptal|onay|red/.test(normalizeTr(v.status))) return false;
    if (String(v.createdAt || v.applicationDate || '') < new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)) return false;
    return !countryName || !v.country || normalizeTr(v.country) === normalizeTr(countryName);
  });
  const openBulkVisa = (custs) => { setShowForm(false); setBulkVisa({ custs, cat: null, type: null, country: '', skip: custs.filter(c => openVisaOf(c, '')).map(c => c.id), busy: false }); }; // açık başvurusu olan varsayılan olarak dışarıda
  const bulkCountryFor = (cat, typeName) => {
    if (!cat) return '';
    if (cat.countries.length === 1) return cat.countries[0];
    const n = normalizeTr(typeName || '');
    return cat.countries.find(c => n.includes(normalizeTr(c))) || '';
  };
  const createBulkVisas = async () => {
    const bv = bulkVisa; if (!bv?.cat || !bv.type) return;
    const country = bv.country || bulkCountryFor(bv.cat, bv.type.name);
    const todo = bv.custs.filter(c => !bv.skip.includes(c.id));
    if (!todo.length) { showToast?.('Başvuru açılacak kişi seçili değil', 'warning'); return; }
    setBulkVisa({ ...bv, busy: true });
    const today = new Date().toISOString().split('T')[0];
    const recs = todo.map(c => ({
      customerId: c.id, customerName: `${c.firstName || ''} ${c.lastName || ''}`.trim(), customerPhone: c.phone || '', customerEmail: c.email || '',
      category: bv.cat.id, categoryId: bv.cat.id, country, visaType: '',
      visaDuration: bv.type.name, visaPrice: bv.type.price || 0, visaCurrency: bv.type.currency || '€',
      applicationDate: today, appointmentDate: '', appointmentTime: '', pnr: '', label: '',
      processor: appSettings?.processors?.[0] || 'Paydos', paymentStatus: 'Ödenmedi', status: visaStatuses[0] || 'Evrak Topluyor', notes: '',
      price: bv.type.price || '', cost: '', currency: bv.type.currency || '€',
      costs: getVisaCostDefaults(appSettings, bv.cat.id, bv.type.name), costCurrency: (appSettings?.visaCostDefaultCurrency || {})[bv.cat.id] || '₺',
      id: generateUniqueId(), createdAt: new Date().toISOString(), createdBy: currentUser?.name || '', bulk: true,
    }));
    let fail = 0;
    for (const r of recs) {
      try { await setDoc(doc(db, 'visa_applications', String(r.id)), { ...r, updatedAt: new Date().toISOString() }, { merge: true }); }
      catch (e) { fail++; console.warn('Toplu vize kaydı', r.customerName, e.message); }
    }
    setVisaApplications(prev => [...prev, ...recs]);
    logActivity('create', 'Vize', `${recs.length} kişiye toplu başvuru — ${country} ${bv.type.name}`.trim(), currentUser);
    showToast?.(`✅ ${recs.length} vize başvurusu açıldı (${country || bv.cat.label} · ${bv.type.name})${fail ? ` — ${fail} tanesi sunucuya yazılamadı` : ''}. Randevu ve diğer bilgileri tek tek girin.`, fail ? 'warning' : 'success');
    setBulkVisa(null);
  };

  const openNewForm = () => { resetForm(); setShowForm(true); };

  // ⚡ Dashboard kısayolu: modül açılınca istenen formu hemen aç
  useEffect(() => { if (!quickAction) return; if (quickAction === 'new') openNewForm();
    else if (quickAction?.type === 'visaFor' && quickAction.customer) { resetForm(); setSelectedCustomer(quickAction.customer); setFormStep('checklist'); setShowForm(true); }
    else if (quickAction?.type === 'visaForMany' && quickAction.customers?.length) openBulkVisa(quickAction.customers);
    onQuickActionDone?.(); }, [quickAction]);

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
      status: visaStatuses[0] || 'Evrak Topluyor', // Ayarlar'daki ilk durum = yeni başvuru varsayılanı
      notes: '',
      price: '',
      cost: '',
      currency: '€',
      // Kategoriye özel varsayılan maliyet kalemleri (Ayarlar → Varsayılan Vize Maliyetleri)
      costs: getVisaCostDefaults(appSettings, cat.id),
      costCurrency: (appSettings?.visaCostDefaultCurrency || {})[cat.id] || '₺'
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
    const fullPhone = formatWhatsAppPhone(phone);
    window.open(waUrl(fullPhone, message), '_blank');
  };

  const sendEmail = (visa) => {
    if (!visa.customerEmail) {
      alert('Müşteri e-posta adresi bulunamadı!');
      return;
    }
    const subject = `${visa.country} Vize Randevu Bilgisi`;
    const body = `Sayın ${titleCaseTr(visa.customerName)},\n\n${visa.country} vize randevunuz ${formatDate(visa.appointmentDate)} tarihinde${visa.appointmentTime ? ` saat ${visa.appointmentTime}` : ''} için alınmıştır.\n\nPNR: ${visa.pnr || '-'}\n\nPaydos Turizm`;
    window.open(`mailto:${visa.customerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
  };

  const sendWhatsApp = (visa) => {
    const phone = visa.customerPhone?.replace(/\D/g, '');
    if (!phone) return;
    const fullPhone = formatWhatsAppPhone(phone);
    window.open(`https://wa.me/${fullPhone}`, '_blank');
  };

  const generateProforma = async (visa) => {
    try {
      showToast?.('Proforma hazırlanıyor...', 'info');
      const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const price = visa.visaPrice || visa.price || 0;
      const currency = visa.visaCurrency || visa.currency || '€';
      const serviceName = visa.visaDuration || visa.visaType || 'Vize Hizmeti';
      const bugun = new Date().toLocaleDateString('tr-TR');
      const odendi = visa.paymentStatus === 'Ödendi';
      const banks = getActiveBanks(appSettings);
      const proformaNo = `PRF-${new Date().getFullYear()}-${String(visa.id || Date.now()).slice(-5)}`;

      const detayRow = (label, val) => val ? `<tr><td style="padding:6px 0;color:#64748b;width:150px;font-size:13px">${esc(label)}</td><td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600">${esc(val)}</td></tr>` : '';
      // Banka bilgileri HTML — para birimine göre uygun IBAN'ı öne çıkar
      const bankaHTML = banks.map(b => {
        const satirlar = [];
        if (b.ibanTL) satirlar.push(`<tr><td style="padding:4px 0;color:#64748b;font-size:12px;width:60px">TL</td><td style="padding:4px 0;color:#0f172a;font-size:12px;font-weight:600">${esc(b.ibanTL)}</td></tr>`);
        if (b.ibanEUR) satirlar.push(`<tr><td style="padding:4px 0;color:#64748b;font-size:12px">EUR</td><td style="padding:4px 0;color:#0f172a;font-size:12px;font-weight:600">${esc(b.ibanEUR)}</td></tr>`);
        if (b.ibanUSD) satirlar.push(`<tr><td style="padding:4px 0;color:#64748b;font-size:12px">USD</td><td style="padding:4px 0;color:#0f172a;font-size:12px;font-weight:600">${esc(b.ibanUSD)}</td></tr>`);
        if (!satirlar.length) return '';
        return `<div style="margin-bottom:10px">
          <div style="font-size:13px;font-weight:700;color:#1e3a5c">${esc(b.bankName)}${b.branch ? ` — ${esc(b.branch)}` : ''}</div>
          ${b.swift ? `<div style="font-size:11px;color:#64748b;margin-bottom:4px">SWIFT: ${esc(b.swift)}</div>` : ''}
          <table style="width:100%;border-collapse:collapse">${satirlar.join('')}</table>
        </div>`;
      }).join('');

      const html = `
        <div style="font-family:'DejaVu Sans','Segoe UI',Arial,sans-serif;color:#0f172a;padding:48px 44px;box-sizing:border-box">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5c;padding-bottom:18px;margin-bottom:24px">
            <div>
              <div style="font-size:26px;font-weight:800;color:#1e3a5c;letter-spacing:1px">PAYDOS TURİZM</div>
              <div style="font-size:12px;color:#64748b;margin-top:4px">Seyahat Acentalığı</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:20px;font-weight:700;color:#e8912a">PROFORMA FATURA</div>
              <div style="font-size:12px;color:#64748b;margin-top:4px">No: ${esc(proformaNo)}</div>
              <div style="font-size:12px;color:#64748b">Tarih: ${esc(bugun)}</div>
            </div>
          </div>

          <div style="display:flex;gap:24px;margin-bottom:24px">
            <div style="flex:1;background:#f8fafc;border-radius:10px;padding:16px">
              <div style="font-size:12px;font-weight:700;color:#1e3a5c;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">Müşteri Bilgileri</div>
              <table style="width:100%;border-collapse:collapse">
                ${detayRow('Ad Soyad', visa.customerName)}
                ${detayRow('Telefon', visa.customerPhone || '-')}
                ${detayRow('E-posta', visa.customerEmail || '-')}
              </table>
            </div>
            <div style="flex:1;background:#f8fafc;border-radius:10px;padding:16px">
              <div style="font-size:12px;font-weight:700;color:#1e3a5c;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">Vize Detayları</div>
              <table style="width:100%;border-collapse:collapse">
                ${detayRow('Ülke', visa.country)}
                ${detayRow('Vize Türü', serviceName)}
                ${detayRow('Başvuru Tarihi', visa.applicationDate ? formatDate(visa.applicationDate) : '')}
                ${detayRow('Randevu', visa.appointmentDate ? `${formatDate(visa.appointmentDate)} ${visa.appointmentTime || ''}`.trim() : '')}
                ${detayRow('PNR', visa.pnr)}
              </table>
            </div>
          </div>

          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <thead>
              <tr style="background:#1e3a5c;color:#fff">
                <th style="text-align:left;padding:12px 16px;font-size:13px;border-radius:8px 0 0 0">Hizmet</th>
                <th style="text-align:right;padding:12px 16px;font-size:13px;border-radius:0 8px 0 0">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr style="border-bottom:1px solid #e2e8f0">
                <td style="padding:14px 16px;font-size:14px;color:#0f172a">${esc(serviceName)}</td>
                <td style="padding:14px 16px;font-size:14px;color:#0f172a;text-align:right;font-weight:600">${esc(price)} ${esc(currency)}</td>
              </tr>
              <tr style="background:#f8fafc">
                <td style="padding:14px 16px;font-size:16px;font-weight:800;color:#1e3a5c">TOPLAM</td>
                <td style="padding:14px 16px;font-size:16px;font-weight:800;color:#e8912a;text-align:right">${esc(price)} ${esc(currency)}</td>
              </tr>
            </tbody>
          </table>

          <div style="display:inline-block;padding:8px 18px;border-radius:20px;font-size:13px;font-weight:700;margin-bottom:24px;${odendi ? 'background:#dcfce7;color:#16a34a' : 'background:#fee2e2;color:#dc2626'}">
            ${odendi ? '✓ ÖDENDİ' : '✗ ÖDENMEDİ'}
          </div>

          ${bankaHTML ? `
          <div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:24px">
            <div style="font-size:12px;font-weight:700;color:#1e3a5c;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px">Banka Bilgileri</div>
            ${bankaHTML}
          </div>` : ''}

          ${visa.notes ? `<div style="margin-bottom:24px"><div style="font-size:12px;font-weight:700;color:#1e3a5c;margin-bottom:6px">NOTLAR</div><div style="font-size:13px;color:#475569;line-height:1.5">${esc(visa.notes)}</div></div>` : ''}

          <div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:8px;text-align:center">
            <div style="font-size:11px;color:#94a3b8">Bu proforma fatura bilgilendirme amaçlıdır.</div>
            <div style="font-size:12px;color:#1e3a5c;font-weight:600;margin-top:4px">Paydos Turizm · www.paydostur.com · 0 258 263 71 76</div>
          </div>
        </div>`;

      await htmlToPdfDownload(html, `Proforma_${(visa.customerName || 'Musteri').replace(/[^\wğüşıöçĞÜŞİÖÇ ]/g, '').replace(/\s+/g, '_')}.pdf`);
      showToast?.('Proforma indirildi', 'success');
    } catch (error) {
      console.error('Proforma oluşturma hatası:', error);
      showToast?.('Proforma oluşturulamadı: ' + error.message, 'error');
    }
  };

  // Proformayı indirir ve müşteriye WhatsApp mesajını açar (wa.me dosya ekleyemez — PDF elle eklenir)
  const sendProformaWhatsApp = async (visa) => {
    const phone = (visa.customerPhone || customers.find(c => c.id === visa.customerId)?.phone || '').replace(/\D/g, '');
    if (!phone) { showToast?.('Müşterinin telefon numarası yok', 'error'); return; }
    await generateProforma(visa);
    const price = visa.visaPrice || visa.price || 0;
    const currency = visa.visaCurrency || visa.currency || '€';
    const msg = `Sayın ${titleCaseTr(visa.customerName || '')},\n\n${visa.country ? visa.country + ' ' : ''}${visa.visaDuration || visa.visaType || 'vize'} hizmet bedeli: ${price} ${currency}\n\nProforma faturanız ekte yer almaktadır.\n\nPaydos Turizm`;
    window.open(waUrl(formatWhatsAppPhone(phone), msg), '_blank');
    showToast?.('Proforma indirildi — WhatsApp\'ta dosyayı ekleyip gönderin', 'info');
  };

  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!findVisaCust(formData.customerId)) {
      showToast?.('Başvuru bir CRM müşterisine bağlı olmalı — listeden müşteri seçin', 'error');
      setTimeout(() => document.getElementById('visa-relink')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }
    if (!formData.visaType && !formData.visaDuration) {
      showToast?.('Vize türü seçiniz', 'error');
      return;
    }
    // Yeni iptal edilen (ya da yeni kayıt iptal durumunda) başvuruda sebep zorunlu; eski sebepsiz kayıtlar başka alan düzenlenirken engellenmez
    if (isCancelStatus(formData.status) && !(formData.cancelReason || '').trim() && !(editingVisa && isCancelStatus(editingVisa.status))) {
      showToast?.('İptal sebebi zorunlu — Başvuru Durumu altındaki kutuya yazın', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingVisa) {
        const oldVisa = visaApplications.find(v => v.id === editingVisa.id);
        const updatedVisa = { ...formData, id: editingVisa.id, _docId: editingVisa._docId };
        const updated = visaApplications.map(v => v.id === editingVisa.id ? updatedVisa : v);
        setVisaApplications(updated);
        addToUndo?.({ type: 'update', undo: () => setVisaApplications(visaApplications.map(v => v.id === editingVisa.id ? oldVisa : v)) });
        // ⚡ Anında Firestore'a yaz (debouncedSave + onSnapshot çakışmasını önle)
        try {
          const docId = editingVisa._docId || String(editingVisa.id);
          const saveData = { ...updatedVisa, updatedAt: new Date().toISOString() };
          delete saveData._docId;
          await setDoc(doc(db, 'visa_applications', docId), saveData, { merge: true });
          showToast?.('Vize başvurusu güncellendi', 'success');
        } catch(e) { console.warn('Vize Firestore yazma hatası:', e.message); showToast?.('⚠️ Sunucuya kaydedilemedi, tekrar denenecek: ' + e.message, 'warning'); }
        logActivity('status', 'Vize', `${formData.customerName || ''} — ${formData.country || ''} ${formData.status || ''}`.trim(), currentUser);
      } else {
        const autoCountry = formData.country || (selectedCategory?.countries?.length === 1 ? selectedCategory.countries[0] : '');
        const newVisa = { ...formData, country: autoCountry, categoryId: selectedCategory?.id || formData.category || 'schengen', id: generateUniqueId(), createdAt: new Date().toISOString() };
        setVisaApplications([...visaApplications, newVisa]);
        // visa_applications'ta silme senkronu yok — geri almada Firestore'dan da sil
        addToUndo?.({ type: 'create', undo: () => { setVisaApplications(prev => prev.filter(v => v.id !== newVisa.id)); deleteDoc(doc(db, 'visa_applications', String(newVisa.id))).catch(e => console.warn('Geri alma silme hatası:', e.message)); } });
        // ⚡ Anında Firestore'a yaz
        try {
          const docId = String(newVisa.id);
          const saveData = { ...newVisa, updatedAt: new Date().toISOString() };
          await setDoc(doc(db, 'visa_applications', docId), saveData, { merge: true });
          showToast?.(`${formData.customerName} için vize başvurusu oluşturuldu`, 'success');
        } catch(e) { console.warn('Vize Firestore yazma hatası:', e.message); showToast?.('⚠️ Sunucuya kaydedilemedi, tekrar denenecek: ' + e.message, 'warning'); }
        logActivity('create', 'Vize', `${formData.customerName || ''} — ${autoCountry} ${formData.visaDuration || ''}`.trim(), currentUser);

        // Evrak maili artık açılışta değil: durum "Atama Bekliyor" olunca sunucu (vizeEvrakMail) gönderir
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
    logActivity('delete', 'Vize', `${visaToDelete.customerName || ''} — ${visaToDelete.country || ''}`.trim(), currentUser);

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
    const customer = findVisaCust(visa.customerId);
    setRelinkQ(customer ? '' : (visa.customerName || '')); // sahipsiz başvuruda seçim kutusu isimle dolu açılır
    // Kategorisi kayıtlı olmayan (eski) başvuru 'Diğer' ile açılır — yoksa form boş sayfa olarak geliyordu, başvuru düzenlenemiyordu
    const cat = getCategoryInfo(visa.category || visa.categoryId);
    setSelectedCustomer(customer);
    setSelectedCategory(cat);
    setFormData(visa);
    setEditingVisa(visa);
    setFormStep('details');
    setShowForm(true);
  };

  // iDATA formu için müşteri bilgilerini hazırla (doğum tarihi gün/ay/yıl'a ayrılır)
  const openIdataInfo = (visa) => {
    const customer = findVisaCust(visa.customerId);
    setIdataInfoModal({ visa, customer: customer || null });
  };
  const TR_AYLAR_IDATA = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const buildIdataFields = (visa, customer) => {
    // İsim/soyisim: müşteriden, yoksa başvurudaki customerName'den böl
    let firstName = customer?.firstName || '';
    let lastName = customer?.lastName || '';
    if (!firstName && !lastName && visa?.customerName) {
      const parts = visa.customerName.trim().split(' ');
      lastName = parts.length > 1 ? parts.pop() : '';
      firstName = parts.join(' ');
    }
    // Doğum tarihi: YYYY-MM-DD → gün/ay/yıl
    const bd = customer?.birthDate || '';
    let gun = '', ay = '', yil = '';
    const m = bd.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) { yil = m[1]; ay = TR_AYLAR_IDATA[parseInt(m[2], 10) - 1] || m[2]; gun = String(parseInt(m[3], 10)); }
    // Pasaport no: müşterinin ilk pasaportu
    let pasaportNo = '';
    try { const ps = safeParseJSON(customer?.passports); if (Array.isArray(ps) && ps.length) pasaportNo = ps[0].passportNo || ''; } catch {}
    // Telefon: başında 0 ve boşluk temizle (iDATA 5xxxxxxxxx ister)
    let tel = (customer?.phone || visa?.customerPhone || '').replace(/\D/g, '');
    if (tel.startsWith('90')) tel = tel.slice(2);
    if (tel.startsWith('0')) tel = tel.slice(1);
    const email = customer?.email || visa?.customerEmail || '';
    return [
      { label: 'İsim', value: firstName },
      { label: 'Soyisim', value: lastName },
      { label: 'Doğum Günü', value: gun },
      { label: 'Doğum Ayı', value: ay },
      { label: 'Doğum Yılı', value: yil },
      { label: 'Pasaport No', value: pasaportNo },
      { label: 'Telefon', value: tel },
      { label: 'Email', value: email }
    ];
  };

  const getStatusColor = (status) => ({
    'Evrak Topluyor': '#f59e0b', 'Evrak Tamamlandı': '#3b82f6', 'Randevu Alındı': '#8b5cf6',
    'Atama Bekliyor': '#a855f7', 'Randevu Bekliyor': '#c084fc',
    'Başvuru Yapıldı': '#6366f1', 'Sonuç Bekliyor': '#14b8a6', 'Onaylandı': '#10b981', 'Reddedildi': '#ef4444'
  }[status] || (() => {
    // Ayarlardan eklenen durumlar için anahtar kelimeye göre renk (hepsi gri kalmasın)
    const t = normalizeTr(status);
    if (/onay/.test(t)) return '#10b981';
    if (/iptal/.test(t)) return '#64748b';
    if (/\bred\b|redd/.test(t)) return '#ef4444';
    if (/konsolos/.test(t)) return '#06b6d4';
    if (/gonderil/.test(t)) return '#3b82f6';
    if (/topluyor|evrak/.test(t)) return '#f59e0b';
    if (/atama|bekliyor/.test(t)) return '#a855f7';
    if (/data|vfs|basvuru/.test(t)) return '#6366f1';
    return '#94a3b8';
  })());

  const getCategoryInfo = (catId) => visaCategories.find(c => c.id === catId) || visaCategories.find(c => c.id === 'other'); // eskiden [5] = Çin idi: kategorisi olmayan başvuru Çin bayrağıyla görünüyordu

  // Takvim renderı
  const renderCalendar = (days, monthName, year) => (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '14px', padding: '18px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <h4 style={{ margin: '0 0 14px', fontSize: '16px', color: '#f59e0b', textAlign: 'center', fontWeight: '700' }}>{monthName} {year}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', fontSize: '13px' }}>
        {['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'].map(d => (
          <div key={d} style={{ textAlign: 'center', color: '#64748b', padding: '8px 4px', fontWeight: '700', fontSize: '12px' }}>{d}</div>
        ))}
        {days.map((d, idx) => {
          const isToday = d.date === today.toISOString().split('T')[0];
          const hasAppointments = d.appointments?.length > 0;
          return (
            <div 
              key={idx} 
              onClick={() => hasAppointments && setDayDetailModal({ date: d.date, appointments: d.appointments })}
              style={{ 
                textAlign: 'center', padding: '10px 4px', borderRadius: '8px', minHeight: '52px',
                background: hasAppointments ? 'rgba(245,158,11,0.2)' : 'transparent',
                border: isToday ? '2px solid #f59e0b' : '1px solid transparent',
                color: d.day ? '#e8f1f8' : 'transparent',
                cursor: hasAppointments ? 'pointer' : 'default',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <span style={{ fontWeight: isToday ? '700' : '500', fontSize: '14px' }}>{d.day || ''}</span>
              {hasAppointments && (() => {
                // Ülkeye göre grupla — bayrak emojisi bazı sistemlerde (Windows) görünmüyor,
                // bu yüzden kısa Türkçe ülke kodu + renk kullanılıyor
                const ulkeKodu = (ulke) => {
                  const u = normalizeTr(ulke); // Türkçe karakter kuralı: desenler ASCII
                  if (/almanya|german/.test(u)) return { k: 'ALM', r: '#334155' };
                  if (/amerika|abd|usa|birlesik devlet/.test(u)) return { k: 'ABD', r: '#1e40af' };
                  if (/italya|itali/.test(u)) return { k: 'İTA', r: '#16a34a' };
                  if (/fransa|franc/.test(u)) return { k: 'FRA', r: '#2563eb' };
                  if (/hollanda|nederland|netherland/.test(u)) return { k: 'HOL', r: '#ea580c' };
                  if (/ingiltere|birlesik krallik|uk|britan/.test(u)) return { k: 'İNG', r: '#1e3a8a' };
                  if (/rusya|russ/.test(u)) return { k: 'RUS', r: '#1d4ed8' };
                  if (/\bcin\b|china/.test(u)) return { k: 'ÇİN', r: '#dc2626' };
                  if (/bae|dubai|emirlik|arap emir/.test(u)) return { k: 'BAE', r: '#166534' };
                  if (/ispanya|spain/.test(u)) return { k: 'İSP', r: '#b91c1c' };
                  if (/yunanistan|greece|greek/.test(u)) return { k: 'YUN', r: '#0284c7' };
                  if (/avusturya|austria/.test(u)) return { k: 'AVU', r: '#b91c1c' };
                  if (/belcika|belgium/.test(u)) return { k: 'BEL', r: '#ca8a04' };
                  if (/cekya|cek|czech/.test(u)) return { k: 'ÇEK', r: '#1e40af' };
                  if (/macaristan|hungar/.test(u)) return { k: 'MAC', r: '#16a34a' };
                  if (/polonya|poland|polska/.test(u)) return { k: 'POL', r: '#dc2626' };
                  if (/portekiz|portugal/.test(u)) return { k: 'POR', r: '#16a34a' };
                  if (/isvicre|switzerland|swiss/.test(u)) return { k: 'İSV', r: '#dc2626' };
                  return { k: 'DİĞ', r: '#64748b' };
                };
                const grup = {};
                d.appointments.forEach(a => {
                  const info = ulkeKodu(extractVisaCountry(a));
                  if (!grup[info.k]) grup[info.k] = { adet: 0, renk: info.r };
                  grup[info.k].adet += 1;
                });
                const girisler = Object.entries(grup);
                return (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', justifyContent: 'center', marginTop: '3px', lineHeight: 1 }}>
                    {girisler.map(([kod, v]) => (
                      <span key={kod} style={{ fontSize: '9px', fontWeight: '800', color: '#fff', background: v.renk, padding: '1px 4px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                        {kod} {v.adet}
                      </span>
                    ))}
                  </span>
                );
              })()}
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
          if (formStep === 'search') {
            // Adım 1'deyse formu kapat
            resetForm();
            setShowForm(false);
          } else if (formStep === 'checklist') {
            // Adım 2'deyse Adım 1'e dön
            setSelectedCustomer(null);
            setChecklist({ passportValid: null, passportCondition: null, addressChecked: null });
            setFormStep('search');
          } else if (formStep === 'category') {
            // Adım 3'teyse Adım 2'ye dön
            setSelectedCategory(null);
            setFormData({});
            setFormStep('checklist');
          } else if (formStep === 'details') {
            // Adım 4'teyse Adım 3'e dön
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
                    <h4 style={{ margin: 0, fontSize: '14px' }}>{fullNameTr(c)}</h4>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>{c.phone} • {c.city || '-'}</p>
                  </div>
                ))}
              </div>
            )}

            {searchQuery.length >= 1 && searchResults.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px' }}>
                <p style={{ color: '#64748b', marginBottom: '16px' }}>Müşteri bulunamadı</p>
                <button onClick={onNavigateToCustomers} style={{ padding: '12px 24px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', color: '#0c1929', fontWeight: '600', cursor: 'pointer' }}>
                  ➕ Yeni Müşteri Ekle
                </button>
              </div>
            )}

            {searchQuery.length < 1 && (
              <p style={{ textAlign: 'center', color: '#64748b', padding: '30px' }}>En az 2 karakter girin</p>
            )}
          </div>
        )}

        {/* ADIM 2: KONTROL LİSTESİ */}
        {formStep === 'checklist' && selectedCustomer && (
          <div>
            <div style={{ background: 'rgba(245,158,11,0.1)', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(245,158,11,0.2)' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#f59e0b' }}>📋 Adım 2/4: Kontrol Listesi</p>
              <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#94a3b8' }}>Müşteri: <CustLink c={selectedCustomer} onOpen={onOpenCustomer}>{selectedCustomer.firstName} {selectedCustomer.lastName}</CustLink></p>
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
              <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#94a3b8' }}>Müşteri: <CustLink c={selectedCustomer} onOpen={onOpenCustomer}>{selectedCustomer?.firstName} {selectedCustomer?.lastName}</CustLink></p>
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
            {/* Üst navigasyon */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
              <button onClick={() => { setShowForm(false); resetForm(); }} style={{ flex: 1, padding: '11px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: '10px', color: '#a78bfa', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                ← Vize Listesine Dön
              </button>
              <button onClick={() => { setShowForm(false); resetForm(); onNavigateHome?.(); }} style={{ flex: 1, padding: '11px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: '#e8f1f8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                🏠 Ana Sayfa
              </button>
            </div>
            <div style={{ background: `rgba(${hexToRgb(selectedCategory.color)},0.1)`, padding: '16px', borderRadius: '12px', marginBottom: '20px', border: `1px solid ${selectedCategory.color}30` }}>
              <p style={{ margin: 0, fontSize: '13px', color: selectedCategory.color }}>{selectedCategory.icon} Adım 4/4: {selectedCategory.label} Vize Detayları</p>
              {(() => {
                const linked = findVisaCust(formData.customerId);
                const q = normalizeTr(relinkQ).trim();
                const qd = relinkQ.replace(/\D/g, '');
                const results = !linked && q.length >= 2 ? (customers || []).filter(c => normalizeTr(`${c.firstName || ''} ${c.lastName || ''}`).includes(q) || (qd.length >= 4 && (String(c.tcKimlik || '').includes(qd) || String(c.phone || '').replace(/\D/g, '').includes(qd)))).slice(0, 8) : [];
                const pick = (c) => {
                  setSelectedCustomer(c);
                  setFormData(f => ({ ...f, customerId: c.id, customerName: `${c.firstName || ''} ${c.lastName || ''}`.trim(), customerPhone: c.phone || '', customerEmail: c.email || '' }));
                  setRelinkQ('');
                };
                return (<>
                  <div id="visa-relink" style={{ margin: '8px 0 0', fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {linked
                      ? <span>Müşteri: <CustLink c={linked} onOpen={onOpenCustomer}>{titleCaseTr(`${linked.firstName || ''} ${linked.lastName || ''}`)}</CustLink>{linked.tcKimlik ? ` · TC ${linked.tcKimlik}` : ''}</span>
                      : <span style={{ color: '#f87171', fontWeight: '700' }}>⚠️ Bu başvuru CRM'deki bir müşteriye bağlı değil{formData.customerName ? ` (${formData.customerName})` : ''} — müşteri seçin</span>}
                  </div>
                  {linked && selectedCategory?.id === 'schengen' && <FingerprintBox c={linked} showToast={showToast} compact />}
                  {/* Müşteri seçimi yalnızca başvuru sahipsizse (bağlı müşteri silinmiş / bulunamıyor) — normal kayıtta değiştirilemez */}
                  {!linked && (
                    <div style={{ marginTop: '10px' }}>
                      <input autoFocus value={relinkQ} onChange={e => setRelinkQ(e.target.value)} placeholder="Ad soyad, TC veya telefon ara..." style={{ width: '100%', padding: '10px 12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' }} />
                      {results.map(c => (
                        <button key={c._docId || c.id} type="button" onClick={() => pick(c)} style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: '6px', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit' }}>
                          <b>{titleCaseTr(`${c.firstName || ''} ${c.lastName || ''}`)}</b> · TC {c.tcKimlik || '—'}{c.tcKimlik && !isValidTc(c.tcKimlik) ? ' ⚠️' : ''} · {c.phone || '—'}{c.birthDate ? ` · ${formatDate(c.birthDate)}` : ''}
                        </button>
                      ))}
                      {q.length >= 2 && !results.length && <div style={{ marginTop: '6px', fontSize: '12px', color: '#64748b' }}>Eşleşen müşteri yok</div>}
                    </div>
                  )}
                  {(() => {
                    const okAt = (x) => x && /^\d{4}-/.test(String(x)) ? formatDate(String(x).slice(0, 10)) : '';
                    const skipTxt = (x) => x === 'kapali-atlandi' ? '⏸ otomatik mail kapalıyken atlandı' : x === 'ilk-kurulum-atlandi' ? '— kurulumdan önceki başvuru' : '';
                    const off = !!formData.autoMailOff;
                    const evrak = off ? '⏸ bu başvuruda kapalı'
                      : okAt(formData.evrakMailAt) ? `✅ gönderildi ${okAt(formData.evrakMailAt)}${formData.evrakMailTo ? ` · ${formData.evrakMailTo}` : ''}`
                      : skipTxt(formData.evrakMailAt) ? skipTxt(formData.evrakMailAt)
                      : formData.evrakMailEpostaYokAt ? '⚠️ e-posta yok — müşteriye e-posta ekleyin'
                      : appSettings?.autoEmailOnVisa === false ? '⏸ ayarlarda kapalı'
                      : formData.status === 'Atama Bekliyor' ? '⏳ sırada (15 dk içinde)' : 'Atama Bekliyor olunca gider';
                    const appt = String(formData.appointmentDate || '').slice(0, 10);
                    const isSch = (formData.categoryId || formData.category || selectedCategory?.id || 'schengen') === 'schengen';
                    const sureli = !isSch ? '— sadece Schengen' : off ? '⏸ bu başvuruda kapalı'
                      : appt && formData.sureliMailFor === appt && okAt(formData.sureliMailAt) ? `✅ gönderildi ${okAt(formData.sureliMailAt)}`
                      : appt && formData.sureliMailFor === appt && skipTxt(formData.sureliMailAt) ? skipTxt(formData.sureliMailAt)
                      : appSettings?.autoSureliMail === false ? '⏸ ayarlarda kapalı'
                      : appt ? '⏳ randevu kaydedilince gider' : 'randevu girilince gider';
                    return (
                      <div style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8', display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span>📧 Evrak maili: {evrak}</span>
                        <span>⏳ Süreli evrak maili: {sureli}</span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', color: off ? '#f87171' : '#94a3b8' }}>
                          <input type="checkbox" checked={off} onChange={e => setFormData(f => ({ ...f, autoMailOff: e.target.checked }))} />
                          Bu başvuruya otomatik mail gönderme
                        </label>
                      </div>
                    );
                  })()}
                </>);
              })()}
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
                            onClick={() => setFormData({ ...formData, visaDuration: name, visaPrice: price, visaCurrency: currency,
                              // Yeni başvuruda tür seçilince o türe özel varsayılan maliyetler gelir; mevcut başvurunun maliyetine dokunulmaz
                              ...(!editingVisa ? { costs: getVisaCostDefaults(appSettings, selectedCategory.id, name) } : {}) })}
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

              {/* Başvuru Tarihi, İşlem Tarihi ve İşlem */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Başvuru Tarihi</label>
                  <input type="date" value={formData.applicationDate || ''} onChange={e => setFormData({...formData, applicationDate: e.target.value})} style={{ width: '100%', padding: '12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#ffffff', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>İleri Tarihte Başvuru <span style={{ color: '#64748b' }}>(boş = normal)</span></label>
                  <input type="date" min={nextBizDay()} value={formData.processDate || ''} onChange={e => setFormData({...formData, processDate: e.target.value})} style={{ width: '100%', padding: '12px', background: '#0d1f33', border: `1px solid ${formData.processDate ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.2)'}`, borderRadius: '8px', color: '#ffffff', fontSize: '14px', boxSizing: 'border-box', colorScheme: 'dark' }} />
                  {formData.processDate && <div style={{ fontSize: '11px', color: '#a855f7', marginTop: '4px' }}>⏳ Vizeci bu başvuruyu {formatDate(formData.processDate)} tarihinde yapacak <button type="button" onClick={() => setFormData({...formData, processDate: ''})} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}>× kaldır</button></div>}
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
                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '-4px' }}>Aşağıda "Müşteri Ödemeleri"ne tutar girince kendiliğinden değişir (tahsilat vize bedelini karşılayınca Ödendi).</div>
              </div>

              {/* MALİ BİLGİLER */}
              {(() => {
                const costs = formData.costs || {};
                const costCurrencies = formData.costCurrencies || {};
                // Kalemler kategori bazlı (Ayarlar → Vize Ayarları → Maliyet Kalemleri)
                const costFields = getVisaCostItems(appSettings, formData.category || selectedCategory?.id);

                const salePrice = parseFloat(formData.visaPrice) || 0;
                const saleCurrency = formData.visaCurrency || '€';
                const discount = parseFloat(formData.visaDiscount) || 0;
                const netSale = salePrice - discount;

                // Tüm kalemler tek para biriminde (formData.costCurrency)
                const costCur = formData.costCurrency || saleCurrency;
                const totalsByCurrency = {};
                costFields.forEach(f => {
                  const amount = parseFloat(costs[f.key]) || 0;
                  if (amount === 0) return;
                  totalsByCurrency[costCur] = (totalsByCurrency[costCur] || 0) + amount;
                });
                // Satışla aynı para birimindeki toplam (kâr/zarar için)
                const totalSameCurrency = totalsByCurrency[saleCurrency] || 0;
                const profit = netSale - totalSameCurrency;
                const margin = netSale > 0 ? (profit / netSale * 100) : 0;

                return (
                  <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '12px', padding: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '13px', color: '#ef4444', fontWeight: '600' }}>💰 Mali Bilgiler (Maliyet Kalemleri)</h4>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>Tüm kalemler için para birimi:</span>
                        <select value={formData.costCurrency || saleCurrency}
                          onChange={e => setFormData({ ...formData, costCurrency: e.target.value })}
                          style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '7px', color: '#fff', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
                          <option value="€" style={{ background: '#0c1929' }}>€</option>
                          <option value="$" style={{ background: '#0c1929' }}>$</option>
                          <option value="£" style={{ background: '#0c1929' }}>£</option>
                          <option value="₺" style={{ background: '#0c1929' }}>₺</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gap: '8px', marginBottom: '12px' }}>
                      {costFields.map(f => (
                        <div key={f.key} style={{ minWidth: 0 }}>
                          <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>{f.label}</label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input type="number" step="0.01" min="0" value={costs[f.key] || ''}
                              onChange={e => setFormData({...formData, costs: {...costs, [f.key]: parseFloat(e.target.value) || 0}})}
                              placeholder="0"
                              style={{ flex: 1, padding: '7px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', color: '#fff', fontSize: '12px', boxSizing: 'border-box', minWidth: 0 }} />
                            <span style={{ fontSize: '12px', color: '#94a3b8', flexShrink: 0 }}>{formData.costCurrency || saleCurrency}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* İNDİRİM */}
                    <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <label style={{ fontSize: '12px', color: '#f59e0b', fontWeight: '600', whiteSpace: 'nowrap' }}>🏷️ İndirim:</label>
                      <input type="number" step="0.01" min="0" value={formData.visaDiscount || ''}
                        onChange={e => setFormData({...formData, visaDiscount: parseFloat(e.target.value) || 0})}
                        placeholder="0"
                        style={{ flex: '1 1 100px', padding: '7px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', color: '#fff', fontSize: '12px', minWidth: 0 }} />
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>{saleCurrency}</span>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                        Satış: <strong style={{ color: '#10b981' }}>{salePrice.toFixed(2)} {saleCurrency}</strong>
                        {' '}→ Net: <strong style={{ color: '#22c55e' }}>{netSale.toFixed(2)} {saleCurrency}</strong>
                      </span>
                    </div>

                    {/* Özet — kâr/zarar hesaplanmaz (farklı para birimleri kur olmadan toplanamaz) */}
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: '10px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ background: 'rgba(239,68,68,0.1)', padding: '10px 12px', borderRadius: '8px' }}>
                        <div style={{ fontSize: '10px', color: '#94a3b8' }}>Toplam Maliyet (para birimine göre)</div>
                        <div style={{ fontSize: '15px', fontWeight: '700', color: '#ef4444' }}>
                          {Object.keys(totalsByCurrency).length === 0
                            ? `0 ${costCur}`
                            : Object.entries(totalsByCurrency).map(([cur, val]) => `${val.toFixed(2)} ${cur}`).join('  ·  ')}
                        </div>
                      </div>
                      <div style={{ background: 'rgba(16,185,129,0.1)', padding: '10px 12px', borderRadius: '8px' }}>
                        <div style={{ fontSize: '10px', color: '#94a3b8' }}>Vize Bedeli (satış)</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <div style={{ fontSize: '15px', fontWeight: '700', color: '#10b981' }}>{netSale.toFixed(2)} {saleCurrency}</div>
                        </div>
                        {/* Kur: vizeci/muhasebeci elle yazar (otomatik kur alınmaz); TL karşılığı = bedel × kur */}
                        {saleCurrency !== '₺' && (() => {
                          const kur = parseFloat(String(formData.visaKur || '').replace(',', '.')) || 0;
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '6px', fontSize: '12px', color: '#94a3b8' }}>
                              <span>Kur: 1 {saleCurrency} =</span>
                              <input type="text" inputMode="decimal" value={formData.visaKur || ''} placeholder="kur"
                                onChange={e => { const fd = { ...formData, visaKur: e.target.value.replace(/[^0-9.,]/g, '') }; setFormData({ ...fd, paymentStatus: visaPaidStatus(fd) }); }}
                                style={{ width: '80px', padding: '5px 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 700, minWidth: 0 }} />
                              <span>₺</span>
                              {kur > 0 && <b style={{ fontSize: '14px', color: '#10b981' }}>→ {(netSale * kur).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺</b>}
                            </div>
                          );
                        })()}
                        {discount > 0 && <div style={{ fontSize: '9px', color: '#f59e0b' }}>(-{discount} indirim)</div>}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* MÜŞTERİ ÖDEMELERİ — manuel giriş, para birimi + tarih */}
              {(() => {
                const odemeler = safeParseJSON(formData.payments);
                // Tahsilat vize bedelini karşılayınca "Ödendi", altında kalınca "Ödenmedi".
                // Vize bedeliyle aynı para birimindeki ödemeler vize bedeline, ₺ ödemeler bedel × elle yazılan kur (visaKur) tutarına göre sayılır.
                const setOdemeler = (list) => setFormData({ ...formData, payments: JSON.stringify(list), paymentStatus: visaPaidStatus({ ...formData, payments: JSON.stringify(list) }) });
                const updateOdeme = (i, patch) => { const l = [...odemeler]; l[i] = { ...l[i], ...patch }; setOdemeler(l); };
                const addOdeme = () => setOdemeler([...odemeler, { id: generateUniqueId(), amount: '', currency: formData.visaCurrency || '€', date: new Date().toISOString().split('T')[0], note: '' }]);
                const delOdeme = (i) => setOdemeler(odemeler.filter((_, x) => x !== i));
                // Para birimi bazlı tahsilat toplamı
                const toplam = {};
                odemeler.forEach(o => { const a = parseFloat(o.amount) || 0; if (!a) return; const c = o.currency || '€'; toplam[c] = (toplam[c] || 0) + a; });

                // Maliyet toplamı (kâr/zarar için) — para birimi bazlı
                const _costs = formData.costs || {};
                const _saleCur = formData.visaCurrency || '€';
                const _costCur = formData.costCurrency || _saleCur;
                const _costItems = getVisaCostItems(appSettings, formData.category || selectedCategory?.id);
                const maliyetPB = {};
                _costItems.forEach(f => { const a = parseFloat(_costs[f.key]) || 0; if (!a) return; maliyetPB[_costCur] = (maliyetPB[_costCur] || 0) + a; });

                return (
                  <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: '12px', padding: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '13px', color: '#10b981', fontWeight: '600' }}>💵 Müşteri Ödemeleri</h4>
                      <button type="button" onClick={addOdeme} style={{ background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: '8px', padding: '6px 12px', color: '#10b981', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>➕ Ödeme Ekle</button>
                    </div>

                    {odemeler.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Henüz ödeme girilmedi. "➕ Ödeme Ekle" ile müşteriden alınan tutarı girin.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {odemeler.map((o, i) => (
                          <div key={o.id || i} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1.1fr 80px 1.2fr 1.1fr 1.4fr 36px', gap: '8px', alignItems: 'center' }}>
                            <input type="number" step="0.01" value={o.amount || ''} onChange={e => updateOdeme(i, { amount: e.target.value })} placeholder="Tutar" style={inputStyle} />
                            <select value={o.currency || '€'} onChange={e => updateOdeme(i, { currency: e.target.value })} style={inputStyle}>
                              <option value="₺">₺</option><option value="€">€</option><option value="$">$</option><option value="£">£</option>
                            </select>
                            <input type="date" value={o.date || ''} onChange={e => updateOdeme(i, { date: e.target.value })} style={inputStyle} />
                            <select value={o.method || ''} onChange={e => updateOdeme(i, { method: e.target.value })} style={{ ...inputStyle, color: o.method ? '#fff' : '#94a3b8' }} title="Ödeme tipi">
                              <option value="">Ödeme tipi…</option>{PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <input type="text" value={o.note || ''} onChange={e => updateOdeme(i, { note: e.target.value })} placeholder="Açıklama" style={inputStyle} />
                            <button type="button" onClick={() => delOdeme(i)} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '13px', padding: '8px' }} title="Sil">🗑️</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tahsilat + gider özeti (kâr/zarar hesaplanmaz) */}
                    {(Object.keys(toplam).length > 0 || Object.keys(maliyetPB).length > 0) && (
                      <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: '10px' }}>
                        <div style={{ background: 'rgba(16,185,129,0.1)', padding: '10px 12px', borderRadius: '8px' }}>
                          <div style={{ fontSize: '10px', color: '#94a3b8' }}>Tahsil Edilen</div>
                          <div style={{ fontSize: '15px', fontWeight: '700', color: '#10b981' }}>
                            {Object.keys(toplam).length === 0 ? '0' : Object.entries(toplam).map(([c, v]) => `${v.toFixed(2)} ${c}`).join('  ·  ')}
                          </div>
                        </div>
                        <div style={{ background: 'rgba(239,68,68,0.1)', padding: '10px 12px', borderRadius: '8px' }}>
                          <div style={{ fontSize: '10px', color: '#94a3b8' }}>Toplam Gider</div>
                          <div style={{ fontSize: '15px', fontWeight: '700', color: '#ef4444' }}>
                            {Object.keys(maliyetPB).length === 0 ? '0' : Object.entries(maliyetPB).map(([c, v]) => `${v.toFixed(2)} ${c}`).join('  ·  ')}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Durum - Butonlar - Dinamik */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Başvuru Durumu</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {(appSettings?.visaStatuses || ['Evrak Topluyor', 'Evrak Tamamlandı', 'Randevu Alındı', 'Başvuru Yapıldı', 'Sonuç Bekliyor', 'Onaylandı', 'Reddedildi', 'Ödenmedi']).map(s => (
                    <button key={s} type="button" onClick={() => {
                      if (isCancelStatus(s) && !isCancelStatus(formData.status)) {
                        const r = askCancelReason(formData.customerName, formData.cancelReason);
                        if (!r) { if (r !== null) showToast?.('İptal sebebi girmeden durum değiştirilemez', 'warning'); return; }
                        setFormData({ ...formData, status: s, cancelReason: r, cancelledAt: new Date().toISOString() });
                        return;
                      }
                      setFormData({ ...formData, status: s });
                    }} style={{ padding: '8px 12px', background: formData.status === s ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.05)', border: formData.status === s ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: formData.status === s ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '11px', fontWeight: formData.status === s ? '600' : '400' }}>
                      {s}
                    </button>
                  ))}
                </div>
                {isCancelStatus(formData.status) && (
                  <div style={{ marginTop: '10px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#f87171', marginBottom: '6px' }}>İptal sebebi *</label>
                    <input value={formData.cancelReason || ''} onChange={e => setFormData({ ...formData, cancelReason: e.target.value })} placeholder="Ör. seyahatten vazgeçti, fiyatı yüksek buldu, başka acenteye gitti…" style={{ ...inputStyle, borderColor: (formData.cancelReason || '').trim() ? 'rgba(255,255,255,0.15)' : 'rgba(239,68,68,0.6)' }} />
                  </div>
                )}
              </div>

              {/* Notlar */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Notlar</label>
                <textarea value={formData.notes || ''} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="Ek notlar..." style={{ width: '100%', padding: '12px', background: '#0d1f33', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#ffffff', fontSize: '14px', minHeight: '80px', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>

              {/* İşlemler — tek kart, eşit butonlar */}
              {(() => {
                const act = (c) => ({ flex: '1 1 160px', padding: '10px 12px', background: `${c}14`, border: `1px solid ${c}40`, borderRadius: '9px', color: c, cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' });
                const head = { fontSize: '11px', color: '#64748b', fontWeight: '600', letterSpacing: '0.3px', margin: '0 0 8px' };
                return (
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '14px' }}>
                    <div style={head}>İLETİŞİM</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      <button type="button" onClick={() => { const phone = formData.customerPhone?.replace(/\D/g, ''); if (phone) window.open(`https://wa.me/${formatWhatsAppPhone(phone)}`, '_blank'); }} style={act('#25d366')}>💬 WhatsApp</button>
                      {formData.appointmentDate && <button type="button" onClick={() => {
                  const linked = customers?.find(c => c.id === formData.customerId || c._docId === formData.customerId);
                  const rawPhone = formData.customerPhone || linked?.phone || '';
                  if (!rawPhone) { alert('Telefon numarası bulunamadı!'); return; }
                  let message = appSettings?.whatsappTemplate || 'Randevu: {tarih} {saat}';
                  message = message.replace('{isim}', titleCaseTr(formData.customerName || '')).replace('{ulke}', formData.country || '').replace('{tarih}', formatDate(formData.appointmentDate) || '').replace('{saat}', formData.appointmentTime || '-').replace('{pnr}', formData.pnr || '-');
                  const phone = rawPhone.replace(/\D/g, '');
                  const fullPhone = formatWhatsAppPhone(phone);
                  window.open(waUrl(fullPhone, message), '_blank');
                }} style={act('#25d366')}>📱 Randevu Bilgisi (WA)</button>}
                      <button type="button" onClick={() => { if (formData.customerEmail) window.open(`mailto:${formData.customerEmail}`, '_blank'); else alert('E-posta adresi bulunamadı'); }} style={act('#60a5fa')}>📧 E-posta</button>
                      <button type="button" onClick={async () => {
                  if (!formData.customerEmail) { showToast?.('Müşterinin e-posta adresi yok', 'error'); return; }
                  const visa = {
                    id: editingVisa?.id || Date.now().toString(),
                    categoryId: selectedCategory?.id || 'schengen',
                    country: formData.country || (selectedCategory?.countries?.length === 1 ? selectedCategory.countries[0] : ''),
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
                }} style={act('#14b8a6')}>📨 Bilgi Maili</button>
                    </div>
                    {editingVisa && (<>
                      <div style={{ ...head, marginTop: '14px' }}>BELGELER</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        <button type="button" onClick={() => openIdataInfo(editingVisa)} style={act('#a78bfa')}>📋 iDATA Bilgileri</button>
                        <button type="button" onClick={() => generateProforma(formData)} style={act('#f59e0b')}>📄 Proforma İndir</button>
                        <button type="button" onClick={() => sendProformaWhatsApp(formData)} style={act('#25d366')}>💬 Proforma Gönder</button>
                      </div>
                    </>)}
                  </div>
                );
              })()}
            </div>

            <LoadingButton 
              onClick={handleSubmit} 
              loading={saving}
              style={{ width: '100%', marginTop: '18px', padding: '15px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}
            >
              {editingVisa ? '💾 Değişiklikleri Kaydet' : '✅ Başvuruyu Kaydet'}
            </LoadingButton>

            {editingVisa && (
              <div style={{ textAlign: 'center', marginTop: '14px' }}>
                <button type="button" onClick={async () => {
                  if (!window.confirm(`"${formData.customerName}" vize başvurusunu silmek istediğinize emin misiniz?`)) return;
                  await deleteVisa(editingVisa.id);
                  setShowForm(false);
                  setEditingVisa(null);
                }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline', opacity: 0.8, fontFamily: 'inherit' }}>🗑️ Başvuruyu sil</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ padding: isMobile ? '16px' : '24px' }}>
      {bulkVisa && (() => {
        const bv = bulkVisa;
        const types = bv.cat ? (appSettings?.visaDurations?.[bv.cat.id] || []).map(d => typeof d === 'string' ? { name: d, price: 0, currency: '€' } : { name: d.name, price: d.price || 0, currency: d.currency || '€' }) : [];
        const country = bv.country || (bv.type ? bulkCountryFor(bv.cat, bv.type.name) : '');
        const n = bv.custs.length - bv.skip.length;
        const chip = (on, color) => ({ padding: '8px 12px', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', border: `1px solid ${on ? color : 'rgba(255,255,255,0.12)'}`, background: on ? `${color}26` : 'rgba(255,255,255,0.04)', color: on ? color : '#e8f1f8', fontWeight: on ? 700 : 500 });
        return (
          <div onClick={() => !bv.busy && setBulkVisa(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#0f2744', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '16px', width: '100%', maxWidth: '560px', maxHeight: '92vh', overflowY: 'auto', padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <h3 style={{ margin: 0, fontSize: '17px' }}>📑 Toplu vize başvurusu</h3>
                <button onClick={() => setBulkVisa(null)} disabled={bv.busy} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }}>✕</button>
              </div>
              <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#94a3b8' }}>Herkese aynı türde başvuru açılır. Randevu, PNR ve kişiye özel bilgileri sonra tek tek girersiniz.</p>

              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>1 · Kategori</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                {visaCategories.map(c => <button key={c.id} onClick={() => setBulkVisa({ ...bv, cat: c, type: null, country: '' })} style={chip(bv.cat?.id === c.id, c.color)}>{c.icon} {c.label}</button>)}
              </div>

              {bv.cat && (<>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>2 · Vize türü</div>
                {types.length === 0
                  ? <p style={{ fontSize: '12px', color: '#f59e0b', margin: '0 0 14px' }}>⚠️ Bu kategoride vize türü yok — Ayarlar → Vize Türleri'nden ekleyin.</p>
                  : <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '6px', marginBottom: '14px' }}>
                      {types.map(t => <button key={t.name} onClick={() => setBulkVisa({ ...bv, type: t, country: '' })} style={{ ...chip(bv.type?.name === t.name, bv.cat.color), textAlign: 'left' }}>{t.name}{t.price > 0 && <span style={{ opacity: 0.7, fontSize: '11px' }}> · {t.price} {t.currency}</span>}</button>)}
                    </div>}
              </>)}

              {bv.type && bv.cat.countries.length > 1 && (<>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>3 · Ülke</div>
                <select value={country} onChange={e => setBulkVisa({ ...bv, country: e.target.value })} style={{ ...selectStyle, marginBottom: '14px' }}>
                  <option value="">Seçin…</option>
                  {bv.cat.countries.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </>)}

              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Kişiler ({n}/{bv.custs.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' }}>
                {bv.custs.map(c => {
                  const open = openVisaOf(c, country);
                  const on = !bv.skip.includes(c.id);
                  return (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', fontSize: '13px', opacity: on ? 1 : 0.55 }}>
                      <input type="checkbox" checked={on} onChange={() => setBulkVisa({ ...bv, skip: on ? [...bv.skip, c.id] : bv.skip.filter(x => x !== c.id) })} style={{ width: '17px', height: '17px', accentColor: '#f59e0b' }} />
                      <span style={{ flex: 1 }}>{fullNameTr(c)}</span>
                      {open && <span title={`${open.country || ''} ${open.visaDuration || ''} · ${open.status || ''}`} style={{ fontSize: '11px', color: '#f59e0b' }}>⚠️ açık başvuru var ({open.status || '—'})</span>}
                    </label>
                  );
                })}
              </div>

              <button onClick={createBulkVisas} disabled={bv.busy || !bv.type || !n || (bv.cat.countries.length > 1 && !country)}
                style={{ width: '100%', padding: '12px', borderRadius: '12px', border: 'none', fontWeight: 700, fontSize: '14px', cursor: 'pointer', color: '#0c1929',
                  background: (bv.type && n && (bv.cat.countries.length === 1 || country)) ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(255,255,255,0.1)' }}>
                {bv.busy ? '⏳ Açılıyor…' : !bv.type ? 'Kategori ve vize türü seçin' : (bv.cat.countries.length > 1 && !country) ? 'Ülke seçin' : `${n} başvuru aç — ${country || bv.cat.label} · ${bv.type.name}`}
              </button>
            </div>
          </div>
        );
      })()}
      {/* YAKLAŞAN RANDEVU UYARISI — dikkat çekici, açılışta üstte */}
      {upcomingReminders.length > 0 && (() => {
        const acil = upcomingReminders.filter(v => { const d = getDaysLeft(v.appointmentDate); return d !== null && d <= 2; });
        const gunEtiket = (d) => d === 0 ? 'BUGÜN' : d === 1 ? 'YARIN' : `${d} gün`;
        return (
          <div style={{
            marginBottom: '18px',
            background: acil.length > 0 ? 'linear-gradient(135deg, rgba(239,68,68,0.18), rgba(220,38,38,0.10))' : 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(217,119,6,0.08))',
            border: acil.length > 0 ? '1.5px solid rgba(239,68,68,0.5)' : '1.5px solid rgba(245,158,11,0.45)',
            borderRadius: '14px', padding: isMobile ? '14px' : '16px 20px',
            boxShadow: acil.length > 0 ? '0 4px 24px rgba(239,68,68,0.2)' : '0 4px 20px rgba(245,158,11,0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '22px' }}>{acil.length > 0 ? '🚨' : '⏰'}</span>
              <span style={{ fontSize: isMobile ? '15px' : '17px', fontWeight: '800', color: acil.length > 0 ? '#ef4444' : '#f59e0b' }}>
                Yaklaşan Randevular ({upcomingReminders.length})
              </span>
              {acil.length > 0 && <span style={{ fontSize: '11px', background: '#ef4444', color: '#fff', padding: '3px 10px', borderRadius: '12px', fontWeight: '700' }}>{acil.length} ACİL</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
              {upcomingReminders.map(v => {
                const d = getDaysLeft(v.appointmentDate);
                const kirmizi = d <= 2;
                return (
                  <div key={v.id} onClick={() => openEditVisa(v)} style={{
                    background: 'rgba(0,0,0,0.2)', borderRadius: '10px', padding: '10px 12px', cursor: 'pointer',
                    border: kirmizi ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(245,158,11,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px'
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#e8f1f8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titleCaseTr(v.customerName)}{!findVisaCust(v.customerId) && <span title="CRM müşterisine bağlı değil — başvuruyu açıp müşteri seçin" style={{ color: '#f87171', marginLeft: '4px' }}>⚠️</span>}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>{extractVisaCountry(v)} · {formatDate(v.appointmentDate)}{v.appointmentTime ? ` ${v.appointmentTime}` : ''}</div>
                    </div>
                    <span style={{
                      flexShrink: 0, fontSize: '12px', fontWeight: '800', padding: '4px 10px', borderRadius: '8px', whiteSpace: 'nowrap',
                      background: kirmizi ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.2)',
                      color: kirmizi ? '#ef4444' : '#f59e0b'
                    }}>{gunEtiket(d)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '20px', margin: 0 }}>🌍 Vize Başvuruları ({visaApplications.length})</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {setAppSettings && (() => {
            const a1 = appSettings?.autoEmailOnVisa !== false, a2 = appSettings?.autoSureliMail !== false;
            const on = a1 || a2;
            return (
              <button type="button" title={`Atama Bekliyor maili: ${a1 ? 'açık' : 'kapalı'} · Süreli evrak maili: ${a2 ? 'açık' : 'kapalı'}\nTıkla: ${on ? 'ikisini de kapat' : 'ikisini de aç'} (ayrı ayrı: Ayarlar → Mail)`}
                onClick={() => { if (on && !window.confirm('Otomatik evrak mailleri kapatılsın mı?\n\nKapalıyken Atama Bekliyor olan / randevusu girilen başvurulara mail gitmez; tekrar açınca da geriye dönük gitmez.')) return; setAppSettings({ ...appSettings, autoEmailOnVisa: !on, autoSureliMail: !on }); showToast?.(on ? '⏸ Otomatik evrak mailleri kapatıldı' : '📧 Otomatik evrak mailleri açıldı', on ? 'warning' : 'success'); }}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: on ? 'rgba(20,184,166,0.12)' : 'rgba(239,68,68,0.12)', border: `1px solid ${on ? 'rgba(20,184,166,0.4)' : 'rgba(239,68,68,0.4)'}`, borderRadius: '10px', color: on ? '#2dd4bf' : '#f87171', cursor: 'pointer', fontSize: '12px', fontWeight: '600', fontFamily: 'inherit' }}>
                <span style={{ width: '30px', height: '16px', borderRadius: '8px', background: on ? '#14b8a6' : 'rgba(255,255,255,0.15)', position: 'relative', flexShrink: 0 }}><span style={{ position: 'absolute', top: '2px', left: on ? '16px' : '2px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} /></span>
                📧 Otomatik mail: {on ? (a1 && a2 ? 'Açık' : 'Kısmen açık') : 'Kapalı'}
              </button>
            );
          })()}
          <button onClick={() => { setShowIdataModal(true); setIdataText(''); setIdataParsed([]); }} style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: '10px', padding: '10px 16px', color: '#a78bfa', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>📧 iDATA Randevu İşle</button>
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
            placeholder="🔍 Müşteri adı, telefon, ülke, PNR veya etiket ile ara..."
            style={{ width: '100%', padding: '12px 16px', paddingRight: visaSearchQuery ? '40px' : '16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }}
          />
          {visaSearchQuery && (
            <button onClick={() => setVisaSearchQuery('')} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '18px' }}>×</button>
          )}
        </div>
        {visaSearchQuery.length >= 1 && (
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
        {/* Ülke filtresi — her görünümde. Önce categoryId, sonra country, sonra visaDuration metninden çözülür */}
        {(() => {
          const countries = [...new Set(visaApplications.map(extractVisaCountry).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr'));
          return (
            <select value={visaCountryFilter} onChange={e => setVisaCountryFilter(e.target.value)}
              style={{ padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', border: '1px solid rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.15)', color: '#a78bfa', outline: 'none', minWidth: '150px', appearance: 'auto' }}>
              <option value="all" style={{ background: '#0c1929', color: '#fff' }}>🌍 Tüm Ülkeler</option>
              {countries.map(c => {
                const count = visaApplications.filter(v => extractVisaCountry(v) === c).length;
                return <option key={c} value={c} style={{ background: '#0c1929', color: '#fff' }}>{c} ({count})</option>;
              })}
            </select>
          );
        })()}
        {/* Sıralama */}
        <select value={visaSort} onChange={e => setVisaSort(e.target.value)}
          style={{ padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', border: '1px solid rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.15)', color: '#10b981', outline: 'none', minWidth: '190px', appearance: 'auto' }}>
          <option value="appointmentDesc" style={{ background: '#0c1929', color: '#fff' }}>🗓 Randevu — yeni → eski</option>
          <option value="appointmentAsc" style={{ background: '#0c1929', color: '#fff' }}>🗓 Randevu — eski → yeni</option>
          <option value="applicationDesc" style={{ background: '#0c1929', color: '#fff' }}>📝 Başvuru — yeni → eski</option>
          <option value="applicationAsc" style={{ background: '#0c1929', color: '#fff' }}>📝 Başvuru — eski → yeni</option>
          <option value="nameAsc" style={{ background: '#0c1929', color: '#fff' }}>🔤 İsme göre (A-Z)</option>
        </select>
      </div>

      {/* Durum filtresi: tek bakışta görünen renkli etiketler (önceden açılır menü içindeydi).
          Sayılar seçili ülke filtresine göre; seçili etikete tekrar tıklamak "Tümü"ne döner. */}
      {(() => {
        const base = visaCountryFilter === 'all' ? visaApplications : visaApplications.filter(v => extractVisaCountry(v) === visaCountryFilter);
        const chips = [
          { key: 'all', label: '📋 Tümü', count: base.length, color: '#3b82f6' },
          { key: '__ileri__', label: '⏳ İleri tarihli', count: base.filter(v => !!visaFutureDate(v)).length, color: '#a855f7' },
          ...visaStatuses.map(st => ({ key: st, label: st, count: base.filter(v => v.status === st && !visaFutureDate(v)).length, color: getStatusColor(st) })),
          { key: '__odenmedi__', label: '💸 Ödenmedi', count: base.filter(v => !v.paymentStatus || v.paymentStatus === 'Ödenmedi').length, color: '#ef4444' },
        ];
        const current = activeTab === 'all' ? visaStatusFilter : null;
        return (
          <div style={{ display: 'flex', gap: '6px', flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', padding: '2px 0 12px', marginBottom: '4px', WebkitOverflowScrolling: 'touch' }}>
            {chips.map(c => {
              const active = current === c.key;
              return (
                <button key={c.key}
                  onClick={() => { setActiveTab('all'); setVisaStatusFilter(active && c.key !== 'all' ? 'all' : c.key); }}
                  style={{
                    flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '6px 10px 6px 12px', borderRadius: '999px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                    border: `1px solid ${active ? c.color : c.color + '40'}`,
                    background: active ? c.color : c.color + '14',
                    color: active ? '#fff' : c.color,
                    opacity: c.count === 0 && !active ? 0.45 : 1,
                    whiteSpace: 'nowrap'
                  }}>
                  {c.label}
                  <span style={{ minWidth: '20px', padding: '1px 6px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, textAlign: 'center',
                    background: active ? 'rgba(255,255,255,0.25)' : c.color + '26', color: active ? '#fff' : c.color }}>{c.count}</span>
                </button>
              );
            })}
          </div>
        );
      })()}

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
                <div key={v.id} onClick={() => openEditVisa(v)} style={{ background: daysLeft <= 3 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.1)', padding: '14px', borderRadius: '10px', border: daysLeft <= 3 ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(245,158,11,0.2)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px' }}>{cat.icon} {titleCaseTr(v.customerName)}{!findVisaCust(v.customerId) && <span title="CRM müşterisine bağlı değil — başvuruyu açıp müşteri seçin" style={{ color: '#f87171', marginLeft: '4px' }}>⚠️</span>}</h4>
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
          {/* Toplu seçim çubuğu */}
          {filteredVisaApplications.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: selectMode ? '10px 12px' : 0, borderRadius: '10px', background: selectMode ? 'rgba(59,130,246,0.1)' : 'transparent', border: selectMode ? '1px solid rgba(59,130,246,0.3)' : 'none', position: selectMode ? 'sticky' : 'static', top: isMobile ? '60px' : '8px', zIndex: 5, backdropFilter: selectMode ? 'blur(8px)' : 'none' }}>
              {!selectMode ? (
                <button onClick={() => setSelectMode(true)} style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>☑️ Seç</button>
              ) : (() => {
                const visibleIds = filteredVisaApplications.map(v => v.id);
                const allOn = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));
                const btn = (bg, col) => ({ padding: '7px 12px', borderRadius: '8px', border: 'none', background: bg, color: col, cursor: bulkBusy ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 700, opacity: selectedIds.length ? 1 : 0.5 });
                return (<>
                  <button onClick={() => setSelectedIds(allOn ? selectedIds.filter(id => !visibleIds.includes(id)) : [...new Set([...selectedIds, ...visibleIds])])} style={{ ...btn('rgba(255,255,255,0.1)', '#e8f1f8'), opacity: 1 }}>
                    {allOn ? '☐ Seçimi kaldır' : `☑️ Tümünü seç (${visibleIds.length})`}
                  </button>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#93c5fd' }}>{selectedIds.length} seçili</span>
                  <div style={{ flex: 1 }} />
                  <button disabled={!selectedIds.length || bulkBusy} onClick={() => bulkUpdateVisas({ paymentStatus: 'Ödendi' }, 'Ödendi')} style={btn('#10b981', '#fff')}>💰 Ödendi</button>
                  <button disabled={!selectedIds.length || bulkBusy} onClick={() => bulkUpdateVisas({ paymentStatus: 'Ödenmedi' }, 'Ödenmedi')} style={btn('rgba(239,68,68,0.2)', '#ef4444')}>Ödenmedi</button>
                  <select disabled={!selectedIds.length || bulkBusy} value="" onChange={e => { if (e.target.value) bulkUpdateVisas({ status: e.target.value }, e.target.value); }} style={{ ...btn('rgba(255,255,255,0.08)', '#e8f1f8'), border: '1px solid rgba(255,255,255,0.15)' }}>
                    <option value="" style={{ background: '#0c1929' }}>Durum değiştir…</option>
                    {visaStatuses.map(st => <option key={st} value={st} style={{ background: '#0c1929' }}>{st}</option>)}
                  </select>
                  <label style={{ ...btn('rgba(168,85,247,0.15)', '#c084fc'), display: 'inline-flex', alignItems: 'center', gap: '6px', border: '1px solid rgba(168,85,247,0.35)', opacity: !selectedIds.length || bulkBusy ? 0.5 : 1 }}>⏳ İleri tarih
                    <input type="date" disabled={!selectedIds.length || bulkBusy} value="" onChange={e => { if (e.target.value) bulkUpdateVisas({ processDate: e.target.value }, `İleri tarih ${formatDate(e.target.value)}`); }} style={{ background: 'transparent', border: 'none', color: '#c084fc', colorScheme: 'dark', fontSize: '12px', width: '120px' }} />
                  </label>
                  <button onClick={exitSelectMode} style={{ ...btn('transparent', '#94a3b8'), opacity: 1 }}>✕ Kapat</button>
                </>);
              })()}
            </div>
          )}
          {filteredVisaApplications.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>{visaSearchQuery ? 'Sonuç bulunamadı' : 'Henüz başvuru yok'}</p>
          ) : (
            filteredVisaApplications.map(v => {
              const cat = getCategoryInfo(v.category);
              return (
                <div key={v.id} onClick={() => selectMode ? toggleSelected(v.id) : openEditVisa(v)} style={{ background: selectMode && selectedIds.includes(v.id) ? 'rgba(59,130,246,0.14)' : 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '10px', border: selectMode && selectedIds.includes(v.id) ? '1px solid rgba(59,130,246,0.5)' : '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '10px' }}>
                    {selectMode && (
                      <span style={{ flexShrink: 0, width: '22px', height: '22px', marginTop: '1px', borderRadius: '6px', border: selectedIds.includes(v.id) ? 'none' : '2px solid rgba(255,255,255,0.3)', background: selectedIds.includes(v.id) ? '#3b82f6' : 'transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700 }}>{selectedIds.includes(v.id) ? '✓' : ''}</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{ margin: 0, fontSize: '14px' }}>{cat.icon} {titleCaseTr(v.customerName)}{!findVisaCust(v.customerId) && <span title="CRM müşterisine bağlı değil — başvuruyu açıp müşteri seçin" style={{ color: '#f87171', marginLeft: '4px' }}>⚠️</span>}</h4>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>{v.country} - {v.visaType} {v.visaDuration && `(${v.visaDuration})`}</p>
                      {v.appointmentDate && <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#64748b' }}>📅 {formatDate(v.appointmentDate)} {v.pnr && `• PNR: ${v.pnr}`}</p>}
                      {visaFutureDate(v) && (
                        <span style={{ display: 'inline-block', marginTop: '6px', fontSize: '11px', padding: '3px 8px', borderRadius: '6px', fontWeight: 700, background: 'rgba(168,85,247,0.15)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.35)' }}>
                          ⏳ Başvuru {formatDate(v.processDate)} tarihinde yapılacak · {getDaysLeft(v.processDate)} gün
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      <span style={{ fontSize: '10px', padding: '4px 8px', borderRadius: '6px', background: `${getStatusColor(v.status)}20`, color: getStatusColor(v.status) }}>{v.status}</span>
                      {isCancelStatus(v.status) && v.cancelReason && <span title={v.cancelReason} style={{ fontSize: '10px', color: '#94a3b8', maxWidth: '150px', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Sebep: {v.cancelReason}</span>}
                      {v.paymentStatus && <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: v.paymentStatus === 'Ödendi' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: v.paymentStatus === 'Ödendi' ? '#10b981' : '#ef4444' }}>{v.paymentStatus}</span>}
                      {(v.categoryId || v.category) === 'schengen' && (() => { const fp = fingerprintStatus(findVisaCust(v.customerId)); if (fp.state === 'unknown') return null;
                        const [t, col] = fp.state === 'valid' ? [`🖐️ PI ✓ ${formatDate(fp.until).slice(3)}`, fp.daysLeft < 183 ? '#f59e0b' : '#10b981'] : fp.state === 'expired' ? ['🖐️ PI doldu', '#ef4444'] : fp.state === 'none' ? ['🖐️ PI yok', '#ef4444'] : ['🖐️ PI var', '#f59e0b'];
                        return <span title={`Parmak izi${fp.date ? ` · verildi ${formatDate(fp.date)} · son geçerlilik ${formatDate(fp.until)}` : ''}`} style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: `${col}22`, color: col }}>{t}</span>; })()}
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
      {/* iDATA HAZIR BİLGİ MODAL (kopyala) */}
      {idataInfoModal && (() => {
        const fields = buildIdataFields(idataInfoModal.visa, idataInfoModal.customer);
        const eksik = fields.filter(f => !f.value).map(f => f.label);
        const copyVal = (val, label) => {
          if (!val) { showToast?.(`${label} boş`, 'warning'); return; }
          navigator.clipboard?.writeText(val).then(() => showToast?.(`${label} kopyalandı`, 'success')).catch(() => showToast?.('Kopyalanamadı', 'error'));
        };
        const copyAll = () => {
          const txt = fields.map(f => `${f.label}: ${f.value || '-'}`).join('\n');
          navigator.clipboard?.writeText(txt).then(() => showToast?.('Tümü kopyalandı', 'success')).catch(() => showToast?.('Kopyalanamadı', 'error'));
        };
        return (
          <div onClick={() => setIdataInfoModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 450, padding: '20px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', maxWidth: '480px', width: '100%', maxHeight: '88vh', overflow: 'auto', border: '1px solid rgba(139,92,246,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', color: '#a78bfa' }}>📋 iDATA Bilgileri</h3>
                <button onClick={() => setIdataInfoModal(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '22px', cursor: 'pointer' }}>×</button>
              </div>
              <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>{idataInfoModal.visa?.customerName} — her alanı kopyalayıp iDATA formuna yapıştırın</p>
              {eksik.length > 0 && <div style={{ margin: '0 0 12px', padding: '8px 12px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', fontSize: '11px', color: '#f59e0b' }}>⚠️ Eksik: {eksik.join(', ')} — müşteri kartından tamamlayın</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {fields.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '2px' }}>{f.label}</div>
                      <div style={{ fontSize: '14px', color: f.value ? '#e8f1f8' : '#475569', fontWeight: '600', wordBreak: 'break-all' }}>{f.value || '(boş)'}</div>
                    </div>
                    <button onClick={() => copyVal(f.value, f.label)} style={{ flexShrink: 0, padding: '8px 14px', background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: '8px', color: '#a78bfa', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>📋 Kopyala</button>
                  </div>
                ))}
              </div>
              <button onClick={copyAll} style={{ width: '100%', marginTop: '14px', padding: '12px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: '10px', color: '#10b981', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>📋 Tümünü Kopyala</button>
            </div>
          </div>
        );
      })()}

      {/* iDATA RANDEVU İŞLE MODAL */}
      {showIdataModal && (
        <div onClick={() => setShowIdataModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', maxWidth: '720px', width: '100%', maxHeight: '88vh', overflow: 'auto', border: '1px solid rgba(139,92,246,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', color: '#a78bfa' }}>📧 iDATA Randevu Maili İşle</h3>
              <button onClick={() => setShowIdataModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '22px', cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>
              iDATA mailindeki <strong>tabloyu</strong> (AD SOYAD / PNR / ... satırlarını) kopyalayıp aşağıya yapıştır. Sistem isimleri mevcut başvurularla eşleştirip PNR'leri otomatik işler.
            </p>

            <textarea
              value={idataText}
              onChange={e => { setIdataText(e.target.value); parseIdataText(e.target.value); }}
              placeholder={"Mail tablosunu buraya yapıştırın...\n\nÖrnek:\nSEDA GUCLU AGAC\tSDPYKATUGMF\tAlmanya - Ticari\tİzmir Ofis\tSTANDART\tAtama Bekliyor"}
              style={{ width: '100%', minHeight: '120px', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', color: '#e8f1f8', fontSize: '12px', fontFamily: 'monospace', boxSizing: 'border-box', resize: 'vertical' }}
            />

            {idataParsed.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '10px', fontWeight: '600' }}>
                  {idataParsed.length} kayıt bulundu — {idataParsed.filter(r => r.matchedVisa).length} eşleşti
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto' }}>
                  {idataParsed.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: r.matchedVisa ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${r.matchedVisa ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`, borderRadius: '8px', fontSize: '12px' }}>
                      <span style={{ fontSize: '16px' }}>{r.matchedVisa ? '✅' : '❓'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: '600', color: '#e8f1f8' }}>{r.name}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                          <span style={{ color: '#a78bfa', fontWeight: '600' }}>{r.pnr}</span>
                          {r.appointmentStatus && ` · ${r.appointmentStatus}`}
                          {r.office && ` · ${r.office}`}
                          {r.appointmentDate && <span style={{ color: '#22d3ee' }}> · 📅 {formatDate(r.appointmentDate)}{r.appointmentTime ? ` ${r.appointmentTime}` : ''}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '11px' }}>
                        {r.matchedVisa ? (
                          <span style={{ color: '#10b981' }}>→ {r.matchedVisa.customerName} <span style={{ color: '#64748b' }}>(%{r.matchScore})</span></span>
                        ) : (
                          <span style={{ color: '#ef4444' }}>Eşleşme yok</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button onClick={() => setShowIdataModal(false)} style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>İptal</button>
                  <button onClick={applyIdataMatches} disabled={idataParsed.filter(r => r.matchedVisa).length === 0} style={{ flex: 2, padding: '12px', background: idataParsed.filter(r => r.matchedVisa).length > 0 ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)' : 'rgba(100,116,139,0.3)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '700', cursor: idataParsed.filter(r => r.matchedVisa).length > 0 ? 'pointer' : 'default', fontSize: '13px' }}>
                    ✅ {idataParsed.filter(r => r.matchedVisa).length} Başvuruya PNR İşle
                  </button>
                </div>
                {idataParsed.some(r => !r.matchedVisa) && (
                  <p style={{ margin: '10px 0 0', fontSize: '11px', color: '#fbbf24' }}>
                    ⚠️ Eşleşmeyen kayıtlar işlenmez. Önce o müşteriler için vize başvurusu oluşturulmalı.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {dayDetailModal && (
        <div onClick={() => setDayDetailModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '20px', maxWidth: '400px', width: '100%', maxHeight: '80vh', overflow: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>📅 {formatDate(dayDetailModal.date)}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {dayDetailModal.appointments.map(v => {
                const cat = getCategoryInfo(v.category);
                return (
                  <div key={v.id} onClick={() => { setDayDetailModal(null); openEditVisa(v); }} style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '10px', cursor: 'pointer' }}>
                    <h4 style={{ margin: 0, fontSize: '14px' }}>{cat.icon} {titleCaseTr(v.customerName)}{!findVisaCust(v.customerId) && <span title="CRM müşterisine bağlı değil — başvuruyu açıp müşteri seçin" style={{ color: '#f87171', marginLeft: '4px' }}>⚠️</span>}</h4>
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
              {visaFutureDate(selectedVisa) && (
                <div style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.45)', padding: '10px 12px', borderRadius: '8px', color: '#c084fc', fontWeight: 700, fontSize: '13px' }}>
                  ⏳ İleri tarihli — başvuru {formatDate(selectedVisa.processDate)} tarihinde yapılacak ({getDaysLeft(selectedVisa.processDate)} gün). O güne kadar başvuru yapmayın.
                </div>
              )}
              {isCancelStatus(selectedVisa.status) && (
                <div style={{ background: 'rgba(239,68,68,0.08)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#f87171' }}>❌ İptal sebebi{selectedVisa.cancelledAt ? ` · ${formatDate(selectedVisa.cancelledAt)}` : ''}</p>
                  <p style={{ margin: '2px 0 0', fontSize: '13px', color: selectedVisa.cancelReason ? '#e8f1f8' : '#64748b' }}>{selectedVisa.cancelReason || 'Girilmemiş (eski kayıt) — Düzenle\'den ekleyebilirsiniz'}</p>
                </div>
              )}
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

// Yeni başvuru için varsayılan maliyetler: kategori varsayılanı + (varsa) o vize türüne özel değerler
export const getVisaCostDefaults = (appSettings, category, typeName) => ({
  ...((appSettings?.visaCostDefaults || {})[category] || {}),
  ...(typeName ? (((appSettings?.visaCostTypeDefaults || {})[category] || {})[typeName] || {}) : {})
});

export const nextBizDay = (ymd) => {
  // createdAt ISO (UTC) ise yerel güne çevir: gece 00:30'da girilen kayıt bir önceki güne sayılmasın
  const d = !ymd ? new Date() : String(ymd).includes('T') ? new Date(ymd) : new Date(String(ymd).slice(0, 10) + 'T12:00:00');
  if (isNaN(d)) return '';
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return ymdLocal(d);
};

// Bir başvurunun maliyetlerini para birimi bazında toplar. Kalem listesinden bağımsız olarak
// kayıttaki tüm tutarları sayar — ayarlardan kaldırılan bir kalem kâr/zarardan düşmesin.
export const sumVisaCosts = (visa) => {
  const cur = visa?.costCurrency || visa?.visaCurrency || visa?.currency || '€';
  const total = Object.values(visa?.costs || {}).reduce((t, v) => t + (parseFloat(v) || 0), 0);
  return total ? { [cur]: total } : {};
};

// İleri tarihli: elle ileri bir işlem tarihi verilmiş ve başvuru henüz ilerlememiş (PNR/randevu yok, sonraki aşamada değil)
export const visaFutureDate = (v) => {
  if (!v.processDate || v.processDate <= ymdLocal(new Date())) return '';
  if (v.pnr || v.appointmentDate) return '';
  if (/basvuru yapildi|randevu alindi|konsolos|sonuc|onay|red|iptal|teslim/.test(normalizeTr(v.status))) return '';
  return v.processDate;
};

// ===== Vizeci iş listesi: başvuru girildiği günün ertesi iş günü (cumartesi/pazar atlanır) sabah 10:00'da işlenir.
// İleri tarihte yapılması gereken başvurularda "İşlem tarihi" elle ileri alınır; o güne kadar listede görünmez.
export const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Müşteri adı: dokununca müşteri kartı vize ekranının üstünde açılır (Geri → vize ekranına dönülür)
function CustLink({ c, onOpen, children }) {
  if (!c || !onOpen) return <strong style={{ color: '#fff' }}>{children}</strong>;
  return (
    <strong role="button" tabIndex={0} title="Müşteri kartını aç" onClick={() => onOpen(c.id)} onKeyDown={e => { if (e.key === 'Enter') onOpen(c.id); }}
      style={{ color: '#fff', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.4)', textUnderlineOffset: '3px' }}>{children} ↗</strong>
  );
}
