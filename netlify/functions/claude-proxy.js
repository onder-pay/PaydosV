// netlify/functions/claude-proxy.js
// Claude API'yi sunucu tarafında çağırır, API key'i tarayıcıdan gizler

// Basit rate limit: IP başına dakikada 30 istek
const rateLimitMap = new Map();
const RATE_LIMIT = 30; // dakika başına istek
const WINDOW_MS = 60 * 1000; // 1 dakika

const checkRateLimit = (ip) => {
  const now = Date.now();
  const entries = rateLimitMap.get(ip) || [];
  const recent = entries.filter(t => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return true;
};

exports.handler = async (event) => {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
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

  try {
    const body = JSON.parse(event.body);

    // İstek payload'ını Anthropic'e gönder
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
