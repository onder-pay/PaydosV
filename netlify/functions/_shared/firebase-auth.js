// Firebase ID token doğrulama — send-mail ve claude-proxy ortak kullanır
const crypto = require('crypto');

// Firebase projesi — ID token'ın bu projeye ait olduğu doğrulanır
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'paydos-crm';
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let certCache = { certs: null, expires: 0 };

const getGoogleCerts = async () => {
  if (certCache.certs && Date.now() < certCache.expires) return certCache.certs;
  const resp = await fetch(GOOGLE_CERTS_URL);
  if (!resp.ok) throw new Error('Google sertifikaları alınamadı');
  const maxAge = parseInt(((resp.headers.get('cache-control') || '').match(/max-age=(\d+)/) || [])[1] || '3600', 10);
  certCache = { certs: await resp.json(), expires: Date.now() + maxAge * 1000 };
  return certCache.certs;
};

const b64urlJson = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

// İstekteki Firebase ID token'ı Google'ın imza sertifikalarıyla yerelde doğrular (API anahtarı gerekmez —
// anahtardaki referer kısıtı sunucu isteklerini engelliyordu). Geçerliyse kullanıcı e-postası/uid döner.
// Bu kontrol olmadan fonksiyon, SMTP hesabınızı kullanan herkese açık bir mail rölesidir.
const verifyFirebaseUser = async (event) => {
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    if (header.alg !== 'RS256') return null;
    const certs = await getGoogleCerts();
    const cert = certs[header.kid];
    if (!cert) return null;
    const ok = crypto.createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(cert, Buffer.from(parts[2], 'base64url'));
    if (!ok) return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== FIREBASE_PROJECT_ID) return null;
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
    if (!payload.sub || payload.exp <= now || payload.iat > now + 300) return null;
    return payload.email || payload.sub;
  } catch {
    return null;
  }
};

module.exports = { verifyFirebaseUser };
