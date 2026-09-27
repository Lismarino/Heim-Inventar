// Belege & Unterlagen (1.8.0): Anhänge je Eintrag im Store „docs“.
// Bilder werden wie Fotos verkleinert (JPEG), PDFs roh gespeichert – bis DOC_MAX.
import * as img from './img.js';
import { uid } from './db.js';

export const DOC_MAX = 10 * 1048576;
export const DOC_TYPES = /^(image\/(jpeg|png|gif|webp|heic|heif)|application\/pdf)$/;

const isPdf = (f) => f.type === 'application/pdf' || (!f.type && /\.pdf$/i.test(f.name || ''));
const cleanName = (n, fallback) => String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || fallback;

/** Datei → Anhang-Satz. Wirft mit verständlicher Meldung (zu groß, falscher Typ). */
export async function prepareDoc(file, itemId, imgMax = 1600) {
  const now = Date.now();
  if (isPdf(file)) {
    if (file.size > DOC_MAX) throw new Error(`„${cleanName(file.name, 'PDF')}“ ist größer als 10 MB.`);
    return { id: uid(), itemId, name: cleanName(file.name, 'Dokument.pdf'), type: 'application/pdf', buf: await file.arrayBuffer(), createdAt: now };
  }
  if (!String(file.type || '').startsWith('image/')) throw new Error(`„${cleanName(file.name, 'Datei')}“ ist weder Bild noch PDF.`);
  let src = null;
  try {
    src = await img.decode(file);
    const blob = await img.toBlob(src, Number(imgMax) || 1600, 0.82);
    return { id: uid(), itemId, name: cleanName(file.name, 'Beleg.jpg'), type: 'image/jpeg', buf: await blob.arrayBuffer(), createdAt: now };
  } finally {
    img.release(src);
  }
}

export const docURL = (doc) => URL.createObjectURL(new Blob([doc.buf], { type: doc.type }));
export const isImageDoc = (doc) => String(doc?.type || '').startsWith('image/');
export const docSize = (doc) => {
  const b = doc?.buf?.byteLength || 0;
  return b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`;
};
