// 🇺🇸 Amerika vize (DS-160) modülü
import { asciiTr, normalizeTr } from '../lib/turkish.js';
import { auth, db } from '../lib/firebase.js';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { jsPDF } from '../lib/heavy.js';
import { onAuthStateChanged } from 'firebase/auth';
import { pdfText } from '../lib/pdf.js';
import { useEffect, useState } from 'react';
import { sendVisaEmail } from '../components/shared';


// DS-160 AMERİKA VİZE MODÜLÜ
export function DS160Module({ isMobile, showToast, appSettings, setAppSettings }) {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedApp, setSelectedApp] = useState(null);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  // Adres https:// olmadan girilirse tarayıcı onu göreli yol sanıp CRM'in altında açıyordu
  // (crm.paydostur.com/crm.paydostur.com/ds160.html → CRM ana sayfası). Protokolü tamamla.
  const ds160Url = (() => {
    const raw = String(appSettings?.ds160SiteUrl || 'https://ds160-paydos.netlify.app').trim();
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
  })();

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
            _name: data.customerName || `${data.formData?.firstName || data.formData?.name || ''} ${data.formData?.lastName || data.formData?.surname || ''}`.trim() || 'İsimsiz',
            _phone: data.customerPhone || data.formData?.phone || data.formData?.homePhone || '',
            _email: data.customerEmail || data.formData?.email || '',
            // Formun yazdığı teknik durumlar (draft/submitted) Türkçe etikete çevrilir
            _status: (!data.status || data.status === 'draft') ? 'Beklemede' : data.status === 'submitted' ? 'Gönderildi' : data.status,
            _tcKimlik: data.tcKimlik || data.formData?.tcKimlik || '',
            _passportNo: data.passportNo || data.formData?.passportNo || data.formData?.passportNumber || '',
          };
        });
        // createdAt karışık tipte olabilir (string ISO veya Firestore Timestamp) — ms'e çevir
        const getTime = (v) => {
          if (!v) return 0;
          if (typeof v === 'object' && v.seconds) return v.seconds * 1000;
          if (typeof v === 'object' && v.toDate) { try { return v.toDate().getTime(); } catch { return 0; } }
          if (typeof v === 'string') return new Date(v).getTime() || 0;
          if (typeof v === 'number') return v;
          return 0;
        };
        items.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
        setApplications(items);
      } catch (e) {
        console.error('DS-160 yükleme hatası:', e);
        showToast?.(`DS-160 yüklenemedi: ${e.message}`, 'error');
      } finally {
        setLoading(false);
      }
    };
    // Firebase Auth oturumu hazır olunca çek (Rules okuma için auth ister)
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { setLoading(false); return; }
      loadApplications();
    });
    return () => unsub();
  }, []);

  const statusColors = {
    'Beklemede': '#f59e0b',
    'Gönderildi': '#a855f7',
    'İnceleniyor': '#3b82f6',
    'Tamamlandı': '#10b981',
    'Reddedildi': '#ef4444',
    'İptal': '#64748b'
  };

  const filtered = applications.filter(a => {
    const q = normalizeTr(searchQuery);
    const matchQ = !q ||
      normalizeTr(a._name).includes(q) ||
      normalizeTr(a._email).includes(q) ||
      (a._phone || '').includes(q) ||
      (a._tcKimlik || '').includes(q);
    const matchS = statusFilter === 'all' || a._status === statusFilter;
    return matchQ && matchS;
  });

  const statuses = ['all', 'Beklemede', 'Gönderildi', 'İnceleniyor', 'Tamamlandı', 'Reddedildi', 'İptal'];

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
          <button onClick={() => { setUrlInput(ds160Url); setShowUrlModal(true); }} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '8px 14px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>
            ⚙️ Site URL
          </button>
          <button onClick={() => {
            const newId = 'a' + Math.random().toString(36).slice(2,8) + Date.now().toString(36);
            const link = `${ds160Url}${ds160Url.includes('?') ? '&' : '?'}id=${newId}`;
            navigator.clipboard.writeText(link);
            showToast?.('Yeni kişiye özel link kopyalandı — müşteriye gönderin', 'success');
          }} style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '8px', padding: '8px 14px', color: '#0c1929', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }} title="Her müşteriye ayrı, devam edilebilir link üretir">
            ➕ Yeni Başvuru Linki
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
          { label: 'Beklemede', value: applications.filter(a => a._status === 'Beklemede').length, color: '#f59e0b' },
          { label: 'Gönderildi', value: applications.filter(a => a._status === 'Gönderildi').length, color: '#a855f7' },
          { label: 'İnceleniyor', value: applications.filter(a => a._status === 'İnceleniyor').length, color: '#3b82f6' },
          { label: 'Tamamlandı', value: applications.filter(a => a._status === 'Tamamlandı').length, color: '#10b981' },
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
                      {/* Kişiye özel devam linki */}
                      <button onClick={(e) => {
                        e.stopPropagation();
                        const link = `${ds160Url}${ds160Url.includes('?') ? '&' : '?'}id=${app._docId}&edit=1`;
                        navigator.clipboard.writeText(link);
                        showToast?.('Devam linki kopyalandı — müşteriye gönderin', 'success');
                      }} style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', padding: '4px 8px', fontSize: '13px' }} title="Bu kişinin devam linkini kopyala">
                        🔗
                      </button>
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
                    {/* Formu Düzenle - DS-160 formunu ?id ile aç */}
                    <button onClick={(e) => {
                      e.stopPropagation();
                      const sep = ds160Url.includes('?') ? '&' : '?';
                      window.open(`${ds160Url}${sep}id=${app._docId}&edit=1`, '_blank');
                    }} style={{ width: '100%', padding: '11px', marginBottom: '14px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '10px', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>
                      ✏️ Formu Aç ve Düzenle
                    </button>
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
                          { title: 'KİŞİSEL BİLGİLER', keys: ['firstName','lastName','maidenSurname','gender','maritalStatus','birthDate','birthPlace','birthCountry','nationality','otherNationality','tcKimlik','homeAddress','homeZip','homePhone','phone','email'] },
                          { title: 'PASAPORT BİLGİLERİ', keys: ['passportType','passportNo','passportNumber','passportCity','passportIssueDate','passportExpiry','passportExpDate','oldPassport','lostPassport','travelHistory'] },
                          { title: 'SEYAHAT VE DİĞER BİLGİLER', keys: ['visaType','arrivalDate','departureDate','stayDuration','usAddress','usPhone','usEmail','tripPayer','hasCompanion','companionName','companionRelation','companionPhone','companionEmail','inviterName','inviterRelation'] },
                          { title: 'DAHA ÖNCE AMERİKA\'DA BULUNDUNUZ MU?', keys: ['beenToUS','usArrivalDate','usDepartureDate','hadUSVisa','usVisaDate','visaNumber','sameVisaCategory','hadFingerprint','visaLost','visaCancelled','visaRefused','refusalReason','greencardPetition'] },
                          { title: 'AİLE BİLGİSİ', keys: ['fatherName','fatherBirth','fatherBirthPlace','fatherNationality','motherName','motherBirth','motherBirthPlace','motherMaidenName','motherNationality','parentInUS','relativeInUS','relativeInUSName','relativeRelation','relativeUSCitizen','relativeAddress','relativePhone','relativeEmail','relative2Name','relative2Relation','relative2USCitizen','relative2Address','relative2Phone','relative2Email'] },
                          { title: 'EŞ HAKKINDA BİLGİLER', keys: ['spouseName','spouseMaidenName','spouseBirthPlace','spouseBirthDate','divorceCount','exSpouseName','exSpouseBirth','marriageDate','divorceDate','divorceReason','exSpouse2Name','exSpouse2Birth','marriageDate2','divorceDate2','divorceReason2'] },
                          { title: 'İŞ HAYATINIZ', keys: ['occupation','jobDescription','monthlySalary','employerName','employerAddress','employerZip','employerPhone','jobStartDate','prevEmployerName','prevEmployerAddress','prevEmployerPhone','prevJobStartDate','prevJobEndDate'] },
                          { title: 'EN SON MEZUN OLUNAN OKUL', keys: ['schoolName','schoolAddress','educationField','educationStartEnd'] },
                          { title: 'DİĞER BİLGİLER', keys: ['militaryService','militaryRank','militaryStart','militaryEnd','languages'] },
                          { title: 'SOSYAL MEDYA BİLGİLERİ', keys: ['facebook','instagram','twitter','linkedin','youtube','reddit','pinterest','tumblr','vk','weibo','myspace'] },
                          { title: 'GÜVENLİK SORULARI', keys: ['sec_drugs','sec_laundering','sec_trafficking','sec_prostitution','sec_terrorism','sec_genocide','sec_torture','sec_violence','sec_assassin','sec_military','sec_spy','sec_disorder','sec_arrested','sec_disease','sec_deported'] },
                        ];

                        const doc2 = new jsPDF();
                        const clean = pdfText(doc2);
                        // Başlık
                        doc2.setFillColor(26, 58, 92);
                        doc2.rect(0, 0, 210, 32, 'F');
                        doc2.setFontSize(14); doc2.setTextColor(255);
                        doc2.text(clean('AMERİKA BİLGİ FORMU - DS-160'), 15, 13);
                        doc2.setFontSize(8); doc2.setTextColor(180);
                        doc2.text(clean('AŞAĞIDA BELİRTİLEN BİLGİLER DS-160 ONLINE FORMUNUZ İÇİNDİR'), 15, 21);
                        doc2.setFontSize(9); doc2.setTextColor(200);
                        const nameClean = clean(app._name || '');
                        doc2.text(clean(`Başvuran: ${nameClean}   |   ${new Date().toLocaleDateString('tr-TR')}`), 15, 28);

                        let y = 40;
                        let rowIdx = 0;

                        // Üst bilgiler
                        const topRows = [
                          ['Ad Soyad', app._name], ['Telefon', app._phone],
                          ['E-posta', app._email], ['TC Kimlik', app._tcKimlik], ['Pasaport No', app._passportNo]
                        ].filter(r => r[1]);

                        doc2.setFontSize(8);
                        topRows.forEach(([k, v]) => {
                          doc2.setFontSize(8); doc2.setFont(undefined,'bold');
                          const kl = doc2.splitTextToSize(clean(k), 52);
                          doc2.setFont(undefined,'normal');
                          const lines = doc2.splitTextToSize(clean(v), 120);
                          const rh = Math.max(8, Math.max(kl.length, lines.length) * 4 + 4);
                          if (y - 4 + rh > 287) { doc2.addPage(); y = 15; }
                          const bg = rowIdx % 2 === 0 ? [245, 248, 255] : [255, 255, 255];
                          doc2.setFillColor(...bg); doc2.rect(15, y-4, 180, rh, 'F');
                          doc2.setTextColor(80,80,80); doc2.setFont(undefined,'bold');
                          doc2.text(kl, 17, y+1);
                          doc2.setTextColor(30,30,30); doc2.setFont(undefined,'normal');
                          doc2.text(lines, 72, y+1);
                          y += rh;
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
                          doc2.text(clean(section.title), 17, y+4);
                          y += 12; rowIdx = 0;

                          sectionRows.forEach(([k, v]) => {
                            doc2.setFontSize(8); doc2.setFont(undefined,'bold');
                            const kl = doc2.splitTextToSize(clean(k), 52);
                            doc2.setFont(undefined,'normal');
                            const lines = doc2.splitTextToSize(clean(v), 120);
                            const rh = Math.max(8, Math.max(kl.length, lines.length) * 4 + 4);
                            if (y - 4 + rh > 287) { doc2.addPage(); y = 15; }
                            const bg = rowIdx % 2 === 0 ? [245, 248, 255] : [255, 255, 255];
                            doc2.setFillColor(...bg); doc2.rect(15, y-4, 180, rh, 'F');
                            doc2.setTextColor(80,80,80); doc2.setFont(undefined,'bold');
                            doc2.text(kl, 17, y+1);
                            doc2.setTextColor(30,30,30); doc2.setFont(undefined,'normal');
                            doc2.text(lines, 72, y+1);
                            y += rh;
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
                          doc2.text(clean('DİĞER'), 17, y+4);
                          y += 12; rowIdx = 0;
                          extraRows.forEach(([k, v]) => {
                            doc2.setFontSize(8); doc2.setFont(undefined,'bold');
                            const kl = doc2.splitTextToSize(clean(k), 52);
                            doc2.setFont(undefined,'normal');
                            const lines = doc2.splitTextToSize(clean(v), 120);
                            const rh = Math.max(8, Math.max(kl.length, lines.length) * 4 + 4);
                            if (y - 4 + rh > 287) { doc2.addPage(); y = 15; }
                            const bg = rowIdx % 2 === 0 ? [245, 248, 255] : [255, 255, 255];
                            doc2.setFillColor(...bg); doc2.rect(15, y-4, 180, rh, 'F');
                            doc2.setTextColor(80,80,80); doc2.setFont(undefined,'bold');
                            doc2.text(kl, 17, y+1);
                            doc2.setTextColor(30,30,30); doc2.setFont(undefined,'normal');
                            doc2.text(lines, 72, y+1);
                            y += rh;
                            rowIdx++;
                          });
                        }

                        doc2.save(`DS160_${asciiTr(app._name||'belge').replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')}.pdf`);
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
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="https://crm.paydostur.com/ds160.html"
              style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => setShowUrlModal(false)} style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: '#e8f1f8', cursor: 'pointer' }}>İptal</button>
              <button onClick={() => {
                let newUrl = urlInput.trim();
                if (!newUrl) { showToast?.('URL boş olamaz', 'error'); return; }
                if (!/^https?:\/\//i.test(newUrl)) newUrl = `https://${newUrl.replace(/^\/+/, '')}`;
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
