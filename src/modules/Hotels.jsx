// 🏨 Oteller ve Uçuşlar modülü (otel, grup uçuşu, transfer, paket)
import { MEAL_CODE, MEAL_CONCEPTS, MEAL_EN, MEAL_TR, tourCountries } from '../lib/data.js';
import { XLSX, jsPDF } from '../lib/heavy.js';
import { asciiTr, normalizeTr, titleCaseTr, trUpper, fullNameTr } from '../lib/turkish.js';
import { db } from '../lib/firebase.js';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { formatDate, generateUniqueId, isSaneDate, safeParseJSON } from '../lib/format.js';
import { getActiveBanks } from '../lib/banks.js';
import { pdfFit, pdfText, pdfFileText } from '../lib/pdf.js';
import { useEffect, useRef, useState, Fragment } from 'react';
import { RES_EXTRA_DEFS, resExtraSum, resExtras, resPax } from '../components/shared';
import { CustomerNameInput } from '../components/ui';
import { claudeRequest } from '../lib/api.js';
import { safeFileName } from '../lib/files.js';


export function HotelsModule({ hotels, setHotels, groupFlights, setGroupFlights, transfers, setTransfers, packages, setPackages, visaApplications, customers, setCustomers, isMobile, showToast, addToUndo, onNavigateToCustomer, appSettings, currentUser }) {
  const [view, setView] = useState('list'); // list, detail, form
  // ===== GRUP UÇUŞ =====
  const [mainTab, setMainTab] = useState('hotels'); // 'hotels' | 'flights'
  const emptyFlight = {
    airline: '', flightNo: '', from: '', to: '', date: '', depTime: '', arrTime: '',
    direction: 'Gidiş', // Gidiş | Dönüş
    capacity: 40, buyPrice: '', sellPrice: '', currency: '€',
    notes: '', reservations: []
  };
  const [flightView, setFlightView] = useState('list'); // list | form | detail
  const [editingFlight, setEditingFlight] = useState(null);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [showFResForm, setShowFResForm] = useState(false);
  const [editingFRes, setEditingFRes] = useState(null);
  const [fCustSearch, setFCustSearch] = useState('');
  const [showFCustList, setShowFCustList] = useState(false);
  const emptyFRes = {
    customerId: '', customerName: '', phone: '',
    sellPrice: '', buyPrice: '', currency: '€',
    paid: false, notes: '', tag: '', // tag: firma/grup etiketi (otel rezervasyonundan gelir)
    extras: [], // [{type:'Ekstra Koltuk'|'Ekstra Bagaj', buy:'', sell:''}]
    packageHotelId: '', packageHotelName: '' // otel paketi bağlantısı
  };
  // ✈️ Otel rezervasyonundan grup uçuşuna ekle (isimleri bir daha yazmamak için)
  const [flightPick, setFlightPick] = useState(null); // { hotel, people: [{ key, customerId, customerName, phone, tag, checked }] }
  const [nameMenu, setNameMenu] = useState(null);     // { x, y, res } — isim üzerinde sağ tık menüsü
  const peopleFromRes = (resList) => {
    const people = [];
    const seen = new Set();
    resList.forEach(r => {
      const push = (name, customerId) => {
        const k = normalizeTr(name); if (!k || seen.has(k)) return; seen.add(k);
        const c = customerId ? customers.find(x => String(x.id) === String(customerId)) : customers.find(x => normalizeTr(`${x.firstName || ''} ${x.lastName || ''}`) === k);
        people.push({ key: k, customerId: c?.id || customerId || '', customerName: titleCaseTr(name), phone: c?.phone || '', tag: r.tag || '', checked: true, resId: r.id });
      };
      push(r.customerName, r.customerId);
      (r.guestNames || []).filter(n => n && n.trim()).forEach(n => push(n.trim(), ''));
    });
    return people;
  };
  const openFlightPick = (hotel, resList) => {
    setFlightPick({ hotel, people: peopleFromRes(resList), makePkg: true });
    setNameMenu(null);
  };
  // fp: { hotel, people, makePkg } (varsayılan: açık pencere) · pkgBase: önceki çağrının paket listesi (gidiş+dönüş art arda)
  const addPeopleToFlight = (fl, fp = flightPick, pkgBase) => {
    const { hotel, people } = fp;
    const chosen = people.filter(p => p.checked);
    if (!chosen.length) { showToast('Eklenecek kişi seçin', 'warning'); return null; }
    const active = (fl.reservations || []).filter(x => !x.cancelled);
    const onFlight = new Set(active.map(x => normalizeTr(x.customerName)));
    const fresh = chosen.filter(p => !onFlight.has(p.key));
    const dup = chosen.length - fresh.length;
    const cap = parseInt(fl.capacity) || 0;
    const room = cap - active.length;
    if (!fresh.length) { showToast('Seçilen kişiler bu uçuşta zaten var', 'info'); return null; }
    if (cap > 0 && fresh.length > room) { showToast(`Kontenjan yetersiz: ${Math.max(0, room)} yer kaldı, ${fresh.length} kişi seçildi`, 'error'); return null; }
    const now = Date.now();
    const added = fresh.map((p, i) => ({ ...emptyFRes, id: now + i, createdAt: new Date().toISOString(),
      customerId: p.customerId, customerName: p.customerName, phone: p.phone, tag: p.tag,
      sellPrice: fl.sellPrice || '', buyPrice: fl.buyPrice || '', currency: fl.currency || '€',
      packageHotelId: hotel.id, packageHotelName: hotel.name || '' }));
    setGroupFlights(prev => prev.map(x => x.id === fl.id ? { ...x, reservations: [...(x.reservations || []), ...added] } : x));
    const msg = `✈️ ${added.length} kişi ${fl.airline || ''} ${fl.from || ''}→${fl.to || ''} uçuşuna eklendi${dup ? ` (${dup} kişi zaten vardı)` : ''}`;
    // 📦 Paket: her otel rezervasyonu (oda) için otel + odadakilerin bu uçuştaki biletleri. Oda için paket varsa ona eklenir.
    const pkgs = [];
    let next = pkgBase || packages || [];
    if (fp.makePkg) {
      const flightRes = [...active, ...added];
      const byRoom = {};
      chosen.forEach(p => { (byRoom[p.resId] = byRoom[p.resId] || []).push(p); });
      next = [...next];
      Object.entries(byRoom).forEach(([resId, ppl], ri) => {
        const hr = (hotel.reservations || []).find(x => String(x.id) === String(resId));
        if (!hr) return;
        const hotelRef = `${hotel.id}-${hr.id}`;
        const hotelItem = { kind: 'hotel', refId: hotelRef, label: `🏨 ${hotel.name} · ${formatDate(hr.checkIn)} – ${formatDate(hr.checkOut)} · ${hr.roomType || ''} ${String(hr.concept || '').toUpperCase()}`.trim(), amount: parseFloat(hr.price) || 0, currency: hr.currency || '€' };
        const flightItems = ppl.map(p => flightRes.find(x => normalizeTr(x.customerName) === p.key)).filter(Boolean).map(fr => ({
          kind: 'flight', refId: `${fl.id}-${fr.id}`,
          label: `✈️ ${fl.airline || ''} ${fl.flightNo || ''} ${fl.from} → ${fl.to} · ${formatDate(fl.date)} · ${titleCaseTr(fr.customerName)}`.replace(/\s+/g, ' '),
          amount: (parseFloat(fr.sellPrice) || 0) + (fr.extras || []).reduce((t, e) => t + (parseFloat(e.sell) || 0), 0), currency: fl.currency || '€' }));
        const idx = next.findIndex(pk => (pk.items || []).some(it => it.refId === hotelRef));
        if (idx >= 0) {
          const have = new Set((next[idx].items || []).map(it => it.refId));
          next[idx] = { ...next[idx], items: [...next[idx].items, ...flightItems.filter(it => !have.has(it.refId))] };
          pkgs.push(next[idx]);
        } else {
          const pk = { ...emptyPackage, id: Date.now() + 1000 + ri, createdAt: new Date().toISOString(), customerId: hr.customerId || '', customerName: titleCaseTr(hr.customerName || ''), tag: hr.tag || '',
            title: `${hotel.name} + ${fl.from}→${fl.to}`, items: [hotelItem, ...flightItems] };
          next.push(pk); pkgs.push(pk);
        }
      });
      if (pkgs.length) setPackages(next);
    }
    showToast(msg + (pkgs.length ? ` · ${pkgs.length} paket` : ''), 'success');
    setFlightPick(cur => cur ? { ...cur, done: { msg, pkgs } } : cur);
    return { next };
  };
  const saveFlight = () => {
    const f = editingFlight;
    if (!f.airline || !f.from || !f.to || !f.date) { showToast('Havayolu, güzergah ve tarih zorunlu', 'error'); return; }
    if (f.id) {
      setGroupFlights(prev => prev.map(x => x.id === f.id ? { ...x, ...f } : x));
      showToast('Uçuş güncellendi', 'success');
    } else {
      setGroupFlights(prev => [...prev, { ...f, id: Date.now(), reservations: [] }]);
      showToast('Grup uçuş eklendi', 'success');
    }
    setFlightView('list'); setEditingFlight(null);
  };
  const flightResTotal = (r) => {
    const base = parseFloat(r.sellPrice) || 0;
    const ex = (r.extras || []).reduce((s, e) => s + (parseFloat(e.sell) || 0), 0);
    return base + ex;
  };
  const flightResCost = (r) => {
    const base = parseFloat(r.buyPrice) || 0;
    const ex = (r.extras || []).reduce((s, e) => s + (parseFloat(e.buy) || 0), 0);
    return base + ex;
  };
  const saveFRes = () => {
    const r = editingFRes;
    if (!r.customerName) { showToast('Müşteri seçin', 'error'); return; }
    const fl = selectedFlight;
    const active = (fl.reservations || []).filter(x => !x.cancelled && x.id !== r.id);
    if (!r.id && active.length >= (parseInt(fl.capacity) || 0)) { showToast('Kontenjan dolu!', 'error'); return; }
    // Aynı kişi bu uçuşta zaten varsa sor (çift bilet olmasın)
    if (dupPassengers([...active, { ...r, id: r.id || '__yeni__' }]).has(r.id || '__yeni__') && !window.confirm(`${titleCaseTr(r.customerName)} bu uçuşta zaten kayıtlı. Yine de eklensin mi?`)) return;
    let newRes;
    if (r.id) {
      newRes = (fl.reservations || []).map(x => x.id === r.id ? { ...x, ...r } : x);
    } else {
      newRes = [...(fl.reservations || []), { ...r, id: Date.now(), createdAt: new Date().toISOString() }];
    }
    setGroupFlights(prev => prev.map(x => x.id === fl.id ? { ...x, reservations: newRes } : x));
    setSelectedFlight(s => ({ ...s, reservations: newRes }));
    setShowFResForm(false); setEditingFRes(null); setFCustSearch('');
    showToast(r.id ? 'Rezervasyon güncellendi' : 'Rezervasyon eklendi', 'success');
  };
  const cancelFRes = (fl, resId) => {
    if (!window.confirm('Bu rezervasyonu iptal etmek istiyor musunuz?')) return;
    const newRes = (fl.reservations || []).map(x => x.id === resId ? { ...x, cancelled: true } : x);
    setGroupFlights(prev => prev.map(x => x.id === fl.id ? { ...x, reservations: newRes } : x));
    setSelectedFlight(s => s && s.id === fl.id ? { ...s, reservations: newRes } : s);
    showToast('Rezervasyon iptal edildi', 'warning');
  };
  // ===== TRANSFER =====
  // Transfer = güzergah/araç tanımı + rezervasyonlar (grup uçuş gibi iki katmanlı)
  const emptyTransfer = {
    vehicleType: 'VIP Minivan', fromLoc: '', toLoc: '', date: '', time: '',
    flightInfo: '', capacity: '', buyPrice: '', sellPrice: '', currency: '€',
    notes: '', reservations: []
  };
  const emptyTRes = {
    customerId: '', customerName: '', phone: '',
    pax: 1, sellPrice: '', buyPrice: '', currency: '€', paid: false, notes: ''
  };
  const [transferView, setTransferView] = useState('list'); // list | form | detail
  const [editingTransfer, setEditingTransfer] = useState(null);
  const [selectedTransfer, setSelectedTransfer] = useState(null);
  const [showTResForm, setShowTResForm] = useState(false);
  const [editingTRes, setEditingTRes] = useState(null);
  const [tCustSearch, setTCustSearch] = useState('');
  const [showTCustList, setShowTCustList] = useState(false);
  const saveTransfer = () => {
    const t = editingTransfer;
    if (!t.fromLoc || !t.toLoc) { showToast('Güzergah (nereden/nereye) zorunlu', 'error'); return; }
    if (t.id) {
      setTransfers(prev => prev.map(x => x.id === t.id ? { ...x, ...t } : x));
      showToast('Transfer güncellendi', 'success');
    } else {
      setTransfers(prev => [...prev, { ...t, id: Date.now(), reservations: [], createdAt: new Date().toISOString() }]);
      showToast('Transfer seçeneği eklendi', 'success');
    }
    setTransferView('list'); setEditingTransfer(null);
  };
  const deleteTransfer = (id) => {
    if (!window.confirm('Bu transferi ve tüm rezervasyonlarını silmek istiyor musunuz?')) return;
    setTransfers(prev => prev.filter(x => x.id !== id));
    showToast('Transfer silindi', 'warning');
  };
  // Transferi çoğalt — aynı bilgilerle yeni transfer (rezervasyonlar kopyalanmaz, tarih boşaltılır)
  const duplicateTransfer = (tr2) => {
    const copy = { ...tr2, id: Date.now(), reservations: [], date: '', createdAt: new Date().toISOString() };
    setTransfers(prev => [...prev, copy]);
    showToast('Transfer kopyalandı', 'success');
  };
  const tResTotal = (r) => (parseFloat(r.sellPrice) || 0) * (parseInt(r.pax) || 1);
  const tResCost = (r) => (parseFloat(r.buyPrice) || 0) * (parseInt(r.pax) || 1);
  const saveTRes = () => {
    const r = editingTRes;
    if (!r.customerName) { showToast('Müşteri seçin veya isim yazın', 'error'); return; }
    const tr2 = selectedTransfer;
    const active = (tr2.reservations || []).filter(x => !x.cancelled && x.id !== r.id);
    const usedPax = active.reduce((s, x) => s + (parseInt(x.pax) || 1), 0);
    const cap = parseInt(tr2.capacity) || 0;
    if (cap > 0 && usedPax + (parseInt(r.pax) || 1) > cap) { showToast(`Kapasite aşılıyor! (${cap} kişilik, ${usedPax} dolu)`, 'error'); return; }
    let newRes;
    if (r.id) newRes = (tr2.reservations || []).map(x => x.id === r.id ? { ...x, ...r } : x);
    else newRes = [...(tr2.reservations || []), { ...r, id: Date.now(), createdAt: new Date().toISOString() }];
    setTransfers(prev => prev.map(x => x.id === tr2.id ? { ...x, reservations: newRes } : x));
    setSelectedTransfer(s => ({ ...s, reservations: newRes }));
    setShowTResForm(false); setEditingTRes(null); setTCustSearch('');
    showToast(r.id ? 'Rezervasyon güncellendi' : 'Rezervasyon eklendi', 'success');
  };
  const cancelTRes = (tr2, resId) => {
    if (!window.confirm('Bu rezervasyonu iptal etmek istiyor musunuz?')) return;
    const newRes = (tr2.reservations || []).map(x => x.id === resId ? { ...x, cancelled: true } : x);
    setTransfers(prev => prev.map(x => x.id === tr2.id ? { ...x, reservations: newRes } : x));
    setSelectedTransfer(s => s && s.id === tr2.id ? { ...s, reservations: newRes } : s);
    showToast('Rezervasyon iptal edildi', 'warning');
  };
  // ===== PAKET =====
  // Paket: müşteri + seçilen kalemler (otel rez / uçuş rez / transfer / vize) — hepsi opsiyonel, en az 1
  const emptyPackage = {
    customerId: '', customerName: '', title: '',
    items: [], // [{kind:'hotel'|'flight'|'transfer'|'visa', label, amount, currency, refId}]
    notes: ''
  };
  const [pkgView, setPkgView] = useState('list'); // list | form
  const [pkgSel, setPkgSel] = useState([]); // tek proforma için seçili paket id'leri
  const [editingPkg, setEditingPkg] = useState(null);
  const [pCustSearch, setPCustSearch] = useState('');
  const [showPCustList, setShowPCustList] = useState(false);
  const [manualItemKind, setManualItemKind] = useState('');
  const [manualItemLabel, setManualItemLabel] = useState('');
  const [manualItemAmount, setManualItemAmount] = useState('');
  const [manualItemCurrency, setManualItemCurrency] = useState('€');
  const pkgTotal = (pk) => (pk.items || []).reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0);
  const pkgCurrency = (pk) => (pk.items || [])[0]?.currency || '€';
  // Müşterinin bağlanabilir kayıtlarını topla
  const findPkgCandidates = (custId, custName) => {
    const nq = normalizeTr(custName || '');
    const out = { hotel: [], flight: [], transfer: [], visa: [] };
    hotels.forEach(h => (h.reservations || []).filter(r => !r.cancelled).forEach(r => {
      if ((custId && String(r.customerId) === String(custId)) || (nq && normalizeTr(r.customerName || '').includes(nq))) {
        out.hotel.push({ kind: 'hotel', refId: `${h.id}-${r.id}`, label: `🏨 ${h.name} · ${r.checkIn || ''}${r.roomType ? ` · ${r.roomType}` : ''}`, amount: r.sellPrice || r.price || 0, currency: r.currency || '€' });
      }
    }));
    groupFlights.forEach(f => (f.reservations || []).filter(r => !r.cancelled).forEach(r => {
      if ((custId && String(r.customerId) === String(custId)) || (nq && normalizeTr(r.customerName || '').includes(nq))) {
        const tot = (parseFloat(r.sellPrice) || 0) + (r.extras || []).reduce((sx, e) => sx + (parseFloat(e.sell) || 0), 0);
        out.flight.push({ kind: 'flight', refId: `${f.id}-${r.id}`, label: `✈️ ${f.from} → ${f.to} · ${formatDate(f.date)}`, amount: tot, currency: f.currency || '€' });
      }
    }));
    transfers.forEach(t => (t.reservations || []).filter(r => !r.cancelled).forEach(r => {
      if ((custId && String(r.customerId) === String(custId)) || (nq && normalizeTr(r.customerName || '').includes(nq))) {
        const tot = (parseFloat(r.sellPrice) || 0) * (parseInt(r.pax) || 1);
        out.transfer.push({ kind: 'transfer', refId: `${t.id}-${r.id}`, label: `🚐 ${t.fromLoc} → ${t.toLoc} · ${t.vehicleType}`, amount: tot, currency: t.currency || '€' });
      }
    }));
    (visaApplications || []).forEach(v => {
      if ((custId && String(v.customerId) === String(custId)) || (nq && normalizeTr(v.customerName || '').includes(nq))) {
        out.visa.push({ kind: 'visa', refId: String(v.id), label: `🌍 ${v.country || 'Vize'} · ${v.visaType || ''}`, amount: v.price || v.totalPrice || 0, currency: v.currency || '€' });
      }
    });
    return out;
  };
  const savePkg = () => {
    const pk = editingPkg;
    if (!pk.customerName) { showToast('Müşteri seçin', 'error'); return; }
    if (!(pk.items || []).length) { showToast('En az bir kalem ekleyin (otel/uçuş/transfer/vize)', 'error'); return; }
    if (pk.id) {
      setPackages(prev => prev.map(x => x.id === pk.id ? { ...x, ...pk } : x));
      showToast('Paket güncellendi', 'success');
    } else {
      setPackages(prev => [...prev, { ...pk, id: Date.now(), createdAt: new Date().toISOString() }]);
      showToast('Paket oluşturuldu', 'success');
    }
    setPkgView('list'); setEditingPkg(null); setPCustSearch(''); setManualItemKind(''); setManualItemLabel(''); setManualItemAmount('');
  };
  const deletePkg = (id) => {
    if (!window.confirm('Bu paketi silmek istiyor musunuz?')) return;
    setPackages(prev => prev.filter(x => x.id !== id));
    showToast('Paket silindi', 'warning');
  };
  // Paket proforması (jsPDF)
  // Paket proforması (jsPDF) — tek paket veya birden fazla paket TEK proformada (ör. firma/grup: Kayteks'in 4 kişisi)
  // Çoklu pakette kalemler kişi adıyla yazılır; farklı para birimleri ayrı toplanır (karışık toplam yazılmaz).
  const generatePackageProforma = (pkOrList, opts = {}) => {
    try {
      const list = (Array.isArray(pkOrList) ? pkOrList : [pkOrList]).filter(Boolean);
      if (!list.length) { showToast('Proforma için paket seçin', 'warning'); return; }
      const multi = list.length > 1;
      const tags = [...new Set(list.map(p => String(p.tag || '').trim()).filter(Boolean).map(t => t.toLocaleUpperCase('tr-TR')))];
      const customerLine = opts.customer || (multi ? (tags.length === 1 ? `${tags[0]} — ${list.length} kişi/oda` : list.map(p => titleCaseTr(p.customerName)).join(', ')) : list[0].customerName);
      const title = opts.title || (multi ? (tags.length === 1 ? `${tags[0]} Grup Paketi` : 'Grup Paketi') : (list[0].title || 'Seyahat Paketi'));
      // Aynı uçuşun odadaki biletleri tek satır: "XQ970 İzmir → Frankfurt · 10.01.2027 · Semanur Dodurga, Aylın Karaca · 2 × 400"
      const mergeFlights = (its) => {
        const out = [];
        its.forEach(it => {
          const k = it.kind === 'flight' ? String(it.label || '').lastIndexOf(' · ') : -1;
          if (k < 0) { out.push(it); return; }
          const base = it.label.slice(0, k), who = it.label.slice(k + 3), amt = parseFloat(it.amount) || 0;
          const g = out.find(x => x._base === base && x._unit === amt && (x.currency || '€') === (it.currency || '€'));
          if (g) { g._who.push(who); g.amount = (parseFloat(g.amount) || 0) + amt; } else out.push({ ...it, _base: base, _unit: amt, _who: [who] });
        });
        return out.map(x => x._base ? { ...x, label: `${x._base} · ${x._who.join(', ')}${x._who.length > 1 ? ` · ${x._who.length} × ${x._unit.toLocaleString('tr-TR')}` : ''}` } : x);
      };
      // Çoklu pakette kişi adı her satırda tekrar etmez: oda/paket başına bir başlık satırı
      const items = list.flatMap(p => [...(multi ? [{ header: true, label: titleCaseTr(p.customerName) }] : []), ...mergeFlights(p.items || [])]);
      const code = (c) => c === '€' ? 'EUR' : c === '$' ? 'USD' : c === '£' ? 'GBP' : c === '₺' ? 'TRY' : (c || 'EUR');
      const totals = {}; items.filter(it => !it.header).forEach(it => { const k = code(it.currency || '€'); totals[k] = (totals[k] || 0) + (parseFloat(it.amount) || 0); });
      const curCodes = Object.keys(totals); const curCode = curCodes[0] || 'EUR';
      const doc = new jsPDF();
      const tr = pdfText(doc);
      doc.setFontSize(20); doc.setTextColor(220, 53, 69); doc.text('Paydos Tur', 20, 20);
      doc.setFontSize(9); doc.setTextColor(100);
      doc.text(tr('Paydos Turizm ve Seyahat Acentalığı Sanayi ve Ticaret Limited Şirketi'), 20, 28);
      doc.text(tr('Mehmetçik Mahallesi Ulus Caddesi No: 124/1 Denizli / Türkiye'), 20, 33);
      doc.text('Vergi: Pamukkale VD 7230433632 | Tel: 0 258 263 71 76', 20, 38);
      const now = new Date();
      const pno = `PF-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
      doc.setFontSize(16); doc.setTextColor(40); doc.text('PROFORMA FATURA', 195, 22, { align: 'right' });
      doc.setFontSize(11); doc.setTextColor(220, 53, 69); doc.text(pno, 195, 30, { align: 'right' });
      doc.setDrawColor(220); doc.setFillColor(245, 245, 245); doc.rect(20, 48, 175, 14, 'FD');
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(tr('TARİH'), 24, 53); doc.text(tr('PARA BİRİMİ'), 90, 53); doc.text('HAZIRLAYAN', 150, 53);
      doc.setFontSize(10); doc.setTextColor(40);
      doc.text(now.toLocaleDateString('tr-TR'), 24, 60); doc.text(curCodes.join(' / ') || 'EUR', 90, 60); doc.text(tr(currentUser?.name || 'Önder Taşçı'), 150, 60);
      doc.setFontSize(9); doc.setTextColor(120); doc.text('KONU', 20, 72);
      doc.setFontSize(11); doc.setTextColor(40);
      doc.text(pdfFit(doc, tr(title), 175, 11, 8), 20, 78);
      doc.setFontSize(9); doc.setTextColor(120); doc.text(tr('MÜŞTERİ'), 20, 90); doc.line(20, 92, 195, 92);
      doc.setTextColor(40); doc.text(pdfFit(doc, tr(customerLine), 175, 11, 8), 20, 99);
      doc.setFontSize(9); doc.setTextColor(120); doc.text(tr('PAKET KALEMLERİ'), 20, 112); doc.line(20, 114, 195, 114);
      doc.setFillColor(245, 245, 245); doc.rect(20, 117, 175, 7, 'F');
      doc.setFontSize(8); doc.setTextColor(80);
      doc.text(tr('HİZMET'), 22, 122); doc.text('TUTAR', 193, 122, { align: 'right' });
      let y = 130;
      let zebra = 0;
      items.forEach((it) => {
        if (it.header) {
          if (y + 16 > 270) { doc.addPage(); y = 30; }
          y += 2; doc.setFont(undefined, 'bold'); doc.setFontSize(9.5); doc.setTextColor(220, 53, 69);
          doc.text(tr(it.label || ''), 22, y); doc.setFont(undefined, 'normal');
          doc.setDrawColor(230); doc.line(20, y + 2, 195, y + 2); y += 8; zebra = 0;
          return;
        }
        const i = zebra++;
        const amt = parseFloat(it.amount) || 0;
        doc.setFontSize(9); doc.setTextColor(40);
        const lbl = doc.splitTextToSize(tr(String(it.label || '').replace(/[\u{1F000}-\u{1FAFF}☀-➿️]/gu, '').replace(/[→⇒➔]/g, '-')).trim() || tr('Hizmet'), 135);
        const rowH = Math.max(9, lbl.length * 4 + 5);
        if (y + rowH > 270) { doc.addPage(); y = 30; }
        if (i % 2 === 1) { doc.setFillColor(250, 250, 250); doc.rect(20, y - 4, 175, rowH, 'F'); }
        doc.text(lbl, 22, y);
        doc.text(`${amt.toLocaleString('tr-TR')} ${code(it.currency || '€')}`, 193, y, { align: 'right' });
        y += rowH;
      });
      if (y + 35 + curCodes.length * 8 > 285) { doc.addPage(); y = 30; }
      doc.setDrawColor(180); doc.line(120, y, 195, y); y += 7;
      (curCodes.length ? curCodes : [curCode]).forEach(k => {
        doc.setFontSize(11); doc.setTextColor(40); doc.text(curCodes.length > 1 ? `TOPLAM (${k})` : 'GENEL TOPLAM', 120, y);
        doc.setFontSize(13); doc.setTextColor(220, 53, 69);
        doc.text(`${(totals[k] || 0).toLocaleString('tr-TR')} ${k}`, 193, y, { align: 'right' });
        y += 8;
      });
      y += 6;
      const BKp = getActiveBanks(appSettings)[0];
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(tr(`Banka: ${BKp.bankName || ''} ${BKp.branch || ''} (${BKp.branchCode || ''}) | SWIFT: ${BKp.swift || ''}`), 20, y);
      doc.text(`TL IBAN: ${BKp.ibanTL || '-'} | EUR IBAN: ${BKp.ibanEUR || '-'}`, 20, y + 5);
      doc.save(`Paket_Proforma_${tr(multi ? (tags[0] || 'Grup') : list[0].customerName).replace(/\s+/g, '_')}.pdf`);
      showToast(multi ? `Tek proforma indirildi (${list.length} paket)` : 'Paket proforması indirildi', 'success');
    } catch (e) { showToast('Proforma hatası: ' + e.message, 'error'); }
  };
  // Hızlı müşteri ekleme (rezervasyon formunda "bulunamadı" durumunda)
  const [showQuickCust, setShowQuickCust] = useState(false);
  const [quickCustName, setQuickCustName] = useState('');
  const [quickCustPhone, setQuickCustPhone] = useState('');
  const [quickCustBusy, setQuickCustBusy] = useState(false);
  const quickAddCustomer = async (onDone) => {
    const parts = quickCustName.trim().split(/\s+/);
    if (parts.length < 1 || !quickCustName.trim()) { showToast?.('Ad soyad girin', 'error'); return; }
    setQuickCustBusy(true);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ') || '';
    const newId = generateUniqueId();
    const now = new Date().toISOString();
    const newCustomer = {
      id: newId, _docId: newId, firstName, lastName, phone: quickCustPhone.trim(),
      createdAt: now.split('T')[0], updatedAt: now, verified: false,
      passports: '[]', schengenVisas: '[]', usaVisa: '{}'
    };
    try {
      await setDoc(doc(db, 'customers', newId), newCustomer);
      setCustomers(prev => [...prev, newCustomer]);
      showToast?.('Müşteri eklendi', 'success');
      onDone(newCustomer);
      setShowQuickCust(false); setQuickCustName(''); setQuickCustPhone('');
    } catch (e) {
      showToast?.('Müşteri eklenemedi: ' + e.message, 'error');
    } finally {
      setQuickCustBusy(false);
    }
  };
  const [selectedHotel, setSelectedHotel] = useState(null);
  const [editingHotel, setEditingHotel] = useState(null);
  const [showResForm, setShowResForm] = useState(false);
  const [editingRes, setEditingRes] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCustList, setShowCustList] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [editingPricePeriod, setEditingPricePeriod] = useState(null);
  const [hotelPriceUploadBusy, setHotelPriceUploadBusy] = useState(false);
  const [proformaBusy, setProformaBusy] = useState(false); // 📄 AI proforma okuma
  // Otel Düzenle ekranında, açık olan otele Excel'den fiyat dönemi yükleme
  const handleHotelPriceExcel = async (hotel, file, replaceMode) => {
    if (!file) return;
    setHotelPriceUploadBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const num = (v) => { if (v === '' || v == null) return 0; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
      const normDate = (val) => {
        if (!val) return '';
        if (val instanceof Date) { const y = val.getUTCFullYear(), m = String(val.getUTCMonth()+1).padStart(2,'0'), d = String(val.getUTCDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
        const m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
        if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
        return s;
      };
      // Sadece bu otele ait satırları al (otel adı eşleşmese de hepsini bu otele yükle — kullanıcı bu otelin ekranında)
      const groups = {};
      for (const r of rows) {
        const startDate = normDate(r['Başlangıç'] || r['Baslangic'] || r['Start']);
        const endDate = normDate(r['Bitiş'] || r['Bitis'] || r['End']);
        const roomType = String(r['Oda Tipi'] || r['Oda'] || r['Room'] || '').trim();
        if (!startDate || !endDate || !roomType) continue;
        const currency = String(r['Para'] || r['Currency'] || '€').trim() || '€';
        const key = `${startDate}__${endDate}__${currency}`;
        if (!groups[key]) groups[key] = { id: generateUniqueId(), startDate, endDate, currency, rates: {} };
        if (!groups[key].rates[roomType]) groups[key].rates[roomType] = {};
        MEAL_CONCEPTS.map(c => [c, MEAL_CODE[c]]).forEach(([c, C]) => {
          const buy = num(r[`${C} Alış`] || r[`${C} Alis`]);
          const sell = num(r[`${C} Satış`] || r[`${C} Satis`]);
          if (buy > 0 || sell > 0) groups[key].rates[roomType][c] = { buy, sell };
        });
      }
      const newPeriods = Object.values(groups).filter(g => Object.keys(g.rates).length > 0);
      if (!newPeriods.length) { showToast?.('Geçerli fiyat satırı bulunamadı. Sütun başlıklarını kontrol edin.', 'error'); return; }
      // Aktif konseptleri otomatik aç
      const enabled = new Set(hotel.enabledConcepts || []);
      newPeriods.forEach(p => Object.values(p.rates).forEach(rr => Object.keys(rr).forEach(c => enabled.add(c))));
      const merged = replaceMode ? newPeriods : [...(hotel.priceList || []), ...newPeriods];
      const updatedHotel = { ...hotel, priceList: merged, enabledConcepts: [...enabled] };
      setHotelForm(f => ({ ...f, priceList: merged, enabledConcepts: [...enabled] }));
      showToast?.(`${newPeriods.length} fiyat dönemi ${replaceMode ? 'yüklendi (eski silindi)' : 'eklendi'} — kaydetmeyi unutmayın`, 'success');
    } catch (err) {
      showToast?.('Excel okunamadı: ' + err.message, 'error');
    } finally {
      setHotelPriceUploadBusy(false);
    }
  };
  const downloadHotelPriceTemplate = (hotelName) => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Otel Adı', 'Başlangıç', 'Bitiş', 'Para', 'Oda Tipi', 'RO Alış', 'RO Satış', 'BB Alış', 'BB Satış', 'HB Alış', 'HB Satış', 'FB Alış', 'FB Satış', 'AI Alış', 'AI Satış', 'UAI Alış', 'UAI Satış'],
      [hotelName || 'Otel Adı', '2026-10-16', '2026-10-17', '€', 'Single', '', '', 80, 100, '', '', '', ''],
      [hotelName || 'Otel Adı', '2026-10-16', '2026-10-17', '€', 'Double', '', '', 100, 130, '', '', '', ''],
      [hotelName || 'Otel Adı', '2026-10-16', '2026-10-17', '€', 'Twin', '', '', 100, 130, '', '', '', ''],
      [hotelName || 'Otel Adı', '2026-10-17', '2026-10-18', '€', 'Single', '', '', 85, 105, '', '', '', ''],
      [hotelName || 'Otel Adı', '2026-10-17', '2026-10-18', '€', 'Double', '', '', 105, 135, '', '', '', ''],
    ]);
    ws['!cols'] = [{wch:20},{wch:12},{wch:12},{wch:6},{wch:11},{wch:9},{wch:9},{wch:9},{wch:9},{wch:9},{wch:9},{wch:9},{wch:9},{wch:9},{wch:9},{wch:9},{wch:9}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fiyatlar');
    XLSX.writeFile(wb, 'Otel_Fiyat_Sablonu.xlsx');
  };
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [excelPreview, setExcelPreview] = useState(null);
  const [excelTab, setExcelTab] = useState('hotels'); // 'hotels' veya 'prices'
  const [priceExcelPreview, setPriceExcelPreview] = useState(null);

  // Ayarlardan oda tipleri (varsayılan)
  const hotelRoomTypes = appSettings?.hotelRoomTypes || ['Single', 'Double', 'Triple', 'Suite'];
  // Oda tipinden kişi kapasitesi (Single=1, Triple=3, Quad=4, diğerleri=2)
  const roomCapacity = (rt) => { const s = normalizeTr(rt); if (/single|tek ki/.test(s)) return 1; if (/triple|uclu|3 ki/.test(s)) return 3; if (/quad|dortlu|4 ki/.test(s)) return 4; return 2; };

  const emptyHotel = {
    name: '', city: '', country: '', stars: '4', phone: '', address: '', bookingCode: '',
    enabledConcepts: ['bb'], // RO/BB/HB/FB/AI/UAI
    priceList: [], // [{ id, startDate, endDate, currency, rates: { 'Single': { bb: 80, hb: 100 }, ... } }]
    season: '',
    notes: '',
    roomAllotment: {}, // { '2027-01-10': { Twin: 20, Single: 10, 'Suit Twin': 2 }, ... } — gece gece anlaşmalı oda sayısı (kontenjan)
    reservations: []
  };
  const [hotelForm, setHotelForm] = useState(emptyHotel);

  const emptyRes = {
    customerId: '', customerName: '', customerPhone: '', customerEmail: '',
    checkIn: '', checkOut: '', roomType: hotelRoomTypes[0] || 'Double', concept: 'bb', guests: 1, guestNames: [], priceManual: false,
    buyPrice: 0, price: 0, currency: '€',
    payment1: 0, payment2: 0, payment3: 0,
    reservationCode: '',
    tag: '',
    notes: ''
  };
  const [resData, setResData] = useState(emptyRes);

  const inputStyle = { width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' };
  const selectStyle = { ...inputStyle };
  const labelStyle = { fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: '500' };

  const openNewHotel = () => { setEditingHotel(null); setHotelForm({...emptyHotel}); setView('form'); };
  const openEditHotel = (h) => { setEditingHotel(h); setHotelForm({...emptyHotel, ...h, prices: h.prices || emptyHotel.prices}); setView('form'); };
  const openHotelDetail = (h) => { setSelectedHotel(h); setView('detail'); };

  // undefined değerleri Firestore için temizle
  const cleanForFirestore = (obj) => {
    if (obj === null || obj === undefined) return null;
    if (Array.isArray(obj)) return obj.map(cleanForFirestore).filter(x => x !== undefined);
    if (typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        const cleaned = cleanForFirestore(v);
        if (cleaned !== undefined) out[k] = cleaned;
      }
      return out;
    }
    return obj;
  };

  const saveHotel = async () => {
    if (!hotelForm.name || !hotelForm.city) { showToast?.('Otel adı ve şehir zorunlu', 'error'); return; }
    const now = new Date().toISOString();
    let updated;
    if (editingHotel) {
      updated = { ...editingHotel, ...hotelForm, updatedAt: now };
      // Eski yapıdaki kalıntı alanları sil
      delete updated.prices;
      delete updated.email;
      delete updated.website;
      const list = hotels.map(h => h.id === editingHotel.id ? updated : h);
      setHotels(list);
      try {
        const docId = editingHotel._docId || String(editingHotel.id);
        const sd = cleanForFirestore({...updated}); delete sd._docId;
        await setDoc(doc(db, 'hotels', docId), sd, { merge: false });
      } catch(e) { showToast?.('❌ Kaydedilemedi: ' + e.message, 'error'); return; }
      showToast?.('✏️ Otel güncellendi', 'success');
    } else {
      const id = generateUniqueId();
      updated = { ...hotelForm, id, _docId: id, createdAt: now, updatedAt: now };
      setHotels([updated, ...hotels]);
      try {
        const sd = cleanForFirestore({...updated}); delete sd._docId;
        await setDoc(doc(db, 'hotels', id), sd);
      } catch(e) { showToast?.('❌ Kaydedilemedi: ' + e.message, 'error'); return; }
      showToast?.('✅ Otel eklendi', 'success');
    }
    setView('list'); setEditingHotel(null);
  };

  const deleteHotel = async (h) => {
    if (!window.confirm(`"${h.name}" otelini ve tüm rezervasyonlarını KALICI silmek istiyor musunuz?`)) return;
    setHotels(hotels.filter(x => x.id !== h.id));
    try {
      const docId = h._docId || String(h.id);
      await deleteDoc(doc(db, 'hotels', docId));
    } catch(e) { showToast?.('❌ Silinemedi: ' + e.message, 'error'); return; }
    // Otelin info sheet dosyaları da silinir (Storage'da sahipsiz dosya kalmasın)
    if ((h.infoSheets || []).length) {
      try { const { getStorage, ref, deleteObject } = await import('firebase/storage'); await Promise.all(h.infoSheets.filter(f => f.path).map(f => deleteObject(ref(getStorage(), f.path)).catch(() => {}))); } catch (e) { /* dosya silinemese de otel silindi */ }
    }
    showToast?.('🗑️ Otel silindi', 'info');
    setView('list');
  };

  // 📄 Hotel Info Sheet: otelin bilgi föyü (PDF / görsel / Word…) — dosya Firebase Storage'a, kaydı otelin infoSheets listesine yazılır.
  // Yükleme sürerken otel listesi değişmiş olabilir: güncelleme her zaman en son otel verisine uygulanır.
  const hotelsRef = useRef(hotels);
  hotelsRef.current = hotels;
  const [infoBusy, setInfoBusy] = useState('');
  const INFO_MAX_MB = 20;
  const patchHotel = async (hotelId, makePatch) => {
    const cur = hotelsRef.current.find(x => String(x.id) === String(hotelId));
    if (!cur) throw new Error('Otel bulunamadı');
    const patch = { ...makePatch(cur), updatedAt: new Date().toISOString() };
    setHotels(prev => prev.map(x => String(x.id) === String(hotelId) ? { ...x, ...patch } : x));
    setSelectedHotel(sh => sh && String(sh.id) === String(hotelId) ? { ...sh, ...patch } : sh);
    await setDoc(doc(db, 'hotels', cur._docId || String(cur.id)), cleanForFirestore(patch), { merge: true });
  };
  const uploadInfoSheets = async (hotel, fileList) => {
    const files = [...(fileList || [])];
    if (!files.length || infoBusy) return;
    const big = files.find(f => f.size > INFO_MAX_MB * 1024 * 1024);
    if (big) { showToast?.(`"${big.name}" ${INFO_MAX_MB} MB'tan büyük — yüklenmedi`, 'error'); return; }
    const added = [];
    try {
      const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setInfoBusy(`⏳ Yükleniyor ${i + 1}/${files.length}…`);
        const path = `tur-belgeleri/otel-${hotel.id}/info_${Date.now()}_${safeFileName(f.name)}`;
        const sRef = ref(getStorage(), path);
        await uploadBytes(sRef, f, { contentType: f.type || 'application/octet-stream' });
        added.push({ id: generateUniqueId(), name: f.name, url: await getDownloadURL(sRef), path, size: f.size, type: f.type || '', addedAt: new Date().toISOString(), addedBy: currentUser?.name || '' });
      }
    } catch (e) { showToast?.('❌ Yükleme hatası: ' + e.message, 'error'); }
    // Bir kısmı yüklendiyse onlar yine de kaydedilir (Storage'da sahipsiz dosya kalmasın)
    try {
      if (added.length) {
        await patchHotel(hotel.id, cur => ({ infoSheets: [...(cur.infoSheets || []), ...added] }));
        showToast?.(`✅ ${added.length} dosya yüklendi`, 'success');
      }
    } catch (e) { showToast?.('❌ Kaydedilemedi: ' + e.message, 'error'); }
    setInfoBusy('');
  };
  const removeInfoSheet = async (hotel, f) => {
    if (!window.confirm(`"${f.name}" silinsin mi?`)) return;
    try { if (f.path) { const { getStorage, ref, deleteObject } = await import('firebase/storage'); await deleteObject(ref(getStorage(), f.path)).catch(() => {}); } } catch (e) { /* dosya zaten yoksa kayıt yine silinir */ }
    try {
      await patchHotel(hotel.id, cur => ({ infoSheets: (cur.infoSheets || []).filter(x => x.id !== f.id) }));
      showToast?.('🗑️ Dosya silindi', 'info');
    } catch (e) { showToast?.('❌ Silinemedi: ' + e.message, 'error'); }
  };

  const [resFlights, setResFlights] = useState({ out: '', ret: '', pkg: true }); // rezervasyonla birlikte grup uçuşuna ekle
  const [resTrf, setResTrf] = useState({ out: '', ret: '' }); // Transferler bölümünden seçilen transfer (id)
  // 👥 Uçuşları kişi bazında ayır: { [normalizeTr(isim)]: { out, ret } } — '' yok · 'M' münferit · grup uçuşu id
  const [splitSel, setSplitSel] = useState({});
  const [splitOrig, setSplitOrig] = useState({}); // düzenleme açılırken kişilerin bağlı olduğu grup uçuşları
  const resNames = (r) => [r?.customerName, ...(r?.guestNames || [])].map(n => String(n || '').trim()).filter(Boolean).filter((n, i, a) => a.findIndex(x => normalizeTr(x) === normalizeTr(n)) === i);
  const openNewRes = () => { setSplitSel({}); setSplitOrig({}); setResFlights({ out: '', ret: '', pkg: true }); setResTrf({ out: '', ret: '' }); setEditingRes(null); setResData({...emptyRes, price: 0, priceManual: false, currency: selectedHotel?.prices?.double?.currency || '€'}); setShowResForm(true); };
  // Bu otel rezervasyonundaki kişilerin bulunduğu grup uçuşları — yön: uçuşun kendi yönü, yoksa giriş/çıkış tarihine yakınlık
  const resGroupFlights = (hotel, r) => {
    const names = new Set([r.customerName, ...(r.guestNames || [])].filter(n => n && String(n).trim()).map(n => normalizeTr(n)));
    const out = { out: null, ret: null };
    (groupFlights || []).forEach(fl => {
      const hit = (fl.reservations || []).some(fr => !fr.cancelled && names.has(normalizeTr(fr.customerName))
        && (fr.packageHotelId ? String(fr.packageHotelId) === String(hotel.id) : (() => { const d = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000; return d(fl.date, r.checkIn) <= 2 || d(fl.date, r.checkOut) <= 2; })()));
      if (!hit) return;
      const dir = fl.direction === 'Gidiş' ? 'out' : fl.direction === 'Dönüş' ? 'ret'
        : Math.abs(new Date(fl.date) - new Date(r.checkIn)) <= Math.abs(new Date(fl.date) - new Date(r.checkOut)) ? 'out' : 'ret';
      if (!out[dir]) out[dir] = String(fl.id);
    });
    return out;
  };
  const openEditRes = (r) => {
    const g = selectedHotel ? resGroupFlights(selectedHotel, r) : { out: null, ret: null };
    // Elle yazılmış uçuş varsa münferit; yoksa bağlı grup uçuşu seçili gelir
    setResFlights({ out: r.flightOut ? 'M' : (g.out || ''), ret: r.flightRet ? 'M' : (g.ret || ''), pkg: true });
    // Kişi bazında: her kişinin kendi bağlı grup uçuşu (ayrılmamış odada da — uçuş değişirse doğru kişinin bileti iptal edilsin)
    const orig = {}, sel = {}, names = resNames(r);
    names.forEach(nm => {
      const k = normalizeTr(nm);
      const pg = selectedHotel ? resGroupFlights(selectedHotel, { ...r, customerName: nm, guestNames: [] }) : { out: null, ret: null };
      const pf = (r.personFlights || []).find(x => normalizeTr(x.name) === k);
      orig[k] = { out: pg.out || '', ret: pg.ret || '' };
      sel[k] = { out: pf?.outText ? 'M' : (pg.out || ''), ret: pf?.retText ? 'M' : (pg.ret || '') };
    });
    // Kayıt ayrılmamış ama odadakiler farklı grup uçuşlarında (ör. birinin bileti Grup Uçuşları'ndan iptal edilmiş / başka uçuşa alınmış):
    // form kişi bazında açılır — yoksa Kaydet'te odanın uçuşu herkese yeniden uygulanır (iptal edilen bilet geri eklenir).
    // Odaya elle yazılmış münferit uçuş varsa dokunulmaz (fiyatı oda başına hesaplı; kullanıcı isterse kutuyla ayırır).
    const diverge = !r.flightSplit && names.length > 1 && !r.flightOut && !r.flightRet
      && ['out', 'ret'].some(d => new Set(names.map(nm => orig[normalizeTr(nm)][d])).size > 1);
    const split = (!!r.flightSplit && names.length > 1) || diverge;
    setSplitOrig(orig); setSplitSel(split ? sel : {});
    setResTrf({ out: '', ret: '' }); setEditingRes(r); setResData({...r, priceManual: true, flightSplit: split}); setShowResForm(true);
  };

  const saveReservation = async () => {
    if (!resData.customerId || !resData.customerName) { showToast?.('Müşteri seçin', 'error'); return; }
    if (!resData.checkIn || !resData.checkOut) { showToast?.('Giriş/çıkış tarihleri zorunlu', 'error'); return; }
    if (!isSaneDate(resData.checkIn) || !isSaneDate(resData.checkOut)) { showToast?.('Tarih hatalı görünüyor (yıl kutusuna tıklayıp tekrar yazın)', 'error'); return; }
    let updatedHotel, savedRes;
    // ✍️ Münferit uçuş: grup uçuşu yerine elle yazılan uçuş bilgisi rezervasyonda saklanır
    // Seçilmeyen kalemin bilgileri temizlenir (eski fiyat proformaya sızmasın)
    const split = !!resData.flightSplit && resNames(resData).length > 1;
    const on = { flightOut: !split && resFlights.out === 'M', flightRet: !split && resFlights.ret === 'M', transferOut: !!resData.transferOutOn, transferRet: !!resData.transferRetOn };
    const resBase = { ...resData };
    RES_EXTRA_DEFS.forEach(d => {
      const k = d.key, use = on[k];
      resBase[k] = use ? String(resData[k] || '').trim() : '';
      resBase[k + 'Buy'] = use ? (parseFloat(resData[k + 'Buy']) || 0) : 0;
      resBase[k + 'Price'] = use ? (parseFloat(resData[k + 'Price']) || 0) : 0;
      if (d.kind === 'transfer') resBase[k + 'On'] = use;
    });
    // 👥 Kişi bazında uçuş: yalnız münferit (elle yazılan) uçuşun metni/fiyatı saklanır; grup uçuşu biletlerden okunur
    resBase.flightSplit = split;
    resBase.personFlights = split ? resNames(resData).map(nm => {
      const sel = splitSel[normalizeTr(nm)] || {}, old = (resData.personFlights || []).find(x => normalizeTr(x.name) === normalizeTr(nm)) || {};
      const o = { name: nm };
      ['out', 'ret'].forEach(d => { const m = sel[d] === 'M';
        o[d + 'Text'] = m ? String(old[d + 'Text'] || '').trim() : '';
        o[d + 'Buy'] = m ? (parseFloat(old[d + 'Buy']) || 0) : 0;
        o[d + 'Price'] = m ? (parseFloat(old[d + 'Price']) || 0) : 0; });
      return o;
    }) : [];
    if (editingRes) {
      savedRes = { ...resBase, id: editingRes.id };
      updatedHotel = { ...selectedHotel, reservations: (selectedHotel.reservations || []).map(r => r.id === editingRes.id ? savedRes : r) };
    } else {
      savedRes = { ...resBase, id: generateUniqueId(), createdAt: new Date().toISOString() };
      updatedHotel = { ...selectedHotel, reservations: [...(selectedHotel.reservations || []), savedRes] };
    }
    const list = hotels.map(h => h.id === selectedHotel.id ? updatedHotel : h);
    setHotels(list);
    setSelectedHotel(updatedHotel);
    try {
      const docId = selectedHotel._docId || String(selectedHotel.id);
      const sd = cleanForFirestore({...updatedHotel}); delete sd._docId;
      delete sd.prices; delete sd.email; delete sd.website;
      await setDoc(doc(db, 'hotels', docId), sd, { merge: false });
    } catch(e) { showToast?.('❌ Kaydedilemedi: ' + e.message, 'error'); return; }
    showToast?.(editingRes ? 'Rezervasyon güncellendi' : 'Rezervasyon eklendi', 'success');
    // ✈️ Seçildiyse odadakiler gidiş / dönüş grup uçuşuna da eklenir (+ paket)
    const fp = { hotel: updatedHotel, people: peopleFromRes([savedRes]), makePkg: resFlights.pkg };
    let pk;
    // Kişi bazında şimdiki / önceki seçim. Ayrılmamış odada herkes odanın seçimini alır.
    // Önceden bağlı olduğu grup uçuşu değişen kişinin (münferite / uçuş yok'a / başka uçuşa) eski bileti iptal edilir —
    // yoksa hem münferit hem grup bileti sayılır
    const nowOf = (key, k) => split ? (splitSel[key]?.[k] || '') : resFlights[k];
    const oldPeople = editingRes ? resNames(editingRes).map(nm => normalizeTr(nm)) : [];
    const newKeys = new Set(fp.people.map(pp => pp.key));
    ['out', 'ret'].forEach(k => {
      const byFlight = {};
      oldPeople.forEach(key => {
        const oldId = splitOrig[key]?.[k] || '';
        // Listeden çıkarılan kişi: ayrılmamış odada odanın seçimi geçerli; ayrılmışta dokunulmaz
        const nowId = newKeys.has(key) ? nowOf(key, k) : (split ? oldId : resFlights[k]);
        if (!oldId || String(oldId) === String(nowId)) return;
        (byFlight[oldId] = byFlight[oldId] || { keys: new Set(), nowId }).keys.add(key);
      });
      Object.entries(byFlight).forEach(([oldId, { keys, nowId }]) => {
        const fl = groupFlights.find(f => String(f.id) === String(oldId));
        if (!fl) return;
        let n = 0;
        const rs = (fl.reservations || []).map(fr => {
          if (fr.cancelled || !keys.has(normalizeTr(fr.customerName))) return fr;
          if (fr.packageHotelId && String(fr.packageHotelId) !== String(updatedHotel.id)) return fr;
          n++; return { ...fr, cancelled: true, cancelledAt: new Date().toISOString(), cancelNote: nowId === 'M' ? 'Otel rezervasyonunda münferit uçuşa çevrildi' : nowId ? 'Otel rezervasyonunda başka uçuşa taşındı' : 'Otel rezervasyonundan uçuş kaldırıldı' };
        });
        if (n) { setGroupFlights(prev => prev.map(x => x.id === fl.id ? { ...x, reservations: rs } : x)); showToast?.(`✈️ ${n} bilet ${fl.airline || ''} ${fl.flightNo || ''} ${fl.from}→${fl.to} grup uçuşundan çıkarıldı`, 'info'); }
      });
    });
    // Seçilen grup uçuşlarına kişiler eklenir (kişi bazında ayrıldıysa herkes kendi uçuşuna)
    ['out', 'ret'].forEach(k => {
      const byFlight = {};
      fp.people.forEach(pp => { const fid = nowOf(pp.key, k); if (fid && fid !== 'M') (byFlight[fid] = byFlight[fid] || []).push(pp); });
      Object.entries(byFlight).forEach(([fid, ppl]) => {
        const fl = groupFlights.find(f => String(f.id) === String(fid));
        if (!fl) return;
        // Bu rezervasyon zaten bu uçuşa bağlıysa yalnız yeni eklenen kişiler eklenir (mevcutlar tekrar eklenmez, uyarı çıkmaz)
        let list = ppl;
        if (editingRes && ppl.some(pp => String(splitOrig[pp.key]?.[k] || '') === String(fid))) {
          const onF = new Set((fl.reservations || []).filter(x => !x.cancelled).map(x => normalizeTr(x.customerName)));
          list = ppl.filter(pp => !onF.has(pp.key));
          if (!list.length) return;
        }
        const r = addPeopleToFlight(fl, { ...fp, people: list }, pk); if (r) pk = r.next;
      });
    });
    // 🚐 Transferler bölümünden seçilen transfer: oda tek rezervasyon olarak (kişi sayısı = odadakiler) eklenir
    [resTrf.out, resTrf.ret].filter(Boolean).forEach(tid => {
      const t = transfers.find(x => String(x.id) === String(tid));
      if (!t) return;
      const act = (t.reservations || []).filter(x => !x.cancelled);
      if (act.some(x => String(x.packageResId) === String(savedRes.id) || normalizeTr(x.customerName) === normalizeTr(savedRes.customerName))) { showToast?.(`🚐 ${savedRes.customerName} bu transferde zaten var`, 'info'); return; }
      const pax = 1 + (savedRes.guestNames || []).filter(x => x && String(x).trim()).length;
      const used = act.reduce((n, x) => n + (parseInt(x.pax) || 1), 0), cap = parseInt(t.capacity) || 0;
      if (cap > 0 && used + pax > cap) { showToast?.(`🚐 Transfer kapasitesi yetersiz: ${cap - used} yer kaldı, ${pax} kişi`, 'error'); return; }
      const tr = { ...emptyTRes, id: Date.now() + Math.random(), createdAt: new Date().toISOString(), customerId: savedRes.customerId, customerName: savedRes.customerName,
        phone: savedRes.customerPhone || '', pax, sellPrice: t.sellPrice || '', buyPrice: t.buyPrice || '', currency: t.currency || '€',
        packageHotelId: updatedHotel.id, packageHotelName: updatedHotel.name || '', packageResId: savedRes.id };
      setTransfers(prev => prev.map(x => x.id === t.id ? { ...x, reservations: [...(x.reservations || []), tr] } : x));
      showToast?.(`🚐 ${pax} kişi ${t.fromLoc} → ${t.toLoc} transferine eklendi`, 'success');
    });
    setShowResForm(false); setEditingRes(null);
  };

  const deleteReservation = async (r) => {
    if (!window.confirm(`"${r.customerName}" rezervasyonunu silmek istiyor musunuz?`)) return;
    const updatedHotel = { ...selectedHotel, reservations: selectedHotel.reservations.filter(x => x.id !== r.id) };
    setHotels(hotels.map(h => h.id === selectedHotel.id ? updatedHotel : h));
    setSelectedHotel(updatedHotel);
    try {
      const docId = selectedHotel._docId || String(selectedHotel.id);
      const sd = cleanForFirestore({...updatedHotel}); delete sd._docId;
      delete sd.prices; delete sd.email; delete sd.website;
      await setDoc(doc(db, 'hotels', docId), sd, { merge: false });
    } catch(e) { showToast?.('❌ Silinemedi: ' + e.message, 'error'); return; }
    showToast?.('Rezervasyon silindi', 'info');
  };

  const handleCustSelect = (c) => {
    setResData({
      ...resData,
      customerId: c.id,
      customerName: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      customerPhone: c.phone || '',
      customerEmail: c.email || ''
    });
    setShowCustList(false); setCustSearch('');
  };

  const calcNights = (cIn, cOut) => {
    if (!cIn || !cOut) return 0;
    const d1 = new Date(cIn), d2 = new Date(cOut);
    if (isNaN(d1) || isNaN(d2)) return 0;
    return Math.max(0, Math.round((d2 - d1) / 86400000));
  };

  // Bir rezervasyon için her geceyi tek tek hesapla
  // Birden fazla fiyat dönemine yayılıyorsa toplar
  const calcReservationPrice = (hotel, checkIn, checkOut, roomType, concept) => {
    const result = { totalBuy: 0, totalSell: 0, nights: 0, currency: '€', gaps: [], periodsUsed: [], overlaps: [], missingRate: [] };
    if (!checkIn || !checkOut || !hotel) return result;
    const d1 = new Date(checkIn);
    const d2 = new Date(checkOut);
    if (isNaN(d1) || isNaN(d2) || d2 <= d1) return result;
    result.nights = Math.round((d2 - d1) / 86400000);

    const periods = hotel.priceList || [];
    if (periods.length === 0) return result;

    // Her gece için (checkIn dahil, checkOut hariç)
    for (let i = 0; i < result.nights; i++) {
      const day = new Date(d1.getTime() + i * 86400000);
      const dayStr = day.toISOString().split('T')[0];
      // Aynı günü kapsayan birden fazla dönem olabilir (eski/boş kopya dönem): bu oda+konsept için fiyatı olan dönem esas alınır
      const covering = periods.filter(p => p.startDate <= dayStr && p.endDate > dayStr);
      if (!covering.length) {
        result.gaps.push(dayStr);
        continue;
      }
      const rateOf = (p) => {
        const rate = p.rates?.[roomType]?.[concept];
        if (rate == null || rate === '') return null;
        const buy = typeof rate === 'object' ? (parseFloat(rate.buy) || 0) : 0;
        const sell = typeof rate === 'object' ? (parseFloat(rate.sell) || 0) : (parseFloat(rate) || 0);
        return buy > 0 || sell > 0 ? { buy, sell } : null;
      };
      const period = covering.find(p => rateOf(p)) || covering[0];
      if (covering.length > 1) result.overlaps.push(dayStr);
      if (!result.periodsUsed.includes(period.id)) result.periodsUsed.push(period.id);
      result.currency = period.currency || result.currency;
      const r = rateOf(period);
      if (r) { result.totalBuy += r.buy; result.totalSell += r.sell; }
      else result.missingRate.push(dayStr);
    }
    return result;
  };

  // Otomatik fiyat senkronizasyonu - seçili otel detayında eski rezervasyon fiyatlarını sessizce güncelle
  useEffect(() => {
    if (!selectedHotel || view !== 'detail') return;
    const res = selectedHotel.reservations || [];
    if (res.length === 0) return;
    if (!selectedHotel.priceList || selectedHotel.priceList.length === 0) return;

    let needsUpdate = false;
    const updated = res.map(r => {
      if (!r.checkIn || !r.checkOut || !r.roomType) return r;
      // Elle girilen fiyata ve bilerek 0 bırakılan rezervasyona (ör. aynı odadaki 2. kişi) sessizce fiyat yazma
      if (r.priceManual) return r;
      if (!(parseFloat(r.price) || 0) && !(parseFloat(r.buyPrice) || 0)) return r;
      const calc = calcReservationPrice(selectedHotel, r.checkIn, r.checkOut, r.roomType, r.concept || 'bb');
      if (calc.totalSell === 0 && calc.totalBuy === 0) return r;
      const cb = parseFloat(r.buyPrice) || 0;
      const cs = parseFloat(r.price) || 0;
      // 0.5 € fark toleransı - değişiklik yoksa dokunma
      if (Math.abs(cs - calc.totalSell) < 0.5 && Math.abs(cb - calc.totalBuy) < 0.5) return r;
      needsUpdate = true;
      return { ...r, price: calc.totalSell, buyPrice: calc.totalBuy, currency: calc.currency || r.currency };
    });

    if (!needsUpdate) return;
    const newHotel = { ...selectedHotel, reservations: updated };
    setHotels(prev => prev.map(x => x.id === selectedHotel.id ? newHotel : x));
    setSelectedHotel(newHotel);
    // Firestore'a sessiz kaydet
    (async () => {
      try {
        const docId = selectedHotel._docId || String(selectedHotel.id);
        const sd = cleanForFirestore({...newHotel}); delete sd._docId;
        delete sd.prices; delete sd.email; delete sd.website;
        await setDoc(doc(db, 'hotels', docId), sd, { merge: false });
      } catch (e) {
        console.error('Otomatik senkronizasyon hatası:', e);
      }
    })();
  }, [selectedHotel?.id, view]);

  // ====== UÇUŞ PROFORMA OLUŞTURUCU ======
  const [selectedFRes, setSelectedFRes] = useState([]); // seçili rezervasyon id'leri
  const generateFlightProforma = (fl, resList, birlesik) => {
    if (!resList || !resList.length) { showToast?.('Rezervasyon seçin', 'error'); return; }
    try {
      const doc = new jsPDF();
      const tr = pdfText(doc);
      const currency = fl.currency || '€';
      const currencyCode = currency === '€' ? 'EUR' : currency === '$' ? 'USD' : currency === '£' ? 'GBP' : currency === '₺' ? 'TRY' : 'EUR';
      doc.setFontSize(20); doc.setTextColor(220, 53, 69); doc.text('Paydos Tur', 20, 20);
      doc.setFontSize(9); doc.setTextColor(100);
      doc.text(tr('Paydos Turizm ve Seyahat Acentalığı Sanayi ve Ticaret Limited Şirketi'), 20, 28);
      doc.text(tr('Mehmetçik Mahallesi Ulus Caddesi No: 124/1 Denizli / Türkiye'), 20, 33);
      doc.text('Vergi: Pamukkale VD 7230433632 | Tel: 0 258 263 71 76', 20, 38);
      const now = new Date();
      const pno = `PF-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
      doc.setFontSize(16); doc.setTextColor(40); doc.text('PROFORMA FATURA', 195, 22, { align: 'right' });
      doc.setFontSize(11); doc.setTextColor(220, 53, 69); doc.text(pno, 195, 30, { align: 'right' });
      doc.setDrawColor(220, 220, 220); doc.setFillColor(245, 245, 245); doc.rect(20, 48, 175, 14, 'FD');
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(tr('TARİH'), 24, 53); doc.text(tr('PARA BİRİMİ'), 90, 53); doc.text('HAZIRLAYAN', 150, 53);
      doc.setFontSize(10); doc.setTextColor(40);
      doc.text(now.toLocaleDateString('tr-TR'), 24, 60); doc.text(currencyCode, 90, 60); doc.text(tr(currentUser?.name || 'Önder Taşçı'), 150, 60);
      doc.setFontSize(9); doc.setTextColor(120); doc.text('KONU', 20, 72);
      doc.setFontSize(11); doc.setTextColor(40);
      doc.text(pdfFit(doc, `${tr(fl.from)} - ${tr(fl.to)} ${tr('Uçuş Rezervasyonu')} (${tr(fl.airline)} ${tr(fl.flightNo || '')})`, 175, 11, 8), 20, 78);
      doc.setFontSize(9); doc.setTextColor(120); doc.text(tr('MÜŞTERİ BİLGİLERİ'), 20, 90);
      doc.line(20, 92, 195, 92);
      const firstCust = customers.find(c => String(c.id) === String(resList[0].customerId));
      doc.setFontSize(9); doc.setTextColor(120); doc.text('Firma / Ad Soyad', 20, 99);
      doc.setFontSize(11); doc.setTextColor(40);
      const baslikAd = birlesik
        ? tr(firstCust?.companyName || `${resList[0].customerName} ve ${resList.length - 1} kişi`)
        : tr(resList[0].customerName);
      doc.text(pdfFit(doc, baslikAd, 175, 11, 8), 20, 105);
      doc.setFontSize(9); doc.setTextColor(120); doc.text('Telefon', 20, 113);
      doc.setFontSize(11); doc.setTextColor(40);
      doc.text(tr(resList[0].phone || firstCust?.phone || '-'), 20, 119);
      doc.setFontSize(9); doc.setTextColor(120); doc.text(tr('HİZMET KALEMLERİ'), 20, 130);
      doc.line(20, 132, 195, 132);
      doc.setFillColor(245, 245, 245); doc.rect(20, 135, 175, 7, 'F');
      doc.setFontSize(8); doc.setTextColor(80);
      doc.text('YOLCU', 22, 140); doc.text(tr('UÇUŞ'), 85, 140); doc.text('EKSTRA', 135, 140); doc.text('TUTAR', 193, 140, { align: 'right' });
      let y = 148, subtotal = 0;
      resList.forEach((r, i) => {
        const tot = flightResTotal(r); subtotal += tot;
        if (i % 2 === 1) { doc.setFillColor(250, 250, 250); doc.rect(20, y - 4, 175, 10, 'F'); }
        doc.setTextColor(40);
        doc.text(pdfFit(doc, tr(r.customerName), 60, 9, 7), 22, y);
        doc.setTextColor(80);
        doc.text(pdfFit(doc, `${tr(fl.from)}-${tr(fl.to)} ${formatDate(fl.date)} ${fl.depTime || ''}`, 48, 8, 6.5), 85, y);
        doc.text(pdfFit(doc, tr((r.extras || []).map(e => e.type).join(', ')) || '-', 30, 8, 6.5), 135, y);
        doc.setFontSize(9); doc.setTextColor(40);
        doc.text(`${tot.toLocaleString('tr-TR')} ${currencyCode}`, 193, y, { align: 'right' });
        y += 10;
        if (y > 250) { doc.addPage(); y = 30; }
      });
      if (y + 45 > 285) { doc.addPage(); y = 30; }
      doc.setDrawColor(180); doc.line(120, y, 195, y); y += 7;
      doc.setFontSize(11); doc.setTextColor(40);
      doc.text('GENEL TOPLAM', 120, y);
      doc.setFontSize(13); doc.setTextColor(220, 53, 69);
      doc.text(`${subtotal.toLocaleString('tr-TR')} ${currencyCode}`, 193, y, { align: 'right' });
      y += 14;
      doc.setFontSize(8); doc.setTextColor(120);
      const BKlist = getActiveBanks(appSettings);
      BKlist.slice(0, 2).forEach((BK, bki) => {
        doc.text(tr(`Banka: ${BK.bankName || ''} ${BK.branch || ''} (${BK.branchCode || ''}) | SWIFT: ${BK.swift || ''}`), 20, y + bki * 11);
        doc.text(`TL IBAN: ${BK.ibanTL || '-'} | EUR IBAN: ${BK.ibanEUR || '-'}`, 20, y + 5 + bki * 11);
      });
      const fname = birlesik ? `Proforma_${tr(fl.from)}_${tr(fl.to)}_toplu.pdf` : `Proforma_${tr(resList[0].customerName).replace(/\s+/g, '_')}.pdf`;
      doc.save(fname);
    } catch (e) { showToast?.('Proforma hatası: ' + e.message, 'error'); }
  };

  // ====== PROFORMA OLUŞTURUCU ======
  // hotel: otel objesi, reservations: array (tek rezervasyon için 1 elemanlı array)
  // 📄 Otel proforması + odadakilerin grup uçuşu biletleri. Uçuş bulunamazsa klasik otel proforması.
  // Biletler, uçuş rezervasyonundaki "hangi otelden geldi" bilgisi (packageHotelId) ve isimle eşleştirilir.
  // Otel rezervasyonuna bağlı grup uçuşu biletleri (Grup Uçuşları) ve transferler (Transferler bölümü):
  // proformaya satır olarak, listedeki Tutar'a da eklenir. Eşleşme: paket oteli + odadaki isimler
  // (otel bilgisi olmayan eski uçuş kayıtlarında giriş/çıkış ±2 gün).
  const linkedResItems = (hotel, r) => {
    const names = new Set([r.customerName, ...(r.guestNames || [])].filter(n => n && String(n).trim()).map(n => normalizeTr(n)));
    const out = [];
    (groupFlights || []).forEach(fl => (fl.reservations || []).forEach(fr => {
      if (fr.cancelled || !names.has(normalizeTr(fr.customerName))) return;
      if (fr.packageHotelId && String(fr.packageHotelId) !== String(hotel.id)) return; // başka otelin paketi
      if (!fr.packageHotelId) { const d = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000; if (!(d(fl.date, r.checkIn) <= 2 || d(fl.date, r.checkOut) <= 2)) return; }
      out.push({ kind: 'flight', refId: `${fl.id}-${fr.id}`,
        label: `✈️ ${fl.airline || ''} ${fl.flightNo || ''} ${fl.from} → ${fl.to} · ${formatDate(fl.date)} · ${titleCaseTr(fr.customerName)}`.replace(/\s+/g, ' '),
        amount: (parseFloat(fr.sellPrice) || 0) + (fr.extras || []).reduce((t, e) => t + (parseFloat(e.sell) || 0), 0),
        buy: (parseFloat(fr.buyPrice) || 0) + (fr.extras || []).reduce((t, e) => t + (parseFloat(e.buy) || 0), 0),
        currency: fl.currency || '€' });
    }));
    (transfers || []).forEach(t => (t.reservations || []).forEach(tr => {
      if (tr.cancelled || String(tr.packageHotelId) !== String(hotel.id)) return;
      if (!(tr.packageResId ? String(tr.packageResId) === String(r.id) : names.has(normalizeTr(tr.customerName)))) return;
      out.push({ kind: 'transfer', refId: `${t.id}-${tr.id}`,
        label: `🚐 ${t.fromLoc} → ${t.toLoc}${t.date ? ` · ${formatDate(t.date)}` : ''}${t.time ? ` ${t.time}` : ''} · ${t.vehicleType || ''}${(parseInt(tr.pax) || 1) > 1 ? ` · ${tr.pax} kişi` : ''}`.replace(/\s+/g, ' '),
        amount: tResTotal(tr), buy: tResCost(tr), currency: t.currency || '€' });
    }));
    return out;
  };
  // Listede/Excel'de müşteriden alınacak: otel + elle eklenen kalemler + bağlı bilet/transfer (aynı para birimindekiler toplanır)
  const resTotals = (hotel, r) => {
    const cur = r.currency || '€';
    const linked = linkedResItems(hotel, r);
    const same = linked.filter(x => x.currency === cur), other = linked.filter(x => x.currency !== cur);
    const linkedSell = same.reduce((t, x) => t + x.amount, 0);
    const linkedProfit = same.filter(x => x.buy > 0).reduce((t, x) => t + x.amount - x.buy, 0);
    return { total: resGrand(r) + linkedSell, linkedSell, profit: resProfit(r) + linkedProfit, linked: same, other };
  };
  const hotelProformaWithFlights = (hotel, resList) => {
    const conceptTxt = (c) => MEAL_TR[c] || trUpper(c);
    let anyFlight = false;
    const pkgs = resList.map(r => {
      const names = new Set([r.customerName, ...(r.guestNames || [])].filter(n => n && String(n).trim()).map(n => normalizeTr(n)));
      const items = [{ kind: 'hotel', refId: `${hotel.id}-${r.id}`, label: `🏨 ${hotel.name} · ${formatDate(r.checkIn)} – ${formatDate(r.checkOut)} · ${r.roomType || ''} ${conceptTxt(r.concept)}`.replace(/\s+/g, ' '), amount: parseFloat(r.price) || 0, currency: r.currency || '€' }];
      // ✍️ Münferit uçuşlar (elle yazılan) — kendi fiyatıyla ayrı satır
      resExtras(r).forEach(x => { anyFlight = true; items.push({ kind: x.kind, refId: `${hotel.id}-${r.id}-${x.key}`, label: `${x.icon} ${x.name} · ${x.text}${x.qty > 1 ? ` · ${x.qty} kişi × ${x.unitPrice.toLocaleString('tr-TR')}` : ''}`, amount: x.price, currency: r.currency || '€' }); });
      linkedResItems(hotel, r).forEach(x => { anyFlight = true; items.push(x); });
      return { customerName: titleCaseTr(r.customerName || ''), customerId: r.customerId || '', tag: r.tag || '', title: `${hotel.name} paketi`, items };
    });
    if (!anyFlight) return generateHotelProforma(hotel, resList);
    generatePackageProforma(pkgs, pkgs.length === 1 ? { title: `${hotel.name} + Uçuş` } : {});
  };
  const generateHotelProforma = (hotel, reservations) => {
    if (!reservations || reservations.length === 0) {
      showToast?.('Proforma için en az 1 rezervasyon gerekli', 'error');
      return;
    }
    try {
      const doc = new jsPDF();

      // Türkçe karakter dönüştürücü
      const tr = pdfText(doc);

      // Para birimi (ilk rezervasyondan)
      const currency = reservations[0].currency || '€';
      const currencyCode = currency === '€' ? 'EUR' : currency === '$' ? 'USD' : currency === '£' ? 'GBP' : currency === '₺' ? 'TRY' : 'EUR';

      // Header
      doc.setFontSize(20);
      doc.setTextColor(220, 53, 69);
      doc.text('Paydos Tur', 20, 20);

      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(tr('Paydos Turizm ve Seyahat Acentalığı Sanayi ve Ticaret Limited Şirketi'), 20, 28);
      doc.text(tr('Mehmetçik Mahallesi Ulus Caddesi No: 124/1 Denizli / Türkiye'), 20, 33);
      doc.text('Vergi: Pamukkale VD 7230433632 | Tel: 0 258 263 71 76', 20, 38);

      // Proforma No
      const now = new Date();
      const pno = `PF-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

      doc.setFontSize(16);
      doc.setTextColor(40);
      doc.text('PROFORMA FATURA', 195, 22, { align: 'right' });
      doc.setFontSize(11);
      doc.setTextColor(220, 53, 69);
      doc.text(pno, 195, 30, { align: 'right' });

      // Üst tablo
      doc.setDrawColor(220, 220, 220);
      doc.setFillColor(245, 245, 245);
      doc.rect(20, 48, 175, 14, 'FD');
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(tr('TARİH'), 24, 53);
      doc.text(tr('OPSİYON TARİHİ'), 70, 53);
      doc.text(tr('PARA BİRİMİ'), 120, 53);
      doc.text('HAZIRLAYAN', 155, 53);
      doc.setFontSize(10);
      doc.setTextColor(40);
      const optionDate = new Date(now.getTime() + 14 * 86400000); // 14 gün opsiyon
      doc.text(now.toLocaleDateString('tr-TR'), 24, 60);
      doc.text(optionDate.toLocaleDateString('tr-TR'), 70, 60);
      doc.text(currencyCode, 120, 60);
      doc.text(tr(currentUser?.name || 'Önder Taşçı'), 155, 60);

      // KONU
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text('KONU', 20, 72);
      doc.setFontSize(11);
      doc.setTextColor(40);
      const konu = reservations.length === 1
        ? `${tr(hotel.name)} - Otel Konaklaması`
        : `${tr(hotel.name)} - Toplu Otel Konaklaması (${reservations.length} rezervasyon)`;
      doc.text(pdfFit(doc, tr(konu), 175, 11, 8), 20, 78);

      // MÜŞTERİ BİLGİLERİ
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(tr('MÜŞTERİ BİLGİLERİ'), 20, 90);
      doc.setDrawColor(220, 220, 220);
      doc.line(20, 92, 195, 92);

      // Tek müşteri varsa onu, toplu ise "Cesitli" yaz
      const uniqueCustomers = [...new Set(reservations.map(r => r.customerName).filter(Boolean))];
      const firstCustomer = customers.find(c => String(c.id) === String(reservations[0].customerId));

      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text('Firma / Ad Soyad', 20, 99);
      doc.text('Vergi Dairesi', 110, 99);
      doc.setFontSize(11);
      doc.setTextColor(40);
      const custName = uniqueCustomers.length === 1
        ? tr(uniqueCustomers[0])
        : tr(`Çeşitli (${uniqueCustomers.length} kişi)`);
      doc.text(pdfFit(doc, custName, 86, 11, 8), 20, 105);
      doc.text(pdfFit(doc, tr(firstCustomer?.taxOffice || '-'), 85, 11, 8), 110, 105);

      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text('Telefon', 20, 113);
      doc.text('E-posta', 110, 113);
      doc.setFontSize(11);
      doc.setTextColor(40);
      doc.text(pdfFit(doc, tr(reservations[0].customerPhone || firstCustomer?.phone || '-'), 86, 11, 8), 20, 119);
      doc.text(pdfFit(doc, tr(reservations[0].customerEmail || firstCustomer?.email || '-'), 85, 11, 8), 110, 119);

      // HİZMET KALEMLERİ
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(tr('HİZMET KALEMLERİ'), 20, 132);
      doc.line(20, 134, 195, 134);

      // Tablo başlığı
      doc.setFillColor(245, 245, 245);
      doc.rect(20, 137, 175, 7, 'F');
      doc.setFontSize(8);
      doc.setTextColor(80);
      doc.text(tr('OTEL / HİZMET'), 22, 142);
      doc.text(tr('AÇIKLAMA'), 80, 142);
      doc.text('GECE', 145, 142, { align: 'center' });
      doc.text(tr('GECELİK'), 165, 142, { align: 'right' });
      doc.text('TOPLAM', 193, 142, { align: 'right' });

      let yPos = 149;
      let subtotal = 0;
      const conceptLabel = (c) => MEAL_TR[c] || trUpper(c);

      reservations.forEach((r, i) => {
        const nights = calcNights(r.checkIn, r.checkOut);
        const totalForRes = parseFloat(r.price) || 0;
        const perNight = nights > 0 ? totalForRes / nights : totalForRes;
        subtotal += totalForRes;

        // Açıklama satırı
        const formatD = (d) => {
          if (!d) return '';
          const dt = new Date(d);
          return isNaN(dt) ? d : dt.toLocaleDateString('tr-TR');
        };
        const aciklama = `${tr(r.customerName || '')}\n${formatD(r.checkIn)} > ${formatD(r.checkOut)}\n${tr(r.roomType || '')} (${tr(conceptLabel(r.concept))})`;

        // Sıra zebra renk
        if (i % 2 === 1) {
          doc.setFillColor(250, 250, 250);
          doc.rect(20, yPos - 4, 175, 18, 'F');
        }

        doc.setFontSize(10);
        doc.setTextColor(40);
        doc.text(doc.splitTextToSize(tr(hotel.name), 55).slice(0, 3), 22, yPos);

        doc.setTextColor(80);
        const lines = aciklama.split('\n');
        lines.forEach((line, idx) => {
          doc.text(pdfFit(doc, line, 56, 8, 6.5), 80, yPos + (idx * 4));
        });

        doc.setFontSize(10);
        doc.setTextColor(40);
        doc.text(String(nights), 145, yPos + 4, { align: 'center' });
        doc.text(`${perNight.toFixed(2)}`, 165, yPos + 4, { align: 'right' });
        doc.text(`${totalForRes.toFixed(2)}`, 193, yPos + 4, { align: 'right' });

        yPos += 18;

        // Sayfa taşması koruması
        if (yPos > 240 && i < reservations.length - 1) {
          doc.addPage();
          yPos = 30;
        }
      });

      // Toplam + banka bloğu (~70mm) sayfaya sığmıyorsa yeni sayfa
      if (yPos + 70 > 280) { doc.addPage(); yPos = 30; }
      // Alt çizgi
      doc.setDrawColor(220, 220, 220);
      doc.line(20, yPos, 195, yPos);
      yPos += 8;

      // Toplamlar
      doc.setFontSize(10);
      doc.setTextColor(80);
      doc.text('Ara Toplam:', 145, yPos);
      doc.text(`${subtotal.toFixed(2)} ${currencyCode}`, 193, yPos, { align: 'right' });
      yPos += 6;
      doc.text('KDV (0%):', 145, yPos);
      doc.text(`0.00 ${currencyCode}`, 193, yPos, { align: 'right' });
      yPos += 8;

      doc.setFillColor(220, 53, 69);
      doc.rect(140, yPos - 5, 55, 10, 'F');
      doc.setFontSize(12);
      doc.setTextColor(255);
      doc.text('TOPLAM:', 145, yPos + 2);
      doc.text(`${subtotal.toFixed(2)} ${currencyCode}`, 193, yPos + 2, { align: 'right' });

      yPos += 18;

      // Banka bilgileri
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(tr('BANKA BİLGİLERİ'), 20, yPos);
      doc.setDrawColor(220, 220, 220);
      doc.line(20, yPos + 2, 195, yPos + 2);
      yPos += 7;
      doc.setFontSize(9);
      doc.setTextColor(40);
      const BKh = getActiveBanks(appSettings)[0];
      doc.text(tr(`${BKh.bankName} - ${BKh.branch} (${BKh.branchCode})`), 20, yPos);
      yPos += 5;
      doc.text(tr('Hesap Sahibi: Paydos Turizm Seyahat Acentalığı San. ve Tic. Ltd. Şti.'), 20, yPos);
      const hAccs = (Array.isArray(BKh.accounts) ? BKh.accounts : []).filter(a => a.iban);
      (hAccs.length ? hAccs : [{ currency: 'TL', iban: BKh.ibanTL }, { currency: 'EUR', iban: BKh.ibanEUR }].filter(a => a.iban)).forEach(a => {
        yPos += 5;
        doc.text(`IBAN (${a.currency}): ${a.iban}`, 20, yPos);
      });

      // Footer
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(tr('Bu proforma fatura bilgi amaçlıdır ve yasal belge niteliği taşımaz.'), 105, 285, { align: 'center' });
      doc.text('www.paydostur.com', 105, 290, { align: 'center' });

      // Kaydet
      const fileName = reservations.length === 1
        ? `Proforma_${tr(hotel.name).replace(/\s/g,'_')}_${tr(reservations[0].customerName || '').replace(/\s/g,'_')}.pdf`
        : `Proforma_${tr(hotel.name).replace(/\s/g,'_')}_Toplu_${reservations.length}rez.pdf`;
      doc.save(fileName);
      showToast?.('✅ Proforma indirildi', 'success');
    } catch (e) {
      console.error('Proforma hatası:', e);
      showToast?.('❌ Proforma oluşturulamadı: ' + e.message, 'error');
    }
  };

  // Checkbox seçimi için state (otel detayında)

  // ====== OTEL VOUCHER OLUŞTURUCU (İngilizce - otele gönderilir) ======
  const generateHotelVoucher = (hotel, reservation) => {
    if (!reservation) {
      showToast?.('Voucher için rezervasyon gerekli', 'error');
      return;
    }
    try {
      const doc = new jsPDF();

      // Türkçe karakter dönüştürücü (jsPDF font sorunu için)
      const ascii = pdfText(doc);

      const r = reservation;
      const nights = calcNights(r.checkIn, r.checkOut);
      const mealPlan = (c) => MEAL_EN[c] || (c || '').toUpperCase();
      const fmtEN = (d) => {
        if (!d) return '';
        const dt = new Date(d);
        if (isNaN(dt)) return d;
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        return `${days[dt.getDay()]}, ${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
      };
      const now = new Date();

      // Header - Acente
      doc.setFontSize(20);
      doc.setTextColor(220, 53, 69);
      doc.text('Paydos Tur', 20, 20);

      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text('Paydos Tourism and Travel Agency Co. Ltd.', 20, 26);
      doc.text(ascii('Mehmetçik Mah. Ulus Cad. No: 124/1 Denizli / Turkey'), 20, 30);
      doc.text(`Tel: +90 258 263 71 76 | Email: ${ascii(currentUser?.email || 'vize@paydostur.com')}`, 20, 34);

      // VOUCHER başlığı
      doc.setFontSize(20);
      doc.setTextColor(40);
      doc.text('HOTEL VOUCHER', 195, 22, { align: 'right' });
      doc.setFontSize(10);
      doc.setTextColor(220, 53, 69);
      const vno = `V-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(r.id || '').toString().slice(-4)}`;
      doc.text(vno, 195, 30, { align: 'right' });
      doc.setFontSize(8);
      doc.setTextColor(120);
      const issuedEN = (() => {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `Issued: ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
      })();
      doc.text(issuedEN, 195, 36, { align: 'right' });

      // HOTEL DETAILS Kutusu
      doc.setDrawColor(220, 53, 69);
      doc.setFillColor(255, 248, 248);
      doc.rect(20, 45, 175, 35, 'FD');
      doc.setFontSize(9);
      doc.setTextColor(220, 53, 69);
      doc.text('HOTEL DETAILS', 24, 51);
      const resCode = r.reservationCode || hotel.bookingCode || '';
      doc.setTextColor(40);
      doc.text(pdfFit(doc, ascii(hotel.name || ''), resCode ? 108 : 166, 14, 10), 24, 58);
      doc.setTextColor(80);
      if (hotel.address) doc.text(pdfFit(doc, `Address: ${ascii(hotel.address)}`, 166, 9, 7), 24, 64);
      if (hotel.city || hotel.country) doc.text(pdfFit(doc, `Location: ${ascii(hotel.city || '')}${hotel.country ? ', ' + ascii(hotel.country) : ''}`, 166, 9, 7), 24, 69);
      if (hotel.phone) doc.text(pdfFit(doc, `Phone: ${ascii(hotel.phone)}`, 166, 9, 7), 24, 74);
      if (resCode) {
        doc.setFillColor(220, 53, 69);
        doc.rect(135, 48, 58, 9, 'F');
        doc.setFontSize(7);
        doc.setTextColor(255, 255, 255);
        doc.text('RESERVATION CODE', 164, 52, { align: 'center' });
        doc.text(pdfFit(doc, ascii(resCode), 55, 10, 7), 164, 56, { align: 'center' });
      }

      // GUEST DETAILS
      let yPos = 86;
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text('GUEST DETAILS', 20, yPos);
      doc.setDrawColor(220, 220, 220);
      doc.line(20, yPos + 2, 195, yPos + 2);
      yPos += 9;

      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text('Full Name:', 20, yPos);
      doc.text('Number of Guests:', 110, yPos);
      doc.setTextColor(40);
      doc.text(pdfFit(doc, ascii(r.customerName || ''), 86, 12, 8), 20, yPos + 6);
      doc.setFontSize(12);
      doc.text(String(r.guests || 1), 110, yPos + 6);
      yPos += 14;

      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text('Phone:', 20, yPos);
      doc.text('Email:', 110, yPos);
      doc.setFontSize(10);
      doc.setTextColor(40);
      doc.text(pdfFit(doc, ascii(r.customerPhone || '-'), 86, 10, 8), 20, yPos + 6);
      doc.text(pdfFit(doc, ascii(r.customerEmail || '-'), 84, 10, 8), 110, yPos + 6);
      yPos += 16;

      // ACCOMMODATION DETAILS
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text('ACCOMMODATION DETAILS', 20, yPos);
      doc.line(20, yPos + 2, 195, yPos + 2);
      yPos += 7;

      doc.setFillColor(245, 245, 250);
      doc.rect(20, yPos, 175, 40, 'F');

      // Check-in
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text('CHECK-IN', 24, yPos + 7);
      doc.setFontSize(13);
      doc.setTextColor(40);
      doc.text(fmtEN(r.checkIn), 24, yPos + 15);
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text('From 14:00', 24, yPos + 21);

      // Check-out
      doc.text('CHECK-OUT', 110, yPos + 7);
      doc.setFontSize(13);
      doc.setTextColor(40);
      doc.text(fmtEN(r.checkOut), 110, yPos + 15);
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text('Until 12:00', 110, yPos + 21);

      // Night badge
      doc.setFillColor(220, 53, 69);
      doc.rect(155, yPos + 5, 35, 20, 'F');
      doc.setFontSize(20);
      doc.setTextColor(255);
      doc.text(String(nights), 172, yPos + 17, { align: 'center' });
      doc.setFontSize(8);
      doc.text(nights === 1 ? 'NIGHT' : 'NIGHTS', 172, yPos + 23, { align: 'center' });

      // Room + meal plan
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text('Room Type:', 24, yPos + 32);
      doc.text('Meal Plan:', 110, yPos + 32);
      doc.setTextColor(40);
      doc.text(pdfFit(doc, ascii(r.roomType || ''), 82, 11, 8), 24, yPos + 37);
      doc.text(pdfFit(doc, ascii(mealPlan(r.concept)), 80, 11, 8), 110, yPos + 37);

      yPos += 50;

      // SPECIAL NOTES
      if (r.notes) {
        doc.setFontSize(9);
        doc.setTextColor(120);
        doc.text('SPECIAL NOTES', 20, yPos);
        doc.line(20, yPos + 2, 195, yPos + 2);
        yPos += 7;
        doc.setFontSize(10);
        doc.setTextColor(40);
        let noteLines = doc.splitTextToSize(ascii(r.notes), 175);
        if (noteLines.length > 6) noteLines = [...noteLines.slice(0, 5), pdfFit(doc, noteLines.slice(5).join(' '), 175, 10)];
        doc.text(noteLines, 20, yPos);
        yPos += noteLines.length * 5 + 5;
      }

      // Damga + ödeme notu + koşullar (~84mm) altbilgiye taşacaksa yeni sayfaya geç
      if (yPos + 84 > 276) { doc.addPage(); yPos = 20; }
      // ÖDEME DURUMU DAMGASI (her zaman PAID)
      const pStat = 'PAID', pc = [34,197,94];
      doc.setDrawColor(pc[0], pc[1], pc[2]);
      doc.setLineWidth(1.5);
      doc.roundedRect(145, yPos, 50, 13, 2, 2, 'S');
      doc.setFontSize(6);
      doc.setTextColor(120);
      doc.text('PAYMENT STATUS', 170, yPos + 4, { align: 'center' });
      doc.setFontSize(pStat.length > 5 ? 9 : 13);
      doc.setTextColor(pc[0], pc[1], pc[2]);
      doc.text(pStat, 170, yPos + 10, { align: 'center' });
      doc.setLineWidth(0.2);
      doc.setDrawColor(220, 53, 69);
      yPos += 17;

      // PAYMENT NOTICE (önemli)
      doc.setFillColor(254, 226, 226);
      doc.setDrawColor(220, 53, 69);
      doc.rect(20, yPos, 175, 13, 'FD');
      doc.setFontSize(10);
      doc.setTextColor(220, 53, 69);
      doc.text('PAYMENT TO BE SETTLED BY THE AGENCY', 105, yPos + 6, { align: 'center' });
      doc.setFontSize(7);
      doc.setTextColor(80);
      doc.text('This voucher confirms the reservation made by Paydos Tourism on behalf of the guest.', 105, yPos + 10.5, { align: 'center' });
      yPos += 18;

      // ===== ÖNEMLİ NOTLAR + İPTAL POLİTİKASI (aynı sayfa, kompakt) =====
      doc.setFontSize(9);
      doc.setTextColor(220, 53, 69);
      doc.text('Important. Please Note', 20, yPos);
      yPos += 4.5;
      doc.setFontSize(6);
      doc.setTextColor(90);
      const note1 = [
        'Hotels may charge additional mandatory fees payable by the guest directly at the property, including but not exclusively: resort fee, facility fee, city tax, fee for the stay of foreign citizens.',
        'The guest can be also asked to provide a credit card or cash deposit as a guarantee of payment for additional services such as: mini-bar, pay-TV, etc.',
        'Agency is not responsible for the quality of services provided by the hotel. Client can contact administration of hotel directly to claim on volume and quality of provided services. In case of any issues during check-in or check-out, please contact the Agency.'
      ];
      note1.forEach(p => {
        const lines = doc.splitTextToSize(p, 175);
        doc.text(lines, 20, yPos);
        yPos += lines.length * 2.7 + 1.3;
      });
      yPos += 2.5;
      doc.setFontSize(9);
      doc.setTextColor(220, 53, 69);
      doc.text('Amendment & Cancellation Policy', 20, yPos);
      yPos += 4.5;
      doc.setFontSize(6);
      doc.setTextColor(90);
      const note2 = [
        'An alteration of Reservation by the Customer is considered as a cancellation of Reservation and making new Reservation. We will try to negotiate the order amendment with the supplier but we cannot guarantee it will be approved.',
        'Cancellation of reservation or no-show may result in penalties, according to rate and contract terms.',
        'Please notify in advance if you expect to check-in after 6 pm. Hotel may cancel the reservation and charge the no-show fee in case you do not show up by that time.'
      ];
      note2.forEach(p => {
        const lines = doc.splitTextToSize(p, 175);
        doc.text(lines, 20, yPos);
        yPos += lines.length * 2.7 + 1.3;
      });

      // Footer - Firma bilgisi
      doc.setDrawColor(220, 53, 69);
      doc.setLineWidth(0.3);
      doc.line(20, 278, 190, 278);
      doc.setFontSize(8);
      doc.setTextColor(80);
      doc.text('Paydos Tourism and Travel Agency Co. Ltd.', 105, 282, { align: 'center' });
      doc.setTextColor(120);
      doc.text(ascii('Mehmetçik Mah. Ulus Cad. No: 124/1 Denizli / Turkey'), 105, 286, { align: 'center' });
      doc.text(`Tel: +90 258 263 71 76 | Email: ${ascii(currentUser?.email || 'vize@paydostur.com')}`, 105, 290, { align: 'center' });
      doc.setTextColor(150);
      doc.text(`www.paydostur.com | ${vno}`, 105, 294, { align: 'center' });

      // Kaydet
      const fileName = `Voucher_${asciiTr(hotel.name || '').replace(/\s/g,'_')}_${asciiTr(r.customerName || '').replace(/\s/g,'_')}.pdf`;
      doc.save(fileName);
      showToast?.('✅ Voucher downloaded', 'success');
    } catch (e) {
      console.error('Voucher error:', e);
      showToast?.('❌ Voucher could not be created: ' + e.message, 'error');
    }
  };

  const [selectedResIds, setSelectedResIds] = useState([]);
  const [resSearch, setResSearch] = useState(''); // otel detayı: rezervasyonlarda ad soyad / etiket araması
  useEffect(() => { setResSearch(''); }, [selectedHotel?.id]);
  const toggleResSelection = (id) => {
    setSelectedResIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // Fiyat dönemleri açık/kapalı state
  const [expandedPeriods, setExpandedPeriods] = useState({});
  const togglePeriod = (id) => setExpandedPeriods(prev => ({ ...prev, [id]: !prev[id] }));
  const [pricesCollapsed, setPricesCollapsed] = useState(true);

  const filteredHotels = hotels.filter(h => {
    if (!searchQuery) return true;
    const q = normalizeTr(searchQuery);
    return normalizeTr(h.name).includes(normalizeTr(q)) || normalizeTr(h.city).includes(normalizeTr(q)) || normalizeTr(h.country).includes(normalizeTr(q));
  });

  // ====== LİSTE GÖRÜNÜMÜ ======
  if (view === 'list') {
    // ---- SEKME: PAKETLER ----
    if (mainTab === 'packages') {
      const inS = { ...inputStyle };
      const fmtP = (n, cur) => `${(parseFloat(n) || 0).toLocaleString('tr-TR')} ${cur || '€'}`;
      // PAKET FORMU
      if (pkgView === 'form' && editingPkg) {
        const pk = editingPkg;
        const setP = (patch) => setEditingPkg(prev => ({ ...prev, ...patch }));
        const hits = pCustSearch.trim().length >= 2 ? customers.filter(c => normalizeTr(`${c.firstName} ${c.lastName}`).includes(normalizeTr(pCustSearch)) || (c.phone || '').includes(pCustSearch)).slice(0, 8) : [];
        const cand = pk.customerName ? findPkgCandidates(pk.customerId, pk.customerName) : { hotel: [], flight: [], transfer: [], visa: [] };
        const isAdded = (refId) => (pk.items || []).some(it => it.refId === refId);
        const toggleItem = (it) => setP({ items: isAdded(it.refId) ? pk.items.filter(x => x.refId !== it.refId) : [...(pk.items || []), it] });
        const candSec = (title, list, color) => list.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', color, fontWeight: '700', marginBottom: '4px' }}>{title}</div>
            {list.map(it => (
              <div key={it.refId} onClick={() => toggleItem(it)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: isAdded(it.refId) ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isAdded(it.refId) ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.06)'}`, borderRadius: '8px', marginBottom: '4px', cursor: 'pointer' }}>
                <span style={{ fontSize: '12px', color: '#e8f1f8' }}>{isAdded(it.refId) ? '☑' : '☐'} {it.label}</span>
                <span style={{ fontSize: '12px', color: '#e8912a', fontWeight: '600' }}>{fmtP(it.amount, it.currency)}</span>
              </div>
            ))}
          </div>
        );
        return (
          <div style={{ padding: isMobile ? '12px' : '24px', maxWidth: '720px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>📦 {pk.id ? 'Paket Düzenle' : 'Paket Oluştur'}</h2>
              <button onClick={() => { setPkgView('list'); setEditingPkg(null); setPCustSearch(''); setManualItemKind(''); setManualItemLabel(''); setManualItemAmount(''); }} style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer' }}>← Geri</button>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px', display: 'grid', gap: '10px' }}>
              {pk.customerName ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px' }}>
                  <span style={{ flex: 1, fontSize: '14px', color: '#22c55e', fontWeight: '600' }}>✓ {titleCaseTr(pk.customerName)}</span>
                  <button onClick={() => setP({ customerId: '', customerName: '', items: [] })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px' }}>×</button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <label style={labelStyle}>Müşteri (ara veya elle yaz) *</label>
                  <input style={inS} value={pCustSearch} onFocus={() => setShowPCustList(true)} onBlur={() => setTimeout(() => setShowPCustList(false), 200)} onChange={e => { setPCustSearch(e.target.value); setShowPCustList(true); }} onKeyDown={e => { if (e.key === 'Enter' && pCustSearch.trim().length >= 2) { e.preventDefault(); setP({ customerName: pCustSearch.trim(), customerId: '' }); setPCustSearch(''); } }} placeholder="Kayıtlı müşteri ara veya ismi elle yazıp Enter'a basın..." />
                  {showPCustList && hits.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, background: '#0f2744', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', marginTop: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                      {hits.map(c => (
                        <div key={c.id} onMouseDown={() => { setP({ customerId: c.id, customerName: `${c.firstName} ${c.lastName}`.trim() }); setPCustSearch(''); }} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', color: '#e8f1f8', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          {fullNameTr(c)} <span style={{ color: '#64748b' }}>· {c.phone || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {pCustSearch.trim().length >= 2 && (
                    <button onMouseDown={() => { setP({ customerName: pCustSearch.trim(), customerId: '' }); setPCustSearch(''); }} style={{ marginTop: '6px', padding: '7px 12px', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '6px', color: '#a78bfa', cursor: 'pointer', fontSize: '12px' }}>
                      + "{pCustSearch.trim()}" olarak kayıtsız müşteri kullan
                    </button>
                  )}
                </div>
              )}
              <div><label style={labelStyle}>Paket Başlığı</label><input style={inS} value={pk.title} onChange={e => setP({ title: e.target.value })} placeholder="Madrid Konser Paketi" /></div>
              {pk.customerName && (
                <div>
                  <label style={labelStyle}>Kalemler — müşterinin kayıtlarından seç (tıkla ekle/çıkar)</label>
                  <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', padding: '10px' }}>
                    {candSec('🏨 OTEL REZERVASYONLARI', cand.hotel, '#f59e0b')}
                    {candSec('✈️ UÇUŞ REZERVASYONLARI', cand.flight, '#3b82f6')}
                    {candSec('🚐 TRANSFERLER', cand.transfer, '#a78bfa')}
                    {!cand.hotel.length && !cand.flight.length && !cand.transfer.length && (
                      <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Bu müşteriye ait sistemde kayıtlı otel/uçuş/transfer kaydı yok. Aşağıdan elle kalem ekleyebilirsiniz.</p>
                    )}
                  </div>
                </div>
              )}
              {pk.customerName && (() => {
                const icons = { hotel: '🏨', flight: '✈️', transfer: '🚐', other: '📌' };
                const labels = { hotel: 'Otel', flight: 'Uçuş', transfer: 'Transfer', other: 'Diğer' };
                const colors = { hotel: '#f59e0b', flight: '#3b82f6', transfer: '#a78bfa', other: '#94a3b8' };
                return (
                  <div>
                    <label style={labelStyle}>Elle Kalem Ekle</label>
                    <div style={{ display: 'flex', gap: '6px', marginBottom: manualItemKind ? '8px' : 0, flexWrap: 'wrap' }}>
                      {['hotel', 'flight', 'transfer', 'other'].map(k => (
                        <button key={k} onClick={() => setManualItemKind(manualItemKind === k ? '' : k)} style={{ padding: '6px 12px', background: manualItemKind === k ? `${colors[k]}30` : 'rgba(255,255,255,0.05)', border: `1px solid ${manualItemKind === k ? colors[k] : 'rgba(255,255,255,0.1)'}`, borderRadius: '8px', color: manualItemKind === k ? colors[k] : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>{icons[k]} + {labels[k]} Ekle</button>
                      ))}
                    </div>
                    {manualItemKind && (
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 80px auto', gap: '6px', alignItems: 'end', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px' }}>
                        <div><label style={{ ...labelStyle, fontSize: '10px' }}>Açıklama</label><input style={inS} value={manualItemLabel} onChange={e => setManualItemLabel(e.target.value)} placeholder={`örn: ${labels[manualItemKind]} — detay`} /></div>
                        <div><label style={{ ...labelStyle, fontSize: '10px' }}>Tutar</label><input type="number" style={inS} value={manualItemAmount} onChange={e => setManualItemAmount(e.target.value)} /></div>
                        <div><label style={{ ...labelStyle, fontSize: '10px' }}>Para</label>
                          <select style={selectStyle} value={manualItemCurrency} onChange={e => setManualItemCurrency(e.target.value)}>
                            {['€','$','₺','£'].map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}
                          </select>
                        </div>
                        <button onClick={() => {
                          if (!manualItemLabel.trim()) { showToast?.('Açıklama girin', 'error'); return; }
                          const it = { kind: manualItemKind, refId: `manual-${Date.now()}`, label: `${icons[manualItemKind]} ${manualItemLabel.trim()}`, amount: parseFloat(manualItemAmount) || 0, currency: manualItemCurrency };
                          setP({ items: [...(pk.items || []), it] });
                          setManualItemKind(''); setManualItemLabel(''); setManualItemAmount('');
                        }} style={{ padding: '9px 14px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>Ekle</button>
                      </div>
                    )}
                  </div>
                );
              })()}
              {(pk.items || []).length > 0 && (
                <div style={{ padding: '10px 14px', background: 'rgba(232,145,42,0.08)', borderRadius: '8px', fontSize: '13px', color: '#e8912a', fontWeight: '600' }}>
                  {pk.items.length} kalem · Toplam: {fmtP(pkgTotal(pk), pkgCurrency(pk))}
                </div>
              )}
              <div><label style={labelStyle}>Not</label><input style={inS} value={pk.notes} onChange={e => setP({ notes: e.target.value })} placeholder="Özel notlar..." /></div>
              <button onClick={savePkg} style={{ padding: '13px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>💾 Kaydet</button>
            </div>
          </div>
        );
      }
      // PAKET LİSTESİ
      return (
        <div style={{ padding: isMobile ? '12px' : '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setMainTab('hotels')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>🏨 Oteller</button>
              <button onClick={() => setMainTab('flights')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>✈️ Grup Uçuşlar ({groupFlights.length})</button>
              <button onClick={() => setMainTab('transfers')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>🚐 Transferler ({transfers.length})</button>
              <button style={{ padding: '9px 16px', background: 'linear-gradient(135deg, #06b6d4, #0891b2)', border: 'none', borderRadius: '10px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>📦 Paketler ({packages.length})</button>
            </div>
            <button onClick={() => { setEditingPkg({ ...emptyPackage }); setPkgView('form'); }} style={{ background: 'linear-gradient(135deg, #06b6d4, #0891b2)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>➕ Paket Oluştur</button>
          </div>
          {packages.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '13px' }}>Henüz paket yok. Müşterinin otel + uçuş + transfer + vize kayıtlarından istediklerinizi birleştirip paket oluşturun — proforması tek belgede çıkar.</p>
          ) : (
            <>
            {(() => {
              const tagList = [...new Set(packages.map(p => String(p.tag || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
              const selPk = packages.filter(p => pkgSel.includes(p.id));
              return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                  {tagList.map(t => {
                    const ids = packages.filter(p => normalizeTr(p.tag) === normalizeTr(t)).map(p => p.id);
                    const on = ids.length && ids.every(id => pkgSel.includes(id));
                    return <button key={t} onClick={() => setPkgSel(on ? pkgSel.filter(id => !ids.includes(id)) : [...new Set([...pkgSel, ...ids])])} style={{ padding: '5px 10px', borderRadius: '14px', fontSize: '12px', cursor: 'pointer', background: on ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${on ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.1)'}`, color: on ? '#fbbf24' : '#94a3b8' }}>🏷️ {t} ({ids.length})</button>;
                  })}
                  {selPk.length > 0 && <>
                    <button onClick={() => generatePackageProforma(selPk)} style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>📄 Tek proforma ({selPk.length} paket)</button>
                    <button onClick={() => setPkgSel([])} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>Seçimi temizle</button>
                  </>}
                  {!selPk.length && <span style={{ fontSize: '11px', color: '#64748b' }}>Birden fazla paketi tek proformada birleştirmek için kartlardaki kutuları veya etiketi seçin.</span>}
                </div>
              );
            })()}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
              {packages.map(pk => (
                <div key={pk.id} style={{ background: pkgSel.includes(pk.id) ? 'rgba(139,92,246,0.10)' : 'rgba(6,182,212,0.05)', borderRadius: '14px', padding: '16px', border: `1px solid ${pkgSel.includes(pk.id) ? 'rgba(139,92,246,0.45)' : 'rgba(6,182,212,0.2)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', gap: '8px' }}>
                    <span style={{ fontSize: '15px', fontWeight: '700', color: '#e8f1f8', display: 'flex', alignItems: 'center', gap: '8px' }}><input type="checkbox" checked={pkgSel.includes(pk.id)} onChange={() => setPkgSel(pkgSel.includes(pk.id) ? pkgSel.filter(id => id !== pk.id) : [...pkgSel, pk.id])} style={{ cursor: 'pointer' }} />📦 {pk.title || 'Paket'}</span>
                    <span style={{ fontSize: '13px', color: '#e8912a', fontWeight: '700' }}>{(pkgTotal(pk)).toLocaleString('tr-TR')} {pkgCurrency(pk)}</span>
                  </div>
                  <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#94a3b8' }}>{titleCaseTr(pk.customerName)}{pk.tag && <span style={{ marginLeft: '6px', padding: '1px 6px', background: 'rgba(254,243,199,0.2)', color: '#fbbf24', borderRadius: '3px', fontSize: '10px', fontWeight: '600' }}>🏷️ {pk.tag}</span>}</p>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '10px' }}>
                    {(pk.items || []).map((it, i) => <div key={i} style={{ padding: '2px 0' }}>{it.label} — <b style={{ color: '#e8912a' }}>{(parseFloat(it.amount) || 0).toLocaleString('tr-TR')} {it.currency}</b></div>)}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => { setEditingPkg({ ...emptyPackage, ...pk }); setPkgView('form'); }} style={{ flex: 1, padding: '8px', background: 'rgba(59,130,246,0.2)', border: 'none', borderRadius: '6px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>✏️ Düzenle</button>
                    <button onClick={() => generatePackageProforma(pk)} style={{ padding: '8px 12px', background: 'rgba(139,92,246,0.2)', border: 'none', borderRadius: '6px', color: '#a78bfa', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>📄 Proforma</button>
                    <button onClick={() => deletePkg(pk.id)} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      );
    }
    // ---- SEKME: TRANSFERLER ----
    if (mainTab === 'transfers') {
      const inS = { ...inputStyle };
      const fmtT = (n, cur) => `${(parseFloat(n) || 0).toLocaleString('tr-TR')} ${cur || '€'}`;
      // TRANSFER SEÇENEĞİ FORMU
      if (transferView === 'form' && editingTransfer) {
        const t = editingTransfer;
        const setT = (patch) => setEditingTransfer(prev => ({ ...prev, ...patch }));
        return (
          <div style={{ padding: isMobile ? '12px' : '24px', maxWidth: '700px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>🚐 {t.id ? 'Transfer Düzenle' : 'Transfer Seçeneği Ekle'}</h2>
              <button onClick={() => { setTransferView('list'); setEditingTransfer(null); }} style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer' }}>← Geri</button>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px', display: 'grid', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr', gap: '8px' }}>
                <div><label style={labelStyle}>Araç Tipi</label>
                  <select style={selectStyle} value={t.vehicleType} onChange={e => setT({ vehicleType: e.target.value })}>
                    {['VIP Minivan', 'Minibüs', 'Midibüs', 'Otobüs', 'Binek Araç', 'VIP Vito'].map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}
                  </select>
                </div>
                <div><label style={labelStyle}>Saat</label><input style={inS} value={t.time} onChange={e => setT({ time: e.target.value })} placeholder="14:30" /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div><label style={labelStyle}>Nereden *</label><input style={inS} value={t.fromLoc} onChange={e => setT({ fromLoc: e.target.value })} placeholder="İzmir ADB Havalimanı" /></div>
                <div><label style={labelStyle}>Nereye *</label><input style={inS} value={t.toLoc} onChange={e => setT({ toLoc: e.target.value })} placeholder="Otel" /></div>
              </div>
              <div><label style={labelStyle}>Uçuş Bilgisi (opsiyonel)</label><input style={inS} value={t.flightInfo} onChange={e => setT({ flightInfo: e.target.value })} placeholder="XQ 920 · İzmir → Madrid · 15:20" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '8px' }}>
                <div><label style={labelStyle}>Kapasite (kişi)</label><input type="number" style={inS} value={t.capacity} onChange={e => setT({ capacity: e.target.value })} placeholder="boş=sınırsız" /></div>
                <div><label style={labelStyle}>Alış (kişi başı)</label><input type="number" style={inS} value={t.buyPrice} onChange={e => setT({ buyPrice: e.target.value })} /></div>
                <div><label style={labelStyle}>Satış (kişi başı)</label><input type="number" style={inS} value={t.sellPrice} onChange={e => setT({ sellPrice: e.target.value })} /></div>
                <div><label style={labelStyle}>Para Birimi</label>
                  <select style={selectStyle} value={t.currency} onChange={e => setT({ currency: e.target.value })}>
                    {['€','$','₺','£'].map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}
                  </select>
                </div>
              </div>
              <div><label style={labelStyle}>Not</label><input style={inS} value={t.notes} onChange={e => setT({ notes: e.target.value })} placeholder="Özel notlar..." /></div>
              <button onClick={saveTransfer} style={{ padding: '13px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>💾 Kaydet</button>
            </div>
          </div>
        );
      }
      // TRANSFER DETAY + REZERVASYONLAR
      if (transferView === 'detail' && selectedTransfer) {
        const tr2 = transfers.find(x => x.id === selectedTransfer.id) || selectedTransfer;
        const active = (tr2.reservations || []).filter(r => !r.cancelled);
        const usedPax = active.reduce((s, r) => s + (parseInt(r.pax) || 1), 0);
        const cap = parseInt(tr2.capacity) || 0;
        const kalan = cap > 0 ? cap - usedPax : null;
        const toplamSatis = active.reduce((s, r) => s + tResTotal(r), 0);
        const toplamAlis = active.reduce((s, r) => s + tResCost(r), 0);
        const odenmemis = active.filter(r => !r.paid).reduce((s, r) => s + tResTotal(r), 0);
        // REZERVASYON FORMU
        if (showTResForm && editingTRes) {
          const r = editingTRes;
          const setR = (patch) => setEditingTRes(prev => ({ ...prev, ...patch }));
          const hits = tCustSearch.trim().length >= 2 ? customers.filter(c => normalizeTr(`${c.firstName} ${c.lastName}`).includes(normalizeTr(tCustSearch)) || (c.phone || '').includes(tCustSearch)).slice(0, 8) : [];
          return (
            <div style={{ padding: isMobile ? '12px' : '24px', maxWidth: '680px', margin: '0 auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '17px', margin: 0 }}>➕ Rezervasyon — {tr2.fromLoc} → {tr2.toLoc}</h2>
                <button onClick={() => { setShowTResForm(false); setEditingTRes(null); setTCustSearch(''); }} style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer' }}>← Geri</button>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px', display: 'grid', gap: '10px' }}>
                {r.customerName ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px' }}>
                    <span style={{ flex: 1, fontSize: '14px', color: '#22c55e', fontWeight: '600' }}>✓ {r.customerName}</span>
                    <button onClick={() => setR({ customerId: '', customerName: '', phone: '' })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px' }}>×</button>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <label style={labelStyle}>Müşteri (ara veya elle yaz) *</label>
                    <input style={inS} value={tCustSearch} onFocus={() => setShowTCustList(true)} onBlur={() => setTimeout(() => setShowTCustList(false), 200)} onChange={e => { setTCustSearch(e.target.value); setR({ customerName: e.target.value }); setShowTCustList(true); }} placeholder="Müşteri ara veya ismi elle yaz..." />
                    {showTCustList && hits.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, background: '#0f2744', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', marginTop: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                        {hits.map(c => (
                          <div key={c.id} onMouseDown={() => { setR({ customerId: c.id, customerName: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone || '' }); setTCustSearch(''); }} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', color: '#e8f1f8', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            {fullNameTr(c)} <span style={{ color: '#64748b' }}>· {c.phone || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '8px' }}>
                  <div><label style={labelStyle}>Kişi Sayısı</label><input type="number" style={inS} value={r.pax} onChange={e => setR({ pax: e.target.value })} min="1" /></div>
                  <div><label style={labelStyle}>Satış (kişi başı)</label><input type="number" style={inS} value={r.sellPrice} onChange={e => setR({ sellPrice: e.target.value })} /></div>
                  <div><label style={labelStyle}>Alış (kişi başı)</label><input type="number" style={inS} value={r.buyPrice} onChange={e => setR({ buyPrice: e.target.value })} /></div>
                  <div><label style={labelStyle}>Ödeme</label>
                    <select style={selectStyle} value={r.paid ? '1' : '0'} onChange={e => setR({ paid: e.target.value === '1' })}>
                      <option value="0" style={{ background: '#0c1929' }}>Ödemedi</option>
                      <option value="1" style={{ background: '#0c1929' }}>✓ Ödedi</option>
                    </select>
                  </div>
                </div>
                <div><label style={labelStyle}>Not</label><input style={inS} value={r.notes} onChange={e => setR({ notes: e.target.value })} placeholder="Özel notlar..." /></div>
                <div style={{ padding: '10px 14px', background: 'rgba(232,145,42,0.08)', borderRadius: '8px', fontSize: '13px', color: '#e8912a', fontWeight: '600' }}>
                  Toplam Satış: {fmtT(tResTotal(r), tr2.currency)}{r.buyPrice ? ` · Maliyet: ${fmtT(tResCost(r), tr2.currency)} · Kâr: ${fmtT(tResTotal(r) - tResCost(r), tr2.currency)}` : ''}
                </div>
                <button onClick={saveTRes} style={{ padding: '13px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>💾 Kaydet</button>
              </div>
            </div>
          );
        }
        return (
          <div style={{ padding: isMobile ? '12px' : '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <button onClick={() => { setTransferView('list'); setSelectedTransfer(null); }} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer', fontSize: '12px', marginBottom: '8px' }}>← Geri</button>
                <h2 style={{ fontSize: '19px', margin: 0 }}>🚐 {tr2.fromLoc} → {tr2.toLoc}</h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>{tr2.vehicleType}{tr2.date ? ` · ${formatDate(tr2.date)}` : ''}{tr2.time ? ` ${tr2.time}` : ''}{tr2.flightInfo ? ` · ${tr2.flightInfo}` : ''}</p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => { setEditingTRes({ ...emptyTRes, sellPrice: tr2.sellPrice, buyPrice: tr2.buyPrice, currency: tr2.currency }); setShowTResForm(true); }} disabled={kalan !== null && kalan <= 0} style={{ padding: '9px 16px', background: (kalan === null || kalan > 0) ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)' : 'rgba(100,116,139,0.3)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: '600', cursor: (kalan === null || kalan > 0) ? 'pointer' : 'not-allowed', fontSize: '13px' }}>➕ Rezervasyon</button>
                <button onClick={() => { setEditingTransfer({ ...tr2 }); setTransferView('form'); }} style={{ padding: '9px 14px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontSize: '13px' }}>✏️</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' }}>
              {[
                [cap > 0 ? `${usedPax}/${cap}` : usedPax, cap > 0 ? 'Dolu / Kapasite' : 'Toplam Kişi', '#8b5cf6'],
                [kalan !== null ? kalan : '∞', 'Kalan', kalan !== null && kalan <= 2 ? '#ef4444' : '#10b981'],
                [fmtT(toplamSatis, tr2.currency), 'Toplam Satış', '#e8912a'],
                [fmtT(toplamSatis - toplamAlis, tr2.currency), 'Kâr', (toplamSatis - toplamAlis) >= 0 ? '#10b981' : '#ef4444'],
                [fmtT(odenmemis, tr2.currency), 'Ödenmemiş', odenmemis > 0 ? '#ef4444' : '#10b981'],
              ].map(([v, l, c], i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: c }}>{v}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{l}</div>
                </div>
              ))}
            </div>
            {active.length === 0 ? <p style={{ color: '#64748b', fontSize: '13px' }}>Henüz rezervasyon yok. "➕ Rezervasyon" ile ekleyin.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    {['Müşteri', 'Kişi', 'Satış', 'Ödeme', ''].map((h, i) => <th key={i} style={{ padding: '8px', textAlign: 'left', color: '#94a3b8', fontSize: '11px' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {active.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '8px', color: '#e8f1f8', fontWeight: '600' }}>{titleCaseTr(r.customerName)}{r.notes ? <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '400' }}>{r.notes}</div> : null}</td>
                        <td style={{ padding: '8px', color: '#94a3b8' }}>{r.pax || 1}</td>
                        <td style={{ padding: '8px', color: '#e8912a' }}>{fmtT(tResTotal(r), tr2.currency)}</td>
                        <td style={{ padding: '8px' }}>{r.paid ? <span style={{ color: '#10b981', fontWeight: '600' }}>✓ Ödedi</span> : <span style={{ color: '#ef4444' }}>Ödemedi</span>}</td>
                        <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                          <button onClick={() => { setEditingTRes({ ...emptyTRes, ...r }); setShowTResForm(true); }} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '14px' }} title="Düzenle">✏️</button>
                          <button onClick={() => cancelTRes(tr2, r.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px' }} title="İptal">⊘</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      }
      // TRANSFER SEÇENEĞİ LİSTESİ
      return (
        <div style={{ padding: isMobile ? '12px' : '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setMainTab('hotels')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>🏨 Oteller</button>
              <button onClick={() => setMainTab('flights')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>✈️ Grup Uçuşlar ({groupFlights.length})</button>
              <button style={{ padding: '9px 16px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '10px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>🚐 Transferler ({transfers.length})</button>
              <button onClick={() => setMainTab('packages')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>📦 Paketler ({packages.length})</button>
            </div>
            <button onClick={() => { setEditingTransfer({ ...emptyTransfer }); setTransferView('form'); }} style={{ background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>➕ Transfer Ekle</button>
          </div>
          {transfers.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '13px' }}>Henüz transfer yok. Önce "➕ Transfer Ekle" ile güzergah/araç tanımlayın, sonra içine rezervasyon ekleyin.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
              {transfers.map(tr2 => {
                const active = (tr2.reservations || []).filter(r => !r.cancelled);
                const usedPax = active.reduce((s, r) => s + (parseInt(r.pax) || 1), 0);
                const cap = parseInt(tr2.capacity) || 0;
                const kalan = cap > 0 ? cap - usedPax : null;
                const doluluk = cap > 0 ? Math.round((usedPax / cap) * 100) : 0;
                return (
                  <div key={tr2.id} onClick={() => { setSelectedTransfer(tr2); setTransferView('detail'); }} style={{ background: 'rgba(139,92,246,0.05)', borderRadius: '14px', padding: '16px', border: '1px solid rgba(139,92,246,0.2)', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '15px', fontWeight: '700', color: '#e8f1f8' }}>🚐 {tr2.fromLoc} → {tr2.toLoc}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '10px', background: 'rgba(139,92,246,0.2)', color: '#a78bfa', fontWeight: '700' }}>{tr2.vehicleType}</span>
                        <button onClick={(e) => { e.stopPropagation(); duplicateTransfer(tr2); }} style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '6px', color: '#a78bfa', cursor: 'pointer', fontSize: '12px', padding: '2px 7px' }} title="Kopyala (aynısından yeni transfer)">📋</button>
                        <button onClick={(e) => { e.stopPropagation(); deleteTransfer(tr2.id); }} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', padding: '2px 7px' }} title="Sil">🗑️</button>
                      </div>
                    </div>
                    <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#94a3b8' }}>{tr2.date ? formatDate(tr2.date) : 'Tarih yok'}{tr2.time ? ` · ${tr2.time}` : ''}</p>
                    {cap > 0 && (
                      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '8px', height: '8px', marginBottom: '6px', overflow: 'hidden' }}>
                        <div style={{ width: `${doluluk}%`, height: '100%', background: doluluk >= 90 ? '#ef4444' : doluluk >= 70 ? '#e8912a' : '#10b981', borderRadius: '8px' }} />
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: '#94a3b8' }}>{cap > 0 ? `${usedPax}/${cap} · ` : `${usedPax} kişi · `}<b style={{ color: '#10b981' }}>{active.length} rez.</b></span>
                      <span style={{ color: '#e8912a', fontWeight: '600' }}>{tr2.sellPrice ? `${tr2.sellPrice} ${tr2.currency}` : ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // ---- SEKME: GRUP UÇUŞLAR ----
    if (mainTab === 'flights') {
      const inS = { ...inputStyle };
      const fmt = (n, cur) => `${(parseFloat(n) || 0).toLocaleString('tr-TR')} ${cur || '€'}`;
      // UÇUŞ FORMU
      if (flightView === 'form' && editingFlight) {
        const f = editingFlight;
        const set = (patch) => setEditingFlight(prev => ({ ...prev, ...patch }));
        return (
          <div style={{ padding: isMobile ? '12px' : '24px', maxWidth: '760px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>✈️ {f.id ? 'Uçuş Düzenle' : 'Grup Uçuş Ekle'}</h2>
              <button onClick={() => { setFlightView('list'); setEditingFlight(null); }} style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer' }}>← Geri</button>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px', display: 'grid', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr', gap: '8px' }}>
                <div><label style={labelStyle}>Yön</label>
                  <select style={selectStyle} value={f.direction} onChange={e => set({ direction: e.target.value })}>
                    <option value="Gidiş" style={{ background: '#0c1929' }}>Gidiş</option>
                    <option value="Dönüş" style={{ background: '#0c1929' }}>Dönüş</option>
                  </select>
                </div>
                <div><label style={labelStyle}>Havayolu *</label><input style={inS} value={f.airline} onChange={e => set({ airline: e.target.value })} placeholder="SunExpress" /></div>
                <div><label style={labelStyle}>Uçuş No</label><input style={inS} value={f.flightNo} onChange={e => set({ flightNo: e.target.value })} placeholder="XQ 920" /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '8px' }}>
                <div><label style={labelStyle}>Kalkış *</label><input style={inS} value={f.from} onChange={e => set({ from: e.target.value })} placeholder="İzmir ADB" /></div>
                <div><label style={labelStyle}>Varış *</label><input style={inS} value={f.to} onChange={e => set({ to: e.target.value })} placeholder="Madrid MAD" /></div>
                <div><label style={labelStyle}>Tarih *</label><input type="date" style={inS} value={f.date} onChange={e => set({ date: e.target.value })} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <div><label style={labelStyle}>Kalkış Saati</label><input style={inS} value={f.depTime} onChange={e => set({ depTime: e.target.value })} placeholder="15:20" /></div>
                  <div><label style={labelStyle}>Varış Saati</label><input style={inS} value={f.arrTime} onChange={e => set({ arrTime: e.target.value })} placeholder="18:45" /></div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '8px' }}>
                <div><label style={labelStyle}>Kontenjan *</label><input type="number" style={inS} value={f.capacity} onChange={e => set({ capacity: e.target.value })} placeholder="40" /></div>
                <div><label style={labelStyle}>Alış Fiyatı (kişi)</label><input type="number" style={inS} value={f.buyPrice} onChange={e => set({ buyPrice: e.target.value })} placeholder="85" /></div>
                <div><label style={labelStyle}>Satış Fiyatı (kişi)</label><input type="number" style={inS} value={f.sellPrice} onChange={e => set({ sellPrice: e.target.value })} placeholder="120" /></div>
                <div><label style={labelStyle}>Para Birimi</label>
                  <select style={selectStyle} value={f.currency} onChange={e => set({ currency: e.target.value })}>
                    {['€','$','₺','£'].map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}
                  </select>
                </div>
              </div>
              {/* 💳 Havayoluna ödeme: ön ödeme + kalan ödeme, tarihleriyle (bizim havayoluna ödediğimiz) */}
              {(() => {
                const ap = f.airlinePay || {};
                const setAp = (patch) => set({ airlinePay: { ...ap, ...patch } });
                const total = (parseFloat(f.capacity) || 0) * (parseFloat(String(f.buyPrice).replace(',', '.')) || 0);
                const dep = parseFloat(ap.depAmount) || 0, bal = parseFloat(ap.balAmount) || 0;
                const row = (k, title, ph) => (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1.1fr 1fr 1fr auto', gap: '8px', alignItems: 'end', marginBottom: '8px' }}>
                    <div style={{ gridColumn: isMobile ? '1 / -1' : 'auto', fontSize: '13px', fontWeight: 600, color: '#e8f1f8', paddingBottom: isMobile ? 0 : '10px' }}>{title}</div>
                    <div><label style={labelStyle}>Tutar ({f.currency || '€'})</label><input type="number" inputMode="decimal" min="0" style={inS} value={ap[k + 'Amount'] ?? ''} onChange={e => setAp({ [k + 'Amount']: e.target.value })} placeholder={ph} /></div>
                    <div><label style={labelStyle}>Son ödeme tarihi</label><input type="date" style={inS} value={ap[k + 'Date'] || ''} onChange={e => setAp({ [k + 'Date']: e.target.value })} /></div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: ap[k + 'Paid'] ? '#10b981' : '#94a3b8', paddingBottom: '10px', cursor: 'pointer', whiteSpace: 'nowrap' }}><input type="checkbox" checked={!!ap[k + 'Paid']} onChange={e => setAp({ [k + 'Paid']: e.target.checked })} /> Ödendi</label>
                  </div>);
                return (
                  <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)' }}>
                    <div style={{ fontSize: '13px', color: '#f59e0b', fontWeight: 700, marginBottom: '8px' }}>💳 Havayoluna Ödeme <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 400 }}>(bizim havayoluna ödediğimiz{total > 0 ? ` · toplam alış ${total.toLocaleString('tr-TR')} ${f.currency || '€'} = ${f.capacity} × ${f.buyPrice}` : ''})</span></div>
                    {row('dep', 'Ön ödeme', 'örn. 5000')}
                    {row('bal', 'Kalan ödeme', total > 0 && dep > 0 ? String(Math.max(0, Math.round((total - dep) * 100) / 100)) : 'kalan tutar')}
                    {total > 0 && dep > 0 && !String(ap.balAmount ?? '').trim() && <button type="button" onClick={() => setAp({ balAmount: String(Math.max(0, Math.round((total - dep) * 100) / 100)) })} style={{ padding: '5px 10px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '6px', color: '#f59e0b', cursor: 'pointer', fontSize: '11px' }}>Kalanı hesapla: {Math.max(0, Math.round((total - dep) * 100) / 100).toLocaleString('tr-TR')} {f.currency || '€'}</button>}
                    {total > 0 && dep > 0 && bal > 0 && Math.abs(dep + bal - total) > 0.5 && <div style={{ fontSize: '11px', color: '#fbbf24' }}>⚠️ Ön ödeme + kalan = {(dep + bal).toLocaleString('tr-TR')} {f.currency || '€'}; toplam alış {total.toLocaleString('tr-TR')} {f.currency || '€'} ile uyuşmuyor.</div>}
                  </div>);
              })()}
              <div><label style={labelStyle}>Notlar</label><input style={inS} value={f.notes} onChange={e => set({ notes: e.target.value })} placeholder="Opsiyon tarihi, PNR, özel şartlar..." /></div>
              <button onClick={saveFlight} style={{ padding: '13px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>💾 Kaydet</button>
            </div>
          </div>
        );
      }
      // UÇUŞ DETAY + REZERVASYONLAR
      if (flightView === 'detail' && selectedFlight) {
        const fl = groupFlights.find(x => x.id === selectedFlight.id) || selectedFlight;
        const active = (fl.reservations || []).filter(r => !r.cancelled);
        const dups = dupPassengers(active);
        const kalan = (parseInt(fl.capacity) || 0) - active.length;
        const toplamSatis = active.reduce((s, r) => s + flightResTotal(r), 0);
        const toplamAlis = active.reduce((s, r) => s + (flightResCost(r) || (parseFloat(fl.buyPrice) || 0)), 0);
        const odenmemis = active.filter(r => !r.paid).reduce((s, r) => s + flightResTotal(r), 0);
        // REZERVASYON FORMU
        if (showFResForm && editingFRes) {
          const r = editingFRes;
          const setR = (patch) => setEditingFRes(prev => ({ ...prev, ...patch }));
          const hits = fCustSearch.trim().length >= 2 ? customers.filter(c => normalizeTr(`${c.firstName} ${c.lastName}`).includes(normalizeTr(fCustSearch)) || (c.phone || '').includes(fCustSearch)).slice(0, 8) : [];
          return (
            <div style={{ padding: isMobile ? '12px' : '24px', maxWidth: '700px', margin: '0 auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '17px', margin: 0 }}>➕ Rezervasyon — {fl.from} → {fl.to}</h2>
                <button onClick={() => { setShowFResForm(false); setEditingFRes(null); setFCustSearch(''); }} style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer' }}>← Geri</button>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px', display: 'grid', gap: '10px' }}>
                {r.customerName ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px' }}>
                    <span style={{ flex: 1, fontSize: '14px', color: '#22c55e', fontWeight: '600' }}>✓ {r.customerName}</span>
                    <button onClick={() => setR({ customerId: '', customerName: '', phone: '' })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px' }}>×</button>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <label style={labelStyle}>Müşteri Seç *</label>
                    <input style={inS} value={fCustSearch} onFocus={() => setShowFCustList(true)} onBlur={() => setTimeout(() => setShowFCustList(false), 200)} onChange={e => { setFCustSearch(e.target.value); setShowFCustList(true); }} placeholder="Ad, soyad veya telefon ile ara..." />
                    {showFCustList && hits.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, background: '#0f2744', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', marginTop: '4px', maxHeight: '220px', overflowY: 'auto' }}>
                        {hits.map(c => (
                          <div key={c.id} onMouseDown={() => { setR({ customerId: c.id, customerName: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone || '' }); setFCustSearch(''); }} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', color: '#e8f1f8', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            {fullNameTr(c)} <span style={{ color: '#64748b' }}>· {c.phone || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr', gap: '8px' }}>
                  <div><label style={labelStyle}>Satış Fiyatı</label><input type="number" style={inS} value={r.sellPrice} onChange={e => setR({ sellPrice: e.target.value })} /></div>
                  <div><label style={labelStyle}>Alış Fiyatı</label><input type="number" style={inS} value={r.buyPrice} onChange={e => setR({ buyPrice: e.target.value })} /></div>
                  <div><label style={labelStyle}>Ödeme</label>
                    <select style={selectStyle} value={r.paid ? '1' : '0'} onChange={e => setR({ paid: e.target.value === '1' })}>
                      <option value="0" style={{ background: '#0c1929' }}>Ödemedi</option>
                      <option value="1" style={{ background: '#0c1929' }}>✓ Ödedi</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={labelStyle}>Ekstralar</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => setR({ extras: [...(r.extras || []), { type: 'Ekstra Koltuk', buy: '', sell: '' }] })} style={{ padding: '5px 10px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px' }}>+ Ekstra Koltuk</button>
                      <button onClick={() => setR({ extras: [...(r.extras || []), { type: 'Ekstra Bagaj', buy: '', sell: '' }] })} style={{ padding: '5px 10px', background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: '6px', color: '#06b6d4', cursor: 'pointer', fontSize: '11px' }}>+ Ekstra Bagaj</button>
                    </div>
                  </div>
                  {(r.extras || []).map((ex, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr auto', gap: '6px', marginBottom: '4px', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#e8f1f8' }}>{ex.type === 'Ekstra Koltuk' ? '💺' : '🧳'} {ex.type}</span>
                      <input type="number" style={inS} value={ex.buy} onChange={e => setR({ extras: r.extras.map((x, j) => j === i ? { ...x, buy: e.target.value } : x) })} placeholder="Alış" />
                      <input type="number" style={inS} value={ex.sell} onChange={e => setR({ extras: r.extras.map((x, j) => j === i ? { ...x, sell: e.target.value } : x) })} placeholder="Satış" />
                      <button onClick={() => setR({ extras: r.extras.filter((_, j) => j !== i) })} style={{ padding: '4px 8px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}>×</button>
                    </div>
                  ))}
                </div>
                <div><label style={labelStyle}>🏷️ Etiket</label><input style={inS} value={r.tag || ''} onChange={e => setR({ tag: e.target.value })} placeholder="Firma / grup (ör. Kayteks)" /></div>
                <div><label style={labelStyle}>Not</label><input style={inS} value={r.notes} onChange={e => setR({ notes: e.target.value })} placeholder="Özel notlar..." /></div>
                <div style={{ padding: '10px 14px', background: 'rgba(232,145,42,0.08)', borderRadius: '8px', fontSize: '13px', color: '#e8912a', fontWeight: '600' }}>
                  Toplam Satış: {fmt(flightResTotal(r), fl.currency)}{(r.buyPrice || (r.extras || []).some(e => e.buy)) ? ` · Maliyet: ${fmt(flightResCost(r), fl.currency)} · Kâr: ${fmt(flightResTotal(r) - flightResCost(r), fl.currency)}` : ''}
                </div>
                <button onClick={saveFRes} style={{ padding: '13px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>💾 Kaydet</button>
              </div>
            </div>
          );
        }
        return (
          <div style={{ padding: isMobile ? '12px' : '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <button onClick={() => { setFlightView('list'); setSelectedFlight(null); }} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer', fontSize: '12px', marginBottom: '8px' }}>← Geri</button>
                <h2 style={{ fontSize: '19px', margin: 0 }}>✈️ {fl.from} → {fl.to} <span style={{ fontSize: '13px', color: '#e8912a' }}>({fl.direction})</span></h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>{fl.airline} {fl.flightNo} · {formatDate(fl.date)} · {fl.depTime}{fl.arrTime ? ` → ${fl.arrTime}` : ''}</p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => {
                  if (selectedFRes.length > 0) {
                    const secilen = active.filter(r => selectedFRes.includes(r.id));
                    generateFlightProforma(fl, secilen, true);
                    showToast(`${secilen.length} kişilik tek proforma indirildi`, 'success');
                  } else {
                    active.forEach((r, i) => setTimeout(() => generateFlightProforma(fl, [r], false), i * 400));
                    showToast(`${active.length} ayrı proforma indiriliyor...`, 'success');
                  }
                }} disabled={!active.length} style={{ padding: '9px 14px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.35)', borderRadius: '8px', color: '#a78bfa', cursor: active.length ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: '600' }}>{selectedFRes.length > 0 ? `📄 Seçilenlere Tek Proforma (${selectedFRes.length})` : '📄 Proformalar (Ayrı Ayrı)'}</button>
                <button onClick={() => {
                  if (!active.length) { showToast('Rezervasyon yok', 'warning'); return; }
                  const rows = active.map((r, i) => {
                    const cust = customers.find(c => String(c.id) === String(r.customerId)) || {};
                    const pp = safeParseJSON(cust.passports).find(p => p.passportNo) || {};
                    return {
                      'S.No': i + 1,
                      'Ad Soyad': r.customerName,
                      'Doğum Tarihi': cust.birthDate ? formatDate(cust.birthDate) : '',
                      'Pasaport No': pp.passportNo || '',
                      'Pasaport Bitiş': pp.expiryDate ? formatDate(pp.expiryDate) : '',
                      'TC Kimlik': cust.tcKimlik || '',
                      'Telefon': r.phone || cust.phone || '',
                      'Satış': flightResTotal(r),
                      'Para Birimi': fl.currency,
                      'Ekstralar': (r.extras || []).map(e => e.type).join(', '),
                      'Paket Otel': r.packageHotelName || '',
                      'Ödeme': r.paid ? 'Ödedi' : 'Ödemedi',
                      'Not': r.notes || ''
                    };
                  });
                  const ws = XLSX.utils.json_to_sheet(rows);
                  ws['!cols'] = [{wch:5},{wch:24},{wch:12},{wch:12},{wch:12},{wch:13},{wch:14},{wch:8},{wch:6},{wch:18},{wch:16},{wch:9},{wch:20}];
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'Yolcu Listesi');
                  XLSX.writeFile(wb, `Ucus_${fl.from}_${fl.to}_${fl.date}.xlsx`.replace(/\s+/g, '_'));
                  showToast('Excel indirildi', 'success');
                }} style={{ padding: '9px 14px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', color: '#10b981', cursor: 'pointer', fontSize: '13px' }}>📥 Excel</button>
                <button onClick={() => { setEditingFRes({ ...emptyFRes, sellPrice: fl.sellPrice, buyPrice: fl.buyPrice, currency: fl.currency }); setShowFResForm(true); }} disabled={kalan <= 0} style={{ padding: '9px 16px', background: kalan > 0 ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'rgba(100,116,139,0.3)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: '600', cursor: kalan > 0 ? 'pointer' : 'not-allowed', fontSize: '13px' }}>➕ Rezervasyon</button>
                <button onClick={() => { setEditingFlight({ ...fl }); setFlightView('form'); }} style={{ padding: '9px 14px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontSize: '13px' }}>✏️</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' }}>
              {[
                [`${active.length}/${fl.capacity}`, 'Dolu / Kontenjan', kalan <= 3 ? '#ef4444' : '#3b82f6'],
                [kalan, 'Kalan Koltuk', kalan <= 3 ? '#ef4444' : '#10b981'],
                [fmt(toplamSatis, fl.currency), 'Toplam Satış', '#e8912a'],
                [fmt(toplamSatis - toplamAlis, fl.currency), 'Kâr', (toplamSatis - toplamAlis) >= 0 ? '#10b981' : '#ef4444'],
                [fmt(odenmemis, fl.currency), 'Ödenmemiş', odenmemis > 0 ? '#ef4444' : '#10b981'],
              ].map(([v, l, c], i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: c }}>{v}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{l}</div>
                </div>
              ))}
            </div>
            {airlinePayments(fl).length > 0 && (
              <div style={{ marginBottom: '12px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', display: 'flex', gap: '8px 18px', flexWrap: 'wrap', alignItems: 'center', fontSize: '13px' }}>
                <b style={{ color: '#f59e0b' }}>💳 Havayoluna ödeme</b>
                {airlinePayments(fl).map(x => <span key={x.key} style={{ color: x.color, fontWeight: 600 }}>{x.text}</span>)}
              </div>)}
            {dups.size > 0 && (
              <div style={{ marginBottom: '12px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.45)', color: '#fca5a5', fontSize: '13px' }}>
                ⚠️ <b>Tekrar eden yolcu var:</b> {[...new Set(active.filter(r => dups.has(r.id)).map(r => titleCaseTr(r.customerName)))].join(', ')} — aynı kişi listede birden fazla. Fazla kaydı ⊘ ile iptal edin.
              </div>)}
            {dups.size === 0 && active.length > 1 && <div style={{ marginBottom: '10px', fontSize: '12px', color: '#10b981' }}>✓ Tekrar eden yolcu yok ({active.length} kişi kontrol edildi)</div>}
            {active.length === 0 ? <p style={{ color: '#64748b', fontSize: '13px' }}>Henüz rezervasyon yok.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ padding: '8px', width: '30px' }}><input type="checkbox" checked={active.length > 0 && selectedFRes.length === active.length} onChange={e => setSelectedFRes(e.target.checked ? active.map(r => r.id) : [])} /></th>
                    {['Ad Soyad', 'Satış', 'Ekstralar', 'Paket', 'Ödeme', ''].map((h, i) => <th key={i} style={{ padding: '8px', textAlign: 'left', color: '#94a3b8', fontSize: '11px' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {active.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: dups.has(r.id) ? 'rgba(239,68,68,0.10)' : 'transparent' }}>
                        <td style={{ padding: '8px' }}><input type="checkbox" checked={selectedFRes.includes(r.id)} onChange={e => setSelectedFRes(prev => e.target.checked ? [...prev, r.id] : prev.filter(x => x !== r.id))} /></td>
                        <td style={{ padding: '8px', color: '#e8f1f8', fontWeight: '600' }}>{titleCaseTr(r.customerName)}{dups.has(r.id) && <span style={{ marginLeft: '6px', padding: '2px 6px', background: 'rgba(239,68,68,0.25)', color: '#fca5a5', borderRadius: '3px', fontSize: '10px', fontWeight: '700' }}>⚠️ TEKRAR ×{dups.get(r.id)}</span>}{r.tag && <span style={{ marginLeft: '6px', padding: '2px 6px', background: 'rgba(254,243,199,0.2)', color: '#fbbf24', borderRadius: '3px', fontSize: '10px', fontWeight: '600' }}>🏷️ {r.tag}</span>}{r.notes ? <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '400' }}>{r.notes}</div> : null}</td>
                        <td style={{ padding: '8px', color: '#e8912a' }}>{fmt(flightResTotal(r), fl.currency)}</td>
                        <td style={{ padding: '8px', color: '#94a3b8', fontSize: '11px' }}>{(r.extras || []).map(e => e.type === 'Ekstra Koltuk' ? '💺' : '🧳').join(' ') || '—'}</td>
                        <td style={{ padding: '8px', fontSize: '11px', color: r.packageHotelName ? '#06b6d4' : '#64748b' }}>{r.packageHotelName ? `📦 ${r.packageHotelName}` : '—'}</td>
                        <td style={{ padding: '8px' }}>{r.paid ? <span style={{ color: '#10b981', fontWeight: '600' }}>✓ Ödedi</span> : <span style={{ color: '#ef4444' }}>Ödemedi</span>}</td>
                        <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                          <button onClick={() => { setEditingFRes({ ...emptyFRes, ...r }); setShowFResForm(true); }} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '14px' }} title="Düzenle">✏️</button>
                          <button onClick={() => cancelFRes(fl, r.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px' }} title="İptal">⊘</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      }
      // UÇUŞ LİSTESİ
      return (
        <div style={{ padding: isMobile ? '12px' : '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button onClick={() => setMainTab('hotels')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>🏨 Oteller</button>
              <button style={{ padding: '9px 16px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '10px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>✈️ Grup Uçuşlar ({groupFlights.length})</button>
              <button onClick={() => setMainTab('transfers')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>🚐 Transferler ({transfers.length})</button>
              <button onClick={() => setMainTab('packages')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>📦 Paketler ({packages.length})</button>
            </div>
            <button onClick={() => { setEditingFlight({ ...emptyFlight }); setFlightView('form'); }} style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>➕ Grup Uçuş Ekle</button>
          </div>
          {groupFlights.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '13px' }}>Henüz grup uçuş yok. "➕ Grup Uçuş Ekle" ile başlayın — havayolundan aldığınız kontenjanı girin, rezervasyonlarla doldurun.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
              {groupFlights.map(fl => {
                const active = (fl.reservations || []).filter(r => !r.cancelled);
        const dups = dupPassengers(active);
                const kalan = (parseInt(fl.capacity) || 0) - active.length;
                const doluluk = fl.capacity > 0 ? Math.round((active.length / fl.capacity) * 100) : 0;
                return (
                  <div key={fl.id} onClick={() => { setSelectedFlight(fl); setFlightView('detail'); }} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '14px', padding: '16px', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '15px', fontWeight: '700', color: '#e8f1f8' }}>✈️ {fl.from} → {fl.to}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '10px', background: fl.direction === 'Gidiş' ? 'rgba(59,130,246,0.2)' : 'rgba(232,145,42,0.2)', color: fl.direction === 'Gidiş' ? '#3b82f6' : '#e8912a', fontWeight: '700' }}>{fl.direction}</span>
                        {dups.size > 0 && <span title="Aynı kişi bu uçuşta birden fazla kayıtlı" style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '10px', background: 'rgba(239,68,68,0.2)', color: '#fca5a5', fontWeight: '700' }}>⚠️ tekrar</span>}
                        <button onClick={(e) => { e.stopPropagation(); const rezSayisi = (fl.reservations || []).filter(r => !r.cancelled).length; if (window.confirm(`"${fl.from} → ${fl.to}" uçuşunu${rezSayisi > 0 ? ` ve ${rezSayisi} rezervasyonunu` : ''} silmek istiyor musunuz?`)) { setGroupFlights(prev => prev.filter(x => x.id !== fl.id)); showToast('Uçuş silindi', 'warning'); } }} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', padding: '2px 7px' }} title="Sil">🗑️</button>
                      </div>
                    </div>
                    <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#94a3b8' }}>{fl.airline} {fl.flightNo} · {formatDate(fl.date)} {fl.depTime}</p>
                    {airlinePayments(fl).filter(x => !x.paid).slice(0, 1).map(x => <p key={x.key} style={{ margin: '-4px 0 10px', fontSize: '11px', color: x.color, fontWeight: 600 }}>💳 {x.text}</p>)}
                    <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '8px', height: '8px', marginBottom: '6px', overflow: 'hidden' }}>
                      <div style={{ width: `${doluluk}%`, height: '100%', background: doluluk >= 90 ? '#ef4444' : doluluk >= 70 ? '#e8912a' : '#10b981', borderRadius: '8px' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: '#94a3b8' }}>{active.length}/{fl.capacity} dolu · <b style={{ color: kalan <= 3 ? '#ef4444' : '#10b981' }}>{kalan} kalan</b></span>
                      <span style={{ color: '#e8912a', fontWeight: '600' }}>{fl.sellPrice} {fl.currency}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }
    return (
      <div style={{ padding: isMobile ? '12px' : '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={{ padding: '9px 16px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', color: '#0c1929', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>🏨 Oteller ({hotels.length})</button>
            <button onClick={() => setMainTab('flights')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>✈️ Grup Uçuşlar ({groupFlights.length})</button>
            <button onClick={() => setMainTab('transfers')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>🚐 Transferler ({transfers.length})</button>
              <button onClick={() => setMainTab('packages')} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>📦 Paketler ({packages.length})</button>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input type="text" placeholder="🔍 Otel/şehir ara..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{...inputStyle, width: '220px'}} />
            <button onClick={() => setShowExcelModal(true)} style={{ background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', padding: '8px 14px', color: '#10b981', cursor: 'pointer', fontSize: '12px' }}>📊 Excel</button>
            <button onClick={openNewHotel} style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '10px', padding: '10px 20px', color: '#0c1929', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>➕ Yeni Otel</button>
          </div>
        </div>

        {filteredHotels.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
            {hotels.length === 0 ? '🏨 Henüz otel eklenmedi. Sağ üstten "➕ Yeni Otel" ekleyin.' : 'Sonuç bulunamadı'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
            {filteredHotels.map(h => {
              const resCount = (h.reservations || []).length;
              const totalRevenue = (h.reservations || []).reduce((s, r) => s + (parseFloat(r.price) || 0), 0);
              return (
                <div key={h.id} onClick={() => openHotelDetail(h)} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', cursor: 'pointer', transition: 'all .2s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '15px', color: '#fff' }}>{titleCaseTr(h.name)}{(h.infoSheets || []).length > 0 && <span title={`Info Sheet yüklü (${h.infoSheets.length} dosya)`} style={{ marginLeft: '6px', fontSize: '12px' }}>📄</span>}</h3>
                    <span style={{ fontSize: '11px', color: '#f59e0b' }}>{'★'.repeat(parseInt(h.stars) || 0)}</span>
                  </div>
                  <p style={{ margin: '4px 0', fontSize: '12px', color: '#94a3b8' }}>🌍 {titleCaseTr(h.city)}{h.country ? `, ${titleCaseTr(h.country)}` : ''}</p>
                  {h.phone && <p style={{ margin: '4px 0', fontSize: '11px', color: '#64748b' }}>📞 {h.phone}</p>}
                  {h.bookingCode && <p style={{ margin: '4px 0', fontSize: '11px', color: '#64748b' }}>🎫 {h.bookingCode}</p>}
                  {(() => {
                    const ds = Object.keys(h.roomAllotment || {}).sort();
                    const tot = ds.reduce((x, d) => x + Object.values(h.roomAllotment[d] || {}).reduce((y, v) => y + (parseInt(v, 10) || 0), 0), 0);
                    return tot > 0 ? <p style={{ margin: '4px 0', fontSize: '11px', color: '#60a5fa' }}>🛏️ Kontenjan {formatDate(ds[0])} – {formatDate(ds[ds.length - 1])} · {tot} oda-gece</p> : null;
                  })()}
                  {(() => {
                    const today = new Date().toISOString().slice(0, 10);
                    const nx = (h.hotelTerms?.payments || []).filter(x => isYmd(x.date) && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
                    if (!nx) return null;
                    const n = Math.round((new Date(nx.date + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 86400000);
                    return <p style={{ margin: '4px 0', fontSize: '11px', color: n <= 7 ? '#ef4444' : n <= 30 ? '#f59e0b' : '#34d399' }}>💳 Sonraki ödeme {formatDate(nx.date)}{nx.amount ? ` · ${Number(nx.amount).toLocaleString('tr-TR')} ${h.hotelTerms?.currency || '€'}` : ''} ({n === 0 ? 'bugün' : `${n} gün`})</p>;
                  })()}
                  <div style={{ marginTop: '10px', padding: '8px', background: 'rgba(245,158,11,0.08)', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: '#94a3b8' }}>📅 {resCount} rezervasyon</span>
                    <span style={{ color: '#10b981', fontWeight: '600' }}>{totalRevenue.toLocaleString('tr-TR')} {h.prices?.double?.currency || '€'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* EXCEL TOPLU GİRİŞ MODAL */}
        {showExcelModal && (
          <div onClick={() => { setShowExcelModal(false); setExcelPreview(null); setPriceExcelPreview(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', overflowY: 'auto' }}>
            <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
            <div onClick={e => e.stopPropagation()} className="hide-scrollbar" style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', maxWidth: '900px', width: '100%', maxHeight: '90vh', overflowY: 'auto', scrollbarWidth: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '17px' }}>📊 Excel ile Toplu Giriş</h3>
                <button onClick={() => { setShowExcelModal(false); setExcelPreview(null); setPriceExcelPreview(null); }} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '22px' }}>×</button>
              </div>

              {/* TAB BUTONLARI */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <button onClick={() => { setExcelTab('hotels'); setPriceExcelPreview(null); }} style={{
                  padding: '10px 16px',
                  background: excelTab === 'hotels' ? 'rgba(245,158,11,0.15)' : 'transparent',
                  border: 'none',
                  borderBottom: excelTab === 'hotels' ? '2px solid #f59e0b' : '2px solid transparent',
                  color: excelTab === 'hotels' ? '#f59e0b' : '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '600',
                  marginBottom: '-1px'
                }}>🏨 Otel Bilgileri</button>
                <button onClick={() => { setExcelTab('prices'); setExcelPreview(null); }} style={{
                  padding: '10px 16px',
                  background: excelTab === 'prices' ? 'rgba(16,185,129,0.15)' : 'transparent',
                  border: 'none',
                  borderBottom: excelTab === 'prices' ? '2px solid #10b981' : '2px solid transparent',
                  color: excelTab === 'prices' ? '#10b981' : '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '600',
                  marginBottom: '-1px'
                }}>💰 Fiyat Dönemleri</button>
              </div>

              {/* OTEL BİLGİLERİ SEKMESİ */}
              {excelTab === 'hotels' && (!excelPreview ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ padding: '14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px' }}>
                    <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#f59e0b', fontWeight: '600' }}>📋 Otel Şablonu</p>
                    <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#94a3b8' }}>Sütunlar: <strong>Otel Adı, Şehir, Ülke, Yıldız, Telefon, Adres, Rezervasyon Kodu, Sezon, Notlar</strong></p>
                    <button onClick={() => {
                      const ws = XLSX.utils.aoa_to_sheet([
                        ['Otel Adı', 'Şehir', 'Ülke', 'Yıldız', 'Telefon', 'Adres', 'Rezervasyon Kodu', 'Sezon', 'Notlar'],
                        ['Hilton Istanbul', 'İstanbul', 'Türkiye', '5', '+90 212 ...', 'Cumhuriyet Cad. No:50, Şişli', 'PAY2026-001', 'Haziran-Eylül 2026', 'Anlaşmalı otel']
                      ]);
                      ws['!cols'] = [{wch:25},{wch:14},{wch:14},{wch:8},{wch:18},{wch:30},{wch:18},{wch:18},{wch:25}];
                      const wb = XLSX.utils.book_new();
                      XLSX.utils.book_append_sheet(wb, ws, 'Oteller ve Uçuşlar');
                      XLSX.writeFile(wb, 'Otel_Sablon.xlsx');
                    }} style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '8px', color: '#f59e0b', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                      📥 Şablonu İndir
                    </button>
                  </div>

                  <div>
                    <label style={labelStyle}>Excel Dosyası Yükle</label>
                    <input type="file" accept=".xlsx,.xls" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const buf = await file.arrayBuffer();
                        const wb = XLSX.read(buf, { type: 'array' });
                        const ws = wb.Sheets[wb.SheetNames[0]];
                        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                        if (rows.length === 0) { showToast?.('Dosya boş', 'error'); return; }
                        const parsed = rows.map(r => ({
                          name: String(r['Otel Adı'] || r['Otel'] || r['name'] || '').trim(),
                          city: String(r['Şehir'] || r['city'] || '').trim(),
                          country: String(r['Ülke'] || r['country'] || '').trim(),
                          stars: String(r['Yıldız'] || r['stars'] || '4').trim(),
                          phone: String(r['Telefon'] || r['phone'] || '').trim(),
                          address: String(r['Adres'] || r['address'] || '').trim(),
                          bookingCode: String(r['Rezervasyon Kodu'] || r['Rezervasyon No'] || r['bookingCode'] || '').trim(),
                          season: String(r['Sezon'] || r['season'] || '').trim(),
                          notes: String(r['Notlar'] || r['Not'] || r['notes'] || '').trim()
                        })).filter(h => h.name);
                        if (parsed.length === 0) { showToast?.('Geçerli otel kaydı bulunamadı (Otel Adı zorunlu)', 'error'); return; }
                        setExcelPreview(parsed);
                      } catch (err) {
                        showToast?.('Excel okuma hatası: ' + err.message, 'error');
                      }
                    }} style={{...inputStyle, padding: '8px'}} />
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ padding: '10px 14px', background: 'rgba(59,130,246,0.1)', borderRadius: '8px', marginBottom: '14px', fontSize: '12px', color: '#3b82f6' }}>
                    📋 <strong>{excelPreview.length}</strong> otel okundu. Önizleme aşağıda.
                  </div>
                  <div style={{ maxHeight: '400px', overflowY: 'auto', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#1a3a5c' }}>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          {['#', 'Otel', 'Şehir', 'Ülke', 'Yıldız', 'Telefon', 'Rez. Kodu'].map(h => (
                            <th key={h} style={{ padding: '8px', textAlign: 'left', color: '#64748b', fontWeight: '600' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {excelPreview.map((h, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '6px 8px', color: '#64748b' }}>{i+1}</td>
                            <td style={{ padding: '6px 8px', color: '#fff', fontWeight: '600' }}>{titleCaseTr(h.name)}</td>
                            <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{h.city}</td>
                            <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{h.country}</td>
                            <td style={{ padding: '6px 8px', color: '#f59e0b' }}>{h.stars}★</td>
                            <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{h.phone}</td>
                            <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{h.bookingCode}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                    <button onClick={async () => {
                      const now = new Date().toISOString();
                      const newHotels = excelPreview.map(h => ({
                        ...emptyHotel,
                        ...h,
                        id: generateUniqueId(),
                        createdAt: now,
                        updatedAt: now
                      }));
                      try {
                        for (const h of newHotels) {
                          const sd = cleanForFirestore({...h});
                          delete sd._docId;
                          await setDoc(doc(db, 'hotels', h.id), sd);
                        }
                        setHotels([...newHotels, ...hotels]);
                        showToast?.(`✅ ${newHotels.length} otel başarıyla eklendi`, 'success');
                        setShowExcelModal(false);
                        setExcelPreview(null);
                      } catch (e) {
                        showToast?.('❌ Kaydetme hatası: ' + e.message, 'error');
                      }
                    }} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '700', cursor: 'pointer' }}>
                      ✅ {excelPreview.length} Oteli Kaydet
                    </button>
                    <button onClick={() => setExcelPreview(null)} style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer' }}>← Geri</button>
                  </div>
                </div>
              ))}

              {/* FİYAT DÖNEMLERİ SEKMESİ */}
              {excelTab === 'prices' && (!priceExcelPreview ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ padding: '14px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px' }}>
                    <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#10b981', fontWeight: '600' }}>📋 Fiyat Şablonu</p>
                    <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#94a3b8' }}>
                      Her satır = bir otelin bir tarih aralığındaki bir oda tipinin fiyatları. Aynı (Otel + Başlangıç + Bitiş) gruplandırılır.
                    </p>
                    <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#94a3b8' }}>
                      Sütunlar: <strong>Otel Adı, Başlangıç, Bitiş, Para, Oda Tipi, RO Alış, RO Satış, BB Alış, BB Satış, HB Alış, HB Satış, FB Alış, FB Satış, AI Alış, AI Satış, UAI Alış, UAI Satış</strong>
                    </p>
                    <p style={{ margin: '0 0 10px', fontSize: '10px', color: '#f59e0b' }}>
                      ⚠️ Otel adı mevcut otel listesindeki adla aynı olmalı (büyük/küçük harf önemsiz). Tarihler GG.AA.YYYY veya YYYY-AA-GG formatında olabilir.
                    </p>
                    <button onClick={() => {
                      const ws = XLSX.utils.aoa_to_sheet([
                        ['Otel Adı', 'Başlangıç', 'Bitiş', 'Para', 'Oda Tipi', 'RO Alış', 'RO Satış', 'BB Alış', 'BB Satış', 'HB Alış', 'HB Satış', 'FB Alış', 'FB Satış', 'AI Alış', 'AI Satış', 'UAI Alış', 'UAI Satış'],
                        ['Hilton Istanbul', '2026-06-01', '2026-06-30', '€', 'Single', 50, 80, 60, 100, '', '', '', ''],
                        ['Hilton Istanbul', '2026-06-01', '2026-06-30', '€', 'Double', 80, 120, 90, 140, '', '', '', ''],
                        ['Hilton Istanbul', '2026-06-01', '2026-06-30', '€', 'Triple', 110, 160, 120, 180, '', '', '', ''],
                        ['Hilton Istanbul', '2026-07-01', '2026-07-31', '€', 'Single', 60, 100, 70, 120, '', '', '', ''],
                        ['Hilton Istanbul', '2026-07-01', '2026-07-31', '€', 'Double', 100, 150, 110, 170, '', '', '', '']
                      ]);
                      ws['!cols'] = [{wch:22},{wch:12},{wch:12},{wch:6},{wch:14},{wch:10},{wch:10},{wch:10},{wch:10},{wch:10},{wch:10},{wch:10},{wch:10}];
                      const wb = XLSX.utils.book_new();
                      XLSX.utils.book_append_sheet(wb, ws, 'Fiyatlar');
                      XLSX.writeFile(wb, 'Fiyat_Sablon.xlsx');
                    }} style={{ padding: '8px 14px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: '8px', color: '#10b981', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                      📥 Şablonu İndir
                    </button>
                  </div>

                  <div>
                    <label style={labelStyle}>Excel Dosyası Yükle</label>
                    <input type="file" accept=".xlsx,.xls" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const buf = await file.arrayBuffer();
                        const wb = XLSX.read(buf, { type: 'array' });
                        const ws = wb.Sheets[wb.SheetNames[0]];
                        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                        if (rows.length === 0) { showToast?.('Dosya boş', 'error'); return; }

                        // Tarih normalleştirme (GG.AA.YYYY, YYYY-AA-GG, Date object, Excel serial)
                        const normalizeDate = (val) => {
                          if (!val && val !== 0) return '';
                          // Yerel tarih bileşenlerinden YYYY-MM-DD üret (timezone kaymasını önler)
                          const ymd = (d) => isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                          if (val instanceof Date) {
                            // SheetJS UTC gece yarısı olarak parse eder; UTC bileşenlerini kullan
                            return `${val.getUTCFullYear()}-${String(val.getUTCMonth()+1).padStart(2,'0')}-${String(val.getUTCDate()).padStart(2,'0')}`;
                          }
                          if (typeof val === 'number') {
                            // Excel serial date — UTC olarak çöz, UTC bileşenlerini al
                            const d = new Date(Math.round((val - 25569) * 86400 * 1000));
                            return isNaN(d.getTime()) ? '' : `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
                          }
                          const s = String(val).trim();
                          // GG.AA.YYYY veya GG/AA/YYYY
                          let m = s.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})$/);
                          if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
                          // YYYY-AA-GG (varsa saat kısmını at)
                          m = s.match(/^(\d{4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})/);
                          if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
                          return s;
                        };

                        const num = (v) => {
                          if (v === '' || v === null || v === undefined) return 0;
                          const n = parseFloat(String(v).replace(',','.'));
                          return isNaN(n) ? 0 : n;
                        };

                        // Otel adı eşleştirme (case-insensitive)
                        const hotelMap = {};
                        hotels.forEach(h => { hotelMap[normalizeTr(h.name)] = h; });

                        // Satırları işle
                        const items = [];
                        const unmatchedHotels = new Set();
                        for (const r of rows) {
                          const name = String(r['Otel Adı'] || r['Otel'] || r['name'] || '').trim();
                          if (!name) continue;
                          const match = hotelMap[normalizeTr(name)];
                          if (!match) { unmatchedHotels.add(name); continue; }
                          items.push({
                            hotelName: name,
                            hotelId: match.id,
                            startDate: normalizeDate(r['Başlangıç'] || r['Baslangic'] || r['Start']),
                            endDate: normalizeDate(r['Bitiş'] || r['Bitis'] || r['End']),
                            currency: String(r['Para'] || r['Currency'] || '€').trim() || '€',
                            roomType: String(r['Oda Tipi'] || r['Oda'] || r['Room'] || '').trim(),
                            ro_buy: num(r['RO Alış'] || r['RO Alis']),
                            ro_sell: num(r['RO Satış'] || r['RO Satis']),
                            bb_buy: num(r['BB Alış'] || r['BB Alis']),
                            bb_sell: num(r['BB Satış'] || r['BB Satis']),
                            hb_buy: num(r['HB Alış'] || r['HB Alis']),
                            hb_sell: num(r['HB Satış'] || r['HB Satis']),
                            fb_buy: num(r['FB Alış'] || r['FB Alis']),
                            fb_sell: num(r['FB Satış'] || r['FB Satis']),
                            ai_buy: num(r['AI Alış'] || r['AI Alis']),
                            ai_sell: num(r['AI Satış'] || r['AI Satis']),
                            uai_buy: num(r['UAI Alış'] || r['UAI Alis']),
                            uai_sell: num(r['UAI Satış'] || r['UAI Satis'])
                          });
                        }

                        if (items.length === 0) {
                          showToast?.(`Geçerli kayıt bulunamadı. ${unmatchedHotels.size > 0 ? `Eşleşmeyen oteller: ${[...unmatchedHotels].slice(0,3).join(', ')}${unmatchedHotels.size > 3 ? '...' : ''}` : ''}`, 'error');
                          return;
                        }
                        setPriceExcelPreview({ items, unmatchedHotels: [...unmatchedHotels] });
                      } catch (err) {
                        showToast?.('Excel okuma hatası: ' + err.message, 'error');
                      }
                    }} style={{...inputStyle, padding: '8px'}} />
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ padding: '10px 14px', background: 'rgba(59,130,246,0.1)', borderRadius: '8px', marginBottom: '10px', fontSize: '12px', color: '#3b82f6' }}>
                    📋 <strong>{priceExcelPreview.items.length}</strong> fiyat satırı okundu. Aynı (otel + tarih) gruplandırılarak dönem oluşturulacak.
                  </div>
                  {priceExcelPreview.unmatchedHotels.length > 0 && (
                    <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', marginBottom: '10px', fontSize: '11px', color: '#ef4444' }}>
                      ⚠️ Otel listesinde olmadığı için <strong>{priceExcelPreview.unmatchedHotels.length}</strong> satır atlandı: {priceExcelPreview.unmatchedHotels.slice(0,5).join(', ')}{priceExcelPreview.unmatchedHotels.length > 5 ? '...' : ''}
                    </div>
                  )}
                  <div style={{ maxHeight: '350px', overflowY: 'auto', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#1a3a5c' }}>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          {['Otel', 'Dönem', 'Oda', 'BB A', 'BB S', 'HB A', 'HB S', 'Para'].map(h => (
                            <th key={h} style={{ padding: '6px', textAlign: 'left', color: '#64748b', fontWeight: '600' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {priceExcelPreview.items.map((it, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '5px 6px', color: '#fff', fontWeight: '600' }}>{it.hotelName}</td>
                            <td style={{ padding: '5px 6px', color: '#94a3b8' }}>{formatDate(it.startDate)} → {formatDate(it.endDate)}</td>
                            <td style={{ padding: '5px 6px', color: '#f59e0b' }}>{it.roomType}</td>
                            <td style={{ padding: '5px 6px', color: '#ef4444' }}>{it.bb_buy || '—'}</td>
                            <td style={{ padding: '5px 6px', color: '#10b981' }}>{it.bb_sell || '—'}</td>
                            <td style={{ padding: '5px 6px', color: '#ef4444' }}>{it.hb_buy || '—'}</td>
                            <td style={{ padding: '5px 6px', color: '#10b981' }}>{it.hb_sell || '—'}</td>
                            <td style={{ padding: '5px 6px', color: '#94a3b8' }}>{it.currency}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                    <button onClick={async () => {
                      // Aynı (hotelId + startDate + endDate) gruplandır
                      const groups = {};
                      priceExcelPreview.items.forEach(it => {
                        const key = `${it.hotelId}__${it.startDate}__${it.endDate}__${it.currency}`;
                        if (!groups[key]) {
                          groups[key] = {
                            hotelId: it.hotelId,
                            startDate: it.startDate,
                            endDate: it.endDate,
                            currency: it.currency,
                            rates: {}
                          };
                        }
                        const rates = groups[key].rates;
                        if (!rates[it.roomType]) rates[it.roomType] = {};
                        MEAL_CONCEPTS.forEach(c => {
                          const buy = it[`${c}_buy`], sell = it[`${c}_sell`];
                          if (buy > 0 || sell > 0) rates[it.roomType][c] = { buy: buy || 0, sell: sell || 0 };
                        });
                      });

                      // Otel başına gruplama
                      const byHotel = {};
                      Object.values(groups).forEach(g => {
                        if (!byHotel[g.hotelId]) byHotel[g.hotelId] = [];
                        byHotel[g.hotelId].push({ id: generateUniqueId(), ...g, rates: g.rates });
                      });

                      // Etkilenen otellerde zaten fiyat dönemi varsa: değiştir mi, ekle mi?
                      const etkilenen = hotels.filter(h => byHotel[h.id] && (h.priceList || []).length > 0);
                      let replaceMode = false;
                      if (etkilenen.length > 0) {
                        replaceMode = window.confirm(
                          `${etkilenen.length} otelde zaten fiyat dönemi var.\n\n` +
                          `TAMAM = Eski dönemleri SİL, yenilerini yükle (önerilen — tekrar/karışıklık olmaz)\n` +
                          `İPTAL = Eskilerin üstüne EKLE`
                        );
                      }

                      // Her otele yaz
                      try {
                        let updatedCount = 0;
                        const updatedHotels = hotels.map(h => {
                          if (!byHotel[h.id]) return h;
                          const newPeriods = byHotel[h.id].map(g => ({ id: g.id, startDate: g.startDate, endDate: g.endDate, currency: g.currency, rates: g.rates }));
                          // Aktif konseptleri otomatik aç
                          const enabledConcepts = new Set(h.enabledConcepts || []);
                          newPeriods.forEach(p => {
                            Object.values(p.rates).forEach(roomRates => {
                              Object.keys(roomRates).forEach(c => enabledConcepts.add(c));
                            });
                          });
                          const updated = {
                            ...h,
                            priceList: replaceMode ? newPeriods : [...(h.priceList || []), ...newPeriods],
                            enabledConcepts: [...enabledConcepts],
                            updatedAt: new Date().toISOString()
                          };
                          delete updated.prices; delete updated.email; delete updated.website;
                          updatedCount++;
                          return updated;
                        });

                        for (const h of updatedHotels) {
                          if (!byHotel[h.id]) continue;
                          const sd = cleanForFirestore({...h});
                          delete sd._docId;
                          await setDoc(doc(db, 'hotels', h._docId || String(h.id)), sd, { merge: false });
                        }

                        setHotels(updatedHotels);
                        showToast?.(`✅ ${updatedCount} otele toplam ${Object.values(groups).length} fiyat dönemi eklendi`, 'success');
                        setShowExcelModal(false);
                        setPriceExcelPreview(null);
                      } catch (e) {
                        showToast?.('❌ Kaydetme hatası: ' + e.message, 'error');
                      }
                    }} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '700', cursor: 'pointer' }}>
                      ✅ Fiyatları Otellere Kaydet
                    </button>
                    <button onClick={() => setPriceExcelPreview(null)} style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer' }}>← Geri</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ====== OTEL FORM ======
  if (view === 'form') {
    return (
      <div style={{ padding: isMobile ? '12px' : '24px', maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}>{editingHotel ? '✏️ Otel Düzenle' : '➕ Yeni Otel'}</h2>
          <button onClick={() => setView('list')} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 16px', color: '#fff', cursor: 'pointer' }}>← Geri</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Otel Adı *</label>
              <input type="text" value={hotelForm.name} onChange={e => setHotelForm({...hotelForm, name: e.target.value})} placeholder="örn: Hilton Istanbul" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Yıldız</label>
              <select value={hotelForm.stars} onChange={e => setHotelForm({...hotelForm, stars: e.target.value})} style={selectStyle}>
                {['3','4','5','6','7'].map(s => <option key={s} value={s}>{s} ★</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Şehir *</label>
              <input type="text" value={hotelForm.city} onChange={e => setHotelForm({...hotelForm, city: e.target.value})} placeholder="örn: İstanbul" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Ülke</label>
              <select value={hotelForm.country} onChange={e => setHotelForm({...hotelForm, country: e.target.value})} style={selectStyle}>
                <option value="">Ülke seçin...</option>
                {tourCountries.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Telefon</label>
              <input type="text" value={hotelForm.phone} onChange={e => setHotelForm({...hotelForm, phone: e.target.value})} placeholder="+90..." style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Rezervasyon Kodu</label>
              <input type="text" value={hotelForm.bookingCode} onChange={e => setHotelForm({...hotelForm, bookingCode: e.target.value})} placeholder="örn: PAY2026-001" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Adres</label>
              <input type="text" value={hotelForm.address} onChange={e => setHotelForm({...hotelForm, address: e.target.value})} placeholder="Otelin açık adresi" style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Sezon (opsiyonel)</label>
            <input type="text" value={hotelForm.season} onChange={e => setHotelForm({...hotelForm, season: e.target.value})} placeholder="örn: Haziran-Eylül 2026" style={inputStyle} />
          </div>

          {(() => {
            const kinds = hotelRoomKinds(hotelForm, hotelRoomTypes);
            const al = hotelForm.roomAllotment || {};
            const dates = Object.keys(al).sort();
            const setAl = (next) => setHotelForm(f => ({ ...f, roomAllotment: next }));
            const setCell = (d, k, v) => {
              const row = { ...(al[d] || {}) };
              if (v === '') delete row[k]; else row[k] = Math.max(0, parseInt(v, 10) || 0);
              setAl({ ...al, [d]: row });
            };
            const fillCol = (k, v) => { if (v === '') return; const n = Math.max(0, parseInt(v, 10) || 0); const next = {}; dates.forEach(d => { next[d] = { ...(al[d] || {}), [k]: n }; }); setAl(next); };
            const total = dates.reduce((s2, d) => s2 + Object.values(al[d] || {}).reduce((x, v) => x + (parseInt(v, 10) || 0), 0), 0);
            const cellIn = { width: '100%', minWidth: '56px', padding: '7px 8px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff', fontSize: '13px', textAlign: 'center', boxSizing: 'border-box' };
            return (
              <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '10px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', fontSize: '14px', color: '#60a5fa' }}>🛏️ Oda Kontenjanı (gece gece)</h3>
                    <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Otelin proformasındaki gibi her gece için oda tipine göre anlaşılan oda sayısı. Elle girebilir ya da proformayı yükleyebilirsiniz. Otel sayfasında rezervasyonlarla karşılaştırılır (dolu / boş / fazla).</p>
                  </div>
                  <input type="file" accept="application/pdf,image/*" id="hotelProformaInput" style={{ display: 'none' }} onChange={async (e) => {
                    const file = e.target.files?.[0]; e.target.value = '';
                    if (!file) return;
                    setProformaBusy(true);
                    try {
                      const r = await readHotelProforma(file, kinds);
                      const nights = (r.nights || []).filter(n => isYmd(n.date));
                      if (!nights.length && !(r.payments || []).length && !(r.cancellation || []).length) { showToast?.('Proformada kontenjan / ödeme bilgisi bulunamadı', 'warning'); return; }
                      const nextAl = { ...(hotelForm.roomAllotment || {}) };
                      nights.forEach(n => { const row = {}; (n.rooms || []).forEach(rm => { const t = String(rm.type || rm.raw || '').trim(); const c = parseInt(rm.count, 10) || 0; if (t && c > 0) row[t] = (row[t] || 0) + c; }); nextAl[n.date] = row; });
                      const old = hotelForm.hotelTerms || {};
                      const nid = () => Math.random().toString(36).slice(2, 9);
                      const terms = {
                        ...old,
                        proformaNo: r.proformaNo || old.proformaNo || '',
                        total: parseFloat(r.total) || old.total || '',
                        currency: r.currency || old.currency || '€',
                        releaseDate: isYmd(r.releaseDate) ? r.releaseDate : (old.releaseDate || ''),
                        payments: (r.payments || []).length ? r.payments.map(x => ({ id: nid(), date: isYmd(x.date) ? x.date : '', amount: parseFloat(x.amount) || '', note: x.note || '' })) : (old.payments || []),
                        cancellation: (r.cancellation || []).length ? r.cancellation.map(x => ({ id: nid(), date: isYmd(x.date) ? x.date : '', text: x.text || '' })) : (old.cancellation || []),
                        notes: [old.notes, r.notes].filter(Boolean).join('\n'),
                        source: file.name || '', importedAt: new Date().toISOString(),
                      };
                      setHotelForm(f => ({ ...f, roomAllotment: nextAl, hotelTerms: terms }));
                      const rn = nights.reduce((x, n) => x + (n.rooms || []).reduce((y, rm) => y + (parseInt(rm.count, 10) || 0), 0), 0);
                      showToast?.(`📄 Proforma okundu: ${nights.length} gece · ${rn} oda-gece · ${terms.payments.length} ödeme · ${terms.cancellation.length} iptal kuralı — kontrol edip Kaydet'e basın`, 'success');
                    } catch (err) { showToast?.('Proforma okunamadı: ' + err.message, 'error'); }
                    finally { setProformaBusy(false); }
                  }} />
                  <button type="button" disabled={proformaBusy} onClick={() => document.getElementById('hotelProformaInput')?.click()} style={{ padding: '9px 14px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '8px', color: '#fff', cursor: proformaBusy ? 'wait' : 'pointer', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap' }}>{proformaBusy ? '⏳ Okunuyor...' : '📄 Proformadan oku (AI)'}</button>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <div><label style={labelStyle}>İlk gece</label><input type="date" id="alFrom" style={{ ...inputStyle, width: '160px' }} /></div>
                  <div><label style={labelStyle}>Son gece</label><input type="date" id="alTo" style={{ ...inputStyle, width: '160px' }} /></div>
                  <button type="button" onClick={() => {
                    const f = document.getElementById('alFrom')?.value, t = document.getElementById('alTo')?.value;
                    const ns = nightsBetween(f, t || f);
                    if (!ns.length) { showToast?.('İlk ve son geceyi seçin', 'error'); return; }
                    const next = { ...al }; ns.forEach(d => { if (!next[d]) next[d] = {}; }); setAl(next);
                  }} style={{ padding: '10px 14px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', color: '#60a5fa', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>➕ Geceleri ekle</button>
                  {dates.length > 0 && <button type="button" onClick={() => { if (window.confirm('Kontenjan tablosu temizlensin mi?')) setAl({}); }} style={{ padding: '10px 12px', background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#f87171', cursor: 'pointer', fontSize: '12px' }}>Temizle</button>}
                </div>
                {dates.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '6px', color: '#94a3b8', fontWeight: '600' }}>Gece</th>
                          {kinds.map(k => <th key={k} style={{ padding: '6px', color: '#e8f1f8', fontWeight: '600', whiteSpace: 'nowrap' }}>{k}</th>)}
                          <th />
                        </tr>
                        <tr>
                          <td style={{ padding: '4px 6px', color: '#64748b', fontSize: '11px' }}>Hepsine yaz →</td>
                          {kinds.map(k => <td key={k} style={{ padding: '4px' }}><input type="number" min="0" placeholder="—" title={`${k}: tüm gecelere aynı sayıyı yaz (Enter)`} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fillCol(k, e.currentTarget.value); e.currentTarget.value = ''; } }} onBlur={e => { fillCol(k, e.currentTarget.value); e.currentTarget.value = ''; }} style={{ ...cellIn, borderStyle: 'dashed', background: 'transparent' }} /></td>)}
                          <td />
                        </tr>
                      </thead>
                      <tbody>
                        {dates.map(d => (
                          <tr key={d} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            <td style={{ padding: '6px', color: '#e8f1f8', whiteSpace: 'nowrap' }}>{formatDate(d)}</td>
                            {kinds.map(k => {
                              const e = Object.entries(al[d] || {}).find(([n]) => roomKey(n) === roomKey(k));
                              return <td key={k} style={{ padding: '4px' }}><input type="number" min="0" inputMode="numeric" value={e ? e[1] : ''} placeholder="0" onChange={ev => setCell(d, e ? e[0] : k, ev.target.value)} style={cellIn} /></td>;
                            })}
                            <td style={{ padding: '4px' }}><button type="button" title="Bu geceyi sil" onClick={() => { const next = { ...al }; delete next[d]; setAl(next); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px' }}>×</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8' }}>{dates.length} gece · toplam <b style={{ color: '#e8f1f8' }}>{total} oda-gece</b></div>
                  </div>
                ) : <div style={{ fontSize: '12px', color: '#64748b' }}>Henüz gece eklenmedi. İlk ve son geceyi seçip "Geceleri ekle"ye basın.</div>}
              </div>
            );
          })()}

          {(() => {
            const t = hotelForm.hotelTerms || {};
            const setT = (patch) => setHotelForm(f => ({ ...f, hotelTerms: { ...(f.hotelTerms || {}), ...patch } }));
            const nid = () => Math.random().toString(36).slice(2, 9);
            const listEd = (key, cols) => {
              const rows = t[key] || [];
              const upd = (id, patch) => setT({ [key]: rows.map(r => r.id === id ? { ...r, ...patch } : r) });
              return (<>
                {rows.map(r => (
                  <div key={r.id} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                    <input type="date" value={r.date || ''} onChange={e => upd(r.id, { date: e.target.value })} style={{ ...inputStyle, width: '150px', flex: 'none' }} />
                    {cols.map(c => <input key={c.k} type={c.type || 'text'} value={r[c.k] ?? ''} placeholder={c.ph} onChange={e => upd(r.id, { [c.k]: c.type === 'number' ? (e.target.value === '' ? '' : parseFloat(e.target.value)) : e.target.value })} style={{ ...inputStyle, flex: c.flex || 1, minWidth: 0 }} />)}
                    <button type="button" onClick={() => setT({ [key]: rows.filter(x => x.id !== r.id) })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '15px' }}>×</button>
                  </div>
                ))}
                <button type="button" onClick={() => setT({ [key]: [...rows, { id: nid(), date: '' }] })} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>➕ Satır ekle</button>
              </>);
            };
            return (
              <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px', padding: '14px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '14px', color: '#34d399' }}>💳 Ödeme ve İptal Koşulları</h3>
                <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#94a3b8' }}>Proformadan otomatik dolar; elle de girilebilir. Otel sayfasında yaklaşan ödeme ve iptal tarihleri uyarı olarak görünür.{t.source ? ` · Kaynak: ${t.source}` : ''}</p>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1.3fr 1fr 0.6fr 1fr', gap: '8px', marginBottom: '12px' }}>
                  <div><label style={labelStyle}>Proforma No</label><input value={t.proformaNo || ''} onChange={e => setT({ proformaNo: e.target.value })} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Toplam tutar</label><input type="number" value={t.total ?? ''} onChange={e => setT({ total: e.target.value === '' ? '' : parseFloat(e.target.value) })} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Para</label><input value={t.currency || '€'} onChange={e => setT({ currency: e.target.value })} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Opsiyon / release</label><input type="date" value={t.releaseDate || ''} onChange={e => setT({ releaseDate: e.target.value })} style={inputStyle} /></div>
                </div>
                <label style={{ ...labelStyle, marginBottom: '6px' }}>Ödeme takvimi</label>
                {listEd('payments', [{ k: 'amount', ph: 'Tutar', type: 'number', flex: 0.6 }, { k: 'note', ph: 'Açıklama (örn. %30 depozito)', flex: 1.4 }])}
                <label style={{ ...labelStyle, margin: '12px 0 6px' }}>İptal / iade koşulları</label>
                {listEd('cancellation', [{ k: 'text', ph: 'Kural (örn. bu tarihe kadar ücretsiz iptal, %50 ceza)', flex: 2 }])}
              </div>
            );
          })()}

          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px', padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '14px', color: '#f59e0b' }}>💰 Anlaşma Fiyatları (oda başı, gecelik)</h3>
                <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Tarih dönemleri ekleyin. Her dönem için oda tipi × yemek konsepti fiyatları girin.</p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input type="file" accept=".xlsx,.xls" id="hotelPriceExcelInput" style={{ display: 'none' }} onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  let replaceMode = false;
                  if ((hotelForm.priceList || []).length > 0) {
                    replaceMode = window.confirm('Bu otelde zaten fiyat dönemi var.\n\nTAMAM = Eskileri SİL, yenilerini yükle\nİPTAL = Üstüne EKLE');
                  }
                  await handleHotelPriceExcel(hotelForm, f, replaceMode);
                  e.target.value = '';
                }} />
                <button type="button" onClick={() => downloadHotelPriceTemplate(hotelForm.name)} style={{ padding: '8px 12px', background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>📥 Örnek</button>
                <button type="button" onClick={() => document.getElementById('hotelPriceExcelInput').click()} disabled={hotelPriceUploadBusy} style={{ padding: '8px 12px', background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: '8px', color: '#06b6d4', cursor: hotelPriceUploadBusy ? 'wait' : 'pointer', fontSize: '12px', fontWeight: '600' }}>{hotelPriceUploadBusy ? '⏳...' : '📤 Excel ile Yükle'}</button>
                <button type="button" onClick={() => { setEditingPricePeriod(null); setShowPriceModal(true); }} style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '8px', color: '#0c1929', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>
                  ➕ Fiyat Dönemi Ekle
                </button>
              </div>
            </div>

            {/* Konsept seçimi */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{...labelStyle, marginBottom: '6px'}}>Anlaşmalı Konseptler</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {MEAL_CONCEPTS.map(key => ({ key, label: `${MEAL_CODE[key]} (${MEAL_TR[key]})` })).map(({key, label}) => {
                  const enabled = (hotelForm.enabledConcepts || []).includes(key);
                  return (
                    <button key={key} type="button" onClick={() => {
                      const cur = hotelForm.enabledConcepts || [];
                      const updated = enabled ? cur.filter(x => x !== key) : [...cur, key];
                      setHotelForm({...hotelForm, enabledConcepts: updated});
                    }} style={{
                      padding: '6px 10px',
                      background: enabled ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${enabled ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: '6px',
                      color: enabled ? '#f59e0b' : '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: enabled ? '600' : '500'
                    }}>
                      {enabled ? '✓ ' : ''}{label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Fiyat dönemleri listesi */}
            {(hotelForm.priceList || []).length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                📅 Henüz fiyat dönemi eklenmedi. "➕ Fiyat Dönemi Ekle" ile başlayın.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {(hotelForm.priceList || []).map((p, idx) => {
                  const concepts = hotelForm.enabledConcepts || ['bb'];
                  const isOpen = expandedPeriods[p.id];
                  return (
                    <div key={p.id || idx} style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.15)', overflow: 'hidden' }}>
                      <div onClick={() => togglePeriod(p.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', cursor: 'pointer', userSelect: 'none', background: isOpen ? 'rgba(245,158,11,0.08)' : 'transparent' }}>
                        <div style={{ fontSize: '13px', color: '#f59e0b', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '10px' }}>{isOpen ? '▼' : '▶'}</span>
                          📅 {formatDate(p.startDate)} → {formatDate(p.endDate)}
                          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '400' }}>({p.currency})</span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                          <button type="button" onClick={() => { setEditingPricePeriod(p); setShowPriceModal(true); }} style={{ padding: '4px 8px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '5px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px' }}>✏️</button>
                          <button type="button" onClick={() => {
                            if (window.confirm('Bu fiyat dönemini silmek istiyor musunuz?')) {
                              setHotelForm({ ...hotelForm, priceList: (hotelForm.priceList || []).filter((_, i) => i !== idx) });
                            }
                          }} style={{ padding: '4px 8px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '5px', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}>🗑️</button>
                        </div>
                      </div>
                      {isOpen && (
                      <div style={{ overflowX: 'auto', padding: '0 12px 12px' }}>
                        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                              <th style={{ padding: '4px 8px', textAlign: 'left', color: '#64748b', fontWeight: '600' }}>Oda</th>
                              {concepts.map(c => (
                                <th key={c} style={{ padding: '4px 8px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>{c.toUpperCase()}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {hotelRoomTypes.map(rt => (
                              <tr key={rt}>
                                <td style={{ padding: '4px 8px', color: '#e2e8f0', fontWeight: '600' }}>{rt}</td>
                                {concepts.map(c => {
                                  const val = p.rates?.[rt]?.[c];
                                  const buy = typeof val === 'number' ? 0 : (val?.buy || 0);
                                  const sell = typeof val === 'number' ? val : (val?.sell || 0);
                                  const hasAny = buy > 0 || sell > 0;
                                  return (
                                    <td key={c} style={{ padding: '4px 8px', textAlign: 'center' }}>
                                      {hasAny ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', alignItems: 'center', fontSize: '10px' }}>
                                          <span style={{ color: '#ef4444' }}>{buy > 0 ? `A: ${buy}` : '—'}</span>
                                          <span style={{ color: '#10b981' }}>{sell > 0 ? `S: ${sell}` : '—'}</span>
                                        </div>
                                      ) : <span style={{ color: '#475569' }}>—</span>}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>Notlar</label>
            <textarea value={hotelForm.notes} onChange={e => setHotelForm({...hotelForm, notes: e.target.value})} placeholder="Otel hakkında notlar..." style={{...inputStyle, minHeight: '80px', resize: 'vertical'}} />
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button onClick={saveHotel} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
              {editingHotel ? '💾 Kaydet' : '✅ Otel Ekle'}
            </button>
            {editingHotel && (
              <button onClick={() => deleteHotel(editingHotel)} style={{ padding: '12px 20px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '10px', color: '#ef4444', cursor: 'pointer', fontSize: '13px' }}>🗑️ Sil</button>
            )}
          </div>
        </div>

        {/* FİYAT DÖNEMİ MODAL */}
        {showPriceModal && (
          <PricePeriodModal
            existing={editingPricePeriod}
            roomTypes={hotelRoomTypes}
            concepts={hotelForm.enabledConcepts || ['bb']}
            onClose={() => { setShowPriceModal(false); setEditingPricePeriod(null); }}
            onSave={(period) => {
              const list = hotelForm.priceList || [];
              if (editingPricePeriod) {
                const updated = list.map(p => p.id === editingPricePeriod.id ? { ...period, id: editingPricePeriod.id } : p);
                setHotelForm({ ...hotelForm, priceList: updated });
              } else {
                setHotelForm({ ...hotelForm, priceList: [...list, { ...period, id: generateUniqueId() }] });
              }
              setShowPriceModal(false); setEditingPricePeriod(null);
            }}
            showToast={showToast}
          />
        )}
      </div>
    );
  }

  // ====== OTEL DETAY ======
  if (view === 'detail' && selectedHotel) {
    const h = selectedHotel;
    const reservations = h.reservations || [];
    const totalRevenue = reservations.reduce((s, r) => s + (parseFloat(r.price) || 0), 0);
    const totalPaid = reservations.reduce((s, r) => s + (parseFloat(r.payment1) || 0) + (parseFloat(r.payment2) || 0) + (parseFloat(r.payment3) || 0), 0);
    const totalBuy = reservations.reduce((s, r) => s + (parseFloat(r.buyPrice) || 0), 0);
    const totalProfit = totalRevenue - totalBuy;
    const resWords = normalizeTr(resSearch).split(/\s+/).filter(Boolean);
    const shownRes = resWords.length ? reservations.filter(r => { const hay = normalizeTr(`${r.customerName || ''} ${r.tag || ''}`); return resWords.every(w => hay.includes(w)); }) : reservations;

    return (
      <div style={{ padding: isMobile ? '12px' : '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <button onClick={() => setView('list')} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '12px', marginBottom: '8px' }}>← Otel Listesi</button>
            <h2 style={{ margin: 0, fontSize: '22px' }}>{titleCaseTr(h.name)} <span style={{ color: '#f59e0b', fontSize: '14px' }}>{'★'.repeat(parseInt(h.stars) || 0)}</span></h2>
            <p style={{ margin: '4px 0', color: '#94a3b8', fontSize: '13px' }}>🌍 {titleCaseTr(h.city)}{h.country ? `, ${titleCaseTr(h.country)}` : ''}</p>
            {h.address && <p style={{ margin: '4px 0', color: '#64748b', fontSize: '12px' }}>📍 {h.address}</p>}
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '4px' }}>
              {h.phone && <span style={{ fontSize: '12px', color: '#64748b' }}>📞 {h.phone}</span>}
              {h.bookingCode && <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: '600' }}>🎫 {h.bookingCode}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => openEditHotel(h)} style={{ padding: '8px 14px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px' }}>✏️ Düzenle</button>

            {/* Excel Export */}
            {reservations.length > 0 && (
              <button onClick={() => {
                const rows = [];
                rows.push(['Müşteri', 'Telefon', 'Giriş', 'Çıkış', 'Gece', 'Oda Tipi', 'Konsept', 'Alış', 'Satış', 'Kâr', 'Para', 'Ödenen', 'Kalan', 'Etiket', 'Notlar', 'Uçuş / transfer (ek)', 'Ek satış (Satış\'a dahil)']);
                reservations.forEach(r => {
                  const nights = calcNights(r.checkIn, r.checkOut);
                  const buy = parseFloat(r.buyPrice) || 0;
                  const paid = (parseFloat(r.payment1) || 0) + (parseFloat(r.payment2) || 0) + (parseFloat(r.payment3) || 0);
                  rows.push([
                    [r.customerName, ...(r.guestNames || [])].filter(n => n && String(n).trim()).map(n => titleCaseTr(String(n).trim())).join(' / '),
                    r.customerPhone || '',
                    r.checkIn ? formatDate(r.checkIn) : '',
                    r.checkOut ? formatDate(r.checkOut) : '',
                    nights,
                    r.roomType || '',
                    r.concept ? trUpper(r.concept) : '',
                    buy + resExtras(r).reduce((t, x) => t + x.buy, 0) + resTotals(h, r).linked.reduce((t, x) => t + x.buy, 0),
                    resTotals(h, r).total,
                    resTotals(h, r).profit,
                    r.currency || '€',
                    paid,
                    resTotals(h, r).total - paid,
                    r.tag || '',
                    r.notes || '',
                    [...resExtras(r).map(x => `${x.name}: ${x.text}${x.price ? ` (${x.price})` : ''}`), ...resTotals(h, r).linked.map(x => `${x.label} (${x.amount})`)].join(' · '),
                    (resExtraSum(r) + resTotals(h, r).linkedSell) || ''
                  ]);
                });
                const ws = XLSX.utils.aoa_to_sheet(rows);
                ws['!cols'] = [{wch:22},{wch:14},{wch:12},{wch:12},{wch:6},{wch:14},{wch:8},{wch:10},{wch:10},{wch:10},{wch:6},{wch:10},{wch:10},{wch:14},{wch:30}];
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Rezervasyonlar');
                XLSX.writeFile(wb, `${h.name.replace(/\s/g,'_')}_Rezervasyonlar.xlsx`);
                showToast?.('✅ Excel indirildi', 'success');
              }} style={{ padding: '8px 14px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: '8px', color: '#10b981', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                📊 Excel
              </button>
            )}
            {/* Otele gönderilecek liste: oda başına bir satır, odadaki herkes yazılır (fiyat yok) */}
            {reservations.length > 0 && (
              <button onClick={() => {
                const rows = [['Guest Name(s)', 'Check in', 'Check out', 'Nights', 'Room Type', 'Meal Type', 'Pax']];
                [...reservations].filter(r => !r.cancelled).sort((a, b) => String(a.checkIn || '').localeCompare(String(b.checkIn || '')) || String(a.customerName || '').localeCompare(String(b.customerName || ''), 'tr')).forEach(r => {
                  const names = [r.customerName, ...(r.guestNames || [])].filter(n => n && String(n).trim()).map(n => titleCaseTr(String(n).trim()));
                  rows.push([names.join(' / '), r.checkIn ? formatDate(r.checkIn) : '', r.checkOut ? formatDate(r.checkOut) : '', calcNights(r.checkIn, r.checkOut), r.roomType || '', trUpper(r.concept || ''), Math.max(names.length, resPax(r))]);
                });
                const ws = XLSX.utils.aoa_to_sheet(rows);
                ws['!cols'] = [{wch:44},{wch:12},{wch:12},{wch:7},{wch:12},{wch:10},{wch:5}];
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Rooming List');
                XLSX.writeFile(wb, `${h.name.replace(/\s/g,'_')}_Rooming_List.xlsx`);
                showToast?.('✅ Otel listesi indirildi', 'success');
              }} title="Otele gönderilecek liste: odadaki herkes, tarihler, oda ve pansiyon (fiyatsız)" style={{ padding: '8px 14px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: '8px', color: '#10b981', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                🏨 Otel listesi
              </button>
            )}

            {selectedResIds.length > 0 && (
              <button onClick={() => {
                const selected = reservations.filter(r => selectedResIds.includes(r.id));
                hotelProformaWithFlights(h, selected);
              }} style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '8px', color: '#f59e0b', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                📄 Seçilenleri Proforma ({selectedResIds.length})
              </button>
            )}
            <button onClick={openNewRes} style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '8px', color: '#0c1929', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>➕ Rezervasyon</button>
          </div>
        </div>

        {/* Özet İstatistikleri */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '10px', padding: '12px' }}>
            <div style={{ fontSize: '22px', fontWeight: '700', color: '#3b82f6' }}>{reservations.length}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Toplam Rezervasyon</div>
          </div>
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', padding: '12px' }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#ef4444' }}>{totalBuy.toLocaleString('tr-TR')} €</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Toplam Alış</div>
          </div>
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px', padding: '12px' }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#10b981' }}>{totalRevenue.toLocaleString('tr-TR')} €</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Toplam Satış</div>
          </div>
          <div style={{ background: totalProfit >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${totalProfit >= 0 ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`, borderRadius: '10px', padding: '12px' }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: totalProfit >= 0 ? '#22c55e' : '#ef4444' }}>
              {totalProfit >= 0 ? '+' : ''}{totalProfit.toLocaleString('tr-TR')} €
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Toplam Kâr</div>
          </div>
          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px', padding: '12px' }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#f59e0b' }}>{totalPaid.toLocaleString('tr-TR')} €</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Tahsil Edilen</div>
          </div>
          <div style={{ background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.2)', borderRadius: '10px', padding: '12px' }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#64748b' }}>{(totalRevenue - totalPaid).toLocaleString('tr-TR')} €</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Kalan Tahsilat</div>
          </div>
        </div>

        {/* 📄 Hotel Info Sheet — otelin bilgi föyü: yükle, aç, linkini kopyala, sil */}
        {(() => {
          const sheets = h.infoSheets || [];
          const fmtSize = (b) => !b ? '' : b >= 1048576 ? `${(b / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
          const icon = (f) => /pdf/.test(f.type || '') || /\.pdf$/.test(normalizeTr(f.name)) ? '📕' : /^image\//.test(f.type || '') ? '🖼️' : '📄';
          const btn = { padding: '6px 10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#e8f1f8', cursor: 'pointer', fontSize: '12px' };
          return (
            <div style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.25)', borderRadius: '10px', padding: '12px 14px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '13px', color: '#22d3ee', fontWeight: '600' }}>📄 Hotel Info Sheet <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '400' }}>({sheets.length} dosya)</span></div>
                <label title={`PDF, görsel, Word/Excel — dosya başına en çok ${INFO_MAX_MB} MB; birden çok dosya seçilebilir`} style={{ padding: '7px 14px', background: 'rgba(6,182,212,0.18)', border: '1px solid rgba(6,182,212,0.45)', borderRadius: '8px', color: '#22d3ee', cursor: infoBusy ? 'wait' : 'pointer', fontSize: '12px', fontWeight: '600' }}>
                  {infoBusy || '📤 Info Sheet Yükle'}
                  <input type="file" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx" disabled={!!infoBusy} style={{ display: 'none' }} onChange={e => { uploadInfoSheets(h, e.target.files); e.target.value = ''; }} />
                </label>
              </div>
              {sheets.length === 0
                ? <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>Otelin bilgi föyünü (info sheet / fact sheet) yükleyin — buradan açılır, linki kopyalanıp paylaşılır.</div>
                : <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {sheets.map(f => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px' }}>
                        <a href={f.url} target="_blank" rel="noopener noreferrer" title="Aç" style={{ flex: '1 1 160px', minWidth: 0, color: '#e8f1f8', fontSize: '13px', fontWeight: '600', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{icon(f)} {f.name}</a>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>{[fmtSize(f.size), f.addedAt ? formatDate(f.addedAt) : '', f.addedBy || ''].filter(Boolean).join(' · ')}</span>
                        <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: 'none' }}>👁️ Aç</a>
                        <button onClick={async () => { try { await navigator.clipboard.writeText(f.url); showToast?.('🔗 Link kopyalandı', 'success'); } catch (e) { window.prompt('Linki kopyalayın:', f.url); } }} style={btn}>🔗 Link</button>
                        <button onClick={() => removeInfoSheet(h, f)} title="Sil" style={{ ...btn, color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.12)' }}>🗑️</button>
                      </div>))}
                  </div>}
            </div>);
        })()}

        {/* 💳 Ödeme ve iptal koşulları */}
        {(() => {
          const t = h.hotelTerms || {};
          const pays = (t.payments || []).filter(x => x.date || x.amount || x.note);
          const cans = (t.cancellation || []).filter(x => x.date || x.text);
          if (!pays.length && !cans.length && !t.releaseDate && !t.total) return null;
          const today = new Date().toISOString().slice(0, 10);
          const days = (d) => isYmd(d) ? Math.round((new Date(d + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 86400000) : null;
          const tag = (d) => { const n = days(d); if (n == null) return { c: '#94a3b8', t: '' }; if (n < 0) return { c: '#64748b', t: 'geçti' }; if (n === 0) return { c: '#ef4444', t: 'bugün' }; if (n <= 7) return { c: '#ef4444', t: `${n} gün kaldı` }; if (n <= 30) return { c: '#f59e0b', t: `${n} gün kaldı` }; return { c: '#10b981', t: `${n} gün` }; };
          const cur = t.currency || '€';
          const row = (d, main, sub) => { const g = tag(d); return (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '12px', opacity: g.t === 'geçti' ? 0.55 : 1 }}>
              <span style={{ width: '82px', flexShrink: 0, color: '#e8f1f8', fontWeight: '600' }}>{d ? formatDate(d) : '—'}</span>
              <span style={{ flex: 1, color: '#e8f1f8' }}>{main}{sub ? <span style={{ color: '#94a3b8' }}> · {sub}</span> : null}</span>
              {g.t && <span style={{ color: g.c, fontWeight: '600', whiteSpace: 'nowrap', fontSize: '11px' }}>{g.t}</span>}
            </div>); };
          return (
            <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.18)', borderRadius: '10px', padding: '14px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                <div style={{ fontSize: '13px', color: '#34d399', fontWeight: '600' }}>💳 Ödeme ve İptal Koşulları</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  {t.proformaNo && <span>Proforma {t.proformaNo}</span>}
                  {t.total ? <span>Toplam <b style={{ color: '#e8f1f8' }}>{Number(t.total).toLocaleString('tr-TR')} {cur}</b></span> : null}
                  {t.releaseDate && <span style={{ color: tag(t.releaseDate).c }}>Opsiyon {formatDate(t.releaseDate)}{tag(t.releaseDate).t ? ` (${tag(t.releaseDate).t})` : ''}</span>}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', marginBottom: '2px' }}>ÖDEME TAKVİMİ</div>
                  {pays.length ? [...pays].sort((a, b) => String(a.date).localeCompare(String(b.date))).map(x => <div key={x.id}>{row(x.date, x.amount ? `${Number(x.amount).toLocaleString('tr-TR')} ${cur}` : (x.note || 'Ödeme'), x.amount ? x.note : '')}</div>) : <div style={{ fontSize: '12px', color: '#64748b' }}>—</div>}
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', marginBottom: '2px' }}>İPTAL / İADE</div>
                  {cans.length ? [...cans].sort((a, b) => String(a.date).localeCompare(String(b.date))).map(x => <div key={x.id}>{row(x.date, x.text || '—')}</div>) : <div style={{ fontSize: '12px', color: '#64748b' }}>—</div>}
                </div>
              </div>
            </div>
          );
        })()}

        {/* 🛏️ Oda durumu — gece × oda tipi: dolu / kontenjan */}
        {(() => {
          const per = hotelNightly(h);
          const allKinds = hotelRoomKinds(h, hotelRoomTypes);
          const dateSet = new Set(Object.keys(h.roomAllotment || {}));
          Object.values(per).forEach(m => Object.keys(m).forEach(d => dateSet.add(d)));
          const dates = [...dateSet].sort();
          const used = (d, k) => per[roomKey(k)]?.[d] || 0;
          const kinds = allKinds.filter(k => dates.some(d => allotOf(h, d, k) > 0 || used(d, k) > 0));
          if (!dates.length || !kinds.length) return null;
          let tAllot = 0, tFree = 0, tOver = 0;
          dates.forEach(d => kinds.forEach(k => { const a = allotOf(h, d, k), u = used(d, k); tAllot += a; tFree += Math.max(0, a - u); tOver += Math.max(0, u - a); }));
          const hasAllot = tAllot > 0;
          return (
            <div style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: '10px', padding: '14px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ fontSize: '13px', color: '#60a5fa', fontWeight: '600' }}>🛏️ Oda Durumu (gece gece)</div>
                <div style={{ display: 'flex', gap: '12px', fontSize: '11px', flexWrap: 'wrap' }}>
                  {hasAllot ? (<>
                    <span style={{ color: '#94a3b8' }}>Kontenjan: <b style={{ color: '#e8f1f8' }}>{tAllot}</b> oda-gece</span>
                    <span style={{ color: tFree ? '#f59e0b' : '#10b981' }}>Boş: <b>{tFree}</b></span>
                    {tOver > 0 && <span style={{ color: '#ef4444' }}>⚠️ Fazla: <b>{tOver}</b></span>}
                  </>) : <button onClick={() => openEditHotel(h)} style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}>Kontenjanı gir</button>}
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
                  <thead><tr>
                    <th style={{ textAlign: 'left', padding: '6px', color: '#94a3b8', fontWeight: '600' }}>Gece</th>
                    {kinds.map(k => <th key={k} style={{ padding: '6px', color: '#e8f1f8', fontWeight: '600', whiteSpace: 'nowrap', textAlign: 'center' }}>{k}</th>)}
                  </tr></thead>
                  <tbody>
                    {dates.map(d => (
                      <tr key={d} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <td style={{ padding: '6px', color: '#e8f1f8', whiteSpace: 'nowrap' }}>{formatDate(d)}</td>
                        {kinds.map(k => {
                          const a = allotOf(h, d, k), u = used(d, k);
                          const c = a === 0 && u === 0 ? '#475569' : u > a ? '#ef4444' : u === a ? '#f59e0b' : '#10b981';
                          const tip = a === 0 && u > 0 ? 'Kontenjan yok' : u > a ? `${u - a} fazla` : u === a ? 'Dolu' : `${a - u} boş`;
                          return <td key={k} title={tip} style={{ padding: '6px', textAlign: 'center', color: c, fontWeight: u || a ? '700' : '400', whiteSpace: 'nowrap' }}>{a === 0 && u === 0 ? '—' : `${u} / ${a}`}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: '8px', fontSize: '10px', color: '#64748b' }}>Dolu / kontenjan · <span style={{ color: '#10b981' }}>boş oda var</span> · <span style={{ color: '#f59e0b' }}>tam dolu</span> · <span style={{ color: '#ef4444' }}>kontenjandan fazla</span></div>
            </div>
          );
        })()}

        {/* Anlaşma fiyatları */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '14px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: pricesCollapsed ? 0 : '10px' }}>
            <div onClick={() => setPricesCollapsed(!pricesCollapsed)} style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', userSelect: 'none' }}>
              <span style={{ fontSize: '11px', color: '#f59e0b' }}>{pricesCollapsed ? '▶' : '▼'}</span>
              💰 Anlaşma Fiyatları
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '400' }}>({(h.priceList || []).length} dönem)</span>
            </div>
            {(h.priceList || []).length > 1 && (
              <button onClick={(e) => {
                e.stopPropagation();
                const list = h.priceList || [];
                const seen = new Map(); const unique = []; let dup = 0;
                list.forEach(p => {
                  const key = `${p.startDate}|${p.endDate}|${p.currency}|${JSON.stringify(p.rates || {})}`;
                  if (seen.has(key)) { dup++; } else { seen.set(key, true); unique.push(p); }
                });
                if (dup === 0) { showToast('Tekrar eden dönem yok', 'info'); return; }
                if (!window.confirm(`${dup} tekrar eden dönem bulundu. Silinsin mi?`)) return;
                setHotels(prev => prev.map(x => x.id === h.id ? { ...x, priceList: unique } : x));
                setSelectedHotel(s => s && s.id === h.id ? { ...s, priceList: unique } : s);
                showToast(`${dup} tekrar silindi`, 'success');
              }} style={{ padding: '5px 10px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}>🧹 Tekrarları Temizle</button>
            )}
          </div>
          {!pricesCollapsed && (() => {
            const list = h.priceList || [];
            const concepts = h.enabledConcepts && h.enabledConcepts.length > 0 ? h.enabledConcepts : ['bb'];
            if (list.length === 0) {
              return <div style={{ padding: '14px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>Henüz fiyat dönemi eklenmedi</div>;
            }
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {list.map(p => {
                  const isOpen = expandedPeriods[p.id];
                  return (
                    <div key={p.id} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', overflow: 'hidden' }}>
                      <div onClick={() => togglePeriod(p.id)} style={{
                        fontSize: '12px', color: '#f59e0b', fontWeight: '600',
                        padding: '10px', cursor: 'pointer', userSelect: 'none',
                        display: 'flex', alignItems: 'center', gap: '8px',
                        background: isOpen ? 'rgba(245,158,11,0.08)' : 'transparent',
                        transition: 'background 0.15s'
                      }}>
                        <span style={{ fontSize: '10px', color: '#f59e0b' }}>{isOpen ? '▼' : '▶'}</span>
                        📅 {formatDate(p.startDate)} → {formatDate(p.endDate)}
                        <span style={{color:'#64748b', fontWeight:'400', fontSize: '11px'}}>({p.currency})</span>
                      </div>
                      {isOpen && (
                        <div style={{ overflowX: 'auto', padding: '0 10px 10px' }}>
                          <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                <th style={{ padding: '4px 8px', textAlign: 'left', color: '#64748b', fontWeight: '600' }}>Oda</th>
                                {concepts.map(c => (
                                  <th key={c} style={{ padding: '4px 8px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>{c.toUpperCase()}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(appSettings?.hotelRoomTypes || ['Single','Double','Triple','Suite']).map(rt => (
                                <tr key={rt}>
                                  <td style={{ padding: '4px 8px', color: '#e2e8f0', fontWeight: '600' }}>{rt}</td>
                                  {concepts.map(c => {
                                    const val = p.rates?.[rt]?.[c];
                                    const buy = typeof val === 'number' ? 0 : (val?.buy || 0);
                                    const sell = typeof val === 'number' ? val : (val?.sell || 0);
                                    const hasAny = buy > 0 || sell > 0;
                                    return (
                                      <td key={c} style={{ padding: '4px 8px', textAlign: 'center' }}>
                                        {hasAny ? (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', alignItems: 'center', fontSize: '10px' }}>
                                            <span style={{ color: '#ef4444' }}>{buy > 0 ? `A: ${buy}` : '—'}</span>
                                            <span style={{ color: '#10b981' }}>{sell > 0 ? `S: ${sell}` : '—'}</span>
                                          </div>
                                        ) : <span style={{ color: '#475569' }}>—</span>}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {nameMenu && (() => {
          const sel = selectedResIds.includes(nameMenu.res.id) && selectedResIds.length > 1 ? reservations.filter(x => selectedResIds.includes(x.id)) : null;
          const sameTag = nameMenu.res.tag ? reservations.filter(x => !x.cancelled && normalizeTr(x.tag) === normalizeTr(nameMenu.res.tag)) : [];
          const item = { display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: '#e8f1f8', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap' };
          return (
            <div onClick={() => setNameMenu(null)} onContextMenu={e => { e.preventDefault(); setNameMenu(null); }} style={{ position: 'fixed', inset: 0, zIndex: 2500 }}>
              <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', left: Math.max(8, Math.min(nameMenu.x, window.innerWidth - 300)), top: Math.max(8, Math.min(nameMenu.y, window.innerHeight - 170)), minWidth: '240px', background: '#0f2744', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '10px', boxShadow: '0 12px 30px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
                <div style={{ padding: '8px 14px', fontSize: '11px', color: '#64748b', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{titleCaseTr(nameMenu.res.customerName)}</div>
                <button style={item} onClick={() => openFlightPick(h, [nameMenu.res])}>✈️ Uçuşa ekle{(nameMenu.res.guestNames || []).filter(Boolean).length ? ' (odadakilerle)' : ''}</button>
                {sel && <button style={item} onClick={() => openFlightPick(h, sel)}>✈️ Seçili {sel.length} rezervasyonu uçuşa ekle</button>}
                {sameTag.length > 1 && <button style={item} onClick={() => openFlightPick(h, sameTag)}>✈️ 🏷️ {nameMenu.res.tag} — {sameTag.length} rezervasyonu uçuşa ekle</button>}
              </div>
            </div>
          );
        })()}
        {flightPick && (() => {
          const ppl = flightPick.people;
          const n = ppl.filter(p => p.checked).length;
          const todayStr = new Date().toISOString().slice(0, 10);
          const list = [...groupFlights].sort((a, b) => {
            const pa = String(a.date || '') < todayStr, pb = String(b.date || '') < todayStr;
            return pa !== pb ? (pa ? 1 : -1) : String(a.date || '').localeCompare(String(b.date || ''));
          });
          return (
            <div onClick={() => setFlightPick(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
              <div onClick={e => e.stopPropagation()} style={{ background: '#0f2744', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '14px', padding: '18px', width: '100%', maxWidth: '520px', maxHeight: '86vh', overflowY: 'auto' }}>
                {flightPick.done ? (
                  <div>
                    <h4 style={{ margin: '0 0 8px', fontSize: '16px' }}>✅ Tamam</h4>
                    <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#cbd5e1' }}>{flightPick.done.msg}</p>
                    {flightPick.done.pkgs.length > 0 && (
                      <>
                        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>📦 {flightPick.done.pkgs.length} paket (otel + uçuş) — Paketler sekmesinde:</div>
                        <div style={{ fontSize: '12px', color: '#e8f1f8', marginBottom: '12px' }}>{flightPick.done.pkgs.map(pk => <div key={pk.id}>• {pk.customerName} — {(pk.items || []).length} kalem</div>)}</div>
                        <button onClick={() => generatePackageProforma(flightPick.done.pkgs)} style={{ width: '100%', padding: '11px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>📄 Tek proforma indir ({flightPick.done.pkgs.length} paket)</button>
                      </>
                    )}
                    <button onClick={() => setFlightPick(null)} style={{ marginTop: '8px', width: '100%', padding: '10px', background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>Kapat</button>
                  </div>
                ) : <>
                <h4 style={{ margin: '0 0 4px', fontSize: '16px' }}>✈️ Grup uçuşuna ekle</h4>
                <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#94a3b8' }}>Kişiler etiketi ve "{flightPick.hotel.name}" otel bağlantısıyla eklenir; fiyat uçuşun kişi başı fiyatından gelir. Uçuşta zaten olanlar atlanır.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                  {ppl.map(p => (
                    <label key={p.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '14px', fontSize: '12px', cursor: 'pointer', background: p.checked ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)', border: `1px solid ${p.checked ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.1)'}`, color: p.checked ? '#10b981' : '#94a3b8' }}>
                      <input type="checkbox" checked={p.checked} onChange={() => setFlightPick(fp => ({ ...fp, people: fp.people.map(x => x.key === p.key ? { ...x, checked: !x.checked } : x) }))} />
                      {p.customerName}{p.tag ? <span style={{ color: '#fbbf24' }}> 🏷️ {p.tag}</span> : null}
                    </label>
                  ))}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', marginBottom: '12px', background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)', borderRadius: '8px', fontSize: '12px', color: '#06b6d4', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!flightPick.makePkg} onChange={() => setFlightPick(fp => ({ ...fp, makePkg: !fp.makePkg }))} />
                  📦 Paket de oluştur — her oda için otel + uçuş (sonra tek proforma)
                </label>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Uçuş seçin ({n} kişi eklenecek):</div>
                {list.length === 0 && <div style={{ fontSize: '12px', color: '#64748b', padding: '10px 0' }}>Kayıtlı grup uçuşu yok. Önce "✈️ Grup Uçuşlar"dan uçuş ekleyin.</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {list.map(fl => {
                    const act = (fl.reservations || []).filter(x => !x.cancelled);
                    const cap = parseInt(fl.capacity) || 0;
                    const left = cap - act.length;
                    const past = String(fl.date || '') < todayStr;
                    const already = ppl.filter(p => p.checked && act.some(x => normalizeTr(x.customerName) === p.key)).length;
                    return (
                      <button key={fl.id} onClick={() => addPeopleToFlight(fl)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', textAlign: 'left', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', cursor: 'pointer', opacity: past ? 0.55 : 1 }}>
                        <span>
                          <b style={{ fontSize: '13px' }}>{fl.airline || 'Uçuş'} {fl.flightNo || ''}</b> <span style={{ fontSize: '12px', color: '#94a3b8' }}>{fl.from} → {fl.to}</span>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>📅 {formatDate(fl.date)}{fl.depTime ? ` · ${fl.depTime}` : ''}{past ? ' · geçmiş' : ''}{already ? ` · ${already} kişi zaten bu uçuşta` : ''}</div>
                        </span>
                        <span style={{ fontSize: '11px', whiteSpace: 'nowrap', color: cap && left < n ? '#ef4444' : '#10b981' }}>{cap ? `${Math.max(0, left)} yer` : `${act.length} kişi`}</span>
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setFlightPick(null)} style={{ marginTop: '12px', width: '100%', padding: '10px', background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>İptal</button>
                </>}
              </div>
            </div>
          );
        })()}

        {/* Rezervasyon araması: ad soyad veya etiket (firma). Birden fazla kelime: hepsi geçmeli ("kayteks semanur") */}
        {reservations.length > 0 && (() => {
          const words = resWords, shown = shownRes;
          const sum = (f) => shown.reduce((t, r) => t + f(r), 0);
          const sell = sum(r => resTotals(h, r).total), got = sum(r => (parseFloat(r.payment1) || 0) + (parseFloat(r.payment2) || 0) + (parseFloat(r.payment3) || 0));
          const cur = reservations[0]?.currency || '€';
          return (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ position: 'relative' }}>
                <input value={resSearch} onChange={e => setResSearch(e.target.value)} placeholder="🔍 Ad soyad veya etiket ara (ör. Kayteks)" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 36px 10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e8f1f8', fontSize: '13px' }} />
                {resSearch && <button onClick={() => setResSearch('')} title="Temizle" style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '14px' }}>✕</button>}
              </div>
              {words.length > 0 && (
                <div style={{ marginTop: '6px', fontSize: '12px', color: shown.length ? '#94a3b8' : '#f59e0b' }}>
                  {shown.length ? <>{shown.length} / {reservations.length} rezervasyon · Satış {sell.toLocaleString('tr-TR')} {cur} · Tahsil {got.toLocaleString('tr-TR')} {cur} · Kalan {(sell - got).toLocaleString('tr-TR')} {cur}</> : 'Eşleşen rezervasyon yok'}
                </div>
              )}
            </div>
          );
        })()}

        {/* Rezervasyonlar Tablosu */}
        {reservations.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', background: 'rgba(255,255,255,0.02)', borderRadius: '10px' }}>
            Henüz rezervasyon yok. Sağ üstten ekleyin.
          </div>
        ) : (
          <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', minWidth: '600px' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b', fontWeight: '600', fontSize: '11px', width: '32px' }}>
                      <input type="checkbox"
                        checked={shownRes.length > 0 && shownRes.every(r => selectedResIds.includes(r.id))}
                        onChange={e => setSelectedResIds(e.target.checked ? [...new Set([...selectedResIds, ...shownRes.map(r => r.id)])] : selectedResIds.filter(id => !shownRes.some(r => r.id === id)))}
                        style={{ cursor: 'pointer' }} />
                    </th>
                    {['Müşteri', 'Giriş - Çıkış', 'Gece', 'Oda / Konsept', 'Tutar', 'Ödeme', ''].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: '600', fontSize: '11px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownRes.map(r => {
                    const nights = calcNights(r.checkIn, r.checkOut);
                    const paid = (parseFloat(r.payment1) || 0) + (parseFloat(r.payment2) || 0) + (parseFloat(r.payment3) || 0);
                    const rt = resTotals(h, r); // otel + münferit uçuş/transfer + bağlı grup uçuşu bileti ve transfer
                    const total = rt.total;
                    const buy = parseFloat(r.buyPrice) || 0;
                    const profit = rt.profit; // alışı girilmiş ek kalemler kâra katılır
                    const fullyPaid = paid >= total && total > 0;
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: selectedResIds.includes(r.id) ? 'rgba(59,130,246,0.06)' : 'transparent' }}>
                        <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                          <input type="checkbox" checked={selectedResIds.includes(r.id)} onChange={() => toggleResSelection(r.id)} style={{ cursor: 'pointer' }} />
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: '600' }}
                          title="Sağ tık (telefonda basılı tut): uçuşa ekle"
                          onContextMenu={e => { e.preventDefault(); setNameMenu({ x: e.clientX, y: e.clientY, res: r }); }}
                          onTouchStart={e => { const t = e.touches[0]; const x = t.clientX, y = t.clientY; const el = e.currentTarget; clearTimeout(el._lp); el._lp = setTimeout(() => setNameMenu({ x, y, res: r }), 600); }}
                          onTouchEnd={e => clearTimeout(e.currentTarget._lp)} onTouchMove={e => clearTimeout(e.currentTarget._lp)}>
                          <span onClick={() => { const c = customers.find(x => String(x.id) === String(r.customerId)); if (c && onNavigateToCustomer) onNavigateToCustomer(c); }} style={{ cursor: 'pointer', color: '#93c5fd', textDecoration: 'underline dotted', textUnderlineOffset: '3px' }}>
                            {titleCaseTr(r.customerName)}
                          </span>
                          {r.tag && <span style={{ marginLeft: '6px', padding: '2px 6px', background: 'rgba(254,243,199,0.2)', color: '#fbbf24', borderRadius: '3px', fontSize: '10px', fontWeight: '600' }}>🏷️ {r.tag}</span>}
                          {resExtras(r).length > 0 && <div style={{ marginTop: '3px', fontSize: '10.5px', color: '#94a3b8' }}>{resExtras(r).map(x => `${x.icon} ${x.name}: ${x.text}${x.price ? ` (${x.qty > 1 ? `${x.unitPrice.toLocaleString('tr-TR')} × ${x.qty} = ` : ''}${x.price.toLocaleString('tr-TR')} ${r.currency || '€'})` : ''}`).join(' · ')}</div>}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: '11px' }}>{formatDate(r.checkIn)} → {formatDate(r.checkOut)}</td>
                        <td style={{ padding: '10px 12px', color: '#94a3b8' }}>{nights}</td>
                        <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: '11px' }}>
                          {r.roomType}
                          {r.concept && <span style={{ marginLeft: '6px', padding: '2px 6px', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', borderRadius: '3px', fontSize: '10px', fontWeight: '600' }}>{trUpper(r.concept)}</span>}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: '600', color: '#10b981' }}>
                          {total.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} {r.currency || '€'}
                          {(rt.linkedSell > 0 || resExtraSum(r) > 0 || rt.other.length > 0) && (
                            <div style={{ fontSize: '10px', fontWeight: 400, color: '#94a3b8', whiteSpace: 'nowrap' }} title={[...rt.linked, ...rt.other].map(x => `${x.label}: ${x.amount} ${x.currency}`).join('\n')}>
                              🏨 {(parseFloat(r.price) || 0).toLocaleString('tr-TR')}{rt.linked.filter(x => x.kind === 'flight').length + resExtras(r).filter(x => x.kind === 'flight').length ? ` · ✈️ ${(rt.linked.filter(x => x.kind === 'flight').reduce((t, x) => t + x.amount, 0) + resExtras(r).filter(x => x.kind === 'flight').reduce((t, x) => t + x.price, 0)).toLocaleString('tr-TR')}` : ''}{rt.linked.filter(x => x.kind === 'transfer').length + resExtras(r).filter(x => x.kind === 'transfer').length ? ` · 🚐 ${(rt.linked.filter(x => x.kind === 'transfer').reduce((t, x) => t + x.amount, 0) + resExtras(r).filter(x => x.kind === 'transfer').reduce((t, x) => t + x.price, 0)).toLocaleString('tr-TR')}` : ''}
                              {rt.other.map((x, i) => <span key={i}> · +{x.amount} {x.currency}</span>)}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '600',
                            background: fullyPaid ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.15)',
                            color: fullyPaid ? '#10b981' : '#ef4444' }}>
                            {fullyPaid ? '✓ Ödendi' : `${paid}/${total}`}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', display: 'flex', gap: '4px' }}>
                          <button onClick={() => hotelProformaWithFlights(h, [r])} style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '6px', padding: '4px 8px', color: '#f59e0b', cursor: 'pointer', fontSize: '14px' }} title="Proforma İndir">📄</button>
                          <button onClick={() => generateHotelVoucher(h, r)} style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '6px', padding: '4px 8px', color: '#22c55e', cursor: 'pointer', fontSize: '14px' }} title="Voucher İndir">🎫</button>
                          <button onClick={() => openEditRes(r)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '14px' }} title="Düzenle">✏️</button>
                          <button onClick={() => deleteReservation(r)} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', padding: '4px 8px', color: '#ef4444', cursor: 'pointer', fontSize: '14px' }} title="Sil">🗑️</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* REZERVASYON FORMU MODAL */}
        {showResForm && (
          <div onClick={() => { setShowResForm(false); setEditingRes(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', overflowY: 'auto' }}>
            <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
            <div onClick={e => e.stopPropagation()} className="hide-scrollbar" style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflowY: 'auto', scrollbarWidth: 'none' }}>
              <h3 style={{ margin: '0 0 20px', fontSize: '18px' }}>{editingRes ? '✏️ Rezervasyon Düzenle' : '➕ Yeni Rezervasyon'} — {titleCaseTr(h.name)}</h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Müşteri seçimi */}
                <div style={{ position: 'relative' }}>
                  <label style={labelStyle}>Müşteri Seç *</label>
                  {resData.customerName ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px' }}>
                      <span style={{ flex: 1, fontSize: '14px', color: '#22c55e', fontWeight: '600' }}>✓ {resData.customerName}</span>
                      <button onClick={() => { setResData({...resData, customerId: '', customerName: '', customerPhone: '', customerEmail: ''}); setShowCustList(true); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px' }}>×</button>
                    </div>
                  ) : (
                    <>
                      <input type="text" value={custSearch} onChange={e => { setCustSearch(e.target.value); setShowCustList(true); }} onFocus={() => setShowCustList(true)} placeholder="Müşteri ara (ad, soyad, telefon)..." style={inputStyle} />
                      {showCustList && custSearch.length >= 1 && (() => {
                        const filtered = customers.filter(c => {
                          const full = normalizeTr(`${c.firstName || ''} ${c.lastName || ''}`) + ' ' + (c.phone || '');
                          return full.includes(normalizeTr(custSearch)) || (c.phone || '').includes(custSearch);
                        }).slice(0, 10);
                        return (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e3a5f', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', zIndex: 1000, maxHeight: '300px', overflowY: 'auto', marginTop: '4px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                            {filtered.length === 0 ? (
                              showQuickCust ? (
                                <div style={{ padding: '12px' }}>
                                  <input autoFocus style={{ ...inputStyle, marginBottom: '6px', fontSize: '13px' }} value={quickCustName} onChange={e => setQuickCustName(e.target.value)} placeholder="Ad Soyad *" />
                                  <input style={{ ...inputStyle, marginBottom: '8px', fontSize: '13px' }} value={quickCustPhone} onChange={e => setQuickCustPhone(e.target.value)} placeholder="Telefon (opsiyonel)" />
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => quickAddCustomer((c) => handleCustSelect(c))} disabled={quickCustBusy} style={{ flex: 1, padding: '8px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>{quickCustBusy ? '⏳...' : '✅ Ekle ve Seç'}</button>
                                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => { setShowQuickCust(false); setQuickCustName(''); setQuickCustPhone(''); }} style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '6px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>İptal</button>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ padding: '14px', textAlign: 'center' }}>
                                  <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '8px' }}>Müşteri bulunamadı</div>
                                  <button onMouseDown={(e) => { e.preventDefault(); setQuickCustName(custSearch); setShowQuickCust(true); }} style={{ padding: '7px 14px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>➕ Yeni Müşteri Ekle</button>
                                </div>
                              )
                            ) : filtered.map(c => (
                              <div key={c.id} onMouseDown={() => handleCustSelect(c)} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '13px' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <div style={{ color: '#fff', fontWeight: '600' }}>{fullNameTr(c)}</div>
                                {c.phone && <div style={{ fontSize: '11px', color: '#64748b' }}>{c.phone}</div>}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>Giriş Tarihi *</label>
                    <input type="date" value={resData.checkIn} onChange={e => {
                      const ci = e.target.value;
                      const rt = resData.roomType, concept = resData.concept || 'bb';
                      // Çıkış boşsa ya da girişten önce/aynıysa otomatik ertesi gün
                      let co = resData.checkOut;
                      if (ci && (!co || co <= ci)) {
                        const [y, m, d] = ci.split('-').map(Number);
                        const nd = new Date(y, m - 1, d + 1);
                        co = `${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}-${String(nd.getDate()).padStart(2,'0')}`;
                      }
                      const calc = calcReservationPrice(h, ci, co, rt, concept);
                      setResData({...resData, checkIn: ci, checkOut: co,
                        price: (resData.priceManual ? resData.price : calc.totalSell),
                        buyPrice: calc.totalBuy > 0 ? calc.totalBuy : resData.buyPrice,
                        currency: calc.currency || resData.currency});
                    }} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Çıkış Tarihi *</label>
                    <input type="date" value={resData.checkOut} min={resData.checkIn ? (() => { const [y,m,d]=resData.checkIn.split('-').map(Number); const nd=new Date(y,m-1,d+1); return `${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}-${String(nd.getDate()).padStart(2,'0')}`; })() : undefined} onChange={e => {
                      const co = e.target.value;
                      const rt = resData.roomType, concept = resData.concept || 'bb';
                      const calc = calcReservationPrice(h, resData.checkIn, co, rt, concept);
                      setResData({...resData, checkOut: co,
                        price: (resData.priceManual ? resData.price : calc.totalSell),
                        buyPrice: calc.totalBuy > 0 ? calc.totalBuy : resData.buyPrice,
                        currency: calc.currency || resData.currency});
                    }} style={inputStyle} />
                  </div>
                </div>

                {resData.checkIn && resData.checkOut && (() => {
                  const calc = calcReservationPrice(h, resData.checkIn, resData.checkOut, resData.roomType, resData.concept || 'bb');
                  const nights = calc.nights;
                  if (nights === 0) return null;
                  const hasMultiplePeriods = calc.periodsUsed.length > 1;
                  const hasGaps = calc.gaps.length > 0;
                  return (
                    <div style={{ padding: '10px 12px', background: hasGaps ? 'rgba(239,68,68,0.08)' : 'rgba(59,130,246,0.1)', border: `1px solid ${hasGaps ? 'rgba(239,68,68,0.25)' : 'rgba(59,130,246,0.2)'}`, borderRadius: '8px', fontSize: '12px', color: hasGaps ? '#ef4444' : '#3b82f6' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <span>🌙 {nights} gece konaklama {hasMultiplePeriods && <span style={{ fontSize: '10px', marginLeft: '4px', padding: '1px 6px', background: 'rgba(245,158,11,0.2)', color: '#f59e0b', borderRadius: '3px' }}>{calc.periodsUsed.length} dönem</span>}</span>
                        {calc.totalSell > 0 && (
                          <span style={{ color: '#94a3b8' }}>
                            Hesap: <span style={{ color: '#ef4444', fontWeight: '600' }}>Alış {calc.totalBuy.toFixed(2)}</span> / <span style={{ color: '#10b981', fontWeight: '600' }}>Satış {calc.totalSell.toFixed(2)} {calc.currency}</span>
                          </span>
                        )}
                      </div>
                      {calc.missingRate.length > 0 && !hasGaps && (
                        <div style={{ marginTop: '6px', fontSize: '11px', color: '#fbbf24' }}>
                          ⚠️ {resData.roomType} / {(resData.concept || 'bb').toUpperCase()} için {calc.missingRate.length} gecenin fiyatı dönemde tanımlı değil — bu geceler hesaba dahil edilmedi.
                        </div>
                      )}
                      {calc.overlaps.length > 0 && (
                        <div style={{ marginTop: '6px', fontSize: '11px', color: '#fbbf24' }}>
                          ⚠️ {calc.overlaps.length} gece için birden fazla fiyat dönemi çakışıyor; fiyatı tanımlı olan dönem kullanıldı. Anlaşma Fiyatları'nda eski/boş dönemi silin.
                        </div>
                      )}
                      {hasGaps && (
                        <div style={{ marginTop: '6px', fontSize: '11px', color: '#fca5a5' }}>
                          ⚠️ {calc.gaps.length} gün için fiyat dönemi yok: {calc.gaps.slice(0,3).join(', ')}{calc.gaps.length > 3 ? '...' : ''}. Bu günler hesaba dahil EDİLMEDİ. Eksik dönemi otel detayından ekleyin.
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>Oda Tipi</label>
                    <select value={resData.roomType} onChange={e => {
                      const rt = e.target.value;
                      const concept = resData.concept || 'bb';
                      const cap = roomCapacity(rt);
                      const gn = (resData.guestNames || []).slice(0, Math.max(0, cap - 1));
                      const calc = calcReservationPrice(h, resData.checkIn, resData.checkOut, rt, concept);
                      setResData({...resData, roomType: rt, guests: cap, guestNames: gn,
                        price: (resData.priceManual ? resData.price : calc.totalSell),
                        buyPrice: calc.totalBuy > 0 ? calc.totalBuy : resData.buyPrice,
                        currency: calc.currency || resData.currency});
                    }} style={selectStyle}>
                      {(appSettings?.hotelRoomTypes || ['Single', 'Double', 'Triple', 'Suite']).map(rt => (
                        <option key={rt} value={rt}>{rt}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Konsept</label>
                    <select value={resData.concept || 'bb'} onChange={e => {
                      const concept = e.target.value;
                      const rt = resData.roomType;
                      const calc = calcReservationPrice(h, resData.checkIn, resData.checkOut, rt, concept);
                      setResData({...resData, concept,
                        price: (resData.priceManual ? resData.price : calc.totalSell),
                        buyPrice: calc.totalBuy > 0 ? calc.totalBuy : resData.buyPrice,
                        currency: calc.currency || resData.currency});
                    }} style={selectStyle}>
                      {(h.enabledConcepts && h.enabledConcepts.length > 0 ? h.enabledConcepts : MEAL_CONCEPTS).map(c => (
                        <option key={c} value={c}>
                          {`${MEAL_TR[c] || c.toUpperCase()} (${MEAL_CODE[c] || c.toUpperCase()})`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Kişi Sayısı</label>
                    <input type="number" min="1" value={resData.guests} onChange={e => setResData({...resData, guests: parseInt(e.target.value) || 1})} style={inputStyle} />
                  </div>
                </div>

                {(() => {
                  const cap = roomCapacity(resData.roomType);
                  if (cap <= 1) return null;
                  const extra = cap - 1;
                  return (
                    <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: '10px', padding: '12px' }}>
                      <div style={{ fontSize: '12px', color: '#3b82f6', fontWeight: '600', marginBottom: '8px' }}>👥 Odadaki diğer kişiler ({resData.roomType} — {cap} kişilik) · <span style={{ color: '#64748b', fontWeight: '400' }}>müşteri listesinden seçin veya elle yazın</span></div>
                      <div style={{ display: 'grid', gridTemplateColumns: extra > 1 ? '1fr 1fr' : '1fr', gap: '8px' }}>
                        {Array.from({ length: extra }).map((_, idx) => (
                          <CustomerNameInput key={idx} customers={customers} placeholder={`${idx + 2}. Kişi — ara / seç`} value={(resData.guestNames || [])[idx] || ''} style={inputStyle}
                            onChange={v => setResData(rd => { const gn = [...(rd.guestNames || [])]; gn[idx] = v; return { ...rd, guestNames: gn }; })} />
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px', padding: '14px' }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#f59e0b' }}>💰 Ödeme Bilgileri</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label style={{...labelStyle, color: '#ef4444'}}>Alış Fiyatı (otele)</label>
                      <input type="number" value={resData.buyPrice || 0} onChange={e => setResData({...resData, buyPrice: parseFloat(e.target.value) || 0})} style={{...inputStyle, border: '1px solid rgba(239,68,68,0.25)'}} />
                    </div>
                    <div>
                      <label style={{...labelStyle, color: '#10b981'}}>Satış (müşteriye)</label>
                      <input type="number" value={resData.price} onChange={e => setResData({...resData, price: parseFloat(e.target.value) || 0, priceManual: true})} style={{...inputStyle, border: '1px solid rgba(16,185,129,0.25)'}} />
                      {resData.priceManual && (() => {
                        const c = calcReservationPrice(h, resData.checkIn, resData.checkOut, resData.roomType, resData.concept || 'bb');
                        if (c.totalSell > 0 && Math.abs((parseFloat(resData.price) || 0) - c.totalSell) > 0.5) {
                          return <button type="button" onClick={() => setResData({...resData, price: c.totalSell, priceManual: false})} style={{ marginTop: '4px', width: '100%', padding: '4px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px' }}>↺ Hesaba dön ({c.totalSell.toFixed(0)} {c.currency})</button>;
                        }
                        return null;
                      })()}
                    </div>
                    <div>
                      <label style={labelStyle}>Para</label>
                      <select value={resData.currency} onChange={e => setResData({...resData, currency: e.target.value})} style={selectStyle}>
                        <option value="€">€</option>
                        <option value="$">$</option>
                        <option value="£">£</option>
                        <option value="₺">₺</option>
                      </select>
                    </div>
                  </div>
                  {(() => {
                    const buy = parseFloat(resData.buyPrice) || 0;
                    const sell = parseFloat(resData.price) || 0;
                    const profit = sell - buy;
                    const margin = sell > 0 ? ((profit / sell) * 100) : 0;
                    if (buy === 0 && sell === 0) return null;
                    return (
                      <div style={{ padding: '8px 12px', background: profit >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: '6px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '11px' }}>
                        <span style={{ color: '#94a3b8' }}>Kâr/Zarar:</span>
                        <span style={{ color: profit >= 0 ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: '13px' }}>
                          {profit >= 0 ? '+' : ''}{profit.toFixed(2)} {resData.currency}
                          {sell > 0 && <span style={{ marginLeft: '6px', fontSize: '11px', opacity: 0.8 }}>({margin.toFixed(1)}%)</span>}
                        </span>
                      </div>
                    );
                  })()}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[1, 2, 3].map(i => (
                      <div key={i}>
                        <label style={labelStyle}>{i}. Ödeme</label>
                        <input type="number" value={resData[`payment${i}`]} onChange={e => setResData({...resData, [`payment${i}`]: parseFloat(e.target.value) || 0})} style={inputStyle} />
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: '10px', fontSize: '12px', color: '#94a3b8' }}>
                    Toplam Ödenen: <span style={{ color: '#10b981', fontWeight: '700' }}>{((parseFloat(resData.payment1) || 0) + (parseFloat(resData.payment2) || 0) + (parseFloat(resData.payment3) || 0)).toFixed(2)} {resData.currency}</span>
                  </div>
                </div>

                {/* ✈️ Aynı anda grup uçuşuna ekle — isimler bir daha yazılmaz */}
                {(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  const near = (d) => (a, b) => Math.abs(new Date(a.date) - new Date(d || today)) - Math.abs(new Date(b.date) - new Date(d || today));
                  const opts = (dir, d) => (groupFlights || []).filter(f => f.date >= today && (!f.direction || f.direction === dir)).sort(near(d));
                  const lab = (f) => { const a = (f.reservations || []).filter(x => !x.cancelled).length; return `${formatDate(f.date)} · ${f.airline || ''} ${f.flightNo || ''} · ${f.from}→${f.to} · ${a}/${f.capacity || '∞'}${f.date === resData.checkIn || f.date === resData.checkOut ? ' ⭐' : ''}`; };
                  // Alış (opsiyonel) + satış kutuları — rezervasyon para biriminde
                  const perPax = (k) => /^flight/.test(k); // uçak bileti kişi başı
                  const money = (k) => [['Buy', perPax(k) ? 'Alış/kişi' : 'Alış', 'Bizim maliyetimiz (opsiyonel — girilirse kâra katılır)', 'rgba(239,68,68,0.35)'], ['Price', perPax(k) ? 'Satış/kişi' : 'Satış', perPax(k) ? 'Kişi başı bilet fiyatı — odadaki kişi sayısıyla çarpılır, proformaya ayrı satır girer' : 'Müşteriye satış — proformaya ayrı satır olarak girer', 'rgba(16,185,129,0.35)']].map(([sf, lb, tt, bc]) => (
                    <div key={sf} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                      <input type="number" inputMode="decimal" min="0" value={resData[k + sf] || ''} onChange={e => setResData({ ...resData, [k + sf]: e.target.value })}
                        placeholder={lb} title={tt} style={{ ...inputStyle, paddingRight: '24px', borderColor: bc }} />
                      <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: '#94a3b8', pointerEvents: 'none' }}>{resData.currency || '€'}</span>
                    </div>));
                  const row = (k, ph) => (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <input autoFocus={!resData[k]} value={resData[k] || ''} onChange={e => setResData({ ...resData, [k]: e.target.value })} placeholder={ph}
                        style={{ ...inputStyle, flex: '1 1 100%', minWidth: 0 }} />
                      {money(k)}
                      {perPax(k) && (parseFloat(resData[k + 'Price']) || 0) > 0 && <div style={{ flexBasis: '100%', fontSize: '11px', color: '#94a3b8' }}>{resPax(resData)} kişi × {parseFloat(resData[k + 'Price']).toLocaleString('tr-TR')} = <b style={{ color: '#34d399' }}>{(resPax(resData) * parseFloat(resData[k + 'Price'])).toLocaleString('tr-TR')} {resData.currency || '€'}</b></div>}
                    </div>);
                  const sel = (key, dir, d) => (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                      <select value={resFlights[key]} onChange={e => setResFlights(x => ({ ...x, [key]: e.target.value }))} style={inputStyle}>
                        <option value="">{dir}: Uçuş yok</option>
                        <option value="M">{dir}: ✍️ Münferit (elle yaz)</option>
                        {opts(dir, d).map(f => <option key={f.id} value={f.id}>{lab(f)}</option>)}
                      </select>
                      {resFlights[key] === 'M' && row(key === 'out' ? 'flightOut' : 'flightRet', dir === 'Gidiş' ? 'örn: 14.01 TK1523 İST→FRA 08:40' : 'örn: 18.01 PC1022 FRA→SAW 19:15')}
                    </div>);
                  // Transfer: yok / elle yaz / Transferler bölümündeki kayıtlı transfer (tarihi geçmemiş, giriş-çıkış tarihine yakın olan üstte)
                  const tOpts = (d) => (transfers || []).filter(t => !t.date || t.date >= today).sort((a, b) => (a.date ? Math.abs(new Date(a.date) - new Date(d || today)) : 9e15) - (b.date ? Math.abs(new Date(b.date) - new Date(d || today)) : 9e15));
                  const tLab = (t) => { const u = (t.reservations || []).filter(x => !x.cancelled).reduce((n, x) => n + (parseInt(x.pax) || 1), 0); return `${t.date ? formatDate(t.date) + ' · ' : ''}${t.time ? t.time + ' · ' : ''}${t.fromLoc}→${t.toLoc} · ${t.vehicleType || ''} · ${u}/${t.capacity || '∞'}${t.sellPrice ? ` · ${t.sellPrice}${t.currency || '€'}/kişi` : ''}${t.date && (t.date === resData.checkIn || t.date === resData.checkOut) ? ' ⭐' : ''}`; };
                  const trf = (k, sk, dir, ph, d) => (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                      <select value={resData[k + 'On'] ? 'M' : (resTrf[sk] || '')} onChange={e => { const v = e.target.value; setResData({ ...resData, [k + 'On']: v === 'M' }); setResTrf(x => ({ ...x, [sk]: v && v !== 'M' ? v : '' })); }} style={inputStyle}>
                        <option value="">{dir}: Transfer yok</option>
                        <option value="M">{dir}: ✍️ Elle yaz</option>
                        {tOpts(d).map(t => <option key={t.id} value={String(t.id)}>🚐 {tLab(t)}</option>)}
                      </select>
                      {resData[k + 'On'] && row(k, ph)}
                      {resTrf[sk] && <div style={{ fontSize: '11px', color: '#94a3b8' }}>Kaydedince odadaki {1 + (resData.guestNames || []).filter(x => x && x.trim()).length} kişi bu transfere eklenir; fiyat transferin kişi başı fiyatından, proformaya girer.</div>}
                    </div>);
                  const n = 1 + (resData.guestNames || []).filter(x => x && x.trim()).length;
                  // 👥 Kişi bazında uçuş: her kişi kendi gidiş/dönüşünü seçer (grup uçuşu ya da münferit; münferitte bilet fiyatı o kişiye ait)
                  const names = resNames(resData);
                  const split = !!resData.flightSplit && names.length > 1;
                  const pfOf = (nm) => (resData.personFlights || []).find(x => normalizeTr(x.name) === normalizeTr(nm)) || { name: nm };
                  const setPf = (nm, patch) => setResData(rd => { const list = [...(rd.personFlights || [])]; const i = list.findIndex(x => normalizeTr(x.name) === normalizeTr(nm));
                    if (i >= 0) list[i] = { ...list[i], ...patch, name: nm }; else list.push({ name: nm, ...patch }); return { ...rd, personFlights: list }; });
                  const pMoney = (nm, d) => [['Buy', 'Alış', 'rgba(239,68,68,0.35)'], ['Price', 'Satış', 'rgba(16,185,129,0.35)']].map(([sf, lb, bc]) => (
                    <div key={sf} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                      <input type="number" inputMode="decimal" min="0" value={pfOf(nm)[d + sf] || ''} onChange={e => setPf(nm, { [d + sf]: e.target.value })} placeholder={lb}
                        title={sf === 'Buy' ? 'Bizim maliyetimiz (opsiyonel)' : 'Bu kişinin bilet fiyatı — proformaya ayrı satır girer'} style={{ ...inputStyle, paddingRight: '24px', borderColor: bc }} />
                      <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: '#94a3b8', pointerEvents: 'none' }}>{resData.currency || '€'}</span>
                    </div>));
                  const pSel = (nm, key, dir, d) => { const k = normalizeTr(nm), v = splitSel[k]?.[key] || ''; return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                      <select value={v} onChange={e => { const val = e.target.value; setSplitSel(x => ({ ...x, [k]: { ...(x[k] || {}), [key]: val } })); }} style={inputStyle}>
                        <option value="">{dir}: Uçuş yok</option>
                        <option value="M">{dir}: ✍️ Münferit (elle yaz)</option>
                        {opts(dir, d).map(f => <option key={f.id} value={f.id}>{lab(f)}</option>)}
                      </select>
                      {v === 'M' && <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <input value={pfOf(nm)[key + 'Text'] || ''} onChange={e => setPf(nm, { [key + 'Text']: e.target.value })} placeholder={dir === 'Gidiş' ? 'örn: 14.01 TK1523 İST→FRA 08:40' : 'örn: 18.01 PC1022 FRA→SAW 19:15'} style={{ ...inputStyle, flex: '1 1 100%', minWidth: 0 }} />
                        {pMoney(nm, key)}
                      </div>}
                    </div>); };
                  const toggleSplit = (on) => {
                    if (on) { // odanın mevcut seçimi herkese kopyalanır; münferit metin/fiyat da
                      const sel = {}; names.forEach(nm => { sel[normalizeTr(nm)] = { out: resFlights.out, ret: resFlights.ret }; });
                      setSplitSel(sel);
                      setResData(rd => ({ ...rd, flightSplit: true, personFlights: names.map(nm => ({ ...pfOf(nm), name: nm,
                        ...(resFlights.out === 'M' && !pfOf(nm).outText ? { outText: rd.flightOut || '', outBuy: rd.flightOutBuy || '', outPrice: rd.flightOutPrice || '' } : {}),
                        ...(resFlights.ret === 'M' && !pfOf(nm).retText ? { retText: rd.flightRet || '', retBuy: rd.flightRetBuy || '', retPrice: rd.flightRetPrice || '' } : {}) })) }));
                    } else setResData(rd => ({ ...rd, flightSplit: false }));
                  };
                  const anyGroup = split ? names.some(nm => ['out', 'ret'].some(d => { const v = splitSel[normalizeTr(nm)]?.[d]; return v && v !== 'M'; }))
                    : ((resFlights.out && resFlights.out !== 'M') || (resFlights.ret && resFlights.ret !== 'M'));
                  return (
                    <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)' }}>
                      <label style={labelStyle}>✈️ Uçuş <span style={{ fontSize: '10px', color: '#64748b' }}>(opsiyonel — grup uçuşu seçilirse {split ? 'o kişi' : `odadaki ${n} kişi`} eklenir · ⭐ giriş/çıkış tarihine uyan · münferit ise elle yazın)</span></label>
                      {!opts('Gidiş').length && !opts('Dönüş').length && <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>İleri tarihli grup uçuşu yok — <b>Grup Uçuşları</b> sekmesinden ekleyebilir ya da münferit uçuşu elle yazabilirsiniz.</div>}
                      {names.length > 1 && <label style={{ display: 'flex', gap: '6px', alignItems: 'center', margin: '2px 0 8px', fontSize: '12px', color: split ? '#60a5fa' : '#94a3b8', cursor: 'pointer' }}>
                        <input type="checkbox" checked={split} onChange={e => toggleSplit(e.target.checked)} /> 👥 Uçuşları kişi bazında ayır <span style={{ fontSize: '10px', color: '#64748b' }}>(odadakiler farklı uçuşlarla gidip dönüyorsa)</span></label>}
                      {split ? names.map(nm => (
                        <div key={normalizeTr(nm)} style={{ marginBottom: '8px', padding: '8px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#e8f1f8', marginBottom: '6px' }}>👤 {nm}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px' }}>{pSel(nm, 'out', 'Gidiş', resData.checkIn)}{pSel(nm, 'ret', 'Dönüş', resData.checkOut)}</div>
                        </div>))
                      : <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px' }}>{sel('out', 'Gidiş', resData.checkIn)}{sel('ret', 'Dönüş', resData.checkOut)}</div>}
                      <label style={{ ...labelStyle, marginTop: '12px' }}>🚐 Transfer <span style={{ fontSize: '10px', color: '#64748b' }}>(opsiyonel — gidiş ve dönüş ayrı · Transferler bölümünden seçin ya da elle yazın)</span></label>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px' }}>{trf('transferOut', 'out', 'Gidiş', 'Havalimanı → Otel (araç, saat…)', resData.checkIn)}{trf('transferRet', 'ret', 'Dönüş', 'Otel → Havalimanı (araç, saat…)', resData.checkOut)}</div>
                      {!split && anyGroup && resPax(resData) > n && (
                        <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', color: '#fbbf24', fontSize: '12px', lineHeight: 1.5 }}>
                          ⚠️ {resData.roomType || 'Oda'} odada {resPax(resData)} kişi var ama {n} isim yazılı — grup uçuşuna yalnız <b>{n} bilet</b> eklenir (biletler isimle tutulur).
                          Yukarıdaki oda arkadaşı kutusuna {resPax(resData) - n === 1 ? 'diğer kişinin' : 'diğer kişilerin'} adını yazın.
                        </div>
                      )}
                      {anyGroup && <label style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '8px', fontSize: '12px', color: '#94a3b8' }}><input type="checkbox" checked={resFlights.pkg} onChange={e => setResFlights(x => ({ ...x, pkg: e.target.checked }))} /> Otel + uçuşu paket yap (tek proforma)</label>}
                    </div>);
                })()}

                <div>
                  <label style={labelStyle}>🏷️ Etiket <span style={{ fontSize: '10px', color: '#64748b' }}>(opsiyonel — VIP, Acil, Tekrar müşteri vs.)</span></label>
                  <input type="text" value={resData.tag || ''} onChange={e => setResData({...resData, tag: e.target.value})} placeholder="örn: VIP, Acil, Honeymoon, Kurumsal..." style={inputStyle} />
                </div>

                <div>
                  <label style={labelStyle}>Notlar</label>
                  <textarea value={resData.notes} onChange={e => setResData({...resData, notes: e.target.value})} placeholder="Özel notlar..." style={{...inputStyle, minHeight: '60px', resize: 'vertical'}} />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                  <button onClick={saveReservation} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                    {editingRes ? '💾 Güncelle' : '✅ Rezervasyon Ekle'}
                  </button>
                  <button onClick={() => { setShowResForm(false); setEditingRes(null); }} style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer' }}>İptal</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// 💳 Havayoluna ödemeler (ön ödeme / kalan): [{ key, label, amount, date, paid, days, color, text }] — days: bugünden kaç gün sonra (geçmişse eksi)
export const airlinePayments = (fl) => {
  const ap = fl?.airlinePay || {}, cur = fl?.currency || '€';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return [['dep', 'Ön ödeme'], ['bal', 'Kalan ödeme']].map(([k, label]) => {
    const amount = parseFloat(ap[k + 'Amount']) || 0, date = ap[k + 'Date'] || '', paid = !!ap[k + 'Paid'];
    if (!amount && !date) return null;
    const days = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Math.round((new Date(date + 'T00:00:00') - today) / 86400000) : null;
    const color = paid ? '#10b981' : days == null ? '#94a3b8' : days < 0 ? '#ef4444' : days <= 7 ? '#ef4444' : days <= 30 ? '#f59e0b' : '#34d399';
    const when = paid ? '✓ ödendi' : days == null ? 'tarih yok' : days < 0 ? `${-days} gün GECİKTİ` : days === 0 ? 'BUGÜN' : `${days} gün kaldı`;
    return { key: k, label, amount, date, paid, days, color, text: `${label}: ${amount ? amount.toLocaleString('tr-TR') + ' ' + cur : '—'}${date ? ' · ' + formatDate(date) : ''} · ${when}` };
  }).filter(Boolean);
};

// 👥 Tekrar eden yolcu: aynı kişi listede birden fazla (aynı müşteri kaydı ya da aynı isim — harf/büyüklük ve kelime sırası farkı yok sayılır).
// Döner: Map(rezervasyon id → aynı kişinin kaç kaydı var)
export const dupPassengers = (list) => {
  const nameKey = (r) => normalizeTr(r.customerName).split(/\s+/).filter(Boolean).sort().join(' ');
  const groups = new Map();
  const add = (k, r) => { if (!k) return; if (!groups.has(k)) groups.set(k, new Set()); groups.get(k).add(r.id); };
  (list || []).forEach(r => { add('n:' + nameKey(r), r); if (r.customerId !== undefined && r.customerId !== null && r.customerId !== '') add('c:' + r.customerId, r); });
  const out = new Map();
  groups.forEach((ids, k) => { if (k.length > 2 && ids.size > 1) ids.forEach(id => out.set(id, Math.max(out.get(id) || 0, ids.size))); });
  return out;
};

// FİYAT DÖNEMİ MODAL (Otel için)
export function PricePeriodModal({ existing, roomTypes, concepts, onClose, onSave, showToast }) {
  const [period, setPeriod] = useState({
    startDate: existing?.startDate || '',
    endDate: existing?.endDate || '',
    currency: existing?.currency || '€',
    rates: existing?.rates || {}
  });

  const inputStyle = { width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' };
  const labelStyle = { fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: '500' };

  const updateRate = (roomType, concept, type, val) => {
    setPeriod({
      ...period,
      rates: {
        ...period.rates,
        [roomType]: {
          ...(period.rates[roomType] || {}),
          [concept]: {
            ...(period.rates[roomType]?.[concept] || {}),
            [type]: parseFloat(val) || 0
          }
        }
      }
    });
  };

  // Eski format desteği (sayı) - okurken yeniye çevir
  const getRate = (roomType, concept, type) => {
    const val = period.rates?.[roomType]?.[concept];
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return type === 'sell' ? val : 0; // eski sayı → satış sayılır
    return val?.[type] || 0;
  };

  const dayCount = (() => {
    if (!period.startDate || !period.endDate) return 0;
    const d1 = new Date(period.startDate), d2 = new Date(period.endDate);
    if (isNaN(d1) || isNaN(d2)) return 0;
    return Math.max(1, Math.round((d2 - d1) / 86400000));
  })();

  const handleSave = () => {
    if (!period.startDate || !period.endDate) { showToast?.('Tarih aralığı zorunlu', 'error'); return; }
    if (!isSaneDate(period.startDate) || !isSaneDate(period.endDate)) { showToast?.('Tarih hatalı görünüyor (yıl kutusuna tıklayıp tekrar yazın)', 'error'); return; }
    if (new Date(period.endDate) < new Date(period.startDate)) { showToast?.('Bitiş tarihi başlangıçtan önce olamaz', 'error'); return; }
    onSave(period);
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px', overflowY: 'auto' }}>
      <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
      <div onClick={e => e.stopPropagation()} className="hide-scrollbar" style={{ background: 'linear-gradient(135deg, #0c1929, #1a3a5c)', borderRadius: '16px', padding: '24px', maxWidth: '700px', width: '100%', maxHeight: '90vh', overflowY: 'auto', scrollbarWidth: 'none' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: '17px' }}>{existing ? '✏️ Fiyat Dönemini Düzenle' : '➕ Yeni Fiyat Dönemi'}</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Başlangıç *</label>
              <input type="date" value={period.startDate} onChange={e => setPeriod({...period, startDate: e.target.value})} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Bitiş *</label>
              <input type="date" value={period.endDate} onChange={e => setPeriod({...period, endDate: e.target.value})} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Para</label>
              <select value={period.currency} onChange={e => setPeriod({...period, currency: e.target.value})} style={inputStyle}>
                <option value="€">€</option>
                <option value="$">$</option>
                <option value="£">£</option>
                <option value="₺">₺</option>
              </select>
            </div>
          </div>

          {dayCount > 0 && (
            <div style={{ padding: '8px 12px', background: 'rgba(59,130,246,0.1)', borderRadius: '6px', fontSize: '12px', color: '#3b82f6' }}>
              🌙 {dayCount} gece — başlangıç tarihinden bitiş (çıkış) tarihine kadar. Örn. 13 → 14 Ekim = 13 Ekim gecesi.
            </div>
          )}

          {concepts.length === 0 ? (
            <div style={{ padding: '14px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', fontSize: '12px', color: '#ef4444' }}>
              ⚠️ Önce konsept seçin (RO/BB/HB/FB/AI/UAI)
            </div>
          ) : roomTypes.length === 0 ? (
            <div style={{ padding: '14px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', fontSize: '12px', color: '#ef4444' }}>
              ⚠️ Ayarlar → Oteller bölümünden oda tipleri ekleyin
            </div>
          ) : (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '14px' }}>
              <h4 style={{ margin: '0 0 4px', fontSize: '13px', color: '#f59e0b' }}>💰 Fiyatlar (oda başı, gecelik)</h4>
              <p style={{ margin: '0 0 10px', fontSize: '10px', color: '#64748b' }}>
                <span style={{ color: '#ef4444' }}>● Alış</span> = otele ödediğin · <span style={{ color: '#10b981' }}>● Satış</span> = müşteriden aldığın
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th rowSpan="2" style={{ padding: '8px', textAlign: 'left', color: '#64748b', fontWeight: '600', fontSize: '11px', verticalAlign: 'bottom' }}>Oda Tipi</th>
                      {concepts.map(c => (
                        <th key={c} colSpan="2" style={{ padding: '4px 8px', textAlign: 'center', color: '#f59e0b', fontWeight: '600', fontSize: '11px', borderLeft: '1px solid rgba(255,255,255,0.06)' }}>{c.toUpperCase()}</th>
                      ))}
                    </tr>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {concepts.map(c => (
                        <Fragment key={c}>
                          <th style={{ padding: '4px 6px', textAlign: 'center', color: '#ef4444', fontWeight: '500', fontSize: '10px', borderLeft: '1px solid rgba(255,255,255,0.06)' }}>Alış</th>
                          <th style={{ padding: '4px 6px', textAlign: 'center', color: '#10b981', fontWeight: '500', fontSize: '10px' }}>Satış</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roomTypes.map(rt => (
                      <tr key={rt} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '8px', fontWeight: '600', color: '#e2e8f0' }}>{rt}</td>
                        {concepts.map(c => (
                          <Fragment key={c}>
                            <td style={{ padding: '3px', borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
                              <input type="number" min="0"
                                value={getRate(rt, c, 'buy')}
                                onChange={e => updateRate(rt, c, 'buy', e.target.value)}
                                style={{...inputStyle, padding: '5px 6px', fontSize: '11px', border: '1px solid rgba(239,68,68,0.25)'}} />
                            </td>
                            <td style={{ padding: '3px' }}>
                              <input type="number" min="0"
                                value={getRate(rt, c, 'sell')}
                                onChange={e => updateRate(rt, c, 'sell', e.target.value)}
                                style={{...inputStyle, padding: '5px 6px', fontSize: '11px', border: '1px solid rgba(16,185,129,0.25)'}} />
                            </td>
                          </Fragment>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
            <button onClick={handleSave} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
              {existing ? '💾 Güncelle' : '✅ Dönemi Kaydet'}
            </button>
            <button onClick={onClose} style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8', cursor: 'pointer' }}>İptal</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// O gecenin kontenjanı: gece × oda tipi tablosu (roomAllotment); yoksa eski sabit sayı (roomCounts)
export const allotOf = (h, date, type) => {
  const k = roomKey(type);
  const day = h?.roomAllotment?.[date];
  if (day) { const e = Object.entries(day).find(([n]) => roomKey(n) === k); if (e) return parseInt(e[1], 10) || 0; }
  const e2 = Object.entries(h?.roomCounts || {}).find(([n]) => roomKey(n) === k);
  return e2 ? (parseInt(e2[1], 10) || 0) : 0;
};

// Gece × oda tipi dolu oda sayısı: { roomKey: { 'YYYY-MM-DD': n } } (1 rezervasyon = 1 oda; iptaller sayılmaz)
export const hotelNightly = (h) => {
  const per = {};
  (h?.reservations || []).filter(r => !r.cancelled).forEach(r => {
    const k = roomKey(r.roomType);
    const a = /^\d{4}-\d{2}-\d{2}/.test(String(r.checkIn || '')) ? new Date(`${String(r.checkIn).slice(0, 10)}T12:00:00Z`) : null;
    const b = /^\d{4}-\d{2}-\d{2}/.test(String(r.checkOut || '')) ? new Date(`${String(r.checkOut).slice(0, 10)}T12:00:00Z`) : null;
    if (!k || !a || !b) return;
    for (let d = new Date(a), i = 0; d < b && i < 400; d.setUTCDate(d.getUTCDate() + 1), i++) {
      const key = d.toISOString().slice(0, 10);
      (per[k] = per[k] || {})[key] = (per[k][key] || 0) + 1;
    }
  });
  return per;
};

// Otelin oda tipleri = Ayarlar'daki otel oda tipleri + fiyat listesindeki + kontenjanı girilmiş + rezervasyonlardaki
// (fiyat tablosuyla aynı liste; "Suit Twin" ayrı tip, "Twin"e sayılmaz)
export const hotelRoomKinds = (h, baseTypes = []) => {
  const out = [], seen = new Set();
  const add = (t) => { const k = roomKey(t); if (t && k && !seen.has(k)) { seen.add(k); out.push(String(t).trim()); } };
  (baseTypes || []).forEach(add);
  (h?.priceList || []).forEach(p => Object.keys(p?.rates || {}).forEach(add));
  Object.keys(h?.roomCounts || {}).forEach(add);
  Object.values(h?.roomAllotment || {}).forEach(day => Object.keys(day || {}).forEach(add));
  (h?.reservations || []).forEach(r => add(r.roomType));
  return out;
};

export const isYmd = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ''));

export const nightsBetween = (from, to) => { // from..to dahil (son gece)
  const out = []; if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return out;
  for (let d = new Date(`${from}T12:00:00Z`), e = new Date(`${to}T12:00:00Z`), i = 0; d <= e && i < 120; d.setUTCDate(d.getUTCDate() + 1), i++) out.push(d.toISOString().slice(0, 10));
  return out;
};

// 📄 Otel proformasını AI ile oku: gece × oda tipi kontenjan + ödeme takvimi + iptal/iade koşulları.
// Metinli PDF'te metin tarayıcıda çıkarılıp gönderilir (hızlı, ucuz); taranmış PDF / görselde dosyanın kendisi gider.
export const readHotelProforma = async (file, roomTypes) => {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  let text = '';
  if (isPdf) { try { text = (await pdfFileText(file)).replace(/\s+/g, ' ').trim(); } catch { text = ''; } }
  const toB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
  const prompt = `Bu bir otel proforması / grup rezervasyon teyidi. SADECE geçerli JSON döndür, başka metin yazma:
{"hotelName":"","proformaNo":"","currency":"EUR","total":0,
 "nights":[{"date":"YYYY-MM-DD","rooms":[{"type":"","raw":"","count":0}]}],
 "releaseDate":"YYYY-MM-DD veya boş",
 "payments":[{"date":"YYYY-MM-DD","amount":0,"note":""}],
 "cancellation":[{"date":"YYYY-MM-DD","text":""}],
 "notes":""}
Kurallar:
- nights: her gece (konaklama tarihi) ve o gece her oda tipinden kaç oda. "20 x Bed & Breakfast TWIN" → count 20, raw "TWIN".
- type: raw oda tipini şu listeden en uygun olanla eşleştir: ${JSON.stringify(roomTypes)}. Uygun yoksa raw'ı aynen yaz. (SUITE / Junior Suite → listede "Suit" geçen tip.)
- payments: ödeme takvimi (depozito, ön ödeme, kalan bakiye). Tutar yoksa yüzdeyi note'a yaz ("%30 depozito"). Göreli tarihleri ("varıştan 30 gün önce") ilk geceye göre gerçek tarihe çevir.
- cancellation: iptal / iade / no-show koşulları, tarih sırasıyla. text Türkçe ve kısa olsun: örn. "Bu tarihe kadar ücretsiz iptal", "%50 ceza", "İade yok". Göreli tarihleri gerçek tarihe çevir.
- releaseDate: opsiyon / release / kontenjan iade son tarihi varsa.
- total: KDV ve şehir vergisi dahil genel toplam. Sayılar nokta ondalıklı (84566.00).
- Bulamadığın alanı boş bırak; tahmin etme.`;
  const content = text.length > 200
    ? [{ type: 'text', text: `PROFORMA METNİ (${file.name || 'proforma'}):\n${text.slice(0, 60000)}\n\n${prompt}` }]
    : [isPdf ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await toB64(file) } }
             : { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: await toB64(file) } },
       { type: 'text', text: prompt }];
  const resp = await claudeRequest({
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 2000, output_config: { effort: 'low' }, messages: [{ role: 'user', content }] }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error?.message || data?.error || `API ${resp.status}`);
  if (data.stop_reason === 'refusal') throw new Error('AI bu belgeyi okumayı reddetti');
  const out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI yanıtı okunamadı');
  return JSON.parse(m[0]);
};

// Müşteriden alınacak toplam: otel + elle eklenen kalemler (ödendi/kalan bununla hesaplanır)
export const resGrand = (r) => (parseFloat(r?.price) || 0) + resExtraSum(r);

// Kâr: otel + alışı girilmiş kalemler (alışı boş kalemin kârı bilinmiyor → katılmaz)
export const resProfit = (r) => (parseFloat(r?.price) || 0) - (parseFloat(r?.buyPrice) || 0) + resExtras(r).filter(x => x.buy > 0).reduce((t, x) => t + x.price - x.buy, 0);

// 🛏️ Otel oda kontenjanı: Single / Double / Twin
export const roomKey = (rt) => normalizeTr(rt).replace(/\s+/g, ' ').trim();
