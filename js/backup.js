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
  } catch (_) {
    void _;
    throw new Error('Die Datei ist kein gültiges JSON.');
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

// Kategorien/Räume nach NAMEN abgleichen, nicht nach ID – auf einem anderen
// Gerät hat dieselbe Kategorie eine andere ID. Liefert alteId -> neueId.
async function mergeNamed(storeName, list) {
  const map = new Map();
  const existing = await db.getAll(storeName);
  const byName = new Map(existing.map(x => [String(x.name).trim().toLowerCase(), x.id]));
  const usedIds = new Set(existing.map(x => x.id));

  for (const rec of list || []) {
    const name = String(rec?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (byName.has(key)) { map.set(rec.id, byName.get(key)); continue; }
    const id = rec.id && !usedIds.has(rec.id) ? rec.id : db.uid();
    await db.put(storeName, { id, name, createdAt: rec.createdAt || Date.now() });
    usedIds.add(id);
    byName.set(key, id);
    map.set(rec.id, id);
  }
  return map;
}

/**
 * mode 'merge'   – Vorhandenes bleibt, Neues kommt dazu (nach ID abgeglichen).
 * mode 'replace' – Alles Bisherige wird gelöscht und durch die Datei ersetzt.
 */
export async function applyBackup(data, mode, onProgress) {
  const stats = { items: 0, photos: 0, skipped: 0 };

  if (mode === 'replace') {
    await db.clear('items');
    await db.clear('photos');
    await db.clear('categories');
    await db.clear('rooms');
  }

  const mapCat = await mergeNamed('categories', data.categories);
  const mapRoom = await mergeNamed('rooms', data.rooms);

  const havePhotos = new Set((await db.getAll('photos')).map(p => p.id));
  const photos = Array.isArray(data.photos) ? data.photos : [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    if (!p?.id || havePhotos.has(p.id)) continue;
    await db.put('photos', {
      id: p.id,
      buf: base64ToBuffer(p.data),
      type: p.type || 'image/jpeg',
      createdAt: p.createdAt || Date.now(),
    });
    stats.photos++;
    if (onProgress) onProgress(i + 1, photos.length);
  }

  const haveItems = new Set((await db.getAll('items')).map(i => i.id));
  for (const raw of data.items) {
    if (!raw?.id) continue;
    if (haveItems.has(raw.id)) { stats.skipped++; continue; }
    const it = db.newItem({ ...raw });
    it.categoryId = raw.categoryId ? (mapCat.get(raw.categoryId) || null) : null;
    it.roomId = raw.roomId ? (mapRoom.get(raw.roomId) || null) : null;
    it.archived = raw.archived ? 1 : 0;
    await db.put('items', it);
    stats.items++;
  }

  return stats;
}
