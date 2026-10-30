// PDF yardımcıları: Türkçe font, PDF okuma (pdf.js), sayfa ayırma/birleştirme (pdf-lib), HTML→PDF
import { jsPDF, dejavuFont } from './heavy.js';
import { asciiTr } from './turkish.js';

// jsPDF'e Türkçe destekli font (DejaVu Sans alt kümesi, normal + kalın) ekler ve aktif eder.
// Başarılıysa true döner; o durumda metinler Türkçe karakterleriyle olduğu gibi yazılabilir.
export const enableTurkishFont = (doc) => {
  try {
    const f = dejavuFont();
    if (!f) return false;
    const { DEJAVU_TR_B64, DEJAVU_TR_BOLD_B64 } = f;
    doc.addFileToVFS('DejaVuSans-TR.ttf', DEJAVU_TR_B64);
    doc.addFont('DejaVuSans-TR.ttf', 'DejaVuTR', 'normal');
    doc.addFileToVFS('DejaVuSans-TR-Bold.ttf', DEJAVU_TR_BOLD_B64);
    doc.addFont('DejaVuSans-TR-Bold.ttf', 'DejaVuTR', 'bold');
    doc.setFont('DejaVuTR', 'normal');
    return true;
  } catch (e) { console.warn('Türkçe font yüklenemedi:', e.message); return false; }
};

// Yeni bir jsPDF belgesi için Türkçe fontu açar ve uygun metin dönüştürücüyü döner
export const pdfText = (doc) => enableTurkishFont(doc) ? (t) => (t == null ? '' : String(t)) : asciiTr;

// html2canvas'ı CDN'den yükle (global — tüm modüller kullanır)
export const loadHtml2Canvas = () => new Promise((resolve, reject) => {
  if (window.html2canvas) return resolve(window.html2canvas);
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  s.onload = () => resolve(window.html2canvas);
  s.onerror = () => reject(new Error('html2canvas yüklenemedi'));
  document.head.appendChild(s);
});

// pdf.js'i CDN'den yükle — PDF içindeki metni tarayıcıda okumak için (toplu bilet eşleştirme)
export const PDFJS_VER = '3.11.174';

export const loadPdfJs = () => new Promise((resolve, reject) => {
  if (window.pdfjsLib) return resolve(window.pdfjsLib);
  const s = document.createElement('script');
  s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.min.js`;
  s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.worker.min.js`; resolve(window.pdfjsLib); };
  s.onerror = () => reject(new Error('pdf.js yüklenemedi'));
  document.head.appendChild(s);
});

// Sayfa sayfa metin (biniş kartı gibi kişi başı sayfalı PDF'leri ayırmak için)
export const pdfPagesText = async (file, max = 80) => {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(pdf.numPages, max); i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out.push(tc.items.map(it => it.str).join(' '));
  }
  return out;
};

// pdf-lib (CDN) — PDF'ten seçili sayfaları yeni PDF olarak çıkarmak için
export const loadPdfLib = () => new Promise((resolve, reject) => {
  if (window.PDFLib) return resolve(window.PDFLib);
  const sc = document.createElement('script');
  sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
  sc.onload = () => window.PDFLib ? resolve(window.PDFLib) : reject(new Error('pdf-lib yüklenemedi'));
  sc.onerror = () => reject(new Error('pdf-lib yüklenemedi'));
  document.head.appendChild(sc);
});

export const pdfExtractPages = async (file, pages) => {
  const { PDFDocument } = await loadPdfLib();
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  (await out.copyPages(src, pages)).forEach(pg => out.addPage(pg));
  const base = file.name.replace(/\.pdf$/i, '');
  return new File([await out.save()], `${base}_s${pages.map(p => p + 1).join('-')}.pdf`, { type: 'application/pdf' });
};

// Aktarmalı uçuş: aynı yolcuya ait birden fazla biniş kartı tek PDF'te birleşir.
// parts: [{ file, pages? }] (sırayla) — PDF sayfaları kopyalanır, JPG/PNG tam sayfa eklenir
export const pdfMergeParts = async (parts, name) => {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  for (const pt of parts) {
    const buf = pt.bytes || await pt.file.arrayBuffer();
    const type = pt.type || pt.file?.type || '';
    if (/png|jpe?g/i.test(type)) {
      const img = /png/i.test(type) ? await out.embedPng(buf) : await out.embedJpg(buf);
      const pg = out.addPage([img.width, img.height]); pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      continue;
    }
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    (await out.copyPages(src, pt.pages || src.getPageIndices())).forEach(pg => out.addPage(pg));
  }
  return new File([await out.save()], name, { type: 'application/pdf' });
};

export const pdfFileText = async (file) => {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let out = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out += ' ' + tc.items.map(it => it.str).join(' ');
  }
  return out;
};

// jsPDF: metni verilen genişliğe sığdırır — önce yazı boyutunu minSize'a kadar küçültür, yine sığmazsa "…" ile kısaltır.
export const pdfFit = (doc, text, maxW, size, minSize = size) => {
  let t = String(text || ''), fs = size;
  doc.setFontSize(fs);
  while (fs > minSize && doc.getTextWidth(t) > maxW) { fs -= 0.5; doc.setFontSize(fs); }
  if (doc.getTextWidth(t) <= maxW) return t;
  while (t.length > 1 && doc.getTextWidth(t + '...') > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '...';
};

// Uzun bir canvas'ı A4 sayfalara böler. Kesim noktası, sayfa sonuna yakın "boş" (tek renk) bir piksel satırına
// kaydırılır; böylece yazı satırları iki sayfa arasında ortadan bölünmez. 2. sayfadan itibaren üstte küçük boşluk bırakır.
export const addCanvasPaged = (pdf, canvas, quality = 0.92) => {
  const W = canvas.width, H = canvas.height;
  const pxPerMm = W / 210;
  const pageH = Math.floor(297 * pxPerMm);
  const topPad = Math.round(10 * pxPerMm), botPad = Math.round(8 * pxPerMm);
  const ctx = canvas.getContext('2d');
  const blankRow = (data, rowIdx) => {
    const o = rowIdx * W * 4, r = data[o], g = data[o + 1], b = data[o + 2];
    for (let x = 0; x < W; x += 3) {
      const i = o + x * 4;
      if (Math.abs(data[i] - r) > 12 || Math.abs(data[i + 1] - g) > 12 || Math.abs(data[i + 2] - b) > 12) return false;
    }
    return true;
  };
  let start = 0, page = 0;
  while (start < H - 2) {
    const usable = pageH - (page ? topPad : 0) - (H - start > pageH - (page ? topPad : 0) ? botPad : 0);
    let end = Math.min(start + usable, H);
    if (end < H) {
      const look = Math.floor(usable * 0.3);
      const from = end - look;
      try {
        const data = ctx.getImageData(0, from, W, look).data;
        for (let y = look - 1; y >= 0; y--) { if (blankRow(data, y)) { end = from + y; break; } }
      } catch { /* okunamazsa düz kes */ }
    }
    const part = document.createElement('canvas');
    part.width = W; part.height = end - start;
    const pc = part.getContext('2d');
    pc.fillStyle = '#ffffff'; pc.fillRect(0, 0, W, part.height);
    pc.drawImage(canvas, 0, start, W, part.height, 0, 0, W, part.height);
    if (page) pdf.addPage();
    pdf.addImage(part.toDataURL('image/jpeg', quality), 'JPEG', 0, page ? 10 : 0, 210, part.height / pxPerMm);
    start = end; page++;
  }
};

// Bir HTML string'ini A4 PDF'e çevirip indir (Türkçe %100 düzgün — tarayıcı render eder)
export const htmlToPdfDownload = async (innerHTML, filename, styleCSS = '') => {
  const html2canvas = await loadHtml2Canvas();
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1';
  holder.innerHTML = `<style>${styleCSS}</style>${innerHTML}`;
  document.body.appendChild(holder);
  try {
    await new Promise(r => setTimeout(r, 260));
    const canvas = await html2canvas(holder, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const pdf = new jsPDF('p', 'mm', 'a4');
    addCanvasPaged(pdf, canvas, 0.94);
    pdf.save(filename);
  } finally { document.body.removeChild(holder); }
};
