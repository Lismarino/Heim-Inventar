// IndexedDB-Schicht. Alles bleibt lokal auf dem Gerät.
const DB_NAME = 'heim-inventar';
const DB_VERSION = 1;

let _db = null;

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
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
      void ev;
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Datenbank ist in einem anderen Tab blockiert.'));
  });
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
  for (const s of ['items', 'photos', 'categories', 'rooms', 'settings']) {
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
  lastRoom: '',   // Schnellerfassung: zuletzt gewählter Raum (Name)
  lastLoc: '',    // … und Ort-Details dazu
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

/* ---------------- Kategorien / Räume ---------------- */

const norm = (s) => String(s || '').trim().toLowerCase();

// Findet eine bestehende Kategorie/Raum per Name (case-insensitiv) oder legt sie an.
// Aufrufe laufen nacheinander: Die KI-Warteschlange arbeitet parallel und würde
// sonst dieselbe neue Kategorie zweimal anlegen.
let namedLock = Promise.resolve();
export function ensureNamed(storeName, name) {
  const run = namedLock.then(() => ensureNamedNow(storeName, name));
  namedLock = run.catch(() => null);
  return run;
}

async function ensureNamedNow(storeName, name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const all = await getAll(storeName);
  const hit = all.find(x => norm(x.name) === norm(clean));
  if (hit) return hit.id;
  const rec = { id: uid(), name: clean, createdAt: Date.now() };
  await put(storeName, rec);
  return rec.id;
}

// Hängt alle Einträge von oldId auf newId um (null leert das Feld) und löscht
// die alte Kategorie/den alten Raum – in EINER Transaktion.
export function moveAndDropNamed(storeName, oldId, newId) {
  const field = storeName === 'categories' ? 'categoryId' : 'roomId';
  return withTx(['items', storeName], 'readwrite', (tx) => {
    const out = { changed: 0 };
    const now = Date.now();
    tx.objectStore('items').openCursor().onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur) return;
      const it = cur.value;
      if (it[field] === oldId) {
        it[field] = newId;
        it.updatedAt = now;
        cur.update(it);
        out.changed++;
      }
      cur.continue();
    };
    tx.objectStore(storeName).delete(oldId);
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
    roomId: null,
    locationDetail: '',
    quantity: '',
    note: '',
    photoId: null,
    thumb: '',
    aiConfidence: null,
    aiState: null,     // null | 'pending' | 'done' | 'failed' – Hintergrund-Erkennung
    aiError: null,
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

// Trägt das Ergebnis der Bilderkennung ein. `found`: [{ name, categoryId, confidence }].
// Der erste Gegenstand füllt den Eintrag selbst – einen inzwischen von Hand
// eingetragenen Namen oder eine Kategorie aber NICHT überschreiben. Jeder weitere
// Gegenstand wird ein eigener Eintrag mit demselben Foto und Ort.
export function applyRecognition(id, found) {
  return withTx(['items'], 'readwrite', (tx) => {
    const out = { applied: false, added: 0 };
    const s = tx.objectStore('items');
    s.get(id).onsuccess = (ev) => {
      const it = ev.target.result;
      if (!it || it.aiState !== 'pending' || !found.length) return;   // gelöscht oder schon erledigt
      const now = Date.now();
      const [first, ...rest] = found;
      if (!String(it.name || '').trim()) {
        it.name = first.name;
        it.aiConfidence = first.confidence;
      }
      if (!it.categoryId) it.categoryId = first.categoryId;
      it.aiState = 'done';
      it.aiError = null;
      it.updatedAt = now;
      s.put(it);
      out.applied = true;
      if (it.archived) return;   // inzwischen archiviert: keine neuen Einträge dazu
      rest.forEach((f, i) => {
        s.put(newItem({
          name: f.name,
          categoryId: f.categoryId,
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
    return out;
  });
}

// Weist mehreren Einträgen einen Raum zu – in EINER Transaktion.
// Ort-Details werden nur gesetzt, wenn welche angegeben sind.
export function assignRoom(ids, roomId, locationDetail) {
  const want = new Set(ids);
  const loc = String(locationDetail || '').trim();
  return withTx(['items'], 'readwrite', (tx) => {
    const out = { changed: 0 };
    const now = Date.now();
    tx.objectStore('items').openCursor().onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur) return;
      const it = cur.value;
      if (want.has(it.id)) {
        it.roomId = roomId;
        if (loc) it.locationDetail = loc;
        it.updatedAt = now;
        cur.update(it);
        out.changed++;
      }
      cur.continue();
    };
    return out;
  });
}

export async function archiveItem(id) {
  const it = await get('items', id);
  if (!it) return null;
  it.archived = 1;
  it.archivedAt = Date.now();
  it.updatedAt = Date.now();
  return put('items', it);
}

export async function restoreItem(id) {
  const it = await get('items', id);
  if (!it) return null;
  it.archived = 0;
  it.archivedAt = null;
  it.updatedAt = Date.now();
  return put('items', it);
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
// `replace` leert vorher alle vier Stores. Scheitert irgendetwas (Speicher voll,
// ungültiger Schlüssel), rollt IndexedDB alles zurück – der alte Stand bleibt.
export function writeImport({ replace = false, categories = [], rooms = [], photos = [], items = [] }) {
  const names = ['items', 'photos', 'categories', 'rooms'];
  return withTx(names, 'readwrite', (tx) => {
    if (replace) for (const n of names) tx.objectStore(n).clear();
    const putAll = (n, list) => { const s = tx.objectStore(n); for (const r of list) s.put(r); };
    putAll('categories', categories);
    putAll('rooms', rooms);
    putAll('photos', photos);
    putAll('items', items);
  });
}
