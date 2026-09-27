// Scannen (1.9.0): Kamera-Foto → einfache Aufbereitung (Drehen, Graustufen mit mehr Kontrast),
// verkleinern, als JPEG kodieren; mehrere Seiten → EIN PDF. Der PDF-Writer ist absichtlich
// winzig: je Seite ein JPEG-Bild (DCTDecode), sonst nichts – keine Bibliothek nötig.
import * as img from './img.js';

const SCAN_EDGE = 2000;   // Scans dürfen etwas größer sein als Fotos – Text soll lesbar bleiben

/**
 * Datei (Foto) → { blob, w, h } als JPEG. rotate: 0/90/180/270 (im Uhrzeigersinn);
 * enhance: Graustufen und Kontrast strecken (lässt Papier weiß und Schrift schwarz wirken).
 */
export async function renderPage(file, { rotate = 0, enhance = false, maxEdge = SCAN_EDGE, quality = 0.8 } = {}) {
  let src = null;
  let c = null;
  try {
    src = await img.decode(file);
    const w0 = src.width || src.naturalWidth || 0;
    const h0 = src.height || src.naturalHeight || 0;
    if (!w0 || !h0) throw new Error('Bild hat keine lesbaren Abmessungen.');
    const f = Math.min(1, maxEdge / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * f));
    const h = Math.max(1, Math.round(h0 * f));
    const r = ((Number(rotate) % 360) + 360) % 360;
    const side = r === 90 || r === 270;
    c = document.createElement('canvas');
    c.width = side ? h : w;
    c.height = side ? w : h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(r * Math.PI / 180);
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (enhance) enhanceCanvas(ctx, c.width, c.height);
    const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht kodiert werden.'))), 'image/jpeg', quality));
    return { blob, w: c.width, h: c.height };
  } finally {
    img.release(src);
    if (c) { c.width = 0; c.height = 0; }
  }
}

// Graustufen + Kontrast: Helligkeit je Pixel, dann die Werte zwischen dem 2.- und 98.-Perzentil
// auf 0…255 strecken, mit leichter Kurve Richtung Weiß (Papier).
function enhanceCanvas(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h);
  const p = d.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < p.length; i += 4) {
    const y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0;
    p[i] = y;
    hist[y]++;
  }
  const n = p.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
  if (hi - lo < 16) { lo = Math.max(0, lo - 8); hi = Math.min(255, hi + 8); }
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    lut[v] = Math.round(255 * Math.pow(t, 0.85));
  }
  for (let i = 0; i < p.length; i += 4) { const y = lut[p[i]]; p[i] = y; p[i + 1] = y; p[i + 2] = y; }
  ctx.putImageData(d, 0, 0);
}

/**
 * JPEG-Seiten → PDF (Uint8Array). pages: [{ bytes: Uint8Array (JPEG), w, h }].
 * Jede Seite ist 595 pt (A4) breit, die Höhe folgt dem Bild.
 */
export function makePdf(pages, { title = '' } = {}) {
  if (!pages.length) throw new Error('Keine Seiten.');
  const te = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (x) => { const b = typeof x === 'string' ? te.encode(x) : x; chunks.push(b); pos += b.length; };
  const obj = (n, body) => { offsets[n] = pos; push(`${n} 0 obj\n${body}\nendobj\n`); };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));   // Binär-Markierung
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((pg, i) => {
    const n = 3 + i * 3;
    const W = 595;
    const H = Math.max(1, Math.round(W * pg.h / pg.w));
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${n + 2} 0 R >>`);
    offsets[n + 1] = pos;
    push(`${n + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`);
    push(pg.bytes);
    push('\nendstream\nendobj\n');
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(n + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const infoN = 3 + pages.length * 3;
  // Titel nur als ASCII (PDF-Strings brauchen sonst Kodierung); Klammern und \\ maskieren.
  const t = String(title).replace(/[^\x20-\x7e]/g, '_').replace(/[()\\]/g, '\\$&').slice(0, 100);
  obj(infoN, `<< /Producer (Heim-Inventar)${t ? ` /Title (${t})` : ''} >>`);
  const xref = pos;
  let x = `xref\n0 ${infoN + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= infoN; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${infoN + 1} /Root 1 0 R /Info ${infoN} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
