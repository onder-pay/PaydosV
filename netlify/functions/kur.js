// Netlify Function: kur
// Belge linkindeki "Para birimi" kartı için TCMB (Merkez Bankası) günlük kurları.
// Tarayıcı TCMB'yi doğrudan okuyamaz (CORS), bu yüzden burada okunup JSON'a çevrilir.
// Cevap Netlify CDN'de 1 saat saklanır: her müşteri açılışında fonksiyon çalışmaz.
// Yolcunun döviz bürosunda ödeyeceğine en yakın değer "efektif satış"; yoksa "döviz satış" kullanılır.

const TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';

const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : '';
};

exports.handler = async () => {
  try {
    const r = await fetch(TCMB_URL, { headers: { 'User-Agent': 'Mozilla/5.0 PaydosCRM' } });
    if (!r.ok) throw new Error('tcmb ' + r.status);
    const xml = await r.text();
    const date = (xml.match(/Tarih="([^"]+)"/) || [])[1] || '';
    const rates = {};
    const re = /<Currency\b[^>]*CurrencyCode="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Currency>/g;
    let m;
    while ((m = re.exec(xml))) {
      const unit = parseInt(pick(m[2], 'Unit'), 10) || 1;
      const sell = parseFloat(pick(m[2], 'BanknoteSelling')) || parseFloat(pick(m[2], 'ForexSelling'));
      if (sell > 0) rates[m[1]] = +(sell / unit).toFixed(6); // 1 birim yabancı para = ? TL
    }
    if (!Object.keys(rates).length) throw new Error('bos');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=1800',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
      body: JSON.stringify({ source: 'TCMB', date, rates }),
    };
  } catch (e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Kur alınamadı' }) };
  }
};
