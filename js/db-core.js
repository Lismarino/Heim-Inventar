// IndexedDB-Grundlagen: Datenbank öffnen und aufrüsten (Schema siehe db.js), Transaktionen,
// Lesen/Schreiben einzelner Stores, Einstellungen. Wird über db.js mit angeboten.

const DB_NAME = 'heim-inventar';
const DB_VERSION = 4;

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

// Schreib-Meldungen (1.9.0) für die automatische Sicherung: fn(storeNamen) nach jedem
// erfolgreichen Schreiben. „settings“ und „sync“ allein zählen nicht als Datenänderung.
const writers = new Set();
export function onWrite(fn) { writers.add(fn); return () => writers.delete(fn); }
function wrote(stores) {
  const list = [].concat(stores).filter(n => n !== 'settings' && n !== 'sync');
  if (!list.length) return;
  for (const fn of writers) { try { fn(list); } catch (_) { void _; } }
}

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
      // Version 3 (1.8.0): Belege & Unterlagen – Anhänge je Eintrag. Rein additiv.
      if (!db.objectStoreNames.contains('docs')) {
        db.createObjectStore('docs', { keyPath: 'id' }).createIndex('by_item', 'itemId');
      }
      // Version 4 (1.9.0): Ordner, Index nach Ordner, Sync-Zustand. Rein additiv – kein
      // bestehender Satz wird umgeschrieben; alles in der Upgrade-Transaktion (atomar).
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      const docs = req.transaction.objectStore('docs');
      if (!docs.indexNames.contains('by_folder')) docs.createIndex('by_folder', 'folderId');
      if (!db.objectStoreNames.contains('sync')) db.createObjectStore('sync', { keyPath: 'key' });
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

// Speicher voll (1.10.0): Safari meldet das als QuotaExceededError (ältere Fassungen nur mit
// code 22) – beim Request oder erst beim Abschluss der Transaktion. Zentral in eine klare
// Meldung übersetzen und die App benachrichtigen ('quota'), auch wenn der Aufrufer schweigt.
export const QUOTA_MSG = 'Speicher voll – mach eine Sicherung, verkleinere Fotos (Einstellungen) oder lösche Altes.';
const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || e.code === 22 || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
function dbErr(e) {
  if (!isQuota(e)) return e;
  emit('quota');
  const err = new Error(QUOTA_MSG);
  err.name = 'QuotaExceededError';
  err.cause = e;
  return err;
}

export function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(dbErr(request.error));
  });
}

// Eine Transaktion über mehrere Stores. `fn` MUSS alle Requests synchron absetzen.
export function withTx(stores, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let box;
    tx.oncomplete = () => { if (mode === 'readwrite') wrote(stores); resolve(box); };
    tx.onerror = () => reject(dbErr(tx.error));
    tx.onabort = () => reject(dbErr(tx.error) || new Error('Transaktion abgebrochen'));
    try { box = fn(tx); } catch (e) { try { tx.abort(); } catch (_) { void _; } reject(dbErr(e)); }
  }));
}

export async function store(name, mode) {
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
// Über withTx: erst der Abschluss der Transaktion zählt – dort meldet Safari „Speicher voll“.
export async function put(name, value) {
  await withTx(name, 'readwrite', (tx) => { tx.objectStore(name).put(value); });
  return value;
}
export async function del(name, key) {
  const r = await reqP((await store(name, 'readwrite')).delete(key));
  wrote(name);
  return r;
}
export async function count(name) {
  return reqP((await store(name, 'readonly')).count());
}
export async function clear(name) {
  const r = await reqP((await store(name, 'readwrite')).clear());
  wrote(name);
  return r;
}

/** Rohe Satzzahlen direkt aus der Datenbank – für die Speicher-Diagnose. */
export async function rawCounts() {
  const out = {};
  for (const s of ['items', 'photos', 'categories', 'rooms', 'places', 'docs', 'folders', 'settings']) {
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
