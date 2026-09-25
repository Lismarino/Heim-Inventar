// Startseite „Zuhause“, der Tab „Räume“ und die Ansicht eines Raums (oder eines Orts).
// Die Daten kommen aus app.js (ctx) – hier wird nur gezeichnet.
// 1.7.0: Orte. Zuhause hat oben einen Umschalter „Alle · Zuhause · Auto …“ (gemerkt in der
// Einstellung homePlace), der Tab „Räume“ gruppiert nach Ort.
import * as db from './db.js';
import * as img from './img.js';
import { esc, icon, plural, isThumb, placeholderHTML, toneOf, initialOf, EMPTY_ART } from './ui.js';
import { placeBadge, placeIcon, safeColor } from './places.js';
import { moveLens } from './glass.js';

const $ = (s) => document.querySelector(s);
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

// { state, catName, roomName, roomById, placeById, placeOf, hasRoom, aiBusy, aiNeedsKey,
//   rowHTML, noRoomItems (= ohne Ort), whereShort, queueNote }
let ctx = null;

export function init(c) { ctx = c; }

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 11) return 'Guten Morgen';
  if (h >= 11 && h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

const live = () => ctx.state.items.filter(i => !i.archived);
const unnamed = (it) => !String(it.name || '').trim() && it.aiState !== 'pending';

/** Zahlen für „Zu erledigen“ – auch für die Tests nützlich. pool: Einträge des gewählten Orts.
 *  „Ohne Ort“ zählt immer alle – solche Einträge gehören ja zu keinem Ort. */
export function todoCounts(pool) {
  const items = pool || live();
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
const HOME_ROOMS_PER_PLACE = 4;   // „Alle“ mit mehreren Orten: je Ort so viele

const multi = () => ctx.state.places.length > 1;
const roomsIn = (pid) => ctx.state.rooms.filter(r => r.placeId === pid);
const inPlace = (pid) => (it) => ctx.placeOf(it)?.id === pid;
/** Einträge, die direkt am Ort liegen – ohne (gültigen) Raum. */
export const directItems = (pid) => live().filter(it => !ctx.hasRoom(it) && it.placeId === pid && ctx.placeById(pid));

/** Gewählter Ort im Umschalter – '' für alle (auch wenn der gemerkte Ort nicht mehr existiert
 *  oder es nur noch einen Ort gibt – dann gibt es keinen Umschalter). */
export function homePlace() {
  const id = ctx.state.settings.homePlace || '';
  return id && multi() && ctx.placeById(id) ? id : '';
}

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

const addTile = (pid) => `<button class="rt rt-add" data-room-add${pid ? ` data-in-place="${esc(pid)}"` : ''}>
  <span class="rt-plus">${icon('plus')}</span><span class="rt-add-txt">Raum hinzufügen</span></button>`;

function noPlaceTile(nr) {
  return `<button class="rt rt-noroom" data-nav="rooms" aria-label="Ohne Ort, ${esc(plural(nr, 'Ding', 'Dinge'))}">
      <span class="rt-pin">${icon('pin')}</span>
      <span class="rt-txt"><b>Ohne Ort</b><small>${esc(plural(nr, 'Ding', 'Dinge'))} zuordnen</small></span></button>`;
}

// Kachel für den Ort selbst: was dort direkt liegt, ohne Raum.
function placeTile(p, items) {
  const withPic = items.filter(i => isThumb(i.thumb)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const count = `${plural(items.length, 'Ding', 'Dinge')} ohne Raum`;
  const art = withPic ? `${pictureHTML(withPic, 'rt-img')}<span class="rt-shade"></span>` : '';
  return `<button class="rt rt-place pc-${safeColor(p.color)}${withPic ? ' has-pic' : ''}" data-place-open="${esc(p.id)}" aria-label="${esc(p.name)} direkt, ${esc(count)}">
    ${art}${placeBadge(p, 'rt-badge')}
    <span class="rt-txt"><b>${esc(p.name)}</b><small>${esc(count)}</small></span>
  </button>`;
}

/**
 * Kacheln eines Orts: erst der Ort selbst (falls etwas direkt dort liegt), dann seine Räume,
 * am Ende „Raum hinzufügen“ – sofern alle Räume gezeigt werden. Liefert { html, shown, total }.
 */
function placeTiles(p, byRoom, { limit = Infinity } = {}) {
  const rooms = p ? roomsIn(p.id) : ctx.state.rooms;
  const tiles = [];
  const direct = p ? directItems(p.id) : [];
  if (direct.length) tiles.push(placeTile(p, direct));
  const shown = rooms.slice(0, limit);
  for (const r of shown) tiles.push(roomTile(r, byRoom.get(r.id) || []));
  if (rooms.length <= limit) tiles.push(addTile(p?.id));
  return { html: tiles.join(''), shown: shown.length, total: rooms.length };
}

// Kopf einer Orts-Gruppe. Zuhause: Überschrift plus Aktion „Nur … zeigen“ (ein Tipp auf den
// Kopf tut dasselbe). Räume-Tab: Name mit ⋯ für die Verwaltung (auch langes Drücken auf den Kopf).
function groupHead(p, n, where) {
  const count = `<span class="sec-n">${n || ''}</span>`;
  if (where === 'home') {
    return `<div class="pgroup-head home" data-home-head="${esc(p.id)}">
      ${placeBadge(p)}<h3 class="pgroup-name">${esc(p.name)}</h3>${count}
      <button type="button" class="pgroup-go" data-home-place="${esc(p.id)}" aria-label="Nur ${esc(p.name)} zeigen">${icon('chev-r', 'go')}</button></div>`;
  }
  return `<div class="pgroup-head" data-place-head="${esc(p.id)}">
      ${placeBadge(p)}<h2 class="pgroup-name">${esc(p.name)}</h2>${count}
      <button type="button" class="pgroup-more" data-place-menu="${esc(p.id)}" aria-label="Ort „${esc(p.name)}“: Aktionen">${icon('more')}</button></div>`;
}

/* ---------------- Umschalter ---------------- */

// Erst ab zwei Orten gibt es etwas umzuschalten. Mit genau einem Ort steht stattdessen ein
// leiser Hinweis „Ort hinzufügen (z. B. Auto)“ da – so findet man die Orte nach dem Update.
function renderSwitch(pid) {
  const box = $('#home-places');
  const places = ctx.state.places;
  box.hidden = places.length < 2;
  $('#home-place-hint').hidden = places.length !== 1;
  if (box.hidden) return;
  const track = box.querySelector('.pswitch-track');
  const sig = places.map(p => [p.id, p.name, p.icon, p.color].join('\u0001')).join('\u0002');
  const fresh = box.dataset.sig !== sig;
  if (fresh) {
    box.dataset.sig = sig;
    track.innerHTML = '<span class="lens" aria-hidden="true"></span>'
      + '<button type="button" class="pseg" data-home-place=""><span>Alle</span></button>'
      + places.map(p => `<button type="button" class="pseg" data-home-place="${esc(p.id)}">${placeIcon(p)}<span>${esc(p.name)}</span></button>`).join('')
      + `<button type="button" class="pseg add" data-place-add aria-label="Ort hinzufügen">${icon('plus')}</button>`;
  }
  let active = null;
  for (const b of track.querySelectorAll('[data-home-place]')) {
    const on = b.dataset.homePlace === pid;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    if (on) active = b;
  }
  moveLens(track.querySelector('.lens'), active, { instant: fresh });
  if (fresh) revealSwitch(false);   // gemerkten Ort gleich ins Bild holen (viele Orte)
}

/** Nach dem Wechsel: den gewählten Ort in den sichtbaren Bereich des Umschalters holen. */
export function revealSwitch(smooth) {
  const b = document.querySelector('#home-places .pseg.on');
  const box = $('#home-places');
  if (!b || !box) return;
  const l = b.offsetLeft - 16, r = b.offsetLeft + b.offsetWidth + 16 - box.clientWidth;
  const to = box.scrollLeft > l ? l : box.scrollLeft < r ? r : null;
  if (to != null) box.scrollTo({ left: Math.max(0, to), behavior: smooth ? 'smooth' : 'auto' });
}

export function renderHome() {
  const { state } = ctx;
  const all = live();
  const pid = homePlace();
  const place = ctx.placeById(pid);
  const items = pid ? all.filter(inPlace(pid)) : all;
  const byRoom = itemsByRoom(items);

  $('#home-date').textContent = dayFmt.format(new Date());
  $('#home-hello').textContent = greeting();
  renderSwitch(pid);
  const used = byRoom.size;
  const usedPlaces = new Set(all.map(it => ctx.placeOf(it)?.id).filter(Boolean)).size;
  const n = `<span class="n">${plural(items.length, 'Ding', 'Dinge')}</span> `;
  $('#home-sum').innerHTML = !all.length
    ? '<span class="n">Willkommen</span> <span class="in">zu Hause</span>'
    : pid && !items.length
      ? `<span class="n">Noch leer</span> <span class="in">– hier liegt noch nichts</span>`
      : pid
        ? n + (used ? `<span class="in">in ${plural(used, 'Raum', 'Räumen')}</span>` : '<span class="in">direkt hier</span>')
        : multi()
          ? n + (usedPlaces ? `<span class="in">an ${plural(usedPlaces, 'Ort', 'Orten')}</span>` : '<span class="in">noch ohne Ort</span>')
          : n + (used ? `<span class="in">in ${plural(used, 'Raum', 'Räumen')}</span>` : '<span class="in">noch ohne Raum</span>');

  // Zu erledigen – für den gewählten Ort; „ohne Ort“ gilt immer.
  const c = todoCounts(items);
  const rows = [];
  if (c.noRoom) rows.push(todoRow('noroom', 'pin', 'clay', `${c.noRoom} ohne Ort`, 'Gesammelt einem Ort zuordnen'));
  if (c.unnamed) rows.push(todoRow('unnamed', 'pencil', 'clay', `${c.unnamed} unbenannt`, 'Antippen und selbst benennen'));
  if (c.busy) rows.push(todoRow('busy', '', 'busy', `${c.busy} ${c.busy === 1 ? 'wird' : 'werden'} erkannt`, ctx.queueNote() || 'Die KI benennt sie im Hintergrund.'));
  if (c.needKey) rows.push(todoRow('needkey', 'sparkle', 'clay', `${c.needKey} ${c.needKey === 1 ? 'wartet' : 'warten'} auf API-Key`, 'Key in den Einstellungen eintragen'));
  const todo = $('#home-todo');
  todo.hidden = !rows.length;
  todo.innerHTML = rows.length ? `<h2 class="todo-title">Zu erledigen</h2>${rows.join('')}` : '';

  // Leer: freundlicher Einstieg statt leerer Streifen
  const empty = !all.length;
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
  $('#home-recent-sec').hidden = !items.length;
  $('#home-recent').innerHTML = recent.map(recentTile).join('');

  // Räume: gewählter Ort (oder der einzige) als ein Raster, „Alle“ mit mehreren Orten gruppiert.
  let html = '', shown = 0, total = 0;
  if (!pid && multi()) {
    html = state.places.map((p) => {
      const t = placeTiles(p, byRoom, { limit: HOME_ROOMS_PER_PLACE });
      shown += t.shown; total += t.total;
      return `<section class="pgroup" aria-label="${esc(p.name)}">${groupHead(p, t.total, 'home')}<div class="room-grid">${t.html}</div></section>`;
    }).join('');
  } else {
    const t = placeTiles(place || (state.places.length === 1 ? state.places[0] : null), byRoom, { limit: HOME_ROOMS });
    shown = t.shown; total = t.total;
    html = `<div class="room-grid">${t.html}</div>`;
  }
  $('#home-rooms').innerHTML = html;
  $('#home-rooms-count').textContent = total ? String(total) : '';
  $('#home-rooms-all').hidden = shown >= total;
  watchCovers($('#view-home'));
}

/* ---------------- Räume (Tab) ---------------- */

export function renderPlaces() {
  const { state } = ctx;
  const byRoom = itemsByRoom(live());
  const parts = [];
  const nr = ctx.noRoomItems().length;
  if (nr) parts.push(`<div class="room-grid">${noPlaceTile(nr)}</div>`);
  for (const p of state.places) {
    const t = placeTiles(p, byRoom);
    parts.push(`<section class="pgroup" aria-label="${esc(p.name)}">${groupHead(p, t.total, 'places')}<div class="room-grid">${t.html}</div></section>`);
  }
  // Räume, deren Ort fehlt (etwa aus einem älteren Tab, bevor der nächste Start sie zuordnet):
  // eigene Gruppe am Ende, mit „Einem Ort zuordnen“ – sonst wären sie hier unsichtbar.
  const lost = state.rooms.filter(r => !ctx.placeById(r.placeId));
  if (lost.length) {
    const tiles = lost.map(r => roomTile(r, byRoom.get(r.id) || [])).join('');
    const act = state.places.length
      ? '<button type="button" class="pgroup-assign" data-rooms-assign>Einem Ort zuordnen</button>' : '';
    parts.push(`<section class="pgroup pgroup-lost" aria-label="Räume ohne Ort"><div class="pgroup-head">
      <span class="pbadge" aria-hidden="true">${icon('pin')}</span><h2 class="pgroup-name">Ohne Ort</h2><span class="sec-n">${lost.length}</span>${act}</div>
      <div class="room-grid">${tiles}</div></section>`);
  }
  // Noch gar kein Ort: „Raum hinzufügen“ legt „Zuhause“ gleich mit an.
  if (!state.places.length && !lost.length) parts.push(`<div class="room-grid">${addTile(null)}</div>`);
  parts.push(`<button type="button" class="place-add" data-place-add>${icon('plus')}<span>Ort hinzufügen</span><small>z. B. Auto, Betrieb, Garten</small></button>`);
  $('#places-grid').innerHTML = parts.join('');
  $('#places-count').textContent = state.rooms.length ? String(state.rooms.length) : '';
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
  const p = ctx.placeOf(it);
  const where = ctx.whereShort(it) || 'Ohne Ort';
  return `<button class="rtile${wait ? ' pending' : ''}${!it.name ? ' unnamed' : ''}" data-id="${esc(it.id)}" aria-label="${esc(name)}">
    <span class="rtile-img">${pic}${wait ? '<span class="spin"></span>' : ''}</span>
    <span class="rtile-name">${esc(name)}</span>
    <span class="rtile-room">${p && multi() ? placeIcon(p) : ''}<span>${esc(where)}</span></span>
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

/* ---------------- Raum (oder Ort ohne Raum) ---------------- */

export function roomItems(roomId) {
  return live().filter(i => i.roomId === roomId);
}

/**
 * Einträge nach Kategorie gruppiert, innerhalb alphabetisch; Unbenanntes ans Ende.
 * roomId: ein Raum. Ohne roomId, aber mit placeId: was direkt am Ort liegt (ohne Raum).
 */
export function renderRoom(roomId, placeId) {
  const room = roomId ? ctx.roomById(roomId) : null;
  const place = room ? ctx.placeById(room.placeId) : (!roomId ? ctx.placeById(placeId) : null);
  if (!room && !place) return false;
  const items = room ? roomItems(room.id) : directItems(place.id);
  const title = room ? room.name : place.name;
  $('#room-title').textContent = title;
  $('#room-bar-title').textContent = title;
  // Über dem Titel: der Ort des Raums (nur bei mehreren Orten) bzw. „ohne Raum“ beim Ort selbst.
  const crumb = $('#room-crumb');
  crumb.hidden = !(place && (!room || multi()));
  crumb.innerHTML = place ? `${placeIcon(place)}<span>${esc(room ? place.name : 'Direkt hier, ohne Raum')}</span>` : '';
  $('#room-menu').setAttribute('aria-label', room ? 'Raum-Aktionen' : 'Ort-Aktionen');
  const groups = new Map();
  for (const it of items) {
    const cat = ctx.catName(it.categoryId);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  }
  const named = groups.size - (groups.has('') ? 1 : 0);
  $('#room-sub').textContent = items.length
    ? plural(items.length, 'Ding', 'Dinge') + (named ? ` · ${plural(named, 'Kategorie', 'Kategorien')}` : '')
    : room ? 'Hier liegt noch nichts.' : 'Hier liegt nichts direkt, ohne Raum.';
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
  const empty = $('#room-empty');
  empty.hidden = items.length > 0;
  empty.querySelector('p').textContent = room
    ? 'Noch nichts in diesem Raum. Fotografiere, was hier steht – es landet gleich richtig.'
    : 'Hier liegt nichts direkt am Ort. Fotografiere, was hier ohne Raum liegt – oder leg Räume an.';
  return true;
}
