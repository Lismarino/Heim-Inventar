// Belege & Unterlagen (1.8.0): Anhänge je Eintrag im Store „docs“.
// Bilder werden wie Fotos verkleinert (JPEG), PDFs roh gespeichert – bis DOC_MAX.
// 1.9.0: Dokumente (Aktenschrank) – derselbe Store; ein Dokument hat Ordner UND/ODER Eintrag.
import * as img from './img.js';
import { uid } from './db.js';
import { cleanDate } from './match.js';

// Startvorschläge beim ersten Öffnen von „Dokumente“ (abwählbar).
export const FOLDER_SUGGESTIONS = ['Versicherungen', 'Verträge', 'Steuer', 'Auto', 'Arbeit', 'Gesundheit', 'Wohnen', 'Rechnungen'];
export const DUE_KINDS = { ablauf: 'Läuft ab', kuendigen: 'Kündigen bis' };

const cleanText = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
/** Stichworte: aus Text („Kfz, Haftpflicht“) oder Liste → bereinigte, eindeutige Liste. */
export function cleanTags(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[,;\n]/);
  const out = [];
  for (const t of list) {
    const x = cleanText(typeof t === 'string' ? t : '', 40);
    if (x && !out.some(o => o.toLowerCase() === x.toLowerCase())) out.push(x);
    if (out.length >= 20) break;
  }
  return out;
}
const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 8.64e15 ? v : fb);

/** Gespeicherte Metadaten eines Dokuments (ohne Datei) – für Sicherung und Manifest. */
export const docMeta = (d) => ({
  id: d.id, itemId: d.itemId || null, folderId: d.folderId || null, name: d.name, type: d.type,
  createdAt: d.createdAt || null, updatedAt: d.updatedAt || null, date: d.date || '', tags: d.tags || [],
  due: d.due || '', dueKind: d.dueKind || '', trashedAt: d.trashedAt || null,
});
/** Metadaten aus fremder Quelle (Sicherung) bereinigen. itemId/folderId prüft der Aufrufer. */
export function cleanDocMeta(d) {
  const createdAt = num(d?.createdAt, Date.now());
  return {
    name: cleanText(d?.name, 120) || 'Anhang',
    createdAt,
    updatedAt: num(d?.updatedAt, createdAt),
    date: cleanDate(d?.date),
    tags: cleanTags(d?.tags),
    due: cleanDate(d?.due),
    dueKind: DUE_KINDS[d?.dueKind] ? d.dueKind : '',
    trashedAt: d?.trashedAt == null ? null : num(d.trashedAt, null),
  };
}

/**
 * KI-REGEL (von der Nutzerin verlangt): Die KI darf Dokumentinhalte NIE sehen – keine Dateien,
 * keine Bilder, kein Text daraus. Das hier ist die EINZIGE Stelle, die Dokumente für die KI
 * aufbereitet: ausdrücklich nur Titel, Ordnerpfad, Stichworte und Datum – jedes Feld als
 * kurzer Text, nie `buf`, nie der Dateiname einer Anlage über den Titel hinaus.
 */
export function docsForAi(docs, folderPath) {
  return docs.filter(d => !d.trashedAt).map((d, i) => ({
    n: i + 1,
    title: String(d.name || '').slice(0, 120),
    folder: String(folderPath(d.folderId) || '').slice(0, 160),
    tags: (Array.isArray(d.tags) ? d.tags : []).map(t => String(t).slice(0, 40)).slice(0, 20).join(', '),
    date: cleanDate(d.date) || '',
  }));
}

export const DOC_MAX = 10 * 1048576;
export const DOC_TYPES = /^(image\/(jpeg|png|gif|webp|heic|heif)|application\/pdf)$/;

const isPdf = (f) => f.type === 'application/pdf' || (!f.type && /\.pdf$/i.test(f.name || ''));
const cleanName = (n, fallback) => String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || fallback;

/** Datei → Anhang-Satz. Wirft mit verständlicher Meldung (zu groß, falscher Typ). */
export async function prepareDoc(file, itemId, imgMax = 1600) {
  const now = Date.now();
  if (isPdf(file)) {
    if (file.size > DOC_MAX) throw new Error(`„${cleanName(file.name, 'PDF')}“ ist größer als 10 MB.`);
    return { id: uid(), itemId, folderId: null, name: cleanName(file.name, 'Dokument.pdf'), type: 'application/pdf', buf: await file.arrayBuffer(), createdAt: now };
  }
  if (!String(file.type || '').startsWith('image/')) throw new Error(`„${cleanName(file.name, 'Datei')}“ ist weder Bild noch PDF.`);
  let src = null;
  try {
    src = await img.decode(file);
    const blob = await img.toBlob(src, Number(imgMax) || 1600, 0.82);
    return { id: uid(), itemId, folderId: null, name: cleanName(file.name, 'Beleg.jpg'), type: 'image/jpeg', buf: await blob.arrayBuffer(), createdAt: now };
  } finally {
    img.release(src);
  }
}

export const docURL = (doc) => URL.createObjectURL(new Blob([doc.buf], { type: doc.type }));
export const isImageDoc = (doc) => String(doc?.type || '').startsWith('image/');
export const docSize = (doc) => {
  const b = doc?.buf?.byteLength || doc?.size || 0;
  return b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`;
};

/** Titel-Vorschlag aus dem Dateinamen: Endung weg, Trennzeichen zu Leerzeichen. */
export function titleFromName(name) {
  const t = cleanText(String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' '), 120);
  return /^(IMG|DSC|PXL|image|photo|scan)[\s-]?\d*$/i.test(t) ? '' : t;
}

/** Datei zum Teilen/Speichern: Titel + passende Endung. */
export function shareName(doc) {
  const ext = doc.type === 'application/pdf' ? '.pdf' : '.jpg';
  const base = String(doc.name || 'Dokument').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.(pdf|jpe?g|png|heic)$/i, '').slice(0, 100) || 'Dokument';
  return base + ext;
}
