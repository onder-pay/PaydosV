// 📄 Teklif & Proforma modülü
import { addCanvasPaged, pdfText } from '../lib/pdf.js';
import { claudeRequest } from '../lib/api.js';
import { db } from '../lib/firebase.js';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { formatDate, formatWhatsAppPhone, safeParseJSON, waUrl } from '../lib/format.js';
import { getActiveBanks } from '../lib/banks.js';
import { jsPDF } from '../lib/heavy.js';
import { normEmail, normalizeTr, titleCaseTr, trHas, trLower } from '../lib/turkish.js';
import { placeTr, tourCountries } from '../lib/data.js';
import { useEffect, useState } from 'react';
import { TR_AYLAR, contractSure, genContractHTML, genOfferHTML, parseTrDate, refreshTourShareLinks, vizeSartiBul, hhmm, offerDateRange, offerDuration, offerLocation, trTarih, TR_GUNLER } from '../components/shared';


export function QuotesModule({ quotes, setQuotes, customers, isMobile, showToast, appSettings, currentUser, tours, setTours, quickAction, onQuickActionDone }) {
  // Teklifi tura dönüştür (fiyat + tarih + destinasyon aktarılır)
  const convertOfferToTour = async (quote) => {
    const o = quote.offer || {};
    // Zaten dönüştürülmüş mü?
    if (tours?.some(t => t.fromQuoteId === quote.id)) {
      if (!window.confirm('Bu teklif zaten bir tura dönüştürülmüş. Yine de yeni bir tur oluşturulsun mu?')) return;
    }
    const dest = (o.destinations || []).filter(d => d.country || d.city)[0] || {};
    // Fiyatı dolu olan otelden al
    const ph = (o.hotels || []).find(h => h.priceDouble || h.priceSingle) || (o.hotels || [])[0] || {};
    const curMap = { USD: '$', EUR: '€', TRY: '₺', GBP: '£' };
    const cur = curMap[ph.currency] || ph.currency || '€';
    const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? 0 : x; };
    const newTour = {
      id: Date.now(),
      name: quote.subject || o.title || 'Yeni Tur',
      country: dest.country || '',
      city: dest.city || '',
      startDate: o.startDate || '',
      endDate: o.endDate || '',
      prices: {
        doubleRoom: { amount: num(ph.priceDouble), currency: cur },
        singleRoom: { amount: num(ph.priceSingle), currency: cur },
        extraBed: { amount: num(ph.priceExtraBed), currency: cur },
        baby: { amount: num(ph.priceBaby), currency: cur },
        child1: { amount: num(ph.priceChild1), currency: cur },
        child2: { amount: num(ph.priceChild2), currency: cur },
      },
      pdfUrl: o.pdfUrl || '',
      offerData: o, // teklifin tüm verisi (günlük program 'days' dahil) — program PDF'i için
      status: 'Aktif',
      reservations: [],
      fromQuoteId: quote.id, // hangi tekliften geldi
      createdAt: new Date().toISOString(),
    };
    setTours(prev => [...prev, newTour]);
    try {
      await setDoc(doc(db, 'tours', String(newTour.id)), newTour, { merge: true });
      showToast?.(`"${newTour.name}" turu oluşturuldu — Turlar bölümünden düzenleyebilirsiniz`, 'success');
    } catch (e) { showToast?.('Tur oluşturuldu ama kaydedilemedi: ' + e.message, 'error'); }
  };
  const canSeeCost = currentUser?.role === 'muhasebe' || currentUser?.role === 'admin';
  const [showCostCalc, setShowCostCalc] = useState(false);
  const [costQuote, setCostQuote] = useState(null); // hangi teklifin maliyeti
  const [pdfBusy, setPdfBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [viewingQuote, setViewingQuote] = useState(null);
  const [filterType, setFilterType] = useState('all'); // all, teklif, proforma
  const emptyOffer = {
    title: 'Tur Adı', subtitle: '', startDate: '', endDate: '',
    destinations: [{ country: '', city: '' }],
    flightOut: { date: '', legs: [{ airline: '', dep: '', arr: '', plane: '' }] },
    flightRet: { date: '', legs: [{ airline: '', dep: '', arr: '', plane: '' }] },
    days: [{ title: '1. GÜN', date: '', items: [{ time: '', text: '' }] }],
    hotels: [{ name: '', stars: '5★', priceDouble: '', priceSingle: '', priceExtraBed: '', priceBaby: '', priceChild1: '', priceChild2: '', currency: 'USD', note: '' }],
    included: [
      'Belirtilen otelde konaklama',
      'Belirtilen uçuşlar',
      'Otelde açık büfe kahvaltı',
      'Havaalanı – otel – havaalanı transferleri',
      'Rehberlik hizmeti dahil "Şehir Turu"',
      'Konser bileti (General Admission)',
      'Seyahat sigortası'
    ],
    excluded: [
      'Kişisel harcamalar, oteldeki ekstralar',
      'Şahsi tercümanlık hizmetleri',
      '20 kg üstü ekstra bagaj',
      'Belirtilen program dışında her türlü rezervasyon değişikliği',
      'Sağlık sigortası',
      'Yurtdışı çıkış harcı'
    ],
    extraNote: ''
  };
  const [showTourOffer, setShowTourOffer] = useState(false);
  const [offer, setOffer] = useState(emptyOffer);
  const [flightRaw, setFlightRaw] = useState('');
  const [dayAiBusy, setDayAiBusy] = useState(null); // AI ile doldurulan gün: sıra no ya da 'all'
  // Uçuş girilince/değişince gidiş ve dönüş gününe toplanma–uçuş–varış maddeleri (elle yazılmış güne dokunulmaz)
  useEffect(() => {
    setOffer(p => {
      const days = p.days || [];
      if (!days.length) return p;
      const dayFor = (f, fallback) => { const fd = parseTrDate(f?.date); if (fd) { const k = days.findIndex(d => { const x = parseTrDate(d.date); return x && x.d.getMonth() === fd.d.getMonth() && x.d.getDate() === fd.d.getDate(); }); if (k >= 0) return k; } return fallback; };
      const free = (d) => !(d.items || []).some(it => String(it.text || '').trim() && !it.auto);
      let changed = false;
      const next = days.map(d => ({ ...d }));
      const strip = (its) => its.map(({ shift, ...x }) => x);
      [[p.flightOut, false, 0], [p.flightRet, true, days.length - 1]].forEach(([f, ret, fb]) => {
        const all = flightAutoItems(f, ret);
        if (!all.length) { // uçuş silindi: yalnız otomatik maddeleri olan gün temizlenir
          const k0 = dayFor(f, fb);
          if (k0 >= 0 && free(next[k0]) && (next[k0].items || []).some(it => it.auto && String(it.text || '').trim())) { next[k0].items = [{ time: '', text: '' }]; changed = true; }
          return;
        }
        const maxShift = all.reduce((m, x) => Math.max(m, x.shift || 0), 0);
        // Dönüşte ertesi güne sarkan uçuş varsa ve gün eşleşmesi yoksa: son gün = varış günü
        let k = dayFor(f, ret ? Math.max(0, days.length - 1 - maxShift) : fb);
        if (k < 0 || (ret && days.length < 2 && k === 0)) return;
        // Her madde uçuş gününden "shift" gün sonraki güne (gün yoksa son güne)
        const groups = new Map();
        all.forEach(x => { const kk = Math.min(k + (x.shift || 0), next.length - 1); groups.set(kk, [...(groups.get(kk) || []), x]); });
        groups.forEach((its, kk) => {
          if (!free(next[kk])) return;
          const items = strip(its);
          const cur = (next[kk].items || []).filter(it => String(it.text || '').trim());
          if (JSON.stringify(cur) === JSON.stringify(items)) return;
          next[kk].items = items; changed = true;
        });
      });
      return changed ? { ...p, days: next } : p;
    });
  }, [JSON.stringify([offer.flightOut, offer.flightRet]), offer.days?.length]);
  const [flightBusy, setFlightBusy] = useState(false);
  const [flightWarn, setFlightWarn] = useState([]);
  const [offerId, setOfferId] = useState(null); // düzenlenen tur teklifi (null = yeni)
  // ===== SÖZLEŞME =====
  const emptyContract = {
    tuketici: { name: '', tc: '', address: '', phone: '', email: '' },
    katilimcilar: [],
    passports: [],
    // 3.1 süre
    startDate: '', endDate: '', baslangicYeri: '',
    // 3.2 tablo
    guzergah: '', konaklama: '', yemekPlani: 'Oda + Kahvaltı', ulasim: '',
    yerTahsisi: 'Ekonomi Sınıfı Koltuklar. Şehir içinde otobüs ile ulaşım ve transfer hizmetleri olacaktır.',
    araKonaklama: 'Ara konaklama yoktur.',
    vizeUlke: '', vizeSarti: '',
    yasSarti: 'Yaş şartı bulunmamaktadır.', asiSarti: 'Aşı şartı bulunmamaktadır.', iklimNot: '',
    // 4 fiyat
    fiyatDouble: '', fiyatSingle: '', paraBirimi: 'USD',
    // 6 sigorta
    sigortaBedeli: '15€',
    // 7 ödeme
    onOdeme: '', sonOdeme: '',
    ozelTalepler: true,
    programDays: []
  };
  const [showContract, setShowContract] = useState(false);
  const [contract, setContract] = useState(emptyContract);
  const [contractId, setContractId] = useState(null);
  const [custSearchC, setCustSearchC] = useState('');
  const [iklimBusy, setIklimBusy] = useState(false);
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
      
      // Türkçe font (DejaVu) — yüklenemezse ASCII'ye düşer
      const toTurkishChars = pdfText(doc);
      
      // Logo ve Başlık
      doc.setFontSize(20);
      doc.setTextColor(220, 53, 69);
      doc.text('Paydos Tur', 20, 20);
      
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(toTurkishChars('Paydos Turizm ve Seyahat Acentalığı Sanayi ve Ticaret Limited Şirketi'), 20, 28);
      doc.text(toTurkishChars('Mehmetçik Mahallesi Ulus Caddesi No: 124/1 Denizli / Türkiye'), 20, 33);
    doc.text('Vergi: Pamukkale VD 7230433632 | Tel: 0 258 263 71 76', 20, 38);
    
    // Teklif/Proforma Başlık
    doc.setFontSize(24);
    doc.setTextColor(220, 53, 69);
    doc.text(quote.type === 'teklif' ? toTurkishChars('TEKLİF') : 'PROFORMA FATURA', 190, 20, { align: 'right' });
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(quote.number, 190, 28, { align: 'right' });
    
    // Bilgiler
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text(toTurkishChars('TARİH'), 20, 50);
    doc.text(toTurkishChars('OPSİYON TARİHİ'), 70, 50);
    doc.text(toTurkishChars('PARA BİRİMİ'), 120, 50);
    doc.text('HAZIRLAYAN', 150, 50);
    
    doc.setTextColor(0);
    doc.text(new Date(quote.createdAt).toLocaleDateString('tr-TR'), 20, 56);
    doc.text(quote.optionDate ? new Date(quote.optionDate).toLocaleDateString('tr-TR') : '-', 70, 56);
    doc.text(quote.currency, 120, 56);
    doc.text(toTurkishChars(quote.createdBy || 'Önder Taşçı'), 150, 56);
    
    // Konu
    doc.setTextColor(60);
    doc.text('KONU', 20, 66);
    doc.setTextColor(0);
    doc.text(toTurkishChars(quote.subject), 20, 72);
    
    // Müşteri Bilgileri
    doc.setFontSize(12);
    doc.setTextColor(220, 53, 69);
    doc.text(toTurkishChars('MÜŞTERİ BİLGİLERİ'), 20, 85);
    
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text('Firma / Ad Soyad', 20, 93);
    if (quote.type === 'proforma') {
      doc.text('Vergi Dairesi', 110, 93);
    } else {
      doc.text(toTurkishChars('Yetkili Kişi'), 110, 93);
    }
    
    doc.setTextColor(0);
    doc.text(toTurkishChars(`${quote.customer.firstName} ${quote.customer.lastName}`), 20, 99);
    doc.text('-', 110, 99);
    
    doc.setTextColor(60);
    doc.text('Telefon', 20, 107);
    doc.text('E-posta', 110, 107);
    
    doc.setTextColor(0);
    doc.text(String(quote.customer.phone || '-'), 20, 113);
    doc.text(String(quote.customer.email || '-'), 110, 113);
    
    // Hizmet Kalemleri Tablosu
    doc.setFontSize(12);
    doc.setTextColor(220, 53, 69);
    doc.text(toTurkishChars('HİZMET KALEMLERİ'), 20, 126);
    
    
    // Manuel tablo çizimi (autoTable yerine)
    let currentY = 132;
    
    // Tablo başlığı
    doc.setFillColor(31, 41, 55);
    doc.rect(20, currentY, 170, 8, 'F');
    doc.setFontSize(9);
    doc.setTextColor(255);
    doc.text(toTurkishChars('HİZMET'), 22, currentY + 5);
    doc.text(toTurkishChars('AÇIKLAMA'), 62, currentY + 5);
    doc.text('ADET', 132, currentY + 5, { align: 'center' });
    doc.text(toTurkishChars('BİRİM'), 162, currentY + 5, { align: 'right' });
    doc.text('TOPLAM', 188, currentY + 5, { align: 'right' });
    currentY += 8;
    
    // Tablo satırları — uzun hizmet/açıklama kesilmez, satır içinde alt satıra geçer
    doc.setTextColor(0);
    quote.items.forEach((item, idx) => {
      const svc = doc.splitTextToSize(toTurkishChars(String(item.service || '')), 38);
      const desc = doc.splitTextToSize(toTurkishChars(String(item.description || '')), 60);
      const rowH = Math.max(svc.length, desc.length, 1) * 4.2 + 3;
      if (currentY + rowH > 275) { doc.addPage(); currentY = 20; }
      if (idx % 2 === 0) {
        doc.setFillColor(245, 245, 245);
        doc.rect(20, currentY, 170, rowH, 'F');
      }
      doc.text(svc, 22, currentY + 5);
      doc.text(desc, 62, currentY + 5);
      doc.text(String(item.quantity), 132, currentY + 5, { align: 'center' });
      doc.text(Number(item.unitPrice).toFixed(2), 162, currentY + 5, { align: 'right' });
      doc.text((item.quantity * item.unitPrice).toFixed(2), 188, currentY + 5, { align: 'right' });
      currentY += rowH;
    });
    
    // Hesaplamalar — toplam + banka + notlar sığmıyorsa yeni sayfaya geç
    if (currentY + (quote.type === 'proforma' ? 75 : 40) > 280) { doc.addPage(); currentY = 20; }
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
      doc.text(toTurkishChars('İndirim:'), 130, finalY + (quote.vatIncluded ? 12 : 6));
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
      doc.text(toTurkishChars('BANKA BİLGİLERİ'), 20, bankY);
      
      doc.setFontSize(9);
      doc.setTextColor(60);
      const BKq = getActiveBanks(appSettings)[0];
      doc.text(toTurkishChars(`${BKq.bankName} - ${BKq.branch} (${BKq.branchCode})`), 20, bankY + 6);
      doc.text(toTurkishChars('Hesap Sahibi: Paydos Turizm Seyahat Acentalığı San. ve Tic. Ltd. Şti.'), 20, bankY + 11);
      doc.setTextColor(0);
      const qAccs = (Array.isArray(BKq.accounts) ? BKq.accounts : []).filter(a => a.iban);
      let qby = bankY + 18;
      (qAccs.length ? qAccs : [{ currency: 'TL', iban: BKq.ibanTL }, { currency: 'EUR', iban: BKq.ibanEUR }].filter(a => a.iban)).forEach(a => {
        doc.text(`IBAN (${a.currency}):`, 20, qby);
        doc.text(a.iban, 50, qby);
        qby += 5;
      });
    }
    
    // Notlar
    if (quote.notes) {
      let notesY = quote.type === 'proforma' ? totalY + 50 : totalY + 15;
      if (notesY + 20 > 280) { doc.addPage(); notesY = 20; }
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
      ? '• Bu teklif opsiyon tarihine kadar geçerlidir. • Fiyatlar döviz kuruna göre değişiklik gösterebilir.'
      : 'Bu proforma fatura bilgi amaçlıdır ve yasal belge niteliği taşımaz.';
    doc.text(toTurkishChars(footerText), 105, 285, { align: 'center' });
    doc.text('www.paydostur.com', 105, 290, { align: 'center' });
    
    return doc;
    } catch (error) {
      console.error('PDF oluşturma hatası:', error);
      throw new Error('PDF oluşturulamadı: ' + error.message);
    }
  };

  const downloadPDF = (quote) => {
    try {
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
      const message = `Merhaba ${quote.customer.firstName},\n\n${quote.type === 'teklif' ? 'Teklifiniz' : 'Proforma faturanız'} hazır.\n\nBelge No: ${quote.number}\nToplam: ${quote.total.toFixed(2)} ${quote.currency}`;
      
      const phone = quote.customer.phone?.replace(/\D/g, '');
      if (!phone) {
        showToast?.('Müşterinin telefon numarası yok!', 'error');
        return;
      }
      
      window.open(waUrl(formatWhatsAppPhone(phone), message), '_blank');
      showToast?.('WhatsApp açıldı', 'success');
    } catch (error) {
      console.error('WhatsApp hatası:', error);
      showToast?.('WhatsApp hatası: ' + error.message, 'error');
    }
  };

  const sendEmail = (quote) => {
    try {
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

  // ⚡ Dashboard kısayolu: modül açılınca istenen formu hemen aç
  useEffect(() => { if (!quickAction) return; if (quickAction === 'new') { resetForm(); setShowForm(true); }
    else if (quickAction === 'offer') { setOffer(emptyOffer); setOfferId(null); setFlightRaw(''); setFlightWarn([]); setShowTourOffer(true); }
    else if (quickAction === 'contract') { setContract(emptyContract); setContractId(null); setCustSearchC(''); setShowContract(true); } onQuickActionDone?.(); }, [quickAction]);

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
      createdBy: currentUser?.name || currentUser?.email || 'Önder Taşçı'
    };

    setQuotes([...quotes, newQuote]);
    showToast?.(`${formData.type === 'teklif' ? 'Teklif' : 'Proforma'} oluşturuldu`, 'success');
    resetForm();
  };

  const searchResults = customerSearchQuery.length >= 1
    ? customers.filter(c =>
        normalizeTr(`${c.firstName} ${c.lastName}`).includes(normalizeTr(customerSearchQuery)) ||
        c.phone?.includes(customerSearchQuery) ||
        normalizeTr(c.email).includes(normalizeTr(customerSearchQuery))
      ).slice(0, 10)
    : [];

  const filteredQuotes = quotes
    .filter(q => filterType === 'all' || q.type === filterType)
    .filter(q => 
      searchQuery.length < 1 || 
      normalizeTr(q.subject).includes(normalizeTr(searchQuery)) ||
      normalizeTr(q.number).includes(normalizeTr(searchQuery)) ||
      normalizeTr(`${q.customer?.firstName} ${q.customer?.lastName}`).includes(normalizeTr(searchQuery))
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
                          <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: '600', color: '#e8f1f8' }}>{titleCaseTr(customer.firstName)} {titleCaseTr(customer.lastName)}</p>
                          <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>{customer.phone} • {normEmail(customer.email)}</p>
                        </div>
                        <span style={{ fontSize: '20px' }}>→</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {customerSearchQuery.length < 1 && (
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

  // ===== Uçuşları AI ile düzenle + tutarlılık kontrolü =====
  const checkFlights = (fo, fr, o) => {
    const w = [];
    const mins = (s) => { const m = String(s||'').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1])*60 + (+m[2]) : null; };
    const plus1 = (s) => /\(\+1\)|ertesi|next day/.test(normalizeTr(s));
    [[fo,'Gidiş'],[fr,'Dönüş']].forEach(([f,lab]) => {
      const legs = (f.legs || []).filter(l => l.airline || l.dep || l.arr);
      legs.forEach((l, idx) => {
        const tag = legs.length > 1 ? `${lab} ${idx+1}. bacak` : lab;
        const d = mins(l.dep), a = mins(l.arr);
        if (d !== null && a !== null && a < d && !plus1(l.arr)) w.push(`${tag}: varış (${l.arr}) kalkıştan (${l.dep}) erken — gece uçuşuysa "(+1)" ekleyin.`);
        const dur = String(l.plane||'').match(/(\d+)\s*s\w*\s*(\d+)?/);
        if (d !== null && a !== null && dur) {
          let diff = a - d; if (diff < 0) diff += 1440;
          const stated = (+dur[1])*60 + (dur[2] ? +dur[2] : 0);
          const fark = Math.abs(diff - stated);
          // Saat dilimi farkı tam saat olur (1-12 saat): fark tam saat katıysa uyarma
          const tamSaat = fark % 60 <= 10 || fark % 60 >= 50;
          if (fark > 90 && !(tamSaat && fark <= 720)) w.push(`${tag}: yazılan süre (${dur[0]}) saatlerle uyuşmuyor (~${Math.floor(diff/60)}s ${diff%60}dk) ve fark saat dilimiyle açıklanamıyor — kontrol edin.`);
        }
        if (!l.airline) w.push(`${tag}: havayolu/uçuş no boş.`);
      });
      // Aktarma bekleme süresi kontrolü
      for (let i = 1; i < legs.length; i++) {
        const prevArr = mins(legs[i-1].arr), nextDep = mins(legs[i].dep);
        if (prevArr !== null && nextDep !== null) {
          let wait = nextDep - prevArr; if (wait < 0) wait += 1440;
          if (wait < 60) w.push(`${lab}: ${i}. aktarma bekleme süresi çok kısa (~${wait} dk) — bağlantı riskli.`);
          if (wait > 600) w.push(`${lab}: ${i}. aktarma bekleme süresi çok uzun (~${Math.floor(wait/60)} saat) — kontrol edin.`);
        }
      }
    });
    // Türkçe tarih metnini gerçek tarihe çevir ("9 Ekim 2026 Cuma" -> Date)
    const trDate = (s) => {
      const t = normalizeTr(s); // "16 EKIM" / "16 Ekim" / "AGUSTOS" hepsi tanınır
      const m = t.match(/(\d{1,2})\s*([a-z]+)\s*(\d{4})?/);
      if (!m) return null;
      const idx = TR_AYLAR.findIndex(a => normalizeTr(a).startsWith(m[2].slice(0, 3)));
      if (idx < 0) return null;
      const yil = m[3] ? +m[3] : (o.startDate ? +o.startDate.slice(0, 4) : new Date().getFullYear());
      return new Date(yil, idx, +m[1]);
    };
    const dOut = trDate(fo.date), dRet = trDate(fr.date);
    // Yazılan gün adı tarihle uyuşuyor mu ("21 Mart 2027 Cumartesi" → aslında Pazar)
    [[fo.date, dOut, 'Gidiş'], [fr.date, dRet, 'Dönüş']].forEach(([txt, d, lab]) => {
      if (!d) return;
      const yazilan = TR_GUNLER.find(g => trHas(txt, g) && !(g === 'Pazar' && trHas(txt, 'Pazartesi')));
      const gercek = TR_GUNLER[d.getDay()];
      if (yazilan && yazilan !== gercek) w.push(`${lab} tarihi: ${d.getDate()} ${TR_AYLAR[d.getMonth()]} ${d.getFullYear()} ${gercek} günüdür ("${yazilan}" yazılmış).`);
    });
    if (dOut && dRet && dOut > dRet) w.push('Gidiş tarihi dönüşten sonra görünüyor — kontrol edin.');
    // Uçuş tarihleri seçilen tur aralığında mı?
    if (o.startDate && o.endDate) {
      const a = new Date(o.startDate + 'T00:00:00'), b = new Date(o.endDate + 'T00:00:00');
      if (dOut && (dOut < a || dOut > b)) w.push(`Gidiş tarihi (${fo.date}) seçilen tur aralığının dışında.`);
      if (dRet && (dRet < a || dRet > b)) w.push(`Dönüş tarihi (${fr.date}) seçilen tur aralığının dışında.`);
    }
    return w;
  };
  const parseFlightsAI = async () => {
    if (!flightRaw.trim()) { showToast?.('Önce uçuş bilgilerini yapıştırın', 'warning'); return; }
    setFlightBusy(true); setFlightWarn([]);
    try {
      const bugun = new Date();
      const bugunStr = bugun.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
      const prompt = `Aşağıdaki serbest metinden uçuş bilgilerini çıkar. Aktarmalı uçuşlarda HER BACAĞI ayrı bir legs elemanı yap. SADECE şu JSON'u döndür, başka hiçbir şey yazma:
{"flightOut":{"date":"","legs":[{"airline":"","dep":"","arr":"","plane":""}]},"flightRet":{"date":"","legs":[{"airline":"","dep":"","arr":"","plane":""}]}}
BUGÜNÜN TARİHİ: ${bugunStr}
Kurallar:
- date: "15 Ekim 2026 Perşembe" gibi Türkçe biçim (o yönün ilk kalkış tarihi)
- YIL KURALI: Uçuş her zaman GELECEKTE ya da bugündür, ASLA geçmişte değildir. Metinde yıl belirtilmemişse, tarihi BUGÜNDEN SONRAKİ en yakın yıl olacak şekilde seç. Örnek: bugün 2026'daysa ve metin "18 Kasım" diyorsa, bu 18 Kasım 2026'dır (2025 DEĞİL — o geçmişte kaldı). Metinde açıkça geçmiş bir yıl yazsa bile, mantıken uçuş gelecekte olmalı — bir sonraki uygun yılı kullan.
- Gün adı (Çarşamba vb.) ile yıl çelişirse, GEÇMİŞ OLMAYAN yılı tercih et; gün adını yok say.
- legs: aktarmasız uçuşta 1 eleman, aktarmalıda her bacak için bir eleman (örn. Madrid→İstanbul, İstanbul→İzmir = 2 eleman)
- airline: "Turkish Airlines (TK 1856)" gibi havayolu + uçuş no
- dep: "Madrid MAD · 14:30" (şehir + havalimanı kodu · saat)
- arr: "İstanbul SAW · 19:40" — "(+1)" YALNIZ metindeki varış tarihi kalkış tarihinden sonraki günse ekle; saat farkından ya da uçuş süresinden tahmin ETME (IST 01:35 → CAN 16:35 aynı gün varıştır)
- plane: "Airbus A321 · 4s 10dk" — bilinmiyorsa boş bırak
- Bilinmeyen alanı boş string bırak. UYDURMA.
METİN:
${flightRaw}`;
      const resp = await claudeRequest({
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 700, messages: [{ role: 'user', content: prompt }] })
      });
      if (!resp.ok) { const t = await resp.text(); throw new Error(`API ${resp.status}: ${t.slice(0,120)}`); }
      const data = await resp.json();
      const txt = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
      const m = txt.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('AI yanıtı okunamadı');
      const p = JSON.parse(m[0]);
      const norm = (x, prev) => {
        const legs = Array.isArray(x?.legs) && x.legs.length ? x.legs.map(l => ({ airline: l.airline || '', dep: l.dep || '', arr: l.arr || '', plane: l.plane || '' })) : prev.legs;
        return { date: x?.date || prev.date || '', legs };
      };
      const fo = norm(p.flightOut, offer.flightOut);
      const fr = norm(p.flightRet, offer.flightRet);
      setOffer(prev => ({ ...prev, flightOut: fo, flightRet: fr }));
      const w = checkFlights(fo, fr, offer);
      setFlightWarn(w);
      showToast?.(w.length ? `Uçuşlar dolduruldu — ${w.length} uyarı var` : 'Uçuşlar dolduruldu, tutarlı görünüyor', w.length ? 'warning' : 'success');
    } catch (e) {
      showToast?.('Uçuş okunamadı: ' + e.message, 'error');
    } finally { setFlightBusy(false); }
  };
  // ===== ✨ Günlük programı AI ile doldur =====
  // Gün notu ("Metzingen outlet alışverişi") + turun uçuş/otel/şehir bilgisi → saatli maddeler. which: gün sırası ya da 'all'
  // 'all': notu olan ya da hiç maddesi olmayan günler doldurulur; elle yazılmış (notsuz) günlere dokunulmaz.
  const dayFilled = (d) => (d.items || []).some(it => String(it.text || '').trim());
  const aiFillDays = async (which) => {
    const days = offer.days || [];
    const idx = which === 'all' ? days.map((d, i) => i).filter(i => String(days[i].note || '').trim() || !dayFilled(days[i])) : [which];
    if (!idx.length) { showToast?.('Doldurulacak gün yok — günlere kısa not yazın', 'warning'); return; }
    if (which !== 'all' && dayFilled(days[which]) && !window.confirm(`${days[which].title || 'Bu gün'}: mevcut maddeler AI'ın yazdıklarıyla değiştirilsin mi?`)) return;
    setDayAiBusy(which);
    try {
      const legs = (f) => (f?.legs || []).filter(l => l.airline || l.dep || l.arr).map(l => `${l.airline || ''} ${l.dep || ''} → ${l.arr || ''}`.trim()).join(' | ');
      const ctx = [
        `Tur: ${offer.title || ''}${offer.subtitle ? ' — ' + offer.subtitle : ''}`,
        `Yerler: ${(offer.destinations || []).map(x => [x.city, x.country].filter(Boolean).join(', ')).filter(Boolean).join(' · ') || '-'}`,
        `Tarih: ${offer.startDate ? formatDate(offer.startDate) : '?'} – ${offer.endDate ? formatDate(offer.endDate) : '?'}`,
        `Gidiş uçuşu (${offer.flightOut?.date || '?'}): ${legs(offer.flightOut) || '-'}`,
        `Dönüş uçuşu (${offer.flightRet?.date || '?'}): ${legs(offer.flightRet) || '-'}`,
        `Otel: ${(offer.hotels || []).map(h => h.name).filter(Boolean).join(' / ') || '-'}`,
      ].join('\n');
      const list = days.map((d, i) => `${i}. ${d.title || ''} · ${d.date || ''}${d.place ? ` · ${d.place}` : ''}${d.note ? ` · NOT: ${d.note}` : ''}${idx.includes(i) ? ' [DOLDUR]' : ` [mevcut: ${(d.items || []).filter(it => it.text).map(it => `${it.time || ''} ${it.text}`.trim()).join('; ')}]`}`).join('\n');
      const prompt = `Bir Türk seyahat acentesinin grup turu teklifi için günlük program yazıyorsun. Sadece [DOLDUR] işaretli günleri yaz.
SADECE şu JSON'u döndür: {"days":[{"index":0,"items":[{"time":"09:00","text":"..."}]}]}
Kurallar:
- Türkçe, kısa ve resmi cümleler ("Otelden hareket.", "Serbest zaman ve alışveriş."). Her gün 4-8 madde, saat sırasıyla.
- time: "HH:MM" ya da saat belli değilse "" (ör. "Akşam: serbest zaman" yerine time "" text "Akşam serbest zaman."). 
- Uçuş günlerinde verilen uçuş saatlerine uy: dış hat uçuşunda havalimanında buluşma kalkıştan 3 saat önce; varıştan sonra bagaj, transfer, otele yerleşme.
- Dönüş gününde otelden çıkış ve havalimanı transferi uçuştan en az 3 saat önce olsun.
- Gün notundaki yerleri ve etkinlikleri programa koy; not yoksa bölgeye uygun, gerçekçi bir gün yaz (şehir turu, serbest zaman).
- Mağaza/müze açılış-kapanış saatini emin değilsen yazma. Fiyat, bilet ücreti, uydurma yer adı YAZMA.
- Konaklama: son gün hariç her günün sonu "Otelde konaklama."
${ctx}
GÜNLER:
${list}`;
      const resp = await claudeRequest({
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] })
      });
      if (!resp.ok) { const t = await resp.text(); throw new Error(`API ${resp.status}: ${t.slice(0, 120)}`); }
      const data = await resp.json();
      const m = (data.content?.[0]?.text || '').replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
      if (!m) throw new Error('AI yanıtı okunamadı');
      const out = (JSON.parse(m[0]).days || []).filter(x => idx.includes(+x.index) && Array.isArray(x.items) && x.items.length);
      if (!out.length) throw new Error('AI gün yazmadı');
      const clean = (items) => items.map(it => ({ time: /^\d{1,2}[:.]\d{2}$/.test(String(it.time || '').trim()) ? String(it.time).trim().replace('.', ':').padStart(5, '0') : '', text: String(it.text || '').trim() })).filter(it => it.text);
      setOffer(p => ({ ...p, days: p.days.map((d, i) => { const hit = out.find(x => +x.index === i); return hit ? { ...d, items: clean(hit.items) } : d; }) }));
      showToast?.(`✨ ${out.length} gün AI ile dolduruldu — okuyup düzeltin`, 'success');
    } catch (e) { showToast?.('AI programı yazamadı: ' + e.message, 'error'); }
    finally { setDayAiBusy(null); }
  };
  // ===== Tarihlere göre günleri otomatik oluştur =====
  const buildDaysFromDates = () => {
    if (!offer.startDate || !offer.endDate) { showToast?.('Önce başlangıç ve bitiş tarihi seçin', 'warning'); return; }
    const a = new Date(offer.startDate + 'T00:00:00');
    let b = new Date(offer.endDate + 'T00:00:00');
    // Dönüş uçuşu (+1) ya da gece aktarmasıyla ertesi gün iniyorsa son gün varış günüdür
    const rp = parseTrDate(offer.flightRet?.date);
    let extended = false;
    if (rp) {
      const shift = flightAutoItems(offer.flightRet, true).reduce((m, x) => Math.max(m, x.shift || 0), 0);
      const arrive = new Date(rp.year ? rp.d.getFullYear() : a.getFullYear(), rp.d.getMonth(), rp.d.getDate() + shift);
      if (arrive > b) { b = arrive; extended = true; }
    }
    const n = Math.round((b - a) / 86400000);
    if (isNaN(n) || n < 0) { showToast?.('Tarihler hatalı', 'error'); return; }
    if (n > 30) { showToast?.('30 günden uzun tur için elle ekleyin', 'warning'); return; }
    const gunler = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
    const days = [];
    for (let i = 0; i <= n; i++) {
      const d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + i);
      const eski = offer.days[i];
      days.push({
        title: `${i + 1}. GÜN`,
        date: `${d.getDate()} ${TR_AYLAR[d.getMonth()]} ${gunler[d.getDay()]}`,
        place: eski?.place || '', note: eski?.note || '',
        items: (eski && eski.items.some(x => (x.time||'').trim() || (x.text||'').trim())) ? eski.items : [{ time: '', text: '' }]
      });
    }
    setOffer(p => ({ ...p, days }));
    showToast?.(`${days.length} gün oluşturuldu${extended ? ' (dönüş uçuşu ertesi gün indiği için son gün eklendi)' : ''}`, 'success');
  };

  // ===== Tur teklifini kaydet (quotes listesine 'tur-teklifi' türünde) =====
  const saveTourOffer = () => {
    if (!offer.title || offer.title === 'Tur Adı') { showToast?.('Tur başlığı girin', 'warning'); return; }
    const now = new Date();
    if (offerId) {
      setQuotes(prev => prev.map(q => q.id === offerId ? { ...q, subject: offer.title, offer, updatedAt: now.toISOString() } : q));
      // Bu tekliften oluşturulmuş tur(lar) varsa: program, tarih ve destinasyon tura da yansır; paylaşılmış linkler yenilenir
      const linked = (tours || []).filter(t => t.fromQuoteId === offerId);
      if (!linked.length) { showToast?.('Tur teklifi güncellendi', 'success'); return; }
      const dest = (offer.destinations || []).filter(d => d.country || d.city)[0] || {};
      const upd = linked.map(t => ({ ...t, offerData: offer, startDate: offer.startDate || t.startDate, endDate: offer.endDate || t.endDate,
        country: dest.country || t.country, city: dest.city || t.city, offerUpdatedAt: now.toISOString() }));
      setTours(prev => prev.map(t => upd.find(u => u.id === t.id) || t));
      (async () => {
        let links = 0, linkErr = '';
        for (const t of upd) {
          try {
            const sd = { ...t }; delete sd._docId;
            await setDoc(doc(db, 'tours', t._docId || String(t.id)), sd, { merge: true });
          } catch (e) { showToast?.(`❌ "${t.name}" turu kaydedilemedi: ${e.message}`, 'error'); return; }
          try { links += await refreshTourShareLinks(t); } catch (e) { linkErr = e.message; }
        }
        if (linkErr) showToast?.(`⚠️ Tur programı güncellendi ama müşteri linkleri yenilenemedi (${linkErr}) — linki tekrar paylaşınca güncellenir`, 'warning');
        else showToast?.(`✅ Teklif kaydedildi · ${upd.length} turun programı güncellendi${links ? ` · ${links} müşteri linki yenilendi` : ''}`, 'success');
      })();
      showToast?.(`Teklif kaydedildi — ${linked.length} tur ve linkleri güncelleniyor…`, 'info');
    } else {
      const id = Date.now();
      const newQ = {
        id, type: 'tur-teklifi', subject: offer.title,
        customer: { firstName: offer.subtitle || '', lastName: '' },
        number: `TUR-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(quotes.filter(q=>q.type==='tur-teklifi').length + 1).padStart(3,'0')}`,
        offer, createdAt: now.toISOString(), createdBy: currentUser?.name || currentUser?.email || 'Önder Taşçı'
      };
      setQuotes(prev => [...prev, newQ]);
      setOfferId(id);
      showToast?.('Tur teklifi kaydedildi', 'success');
    }
  };

  // html2canvas'ı CDN'den dinamik yükle (teklif PDF'i için)
  const loadHtml2Canvas = () => new Promise((resolve, reject) => {
    if (window.html2canvas) return resolve(window.html2canvas);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error('html2canvas yüklenemedi'));
    document.head.appendChild(s);
  });

  const makeOfferPDF = async (o) => {
    const data = { ...emptyOffer, ...o };
    setPdfBusy(true);
    let holder = null;
    try {
      const html2canvas = await loadHtml2Canvas();
      // Teklifi ekran dışında render et
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;background:#fff;z-index:-1';
      const inner = genOfferHTML(data);
      const bodyMatch = inner.match(/<body>([\s\S]*)<\/body>/);
      const styleMatch = inner.match(/<style>([\s\S]*?)<\/style>/);
      holder.innerHTML = `<style>${styleMatch ? styleMatch[1] : ''}</style><div style="padding:14px;font-family:'Segoe UI',Arial,sans-serif;color:#1c2b3a;font-size:12px;background:#fff">${bodyMatch ? bodyMatch[1] : ''}</div>`;
      document.body.appendChild(holder);
      await new Promise(r => setTimeout(r, 250)); // yerleşim otursun

      const canvas = await html2canvas(holder, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const img = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pw = 210, ph = 297;
      let iw = pw, ih = (canvas.height * pw) / canvas.width;
      if (ih > ph && ih <= ph * 1.35) {
        // Bir sayfayı az aşıyor -> küçültüp tek sayfaya sığdır (ortala)
        const k = ph / ih;
        ih = ph; iw = pw * k;
        pdf.addImage(img, 'JPEG', (pw - iw) / 2, 0, iw, ih);
      } else if (ih <= ph) {
        pdf.addImage(img, 'JPEG', 0, 0, iw, ih);
      } else {
        // uzun içerik -> sayfalara böl (satırları ortadan kesmeden)
        addCanvasPaged(pdf, canvas, 0.92);
      }
      const safe = (data.title || 'Tur_Teklifi').replace(/[^\w\sğüşıöçĞÜŞİÖÇ-]/g, '').replace(/\s+/g, '_');
      pdf.save(`${safe}.pdf`);
      showToast?.('PDF indirildi', 'success');
    } catch (e) {
      console.error('PDF hatası:', e);
      showToast?.('PDF oluşturulamadı: ' + e.message, 'error');
    } finally {
      if (holder) document.body.removeChild(holder);
      setPdfBusy(false);
    }
  };

  // ===== SÖZLEŞME: yardımcılar =====
  // Müşteriyi tüketici olarak aktar
  const pickCustomer = (cust) => {
    const pps = safeParseJSON(cust.passports).filter(p => p.passportNo).map(p => ({
      name: `${cust.firstName} ${cust.lastName}`.trim(), no: p.passportNo,
      issueDate: p.issueDate, expiryDate: p.expiryDate, birthPlace: placeTr(cust.birthPlace)
    }));
    setContract(c => ({ ...c,
      tuketici: { name: `${cust.firstName} ${cust.lastName}`.trim(), tc: cust.tcKimlik || '', address: cust.city || '', phone: cust.phone || '', email: cust.email || '' },
      passports: pps.length ? pps : c.passports
    }));
    setCustSearchC('');
    showToast?.('Müşteri bilgileri aktarıldı', 'success');
  };
  // Vize şartını ülkeye göre belirle
  // Tur teklifinden aktar
  const importFromOffer = (q, hotelIdx = 0) => {
    const o = q.offer || {};
    const h = (o.hotels || [])[hotelIdx] || {};
    // Fiyat: seçili otelde varsa onu, yoksa teklifte fiyatı dolu olan ilk otelden al
    const priceHotel = (h.priceDouble || h.priceSingle) ? h : ((o.hotels || []).find(x => x.priceDouble || x.priceSingle) || h);
    const dest = (o.destinations || []).filter(d => d.country || d.city);
    const guzergah = dest.map(d => [d.city, d.country].filter(Boolean).join(' / ')).join(' — ');
    const anaUlke = dest[0]?.country || '';
    const vz = vizeSartiBul(anaUlke);
    const legTxt = (f, lab) => {
      const legs = (f?.legs || []).filter(l => l.airline || l.dep || l.arr);
      if (!legs.length) return '';
      return `${lab} (${f.date || ''}): ` + legs.map(l => `${l.airline || ''} ${l.dep || ''} → ${l.arr || ''}`.trim()).join(' | ');
    };
    const ulasim = [legTxt(o.flightOut, 'Gidiş'), legTxt(o.flightRet, 'Dönüş')].filter(Boolean).join('  ///  ');
    const konak = h.name ? `${h.name} (${h.stars || ''}) — ${offerDateRange(o)}` : '';
    setContract(c => ({ ...c,
      startDate: o.startDate || c.startDate, endDate: o.endDate || c.endDate,
      guzergah: guzergah || c.guzergah, konaklama: konak || c.konaklama, ulasim: ulasim || c.ulasim,
      vizeUlke: anaUlke || c.vizeUlke, vizeSarti: vz.metin || c.vizeSarti,
      fiyatDouble: priceHotel.priceDouble || h.priceDouble || c.fiyatDouble, fiyatSingle: priceHotel.priceSingle || h.priceSingle || c.fiyatSingle,
      paraBirimi: priceHotel.currency || h.currency || c.paraBirimi,
      programDays: o.days || c.programDays
    }));
    showToast?.(vz.bilinmiyor && anaUlke ? `Aktarıldı — ${anaUlke} vize durumu belirsiz, elle kontrol edin` : 'Tur teklifinden aktarıldı', vz.bilinmiyor ? 'warning' : 'success');
  };
  // İklim/giyim tavsiyesi (AI)
  const iklimOlustur = async () => {
    if (!contract.vizeUlke && !contract.guzergah) { showToast?.('Önce tur teklifinden aktarın veya güzergah girin', 'warning'); return; }
    if (!contract.startDate) { showToast?.('Önce tarih girin', 'warning'); return; }
    setIklimBusy(true);
    try {
      const ay = TR_AYLAR[+contract.startDate.slice(5,7) - 1];
      const yer = contract.guzergah || contract.vizeUlke;
      const prompt = `${yer} bölgesinin ${ay} ayındaki TİPİK MEVSİM NORMALLERİNE göre, bir tur sözleşmesine yazılacak kısa bir iklim ve giyim tavsiyesi yaz.
KURALLAR:
- Bu bir TAHMİN DEĞİL, mevsim normali. "olacaktır" deme, "hâkimdir / beklenir / tavsiye edilir" gibi ifadeler kullan.
- 2 cümleyi geçme. Ortalama sıcaklık aralığı ver.
- Giyim tavsiyesi ekle (mont, yağmurluk, şemsiye vb.).
- Sağlık/aşı konusuna GİRME.
- Sadece metni döndür, başlık/açıklama yazma.`;
      const r = await claudeRequest({
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 300, messages: [{ role: 'user', content: prompt }] })
      });
      if (!r.ok) throw new Error('API ' + r.status);
      const data = await r.json();
      const txt = (data.content?.[0]?.text || '').trim();
      if (!txt) throw new Error('boş yanıt');
      setContract(c => ({ ...c, iklimNot: txt }));
      showToast?.('İklim tavsiyesi oluşturuldu — kontrol edin', 'success');
    } catch (e) { showToast?.('Oluşturulamadı: ' + e.message, 'error'); }
    finally { setIklimBusy(false); }
  };

  // ===== SÖZLEŞME: HTML üretici =====

  // ===== SÖZLEŞME: kaydet =====
  const saveContract = () => {
    const tketiciAdi = contract.tuketici.name || 'İsimsiz (örnek)';
    const now = new Date();
    if (contractId) {
      setQuotes(prev => prev.map(q => q.id === contractId ? { ...q, subject: `Sözleşme — ${tketiciAdi}`, contract, updatedAt: now.toISOString() } : q));
      showToast?.('Sözleşme güncellendi', 'success');
    } else {
      const id = Date.now();
      setQuotes(prev => [...prev, { id, type: 'sozlesme', subject: `Sözleşme — ${tketiciAdi}`,
        customer: { firstName: contract.tuketici.name || '', lastName: '' },
        number: `SZL-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(quotes.filter(q=>q.type==='sozlesme').length + 1).padStart(3,'0')}`,
        contract, createdAt: now.toISOString() }]);
      setContractId(id);
      showToast?.('Sözleşme kaydedildi', 'success');
    }
  };
  const makeContractPDF = async (c) => {
    const data = { ...emptyContract, ...c };
    setPdfBusy(true);
    let holder = null;
    try {
      const html2canvas = await loadHtml2Canvas();
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;background:#fff;z-index:-1';
      const full = genContractHTML(data, getActiveBanks(appSettings));
      const b = full.match(/<body>([\s\S]*)<\/body>/), st = full.match(/<style>([\s\S]*?)<\/style>/);
      holder.innerHTML = `<style>${st ? st[1] : ''}</style><div style="padding:16px;background:#fff;font-family:'Segoe UI',Arial,sans-serif;font-size:9.5px;line-height:1.45;color:#1a1a1a">${b ? b[1] : ''}</div>`;
      document.body.appendChild(holder);
      await new Promise(r => setTimeout(r, 350));
      const canvas = await html2canvas(holder, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const pdf = new jsPDF('p', 'mm', 'a4');
      addCanvasPaged(pdf, canvas, 0.9);
      pdf.save(`Sozlesme_${(data.tuketici.name || 'Musteri').replace(/\s+/g,'_')}.pdf`);
      showToast?.('Sözleşme PDF indirildi', 'success');
    } catch (e) { showToast?.('PDF oluşturulamadı: ' + e.message, 'error'); }
    finally { if (holder) document.body.removeChild(holder); setPdfBusy(false); }
  };

  const printOffer = () => makeOfferPDF(offer);

  if (showContract) {
    const inS = { width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' };
    const lbl = { display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' };
    const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '14px', marginBottom: '14px' };
    const secT = { fontSize: '13px', color: '#e8912a', fontWeight: '700', marginBottom: '10px' };
    const addB = { padding: '6px 12px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px' };
    const delB = { padding: '4px 8px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '11px' };
    const custHits = custSearchC.trim().length >= 2
      ? (customers || []).filter(c => normalizeTr(`${c.firstName} ${c.lastName} ${c.tcKimlik || ''}`).includes(normalizeTr(custSearchC))).slice(0, 6) : [];
    const tourOffers = quotes.filter(q => q.type === 'tur-teklifi');
    const vz = contract.vizeUlke ? vizeSartiBul(contract.vizeUlke) : null;
    return (
      <div style={{ padding: '16px', maxWidth: '820px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>📜 {contractId ? 'Sözleşme Düzenle' : 'Paket Tur Sözleşmesi'}</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={saveContract} style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>💾 Kaydet</button>
            <button onClick={() => setShowContract(false)} style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer', fontSize: '13px' }}>← Geri</button>
          </div>
        </div>

        {/* Tur teklifinden aktar */}
        <div style={{ ...card, background: 'rgba(232,145,42,0.06)', border: '1px solid rgba(232,145,42,0.25)' }}>
          <div style={secT}>🧾 Tur Teklifinden Aktar</div>
          {tourOffers.length === 0 ? <p style={{ fontSize: '12px', color: '#64748b' }}>Kayıtlı tur teklifi yok. Önce bir tur teklifi oluşturup kaydedin.</p> : (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {tourOffers.map(q => (
                <div key={q.id} style={{ display: 'flex', gap: '4px', alignItems: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '6px 8px' }}>
                  <span style={{ fontSize: '11px', color: '#e8f1f8' }}>{q.subject}</span>
                  {(q.offer?.hotels || []).filter(h => h.name).map((h, hi) => (
                    <button key={hi} onClick={() => importFromOffer(q, hi)} style={{ ...addB, padding: '4px 8px' }}>↓ {h.name.slice(0, 18)}</button>
                  ))}
                  {!(q.offer?.hotels || []).some(h => h.name) && <button onClick={() => importFromOffer(q, 0)} style={{ ...addB, padding: '4px 8px' }}>↓ Aktar</button>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 1) Taraflar */}
        <div style={card}>
          <div style={secT}>1) Taraflar — Tüketici</div>
          {contract.tuketici.name ? (
            <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', padding: '10px' }}>
              <div style={{ fontSize: '13px', color: '#10b981', fontWeight: '700' }}>👤 {contract.tuketici.name}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>TC: {contract.tuketici.tc || '—'} · {contract.tuketici.address || '—'} · {contract.tuketici.phone || '—'}</div>
            </div>
          ) : (
            <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Yukarıdan "🧾 Tur Teklifinden Aktar" ile tur seçin — müşteri bilgileri otomatik dolar.</p>
          )}

          {contract.katilimcilar.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <label style={lbl}>Katılımcılar</label>
              {contract.katilimcilar.map((k, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '6px 10px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '12px', color: '#e8f1f8' }}>{i + 1}. {k.name}{k.tc ? ` · ${k.tc}` : ''}</span>
                  <button style={delB} onClick={() => setContract(c => ({...c, katilimcilar: c.katilimcilar.filter((_,j)=>j!==i)}))}>×</button>
                </div>
              ))}
            </div>
          )}
          {contract.passports.length > 0 && (
            <div style={{ marginTop: '10px', background: 'rgba(59,130,246,0.06)', borderRadius: '8px', padding: '8px' }}>
              <div style={{ fontSize: '11px', color: '#3b82f6', fontWeight: '600', marginBottom: '4px' }}>🛂 Pasaport bilgileri (müşteriden geldi)</div>
              {contract.passports.map((p, i) => <div key={i} style={{ fontSize: '11px', color: '#94a3b8' }}>{p.name} · {p.no} · {trTarih(p.expiryDate)}</div>)}
            </div>
          )}
        </div>

        {/* 3.1 Süre */}
        <div style={card}>
          <div style={secT}>3.1) Süre</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '8px' }}>
            <div><label style={lbl}>Hareket Tarihi</label><input type="date" style={inS} value={contract.startDate} onChange={e => setContract({...contract, startDate: e.target.value})} /></div>
            <div><label style={lbl}>Dönüş Tarihi</label><input type="date" style={inS} min={contract.startDate || undefined} value={contract.endDate} onChange={e => setContract({...contract, endDate: e.target.value})} /></div>
            <div><label style={lbl}>Süre (otomatik)</label><div style={{...inS, color: '#e8912a', fontWeight: '600'}}>{contractSure(contract) || '—'}</div></div>
            <div><label style={lbl}>Başlangıç/Bitiş Yeri</label><input style={inS} value={contract.baslangicYeri} onChange={e => setContract({...contract, baslangicYeri: e.target.value})} placeholder="İzmir" /></div>
          </div>
        </div>

        {/* 3.2 Nitelikler */}
        <div style={card}>
          <div style={secT}>3.2) Tur Nitelikleri</div>
          <div style={{ display: 'grid', gap: '8px' }}>
            <div><label style={lbl}>Duraklama Yerleri / Güzergah</label><input style={inS} value={contract.guzergah} onChange={e => setContract({...contract, guzergah: e.target.value})} /></div>
            <div><label style={lbl}>Konaklama (otel, sınıf, tarih)</label><input style={inS} value={contract.konaklama} onChange={e => setContract({...contract, konaklama: e.target.value})} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px' }}>
              <div><label style={lbl}>Yemek Planı</label><input style={inS} value={contract.yemekPlani} onChange={e => setContract({...contract, yemekPlani: e.target.value})} /></div>
              <div><label style={lbl}>Ulaşım (uçuşlar)</label><input style={inS} value={contract.ulasim} onChange={e => setContract({...contract, ulasim: e.target.value})} /></div>
            </div>
            <div><label style={lbl}>Yer Tahsisi</label><input style={inS} value={contract.yerTahsisi} onChange={e => setContract({...contract, yerTahsisi: e.target.value})} /></div>
            <div><label style={lbl}>Ara Konaklama / Aktarma</label><input style={inS} value={contract.araKonaklama} onChange={e => setContract({...contract, araKonaklama: e.target.value})} /></div>
          </div>
          {contract.programDays.length > 0 && <p style={{ fontSize: '11px', color: '#10b981', marginTop: '6px' }}>✔ {contract.programDays.length} günlük program tekliften aktarıldı (sözleşmeye eklenecek)</p>}
        </div>

        {/* Vize */}
        <div style={card}>
          <div style={secT}>Vize Şartları</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 2fr', gap: '8px' }}>
            <div><label style={lbl}>Ülke</label>
              <select style={inS} value={contract.vizeUlke} onChange={e => { const u = e.target.value; const v = vizeSartiBul(u); setContract(c => ({...c, vizeUlke: u, vizeSarti: v.metin || c.vizeSarti})); }}>
                <option value="" style={{ background: '#0c1929' }}>Ülke seçin...</option>
                {tourCountries.map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Sözleşmeye yazılacak</label><input style={inS} value={contract.vizeSarti} onChange={e => setContract({...contract, vizeSarti: e.target.value})} placeholder="Örn. Almanya Vizesi Şartı bulunmaktadır." /></div>
          </div>
          {vz && vz.detay && (
            <div style={{ marginTop: '8px', background: vz.bilinmiyor ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.06)', border: `1px solid ${vz.bilinmiyor ? 'rgba(245,158,11,0.3)' : 'rgba(59,130,246,0.2)'}`, borderRadius: '8px', padding: '8px' }}>
              <div style={{ fontSize: '10px', color: vz.bilinmiyor ? '#f59e0b' : '#3b82f6', fontWeight: '700' }}>{vz.bilinmiyor ? '⚠️ Durum belirsiz — elle yazın' : 'ℹ️ Dışişleri Bakanlığı bilgisi'}</div>
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '3px' }}>{vz.detay.slice(0, 260)}</div>
              <div style={{ fontSize: '9px', color: '#64748b', marginTop: '3px' }}>Vize kuralları değişebilir — sözleşme öncesi teyit edin.</div>
            </div>
          )}
        </div>

        {/* Yaş / sağlık / iklim */}
        <div style={card}>
          <div style={secT}>Yaş ve Sağlık Şartları</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <div><label style={lbl}>Yaş Şartı</label><input style={inS} value={contract.yasSarti} onChange={e => setContract({...contract, yasSarti: e.target.value})} /></div>
            <div><label style={lbl}>Aşı / Sağlık Şartı</label><input style={inS} value={contract.asiSarti} onChange={e => setContract({...contract, asiSarti: e.target.value})} /></div>
          </div>
          <label style={lbl}>İklim ve Giyim Tavsiyesi</label>
          <textarea style={{...inS, minHeight: '54px', resize: 'vertical', fontFamily: 'inherit'}} value={contract.iklimNot} onChange={e => setContract({...contract, iklimNot: e.target.value})} placeholder="Mevsim normallerine göre tavsiye" />
          <button disabled={iklimBusy} onClick={iklimOlustur} style={{ marginTop: '6px', padding: '7px 12px', background: iklimBusy ? 'rgba(139,92,246,0.3)' : 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '8px', color: '#fff', cursor: iklimBusy ? 'wait' : 'pointer', fontSize: '11px', fontWeight: '600' }}>{iklimBusy ? '⏳ Yazılıyor...' : '🤖 AI ile Oluştur'}</button>
          <p style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>Mevsim normali tavsiyesi üretir — hava tahmini değildir. Kontrol edip düzenleyin.</p>
        </div>

        {/* Fiyat / sigorta / ödeme */}
        <div style={card}>
          <div style={secT}>4) Fiyat · 6) Sigorta · 7) Ödeme</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: '8px', marginBottom: '8px' }}>
            <div><label style={lbl}>2 Kişilik / Kişi Başı</label><input style={inS} value={contract.fiyatDouble} onChange={e => setContract({...contract, fiyatDouble: e.target.value})} /></div>
            <div><label style={lbl}>Tek Kişilik</label><input style={inS} value={contract.fiyatSingle} onChange={e => setContract({...contract, fiyatSingle: e.target.value})} /></div>
            <div><label style={lbl}>Para Birimi</label>
              <select style={inS} value={contract.paraBirimi} onChange={e => setContract({...contract, paraBirimi: e.target.value})}>
                {['USD','EUR','TRY','GBP'].map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px' }}>
            <div><label style={lbl}>Ön Ödeme Günü</label><input type="date" style={inS} value={contract.onOdeme} onChange={e => setContract({...contract, onOdeme: e.target.value})} /></div>
            <div><label style={lbl}>Son Ödeme Günü</label><input type="date" style={inS} value={contract.sonOdeme} onChange={e => setContract({...contract, sonOdeme: e.target.value})} /></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', fontSize: '12px', color: '#94a3b8', cursor: 'pointer' }}>
            <input type="checkbox" checked={contract.ozelTalepler} onChange={e => setContract({...contract, ozelTalepler: e.target.checked})} />
            8) Özel Talepler maddesini ekle (fuar bileti iade şartı — fuar turlarında)
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <button onClick={saveContract} style={{ padding: '14px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>💾 Kaydet</button>
          <button onClick={() => makeContractPDF(contract)} disabled={pdfBusy} style={{ padding: '14px', background: pdfBusy ? 'rgba(232,145,42,0.4)' : 'linear-gradient(135deg, #e8912a, #d97706)', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: '700', fontSize: '15px', cursor: pdfBusy ? 'wait' : 'pointer' }}>{pdfBusy ? '⏳ Hazırlanıyor...' : '📄 Sözleşme PDF'}</button>
        </div>
      </div>
    );
  }

  if (showTourOffer) {
    const inS = { width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' };
    const lbl = { display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' };
    const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '14px', marginBottom: '14px' };
    const secTitle = { fontSize: '13px', color: '#e8912a', fontWeight: '700', marginBottom: '10px' };
    const addBtn = { padding: '6px 12px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px' };
    const delBtn = { padding: '4px 8px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '11px' };
    const setDay = (i, patch) => setOffer(p => ({ ...p, days: p.days.map((d,j) => j===i ? {...d, ...patch} : d) }));
    const setHotel = (i, patch) => setOffer(p => ({ ...p, hotels: p.hotels.map((h,j) => j===i ? {...h, ...patch} : h) }));
    return (
      <div style={{ padding: '16px', maxWidth: '780px', margin: '0 auto' }}>
        <datalist id="offerTimes">
          {Array.from({ length: 48 }).map((_, i) => {
            const t = `${String(Math.floor(i/2)).padStart(2,'0')}:${i%2 ? '30' : '00'}`;
            return <option key={t} value={t} />;
          })}
        </datalist>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>🧾 {offerId ? 'Tur Teklifi Düzenle' : 'Tur Teklifi Oluştur'}</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={saveTourOffer} style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>💾 Kaydet</button>
            <button onClick={() => setShowTourOffer(false)} style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer', fontSize: '13px' }}>← Geri</button>
          </div>
        </div>

        <div style={card}>
          <div style={secTitle}>Üst Bilgi</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginBottom: '8px' }}>
            <div><label style={lbl}>Tur Başlığı</label><input style={inS} value={offer.title} onChange={e => setOffer({...offer, title: e.target.value})} placeholder="Bakü Build Fuar Turu" /></div>
            <div><label style={lbl}>Alt Başlık (grup/oda adı)</label><input style={inS} value={offer.subtitle} onChange={e => setOffer({...offer, subtitle: e.target.value})} placeholder="Denizli İnşaat Mühendisleri Odası" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
            <div><label style={lbl}>Başlangıç Tarihi</label><input type="date" style={inS} value={offer.startDate} onChange={e => setOffer({...offer, startDate: e.target.value})} /></div>
            <div><label style={lbl}>Bitiş Tarihi</label><input type="date" style={inS} min={offer.startDate || undefined} value={offer.endDate} onChange={e => setOffer({...offer, endDate: e.target.value})} /></div>
            <div><label style={lbl}>Süre (otomatik)</label><div style={{...inS, color: '#e8912a', fontWeight: '600', lineHeight: '1.4'}}>{offerDuration(offer) || '—'}</div></div>
          </div>
          {offer.startDate && <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 10px' }}>Teklifte görünecek: <b style={{ color: '#e8912a' }}>{offerDateRange(offer)}</b></p>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <label style={lbl}>Ülke / Şehir</label>
            <button style={addBtn} onClick={() => setOffer(p => ({...p, destinations: [...p.destinations, { country: '', city: '' }]}))}>+ Destinasyon Ekle</button>
          </div>
          {offer.destinations.map((d, i) => (
            <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              <select style={{...inS, flex: 1}} value={d.country} onChange={e => setOffer(p => ({...p, destinations: p.destinations.map((x,j)=>j===i?{...x, country: e.target.value}:x)}))}>
                <option value="" style={{ background: '#0c1929' }}>Ülke seçin...</option>
                {tourCountries.map(c => <option key={c} value={c} style={{ background: '#0c1929' }}>{c}</option>)}
              </select>
              <input style={{...inS, flex: 1}} value={d.city} onChange={e => setOffer(p => ({...p, destinations: p.destinations.map((x,j)=>j===i?{...x, city: e.target.value}:x)}))} placeholder="Şehir (örn. Bakü)" />
              {offer.destinations.length > 1 && <button style={delBtn} onClick={() => setOffer(p => ({...p, destinations: p.destinations.filter((_,j)=>j!==i)}))}>🗑️</button>}
            </div>
          ))}
        </div>

        <div style={card}>
          <div style={secTitle}>✈ Uçuş Bilgileri</div>
          <div style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '8px', padding: '10px', marginBottom: '12px' }}>
            <label style={{...lbl, color: '#a78bfa'}}>🤖 Uçuşları buraya yapıştır — AI düzenleyip alanlara yazsın</label>
            <textarea style={{...inS, minHeight: '70px', fontFamily: 'inherit', resize: 'vertical'}} value={flightRaw} onChange={e => setFlightRaw(e.target.value)} placeholder={"Örn:\n15 Ekim Ankara-Bakü AZAL J2 8004 22:55-02:25 A320\n18 Ekim Bakü-Ankara J2 8003 20:15-21:55"} />
            <button disabled={flightBusy} onClick={parseFlightsAI} style={{ marginTop: '8px', padding: '8px 14px', background: flightBusy ? 'rgba(139,92,246,0.3)' : 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '8px', color: 'white', cursor: flightBusy ? 'wait' : 'pointer', fontSize: '12px', fontWeight: '600' }}>
              {flightBusy ? '⏳ Okunuyor...' : '🤖 AI ile Düzenle & Kontrol Et'}
            </button>
            {flightWarn.length > 0 && (
              <div style={{ marginTop: '8px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', padding: '8px' }}>
                <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: '700', marginBottom: '4px' }}>⚠️ Tutarlılık uyarıları</div>
                {flightWarn.map((w, i) => <div key={i} style={{ fontSize: '11px', color: '#fbbf24', padding: '2px 0' }}>• {w}</div>)}
                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>Not: AI gerçek uçuş tarifesini doğrulayamaz, sadece mantık/tutarlılık kontrolü yapar.</div>
              </div>
            )}
          </div>
          {[['flightOut','GİDİŞ'],['flightRet','DÖNÜŞ']].map(([key,lab]) => {
            const f = offer[key];
            const setLeg = (li, patch) => setOffer(p => ({ ...p, [key]: { ...p[key], legs: p[key].legs.map((l,j) => j===li ? {...l, ...patch} : l) } }));
            return (
              <div key={key} style={{ marginBottom: '14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#3b82f6', fontWeight: '600' }}>{lab}{f.legs.length > 1 && <span style={{ marginLeft: '6px', fontSize: '10px', background: 'rgba(232,145,42,0.2)', color: '#e8912a', padding: '2px 6px', borderRadius: '8px' }}>Aktarmalı ({f.legs.length} bacak)</span>}</div>
                  <button style={addBtn} onClick={() => setOffer(p => ({ ...p, [key]: { ...p[key], legs: [...p[key].legs, { airline: '', dep: '', arr: '', plane: '' }] } }))}>+ Aktarma Ekle</button>
                </div>
                <input style={{...inS, marginBottom: '6px'}} value={f.date} onChange={e => setOffer({...offer, [key]: {...f, date: e.target.value}})} placeholder="Tarih (örn. 15 Ekim 2026 Perşembe)" />
                {f.legs.map((l, li) => (
                  <div key={li} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1.4fr 1.2fr 1.2fr 1fr auto', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                    {f.legs.length > 1 && <div style={{ gridColumn: '1 / -1', fontSize: '10px', color: '#64748b' }}>{li + 1}. Bacak</div>}
                    <input style={inS} value={l.airline} onChange={e => setLeg(li, { airline: e.target.value })} placeholder="Havayolu / Uçuş No" />
                    <input style={inS} value={l.dep} onChange={e => setLeg(li, { dep: e.target.value })} placeholder="Kalkış (Madrid MAD · 14:30)" />
                    <input style={inS} value={l.arr} onChange={e => setLeg(li, { arr: e.target.value })} placeholder="Varış (İstanbul SAW · 19:40)" />
                    <input style={inS} value={l.plane} onChange={e => setLeg(li, { plane: e.target.value })} placeholder="Uçak / Süre" />
                    {f.legs.length > 1 && <button style={delBtn} onClick={() => setOffer(p => ({ ...p, [key]: { ...p[key], legs: p[key].legs.filter((_,j)=>j!==li) } }))}>🗑️</button>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={secTitle}>◆ Günlük Program</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button style={{...addBtn, background: 'rgba(6,182,212,0.15)', borderColor: 'rgba(6,182,212,0.3)', color: '#06b6d4'}} onClick={buildDaysFromDates}>📅 Tarihlerden Oluştur</button>
              <button disabled={dayAiBusy !== null} title="Notu olan ya da boş günleri uçuş/otel bilgisine göre AI yazar; elle yazdığınız günlere dokunmaz" style={{...addBtn, background: 'rgba(168,85,247,0.15)', borderColor: 'rgba(168,85,247,0.35)', color: '#c084fc', cursor: dayAiBusy !== null ? 'wait' : 'pointer'}} onClick={() => aiFillDays('all')}>{dayAiBusy === 'all' ? '⏳ Yazılıyor…' : '✨ Boş günleri AI yazsın'}</button>
              <button style={addBtn} onClick={() => setOffer(p => ({...p, days: [...p.days, { title: `${p.days.length+1}. GÜN`, date: '', items: [{ time: '', text: '' }] }]}))}>+ Gün Ekle</button>
            </div>
          </div>
          {offer.days.map((d, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '10px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <input style={{...inS, flex: '0 0 90px'}} value={d.title} onChange={e => setDay(i, {title: e.target.value})} placeholder="1. GÜN" />
                <input style={{...inS, flex: '0 0 150px'}} value={d.date} onChange={e => setDay(i, {date: e.target.value})} placeholder="15 Ekim" />
                <input style={{...inS, flex: 1, fontWeight: 600}} value={d.place || ''} onChange={e => setDay(i, {place: e.target.value})} placeholder="Gün başlığı (örn. İzmir – Stuttgart)" />
                {offer.days.length > 1 && <button style={delBtn} onClick={() => setOffer(p => ({...p, days: p.days.filter((_,j)=>j!==i)}))}>🗑️ Gün</button>}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <input style={{...inS, borderStyle: 'dashed', fontSize: '12px'}} value={d.note || ''} onChange={e => setDay(i, { note: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && dayAiBusy === null) aiFillDays(i); }} placeholder="✨ Kısa not yaz, AI doldursun (örn. Metzingen outlet alışverişi, akşam Stuttgart)" />
                <button disabled={dayAiBusy !== null} onClick={() => aiFillDays(i)} style={{ flex: '0 0 auto', padding: '6px 12px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: '6px', color: '#c084fc', cursor: dayAiBusy !== null ? 'wait' : 'pointer', fontSize: '11px', fontWeight: 600 }}>{dayAiBusy === i ? '⏳' : '✨ AI'}</button>
              </div>
              {d.items.map((it, k) => (
                <div key={k} style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                  <input list="offerTimes" style={{...inS, flex: '0 0 88px', textAlign: 'center'}} value={it.time || ''} onChange={e => setDay(i, { items: d.items.map((x,m)=>m===k?{...x, time: e.target.value, auto: false}:x) })} placeholder="12:00" />
                  <input style={inS} value={it.text || ''} onChange={e => setDay(i, { items: d.items.map((x,m)=>m===k?{...x, text: e.target.value, auto: false}:x) })} placeholder="Açıklama (örn. Havalimanına hareket)" />
                  {d.items.length > 1 && <button style={delBtn} onClick={() => setDay(i, { items: d.items.filter((_,m)=>m!==k) })}>×</button>}
                </div>
              ))}
              <button style={{...addBtn, marginTop: '4px'}} onClick={() => setDay(i, { items: [...d.items, { time: '', text: '' }] })}>+ Madde</button>
            </div>
          ))}
        </div>

        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={secTitle}>★ Otel Seçenekleri</div>
            <button style={addBtn} onClick={() => setOffer(p => ({...p, hotels: [...p.hotels, { name: '', stars: '5★', priceDouble: '', priceSingle: '', priceExtraBed: '', priceBaby: '', priceChild1: '', priceChild2: '', currency: 'USD', note: '' }]}))}>+ Otel Ekle</button>
          </div>
          {offer.hotels.map((h, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '10px', marginBottom: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 70px auto' : '2fr 70px 70px auto', gap: '6px', marginBottom: '8px', alignItems: 'center' }}>
                <input style={inS} value={h.name} onChange={e => setHotel(i, {name: e.target.value})} placeholder="Otel adı" />
                <select style={inS} value={h.stars} onChange={e => setHotel(i, {stars: e.target.value})}>
                  {['5★','4★','3★','2★','Apart','Butik','—'].map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}
                </select>
                {!isMobile && (
                  <select style={inS} value={h.currency} onChange={e => setHotel(i, {currency: e.target.value})}>
                    {['USD','EUR','TRY','GBP'].map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}
                  </select>
                )}
                {offer.hotels.length > 1 && <button style={delBtn} onClick={() => setOffer(p => ({...p, hotels: p.hotels.filter((_,j)=>j!==i)}))}>🗑️</button>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6, 1fr)', gap: '6px' }}>
                <div><label style={{...lbl, fontSize: '10px'}}>İki Kişilik / Kişi Başı</label><input style={inS} value={h.priceDouble} onChange={e => setHotel(i, {priceDouble: e.target.value})} placeholder="650" /></div>
                <div><label style={{...lbl, fontSize: '10px'}}>Tek Kişilik Oda</label><input style={inS} value={h.priceSingle} onChange={e => setHotel(i, {priceSingle: e.target.value})} placeholder="820" /></div>
                <div><label style={{...lbl, fontSize: '10px'}}>İlave Yatak</label><input style={inS} value={h.priceExtraBed} onChange={e => setHotel(i, {priceExtraBed: e.target.value})} placeholder="—" /></div>
                <div><label style={{...lbl, fontSize: '10px', color: '#60a5fa'}}>Bebek (0–1,99)</label><input style={inS} value={h.priceBaby} onChange={e => setHotel(i, {priceBaby: e.target.value})} placeholder="—" /></div>
                <div><label style={{...lbl, fontSize: '10px', color: '#60a5fa'}}>1.Çocuk (7–11,99)</label><input style={inS} value={h.priceChild1} onChange={e => setHotel(i, {priceChild1: e.target.value})} placeholder="—" /></div>
                <div><label style={{...lbl, fontSize: '10px', color: '#60a5fa'}}>2.Çocuk (2–6,99)</label><input style={inS} value={h.priceChild2} onChange={e => setHotel(i, {priceChild2: e.target.value})} placeholder="—" /></div>
              </div>
              {isMobile && <div style={{ marginTop: '6px' }}><label style={{...lbl, fontSize: '10px'}}>Para Birimi</label>
                <select style={inS} value={h.currency} onChange={e => setHotel(i, {currency: e.target.value})}>
                  {['USD','EUR','TRY','GBP'].map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}
                </select>
              </div>}
              <input style={{...inS, marginTop: '6px'}} value={h.note} onChange={e => setHotel(i, {note: e.target.value})} placeholder="Not (örn. 14-17 Ekim için) — opsiyonel" />
            </div>
          ))}
          <div><label style={lbl}>Ek Not (opsiyonel)</label><input style={inS} value={offer.extraNote} onChange={e => setOffer({...offer, extraNote: e.target.value})} placeholder="Ek: Ankara gidiş-geliş otobüs 65 USD" /></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{...secTitle, color: '#10b981'}}>✔ Fiyata Dahil</div>
              <button style={addBtn} onClick={() => setOffer(p => ({...p, included: [...p.included, '']}))}>+</button>
            </div>
            {offer.included.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                <input style={inS} value={it} onChange={e => setOffer(p => ({...p, included: p.included.map((x,j)=>j===i?e.target.value:x)}))} placeholder="Dahil hizmet" />
                {offer.included.length > 1 && <button style={delBtn} onClick={() => setOffer(p => ({...p, included: p.included.filter((_,j)=>j!==i)}))}>×</button>}
              </div>
            ))}
          </div>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{...secTitle, color: '#ef4444'}}>✘ Dahil Değil</div>
              <button style={addBtn} onClick={() => setOffer(p => ({...p, excluded: [...p.excluded, '']}))}>+</button>
            </div>
            {offer.excluded.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                <input style={inS} value={it} onChange={e => setOffer(p => ({...p, excluded: p.excluded.map((x,j)=>j===i?e.target.value:x)}))} placeholder="Dahil olmayan" />
                {offer.excluded.length > 1 && <button style={delBtn} onClick={() => setOffer(p => ({...p, excluded: p.excluded.filter((_,j)=>j!==i)}))}>×</button>}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <button onClick={saveTourOffer} style={{ padding: '14px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>💾 Kaydet</button>
          <button onClick={printOffer} disabled={pdfBusy} style={{ padding: '14px', background: pdfBusy ? 'rgba(232,145,42,0.4)' : 'linear-gradient(135deg, #e8912a, #d97706)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '700', fontSize: '15px', cursor: pdfBusy ? 'wait' : 'pointer' }}>{pdfBusy ? '⏳ PDF hazırlanıyor...' : '📄 PDF Oluştur'}</button>
        </div>

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
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { setOffer(emptyOffer); setOfferId(null); setFlightRaw(''); setFlightWarn([]); setShowTourOffer(true); }} style={{ background: 'linear-gradient(135deg, #e8912a, #d97706)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>🧾 Tur Teklifi</button>
          <button onClick={() => { setContract(emptyContract); setContractId(null); setCustSearchC(''); setShowContract(true); }} style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>📜 Sözleşme</button>
          <button onClick={() => setShowForm(true)} style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>➕ Yeni Oluştur</button>
        </div>
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
            <button onClick={() => setFilterType('tur-teklifi')} style={{ padding: '10px 20px', background: filterType === 'tur-teklifi' ? 'linear-gradient(135deg, #e8912a, #d97706)' : 'rgba(255,255,255,0.05)', border: filterType === 'tur-teklifi' ? 'none' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: filterType === 'tur-teklifi' ? 'white' : '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
              🧾 Tur Teklifleri ({quotes.filter(q => q.type === 'tur-teklifi').length})
            </button>
            <button onClick={() => setFilterType('sozlesme')} style={{ padding: '10px 20px', background: filterType === 'sozlesme' ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'rgba(255,255,255,0.05)', border: filterType === 'sozlesme' ? 'none' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: filterType === 'sozlesme' ? 'white' : '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
              📜 Sözleşmeler ({quotes.filter(q => q.type === 'sozlesme').length})
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
          {filteredQuotes.map(quote => quote.type === 'sozlesme' ? (
            <div key={quote.id} style={{ background: 'rgba(99,102,241,0.06)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(99,102,241,0.25)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '18px' }}>📜</span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>{quote.number}</span>
              </div>
              <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#ffffff' }}>{quote.contract?.tuketici?.name || quote.subject}</h3>
              <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#64748b' }}>{quote.contract?.guzergah || '—'}</p>
              <div style={{ padding: '10px 12px', background: 'rgba(99,102,241,0.1)', borderRadius: '8px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', color: '#a5b4fc', fontWeight: '600' }}>{quote.contract?.startDate ? `${trTarih(quote.contract.startDate)} → ${trTarih(quote.contract.endDate)}` : 'Tarih yok'}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{contractSure(quote.contract || {})}{quote.contract?.fiyatDouble ? ` · ${quote.contract.fiyatDouble} ${quote.contract.paraBirimi}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => { setContract({ ...emptyContract, ...quote.contract }); setContractId(quote.id); setCustSearchC(''); setShowContract(true); }} style={{ flex: '1 1 auto', padding: '8px', background: 'rgba(59,130,246,0.2)', border: 'none', borderRadius: '6px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>✏️ Aç / Düzenle</button>
                <button onClick={() => { const now = new Date(); const id = Date.now();
                  setQuotes(prev => [...prev, { ...quote, id, _docId: undefined, subject: `${quote.subject} (Kopya)`, number: `SZL-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(quotes.filter(q=>q.type==='sozlesme').length + 1).padStart(3,'0')}`, createdAt: now.toISOString() }]);
                  showToast?.('Sözleşme kopyalandı', 'success'); }} style={{ padding: '8px 12px', background: 'rgba(139,92,246,0.2)', border: 'none', borderRadius: '6px', color: '#a78bfa', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>📋 Kopyala</button>
                <button onClick={() => makeContractPDF(quote.contract)} disabled={pdfBusy} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '6px', color: '#ef4444', cursor: pdfBusy ? 'wait' : 'pointer', fontSize: '11px', fontWeight: '600' }}>{pdfBusy ? '⏳' : '📄'}</button>
                <button onClick={async () => { if (window.confirm('Bu sözleşmeyi silmek istediğinizden emin misiniz?')) { setQuotes(prev => prev.filter(q => q.id !== quote.id)); showToast?.('Sözleşme silindi', 'warning'); try { const docId = quote._docId || quote.id?.toString(); if (docId) await deleteDoc(doc(db, 'quotes', docId)); } catch(e) {} } }} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>🗑️</button>
              </div>
            </div>
          ) : quote.type === 'tur-teklifi' ? (
            <div key={quote.id} style={{ background: 'rgba(232,145,42,0.06)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(232,145,42,0.25)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '18px' }}>🧾</span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>{quote.number}</span>
              </div>
              <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#ffffff' }}>{quote.subject}</h3>
              <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#64748b' }}>{quote.offer?.subtitle || '—'}</p>
              <div style={{ padding: '10px 12px', background: 'rgba(232,145,42,0.1)', borderRadius: '8px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', color: '#e8912a', fontWeight: '600' }}>{offerDateRange(quote.offer || {}) || 'Tarih yok'}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{offerDuration(quote.offer || {})}{offerLocation(quote.offer || {}) ? ' · ' + offerLocation(quote.offer) : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => { setOffer({ ...emptyOffer, ...quote.offer }); setOfferId(quote.id); setFlightRaw(''); setFlightWarn([]); setShowTourOffer(true); }} style={{ flex: '1 1 auto', padding: '8px', background: 'rgba(59,130,246,0.2)', border: 'none', borderRadius: '6px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>✏️ Aç / Düzenle</button>
                {canSeeCost && (
                  <button onClick={() => { setCostQuote(quote); setShowCostCalc(true); }} style={{ padding: '8px 12px', background: quote.cost ? 'rgba(16,185,129,0.2)' : 'rgba(232,145,42,0.2)', border: 'none', borderRadius: '6px', color: quote.cost ? '#10b981' : '#e8912a', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }} title="Maliyet Hesaplama (tahmini)">💰 Maliyet{quote.cost ? ' ✓' : ''}</button>
                )}
                <button onClick={() => convertOfferToTour(quote)} style={{ padding: '8px 12px', background: 'rgba(16,185,129,0.2)', border: 'none', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }} title="Bu teklifi tura dönüştür (fiyat + tarih aktarılır)">🎫 Tura Dönüştür</button>
                <button onClick={() => {
                  const now = new Date(); const id = Date.now();
                  const copy = { ...quote, id, _docId: undefined, subject: `${quote.subject} (Kopya)`, number: `TUR-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(quotes.filter(q=>q.type==='tur-teklifi').length + 1).padStart(3,'0')}`, createdAt: now.toISOString() };
                  setQuotes(prev => [...prev, copy]);
                  showToast?.('Teklif kopyalandı', 'success');
                }} style={{ padding: '8px 12px', background: 'rgba(139,92,246,0.2)', border: 'none', borderRadius: '6px', color: '#a78bfa', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>📋 Kopyala</button>
                <button onClick={() => makeOfferPDF(quote.offer)} disabled={pdfBusy} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '6px', color: '#ef4444', cursor: pdfBusy ? 'wait' : 'pointer', fontSize: '11px', fontWeight: '600' }}>{pdfBusy ? '⏳' : '📄'}</button>
                <button onClick={async () => { if (window.confirm(`"${quote.subject}" teklifini silmek istediğinizden emin misiniz?`)) { setQuotes(prev => prev.filter(q => q.id !== quote.id)); showToast?.('Teklif silindi', 'warning'); try { const docId = quote._docId || quote.id?.toString(); if (docId) await deleteDoc(doc(db, 'quotes', docId)); } catch(e) { console.warn('Firestore silme hatası:', e.message); } } }} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>🗑️</button>
              </div>
            </div>
          ) : (
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

      {showCostCalc && costQuote && (
        <CostCalculator
          initial={costQuote}
          isMobile={isMobile}
          showToast={showToast}
          onClose={() => { setShowCostCalc(false); setCostQuote(null); }}
          onSave={async (cost) => {
            const updated = { ...costQuote, cost };
            setQuotes(prev => prev.map(q => q.id === costQuote.id ? updated : q));
            try {
              const docId = costQuote._docId || String(costQuote.id);
              const sd = { ...updated }; delete sd._docId;
              await setDoc(doc(db, 'quotes', docId), sd, { merge: true });
              showToast?.('Maliyet hesabı kaydedildi', 'success');
            } catch (e) { showToast?.('Kaydedilemedi: ' + e.message, 'error'); }
            setShowCostCalc(false); setCostQuote(null);
          }}
        />
      )}
    </div>
  );
}

// TEKLİF & PROFORMA MODÜLÜ
// ===== MALİYET HESAPLAMA (tahmini planlama — sadece muhasebe/yönetici) =====
export function CostCalculator({ initial, onSave, onClose, showToast, isMobile }) {
  const emptyCost = {
    tourName: '', peopleCount: 30, currency: 'TL',
    hotels: [{ name: '', nights: 1, single: '', twin: '' }],
    perPerson: [
      { name: 'Uçak Bileti', qty: 1, unit: '' },
      { name: 'Fuar Giriş Bileti', qty: 0, unit: '' },
      { name: 'Yemek', qty: 1, unit: '' },
      { name: 'Transfer/Taksi', qty: 1, unit: '' },
      { name: 'Sigorta', qty: 1, unit: '' },
      { name: 'Kahvaltı', qty: 1, unit: '' },
    ],
    shared: [
      { name: 'Otobüs', qty: 1, unit: '' },
      { name: 'Rehber', qty: 1, unit: '' },
      { name: 'Free Pax (Ücretsiz Misafir)', qty: 0, unit: '' },
      { name: 'Yol Parası/Otoban', qty: 0, unit: '' },
    ],
    sellTwin: '', sellSingle: '',
    estTwin: 20, estSingle: 5,
  };
  const [c, setC] = useState(initial?.cost ? { ...emptyCost, ...initial.cost } : { ...emptyCost, tourName: initial?.title || initial?.subject || '' });
  const n = (v) => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? 0 : x; };
  const cur = c.currency || 'TL';

  // Otel toplamları
  const hotelSingle = c.hotels.reduce((s, h) => s + n(h.single) * n(h.nights || 1), 0);
  const hotelTwin = c.hotels.reduce((s, h) => s + n(h.twin) * n(h.nights || 1), 0);
  // Kişi başı gider toplamı
  const perPersonTotal = c.perPerson.reduce((s, r) => s + n(r.qty) * n(r.unit), 0);
  // Free pax birim maliyeti = otel(single) + uçak birim + fuar birim  (Excel: E16 + C21 + C22)
  const ucakUnit = n(c.perPerson.find(r => trHas(r.name, 'ucak'))?.unit);
  const fuarUnit = n(c.perPerson.find(r => trHas(r.name, 'fuar'))?.unit);
  const freePaxUnit = hotelSingle + ucakUnit + fuarUnit;
  // Ortak gider toplamı (free pax satırının birim fiyatı otomatik)
  const sharedTotal = c.shared.reduce((s, r) => {
    const unit = /free pax/i.test(r.name) ? freePaxUnit : n(r.unit);
    return s + n(r.qty) * unit;
  }, 0);
  const perPersonShared = n(c.peopleCount) > 0 ? sharedTotal / n(c.peopleCount) : 0;
  // Toplam maliyet (kişi başı)
  const costTwin = perPersonShared + perPersonTotal + hotelTwin / 2;
  const costSingle = perPersonShared + perPersonTotal + hotelSingle;
  // Kâr
  const profitTwin = n(c.sellTwin) - costTwin;
  const profitSingle = n(c.sellSingle) - costSingle;
  const marginTwin = n(c.sellTwin) > 0 ? (profitTwin / n(c.sellTwin)) * 100 : 0;
  const marginSingle = n(c.sellSingle) > 0 ? (profitSingle / n(c.sellSingle)) * 100 : 0;
  // Toplam gelir/kâr
  const totalRevenue = n(c.estTwin) * n(c.sellTwin) + n(c.estSingle) * n(c.sellSingle);
  const totalCost = n(c.estTwin) * costTwin + n(c.estSingle) * costSingle;
  const totalNetProfit = totalRevenue - totalCost;

  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('tr') + ' ' + cur;
  const inp = { width: '100%', padding: '7px 9px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' };
  const th = { padding: '6px 8px', textAlign: 'left', color: '#94a3b8', fontSize: '10px', fontWeight: '600', borderBottom: '1px solid rgba(255,255,255,0.1)' };
  const td = { padding: '4px 6px' };
  const sectionTitle = { fontSize: '13px', fontWeight: '700', color: '#e8912a', margin: '0 0 8px' };
  const card = { background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '14px', marginBottom: '12px', border: '1px solid rgba(255,255,255,0.06)' };

  const setHotel = (i, k, v) => setC({ ...c, hotels: c.hotels.map((h, j) => j === i ? { ...h, [k]: v } : h) });
  const setPP = (i, k, v) => setC({ ...c, perPerson: c.perPerson.map((r, j) => j === i ? { ...r, [k]: v } : r) });
  const setSH = (i, k, v) => setC({ ...c, shared: c.shared.map((r, j) => j === i ? { ...r, [k]: v } : r) });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 500, overflow: 'auto', padding: isMobile ? '10px' : '30px' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', background: 'linear-gradient(135deg, #0c1929, #14263d)', borderRadius: '16px', padding: isMobile ? '16px' : '24px', border: '1px solid rgba(232,145,42,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#e8912a' }}>💰 Maliyet Hesaplama <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '400' }}>(tahmini planlama)</span></h2>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', color: '#fff', width: '32px', height: '32px', cursor: 'pointer', fontSize: '16px' }}>×</button>
        </div>

        {/* Tur bilgileri */}
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '2fr 1fr 1fr', gap: '10px' }}>
            <div><label style={{ fontSize: '10px', color: '#94a3b8' }}>Tur Adı</label><input value={c.tourName} onChange={e => setC({ ...c, tourName: e.target.value })} style={inp} /></div>
            <div><label style={{ fontSize: '10px', color: '#94a3b8' }}>Kişi Sayısı</label><input type="number" value={c.peopleCount} onChange={e => setC({ ...c, peopleCount: e.target.value })} style={inp} /></div>
            <div><label style={{ fontSize: '10px', color: '#94a3b8' }}>Para Birimi</label>
              <select value={c.currency} onChange={e => setC({ ...c, currency: e.target.value })} style={inp}>{['TL','€','$','£'].map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}</select>
            </div>
          </div>
        </div>

        {/* Otel */}
        <div style={card}>
          <p style={sectionTitle}>🏨 Otel Bilgileri</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '480px' }}>
              <thead><tr><th style={th}>Otel Adı</th><th style={th}>Gece</th><th style={th}>Single (kişi)</th><th style={th}>Twin (kişi)</th><th style={th}></th></tr></thead>
              <tbody>
                {c.hotels.map((h, i) => (
                  <tr key={i}>
                    <td style={td}><input value={h.name} onChange={e => setHotel(i, 'name', e.target.value)} style={inp} placeholder="Otel adı" /></td>
                    <td style={{ ...td, width: '70px' }}><input type="number" value={h.nights} onChange={e => setHotel(i, 'nights', e.target.value)} style={inp} /></td>
                    <td style={{ ...td, width: '100px' }}><input type="number" value={h.single} onChange={e => setHotel(i, 'single', e.target.value)} style={inp} /></td>
                    <td style={{ ...td, width: '100px' }}><input type="number" value={h.twin} onChange={e => setHotel(i, 'twin', e.target.value)} style={inp} /></td>
                    <td style={{ ...td, width: '30px' }}>{c.hotels.length > 1 && <button onClick={() => setC({ ...c, hotels: c.hotels.filter((_, j) => j !== i) })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>🗑️</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setC({ ...c, hotels: [...c.hotels, { name: '', nights: 1, single: '', twin: '' }] })} style={{ marginTop: '8px', padding: '5px 12px', background: 'rgba(232,145,42,0.15)', border: '1px solid rgba(232,145,42,0.3)', borderRadius: '6px', color: '#e8912a', cursor: 'pointer', fontSize: '11px' }}>➕ Otel Satırı</button>
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8' }}>Toplam otel (kişi başı): Single <b style={{ color: '#e8f1f8' }}>{fmt(hotelSingle)}</b> · Twin <b style={{ color: '#e8f1f8' }}>{fmt(hotelTwin)}</b></div>
        </div>

        {/* Kişi başı giderler */}
        <div style={card}>
          <p style={sectionTitle}>👤 Kişi Başı Giderler</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '420px' }}>
              <thead><tr><th style={th}>Gider Kalemi</th><th style={th}>Adet</th><th style={th}>Birim Fiyat</th><th style={th}>Toplam</th><th style={th}></th></tr></thead>
              <tbody>
                {c.perPerson.map((r, i) => (
                  <tr key={i}>
                    <td style={td}><input value={r.name} onChange={e => setPP(i, 'name', e.target.value)} style={inp} /></td>
                    <td style={{ ...td, width: '70px' }}><input type="number" value={r.qty} onChange={e => setPP(i, 'qty', e.target.value)} style={inp} /></td>
                    <td style={{ ...td, width: '100px' }}><input type="number" value={r.unit} onChange={e => setPP(i, 'unit', e.target.value)} style={inp} /></td>
                    <td style={{ ...td, width: '90px', color: '#e8f1f8' }}>{fmt(n(r.qty) * n(r.unit))}</td>
                    <td style={{ ...td, width: '30px' }}><button onClick={() => setC({ ...c, perPerson: c.perPerson.filter((_, j) => j !== i) })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>🗑️</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setC({ ...c, perPerson: [...c.perPerson, { name: '', qty: 1, unit: '' }] })} style={{ marginTop: '8px', padding: '5px 12px', background: 'rgba(232,145,42,0.15)', border: '1px solid rgba(232,145,42,0.3)', borderRadius: '6px', color: '#e8912a', cursor: 'pointer', fontSize: '11px' }}>➕ Satır</button>
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8' }}>Toplam kişi başı gider: <b style={{ color: '#e8f1f8' }}>{fmt(perPersonTotal)}</b></div>
        </div>

        {/* Ortak giderler */}
        <div style={card}>
          <p style={sectionTitle}>👥 Ortak Giderler (Grup)</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '420px' }}>
              <thead><tr><th style={th}>Gider Kalemi</th><th style={th}>Adet/Gün</th><th style={th}>Birim Fiyat</th><th style={th}>Toplam</th><th style={th}></th></tr></thead>
              <tbody>
                {c.shared.map((r, i) => {
                  const isFreePax = /free pax/i.test(r.name);
                  const unit = isFreePax ? freePaxUnit : n(r.unit);
                  return (
                    <tr key={i}>
                      <td style={td}><input value={r.name} onChange={e => setSH(i, 'name', e.target.value)} style={inp} /></td>
                      <td style={{ ...td, width: '70px' }}><input type="number" value={r.qty} onChange={e => setSH(i, 'qty', e.target.value)} style={inp} /></td>
                      <td style={{ ...td, width: '100px' }}>{isFreePax ? <span style={{ fontSize: '11px', color: '#64748b' }} title="Otomatik: otel+uçak+fuar">{fmt(freePaxUnit)} (oto)</span> : <input type="number" value={r.unit} onChange={e => setSH(i, 'unit', e.target.value)} style={inp} />}</td>
                      <td style={{ ...td, width: '90px', color: '#e8f1f8' }}>{fmt(n(r.qty) * unit)}</td>
                      <td style={{ ...td, width: '30px' }}><button onClick={() => setC({ ...c, shared: c.shared.filter((_, j) => j !== i) })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>🗑️</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button onClick={() => setC({ ...c, shared: [...c.shared, { name: '', qty: 1, unit: '' }] })} style={{ marginTop: '8px', padding: '5px 12px', background: 'rgba(232,145,42,0.15)', border: '1px solid rgba(232,145,42,0.3)', borderRadius: '6px', color: '#e8912a', cursor: 'pointer', fontSize: '11px' }}>➕ Satır</button>
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8' }}>Toplam ortak gider: <b style={{ color: '#e8f1f8' }}>{fmt(sharedTotal)}</b> · Kişi başı: <b style={{ color: '#e8f1f8' }}>{fmt(perPersonShared)}</b></div>
        </div>

        {/* Maliyet & Kâr */}
        <div style={{ ...card, background: 'rgba(232,145,42,0.06)', border: '1px solid rgba(232,145,42,0.25)' }}>
          <p style={sectionTitle}>📊 Maliyet & Kâr Özeti (kişi başı)</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '380px' }}>
              <thead><tr><th style={th}></th><th style={th}>Twin</th><th style={th}>Single</th></tr></thead>
              <tbody>
                <tr><td style={{ ...td, color: '#94a3b8' }}>Toplam Maliyet</td><td style={{ ...td, color: '#ef4444', fontWeight: '600' }}>{fmt(costTwin)}</td><td style={{ ...td, color: '#ef4444', fontWeight: '600' }}>{fmt(costSingle)}</td></tr>
                <tr><td style={{ ...td, color: '#94a3b8' }}>Satış Fiyatı</td>
                  <td style={td}><input type="number" value={c.sellTwin} onChange={e => setC({ ...c, sellTwin: e.target.value })} style={{ ...inp, width: '110px' }} /></td>
                  <td style={td}><input type="number" value={c.sellSingle} onChange={e => setC({ ...c, sellSingle: e.target.value })} style={{ ...inp, width: '110px' }} /></td>
                </tr>
                <tr><td style={{ ...td, color: '#94a3b8' }}>Kişi Başı Kâr</td><td style={{ ...td, color: profitTwin >= 0 ? '#10b981' : '#ef4444', fontWeight: '700' }}>{fmt(profitTwin)}</td><td style={{ ...td, color: profitSingle >= 0 ? '#10b981' : '#ef4444', fontWeight: '700' }}>{fmt(profitSingle)}</td></tr>
                <tr><td style={{ ...td, color: '#94a3b8' }}>Kâr Marjı</td><td style={{ ...td, color: '#3b82f6' }}>%{marginTwin.toFixed(1)}</td><td style={{ ...td, color: '#3b82f6' }}>%{marginSingle.toFixed(1)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Toplam gelir/kâr */}
        <div style={{ ...card, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)' }}>
          <p style={{ ...sectionTitle, color: '#10b981' }}>💵 Tahmini Toplam Gelir & Kâr</p>
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
            <div><label style={{ fontSize: '10px', color: '#94a3b8' }}>Tahmini Twin kişi</label><input type="number" value={c.estTwin} onChange={e => setC({ ...c, estTwin: e.target.value })} style={{ ...inp, width: '90px' }} /></div>
            <div><label style={{ fontSize: '10px', color: '#94a3b8' }}>Tahmini Single kişi</label><input type="number" value={c.estSingle} onChange={e => setC({ ...c, estSingle: e.target.value })} style={{ ...inp, width: '90px' }} /></div>
            <div style={{ fontSize: '11px', color: '#94a3b8', alignSelf: 'end' }}>Toplam: <b style={{ color: '#e8f1f8' }}>{n(c.estTwin) + n(c.estSingle)} kişi</b></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: '8px' }}>
            <div style={{ background: 'rgba(255,255,255,0.04)', padding: '10px', borderRadius: '8px', textAlign: 'center' }}><div style={{ fontSize: '15px', fontWeight: '700', color: '#10b981' }}>{fmt(totalRevenue)}</div><div style={{ fontSize: '10px', color: '#64748b' }}>Toplam Gelir</div></div>
            <div style={{ background: 'rgba(255,255,255,0.04)', padding: '10px', borderRadius: '8px', textAlign: 'center' }}><div style={{ fontSize: '15px', fontWeight: '700', color: '#ef4444' }}>{fmt(totalCost)}</div><div style={{ fontSize: '10px', color: '#64748b' }}>Toplam Maliyet</div></div>
            <div style={{ background: totalNetProfit >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', padding: '10px', borderRadius: '8px', textAlign: 'center', border: `1px solid ${totalNetProfit >= 0 ? '#10b98140' : '#ef444440'}` }}><div style={{ fontSize: '16px', fontWeight: '800', color: totalNetProfit >= 0 ? '#10b981' : '#ef4444' }}>{fmt(totalNetProfit)}</div><div style={{ fontSize: '10px', color: '#64748b' }}>{totalNetProfit >= 0 ? '📈 NET KÂR' : '📉 NET ZARAR'}</div></div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>Kapat</button>
          <button onClick={() => onSave(c)} style={{ padding: '10px 24px', background: 'linear-gradient(135deg, #e8912a, #d97706)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>💾 Kaydet</button>
        </div>
      </div>
    </div>
  );
}

export const flightAutoItems = (f, ret) => {
  const legs = (f?.legs || []).filter(l => hhmm(l.dep) != null);
  if (!legs.length) return [];
  const pt = (s) => { const x = String(s || '').split('·')[0].trim().split(/\s+/); const iata = /^[A-Z]{3}$/.test(x[x.length - 1] || '') ? x.pop() : ''; return { city: x.join(' '), iata }; };
  const hm = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const timeOf = (s) => { const m = hhmm(s); return m == null ? '' : hm(m); };
  const first = pt(legs[0].dep);
  const out = [];
  // shift: uçuş tarihinden kaç gün sonra (aktarma gece yarısını geçerse ya da varış (+1) ise ertesi güne düşer)
  let shift = 0, prevArr = null;
  if (ret) out.push({ time: '', text: 'Otelden çıkış ve havalimanına transfer.', auto: true, shift: 0 });
  out.push({ time: hm(hhmm(legs[0].dep) - 180), text: `${first.city || 'Havalimanı'}${first.iata ? ` (${first.iata})` : ''} havalimanında toplanma ve check-in işlemleri (uçuştan 3 saat önce).`, auto: true, shift: 0 });
  legs.forEach((l, i) => {
    const to = pt(l.arr), last = i === legs.length - 1, dep = hhmm(l.dep), arr = hhmm(l.arr);
    if (prevArr != null && dep != null && dep < prevArr) shift++;
    out.push({ time: timeOf(l.dep), text: `${String(l.airline || '').trim() ? `${String(l.airline).trim()} ile ` : ''}${trDative(to.city) || 'varış noktasına'} uçuş.`, auto: true, shift });
    if (arr != null && (/\+\s?1/.test(String(l.arr)) || arr < dep)) shift++;
    if (arr != null) out.push({ time: timeOf(l.arr), text: last ? `${trDative(to.city) || 'Varış noktasına'} varış.${ret ? ' Turumuzun sonu.' : ''}` : `${trDative(to.city)} varış, aktarma.`, auto: true, shift });
    prevArr = arr;
  });
  if (!ret) out.push({ time: '', text: 'Pasaport ve bagaj işlemlerinin ardından otele transfer.', auto: true, shift });
  return out;
};

// ✈️ Teklifte uçuş girilince gidiş/dönüş gününe otomatik maddeler: 3 saat önce havalimanında toplanma, uçuş, varış.
// Maddeler auto:true işaretli; elle düzeltilen madde işareti kaybeder. Gün boşsa ya da sadece otomatik maddeler varsa yazılır.
export const trDative = (w) => { // "Stuttgart" → "Stuttgart'a", "İzmir" → "İzmir'e", "Roma" → "Roma'ya"
  const t = String(w || '').trim(); if (!t) return '';
  const v = (trLower(t).match(/[aeıioöuü]/g) || []).pop() || 'a';
  const e = 'aıou'.includes(v) ? 'a' : 'e';
  return `${t}'${/[aeıioöuü]$/.test(trLower(t)) ? 'y' : ''}${e}`;
};
