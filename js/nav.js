// Navigation: Ansichten-Stapel, Tabs und Push-Ansichten, Zurückwischen, Neuzeichnen.
// Tabs behalten ihre Scroll-Position; Push-Ansichten gleiten von rechts herein.
import * as home from './home.js';
import * as motion from './motion.js';
import * as sheet from './sheet.js';
import * as glass from './glass.js';
import * as sound from './sound.js';
import { hideCombo } from './combo.js';
import { $, $$ } from './ui.js';
import { cabinet, cabM } from './lazy.js';
import { endSelect } from './select.js';
import { refreshItems, state } from './state.js';
import { renderCapture, resetCapture } from './view-add.js';
import { closeLightbox, leaveItem, syncItemAi } from './view-item.js';
import { renderArchive, renderList } from './view-list.js';
import { renderNoPlace, resetRoomSel } from './view-noplace.js';
import { renderOrte } from './view-orte.js';
import { renderManagers, updateStorageInfo } from './view-settings.js';

// Tabs (2.0): Start · Alles · [Kamera] · Orte · Dokumente. „orte“ verwaltet Orte und Räume,
// „noplace“ sammelt Dinge ohne Ort, „room“ zeigt einen Raum oder, ohne Raum, einen Ort selbst,
// „archive“ ist der Papierkorb (Feld `archived`), „docadd“ legt ein Dokument an oder bearbeitet
// es. Die Einstellungen sind seit 2.0 eine Push-Ansicht (⚙ auf Start).
const TABS = ['home', 'list', 'orte', 'docs'];
const PUSH = ['item', 'noplace', 'room', 'archive', 'docadd', 'settings'];

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
  else if (view === 'orte') renderOrte();
  else if (view === 'list') renderList();
  else if (view === 'add') renderCapture();
  else if (view === 'noplace') renderNoPlace();
  else if (view === 'archive') renderArchive();
  else if (view === 'docs') renderDocs();
  else if (view === 'docadd') cabM?.renderAdd();
  else if (view === 'room' && !home.renderRoom(state.roomId, state.placeId) && state.view === 'room') navigate('back');
}

// Der Aktenschrank wird erst beim ersten Öffnen geladen (js/lazy.js) – bis dahin bleibt der
// Tab leer, danach zeichnet er sich, sofern man noch dort ist.
function renderDocs() {
  if (cabM?.ready()) { cabM.render(); return; }
  cabinet().then((c) => c.ready() || c.reload()).then(() => { if (state.view === 'docs') cabM.render(); })
    .catch((e) => console.warn('Dokumente laden:', e));
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
  if (view === 'noplace' && !back && from !== 'noplace') resetRoomSel();
  // Dokumente-Tab erneut angetippt: aus einem Ordner zurück nach oben.
  if (view === 'docs' && from === 'docs' && cabM?.canUp()) cabM.toTop();

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

// Zurückwischen vom linken Rand – nur in Push-Ansichten (und in Ordnern der Dokumente) und
// wenn nichts darüber liegt.
let swipeFrom = null;
export function beginSwipeBack() {
  if (motion.busy() || !$('#lightbox').hidden || sheet.isOpen() || !$('#onboarding').hidden) return null;
  if (state.view === 'docs' && cabM?.canUp()) return folderSwipe();
  if (!PUSH.includes(state.view)) return null;
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

// In einem Ordner der Dokumente: der Inhalt folgt dem Finger, losgelassen geht es eine Ebene hoch.
function folderSwipe() {
  const el = $('#view-docs .scroll');
  const w = el.getBoundingClientRect().width || window.innerWidth;
  hideCombo();
  return {
    width: w,
    move(px) { const x = Math.max(0, Math.min(w, px)); el.style.transform = `translateX(${x * 0.6}px)`; el.style.opacity = String(1 - x / w * 0.6); },
    end(commit, onDone = () => {}) {
      el.style.transform = '';
      el.style.opacity = '';
      if (commit) { cabM?.up(); sound.play('tick'); }
      onDone();
      return Promise.resolve();
    },
  };
}

// Aufgeklappte Wisch-Zeilen schließen (vor dem Neuzeichnen einer Liste und beim Navigieren).
export const swipers = [];
export function closeSwipes() { for (const w of swipers) w.close(); }
