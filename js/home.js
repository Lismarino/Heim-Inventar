// Startseite „Zuhause“, der Tab „Räume“ und die Ansicht eines Raums.
// Die Daten kommen aus app.js (ctx) – hier wird nur gezeichnet.
import * as db from './db.js';
import * as img from './img.js';
import { esc, icon, plural, isThumb, placeholderHTML, toneOf, initialOf, EMPTY_ART } from './ui.js';

const $ = (s) => document.querySelector(s);
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

let ctx = null;   // { state, catName, aiBusy, aiNeedsKey, hasRoom, rowHTML, noRoomItems, queueNote }

export function init(c) { ctx = c; }

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 11) return 'Guten Morgen';
  if (h >= 11 && h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

const live = () => ctx.state.items.filter(i => !i.archived);
const unnamed = (it) => !String(it.name || '').trim() && it.aiState !== 'pending';

/** Zahlen für „Zu erledigen“ – auch für die Tests nützlich. */
export function todoCounts() {
  const items = live();
  return {
    noRoom: ctx.noRoomItems().length,
    unnamed: items.filter(unnamed).length,
    busy: items.filter(ctx.aiBusy).length,
    needKey: items.filter(ctx.aiNeedsKey).length,
  };
}
export const isUnnamed = unnamed;

/* ---------------- Titelbilder ----------------
   Die gespeicherten Vorschaubilder haben nur 160 px – für große Kacheln zu unscharf.
   Deshalb aus dem Original einmal eine 480-px-Fassung machen und für die Sitzung
   merken. Bis sie da ist, steht das kleine Vorschaubild da. Dekodiert wird nur für
   Kacheln, die gerade (fast) im Bild sind und in einer sichtbaren Ansicht liegen –
   dafür beobachtet ein IntersectionObserver die Bilder. */

const covers = new Map();    // photoId -> Object-URL | Promise
const COVER_MAX = 60;
let coverChain = Promise.resolve();

function coverURL(photoId) {
  const c = covers.get(photoId);
  return typeof c === 'string' ? c : null;
}

// Liegt das Bild in einer Ansicht, die man gerade sieht? (Versteckte Ansichten bleiben
// im Layout und würden sonst als „im Bild“ gelten.)
const onScreen = (el) => el.isConnected && !el.closest('.view[hidden]');

let io = null;
function observer() {
  if (io || typeof IntersectionObserver !== 'function') return io;
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || !onScreen(e.target)) continue;
      io.unobserve(e.target);
      watched.delete(e.target);
      wantCover(e.target.dataset.cover);
    }
  }, { rootMargin: '240px 0px' });
  return io;
}

// Nach dem Zeichnen: Bilder ohne scharfe Fassung beobachten, verwaiste URLs freigeben.
const watched = new Set();
function watchCovers(root) {
  const obs = observer();
  for (const el of watched) if (!el.isConnected) { obs?.unobserve(el); watched.delete(el); }
  for (const el of root.querySelectorAll('img[data-cover]')) {
    if (coverURL(el.dataset.cover)) continue;
    if (obs) { obs.observe(el); watched.add(el); }
    else if (onScreen(el)) wantCover(el.dataset.cover);   // sehr alte Browser: gleich laden
  }
  pruneCovers();
}

// Scharfe Fassungen, die keine Kachel mehr zeigt (Raum gelöscht, Eintrag archiviert
// oder nicht mehr unter den neuesten), gleich freigeben statt sie bis COVER_MAX zu horten.
function pruneCovers() {
  const used = new Set([...document.querySelectorAll('img[data-cover]')].map(el => el.dataset.cover));
  for (const [id, v] of covers) {
    if (typeof v !== 'string' || used.has(id)) continue;
    URL.revokeObjectURL(v);
    covers.delete(id);
  }
}

function wantCover(photoId) {
  if (!photoId || covers.has(photoId)) return;
  const job = coverChain.then(async () => {
    let src = null;
    try {
      // Inzwischen weggescrollt, neu gezeichnet oder die Ansicht verlassen: nicht dekodieren.
      const want = [...document.querySelectorAll(`img[data-cover="${CSS.escape(photoId)}"]`)].some(onScreen);
      if (!want) { covers.delete(photoId); return; }
      const photo = await db.get('photos', photoId);
      if (!photo) { covers.delete(photoId); return; }
      src = await img.decode(new Blob([photo.buf], { type: photo.type || 'image/jpeg' }));
      const blob = await img.toBlob(src, 480, 0.8);
      const url = URL.createObjectURL(blob);
      covers.set(photoId, url);
      trimCovers();
      for (const el of document.querySelectorAll(`img[data-cover="${CSS.escape(photoId)}"]`)) {
        el.src = url;
        io?.unobserve(el);
        watched.delete(el);
      }
    } catch (e) {
      covers.delete(photoId);
      console.warn('Titelbild:', e);
    } finally {
      img.release(src);
    }
  });
  covers.set(photoId, job);
  coverChain = job.catch(() => null);
}

function trimCovers() {
  if (covers.size <= COVER_MAX) return;
  for (const [id, v] of covers) {
    if (covers.size <= COVER_MAX) break;
    if (typeof v !== 'string' || document.querySelector(`img[data-cover="${CSS.escape(id)}"]`)) continue;
    URL.revokeObjectURL(v);
    covers.delete(id);
  }
}

// Bild für eine Kachel: scharfe Fassung, falls schon da, sonst das Vorschaubild.
// Die scharfe Fassung bestellt erst watchCovers(), sobald die Kachel zu sehen ist.
function pictureHTML(it, cls) {
  if (!isThumb(it.thumb)) return '';
  const sharp = it.photoId ? coverURL(it.photoId) : null;
  return `<img class="${cls}" src="${esc(sharp || it.thumb)}" alt=""${it.photoId ? ` data-cover="${esc(it.photoId)}"` : ''} draggable="false">`;
}

/* ---------------- Zuhause ---------------- */

// Auf Zuhause stehen nur die ersten Räume, alle weiteren im Tab „Räume“.
export const HOME_ROOMS = 6;

function itemsByRoom(items) {
  const byRoom = new Map();
  for (const it of items) {
    if (!ctx.hasRoom(it)) continue;
    const list = byRoom.get(it.roomId) || [];
    list.push(it);
    byRoom.set(it.roomId, list);
  }
  return byRoom;
}

/**
 * Kacheln für ein Raum-Raster – gemeinsam für Zuhause und den Tab „Räume“.
 * limit: höchstens so viele Räume; noRoom: Kachel „Ohne Raum“ voranstellen (wenn > 0);
 * „Raum hinzufügen“ steht am Ende, sofern alle Räume gezeigt werden.
 */
function roomTilesHTML(byRoom, { limit = Infinity, noRoom = false } = {}) {
  const rooms = ctx.state.rooms;
  const tiles = rooms.slice(0, limit).map(r => roomTile(r, byRoom.get(r.id) || []));
  const nr = noRoom ? ctx.noRoomItems().length : 0;
  if (nr) {
    tiles.unshift(`<button class="rt rt-noroom" data-nav="rooms" aria-label="Ohne Raum, ${esc(plural(nr, 'Ding', 'Dinge'))}">
      <span class="rt-pin">${icon('pin')}</span>
      <span class="rt-txt"><b>Ohne Raum</b><small>${esc(plural(nr, 'Ding', 'Dinge'))} zuordnen</small></span></button>`);
  }
  if (rooms.length <= limit) {
    tiles.push(`<button class="rt rt-add" data-room-add>
      <span class="rt-plus">${icon('plus')}</span><span class="rt-add-txt">Raum hinzufügen</span></button>`);
  }
  return tiles.join('');
}

export function renderHome() {
  const { state } = ctx;
  const items = live();
  const rooms = state.rooms;
  const byRoom = itemsByRoom(items);

  $('#home-date').textContent = dayFmt.format(new Date());
  $('#home-hello').textContent = greeting();
  const used = byRoom.size;
  $('#home-sum').innerHTML = items.length
    ? `<span class="n">${plural(items.length, 'Ding', 'Dinge')}</span> `
      + (used ? `<span class="in">in ${plural(used, 'Raum', 'Räumen')}</span>` : '<span class="in">noch ohne Raum</span>')
    : '<span class="n">Willkommen</span> <span class="in">zu Hause</span>';

  // Zu erledigen
  const c = todoCounts();
  const rows = [];
  if (c.noRoom) rows.push(todoRow('noroom', 'pin', 'clay', `${c.noRoom} ohne Raum`, 'Gesammelt einem Raum zuordnen'));
  if (c.unnamed) rows.push(todoRow('unnamed', 'pencil', 'clay', `${c.unnamed} unbenannt`, 'Antippen und selbst benennen'));
  if (c.busy) rows.push(todoRow('busy', '', 'busy', `${c.busy} ${c.busy === 1 ? 'wird' : 'werden'} erkannt`, ctx.queueNote() || 'Die KI benennt sie im Hintergrund.'));
  if (c.needKey) rows.push(todoRow('needkey', 'sparkle', 'clay', `${c.needKey} ${c.needKey === 1 ? 'wartet' : 'warten'} auf API-Key`, 'Key in den Einstellungen eintragen'));
  const todo = $('#home-todo');
  todo.hidden = !rows.length;
  todo.innerHTML = rows.length ? `<h2 class="todo-title">Zu erledigen</h2>${rows.join('')}` : '';

  // Leer: freundlicher Einstieg statt leerer Streifen
  const empty = !items.length;
  $('#home-empty').hidden = !empty;
  if (empty && !$('#home-empty').innerHTML) {
    $('#home-empty').innerHTML = `${EMPTY_ART}
      <strong>Noch nichts erfasst</strong>
      <p>Fotografiere, was du aufbewahrst. Die App erkennt, was drauf ist, und merkt sich, wo es liegt.</p>
      <button class="cap-btn cam home-cta" data-nav="add">
        <span class="cap-ic">${icon('camera')}</span>
        <span class="cap-txt"><b>Erstes Foto aufnehmen</b><small>Stück für Stück, Raum für Raum</small></span>
      </button>`;
  }

  // Zuletzt hinzugefügt
  const recent = items.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 14);
  $('#home-recent-sec').hidden = empty;
  $('#home-recent').innerHTML = recent.map(recentTile).join('');

  // Räume – die ersten sechs, „Alle“ führt in den Tab
  $('#home-rooms').innerHTML = roomTilesHTML(byRoom, { limit: HOME_ROOMS });
  $('#home-rooms-count').textContent = rooms.length ? String(rooms.length) : '';
  $('#home-rooms-all').hidden = rooms.length <= HOME_ROOMS;
  watchCovers($('#view-home'));
}

/* ---------------- Räume (Tab) ---------------- */

export function renderPlaces() {
  const rooms = ctx.state.rooms;
  $('#places-grid').innerHTML = roomTilesHTML(itemsByRoom(live()), { noRoom: true });
  $('#places-count').textContent = rooms.length ? String(rooms.length) : '';
  watchCovers($('#view-places'));
}

function todoRow(kind, ic, tone, title, sub) {
  const badge = tone === 'busy' ? '<span class="spin"></span>' : icon(ic);
  return `<button class="todo-row" data-todo="${kind}">
    <span class="todo-ic ${tone}">${badge}</span>
    <span class="todo-txt"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
    ${icon('chev-r', 'go')}
  </button>`;
}

function recentTile(it) {
  const wait = ctx.aiBusy(it);
  const pic = pictureHTML(it, 'rtile-pic') || placeholderHTML(it, 'rtile-pic');
  const name = it.name || (wait ? 'wird erkannt …' : ctx.aiNeedsKey(it) ? 'Wartet auf Key' : 'Unbenannt');
  const room = ctx.hasRoom(it) ? ctx.roomName(it.roomId) : 'Ohne Raum';
  return `<button class="rtile${wait ? ' pending' : ''}${!it.name ? ' unnamed' : ''}" data-id="${esc(it.id)}" aria-label="${esc(name)}">
    <span class="rtile-img">${pic}${wait ? '<span class="spin"></span>' : ''}</span>
    <span class="rtile-name">${esc(name)}</span>
    <span class="rtile-room">${esc(room)}</span>
  </button>`;
}

function roomTile(room, items) {
  const withPic = items.filter(i => isThumb(i.thumb)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const n = items.length;
  const count = n ? plural(n, 'Ding', 'Dinge') : 'noch leer';
  const art = withPic
    ? `${pictureHTML(withPic, 'rt-img')}<span class="rt-shade"></span>`
    : `<span class="rt-ph"><span class="rt-initial">${esc(initialOf(room.name))}</span>${icon('door', 'rt-door')}</span>`;
  return `<button class="rt ${withPic ? 'has-pic' : `ph-${toneOf(room.name)}`}" data-room="${esc(room.id)}" aria-label="${esc(room.name)}, ${esc(count)}">
    ${art}
    <span class="rt-txt"><b>${esc(room.name)}</b><small>${esc(count)}</small></span>
  </button>`;
}

/* ---------------- Raum ---------------- */

export function roomItems(roomId) {
  return live().filter(i => i.roomId === roomId);
}

/** Einträge nach Kategorie gruppiert, innerhalb alphabetisch; Unbenanntes ans Ende. */
export function renderRoom(roomId) {
  const room = ctx.state.rooms.find(r => r.id === roomId);
  if (!room) return false;
  const items = roomItems(roomId);
  $('#room-title').textContent = room.name;
  $('#room-bar-title').textContent = room.name;
  const groups = new Map();
  for (const it of items) {
    const cat = ctx.catName(it.categoryId);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  }
  const named = groups.size - (groups.has('') ? 1 : 0);
  $('#room-sub').textContent = items.length
    ? plural(items.length, 'Ding', 'Dinge') + (named ? ` · ${plural(named, 'Kategorie', 'Kategorien')}` : '')
    : 'Hier liegt noch nichts.';
  const byName = (a, b) => {
    if (!a.name !== !b.name) return a.name ? -1 : 1;
    return collator.compare(a.name || '', b.name || '') || b.createdAt - a.createdAt;
  };
  const keys = [...groups.keys()].sort((a, b) => (!a) - (!b) || collator.compare(a, b));
  const grouped = keys.length > 1;
  $('#room-list').innerHTML = keys.map((k) => {
    const rows = groups.get(k).sort(byName).map(it => ctx.rowHTML(it, { inRoom: true, noCat: grouped })).join('');
    const head = grouped ? `<h3 class="sec grp">${esc(k || 'Ohne Kategorie')}<span>${groups.get(k).length}</span></h3>` : '';
    return `${head}<div class="list">${rows}</div>`;
  }).join('');
  $('#room-empty').hidden = items.length > 0;
  return true;
}
