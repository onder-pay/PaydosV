// 🎫 Turlar modülü
import { DEFAULT_SHARE_MSG, RES_LINK_DOCS, TavsiyelerModal, genContractHTML, genOfferHTML, makeTourProgramPdf, refreshTourShareLinks, resFlightList, visaAppBelongsTo, vizeSartiBul, addTourToCustomerLink, customerLinkSlug, pdfUrlText, publishCustomerLink, ticketFlightsOf } from '../components/shared';
import { Fragment, useEffect, useRef, useState } from 'react';
import { MEAL_CONCEPTS, MEAL_EN, VIZE_DURUM, placeTr, schengenCountries, tourCountries } from '../lib/data.js';
import { XLSX, jsPDF } from '../lib/heavy.js';
import { YarismaModal } from './Yarisma';
import { addCanvasPaged, pdfExtractPages, pdfFileText, pdfFit, pdfMergeParts, pdfPagesText, pdfText } from '../lib/pdf.js';
import { db } from '../lib/firebase.js';
import { deleteDoc, doc, setDoc, getDoc } from 'firebase/firestore';
import { flightSortKey, nameWords, detectFlights } from '../lib/docparse.js';
import { formatDate, formatPhoneNumber, formatWhatsAppPhone, generateUniqueId, getDaysLeft, safeParseJSON, safeParseObj, waUrl } from '../lib/format.js';
import { getActiveBanks } from '../lib/banks.js';
import { greenExemptIn, greenPassportStatus, passportValidityFor } from '../lib/travel.js';
import { inputStyle, labelStyle, selectStyle } from '../components/ui';
import { logActivity, mailHtml, sendMailRequest } from '../lib/api.js';
import { nameForSave, normEmail, normalizeTr, titleCaseTr, trHas } from '../lib/turkish.js';
import { fetchFile, loadJSZip, passportImageOf, safeFileName, saveBlob } from '../lib/files.js';


export function ToursModule({ tours, setTours, customers, setCustomers, visaApplications = [], isMobile, showToast, addToUndo, appSettings, onNavigateToCustomer, currentUser, initialTourId, onTourOpened, quickAction, onQuickActionDone, onGo, quotes = [] }) {
  // Tur programını PDF olarak aç: tekliften gelen TAM teklif verisiyle (uçuş+program+otel+hizmet) genOfferHTML üret
  const openTourProgram = (tour) => {
    const o = tour.offerData;
    if (!o) { showToast?.('Bu turda program bilgisi yok (tekliften aktarılmadı)', 'warning'); return; }
    const html = genOfferHTML(o);
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
    else showToast?.('Açılır pencere engellendi — izin verin', 'error');
  };
  // Tur programı PDF'ini üret (returnBlob=true → blob döner, false → indirir)
  const [progBusy, setProgBusy] = useState('');
  const tourProgramPdf = makeTourProgramPdf;
  // Elle açılmış turu bir tur teklifine bağla: program (offerData) gelir, paylaşılmış linkler yenilenir,
  // bundan sonra teklif her güncellendiğinde tur da güncellenir (fromQuoteId)
  const [linkBusy, setLinkBusy] = useState('');
  const linkTourToQuote = async (tour, q) => {
    if (!window.confirm(`"${tour.name}" turu "${q.subject || q.offer?.title}" teklifine bağlansın mı?\n\nTurun programı ve uçuşları bu tekliften alınır, müşterilere gönderilmiş linkler güncellenir. Fiyatlar ve rezervasyonlar değişmez.`)) return;
    setLinkBusy(tour.id);
    const upd = { ...tour, offerData: q.offer, fromQuoteId: q.id, offerUpdatedAt: new Date().toISOString() };
    try {
      setTours(prev => prev.map(t => t.id === tour.id ? upd : t));
      if (selectedTour?.id === tour.id) setSelectedTour(upd);
      const sd = { ...upd }; delete sd._docId;
      await setDoc(doc(db, 'tours', tour._docId || String(tour.id)), sd, { merge: true });
      let n = 0;
      try { n = await refreshTourShareLinks(upd); } catch (e) { showToast?.('⚠️ Program bağlandı ama linkler yenilenemedi: ' + e.message, 'warning'); return; }
      showToast?.(`✅ Program teklife bağlandı${n ? ` · ${n} müşteri linki güncellendi` : ''}`, 'success');
    } catch (e) { showToast?.('❌ Bağlanamadı: ' + e.message, 'error'); }
    finally { setLinkBusy(''); }
  };
  const downloadTourProgram = async (tour) => {
    if (!tour.offerData) { showToast?.('Bu turda program bilgisi yok (tekliften aktarılmadı)', 'warning'); return; }
    setProgBusy(tour.id);
    try { await tourProgramPdf(tour); showToast?.('Tur programı indirildi', 'success'); }
    catch (e) { showToast?.('PDF oluşturulamadı: ' + e.message, 'error'); }
    finally { setProgBusy(''); }
  };
  // Blob → base64 (data: prefix'siz saf base64)
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('base64 dönüşüm hatası'));
    r.readAsDataURL(blob);
  });

  const [showForm, setShowForm] = useState(false);
  const [showReservationForm, setShowReservationForm] = useState(false);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [showCustList, setShowCustList] = useState(false);
  const [selectedTour, setSelectedTour] = useState(null);
  // Müşteri kartından geri dönüldüğünde en son açık olan turu tekrar aç
  useEffect(() => {
    if (initialTourId && !selectedTour) {
      const t = tours.find(x => String(x.id) === String(initialTourId));
      if (t) { setSelectedTour(t); onTourOpened?.(); }
    }
  }, [initialTourId, tours]);

  // OTOMATİK ONARIM: Açılan turda customerId='new' (müşteriye bağlanmamış) rezervasyonları
  // gerçek müşteriye bağla — varsa mevcut müşteriye, yoksa yeni müşteri kaydı aç.
  const onarımYapıldı = useRef({});
  useEffect(() => {
    if (!selectedTour || !customers.length) return;
    if (onarımYapıldı.current[selectedTour.id]) return; // her tur için bir kez
    const bagsizlar = (selectedTour.reservations || []).filter(r => r.customerId === 'new' && r.customerName && !r.cancelled);
    if (!bagsizlar.length) { onarımYapıldı.current[selectedTour.id] = true; return; }
    onarımYapıldı.current[selectedTour.id] = true;

    const sadele = (s) => normalizeTr((s || '').replace(/\s*\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\s*/g, ' ').replace(/\s+/g, ' ').trim());
    let yeniCustomers = [...customers];
    let bagli = 0, olusturuldu = 0;
    const now = new Date().toISOString();

    const guncelRez = (selectedTour.reservations || []).map(r => {
      if (r.customerId !== 'new' || !r.customerName || r.cancelled) return r;
      const hedef = sadele(r.customerName);
      // 1) Mevcut müşteride ara (isim normalize + boşluksuz)
      let cust = yeniCustomers.find(c => sadele(`${c.firstName} ${c.lastName}`) === hedef)
        || yeniCustomers.find(c => sadele(`${c.firstName} ${c.lastName}`).replace(/\s/g, '') === hedef.replace(/\s/g, ''));
      if (cust) { bagli++; }
      else {
        // 2) Yoksa yeni müşteri oluştur
        const temiz = (r.customerName || '').replace(/\s*\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\s*/g, ' ').replace(/\s+/g, ' ').trim();
        const parts = temiz.split(/\s+/);
        const newId = generateUniqueId();
        cust = {
          id: newId, _docId: newId,
          firstName: nameForSave(parts[0] || ''), lastName: nameForSave(parts.slice(1).join(' ')),
          phone: r.customerPhone || '', email: r.customerEmail || '', company: r.company || '',
          tcKimlik: '', birthDate: '', birthPlace: '', city: '', sector: '', notes: '', tkMemberNo: '',
          passports: '[]', schengenVisas: '[]', usaVisa: '{}', tags: '[]', activities: '[]',
          verified: false, createdBy: 'Tur Onarım', createdAt: now, updatedAt: now
        };
        yeniCustomers.push(cust);
        setDoc(doc(db, 'customers', newId), cust).catch(() => {});
        olusturuldu++;
      }
      return { ...r, customerId: cust.id, customerName: `${titleCaseTr(cust.firstName)} ${titleCaseTr(cust.lastName)}`.trim() };
    });

    if (bagli + olusturuldu > 0) {
      if (olusturuldu > 0) setCustomers(yeniCustomers);
      const yeniTur = { ...selectedTour, reservations: guncelRez };
      setTours(prev => prev.map(t => t.id === selectedTour.id ? yeniTur : t));
      setSelectedTour(yeniTur);
      // Firestore'a turu yaz
      try { const docId = selectedTour._docId || String(selectedTour.id); const sd = { ...yeniTur }; delete sd._docId; setDoc(doc(db, 'tours', docId), sd, { merge: true }).catch(() => {}); } catch (e) {}
      showToast?.(`${bagli + olusturuldu} katılımcı müşteri kaydına bağlandı${olusturuldu ? ` (${olusturuldu} yeni kayıt)` : ''}`, 'success');
    }
  }, [selectedTour, customers]);
  const [editingTour, setEditingTour] = useState(null);
  const [editingReservation, setEditingReservation] = useState(null);
  const [roomingTour, setRoomingTour] = useState(null);
  const [tavsiye, setTavsiye] = useState(null); // ⭐ Tavsiyeler penceresi: { focusCity }
  const [yarismaTour, setYarismaTour] = useState(null); // 🏆 Bilgi yarışması (canlı)
  const [detailedView, setDetailedView] = useState({}); // {tourId: bool}
  const [showCancelled, setShowCancelled] = useState({}); // {tourId: bool} — iptal listesini aç/kapa
  const [excelTour, setExcelTour] = useState(null); // 📥 sütun seçmeli Excel penceresi
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
    invoiceType: 'personal', // 'personal' veya 'company'
    roomType: 'Double',
    roommate: '',
    roommate3: '',
    roommate4: '',
    hasChild: false,
    passport: '',
    hasVisa: false,
    visaEndDate: '',
    tourPrice: 0,
    currency: '€',
    payment1: 0,
    payment2: 0,
    payment3: 0,
    notes: '',
    cancelReason: ''
  });

  const filteredTours = tours.filter(tour => {
    const matchesSearch = !searchQuery || 
      normalizeTr(tour.name).includes(normalizeTr(searchQuery)) ||
      normalizeTr(tour.country).includes(normalizeTr(searchQuery)) ||
      normalizeTr(tour.city).includes(normalizeTr(searchQuery));
    
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

  // ⚡ Dashboard kısayolu: modül açılınca istenen formu hemen aç
  const [pendingResCust, setPendingResCust] = useState(null);
  useEffect(() => { if (!quickAction) return; if (quickAction === 'new') openNewForm();
    else if (quickAction?.type === 'resForMany') {
      const t = tours.find(x => String(x.id) === String(quickAction.tourId));
      if (t) addBulkReservations(t, quickAction.customers || []);
      else showToast?.('Tur bulunamadı', 'error');
    }
    else if (quickAction?.type === 'resFor') {
      const t = tours.find(x => String(x.id) === String(quickAction.tourId));
      if (t) { openReservationForm(t); setPendingResCust(String(quickAction.customer?.id ?? '')); }
      else showToast?.('Tur bulunamadı', 'error');
    }
    onQuickActionDone?.(); }, [quickAction]);
  // Müşteriler'den "Tura ekle": form açıldıktan sonra müşteriyi seçili getir (taze state ile)
  useEffect(() => { if (showReservationForm && pendingResCust) { handleCustomerSelect({ target: { value: pendingResCust } }); setPendingResCust(null); } }, [showReservationForm, pendingResCust]);

  const openEditForm = (tour) => {
    setFormData({...tour});
    setEditingTour(tour);
    setShowForm(true);
  };

  // ====== TUR VOUCHER (oda bazlı, İngilizce - otele gönderilir) ======
  const ascii = (text) => {
    if (!text) return '';
    return String(text)
      .replace(/ı/g, 'i').replace(/İ/g, 'I').replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
      .replace(/ü/g, 'u').replace(/Ü/g, 'U').replace(/ş/g, 's').replace(/Ş/g, 'S')
      .replace(/ö/g, 'o').replace(/Ö/g, 'O').replace(/ç/g, 'c').replace(/Ç/g, 'C');
  };

  const generateTourVoucher = (tour, hi, room, roomNo, returnDoc = false) => {
    const doc = new jsPDF();
    const T = pdfText(doc);
    const fmtEN = (d) => {
      if (!d) return '-';
      const dt = new Date(d);
      if (isNaN(dt)) return d;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      return `${days[dt.getDay()]}, ${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
    };
    const nightsCalc = (a,b) => { try { const d=Math.round((new Date(b)-new Date(a))/86400000); return d>0?d:0; } catch { return 0; } };
    const mealPlan = (c) => MEAL_EN[c] || c || MEAL_EN.bb;
    const checkIn = hi.checkIn || tour.startDate || '';
    const checkOut = hi.checkOut || tour.endDate || '';
    const nights = nightsCalc(checkIn, checkOut);
    const now = new Date();

    // Header - Acente
    doc.setFontSize(20); doc.setTextColor(220, 53, 69);
    doc.text('Paydos Tur', 20, 20);
    doc.setFontSize(8); doc.setTextColor(100);
    doc.text('Paydos Tourism and Travel Agency Co. Ltd.', 20, 26);
    doc.text(T('Mehmetçik Mah. Ulus Cad. No: 124/1 Denizli / Turkey'), 20, 30);
    doc.text(`Tel: +90 258 263 71 76 | Email: ${T(currentUser?.email || 'vize@paydostur.com')}`, 20, 34);

    doc.setFontSize(20); doc.setTextColor(40);
    doc.text('HOTEL VOUCHER', 195, 22, { align: 'right' });
    doc.setFontSize(10); doc.setTextColor(220, 53, 69);
    const vno = `V-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-R${roomNo}`;
    doc.text(vno, 195, 30, { align: 'right' });
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Issued: ${now.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][now.getMonth()]} ${now.getFullYear()}`, 195, 36, { align: 'right' });

    // HOTEL DETAILS
    doc.setDrawColor(220, 53, 69); doc.setFillColor(255, 248, 248);
    doc.rect(20, 45, 175, 35, 'FD');
    doc.setFontSize(9); doc.setTextColor(220, 53, 69);
    doc.text('HOTEL DETAILS', 24, 51);
    const resCode = hi.bookingCode || '';
    doc.setTextColor(40);
    doc.text(pdfFit(doc, T(hi.name || tour.name || ''), resCode ? 108 : 166, 14, 10), 24, 58);
    doc.setTextColor(80);
    if (hi.address) doc.text(pdfFit(doc, `Address: ${T(hi.address)}`, 166, 9, 7), 24, 64);
    const loc = `${T(hi.city || '')}${hi.country ? ', ' + T(hi.country) : ''}`;
    if (loc.trim()) doc.text(pdfFit(doc, `Location: ${loc}`, 166, 9, 7), 24, 69);
    if (hi.phone) doc.text(pdfFit(doc, `Phone: ${T(hi.phone)}`, 166, 9, 7), 24, 74);
    if (resCode) {
      doc.setFillColor(220, 53, 69); doc.rect(135, 48, 58, 9, 'F');
      doc.setFontSize(7); doc.setTextColor(255,255,255);
      doc.text('RESERVATION CODE', 164, 52, { align: 'center' });
      doc.text(pdfFit(doc, T(resCode), 55, 10, 7), 164, 56, { align: 'center' });
    }

    // GUEST DETAILS (oda misafirleri)
    let yPos = 88;
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`GUEST DETAILS — ROOM ${roomNo}`, 20, yPos);
    doc.setDrawColor(220, 220, 220); doc.line(20, yPos + 2, 195, yPos + 2);
    yPos += 8;
    doc.setFontSize(11); doc.setTextColor(40);
    room.forEach((g, i) => {
      doc.text(pdfFit(doc, `${i+1}. ${T(g.customerName || '')}`, 166, 11, 8), 24, yPos);
      yPos += 6;
    });
    yPos += 4;

    // ACCOMMODATION DETAILS
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text('ACCOMMODATION DETAILS', 20, yPos);
    doc.line(20, yPos + 2, 195, yPos + 2);
    yPos += 9;
    doc.setFontSize(10); doc.setTextColor(40);
    const roomType = roomTypeLabel(room[0]?.roomType) || hi.roomType || 'Standard';
    doc.text(`Check-in:  ${fmtEN(checkIn)}`, 24, yPos); yPos += 6;
    doc.text(`Check-out: ${fmtEN(checkOut)}`, 24, yPos); yPos += 6;
    doc.text(pdfFit(doc, `Nights: ${nights}   |   Room Type: ${T(roomType)}   |   Guests: ${room.length}`, 166, 10, 8), 24, yPos); doc.setFontSize(10); yPos += 6;
    doc.text(`Meal Plan: ${mealPlan(hi.concept)}`, 24, yPos); yPos += 10;

    // Damga + ödeme notu + koşullar (~84mm) altbilgiye taşacaksa yeni sayfaya geç
    if (yPos + 84 > 276) { doc.addPage(); yPos = 20; }
    // PAID damgası
    doc.setDrawColor(34,197,94); doc.setLineWidth(1.5);
    doc.roundedRect(145, yPos, 50, 13, 2, 2, 'S');
    doc.setFontSize(6); doc.setTextColor(120);
    doc.text('PAYMENT STATUS', 170, yPos + 4, { align: 'center' });
    doc.setFontSize(13); doc.setTextColor(34,197,94);
    doc.text('PAID', 170, yPos + 10, { align: 'center' });
    doc.setLineWidth(0.2); doc.setDrawColor(220, 53, 69);
    yPos += 17;

    // PAYMENT NOTICE
    doc.setFillColor(254, 226, 226); doc.setDrawColor(220, 53, 69);
    doc.rect(20, yPos, 175, 13, 'FD');
    doc.setFontSize(10); doc.setTextColor(220, 53, 69);
    doc.text('PAYMENT TO BE SETTLED BY THE AGENCY', 105, yPos + 6, { align: 'center' });
    doc.setFontSize(7); doc.setTextColor(80);
    doc.text('This voucher confirms the reservation made by Paydos Tourism on behalf of the guest.', 105, yPos + 10.5, { align: 'center' });
    yPos += 18;

    // Notlar (kompakt)
    doc.setFontSize(9); doc.setTextColor(220, 53, 69);
    doc.text('Important. Please Note', 20, yPos); yPos += 4.5;
    doc.setFontSize(6); doc.setTextColor(90);
    [
      'Hotels may charge additional mandatory fees payable by the guest directly at the property, including but not exclusively: resort fee, facility fee, city tax, fee for the stay of foreign citizens.',
      'The guest can be also asked to provide a credit card or cash deposit as a guarantee of payment for additional services such as: mini-bar, pay-TV, etc.',
      'Agency is not responsible for the quality of services provided by the hotel. In case of any issues during check-in or check-out, please contact the Agency.'
    ].forEach(p => { const l = doc.splitTextToSize(p, 175); doc.text(l, 20, yPos); yPos += l.length * 2.7 + 1.3; });
    yPos += 2.5;
    doc.setFontSize(9); doc.setTextColor(220, 53, 69);
    doc.text('Amendment & Cancellation Policy', 20, yPos); yPos += 4.5;
    doc.setFontSize(6); doc.setTextColor(90);
    [
      'An alteration of Reservation by the Customer is considered as a cancellation of Reservation and making new Reservation. We will try to negotiate the order amendment with the supplier but we cannot guarantee it will be approved.',
      'Cancellation of reservation or no-show may result in penalties, according to rate and contract terms.',
      'Please notify in advance if you expect to check-in after 6 pm. Hotel may cancel the reservation and charge the no-show fee in case you do not show up by that time.'
    ].forEach(p => { const l = doc.splitTextToSize(p, 175); doc.text(l, 20, yPos); yPos += l.length * 2.7 + 1.3; });

    // Footer
    doc.setDrawColor(220, 53, 69); doc.setLineWidth(0.3); doc.line(20, 278, 190, 278);
    doc.setFontSize(8); doc.setTextColor(80);
    doc.text('Paydos Tourism and Travel Agency Co. Ltd.', 105, 282, { align: 'center' });
    doc.setTextColor(120);
    doc.text(T('Mehmetçik Mah. Ulus Cad. No: 124/1 Denizli / Turkey'), 105, 286, { align: 'center' });
    doc.text(`Tel: +90 258 263 71 76 | Email: ${T(currentUser?.email || 'vize@paydostur.com')}`, 105, 290, { align: 'center' });
    doc.setTextColor(150);
    doc.text(`www.paydostur.com | ${vno}`, 105, 294, { align: 'center' });

    const guestName = ascii(room[0]?.customerName || `Room${roomNo}`).replace(/\s+/g, '_');
    const fileName = `Voucher_${ascii(tour.name||'').replace(/\s+/g,'_')}_Oda${roomNo}_${guestName}.pdf`;
    if (returnDoc) return { doc, fileName };
    doc.save(fileName);
  };

  // Odalama: rezervasyonları oda tipine ve oda arkadaşlarına göre odalara böler.
  // Odalama ekranı ve rezervasyon satırındaki 🏨 otel belgesi aynı oda numaralarını kullanır.
  const buildRoomTypes = (tour) => {
    const reservations = (tour.reservations || []).filter(r => !r.cancelled);
    const roomTypes = {}; const assigned = new Set();
    const roomCap = (rt) => { const s = normalizeTr(rt); if (/single|tek ki/.test(s)) return 1; if (/triple|uclu|3 ki/.test(s)) return 3; if (/quad|dortlu|4 ki|aile/.test(s)) return 4; return 2; };

    // Bir kişinin oda arkadaşı isimleri (tüm slotlar)
    const arkadasIsimleri = (c) => [c.roommate, c.roommate3, c.roommate4].filter(Boolean);
    // Çift yönlü: x, oda grubundaki HERHANGİ birinin arkadaşı mı (ya da tersi)
    const grubaAitMi = (x, grup) => grup.some(g =>
      x.customerName !== g.customerName && (
        arkadasIsimleri(g).includes(x.customerName) ||
        arkadasIsimleri(x).includes(g.customerName)
      )
    );

    reservations.forEach(r => {
      if (assigned.has(r.id)) return;
      const type = roomTypeLabel(r.roomType) || '-';
      if (!roomTypes[type]) roomTypes[type] = [];
      const cap = roomCap(type);
      const room = [r]; assigned.add(r.id);
      // Kapasite dolana kadar, gruptan birinin arkadaşı olan kişileri ekle
      let eklendi = true;
      while (room.length < cap && eklendi) {
        eklendi = false;
        for (const x of reservations) {
          if (assigned.has(x.id)) continue;
          if (grubaAitMi(x, room)) { room.push(x); assigned.add(x.id); eklendi = true; if (room.length >= cap) break; }
        }
      }
      roomTypes[type].push(room);
    });
    return roomTypes;
  };
  // Bir rezervasyonun odası ve oda numarası (odalama ekranındaki sırayla)
  const findResRoom = (tour, resId) => {
    let n = 0;
    for (const rooms of Object.values(buildRoomTypes(tour))) {
      for (const room of rooms) { n++; if (room.some(r => r.id === resId)) return { room, roomNo: n }; }
    }
    return null;
  };
  const openResHotelVoucher = (tour, res) => {
    const hi = tour.voucherHotel || {};
    if (!hi.name) { showToast?.('Önce Odalama ekranında otel bilgilerini girin', 'warning'); return; }
    const found = findResRoom(tour, res.id);
    if (!found) { showToast?.('Bu kişi odalamada bulunamadı', 'error'); return; }
    try { generateTourVoucher(tour, hi, found.room, found.roomNo); }
    catch (e) { showToast?.('Otel belgesi oluşturulamadı: ' + e.message, 'error'); }
  };

  // 🔗 BELGE LİNKİ: müşteriye tek link — tur programı, otel giriş belgesi, uçak ve fuar bileti.
  // PDF'ler üretilip Storage'a yüklenir, özet Firestore'da paylasimlar/{token} olarak tutulur;
  // /b/{token} sayfası (public/belgeler.html) girişsiz gösterir. Tekrar paylaşımda aynı link güncellenir.
  const [shareBusy, setShareBusy] = useState('');
  const [shareReady, setShareReady] = useState(null); // { link, text, phone, count }
  const newShareToken = () => {
    const abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => abc[b % abc.length]).join('');
  };
  const shareResLink = async (tour, res) => {
    if (shareBusy) return;
    setShareBusy(res.id);
    try {
      const token = res.shareToken || newShareToken();
      const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const up = async (name, blob) => {
        const r = ref(getStorage(), `paylasim/${token}/${name}`);
        await uploadBytes(r, blob, { contentType: 'application/pdf' });
        return getDownloadURL(r);
      };
      const docs = [];
      if (tour.offerData) {
        const p = await tourProgramPdf(tour, true);
        docs.push({ icon: '🗺️', label: 'Tur Programı', url: await up('tur-programi.pdf', p.blob) });
      } else if (tour.pdfUrl) docs.push({ icon: '🗺️', label: 'Tur Programı', url: tour.pdfUrl }); // tura elle yüklenmiş program PDF'i
      const hi = tour.voucherHotel || {};
      const room = hi.name ? findResRoom(tour, res.id) : null;
      if (room) {
        const { doc: vdoc } = generateTourVoucher(tour, hi, room.room, room.roomNo, true);
        docs.push({ icon: '🏨', label: `Otel Giriş Belgesi — ${hi.name}`, url: await up('otel-giris-belgesi.pdf', vdoc.output('blob')) });
      }
      RES_LINK_DOCS.forEach(([f, icon, label]) => { if (res[f]) docs.push({ icon, label, url: res[f] }); });
      const flights = resFlightList(tour, res);
      if (!docs.length && !flights.length) { showToast?.('Paylaşılacak belge yok (program, odalama oteli veya bilet ekleyin)', 'warning'); return; }
      const custForLink = (customers || []).find(c => String(c.id) === String(res.customerId) || (c._docId && c._docId === String(res.customerId)));
      let nextLink = '';
      try {
        nextLink = await ensureCustomerLink(custForLink, appSettings);
        if (nextLink && custForLink) setCustomers?.(prev => prev.map(c => c.id === custForLink.id ? { ...c, shareToken: nextLink } : c));
        if (nextLink) await addTourToCustomerLink(nextLink, tour, token);
      } catch (e) { console.warn('[müşteri linki]', e.message); }
      await setDoc(doc(db, 'paylasimlar', token), {
        ...(nextLink ? { nextLink } : {}),
        customerName: res.customerName || '', tourName: tour.name || '', tourId: String(tour.id),
        country: tour.country || '', city: tour.city || '', startDate: tour.startDate || '', endDate: tour.endDate || '',
        docs, flights, updatedAt: new Date().toISOString(), createdBy: currentUser?.name || '',
        // Sayfadaki otel kartı (adres + yol tarifi) ve acil iletişim
        hotel: hi.name ? { name: hi.name || '', address: hi.address || '', city: hi.city || '', country: hi.country || '', phone: hi.phone || '' } : null,
        contact: { phone: appSettings?.shareContact?.phone || '+90 258 263 71 76', whatsapp: tour.contactWhatsapp || appSettings?.shareContact?.whatsapp || '', instagram: appSettings?.shareContact?.instagram ?? 'paydostur', hours: appSettings?.shareContact?.hours || '' }
      });
      if (res.shareToken !== token) await patchTourReservations(tour.id, { [res.id]: { shareToken: token } });
      const link = `${window.location.origin}/b/${token}`;
      const belgeler = [...docs.map(d => d.label.split(' — ')[0]), ...(flights.length ? ['Uçuş Takibi'] : [])].join(', ');
      const tpl = (appSettings?.shareMessageTemplate || '').trim() || DEFAULT_SHARE_MSG;
      let text = tpl.replace(/\{isim\}/g, res.customerName || '').replace(/\{tur\}/g, tour.name || 'Tur').replace(/\{belgeler\}/g, belgeler).replace(/\{link\}/g, link);
      if (!text.includes(link)) text += `\n${link}`; // şablonda {link} unutulsa da link gitsin
      // Telefon: önce müşteri kaydındaki, sonra rezervasyondaki — TC'ye benzeyen değer atlanır (formatWhatsAppPhone boş döner)
      const cust = (customers || []).find(c => String(c.id) === String(res.customerId) || (c._docId && c._docId === String(res.customerId)));
      const phone = [cust?.phone, res.customerPhone].map(formatWhatsAppPhone).find(Boolean) || '';
      setShareReady({ link, text, phone, name: res.customerName, count: docs.length + (flights.length ? 1 : 0) });
    } catch (e) {
      showToast?.('Link hazırlanamadı: ' + e.message, 'error');
    } finally { setShareBusy(''); }
  };

  // Voucher'ı WhatsApp/paylaş menüsüne gönder (mobilde dosya ekli paylaşım)
  const shareTourVoucher = async (tour, hi, room, roomNo) => {
    if (!hi?.name) { showToast?.('Önce otel bilgilerini girin (Odalama formu)', 'warning'); return; }
    try {
      const { doc, fileName } = generateTourVoucher(tour, hi, room, roomNo, true);
      const blob = doc.output('blob');
      const file = new File([blob], fileName, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName, text: `${tour.name} - Otel Voucher` });
      } else {
        doc.save(fileName);
        showToast?.('Bu cihaz dosya paylaşımını desteklemiyor — voucher indirildi, WhatsApp\'tan elle ekleyin', 'info');
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
      showToast?.('Voucher paylaşılamadı: ' + e.message, 'error');
    }
  };

  // JSZip'i CDN'den dinamik yükle (toplu voucher için)
  // ===== Katılımcı bazlı Paket Tur Sözleşmesi =====
  const [szBusy, setSzBusy] = useState('');
  const loadH2C = () => new Promise((resolve, reject) => {
    if (window.html2canvas) return resolve(window.html2canvas);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error('html2canvas yüklenemedi'));
    document.head.appendChild(s);
  });
  // Rezervasyon + tur + müşteriden sözleşme verisi kur
  const buildContractFor = (tour, res) => {
    let cust = customers.find(c => String(c.id) === String(res.customerId));
    if (!cust) cust = customers.find(c => normalizeTr(`${c.firstName} ${c.lastName}`) === normalizeTr(res.customerName || ''));
    const pps = cust ? safeParseJSON(cust.passports).filter(p => p.passportNo).map(p => ({
      name: `${cust.firstName} ${cust.lastName}`.trim(), no: p.passportNo,
      issueDate: p.issueDate, expiryDate: p.expiryDate, birthPlace: placeTr(cust.birthPlace)
    })) : [];
    const vz = vizeSartiBul(tour.country);
    const kat = [];
    // Oda arkadaşları (roommate) sözleşmeye katılımcı olarak EKLENMEZ — her kişinin kendi ayrı kaydı/sözleşmesi var.
    // Sadece açıkça eklenmiş ek misafirler (guestNames, örn. çocuk) katılımcı olur.
    (res.guestNames || []).filter(x => x && x.trim()).forEach(n => {
      if (!kat.some(k => normalizeTr(k.name) === normalizeTr(n))) kat.push({ name: n.trim(), tc: '', address: '', phone: '' });
    });
    const cur = res.currency || tour.prices?.doubleRoom?.currency || '€';
    return {
      tuketici: (() => {
        const tc = cust?.tcKimlik || '';
        let phone = res.customerPhone || cust?.phone || '';
        // Telefon yanlışlıkla TC ile aynı girilmişse gösterme (veri hatası koruması)
        if (phone && tc && phone.replace(/\D/g, '') === tc.replace(/\D/g, '')) phone = '';
        return {
          name: res.customerName || (cust ? `${cust.firstName} ${cust.lastName}` : ''),
          company: cust?.companyName || cust?.company || res.company || '',
          tc, address: cust?.city || '',
          phone, email: res.customerEmail || cust?.email || ''
        };
      })(),
      katilimcilar: kat, passports: pps,
      startDate: tour.startDate || '', endDate: tour.endDate || '',
      baslangicYeri: appSettings?.city || 'Denizli',
      guzergah: [tour.city, tour.country].filter(Boolean).join(' / '),
      konaklama: tour.name || '',
      yemekPlani: 'Oda + Kahvaltı',
      ulasim: '',
      yerTahsisi: 'Ekonomi Sınıfı Koltuklar. Şehir içinde otobüs ile ulaşım ve transfer hizmetleri olacaktır.',
      araKonaklama: 'Ara konaklama yoktur.',
      vizeUlke: tour.country || '', vizeSarti: vz.metin || '',
      yasSarti: 'Yaş şartı bulunmamaktadır.', asiSarti: 'Aşı şartı bulunmamaktadır.', iklimNot: '',
      fiyatDouble: res.tourPrice || '', fiyatSingle: '', paraBirimi: cur,
      sigortaBedeli: '15€', onOdeme: '', sonOdeme: '', ozelTalepler: true, programDays: []
    };
  };
  const contractPdfFor = async (tour, res, returnBlob = false) => {
    const data = buildContractFor(tour, res);
    let holder = null;
    try {
      const html2canvas = await loadH2C();
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;background:#fff;z-index:-1';
      const full = genContractHTML(data, getActiveBanks(appSettings));
      const b = full.match(/<body>([\s\S]*)<\/body>/), st = full.match(/<style>([\s\S]*?)<\/style>/);
      holder.innerHTML = `<style>${st ? st[1] : ''}</style><div style="padding:16px;background:#fff;font-family:'Segoe UI',Arial,sans-serif;font-size:9.5px;line-height:1.45;color:#1a1a1a">${b ? b[1] : ''}</div>`;
      document.body.appendChild(holder);
      await new Promise(r => setTimeout(r, 320));
      const canvas = await html2canvas(holder, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const pdf = new jsPDF('p', 'mm', 'a4');
      addCanvasPaged(pdf, canvas, 0.9);
      const ad = (data.tuketici.name || 'Musteri').replace(/[^\wğüşıöçĞÜŞİÖÇ ]/g, '').replace(/\s+/g, '_');
      if (returnBlob) return { name: `Sozlesme_${ad}.pdf`, blob: pdf.output('blob') };
      pdf.save(`Sozlesme_${ad}.pdf`);
      return null;
    } finally { if (holder) document.body.removeChild(holder); }
  };
  const singleContract = async (tour, res) => {
    setSzBusy(res.id);
    try { await contractPdfFor(tour, res); showToast('Sözleşme indirildi', 'success'); }
    catch (e) { showToast('Sözleşme oluşturulamadı: ' + e.message, 'error'); }
    finally { setSzBusy(''); }
  };
  const bulkContracts = async (tour) => {
    const list = (tour.reservations || []).filter(r => !r.cancelled);
    if (!list.length) { showToast('Katılımcı yok', 'warning'); return; }
    if (!window.confirm(`${list.length} katılımcı için ayrı ayrı sözleşme oluşturulacak ve ZIP olarak inecek. Devam?`)) return;
    setSzBusy('bulk');
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      for (let i = 0; i < list.length; i++) {
        showToast(`Sözleşme ${i + 1}/${list.length} hazırlanıyor...`, 'info');
        const r = await contractPdfFor(tour, list[i], true);
        zip.file(r.name, r.blob);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(out);
      const a = document.createElement('a');
      a.href = url; a.download = `${(tour.name || 'Tur').replace(/\s+/g,'_')}_Sozlesmeler.zip`;
      a.click(); URL.revokeObjectURL(url);
      showToast(`${list.length} sözleşme indirildi`, 'success');
    } catch (e) { showToast('Toplu sözleşme hatası: ' + e.message, 'error'); }
    finally { setSzBusy(''); }
  };

  // 🛂 Turdaki yolcuların pasaport görselleri tek ZIP: "01_Ad_Soyad.jpg" (rezervasyon sırasıyla)
  const [ppBusy, setPpBusy] = useState(false);
  const bulkPassports = async (tour) => {
    const list = (tour.reservations || []).filter(r => !r.cancelled);
    if (!list.length) { showToast('Katılımcı yok', 'warning'); return; }
    const custOf = (r) => customers.find(c => String(c.id) === String(r.customerId) || (c._docId && c._docId === String(r.customerId)))
      || customers.find(c => normalizeTr(`${c.firstName} ${c.lastName}`) === normalizeTr(r.customerName || ''));
    const rows = list.map(r => ({ r, img: passportImageOf(custOf(r)) }));
    const missing = rows.filter(x => !x.img).map(x => titleCaseTr(x.r.customerName || '?'));
    const todo = rows.filter(x => x.img);
    if (!todo.length) { showToast('Bu turda pasaport görseli olan yolcu yok', 'warning'); return; }
    setPpBusy(true);
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      let fail = [];
      for (let i = 0; i < todo.length; i++) {
        const { r, img } = todo[i];
        showToast(`Pasaport ${i + 1}/${todo.length} indiriliyor...`, 'info');
        try { const { blob, ext } = await fetchFile(img); zip.file(`${String(i + 1).padStart(2, '0')}_${safeFileName(titleCaseTr(r.customerName || 'yolcu'))}.${ext}`, blob); }
        catch (e) { fail.push(titleCaseTr(r.customerName || '?')); }
      }
      saveBlob(await zip.generateAsync({ type: 'blob' }), `${safeFileName(tour.name || 'Tur')}_Pasaportlar.zip`);
      const notes = [missing.length ? `${missing.length} kişinin görseli yok: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}` : '', fail.length ? `${fail.length} görsel indirilemedi: ${fail.slice(0, 5).join(', ')}` : ''].filter(Boolean).join(' · ');
      showToast(`🛂 ${todo.length - fail.length} pasaport ZIP olarak indirildi${notes ? ' · ' + notes : ''}`, notes ? 'warning' : 'success');
    } catch (e) { showToast('Pasaportlar indirilemedi: ' + e.message, 'error'); }
    finally { setPpBusy(false); }
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
      addToUndo({ type: 'delete', undo: () => setTours(old) });
      try {
        const docId = tour._docId || String(tour.id);
        await deleteDoc(doc(db, 'tours', docId));
      } catch(e) { console.warn('Tur Firestore silme hatası:', e.message); }
    }
  };

  // ===== Excel ile toplu rezervasyon yükleme =====
  const [bulkResBusy, setBulkResBusy] = useState(false);
  // ===== Toplu Mail =====
  const [showBulkMail, setShowBulkMail] = useState(false);
  const [bulkMailTour, setBulkMailTour] = useState(null);
  const [bulkMailSubject, setBulkMailSubject] = useState('');
  const [bulkMailBody, setBulkMailBody] = useState('');
  const [bulkMailSending, setBulkMailSending] = useState(false);
  const [bulkMailResult, setBulkMailResult] = useState(null);
  const [bulkMailAttach, setBulkMailAttach] = useState([]); // seçili ek id'leri
  const [autoAttachProgram, setAutoAttachProgram] = useState(true); // Tur Programı otomatik ekle
  const [autoAttachContract, setAutoAttachContract] = useState(true); // kişiye özel Sözleşme otomatik ekle
  const openBulkMail = (tour) => {
    setBulkMailTour(tour);
    const tpl = appSettings?.tourMailTemplate || {};
    // Ayarlardaki şablon varsa onu kullan, yoksa varsayılan
    setBulkMailSubject(tpl.subject || `${tour.name} - Bilgilendirme`);
    setBulkMailBody(tpl.body || `Sayın {isim},\n\n{tur} turumuz ({tarih}) ile ilgili bilgilendirme:\n\n\n\nSaygılarımızla,\nPaydos Turizm`);
    setBulkMailResult(null);
    setBulkMailAttach([]);
    setShowBulkMail(true);
  };
  const sendBulkMail = async () => {
    const tour = bulkMailTour;
    // Seçili rezervasyon varsa sadece onlara, yoksa tüm aktiflere
    const activeAll = (tour.reservations || []).filter(r => !r.cancelled);
    const active = selectedRes.length > 0 ? activeAll.filter(r => selectedRes.includes(r.id)) : activeAll;
    // Her katılımcının e-postasını + rezervasyon kaydını bul
    const recipients = [];
    const noEmail = [];
    active.forEach(res => {
      const cust = customers.find(c => String(c.id) === String(res.customerId)) ||
        customers.find(c => normalizeTr(`${c.firstName} ${c.lastName}`) === normalizeTr(res.customerName || ''));
      const email = (cust?.email || res.customerEmail || '').trim();
      if (email) recipients.push({ name: res.customerName, email, res });
      else noEmail.push(res.customerName);
    });
    if (!recipients.length) { showToast('Hiçbir katılımcının e-postası yok', 'error'); return; }
    if (!bulkMailSubject.trim() || !bulkMailBody.trim()) { showToast('Konu ve mesaj zorunlu', 'error'); return; }
    setBulkMailSending(true);
    let sent = 0, failed = 0;
    const tourFrom = (appSettings?.smtpTour?.from || '').trim() || undefined; // boşsa function SMTP_FROM'a düşer
    const tarih = `${formatDate(tour.startDate)} - ${formatDate(tour.endDate)}`;
    // Seçili (elle) ekleri hazırla — URL bazlı
    const allAtt = appSettings?.attachments || [];
    const baseAttachments = allAtt.filter(a => bulkMailAttach.includes(a.id)).map(a => ({ filename: a.name, url: a.url }));
    // Tura yüklü tur programı + sözleşme (varsa, URL bazlı) — eski davranış korunur
    if (tour.pdfUrl) baseAttachments.push({ filename: `${tour.name} - Tur Programi.pdf`, url: tour.pdfUrl });
    if (tour.contractUrl) baseAttachments.push({ filename: `${tour.name} - Sozlesme.pdf`, url: tour.contractUrl });

    // OTOMATIK: Tur Programı (herkese aynı) — tekliften üret, base64 (bir kez üret, tekrar kullan)
    let programAttach = null;
    if (autoAttachProgram && tour.offerData) {
      try {
        showToast('Tur programı hazırlanıyor...', 'info');
        const p = await tourProgramPdf(tour, true);
        const b64 = await blobToBase64(p.blob);
        programAttach = { filename: `${tour.name} - Tur Programi.pdf`.replace(/[^\wğüşıöçĞÜŞİÖÇ .\-]/g, '_'), contentBase64: b64 };
      } catch (e) { showToast('Program eklenemedi: ' + e.message, 'warning'); }
    }

    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      const subject = bulkMailSubject.replace(/{isim}/g, r.name).replace(/{tur}/g, tour.name).replace(/{tarih}/g, tarih);
      const bodyText = bulkMailBody.replace(/{isim}/g, r.name).replace(/{tur}/g, tour.name).replace(/{tarih}/g, tarih);
      const html = mailHtml(bodyText);
      // Bu kişiye gidecek ekler = ortak elle ekler + ortak program + KİŞİYE ÖZEL sözleşme
      const perAttachments = [...baseAttachments];
      if (programAttach) perAttachments.push(programAttach);
      if (autoAttachContract) {
        try {
          showToast(`Sözleşme ${i + 1}/${recipients.length} hazırlanıyor...`, 'info');
          const c = await contractPdfFor(tour, r.res, true); // { name, blob }
          const cb64 = await blobToBase64(c.blob);
          perAttachments.push({ filename: c.name.replace(/[^\wğüşıöçĞÜŞİÖÇ .\-]/g, '_'), contentBase64: cb64 });
        } catch (e) { /* sözleşme üretilemezse mail yine gitsin */ }
      }
      try {
        const resp = await sendMailRequest({
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: r.email, from: tourFrom, subject, html, text: bodyText, attachments: perAttachments, smtp: appSettings?.smtpTour })
        });
        if (resp.ok) sent++; else failed++;
      } catch (e) { failed++; }
    }
    setBulkMailSending(false);
    setBulkMailResult({ sent, failed, noEmail });
    showToast(`${sent} mail gönderildi${failed ? `, ${failed} başarısız` : ''}${noEmail.length ? `, ${noEmail.length} e-postasız` : ''}`, failed ? 'warning' : 'success');
  };
  const [selectedRes, setSelectedRes] = useState([]); // seçili rezervasyon id'leri
  // ===== Giderler (sadece muhasebe + admin) =====
  const canSeeExpenses = currentUser?.role === 'muhasebe' || currentUser?.role === 'admin';
  const emptyExpense = { type: 'Otel', description: '', amount: '', currency: '€', paid: false, date: '' };
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const saveExpense = async (tour) => {
    const ex = editingExpense;
    if (!ex.amount || parseFloat(ex.amount) <= 0) { showToast?.('Tutar girin', 'error'); return; }
    let newExpenses;
    if (ex.id) newExpenses = (tour.expenses || []).map(x => x.id === ex.id ? { ...ex, amount: parseFloat(ex.amount) } : x);
    else newExpenses = [...(tour.expenses || []), { ...ex, amount: parseFloat(ex.amount), id: Date.now(), addedBy: currentUser?.name || currentUser?.email || '', createdAt: new Date().toISOString() }];
    const updatedTour = { ...tour, expenses: newExpenses };
    setTours(prev => prev.map(t => t.id === tour.id ? updatedTour : t));
    setSelectedTour(updatedTour);
    try {
      const docId = tour._docId || String(tour.id);
      const sd = { ...updatedTour }; delete sd._docId;
      await setDoc(doc(db, 'tours', docId), sd, { merge: true });
      showToast?.(ex.id ? 'Gider güncellendi' : 'Gider eklendi', 'success');
    } catch (e) { showToast?.('Kaydedilemedi: ' + e.message, 'error'); }
    setShowExpenseForm(false); setEditingExpense(null);
  };
  const deleteExpense = async (tour, expId) => {
    if (!window.confirm('Bu gideri silmek istiyor musunuz?')) return;
    const newExpenses = (tour.expenses || []).filter(x => x.id !== expId);
    const updatedTour = { ...tour, expenses: newExpenses };
    setTours(prev => prev.map(t => t.id === tour.id ? updatedTour : t));
    setSelectedTour(updatedTour);
    try {
      const docId = tour._docId || String(tour.id);
      const sd = { ...updatedTour }; delete sd._docId;
      await setDoc(doc(db, 'tours', docId), sd, { merge: true });
      showToast?.('Gider silindi', 'info');
    } catch (e) { showToast?.('Silinemedi: ' + e.message, 'error'); }
  };
  const bulkDeleteReservations = async (tour) => {
    if (!selectedRes.length) return;
    if (!window.confirm(`${selectedRes.length} rezervasyonu KALICI olarak silmek istediğinizden emin misiniz?\n\nBu işlem geri alınamaz.`)) return;
    const targetTour = tours.find(t => t.id === tour.id);
    if (!targetTour) return;
    const updatedTour = { ...targetTour, reservations: targetTour.reservations.filter(r => !selectedRes.includes(r.id)) };
    const u = tours.map(t => t.id === tour.id ? updatedTour : t);
    setTours(u); setSelectedTour(updatedTour);
    try {
      const docId = targetTour._docId || String(targetTour.id);
      const sd = { ...updatedTour }; delete sd._docId;
      await setDoc(doc(db, 'tours', docId), sd, { merge: true });
    } catch (e) { showToast('❌ Kaydedilemedi: ' + e.message, 'error'); return; }
    showToast(`${selectedRes.length} rezervasyon silindi`, 'info');
    setSelectedRes([]);
  };
  const roomTypeKeyFromLabel = (label, tourPrices) => {
    const genKey = String(label || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const map = { 'single': 'singleRoom', 'tek': 'singleRoom', 'tek_kiilik': 'singleRoom', 'double': 'doubleRoom', 'çift': 'doubleRoom', 'twin': 'doubleRoom', 'triple': 'tripleRoom', 'üçlü': 'tripleRoom', 'suite': 'suiteRoom' };
    const candidates = [genKey, map[String(label || '').toLowerCase()], label].filter(Boolean);
    for (const k of candidates) if (tourPrices?.[k]?.amount > 0) return k;
    const nrt = normalizeTr(label).replace(/\s+/g, '_');
    for (const k of Object.keys(tourPrices || {})) if (normalizeTr(k).includes(nrt) || nrt.includes(normalizeTr(k))) return k;
    return genKey || 'doubleRoom';
  };
  const handleBulkResUpload = async (tour, file) => {
    if (!file) return;
    setBulkResBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showToast('Excel boş görünüyor', 'error'); return; }
      let newCustomers = [...customers];
      const newReservations = [];
      let created = 0, matched = 0, skipped = 0;
      const tcConflicts = [], phoneWarn = [];
      // Telefon: "+90 5064413266", "5326462814", "+90 533 515 22 77" → "+90 506 441 32 66". TR cep değilse olduğu gibi kalır, uyarılır.
      const phoneDigits = (x) => { let d = String(x || '').replace(/\D/g, ''); if (d.startsWith('90') && d.length === 12) d = d.slice(2); if (d.startsWith('0') && d.length === 11) d = d.slice(1); return d; };
      const fmtPhone = (x) => { const d = phoneDigits(x); return /^5\d{9}$/.test(d) ? formatPhoneNumber(d) : String(x || '').trim(); };
      // Turda zaten var olan isimler (mükerrer yüklemeyi önle)
      const existingNames = new Set((tour.reservations || []).filter(r => !r.cancelled).map(r => normalizeTr(r.customerName || '')));
      for (const row of rows) {
        const name = String(row['Ad Soyad'] || row['Ad Soyad*'] || '').trim();
        if (!name) continue;
        // Bu turda zaten varsa atla
        if (existingNames.has(normalizeTr(name))) { skipped++; continue; }
        existingNames.add(normalizeTr(name)); // aynı dosyada da tekrar varsa engelle
        const phoneRaw = String(row['Telefon'] || '').trim();
        const phone = fmtPhone(phoneRaw);
        if (phoneRaw && !/^5\d{9}$/.test(phoneDigits(phoneRaw))) phoneWarn.push(`${name}: telefon "${phoneRaw}" geçerli bir cep numarası değil — kontrol edin`);
        const email = normEmail(row['E-posta'] || row['Email'] || '');
        const tcKimlik = String(row['TC Kimlik No'] || row['TC'] || '').trim().replace(/\D/g, '');
        const roomLabel = String(row['Oda Tipi'] || 'Double').trim();
        const priceRaw = row['Tur Bedeli'] ?? row['Fiyat'] ?? 0;
        const currency = String(row['Para Birimi'] || row['Para'] || '€').trim() || '€';
        const paid = parseFloat(row['Ödenen'] ?? row['1. Ödeme'] ?? 0) || 0;
        const passport = String(row['Pasaport No'] || '').trim();
        // Müşteri eşleştir veya oluştur
        // Aynı isimde birden fazla müşteri olabilir ("Mehmet Sarı"): telefonu tutan seçilir; tutmuyorsa uyarılır
        const sameName = newCustomers.filter(c => normalizeTr(`${c.firstName} ${c.lastName}`) === normalizeTr(name));
        const pd = phoneDigits(phoneRaw);
        let cust = (pd && sameName.find(c => phoneDigits(c.phone) === pd)) || sameName[0];
        if (cust && pd && cust.phone && phoneDigits(cust.phone) !== pd) phoneWarn.push(`${name}: CRM'deki aynı isimli müşterinin telefonu farklı (${cust.phone} ≠ ${phoneRaw})${sameName.length > 1 ? ` · bu isimde ${sameName.length} müşteri var` : ''} — aynı kişi mi kontrol edin`);
        // TC eşsizdir: aynı TC varsa o kişidir; isim farklıysa uyar
        const byTc = tcKimlik.length === 11 ? newCustomers.find(c => String(c.tcKimlik || '').trim() === tcKimlik) : null;
        if (byTc && (!cust || cust !== byTc)) {
          if (normalizeTr(`${byTc.firstName} ${byTc.lastName}`) !== normalizeTr(name)) tcConflicts.push(`${name} ↔ ${titleCaseTr(`${byTc.firstName || ''} ${byTc.lastName || ''}`)} (TC ${tcKimlik})`);
          cust = byTc;
        } else if (cust && tcKimlik && cust.tcKimlik && String(cust.tcKimlik).trim() !== tcKimlik) {
          tcConflicts.push(`${name}: Excel TC ${tcKimlik} ≠ kayıtlı TC ${cust.tcKimlik}`);
        }
        if (!cust) {
          // İsimdeki doğum tarihini temizle + titleCase
          const temizName = name.replace(/\s*\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\s*/g, ' ').replace(/\s+/g, ' ').trim();
          const parts = temizName.split(/\s+/);
          const newId = generateUniqueId();
          cust = { id: newId, _docId: newId, firstName: nameForSave(parts[0]), lastName: nameForSave(parts.slice(1).join(' ')), phone, email, tcKimlik, createdAt: new Date().toISOString().split('T')[0], updatedAt: new Date().toISOString(), verified: false, passports: '[]', schengenVisas: '[]', usaVisa: '{}' };
          newCustomers.push(cust);
          try { await setDoc(doc(db, 'customers', newId), cust); } catch (e) {}
          created++;
        } else {
          matched++;
          // Eşleşen müşteride boş olan alanları Excel'den doldur (TC, telefon, e-posta)
          const patch = {};
          if (tcKimlik && !cust.tcKimlik) patch.tcKimlik = tcKimlik;
          if (phone && !cust.phone) patch.phone = phone;
          if (email && !cust.email) patch.email = email;
          if (Object.keys(patch).length) {
            cust = { ...cust, ...patch, updatedAt: new Date().toISOString() };
            newCustomers = newCustomers.map(c => c.id === cust.id ? cust : c);
            try { await setDoc(doc(db, 'customers', cust._docId || String(cust.id)), patch, { merge: true }); } catch (e) {}
          }
        }
        const roomKey = roomTypeKeyFromLabel(roomLabel, tour.prices);
        const tourPrice = parseFloat(priceRaw) || tour.prices?.[roomKey]?.amount || 0;
        newReservations.push({
          id: Date.now() + Math.random(), sNo: (tour.reservations?.length || 0) + newReservations.length + 1,
          customerId: cust.id, customerName: `${cust.firstName} ${cust.lastName}`.trim(),
          customerPhone: phone || cust.phone || '', customerEmail: email || cust.email || '', company: '',
          roomType: String(roomLabel || '').trim() || roomTypeLabel(roomKey), roommate: '', roommate3: '', hasChild: false,
          passport, hasVisa: false, visaEndDate: '',
          tourPrice, currency: tour.prices?.[roomKey]?.currency || currency,
          payment1: paid, payment2: 0, payment3: 0, notes: '', label: ''
        });
      }
      if (!newReservations.length) { showToast('Geçerli satır bulunamadı (Ad Soyad sütunu boş)', 'error'); return; }
      setCustomers(newCustomers);
      setTours(prev => prev.map(t => t.id === tour.id ? { ...t, reservations: [...(t.reservations || []), ...newReservations] } : t));
      showToast(`${newReservations.length} rezervasyon eklendi (${created} yeni müşteri, ${matched} eşleşen)${skipped > 0 ? ` · ${skipped} mükerrer atlandı` : ''}`, 'success');
      if (phoneWarn.length) alert(`📞 Kontrol edilecek (${phoneWarn.length}):\n\n${phoneWarn.slice(0, 30).join('\n')}${phoneWarn.length > 30 ? `\n… +${phoneWarn.length - 30}` : ''}`);
      if (tcConflicts.length) alert(`⚠️ TC uyuşmazlığı (${tcConflicts.length}) — TC eşsizdir, isim veya TC hatalı olabilir, kontrol ediniz:\n\n${tcConflicts.slice(0, 30).join('\n')}${tcConflicts.length > 30 ? `\n… +${tcConflicts.length - 30}` : ''}`);
    } catch (e) {
      showToast('Excel okunamadı: ' + e.message, 'error');
    } finally {
      setBulkResBusy(false);
    }
  };

  const downloadBulkResTemplate = () => {
    const headers = ['Ad Soyad*', 'TC Kimlik No', 'Telefon', 'E-posta', 'Oda Tipi', 'Tur Bedeli', 'Para Birimi', 'Ödenen', 'Pasaport No'];
    const examples = [
      ['Ahmet Yılmaz', '12345678901', '5551234567', 'ahmet@example.com', 'Double', 1300, '€', 500, 'U12345678'],
      ['Ayşe Yılmaz', '12345678902', '5551234567', 'ayse@example.com', 'Double', 1300, '€', 500, 'U12345679'],
      ['Mehmet Kaya', '', '5559876543', '', 'Single', 1550, '€', 0, ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
    ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 16 }];
    const notes = [
      ['Sütun', 'Açıklama'],
      ['Ad Soyad*', 'ZORUNLU. Sistemde bu isimde müşteri varsa eşleştirilir; yoksa otomatik yeni müşteri oluşturulur.'],
      ['TC Kimlik No', 'Opsiyonel. Yeni müşteri oluşturulursa buraya kaydedilir. 11 haneli.'],
      ['Telefon', 'Opsiyonel. Yeni müşteri oluşturulursa buraya kaydedilir.'],
      ['E-posta', 'Opsiyonel. Yeni müşteri oluşturulursa buraya kaydedilir.'],
      ['Oda Tipi', 'Örn: Single, Double, Twin, Triple. Turun kayıtlı fiyat listesiyle otomatik eşleştirilir.'],
      ['Tur Bedeli', "Boş bırakılırsa, Oda Tipi'ne göre turun kayıtlı fiyatı otomatik kullanılır. Özel fiyat için buraya yazın."],
      ['Para Birimi', 'Boşsa turun para birimi kullanılır.'],
      ['Ödenen', 'Şimdiye kadar alınan toplam ödeme (1. Ödeme olarak işlenir). Boşsa 0 kabul edilir.'],
      ['Pasaport No', 'Opsiyonel.'],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(notes);
    ws2['!cols'] = [{ wch: 16 }, { wch: 75 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rezervasyon Listesi');
    XLSX.utils.book_append_sheet(wb, ws2, 'Açıklama');
    XLSX.writeFile(wb, 'Tur_Rezervasyon_Sablonu.xlsx');
  };

  // Müşteriler'den çoklu seçim → "Tura ekle": seçilenler varsayılan oda tipi/fiyatla tek seferde eklenir.
  // Pasaport ve vize durumu tek tek eklemedeki gibi müşteri kartından okunur; turda zaten olan atlanır.
  const addBulkReservations = async (tour, custs) => {
    const inTour = new Set((tour.reservations || []).filter(r => !r.cancelled).map(r => String(r.customerId)));
    const todo = custs.filter(c => c && !inTour.has(String(c.id)));
    const skipped = custs.length - todo.length;
    if (!todo.length) { setSelectedTour(tour); showToast?.('Seçilenlerin hepsi bu turda zaten kayıtlı', 'info'); return; }
    const rts = resRoomTypes();
    const defRt = rts.find(rt => /double|cift/.test(normalizeTr(rt))) || rts[0] || 'Double';
    const defPrice = tourPriceFor(tour, defRt) || Object.values(tour.prices || {}).find(x => x?.amount > 0);
    const isSchengen = schengenCountries.includes(tour?.country);
    const now = Date.now();
    const added = todo.map((customer, i) => {
      const passports = safeParseJSON(customer.passports);
      const validPassport = passports.find(pp => pp.passportNo && getDaysLeft(pp.expiryDate) > 0) || passports[0];
      const hasGreen = passports.some(pp => trHas(pp.passportType, 'yesil') || (pp.passportNo && pp.passportNo.toUpperCase().startsWith('S')));
      let hasVisa = false, visaEndDate = '';
      if (hasGreen && greenExemptIn(tour?.country) && greenPassportStatus(passports, tour?.endDate || tour?.startDate).ok) { hasVisa = true; visaEndDate = 'GREEN_PASSPORT'; }
      else if (isSchengen) { const v = safeParseJSON(customer.schengenVisas).find(x => x.endDate && getDaysLeft(x.endDate) > 0); if (v) { hasVisa = true; visaEndDate = v.endDate; } }
      else if (tour?.country === 'Amerika Birleşik Devletleri' || tour?.country === 'ABD') { const u = safeParseObj(customer.usaVisa); if (u.endDate && getDaysLeft(u.endDate) > 0) { hasVisa = true; visaEndDate = u.endDate; } }
      return {
        id: now + i, sNo: (tour.reservations?.length || 0) + i + 1,
        customerId: customer.id, customerName: customer.name || `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
        customerPhone: customer.phone || '', customerEmail: customer.email || '', company: customer.companyName || customer.company || '',
        roomType: defRt, roommate: '', roommate3: '', hasChild: false,
        passport: validPassport?.passportNo || '', hasVisa, visaEndDate,
        tourPrice: defPrice?.amount || 0, currency: defPrice?.currency || '€',
        payment1: 0, payment2: 0, payment3: 0, notes: '', createdAt: new Date().toISOString(),
      };
    });
    const updatedTour = { ...tour, reservations: [...(tour.reservations || []), ...added] };
    setTours(prev => prev.map(t => t.id === tour.id ? updatedTour : t));
    setSelectedTour(updatedTour);
    try {
      const sd = { ...updatedTour }; delete sd._docId;
      await setDoc(doc(db, 'tours', tour._docId || String(tour.id)), sd, { merge: true });
    } catch (e) { showToast?.('❌ Kaydedilemedi: ' + e.message, 'error'); return; }
    logActivity('create', 'Tur', `${added.length} kişi toplu eklendi — ${tour.name || ''}`, currentUser);
    showToast?.(`✅ ${added.length} kişi "${tour.name}" turuna eklendi${skipped ? ` (${skipped} kişi zaten vardı)` : ''} — oda tipi ${defRt}; oda ve fiyatları kontrol edin`, 'success');
  };
  const openReservationForm = (tour) => {
    setSelectedTour(tour);
    // Varsayılan oda tipi: listede Double/Çift varsa o, yoksa ilk tip — fiyat da o tipten
    const rts = resRoomTypes();
    const defRt = rts.find(rt => /double|cift/.test(normalizeTr(rt))) || rts[0] || 'Double';
    const defPrice = tourPriceFor(tour, defRt) || Object.values(tour.prices || {}).find(x => x?.amount > 0);
    setReservationData({
      customerId: '',
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      company: '',
      roomType: defRt,
      roommate: '',
      roommate3: '',
      hasChild: false,
      passport: '',
      hasVisa: false,
      visaEndDate: '',
      tourPrice: defPrice?.amount || 0,
      currency: defPrice?.currency || '€',
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
      // Yeşil pasaport: passportType "Yeşil" içeriyor VEYA pasaport no S ile başlıyor
      const hasGreenPassport = passports.some(p =>
        trHas(p.passportType, 'yesil') || // 'Yeşil'/'Yesil' (bot eskiden ş'siz yazdı)
        (p.passportNo && p.passportNo.toUpperCase().startsWith('S'))
      );
      let hasVisa = false;
      let visaEndDate = '';
      // Yeşil pasaport sahibi Schengen'den muaf — ancak pasaport tur bitişi + 6 ay geçerliyse
      const gpOk = hasGreenPassport && greenExemptIn(selectedTour?.country) && greenPassportStatus(passports, selectedTour?.endDate || selectedTour?.startDate).ok;
      if (gpOk) {
        hasVisa = true;
        visaEndDate = 'GREEN_PASSPORT'; // özel işaret
      } else if (isSchengen) {
        const visas = safeParseJSON(customer.schengenVisas);
        const validVisa = visas.find(v => v.endDate && getDaysLeft(v.endDate) > 0);
        if (validVisa) { hasVisa = true; visaEndDate = validVisa.endDate; }
      } else if (selectedTour?.country === 'Amerika Birleşik Devletleri' || selectedTour?.country === 'ABD') {
        const usaVisa = safeParseObj(customer.usaVisa);
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

  const tourPriceFor = (tour, rt) => {
      const p = tour?.prices || {};
      // 1) Tur formunun kullandığı key üretimi (Türkçe ad -> key)
      const genKey = String(rt).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      // 2) Eski İngilizce key eşlemesi (geriye uyumluluk)
      const priceKeyMap = {
        'Single': 'singleRoom', 'Tek': 'singleRoom', 'Tek Kişilik': 'singleRoom',
        'Double': 'doubleRoom', 'Çift': 'doubleRoom', 'Çift Kişilik': 'doubleRoom',
        'Twin': 'doubleRoom', 'Triple': 'tripleRoom', 'Üçlü': 'tripleRoom',
        'Suite': 'suiteRoom', 'Süit': 'suiteRoom',
        'Ekstra Yatak': 'extraBed', 'İlave Yatak': 'extraBed', 'Bebek': 'baby', 'Çocuk 1': 'child1', 'Çocuk 2': 'child2'
      };
      const candidates = [genKey, priceKeyMap[rt], rt, rt.toLowerCase(), `${rt.toLowerCase()}Room`].filter(Boolean);
      for (const k of candidates) {
        if (p[k]?.amount > 0) return p[k];
      }
      // 3) normalizeTr ile gevşek eşleşme: kayıtlı key'lerden ada en yakın olan
      const EQ = { single: 'tek', double: 'ift', twin: 'ift', triple: 'uc', suite: 'suit' };
      let nrt = normalizeTr(rt).replace(/\s+/g, '_');
      for (const [en, tr] of Object.entries(EQ)) { if (nrt.includes(en)) { nrt = tr; break; } }
      for (const [k, v] of Object.entries(p)) {
        if (v?.amount > 0 && (normalizeTr(k).includes(nrt) || nrt.includes(normalizeTr(k)))) return v;
      }
      return null;
  };
  const resRoomTypes = () => (appSettings?.roomTypes?.length > 0 ? appSettings.roomTypes : ['Single', 'Double', 'Twin', 'Triple']);

  const handleRoomTypeChange = (e) => {
    const roomType = e.target.value;
    let priceData = tourPriceFor(selectedTour, roomType);
    // Hâlâ bulamazsa herhangi bir geçerli fiyatı kullan
    if (!priceData && selectedTour?.prices) {
      const firstNonZero = Object.values(selectedTour.prices).find(p => p?.amount > 0);
      if (firstNonZero) priceData = firstNonZero;
    }
    const tourPrice = priceData?.amount || 0;
    const currency = priceData?.currency || reservationData.currency || '€';
    setReservationData({ ...reservationData, roomType, tourPrice, currency, basePrice: tourPrice, discount: 0 });
  };

  const openEditReservation = (tour, res) => {
    setSelectedTour(tour);
    setEditingReservation(res);
    // Müşterinin güncel pasaport ve vize bilgilerini yeniden çek
    const customer = customers.find(c => String(c.id) === String(res.customerId));
    let passport = res.passport || '';
    let hasVisa = res.hasVisa || false;
    let visaEndDate = res.visaEndDate || '';
    if (customer) {
      const passports = safeParseJSON(customer.passports);
      const validPassport = passports.find(p => p.passportNo && getDaysLeft(p.expiryDate) > 0) || passports[0];
      passport = validPassport?.passportNo || passport;
      const hasGreenPassport = passports.some(p =>
        trHas(p.passportType, 'yesil') || // 'Yeşil'/'Yesil' (bot eskiden ş'siz yazdı)
        (p.passportNo && p.passportNo.toUpperCase().startsWith('S'))
      );
      // Vize durumu - tur ülkesi Schengen mi?
      const isSchengen = schengenCountries.includes(tour?.country);
      const isUSA = tour?.country === 'Amerika Birleşik Devletleri' || tour?.country === 'ABD';
      // Yeşil pasaport sahibi Schengen'den muaf — ancak pasaport tur bitişi + 6 ay geçerliyse
      if (hasGreenPassport && greenExemptIn(tour?.country) && greenPassportStatus(passports, tour?.endDate || tour?.startDate).ok) {
        hasVisa = true;
        visaEndDate = 'GREEN_PASSPORT';
      } else if (isSchengen) {
        const visas = safeParseJSON(customer.schengenVisas);
        const validVisa = visas.find(v => v.endDate && getDaysLeft(v.endDate) > 0);
        if (validVisa) { hasVisa = true; visaEndDate = validVisa.endDate; } else { hasVisa = false; visaEndDate = ''; }
      } else if (isUSA) {
        const usaVisa = safeParseObj(customer.usaVisa);
        if (usaVisa.endDate && getDaysLeft(usaVisa.endDate) > 0) { hasVisa = true; visaEndDate = usaVisa.endDate; } else { hasVisa = false; visaEndDate = ''; }
      }
    }
    setReservationData({ ...res, roomType: roomTypeLabel(res.roomType), passport, hasVisa, visaEndDate });
    setShowReservationForm(true);
  };

  // Rezervasyona belge yükle (fuar bileti / uçak bileti) — Firebase Storage
  const [resDocBusy, setResDocBusy] = useState('');
  // Yükleme sürerken turlar değişmiş olabilir — güncellemeyi her zaman en son tur verisine uygula
  const toursRef = useRef(tours);
  toursRef.current = tours;
  const storeResDocFile = async (tour, key, file) => {
    const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const path = `tur-belgeleri/${tour.id}/${key}_${Date.now()}_${file.name}`;
    const sRef = ref(getStorage(), path);
    await uploadBytes(sRef, file);
    return { url: await getDownloadURL(sRef), path };
  };
  // patches: { [resId]: { alan: değer } } — tek yazımla turdaki rezervasyonlara uygular
  const patchTourReservations = async (tourId, patches0) => {
    const targetTour = toursRef.current.find(t => t.id === tourId);
    if (!targetTour) throw new Error('Tur bulunamadı');
    // Uçak bileti değiştiyse yolcunun uçuşlarını biletten oku (grup biletinde aynı dosya bir kez okunur)
    const patches = {}, read = new Map();
    for (const [rid, p] of Object.entries(patches0)) {
      patches[rid] = p;
      if (!('flightTicketUrl' in p) || 'ticketFlights' in p) continue;
      if (!p.flightTicketUrl) { patches[rid] = { ...p, ticketFlights: [] }; continue; }
      if (!read.has(p.flightTicketUrl)) read.set(p.flightTicketUrl, await ticketFlightsOf(p.flightTicketUrl));
      const tf = read.get(p.flightTicketUrl);
      if (tf) patches[rid] = { ...p, ticketFlights: tf };
    }
    const updatedTour = { ...targetTour, reservations: (targetTour.reservations || []).map(r => patches[r.id] ? { ...r, ...patches[r.id] } : r) };
    setTours(prev => prev.map(t => t.id === tourId ? updatedTour : t));
    setSelectedTour(prev => (prev && prev.id === tourId ? updatedTour : prev));
    const docId = targetTour._docId || String(targetTour.id);
    const sd = { ...updatedTour }; delete sd._docId;
    await setDoc(doc(db, 'tours', docId), sd, { merge: true });
    // Bilet/biniş kartı değiştiyse paylaşılmış linkleri de güncelle
    const docFields = RES_LINK_DOCS.map(x => x[0]);
    const touched = updatedTour.reservations.filter(r => r.shareToken && patches[r.id] && Object.keys(patches[r.id]).some(k => docFields.includes(k)));
    if (touched.length) await Promise.all(touched.map(r => syncResLinkDocs(r, null, updatedTour).catch(e => console.warn('[link belge]', r.shareToken, e.message))));
    return updatedTour;
  };
  // Tur açılınca: bu düzeltmeden önce yüklenen bilet/biniş kartları da paylaşılmış linklere işlensin (oturumda tur başına bir kez)
  const linkSyncedRef = useRef(new Set());
  useEffect(() => {
    const t = selectedTour;
    if (!t || linkSyncedRef.current.has(t.id)) return;
    linkSyncedRef.current.add(t.id);
    let todo = (t.reservations || []).filter(r => !r.cancelled && r.shareToken);
    if (!todo.length) return;
    (async () => {
      let n = 0, tt = t;
      // Bu özellikten önce yüklenen biletler: uçuşları bir kez okunup rezervasyona yazılır
      const unread = todo.filter(r => r.flightTicketUrl && !Array.isArray(r.ticketFlights));
      if (unread.length) {
        const patches = {};
        unread.forEach(r => { patches[r.id] = { flightTicketUrl: r.flightTicketUrl }; });
        try { tt = await patchTourReservations(t.id, patches); } catch (e) { console.warn('[bilet uçuşları]', e.message); }
        todo = (tt.reservations || []).filter(r => !r.cancelled && r.shareToken);
      }
      const getNext = (r) => async () => {
        const c = (customers || []).find(x => String(x.id) === String(r.customerId) || (x._docId && x._docId === String(r.customerId)));
        const tok = await ensureCustomerLink(c, appSettings);
        if (tok && c) setCustomers?.(prev => prev.map(x => x.id === c.id ? { ...x, shareToken: tok } : x));
        if (tok) await addTourToCustomerLink(tok, t, r.shareToken).catch(() => {});
        return tok;
      };
      for (const r of todo) { try { if (await syncResLinkDocs(r, getNext(r), tt)) n++; } catch (e) { console.warn('[link belge]', r.shareToken, e.message); } }
      if (n) showToast?.(`🔗 ${n} müşteri linkine bilet/biniş kartı işlendi`, 'success');
    })();
  }, [selectedTour?.id]);
  const uploadResDoc = async (tour, res, field, file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast?.('Dosya 10MB\'dan büyük olamaz', 'error'); return; }
    setResDocBusy(`${res.id}-${field}`);
    try {
      const { url, path } = await storeResDocFile(tour, `${res.id}_${field}`, file);
      await patchTourReservations(tour.id, { [res.id]: { [field]: url, [`${field}Path`]: path } });
      showToast?.('Belge yüklendi', 'success');
    } catch (e) { showToast?.('Yükleme hatası: ' + e.message, 'error'); }
    finally { setResDocBusy(''); }
  };

  // 📦 TOPLU BİLET: çok sayıda PDF seç → içindeki yolcu adıyla rezervasyonlara otomatik eşleştir → önizle → yükle
  const [bulkTicket, setBulkTicket] = useState(null); // { tourId, field, rows: [{ key, file, resIds, note }], busy, uploading }
  const openBulkTicket = async (tour, field, fileList) => {
    const files = Array.from(fileList || []).filter(f => f.size <= 10 * 1024 * 1024);
    if (!files.length) { showToast?.('Dosya seçilmedi (en fazla 10MB/dosya)', 'error'); return; }
    const resList = (tour.reservations || []).filter(r => !r.cancelled && r.customerName);
    setBulkTicket({ tourId: tour.id, field, rows: [], busy: true });
    // Ad-soyadın TÜM kelimeleri metinde geçiyorsa eşleşir; birden fazla kişi geçiyorsa (grup bileti) hepsine atanır
    // (Bilette ikinci ad yazılmayabilir: ilk ad + soyad geçmesi de yeterli)
    const matchRes = (words) => resList.filter(r => {
      const t = [...nameWords(r.customerName)].filter(w => w.length > 1);
      if (!t.length) return false;
      return t.every(w => words.has(w)) || (t.length >= 3 && words.has(t[0]) && words.has(t[t.length - 1]));
    }).map(r => r.id);
    // Bir sayfada birden fazla kişi eşleşirse ("Halil Işık" + "Halil İbrahim Işık") en çok kelimesi tutanı seç
    const bestOf = (ids, words) => {
      if (ids.length < 2) return ids;
      const score = (id) => [...nameWords(resList.find(r => r.id === id)?.customerName || '')].filter(w => w.length > 1 && words.has(w)).length;
      const max = Math.max(...ids.map(score));
      const top = ids.filter(id => score(id) === max);
      return top.length === 1 ? top : ids;
    };
    // Tüm belge türlerinde: çok sayfalı PDF'te sayfalar farklı yolculara aitse kişi başı bölünür
    // (havayolu toplu bileti: her yolcu 1-2 sayfa). Tek sayfada herkes yazıyorsa (grup bileti) bölünmez.
    const split = true;
    const rows = [];
    for (const [i, file] of files.entries()) {
      let resIds = [], note = '', sk = '';
      if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
        try {
          if (split) {
            // Biniş kartı: her sayfayı ayrı eşleştir; sayfalar farklı kişilere aitse PDF kişi başı bölünür
            const pages = await pdfPagesText(file);
            const per = pages.map(t => { const w = nameWords(t); return bestOf(matchRes(w), w); });
            const owners = new Set(per.filter(ids => ids.length === 1).map(ids => ids[0]));
            if (pages.length > 1 && owners.size > 1) {
              // İsimsiz sayfa (bagaj kuralları, devam sayfası) bir önceki yolcunun biletine aittir
              let last = null;
              for (let pi = 0; pi < per.length; pi++) {
                if (per[pi].length === 1) last = per[pi][0];
                else if (per[pi].length === 0 && last != null) per[pi] = [last];
              }
              const byRes = new Map();
              per.forEach((ids, pi) => { if (ids.length === 1) byRes.set(ids[0], [...(byRes.get(ids[0]) || []), pi]); });
              [...byRes.entries()].forEach(([rid, pgs], k) => rows.push({ key: `${i}_${k}_${file.name}`, file, pages: pgs, resIds: [rid], note: '', order: i, sortKey: flightSortKey(pgs.map(pi => pages[pi]).join(' ')) }));
              const rest = per.map((ids, pi) => ids.length === 1 ? -1 : pi).filter(pi => pi >= 0);
              if (rest.length) rows.push({ key: `${i}_rest_${file.name}`, file, pages: rest, resIds: [], note: `${rest.length} sayfada isim bulunamadı — elle seçin`, order: i, sortKey: '' });
              continue;
            }
          }
          const txt = await pdfFileText(file);
          sk = flightSortKey(txt);
          const words = nameWords(txt);
          if (words.size === 0) note = 'PDF\'de metin yok (taranmış olabilir) — elle seçin';
          else {
            resIds = matchRes(words);
            if (!resIds.length) note = 'İsim bulunamadı — elle seçin';
          }
        } catch (e) { note = 'PDF okunamadı — elle seçin'; }
      } else note = 'Görsel dosya — elle seçin';
      rows.push({ key: `${i}_${file.name}`, file, resIds, note, order: i, sortKey: sk });
    }
    setBulkTicket({ tourId: tour.id, field, rows, busy: false, append: false });
  };
  const runBulkTicket = async () => {
    const bt = bulkTicket; if (!bt) return;
    const todo = bt.rows.filter(r => r.resIds.length);
    if (!todo.length) { showToast?.('Eşleşen dosya yok', 'error'); return; }
    setBulkTicket({ ...bt, uploading: true });
    const tour = toursRef.current.find(t => t.id === bt.tourId);
    const patches = {}; let fail = 0, merged = 0, appendFail = 0;
    // Kişi başı parçaları topla: aktarmalı uçuşta aynı kişiye 2+ biniş kartı düşer → uçuş sırasına göre tek PDF
    const byPerson = new Map();
    todo.forEach(row => row.resIds.forEach(id => byPerson.set(id, [...(byPerson.get(id) || []), row])));
    const legOrder = (a, b) => (a.sortKey && b.sortKey && a.sortKey !== b.sortKey) ? a.sortKey.localeCompare(b.sortKey) : (a.order - b.order);
    const cache = new Map(); // aynı parça seti birden çok kişiye gidiyorsa (grup bileti) tek yükleme
    for (const [rid, rowsOf] of byPerson.entries()) {
      const res = (tour.reservations || []).find(r => r.id === rid);
      const legs = [...rowsOf].sort(legOrder);
      const appendTo = bt.append && res?.[bt.field] ? res : null;
      const sig = legs.map(r => r.key).join('|');
      try {
        let up = !appendTo && cache.get(sig);
        if (!up) {
          let f;
          if (legs.length === 1 && !appendTo) f = legs[0].pages ? await pdfExtractPages(legs[0].file, legs[0].pages) : legs[0].file;
          else {
            const parts = [];
            if (appendTo) {
              // Mevcut biniş kartını indir, yenisini sonuna ekle
              let bytes = null;
              try {
                const p = appendTo[`${bt.field}Path`];
                if (p) { const { getStorage, ref, getBytes } = await import('firebase/storage'); bytes = await getBytes(ref(getStorage(), p)); }
              } catch (e) { bytes = null; }
              if (!bytes) { try { const r = await fetch(appendTo[bt.field]); if (r.ok) bytes = await r.arrayBuffer(); } catch (e) { bytes = null; } }
              if (!bytes) { appendFail++; continue; }
              parts.push({ bytes, type: 'application/pdf' });
            }
            legs.forEach(r => parts.push({ file: r.file, pages: r.pages }));
            f = await pdfMergeParts(parts, `aktarmali_${String(res?.customerName || rid).replace(/[^\wçğıöşüÇĞİÖŞÜ]+/g, '_')}.pdf`);
            merged++;
          }
          up = await storeResDocFile(tour, `toplu_${bt.field}`, f);
          if (!appendTo) cache.set(sig, up);
        }
        patches[rid] = { [bt.field]: up.url, [`${bt.field}Path`]: up.path };
      } catch (e) { fail++; console.warn('Toplu bilet yükleme hatası', rid, e.message); }
    }
    try {
      if (Object.keys(patches).length) await patchTourReservations(bt.tourId, patches);
      const dd = RES_DOCS.find(d => d.field === bt.field) || RES_DOCS[0];
      showToast?.(`${dd.icon} ${Object.keys(patches).length} kişiye ${dd.label.toLocaleLowerCase('tr-TR')} eklendi${merged ? ` (${merged} kişide aktarmalı kartlar birleştirildi)` : ''}${fail ? `, ${fail} kişide yükleme hatası` : ''}${appendFail ? `, ${appendFail} kişinin mevcut kartı okunamadı — iki bacağı birlikte yükleyin` : ''}`, (fail || appendFail) ? 'warning' : 'success');
      setBulkTicket(null);
    } catch (e) {
      showToast?.('❌ Tura kaydedilemedi: ' + e.message, 'error');
      setBulkTicket({ ...bt, uploading: false });
    }
  };
  // Belge ikonu: tıkla = aç, sağ tık = sil. Telefonda sağ tık yok → 600 ms basılı tutunca sil (ardından gelen tıklama açmaz)
  const docPressHandlers = (onOpen, onDelete) => {
    let timer = null, fired = false;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    return {
      onClick: (e) => { if (fired) { fired = false; e.preventDefault(); return; } onOpen(); },
      onContextMenu: (e) => { e.preventDefault(); clear(); if (!fired) onDelete(); fired = false; },
      onPointerDown: (e) => { if (e.pointerType !== 'touch') return; fired = false; clear(); timer = setTimeout(() => { fired = true; timer = null; onDelete(); }, 600); },
      onPointerUp: clear, onPointerLeave: clear, onPointerCancel: clear,
    };
  };
  const removeResDoc = async (tour, res, field) => {
    if (!window.confirm('Bu belgeyi silmek istiyor musunuz?')) return;
    try {
      const p = res[`${field}Path`];
      if (p) { const { getStorage, ref, deleteObject } = await import('firebase/storage'); await deleteObject(ref(getStorage(), p)).catch(() => {}); }
    } catch (e) {}
    try {
      await patchTourReservations(tour.id, { [res.id]: { [field]: null, [`${field}Path`]: null } });
      showToast?.('Belge silindi', 'info');
    } catch (e) { showToast?.('❌ Silinemedi: ' + e.message, 'error'); }
  };

  const saveReservation = async () => {
    if (!reservationData.customerId || !reservationData.customerName) {
      showToast('Lütfen müşteri seçin', 'error');
      return;
    }

    // Yeni müşteri (customerId==='new') → önce customers'a gerçek kayıt aç, gerçek id al
    let resData = { ...reservationData };
    if (resData.customerId === 'new') {
      // İsimden ad/soyad ayır + isimdeki doğum tarihini temizle
      const cleanName = (resData.customerName || '').replace(/\s*\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\s*/g, ' ').replace(/\s+/g, ' ').trim();
      const parts = cleanName.split(' ');
      const lastName = parts.length > 1 ? parts.pop() : '';
      const firstName = parts.join(' ');
      // Aynı isimde kayıt var mı? Varsa ona bağla
      const existing = customers.find(c => normalizeTr(`${c.firstName} ${c.lastName}`) === normalizeTr(cleanName));
      if (existing) {
        resData.customerId = existing.id;
      } else {
        const newId = generateUniqueId();
        const now = new Date().toISOString();
        const newCust = {
          id: newId, _docId: newId,
          firstName: nameForSave(firstName), lastName: nameForSave(lastName),
          phone: resData.customerPhone || '', email: resData.customerEmail || '',
          company: resData.company || '', tcKimlik: '', birthDate: '', birthPlace: '',
          city: '', sector: '', notes: '', tkMemberNo: '',
          passports: '[]', schengenVisas: '[]', usaVisa: '{}', tags: '[]', activities: '[]',
          verified: false, createdBy: 'Tur Rezervasyonu', createdAt: now, updatedAt: now
        };
        setCustomers(prev => [...prev, newCust]);
        try { await setDoc(doc(db, 'customers', newId), newCust, { merge: true }); } catch (e) { console.error('Müşteri kaydı hatası:', e); }
        resData.customerId = newId;
        resData.customerName = `${titleCaseTr(firstName)} ${titleCaseTr(lastName)}`.trim();
      }
    }

    let updatedTour;
    if (editingReservation) {
      updatedTour = { ...selectedTour, reservations: selectedTour.reservations.map(r => r.id === editingReservation.id ? { ...resData, id: r.id, sNo: r.sNo } : r) };
    } else {
      const newReservation = { ...resData, id: Date.now(), sNo: (selectedTour.reservations?.length || 0) + 1 };
      updatedTour = { ...selectedTour, reservations: [...(selectedTour.reservations || []), newReservation] };
    }

    // Oda arkadaşlığını çift yönlü yap: seçilen kişilere de bu kişiyi ekle (aynı odada birbirini görsün)
    const benim = resData.customerName;
    const odaArkadaslari = [resData.roommate, resData.roommate3, resData.roommate4].filter(Boolean);
    if (benim && odaArkadaslari.length) {
      updatedTour = {
        ...updatedTour,
        reservations: updatedTour.reservations.map(r => {
          if (!odaArkadaslari.includes(r.customerName)) return r;
          // Bu kişinin oda arkadaşı slotlarına "benim"i ekle (yoksa)
          const mevcut = [r.roommate, r.roommate3, r.roommate4].filter(Boolean);
          if (mevcut.includes(benim)) return r; // zaten var
          // Boş ilk slota yerleştir
          if (!r.roommate) return { ...r, roommate: benim };
          if (!r.roommate3) return { ...r, roommate3: benim };
          if (!r.roommate4) return { ...r, roommate4: benim };
          return r; // 3 slot da dolu
        })
      };
    }

    const updatedTours = tours.map(t => t.id === selectedTour.id ? updatedTour : t);
    setTours(updatedTours);
    setSelectedTour(updatedTour);

    // Firestore'a anında yaz
    try {
      const docId = selectedTour._docId || String(selectedTour.id);
      const saveData = { ...updatedTour };
      delete saveData._docId;
      await setDoc(doc(db, 'tours', docId), saveData, { merge: true });
    } catch (err) {
      console.error('Tur kayıt hatası:', err);
      showToast('❌ Kaydedilemedi: ' + err.message, 'error');
      return;
    }

    showToast(editingReservation ? 'Rezervasyon güncellendi' : 'Rezervasyon eklendi', 'success');
    logActivity(editingReservation ? 'status' : 'create', 'Tur', `${resData.customerName || ''} — ${selectedTour?.name || ''}`.trim(), currentUser);
    setShowReservationForm(false);
    setEditingReservation(null);
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
      {tavsiye && <TavsiyelerModal focusCity={tavsiye.focusCity} onClose={() => setTavsiye(null)} showToast={showToast} isMobile={isMobile} currentUser={currentUser} />}
      {yarismaTour && <YarismaModal tour={yarismaTour} onClose={() => setYarismaTour(null)} showToast={showToast} isMobile={isMobile} />}
      {!selectedTour && <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="🔍 Tur ara (isim, ülke, şehir)..."
          style={{ flex: 1, minWidth: 0, width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '14px', boxSizing: 'border-box' }}
        />
        <button onClick={() => setTavsiye({ focusCity: '' })} title="Şehir bazlı tavsiye restoranlar — tur linklerinde görünür" style={{ padding: '0 16px', background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.35)', borderRadius: '10px', color: '#fb923c', cursor: 'pointer', fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap' }}>⭐ Tavsiyeler</button>
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
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#ffffff', lineHeight: '1.3', flex: 1, paddingRight: '8px' }}>{titleCaseTr(tour.name)}</h3>
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
            {shareReady && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setShareReady(null)}>
                <div onClick={e => e.stopPropagation()} style={{ background: '#0f2744', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '14px', padding: '20px', width: '100%', maxWidth: '420px' }}>
                  <h4 style={{ margin: '0 0 6px', fontSize: '16px' }}>🔗 Belge linki hazır</h4>
                  <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#94a3b8' }}>{shareReady.name} — {shareReady.count} belge</p>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>✏️ Gönderilecek mesaj (düzenleyebilirsiniz)</label>
                  <textarea value={shareReady.text} onChange={e => setShareReady({ ...shareReady, text: e.target.value })} rows={8}
                    style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '10px', fontSize: '13px', lineHeight: 1.45, color: '#e8f1f8', fontFamily: 'inherit', resize: 'vertical', marginBottom: '6px' }} />
                  {!shareReady.text.includes(shareReady.link) && <div style={{ fontSize: '11px', color: '#f59e0b', marginBottom: '8px' }}>⚠️ Mesajda link yok — müşteri belgelere ulaşamaz</div>}
                  <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '12px' }}>Kalıcı değişiklik için: Ayarlar → Tur Ayarları → Belge linki mesajı</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input value={shareReady.phone || ''} onChange={e => setShareReady({ ...shareReady, phone: e.target.value.replace(/[^\d+ ]/g, '') })} placeholder="WhatsApp numarası (boşsa kişi seçilir)" style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#fff', fontSize: '13px' }} />
                    <a href={waUrl(formatWhatsAppPhone(shareReady.phone) || '', shareReady.text)} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(() => setShareReady(null), 300)} style={{ padding: '12px', background: 'linear-gradient(135deg, #22c55e, #16a34a)', borderRadius: '10px', color: 'white', fontWeight: '700', textAlign: 'center', textDecoration: 'none', fontSize: '14px' }}>💬 WhatsApp'ta Gönder{shareReady.phone ? '' : ' (kişi seçerek)'}</a>
                    <button onClick={async () => { try { await navigator.clipboard.writeText(shareReady.text); showToast?.('Mesaj kopyalandı', 'success'); } catch { showToast?.('Kopyalanamadı', 'error'); } }} style={{ padding: '10px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer', fontSize: '13px' }}>📋 Mesajı kopyala</button>
                    <button onClick={async () => { try { await navigator.clipboard.writeText(shareReady.link); showToast?.('Link kopyalandı', 'success'); } catch { showToast?.('Kopyalanamadı — linki elle seçin', 'error'); } }} style={{ padding: '10px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: '#e8f1f8', cursor: 'pointer', fontSize: '13px' }}>📋 Linki Kopyala</button>
                    <button onClick={() => window.open(shareReady.link, '_blank')} style={{ padding: '10px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>👁️ Müşterinin göreceği sayfayı aç</button>
                  </div>
                </div>
              </div>
            )}
            {bulkTicket && bulkTicket.tourId === tour.id && (() => {
              const resList = (tour.reservations || []).filter(r => !r.cancelled && r.customerName);
              const nameOf = (id) => resList.find(r => r.id === id)?.customerName || '?';
              const setRow = (key, fn) => setBulkTicket(bt => ({ ...bt, rows: bt.rows.map(r => r.key === key ? fn(r) : r) }));
              const dd = RES_DOCS.find(d => d.field === bulkTicket.field) || RES_DOCS[0];
              const label = `${dd.icon} ${dd.label}`;
              const ready = bulkTicket.rows.filter(r => r.resIds.length).length;
              // Aynı kişiye birden fazla dosya/sayfa grubu → aktarmalı, birleştirilecek
              const legCount = {}; bulkTicket.rows.forEach(r => r.resIds.forEach(id => { legCount[id] = (legCount[id] || 0) + 1; }));
              const multiIds = Object.keys(legCount).filter(id => legCount[id] > 1);
              const hasExisting = bulkTicket.rows.some(r => r.resIds.some(id => resList.find(x => x.id === id)?.[bulkTicket.field]));
              return (
                <div style={{ background: 'rgba(15,39,68,0.95)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
                  <h4 style={{ margin: '0 0 4px', fontSize: '15px' }}>{label} — toplu yükleme</h4>
                  <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#94a3b8' }}>{'Çok sayfalı PDF\'ler sayfa sayfa okunup her yolcuya kendi sayfaları ayrıldı. '}PDF'teki yolcu adıyla otomatik eşleştirildi. Kontrol edin; yanlışsa × ile çıkarın, eksikse listeden ekleyin. Mevcut bileti olan kişide eskisinin yerine geçer.</p>
                  {bulkTicket.busy ? <p style={{ fontSize: '13px' }}>⏳ PDF'ler okunuyor...</p> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '50vh', overflowY: 'auto' }}>
                      {bulkTicket.rows.map(row => (
                        <div key={row.key} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '10px', border: `1px solid ${row.resIds.length ? 'rgba(16,185,129,0.3)' : 'rgba(234,179,8,0.35)'}` }}>
                          <div style={{ fontSize: '12px', color: '#e8f1f8', wordBreak: 'break-all', marginBottom: '6px' }}>📄 {row.file.name}{row.pages && <span style={{ color: '#06b6d4', marginLeft: '6px' }}>· sayfa {row.pages.map(p => p + 1).join(', ')}</span>}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                            {row.resIds.map(id => {
                              const r = resList.find(x => x.id === id);
                              return (
                                <span key={id} style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', borderRadius: '12px', padding: '3px 8px', fontSize: '12px' }}>
                                  {nameOf(id)}{legCount[id] > 1 ? ' 🔗' : ''}{r?.[bulkTicket.field] ? (bulkTicket.append ? ' (mevcuda eklenecek)' : ' (değişecek)') : ''}
                                  <button onClick={() => setRow(row.key, x => ({ ...x, resIds: x.resIds.filter(i => i !== id) }))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', marginLeft: '4px', fontSize: '12px' }}>×</button>
                                </span>
                              );
                            })}
                            <select value="" onChange={e => { const id = resList.find(r => String(r.id) === e.target.value)?.id; if (id != null) setRow(row.key, x => ({ ...x, resIds: x.resIds.includes(id) ? x.resIds : [...x.resIds, id] })); }} style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: '12px' }}>
                              <option value="">+ kişi ekle</option>
                              {resList.filter(r => !row.resIds.includes(r.id)).map(r => <option key={r.id} value={String(r.id)}>{r.customerName}</option>)}
                            </select>
                            {row.note && !row.resIds.length && <span style={{ fontSize: '11px', color: '#eab308' }}>⚠️ {row.note}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {multiIds.length > 0 && (
                    <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.35)', fontSize: '12px', color: '#67e8f9' }}>
                      🔗 Aktarmalı uçuş: {multiIds.length} kişiye birden fazla biniş kartı düştü — her kişinin kartları uçuş sırasına göre tek PDF'te birleştirilecek.
                    </div>
                  )}
                  {hasExisting && (
                    <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginTop: '10px', fontSize: '12px', color: '#cbd5e1', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!bulkTicket.append} onChange={e => setBulkTicket(bt => ({ ...bt, append: e.target.checked }))} style={{ marginTop: '2px' }} />
                      <span>Mevcut biniş kartının <b>sonuna ekle</b> (aktarmalı uçuşun 2. bacağı ayrı geldiyse). İşaretsizse mevcut kart değiştirilir.</span>
                    </label>
                  )}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button onClick={runBulkTicket} disabled={bulkTicket.busy || bulkTicket.uploading || !ready} style={{ flex: 1, padding: '10px', background: ready ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                      {bulkTicket.uploading ? '⏳ Yükleniyor...' : `⬆️ ${Object.keys(legCount).length} kişiye yükle`}
                    </button>
                    <button onClick={() => setBulkTicket(null)} disabled={bulkTicket.uploading} style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>İptal</button>
                  </div>
                </div>
              );
            })()}
            {/* Detay Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <button onClick={() => setSelectedTour(null)} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 16px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px' }}>← Geri</button>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>{titleCaseTr(tour.name)}</h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>🌍 {tour.country}{tour.city ? ` — ${tour.city}` : ''} &nbsp;|&nbsp; 📅 {formatDate(tour.startDate)} → {formatDate(tour.endDate)}</p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {tour.contractUrl && <button onClick={() => window.open(tour.contractUrl, '_blank')} style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', color: '#f59e0b', cursor: 'pointer', fontSize: '12px' }}>📄 Sözleşme</button>}
                {!tour.fromQuoteId && (
                  <select value="" disabled={!!linkBusy} title="Tur programı, uçuşlar ve linkler bu teklifle eşitlenir; teklif güncellenince tur da güncellenir"
                    onChange={e => { const q = quotes.find(x => String(x.id) === e.target.value); if (q) linkTourToQuote(tour, q); }}
                    style={{ padding: '8px 10px', background: 'rgba(232,145,42,0.15)', border: '1px solid rgba(232,145,42,0.45)', borderRadius: '8px', color: '#f59e0b', cursor: 'pointer', fontSize: '12px', fontWeight: '600', maxWidth: '220px' }}>
                    <option value="">{linkBusy ? '⏳ Bağlanıyor…' : '🔗 Programı teklife bağla'}</option>
                    {[...quotes].filter(q => q.type === 'tur-teklifi' && q.offer)
                      .sort((a, b) => (normalizeTr(b.subject || '') === normalizeTr(tour.name || '')) - (normalizeTr(a.subject || '') === normalizeTr(tour.name || '')) || String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
                      .map(q => <option key={q.id} value={String(q.id)} style={{ background: '#1a3a5c', color: '#e8f1f8' }}>{q.subject || q.offer?.title}{q.offer?.startDate ? ` · ${formatDate(q.offer.startDate)}` : ''}</option>)}
                  </select>
                )}
                {tour.offerData && <button onClick={() => openTourProgram(tour)} style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>📄 Tur Programı</button>}
                {tour.offerData && <button onClick={() => downloadTourProgram(tour)} disabled={progBusy === tour.id} style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: progBusy === tour.id ? 'wait' : 'pointer', fontSize: '12px' }}>{progBusy === tour.id ? '⏳ İndiriliyor...' : '⬇️ PDF İndir'}</button>}
                <button onClick={() => setExcelTour(tour)} style={{ padding: '8px 14px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', color: '#10b981', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>📥 Excel</button>
                {excelTour && excelTour.id === tour.id && <TourExcelModal tour={tour} customers={customers} onClose={() => setExcelTour(null)} showToast={showToast} />}
                <button onClick={() => setTavsiye({ focusCity: tour.city || '' })} style={{ padding: '8px 14px', background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.35)', borderRadius: '8px', color: '#fb923c', cursor: 'pointer', fontSize: '12px' }} title="Bu turun şehrine ait tavsiye restoranlar (tur linkinde görünür)">⭐ Tavsiyeler</button>
                <button onClick={() => setYarismaTour(tour)} style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '8px', color: '#fbbf24', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }} title="Yolcularla tur linki üzerinden canlı bilgi yarışması">🏆 Yarışma</button>
                <button onClick={() => setRoomingTour(roomingTour?.id === tour.id ? null : tour)} style={{ padding: '8px 14px', background: roomingTour?.id === tour.id ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', color: '#8b5cf6', cursor: 'pointer', fontSize: '12px' }}>🏨 Odalama</button>
                <button onClick={() => openReservationForm(tour)} style={{ padding: '8px 14px', background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', color: '#22c55e', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>➕ Rezervasyon</button>
                {RES_DOCS.map(d => (
                  <Fragment key={d.field}>
                    <input type="file" accept="application/pdf,image/*" multiple id={`bulk-${d.field}-${tour.id}`} style={{ display: 'none' }} onChange={e => { openBulkTicket(tour, d.field, e.target.files); e.target.value = ''; }} />
                    <button onClick={() => document.getElementById(`bulk-${d.field}-${tour.id}`).click()} disabled={!!bulkTicket} style={{ padding: '8px 14px', background: d.bg, border: `1px solid ${d.border}`, borderRadius: '8px', color: d.color, cursor: 'pointer', fontSize: '12px' }}>{d.icon} Toplu {d.label}</button>
                  </Fragment>
                ))}
                <input type="file" accept=".xlsx,.xls" id={`bulkres-${tour.id}`} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleBulkResUpload(tour, f); e.target.value = ''; }} />
                <button onClick={() => document.getElementById(`bulkres-${tour.id}`).click()} disabled={bulkResBusy} style={{ padding: '8px 14px', background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: '8px', color: '#06b6d4', cursor: bulkResBusy ? 'wait' : 'pointer', fontSize: '12px', fontWeight: '600' }}>{bulkResBusy ? '⏳ Yükleniyor...' : '📤 Excel ile Liste Ekle'}</button>
                <button onClick={() => downloadBulkResTemplate()} style={{ padding: '8px 14px', background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>📋 Örnek İndir</button>
                <button onClick={() => {
                  const list = tour.reservations || [];
                  const seen = new Set(); const unique = []; let dup = 0;
                  list.forEach(r => {
                    if (r.cancelled) { unique.push(r); return; }
                    const key = `${normalizeTr(r.customerName || '')}|${r.roomType || ''}`;
                    if (seen.has(key)) { dup++; } else { seen.add(key); unique.push(r); }
                  });
                  if (dup === 0) { showToast('Mükerrer rezervasyon yok', 'info'); return; }
                  if (!window.confirm(`${dup} mükerrer rezervasyon (aynı isim + oda tipi) bulundu. Silinsin mi?`)) return;
                  setTours(prev => prev.map(t => t.id === tour.id ? { ...t, reservations: unique } : t));
                  showToast(`${dup} mükerrer rezervasyon silindi`, 'success');
                }} style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🧹 Tekrarları Temizle</button>
                <button onClick={() => bulkPassports(tour)} disabled={ppBusy} title="Turdaki yolcuların pasaport görselleri tek ZIP dosyası" style={{ padding: '8px 14px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: '8px', color: '#60a5fa', cursor: ppBusy ? 'wait' : 'pointer', fontSize: '12px', fontWeight: '600' }}>{ppBusy ? '⏳ Pasaportlar…' : '🛂 Pasaportları indir'}</button>
                <button onClick={() => bulkContracts(tour)} disabled={!!szBusy} style={{ padding: '8px 14px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)', borderRadius: '8px', color: '#818cf8', cursor: szBusy ? 'wait' : 'pointer', fontSize: '12px', fontWeight: '600' }}>{szBusy === 'bulk' ? '⏳ Hazırlanıyor...' : '📜 Tüm Sözleşmeler (ZIP)'}</button>
                <button onClick={() => setDetailedView(prev => ({...prev, [tour.id]: !prev[tour.id]}))} style={{ padding: '8px 14px', background: detailedView[tour.id] ? 'rgba(59,130,246,0.28)' : 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px' }}>{detailedView[tour.id] ? '📋 Genel Liste' : '📑 Detaylı Liste'}</button>
                <button onClick={() => openBulkMail(tour)} style={{ padding: '8px 14px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>📧 Toplu Mail</button>
                <span style={{ width: '1px', alignSelf: 'stretch', background: 'rgba(255,255,255,0.12)', margin: '0 2px' }} />
                <button onClick={() => { openEditForm(tour); setSelectedTour(null); }} style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', color: '#f59e0b', cursor: 'pointer', fontSize: '12px' }}>✏️ Düzenle</button>
                <button onClick={() => { deleteTour(tour); setSelectedTour(null); }} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🗑️</button>
              </div>
            </div>

            {/* Rezervasyon İstatistikleri */}

            {/* Özet */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '10px' }}>
              {(() => {
                const totalBedel = activeRes.reduce((s, r) => s + (r.tourPrice || 0), 0);
                const totalOdenen = activeRes.reduce((s, r) => s + (r.payment1 || 0) + (r.payment2 || 0) + (r.payment3 || 0), 0);
                const totalOdenmemis = totalBedel - totalOdenen;
                const cur = activeRes[0]?.currency || '€';
                return [
                  { label: 'Aktif Rezervasyon', value: activeRes.length, color: '#10b981', suffix: '' },
                  { label: 'İptal', value: cancelledRes.length, color: '#ef4444', suffix: '', onClick: cancelledRes.length ? () => setShowCancelled(prev => ({...prev, [tour.id]: !prev[tour.id]})) : null, active: !!showCancelled[tour.id] },
                  { label: 'Toplam Ödenen', value: totalOdenen.toLocaleString('tr'), color: '#10b981', suffix: ` ${cur}` },
                  { label: 'Ödenmemiş', value: totalOdenmemis > 0 ? totalOdenmemis.toLocaleString('tr') : '0', color: totalOdenmemis > 0 ? '#ef4444' : '#64748b', suffix: ` ${cur}` },
                ];
              })().map(s => (
                <div key={s.label} onClick={s.onClick || undefined} title={s.onClick ? (s.active ? 'İptal edenleri gizle' : 'İptal edenleri göster') : undefined} style={{ background: s.active ? `${s.color}26` : 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '7px 8px', textAlign: 'center', border: `1px solid ${s.active ? s.color : `${s.color}20`}`, cursor: s.onClick ? 'pointer' : 'default' }}>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: s.color }}>{s.value}{s.suffix}</div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>{s.label}{s.onClick ? (s.active ? ' ▲' : ' ▼') : ''}</div>
                </div>
              ))}
            </div>

            {/* GİDERLER + KÂR/ZARAR (sadece muhasebe + yönetici) */}
            {canSeeExpenses && (() => {
              const activeR = tour.reservations?.filter(r => !r.cancelled) || [];
              const cur = activeR[0]?.currency || '€';
              const gelir = activeR.reduce((s, r) => s + (r.payment1 || 0) + (r.payment2 || 0) + (r.payment3 || 0), 0);
              const expenses = tour.expenses || [];
              const toplamGider = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
              const odenenGider = expenses.filter(e => e.paid).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
              const karZarar = gelir - toplamGider;
              const typeIcons = { 'Otel': '🏨', 'Uçak Bileti': '✈️', 'Otobüs': '🚌', 'Transfer': '🚐', 'Rehber': '🧑‍🏫', 'Vize': '🌍', 'Diğer': '📌' };
              return (
                <div style={{ background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '12px', padding: '14px', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '14px', color: '#a78bfa' }}>💸 Giderler <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '400' }}>(sadece muhasebe/yönetici görür)</span></h3>
                    <button onClick={() => { setEditingExpense({ ...emptyExpense, currency: cur }); setShowExpenseForm(true); }} style={{ padding: '7px 14px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>➕ Gider Ekle</button>
                  </div>

                  {showExpenseForm && editingExpense && (
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '10px', padding: '12px', marginBottom: '12px', display: 'grid', gap: '8px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 2fr 1fr 90px auto', gap: '8px', alignItems: 'end' }}>
                        <div><label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>Tür</label>
                          <select value={editingExpense.type} onChange={e => setEditingExpense({ ...editingExpense, type: e.target.value })} style={{ width: '100%', padding: '8px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px' }}>
                            {['Otel','Uçak Bileti','Otobüs','Transfer','Rehber','Vize','Diğer'].map(t => <option key={t} value={t} style={{ background: '#0c1929' }}>{t}</option>)}
                          </select>
                        </div>
                        <div><label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>Açıklama</label><input value={editingExpense.description} onChange={e => setEditingExpense({ ...editingExpense, description: e.target.value })} placeholder="örn: Erse Hotel 40 oda 3 gece" style={{ width: '100%', padding: '8px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }} /></div>
                        <div><label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>Tutar</label><input type="number" value={editingExpense.amount} onChange={e => setEditingExpense({ ...editingExpense, amount: e.target.value })} style={{ width: '100%', padding: '8px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }} /></div>
                        <div><label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>Para</label>
                          <select value={editingExpense.currency} onChange={e => setEditingExpense({ ...editingExpense, currency: e.target.value })} style={{ width: '100%', padding: '8px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px' }}>
                            {['€','$','₺','£'].map(c => <option key={c} value={c} style={{ background: '#0c1929' }}>{c}</option>)}
                          </select>
                        </div>
                        <button onClick={() => saveExpense(tour)} style={{ padding: '9px 14px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>Kaydet</button>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><label style={{ fontSize: '11px', color: '#94a3b8' }}>Ödeme:</label>
                          <select value={editingExpense.paid ? '1' : '0'} onChange={e => setEditingExpense({ ...editingExpense, paid: e.target.value === '1' })} style={{ padding: '6px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px' }}>
                            <option value="0" style={{ background: '#0c1929' }}>Ödenecek</option>
                            <option value="1" style={{ background: '#0c1929' }}>✓ Ödendi</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><label style={{ fontSize: '11px', color: '#94a3b8' }}>Tarih:</label><input type="date" value={editingExpense.date} onChange={e => setEditingExpense({ ...editingExpense, date: e.target.value })} style={{ padding: '6px', background: '#0f2744', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px' }} /></div>
                        <button onClick={() => { setShowExpenseForm(false); setEditingExpense(null); }} style={{ marginLeft: 'auto', padding: '6px 12px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '6px', color: '#94a3b8', cursor: 'pointer', fontSize: '11px' }}>İptal</button>
                      </div>
                    </div>
                  )}

                  {expenses.length > 0 && (
                    <div style={{ overflowX: 'auto', marginBottom: '10px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          {['Tür', 'Açıklama', 'Tutar', 'Durum', 'Tarih', ''].map((h, i) => <th key={i} style={{ padding: '6px 8px', textAlign: 'left', color: '#64748b', fontSize: '10px' }}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {expenses.map(ex => (
                            <tr key={ex.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: '6px 8px', color: '#e8f1f8' }}>{typeIcons[ex.type] || '📌'} {ex.type}</td>
                              <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{ex.description || '—'}</td>
                              <td style={{ padding: '6px 8px', color: '#ef4444', fontWeight: '600' }}>{(parseFloat(ex.amount) || 0).toLocaleString('tr')} {ex.currency}</td>
                              <td style={{ padding: '6px 8px' }}>{ex.paid ? <span style={{ color: '#10b981' }}>✓ Ödendi</span> : <span style={{ color: '#f59e0b' }}>Ödenecek</span>}</td>
                              <td style={{ padding: '6px 8px', color: '#64748b' }}>{ex.date ? formatDate(ex.date) : '—'}</td>
                              <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                                <button onClick={() => { setEditingExpense({ ...ex, amount: String(ex.amount) }); setShowExpenseForm(true); }} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '13px' }}>✏️</button>
                                <button onClick={() => deleteExpense(tour, ex.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '13px' }}>🗑️</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Kâr/Zarar özeti */}
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '8px', paddingTop: '10px', borderTop: '1px solid rgba(139,92,246,0.2)' }}>
                    {[
                      ['Gelir (Tahsilat)', `${gelir.toLocaleString('tr')} ${cur}`, '#10b981'],
                      ['Toplam Gider', `${toplamGider.toLocaleString('tr')} ${cur}`, '#ef4444'],
                      ['Ödenen Gider', `${odenenGider.toLocaleString('tr')} ${cur}`, '#f59e0b'],
                      [karZarar >= 0 ? '📈 KÂR' : '📉 ZARAR', `${karZarar.toLocaleString('tr')} ${cur}`, karZarar >= 0 ? '#10b981' : '#ef4444'],
                    ].map(([l, v, c], i) => (
                      <div key={i} style={{ background: i === 3 ? `${c}15` : 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '8px', textAlign: 'center', border: i === 3 ? `1px solid ${c}40` : 'none' }}>
                        <div style={{ fontSize: '14px', fontWeight: '700', color: c }}>{v}</div>
                        <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            {(tour.reservations?.length || 0) === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', background: 'rgba(255,255,255,0.02)', borderRadius: '12px' }}>
                <p style={{ fontSize: '32px', margin: '0 0 10px' }}>📋</p>
                <p>Henüz rezervasyon yok</p>
                <button onClick={() => openReservationForm(tour)} style={{ marginTop: '12px', padding: '10px 20px', background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', color: '#22c55e', cursor: 'pointer', fontSize: '13px' }}>➕ İlk Rezervasyonu Ekle</button>
              </div>
            ) : (() => {
              const aktifRes = tour.reservations.filter(r => !r.cancelled);
              const iptalRes = tour.reservations.filter(r => r.cancelled);

              // Detaylı satır - müşterinin doğum tarihi, TC, pasaport, firma vs.
              const renderDetailRow = (res) => {
                const customer = customers.find(c => String(c.id) === String(res.customerId)) ||
                  customers.find(c => normalizeTr(`${c.firstName || ''} ${c.lastName || ''}`) === normalizeTr(res.customerName));
                const birthDate = customer?.birthDate ? formatDate(customer.birthDate) : '—';
                const tcKimlik = customer?.tcKimlik || '—';
                const passports = safeParseJSON(customer?.passports);
                const passportNo = res.passport || passports[0]?.passportNo || '—';
                const company = customer?.company || res.company || '—';
                const phone = customer?.phone || res.customerPhone || '—';
                const email = customer?.email || res.customerEmail || '—';
                return (
                  <tr key={res.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: res.cancelled ? 0.5 : 1 }}>
                    <td style={{ padding: '10px 12px', width: '30px' }}><input type="checkbox" checked={selectedRes.includes(res.id)} onChange={e => setSelectedRes(prev => e.target.checked ? [...prev, res.id] : prev.filter(x => x !== res.id))} /></td>
                    <td style={{ padding: '10px 12px', fontWeight: '600', color: '#e2e8f0' }}>{titleCaseTr(res.customerName)}</td>
                    <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: '11px' }}>{birthDate}</td>
                    <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: '11px', fontFamily: 'monospace' }}>{tcKimlik}</td>
                    <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: '11px', fontFamily: 'monospace' }}>{passportNo}</td>
                    <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: '11px' }}>{company}</td>
                    <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: '11px' }}>{phone}</td>
                    <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: '11px' }}>{email}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <button onClick={() => openEditReservation(tour, res)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '14px' }} title="Düzenle">✏️</button>
                    </td>
                  </tr>
                );
              };

              const renderRow = (res) => {
                const totalPaid = (res.payment1 || 0) + (res.payment2 || 0) + (res.payment3 || 0);
                const fullyPaid = totalPaid >= (res.tourPrice || 0);

                        // Vize Durumu Hesaplama
                        const getVisaStatus = () => {
                          // Tur ülkesi Schengen mi?
                          const isSchengen = schengenCountries.includes(tour.country);
                          if (!isSchengen) return null; // Schengen değilse gösterme

                          // Türkçe karakter normalize edici
                          const normalize = normalizeTr;

                          // Önce customerId ile, sonra _docId ile, sonra normalize edilmiş isimle bul
                          let customer = customers.find(c => String(c.id) === String(res.customerId));
                          if (!customer) customer = customers.find(c => c._docId && c._docId === res.customerDocId);
                          if (!customer) {
                            const targetName = normalize(res.customerName);
                            customer = customers.find(c => normalize(`${c.firstName} ${c.lastName}`) === targetName);
                          }
                          if (!customer) return { label: 'Müşteri Bulunamadı', color: '#64748b', bg: 'rgba(100,116,139,0.2)' };

                          // Yeşil pasaport kontrolü — Schengen'den muaf
                          const cPassports = safeParseJSON(customer.passports);
                          const gp = greenPassportStatus(cPassports, tour.endDate || tour.startDate);
                          // Yeşil pasaport sadece ülke muafiyet tanıyorsa sayılır (ABD, İngiltere vb. tanımaz)
                          if (gp.green && !greenExemptIn(tour.country)) { /* normal vize kontrolüne devam */ }
                          else if (gp.green) {
                            const expStr = gp.exp ? formatDate(`${gp.exp.getFullYear()}-${String(gp.exp.getMonth() + 1).padStart(2, '0')}-${String(gp.exp.getDate()).padStart(2, '0')}`) : '';
                            if (gp.reason === 'nodate') return { label: '🟠 Yeşil Pasaport — tarih yok', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
                            if (gp.reason === 'expires') return { label: `🔴 Yeşil Pasaport Bitiyor (${expStr})`, color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
                            if (gp.reason === 'months') return { label: `🟠 Yeşil Pasaport — 6 ay kuralı (${expStr})`, color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
                            return { label: '🟢 Yeşil Pasaport Muaf', color: '#059669', bg: 'rgba(5,150,105,0.15)' };
                          }

                          // Vize olsa bile pasaport seyahat bitişinden sonra 6 ay geçerli olmalı — önce bunu uyar
                          const domestic = VIZE_DURUM[tour.country]?.b === 'yurtici'; // yurt içi turda pasaport aranmaz
                          const pv = passportValidityFor(cPassports, tour.endDate || tour.startDate);
                          if (!domestic && (pv.reason === 'expires' || pv.reason === 'months')) {
                            const pStr = formatDate(`${pv.exp.getFullYear()}-${String(pv.exp.getMonth() + 1).padStart(2, '0')}-${String(pv.exp.getDate()).padStart(2, '0')}`);
                            return pv.reason === 'expires'
                              ? { label: `🔴 Pasaport Bitiyor (${pStr})`, color: '#ef4444', bg: 'rgba(239,68,68,0.15)' }
                              : { label: `🟠 Pasaport — 6 ay kuralı (${pStr})`, color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
                          }

                          const visas = safeParseJSON(customer.schengenVisas);
                          // DEBUG: müşteri ve vize listesini console'a yaz
                          const validVisa = visas.find(v => {
                            if (!v.endDate) return false; // sadece tarih zorunlu
                            const days = getDaysLeft(v.endDate);
                            return days !== null && days > 0;
                          });

                          // Geçerli vize yoksa: bu müşterinin son 12 aydaki Schengen/tur ülkesi başvurusu var mı?
                          const appBadge = () => {
                            const lc = normalizeTr; // Türkçe karakter kuralı ("ITALYA" = "İtalya")
                            const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
                            const app = (visaApplications || [])
                              .filter(a => visaAppBelongsTo(a, customer, customers))
                              .filter(a => {
                                const cat = a.categoryId || a.category;
                                const txt = lc(`${a.country || ''} ${a.visaDuration || ''}`);
                                return cat === 'schengen' || txt.includes(lc(tour.country)) || schengenCountries.some(c => txt.includes(lc(c)));
                              })
                              .filter(a => String(a.createdAt || a.applicationDate || '9999').slice(0, 10) >= yearAgo)
                              .sort((a, b) => String(b.createdAt || b.applicationDate || '').localeCompare(String(a.createdAt || a.applicationDate || '')))[0];
                            if (!app) return null;
                            const st = lc(app.status);
                            if (/iptal/.test(st)) return null; // iptal edilen başvuru sayılmaz
                            if (/red/.test(st)) return { label: '❌ Vize Reddedildi', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', apply: customer };
                            if (/onay/.test(st)) return { label: '✅ Vize Onaylandı', color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
                            const rnd = app.appointmentDate ? ` · Randevu ${formatDate(app.appointmentDate).slice(0, 5)}` : '';
                            return { label: `📑 Başvuru — ${app.status || 'Açık'}${rnd}`, color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' };
                          };

                          if (!validVisa) {
                            const ab = appBadge(); if (ab) return ab;
                            // Süresi bitmiş vize var mı?
                            const expiredVisa = visas.find(v => v.endDate && getDaysLeft(v.endDate) !== null && getDaysLeft(v.endDate) <= 0);
                            if (expiredVisa) return { label: `Süresi Doldu (${formatDate(expiredVisa.endDate)})`, color: '#ef4444', bg: 'rgba(239,68,68,0.15)', apply: customer };
                            return { label: 'Vize Yok', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', apply: customer };
                          }

                          // Tur tarihine kadar vize geçerli mi?
                          const tourEndDate = tour.endDate;
                          if (tourEndDate) {
                            const visaExpiry = getDaysLeft(validVisa.endDate);
                            const tourDays = getDaysLeft(tourEndDate);
                            if (visaExpiry !== null && tourDays !== null && visaExpiry < tourDays) {
                              return { label: `Tur Tarihinde Bitiyor (${formatDate(validVisa.endDate)})`, color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', apply: customer };
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
                            <td style={{ padding: '10px 12px', width: '30px' }}><input type="checkbox" checked={selectedRes.includes(res.id)} onChange={e => setSelectedRes(prev => e.target.checked ? [...prev, res.id] : prev.filter(x => x !== res.id))} /></td>
                            <td style={{ padding: '10px 12px', fontWeight: '600', textDecoration: res.cancelled ? 'line-through' : 'none' }}>
                              <span
                                onClick={() => {
                                  // 1) customerId ile (en güvenilir)
                                  let found = res.customerId && res.customerId !== 'new'
                                    ? customers.find(c => String(c.id) === String(res.customerId) || String(c._docId) === String(res.customerId))
                                    : null;
                                  // 2) İsimle — tarih temizle, Türkçe normalize, boşlukları sadeleştir
                                  if (!found) {
                                    const sadeleAd = (s) => normalizeTr((s || '').replace(/\s*\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\s*/g, ' ').replace(/\s+/g, ' ').trim());
                                    const hedef = sadeleAd(res.customerName);
                                    found = customers.find(c => sadeleAd(`${c.firstName} ${c.lastName}`) === hedef);
                                    // 3) Hâlâ yoksa: boşluksuz karşılaştır (fazladan/eksik boşluk sorununa karşı)
                                    if (!found) {
                                      const bosluksuz = hedef.replace(/\s/g, '');
                                      found = customers.find(c => sadeleAd(`${c.firstName} ${c.lastName}`).replace(/\s/g, '') === bosluksuz);
                                    }
                                  }
                                  if (found && onNavigateToCustomer) onNavigateToCustomer(found, selectedTour?.id);
                                  else showToast?.('Müşteri kaydı henüz yüklenmemiş olabilir — sayfayı yenileyip (🔄) tekrar deneyin', 'warning');
                                }}
                                style={{ cursor: 'pointer', color: '#93c5fd', textDecoration: 'underline dotted', textUnderlineOffset: '3px' }}
                                title="Profili aç"
                              >
                                {titleCaseTr(res.customerName)}
                              </span>
                              {res.cancelled && (
                                <>
                                  <span style={{ fontSize: '9px', color: '#ef4444', marginLeft: '4px', display: 'block', textDecoration: 'none' }}>İPTAL</span>
                                  {res.cancelReason && (
                                    <span style={{ fontSize: '10px', color: '#64748b', display: 'block', marginTop: '2px', fontStyle: 'italic', textDecoration: 'none' }} title={res.cancelReason}>
                                      Sebep: {res.cancelReason.length > 30 ? res.cancelReason.slice(0, 30) + '…' : res.cancelReason}
                                    </span>
                                  )}
                                </>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: '11px' }}>
                              {roomTypeLabel(res.roomType) || '-'}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {visaStatus ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', background: visaStatus.bg, color: visaStatus.color, fontWeight: '600', whiteSpace: 'nowrap' }}>
                                    {visaStatus.label}
                                  </span>
                                  {visaStatus.apply && onGo && !res.cancelled && (
                                    <button onClick={() => onGo('visa', { type: 'visaFor', customer: visaStatus.apply })} title="Bu müşteri için vize başvurusu başlat"
                                      style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)', color: '#60a5fa', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                      ➕ Başvuru yap
                                    </button>
                                  )}
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
                                {!res.cancelled && <button onClick={() => openResHotelVoucher(tour, res)} style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: '14px', opacity: tour.voucherHotel?.name ? 1 : 0.4 }} title={tour.voucherHotel?.name ? `Otel giriş belgesi — ${tour.voucherHotel.name} (odalamadan)` : 'Otel giriş belgesi — önce Odalama\'da otel bilgilerini girin'}>🏨</button>}
                                {!res.cancelled && RES_DOCS.map(d => res[d.field]
                                  ? <span key={d.field} style={{ display: 'inline-flex', alignItems: 'center' }}><button {...docPressHandlers(() => window.open(res[d.field], '_blank'), () => removeResDoc(tour, res, d.field))} style={{ background: 'none', border: 'none', color: d.color, cursor: 'pointer', fontSize: '14px', WebkitTouchCallout: 'none', userSelect: 'none' }} title={`${d.label} — tıkla: aç · sağ tık (telefonda basılı tut): sil`}>{d.icon}</button></span>
                                  : <label key={d.field} style={{ cursor: resDocBusy === `${res.id}-${d.field}` ? 'wait' : 'pointer', fontSize: '14px', opacity: 0.4 }} title={`${d.label} yükle`}>{resDocBusy === `${res.id}-${d.field}` ? '⏳' : d.icon}<input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={(e) => uploadResDoc(tour, res, d.field, e.target.files[0])} /></label>
                                )}
                                {!res.cancelled && <button onClick={() => shareResLink(tour, res)} disabled={!!shareBusy} style={{ background: 'none', border: 'none', color: '#22c55e', cursor: shareBusy ? 'wait' : 'pointer', fontSize: '14px' }} title="Belge linkini WhatsApp'tan paylaş (program, otel, uçak, fuar)">{shareBusy === res.id ? '⏳' : '🔗'}</button>}
                                {!res.cancelled && <button onClick={() => singleContract(tour, res)} disabled={!!szBusy} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: szBusy ? 'wait' : 'pointer', fontSize: '14px' }} title="Sözleşme PDF">{szBusy === res.id ? '⏳' : '📜'}</button>}
                                <button onClick={() => openEditReservation(tour, res)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '14px' }} title="Düzenle">✏️</button>
                                {res.cancelled ? (
                                  <button onClick={async () => { const targetTour = tours.find(t => t.id === tour.id); if (!targetTour) return; const updatedTour = {...targetTour, reservations: targetTour.reservations.map(r => r.id === res.id ? {...r, cancelled: false, cancelledAt: null} : r)}; const u = tours.map(t => t.id === tour.id ? updatedTour : t); setTours(u); setSelectedTour(updatedTour); try { const docId = targetTour._docId || String(targetTour.id); const sd = {...updatedTour}; delete sd._docId; await setDoc(doc(db, 'tours', docId), sd, { merge: true }); } catch(e) { showToast('❌ Kaydedilemedi: ' + e.message, 'error'); return; } showToast('Rezervasyon geri alındı', 'success'); }} style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', fontSize: '14px' }} title="Geri Al">↩</button>
                                ) : (
                                  <button onClick={async () => { const reason = window.prompt(`${res.customerName} rezervasyonunu neden iptal ediyorsunuz?\n\n(Boş bırakırsanız iptal edilmez)`, ''); if (reason === null || reason.trim() === '') return; const targetTour = tours.find(t => t.id === tour.id); if (!targetTour) return; const updatedTour = {...targetTour, reservations: targetTour.reservations.map(r => r.id === res.id ? {...r, cancelled: true, cancelledAt: new Date().toISOString(), cancelReason: reason.trim()} : r)}; const u = tours.map(t => t.id === tour.id ? updatedTour : t); setTours(u); setSelectedTour(updatedTour); try { const docId = targetTour._docId || String(targetTour.id); const sd = {...updatedTour}; delete sd._docId; await setDoc(doc(db, 'tours', docId), sd, { merge: true }); } catch(e) { showToast('❌ Kaydedilemedi: ' + e.message, 'error'); return; } showToast('Rezervasyon iptal edildi', 'warning'); }} style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: '14px' }} title="İptal Et">⊘</button>
                                )}
                                {res.cancelled && (<button onClick={async () => { if (window.confirm(`"${res.customerName}" rezervasyonunu KALICI olarak silmek istediğinizden emin misiniz?\n\nBu işlem geri alınamaz. İptal listesine düşmez, tamamen silinir.`)) { const targetTour = tours.find(t => t.id === tour.id); if (!targetTour) return; const updatedTour = {...targetTour, reservations: targetTour.reservations.filter(r => r.id !== res.id)}; const u = tours.map(t => t.id === tour.id ? updatedTour : t); setTours(u); setSelectedTour(updatedTour); try { const docId = targetTour._docId || String(targetTour.id); const sd = {...updatedTour}; delete sd._docId; await setDoc(doc(db, 'tours', docId), sd, { merge: true }); } catch(e) { showToast('❌ Kaydedilemedi: ' + e.message, 'error'); return; } showToast('Rezervasyon kalıcı silindi', 'info'); } }} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', padding: '4px 8px', color: '#ef4444', cursor: 'pointer', fontSize: '14px' }} title="Kalıcı Sil">🗑️</button>)}
                              </div>
                            </td>
                          </tr>
                        );
                      };

              return (
                <>
                  {/* GÖRÜNÜM TOGGLE */}
                  {false && (  /* eski araç çubuğu header'a taşındı */
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                      <button onClick={() => setDetailedView(prev => ({...prev, [tour.id]: !prev[tour.id]}))}
                        style={{ padding: '6px 12px', background: detailedView[tour.id] ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>
                        {detailedView[tour.id] ? '📋 Genel Liste' : '📑 Detaylı Liste'}
                      </button>
                      <button onClick={() => {
                        const isDetail = detailedView[tour.id];
                        const allRes = [...aktifRes, ...iptalRes];
                        let rows;
                        if (isDetail) {
                          rows = [['Ad Soyad', 'Doğum Tarihi', 'TC No', 'Pasaport No', 'Firma', 'Telefon', 'E-posta', 'Durum']];
                          allRes.forEach(res => {
                            const customer = customers.find(c => String(c.id) === String(res.customerId)) ||
                              customers.find(c => normalizeTr(`${c.firstName || ''} ${c.lastName || ''}`) === normalizeTr(res.customerName));
                            const passports = safeParseJSON(customer?.passports);
                            rows.push([
                              res.customerName,
                              customer?.birthDate ? formatDate(customer.birthDate) : '',
                              customer?.tcKimlik || '',
                              res.passport || passports[0]?.passportNo || '',
                              customer?.company || res.company || '',
                              customer?.phone || res.customerPhone || '',
                              customer?.email || res.customerEmail || '',
                              res.cancelled ? 'İptal' : 'Aktif'
                            ]);
                          });
                        } else {
                          rows = [['Ad Soyad', 'Oda Tipi', 'Vize Durumu', 'Tur Bedeli', 'Ödeme', 'Durum']];
                          allRes.forEach(res => {
                            const totalPaid = (parseFloat(res.payment1) || 0) + (parseFloat(res.payment2) || 0) + (parseFloat(res.payment3) || 0);
                            const fullyPaid = totalPaid >= (parseFloat(res.tourPrice) || 0) && totalPaid > 0;
                            rows.push([
                              res.customerName,
                              roomTypeLabel(res.roomType),
                              res.hasVisa ? (res.visaEndDate === 'GREEN_PASSPORT' ? 'Yeşil Pasaport' : `Var${res.visaEndDate ? ` (${formatDate(res.visaEndDate)})` : ''}`) : 'Yok',
                              `${res.tourPrice || 0} ${res.currency || '€'}`,
                              fullyPaid ? 'Ödendi' : `${totalPaid} ${res.currency || '€'}`,
                              res.cancelled ? 'İptal' : 'Aktif'
                            ]);
                          });
                        }
                        const ws = XLSX.utils.aoa_to_sheet(rows);
                        ws['!cols'] = isDetail
                          ? [{wch:25},{wch:14},{wch:14},{wch:14},{wch:20},{wch:18},{wch:25},{wch:10}]
                          : [{wch:25},{wch:14},{wch:25},{wch:14},{wch:18},{wch:10}];
                        const wb = XLSX.utils.book_new();
                        XLSX.utils.book_append_sheet(wb, ws, isDetail ? 'Detaylı Liste' : 'Genel Liste');
                        XLSX.writeFile(wb, `${tour.name}_${isDetail ? 'Detayli' : 'Genel'}_Liste.xlsx`);
                      }} style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>
                        📥 {detailedView[tour.id] ? 'Detaylı' : 'Genel'} Liste Excel
                      </button>
                    </div>
                  )}

                  {/* AKTİF REZERVASYONLAR */}
                  {!(showCancelled[tour.id] && iptalRes.length > 0) && aktifRes.length > 0 && (
                    <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', marginBottom: '12px' }}>
                      {selectedRes.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderBottom: '1px solid rgba(239,68,68,0.2)' }}>
                          <span style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: '600' }}>{selectedRes.length} rezervasyon seçili</span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => setSelectedRes([])} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>Seçimi Temizle</button>
                            <button onClick={() => openBulkMail(tour)} style={{ padding: '6px 14px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '6px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>📧 Seçilenlere Mail ({selectedRes.length})</button>
                            <button onClick={() => bulkDeleteReservations(tour)} style={{ padding: '6px 14px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>🗑️ Seçilenleri Sil ({selectedRes.length})</button>
                          </div>
                        </div>
                      )}
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', minWidth: '500px' }}>
                          <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                              <th style={{ padding: '10px 12px', width: '30px' }}><input type="checkbox" checked={aktifRes.length > 0 && aktifRes.every(r => selectedRes.includes(r.id))} onChange={e => setSelectedRes(e.target.checked ? aktifRes.map(r => r.id) : [])} /></th>
                              {(detailedView[tour.id]
                                ? ['Ad Soyad', 'Doğum Tarihi', 'TC No', 'Pasaport No', 'Firma', 'Telefon', 'E-posta', '']
                                : ['Ad Soyad', 'Oda Tipi', 'Vize Durumu', 'Tur Bedeli', 'Ödeme', '']
                              ).map(h => (
                                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: '600', fontSize: '11px' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {aktifRes.map(res => detailedView[tour.id] ? renderDetailRow(res) : renderRow(res))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* İPTAL EDİLENLER — AYRI SAYFA */}
                  {iptalRes.length > 0 && showCancelled[tour.id] && (
                    <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '14px', overflow: 'hidden' }}>
                      <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.1)', borderBottom: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <button onClick={() => setShowCancelled(prev => ({...prev, [tour.id]: false}))} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '6px 14px', color: '#e8f1f8', cursor: 'pointer', fontSize: '13px' }}>← Geri</button>
                        <span style={{ fontSize: '15px', color: '#ef4444', fontWeight: '700' }}>⊘ İptal Edilenler ({iptalRes.length})</span>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>— Kararınız değişirse ↩ ile geri alabilirsiniz</span>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', minWidth: '500px' }}>
                          <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(239,68,68,0.1)' }}>
                              {(detailedView[tour.id]
                                ? ['Ad Soyad', 'Doğum Tarihi', 'TC No', 'Pasaport No', 'Firma', 'Telefon', 'E-posta', '']
                                : ['Ad Soyad', 'Oda Tipi', 'Vize Durumu', 'Tur Bedeli', 'Ödeme', '']
                              ).map(h => (
                                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: '600', fontSize: '11px' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {iptalRes.map(res => detailedView[tour.id] ? renderDetailRow(res) : renderRow(res))}
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
              const roomTypes = buildRoomTypes(tour);
              const totalRooms = Object.values(roomTypes).reduce((s, r) => s + r.length, 0);
              return (
                <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', zIndex: 2000, overflowY: 'auto', padding: '24px', boxSizing: 'border-box' }}>
                  <button onClick={() => setRoomingTour(null)} style={{ marginBottom: '16px', padding: '10px 18px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>← Tura Dön</button>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', color: '#8b5cf6' }}>🏨 {titleCaseTr(tour.name)} — Odalama ({totalRooms} oda)</h4>
                    <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={async () => {
                      const hi = tour.voucherHotel || {};
                      if (!hi.name) { showToast?.('Önce otel bilgilerini girin (aşağıdaki form)', 'warning'); return; }
                      try {
                        showToast?.('Voucherlar hazırlanıyor...', 'info');
                        const JSZip = await loadJSZip();
                        const zip = new JSZip();
                        let n = 1;
                        Object.values(roomTypes).forEach(rooms => rooms.forEach(room => {
                          const { doc, fileName } = generateTourVoucher(tour, hi, room, n, true);
                          zip.file(fileName, doc.output('blob'));
                          n++;
                        }));
                        const blob = await zip.generateAsync({ type: 'blob' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${ascii(tour.name||'Tur').replace(/\s+/g,'_')}_Voucherlar.zip`;
                        document.body.appendChild(a); a.click(); document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        showToast?.(`${totalRooms} voucher tek ZIP olarak indirildi`, 'success');
                      } catch (e) {
                        showToast?.('ZIP oluşturulamadı: ' + e.message, 'error');
                      }
                    }} style={{ padding: '6px 12px', background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '6px', color: '#22c55e', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>🎫 Toplu Voucher (ZIP)</button>
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
                  </div>

                  {/* Otel Bilgisi Girişi (Voucher için manuel) */}
                  {(() => {
                    const hi = tour.voucherHotel || {};
                    const updateHotel = (field, val) => {
                      const updated = tours.map(t => t.id === tour.id ? { ...t, voucherHotel: { ...(t.voucherHotel||{}), [field]: val } } : t);
                      setTours(updated);
                    };
                    const fieldStyle = { padding: '7px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff', fontSize: '12px', width: '100%', boxSizing: 'border-box' };
                    return (
                      <div style={{ marginBottom: '14px', padding: '12px', background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '10px' }}>
                        <div style={{ fontSize: '12px', color: '#22c55e', fontWeight: '600', marginBottom: '8px' }}>🏨 Voucher Otel Bilgileri (manuel)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px' }}>
                          <input value={hi.name || ''} onChange={e => updateHotel('name', e.target.value)} placeholder="Otel Adı *" style={fieldStyle} />
                          <input value={hi.bookingCode || ''} onChange={e => updateHotel('bookingCode', e.target.value)} placeholder="Rezervasyon Kodu (MB...)" style={fieldStyle} />
                          <input value={hi.city || ''} onChange={e => updateHotel('city', e.target.value)} placeholder="Şehir" style={fieldStyle} />
                          <input value={hi.country || ''} onChange={e => updateHotel('country', e.target.value)} placeholder="Ülke" style={fieldStyle} />
                          <input value={hi.address || ''} onChange={e => updateHotel('address', e.target.value)} placeholder="Adres" style={fieldStyle} />
                          <input value={hi.phone || ''} onChange={e => updateHotel('phone', e.target.value)} placeholder="Telefon" style={fieldStyle} />
                          <div><label style={{ fontSize: '10px', color: '#94a3b8' }}>Giriş Tarihi</label><input type="date" value={hi.checkIn || tour.startDate || ''} onChange={e => updateHotel('checkIn', e.target.value)} style={fieldStyle} /></div>
                          <div><label style={{ fontSize: '10px', color: '#94a3b8' }}>Çıkış Tarihi</label><input type="date" value={hi.checkOut || tour.endDate || ''} onChange={e => updateHotel('checkOut', e.target.value)} style={fieldStyle} /></div>
                          <select value={hi.concept || 'bb'} onChange={e => updateHotel('concept', e.target.value)} style={fieldStyle}>
                            {MEAL_CONCEPTS.map(c => <option key={c} value={c} style={{background:'#1a3a5c'}}>{MEAL_EN[c]}</option>)}
                          </select>
                        </div>
                      </div>
                    );
                  })()}
                  {Object.entries(roomTypes).map(([type, rooms], typeIdx) => {
                    const roomOffset = Object.entries(roomTypes).slice(0, typeIdx).reduce((s, [, rs]) => s + rs.length, 0);
                    return (
                    <div key={type} style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '12px', color: '#f59e0b', fontWeight: '600', marginBottom: '6px', padding: '4px 8px', background: 'rgba(245,158,11,0.1)', borderRadius: '6px', display: 'inline-block' }}>{type} ({rooms.length} oda)</div>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
                        {rooms.map((room, i) => (
                          <div key={i} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px' }}>Oda {roomOffset+i+1}</div>
                            {room.map((p, j) => <div key={j} style={{ fontSize: '12px', color: '#e8f1f8', padding: '2px 0' }}>👤 {p.customerName}</div>)}
                            <button onClick={() => shareTourVoucher(tour, tour.voucherHotel || {}, room, roomOffset+i+1)} style={{ marginTop: '8px', width: '100%', padding: '6px', background: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.35)', borderRadius: '6px', color: '#25d366', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>📲 Voucher Gönder</button>
                          </div>
                        ))}
                      </div>
                    </div>
                    );
                  })}
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
                  <select
                    value={formData.country}
                    onChange={e => setFormData({...formData, country: e.target.value})}
                    style={selectStyle}
                  >
                    <option value="">Ülke seçin...</option>
                    {tourCountries.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
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

              <div>
                <label style={labelStyle}>💬 Bu turun WhatsApp numarası (belge linkindeki "Yardıma mı ihtiyacınız var?" kartı)</label>
                <input type="tel" value={formData.contactWhatsapp || ''} onChange={e => setFormData({ ...formData, contactWhatsapp: e.target.value.replace(/[^\d+ ]/g, '') })} placeholder={appSettings?.shareContact?.whatsapp ? `Boşsa genel numara: ${appSettings.shareContact.whatsapp}` : '+90 5xx xxx xx xx (boşsa Ayarlar → Turlar\'daki genel numara)'} style={inputStyle} />
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

      {/* Toplu Mail Modal */}
      {showBulkMail && bulkMailTour && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }} onClick={() => !bulkMailSending && setShowBulkMail(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f2744', borderRadius: '16px', padding: '24px', maxWidth: '560px', width: '100%', maxHeight: '90vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <h2 style={{ fontSize: '18px', margin: 0, color: '#e8f1f8' }}>📧 Toplu Mail — {titleCaseTr(bulkMailTour.name)}</h2>
              <button onClick={() => !bulkMailSending && setShowBulkMail(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '20px' }}>×</button>
            </div>
            {(() => {
              const activeAll = (bulkMailTour.reservations || []).filter(r => !r.cancelled);
              const active = selectedRes.length > 0 ? activeAll.filter(r => selectedRes.includes(r.id)) : activeAll;
              const withEmail = active.filter(res => {
                const cust = customers.find(c => String(c.id) === String(res.customerId)) || customers.find(c => normalizeTr(`${c.firstName} ${c.lastName}`) === normalizeTr(res.customerName || ''));
                return (cust?.email || res.customerEmail || '').trim();
              }).length;
              return <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#94a3b8' }}>{selectedRes.length > 0 ? <><b style={{ color: '#3b82f6' }}>{active.length} seçili</b> katılımcıdan</> : <>{active.length} katılımcıdan</>} <b style={{ color: '#10b981' }}>{withEmail}</b> tanesinin e-postası var. Gönderen: <b>{appSettings?.smtpTour?.from || 'varsayılan SMTP adresi'}</b></p>;
            })()}
            <div style={{ marginBottom: '10px', padding: '8px 12px', background: 'rgba(59,130,246,0.08)', borderRadius: '8px', fontSize: '11px', color: '#94a3b8' }}>
              Kişiselleştirme: <code style={{ color: '#3b82f6' }}>{'{isim}'}</code> <code style={{ color: '#3b82f6' }}>{'{tur}'}</code> <code style={{ color: '#3b82f6' }}>{'{tarih}'}</code> — her katılımcıya kendi bilgisiyle gider
            </div>
            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Konu</label>
            <input value={bulkMailSubject} onChange={e => setBulkMailSubject(e.target.value)} style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box', marginBottom: '12px' }} />
            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Mesaj</label>
            <textarea value={bulkMailBody} onChange={e => setBulkMailBody(e.target.value)} rows={9} style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box', marginBottom: '14px', resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ margin: '0 0 12px', padding: '10px 12px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: '#10b981', fontWeight: '600', marginBottom: '8px' }}>✓ Otomatik Ekler</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {bulkMailTour.offerData && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#e8f1f8', cursor: 'pointer' }}>
                    <input type="checkbox" checked={autoAttachProgram} onChange={e => setAutoAttachProgram(e.target.checked)} />
                    📄 Tur Programı <span style={{ color: '#64748b', fontSize: '10px' }}>(herkese aynı)</span>
                  </label>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#e8f1f8', cursor: 'pointer' }}>
                  <input type="checkbox" checked={autoAttachContract} onChange={e => setAutoAttachContract(e.target.checked)} />
                  📜 Sözleşme <span style={{ color: '#64748b', fontSize: '10px' }}>(her katılımcıya kendi TC/pasaportuyla)</span>
                </label>
                {bulkMailTour.contractUrl && (
                  <div style={{ fontSize: '10px', color: '#64748b', paddingLeft: '22px' }}>+ Tura yüklü sözleşme PDF'i de eklenir</div>
                )}
              </div>
              {autoAttachContract && <div style={{ marginTop: '6px', fontSize: '10px', color: '#e8912a' }}>⚠️ Sözleşmeler kişiye özel üretilir — çok katılımcıda gönderim biraz sürebilir.</div>}
            </div>
            {(() => {
              const allAtt = appSettings?.attachments || [];
              if (!allAtt.length) return <p style={{ margin: '0 0 14px', fontSize: '11px', color: '#64748b' }}>📎 Ek eklemek için önce Ayarlar → Dosya Ekleri'nden dosya yükleyin.</p>;
              return (
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>📎 Ekler (isteğe bağlı)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                    {allAtt.map(a => (
                      <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', background: bulkMailAttach.includes(a.id) ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${bulkMailAttach.includes(a.id) ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: '#e8f1f8' }}>
                        <input type="checkbox" checked={bulkMailAttach.includes(a.id)} onChange={e => setBulkMailAttach(prev => e.target.checked ? [...prev, a.id] : prev.filter(x => x !== a.id))} />
                        📄 {a.name}{a.size ? <span style={{ color: '#64748b', fontSize: '10px' }}> · {(a.size / 1024).toFixed(0)} KB</span> : null}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })()}
            {bulkMailResult && (
              <div style={{ marginBottom: '12px', padding: '10px 14px', background: 'rgba(16,185,129,0.1)', borderRadius: '8px', fontSize: '12px', color: '#10b981' }}>
                ✓ {bulkMailResult.sent} gönderildi{bulkMailResult.failed ? ` · ${bulkMailResult.failed} başarısız` : ''}{bulkMailResult.noEmail.length ? ` · E-postasız: ${bulkMailResult.noEmail.slice(0, 5).join(', ')}${bulkMailResult.noEmail.length > 5 ? '...' : ''}` : ''}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowBulkMail(false)} disabled={bulkMailSending} style={{ padding: '10px 18px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>Kapat</button>
              <button onClick={sendBulkMail} disabled={bulkMailSending} style={{ padding: '10px 20px', background: bulkMailSending ? 'rgba(100,116,139,0.3)' : 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: '600', cursor: bulkMailSending ? 'wait' : 'pointer', fontSize: '13px' }}>{bulkMailSending ? '⏳ Gönderiliyor...' : '📧 Gönder'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Rezervasyon Formu Modal */}
      {showReservationForm && selectedTour && (
        <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', zIndex: 2000, overflowY: 'auto', padding: '24px', boxSizing: 'border-box' }}>
          <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
          <div style={{ maxWidth: '760px', margin: '0 auto' }}>
            <button onClick={() => { setShowReservationForm(false); setEditingReservation(null); }} style={{ marginBottom: '16px', padding: '10px 18px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: '#e8f1f8', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>← Geri</button>
            <h3 style={{ margin: '0 0 20px', fontSize: '18px' }}>
              {editingReservation ? '✏️ Rezervasyon Düzenle' : '➕ Rezervasyon Ekle'} — {selectedTour.name}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ position: 'relative' }}>
                <label style={labelStyle}>Müşteri Seç *</label>
                {reservationData.customerId && reservationData.customerId !== 'new' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px' }}>
                    <span style={{ flex: 1, fontSize: '14px', color: '#22c55e', fontWeight: '600' }}>✓ {reservationData.customerName}</span>
                    <button type="button" onClick={() => { setReservationData({ ...reservationData, customerId: '', customerName: '', customerPhone: '', customerEmail: '', company: '', passport: '', hasVisa: false, visaEndDate: '' }); setShowNewCustomerForm(false); setCustSearch(''); }}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', padding: '0' }}>×</button>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={custSearch}
                      onChange={e => { setCustSearch(e.target.value); setShowCustList(true); }}
                      onFocus={() => setShowCustList(true)}
                      onBlur={() => setTimeout(() => setShowCustList(false), 200)}
                      placeholder="Ad, soyad veya telefon ile ara..."
                      style={{ ...selectStyle, width: '100%' }}
                    />
                    {showCustList && custSearch.length >= 1 && (() => {
                      const filteredCusts = customers.filter(c => {
                        const name = normalizeTr(`${c.firstName || ''} ${c.lastName || ''}`);
                        return name.includes(normalizeTr(custSearch)) || (c.phone || '').includes(custSearch);
                      }).slice(0, 10);
                      return (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e3a5f', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', zIndex: 1000, maxHeight: '300px', overflowY: 'auto', marginTop: '4px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                          <div
                            onMouseDown={() => { handleCustomerSelect({ target: { value: 'new' } }); setShowCustList(false); setCustSearch(''); }}
                            style={{ padding: '10px 14px', cursor: 'pointer', color: '#22c55e', fontWeight: '600', borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: '13px' }}
                          >
                            ➕ Yeni Müşteri Ekle
                          </div>
                          {filteredCusts.length === 0 ? (
                            <div style={{ padding: '12px 14px', color: '#64748b', fontSize: '13px' }}>
                              Müşteri bulunamadı —{' '}
                              <span style={{ color: '#22c55e', cursor: 'pointer', textDecoration: 'underline' }}
                                onMouseDown={() => { handleCustomerSelect({ target: { value: 'new' } }); setShowCustList(false); setCustSearch(''); }}>
                                Yeni müşteri ekle
                              </span>
                            </div>
                          ) : filteredCusts.map(c => (
                            <div key={c.id}
                              onMouseDown={() => { handleCustomerSelect({ target: { value: c.id } }); setShowCustList(false); setCustSearch(''); }}
                              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '13px' }}
                            >
                              <div style={{ color: '#e8f1f8', fontWeight: '500' }}>{`${c.firstName || ''} ${c.lastName || ''}`.trim()}</div>
                              {c.phone && <div style={{ color: '#64748b', fontSize: '11px', marginTop: '2px' }}>{c.phone}</div>}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}
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
                        onChange={e => setReservationData({...reservationData, customerEmail: normEmail(e.target.value)})}
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
                      {(() => { const rts = resRoomTypes(); return reservationData.roomType && !rts.includes(reservationData.roomType) ? [reservationData.roomType, ...rts] : rts; })().map(rt => (
                        <option key={rt} value={rt}>{rt}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>Oda Arkadaşı</label>
                      <select
                        value={reservationData.roommate}
                        onChange={e => setReservationData({...reservationData, roommate: e.target.value})}
                        style={selectStyle}
                      >
                        <option value="">Oda arkadaşı seçin...</option>
                        {(selectedTour?.reservations || [])
                          .filter(r => !r.cancelled && r.customerName && r.customerName !== reservationData.customerName)
                          .map(r => <option key={r.id} value={r.customerName}>{titleCaseTr(r.customerName)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>3. Oda Arkadaşı</label>
                      <select
                        value={reservationData.roommate3}
                        onChange={e => setReservationData({...reservationData, roommate3: e.target.value})}
                        style={selectStyle}
                      >
                        <option value="">3. kişi seçin...</option>
                        {(selectedTour?.reservations || [])
                          .filter(r => !r.cancelled && r.customerName && r.customerName !== reservationData.customerName && r.customerName !== reservationData.roommate)
                          .map(r => <option key={r.id} value={r.customerName}>{titleCaseTr(r.customerName)}</option>)}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>4. Oda Arkadaşı</label>
                      <select
                        value={reservationData.roommate4}
                        onChange={e => setReservationData({...reservationData, roommate4: e.target.value})}
                        style={selectStyle}
                      >
                        <option value="">4. kişi seçin...</option>
                        {(selectedTour?.reservations || [])
                          .filter(r => !r.cancelled && r.customerName && r.customerName !== reservationData.customerName && r.customerName !== reservationData.roommate && r.customerName !== reservationData.roommate3)
                          .map(r => <option key={r.id} value={r.customerName}>{titleCaseTr(r.customerName)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Vize Durumu</label>
                      <div style={{ paddingTop: '4px' }}>
                        {schengenCountries.includes(selectedTour?.country) || selectedTour?.country?.includes('Amerika') ? (
                          reservationData.hasVisa ? (
                            reservationData.visaEndDate === 'GREEN_PASSPORT' ? (
                              <span style={{ display: 'inline-block', fontSize: '12px', padding: '5px 10px', borderRadius: '6px', fontWeight: '600',
                                background: 'rgba(5,150,105,0.2)', color: '#059669', border: '1px solid rgba(5,150,105,0.3)' }}>
                                🟢 Yeşil Pasaport — Schengen'den muaf
                              </span>
                            ) : (
                              <span style={{ display: 'inline-block', fontSize: '12px', padding: '5px 10px', borderRadius: '6px', fontWeight: '600',
                                background: 'rgba(16,185,129,0.2)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                                ✅ Var{reservationData.visaEndDate ? ` (${formatDate(reservationData.visaEndDate)})` : ''}
                              </span>
                            )
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <span style={{ display: 'inline-block', fontSize: '12px', padding: '5px 10px', borderRadius: '6px', fontWeight: '600',
                                background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)', alignSelf: 'flex-start' }}>
                                ❌ Vize bilgisi yok
                              </span>
                              <span style={{ fontSize: '10px', color: '#64748b' }}>Müşteri kartından vize görselini yükleyin</span>
                            </div>
                          )
                        ) : (
                          <span style={{ fontSize: '11px', color: '#475569' }}>— Gerekli değil</span>
                        )}
                      </div>
                    </div>
                  </div>

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
                    <label style={labelStyle}>Fatura Tipi *</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="button" onClick={() => setReservationData({...reservationData, invoiceType: 'personal'})}
                        style={{ flex: 1, padding: '12px', background: reservationData.invoiceType === 'personal' ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.05)', border: `1px solid ${reservationData.invoiceType === 'personal' ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`, borderRadius: '8px', color: reservationData.invoiceType === 'personal' ? '#3b82f6' : '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                        👤 Şahsi
                      </button>
                      <button type="button" onClick={() => setReservationData({...reservationData, invoiceType: 'company'})}
                        style={{ flex: 1, padding: '12px', background: reservationData.invoiceType === 'company' ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.05)', border: `1px solid ${reservationData.invoiceType === 'company' ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.1)'}`, borderRadius: '8px', color: reservationData.invoiceType === 'company' ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                        🏢 Firma
                      </button>
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

// Tur rezervasyonuna yüklenen belgeler — tablo ikonları, toplu yükleme butonları ve önizleme bu listeden üretilir.
// (Otel giriş belgesi yüklenmez: turun odalamasından üretilir — bkz. openResHotelVoucher)
export const RES_DOCS = [
  { field: 'fuarTicketUrl', icon: '🎫', label: 'Fuar bileti', color: '#10b981', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.3)' },
  { field: 'flightTicketUrl', icon: '✈️', label: 'Uçak bileti', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.3)' },
  // Biniş kartları: havayolu çoğu zaman herkesinkini tek PDF'te (kişi başı sayfa) verir → split: sayfalar kişiye ayrılır
  { field: 'boardingOutUrl', icon: '🛫', label: 'Gidiş biniş kartı', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)', border: 'rgba(6,182,212,0.3)', split: true },
  { field: 'boardingRetUrl', icon: '🛬', label: 'Dönüş biniş kartı', color: '#a855f7', bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.3)', split: true },
];

export function TourExcelModal({ tour, customers, onClose, showToast }) {
  const LS = 'paydos_tour_xls_cols';
  const [cols, setCols] = useState(() => { try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); if (Array.isArray(v) && v.length) return v.filter(k => TOUR_XLS_COLS.some(c => c.k === k)); } catch { /* yok */ } return TOUR_XLS_PRESETS['Genel Liste']; });
  const [withCancelled, setWithCancelled] = useState(false);
  const [withHeader, setWithHeader] = useState(false);
  const all = tour.reservations || [];
  const nCancelled = all.filter(r => r.cancelled).length;
  const toggle = (k) => setCols(prev => prev.includes(k) ? prev.filter(x => x !== k) : TOUR_XLS_COLS.map(c => c.k).filter(x => x === k || prev.includes(x)));
  const download = () => {
    if (!cols.length) { showToast?.('En az bir sütun seçin', 'error'); return; }
    try { localStorage.setItem(LS, JSON.stringify(cols)); } catch { /* yok */ }
    const list = all.filter(r => withCancelled || !r.cancelled);
    const findCust = (res) => (customers || []).find(c => String(c.id) === String(res.customerId) || (c._docId && c._docId === String(res.customerId))) || (customers || []).find(c => normalizeTr(`${c.firstName || ''} ${c.lastName || ''}`) === normalizeTr(res.customerName || ''));
    const num = (v) => parseFloat(v) || 0;
    const val = (k, r, i, cust) => {
      const cur = r.currency || '€';
      const paid = num(r.payment1) + num(r.payment2) + num(r.payment3);
      switch (k) {
        case 'sNo': return i + 1;
        case 'name': return titleCaseTr(r.customerName || '');
        case 'company': return cust?.companyName || cust?.company || r.company || '';
        case 'phone': return cust?.phone || r.customerPhone || '';
        case 'email': return cust?.email || r.customerEmail || '';
        case 'birthDate': return cust?.birthDate ? formatDate(cust.birthDate) : '';
        case 'tc': return cust?.tcKimlik || '';
        case 'passport': return r.passport || safeParseJSON(cust?.passports)[0]?.passportNo || '';
        case 'roomType': return roomTypeLabel(r.roomType);
        case 'roommate': return titleCaseTr(r.roommate || '');
        case 'roommate3': return titleCaseTr(r.roommate3 || '');
        case 'child': return r.hasChild ? 'Evet' : 'Hayır';
        case 'visa': return r.hasVisa ? (r.visaEndDate === 'GREEN_PASSPORT' ? 'Yeşil Pasaport' : `Var${r.visaEndDate ? ` (${formatDate(r.visaEndDate)})` : ''}`) : 'Yok';
        case 'visaEnd': return r.visaEndDate && r.visaEndDate !== 'GREEN_PASSPORT' ? formatDate(r.visaEndDate) : '';
        case 'price': return num(r.tourPrice);
        case 'currency': return cur;
        case 'p1': return num(r.payment1);
        case 'p2': return num(r.payment2);
        case 'p3': return num(r.payment3);
        case 'paid': return paid;
        case 'remaining': return Math.max(0, num(r.tourPrice) - paid);
        case 'payStatus': return paid >= num(r.tourPrice) && paid > 0 ? 'Ödendi' : `${paid} ${cur}`;
        case 'notes': return r.notes || '';
        case 'status': return r.cancelled ? 'İptal' : 'Aktif';
        default: return '';
      }
    };
    const defs = TOUR_XLS_COLS.filter(c => cols.includes(c.k));
    const rows = [];
    if (withHeader) rows.push([tour.name || ''], [`${tour.country || ''}${tour.city ? ' — ' + tour.city : ''}`], [`${formatDate(tour.startDate)} → ${formatDate(tour.endDate)}`], []);
    rows.push(defs.map(c => c.l));
    list.forEach((r, i) => { const cust = findCust(r); rows.push(defs.map(c => val(c.k, r, i, cust))); });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = defs.map(c => ({ wch: c.w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Liste');
    XLSX.writeFile(wb, `${(tour.name || 'Tur').replace(/[\\/:*?"<>|]/g, '')}_Liste.xlsx`);
    showToast?.(`📥 ${list.length} kişi, ${defs.length} sütun indirildi`, 'success');
    onClose();
  };
  const chip = (on) => ({ padding: '7px 11px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${on ? '#10b981' : 'rgba(255,255,255,0.15)'}`, background: on ? 'rgba(16,185,129,0.18)' : 'transparent', color: on ? '#34d399' : '#cbd5e1', fontWeight: on ? 600 : 400 });
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f1d2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto', padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ fontSize: '16px', fontWeight: '700', color: '#fff' }}>📥 Excel — sütunları seçin</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '22px', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px' }}>Hazır seçimler</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
          {Object.entries(TOUR_XLS_PRESETS).map(([name, ks]) => (
            <button key={name} type="button" onClick={() => setCols(ks)} style={chip(ks.length === cols.length && ks.every(k => cols.includes(k)))}>{name}</button>
          ))}
          <button type="button" onClick={() => setCols(TOUR_XLS_COLS.map(c => c.k))} style={chip(cols.length === TOUR_XLS_COLS.length)}>Tümü</button>
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px' }}>Sütunlar ({cols.length})</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
          {TOUR_XLS_COLS.map(c => <button key={c.k} type="button" onClick={() => toggle(c.k)} style={chip(cols.includes(c.k))}>{cols.includes(c.k) ? '✓ ' : ''}{c.l}</button>)}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e8f1f8', marginBottom: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={withCancelled} onChange={e => setWithCancelled(e.target.checked)} /> İptal edenleri de ekle ({nCancelled})
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e8f1f8', marginBottom: '16px', cursor: 'pointer' }}>
          <input type="checkbox" checked={withHeader} onChange={e => setWithHeader(e.target.checked)} /> Üste tur bilgisi yaz (ad, ülke, tarih)
        </label>
        <button type="button" onClick={download} style={{ width: '100%', padding: '13px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: '700', fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit' }}>📥 İndir — {all.filter(r => withCancelled || !r.cancelled).length} kişi</button>
      </div>
    </div>
  );
}

// Yolcunun müşteri linki (/m/) kodu: varsa onu, yoksa boş bir müşteri linki açar (PIN'i müşteri ilk girişte belirler).
// Tur linki (/b/) tur bittikten sonra buna yönlenir — ana ekrana eklenen simge Paydos hesabı olarak yaşamaya devam eder.
export const ensureCustomerLink = async (cust, appSettings) => {
  if (!cust) return '';
  if (cust.shareToken) return cust.shareToken;
  // Doğum tarihi yoksa otomatik açma: PIN'i ilk belirleyen kimliğini doğum tarihiyle kanıtlar (belge.js) —
  // doğum tarihi olmayan linkte tur linkini bilen herkes PIN koyabilirdi
  if (!cust.birthDate) return '';
  const token = customerLinkSlug(cust);
  await publishCustomerLink(cust, { title: '', city: '', country: '', startDate: '', endDate: '', hotelName: '', hotelAddress: '', flights: [], docs: [] }, token, appSettings);
  cust.shareToken = token; // aynı oturumda ikinci kez açılmasın (state ayrıca güncellenir)
  return token;
};

export const roomTypeLabel = (rt) => ROOM_KEY_LABELS[rt] || rt || '';

export const syncResLinkDocs = async (res, getNext, tour) => {
  if (!res?.shareToken) return false;
  const snap = await getDoc(doc(db, 'paylasimlar', res.shareToken));
  if (!snap.exists()) return false;
  const labels = new Set(RES_LINK_DOCS.map(x => x[2]));
  const keep = (Array.isArray(snap.data()?.docs) ? snap.data().docs : []).filter(x => !labels.has(x.label));
  const add = RES_LINK_DOCS.filter(([f]) => res[f]).map(([f, icon, label]) => ({ icon, label, url: res[f] }));
  const cur = (snap.data()?.docs || []).filter(x => labels.has(x.label));
  const patch = {};
  const docsChanged = JSON.stringify(cur.map(x => [x.label, x.url])) !== JSON.stringify(add.map(x => [x.label, x.url]));
  if (docsChanged) patch.docs = [...keep, ...add];
  // Kişinin biletinden okunan uçuşlar (ya da bilet silindiyse turun uçuşları)
  if (tour) { const fl = resFlightList(tour, res); if (JSON.stringify(fl) !== JSON.stringify(snap.data()?.flights || [])) patch.flights = fl; }
  // Tur bitince ana ekrandaki tur simgesi yolcunun müşteri linkine (/m/) geçsin
  if (!snap.data()?.nextLink && getNext) { const n = await getNext(); if (n) patch.nextLink = n; }
  else if (snap.data()?.nextLink && tour) await addTourToCustomerLink(snap.data().nextLink, tour, res.shareToken).catch(() => {});
  if (!Object.keys(patch).length) return false;
  await setDoc(doc(db, 'paylasimlar', res.shareToken), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
  return docsChanged;
};

// Eski kayıtlar oda tipini fiyat anahtarıyla tutuyor (doubleRoom) — ekranda etiket göster
export const ROOM_KEY_LABELS = { singleRoom: 'Single', doubleRoom: 'Double', twinRoom: 'Twin', tripleRoom: 'Triple', suiteRoom: 'Suite' };

// 📥 Tur Excel — sütunları seçilebilir tek dışa aktarma (eski "Tam Excel" + "Liste Excel")
export const TOUR_XLS_COLS = [
  { k: 'sNo', l: 'S.No', w: 6 },
  { k: 'name', l: 'Ad Soyad', w: 25 },
  { k: 'company', l: 'Firma', w: 22 },
  { k: 'phone', l: 'Telefon', w: 16 },
  { k: 'email', l: 'E-posta', w: 26 },
  { k: 'birthDate', l: 'Doğum Tarihi', w: 13 },
  { k: 'tc', l: 'TC No', w: 14 },
  { k: 'passport', l: 'Pasaport No', w: 13 },
  { k: 'roomType', l: 'Oda Tipi', w: 12 },
  { k: 'roommate', l: 'Oda Arkadaşı', w: 22 },
  { k: 'roommate3', l: '3. Oda Arkadaşı', w: 22 },
  { k: 'child', l: 'Çocuk', w: 7 },
  { k: 'visa', l: 'Vize Durumu', w: 22 },
  { k: 'visaEnd', l: 'Vize Bitiş', w: 12 },
  { k: 'price', l: 'Tur Ücreti', w: 11 },
  { k: 'currency', l: 'Para Birimi', w: 8 },
  { k: 'p1', l: '1. Ödeme', w: 10 },
  { k: 'p2', l: '2. Ödeme', w: 10 },
  { k: 'p3', l: '3. Ödeme', w: 10 },
  { k: 'paid', l: 'Toplam Ödeme', w: 12 },
  { k: 'remaining', l: 'Kalan', w: 10 },
  { k: 'payStatus', l: 'Ödeme Durumu', w: 14 },
  { k: 'notes', l: 'Notlar', w: 30 },
  { k: 'status', l: 'Durum', w: 9 },
];

export const TOUR_XLS_PRESETS = {
  'Genel Liste': ['name', 'roomType', 'visa', 'price', 'payStatus'],
  'Detaylı Liste': ['name', 'birthDate', 'tc', 'passport', 'company', 'phone', 'email'],
  'Muhasebe (Tam)': ['sNo', 'company', 'name', 'phone', 'email', 'roomType', 'roommate', 'roommate3', 'child', 'passport', 'visa', 'visaEnd', 'price', 'currency', 'p1', 'p2', 'p3', 'paid', 'remaining', 'notes'],
};
