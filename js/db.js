// IndexedDB-Schicht. Alles bleibt lokal auf dem Gerät.
//
// Orte (1.7.0, Datenbank-Version 2): Store „places“ { id, name, icon, color, createdAt, order }.
// Jeder Raum gehört zu genau einem Ort (rooms.placeId). Einträge tragen placeId immer mit:
// - mit Raum: placeId ist redundant und gleich dem Ort des Raums – maßgeblich ist der Raum
//   (Lesen leitet den Ort aus dem Raum ab, alle Schreibwege hier halten beides gleich);
// - ohne Raum: placeId = der Ort, an dem der Eintrag direkt liegt (z. B. „im Auto“);
// - placeId null (oder fehlend – Einträge aus 1.6.x ohne Raum fasst die Umstellung nicht an)
//   und kein Raum: „Ohne Ort“ – noch zuzuordnen.
//
// 1.8.0 (Datenbank-Version 3): Store „docs“ (Anhänge, Index by_item). Neue, optionale Felder
// am Eintrag: out { type, to, since } (unterwegs/verliehen), essential + homePlaceId
// (Checkliste je Ort), serial, purchaseDate, warrantyUntil (JJJJ-MM-TT), dupOf/dupDismissed.
//
// 1.9.0 (Datenbank-Version 4): Dokumente (digitaler Aktenschrank). Store „folders“
// { id, name, parentId|null, createdAt, order }. Der Store „docs“ bleibt – ein Dokument hat
// jetzt Ordner UND/ODER Eintrag: { id, itemId|null, folderId|null, name (= Titel), type, buf,
// createdAt, date, tags[], due, dueKind, trashedAt }. Die Anhänge aus 1.8.x bleiben unverändert
// gültig (nur itemId, kein Ordner) – neue Felder sind optional, gelesen wird mit Ersatzwerten.
// Neuer Index „by_folder“. Store „sync“ { key, value }: Google-Drive-Sicherung (Schlüssel als
// nicht exportierbarer CryptoKey, Zugangs-Token, Blob-Tabelle) – wird nie mitgesichert.
import { findSimilar } from './match.js';
import { del, get, getAll, put, reqP, store, uid, withTx } from './db-core.js';
import { norm } from './db-places.js';
export { clear, count, DEFAULT_MODEL, del, get, getAll, getAllKeys, loadSettings, onDbEvent, onWrite, openDB, put, QUOTA_MSG, rawCounts, setSetting, uid } from './db-core.js';
export { defaultPlace, dropPlace, ensureNamed, ensurePlace, ensureRoom, migratePlaces, moveAndDropNamed, moveRooms, placesMigrationPending } from './db-places.js';

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

// Endgültig löschen – inklusive Foto, falls kein anderer Eintrag es noch nutzt, und Anhängen.
export async function purgeItem(id) {
  const it = await get('items', id);
  if (!it) return;
  let dropPhoto = null;
  if (it.photoId) {
    const all = await getAll('items');
    const others = all.filter(x => x.id !== id && x.photoId === it.photoId);
    if (others.length === 0) dropPhoto = it.photoId;
  }
  return withTx(['items', 'photos', 'docs'], 'readwrite', (tx) => {
    tx.objectStore('items').delete(id);
    if (dropPhoto) tx.objectStore('photos').delete(dropPhoto);
    // Anhänge: nur reine Belege löschen – liegt ein Dokument auch in einem Ordner, bleibt es
    // dort und verliert nur die Verknüpfung.
    tx.objectStore('docs').index('by_item').openCursor(IDBKeyRange.only(id)).onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur) return;
      if (cur.value.folderId) cur.update({ ...cur.value, itemId: null });
      else cur.delete();
      cur.continue();
    };
  });
}

/* ---------------- 1.8.0: mehrere Einträge, Bestand, Duplikate, Anhänge ---------------- */

// Dieselben Felder an mehreren Einträgen ändern – EINE Transaktion (Mehrfachauswahl).
export function patchItems(ids, patch) {
  const want = new Set(ids);
  return withTx(['items'], 'readwrite', (tx) => {
    const out = { changed: 0 };
    const now = Date.now();
    tx.objectStore('items').openCursor().onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur) return;
      if (want.has(cur.value.id)) { cur.update({ ...cur.value, ...patch, updatedAt: now }); out.changed++; }
      cur.continue();
    };
    return out;
  });
}

// Bestand um `delta` ändern – nur wenn er eine ganze Zahl ist, nie unter 0.
export function stepQuantity(id, delta) {
  return patchItemWith(id, (it) => {
    if (!/^\s*\d{1,6}\s*$/.test(String(it.quantity ?? ''))) return false;
    it.quantity = String(Math.max(0, Number(it.quantity) + delta));
    return true;
  });
}

// Lesen, ändern (`fn` liefert false = nichts tun), schreiben – in EINER Transaktion.
function patchItemWith(id, fn) {
  return withTx(['items'], 'readwrite', (tx) => {
    const box = { item: null };
    const s = tx.objectStore('items');
    s.get(id).onsuccess = (ev) => {
      const it = ev.target.result;
      if (!it || fn(it) === false) return;
      it.updatedAt = Date.now();
      s.put(it);
      box.item = it;
    };
    return box;
  }).then(box => box.item);
}

// Nach der Erkennung: Gibt es schon einen stark ähnlichen Eintrag (nicht archiviert, anderes
// Foto)? Dann den Hinweis „dupOf“ am neuen Eintrag setzen. Nie blockierend, nie doppelt.
export async function flagDuplicate(id) {
  const all = await getAll('items');
  const it = all.find(x => x.id === id);
  if (!it || it.archived || it.dupOf || it.dupDismissed || !String(it.name || '').trim()) return null;
  const hit = findSimilar(all.filter(x => x.id !== id && (!x.photoId || x.photoId !== it.photoId)), [it.name], 2)[0];
  if (!hit) return null;
  return patchItem(id, { dupOf: hit.item.id }, (x) => !x.dupOf && !x.dupDismissed && !x.archived);
}

// Anhänge (Belege, Unterlagen): { id, itemId, name, type, buf, createdAt } – ab 1.9.0 Dokumente
// (siehe oben). Im Papierkorb liegende zählen am Eintrag nicht.
export function docsOf(itemId) {
  return store('docs', 'readonly').then(s => reqP(s.index('by_item').getAll(IDBKeyRange.only(itemId))))
    .then(list => list.filter(d => !d.trashedAt));
}
// Alle Dokumente ohne die Datei selbst – für Listen, Suche, Fristen (spart Speicher).
export function docMetas() {
  return withTx(['docs'], 'readonly', (tx) => {
    const out = [];
    tx.objectStore('docs').openCursor().onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur) return;
      const { buf, ...meta } = cur.value;
      meta.size = buf?.byteLength || 0;
      out.push(meta);
      cur.continue();
    };
    return out;
  });
}
// Metadaten eines Dokuments ändern (Titel, Ordner, Frist …) – die Datei bleibt, wie sie ist.
export function patchDoc(id, patch) {
  return withTx(['docs'], 'readwrite', (tx) => {
    const box = { doc: null };
    const s = tx.objectStore('docs');
    s.get(id).onsuccess = (ev) => {
      const d = ev.target.result;
      if (!d) return;
      const { buf: _b, ...safe } = patch;   // die Datei nie über diesen Weg ersetzen
      void _b;
      box.doc = { ...d, ...safe, updatedAt: Date.now() };
      s.put(box.doc);
    };
    return box;
  }).then(b => b.doc);
}

// Ordner löschen: samt Unterordnern; enthaltene Dokumente wandern in den Papierkorb
// (wiederherstellbar) – EINE Transaktion.
export function dropFolder(folderId) {
  return withTx(['folders', 'docs'], 'readwrite', (tx) => {
    const fs = tx.objectStore('folders');
    const box = { folders: 0, docs: 0 };
    fs.getAll().onsuccess = (ev) => {
      const all = ev.target.result;
      const gone = new Set([folderId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const f of all) if (!gone.has(f.id) && gone.has(f.parentId)) { gone.add(f.id); grew = true; }
      }
      for (const id of gone) fs.delete(id);
      box.folders = gone.size;
      const now = Date.now();
      tx.objectStore('docs').openCursor().onsuccess = (e2) => {
        const cur = e2.target.result;
        if (!cur) return;
        if (gone.has(cur.value.folderId)) {
          // Mit Eintrag verknüpft: bleibt als Beleg am Eintrag, sonst in den Papierkorb.
          const d = cur.value;
          cur.update(d.itemId ? { ...d, folderId: null } : { ...d, folderId: null, trashedAt: d.trashedAt || now });
          box.docs++;
        }
        cur.continue();
      };
    };
    return box;
  });
}
export const addDoc = (doc) => put('docs', doc);
export const delDoc = (id) => del('docs', id);

/* ---------------- Sicherung einlesen ---------------- */

// Schreibt einen fertig vorbereiteten Import in EINER Transaktion.
// `replace` leert vorher alle sieben Stores (samt Anhängen, 1.9.0: und Ordnern). Scheitert irgendetwas (Speicher voll,
// ungültiger Schlüssel), rollt IndexedDB alles zurück – der alte Stand bleibt.
export function writeImport({ replace = false, places = [], categories = [], rooms = [], photos = [], items = [], docs = [], folders = [] }) {
  const names = ['items', 'photos', 'categories', 'rooms', 'places', 'docs', 'folders'];
  return withTx(names, 'readwrite', (tx) => {
    if (replace) for (const n of names) tx.objectStore(n).clear();
    const putAll = (n, list) => { const s = tx.objectStore(n); for (const r of list) s.put(r); };
    putAll('places', places);
    putAll('categories', categories);
    putAll('rooms', rooms);
    putAll('photos', photos);
    putAll('items', items);
    putAll('docs', docs);
    putAll('folders', folders);
  });
}
