// Raum- und Ort-Ansicht mit ihren Menüs: fotografieren, umbenennen, Symbol & Farbe, Räume
// verschieben/zusammenführen, Orte und Räume anlegen und löschen; Umbenennen/Löschen von Namen
// (Räume, Kategorien) mit Zusammenführen.
import * as db from './db.js';
import * as home from './home.js';
import * as sheet from './sheet.js';
import { norm } from './combo.js';
import { haptic } from './gestures.js';
import { colorFor, placeBadge, placeChipsHTML, safeColor, safeIcon, styleHTML, suggestIcon } from './places.js';
import { $, $$, esc, icon, initialOf, plural, toneOf } from './ui.js';
import { navigate, renderCurrent, renderView } from './nav.js';
import { checkItems, checklistSheet } from './select.js';
import { low, multiPlaces, placeById, placeName, placeOf, reloadAll, roomById, roomsIn, state } from './state.js';
import { toast } from './toast.js';
import { renderManagers } from './view-settings.js';

export function openRoom(id) {
  if (!roomById(id)) return;
  state.roomId = id;
  state.placeId = null;
  if (state.view === 'room') { renderView('room'); return; }
  navigate('room', { fresh: true });
}

// Ein Ort selbst: was dort direkt liegt, ohne Raum (dieselbe Ansicht wie ein Raum).
export function openPlace(pid) {
  if (!placeById(pid)) return;
  state.roomId = null;
  state.placeId = pid;
  if (state.view === 'room') { renderView('room'); return; }
  navigate('room', { fresh: true });
}

// „Hier fotografieren“: Ort und Raum als gemerkte Stelle vorbelegen und Hinzufügen öffnen.
function shootHere(roomId, placeId) {
  const r = roomById(roomId);
  const p = r ? placeById(r.placeId) : placeById(placeId);
  if (!r && !p) return;
  state.settings.lastPlace = p?.id || '';
  state.settings.lastRoom = r?.name || '';
  state.settings.lastLoc = '';
  Promise.all([db.setSetting('lastPlace', state.settings.lastPlace), db.setSetting('lastRoom', state.settings.lastRoom), db.setSetting('lastLoc', '')])
    .catch((e) => console.warn('Ort merken fehlgeschlagen:', e));
  navigate('add');
}

const roomHead = (r) => {
  const n = home.roomItems(r.id).length;
  const sub = [multiPlaces() ? placeName(r.placeId) : '', n ? plural(n, 'Ding', 'Dinge') : 'noch leer'].filter(Boolean).join(' · ');
  return `<span class="sh-pic ph ph-${toneOf(r.name)}">${esc(initialOf(r.name))}</span>`
    + `<span class="sh-txt"><b>${esc(r.name)}</b><small>${esc(sub)}</small></span>`;
};

export function roomMenu(id) {
  const r = roomById(id);
  if (!r) return;
  const lost = !placeById(r.placeId);
  sheet.open({
    head: roomHead(r),
    // „Hier fotografieren“ steht groß in der Raum-Ansicht (2.0: nicht noch einmal hier).
    actions: [
      { id: 'rename', label: 'Umbenennen', icon: 'pencil' },
      // Verschieben nur, wenn es einen anderen Ort gibt (angelegt wird ein Ort im Tab „Orte“).
      ...(lost || state.places.length > 1 ? [{ id: 'move', label: lost ? 'Einem Ort zuordnen' : 'In anderen Ort verschieben', icon: 'pin' }] : []),
      { id: 'drop', label: 'Raum löschen', icon: 'trash', danger: true },
    ],
    onAction: (a) => {
      if (a === 'move') moveRoomSheet(id);
      else if (a === 'rename') {
        sheet.form({
          head: roomHead(r), title: 'Raum umbenennen', label: 'Name', value: r.name, submit: 'Umbenennen',
          onSubmit: async (v) => {
            if (!v) { toast('Bitte einen Namen eintragen.', true); return false; }
            await renameNamed('rooms', id, v);
            return true;
          },
        });
      } else if (a === 'drop') {
        sheet.close();
        dropNamed('rooms', id);
      }
    },
  });
}

// Wohin mit Räumen? Chips der Ziel-Orte. (Neue Orte entstehen seit 2.0 nur noch im Tab „Orte“,
// beim Hinzufügen und in der Einführung.)
function roomTargetSheet({ head, title, others, target, note, submit, onSubmit }) {
  const draw = () => placeChipsHTML(others, target, { add: false, label: 'Wohin?' });
  sheet.panel({
    head, title, submit,
    html: `<div id="sheet-places">${draw()}</div><p class="sheet-note small" id="sheet-move-note">${esc(note(target))}</p>`,
    onClick: (e) => {
      const b = e.target.closest('[data-place]');
      if (!b) return;
      target = b.dataset.place;
      $('#sheet-places').innerHTML = draw();
      $('#sheet-move-note').textContent = note(target);
      haptic();
    },
    onSubmit: () => {
      if (!placeById(target)) { toast('Bitte einen Ort wählen.', true); return false; }
      return onSubmit(target);
    },
  });
}

// Gleichnamige Räume im Ziel – die, die beim Verschieben zusammengeführt würden.
function twinsIn(ids, target) {
  const moving = ids.map(roomById).filter(r => r && r.placeId !== target);
  const seen = new Set(roomsIn(target).filter(x => !ids.includes(x.id)).map(x => low(x.name)));
  const twins = [];
  for (const r of moving) { if (seen.has(low(r.name))) twins.push(r); else seen.add(low(r.name)); }
  return twins;
}

/**
 * Raum (samt allem, was darin liegt) in einen anderen Ort verschieben. Gibt es dort schon einen
 * gleichnamigen Raum, erst nach Rückfrage zusammenführen. Ein Raum ohne gültigen Ort wird so
 * einem Ort zugeordnet.
 */
function moveRoomSheet(id, preselect = '') {
  const r = roomById(id);
  if (!r) return;
  const others = state.places.filter(p => p.id !== r.placeId);
  const lost = !placeById(r.placeId);
  const n = home.roomItems(r.id).length;
  roomTargetSheet({
    head: roomHead(r),
    title: lost ? 'Einem Ort zuordnen' : 'In anderen Ort verschieben',
    submit: 'Verschieben',
    others,
    target: others.some(p => p.id === preselect) ? preselect : (others.length === 1 ? others[0].id : ''),
    note: (t) => {
      const p = placeById(t);
      if (!p) return others.length ? 'Wähle den Ort, in den der Raum umzieht.' : 'Es gibt noch keinen anderen Ort – leg im Tab „Orte“ mit „+“ einen an.';
      const twin = twinsIn([id], t).length ? roomsIn(t).find(x => low(x.name) === low(r.name)) : null;
      if (twin) return `In „${p.name}“ gibt es schon „${twin.name}“ – beide werden zusammengeführt.`;
      return n ? `${plural(n, 'Ding zieht', 'Dinge ziehen')} mit nach „${p.name}“.` : `Der Raum ist leer und zieht nach „${p.name}“.`;
    },
    onSubmit: (t) => moveRoomsTo([id], t),
  });
}

// Tab „Orte“, Gruppe „Räume ohne Ort“: alle Räume ohne gültigen Ort auf einmal einem Ort zuordnen.
export function assignLostRoomsSheet(preselect = '') {
  const lost = state.rooms.filter(r => !placeById(r.placeId));
  if (!lost.length) return;
  const others = state.places;
  roomTargetSheet({
    head: '',
    title: `${plural(lost.length, 'Raum', 'Räume')} einem Ort zuordnen`,
    submit: 'Zuordnen',
    others,
    target: others.some(p => p.id === preselect) ? preselect : (others.length === 1 ? others[0].id : ''),
    note: (t) => {
      const p = placeById(t);
      if (!p) return 'Wähle den Ort, zu dem diese Räume gehören.';
      const tw = twinsIn(lost.map(r => r.id), t).length;
      return `Die Räume ziehen samt Inhalt nach „${p.name}“.` + (tw ? ` ${plural(tw, 'gleichnamiger Raum wird', 'gleichnamige Räume werden')} dort zusammengeführt.` : '');
    },
    onSubmit: (t) => moveRoomsTo(lost.map(r => r.id), t),
  });
}

// Verschieben ausführen (eine Transaktion, db.moveRooms). Liefert false, wenn das Blatt offen
// bleiben soll (Zusammenführen abgelehnt, Fehler).
async function moveRoomsTo(ids, target) {
  const to = placeById(target);
  if (!to) return false;
  const twins = twinsIn(ids, target);
  if (twins.length) {
    const msg = ids.length === 1
      ? `„${twins[0].name}“ gibt es in „${to.name}“ schon. Zusammenführen? Alles liegt danach in einem Raum.`
      : `${twins.map(r => `„${r.name}“`).join(', ')} gibt es in „${to.name}“ schon. Zusammenführen?`;
    if (!confirm(msg)) return false;
  }
  const moved = ids.map(roomById).filter(Boolean);
  try {
    const res = await db.moveRooms(ids, target, { merge: true });
    // Der gemerkte Raum der Schnellerfassung zieht mit um.
    const s = state.settings;
    const hit = moved.find(r => s.lastRoom && low(r.name) === low(s.lastRoom) && (!s.lastPlace || s.lastPlace === r.placeId || !placeById(r.placeId)));
    if (hit && s.lastPlace !== target) { s.lastPlace = target; await db.setSetting('lastPlace', target); }
    if (state.roomId && res.map[state.roomId]) state.roomId = res.map[state.roomId];
    await reloadAll();
    renderManagers();
    renderCurrent();
    haptic();
    const what = ids.length === 1 ? `„${moved[0]?.name || 'Raum'}“` : plural(ids.length, 'Raum', 'Räume');
    toast(`${what} → ${to.name}${res.merged ? ' (zusammengeführt)' : ''}`);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

// Neuer Raum – im angegebenen Ort; ohne Ort im Standard-Ort (notfalls entsteht „Zuhause“).
export function addRoomSheet(placeId) {
  const p = placeById(placeId);
  sheet.form({
    head: p ? placeHead(p) : '',
    title: p && multiPlaces() ? `Neuer Raum in ${p.name}` : 'Neuer Raum', label: 'Name',
    placeholder: p?.icon === 'auto' || p?.icon === 'bus' ? 'z. B. Kofferraum' : 'z. B. Werkstatt', submit: 'Anlegen',
    onSubmit: async (v) => {
      if (!v) { toast('Bitte einen Namen eintragen.', true); return false; }
      try {
        await db.ensureRoom(p?.id, v);
        await reloadAll();
        renderCurrent();
        haptic();
        toast(`„${v}“ angelegt.`);
      } catch (e) {
        toast(e.message, true);
      }
      return true;
    },
  });
}

export const placeHead = (p) => {
  const rooms = roomsIn(p.id).length;
  const n = state.items.filter(it => !it.archived && placeOf(it)?.id === p.id).length;
  return placeBadge(p, 'sh-pic')
    + `<span class="sh-txt"><b>${esc(p.name)}</b><small>${esc(`${plural(rooms, 'Raum', 'Räume')} · ${plural(n, 'Ding', 'Dinge')}`)}</small></span>`;
};

export function placeMenu(pid) {
  const p = placeById(pid);
  if (!p) return;
  sheet.open({
    head: placeHead(p),
    actions: [
      { id: 'shoot', label: 'Hier fotografieren', icon: 'camera' },
      { id: 'check', label: `Checkliste${checkItems(pid).length ? ` (${checkItems(pid).length})` : ''}`, icon: 'done' },
      { id: 'room', label: 'Raum hinzufügen', icon: 'plus' },
      { id: 'rename', label: 'Umbenennen', icon: 'pencil' },
      { id: 'style', label: 'Symbol & Farbe', icon: 'pl-' + safeIcon(p.icon) },
      { id: 'drop', label: 'Ort löschen', icon: 'trash', danger: true },
    ],
    onAction: (a) => {
      if (a === 'shoot') shootHere(null, pid);
      else if (a === 'check') checklistSheet(pid);
      else if (a === 'room') addRoomSheet(pid);
      else if (a === 'rename') {
        sheet.form({
          head: placeHead(p), title: 'Ort umbenennen', label: 'Name', value: p.name, submit: 'Umbenennen',
          onSubmit: async (v) => {
            if (!v) { toast('Bitte einen Namen eintragen.', true); return false; }
            await renamePlace(pid, v);
            return true;
          },
        });
      } else if (a === 'style') placeStyleSheet(pid);
      else if (a === 'drop') placeDropSheet(pid);
    },
  });
}

// Symbol und Farbe wählen – im Blatt eines Orts oder beim Anlegen.
function styleClick(e, sel) {
  const ic = e.target.closest('[data-icon]');
  const col = e.target.closest('[data-color]');
  if (!ic && !col) return false;
  if (ic) sel.icon = ic.dataset.icon;
  if (col) sel.color = col.dataset.color;
  markStyle(sel);
  return ic ? 'icon' : 'color';
}
function markStyle(sel) {
  for (const b of $$('#sheet-body [data-icon]')) { const on = b.dataset.icon === sel.icon; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  for (const b of $$('#sheet-body [data-color]')) { const on = b.dataset.color === sel.color; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  // Vorschau: das Symbol in den Farben des Orts.
  for (const b of $$('#sheet-body [data-icon]')) b.className = b.className.replace(/\bpc-\S+/g, '').trim() + ` pc-${sel.color}`;
}

function placeStyleSheet(pid) {
  const p = placeById(pid);
  if (!p) return;
  const sel = { icon: safeIcon(p.icon), color: safeColor(p.color) };
  sheet.panel({
    head: placeHead(p), title: 'Symbol & Farbe', html: styleHTML(sel.icon, sel.color), submit: 'Übernehmen',
    onClick: (e) => { if (styleClick(e, sel)) haptic(); },
    onSubmit: async () => {
      try {
        const cur = await db.get('places', pid);
        if (cur) await db.put('places', { ...cur, icon: sel.icon, color: sel.color });
        await reloadAll();
        renderManagers();
        renderCurrent();
      } catch (e) { toast(e.message, true); }
      return true;
    },
  });
  markStyle(sel);
}

/** Neuer Ort: Name, dazu Symbol und Farbe – vorgeschlagen aus dem Namen, bis man selbst wählt. */
export function addPlaceSheet({ onDone } = {}) {
  const sel = { icon: 'haus', color: colorFor('haus') };
  const manual = { icon: false, color: false };
  sheet.panel({
    title: 'Neuer Ort',
    html: `<label class="field"><span>Name</span><input id="sheet-input" type="text" placeholder="z. B. Auto, Betrieb, Haus 2" autocomplete="off" enterkeyhint="done"></label>`
      + styleHTML(sel.icon, sel.color),
    submit: 'Anlegen', focus: '#sheet-input',
    onClick: (e) => { const k = styleClick(e, sel); if (k) { manual[k] = true; haptic(); } },
    onSubmit: async (v) => {
      if (!v) { toast('Bitte einen Namen eintragen.', true); return false; }
      try {
        const twin = state.places.find(p => low(p.name) === low(v));
        const id = twin ? twin.id : await db.ensurePlace(v, { icon: sel.icon, color: sel.color });
        await reloadAll();
        renderManagers();
        renderCurrent();
        haptic();
        toast(twin ? `„${twin.name}“ gibt es schon.` : `„${v}“ angelegt.`);
        onDone?.(id);
      } catch (e) {
        toast(e.message, true);
      }
      return true;
    },
  });
  markStyle(sel);
  $('#sheet-input').addEventListener('input', (e) => {
    if (!manual.icon) sel.icon = suggestIcon(e.target.value);
    if (!manual.color) sel.color = colorFor(sel.icon);
    markStyle(sel);
  });
}

// Gemerkte Orte (Schnellerfassung, Umschalter, Ansichten) nach Umbenennen-Zusammenführen
// oder Löschen umbiegen. to: neuer Ort oder '' (weg).
async function followPlaceGone(from, to) {
  const s = state.settings;
  if (s.lastPlace === from) {
    s.lastPlace = to;
    await db.setSetting('lastPlace', to);
    if (!to && s.lastRoom) { s.lastRoom = ''; await db.setSetting('lastRoom', ''); $('#cap-room').value = ''; }
  }
  if (s.homePlace === from) { s.homePlace = to; await db.setSetting('homePlace', to); }
  if (state.rsPlace === from) state.rsPlace = to;
  if (state.itPlace === from) state.itPlace = to;
  if (state.placeId === from) state.placeId = to || null;
}

// Liefert die ID, unter der der Ort danach steht (bei Zusammenführen die des Zwillings).
async function renamePlace(pid, name) {
  const clean = String(name || '').trim();
  const p = placeById(pid);
  if (!clean || !p) { renderManagers(); return pid; }
  if (p.name === clean) return pid;
  try {
    const twin = state.places.find(x => x.id !== pid && low(x.name) === low(clean));
    if (twin) {
      const n = state.items.filter(it => placeOf(it)?.id === pid).length;
      const msg = `„${clean}“ gibt es bereits. Zusammenführen?`
        + ` ${plural(roomsIn(pid).length, 'Raum', 'Räume')} und ${plural(n, 'Ding', 'Dinge')} ziehen dorthin um.`;
      if (!confirm(msg)) { renderManagers(); return pid; }
      await db.dropPlace(pid, twin.id);
      await followPlaceGone(pid, twin.id);
      await reloadAll();
      renderManagers();
      renderCurrent();
      toast('Zusammengeführt.');
      return twin.id;
    }
    const cur = await db.get('places', pid);
    if (cur) await db.put('places', { ...cur, name: clean });
    await reloadAll();
    renderManagers();
    renderCurrent();
    toast('Umbenannt.');
  } catch (e) {
    renderManagers();
    toast(e.message, true);
  }
  return pid;
}

/**
 * Ort löschen – mit Rückfrage im Blatt: Liegen dort Räume oder Dinge, wählt man, wohin sie
 * kommen (anderer Ort; gleichnamige Räume werden dort zusammengeführt) oder „Ohne Ort“
 * (Räume werden aufgelöst, die Dinge bleiben erhalten und stehen unter „Ohne Ort“).
 */
function placeDropSheet(pid) {
  const p = placeById(pid);
  if (!p) return;
  const rooms = roomsIn(pid).length;
  const n = state.items.filter(it => placeOf(it)?.id === pid).length;
  const others = state.places.filter(x => x.id !== pid);
  let target = others[0]?.id || '';
  const draw = () => placeChipsHTML(others, target, { add: false, label: 'Wohin damit?' })
    .replace('</div>', `<button type="button" class="pchip none${target ? '' : ' on'}" data-place="" aria-pressed="${!target}">${icon('pin')}<span>Ohne Ort</span></button></div>`);
  const note = () => (target
    ? `Räume und Dinge ziehen nach „${esc(placeName(target))}“ um. Gleichnamige Räume werden dort zusammengeführt.`
    : 'Die Räume werden aufgelöst. Die Dinge bleiben erhalten und stehen danach unter „Ohne Ort“.');
  const empty = !rooms && !n;
  sheet.panel({
    head: placeHead(p), title: `„${p.name}“ löschen?`, danger: true, submit: 'Ort löschen',
    html: empty
      ? '<p class="sheet-note">Hier liegt nichts – der Ort verschwindet einfach.</p>'
      : `<p class="sheet-note">${esc(`${plural(rooms, 'Raum', 'Räume')} und ${plural(n, 'Ding', 'Dinge')} gehören dazu. Wohin damit?`)}</p>`
        + `<div id="sheet-places">${draw()}</div><p class="sheet-note small" id="sheet-drop-note">${note()}</p>`,
    onClick: (e) => {
      const b = e.target.closest('[data-place]');
      if (!b) return;
      target = b.dataset.place;
      $('#sheet-places').innerHTML = draw();
      $('#sheet-drop-note').innerHTML = note();
      haptic();
    },
    onSubmit: async () => {
      try {
        const to = empty ? '' : target;
        const res = await db.dropPlace(pid, to || null);
        await followPlaceGone(pid, to);
        await reloadAll();
        renderManagers();
        const gone = state.view === 'room' && (state.placeId === pid || (state.roomId && !roomById(state.roomId)));
        if (gone && to && state.placeId === to) renderCurrent();
        else if (gone) navigate('back');
        else renderCurrent();
        toast(to ? `Gelöscht – ${plural(res.items, 'Ding', 'Dinge')} jetzt in „${placeName(to)}“.` : 'Ort gelöscht.');
      } catch (e) {
        toast(e.message, true);
      }
      return true;
    },
  });
}

const fieldOf = (kind) => (kind === 'categories' ? 'categoryId' : kind === 'places' ? 'placeId' : 'roomId');
export const labelOf = (kind) => (kind === 'categories' ? 'Kategorie' : kind === 'places' ? 'Ort' : 'Raum');

// Der gemerkte Raum der Schnellerfassung ist ein Name im gemerkten Ort – bei Umbenennen/
// Löschen eines Raums in diesem Ort mitziehen.
async function followLastRoom(oldName, newName, placeId) {
  if (!oldName || norm(state.settings.lastRoom) !== norm(oldName)) return;
  if (placeId && state.settings.lastPlace && state.settings.lastPlace !== placeId) return;
  state.settings.lastRoom = newName;
  await db.setSetting('lastRoom', newName);
  if (norm($('#cap-room').value) === norm(oldName)) $('#cap-room').value = newName;
}

// Liefert die ID, unter der der Name danach steht (bei Zusammenführen die des Zwillings).
// Räume: nur innerhalb ihres Orts eindeutig – „Keller“ darf es in Zuhause und in Haus 2 geben.
export async function renameNamed(kind, id, name) {
  if (kind === 'places') return renamePlace(id, name);
  const clean = name.trim();
  if (!clean) { renderManagers(); return id; }
  try {
    const rec = await db.get(kind, id);
    if (!rec || rec.name === clean) return id;

    // Gibt es den Namen schon? Dann zusammenführen statt ein Duplikat anzulegen.
    const list = kind === 'categories' ? state.cats : state.rooms.filter(r => r.placeId === rec.placeId);
    const twin = list.find(x => x.id !== id && x.name.toLowerCase() === clean.toLowerCase());
    if (twin) {
      const field = fieldOf(kind);
      const affected = state.items.filter(i => i[field] === id);
      const msg = `„${clean}“ gibt es bereits. Zusammenführen?` +
        (affected.length ? ` ${plural(affected.length, 'Eintrag wird', 'Einträge werden')} umgehängt.` : '');
      if (!confirm(msg)) { renderManagers(); return id; }
      await db.moveAndDropNamed(kind, id, twin.id);
      if (kind === 'rooms') await followLastRoom(rec.name, twin.name, rec.placeId);
      if (kind === 'rooms' && state.roomId === id) state.roomId = twin.id;
      await reloadAll();
      renderManagers();
      renderCurrent();
      toast('Zusammengeführt.');
      return twin.id;
    }

    const oldName = rec.name;
    rec.name = clean;
    await db.put(kind, rec);
    if (kind === 'rooms') await followLastRoom(oldName, clean, rec.placeId);
    await reloadAll();
    renderManagers();
    renderCurrent();
    toast('Umbenannt.');
  } catch (e) {
    renderManagers();
    toast(e.message, true);
  }
  return id;
}

export async function dropNamed(kind, id) {
  if (kind === 'places') { placeDropSheet(id); return false; }
  const field = fieldOf(kind);
  const affected = state.items.filter(i => i[field] === id);
  const label = labelOf(kind);
  const room = kind === 'rooms' ? roomById(id) : null;
  const msg = !affected.length ? `${label} löschen?`
    : room && placeById(room.placeId)
      ? `${label} löschen? ${plural(affected.length, 'Eintrag bleibt', 'Einträge bleiben')} erhalten und ${affected.length === 1 ? 'liegt' : 'liegen'} dann direkt in „${placeName(room.placeId)}“.`
      : `${label} löschen? Bei ${plural(affected.length, 'Eintrag', 'Einträgen')} wird das Feld geleert. Die Einträge selbst bleiben erhalten.`;
  if (!confirm(msg)) return false;
  try {
    await db.moveAndDropNamed(kind, id, null);
    if (room) await followLastRoom(room.name, '', room.placeId);
    await reloadAll();
    renderManagers();
    if (state.view === 'room' && state.roomId === id) navigate('back');
    else renderCurrent();
    toast(`${label} gelöscht.`);
    return true;
  } catch (e) {
    toast(e.message, true);
  }
  return false;
}

export function init() {
  $('#room-shoot').addEventListener('click', () => shootHere(state.roomId, state.placeId));
  $('#room-menu').addEventListener('click', () => (state.roomId ? roomMenu(state.roomId) : placeMenu(state.placeId)));
  const roomScroll = $('#view-room .scroll');
  roomScroll.addEventListener('scroll', () => {
    $('#view-room').classList.toggle('scrolled', roomScroll.scrollTop > 40);
  }, { passive: true });
}
