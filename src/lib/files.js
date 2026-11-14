// Dosya indirme: Firebase Storage/base64 görseli dosya olarak indir, çok dosyayı ZIP'le. Müşterinin pasaport görseli.
import { safeParseJSON } from './format.js';
import { asciiTr } from './turkish.js';
// Müşterinin en son pasaport görseli (Storage adresi ya da eski base64) — yoksa ''
export const passportImageOf = (c) => {
  const pp = safeParseJSON(c?.passports).filter(p => p && p.image && (/^https:\/\//.test(p.image) || /^data:image\//.test(p.image)));
  if (!pp.length) return '';
  pp.sort((a, b) => String(b.expiryDate || '').localeCompare(String(a.expiryDate || '')));
  return pp[0].image;
};

// Dosya adı: ASCII, boşluk/işaret yerine alt çizgi ("Önder Taşçı" → "Onder_Tasci"); şapkalı/aksanlı harfler sade harfe ("Mekân" → "Mekan")
export const safeFileName = (s) => asciiTr(String(s || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'dosya';
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };
// Adresteki dosyayı indirir (Storage adresi ya da data: görsel). Döner: { blob, ext }
export const fetchFile = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error('dosya indirilemedi (' + r.status + ')');
  const blob = await r.blob();
  return { blob, ext: EXT[blob.type] || (String(url).match(/\.(jpe?g|png|webp|pdf)(\?|$)/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg') };
};
export const saveBlob = (blob, name) => {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
};
// Tek dosya: name uzantısız verilir, uzantı dosya türünden eklenir
export const downloadUrl = async (url, name) => { const { blob, ext } = await fetchFile(url); saveBlob(blob, `${safeFileName(name)}.${ext}`); };
// JSZip (CDN'den, ilk kullanımda)
export const loadJSZip = () => new Promise((resolve, reject) => {
  if (window.JSZip) return resolve(window.JSZip);
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  s.onload = () => resolve(window.JSZip);
  s.onerror = () => reject(new Error('JSZip yüklenemedi'));
  document.head.appendChild(s);
});
