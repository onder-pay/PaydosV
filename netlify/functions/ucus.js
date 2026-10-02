// Netlify Function: ucus
// Tur linkindeki kalkış tabelası için uçuşun canlı bilgisi: kapı, terminal, check-in kontuarı, durum, yeni saat.
// Kaynak: AeroDataBox (RapidAPI). Anahtar Netlify env'de: AERODATABOX_KEY. Anahtar yoksa {ok:false} döner,
// tabela bilet bilgisiyle (saat, uçuş, nereye) çalışmaya devam eder.
//
// Kota koruması: cevap Netlify CDN'de 10 dk saklanır (aynı uçuşa bakan 40 yolcu = 1 sorgu). Sadece bugün ±2 gün
// içindeki uçuşlar sorgulanır; uçuş kodu ve tarih dışında hiçbir girdi kabul edilmez.
const KEY = process.env.AERODATABOX_KEY || '';
const json = (body, maxAge) => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=60',
    'Netlify-CDN-Cache-Control': `public, s-maxage=${maxAge}, durable`,
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const code = String(q.c || '').toUpperCase().replace(/\s/g, '');
  const date = String(q.d || '');
  const from = String(q.f || '').toUpperCase();
  if (!/^[A-Z0-9]{2}\d{1,4}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (from && !/^[A-Z]{3}$/.test(from))) {
    return { statusCode: 400, body: 'Geçersiz istek' };
  }
  if (!KEY) return json({ ok: false, reason: 'nokey' }, 3600);
  const diff = Math.abs(Date.parse(date + 'T12:00:00Z') - Date.now()) / 86400000;
  if (!(diff <= 2.5)) return json({ ok: false, reason: 'far' }, 3600);
  try {
    const r = await fetch(`https://aerodatabox.p.rapidapi.com/flights/number/${code}/${date}?withAircraftImage=false&withLocation=false`, {
      headers: { 'X-RapidAPI-Key': KEY, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' },
    });
    if (r.status === 204 || r.status === 404) return json({ ok: false, reason: 'notfound' }, 900);
    if (!r.ok) { console.warn('[ucus] api', r.status); return json({ ok: false, reason: 'api' }, 120); }
    const list = await r.json().catch(() => []);
    const all = Array.isArray(list) ? list : [];
    const x = all.find(f => from && f.departure?.airport?.iata === from) || all[0];
    if (!x) return json({ ok: false, reason: 'notfound' }, 900);
    const dep = x.departure || {};
    const t = (v) => (v && (v.local || v.utc)) || '';
    return json({
      ok: true, status: String(x.status || ''), gate: String(dep.gate || ''), terminal: String(dep.terminal || ''),
      desk: String(dep.checkInDesk || ''), sched: t(dep.scheduledTime), revised: t(dep.revisedTime) || t(dep.predictedTime),
      updated: new Date().toISOString(),
    }, 600);
  } catch (e) {
    console.warn('[ucus] hata', e.message);
    return json({ ok: false, reason: 'error' }, 120);
  }
};
