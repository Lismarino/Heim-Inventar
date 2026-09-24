// Sicherung: komplette Liste inklusive Fotos in eine JSON-Datei und zurück.
import * as db from './db.js';
import { blobToBase64 } from './img.js';

const FORMAT = 'heim-inventar';
const FORMAT_VERSION = 1;

/* ---------------- Export ---------------- */

/**
 * Baut die Sicherungsdatei stückweise als Blob.
 * Ein einziges JSON.stringify über alle Fotos würde auf dem Telefon
 * einen dreistelligen Megabyte-String im Speicher erzeugen.
 */
export async function buildExport({ withPhotos = true, onProgress } = {}) {
  const [items, cats, rooms, settings] = await Promise.all([
    db.getAll('items'), db.getAll('categories'), db.getAll('rooms'), db.loadSettings(),
  ]);
  const photos = withPhotos ? await db.getAll('photos') : [];

  const head = {
    app: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    withPhotos,
    counts: { items: items.length, photos: photos.length, categories: cats.length, rooms: rooms.length },
    // Der API-Key wird bewusst NICHT mitgesichert.
    settings: { model: settings.model, imgMax: settings.imgMax },
  };

  const parts = [];
  const h = JSON.stringify(head);
  parts.push(h.slice(0, -1) + ',');                       // schließende Klammer offen lassen
  parts.push('"categories":' + JSON.stringify(cats) + ',');
  parts.push('"rooms":' + JSON.stringify(rooms) + ',');
  parts.push('"items":' + JSON.stringify(items) + ',');
  parts.push('"photos":[');

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const type = p.type || 'image/jpeg';
    const data = await blobToBase64(new Blob([p.buf], { type }));
    parts.push((i ? ',' : '') + JSON.stringify({ id: p.id, type, createdAt: p.createdAt || null, data }));
    if (onProgress) onProgress(i + 1, photos.length);
  }
  parts.push(']}');

  const blob = new Blob(parts, { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 10);
  return { blob, filename: `heim-inventar-${stamp}.json`, counts: head.counts };
}

/* ---------------- Import ---------------- */

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // Sehr große Dateien können beim Einlesen auch am Speicher scheitern.
    if (e instanceof SyntaxError) throw new Error('Die Datei ist kein gültiges JSON.');
    throw new Error('Die Datei konnte nicht verarbeitet werden (zu groß?). Es wurde nichts verändert.');
  }
  if (!data || data.app !== FORMAT) throw new Error('Das ist keine Sicherung von Heim-Inventar.');
  if (Number(data.version) > FORMAT_VERSION) throw new Error('Die Datei stammt aus einer neueren Version der App.');
  if (!Array.isArray(data.items)) throw new Error('In der Datei fehlt die Liste der Einträge.');
  return data;
}

function base64ToBuffer(b64) {
  const bin = atob(String(b64 || ''));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

const isId = (v) => typeof v === 'string' && v !== '';
// Zeitstempel: nur Zahlen im gültigen Datumsbereich, sonst Ersatzwert.
const num = (v, fallback) => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v) : NaN);
  return Number.isFinite(n) && Math.abs(n) <= 8.64e15 ? n : fallback;
};
// Vorschaubilder landen in <img src> – nur echte Bild-Data-URLs zulassen.
const safeThumb = (v) => (typeof v === 'string' && v.startsWith('data:image/') ? v : '');
// Dem Browser Luft lassen, damit die Fortschrittsanzeige sichtbar aktualisiert.
const tick = () => new Promise((r) => setTimeout(r, 0));

// Kategorien/Räume nach NAMEN abgleichen, nicht nach ID – auf einem anderen
// Gerät hat dieselbe Kategorie eine andere ID. Schreibt nichts, sondern liefert
// alteId -> neueId und die neu anzulegenden Sätze.
function mapNamed(list, existing) {
  const map = new Map();
  const add = [];
  const byName = new Map(existing.map(x => [String(x.name).trim().toLowerCase(), x.id]));
  const usedIds = new Set(existing.map(x => x.id));

  for (const rec of Array.isArray(list) ? list : []) {
    const name = String(rec?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let id = byName.get(key);
    if (!id) {
      id = isId(rec.id) && !usedIds.has(rec.id) ? rec.id : db.uid();
      add.push({ id, name, createdAt: num(rec.createdAt, Date.now()) });
      usedIds.add(id);
      byName.set(key, id);
    }
    if (isId(rec.id)) map.set(rec.id, id);   // ohne ID kann kein Eintrag darauf zeigen
  }
  return { map, add };
}

/**
 * mode 'merge'   – Vorhandenes bleibt, Neues kommt dazu (nach ID abgeglichen).
 * mode 'replace' – Alles Bisherige wird gelöscht und durch die Datei ersetzt.
 *
 * Erst wird alles vorbereitet (Fotos dekodiert, Einträge zugeordnet), dann in
 * EINER Transaktion geschrieben. Bricht etwas ab, bleibt der alte Stand erhalten.
 */
export async function applyBackup(data, mode, onProgress) {
  const replace = mode === 'replace';
  const stats = { items: 0, photos: 0, skipped: 0 };

  // Bei „ersetzen“ zählt der bisherige Bestand nicht – er wird ja geleert.
  const [existCats, existRooms, photoKeys, itemKeys] = replace
    ? [[], [], [], []]
    : await Promise.all([db.getAll('categories'), db.getAll('rooms'), db.getAllKeys('photos'), db.getAllKeys('items')]);

  const cats = mapNamed(data.categories, existCats);
  const rooms = mapNamed(data.rooms, existRooms);

  // Fotos vorab dekodieren – kaputtes base64 fällt hier auf, bevor etwas geschrieben ist.
  const havePhotos = new Set(photoKeys);
  const photosIn = Array.isArray(data.photos) ? data.photos : [];
  const photos = [];
  for (let i = 0; i < photosIn.length; i++) {
    const p = photosIn[i];
    if (isId(p?.id) && !havePhotos.has(p.id)) {
      let buf;
      try {
        buf = base64ToBuffer(p.data);
      } catch (_) {
        void _;
        throw new Error(`Foto ${i + 1} in der Datei ist beschädigt.`);
      }
      photos.push({
        id: p.id,
        buf,
        type: typeof p.type === 'string' && p.type.startsWith('image/') ? p.type : 'image/jpeg',
        createdAt: num(p.createdAt, Date.now()),
      });
      havePhotos.add(p.id);
    }
    if (onProgress) onProgress(i + 1, photosIn.length);
    if (i % 10 === 9) await tick();
  }

  const haveItems = new Set(itemKeys);
  const items = [];
  for (const raw of data.items) {
    if (!isId(raw?.id)) continue;
    if (haveItems.has(raw.id)) { stats.skipped++; continue; }
    const it = db.newItem({ ...raw });
    it.categoryId = raw.categoryId ? (cats.map.get(raw.categoryId) || null) : null;
    it.roomId = raw.roomId ? (rooms.map.get(raw.roomId) || null) : null;
    it.archived = raw.archived ? 1 : 0;
    it.thumb = safeThumb(raw.thumb);
    // Verweis auf ein Foto, das weder in der Datei noch auf dem Gerät liegt: leeren.
    it.photoId = isId(raw.photoId) && havePhotos.has(raw.photoId) ? raw.photoId : null;
    // Erkennungsstatus: 'pending' nur mit Foto – sonst hinge der Eintrag ewig in der Warteschlange.
    it.aiState = raw.aiState === 'done' || raw.aiState === 'failed' ? raw.aiState
      : raw.aiState === 'pending' && it.photoId ? 'pending' : null;
    it.aiError = typeof raw.aiError === 'string' ? raw.aiError : null;
    it.aiSplit = raw.aiSplit === true;
    // Kaputte Zeitstempel würden sonst das Datumsformat in der Liste sprengen.
    it.createdAt = num(raw.createdAt, Date.now());
    it.updatedAt = num(raw.updatedAt, it.createdAt);
    it.archivedAt = raw.archivedAt == null ? null : num(raw.archivedAt, null);
    haveItems.add(it.id);
    items.push(it);
  }

  await db.writeImport({ replace, categories: cats.add, rooms: rooms.add, photos, items });
  stats.items = items.length;
  stats.photos = photos.length;
  return stats;
}
