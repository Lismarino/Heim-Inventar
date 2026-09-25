// Sicherung: komplette Liste inklusive Fotos in eine JSON-Datei und zurück.
// Format 2 (1.7.0): zusätzlich „places“ (Orte), Räume mit placeId, Einträge mit placeId.
// Format 1 (ohne Orte) wird weiter gelesen: alle Räume kommen dann nach „Zuhause“.
import * as db from './db.js';
import { blobToBase64 } from './img.js';
import { DEFAULT_PLACE, PLACE_ICONS, PLACE_COLORS, suggestIcon, colorFor } from './places.js';

const FORMAT = 'heim-inventar';
const FORMAT_VERSION = 2;

/* ---------------- Export ---------------- */

/**
 * Baut die Sicherungsdatei stückweise als Blob.
 * Ein einziges JSON.stringify über alle Fotos würde auf dem Telefon
 * einen dreistelligen Megabyte-String im Speicher erzeugen.
 */
export async function buildExport({ withPhotos = true, onProgress } = {}) {
  const [items, cats, rooms, places, settings] = await Promise.all([
    db.getAll('items'), db.getAll('categories'), db.getAll('rooms'), db.getAll('places'), db.loadSettings(),
  ]);
  const photos = withPhotos ? await db.getAll('photos') : [];
  // Ort am Eintrag immer gleich dem seines Raums (maßgeblich ist der Raum).
  const placeOfRoom = new Map(rooms.map(r => [r.id, r.placeId]));
  for (const it of items) if (placeOfRoom.get(it.roomId)) it.placeId = placeOfRoom.get(it.roomId);

  const head = {
    app: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    withPhotos,
    counts: { items: items.length, photos: photos.length, categories: cats.length, rooms: rooms.length, places: places.length },
    // Der API-Key wird bewusst NICHT mitgesichert.
    settings: { model: settings.model, imgMax: settings.imgMax },
  };

  const parts = [];
  const h = JSON.stringify(head);
  parts.push(h.slice(0, -1) + ',');                       // schließende Klammer offen lassen
  parts.push('"places":' + JSON.stringify(places) + ',');
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

const key = (s) => String(s || '').trim().toLowerCase();

// Orte nach NAMEN abgleichen (wie Kategorien). Symbol und Farbe nur aus den festen
// Listen – sie landen in Klassennamen und Symbol-Verweisen.
function mapPlaces(list, existing) {
  const map = new Map();
  const add = [];
  const byName = new Map(existing.map(x => [key(x.name), x.id]));
  const usedIds = new Set(existing.map(x => x.id));
  let order = existing.reduce((m, p) => Math.max(m, Number(p.order) || 0), -1);
  const fresh = (rec, name) => {
    const ic = PLACE_ICONS.includes(rec?.icon) ? rec.icon : suggestIcon(name);
    const id = isId(rec?.id) && !usedIds.has(rec.id) ? rec.id : db.uid();
    const color = PLACE_COLORS.includes(rec?.color) ? rec.color : colorFor(ic);
    const out = { id, name, icon: ic, color, createdAt: num(rec?.createdAt, Date.now()), order: ++order };
    usedIds.add(id);
    byName.set(key(name), id);
    add.push(out);
    return id;
  };
  for (const rec of Array.isArray(list) ? list : []) {
    const name = String(rec?.name || '').trim();
    if (!name) continue;
    const id = byName.get(key(name)) || fresh(rec, name);
    if (isId(rec.id)) map.set(rec.id, id);
  }
  // Ort für Räume ohne (gültigen) Ort – bei alten Sicherungen alle: „Zuhause“, erst bei Bedarf.
  const fallback = () => byName.get(key(DEFAULT_PLACE)) || fresh({ icon: 'haus' }, DEFAULT_PLACE);
  return { map, add, fallback };
}

// Räume nach (Ort, Name) abgleichen – „Keller“ in Zuhause und in Haus 2 sind zwei Räume.
function mapRooms(list, existing, places) {
  const map = new Map();
  const placeOf = new Map();   // neue Raum-ID -> Orts-ID
  const add = [];
  const byKey = new Map(existing.map(x => [x.placeId + '|' + key(x.name), x.id]));
  for (const r of existing) placeOf.set(r.id, r.placeId);
  const usedIds = new Set(existing.map(x => x.id));
  for (const rec of Array.isArray(list) ? list : []) {
    const name = String(rec?.name || '').trim();
    if (!name) continue;
    const placeId = (rec.placeId && places.map.get(rec.placeId)) || places.fallback();
    const k = placeId + '|' + key(name);
    let id = byKey.get(k);
    if (!id) {
      id = isId(rec.id) && !usedIds.has(rec.id) ? rec.id : db.uid();
      add.push({ id, name, placeId, createdAt: num(rec.createdAt, Date.now()) });
      usedIds.add(id);
      byKey.set(k, id);
      placeOf.set(id, placeId);
    }
    if (isId(rec.id)) map.set(rec.id, id);
  }
  return { map, add, placeOf };
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
  const [existCats, existRooms, existPlaces, photoKeys, itemKeys] = replace
    ? [[], [], [], [], []]
    : await Promise.all([db.getAll('categories'), db.getAll('rooms'), db.getAll('places'), db.getAllKeys('photos'), db.getAllKeys('items')]);

  const cats = mapNamed(data.categories, existCats);
  const places = mapPlaces(data.places, existPlaces);
  const rooms = mapRooms(data.rooms, existRooms, places);

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
    // Ort: bei einem Raum immer der des Raums; sonst der mitgebrachte (falls es ihn gibt).
    // Alte Sicherungen ohne Orte: Einträge ohne Raum bleiben „ohne Ort“ (wie „ohne Raum“ bisher).
    it.placeId = it.roomId ? (rooms.placeOf.get(it.roomId) || null)
      : (raw.placeId && places.map.get(raw.placeId)) || null;
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

  await db.writeImport({ replace, places: places.add, categories: cats.add, rooms: rooms.add, photos, items });
  stats.items = items.length;
  stats.photos = photos.length;
  return stats;
}
