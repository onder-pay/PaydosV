// 🏦 Banka Bilgileri modülü
import { useState, useEffect } from 'react';
import { getActiveBanks } from '../lib/banks.js';

export function BankInfoModule({ appSettings, showToast, isMobile }) {
  const banks = getActiveBanks(appSettings);
  const kopyala = (txt, etiket) => {
    navigator.clipboard?.writeText(txt).then(() => showToast?.(`${etiket} kopyalandı`, 'success')).catch(() => showToast?.('Kopyalanamadı', 'error'));
  };
  return (
    <div style={{ padding: isMobile ? '16px' : '24px', maxWidth: '900px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '20px', margin: '0 0 6px', color: '#fff' }}>🏦 Banka Bilgileri</h2>
      <p style={{ fontSize: '13px', color: '#94a3b8', margin: '0 0 20px' }}>Ayarlar'da "belgelerde göster" işaretli bankalar. Müşteriye göndermek için kopyalayın.</p>
      {(!banks || banks.length === 0) ? (
        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '40px', textAlign: 'center' }}>
          <span style={{ fontSize: '42px' }}>🏦</span>
          <p style={{ color: '#64748b', marginTop: '12px' }}>Kayıtlı banka yok. Ayarlar → Banka Bilgileri'nden ekleyin.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
          {banks.map((b, bi) => {
            const satirlar = [
              { et: 'TL', iban: b.ibanTL },
              { et: 'EUR', iban: b.ibanEUR },
              { et: 'USD', iban: b.ibanUSD }
            ].filter(x => x.iban);
            if (!satirlar.length) return null;
            return (
              <div key={bi} style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '14px', padding: '18px' }}>
                <div style={{ fontSize: '15px', fontWeight: '700', color: '#e8f1f8', marginBottom: '2px' }}>
                  {b.bankName}{b.branch ? ` — ${b.branch}` : ''}
                </div>
                {b.accountName && <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>{b.accountName}</div>}
                {satirlar.map(({ et, iban }) => (
                  <div key={et} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '8px 10px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', width: '36px', flexShrink: 0, fontWeight: '700' }}>{et}</span>
                    <span style={{ flex: 1, fontSize: '13px', color: '#e8f1f8', fontFamily: 'monospace', wordBreak: 'break-all' }}>{iban}</span>
                    <button onClick={() => kopyala(iban, `${et} IBAN`)} style={{ flexShrink: 0, padding: '6px 12px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '7px', color: '#3b82f6', cursor: 'pointer', fontSize: '12px' }}>📋</button>
                  </div>
                ))}
                {b.swift && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px' }}>SWIFT: {b.swift}</div>}
                <button onClick={() => kopyala(
                  `${b.bankName}${b.branch ? ' — ' + b.branch : ''}\n${b.accountName || ''}\n` +
                  satirlar.map(({ et, iban }) => `${et}: ${iban}`).join('\n') + (b.swift ? `\nSWIFT: ${b.swift}` : ''),
                  'Banka bilgileri'
                )} style={{ marginTop: '12px', width: '100%', padding: '10px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '9px', color: '#3b82f6', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>📋 Tümünü Kopyala</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
