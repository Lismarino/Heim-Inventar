// Navigation: Ansichten-Stapel, Tabs und Push-Ansichten, Zurückwischen, Neuzeichnen.
// Tabs behalten ihre Scroll-Position; Push-Ansichten gleiten von rechts herein.
import * as home from './home.js';
import * as motion from './motion.js';
import * as sheet from './sheet.js';
import * as glass from './glass.js';
import * as sound from './sound.js';
import { hideCombo } from './combo.js';
import { $, $$ } from './ui.js';
import { cabM } from './lazy.js';
import { endSelect } from './select.js';
import { refreshItems, state } from './state.js';
import { renderCapture, resetCapture } from './view-add.js';
import { closeLightbox, leaveItem, syncItemAi } from './view-item.js';
import { renderArchive, renderList } from './view-list.js';
import { renderRooms, resetRoomSel } from './view-noplace.js';
import { renderManagers, updateStorageInfo } from './view-settings.js';

// „places“ ist der Tab „Räume“ – „rooms“ ist (historisch) die Ansicht „Ohne Ort“
// (bis 1.6 „Ohne Raum“), „room“ zeigt einen Raum oder, ohne Raum, einen Ort selbst.
const TABS = ['home', 'list', 'places', 'settings'];
// 1.9.0: „docs“ (Dokumente, von Zuhause) und „docadd“ (Dokument hinzufügen/bearbeiten).
const PUSH = ['item', 'rooms', 'room', 'archive', 'docs', 'docadd'];

// Die Warteschlange hat etwas geändert: Daten neu holen und nur die aktuelle Ansicht
// auffrischen – ohne offene Eingabefelder oder die Detail-Ansicht zu zerstören.
let changeTimer = null;
export function onDataChanged() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(async () => {
    try {
      await refreshItems();
      renderCurrent();
    } catch (e) {
      console.warn('Aktualisieren fehlgeschlagen:', e);
    }
  }, 120);
}

export function renderCurrent() {
  if (state.view === 'item') syncItemAi();
  else renderView(state.view);
}

export function renderView(view) {
  closeSwipes();   // eine offene Wisch-Zeile überlebt das Neuzeichnen nicht
  if (view === 'home') home.renderHome();
  else if (view === 'places') home.renderPlaces();
  else if (view === 'list') renderList();
  else if (view === 'add') renderCapture();
  else if (view === 'rooms') renderRooms();
  else if (view === 'archive') renderArchive();
  else if (view === 'docs') cabM?.render();
  else if (view === 'docadd') cabM?.renderAdd();
  else if (view === 'room' && !home.renderRoom(state.roomId, state.placeId) && state.view === 'room') navigate('back');
}

// Zu welchem Tab gehört die aktuelle Ansicht? (für die Markierung in der Leiste)
// Hinzufügen zählt als eigener Platz, solange es im Stapel liegt.
function tabOf() {
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const v = state.stack[i];
    if (TABS.includes(v) || v === 'add') return v;
  }
  return 'home';
}

// Vorige Ansicht im Stapel (für „Zurück“ und das Zurückwischen).
const prevView = () => (state.stack.length > 1 ? state.stack[state.stack.length - 2] : 'home');

/**
 * Wechselt die Ansicht und führt den Stapel:
 * - 'back' (Zurück, Zurückwischen, „Fertig“) nimmt die oberste Ansicht ab;
 * - ein Tab setzt den Stapel auf diesen Tab zurück;
 * - eine Ansicht, die schon im Stapel liegt, kürzt ihn bis dorthin (wie Zurück);
 * - fresh: dieselbe Ansicht mit neuem Inhalt (anderer Eintrag, anderer Raum) – die alte
 *   Stelle im Stapel zeigt es nicht mehr, sie fällt heraus, die Ansicht kommt oben neu drauf.
 *   So pendelt Eintrag → Hinzufügen → Eintrag aus dem Streifen nicht endlos hin und her.
 * - alles andere kommt oben drauf.
 */
export function navigate(view, { instant = false, fresh = false } = {}) {
  if (state.view === 'item') leaveItem();   // Änderungen im Eintrag nie still verwerfen
  const from = state.view;
  const stack = state.stack;
  let back = false;
  if (view === 'back') {
    back = true;
    if (stack.length > 1) stack.pop();
    else stack.splice(0, stack.length, 'home');
    view = stack[stack.length - 1];
  } else if (TABS.includes(view)) {
    back = stack[0] === view && stack.length > 1;   // aus einer Unteransicht zurück zum eigenen Tab
    stack.splice(0, stack.length, view);
  } else if (view !== from) {
    const at = stack.indexOf(view);
    if (at >= 0 && !fresh) {
      stack.length = at + 1;
      back = true;
    } else {
      if (at >= 0) stack.splice(at, 1);
      stack.push(view);
    }
  }

  if (state.sel) endSelect(false);   // Auswahl endet mit jedem Ansichtswechsel
  // Schnell hintereinander getippt: der laufende Übergang endet sofort – nur das neue Ziel
  // zählt. Hatte er kaum begonnen, bleibt die vorige Ansicht als Grundlage (base).
  const base = motion.settle({ revert: view !== from });
  closeLightbox();
  hideCombo();
  sheet.close();
  closeSwipes();
  if (state.detailURL && view !== 'item') { URL.revokeObjectURL(state.detailURL); state.detailURL = null; }
  // Neue Erfassungsrunde – außer man kommt nur aus einem Eintrag oder „Ohne Ort“ zurück.
  if (view === 'add' && !back && from !== 'add') resetCapture();
  if (view === 'rooms' && !back && from !== 'rooms') resetRoomSel();

  const leaving = $('#view-' + from + ' .scroll');
  if (leaving) state.scrollPos[from] = leaving.scrollTop;

  state.view = view;
  document.body.dataset.view = view;
  const fromEl = base || $('#view-' + from);
  const toEl = $('#view-' + view);
  toEl.hidden = false;
  for (const v of $$('.view')) if (v !== toEl && v !== fromEl) v.hidden = true;
  const tab = tabOf();
  $$('#nav button').forEach((b) => {
    const on = b.dataset.nav === tab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  glass.setTab(tab, { instant });
  if (view !== from) glass.resetBar();
  if (view !== from && TABS.includes(view) && !instant) sound.play('tick');

  renderView(view);
  if (view === 'settings') { renderManagers(); updateStorageInfo(); }

  // Scroll-Position: zurück und aus einem Eintrag dort weiter, wo man war; Tabs behalten
  // ihre Stelle; erneutes Antippen des Tabs springt nach oben; Neues beginnt oben.
  const sc = toEl.querySelector('.scroll');
  if (sc) {
    if (view === from) {
      if (TABS.includes(view) && !instant) sc.scrollTo({ top: 0, behavior: motion.reduced() ? 'auto' : 'smooth' });
    } else if (back || (from === 'item' && !fresh)) sc.scrollTop = state.scrollPos[view] || 0;
    else if (from === 'add' || !TABS.includes(view)) sc.scrollTop = 0;
  }

  const kind = instant || view === from || fromEl === toEl ? 'none'
    : view === 'add' ? 'sheet-up'
      : from === 'add' ? 'sheet-down'
        : back ? 'pop'
          : PUSH.includes(view) ? 'push'
            : 'fade-out'; // Tabwechsel: kurzes Überblenden
  if (kind === 'sheet-up') glass.dropFromFab();
  motion.run(kind, fromEl, toEl, (el) => el === $('#view-' + state.view));
}

// Zurückwischen vom linken Rand – nur in Push-Ansichten und wenn nichts darüber liegt.
let swipeFrom = null;
export function beginSwipeBack() {
  if (!PUSH.includes(state.view) || motion.busy() || !$('#lightbox').hidden || sheet.isOpen() || !$('#onboarding').hidden) return null;
  const prev = prevView();
  const prevEl = $('#view-' + prev);
  if (!prevEl || prev === state.view) return null;
  hideCombo();
  closeSwipes();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  renderView(prev);
  swipeFrom = state.view;
  return motion.dragPop($('#view-' + state.view), prevEl);
}

// Nach dem Loslassen: nur zurück, wenn inzwischen nicht schon woandershin navigiert wurde
// (z. B. Tab angetippt, während die Ansicht noch zurückgleitet).
export function commitSwipeBack() {
  const at = swipeFrom;
  swipeFrom = null;
  if (at && state.view === at) navigate('back', { instant: true });
}

// Aufgeklappte Wisch-Zeilen schließen (vor dem Neuzeichnen einer Liste und beim Navigieren).
export const swipers = [];
export function closeSwipes() { for (const w of swipers) w.close(); }
