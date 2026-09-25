// IndexedDB-Schicht. Alles bleibt lokal auf dem Gerät.
//
// Orte (1.7.0, Datenbank-Version 2): Store „places“ { id, name, icon, color, createdAt, order }.
// Jeder Raum gehört zu genau einem Ort (rooms.placeId). Einträge tragen placeId immer mit:
// - mit Raum: placeId ist redundant und gleich dem Ort des Raums – maßgeblich ist der Raum
//   (Lesen leitet den Ort aus dem Raum ab, alle Schreibwege hier halten beides gleich);
// - ohne Raum: placeId = der Ort, an dem der Eintrag direkt liegt (z. B. „im Auto“);
// - placeId null und kein Raum: „Ohne Ort“ – noch zuzuordnen.
import { DEFAULT_PLACE, suggestIcon, colorFor, safeIcon, safeColor, byOrder } from './places.js';

const DB_NAME = 'heim-inventar';
const DB_VERSION = 2;

let _db = null;
let _opening = null;

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Meldungen an die App: 'blocked' (ein anderer Tab mit älterer Fassung hält die Datenbank
// offen, das Upgrade wartet), 'unblocked', 'versionchange' (eine neuere Fassung will upgraden).
const listeners = new Set();
export function onDbEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (type) => { for (const fn of listeners) { try { fn(type); } catch (_) { void _; } } };

export function openDB() {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;
  let blocked = false;
  _opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('by_archived', 'archived');
        s.createIndex('by_createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('rooms')) db.createObjectStore('rooms', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      // Version 2: Orte. Bestehende Räume und Einträge ordnet migratePlaces() danach zu –
      // hier nur den Store anlegen, damit das Upgrade selbst nichts umschreibt.
      if (!db.objectStoreNames.contains('places')) db.createObjectStore('places', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      _db = req.result;
      _opening = null;
      // Eine neuere Fassung (anderer Tab) will upgraden: loslassen, sonst wartet sie ewig.
      _db.onversionchange = () => { try { _db.close(); } catch (_) { void _; } _db = null; emit('versionchange'); };
      if (blocked) emit('unblocked');
      resolve(_db);
    };
    req.onerror = () => { _opening = null; reject(req.error); };
    // Ein anderer Tab (ältere Fassung, eingefroren im Hintergrund) hält die Datenbank offen.
    // Nicht aufgeben: Die Anfrage bleibt stehen und läuft weiter, sobald er sie schließt.
    req.onblocked = () => { blocked = true; emit('blocked'); };
  });
  return _opening;
}

function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Eine Transaktion über mehrere Stores. `fn` MUSS alle Requests synchron absetzen.
function withTx(stores, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let box;
    tx.oncomplete = () => resolve(box);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaktion abgebrochen'));
    try { box = fn(tx); } catch (e) { try { tx.abort(); } catch (_) { void _; } reject(e); }
  }));
}

async function store(name, mode) {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

export async function getAll(name) {
  return reqP((await store(name, 'readonly')).getAll());
}
export async function getAllKeys(name) {
  return reqP((await store(name, 'readonly')).getAllKeys());
}
export async function get(name, key) {
  return reqP((await store(name, 'readonly')).get(key));
}
export async function put(name, value) {
  await reqP((await store(name, 'readwrite')).put(value));
  return value;
}
export async function del(name, key) {
  return reqP((await store(name, 'readwrite')).delete(key));
}
export async function count(name) {
  return reqP((await store(name, 'readonly')).count());
}
export async function clear(name) {
  return reqP((await store(name, 'readwrite')).clear());
}

/** Rohe Satzzahlen direkt aus der Datenbank – für die Speicher-Diagnose. */
export async function rawCounts() {
  const out = {};
  for (const s of ['items', 'photos', 'categories', 'rooms', 'places', 'settings']) {
    try { out[s] = await count(s); } catch (_) { void _; out[s] = -1; }
  }
  return out;
}

/* ---------------- Einstellungen ---------------- */

export const DEFAULT_MODEL = 'gemini-3.6-flash';

const SETTING_DEFAULTS = {
  apiKey: '',
  model: DEFAULT_MODEL,
  imgMax: 1600,
  lastPlace: '',  // Schnellerfassung: zuletzt gewählter Ort (ID) – leer: Ort offen
  lastRoom: '',   // … Raum darin (Name)
  lastLoc: '',    // … und der genaue Platz dazu
  homePlace: '',  // Zuhause: gewählter Ort im Umschalter (ID) – leer: alle Orte
};

// Von Google abgeschaltete Modelle. Sie stehen teils noch in der Modellliste,
// liefern beim Aufruf aber 404 "no longer available to new users".
const RETIRED_MODELS = {
  'gemini-1.5-flash': DEFAULT_MODEL,
  'gemini-1.5-pro': DEFAULT_MODEL,
  'gemini-2.0-flash': DEFAULT_MODEL,
  'gemini-2.0-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.5-flash': DEFAULT_MODEL,
  'gemini-2.5-pro': DEFAULT_MODEL,
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
};

export async function loadSettings() {
  const rows = await getAll('settings');
  const out = { ...SETTING_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;

  const replacement = RETIRED_MODELS[out.model];
  if (replacement) {
    out.model = replacement;
    await put('settings', { key: 'model', value: replacement });
  }
  return out;
}
export function setSetting(key, value) {
  return put('settings', { key, value });
}

/* ---------------- Kategorien / Räume / Orte ---------------- */

const norm = (s) => String(s || '').trim().toLowerCase();

// Der Ort, in den ein Raum ohne ausdrücklichen Ort kommt: „Zuhause“, sonst der erste Ort.
// `places` sind alle Orte; liefert null, wenn es noch keinen gibt.
const defaultPlace = (places) => places.find(p => norm(p.name) === norm(DEFAULT_PLACE))
  || places.slice().sort(byOrder)[0] || null;

function newPlaceRec(name, places, { icon, color } = {}) {
  const ic = safeIcon(icon || suggestIcon(name));
  const order = places.reduce((m, p) => Math.max(m, Number(p.order) || 0), -1) + 1;
  return { id: uid(), name, icon: ic, color: safeColor(color || colorFor(ic)), createdAt: Date.now(), order };
}

// Findet eine bestehende Kategorie/Raum/Ort per Name (case-insensitiv) oder legt sie an.
// Aufrufe laufen nacheinander, jeder in einer eigenen Transaktion – so entsteht
// dieselbe neue Kategorie nie zweimal, auch nicht neben der KI-Warteschlange.
// Räume sind nur innerhalb eines Orts eindeutig: ensureNamed('rooms', name, placeId).
// Ohne placeId (ältere Aufrufer) landet der Raum im Standard-Ort – gibt es noch keinen,
// entsteht „Zuhause“.
let namedLock = Promise.resolve();
export function ensureNamed(storeName, name, placeId) {
  const run = namedLock.then(() => (storeName === 'rooms' ? ensureRoomNow(placeId, name)
    : storeName === 'places' ? ensurePlaceNow(name) : ensureNamedNow(storeName, name)));
  namedLock = run.catch(() => null);
  return run;
}

/** Raum `name` im Ort `placeId` finden oder anlegen. Liefert die Raum-ID (leerer Name: null). */
export const ensureRoom = (placeId, name) => ensureNamed('rooms', name, placeId || undefined);

/** Ort per Name finden oder anlegen (Symbol/Farbe nur beim Anlegen). Liefert die ID. */
export function ensurePlace(name, style) {
  const run = namedLock.then(() => ensurePlaceNow(name, style));
  namedLock = run.catch(() => null);
  return run;
}

// Suchen und Anlegen in EINER Transaktion – sonst könnte die Erkennung
// (applyRecognition) dazwischen denselben Namen anlegen.
function ensureNamedNow(storeName, name) {
  const clean = String(name || '').trim();
  if (!clean) return Promise.resolve(null);
  return withTx([storeName], 'readwrite', (tx) => {
    const box = { id: null };
    const s = tx.objectStore(storeName);
    s.getAll().onsuccess = (ev) => {
      const hit = ev.target.result.find(x => norm(x.name) === norm(clean));
      if (hit) { box.id = hit.id; return; }
      const rec = { id: uid(), name: clean, createdAt: Date.now() };
      s.put(rec);
      box.id = rec.id;
    };
    return box;
  }).then(box => box.id);
}

function ensurePlaceNow(name, style) {
  const clean = String(name || '').trim();
  if (!clean) return Promise.resolve(null);
  return withTx(['places'], 'readwrite', (tx) => {
    const box = { id: null };
    const s = tx.objectStore('places');
    s.getAll().onsuccess = (ev) => {
      const all = ev.target.result;
      const hit = all.find(x => norm(x.name) === norm(clean));
      if (hit) { box.id = hit.id; return; }
      const rec = newPlaceRec(clean, all, style);
      s.put(rec);
      box.id = rec.id;
    };
    return box;
  }).then(box => box.id);
}

// Ort auflösen (gegeben, sonst Standard, sonst „Zuhause“ anlegen) und den Raum darin
// suchen oder anlegen – alles in EINER Transaktion.
function ensureRoomNow(placeId, name) {
  const clean = String(name || '').trim();
  if (!clean) return Promise.resolve(null);
  return withTx(['rooms', 'places'], 'readwrite', (tx) => {
    const box = { id: null };
    const ps = tx.objectStore('places');
    const rs = tx.objectStore('rooms');
    ps.getAll().onsuccess = (ev) => {
      const places = ev.target.result;
      let place = placeId ? places.find(p => p.id === placeId) : null;
      if (!place) place = defaultPlace(places);
      if (!place) {
        place = newPlaceRec(DEFAULT_PLACE, places, { icon: 'haus' });
        ps.put(place);
      }
      rs.getAll().onsuccess = (ev2) => {
        const hit = ev2.target.result.find(r => r.placeId === place.id && norm(r.name) === norm(clean));
        if (hit) { box.id = hit.id; return; }
        const rec = { id: uid(), name: clean, placeId: place.id, createdAt: Date.now() };
        rs.put(rec);
        box.id = rec.id;
      };
    };
    return box;
  }).then(box => box.id);
}

// Hängt alle Einträge von oldId auf newId um (null leert das Feld) und löscht
// die alte Kategorie/den alten Raum – in EINER Transaktion.
// Räume: Beim Löschen (newId null) bleiben die Einträge im Ort des Raums, direkt dort;
// beim Zusammenführen ziehen sie mit in den Ort des Ziel-Raums.
export function moveAndDropNamed(storeName, oldId, newId) {
  const field = storeName === 'categories' ? 'categoryId' : 'roomId';
  return withTx(['items', storeName], 'readwrite', (tx) => {
    const out = { changed: 0 };
    const now = Date.now();
    const named = tx.objectStore(storeName);
    const run = (oldRec, newRec) => {
      tx.objectStore('items').openCursor().onsuccess = (ev) => {
        const cur = ev.target.result;
        if (!cur) return;
        const it = cur.value;
        if (it[field] === oldId) {
          it[field] = newId;
          if (field === 'roomId') it.placeId = (newRec ? newRec.placeId : oldRec?.placeId) || null;
          it.updatedAt = now;
          cur.update(it);
          out.changed++;
        }
        cur.continue();
      };
      named.delete(oldId);
    };
    if (field !== 'roomId') { run(null, null); return out; }
    named.get(oldId).onsuccess = (ev) => {
      const oldRec = ev.target.result || null;
      if (!newId) { run(oldRec, null); return; }
      named.get(newId).onsuccess = (ev2) => run(oldRec, ev2.target.result || null);
    };
    return out;
  });
}

/**
 * Ort löschen. targetId: Räume und Einträge wandern in diesen Ort (gleichnamige Räume
 * werden dort zusammengeführt); null: Räume werden aufgelöst, ihre Einträge und die direkt
 * am Ort liegenden sind danach „ohne Ort“ – erhalten bleiben sie in jedem Fall.
 * Alles in EINER Transaktion. Liefert { rooms, items }.
 */
export function dropPlace(placeId, targetId) {
  const target = targetId && targetId !== placeId ? targetId : null;
  return withTx(['places', 'rooms', 'items'], 'readwrite', (tx) => {
    const out = { rooms: 0, items: 0 };
    const ps = tx.objectStore('places');
    const rs = tx.objectStore('rooms');
    const now = Date.now();
    ps.get(target || '\u0000').onsuccess = (evT) => {
      const to = target ? evT.target.result : null;
      if (target && !to) throw new Error('Den Ziel-Ort gibt es nicht mehr.');
      rs.getAll().onsuccess = (ev) => {
        const rooms = ev.target.result;
        const twins = new Map(rooms.filter(r => to && r.placeId === to.id).map(r => [norm(r.name), r.id]));
        const remap = new Map();   // Raum-ID -> neue Raum-ID (null: aufgelöst)
        for (const r of rooms) {
          if (r.placeId !== placeId) continue;
          out.rooms++;
          if (!to) { remap.set(r.id, null); rs.delete(r.id); continue; }
          const twin = twins.get(norm(r.name));
          if (twin) { remap.set(r.id, twin); rs.delete(r.id); continue; }
          r.placeId = to.id;
          rs.put(r);
          twins.set(norm(r.name), r.id);
        }
        tx.objectStore('items').openCursor().onsuccess = (ev2) => {
          const cur = ev2.target.result;
          if (!cur) return;
          const it = cur.value;
          const inRoom = it.roomId && rooms.some(r => r.id === it.roomId && r.placeId === placeId);
          if (inRoom || it.placeId === placeId) {
            if (inRoom && remap.has(it.roomId)) it.roomId = remap.get(it.roomId);
            it.placeId = to ? to.id : null;
            it.updatedAt = now;
            cur.update(it);
            out.items++;
          }
          cur.continue();
        };
        ps.delete(placeId);
      };
    };
    return out;
  });
}

/**
 * Ordnet Räume ohne Ort und Einträge in Räumen einem Ort zu – beim ersten Start von 1.7.0
 * über einer Datenbank von 1.6.x, und immer dann, wenn ein noch offener älterer Tab einen
 * Raum ohne Ort angelegt hat. Idempotent: Ein zweiter Lauf findet nichts mehr zu tun.
 * - Räume ohne (gültigen) Ort kommen nach „Zuhause“ (vorhanden, sonst angelegt, Symbol Haus);
 *   gibt es dort schon einen gleichnamigen Raum, werden beide zusammengeführt.
 * - Einträge in einem Raum bekommen den Ort des Raums.
 * - Einträge OHNE Raum bleiben ohne Ort: Sie waren „ohne Raum“ – also noch zuzuordnen – und
 *   stehen jetzt unter „Ohne Ort“. So verschwindet nichts stillschweigend aus „Zu erledigen“.
 * - Der gemerkte Raum der Schnellerfassung (lastRoom) liegt danach in „Zuhause“: lastPlace
 *   zeigt dorthin. War kein Raum gemerkt, bleibt auch der Ort offen.
 * Alles in EINER Transaktion – scheitert etwas, bleibt der alte Stand vollständig erhalten.
 * Liefert { place, rooms, items, merged } (place: Name des verwendeten Orts oder null).
 */
export function migratePlaces() {
  return withTx(['places', 'rooms', 'items', 'settings'], 'readwrite', (tx) => {
    const out = { place: null, created: false, rooms: 0, items: 0, merged: 0 };
    const ps = tx.objectStore('places');
    const rs = tx.objectStore('rooms');
    const ss = tx.objectStore('settings');
    ps.getAll().onsuccess = (e1) => {
      const places = e1.target.result;
      rs.getAll().onsuccess = (e2) => {
        const rooms = e2.target.result;
        ss.getAll().onsuccess = (e3) => {
          const set = new Map(e3.target.result.map(r => [r.key, r.value]));
          const pids = new Set(places.map(p => p.id));
          const orphans = rooms.filter(r => !pids.has(r.placeId));
          if (set.get('schemaPlaces') === 1 && !orphans.length) return;

          const remap = new Map();
          let home = null;
          if (orphans.length) {
            home = defaultPlace(places);
            if (!home) {
              home = newPlaceRec(DEFAULT_PLACE, places, { icon: 'haus' });
              ps.put(home);
              out.created = true;
            }
            out.place = home.name;
            const twins = new Map(rooms.filter(r => r.placeId === home.id).map(r => [norm(r.name), r.id]));
            for (const r of orphans) {
              const twin = twins.get(norm(r.name));
              if (twin) { remap.set(r.id, twin); rs.delete(r.id); out.merged++; continue; }
              r.placeId = home.id;
              rs.put(r);
              twins.set(norm(r.name), r.id);
              out.rooms++;
            }
          }
          const placeOfRoom = new Map(rooms.filter(r => !remap.has(r.id)).map(r => [r.id, r.placeId]));
          tx.objectStore('items').openCursor().onsuccess = (e4) => {
            const cur = e4.target.result;
            if (!cur) return;
            const it = cur.value;
            let dirty = false;
            if (remap.has(it.roomId)) { it.roomId = remap.get(it.roomId); dirty = true; }
            const want = placeOfRoom.get(it.roomId);
            if (want && it.placeId !== want) { it.placeId = want; dirty = true; }
            else if (!want && it.placeId === undefined) { it.placeId = null; dirty = true; }
            // Kein updatedAt: Die Zuordnung ist keine Änderung der Nutzerin.
            if (dirty) { cur.update(it); out.items++; }
            cur.continue();
          };
          ss.put({ key: 'schemaPlaces', value: 1 });
          if (home && String(set.get('lastRoom') || '').trim() && !set.get('lastPlace')) {
            ss.put({ key: 'lastPlace', value: home.id });
          }
        };
      };
    };
    return out;
  });
}

/* ---------------- Einträge ---------------- */

export function newItem(patch = {}) {
  const now = Date.now();
  return {
    id: uid(),
    name: '',
    categoryId: null,
    placeId: null,     // Ort – bei einem Raum immer der Ort des Raums (siehe oben)
    roomId: null,
    locationDetail: '',
    quantity: '',
    note: '',
    photoId: null,
    thumb: '',
    aiConfidence: null,
    aiState: null,     // null | 'pending' | 'done' | 'failed' – Hintergrund-Erkennung
    aiError: null,
    aiSplit: false,    // true: Zusatz-Einträge aus diesem Foto sind schon angelegt
    createdAt: now,
    updatedAt: now,
    archived: 0,
    archivedAt: null,
    ...patch,
  };
}

// Speichert mehrere Einträge und (optional) EIN gemeinsames Foto in einer Transaktion.
export function saveItems(items, photo) {
  return withTx(['items', 'photos'], 'readwrite', (tx) => {
    if (photo) tx.objectStore('photos').put(photo);
    const s = tx.objectStore('items');
    for (const it of items) s.put(it);
    return items;
  });
}

// Ändert einzelne Felder eines Eintrags in EINER Transaktion (lesen + schreiben).
// So überschreibt ein Speichern aus der Detail-Ansicht nicht, was die
// KI-Warteschlange gerade eingetragen hat – und umgekehrt.
// `cond(item)` kann das Schreiben verhindern. Liefert den neuen Stand oder null.
export function patchItem(id, patch, cond) {
  return withTx(['items'], 'readwrite', (tx) => {
    const box = { item: null };
    const s = tx.objectStore('items');
    s.get(id).onsuccess = (ev) => {
      const it = ev.target.result;
      if (!it || (cond && !cond(it))) return;
      Object.assign(it, patch, { updatedAt: Date.now() });
      s.put(it);
      box.item = it;
    };
    return box;
  }).then(box => box.item);
}

// Trägt das Ergebnis der Bilderkennung ein. `found`: [{ name, category, confidence }]
// (Kategorie als Name; alternativ schon aufgelöst als `categoryId`).
// Alles in EINER Transaktion über Einträge und Kategorien: Ist der Eintrag inzwischen
// gelöscht, erledigt oder die Datenbank per „Alles ersetzen“ neu befüllt, wird auch
// keine Kategorie angelegt.
// Der erste Gegenstand füllt den Eintrag selbst – einen inzwischen von Hand
// eingetragenen Namen oder eine Kategorie aber NICHT überschreiben. Jeder weitere
// Gegenstand wird ein eigener Eintrag mit demselben Foto und Ort – aber nur beim
// ersten Mal: Nach „Erneut erkennen“ (aiSplit gesetzt) entstehen keine Dubletten.
export function applyRecognition(id, found) {
  return withTx(['items', 'categories'], 'readwrite', (tx) => {
    const out = { applied: false, added: 0 };
    const s = tx.objectStore('items');
    const cs = tx.objectStore('categories');
    s.get(id).onsuccess = (ev) => {
      const it = ev.target.result;
      if (!it || it.aiState !== 'pending' || !found.length) return;   // gelöscht oder schon erledigt
      cs.getAll().onsuccess = (ev2) => {
        const byName = new Map(ev2.target.result.map(c => [norm(c.name), c.id]));
        const catId = (f) => {
          if (f.categoryId !== undefined) return f.categoryId || null;
          const clean = String(f.category || '').trim();
          if (!clean) return null;
          let cid = byName.get(norm(clean));
          if (!cid) {
            const rec = { id: uid(), name: clean, createdAt: Date.now() };
            cs.put(rec);
            cid = rec.id;
            byName.set(norm(clean), cid);
          }
          return cid;
        };
        const now = Date.now();
        const [first, ...rest] = found;
        if (!String(it.name || '').trim()) {
          it.name = first.name;
          it.aiConfidence = first.confidence;
        }
        if (!it.categoryId) it.categoryId = catId(first);
        it.aiState = 'done';
        it.aiError = null;
        it.updatedAt = now;
        out.applied = true;
        // Inzwischen archiviert oder schon einmal aufgeteilt: keine neuen Einträge dazu.
        if (it.archived || it.aiSplit || !rest.length) { s.put(it); return; }
        it.aiSplit = true;
        s.put(it);
        // Sicherheitshalber gegen vorhandene Einträge mit demselben Foto abgleichen.
        s.getAll().onsuccess = (ev3) => {
          const have = new Set(ev3.target.result
            .filter(x => x.photoId && x.photoId === it.photoId)
            .map(x => norm(x.name)));
          have.add(norm(it.name));
          rest.forEach((f, i) => {
            if (have.has(norm(f.name))) return;
            have.add(norm(f.name));
            s.put(newItem({
              name: f.name,
              categoryId: catId(f),
              placeId: it.placeId ?? null,   // Ort des Originals mitnehmen
              roomId: it.roomId,
              locationDetail: it.locationDetail,
              photoId: it.photoId,
              thumb: it.thumb,
              aiConfidence: f.confidence,
              aiState: 'done',
              createdAt: it.createdAt + i + 1,   // direkt neben dem Original einsortieren
              updatedAt: now,
            }));
            out.added++;
          });
        };
      };
    };
    return out;
  });
}

// Fotos, die ohne API-Key erfasst und nie erkannt wurden, zur Erkennung vormerken
// (nicht archiviert, mit Foto, ohne Namen, aiState null). Liefert die Anzahl.
export function markUnrecognized() {
  return withTx(['items'], 'readwrite', (tx) => {
    const out = { marked: 0 };
    const now = Date.now();
    tx.objectStore('items').openCursor().onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur) return;
      const it = cur.value;
      if (!it.archived && it.photoId && !String(it.name || '').trim() && it.aiState == null) {
        it.aiState = 'pending';
        it.aiError = null;
        it.updatedAt = now;
        cur.update(it);
        out.marked++;
      }
      cur.continue();
    };
    return out;
  }).then(out => out.marked);
}

// Legt mehrere Einträge an Ort + Raum – in EINER Transaktion. roomId (optional) gewinnt:
// der Ort ist dann der des Raums. Ohne Raum liegen die Einträge direkt am Ort, mit
// placeId null und ohne Raum sind sie „ohne Ort“. Der genaue Platz (locationDetail) wird
// nur gesetzt, wenn einer angegeben ist.
export function moveItems(ids, placeId, roomId, locationDetail) {
  const want = new Set(ids);
  const loc = String(locationDetail || '').trim();
  return withTx(['items', 'rooms'], 'readwrite', (tx) => {
    const out = { changed: 0 };
    const now = Date.now();
    const apply = (room) => {
      const pid = room ? room.placeId : (placeId || null);
      tx.objectStore('items').openCursor().onsuccess = (ev) => {
        const cur = ev.target.result;
        if (!cur) return;
        const it = cur.value;
        if (want.has(it.id)) {
          it.roomId = room ? room.id : null;
          it.placeId = pid;
          if (loc) it.locationDetail = loc;
          it.updatedAt = now;
          cur.update(it);
          out.changed++;
        }
        cur.continue();
      };
    };
    if (!roomId) apply(null);
    else tx.objectStore('rooms').get(roomId).onsuccess = (ev) => apply(ev.target.result || null);
    return out;
  });
}

/** placeId der Einträge `ids` auf den Ort ihres Raums setzen (Reparatur, eine Transaktion). */
export function syncItemPlaces(ids) {
  const want = new Set(ids);
  return withTx(['items', 'rooms'], 'readwrite', (tx) => {
    const out = { changed: 0 };
    tx.objectStore('rooms').getAll().onsuccess = (ev) => {
      const placeOfRoom = new Map(ev.target.result.map(r => [r.id, r.placeId]));
      tx.objectStore('items').openCursor().onsuccess = (e2) => {
        const cur = e2.target.result;
        if (!cur) return;
        const it = cur.value;
        const pid = placeOfRoom.get(it.roomId);
        if (want.has(it.id) && pid && it.placeId !== pid) { it.placeId = pid; cur.update(it); out.changed++; }
        cur.continue();
      };
    };
    return out;
  });
}

/** Früherer Name: Raum zuweisen (Ort folgt aus dem Raum). */
export const assignRoom = (ids, roomId, locationDetail) => moveItems(ids, null, roomId, locationDetail);

/** Einen Eintrag an Ort + Raum legen (wie moveItems, liefert den neuen Stand). */
export function setItemWhere(id, placeId, roomId) {
  return moveItems([id], placeId, roomId).then(() => get('items', id));
}

// Archivieren/Wiederherstellen über patchItem: lesen und schreiben in EINER
// Transaktion, damit eine gleichzeitig eintreffende Erkennung nicht verloren geht.
export function archiveItem(id) {
  return patchItem(id, { archived: 1, archivedAt: Date.now() });
}

export function restoreItem(id) {
  return patchItem(id, { archived: 0, archivedAt: null });
}

// Endgültig löschen – inklusive Foto, falls kein anderer Eintrag es noch nutzt.
export async function purgeItem(id) {
  const it = await get('items', id);
  if (!it) return;
  let dropPhoto = null;
  if (it.photoId) {
    const all = await getAll('items');
    const others = all.filter(x => x.id !== id && x.photoId === it.photoId);
    if (others.length === 0) dropPhoto = it.photoId;
  }
  return withTx(['items', 'photos'], 'readwrite', (tx) => {
    tx.objectStore('items').delete(id);
    if (dropPhoto) tx.objectStore('photos').delete(dropPhoto);
  });
}

/* ---------------- Sicherung einlesen ---------------- */

// Schreibt einen fertig vorbereiteten Import in EINER Transaktion.
// `replace` leert vorher alle fünf Stores. Scheitert irgendetwas (Speicher voll,
// ungültiger Schlüssel), rollt IndexedDB alles zurück – der alte Stand bleibt.
export function writeImport({ replace = false, places = [], categories = [], rooms = [], photos = [], items = [] }) {
  const names = ['items', 'photos', 'categories', 'rooms', 'places'];
  return withTx(names, 'readwrite', (tx) => {
    if (replace) for (const n of names) tx.objectStore(n).clear();
    const putAll = (n, list) => { const s = tx.objectStore(n); for (const r of list) s.put(r); };
    putAll('places', places);
    putAll('categories', categories);
    putAll('rooms', rooms);
    putAll('photos', photos);
    putAll('items', items);
  });
}
