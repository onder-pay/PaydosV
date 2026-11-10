import { useState, useRef, useEffect, useCallback, useMemo, Fragment, Component } from 'react';
// Firebase + localStorage CRM
import { preloadHeavy } from './lib/heavy';
import { db, auth } from './lib/firebase';
import { collection, doc, setDoc, getDoc, getDocs, writeBatch, deleteDoc, onSnapshot, deleteField, serverTimestamp } from 'firebase/firestore';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, reauthenticateWithCredential, EmailAuthProvider, updatePassword } from 'firebase/auth';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { normalizeTr, trUpper, normEmail } from './lib/turkish';
import { generateUniqueId } from './lib/format';

import { labelStyle, inputStyle, Toast } from './components/ui';

import { TavsiyelerModal } from './components/shared';
import { BankInfoModule } from './modules/BankInfo';
import { HotelsModule } from './modules/Hotels';
import { ToursModule } from './modules/Tours';
import { CustomerModule } from './modules/Customers';
import { VisaModule } from './modules/Visa';
import { QuotesModule } from './modules/Quotes';
import { SettingsModule } from './modules/Settings';
import { DS160Module } from './modules/DS160';
import { AgenciesModule } from './modules/Agencies';
import { DashboardModule } from './modules/Dashboard';
import { LinkDuyuruModule, MusteriLinkiModule, TurLinkiModule } from './modules/LinkDuyuru';
import { DuyurularModule } from './modules/Duyurular';
import { BildirimlerModule } from './modules/Bildirimler';
import { CreditCardsModule } from './modules/CreditCards';
import { ActivityLogModule } from './modules/ActivityLog';


const defaultCustomers = [];
const defaultUsers = [{ id: 1, email: 'onder@paydostur.com', password: '', name: 'Önder', role: 'admin' }];

const visaStatuses = ['Evrak Topluyor', 'Evrak Tamamlandı', 'Evraklar Gönderildi', 'E-posta Gönderildi', 'Atama Bekliyor', 'Randevu Bekliyor', 'Başvuru Yapıldı', 'Sonuç Bekliyor', 'Müşteri İptal Etti'];

// Form Error Component

function LoginScreen({ onLogin, users }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    if (!email) { setError('E-posta adresi gerekli'); return; }
    if (!password) { setError('Şifre gerekli'); return; }
    setLoading(true);
    try {
      // Firebase Auth ile giriş (Firestore Rules güvenliği için)
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      // users koleksiyonundan profil/rol bul — giriş ekranındaki liste sadece yerel önbellek
      // (yeni cihazda boş); bu yüzden girişten sonra Firestore'dan okunur. Yoksa temel profil.
      const mail = normEmail(email);
      let profile = null;
      try {
        const snap = await getDocs(collection(db, 'users'));
        const d = snap.docs.find(x => normEmail(x.data().email) === mail);
        if (d) profile = { ...d.data(), _docId: d.id };
      } catch (e) { console.warn('Kullanıcı profili okunamadı:', e.message); }
      if (!profile) profile = users.find(u => normEmail(u.email) === mail) || null;
      if (profile) { const { password: _pw, ...clean } = profile; profile = clean; }
      onLogin(profile || { id: cred.user.uid, email: cred.user.email, name: cred.user.email, role: 'user' });
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        setError('E-posta veya şifre hatalı');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Çok fazla deneme. Biraz bekleyin.');
      } else {
        setError('Giriş hatası: ' + (err.code || err.message));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0c1929 0%, #1a3a5c 50%, #0d2137 100%)', fontFamily: "'Segoe UI', sans-serif", padding: '20px' }}>
      <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '40px', width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <img src="/icons/logo.png" alt="Paydos" style={{ width: '88px', height: '88px', borderRadius: '50%', display: 'block', margin: '0 auto 12px' }} />
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

const newLinkToken = () => {
  const abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => abc[b % abc.length]).join('');
};

// VİZE MODÜLÜ

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, info: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { this.setState({ info }); console.error('YAKALANAN HATA:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '24px', margin: '20px', background: '#1a0e0e', border: '2px solid #ef4444', borderRadius: '12px', color: '#fca5a5', fontFamily: 'monospace', fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          <h2 style={{ color: '#ef4444', margin: '0 0 12px' }}>⚠️ Hata Yakalandı (Debug)</h2>
          <div style={{ marginBottom: '12px', color: '#fff' }}><b>Mesaj:</b> {String(this.state.error?.message || this.state.error)}</div>
          <div style={{ marginBottom: '12px' }}><b>Bileşen izi (hangi bileşende patladı):</b>
            <div style={{ background: '#000', padding: '10px', borderRadius: '6px', marginTop: '6px', maxHeight: '300px', overflow: 'auto' }}>{this.state.info?.componentStack || '(yok)'}</div>
          </div>
          <div><b>Hata yığını:</b>
            <div style={{ background: '#000', padding: '10px', borderRadius: '6px', marginTop: '6px', maxHeight: '200px', overflow: 'auto' }}>{this.state.error?.stack || '(yok)'}</div>
          </div>
          <button onClick={() => window.location.reload()} style={{ marginTop: '14px', padding: '10px 20px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>🔄 Sayfayı Yenile</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Menü sırasıyla aynı olmalı (menüde ⌘1-9 olarak gösterilir)
const SHORTCUT_MODULES = [['dashboard', 'Dashboard'], ['customers', 'Müşteriler'], ['visa', 'Vize'], ['ds160', 'Amerika Vize'], ['tours', 'Turlar'], ['hotels', 'Oteller ve Uçuşlar'], ['quotes', 'Teklif & Proforma'], ['agencies', 'Acentelikler'], ['cards', 'Kredi Kartları']];

function AppInner() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeModule, setActiveModule] = useState('dashboard');
  const [lastTourId, setLastTourId] = useState(null); // tur→müşteri→geri dönüşünde turu geri açmak için
  const [prevModule, setPrevModule] = useState(null);
  const navigateTo = (mod) => { setPrevModule(activeModule); setActiveModule(mod); };
  // Dashboard kısayolu: modüle git + formu aç ('new' | 'offer' | 'contract')
  const [quickAction, setQuickAction] = useState(null);
  const goAction = (mod, act) => { setQuickAction(act ? { mod, act } : null); navigateTo(mod); };
  const [tourTab, setTourTab] = useState('list'); // Turlar: 'list' | 'offers' (Tur Teklifleri)
  useEffect(() => { if (quickAction?.mod === 'tours' && quickAction.act === 'offer') setTourTab('offers'); }, [quickAction]);
  const qa = (mod) => ({ quickAction: quickAction?.mod === mod ? quickAction.act : null, onQuickActionDone: () => setQuickAction(null) });

  // 🔄 Tüm veriyi Firebase'den yenile (onSnapshot kaldırıldığı için manuel tazeleme)
  const [refreshing, setRefreshing] = useState(false);
  const refreshAllData = async () => {
    if (refreshing) return;
    setRefreshing(true);
    showToast?.('🔄 Firebase\'den yenileniyor...', 'info');
    try {
      const cols = [
        ['visa_applications', setVisaApplications],
        ['ds160_applications', setDs160Applications],
        ['tours', setTours],
        ['hotels', setHotels],
        ['group_flights', setGroupFlights],
        ['transfers', setTransfers],
        ['packages', setPackages],
        ['agencies', setAgencies],
        ['credit_cards', setCreditCards],
        ['quotes', setQuotes],
        ['users', setUsers],
      ];
      await Promise.all(cols.map(async ([name, setter]) => {
        const snap = await getDocs(collection(db, name));
        const items = snap.empty ? [] : snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
        applyingRemote.current[name] = true; // sunucudan geldi — tekrar yazma
        loadFailed.current[name] = false;
        knownDocs.current[name] = snapshotDocs(items);
        setter(items);
      }));
      const cs = await getDocs(collection(db, 'customers'));
      let citems = cs.empty ? [] : cs.docs.map(d => ({ ...d.data(), _docId: d.id }));
      citems = citems.filter(c => c.firstName || c.lastName);
      setCustomers(citems);
      showToast?.('✅ Tüm veriler güncellendi', 'success');
    } catch (e) {
      showToast?.('❌ Yenileme hatası: ' + e.message, 'error');
    } finally {
      setRefreshing(false);
    }
  };
  const navigateBack = () => { if (prevModule) { setActiveModule(prevModule); setPrevModule(null); } else setActiveModule('dashboard'); };
  const [openCustomerId, setOpenCustomerId] = useState(null); // dashboard'dan müşteriye git
  const [custOverlay, setCustOverlay] = useState(null); // başka ekranın üstünde açılan müşteri kartı (Geri ile o ekrana dönülür)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Yeni sürüm kontrolü: CRM sekmesi gün boyu açık kalınca deploy sonrası eski kodla çalışmaya devam ediyordu
  // (ör. vizeci ileri tarih rozetini göremedi). 5 dakikada bir ve sekmeye dönünce index.html'deki
  // uygulama dosyası adı kontrol edilir; değiştiyse üstte "Yenile" şeridi çıkar.
  const [newVersion, setNewVersion] = useState(false);
  useEffect(() => {
    const mine = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src');
    if (!mine) return; // geliştirme ortamı
    let stop = false;
    const check = async () => {
      try {
        const html = await (await fetch('/index.html?v=' + Date.now(), { cache: 'no-store' })).text();
        const live = (html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/) || html.match(/src="(\/assets\/index-[^"]+\.js)"/) || [])[1];
        if (!stop && live && live !== mine) setNewVersion(true);
      } catch (e) { /* çevrimdışı */ }
    };
    const iv = setInterval(check, 5 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    check();
    return () => { stop = true; clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  const [customers, setCustomers] = useState(defaultCustomers);
  const [visaApplications, setVisaApplications] = useState([]);
  const [ds160Applications, setDs160Applications] = useState([]);
  const [tours, setTours] = useState([]);
  const [hotels, setHotels] = useState([]);
  const [groupFlights, setGroupFlights] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [creditCards, setCreditCards] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [users, setUsers] = useState(defaultUsers);
  const [isLoading, setIsLoading] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [appSettings, setAppSettings] = useState({
    processors: ['Paydos', 'İdata', 'Oğuz'],
    banks: [{
      id: 1,
      bankName: 'Garanti Bankası A.Ş.',
      branch: 'Denizli Çınar Şubesi',
      branchCode: '781',
      swift: 'TGBATRIS',
      ibanTL: 'TR40 0006 2000 7810 0006 2962 46',
      accountTL: '0006 2962 46',
      ibanEUR: 'TR73 0006 2000 7810 0009 0910 95',
      accountEUR: '0009 0910 95',
      ibanUSD: 'TR46 0006 2000 7810 0009 0910 96',
      showInDocs: true
    }],
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
    attachments: [],
    sectors: []
  });

  // Toast fonksiyonları
  // Kimlik benzersiz olmalı: aynı milisaniyede iki bildirim gelirse (Date.now() aynı) React aynı anahtarlı
  // kutulardan birini DOM'da yetim bırakıyordu — ekranda kapanmayan bildirim kalıyordu
  const toastSeq = useRef(0);
  const showToast = useCallback((message, type = 'info', undo = null) => {
    const id = `${Date.now()}_${++toastSeq.current}`;
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
      // Yazı alanındayken tarayıcının kendi geri alması çalışsın (veri geri alma tetiklenmesin)
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      // Ctrl/Cmd + Z = Undo
      if (!typing && (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
      }
      // Ctrl/Cmd + 1-9 = Modül değiştir (menüdeki ⌘ numaralarıyla aynı sıra)
      if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
        const m = SHORTCUT_MODULES[parseInt(e.key) - 1];
        if (m) { e.preventDefault(); setActiveModule(m[0]); showToast(`${m[1]} açıldı`, 'info'); }
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

  // Kısayollar başka cihazda değiştirilmiş olabilir: oturum açıkken profilden bir kez tazele
  useEffect(() => {
    const u = currentUser; if (!isLoggedIn || !u?.id) return;
    getDoc(doc(db, 'users', u._docId || String(u.id))).then(snap => {
      const sc = snap.exists() ? snap.data()?.shortcuts : undefined;
      if (Array.isArray(sc) && JSON.stringify(sc) !== JSON.stringify(u.shortcuts)) {
        setCurrentUser(prev => { const nu = { ...prev, shortcuts: sc }; try { localStorage.setItem('paydos_current_user', JSON.stringify(nu)); } catch (e) { /* yok */ } return nu; });
      }
    }).catch(() => {});
  }, [isLoggedIn, currentUser?.id]);

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
    let unsubs = [];
    const authUnsub = onAuthStateChanged(auth, (user) => {
      // Firebase Auth oturumu yoksa veri çekme (Firestore Rules güvenliği)
      if (!user) {
        // Oturum düştü / çıkış yapıldı: dinleyicileri kapat, kaydı durdur. Ekranda "giriş yapılmış"
        // görünüp veri yüklenmeyen ve yapılan değişikliklerin sessizce kaybolduğu durumu önler.
        unsubs.forEach(u => u()); unsubs = [];
        firestoreLoaded.current = false;
        initialLoadDone.current = false;
        settingsLoaded.current = false;
        if (localStorage.getItem('paydos_logged_in') === 'true') {
          localStorage.removeItem('paydos_logged_in'); localStorage.removeItem('paydos_current_user');
          setIsLoggedIn(false); setCurrentUser(null);
        }
        return;
      }
      if (firestoreLoaded.current) return;
      firestoreLoaded.current = true;

    // Küçük koleksiyonlar: tam gerçek zamanlı dinleme
    const smallCollections = [
      { name: 'visa_applications', setter: setVisaApplications, label: 'vize başvurusu', icon: '🌍' },
      { name: 'ds160_applications', setter: setDs160Applications, label: 'Amerika vize başvurusu', icon: '🇺🇸' },
      { name: 'tours', setter: setTours, label: 'tur', icon: '🎫' },
      { name: 'hotels', setter: setHotels, label: 'otel', icon: '🏨' },
      { name: 'group_flights', setter: setGroupFlights, label: 'grup uçuşu', icon: '✈️' },
      { name: 'transfers', setter: setTransfers, label: 'transfer', icon: '🚐' },
      { name: 'packages', setter: setPackages, label: 'paket', icon: '📦' },
      { name: 'agencies', setter: setAgencies, label: 'acente', icon: '🏢' },
      { name: 'credit_cards', setter: setCreditCards, label: 'kredi kartı', icon: '💳' },
      { name: 'quotes', setter: setQuotes, label: 'teklif', icon: '📄' },
      { name: 'users', setter: setUsers, label: 'kullanıcı', icon: '👤' }
    ];

    // Performans: ilk yükleme tek seferlik getDocs (hızlı), SONRA her koleksiyon için
    // sadece DEĞİŞENLERİ dinle (onSnapshot docChanges) — tüm veriyi tekrar çekmez ama gerçek zamanlı olur.
    (async () => {
      await Promise.all(smallCollections.map(async (col) => {
        try {
          const snapshot = await getDocs(collection(db, col.name));
          const items = snapshot.empty ? [] : snapshot.docs.map(d => ({ ...d.data(), _docId: d.id }));
          // Sunucudan gelen veriyi geri yazma (debouncedSave bu işareti görüp atlar)
          applyingRemote.current[col.name] = true;
          loadFailed.current[col.name] = false;
          knownDocs.current[col.name] = snapshotDocs(items);
          col.setter(items);
          // localStorage'a hafif (resimsiz) kaydet — quota aşımını önler
          try {
            const lite = items.map(it => {
              const o = { ...it };
              if (o.formData && typeof o.formData === 'object') {
                const fd = { ...o.formData };
                ['passport','visa','usaVisa'].forEach(k => { if (fd[k] && fd[k].image) fd[k] = { ...fd[k], image: (fd[k].image||'').startsWith('http') ? fd[k].image : '' }; });
                o.formData = fd;
              }
              ['passportImage','visaImage','image'].forEach(k => { if (o[k] && !String(o[k]).startsWith('http')) o[k] = ''; });
              return o;
            });
            localStorage.setItem(`paydos_${col.name}`, JSON.stringify(lite));
          } catch(e) {}
        } catch (e) { loadFailed.current[col.name] = true; console.warn(`${col.name} yükleme hatası:`, e.message); }
      }));
      // Kayıt ancak sunucu verisi yüklendikten sonra açılır — aksi halde localStorage'daki eski
      // önbellek Firestore'a yazılıp aradaki yeni kayıtları silebilirdi.
      initialLoadDone.current = true;
      setDataReady(true); // tek seferlik temizlik efektleri yükleme bitince çalışsın
    })();

    // Her küçük koleksiyon için gerçek zamanlı dinleyici (ilk snapshot atlanır, sonra sadece değişenler)
    smallCollections.forEach((col) => {
      let initialized = false;
      const unsub = onSnapshot(collection(db, col.name), (snapshot) => {
        if (!initialized) { initialized = true; return; } // ilk yükleme getDocs ile yapıldı
        const changes = snapshot.docChanges();
        if (changes.length === 0) return;
        // Sadece BAŞKA cihazdan gelen YENİ eklemeleri bildir (kendi yazdığın hariç)
        // Bildirim ayarı kapalıysa gösterme (Ayarlar'dan açılıp kapanır). localStorage'dan anlık okunur.
        let notifOn = true;
        try { const s = JSON.parse(localStorage.getItem('paydos_app_settings') || '{}'); if (s.notificationsEnabled === false) notifOn = false; } catch(e) {}
        if (notifOn && !snapshot.metadata.hasPendingWrites) {
          changes.filter(ch => ch.type === 'added').forEach(ch => {
            const d = ch.doc.data();
            const isim = d.name || (d.firstName ? `${d.firstName} ${d.lastName || ''}`.trim() : '') || d.customerName || d.title || d.hotelName || d.agencyName || '';
            showToast?.(`${col.icon} Yeni ${col.label} eklendi${isim ? ': ' + isim : ''}`, 'info');
          });
        }
        // debouncedSave bu güncellemeyi tekrar yazmasın (döngü önleme)
        applyingRemote.current[col.name] = true;
        const known = knownDocs.current[col.name] || (knownDocs.current[col.name] = new Map());
        changes.forEach(change => {
          const data = { ...change.doc.data(), _docId: change.doc.id };
          if (change.type === 'removed') known.delete(change.doc.id); else known.set(change.doc.id, docSig(data));
        });
        col.setter(prev => {
          let updated = Array.isArray(prev) ? [...prev] : [];
          changes.forEach(change => {
            const data = { ...change.doc.data(), _docId: change.doc.id };
            if (change.type === 'added' || change.type === 'modified') {
              const idx = updated.findIndex(x => x._docId === data._docId || (x.id != null && String(x.id) === String(data.id)));
              if (idx >= 0) updated[idx] = data;
              else updated = [...updated, data];
            } else if (change.type === 'removed') {
              updated = updated.filter(x => x._docId !== data._docId && !(x.id != null && String(x.id) === String(data.id)));
            }
          });
          return updated;
        });
      }, (e) => console.warn(`${col.name} realtime hatası:`, e.message));
      unsubs.push(unsub);
    });

    // Customers: ilk yükleme getDocs, sonra değişen kayıtları onSnapshot ile yakala
    const loadCustomers = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'customers'));
        if (!snapshot.empty) {
          let items = snapshot.docs.map(d => ({ ...d.data(), _docId: d.id }));
          items = items.filter(c => c.firstName || c.lastName);
          // Pasaport tipi düzeltme kaldırıldı - artık kayıt sırasında yapılıyor
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

    // Customers gerçek zamanlı: ilk yüklemeden sonra sadece modified/removed dinle
    let customersInitialized = false;
    const custUnsub = onSnapshot(collection(db, 'customers'), (snapshot) => {
      // İlk snapshot (added eventleri) loadCustomers ile zaten yüklendi — atla
      if (!customersInitialized) {
        customersInitialized = true;
        return;
      }
      // Batch güncelleme — tek seferlik setCustomers
      const changes = snapshot.docChanges();
      if (changes.length === 0) return;
      setCustomers(prev => {
        let updated = [...prev];
        changes.forEach(change => {
          const data = { ...change.doc.data(), _docId: change.doc.id };
          if (!(data.firstName || data.lastName)) return;
          if (change.type === 'added' || change.type === 'modified') {
            const idx = updated.findIndex(c => c._docId === data._docId || String(c.id) === String(data.id));
            if (idx >= 0) updated[idx] = data;
            else updated = [...updated, data];
          } else if (change.type === 'removed') {
            updated = updated.filter(c => c._docId !== data._docId);
          }
        });
        return updated;
      });
    }, (e) => console.warn('customers realtime hatası:', e.message));
    unsubs.push(custUnsub);

    // App settings
    const settingsUnsub = onSnapshot(collection(db, 'app_settings'), (snapshot) => {
      settingsLoaded.current = true;
      if (!snapshot.empty) {
        const settingsDoc = snapshot.docs[0].data();
        if (settingsDoc) {
          applyingRemote.current['app_settings'] = true;
          setAppSettings(prev => ({ ...prev, ...settingsDoc }));
          try { localStorage.setItem('paydos_app_settings', JSON.stringify(settingsDoc)); } catch(e) {}
        }
      }
    }, (e) => console.warn('app_settings dinleme hatası:', e.message));
    unsubs.push(settingsUnsub);

    });
    // Cleanup: bileşen unmount olunca dinleyicileri kapat
    return () => { authUnsub(); unsubs.forEach(u => u()); };
  }, []);

  // 🔥 FIRESTORE'A KAYDET — debounced
  const saveTimers = useRef({});
  const initialLoadDone = useRef(false);
  // Gerçek zamanlı dinleyiciden gelen güncellemeleri işaretle — debouncedSave bunları TEKRAR YAZMASIN (sonsuz döngü önlenir)
  const applyingRemote = useRef({});
  // Yüklenemeyen koleksiyonlarda silme senkronu yapılmaz (state eski önbellek olabilir)
  const loadFailed = useRef({});
  // Her koleksiyonda bu cihazın bildiği kayıtlar (kimlik → içerik). Kayıt sırasında:
  //  - sadece burada olup yerelde kaldırılanlar silinir (başka cihazdan yeni eklenmiş kayıt silinmez),
  //  - sadece içeriği değişen kayıtlar yazılır (tüm koleksiyon her seferinde yeniden yazılmaz,
  //    başkasının aynı anda düzenlediği diğer kayıtların üzerine eski veri yazılmaz).
  const knownDocs = useRef({});
  const docKey = (item) => item._docId || (item.id !== undefined && item.id !== null ? String(item.id) : null);
  const docSig = (item) => { const { _docId, updatedAt, ...rest } = item; try { return JSON.stringify(rest); } catch { return String(Math.random()); } };
  const snapshotDocs = (arr) => { const m = new Map(); (Array.isArray(arr) ? arr : []).forEach(it => { const k = docKey(it); if (k) m.set(k, docSig(it)); }); return m; };

  // Eski tek-banka alanını (bankInfo) temizle — artık banks[] dizisi kullanılıyor
  useEffect(() => {
    if (appSettings?.bankInfo) {
      setAppSettings(prev => { const { bankInfo, ...rest } = prev; return rest; });
    }
  }, [appSettings?.bankInfo]);

  // Sayı input'larında mouse tekerleği ile değer değişmesini engelle (fiyat kayması sorunu)
  useEffect(() => {
    const stopWheel = (e) => {
      if (document.activeElement === e.target && e.target.type === 'number') {
        e.target.blur();
      }
    };
    document.addEventListener('wheel', stopWheel, { passive: true });
    return () => document.removeEventListener('wheel', stopWheel);
  }, []);

  // Tüm dropdown option'ları için koyu zemin (beyaz üstüne beyaz sorununu çözer)
  useEffect(() => {
    const id = 'paydos-select-fix';
    if (document.getElementById(id)) return;
    const st = document.createElement('style');
    st.id = id;
    st.textContent = `select option { background-color: #0f2744 !important; color: #e8f1f8 !important; }
select option:checked { background-color: #2563eb !important; color: #ffffff !important; }`;
    document.head.appendChild(st);
  }, []);

  const latestData = useRef({});
  const settingsLoaded = useRef(false);
  const debouncedSave = useCallback((key, collectionName, dataAtCall, isSettings = false) => {
    // Zamanlayıcı en güncel state ile çalışır — bekleme sırasında başka cihazdan gelen kayıtlar dahil
    latestData.current[collectionName] = dataAtCall;
    // Bu güncelleme sunucudan/dinleyiciden geldiyse tekrar yazma (döngü önleme)
    if (applyingRemote.current[collectionName]) { applyingRemote.current[collectionName] = false; return; }
    if (!initialLoadDone.current) return;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      const data = latestData.current[collectionName];
      try {
        if (isSettings) {
          const snapshot = await getDocs(collection(db, collectionName));
          const docId = snapshot.empty ? 'main' : snapshot.docs[0].id;
          // Sunucu ayarları yüklendiyse tam yaz: merge silinen anahtarları (ör. temizlenen tür
          // maliyeti) Firestore'da bırakıyordu ve yenilemede geri geliyorlardı. Yüklenmediyse eski
          // davranış (merge) — sunucudaki bilinmeyen ayarlar ezilmesin.
          await setDoc(doc(db, collectionName, docId), data, settingsLoaded.current ? {} : { merge: true });
        } else {
          // Silme sync YAPMA: customers (4000+ kayıt pahalı) ve visa_applications (iDATA/işlem
          // sırasında race condition + _docId tutarsızlığı veri kaybına yol açıyordu).
          // Bu modüllerde silme zaten anında deleteDoc ile yapılıyor.
          if (collectionName !== 'customers' && collectionName !== 'visa_applications' && !loadFailed.current[collectionName]) {
            const currentIds = new Set(data.map(docKey).filter(Boolean));
            const removedIds = [...(knownDocs.current[collectionName]?.keys() || [])].filter(id => !currentIds.has(id));
            let delBatch = writeBatch(db);
            let delCount = 0;
            for (const id of removedIds) {
              delBatch.delete(doc(db, collectionName, id));
              delCount++;
              if (delCount >= 400) { await delBatch.commit(); delBatch = writeBatch(db); delCount = 0; }
            }
            if (delCount > 0) await delBatch.commit();
          }
          const prevDocs = knownDocs.current[collectionName];
          knownDocs.current[collectionName] = snapshotDocs(data);
          // State'teki kayıtları kaydet — sadece yeni veya değişenler
          let batch = writeBatch(db);
          let count = 0;
          const now = new Date().toISOString();
          for (const item of data) {
            const k = docKey(item);
            if (prevDocs && k && prevDocs.get(k) === docSig(item)) continue;
            const docId = item._docId || (item.id !== undefined && item.id !== null ? String(item.id) : null) || generateUniqueId();
            const saveData = { ...item, updatedAt: now };
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

  // customers artık her işlemde anında Firestore'a yazılıyor - debounce gereksiz
  useEffect(() => { debouncedSave('visa_applications', 'visa_applications', visaApplications); }, [visaApplications]);

  // 🧹 TEK SEFERLİK TEMİZLİK: yanlışlıkla visa_applications'a kopyalanmış
  // DS-160 başvurularını sil (ds160SourceId olanlar). DS-160'lar zaten
  // "Amerika Vize" sekmesinde ds160_applications'tan gösteriliyor.
  const ds160CleanupDone = useRef(false);
  useEffect(() => {
    if (!initialLoadDone.current) return;
    if (ds160CleanupDone.current) return;
    const copies = visaApplications.filter(v => v.ds160SourceId);
    if (copies.length === 0) { ds160CleanupDone.current = true; return; }
    ds160CleanupDone.current = true;
    // Local state'ten çıkar
    setVisaApplications(prev => prev.filter(v => !v.ds160SourceId));
    // Firestore'dan sil
    (async () => {
      try {
        const batch = writeBatch(db);
        copies.forEach(v => {
          const docId = v._docId || String(v.id);
          batch.delete(doc(db, 'visa_applications', docId));
        });
        await batch.commit();
        console.log(`${copies.length} hatalı DS-160 kopyası temizlendi`);
      } catch (e) {
        console.error('DS-160 kopya temizleme hatası:', e.message);
      }
    })();
  }, [visaApplications, dataReady]);
  // 📋 Bir kerelik düzenleme: "iDATA/VFS Başvuru Yapılacak" durumu doğru yazımla listenin başına alınır
  // (eski yazım "İ Data\Vfs Başvuru Yapılacak" olan başvurular da yeni ada geçer). Sonra Ayarlar'dan serbestçe sıralanabilir.
  useEffect(() => {
    if (!dataReady || !settingsLoaded.current || appSettings?.visaStatusIdataFirst) return;
    const list = appSettings?.visaStatuses || [];
    if (!list.length) return;
    const TARGET = 'iDATA/VFS Başvuru Yapılacak';
    const isIdata = (st) => { const n = normalizeTr(st).replace(/[^a-z]/g, ''); return /data/.test(n) && /vfs/.test(n) && /yapilacak/.test(n); };
    setAppSettings(prev => ({ ...prev, visaStatuses: [TARGET, ...(prev.visaStatuses || []).filter(st => !isIdata(st))], visaStatusIdataFirst: true }));
    setVisaApplications(prev => prev.some(v => v.status && v.status !== TARGET && isIdata(v.status)) ? prev.map(v => v.status && v.status !== TARGET && isIdata(v.status) ? { ...v, status: TARGET } : v) : prev);
  }, [dataReady, appSettings?.visaStatuses, appSettings?.visaStatusIdataFirst]);
  // 🏛️ Randevu günü gelen başvurular otomatik "Konsoloslukta" olur.
  // Sadece randevu öncesi durumlardan (onay/red/iptal/konsolosluk hariç), son 30 günün randevuları,
  // her başvuruda bir kez (autoKonsolosluk işareti) — elle geri alınan durum tekrar ezilmez.
  // Ayarlarda "Konsoloslukta" durumu yoksa hiçbir şey yapılmaz. Uygulama açık kalırsa saatte bir kontrol eder.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setClockTick(x => x + 1), 60 * 60 * 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!dataReady) return;
    const target = (appSettings?.visaStatuses || []).find(st => /konsolos/i.test(st));
    if (!target) return;
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const minD = new Date(d); minD.setDate(minD.getDate() - 30);
    const minStr = `${minD.getFullYear()}-${String(minD.getMonth() + 1).padStart(2, '0')}-${String(minD.getDate()).padStart(2, '0')}`;
    const skip = /iptal|red|onay|konsolos|sonuc|teslim/; // normalizeTr metin üzerinde (ASCII)
    const due = (visaApplications || []).filter(v =>
      /^\d{4}-\d{2}-\d{2}$/.test(v.appointmentDate || '') &&
      v.appointmentDate <= todayStr && v.appointmentDate >= minStr &&
      !v.autoKonsolosluk && !skip.test(normalizeTr(v.status)) // 'İptal' / 'IPTAL' → 'iptal'
    );
    if (!due.length) return;
    const ids = new Set(due.map(v => v.id));
    const now = new Date().toISOString();
    setVisaApplications(prev => prev.map(v => ids.has(v.id) ? { ...v, status: target, autoKonsolosluk: now } : v));
    showToast(`🏛️ Randevu günü gelen ${due.length} başvuru "${target}" durumuna alındı`, 'info');
  }, [dataReady, visaApplications, appSettings?.visaStatuses, clockTick]);

  // 🧹 TEK SEFERLİK: users kayıtlarındaki düz metin şifreleri sil (giriş Firebase Auth ile yapılıyor,
  // bu alan hiçbir işe yaramıyordu ama giriş yapan herkes okuyabiliyordu)
  const pwCleanupDone = useRef(false);
  useEffect(() => {
    if (!initialLoadDone.current || pwCleanupDone.current) return;
    const withPw = users.filter(u => u.password);
    pwCleanupDone.current = true;
    if (withPw.length === 0) return;
    (async () => {
      try {
        const batch = writeBatch(db);
        withPw.forEach(u => batch.set(doc(db, 'users', u._docId || String(u.id)), { password: deleteField() }, { merge: true }));
        await batch.commit();
        setUsers(prev => prev.map(u => { const { password, ...rest } = u; return rest; }));
      } catch (e) { console.warn('Şifre temizleme hatası:', e.message); }
    })();
  }, [users, dataReady]);
  useEffect(() => { debouncedSave('tours', 'tours', tours); }, [tours]);
  // 👤 İsim eşitleme: vize başvurusu ve tur/otel/uçuş/transfer rezervasyonları müşteri adının kopyasını tutar.
  // Müşteri kartındaki isim düzeltilince (ör. "Ismaıl" → "İsmail", "Eryılmaz Agaoglu" → "Özcan Ağaoğlu Eryılmaz")
  // bu kopyalar da güncellenir. Eşleşme müşteri kimliğiyle; güvenlik için eski ve yeni isim en az bir kelimede
  // (Türkçe harf farkı yok sayılarak) ortak olmalı — bambaşka bir isme çevrilmez.
  useEffect(() => {
    if (!dataReady) return;
    const t = setTimeout(() => {
      const byId = new Map();
      customers.forEach(c => {
        const n = `${c.firstName || ''} ${c.lastName || ''}`.replace(/\s+/g, ' ').trim();
        if (!n) return;
        [c.id, c._docId].filter(x => x !== undefined && x !== null && x !== '').forEach(k => byId.set(String(k), n));
      });
      const words = (x) => new Set(normalizeTr(x).split(/\s+/).filter(w => w.length > 1));
      const fix = (rec) => {
        if (!rec || rec.customerId === undefined || rec.customerId === null || rec.customerId === '') return null;
        const n = byId.get(String(rec.customerId));
        if (!n || n === rec.customerName) return null;
        const a = words(rec.customerName || ''), b = words(n);
        if (rec.customerName && ![...a].some(w => b.has(w))) return null;
        // Kart "ISMAIL KAYGUN" (I belirsiz, büyük harf saklanmış), kopya düzgün "Ismail Kaygun" ise dokunma — sadece bozuk (ı'lı) kopya düzelir
        const old = String(rec.customerName || '');
        if (normalizeTr(old) === normalizeTr(n) && n === trUpper(n) && old !== trUpper(old) && !/ı/.test(old)) return null;
        return n;
      };
      const fixList = (list) => { let ch = false; const out = (list || []).map(r => { const n = fix(r); if (!n) return r; ch = true; return { ...r, customerName: n }; }); return ch ? out : null; };
      const fixNested = (arr) => { let ch = false; const out = (arr || []).map(x => { const rs = fixList(x.reservations); if (!rs) return x; ch = true; return { ...x, reservations: rs }; }); return ch ? out : null; };
      setVisaApplications(prev => fixList(prev) || prev);
      setTours(prev => fixNested(prev) || prev);
      setHotels(prev => fixNested(prev) || prev);
      setGroupFlights(prev => fixNested(prev) || prev);
      setTransfers(prev => fixNested(prev) || prev);
    }, 1500);
    return () => clearTimeout(t);
  }, [dataReady, customers]);
  useEffect(() => { debouncedSave('hotels', 'hotels', hotels); }, [hotels]);
  useEffect(() => { debouncedSave('group_flights', 'group_flights', groupFlights); }, [groupFlights]);
  useEffect(() => { debouncedSave('transfers', 'transfers', transfers); }, [transfers]);
  useEffect(() => { debouncedSave('packages', 'packages', packages); }, [packages]);
  useEffect(() => { debouncedSave('agencies', 'agencies', agencies); }, [agencies]);
  useEffect(() => { debouncedSave('credit_cards', 'credit_cards', creditCards); }, [creditCards]);
  useEffect(() => { debouncedSave('quotes', 'quotes', quotes); }, [quotes]);
  useEffect(() => { debouncedSave('users', 'users', users); }, [users]);
  useEffect(() => { debouncedSave('app_settings', 'app_settings', appSettings, true); }, [appSettings]);
  const handleLogin = (user) => { setIsLoggedIn(true); setCurrentUser(user); localStorage.setItem('paydos_logged_in', 'true'); localStorage.setItem('paydos_current_user', JSON.stringify(user)); };
  const handleLogout = () => {
    signOut(auth).catch(()=>{}); firestoreLoaded.current = false; setIsLoggedIn(false); setCurrentUser(null);
    // Ortak bilgisayarda müşteri verisi (TC, pasaport, kart) tarayıcıda kalmasın
    try { Object.keys(localStorage).filter(k => k.startsWith('paydos_')).forEach(k => localStorage.removeItem(k)); } catch(e) {}
  };

  if (!isLoggedIn) return <LoginScreen onLogin={handleLogin} users={users} />;
  if (isLoading) return (<div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0c1929 0%, #1a3a5c 50%, #0d2137 100%)' }}><div style={{ textAlign: 'center' }}><div style={{ fontSize: '48px', marginBottom: '16px' }}>✈️</div><p style={{ color: '#94a3b8' }}>Yükleniyor...</p></div></div>);

  const menuItems = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' }, 
    { id: 'customers', icon: '👥', label: 'Müşteriler' },
    { id: 'visa', icon: '🌍', label: 'Vize' },
    { id: 'ds160', icon: '🇺🇸', label: 'Amerika Vize' },
    { id: 'tours', icon: '🎫', label: 'Turlar' },
    { id: 'hotels', icon: '🏨', label: 'Oteller ve Uçuşlar' },
    { id: 'quotes', icon: '📄', label: 'Teklif & Proforma' },
    { id: 'agencies', icon: '🏢', label: 'Acentelikler' },
    { id: 'cards', icon: '💳', label: 'Kredi Kartları' },
    { id: 'tavsiyeler', icon: '⭐', label: 'Tavsiyeler' },
    { id: 'linkduyuru', icon: '📢', label: 'Duyurular' },
    { id: 'vizeevrak', icon: '📁', label: 'Vize Evrak', external: 'https://vize.paydostur.com/#/panel' },
    { id: 'bankinfo', icon: '🏦', label: 'Banka Bilgileri' },
    { id: 'activitylog', icon: '📋', label: 'İşlemler' },
    { id: 'settings', icon: '⚙️', label: 'Ayarlar' }
  ];

  const renderModule = () => {
    switch (activeModule) {
      case 'dashboard': return <DashboardModule customers={customers} setCustomers={setCustomers} appSettings={appSettings} showToast={showToast} isMobile={isMobile} currentUser={currentUser} onGo={goAction} onNavigate={(customer) => { setOpenCustomerId(customer.id); setActiveModule('customers'); }} />;
      case 'customers': return <CustomerModule customers={customers} setCustomers={setCustomers} tours={tours} visaApplications={visaApplications} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} appSettings={appSettings} openCustomerId={openCustomerId} onOpenCustomerHandled={() => setOpenCustomerId(null)} onBack={navigateBack} currentUser={currentUser} onGo={goAction} {...qa('customers')} />;
      case 'visa': return <VisaModule customers={customers} visaApplications={visaApplications} setVisaApplications={setVisaApplications} isMobile={isMobile} onNavigateToCustomers={() => setActiveModule('customers')} onOpenCustomer={setCustOverlay} onNavigateHome={() => setActiveModule('dashboard')} appSettings={appSettings} setAppSettings={setAppSettings} showToast={showToast} addToUndo={addToUndo} creditCards={creditCards} currentUser={currentUser} {...qa('visa')} />;
      case 'ds160': return <DS160Module isMobile={isMobile} showToast={showToast} appSettings={appSettings} setAppSettings={setAppSettings} />;
      case 'tours': {
        const tabB = (id, label) => <button key={id} onClick={() => setTourTab(id)} style={{ padding: '8px 16px', background: tourTab === id ? 'linear-gradient(135deg, #e8912a, #d97706)' : 'rgba(255,255,255,0.05)', border: tourTab === id ? 'none' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: tourTab === id ? '#fff' : '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>{label}</button>;
        const offerCount = quotes.filter(q => q.type === 'tur-teklifi').length;
        return <>
          <div style={{ display: 'flex', gap: '8px', padding: '16px 20px 0', flexWrap: 'wrap' }}>{tabB('list', '🎫 Turlar')}{tabB('offers', `🧾 Tur Teklifleri (${offerCount})`)}</div>
          {tourTab === 'offers'
            ? <QuotesModule only="tur-teklifi" appSettings={appSettings} quotes={quotes} setQuotes={setQuotes} customers={customers} isMobile={isMobile} showToast={showToast} currentUser={currentUser} tours={tours} setTours={setTours} {...qa('tours')} />
            : <ToursModule tours={tours} setTours={setTours} customers={customers} setCustomers={setCustomers} visaApplications={visaApplications} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} appSettings={appSettings} currentUser={currentUser} initialTourId={lastTourId} onTourOpened={() => setLastTourId(null)} onNavigateToCustomer={(c, tourId) => { setOpenCustomerId(c.id); if (tourId) setLastTourId(tourId); navigateTo('customers'); }} onGo={goAction} quotes={quotes} {...(quickAction?.act === 'offer' ? {} : qa('tours'))} />}
        </>;
      }
      case 'hotels': return <HotelsModule hotels={hotels} setHotels={setHotels} groupFlights={groupFlights} setGroupFlights={setGroupFlights} transfers={transfers} setTransfers={setTransfers} packages={packages} setPackages={setPackages} visaApplications={visaApplications} customers={customers} setCustomers={setCustomers} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} appSettings={appSettings} currentUser={currentUser} onNavigateToCustomer={(c) => { setOpenCustomerId(c.id); navigateTo('customers'); }} />;
      case 'quotes': return <QuotesModule appSettings={appSettings} quotes={quotes} setQuotes={setQuotes} customers={customers} isMobile={isMobile} showToast={showToast} currentUser={currentUser} tours={tours} setTours={setTours} {...qa('quotes')} />;
      case 'agencies': return <AgenciesModule agencies={agencies} setAgencies={setAgencies} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} />;
      case 'cards': return <CreditCardsModule creditCards={creditCards} setCreditCards={setCreditCards} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} />;
      case 'linkduyuru': return <LinkDuyuruModule customers={customers} tours={tours} showToast={showToast} isMobile={isMobile} currentUser={currentUser} />;
      case 'musterilinki': return <MusteriLinkiModule customers={customers} tours={tours} showToast={showToast} isMobile={isMobile} currentUser={currentUser} />;
      case 'turlinki': return <TurLinkiModule tours={tours} customers={customers} showToast={showToast} isMobile={isMobile} currentUser={currentUser} />;
      case 'duyurular': return <DuyurularModule tours={tours} showToast={showToast} isMobile={isMobile} currentUser={currentUser} />;
      case 'bildirimler': return <BildirimlerModule customers={customers} tours={tours} showToast={showToast} isMobile={isMobile} />;
      case 'tavsiyeler': return <TavsiyelerModal asPage onClose={() => {}} showToast={showToast} isMobile={isMobile} currentUser={currentUser} />;
      case 'bankinfo': return <BankInfoModule appSettings={appSettings} showToast={showToast} isMobile={isMobile} />;
      case 'activitylog': return <ActivityLogModule isMobile={isMobile} showToast={showToast} currentUser={currentUser} />;
      case 'settings': return <SettingsModule visaApplications={visaApplications} setVisaApplications={setVisaApplications} users={users} setUsers={setUsers} currentUser={currentUser} setCurrentUser={setCurrentUser} isMobile={isMobile} appSettings={appSettings} setAppSettings={setAppSettings} showToast={showToast} />;
      default: return <DashboardModule customers={customers} setCustomers={setCustomers} appSettings={appSettings} showToast={showToast} isMobile={isMobile} currentUser={currentUser} onGo={goAction} onNavigate={(customer) => { setOpenCustomerId(customer.id); setActiveModule('customers'); }} />;
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0c1929 0%, #1a3a5c 50%, #0d2137 100%)', color: '#e8f1f8', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {/* Toast Bildirimleri */}
      <Toast toasts={toasts} removeToast={removeToast} />
      {newVersion && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', padding: '10px 16px', background: 'linear-gradient(90deg, #7c3aed, #db2777)', color: '#fff', fontSize: '13px', fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          🆕 CRM'in yeni sürümü yayınlandı — yeni özellikleri görmek için sayfayı yenileyin.
          <button onClick={() => window.location.reload()} style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: '#fff', color: '#7c3aed', fontWeight: 700, cursor: 'pointer' }}>🔄 Yenile</button>
        </div>
      )}
      
      {/* Klavye Kısayolları Bilgisi */}
      {!isMobile && (
        <div style={{ position: 'fixed', bottom: '20px', left: '280px', fontSize: '10px', color: '#64748b', zIndex: 50 }}>
          ⌨️ Ctrl+1-9: Modül | Ctrl+Z: Geri Al
        </div>
      )}
      
      {isMobile && sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100 }} />}
      <aside style={{ position: 'fixed', left: isMobile ? (sidebarOpen ? 0 : '-280px') : 0, top: 0, bottom: 0, width: '260px', background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(10px)', borderRight: '1px solid rgba(255,255,255,0.1)', zIndex: 200, transition: 'left 0.3s ease', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}><div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><img src="/icons/logo.png" alt="Paydos" style={{ width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0 }} /><div style={{ flex: 1 }}><h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>Paydos</h1><p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Turizm CRM</p></div><button onClick={refreshAllData} disabled={refreshing} title="Firebase'den yenile" style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '8px 10px', color: '#3b82f6', cursor: refreshing ? 'wait' : 'pointer', fontSize: '16px' }}>{refreshing ? '⏳' : '🔄'}</button></div></div>
        <nav style={{ flex: 1, padding: '16px 12px', overflowY: 'auto' }}>{menuItems.map((item, idx) => (<button key={item.id} onClick={() => { if (item.external) { window.open(item.external, '_blank', 'noopener'); if (isMobile) setSidebarOpen(false); return; } setActiveModule(item.id); if (isMobile) setSidebarOpen(false); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', marginBottom: '3px', background: activeModule === item.id ? 'rgba(245,158,11,0.15)' : 'transparent', border: activeModule === item.id ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent', borderRadius: '10px', color: activeModule === item.id ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: activeModule === item.id ? '600' : '400' }}><span style={{ fontSize: '16px' }}>{item.icon}</span>{item.label}{!isMobile && <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#64748b' }}>{item.external ? '↗' : (SHORTCUT_MODULES[idx]?.[0] === item.id ? `⌘${idx+1}` : '')}</span>}</button>))}</nav>
        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}><div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}><div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '14px' }}>{currentUser?.name?.[0] || 'U'}</div><div><p style={{ margin: 0, fontSize: '13px', fontWeight: '600' }}>{currentUser?.name}</p><p style={{ margin: 0, fontSize: '10px', color: '#64748b' }}>{currentUser?.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}</p></div></div><button onClick={handleLogout} style={{ width: '100%', padding: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🚪 Çıkış Yap</button></div>
      </aside>
      <main style={{ marginLeft: isMobile ? 0 : '260px', minHeight: '100vh' }}>
        {isMobile && <header style={{ position: 'sticky', top: 0, background: 'rgba(12,25,41,0.95)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 50 }}><button onClick={() => setSidebarOpen(true)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#e8f1f8', cursor: 'pointer', fontSize: '18px' }}>☰</button><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '24px' }}>✈️</span><span style={{ fontWeight: '700' }}>Paydos</span></div><button onClick={refreshAllData} disabled={refreshing} style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '8px 10px', color: '#3b82f6', cursor: refreshing ? 'wait' : 'pointer', fontSize: '16px', width: '40px' }}>{refreshing ? '⏳' : '🔄'}</button></header>}
        {renderModule()}
        {/* Müşteri kartı katmanı: alttaki ekran (ör. yarım kalmış vize formu) kapanmadan açılır */}
        {custOverlay != null && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 900, overflowY: 'auto', background: 'linear-gradient(135deg, #0c1929 0%, #1a3a5c 100%)' }}>
              <CustomerModule customers={customers} setCustomers={setCustomers} tours={tours} visaApplications={visaApplications} isMobile={isMobile} showToast={showToast} addToUndo={addToUndo} appSettings={appSettings}
                openCustomerId={custOverlay} onOpenCustomerHandled={() => {}} onBack={() => setCustOverlay(null)} currentUser={currentUser} onGo={(mod, act) => { setCustOverlay(null); goAction(mod, act); }} />
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  // Excel/PDF kütüphaneleri ilk ekran çizildikten sonra arka planda iner
  useEffect(() => { const t = setTimeout(() => preloadHeavy().catch(() => {}), 800); return () => clearTimeout(t); }, []);
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
