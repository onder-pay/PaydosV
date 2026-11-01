// ⚙️ Ayarlar modülü ve alt panelleri
import { DEFAULT_SHARE_MSG, DEFAULT_SHORTCUTS, SHORTCUTS, sendVisaEmail, userShortcuts, VISA_COST_CATEGORIES, getVisaCostItems } from '../components/shared';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth, db } from '../lib/firebase.js';
import { deleteDoc, deleteField, doc, setDoc } from 'firebase/firestore';
import { generateUniqueId, waUrl } from '../lib/format.js';
import { inputStyle, labelStyle, selectStyle } from '../components/ui';
import { mailHtml, sendMailRequest } from '../lib/api.js';
import { normEmail, normalizeTr, trHas } from '../lib/turkish.js';
import { useMemo, useState } from 'react';


export function AttachmentSettingsPanel({ appSettings, setAppSettings, showToast }) {
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

export function SmtpConfigCard({ appSettings, setAppSettings, showToast, settingsKey = 'smtp', title = '⚙️ SMTP Yapılandırması' }) {
  const smtp = appSettings?.[settingsKey] || {};
  const set = (patch) => setAppSettings({ ...appSettings, [settingsKey]: { ...smtp, ...patch } });
  const [showPass, setShowPass] = useState(false);
  const field = (label, key, opts = {}) => (
    <div style={{ marginBottom: '10px' }}>
      <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>{label}</label>
      <input
        type={opts.pass && !showPass ? 'password' : 'text'}
        value={smtp[key] || ''}
        onChange={e => set({ [key]: opts.lower ? normEmail(e.target.value) : e.target.value })}
        placeholder={opts.placeholder || ''}
        style={{ width: '100%', maxWidth: '380px', padding: '10px 12px', background: '#0a1626', border: '1px solid rgba(20,184,166,0.3)', borderRadius: '8px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' }}
      />
    </div>
  );
  return (
    <div style={{ background: 'rgba(20,184,166,0.08)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(20,184,166,0.2)' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#14b8a6' }}>{title}</h3>
      <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>Buradan girilen bilgiler mail gönderiminde kullanılır. Boş bırakılan alanlar için sunucu varsayılanı (Netlify env) kullanılır.</p>
      {field('SMTP Sunucu (host)', 'host', { placeholder: 'smtp.sirketemail.com' })}
      {field('Port', 'port', { placeholder: '465' })}
      {field('Kullanıcı (user)', 'user', { placeholder: 'vize@paydostur.com', lower: true })}
      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Şifre (pass)</label>
        <div style={{ display: 'flex', gap: '6px', maxWidth: '380px' }}>
          <input type={showPass ? 'text' : 'password'} value={smtp.pass || ''} onChange={e => set({ pass: e.target.value })} placeholder="••••••••" style={{ flex: 1, padding: '10px 12px', background: '#0a1626', border: '1px solid rgba(20,184,166,0.3)', borderRadius: '8px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' }} />
          <button type="button" onClick={() => setShowPass(!showPass)} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>{showPass ? '🙈' : '👁️'}</button>
        </div>
      </div>
      {field('Gönderen Adresi (from)', 'from', { placeholder: 'vize@paydostur.com', lower: true })}
      <button onClick={() => showToast?.('SMTP ayarları kaydedildi', 'success')} style={{ marginTop: '6px', padding: '10px 20px', background: 'linear-gradient(135deg, #14b8a6, #0d9488)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>💾 Kaydet</button>
      <p style={{ margin: '10px 0 0', fontSize: '11px', color: '#f59e0b' }}>⚠️ Şifre veritabanında saklanır. Sadece yetkili kullanıcıların CRM'e eriştiğinden emin olun.</p>
    </div>
  );
}

export function MailSettingsPanel({ mode = 'visa', appSettings, setAppSettings, showToast }) {
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
    trHas(t.label, searchTerm) || trHas(t.cat, searchTerm)
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
      {mode === 'visa' && (
      <SmtpConfigCard appSettings={appSettings} setAppSettings={setAppSettings} showToast={showToast} settingsKey="smtpVisa" title="⚙️ Vize SMTP Yapılandırması" />
      )}

      {mode === 'tour' && (<>
      <SmtpConfigCard appSettings={appSettings} setAppSettings={setAppSettings} showToast={showToast} settingsKey="smtpTour" title="⚙️ Tur SMTP Yapılandırması" />

      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#e8f1f8' }}>✉️ Tur Maili Şablonu</h3>
        <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>
          Toplu mail gönderirken bu şablon varsayılan olarak yüklenir.<br/>
          Değişkenler: <code style={{ color: '#3b82f6' }}>{'{isim}'}</code> <code style={{ color: '#3b82f6' }}>{'{tur}'}</code> <code style={{ color: '#3b82f6' }}>{'{tarih}'}</code>
        </p>
        <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>📌 Mail Konusu</label>
        <input
          value={appSettings?.tourMailTemplate?.subject || ''}
          onChange={e => setAppSettings({ ...appSettings, tourMailTemplate: { ...(appSettings?.tourMailTemplate || {}), subject: e.target.value } })}
          placeholder="{tur} - Bilgilendirme"
          style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box', marginBottom: '12px' }}
        />
        <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>📝 Mail İçeriği</label>
        <textarea
          value={appSettings?.tourMailTemplate?.body || ''}
          onChange={e => setAppSettings({ ...appSettings, tourMailTemplate: { ...(appSettings?.tourMailTemplate || {}), body: e.target.value } })}
          rows={9}
          placeholder={"Sayın {isim},\n\n{tur} turumuz ({tarih}) ile ilgili bilgilendirme:\n\n\n\nSaygılarımızla,\nPaydos Turizm"}
          style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#e8f1f8' }}>🧪 Test Maili Gönder</h3>
        <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>Tur mail şablonunu örnek bilgilerle bir adrese gönder</p>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="test@ornek.com"
            style={{ flex: 1, padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px' }} />
          <button onClick={async () => {
            if (!testEmail.trim()) return;
            const tpl = appSettings?.tourMailTemplate || {};
            if (!tpl.subject && !tpl.body) { showToast?.('Önce şablon doldurun', 'error'); return; }
            setTestSending(true);
            const rep = (s) => (s || '').replace(/{isim}/g, 'Örnek Katılımcı').replace(/{tur}/g, 'Örnek Turu').replace(/{tarih}/g, new Date().toLocaleDateString('tr-TR'));
            const subject = rep(tpl.subject) || 'Tur Bilgilendirme';
            const bodyText = rep(tpl.body);
            const html = mailHtml(bodyText);
            try {
              const resp = await sendMailRequest({
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: testEmail.trim(), from: (appSettings?.smtpTour?.from || '').trim() || undefined, subject, html, text: bodyText, smtp: appSettings?.smtpTour })
              });
              if (resp.ok) showToast?.(`✅ Test maili gönderildi: ${testEmail}`, 'success');
              else { const d = await resp.json(); showToast?.(`❌ ${d.error || 'Gönderilemedi'}`, 'error'); }
            } catch (err) { showToast?.(`❌ ${err.message}`, 'error'); }
            finally { setTestSending(false); }
          }} disabled={testSending || !testEmail.trim()}
            style={{ padding: '10px 18px', background: testSending ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: '8px', color: 'white', cursor: testSending ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '13px', whiteSpace: 'nowrap' }}>
            {testSending ? '⏳ Gönderiliyor...' : '📤 Test Gönder'}
          </button>
        </div>
      </div>
      </>)}

      {mode === 'visa' && (<>
      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#e8f1f8' }}>🤖 Otomatik Evrak Mailleri</h3>
        <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#64748b' }}>15 dakikada bir kontrol edilir (08:00–21:00). E-postası olmayanlar Telegram vize grubuna yazılır. Kapalıyken gelen başvurulara, tekrar açınca geriye dönük mail gitmez.</p>
        {[
          { key: 'autoEmailOnVisa', title: '📧 Atama Bekliyor → evrak maili', desc: 'Durum Atama Bekliyor olunca vize türünün şablonu (aşağıda) ve bağlı ekleri gider.' },
          { key: 'autoSureliMail', title: '⏳ Randevu → süreli evrak maili', desc: "Schengen'de randevu tarihi girilince SGK / banka dökümü vb. süreli evraklar, randevuya göre hesaplanmış tarihlerle gider." },
        ].map(t => { const on = appSettings?.[t.key] !== false; return (
          <div key={t.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <div style={{ fontSize: '13px', color: '#e8f1f8', fontWeight: '600' }}>{t.title} <span style={{ fontSize: '11px', color: on ? '#14b8a6' : '#ef4444', marginLeft: '6px' }}>{on ? 'AÇIK' : 'KAPALI'}</span></div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{t.desc}</div>
            </div>
            <div onClick={() => setAppSettings({ ...appSettings, [t.key]: !on })}
              style={{ width: '48px', height: '26px', borderRadius: '13px', cursor: 'pointer', background: on ? '#14b8a6' : 'rgba(255,255,255,0.1)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
              <div style={{ position: 'absolute', top: '3px', left: on ? '25px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
            </div>
          </div>
        ); })}
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
      </>)}
    </div>
  );
}

// AYARLAR MODÜLÜ
// Kategori bazlı vize maliyet kalemleri + varsayılan değerleri (Schengen/Amerika/Rusya... ayrı)
export function VarsayilanMaliyetAyari({ appSettings, setAppSettings, isMobile }) {
  const kategoriler = VISA_COST_CATEGORIES;
  const [aktifKat, setAktifKat] = useState('schengen');
  const [aktifTur, setAktifTur] = useState(''); // '' = kategori varsayılanı, aksi halde vize türü adı
  const [yeniKalem, setYeniKalem] = useState('');
  const slugify = (s) => normalizeTr(s).replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''); // yalnız yeni kalem anahtarı üretir

  // Kategori bazlı kalemler. Eski düz dizi varsa ilk düzenlemede tüm kategorilere kopyalanır (geriye uyum).
  const rawItems = appSettings?.visaCostItems;
  const eskiDuz = Array.isArray(rawItems) ? rawItems : null;
  const katItemsAll = (rawItems && !Array.isArray(rawItems)) ? rawItems : {};
  const items = getVisaCostItems(appSettings, aktifKat);

  const tumDefs = appSettings?.visaCostDefaults || {};
  const tumCur = appSettings?.visaCostDefaultCurrency || {};
  const katDefs = tumDefs[aktifKat] || {};
  const katCur = tumCur[aktifKat] || '€';
  const turAdlari = (appSettings?.visaDurations?.[aktifKat] || []).map(d => (typeof d === 'string' ? d : d.name)).filter(Boolean);
  const tumTurDefs = appSettings?.visaCostTypeDefaults || {};
  const katTurDefs = tumTurDefs[aktifKat] || {};
  const turDefs = aktifTur ? (katTurDefs[aktifTur] || {}) : {};
  // Türe özel değer: boş bırakılırsa kategori varsayılanı kullanılır
  const setTurDeger = (key, val) => {
    const yeni = { ...turDefs };
    if (val === '' || val == null) delete yeni[key]; else yeni[key] = parseFloat(val) || 0;
    setAppSettings({ ...appSettings, visaCostTypeDefaults: { ...tumTurDefs, [aktifKat]: { ...katTurDefs, [aktifTur]: yeni } } });
  };

  const setKatItems = (yeni) => {
    const base = eskiDuz ? Object.fromEntries(kategoriler.map(k => [k.id, [...eskiDuz]])) : { ...katItemsAll };
    base[aktifKat] = yeni;
    setAppSettings({ ...appSettings, visaCostItems: base });
  };
  const setKatDeger = (key, val) => setAppSettings({ ...appSettings, visaCostDefaults: { ...tumDefs, [aktifKat]: { ...katDefs, [key]: parseFloat(val) || 0 } } });
  const setKatCur = (cur) => setAppSettings({ ...appSettings, visaCostDefaultCurrency: { ...tumCur, [aktifKat]: cur } });

  const kalemEkle = () => {
    const label = (yeniKalem || '').trim();
    if (!label) return;
    let key = slugify(label) || 'kalem_' + Date.now();
    if (items.some(it => it.key === key)) key = `${key}_${Date.now()}`;
    setKatItems([...items, { key, label }]);
    setYeniKalem('');
  };
  const katAd = kategoriler.find(k => k.id === aktifKat)?.label;

  return (
    <div style={{ background: 'rgba(16,185,129,0.06)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(16,185,129,0.2)' }}>
      <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#10b981' }}>💰 Vize Maliyet Kalemleri & Varsayılan Değerler</h3>
      <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>Her vize kategorisi için ayrı kalem listesi ve varsayılan değer. Yeni başvuruda kategori seçilince o kategorinin kalemleri + değerleri otomatik gelir.</p>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {kategoriler.map(k => (
          <button key={k.id} onClick={() => { setAktifKat(k.id); setAktifTur(''); }} style={{
            padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600',
            border: aktifKat === k.id ? '1px solid rgba(16,185,129,0.5)' : '1px solid rgba(255,255,255,0.1)',
            background: aktifKat === k.id ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.04)',
            color: aktifKat === k.id ? '#10b981' : '#94a3b8'
          }}>{k.icon} {k.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>{katAd} para birimi:</span>
        <select value={katCur} onChange={e => setKatCur(e.target.value)}
          style={{ padding: '6px 10px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
          <option value="€" style={{ background: '#0c1929' }}>€</option>
          <option value="$" style={{ background: '#0c1929' }}>$</option>
          <option value="£" style={{ background: '#0c1929' }}>£</option>
          <option value="₺" style={{ background: '#0c1929' }}>₺</option>
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>Değerler:</span>
        <select value={aktifTur} onChange={e => setAktifTur(e.target.value)}
          style={{ padding: '6px 10px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#fff', fontSize: '12px', cursor: 'pointer', maxWidth: '100%' }}>
          <option value="" style={{ background: '#0c1929' }}>{katAd} — tüm türler (varsayılan)</option>
          {turAdlari.map(t => (
            <option key={t} value={t} style={{ background: '#0c1929' }}>{t}{katTurDefs[t] && Object.keys(katTurDefs[t]).length ? ' ✎' : ''}</option>
          ))}
        </select>
        {aktifTur && <span style={{ fontSize: '11px', color: '#64748b' }}>Sadece farklı olan kalemi yazın; boş bırakılan kalem kategori varsayılanını kullanır.</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
        {items.map((it, idx) => (
          <div key={it.key + idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(16,185,129,0.06)', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(16,185,129,0.15)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <button onClick={() => { if (idx === 0) return; const n = [...items]; [n[idx-1], n[idx]] = [n[idx], n[idx-1]]; setKatItems(n); }} disabled={idx === 0} style={{ background: 'none', border: 'none', color: idx === 0 ? '#475569' : '#94a3b8', cursor: idx === 0 ? 'default' : 'pointer', fontSize: '10px', lineHeight: 1, padding: 0 }}>▲</button>
              <button onClick={() => { if (idx === items.length-1) return; const n = [...items]; [n[idx], n[idx+1]] = [n[idx+1], n[idx]]; setKatItems(n); }} disabled={idx === items.length-1} style={{ background: 'none', border: 'none', color: idx === items.length-1 ? '#475569' : '#94a3b8', cursor: idx === items.length-1 ? 'default' : 'pointer', fontSize: '10px', lineHeight: 1, padding: 0 }}>▼</button>
            </div>
            <input type="text" value={it.label} onChange={e => { const n = [...items]; n[idx] = { ...it, label: e.target.value }; setKatItems(n); }}
              style={{ flex: 1, minWidth: 0, padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', color: '#fff', fontSize: '12px' }} />
            {aktifTur ? (
              <input type="number" step="0.01" min="0" value={turDefs[it.key] ?? ''} onChange={e => setTurDeger(it.key, e.target.value)} placeholder={String(katDefs[it.key] ?? 0)}
                title="Boş = kategori varsayılanı"
                style={{ width: '90px', flexShrink: 0, padding: '6px 8px', background: turDefs[it.key] != null ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.05)', border: `1px solid ${turDefs[it.key] != null ? 'rgba(245,158,11,0.5)' : 'rgba(16,185,129,0.25)'}`, borderRadius: '5px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }} />
            ) : (
              <input type="number" step="0.01" min="0" value={katDefs[it.key] ?? ''} onChange={e => setKatDeger(it.key, e.target.value)} placeholder="0"
                style={{ width: '90px', flexShrink: 0, padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '5px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }} />
            )}
            <span style={{ fontSize: '11px', color: '#94a3b8', width: '14px', flexShrink: 0 }}>{katCur}</span>
            <button onClick={() => { if (!window.confirm(`"${it.label}" kalemini ${katAd} kategorisinden silmek istiyor musun?`)) return; setKatItems(items.filter((_, i) => i !== idx)); }} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '5px', padding: '4px 8px', color: '#ef4444', cursor: 'pointer', fontSize: '11px', flexShrink: 0 }}>🗑️</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <input type="text" value={yeniKalem} onChange={e => setYeniKalem(e.target.value)} placeholder={`${katAd} için yeni kalem (örn: Vize Sigortası)`}
          onKeyDown={e => { if (e.key === 'Enter') kalemEkle(); }}
          style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '12px' }} />
        <button onClick={kalemEkle} style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>➕ Ekle</button>
      </div>
    </div>
  );
}

// Ayarlar → ⚡ Kısayollarım: her kullanıcı Dashboard'daki hızlı düğmeleri kendisi seçer ve sıralar
export function ShortcutSettings({ currentUser, setCurrentUser, setUsers, showToast, isMobile }) {
  const [ids, setIds] = useState(() => userShortcuts(currentUser).map(x => x.id));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(ids) !== JSON.stringify(userShortcuts(currentUser).map(x => x.id));
  const move = (i, d) => setIds(a => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });
  const save = async (list) => {
    if (!currentUser) return;
    setBusy(true);
    try {
      await setDoc(doc(db, 'users', currentUser._docId || String(currentUser.id)), { shortcuts: list, updatedAt: new Date().toISOString() }, { merge: true });
      const u = { ...currentUser, shortcuts: list };
      setCurrentUser(u);
      try { localStorage.setItem('paydos_current_user', JSON.stringify(u)); } catch (e) { /* yok */ }
      setUsers?.(prev => (prev || []).map(x => x.id === currentUser.id ? { ...x, shortcuts: list } : x));
      setIds(list);
      showToast?.('⚡ Kısayollar kaydedildi', 'success');
    } catch (e) { showToast?.('Kaydedilemedi: ' + e.message, 'error'); }
    finally { setBusy(false); }
  };
  const chip = (x) => ({ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', borderRadius: '10px', background: `${x.color}14`, border: `1px solid ${x.color}44`, fontSize: '13px', color: '#e8f1f8' });
  const sm = { padding: '4px 9px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', cursor: 'pointer', fontSize: '12px' };
  const selected = ids.map(id => SHORTCUTS.find(x => x.id === id)).filter(Boolean);
  const rest = SHORTCUTS.filter(x => !ids.includes(x.id));
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: isMobile ? '16px' : '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '15px' }}>⚡ Dashboard kısayollarım</h3>
      <p style={{ margin: '0 0 16px', fontSize: '12px', color: '#64748b' }}>Bu liste yalnız sizin hesabınız için geçerlidir ({currentUser?.name || currentUser?.username || ''}). Diğer kullanıcılar kendi kısayollarını seçer.</p>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '18px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 700, marginBottom: '8px' }}>Dashboard'da görünenler ({selected.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {selected.map((x, i) => (
              <div key={x.id} style={chip(x)}>
                <span style={{ fontSize: '15px' }}>{x.icon}</span><span style={{ flex: 1 }}>{x.label}</span>
                <button onClick={() => move(i, -1)} disabled={i === 0} style={{ ...sm, opacity: i === 0 ? 0.35 : 1 }} title="Yukarı">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === selected.length - 1} style={{ ...sm, opacity: i === selected.length - 1 ? 0.35 : 1 }} title="Aşağı">↓</button>
                <button onClick={() => setIds(a => a.filter(y => y !== x.id))} style={{ ...sm, color: '#f87171' }} title="Kaldır">✕</button>
              </div>
            ))}
            {!selected.length && <div style={{ fontSize: '12px', color: '#64748b', padding: '10px', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: '10px' }}>Kısayol yok — Dashboard'da düğme görünmez. Sağdan ekleyin.</div>}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 700, marginBottom: '8px' }}>Eklenebilecekler</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {rest.map(x => (
              <button key={x.id} onClick={() => setIds(a => [...a, x.id])} style={{ ...chip(x), cursor: 'pointer', textAlign: 'left', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ fontSize: '15px' }}>{x.icon}</span><span style={{ flex: 1 }}>{x.label}</span><span style={{ color: '#10b981', fontWeight: 700 }}>＋</span>
              </button>
            ))}
            {!rest.length && <div style={{ fontSize: '12px', color: '#64748b' }}>Hepsi eklendi.</div>}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '18px', flexWrap: 'wrap' }}>
        <button onClick={() => save(ids)} disabled={busy || !dirty} style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', background: dirty ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'rgba(255,255,255,0.08)', color: dirty ? '#1a1a1a' : '#64748b', fontWeight: 700, cursor: dirty && !busy ? 'pointer' : 'default' }}>{busy ? 'Kaydediliyor…' : '💾 Kaydet'}</button>
        <button onClick={() => setIds(DEFAULT_SHORTCUTS)} style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>↺ Varsayılan</button>
      </div>
    </div>
  );
}

export function SettingsModule({ visaApplications, setVisaApplications, users, setUsers, currentUser, setCurrentUser, isMobile, appSettings, setAppSettings, showToast }) {
  const [activeTab, setActiveTab] = useState('users');
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userFormData, setUserFormData] = useState({});
  const [passwordData, setPasswordData] = useState({ current: '', new: '', confirm: '' });
  const [showPwForm, setShowPwForm] = useState(false); // şifre formu açılır/kapanır
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [newProcessor, setNewProcessor] = useState('');
  const [newPersonalField, setNewPersonalField] = useState('');
  const [newVisaStatus, setNewVisaStatus] = useState('');
  const [newSector, setNewSector] = useState('');
  const [newHotelRoomType, setNewHotelRoomType] = useState('');
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

      const updated = users.map(u => u.id === editingUser.id ? { ...u, ...updateData } : u);
      setUsers(updated);

      // Firestore'a gerçekten yaz
      try {
        const docId = editingUser._docId || String(editingUser.id);
        await setDoc(doc(db, 'users', docId), { ...updateData, id: editingUser.id, updatedAt: new Date().toISOString() }, { merge: true });
        showToast?.('Kullanıcı güncellendi', 'success');
      } catch (err) {
        showToast?.('Güncellenemedi: ' + err.message, 'error');
      }

      // Eğer kendi profilini güncelliyorsa currentUser'ı da güncelle
      if (currentUser.id === editingUser.id) {
        const updatedCurrentUser = { ...currentUser, ...updateData };
        setCurrentUser(updatedCurrentUser);
        localStorage.setItem('paydos_current_user', JSON.stringify(updatedCurrentUser));
      }

    } else {
      // Şifre Firestore'a yazılmaz — giriş Firebase Auth ile yapılır, hesap Firebase Console'dan açılır
      const { password: _pw, ...formNoPw } = userFormData;
      const newUser = { ...formNoPw, id: generateUniqueId(), createdAt: new Date().toISOString() };
      setUsers([...users, newUser]);
      // Firestore'a gerçekten yaz
      try {
        await setDoc(doc(db, 'users', String(newUser.id)), newUser, { merge: true });
        showToast?.('Kullanıcı eklendi', 'success');
      } catch (err) {
        showToast?.('Eklenemedi: ' + err.message, 'error');
      }
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
    const user = users.find(u => u.id === id);
    // Ekranda hemen kaldır
    setUsers(users.filter(u => u.id !== id));
    // Firestore'dan gerçekten sil
    try {
      const docId = user?._docId || String(id);
      await deleteDoc(doc(db, 'users', docId));
      showToast?.('Kullanıcı silindi', 'info');
    } catch (err) {
      showToast?.('Silinemedi: ' + err.message, 'error');
    }
  };

  // Şifre Firebase Auth üzerinde değişir (giriş Firebase Auth ile yapılıyor).
  // Eskiden sadece Firestore'daki düz metin şifre güncelleniyordu; giriş eski şifreyle devam ediyordu.
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.email) {
      setPasswordError('Oturum bulunamadı, çıkış yapıp tekrar giriş yapın.');
      return;
    }
    if (passwordData.new.length < 6) {
      setPasswordError('Yeni şifre en az 6 karakter olmalı');
      return;
    }
    if (passwordData.new !== passwordData.confirm) {
      setPasswordError('Yeni şifreler eşleşmiyor!');
      return;
    }

    try {
      await reauthenticateWithCredential(fbUser, EmailAuthProvider.credential(fbUser.email, passwordData.current));
      await updatePassword(fbUser, passwordData.new);
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') setPasswordError('Mevcut şifre yanlış!');
      else if (err.code === 'auth/weak-password') setPasswordError('Yeni şifre çok zayıf');
      else if (err.code === 'auth/too-many-requests') setPasswordError('Çok fazla deneme. Biraz bekleyin.');
      else setPasswordError('Şifre değiştirilemedi: ' + (err.code || err.message));
      return;
    }

    // Firestore/localStorage'da düz metin şifre tutma — varsa temizle
    const { password: _pw, ...cleanUser } = currentUser;
    setUsers(users.map(u => u.id === currentUser.id ? (({ password, ...rest }) => rest)(u) : u));
    setCurrentUser(cleanUser);
    localStorage.setItem('paydos_current_user', JSON.stringify(cleanUser));
    try { await setDoc(doc(db, 'users', currentUser._docId || String(currentUser.id)), { password: deleteField() }, { merge: true }); } catch (err) { /* profil dokümanı yoksa önemli değil */ }

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
        <button onClick={() => setActiveTab('shortcuts')} style={{ padding: '12px 16px', background: activeTab === 'shortcuts' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'shortcuts' ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'shortcuts' ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'shortcuts' ? '600' : '400' }}>
          ⚡ Kısayollarım
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
              📧 Vize Mail Ayarları
            </button>
            <button onClick={() => setActiveTab('attachmentSettings')} style={{ padding: '12px 16px', background: activeTab === 'attachmentSettings' ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'attachmentSettings' ? '1px solid rgba(168,85,247,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'attachmentSettings' ? '#a855f7' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'attachmentSettings' ? '600' : '400' }}>
              📎 Dosya Ekleri
            </button>
            <button onClick={() => setActiveTab('bankSettings')} style={{ padding: '12px 16px', background: activeTab === 'bankSettings' ? 'rgba(232,145,42,0.2)' : 'rgba(255,255,255,0.05)', border: activeTab === 'bankSettings' ? '1px solid rgba(232,145,42,0.3)' : '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: activeTab === 'bankSettings' ? '#e8912a' : '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === 'bankSettings' ? '600' : '400' }}>
              🏦 Banka Bilgileri
            </button>
          </>
        )}
      </div>

      {/* BANKA BİLGİLERİ */}
      {activeTab === 'bankSettings' && isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', color: '#e8912a' }}>🏦 Banka Bilgileri</h3>
              <button onClick={() => setAppSettings(prev => ({ ...prev, banks: [...(prev.banks || []), { id: Date.now(), bankName: '', branch: '', branchCode: '', swift: '', accounts: [{ currency: 'TL', iban: '', accountNo: '' }], showInDocs: false }] }))} style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '12px' }}>➕ Banka Ekle</button>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>Sözleşme ve proformalarda "belgelerde göster" işaretli bankalar yer alır. Her bankaya istediğiniz para biriminde hesap ekleyin.</p>
            {(appSettings?.banks || []).map((b, bi2) => {
              const setB = (patch) => setAppSettings(prev => ({ ...prev, banks: prev.banks.map((x, j) => j === bi2 ? { ...x, ...patch } : x) }));
              // Eski kayıtları hesap listesine çevir (geriye uyumluluk)
              const accs = Array.isArray(b.accounts) && b.accounts.length ? b.accounts : [
                ...(b.ibanTL ? [{ currency: 'TL', iban: b.ibanTL, accountNo: b.accountTL || '' }] : []),
                ...(b.ibanEUR ? [{ currency: 'EUR', iban: b.ibanEUR, accountNo: b.accountEUR || '' }] : []),
                ...(b.ibanUSD ? [{ currency: 'USD', iban: b.ibanUSD, accountNo: '' }] : []),
              ];
              const setAcc = (ai, patch) => setB({ accounts: accs.map((x, j) => j === ai ? { ...x, ...patch } : x) });
              const bi = { width: '100%', padding: '9px 11px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' };
              const bl = { display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' };
              return (
                <div key={b.id || bi2} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '12px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: b.showInDocs ? '#10b981' : '#64748b', cursor: 'pointer', fontWeight: '600' }}>
                      <input type="checkbox" checked={!!b.showInDocs} onChange={e => setB({ showInDocs: e.target.checked })} />
                      Belgelerde göster
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => {
                        const txt = [
                          `🏦 ${b.bankName || ''} ${b.branch || ''}`.trim(),
                          b.branchCode ? `Şube Kodu: ${b.branchCode}` : '',
                          b.swift ? `SWIFT: ${b.swift}` : '',
                          'Hesap Sahibi: Paydos Turizm Seyahat Acentalığı San. ve Tic. Ltd. Şti.',
                          ...accs.filter(a => a.iban).map(a => `${a.currency} IBAN: ${a.iban}${a.accountNo ? ` (Hesap: ${a.accountNo})` : ''}`)
                        ].filter(Boolean).join('\n');
                        navigator.clipboard.writeText(txt).then(() => showToast('Banka bilgileri kopyalandı', 'success')).catch(() => showToast('Kopyalanamadı', 'error'));
                      }} style={{ padding: '4px 10px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px' }}>📋 Kopyala</button>
                      <button onClick={() => {
                        const txt = [
                          `🏦 ${b.bankName || ''} ${b.branch || ''}`.trim(),
                          b.branchCode ? `Şube Kodu: ${b.branchCode}` : '',
                          b.swift ? `SWIFT: ${b.swift}` : '',
                          'Hesap Sahibi: Paydos Turizm Seyahat Acentalığı San. ve Tic. Ltd. Şti.',
                          ...accs.filter(a => a.iban).map(a => `${a.currency} IBAN: ${a.iban}`)
                        ].filter(Boolean).join('\n');
                        window.open(waUrl('', txt), '_blank');
                      }} style={{ padding: '4px 10px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '11px' }}>💬 WhatsApp</button>
                      {(appSettings.banks || []).length > 1 && <button onClick={() => { if (window.confirm('Bu bankayı silmek istiyor musunuz?')) setAppSettings(prev => ({ ...prev, banks: prev.banks.filter((_, j) => j !== bi2) })); }} style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}>🗑️ Sil</button>}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                    <div><label style={bl}>Banka Adı</label><input style={bi} value={b.bankName || ''} onChange={e => setB({ bankName: e.target.value })} /></div>
                    <div><label style={bl}>Şube</label><input style={bi} value={b.branch || ''} onChange={e => setB({ branch: e.target.value })} /></div>
                    <div><label style={bl}>Şube Kodu</label><input style={bi} value={b.branchCode || ''} onChange={e => setB({ branchCode: e.target.value })} /></div>
                    <div><label style={bl}>SWIFT</label><input style={bi} value={b.swift || ''} onChange={e => setB({ swift: e.target.value })} /></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ ...bl, marginBottom: 0 }}>Hesaplar (para birimi başına)</label>
                    <button onClick={() => setB({ accounts: [...accs, { currency: 'EUR', iban: '', accountNo: '' }] })} style={{ padding: '4px 10px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', color: '#3b82f6', cursor: 'pointer', fontSize: '11px' }}>➕ Hesap Ekle</button>
                  </div>
                  {accs.map((ac, ai) => (
                    <div key={ai} style={{ display: 'grid', gridTemplateColumns: isMobile ? '80px 1fr auto' : '90px 2fr 1fr auto', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                      <select style={bi} value={ac.currency} onChange={e => setAcc(ai, { currency: e.target.value })}>
                        {['TL','EUR','USD','GBP','CHF'].map(x => <option key={x} value={x} style={{ background: '#0c1929' }}>{x}</option>)}
                      </select>
                      <input style={bi} value={ac.iban || ''} onChange={e => setAcc(ai, { iban: e.target.value })} placeholder="IBAN" />
                      {!isMobile && <input style={bi} value={ac.accountNo || ''} onChange={e => setAcc(ai, { accountNo: e.target.value })} placeholder="Hesap No" />}
                      <button onClick={() => setB({ accounts: accs.filter((_, j) => j !== ai) })} style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}>×</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
            <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>Vize başvuru sürecinde kullanılan durum etiketleri. Sıra formda ve botta da aynıdır; <b style={{ color: '#10b981' }}>ilk durum yeni başvurunun varsayılanıdır</b>.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
              {(appSettings?.visaStatuses || []).map((status, idx, arr) => {
                const move = (d) => { const a = [...arr]; [a[idx], a[idx + d]] = [a[idx + d], a[idx]]; setAppSettings({ ...appSettings, visaStatuses: a }); };
                const rename = () => {
                  const nv = (window.prompt('Durumun yeni adı:', status) || '').trim();
                  if (!nv || nv === status) return;
                  // Bot/otomasyon bu adlara göre çalışır: "Atama Bekliyor" (atama + evrak maili), "Konsoloslukta" (süre takibi)
                  if (trHas(status, 'atama bekliyor', 'konsolos') && normalizeTr(nv) !== normalizeTr(status) && !window.confirm(`"${status}" adını bot ve otomatik mailler kullanıyor. Değiştirirseniz bu otomasyonlar çalışmaz. Yine de değiştirilsin mi?`)) return;
                  if (arr.some((x, i) => i !== idx && normalizeTr(x) === normalizeTr(nv))) { showToast?.('Bu adla bir durum zaten var', 'warning'); return; }
                  const n = (visaApplications || []).filter(v => v.status === status).length;
                  setAppSettings({ ...appSettings, visaStatuses: arr.map((x, i) => i === idx ? nv : x) });
                  // Bu durumdaki başvurular da yeni ada geçer (yoksa listede "bilinmeyen durum" kalırlar)
                  if (n) setVisaApplications?.(prev => prev.map(v => v.status === status ? { ...v, status: nv } : v));
                  showToast?.(`"${status}" → "${nv}"${n ? ` · ${n} başvuru güncellendi` : ''}`, 'success');
                };
                const btn = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px', color: '#cbd5e1', cursor: 'pointer', fontSize: '11px', padding: '2px 7px', lineHeight: 1.4 };
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: idx === 0 ? 'rgba(16,185,129,0.22)' : 'rgba(16,185,129,0.1)', padding: '6px 10px', borderRadius: '6px', border: `1px solid rgba(16,185,129,${idx === 0 ? 0.55 : 0.25})` }}>
                    <span style={{ fontSize: '11px', color: '#64748b', width: '16px' }}>{idx + 1}.</span>
                    <span style={{ flex: 1, fontSize: '12px', color: '#10b981', fontWeight: idx === 0 ? 700 : 400 }}>{status}{idx === 0 && <span style={{ marginLeft: '8px', fontSize: '10px', color: '#94a3b8', fontWeight: 400 }}>yeni başvuru varsayılanı</span>}</span>
                    <button type="button" title="Yukarı" disabled={idx === 0} onClick={() => move(-1)} style={{ ...btn, opacity: idx === 0 ? 0.3 : 1 }}>▲</button>
                    <button type="button" title="Aşağı" disabled={idx === arr.length - 1} onClick={() => move(1)} style={{ ...btn, opacity: idx === arr.length - 1 ? 0.3 : 1 }}>▼</button>
                    <button type="button" title="Adını değiştir (bu durumdaki başvurular da güncellenir)" onClick={rename} style={btn}>✏️</button>
                    <button type="button" title="Sil" onClick={() => setAppSettings({ ...appSettings, visaStatuses: arr.filter((_, i) => i !== idx) })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: 1 }}>×</button>
                  </div>
                );
              })}
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
              <details style={{ background: 'rgba(148,163,184,0.05)', borderRadius: '10px', border: '1px solid rgba(148,163,184,0.2)', padding: '12px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: '600', color: '#94a3b8', fontSize: '14px', listStyle: 'none' }}>
                  <span style={{ marginRight: '8px' }}>🌍</span>
                  Diğer ({(appSettings?.visaDurations?.other || []).length} tür)
                </summary>
                <div style={{ paddingLeft: '26px', marginTop: '10px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                    {(appSettings?.visaDurations?.other || []).map((d, idx) => {
                      const name = typeof d === 'string' ? d : d.name;
                      const price = typeof d === 'object' ? d.price : 0;
                      const currency = typeof d === 'object' ? d.currency : '€';
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(148,163,184,0.15)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(148,163,184,0.3)' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                            {name} {price > 0 && `• ${price} ${currency}`}
                          </span>
                          <button onClick={() => setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, other: appSettings.visaDurations.other.filter((_, i) => i !== idx) } })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <input type="text" value={newDuration.category === 'other' ? newDuration.value : ''} onChange={e => setNewDuration({ ...newDuration, category: 'other', value: e.target.value })} placeholder="Vize türü" style={{ flex: '1 1 120px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} />
                    <input type="number" value={newDuration.category === 'other' ? (newDuration.price || '') : ''} onChange={e => setNewDuration({ ...newDuration, category: 'other', price: Number(e.target.value) })} placeholder="Fiyat" style={{ width: '70px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }} />
                    <select value={newDuration.category === 'other' ? (newDuration.currency || '€') : '€'} onChange={e => setNewDuration({ ...newDuration, category: 'other', currency: e.target.value })} style={{ width: '50px', padding: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '11px' }}>
                      <option value="€">€</option>
                      <option value="$">$</option>
                      <option value="£">£</option>
                      <option value="₺">₺</option>
                    </select>
                    <button onClick={() => { if (newDuration.value && newDuration.value.trim()) { const newItem = { name: newDuration.value.trim(), price: newDuration.price || 0, currency: newDuration.currency || '€' }; setAppSettings({ ...appSettings, visaDurations: { ...appSettings.visaDurations, other: [...(appSettings.visaDurations?.other || []), newItem] } }); setNewDuration({ category: '', value: '', price: 0, currency: '€' }); } }} style={{ padding: '6px 10px', background: 'linear-gradient(135deg, #64748b, #475569)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>➕</button>
                  </div>
                </div>
              </details>
            </div>
          </div>

          <VarsayilanMaliyetAyari appSettings={appSettings} setAppSettings={setAppSettings} isMobile={isMobile} />
        </div>
      )}

      {/* 📊 DURUM YÖNETİMİ */}
      {activeTab === 'statusManagement' && isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Bildirim Ayarı */}
          <div style={{ background: 'rgba(59,130,246,0.06)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(59,130,246,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#3b82f6' }}>🔔 Canlı Bildirimler</h3>
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Başka bir cihazdan yeni kayıt (müşteri, tur, vize...) eklendiğinde sağ altta bildirim gösterir.</p>
              </div>
              <button onClick={() => { const yeni = appSettings?.notificationsEnabled === false; setAppSettings({ ...appSettings, notificationsEnabled: yeni }); showToast?.(yeni ? '🔔 Bildirimler açıldı' : '🔕 Bildirimler kapatıldı', 'info'); }}
                style={{ position: 'relative', width: '52px', height: '28px', borderRadius: '14px', border: 'none', cursor: 'pointer', background: appSettings?.notificationsEnabled === false ? 'rgba(255,255,255,0.15)' : '#3b82f6', transition: 'background 0.2s', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: '3px', left: appSettings?.notificationsEnabled === false ? '3px' : '27px', width: '22px', height: '22px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </button>
            </div>
          </div>

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

          {/* SEKTÖRLER */}
          {(() => {
            const sectorList = appSettings?.sectors || [];
            return (
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#f59e0b' }}>🏭 Sektörler</h3>
                <p style={{ margin: '0 0 14px', fontSize: '11px', color: '#64748b' }}>
                  Müşteri formunda ve filtrelerde görünen sektör listesi.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                  {sectorList.map((s, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(245,158,11,0.12)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.3)' }}>
                      <span style={{ fontSize: '12px', color: '#f59e0b' }}>{s}</span>
                      <button onClick={() => setAppSettings({ ...appSettings, sectors: sectorList.filter((_, i) => i !== idx) })}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" value={newSector} onChange={e => setNewSector(e.target.value)}
                    placeholder="Yeni sektör ekle..." onKeyPress={e => { if (e.key === 'Enter' && newSector.trim()) { setAppSettings({ ...appSettings, sectors: [...sectorList, newSector.trim()] }); setNewSector(''); } }}
                    style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '12px' }} />
                  <button onClick={() => { if (newSector.trim()) { setAppSettings({ ...appSettings, sectors: [...sectorList, newSector.trim()] }); setNewSector(''); } }}
                    style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                    ➕ Ekle
                  </button>
                </div>
              </div>
            );
          })()}

          {/* OTEL ODA TİPLERİ */}
          {(() => {
            const hotelRoomTypes = appSettings?.hotelRoomTypes || ['Single', 'Double', 'Triple', 'Suite'];
            return (
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#f59e0b' }}>🏨 Otel Oda Tipleri</h3>
                <p style={{ margin: '0 0 14px', fontSize: '11px', color: '#64748b' }}>
                  Otel formunda ve rezervasyonlarda kullanılacak oda tipleri (örn: Single, Double, Deluxe, Aile Süiti).
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                  {hotelRoomTypes.map((rt, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(139,92,246,0.12)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(139,92,246,0.3)' }}>
                      <span style={{ fontSize: '12px', color: '#a78bfa' }}>{rt}</span>
                      <button onClick={() => setAppSettings({ ...appSettings, hotelRoomTypes: hotelRoomTypes.filter((_, i) => i !== idx) })}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" value={newHotelRoomType || ''} onChange={e => setNewHotelRoomType(e.target.value)}
                    placeholder="Yeni oda tipi ekle..." onKeyPress={e => { if (e.key === 'Enter' && (newHotelRoomType || '').trim()) { setAppSettings({ ...appSettings, hotelRoomTypes: [...hotelRoomTypes, newHotelRoomType.trim()] }); setNewHotelRoomType(''); } }}
                    style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e8f1f8', fontSize: '12px' }} />
                  <button onClick={() => { if ((newHotelRoomType || '').trim()) { setAppSettings({ ...appSettings, hotelRoomTypes: [...hotelRoomTypes, newHotelRoomType.trim()] }); setNewHotelRoomType(''); } }}
                    style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                    ➕ Ekle
                  </button>
                </div>
              </div>
            );
          })()}

        </div>
      )}

      {/* ⚡ KISAYOLLARIM — kullanıcıya özel Dashboard kısayolları */}
      {activeTab === 'shortcuts' && <ShortcutSettings currentUser={currentUser} setCurrentUser={setCurrentUser} setUsers={setUsers} showToast={showToast} isMobile={isMobile} />}

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
              <div style={{ padding: '12px', background: 'rgba(0,136,204,0.1)', borderRadius: '10px', border: '1px solid rgba(0,136,204,0.25)', fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
                🔒 Bot yalnız kayıtlı Telegram grubunda çalışır{appSettings?.telegramVizeGrupId ? <>: <b style={{ color: '#e8f1f8' }}>{appSettings.telegramVizeGrupAdi || appSettings.telegramVizeGrupId}</b></> : ' — henüz kayıtlı grup yok, vize grubunda /grup yazın'}. Özelden yazanlara ve başka gruplara cevap vermez.
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
              <div style={{ padding: '14px', background: 'rgba(16,185,129,0.08)', borderRadius: '10px', border: '1px solid rgba(16,185,129,0.2)' }}>
                <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#10b981', fontWeight: '600' }}>
                  🔒 API Key güvenli şekilde sunucuda tutuluyor
                </p>
                <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8', lineHeight: '1.5' }}>
                  Claude API çağrıları artık Netlify Function üzerinden geçiyor. Tarayıcıda API key tutulmuyor, fatura riskine karşı korumalı.
                  <br/><br/>
                  <strong style={{ color: '#94a3b8' }}>Aktif olması için:</strong> Netlify → Site settings → Environment variables → <code style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '3px', fontSize: '10px' }}>CLAUDE_API_KEY</code> ekli olmalı.
                </p>
              </div>
              <div>
                <label style={labelStyle}>AI Modeli</label>
                <select
                  value={appSettings?.claudeModel || 'claude-sonnet-4-6'}
                  onChange={e => setAppSettings({ ...appSettings, claudeModel: e.target.value })}
                  style={selectStyle}
                >
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (Önerilen)</option>
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
      {/* 👤 PROFİL + ŞİFRE + KULLANICILAR — tek düzen */}
      {activeTab === 'users' && (() => {
        const roleOf = (r) => r === 'admin' ? { label: 'Yönetici', icon: '👑', color: '#a78bfa', bg: 'rgba(139,92,246,0.15)', grad: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' }
          : r === 'muhasebe' ? { label: 'Muhasebe', icon: '🧮', color: '#34d399', bg: 'rgba(16,185,129,0.15)', grad: 'linear-gradient(135deg, #10b981, #059669)' }
          : { label: 'Kullanıcı', icon: '👤', color: '#60a5fa', bg: 'rgba(59,130,246,0.15)', grad: 'linear-gradient(135deg, #3b82f6, #2563eb)' };
        const me = roleOf(currentUser?.role);
        const card = { background: 'rgba(255,255,255,0.03)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.07)' };
        const ghost = (c) => ({ padding: '8px 14px', background: `${c}1a`, border: `1px solid ${c}55`, borderRadius: '8px', color: c, cursor: 'pointer', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', fontFamily: 'inherit' });
        const pwIn = { width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' };
        return (<>
          {/* Profil */}
          <div style={{ ...card, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '20px', flexShrink: 0 }}>{currentUser?.name?.[0] || 'U'}</div>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '16px', fontWeight: '700', color: '#fff' }}>{currentUser?.name}</span>
                <span style={{ fontSize: '11px', padding: '2px 10px', borderRadius: '20px', background: me.bg, color: me.color }}>{me.icon} {me.label}</span>
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUser?.email}</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => openEditUser(currentUser)} style={ghost('#60a5fa')}>✏️ Profili düzenle</button>
              <button type="button" onClick={() => setShowPwForm(v => !v)} style={ghost('#f59e0b')}>{showPwForm ? '✕ Kapat' : '🔐 Şifre değiştir'}</button>
            </div>
          </div>

          {/* Şifre — tıklanınca açılır */}
          {(showPwForm || passwordError || passwordSuccess) && (
            <div style={{ ...card, padding: '16px 18px', marginTop: '12px' }}>
              {passwordError && <div style={{ background: 'rgba(239,68,68,0.12)', padding: '10px 12px', borderRadius: '8px', marginBottom: '12px', border: '1px solid rgba(239,68,68,0.3)', fontSize: '13px', color: '#f87171' }}>❌ {passwordError}</div>}
              {passwordSuccess && <div style={{ background: 'rgba(16,185,129,0.12)', padding: '10px 12px', borderRadius: '8px', marginBottom: '12px', border: '1px solid rgba(16,185,129,0.3)', fontSize: '13px', color: '#34d399' }}>✅ {passwordSuccess}</div>}
              {showPwForm && (
                <form onSubmit={handlePasswordChange} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
                  <div><label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Mevcut şifre</label><input type="password" autoComplete="current-password" value={passwordData.current} onChange={e => setPasswordData({ ...passwordData, current: e.target.value })} style={pwIn} required /></div>
                  <div><label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Yeni şifre</label><input type="password" autoComplete="new-password" value={passwordData.new} onChange={e => setPasswordData({ ...passwordData, new: e.target.value })} style={pwIn} required /></div>
                  <div><label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Yeni şifre (tekrar)</label><input type="password" autoComplete="new-password" value={passwordData.confirm} onChange={e => setPasswordData({ ...passwordData, confirm: e.target.value })} style={pwIn} required /></div>
                  <button type="submit" style={{ padding: '10px 18px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', borderRadius: '8px', color: '#0c1929', fontWeight: '700', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}>🔐 Değiştir</button>
                </form>
              )}
            </div>
          )}

          {/* Kullanıcılar (sadece yönetici) */}
          {isAdmin && (
            <div style={{ ...card, marginTop: '16px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '15px', fontWeight: '700', color: '#fff' }}>👥 Kullanıcılar <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '400' }}>({users.length})</span></div>
                <button type="button" onClick={openNewUserForm} style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '8px', padding: '8px 16px', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>➕ Yeni Kullanıcı</button>
              </div>
              {[...users].sort((x, y) => (x.id === currentUser.id ? -1 : y.id === currentUser.id ? 1 : 0) || (x.role === 'admin' ? -1 : 0) - (y.role === 'admin' ? -1 : 0) || String(x.name || '').localeCompare(String(y.name || ''), 'tr')).map(user => {
                const ri = roleOf(user.role);
                const isMe = user.id === currentUser.id;
                return (
                  <div key={user.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,0.05)', background: isMe ? 'rgba(245,158,11,0.05)' : 'transparent' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: ri.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '14px', flexShrink: 0 }}>{user.name?.[0] || 'U'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#e8f1f8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}{isMe && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#f59e0b' }}>(sen)</span>}</div>
                      <div style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
                    </div>
                    <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '20px', background: ri.bg, color: ri.color, flexShrink: 0, whiteSpace: 'nowrap' }}>{ri.icon} {ri.label}</span>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button type="button" title="Düzenle" onClick={() => openEditUser(user)} style={{ width: '32px', height: '32px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#60a5fa', cursor: 'pointer', fontSize: '13px' }}>✏️</button>
                      <button type="button" title={isMe ? 'Kendinizi silemezsiniz' : 'Sil'} disabled={isMe} onClick={() => !isMe && deleteUser(user.id)} style={{ width: '32px', height: '32px', background: isMe ? 'transparent' : 'rgba(239,68,68,0.1)', border: `1px solid ${isMe ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.3)'}`, borderRadius: '8px', color: '#ef4444', cursor: isMe ? 'default' : 'pointer', fontSize: '13px', opacity: isMe ? 0.25 : 1 }}>🗑️</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>);
      })()}

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
                <div style={{ padding: '10px 12px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '8px', fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
                  🔐 Giriş hesabı buradan açılmaz. Firebase Console → Authentication → Users → <b>Add user</b> ile bu e-postaya hesap açın; kullanıcı kendi şifresini Ayarlar → Profil'den değiştirir.
                </div>
                {isAdmin && editingUser?.id !== currentUser.id && (
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Rol</label>
                    <select value={userFormData.role || 'user'} onChange={e => setUserFormData({...userFormData, role: e.target.value})} style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '14px' }}>
                      <option value="user">Kullanıcı</option>
                      <option value="muhasebe">Muhasebe</option>
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

      {activeTab === 'tourSettings' && (
        <div style={{ marginTop: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#f59e0b' }}>💬 Belge Linki Mesajı</h3>
          <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#64748b' }}>Tur rezervasyonunda 🔗 ile link paylaşırken WhatsApp'a giden hazır metin. Kullanılabilir: <b>{'{isim}'}</b> müşteri adı, <b>{'{tur}'}</b> tur adı, <b>{'{belgeler}'}</b> belge listesi, <b>{'{link}'}</b> link. Her gönderimde pencerede ayrıca düzenlenebilir.</p>
          <textarea value={appSettings?.shareMessageTemplate || DEFAULT_SHARE_MSG} onChange={e => setAppSettings({ ...appSettings, shareMessageTemplate: e.target.value })} rows={7}
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', lineHeight: 1.45, fontFamily: 'inherit', resize: 'vertical', marginBottom: '6px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {!(appSettings?.shareMessageTemplate || DEFAULT_SHARE_MSG).includes('{link}') ? <span style={{ fontSize: '11px', color: '#f59e0b' }}>⚠️ {'{link}'} yok — link mesajın sonuna eklenir</span> : <span />}
            <button onClick={() => setAppSettings({ ...appSettings, shareMessageTemplate: '' })} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>↺ Varsayılana dön</button>
          </div>
          <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#f59e0b' }}>📞 Belge Linkinde İletişim</h3>
          <p style={{ margin: '0 0 14px', fontSize: '11px', color: '#64748b' }}>Müşteriye gönderilen tur linkinin altındaki "Yardıma mı ihtiyacınız var?" kartında görünür. Değişiklik, link yeniden paylaşılınca yansır.</p>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px' }}>
            <div><label style={{ fontSize: '11px', color: '#94a3b8' }}>Aranacak telefon</label>
              <input value={appSettings?.shareContact?.phone ?? '+90 258 263 71 76'} onChange={e => setAppSettings({ ...appSettings, shareContact: { ...(appSettings?.shareContact || {}), phone: e.target.value } })} placeholder="+90 258 263 71 76" style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' }} /></div>
            <div><label style={{ fontSize: '11px', color: '#94a3b8' }}>WhatsApp numarası — müşteri linkindeki WhatsApp düğmesi bu numarayı açar (eski linkler dahil; boşsa düğme çıkmaz)</label>
              <input value={appSettings?.shareContact?.whatsapp || ''} onChange={e => setAppSettings({ ...appSettings, shareContact: { ...(appSettings?.shareContact || {}), whatsapp: e.target.value } })} placeholder="+90 5xx xxx xx xx" style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' }} /></div>
            <div><label style={{ fontSize: '11px', color: '#94a3b8' }}>Instagram kullanıcı adı (boşsa "Takip et" butonu çıkmaz)</label>
              <input value={appSettings?.shareContact?.instagram ?? 'paydostur'} onChange={e => setAppSettings({ ...appSettings, shareContact: { ...(appSettings?.shareContact || {}), instagram: e.target.value.replace(/^.*instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#\s].*$/, '') } })} placeholder="paydostur" style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' }} /></div>
            <div><label style={{ fontSize: '11px', color: '#94a3b8' }}>Çalışma saatleri (boşsa gösterilmez)</label>
              <input value={appSettings?.shareContact?.hours || ''} onChange={e => setAppSettings({ ...appSettings, shareContact: { ...(appSettings?.shareContact || {}), hours: e.target.value.slice(0, 120) } })} placeholder="Hafta içi 09:00–18:00 · Cumartesi 09:00–13:00" style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e8f1f8', fontSize: '13px', boxSizing: 'border-box' }} /></div>
          </div>
        </div>
      )}

      {/* MAIL AYARLARI */}
      {activeTab === 'mailSettings' && isAdmin && (
        <MailSettingsPanel mode="visa" appSettings={appSettings} setAppSettings={setAppSettings} showToast={showToast} />
      )}

      {/* TUR MAIL AYARLARI — Turlar sekmesinin altında (ayrı sekme kaldırıldı) */}
      {(activeTab === 'tourSettings' || activeTab === 'tourMailSettings') && isAdmin && (
        <div style={{ marginTop: '20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: '#3b82f6' }}>📧 Tur Mail Ayarları</h3>
          <MailSettingsPanel mode="tour" appSettings={appSettings} setAppSettings={setAppSettings} showToast={showToast} />
        </div>
      )}

      {/* DOSYA EKLERİ */}
      {activeTab === 'attachmentSettings' && isAdmin && (
        <AttachmentSettingsPanel appSettings={appSettings} setAppSettings={setAppSettings} showToast={showToast} />
      )}

    </div>
  );
}
