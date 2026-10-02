// Kategorien, Räume und Orte: anlegen (eindeutig je Name), umbenennen/zusammenführen,
// löschen, Räume verschieben, Umstellung auf Orte (1.7.0). Wird über db.js mit angeboten.
import { byOrder, colorFor, DEFAULT_PLACE, safeColor, safeIcon, suggestIcon } from './places.js';
import { uid, withTx } from './db-core.js';

/* ---------------- Kategorien / Räume / Orte ---------------- */

export const norm = (s) => String(s || '').trim().toLowerCase();

// Der Ort, in den ein Raum ohne ausdrücklichen Ort kommt: „Zuhause“, sonst der erste Ort.
// `places` sind alle Orte; liefert null, wenn es noch keinen gibt.
export const defaultPlace = (places) => places.find(p => norm(p.name) === norm(DEFAULT_PLACE))
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
 * Räume in einen anderen Ort verschieben (Raum-Menü „In anderen Ort verschieben“, Gruppe
 * „Ohne Ort“ im Tab „Räume“). Die Einträge ziehen mit – ihr placeId folgt dem Raum.
 * Gibt es im Ziel schon einen gleichnamigen Raum, wird zusammengeführt: nur mit merge: true,
 * sonst scheitert es (err.code 'twin', err.twin = Name) und nichts ist geändert.
 * Alles in EINER Transaktion. Liefert { rooms, merged, items, map } (map: Raum-ID -> Raum-ID
 * danach, bei Zusammenführen die des Zwillings).
 */
export function moveRooms(roomIds, targetId, { merge = false } = {}) {
  const want = new Set(roomIds);
  let fail = null;
  return withTx(['places', 'rooms', 'items'], 'readwrite', (tx) => {
    const out = { rooms: 0, merged: 0, items: 0, map: {} };
    const rs = tx.objectStore('rooms');
    const is = tx.objectStore('items');
    const stop = (err) => { fail = err; tx.abort(); };
    tx.objectStore('places').get(targetId || '\u0000').onsuccess = (e1) => {
      const to = e1.target.result;
      if (!to) { stop(new Error('Den Ziel-Ort gibt es nicht mehr.')); return; }
      rs.getAll().onsuccess = (e2) => {
        const rooms = e2.target.result;
        const twins = new Map(rooms.filter(r => r.placeId === to.id && !want.has(r.id)).map(r => [norm(r.name), r]));
        const remap = new Map();   // Raum-ID -> Raum-ID danach
        for (const r of rooms) {
          if (!want.has(r.id) || r.placeId === to.id) continue;
          const twin = twins.get(norm(r.name));
          if (twin) {
            if (!merge) { const e = new Error(`„${twin.name}“ gibt es in „${to.name}“ schon.`); e.code = 'twin'; e.twin = twin.name; stop(e); return; }
            remap.set(r.id, twin.id);
            rs.delete(r.id);
            out.merged++;
          } else {
            r.placeId = to.id;
            rs.put(r);
            twins.set(norm(r.name), r);
            remap.set(r.id, r.id);
            out.rooms++;
          }
        }
        for (const [a, b] of remap) out.map[a] = b;
        if (!remap.size) return;
        const now = Date.now();
        scanItems(is, (it) => {
          if (!remap.has(it.roomId)) return;
          it.roomId = remap.get(it.roomId);
          it.placeId = to.id;
          it.updatedAt = now;
          is.put(it);
          out.items++;
        });
      };
    };
    return out;
  }).catch((e) => { throw fail || e; });
}

// Überlebender beim Zusammenführen gleichnamiger Räume: der älteste (createdAt), bei
// Gleichstand der mit mehr Einträgen, dann der Name (Großschreibung vor Kleinschreibung,
// „Küche“ vor „küche“), zuletzt die ID – so ist das Ergebnis auf jedem Gerät dasselbe.
function roomRank(counts) {
  const n = (r) => counts?.get(r.id) || 0;
  return (a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)
    || n(b) - n(a)
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// Was migratePlaces() tun muss – nur aus Orten, Räumen und Einstellungen berechnet.
// null: nichts zu tun. Sonst { home (Ort oder null: anlegen), orphans, groups, ties }:
// groups sind die gleichnamigen Räume in „Zuhause“ (nach Normal-Name), die zusammengeführt
// werden; ties: Für die Reihenfolge braucht es die Zahl der Einträge je Raum.
function placesPlan(places, rooms, set) {
  const pids = new Set(places.map(p => p.id));
  const orphans = rooms.filter(r => !pids.has(r.placeId));
  if (set.get('schemaPlaces') === 1 && !orphans.length) return null;
  const home = orphans.length ? defaultPlace(places) : null;
  const groups = new Map();
  if (orphans.length) {
    for (const r of rooms) {
      if (!orphans.includes(r) && !(home && r.placeId === home.id)) continue;
      const k = norm(r.name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
  }
  const ties = [...groups.values()].some(g => g.length > 1
    && new Set(g.map(r => Number(r.createdAt) || 0)).size < g.length);
  return { home, orphans, groups, ties };
}

/**
 * Muss beim Start noch auf Orte umgestellt werden? Nur lesend. Liefert null (nichts zu tun)
 * oder { items }: so viele Einträge sind zu prüfen (für die Fortschrittsanzeige; 0: nur
 * Räume/Einstellungen, geht sofort).
 */
export function placesMigrationPending() {
  return withTx(['places', 'rooms', 'items', 'settings'], 'readonly', (tx) => {
    const out = { pending: null };
    tx.objectStore('places').getAll().onsuccess = (e1) => {
      tx.objectStore('rooms').getAll().onsuccess = (e2) => {
        tx.objectStore('settings').getAll().onsuccess = (e3) => {
          const rooms = e2.target.result;
          const plan = placesPlan(e1.target.result, rooms, new Map(e3.target.result.map(r => [r.key, r.value])));
          if (!plan) return;
          // Ohne Räume gibt es an den Einträgen nichts umzuschreiben.
          if (!rooms.length) { out.pending = { items: 0 }; return; }
          tx.objectStore('items').count().onsuccess = (e4) => { out.pending = { items: e4.target.result }; };
        };
      };
    };
    return out;
  }).then(out => out.pending);
}

const CHUNK = 250;

// Alle Einträge blockweise lesen (nach ID) – innerhalb einer laufenden Transaktion. Deutlich
// schneller als ein Cursor mit update() je Eintrag, wenn es Tausende sind: visit(eintrag)
// darf `store.put()` aufrufen (nur für Geänderte), step(n) meldet nach jedem vollen Block,
// done(n) am Ende.
function scanItems(store, visit, done, step) {
  let last = null, seen = 0;
  const next = () => {
    const range = last === null ? null : IDBKeyRange.lowerBound(last, true);
    store.getAll(range, CHUNK).onsuccess = (ev) => {
      const list = ev.target.result;
      for (const it of list) visit(it);
      seen += list.length;
      if (list.length) last = list[list.length - 1].id;
      if (list.length === CHUNK) { step?.(seen); next(); } else done?.(seen);
    };
  };
  next();
}

/**
 * Ordnet Räume ohne Ort und Einträge in Räumen einem Ort zu – beim ersten Start von 1.7.x
 * über einer Datenbank von 1.6.x, und immer dann, wenn ein noch offener älterer Tab einen
 * Raum ohne Ort angelegt hat. Idempotent: Ein zweiter Lauf findet nichts mehr zu tun.
 * - Räume ohne (gültigen) Ort kommen nach „Zuhause“ (vorhanden – sonst der erste Ort –,
 *   sonst angelegt, Symbol Haus). Gleichnamige Räume dort werden zusammengeführt; es bleibt
 *   der älteste (siehe roomRank) – auf jedem Gerät derselbe.
 * - Einträge in einem Raum bekommen den Ort des Raums.
 * - Einträge OHNE Raum werden nicht angefasst: Sie waren „ohne Raum“ – also noch zuzuordnen –
 *   und stehen jetzt unter „Ohne Ort“ (ein fehlendes placeId gilt überall wie null). Das
 *   spart bei großen Beständen viel Schreibarbeit.
 * - Der gemerkte Raum der Schnellerfassung (lastRoom) liegt danach in „Zuhause“: lastPlace
 *   zeigt dorthin. War kein Raum gemerkt, bleibt auch der Ort offen.
 * Einträge werden in Blöcken gelesen und nur geschrieben, wo sich etwas ändert.
 * onProgress(geprüft, gesamt) meldet den Fortschritt (für die Anzeige beim Start).
 * Alles in EINER Transaktion – scheitert etwas (oder wird die Seite neu geladen), bleibt der
 * alte Stand vollständig erhalten, und der nächste Start beginnt von vorn.
 * Liefert { place, rooms, items, merged } (place: Name des verwendeten Orts oder null).
 */
export function migratePlaces({ onProgress } = {}) {
  return withTx(['places', 'rooms', 'items', 'settings'], 'readwrite', (tx) => {
    const out = { place: null, created: false, rooms: 0, items: 0, merged: 0 };
    const ps = tx.objectStore('places');
    const rs = tx.objectStore('rooms');
    const ss = tx.objectStore('settings');
    const is = tx.objectStore('items');
    ps.getAll().onsuccess = (e1) => {
      const places = e1.target.result;
      rs.getAll().onsuccess = (e2) => {
        const rooms = e2.target.result;
        ss.getAll().onsuccess = (e3) => {
          const set = new Map(e3.target.result.map(r => [r.key, r.value]));
          const plan = placesPlan(places, rooms, set);
          if (!plan) return;
          let home = plan.home;
          if (plan.orphans.length && !home) {
            home = newPlaceRec(DEFAULT_PLACE, places, { icon: 'haus' });
            ps.put(home);
            out.created = true;
          }
          if (home) out.place = home.name;

          const finish = (counts) => {
            const remap = new Map();
            const orphans = new Set(plan.orphans.map(r => r.id));
            for (const group of plan.groups.values()) {
              const [keep, ...rest] = group.slice().sort(roomRank(counts));
              if (orphans.has(keep.id)) { keep.placeId = home.id; rs.put(keep); out.rooms++; }
              for (const r of rest) { remap.set(r.id, keep.id); rs.delete(r.id); out.merged++; }
            }
            const placeOfRoom = new Map(rooms.filter(r => !remap.has(r.id)).map(r => [r.id, r.placeId]));
            let total = 0;
            is.count().onsuccess = (ev) => { total = ev.target.result; onProgress?.(0, total); };
            scanItems(is, (it) => {
              if (!it.roomId) return;   // ohne Raum: bleibt, wie es ist
              let dirty = false;
              if (remap.has(it.roomId)) { it.roomId = remap.get(it.roomId); dirty = true; }
              const want = placeOfRoom.get(it.roomId);
              if (want && it.placeId !== want) { it.placeId = want; dirty = true; }
              // Kein updatedAt: Die Zuordnung ist keine Änderung der Nutzerin.
              if (dirty) { is.put(it); out.items++; }
            }, (seen) => onProgress?.(seen, Math.max(total, seen)),
            // Zwischenstand nach jedem Block – der Browser zeichnet zwischen den Ereignissen.
            (seen) => onProgress?.(seen, Math.max(total, seen)));
            ss.put({ key: 'schemaPlaces', value: 1 });
            if (home && String(set.get('lastRoom') || '').trim() && !set.get('lastPlace')) {
              ss.put({ key: 'lastPlace', value: home.id });
            }
          };

          // Nur bei gleich alten Zwillingen entscheidet die Zahl der Einträge – dann einmal zählen.
          if (!plan.ties) { finish(null); return; }
          const counts = new Map();
          scanItems(is, (it) => { if (it.roomId) counts.set(it.roomId, (counts.get(it.roomId) || 0) + 1); }, () => finish(counts));
        };
      };
    };
    return out;
  });
}
