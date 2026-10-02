// Tab „Orte“ (2.0, bis 1.11 „Räume“): je Ort ein Kopf mit Symbol, Anzahl und ⋯, darunter die
// Räume als kompakte Zeilen; oben „Ohne Ort (n)“, wenn etwas keinen Ort hat. Angelegt wird über
// „+“ oben rechts (Neuer Ort / Neuer Raum in …) oder das ⋯ eines Orts; die Checkliste steht im
// ⋯ und in der Ortsansicht.
import * as home from './home.js';
import * as sheet from './sheet.js';
import { longPress } from './gestures.js';
import { placeBadge, safeIcon } from './places.js';
import { $, esc, icon, initialOf, isThumb, plural, toneOf } from './ui.js';
import { hasRoom, noRoomItems, placeById, placeOf, roomsIn, state } from './state.js';
import { addPlaceSheet, addRoomSheet, assignLostRoomsSheet, openPlace, openRoom, placeMenu, roomMenu } from './view-room.js';

const live = () => state.items.filter(i => !i.archived);

// Kleines Bild einer Zeile: das neueste Foto darin, sonst der Anfangsbuchstabe.
function pic(items, name, fallback = '') {
  const withPic = items.filter(i => isThumb(i.thumb)).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (withPic) return `<img class="o-pic" src="${esc(withPic.thumb)}" alt="" loading="lazy" decoding="async" draggable="false">`;
  return fallback || `<span class="o-pic ph ph-${toneOf(name)}" aria-hidden="true">${esc(initialOf(name))}</span>`;
}

function roomRow(r, items) {
  const n = items.length;
  return `<button type="button" class="orow" data-room="${esc(r.id)}">
    ${pic(items, r.name)}
    <span class="o-txt"><b>${esc(r.name)}</b><small>${esc(n ? plural(n, 'Ding', 'Dinge') : 'noch leer')}</small></span>
    ${icon('chev-r', 'go')}</button>`;
}

// Was direkt am Ort liegt (ohne Raum) – öffnet die Ortsansicht.
function directRow(p, items) {
  return `<button type="button" class="orow" data-place-open="${esc(p.id)}">
    ${pic(items, p.name, `<span class="o-pic ph ph-none" aria-hidden="true">${icon('pl-' + safeIcon(p.icon))}</span>`)}
    <span class="o-txt"><b>Direkt in ${esc(p.name)}</b><small>${esc(plural(items.length, 'Ding', 'Dinge'))} ohne Raum</small></span>
    ${icon('chev-r', 'go')}</button>`;
}

function placeHead(p, rooms, n) {
  return `<div class="ogroup-head" data-place-head="${esc(p.id)}">
    ${placeBadge(p)}<span class="o-txt"><h2 class="ogroup-name">${esc(p.name)}</h2><small>${esc(`${plural(rooms, 'Raum', 'Räume')} · ${plural(n, 'Ding', 'Dinge')}`)}</small></span>
    <button type="button" class="pgroup-more" data-place-menu="${esc(p.id)}" aria-label="Ort „${esc(p.name)}“: Aktionen">${icon('more')}</button></div>`;
}

export function renderOrte() {
  const items = live();
  const byRoom = new Map();
  for (const it of items) {
    if (!hasRoom(it)) continue;
    if (!byRoom.has(it.roomId)) byRoom.set(it.roomId, []);
    byRoom.get(it.roomId).push(it);
  }
  const parts = [];
  const nr = noRoomItems().length;
  if (nr) {
    parts.push(`<button type="button" class="orow o-noplace" data-nav="noplace">
      <span class="o-pic">${icon('pin')}</span>
      <span class="o-txt"><b>Ohne Ort <span class="o-n">${nr}</span></b><small>Antippen und gesammelt zuordnen</small></span>
      ${icon('chev-r', 'go')}</button>`);
  }
  for (const p of state.places) {
    const rooms = roomsIn(p.id);
    const direct = home.directItems(p.id);
    const n = items.filter(it => placeOf(it)?.id === p.id).length;
    const rows = (direct.length ? directRow(p, direct) : '') + rooms.map(r => roomRow(r, byRoom.get(r.id) || [])).join('');
    parts.push(`<section class="ogroup" aria-label="${esc(p.name)}">${placeHead(p, rooms.length, n)}`
      + (rows ? `<div class="olist">${rows}</div>` : '<p class="hint ogroup-empty">Noch keine Räume – über ⋯ oder „+“ oben anlegen.</p>')
      + '</section>');
  }
  // Räume, deren Ort fehlt (etwa aus einem älteren Tab, bevor der nächste Start sie zuordnet):
  // eigene Gruppe am Ende, mit „Einem Ort zuordnen“ – sonst wären sie hier unsichtbar.
  const lost = state.rooms.filter(r => !placeById(r.placeId));
  if (lost.length) {
    const act = state.places.length ? '<button type="button" class="pgroup-assign" data-rooms-assign>Einem Ort zuordnen</button>' : '';
    parts.push(`<section class="ogroup ogroup-lost" aria-label="Räume ohne Ort"><div class="ogroup-head">
      <span class="pbadge" aria-hidden="true">${icon('pin')}</span><span class="o-txt"><h2 class="ogroup-name">Räume ohne Ort</h2><small>${esc(plural(lost.length, 'Raum', 'Räume'))}</small></span>${act}</div>
      <div class="olist">${lost.map(r => roomRow(r, byRoom.get(r.id) || [])).join('')}</div></section>`);
  }
  if (!state.places.length && !lost.length) {
    parts.push(`<div class="empty"><span class="empty-badge muted">${icon('pin')}</span><p>Noch keine Orte. Tippe oben auf „+“, um „Zuhause“, „Auto“ oder einen anderen Ort anzulegen.</p></div>`);
  }
  $('#orte-list').innerHTML = parts.join('');
}

/** „+“ oben rechts: Neuer Ort – oder ein neuer Raum in einem der Orte. */
function addMenu() {
  const places = state.places;
  sheet.open({
    head: `<span class="sh-pic ph ph-none">${icon('rooms')}</span><span class="sh-txt"><b>Hinzufügen</b><small>${esc(places.length ? plural(places.length, 'Ort', 'Orte') : 'Noch kein Ort')}</small></span>`,
    actions: [
      { id: 'place', label: 'Neuer Ort', icon: 'plus' },
      ...(places.length
        ? places.map(p => ({ id: 'room:' + p.id, label: places.length > 1 ? `Neuer Raum in ${p.name}` : 'Neuer Raum', icon: 'pl-' + safeIcon(p.icon) }))
        : [{ id: 'room:', label: 'Neuer Raum', icon: 'door' }]),
    ],
    onAction: (a) => {
      if (a === 'place') addPlaceSheet();
      else if (a.startsWith('room:')) addRoomSheet(a.slice(5));
    },
  });
}

function onClick(e) {
  const nav = e.target.closest('[data-nav]');
  if (nav) return;   // erledigt der allgemeine Klick (app.js)
  if (e.target.closest('[data-rooms-assign]')) { assignLostRoomsSheet(); return; }
  const pm = e.target.closest('[data-place-menu]');
  if (pm) { placeMenu(pm.dataset.placeMenu); return; }
  const po = e.target.closest('[data-place-open]');
  if (po) { openPlace(po.dataset.placeOpen); return; }
  const rt = e.target.closest('[data-room]');
  if (rt) openRoom(rt.dataset.room);
}

export function init() {
  $('#orte-add').addEventListener('click', addMenu);
  const list = $('#orte-list');
  list.addEventListener('click', onClick);
  longPress(list, '.orow[data-room]', (el) => roomMenu(el.dataset.room));
  longPress(list, '.orow[data-place-open]', (el) => placeMenu(el.dataset.placeOpen));
  longPress(list, '.ogroup-head[data-place-head]', (el) => placeMenu(el.dataset.placeHead));
}
