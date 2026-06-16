// netlify/functions/claude-proxy.js
// Claude API'yi sunucu tarafında çağırır, API key'i tarayıcıdan gizler

// İzin verilen origin'ler (sadece kendi sitelerin)
const ALLOWED_ORIGINS = [
  'https://paydosv.netlify.app',
  'https://paydoscrm.netlify.app',
  'http://localhost:5173',  // Vite dev server
  'http://localhost:3000',
  'http://localhost:8888'   // Netlify dev
];

// İzin verilen Claude modelleri (whitelist) — Haziran 2026 güncel modeller
const ALLOWED_MODELS = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001'
];

const MAX_TOKENS_CAP = 2000; // max_tokens üst limit
const MAX_BODY_SIZE = 6 * 1024 * 1024; // 6MB (pasaport görseli için yeterli)

// Basit in-memory rate limit (warm instance'da çalışır)
const rateLimitMap = new Map();
const RATE_LIMIT = 30; // dakikada istek
const WINDOW_MS = 60 * 1000;

const checkRateLimit = (ip) => {
  const now = Date.now();
  const entries = rateLimitMap.get(ip) || [];
  const recent = entries.filter(t => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimitMap.set(ip, recent);
  // Cleanup: çok büyürse temizle
  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (v[v.length - 1] < now - WINDOW_MS) rateLimitMap.delete(k);
    }
  }
  return true;
};

const buildHeaders = (origin) => {
  // Origin allowlist kontrolü
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
};

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = buildHeaders(origin);

  // OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  // Origin kontrolü - izin verilmeyen origin'leri reddet
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Origin not allowed' })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'CLAUDE_API_KEY env var Netlify\'da tanımlı değil' })
    };
  }

  // Body boyutu kontrolü
  if (event.body && event.body.length > MAX_BODY_SIZE) {
    return {
      statusCode: 413,
      headers,
      body: JSON.stringify({ error: 'İstek çok büyük (max 6MB)' })
    };
  }

  // Rate limit
  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
          || event.headers['client-ip']
          || 'unknown';
  if (!checkRateLimit(ip)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Çok fazla istek. Lütfen 1 dakika bekleyin.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Geçersiz JSON' })
    };
  }

  // === BODY VALIDATION ===

  // Model kontrolü
  if (!body.model || !ALLOWED_MODELS.includes(body.model)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: `Geçersiz model: ${body.model}. İzin verilen: ${ALLOWED_MODELS.join(', ')}`
      })
    };
  }

  // max_tokens kontrolü
  if (typeof body.max_tokens !== 'number' || body.max_tokens < 1) {
    body.max_tokens = 1000;
  }
  if (body.max_tokens > MAX_TOKENS_CAP) {
    body.max_tokens = MAX_TOKENS_CAP;
  }

  // messages kontrolü
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'messages alanı zorunlu (array)' })
    };
  }
  if (body.messages.length > 20) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Maksimum 20 mesaj kabul edilir' })
    };
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error('Anthropic error:', data);
      return {
        statusCode: resp.status,
        headers,
        body: JSON.stringify({ error: data.error?.message || 'API hatası', details: data })
      };
    }

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error('Proxy hatası:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
