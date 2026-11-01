// Banka hesapları (Ayarlar → Banka Bilgileri): eski tek-banka kaydı ve yeni çoklu liste aynı biçime getirilir

export const normalizeBank = (b) => {
  b = b || {};
  // accounts dizisi yoksa eski alanlardan üret; varsa ibanTL/EUR/USD alanlarını accounts'tan doldur (belge üreticileri için)
  const accounts = Array.isArray(b.accounts) && b.accounts.length ? b.accounts.filter(a => a.iban) : [
    ...(b.ibanTL ? [{ currency: 'TL', iban: b.ibanTL, accountNo: b.accountTL || '' }] : []),
    ...(b.ibanEUR ? [{ currency: 'EUR', iban: b.ibanEUR, accountNo: b.accountEUR || '' }] : []),
    ...(b.ibanUSD ? [{ currency: 'USD', iban: b.ibanUSD, accountNo: '' }] : []),
  ];
  const byC = (c) => accounts.find(a => a.currency === c);
  return { ...b, accounts,
    bankName: b.bankName || '', branch: b.branch || '', branchCode: b.branchCode || '', swift: b.swift || '',
    ibanTL: byC('TL')?.iban || b.ibanTL || '', accountTL: byC('TL')?.accountNo || b.accountTL || '',
    ibanEUR: byC('EUR')?.iban || b.ibanEUR || '', accountEUR: byC('EUR')?.accountNo || b.accountEUR || '',
    ibanUSD: byC('USD')?.iban || b.ibanUSD || '' };
};

export const getActiveBanks = (settings) => {
  const hasData = (b) => b.bankName || b.ibanTL || b.ibanEUR || (Array.isArray(b.accounts) && b.accounts.some(a => a.iban));
  const banks = Array.isArray(settings?.banks) ? settings.banks.filter(hasData) : [];
  // Önce "belgelerde göster" işaretliler; hiç işaretli yoksa ilk dolu bankayı kullan
  const flagged = banks.filter(b => b.showInDocs);
  const use = flagged.length ? flagged : banks;
  if (use.length) return use.map(normalizeBank);
  return [normalizeBank(DEFAULT_BANK)];
};

export const DEFAULT_BANK = {
  bankName: 'Garanti Bankası A.Ş.', branch: 'Denizli Çınar Şubesi', branchCode: '781', swift: 'TGBATRIS',
  ibanTL: 'TR40 0006 2000 7810 0006 2962 46', accountTL: '0006 2962 46',
  ibanEUR: 'TR73 0006 2000 7810 0009 0910 95', accountEUR: '0009 0910 95'
};
