// Netlify Function: ucak
// Müşteri linkindeki (/m/<kod>) canlı uçuş haritası için uçağın anlık konumu.
// Kaynak: adsb.lol (açık kaynak, gönüllü ADS-B alıcıları; veri ODbL — sayfada kaynak belirtilir).
// Tarayıcı doğrudan çağırmaz: CORS'a takılmasın ve aynı uçuşa bakan herkes tek sorguyu paylaşsın diye
// cevap Netlify CDN'de 10 sn saklanır. Sadece çağrı kodu (ör. PGT1234) alınır, başka adres kurulmaz.

exports.handler = async (event) => {
  const cs = String((event.queryStringParameters || {}).cs || '').toUpperCase();
  if (!/^[A-Z]{3}[0-9][0-9A-Z]{0,4}$/.test(cs)) return { statusCode: 400, body: 'Geçersiz çağrı kodu' };
  try {
    const r = await fetch(`https://api.adsb.lol/v2/callsign/${cs}`, { headers: { 'User-Agent': 'PaydosTurizm/1.0 (crm.paydostur.com)' } });
    if (!r.ok) throw new Error('adsb ' + r.status);
    const j = await r.json();
    // Aynı çağrı kodunda birden fazla kayıt olabilir: en taze konumu al
    const list = (j.ac || []).filter(a => typeof a.lat === 'number' && typeof a.lon === 'number')
      .sort((a, b) => (a.seen_pos ?? a.seen ?? 999) - (b.seen_pos ?? b.seen ?? 999));
    const a = list[0];
    const body = a ? {
      found: true,
      lat: a.lat, lon: a.lon,
      ground: a.alt_baro === 'ground',
      altM: typeof a.alt_baro === 'number' ? Math.round(a.alt_baro * 0.3048) : null, // ft → m
      kmh: typeof a.gs === 'number' ? Math.round(a.gs * 1.852) : null,              // knot → km/sa
      track: typeof a.track === 'number' ? a.track : (typeof a.true_heading === 'number' ? a.true_heading : null),
      type: a.t || '', reg: a.r || '',
      seen: Math.round(a.seen_pos ?? a.seen ?? 0),
    } : { found: false };
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=10',
      },
      body: JSON.stringify(body),
    };
  } catch (e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ found: false, error: 'Konum alınamadı' }) };
  }
};
