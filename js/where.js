// Orte als gemeinsamer Baustein: Orts-Chips, Raumfeld, das dem Ort folgt, Auflösen von Ort und
// Raum in IDs, Blatt „Ort ändern“ für einen oder mehrere Einträge.
import * as db from './db.js';
import * as sheet from './sheet.js';
import { hideCombo } from './combo.js';
import { haptic } from './gestures.js';
import { placeChipsHTML } from './places.js';
import { $, $$, esc, icon, plural } from './ui.js';
import { renderCurrent } from './nav.js';
import { itemHead, moveSelected } from './select.js';
import { hasPlace, hasRoom, low, placeById, placeName, placeOf, reloadAll, roomById, roomName, roomsIn, state, whereText } from './state.js';
import { toast } from './toast.js';
import { addPlaceSheet } from './view-room.js';

// Chips zur Wahl des Orts in `box` zeichnen – nur neu, wenn sich Orte oder Wahl geändert
// haben (sonst springt die Chip-Reihe beim Hintergrund-Aktualisieren an den Anfang zurück).
export function drawPlaceChips(box, selected, opts) {
  const sig = state.places.map(p => [p.id, p.name, p.icon, p.color].join('\u0001')).join('\u0002') + '|' + selected;
  if (box.dataset.sig === sig) return;
  const first = box.dataset.sig == null;
  box.dataset.sig = sig;
  const keep = box.querySelector('.pchips')?.scrollLeft || 0;
  box.innerHTML = placeChipsHTML(state.places, selected, opts);
  const row = box.querySelector('.pchips');
  if (!first) row.scrollLeft = keep;
  const on = row.querySelector('.pchip.on');
  if (on && (on.offsetLeft < row.scrollLeft || on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth)) {
    row.scrollLeft = Math.max(0, on.offsetLeft - 16);
  }
}

// Den gewählten Chip waagerecht mittig zeigen – wie scrollIntoView({ inline: 'center' }),
// aber nur in der Chip-Reihe, damit die Seite nicht senkrecht springt.
export function centerChip(box) {
  const row = box?.querySelector('.pchips');
  const on = row?.querySelector('.pchip.on');
  if (!on || !row.clientWidth) return;
  const a = on.getBoundingClientRect();
  const b = row.getBoundingClientRect();
  row.scrollLeft = Math.max(0, row.scrollLeft + (a.left + a.width / 2) - (b.left + b.width / 2));
}

// Tipp auf einen Orts-Chip: gewählt – oder, noch einmal angetippt, wieder offen.
// Liefert die neue Wahl, null bei einem Tipp daneben; „Neuer Ort“ öffnet das Anlegen.
export function pickPlace(e, current, onNew) {
  if (e.target.closest('[data-place-new]')) { addPlaceSheet({ onDone: onNew }); return null; }
  const b = e.target.closest('[data-place]');
  if (!b) return null;
  haptic();
  return b.dataset.place === current ? '' : b.dataset.place;
}

// Ein Raumfeld folgt dem gewählten Ort: Vorschläge nur aus diesem Ort; steht darin ein Raum,
// den es dort nicht gibt, wird es geleert – sonst entstünde beim Speichern still ein neuer.
export function followPlace(input, pid) {
  input.dataset.place = pid || '';
  const v = input.value.trim();
  if (v && pid && !roomsIn(pid).some(r => low(r.name) === low(v))) input.value = '';
  hideCombo();
}

/**
 * Ort und Raumnamen in IDs auflösen (neue Räume entstehen im Ort). Ohne Ort, aber mit Raum:
 * der Ort, in dem es den Raum schon gibt – sonst der Standard-Ort (db.ensureRoom, notfalls
 * wird „Zuhause“ angelegt). Liefert { placeId, roomId }.
 */
export async function resolveWhere(placeId, roomName) {
  const clean = String(roomName || '').trim();
  let pid = placeById(placeId)?.id || '';
  if (!clean) return { placeId: pid || null, roomId: null };
  if (!pid) pid = state.rooms.find(r => low(r.name) === low(clean))?.placeId || '';
  const roomId = await db.ensureRoom(pid, clean);
  if (!roomById(roomId)) await reloadAll();
  return { placeId: roomById(roomId)?.placeId || pid || null, roomId };
}

// „Ort ändern“: erst der Ort (Chips), darunter die Räume dieses Orts als Chips – ein Tipp
// übernimmt sofort, „Kein Raum“ legt den Eintrag direkt an den Ort. Ein neuer Raum geht über
// das Feld darunter. Bewusst ohne Autofokus: Die Vorschlagsliste des Felds öffnet im Blatt
// nach oben und läge sonst über den Orts-Chips (auf dem iPhone samt Tastatur).
export function whereSheet(it, ids) {
  const sel = {
    pid: placeOf(it)?.id || placeById(state.settings.lastPlace)?.id || state.places[0]?.id || '',
    room: hasRoom(it) ? roomName(it.roomId) : '',
  };
  const drawRooms = () => {
    const rooms = sel.pid ? roomsIn(sel.pid) : [];
    const chip = (name, label, ic) => {
      const on = low(name) === low(sel.room);
      return `<button type="button" class="pchip room${name ? '' : ' none'}" data-room-pick="${esc(name)}" aria-pressed="${on}">${icon(ic)}<span>${esc(label)}</span></button>`;
    };
    $('#sheet-rooms').innerHTML = !sel.pid ? ''
      : `<p class="pstyle-lbl">Raum in ${esc(placeName(sel.pid))}</p><div class="pchips" role="group" aria-label="Raum">`
        + chip('', 'Kein Raum', 'pin') + rooms.map(r => chip(r.name, r.name, 'door')).join('') + '</div>';
    for (const b of $$('#sheet-rooms .pchip')) b.classList.toggle('on', b.getAttribute('aria-pressed') === 'true');
  };
  sheet.panel({
    head: ids ? `<span class="sh-txt"><b>${esc(plural(ids.length, 'Ding', 'Dinge'))}</b><small>ausgewählt</small></span>` : itemHead(it),
    title: ids || hasPlace(it) ? 'Ort ändern' : 'Ort zuweisen', submit: 'Übernehmen',
    html: `<div id="sheet-places" class="sheet-places"></div>
      <div id="sheet-rooms" class="sheet-rooms"></div>
      <label class="field"><span>Neuer Raum <small>(optional)</small></span>
        <input id="sheet-input" type="text" placeholder="z. B. Kofferraum" autocomplete="off" data-combo="rooms" data-place="${esc(sel.pid)}" enterkeyhint="done">
      </label>`,
    comboSubmit: true,
    onClick: (e) => {
      const rb = e.target.closest('[data-room-pick]');
      if (rb) {
        haptic();
        sel.room = rb.dataset.roomPick;
        const form = $('#sheet .sheet-form');
        $('#sheet-input').value = '';
        if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true }));
        return;
      }
      const next = pickPlace(e, sel.pid);
      if (next == null) return;
      sel.pid = next;
      if (!roomsIn(next).some(r => low(r.name) === low(sel.room))) sel.room = '';
      drawPlaceChips($('#sheet-places'), sel.pid, { add: false, label: 'Ort' });
      followPlace($('#sheet-input'), sel.pid);
      drawRooms();
    },
    onSubmit: (v) => (ids ? moveSelected(ids, sel.pid, v || sel.room) : setItemWhere(it.id, sel.pid, v || sel.room)),
  });
  drawPlaceChips($('#sheet-places'), sel.pid, { add: false, label: 'Ort' });
  drawRooms();
}

async function setItemWhere(id, pid, name) {
  if (!pid && !String(name || '').trim()) { toast('Bitte einen Ort wählen.', true); return false; }
  try {
    const where = await resolveWhere(pid, name);
    await db.setItemWhere(id, where.placeId, where.roomId);
    await reloadAll();
    hideCombo();
    renderCurrent();
    haptic();
    const it = state.items.find(x => x.id === id);
    toast(`${it?.name ? `„${it.name}“` : 'Ding'} → ${whereText(where.placeId, where.roomId)}`);
  } catch (e) {
    toast('Zuweisen fehlgeschlagen: ' + e.message, true);
  }
  return true;
}
