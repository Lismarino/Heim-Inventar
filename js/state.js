// Gemeinsamer Zustand der App und die Nachschlage-Hilfen darauf (Ort, Raum, Kategorie eines
// Eintrags). reloadAll() holt alles frisch aus der Datenbank.
import * as db from './db.js';
import { docTitles, loadIndex } from './docs.js';
import { byOrder } from './places.js';
import { refreshPickers } from './view-list.js';

export const state = {
  settings: {},
  items: [],
  cats: [],
  rooms: [],
  places: [],       // Orte, geordnet (1.7.0)
  view: 'home',
  stack: ['home'],  // Navigationsstapel: unten der Tab, oben die aktuelle Ansicht
  roomId: null,     // Raum-Ansicht: welcher Raum
  placeId: null,    // … oder ohne Raum: welcher Ort (was direkt dort liegt)
  rsPlace: '',      // „Ohne Ort“: gewählter Ort in der Zuweisen-Leiste
  itPlace: '',      // Eintrag: gewählter Ort
  listFilter: null, // „Alles“: null | 'unnamed' | 'out' | 'warranty'
  sel: null,        // Mehrfachauswahl: null (aus) oder Set der markierten IDs
  checks: new Map(),  // Checkliste: Orts-ID -> Set abgehakter IDs – nur für diese Sitzung
  docs: [],         // Detail: Belege des offenen Eintrags
  homeBackup: '',   // Zuhause-Karte „Sicherung“: '' | 'building' | 'ready'
  capture: { ids: [], busy: '' },   // Schnellerfassung: in dieser Runde erfasste Einträge
  roomSel: new Set(),               // „Ohne Ort“: markierte Einträge
  scrollPos: {},                    // Ansicht -> Scroll-Position beim Verlassen
  currentId: null,
  shown: {},        // Detail: zuletzt angezeigte Feldwerte – gespeichert wird nur, was davon abweicht
  detailURL: null,
  lightboxURL: null,
  aiSearch: null,   // { question, answer, matches:[{item, why}] }
};

export const catName = (id) => state.cats.find(c => c.id === id)?.name || '';
export const roomById = (id) => (id && state.rooms.find(r => r.id === id)) || null;
export const placeById = (id) => (id && state.places.find(p => p.id === id)) || null;
export const roomName = (id) => roomById(id)?.name || '';
export const placeName = (id) => placeById(id)?.name || '';
export const roomsIn = (pid) => state.rooms.filter(r => r.placeId === pid);
export const multiPlaces = () => state.places.length > 1;
export const low = (s) => String(s || '').trim().toLowerCase();
export const hasKey = () => !!(state.settings.apiKey || '').trim();
// Raum zählt nur, wenn es ihn auch gibt – eine Sicherung kann tote Verweise enthalten.
export const hasRoom = (it) => !!roomById(it.roomId);
// Ort eines Eintrags: der seines Raums, sonst der, an dem er direkt liegt (db.js, oben).
export const placeOf = (it) => { const r = roomById(it.roomId); return r ? placeById(r.placeId) : placeById(it.placeId); };
// Zugeordnet ist, was in einem Raum oder direkt an einem Ort liegt. Ein Raum zählt auch dann,
// wenn sein Ort (noch) fehlt – so springt nichts nach „Ohne Ort“, falls die Zuordnung hakt.
export const hasPlace = (it) => hasRoom(it) || !!placeById(it.placeId);
// „Auto › Kofferraum“. Den Ort nur, wenn es mehrere gibt oder kein Raum da ist – mit einem
// einzigen Ort versteht er sich von selbst.
export function whereText(placeId, roomId, sep = ' › ') {
  const r = roomById(roomId);
  const p = r ? placeById(r.placeId) : placeById(placeId);
  return [p && (multiPlaces() || !r) ? p.name : '', r ? r.name : ''].filter(Boolean).join(sep);
}
export const whereOf = (it, sep) => whereText(it.placeId, it.roomId, sep);
export const whereShort = (it) => roomName(it.roomId) || placeOf(it)?.name || '';
// Wartet ein Eintrag auf die Erkennung, geht das nur mit Key voran. Ohne Key nicht
// ewig „wird erkannt …“ drehen, sondern sagen, woran es hängt.
export const aiBusy = (it) => it.aiState === 'pending' && hasKey();
export const aiNeedsKey = (it) => it.aiState === 'pending' && !hasKey();
// „Ohne Ort“ (Name aus der Zeit, als es „Ohne Raum“ hieß): weder Raum noch Ort.
export const noRoomItems = () => state.items
  .filter(i => !i.archived && !hasPlace(i))
  .sort((a, b) => b.createdAt - a.createdAt);

export async function reloadAll() {
  const [settings, items, cats, rooms, places] = await Promise.all([
    db.loadSettings(), db.getAll('items'), db.getAll('categories'), db.getAll('rooms'), db.getAll('places'),
  ]);
  state.settings = settings;
  state.items = items;
  state.cats = cats.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  state.rooms = rooms.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  state.places = places.sort(byOrder);
  // Ort am Eintrag mit dem seines Raums gleichziehen, falls ein älterer Tab (oder eine alte
  // Fassung) einen Eintrag ohne placeId geschrieben hat – ohne extra Lesen, nur bei Bedarf.
  const drift = items.filter(it => { const r = roomById(it.roomId); return r && placeById(r.placeId) && it.placeId !== r.placeId; });
  if (drift.length) {
    for (const it of drift) it.placeId = roomById(it.roomId).placeId;
    await db.syncItemPlaces(drift.map(it => it.id)).catch((e) => console.warn('Orte nachziehen:', e));
  }
  // Gemerkte Orte, die es nicht mehr gibt (gelöscht, Sicherung ersetzt): vergessen.
  if (settings.lastPlace && !placeById(settings.lastPlace)) settings.lastPlace = '';
  if (settings.homePlace && !placeById(settings.homePlace)) settings.homePlace = '';
  if (state.rsPlace && !placeById(state.rsPlace)) state.rsPlace = '';
  refreshPickers();
  // Dokumente (für Fristen auf Zuhause); scheitert das, startet die App trotzdem.
  await loadIndex().catch((e) => console.warn('Dokumente laden:', e));
}

// Vorschläge: Kategorien; Räume nur aus dem Ort des Felds (data-place), ohne Ort alle.
export function comboSource(kind, input) {
  if (kind === 'categories') return state.cats.map(c => c.name);
  if (kind === 'doctitles') return docTitles();
  if (kind === 'items') return [...new Map(state.items.filter(i => !i.archived && i.name).map(i => [low(i.name), i.name])).values()];
  const pid = input?.dataset.place || '';
  const rooms = pid && placeById(pid) ? roomsIn(pid) : state.rooms;
  return [...new Map(rooms.map(r => [low(r.name), r.name])).values()];
}

// Leichter als reloadAll(): nur Einträge und Kategorien – für die Hintergrund-Erkennung.
export async function refreshItems() {
  const [items, cats] = await Promise.all([db.getAll('items'), db.getAll('categories')]);
  state.items = items;
  const before = state.cats.map(c => c.id + c.name).join('|');
  state.cats = cats.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (state.cats.map(c => c.id + c.name).join('|') !== before) refreshPickers();
}
