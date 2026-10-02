// Ansicht „Ohne Ort“ („noplace“): Einträge ohne Ort gesammelt auswählen und einem Ort/Raum
// zuweisen. Erreichbar über „Wichtig“ auf Start und oben im Tab „Orte“.
import * as db from './db.js';
import { hideCombo } from './combo.js';
import { haptic } from './gestures.js';
import { $, esc, icon, isThumb, placeholderHTML, plural } from './ui.js';
import { aiBusy, aiNeedsKey, noRoomItems, placeById, reloadAll, state, whereText } from './state.js';
import { toast } from './toast.js';
import { openItem } from './view-item.js';
import { drawPlaceChips, followPlace, pickPlace, resolveWhere } from './where.js';

// Neue Runde: nichts markiert, Ort vorbelegt (gemerkter Ort der Schnellerfassung, sonst der erste).
export function resetRoomSel() {
  state.roomSel.clear();
  state.rsPlace = placeById(state.settings.lastPlace)?.id || state.places[0]?.id || '';
  $('#rs-room').value = '';
  $('#rs-loc').value = '';
}

// Das Ankreuzfeld (role=checkbox) und der Stift sind Geschwister – ein Knopf darf
// nicht in einem anderen bedienbaren Element stecken.
function pickHTML(it) {
  const on = state.roomSel.has(it.id);
  const wait = aiBusy(it);
  const pic = isThumb(it.thumb) ? `<img src="${esc(it.thumb)}" alt="">` : placeholderHTML(it, 'pick-ph');
  const label = it.name || (wait ? 'wird erkannt' : aiNeedsKey(it) ? 'wartet auf API-Key' : 'Unbenannt');
  const name = wait
    ? `<span class="spin"></span>${esc(it.name || 'wird erkannt …')}`
    : esc(label);
  return `<div class="pick${on ? ' on' : ''}" data-id="${esc(it.id)}">
    <div class="pick-toggle" role="checkbox" aria-checked="${on}" tabindex="0" aria-label="${esc(label)}">
      <div class="pick-img">${pic}<span class="pick-check" aria-hidden="true">${icon('check')}</span></div>
      <div class="pick-name${!it.name && !wait ? ' unnamed' : ''}">${name}</div>
    </div>
    <button class="pick-edit" data-edit aria-label="${esc(label)} öffnen">${icon('pencil')}</button>
  </div>`;
}

export function renderNoPlace() {
  const rows = noRoomItems();
  const ids = new Set(rows.map(r => r.id));
  for (const id of [...state.roomSel]) if (!ids.has(id)) state.roomSel.delete(id);
  $('#rs-main').hidden = !rows.length;
  $('#rs-bar').hidden = !rows.length;
  $('#rs-empty').hidden = rows.length > 0;
  $('#rs-grid').innerHTML = rows.map(pickHTML).join('');
  drawPlaceChips($('#rs-places'), state.rsPlace, { add: false, label: 'Ort' });
  $('#rs-room').dataset.place = state.rsPlace;
  updateAssignButton();
}

function updateAssignButton() {
  const n = state.roomSel.size;
  const btn = $('#rs-assign');
  btn.disabled = !n;
  btn.textContent = n ? `${n} zuweisen` : 'Zuweisen';
}

function togglePick(el) {
  const id = el.dataset.id;
  const on = !state.roomSel.has(id);
  if (on) state.roomSel.add(id); else state.roomSel.delete(id);
  el.classList.toggle('on', on);
  el.querySelector('.pick-toggle').setAttribute('aria-checked', String(on));
  updateAssignButton();
}

async function assignRooms() {
  const ids = [...state.roomSel];
  if (!ids.length) return;
  const room = $('#rs-room').value.trim();
  if (!state.rsPlace && !room) { toast('Bitte einen Ort wählen.', true); return; }
  const btn = $('#rs-assign');
  btn.disabled = true;
  try {
    const where = await resolveWhere(state.rsPlace, room);
    const res = await db.moveItems(ids, where.placeId, where.roomId, $('#rs-loc').value);
    state.roomSel.clear();
    hideCombo();
    await reloadAll();
    renderNoPlace();
    haptic();
    toast(`${plural(res.changed, 'Ding', 'Dinge')} → ${whereText(where.placeId, where.roomId)}`);
  } catch (e) {
    toast('Zuweisen fehlgeschlagen: ' + e.message, true);
  } finally {
    updateAssignButton();
  }
}

export function init() {
  $('#rs-places').addEventListener('click', (e) => {
    const next = pickPlace(e, state.rsPlace, (id) => { if (id) { state.rsPlace = id; renderNoPlace(); } });
    if (next == null) return;
    state.rsPlace = next;
    followPlace($('#rs-room'), next);
    renderNoPlace();
  });
  $('#rs-grid').addEventListener('click', (e) => {
    const pick = e.target.closest('.pick');
    if (!pick) return;
    if (e.target.closest('[data-edit]')) { openItem(pick.dataset.id); return; }
    togglePick(pick);
  });
  $('#rs-grid').addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && e.target.matches('.pick-toggle')) { e.preventDefault(); togglePick(e.target.closest('.pick')); }
  });
  $('#rs-all').addEventListener('click', () => {
    for (const it of noRoomItems()) state.roomSel.add(it.id);
    renderNoPlace();
  });
  $('#rs-none').addEventListener('click', () => { state.roomSel.clear(); renderNoPlace(); });
  $('#rs-assign').addEventListener('click', assignRooms);
}
