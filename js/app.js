import * as db from './db.js';
import * as img from './img.js';
import * as ai from './gemini.js';
import { initCombos, hideCombo, norm } from './combo.js';
import * as backup from './backup.js';
import * as queue from './queue.js';
import { esc, dtf, plural, icon, isThumb, placeholderHTML, toneOf, initialOf, EMPTY_ART } from './ui.js';
import * as home from './home.js';
import * as motion from './motion.js';
import * as sheet from './sheet.js';
import * as onboarding from './onboarding.js';
import { haptic, longPress, swipeRows, edgeSwipe } from './gestures.js';
import * as glass from './glass.js';
import * as intro from './intro.js';
import { byOrder, placeBadge, placeIcon, placeChipsHTML, styleHTML, suggestIcon, colorFor, safeIcon, safeColor } from './places.js';

const APP_VERSION = '1.7.0';
// Für die Mischstand-Prüfung in index.html: gesetzt, sobald dieses Modul läuft.
window.__inventarVersion = APP_VERSION;
// Start-Szene gleich loslaufen lassen – der Start unten wartet nicht auf sie.
intro.start();

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// Tabs behalten ihre Scroll-Position; Push-Ansichten gleiten von rechts herein.
// „places“ ist der Tab „Räume“ – „rooms“ ist (historisch) die Ansicht „Ohne Ort“
// (bis 1.6 „Ohne Raum“), „room“ zeigt einen Raum oder, ohne Raum, einen Ort selbst.
const TABS = ['home', 'list', 'places', 'settings'];
const PUSH = ['item', 'rooms', 'room', 'archive'];

const state = {
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
  listFilter: null, // „Alles“: null | 'unnamed'
  capture: { ids: [], busy: '' },   // Schnellerfassung: in dieser Runde erfasste Einträge
  roomSel: new Set(),               // „Ohne Ort“: markierte Einträge
  scrollPos: {},                    // Ansicht -> Scroll-Position beim Verlassen
  currentId: null,
  shown: {},        // Detail: zuletzt angezeigte Feldwerte – gespeichert wird nur, was davon abweicht
  detailURL: null,
  lightboxURL: null,
  aiSearch: null,   // { question, answer, matches:[{item, why}] }
};

const catName = (id) => state.cats.find(c => c.id === id)?.name || '';
const roomById = (id) => (id && state.rooms.find(r => r.id === id)) || null;
const placeById = (id) => (id && state.places.find(p => p.id === id)) || null;
const roomName = (id) => roomById(id)?.name || '';
const placeName = (id) => placeById(id)?.name || '';
const roomsIn = (pid) => state.rooms.filter(r => r.placeId === pid);
const multiPlaces = () => state.places.length > 1;
const low = (s) => String(s || '').trim().toLowerCase();
const hasKey = () => !!(state.settings.apiKey || '').trim();
// Raum zählt nur, wenn es ihn auch gibt – eine Sicherung kann tote Verweise enthalten.
const hasRoom = (it) => !!roomById(it.roomId);
// Ort eines Eintrags: der seines Raums, sonst der, an dem er direkt liegt (db.js, oben).
const placeOf = (it) => { const r = roomById(it.roomId); return r ? placeById(r.placeId) : placeById(it.placeId); };
// Zugeordnet ist, was in einem Raum oder direkt an einem Ort liegt. Ein Raum zählt auch dann,
// wenn sein Ort (noch) fehlt – so springt nichts nach „Ohne Ort“, falls die Zuordnung hakt.
const hasPlace = (it) => hasRoom(it) || !!placeById(it.placeId);
// „Auto › Kofferraum“. Den Ort nur, wenn es mehrere gibt oder kein Raum da ist – mit einem
// einzigen Ort versteht er sich von selbst.
function whereText(placeId, roomId, sep = ' › ') {
  const r = roomById(roomId);
  const p = r ? placeById(r.placeId) : placeById(placeId);
  return [p && (multiPlaces() || !r) ? p.name : '', r ? r.name : ''].filter(Boolean).join(sep);
}
const whereOf = (it, sep) => whereText(it.placeId, it.roomId, sep);
const whereShort = (it) => roomName(it.roomId) || placeOf(it)?.name || '';
// Wartet ein Eintrag auf die Erkennung, geht das nur mit Key voran. Ohne Key nicht
// ewig „wird erkannt …“ drehen, sondern sagen, woran es hängt.
const aiBusy = (it) => it.aiState === 'pending' && hasKey();
const aiNeedsKey = (it) => it.aiState === 'pending' && !hasKey();
// „Ohne Ort“ (Name aus der Zeit, als es „Ohne Raum“ hieß): weder Raum noch Ort.
const noRoomItems = () => state.items
  .filter(i => !i.archived && !hasPlace(i))
  .sort((a, b) => b.createdAt - a.createdAt);

/* =========================== Boot =========================== */

async function boot() {
  // Passt index.html nicht zu diesem Skript (Mischstand nach einem Update), lieber die
  // neue Version übernehmen und neu laden, statt halb zu starten.
  const pageVersion = document.querySelector('meta[name="app-version"]')?.content || '';
  if (pageVersion !== APP_VERSION) {
    console.warn(`Versionen passen nicht zusammen: index.html ${pageVersion || 'alt'}, app.js ${APP_VERSION}.`);
    if (await rescueUpdate('Version')) return;
  }
  db.onDbEvent(onDbEvent);
  try {
    await db.openDB();
  } catch (e) {
    showBootError('Die lokale Datenbank konnte nicht geöffnet werden. Im privaten Modus von Safari steht IndexedDB nicht zur Verfügung.', e);
    return;
  }
  // 1.7.0: Räume ohne Ort nach „Zuhause“ (einmalig, idempotent, eine Transaktion). Scheitert es,
  // bleibt alles, wie es war, und die App startet trotzdem – der nächste Start versucht es erneut.
  try {
    const m = await db.migratePlaces();
    if (m.rooms || m.items || m.merged) console.info('Orte eingerichtet:', m);
  } catch (e) {
    console.warn('Zuordnung zu Orten fehlgeschlagen – nächster Start versucht es erneut:', e);
  }
  try {
    await reloadAll();
    wire();
    glass.init();
    initCombos(comboSource);
    sheet.init();
    home.init({
      state, roomName, catName, roomById, placeById, placeOf, hasRoom, aiBusy, aiNeedsKey, noRoomItems, whereShort,
      rowHTML: (it, opts) => rowHTML(it, '', opts),
      queueNote: () => queue.status().note,
    });
    onboarding.init({
      places: () => state.places.map(p => ({ name: p.name, icon: p.icon })),
      rooms: () => state.rooms.map(r => ({ name: r.name, place: placeName(r.placeId) })),
      apiKey: () => state.settings.apiKey,
      done: finishOnboarding,
    });
    queue.initQueue({ settings: () => state.settings, onChange: onDataChanged });
    fillSettingsForm();
    navigate('home', { instant: true });
    $('#ver-info').textContent = `Heim-Inventar ${APP_VERSION}`;
    // Erster Start ohne jede Spur einer Einrichtung: Begrüßung. Scheitert sie, startet die App trotzdem.
    await onboarding.maybeShow(state.settings, { items: state.items.length, rooms: state.rooms.length, places: state.places.length })
      .catch((e) => console.warn('Einführung:', e));
  } catch (e) {
    showBootError('Die gespeicherten Daten konnten nicht geladen werden. Lade die Seite neu; hilft das nicht, schließe andere Tabs mit der App.', e);
    return;
  }
  // Hat der Wächter in index.html schon Alarm geschlagen, weil der Start länger dauerte: zurücknehmen.
  $('#boot-error').hidden = true;
  $('#app').hidden = false;
  window.__inventarReady = true;
  hideSplash();
  // Die App kann mitten in der Erkennung geschlossen worden sein – liegen Gebliebenes abarbeiten.
  queue.kick();
  registerSW();
  requestPersist();
  updateStorageInfo();
}

// Zeigt die Startfehler-Seite aus index.html mit einer passenden Meldung.
function showBootError(msg, err) {
  window.__inventarFailed = true;   // der Wächter in index.html überschreibt dann nichts mehr
  rescueUpdate('Startfehler');      // liegt womöglich nur an einem halben Update
  const box = $('#boot-error');
  box.querySelector('p').textContent = msg;
  $('#boot-error-detail').textContent = err?.message || String(err || '');
  box.hidden = false;
  $('#app').hidden = true;
  $('#splash').hidden = true;
  intro.stop();
  console.error('Start fehlgeschlagen:', err);
}

// Datenbank-Ereignisse (db.js). blocked: Das Upgrade auf Version 2 wartet, weil ein anderer
// Tab mit einer älteren Fassung die Datenbank offen hält (etwa eingefroren im Hintergrund) –
// dann sagen, was los ist, statt still zu hängen; es geht von selbst weiter, sobald er zu ist.
// versionchange: Eine neuere Fassung in einem anderen Tab will upgraden – wir haben
// losgelassen und bieten Neuladen an.
function onDbEvent(type) {
  const box = $('#boot-error');
  if (type === 'blocked') {
    window.__inventarFailed = true;   // der Start-Wächter soll hier nicht „Datei fehlt“ melden
    box.querySelector('h2').textContent = 'Einen Moment …';
    box.querySelector('p').textContent = 'Die App ist noch in einem anderen Tab oder Fenster mit einer älteren Version geöffnet. '
      + 'Schließe es dort (oder lade es neu) – dann geht es hier von selbst weiter.';
    $('#boot-error-detail').textContent = 'Deine Einträge werden dabei auf Orte umgestellt (Version 1.7.0). Es geht nichts verloren.';
    box.hidden = false;
  } else if (type === 'unblocked') {
    window.__inventarFailed = false;
    box.hidden = true;
    box.querySelector('h2').textContent = 'Die App konnte nicht starten';
  } else if (type === 'versionchange') {
    const bar = $('#update-bar');
    bar.querySelector('span').textContent = 'Neue Version in einem anderen Tab';
    bar.hidden = false;
    $('#update-go').addEventListener('click', () => location.reload(), { once: true });
  }
}

// Die Start-Szene öffnet sich in die App, sobald sie steht (js/intro.js). Liegt darunter die
// Einführung, bekommt danach deren Überschrift den Fokus (vorher ist sie inert).
function hideSplash() {
  intro.done().then(() => onboarding.focusStart());
}

// skipped: übersprungen (oder Escape) – dann bleibt man, wo man war (beim ersten Start
// Zuhause, beim erneuten Zeigen die Einstellungen), und der Fokus kehrt zum Auslöser zurück.
async function finishOnboarding({ key, goAdd, skipped }) {
  state.settings.onboarded = true;
  if (key && key !== (state.settings.apiKey || '')) {
    const n = await applyKey(key);
    $('#set-key').value = key;
    if (n) toast(markedMsg(n).trim());
  }
  await reloadAll();
  if (skipped) { renderCurrent(); return; }
  navigate(goAdd ? 'add' : 'home', { instant: true });
  if (goAdd) resetCapture();
}

async function reloadAll() {
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
}

// Vorschläge: Kategorien; Räume nur aus dem Ort des Felds (data-place), ohne Ort alle.
function comboSource(kind, input) {
  if (kind === 'categories') return state.cats.map(c => c.name);
  const pid = input?.dataset.place || '';
  const rooms = pid && placeById(pid) ? roomsIn(pid) : state.rooms;
  return [...new Map(rooms.map(r => [low(r.name), r.name])).values()];
}

// Leichter als reloadAll(): nur Einträge und Kategorien – für die Hintergrund-Erkennung.
async function refreshItems() {
  const [items, cats] = await Promise.all([db.getAll('items'), db.getAll('categories')]);
  state.items = items;
  const before = state.cats.map(c => c.id + c.name).join('|');
  state.cats = cats.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (state.cats.map(c => c.id + c.name).join('|') !== before) refreshPickers();
}

// Die Warteschlange hat etwas geändert: Daten neu holen und nur die aktuelle Ansicht
// auffrischen – ohne offene Eingabefelder oder die Detail-Ansicht zu zerstören.
let changeTimer = null;
function onDataChanged() {
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

function renderCurrent() {
  if (state.view === 'item') syncItemAi();
  else renderView(state.view);
}

function renderView(view) {
  closeSwipes();   // eine offene Wisch-Zeile überlebt das Neuzeichnen nicht
  if (view === 'home') home.renderHome();
  else if (view === 'places') home.renderPlaces();
  else if (view === 'list') renderList();
  else if (view === 'add') renderCapture();
  else if (view === 'rooms') renderRooms();
  else if (view === 'archive') renderArchive();
  else if (view === 'room' && !home.renderRoom(state.roomId, state.placeId) && state.view === 'room') navigate('back');
}

function refreshPickers() {
  fillSelect($('#f-cat'), state.cats, 'Alle Kategorien');
  const fp = $('#f-place');
  fillSelect(fp, state.places, 'Alle Orte');
  // Mit nur einem Ort wäre der Filter nutzlos.
  fp.hidden = state.places.length < 2;
  if (fp.hidden) fp.value = '';
  $('#filters').classList.toggle('three', !fp.hidden);
  fillRoomFilter();
}

// Raum-Filter: nur Räume des gewählten Orts; ohne Ort-Filter bei mehreren Orten mit Ortsnamen.
function fillRoomFilter() {
  const pid = $('#f-place').value;
  const rows = (pid ? roomsIn(pid) : state.rooms)
    .map(r => ({ id: r.id, name: !pid && multiPlaces() ? `${r.name} (${placeName(r.placeId)})` : r.name }));
  fillSelect($('#f-room'), rows, 'Alle Räume');
}

function fillSelect(sel, rows, allLabel) {
  const keep = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` + rows.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  if (rows.some(r => r.id === keep)) sel.value = keep;
}

/* =========================== Navigation =========================== */

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
function navigate(view, { instant = false, fresh = false } = {}) {
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

  motion.settle();
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
  const fromEl = $('#view-' + from);
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

  const kind = instant || view === from ? 'none'
    : view === 'add' ? 'sheet-up'
      : from === 'add' ? 'sheet-down'
        : back ? 'pop'
          : PUSH.includes(view) ? 'push'
            : 'fade';
  if (kind === 'sheet-up') glass.dropFromFab();
  motion.run(kind, fromEl, toEl, (el) => el === $('#view-' + state.view));
}

// Zurückwischen vom linken Rand – nur in Push-Ansichten und wenn nichts darüber liegt.
let swipeFrom = null;
function beginSwipeBack() {
  if (!PUSH.includes(state.view) || motion.busy() || !$('#lightbox').hidden || sheet.isOpen() || onboarding.isOpen()) return null;
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
function commitSwipeBack() {
  const at = swipeFrom;
  swipeFrom = null;
  if (at && state.view === at) navigate('back', { instant: true });
}

// Aufgeklappte Wisch-Zeilen schließen (vor dem Neuzeichnen einer Liste und beim Navigieren).
const swipers = [];
function closeSwipes() { for (const w of swipers) w.close(); }

/* =========================== Liste =========================== */

function haystack(it) {
  return [it.name, catName(it.categoryId), placeOf(it)?.name, roomName(it.roomId), it.locationDetail, it.quantity, it.note]
    .filter(Boolean).join(' ');
}

function visibleItems() {
  const q = norm($('#q').value);
  const cat = $('#f-cat').value;
  const place = $('#f-place').value;
  const room = $('#f-room').value;
  return state.items
    .filter(i => !i.archived)
    .filter(i => !place || placeOf(i)?.id === place)
    .filter(i => !cat || i.categoryId === cat)
    .filter(i => !room || i.roomId === room)
    .filter(i => state.listFilter !== 'unnamed' || home.isUnnamed(i))
    .filter(i => !q || norm(haystack(i)).includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// opts.inRoom: in der Raum-Ansicht Ort und Raum weglassen; opts.noCat: Kategorie steht schon darüber.
// Wo: „Auto · Kofferraum · Regal 2“ mit dem Symbol des Orts.
function rowHTML(it, why, opts = {}) {
  const thumb = isThumb(it.thumb)
    ? `<img class="thumb" src="${esc(it.thumb)}" alt="">`
    : placeholderHTML(it, 'thumb');
  const cat = opts.noCat ? '' : catName(it.categoryId);
  const p = opts.inRoom ? null : placeOf(it);
  const place = [opts.inRoom ? '' : whereOf(it, ' · '), it.locationDetail].filter(Boolean).join(' · ');
  const title = aiBusy(it)
    ? `<div class="name pending"><span class="spin"></span>${esc(it.name || 'wird erkannt …')}</div>`
    : it.name
      ? `<div class="name">${esc(it.name)}</div>`
      : aiNeedsKey(it)
        ? '<div class="name unnamed">Wartet auf API-Key</div>'
        : '<div class="name unnamed">Unbenannt – antippen zum Benennen</div>';
  return `<button class="row${aiBusy(it) ? ' is-pending' : ''}" data-id="${esc(it.id)}">
    ${thumb}
    <div class="body">
      ${title}
      <div class="meta">${cat ? `<span class="tag">${esc(cat)}</span>` : ''}${place ? `<span class="place">${p ? placeIcon(p) : icon('pin')}<span>${esc(place)}</span></span>` : ''}${it.quantity ? `<span class="qty">${esc(it.quantity)}</span>` : ''}</div>
      ${why ? `<div class="why">${esc(why)}</div>` : `<div class="when">${dtf.format(new Date(it.createdAt))}</div>`}
    </div>
  </button>`;
}

function renderList() {
  if (state.aiSearch) { renderAiResult(); return; }
  $('#ai-answer').hidden = true;
  $('#filters').hidden = false;
  $('#f-flag').hidden = !state.listFilter;
  $('#f-flag-txt').textContent = state.listFilter === 'unnamed' ? 'Nur unbenannte' : '';
  const nr = noRoomItems().length;
  const hint = $('#noroom-hint');
  hint.hidden = !nr;
  if (nr) hint.innerHTML = `<span class="nr-ic">${icon('pin')}</span>`
    + `<span class="nr-txt"><b>${plural(nr, 'Eintrag', 'Einträge')} ohne Ort</b><small>Jetzt gesammelt zuordnen</small></span>`
    + icon('chev-r', 'go');
  const rows = visibleItems();
  const total = state.items.filter(i => !i.archived).length;
  $('#list').innerHTML = rows.map(it => rowHTML(it)).join('');
  $('#list-count').textContent = total ? (rows.length === total ? `${total}` : `${rows.length}/${total}`) : '';
  const empty = $('#list-empty');
  empty.hidden = rows.length > 0;
  empty.classList.toggle('first', total === 0);
  empty.innerHTML = total === 0
    ? `${EMPTY_ART}<p><strong>Noch nichts erfasst</strong>Tippe unten auf die Kamera und fotografiere, was du aufbewahrst – Stück für Stück.</p>`
    : state.listFilter === 'unnamed' && !$('#q').value.trim()
      ? `<span class="empty-badge">${icon('check')}</span><p>Alles hat einen Namen.</p>`
      : `<span class="empty-badge muted">${icon('search')}</span><p>Keine Treffer für diese Suche oder Filter.</p>`;
}

/* ---------------- KI-Suche ---------------- */

function renderAiResult() {
  const a = state.aiSearch;
  // Inzwischen Archiviertes (z. B. weggewischt) nicht mehr zeigen.
  const matches = a.matches
    .map(m => ({ item: state.items.find(i => i.id === m.item.id), why: m.why }))
    .filter(m => m.item && !m.item.archived);
  $('#filters').hidden = true;
  $('#f-flag').hidden = true;
  $('#noroom-hint').hidden = true;
  $('#ai-answer').hidden = false;
  $('#ai-answer-q').textContent = a.question;
  $('#ai-answer-text').textContent = a.answer || 'Keine Antwort erhalten.';
  $('#list').innerHTML = matches.map(m => rowHTML(m.item, m.why)).join('');
  $('#list-count').textContent = matches.length || '';
  const empty = $('#list-empty');
  empty.hidden = matches.length > 0;
  empty.classList.remove('first');
  empty.innerHTML = `<span class="empty-badge muted">${icon('sparkle')}</span><p>Dazu passt nichts aus deinem Bestand.</p>`;
}

function clearAiSearch() {
  state.aiSearch = null;
  // Auch das Suchfeld leeren: die Frage als Textfilter ergäbe sonst eine leere Liste.
  $('#q').value = '';
  renderList();
  updateAskButton();
}

function updateAskButton() {
  const q = $('#q').value.trim();
  $('#ai-search').hidden = !!state.aiSearch || q.length < 3;
}

async function runAiSearch() {
  const question = $('#q').value.trim();
  if (question.length < 3) return;
  if (!state.settings.apiKey) {
    toast('Für die KI-Suche brauchst du einen API-Key in den Einstellungen.', true);
    return;
  }
  const pool = state.items.filter(i => !i.archived);
  if (!pool.length) { toast('Es ist noch nichts erfasst.', true); return; }

  const btn = $('#ai-search');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>KI durchsucht deinen Bestand …';
  try {
    const entries = pool.map((it, i) => ({
      n: i + 1,
      name: it.name,
      category: catName(it.categoryId),
      place: placeOf(it)?.name || '',
      room: roomName(it.roomId),
      location: it.locationDetail,
      quantity: it.quantity,
      note: it.note,
    }));
    const res = await ai.searchInventory(state.settings, question, entries);
    // Nur Nummern übernehmen, die es wirklich gibt – gegen erfundene Treffer.
    const seen = new Set();
    const matches = [];
    for (const m of res.matches) {
      if (m.n < 1 || m.n > pool.length || seen.has(m.n)) continue;
      seen.add(m.n);
      matches.push({ item: pool[m.n - 1], why: m.why });
    }
    state.aiSearch = { question, answer: res.answer, matches };
    renderList();
    updateAskButton();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Stattdessen die KI fragen';
  }
}

function renderArchive() {
  const rows = state.items.filter(i => i.archived).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  $('#arch-list').innerHTML = rows.map(it => rowHTML(it)).join('');
  $('#arch-count').textContent = rows.length || '';
  $('#arch-empty').hidden = rows.length > 0;
}

/* =========================== Orte: gemeinsame Bausteine =========================== */

// Chips zur Wahl des Orts in `box` zeichnen – nur neu, wenn sich Orte oder Wahl geändert
// haben (sonst springt die Chip-Reihe beim Hintergrund-Aktualisieren an den Anfang zurück).
function drawPlaceChips(box, selected, opts) {
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

// Tipp auf einen Orts-Chip: gewählt – oder, noch einmal angetippt, wieder offen.
// Liefert die neue Wahl, null bei einem Tipp daneben; „Neuer Ort“ öffnet das Anlegen.
function pickPlace(e, current, onNew) {
  if (e.target.closest('[data-place-new]')) { addPlaceSheet({ onDone: onNew }); return null; }
  const b = e.target.closest('[data-place]');
  if (!b) return null;
  haptic();
  return b.dataset.place === current ? '' : b.dataset.place;
}

// Ein Raumfeld folgt dem gewählten Ort: Vorschläge nur aus diesem Ort; steht darin ein Raum,
// den es dort nicht gibt, wird es geleert – sonst entstünde beim Speichern still ein neuer.
function followPlace(input, pid) {
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
async function resolveWhere(placeId, roomName) {
  const clean = String(roomName || '').trim();
  let pid = placeById(placeId)?.id || '';
  if (!clean) return { placeId: pid || null, roomId: null };
  if (!pid) pid = state.rooms.find(r => low(r.name) === low(clean))?.placeId || '';
  const roomId = await db.ensureRoom(pid, clean);
  if (!roomById(roomId)) await reloadAll();
  return { placeId: roomById(roomId)?.placeId || pid || null, roomId };
}

/* =========================== Hinzufügen: Schnellerfassung =========================== */

// Neue Erfassungsrunde: Zähler leeren, gemerkten Ort und Raum vorbelegen.
function resetCapture() {
  state.capture = { ids: [], busy: state.capture.busy };
  $('#cap-room').value = state.settings.lastRoom || '';
  $('#cap-loc').value = state.settings.lastLoc || '';
  $('#manual').open = false;
  resetManual();
  renderCapWhere();
}

function resetManual() {
  for (const id of ['#man-name', '#man-cat', '#man-qty', '#man-note']) $(id).value = '';
  $('#man-more').open = false;
}

// „Du bist gerade in: Auto › Kofferraum“ – oben groß, darunter die Orts-Chips.
function renderCapWhere() {
  const pid = placeById(state.settings.lastPlace)?.id || '';
  drawPlaceChips($('#cap-places'), pid, { label: 'Ort' });
  $('#cap-room').dataset.place = pid;
  renderCapNow();
}

function renderCapNow() {
  const p = placeById(state.settings.lastPlace);
  const room = $('#cap-room').value.trim();
  $('#cap-now').innerHTML = !p && !room
    ? '<span class="open">Noch offen</span> <small>ordnest du später zu</small>'
    : (p ? `${placeIcon(p)}<b>${esc(p.name)}</b>` : '') + (room ? `${p ? ' <i>›</i> ' : ''}<b>${esc(room)}</b>` : '');
}

async function setCapPlace(id) {
  state.settings.lastPlace = id;
  followPlace($('#cap-room'), id);
  renderCapWhere();
  try {
    await db.setSetting('lastPlace', id);
    await rememberWhere();
  } catch (e) { console.warn('Ort merken fehlgeschlagen:', e); }
}

// Ort, Raum und genauen Platz merken, bis die Nutzerin sie ändert. Leer ist erlaubt.
async function rememberWhere() {
  const room = $('#cap-room').value.trim();
  const loc = $('#cap-loc').value.trim();
  if (room !== (state.settings.lastRoom || '')) { state.settings.lastRoom = room; await db.setSetting('lastRoom', room); }
  if (loc !== (state.settings.lastLoc || '')) { state.settings.lastLoc = loc; await db.setSetting('lastLoc', loc); }
  renderCapNow();
  return { placeId: placeById(state.settings.lastPlace)?.id || '', room, loc };
}

// Ort und Raum für neue Einträge auflösen. Ergab sich der Ort erst aus dem Raum, ihn
// ab jetzt auch oben zeigen und merken.
async function captureWhere() {
  const { placeId, room, loc } = await rememberWhere();
  const where = await resolveWhere(placeId, room);
  if (!placeId && where.placeId) {
    state.settings.lastPlace = where.placeId;
    await db.setSetting('lastPlace', where.placeId);
    renderCapWhere();
  }
  return { ...where, loc };
}

function renderCapture() {
  const hint = $('#cap-hint');
  hint.hidden = hasKey();
  hint.textContent = 'Ohne API-Key in den Einstellungen werden Fotos nicht erkannt. Sie landen als „Unbenannt“ in der Liste – trägst du später einen Key ein, werden sie automatisch erkannt.';
  renderCapWhere();

  const mine = state.capture.ids.map(id => state.items.find(i => i.id === id)).filter(Boolean);
  const busy = state.capture.busy;
  const pending = mine.filter(aiBusy).length;
  const needKey = mine.filter(aiNeedsKey).length;
  $('#cap-status').hidden = !mine.length && !busy;

  const parts = [`${mine.length} erfasst`];
  if (pending) parts.push(`${pending} ${pending === 1 ? 'wird' : 'werden'} erkannt`);
  if (needKey) parts.push(`${needKey} ${needKey === 1 ? 'wartet' : 'warten'} auf API-Key`);
  if (busy) parts.push(busy);
  $('#cap-summary').innerHTML = (busy || pending ? '<span class="spin"></span>' : '') + esc(parts.join(' · '));

  $('#cap-strip').innerHTML = mine.slice(-20).reverse().map(it => {
    const wait = aiBusy(it);
    const pic = isThumb(it.thumb) ? `<img src="${esc(it.thumb)}" alt="">` : placeholderHTML(it, 'cap-ph');
    const label = wait ? 'wird erkannt' : (it.name || (aiNeedsKey(it) ? 'wartet auf API-Key' : 'Unbenannt'));
    const badge = wait ? '<span class="spin"></span>'
      : it.aiState === 'failed' || aiNeedsKey(it) ? `<span class="cap-badge bad">${icon('alert')}</span>`
        : `<span class="cap-badge">${icon('check')}</span>`;
    return `<button class="cap-thumb${wait ? ' pending' : ''}" data-id="${esc(it.id)}" title="${esc(label)}" aria-label="${esc(label)}">
      ${pic}${badge}</button>`;
  }).join('');

  const note = pending ? queue.status().note : '';
  $('#cap-note').hidden = !note;
  $('#cap-note').textContent = note;

  const nr = noRoomItems().length;
  const link = $('#cap-noroom');
  link.hidden = !nr;
  link.textContent = `${plural(nr, 'Eintrag', 'Einträge')} ohne Ort – zuordnen`;
}

// Mehrere Auswahlen nacheinander abarbeiten, nie parallel (Speicher auf dem iPhone).
let captureChain = Promise.resolve();
function capturePhotos(files) {
  if (!files.length) return captureChain;
  captureChain = captureChain.then(() => captureBatch(files)).catch((e) => toast('Speichern fehlgeschlagen: ' + e.message, true));
  return captureChain;
}

// Jedes Foto wird sofort ein Eintrag – erkannt wird später im Hintergrund.
async function captureBatch(files) {
  const { placeId, roomId, loc } = await captureWhere();
  const pending = hasKey();
  const max = Number(state.settings.imgMax) || 1600;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    state.capture.busy = files.length > 1 ? `Foto ${i + 1} von ${files.length} wird gespeichert …` : 'Foto wird gespeichert …';
    if (state.view === 'add') renderCapture();
    let src = null;
    try {
      src = await img.decode(files[i]);
      const blob = await img.toBlob(src, max, 0.82);
      const thumb = img.toDataURL(src, 160, 0.62);
      img.release(src);
      src = null;
      const now = Date.now();
      const photo = { id: db.uid(), buf: await blob.arrayBuffer(), type: 'image/jpeg', createdAt: now };
      const it = db.newItem({
        placeId,
        roomId,
        locationDetail: loc,
        photoId: photo.id,
        thumb,
        aiState: pending ? 'pending' : null,
        createdAt: now,
        updatedAt: now,
      });
      await db.saveItems([it], photo);
      state.items.push(it);
      state.capture.ids.push(it.id);
      if (pending) queue.kick();
    } catch (e) {
      failed++;
      console.warn('Foto nicht übernommen:', e);
    } finally {
      img.release(src);
    }
  }

  state.capture.busy = '';
  renderCurrent();
  if (failed < files.length) haptic();   // Foto gespeichert
  if (failed) toast(`${plural(failed, 'Foto konnte', 'Fotos konnten')} nicht gelesen werden.`, true);
  updateStorageInfo();
}

// „Ohne Foto eintragen“: Name, Kategorie, optional Bestand und Notiz.
async function saveManual() {
  const name = $('#man-name').value.trim();
  if (!name) { toast('Bitte einen Namen eintragen.', true); $('#man-name').focus(); return; }
  const btn = $('#man-save');
  btn.disabled = true;
  try {
    const { placeId, roomId, loc } = await captureWhere();
    const categoryId = await db.ensureNamed('categories', $('#man-cat').value);
    const it = db.newItem({
      name,
      categoryId,
      placeId,
      roomId,
      locationDetail: loc,
      quantity: $('#man-qty').value.trim(),
      note: $('#man-note').value.trim(),
    });
    await db.saveItems([it]);
    state.capture.ids.push(it.id);
    await reloadAll();
    resetManual();
    renderCapture();
    toast(`„${name}“ gespeichert.`);
    updateStorageInfo();
    if (!categoryId) suggestCategoryLater(it.id, name);
  } catch (e) {
    toast('Speichern fehlgeschlagen: ' + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// Kategorie im Hintergrund vorschlagen lassen – blockiert nichts, Fehler sind egal.
async function suggestCategoryLater(id, name) {
  if (!hasKey() || !navigator.onLine) return;
  try {
    const cat = await ai.suggestCategory(state.settings, name, state.cats.map(c => c.name));
    if (!cat) return;
    const cur = await db.get('items', id);
    if (!cur || cur.categoryId) return;
    const categoryId = await db.ensureNamed('categories', cat);
    await db.patchItem(id, { categoryId }, x => !x.categoryId);
    onDataChanged();
  } catch (e) {
    console.warn('Kategorie-Vorschlag fehlgeschlagen:', e);
  }
}

/* =========================== Ohne Ort =========================== */

// Neue Runde: nichts markiert, Ort vorbelegt (gemerkter Ort der Schnellerfassung, sonst der erste).
function resetRoomSel() {
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

function renderRooms() {
  const rows = noRoomItems();
  const ids = new Set(rows.map(r => r.id));
  for (const id of [...state.roomSel]) if (!ids.has(id)) state.roomSel.delete(id);
  $('#rs-count').textContent = rows.length || '';
  $('#rs-main').hidden = !rows.length;
  $('#rs-bar').hidden = !rows.length;
  $('#rs-empty').hidden = rows.length > 0;
  $('#rs-grid').innerHTML = rows.map(pickHTML).join('');
  drawPlaceChips($('#rs-places'), state.rsPlace, { label: 'Ort' });
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
    renderRooms();
    haptic();
    toast(`${plural(res.changed, 'Eintrag', 'Einträge')} → ${whereText(where.placeId, where.roomId)}`);
  } catch (e) {
    toast('Zuweisen fehlgeschlagen: ' + e.message, true);
  } finally {
    updateAssignButton();
  }
}

/* =========================== Raum & Ort =========================== */

function openRoom(id) {
  if (!roomById(id)) return;
  state.roomId = id;
  state.placeId = null;
  if (state.view === 'room') { renderView('room'); return; }
  navigate('room', { fresh: true });
}

// Ein Ort selbst: was dort direkt liegt, ohne Raum (dieselbe Ansicht wie ein Raum).
function openPlace(pid) {
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

function roomMenu(id) {
  const r = roomById(id);
  if (!r) return;
  sheet.open({
    head: roomHead(r),
    actions: [
      { id: 'shoot', label: 'Hier fotografieren', icon: 'camera' },
      { id: 'rename', label: 'Umbenennen', icon: 'pencil' },
      { id: 'drop', label: 'Raum löschen', icon: 'trash', danger: true },
    ],
    onAction: (a) => {
      if (a === 'shoot') shootHere(id);
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

// Neuer Raum – im angegebenen Ort; ohne Ort im Standard-Ort (notfalls entsteht „Zuhause“).
function addRoomSheet(placeId) {
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

const placeHead = (p) => {
  const rooms = roomsIn(p.id).length;
  const n = state.items.filter(it => !it.archived && placeOf(it)?.id === p.id).length;
  return placeBadge(p, 'sh-pic')
    + `<span class="sh-txt"><b>${esc(p.name)}</b><small>${esc(`${plural(rooms, 'Raum', 'Räume')} · ${plural(n, 'Ding', 'Dinge')}`)}</small></span>`;
};

function placeMenu(pid) {
  const p = placeById(pid);
  if (!p) return;
  sheet.open({
    head: placeHead(p),
    actions: [
      { id: 'shoot', label: 'Hier fotografieren', icon: 'camera' },
      { id: 'room', label: 'Raum hinzufügen', icon: 'plus' },
      { id: 'rename', label: 'Umbenennen', icon: 'pencil' },
      { id: 'style', label: 'Symbol & Farbe', icon: 'pl-' + safeIcon(p.icon) },
      { id: 'drop', label: 'Ort löschen', icon: 'trash', danger: true },
    ],
    onAction: (a) => {
      if (a === 'shoot') shootHere(null, pid);
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
function addPlaceSheet({ onDone } = {}) {
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

/* =========================== Kontextmenü eines Eintrags =========================== */

function itemHead(it) {
  const pic = isThumb(it.thumb) ? `<img class="sh-pic" src="${esc(it.thumb)}" alt="">` : placeholderHTML(it, 'sh-pic');
  const place = hasPlace(it) ? [whereOf(it, ' · '), it.locationDetail].filter(Boolean).join(' · ') : 'Ohne Ort';
  const name = it.name || (aiBusy(it) ? 'wird erkannt …' : 'Unbenannt');
  return `${pic}<span class="sh-txt"><b>${esc(name)}</b><small>${esc(place)}</small></span>`;
}

function itemMenu(id) {
  const it = state.items.find(x => x.id === id);
  if (!it || it.archived) return;
  sheet.open({
    head: itemHead(it),
    actions: [
      { id: 'room', label: hasPlace(it) ? 'Ort ändern' : 'Ort zuweisen', icon: 'pin' },
      { id: 'rename', label: it.name ? 'Umbenennen' : 'Benennen', icon: 'pencil' },
      { id: 'archive', label: 'Archivieren', icon: 'archive', danger: true },
    ],
    onAction: (a) => {
      if (a === 'room') whereSheet(it);
      else if (a === 'rename') {
        sheet.form({
          head: itemHead(it), title: it.name ? 'Umbenennen' : 'Benennen', label: 'Name', value: it.name || '',
          placeholder: 'z. B. Akkuschrauber',
          onSubmit: async (v) => {
            if (!v) { toast('Der Name darf nicht leer sein.', true); return false; }
            try {
              await db.patchItem(id, { name: v });
              await refreshItems();
              renderCurrent();
              toast('Umbenannt.');
            } catch (e) { toast(e.message, true); }
            return true;
          },
        });
      } else if (a === 'archive') {
        sheet.close();
        haptic();
        archiveWithUndo(id);
      }
    },
  });
}

// „Ort ändern“: erst der Ort (Chips), darunter die Räume dieses Orts als Chips – ein Tipp
// übernimmt sofort, „Kein Raum“ legt den Eintrag direkt an den Ort. Ein neuer Raum geht über
// das Feld darunter. Bewusst ohne Autofokus: Die Vorschlagsliste des Felds öffnet im Blatt
// nach oben und läge sonst über den Orts-Chips (auf dem iPhone samt Tastatur).
function whereSheet(it) {
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
    head: itemHead(it), title: hasPlace(it) ? 'Ort ändern' : 'Ort zuweisen', submit: 'Übernehmen',
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
    onSubmit: (v) => setItemWhere(it.id, sel.pid, v || sel.room),
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
    toast(`${it?.name ? `„${it.name}“` : 'Eintrag'} → ${whereText(where.placeId, where.roomId)}`);
  } catch (e) {
    toast('Zuweisen fehlgeschlagen: ' + e.message, true);
  }
  return true;
}

// Ins Archiv – mit „Rückgängig“ im Toast statt einer Rückfrage vorher. Wischt man
// mehrere nacheinander weg, sammelt der Toast sie („3 archiviert“), jedes Wischen startet
// die 5 s neu, und Rückgängig holt alle zurück.
let undoBatch = null;   // { ids: [] } – gehört zum gerade stehenden Rückgängig-Toast
async function archiveWithUndo(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  try {
    await db.archiveItem(id);
    await refreshItems();
    renderCurrent();
    updateStorageInfo();
    const batch = undoBatch && toastAction?.batch === undoBatch && !$('#toast').hidden ? undoBatch : { ids: [] };
    if (!batch.ids.includes(id)) batch.ids.push(id);
    undoBatch = batch;
    const n = batch.ids.length;
    const msg = n > 1 ? `${n} archiviert` : it.name ? `„${it.name}“ archiviert.` : 'Ins Archiv verschoben.';
    toast(msg, false, {
      label: 'Rückgängig',
      batch,
      run: async () => {
        if (undoBatch === batch) undoBatch = null;
        try {
          for (const x of batch.ids) await db.restoreItem(x);
          await refreshItems();
          renderCurrent();
          updateStorageInfo();
          queue.kick();
        } catch (e) { toast(e.message, true); }
      },
    });
  } catch (e) {
    toast(e.message, true);
    renderCurrent();
  }
}

/* =========================== Zuhause: Aktionen =========================== */

function onHomeClick(e) {
  const todo = e.target.closest('[data-todo]');
  if (todo) {
    const k = todo.dataset.todo;
    if (k === 'noroom') navigate('rooms');
    else if (k === 'unnamed') { state.listFilter = 'unnamed'; clearSearch(); navigate('list'); }
    else if (k === 'busy') toast(queue.status().note || 'Die KI benennt die Fotos gerade im Hintergrund – du kannst einfach weitermachen.');
    else if (k === 'needkey') {
      navigate('settings');
      const key = $('#set-key');
      key.scrollIntoView({ block: 'center' });
      key.focus({ preventScroll: true });
    }
    return;
  }
  const hp = e.target.closest('[data-home-place]');
  if (hp) { setHomePlace(hp.dataset.homePlace); return; }
  if (e.target.closest('[data-place-add]')) { addPlaceSheet(); return; }
  const pm = e.target.closest('[data-place-menu]');
  if (pm) { placeMenu(pm.dataset.placeMenu); return; }
  const po = e.target.closest('[data-place-open]');
  if (po) { openPlace(po.dataset.placeOpen); return; }
  const ra = e.target.closest('[data-room-add]');
  if (ra) { addRoomSheet(ra.dataset.inPlace || ''); return; }
  const rt = e.target.closest('[data-room]');
  if (rt) { openRoom(rt.dataset.room); return; }
  const tile = e.target.closest('.rtile');
  if (tile) openItem(tile.dataset.id);
}

// Umschalter auf Zuhause: Ort wählen ('' = alle) und merken.
async function setHomePlace(id) {
  if (id && !placeById(id)) id = '';
  if (home.homePlace() === id) return;
  state.settings.homePlace = id;
  home.renderHome();
  home.revealSwitch(!motion.reduced());
  try { await db.setSetting('homePlace', id); } catch (e) { console.warn('Ort merken fehlgeschlagen:', e); }
}

// Suchfeld leeren (auch ein KI-Ergebnis verwerfen).
function clearSearch() {
  state.aiSearch = null;
  $('#q').value = '';
  updateAskButton();
}

/* =========================== Vollbild-Ansicht =========================== */

// ownURL: nur selbst erzeugte Object-URLs beim Schließen wieder freigeben.
function openLightbox(url, ownURL) {
  if (!url) return;
  closeLightbox();
  state.lightboxURL = ownURL ? url : null;
  const lb = $('#lightbox');
  lb.classList.remove('zoom');
  $('#lb-img').src = url;
  $('#lb-scroll').scrollTop = 0;
  $('#lb-scroll').scrollLeft = 0;
  lb.hidden = false;
}

function closeLightbox() {
  const lb = $('#lightbox');
  if (lb.hidden) return;
  lb.hidden = true;
  lb.classList.remove('zoom');
  $('#lb-img').removeAttribute('src');
  if (state.lightboxURL) { URL.revokeObjectURL(state.lightboxURL); state.lightboxURL = null; }
}

// Für die Liste: das Original aus der Datenbank holen, nicht das kleine Vorschaubild.
async function openPhotoOf(itemId) {
  const it = state.items.find(x => x.id === itemId);
  if (!it?.photoId) return;
  const photo = await db.get('photos', it.photoId);
  if (!photo) { toast('Zu diesem Eintrag ist kein Foto gespeichert.', true); return; }
  openLightbox(img.photoURL(photo), true);
}

/* =========================== Detail =========================== */

async function openItem(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  state.currentId = id;

  state.shown = {};
  showField('name', it.name || '');
  showField('cat', catName(it.categoryId));
  showField('room', roomName(it.roomId));
  state.itPlace = placeOf(it)?.id || '';
  state.shown.place = state.itPlace;
  renderItPlace();
  showField('loc', it.locationDetail || '');
  showField('qty', it.quantity || '');
  showField('note', it.note || '');
  // Selten gebrauchte Felder einklappen – außer sie sind schon befüllt.
  $('#it-more').open = !!(it.locationDetail || it.quantity || it.note);
  renderItemAi(it);
  $('#it-meta').textContent =
    `Hinzugefügt: ${dtf.format(new Date(it.createdAt))}` +
    (it.updatedAt && it.updatedAt !== it.createdAt ? ` · Geändert: ${dtf.format(new Date(it.updatedAt))}` : '') +
    (it.archived && it.archivedAt ? ` · Archiviert: ${dtf.format(new Date(it.archivedAt))}` : '');

  $('#it-actions').hidden = !!it.archived;
  $('#it-actions-arch').hidden = !it.archived;

  const el = $('#item-photo');
  if (state.detailURL) { URL.revokeObjectURL(state.detailURL); state.detailURL = null; }
  el.hidden = true;
  el.removeAttribute('src');
  $('#item-nophoto').hidden = false;
  $('#item-expand').hidden = true;
  navigate('item', { fresh: true });

  if (it.photoId) {
    const photo = await db.get('photos', it.photoId);
    if (photo && state.currentId === id) {
      state.detailURL = img.photoURL(photo);
      el.src = state.detailURL;
      el.hidden = false;
      $('#item-nophoto').hidden = true;
      $('#item-expand').hidden = false;
    }
  }
}

// Ort im Eintrag: Chips, der Raum darunter folgt dem gewählten Ort.
function renderItPlace() {
  drawPlaceChips($('#it-place'), state.itPlace, { label: 'Ort' });
  $('#it-room').dataset.place = state.itPlace;
}

// Detail-Feld befüllen und den angezeigten Wert merken (Schlüssel: it-<key>).
function showField(key, val) {
  $('#it-' + key).value = val;
  state.shown[key] = val;
}

// Hat die Nutzerin das Feld seit dem Anzeigen geändert?
const fieldChanged = (key) => $('#it-' + key).value.trim() !== String(state.shown[key] ?? '').trim();

// Status der Hintergrund-Erkennung im Eintrag.
function renderItemAi(it) {
  const pending = it.aiState === 'pending';
  const needKey = aiNeedsKey(it);
  const failed = it.aiState === 'failed';
  // Ohne Key erfasste Fotos lassen sich nachträglich erkennen.
  const fresh = !pending && !failed && !!it.photoId && !it.name;
  const box = $('#it-ai');
  box.hidden = it.archived || !(pending || failed || fresh);
  const txt = $('#it-ai-text');
  if (needKey) {
    txt.className = 'hint';
    txt.textContent = 'Wartet auf die Erkennung – dafür fehlt noch ein API-Key in den Einstellungen.';
  } else if (pending) {
    const note = queue.status().note;
    txt.className = 'hint';
    txt.innerHTML = '<span class="spin"></span>Wird gerade erkannt … Ort, Raum oder Name kannst du trotzdem schon eintragen.'
      + (note ? ` ${esc(note)}` : '');
  } else if (failed) {
    txt.className = 'hint err';
    txt.textContent = 'Erkennung fehlgeschlagen: ' + (it.aiError || 'unbekannter Fehler');
  } else {
    txt.className = 'hint';
    txt.textContent = 'Dieses Foto wurde noch nicht erkannt.';
  }
  const retry = $('#it-retry');
  retry.hidden = pending;
  retry.textContent = failed ? 'Erneut erkennen' : 'Mit KI erkennen';
  $('#it-name').placeholder = pending && !needKey ? 'wird erkannt …' : '';
}

// Nach einer Änderung im Hintergrund: Status neu zeichnen und frisch erkannte
// Werte in noch leere Felder übernehmen – nie Eingaben überschreiben.
function syncItemAi() {
  const it = state.items.find(x => x.id === state.currentId);
  if (!it) return;
  renderItemAi(it);
  // Nur übernehmen, was die Nutzerin nicht angefasst hat. Bleibt ein fokussiertes Feld
  // leer, bleibt auch der gemerkte Wert leer – Speichern lässt das KI-Ergebnis dann stehen.
  const fill = (key, val) => {
    const el = $('#it-' + key);
    if (val && !el.value && document.activeElement !== el) showField(key, val);
  };
  fill('name', it.name);
  fill('cat', catName(it.categoryId));
}

async function retryItem() {
  if (!hasKey()) { toast('Für die Erkennung brauchst du einen API-Key in den Einstellungen.', true); return; }
  try {
    await db.patchItem(state.currentId, { aiState: 'pending', aiError: null });
    await refreshItems();
    syncItemAi();
    queue.kick();
  } catch (e) {
    toast(e.message, true);
  }
}

// Gespeichert wird nur, was die Nutzerin im Detail tatsächlich geändert hat. So bleibt
// ein Ergebnis der Erkennung stehen, das eingetroffen ist, während ein Feld leer im
// Fokus war – und ein bewusst geleertes Feld wird trotzdem geleert.
async function saveItem() {
  const it = state.items.find(x => x.id === state.currentId);
  if (!it) return;
  const name = $('#it-name').value.trim();
  const pending = it.aiState === 'pending';
  // Solange die KI noch arbeitet, darf der Name leer bleiben – sie trägt ihn dann ein.
  if (fieldChanged('name') && !name && !pending) { toast('Der Name darf nicht leer sein.', true); return; }
  try {
    const patch = {};
    if (fieldChanged('name') && name) patch.name = name;
    if (fieldChanged('cat')) patch.categoryId = await db.ensureNamed('categories', $('#it-cat').value);
    // Ort und Raum gehören zusammen: ändert sich eins, beides neu auflösen (neue Räume im Ort).
    if (fieldChanged('room') || state.itPlace !== state.shown.place) {
      const where = await resolveWhere(state.itPlace, $('#it-room').value);
      patch.roomId = where.roomId;
      patch.placeId = where.placeId;
    }
    if (fieldChanged('loc')) patch.locationDetail = $('#it-loc').value.trim();
    if (fieldChanged('qty')) patch.quantity = $('#it-qty').value.trim();
    if (fieldChanged('note')) patch.note = $('#it-note').value.trim();
    if (Object.keys(patch).length) await db.patchItem(it.id, patch);
    await reloadAll();
    navigate('back');
    toast('Gespeichert.');
  } catch (e) {
    toast('Speichern fehlgeschlagen: ' + e.message, true);
  }
}

/* =========================== Einstellungen =========================== */

function fillSettingsForm() {
  $('#set-key').value = state.settings.apiKey || '';
  selectModel(state.settings.model || db.DEFAULT_MODEL);
  $('#set-imgmax').value = String(state.settings.imgMax || 1600);
}

// Setzt die Auswahl und ergänzt den Eintrag, falls er in der Liste fehlt.
function selectModel(id) {
  const sel = $('#set-model');
  if (![...sel.options].some(o => o.value === id)) {
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(id)}">${esc(id)}</option>`);
  }
  sel.value = id;
}

// Neuer oder geänderter API-Key: speichern, Warteschlange neu starten und Fotos,
// die ohne Key erfasst wurden, jetzt erkennen lassen. Liefert die Zahl der vorgemerkten.
async function applyKey(key) {
  state.settings.apiKey = key;
  await db.setSetting('apiKey', key);
  let marked = 0;
  if (key) {
    try {
      marked = await db.markUnrecognized();
    } catch (e) {
      console.warn('Vormerken zur Erkennung fehlgeschlagen:', e);
    }
    if (marked) await refreshItems();
  }
  queue.kick({ reset: true });
  renderCurrent();
  return marked;
}

const markedMsg = (n) => (n ? ` ${plural(n, 'Foto wird', 'Fotos werden')} jetzt erkannt.` : '');

async function loadModelList() {
  const out = $('#set-models-out');
  const key = $('#set-key').value.trim();
  if (key !== state.settings.apiKey) { const n = await applyKey(key); if (n) toast(markedMsg(n).trim()); }
  out.className = 'hint';
  out.innerHTML = '<span class="spin"></span>Lade Modellliste …';
  try {
    const models = await ai.listModels(state.settings);
    if (!models.length) throw new Error('Keine passenden Modelle gefunden.');
    const current = state.settings.model;
    $('#set-model').innerHTML = models
      .map(m => `<option value="${esc(m.id)}">${esc(m.id)}${m.label ? ` – ${esc(m.label)}` : ''}</option>`).join('');
    selectModel(current);
    out.className = 'hint ok';
    out.textContent = `${models.length} Modelle geladen. Bleib im Zweifel bei ${db.DEFAULT_MODEL} – nicht jedes gelistete Modell ist für neue Konten freigeschaltet.`;
  } catch (e) {
    out.className = 'hint err';
    out.textContent = e.message;
  }
}

function renderManagers() {
  const usedCat = new Map(), usedRoom = new Map(), usedPlace = new Map();
  for (const it of state.items) {
    if (it.categoryId) usedCat.set(it.categoryId, (usedCat.get(it.categoryId) || 0) + 1);
    if (it.roomId) usedRoom.set(it.roomId, (usedRoom.get(it.roomId) || 0) + 1);
    const p = placeOf(it);
    if (p) usedPlace.set(p.id, (usedPlace.get(p.id) || 0) + 1);
  }
  const row = (r, used, kind, lead = '') => `<div class="m" data-id="${esc(r.id)}" data-kind="${kind}">
          ${lead}<input value="${esc(r.name)}" data-rename aria-label="${labelOf(kind)} umbenennen">
          <span class="cnt">${used.get(r.id) || 0}</span>
          <button data-drop aria-label="${labelOf(kind)} „${esc(r.name)}“ löschen">${icon('trash')}</button>
        </div>`;
  const none = (txt) => `<div class="none">${txt}</div>`;
  $('#cat-mgr').innerHTML = state.cats.length ? state.cats.map(r => row(r, usedCat, 'categories')).join('')
    : none('Noch nichts angelegt – entsteht automatisch beim Hinzufügen.');
  $('#place-mgr').innerHTML = state.places.length
    ? state.places.map(p => row(p, usedPlace, 'places',
      `<button class="m-badge" data-style aria-label="Symbol und Farbe von „${esc(p.name)}“">${placeBadge(p)}</button>`)).join('')
    : none('Noch kein Ort – entsteht mit dem ersten Raum („Zuhause“) oder hier.');
  // Räume nach Ort gruppiert; Räume, deren Ort fehlt, stehen am Ende für sich.
  const groups = state.places.map(p => [p, roomsIn(p.id)]).filter(([, rs]) => rs.length);
  const lost = state.rooms.filter(r => !placeById(r.placeId));
  $('#room-mgr').innerHTML = state.rooms.length
    ? groups.map(([p, rs]) => `<p class="mgr-sub">${placeBadge(p)}<span>${esc(p.name)}</span></p>` + rs.map(r => row(r, usedRoom, 'rooms')).join('')).join('')
      + (lost.length ? `<p class="mgr-sub"><span>Ohne Ort</span></p>` + lost.map(r => row(r, usedRoom, 'rooms')).join('') : '')
    : none('Noch nichts angelegt – entsteht automatisch beim Hinzufügen.');
  const sel = $('#room-new-place');
  const keep = sel.value;
  sel.innerHTML = state.places.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  sel.hidden = state.places.length < 2;
  sel.value = state.places.some(p => p.id === keep) ? keep : (placeById(state.settings.lastPlace)?.id || state.places[0]?.id || '');
}

const fieldOf = (kind) => (kind === 'categories' ? 'categoryId' : kind === 'places' ? 'placeId' : 'roomId');
const labelOf = (kind) => (kind === 'categories' ? 'Kategorie' : kind === 'places' ? 'Ort' : 'Raum');

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
async function renameNamed(kind, id, name) {
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

async function dropNamed(kind, id) {
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

async function updateStorageInfo() {
  const n = state.items.filter(i => !i.archived).length;
  const a = state.items.filter(i => i.archived).length;
  let usage = '';
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.usage) usage = ` · belegt ca. ${(est.usage / 1048576).toFixed(1)} MB`;
    }
  } catch (_) { void _; }
  let persist = '';
  try {
    if (navigator.storage?.persisted) persist = (await navigator.storage.persisted()) ? ' · dauerhaft gesichert' : '';
  } catch (_) { void _; }
  $('#storage-info').textContent = `${plural(n, 'Eintrag', 'Einträge')}, ${a} im Archiv${usage}${persist}`;
}

/* =========================== Sicherung =========================== */

let exportFile = null;   // { blob, filename, counts }
let importData = null;

const mb = (bytes) => (bytes / 1048576).toFixed(bytes < 1048576 ? 2 : 1) + ' MB';

async function buildBackup() {
  const out = $('#exp-out');
  const btn = $('#exp-build');
  $('#exp-save').hidden = true;
  exportFile = null;
  btn.disabled = true;
  out.className = 'hint';
  out.innerHTML = '<span class="spin"></span>Sicherung wird erstellt …';
  try {
    const withPhotos = $('#exp-photos').checked;
    exportFile = await backup.buildExport({
      withPhotos,
      onProgress: (i, n) => { out.innerHTML = `<span class="spin"></span>Foto ${i} von ${n} …`; },
    });
    const c = exportFile.counts;
    out.className = 'hint ok';
    out.textContent = `Fertig: ${plural(c.items, 'Eintrag', 'Einträge')}, ${c.photos} Fotos, `
      + `${c.categories} Kategorien, ${plural(c.places, 'Ort', 'Orte')}, ${c.rooms} Räume – ${mb(exportFile.blob.size)}.`;
    $('#exp-save').hidden = false;
  } catch (e) {
    out.className = 'hint err';
    out.textContent = 'Sicherung fehlgeschlagen: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

// Muss direkt aus dem Tippen heraus laufen, sonst blockiert iOS das Teilen-Fenster.
async function saveBackup() {
  if (!exportFile) return;
  const { blob, filename } = exportFile;
  const file = new File([blob], filename, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Heim-Inventar Sicherung' });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;   // Nutzer hat abgebrochen
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

async function readImportFile(file) {
  const out = $('#imp-out');
  $('#imp-choice').hidden = true;
  importData = null;
  if (!file) return;
  out.className = 'hint';
  out.innerHTML = '<span class="spin"></span>Datei wird gelesen …';
  try {
    let text;
    try {
      text = await file.text();
    } catch (e) {
      throw new Error('Die Datei konnte nicht gelesen werden: ' + e.message);
    }
    importData = backup.parseBackup(text);
    const c = importData.counts || {};
    const when = importData.exportedAt ? dtf.format(new Date(importData.exportedAt)) : 'unbekannt';
    out.className = 'hint';
    const places = Array.isArray(importData.places) ? importData.places.length : 0;
    out.textContent = `Sicherung vom ${when}: ${c.items ?? importData.items.length} Einträge, `
      + `${(importData.photos || []).length} Fotos, ${(importData.categories || []).length} Kategorien, `
      + (places ? `${plural(places, 'Ort', 'Orte')}, ` : '')
      + `${(importData.rooms || []).length} Räume`
      + (!places && (importData.rooms || []).length ? ' (aus der Zeit vor den Orten – sie kommen nach „Zuhause“)' : '')
      + '. Wie soll eingelesen werden?';
    $('#imp-choice').hidden = false;
  } catch (e) {
    importData = null;
    $('#imp-input').value = '';
    out.className = 'hint err';
    out.textContent = e.message;
  }
}

async function runImport(mode) {
  if (!importData) return;
  if (mode === 'replace' && !confirm('Wirklich alles ersetzen? Die aktuellen Einträge und Fotos auf diesem Gerät werden vorher gelöscht.')) return;

  const out = $('#imp-out');
  $('#imp-choice').hidden = true;
  out.className = 'hint';
  out.innerHTML = '<span class="spin"></span>Wird eingelesen …';
  try {
    const stats = await backup.applyBackup(importData, mode, (i, n) => {
      out.innerHTML = `<span class="spin"></span>Foto ${i} von ${n} …`;
    });
    importData = null;
    $('#imp-input').value = '';
    await reloadAll();
    renderManagers();
    renderList();
    updateStorageInfo();
    queue.kick();   // mitgebrachte, noch nicht erkannte Fotos jetzt abarbeiten
    out.className = 'hint ok';
    out.textContent = `${plural(stats.items, 'Eintrag', 'Einträge')} und ${stats.photos} Fotos eingelesen`
      + (stats.skipped ? `, ${stats.skipped} waren schon vorhanden.` : '.');
  } catch (e) {
    out.className = 'hint err';
    // Geschrieben wird in einer einzigen Transaktion – der alte Stand ist unverändert.
    out.textContent = 'Import fehlgeschlagen: ' + e.message + ' Es wurde nichts verändert.';
  }
}

async function runDiagnostics() {
  const out = $('#diag-out');
  out.className = 'hint';
  out.textContent = 'Prüfe …';
  try {
    const c = await db.rawCounts();
    const lines = [
      `Adresse: ${location.origin}${location.pathname}`,
      `Datenbank: ${c.items} Einträge, ${c.photos} Fotos, ${c.categories} Kategorien, ${c.places} Orte, ${c.rooms} Räume`,
      `Modus: ${window.matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'vom Home-Bildschirm' : 'im Browser'}`,
    ];
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      lines.push(`Datenbanken hier: ${dbs.map(d => d.name).filter(Boolean).join(', ') || 'keine'}`);
    }
    out.className = c.items > 0 ? 'hint ok' : 'hint';
    out.textContent = lines.join(' · ');
  } catch (e) {
    out.className = 'hint err';
    out.textContent = 'Prüfung fehlgeschlagen: ' + e.message;
  }
}

async function requestPersist() {
  try {
    if (navigator.storage?.persist && navigator.storage?.persisted) {
      if (!(await navigator.storage.persisted())) await navigator.storage.persist();
    }
  } catch (_) { void _; }
}

/* =========================== Events =========================== */

function wire() {
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.preventDefault(); navigate(nav.dataset.nav); }
  });

  // Tippen verwirft ein KI-Ergebnis – es passt dann nicht mehr zur Eingabe.
  $('#q').addEventListener('input', () => {
    if (state.aiSearch) state.aiSearch = null;
    renderList();
    updateAskButton();
  });
  $('#f-cat').addEventListener('change', renderList);
  $('#f-place').addEventListener('change', () => { fillRoomFilter(); renderList(); });
  $('#f-room').addEventListener('change', renderList);
  $('#ai-search').addEventListener('click', runAiSearch);
  $('#ai-clear').addEventListener('click', clearAiSearch);
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !state.aiSearch && $('#q').value.trim().length >= 3) runAiSearch();
  });

  // Tipp auf das Vorschaubild zeigt das Foto groß, Tipp auf den Rest öffnet den Eintrag.
  const rowClick = (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    if (e.target.matches('img.thumb')) { openPhotoOf(row.dataset.id); return; }
    openItem(row.dataset.id);
  };
  $('#list').addEventListener('click', rowClick);
  $('#arch-list').addEventListener('click', rowClick);
  $('#room-list').addEventListener('click', rowClick);
  $('#f-flag').addEventListener('click', () => { state.listFilter = null; renderList(); });

  // --- Zuhause, Räume & Raum ---
  $('#view-home').addEventListener('click', onHomeClick);
  $('#view-places').addEventListener('click', onHomeClick);
  // Direkt im Tipp fokussieren, sonst öffnet iOS die Tastatur nicht.
  $('#home-search').addEventListener('click', () => { navigate('list'); $('#q').focus(); });
  $('#room-shoot').addEventListener('click', () => shootHere(state.roomId, state.placeId));
  $('#room-menu').addEventListener('click', () => (state.roomId ? roomMenu(state.roomId) : placeMenu(state.placeId)));
  $('#places-add').addEventListener('click', () => addPlaceSheet());
  const roomScroll = $('#view-room .scroll');
  roomScroll.addEventListener('scroll', () => {
    $('#view-room').classList.toggle('scrolled', roomScroll.scrollTop > 40);
  }, { passive: true });
  $('#onb-again').addEventListener('click', () => onboarding.show());

  // --- Gesten ---
  const archiveAct = `<span class="sa-in">${icon('archive')}<span>Archiv</span></span>`;
  for (const root of [$('#list'), $('#room-list')]) {
    swipers.push(swipeRows(root, '.row', archiveAct, (row) => archiveWithUndo(row.dataset.id)));
    longPress(root, '.row', (row) => itemMenu(row.dataset.id));
  }
  longPress($('#home-recent'), '.rtile', (el) => itemMenu(el.dataset.id));
  for (const root of [$('#home-rooms'), $('#places-grid')]) {
    longPress(root, '.rt[data-room]', (el) => roomMenu(el.dataset.room));
    longPress(root, '.rt[data-place-open]', (el) => placeMenu(el.dataset.placeOpen));
    longPress(root, '.pgroup-head', (el) => placeMenu(el.dataset.placeHead || el.dataset.homePlace));
  }
  edgeSwipe($('#edge'), beginSwipeBack, commitSwipeBack);

  // --- Vollbild-Ansicht ---
  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lb-scroll').addEventListener('click', (e) => {
    if (e.target.id === 'lb-img') $('#lightbox').classList.toggle('zoom');
    else closeLightbox();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
  $('#item-photo').addEventListener('click', () => openLightbox(state.detailURL, false));
  $('#item-photo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(state.detailURL, false); }
  });

  // --- Hinzufügen (Schnellerfassung) ---
  $('#cap-camera').addEventListener('click', () => $('#cap-camera-input').click());
  $('#cap-library').addEventListener('click', () => $('#cap-library-input').click());
  const onFiles = (e) => {
    const input = e.target;
    const files = Array.from(input.files || []);   // sofort kopieren, die FileList ist „live“
    // Erst nach der Verarbeitung leeren (dasselbe Foto soll sich noch einmal wählen
    // lassen) – Safari macht die Dateien sonst u. U. schon vorher unlesbar.
    capturePhotos(files).finally(() => { input.value = ''; });
  };
  $('#cap-camera-input').addEventListener('change', onFiles);
  $('#cap-library-input').addEventListener('change', onFiles);
  $('#cap-places').addEventListener('click', (e) => {
    const next = pickPlace(e, placeById(state.settings.lastPlace)?.id || '', (id) => { if (id) setCapPlace(id); });
    if (next != null) setCapPlace(next);
  });
  $('#cap-room').addEventListener('input', renderCapNow);
  $('#cap-room').addEventListener('change', rememberWhere);
  $('#cap-loc').addEventListener('change', rememberWhere);
  $('#cap-strip').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) openItem(b.dataset.id);
  });
  $('#man-save').addEventListener('click', saveManual);
  $('#man-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveManual(); } });
  $('#qty-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-qty]');
    if (chip) $('#man-qty').value = chip.dataset.qty;
  });

  // --- Ohne Ort ---
  $('#rs-places').addEventListener('click', (e) => {
    const next = pickPlace(e, state.rsPlace, (id) => { if (id) { state.rsPlace = id; renderRooms(); } });
    if (next == null) return;
    state.rsPlace = next;
    followPlace($('#rs-room'), next);
    renderRooms();
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
    renderRooms();
  });
  $('#rs-none').addEventListener('click', () => { state.roomSel.clear(); renderRooms(); });
  $('#rs-assign').addEventListener('click', assignRooms);

  // --- Detail ---
  $('#it-place').addEventListener('click', (e) => {
    const next = pickPlace(e, state.itPlace, (id) => { if (id) { state.itPlace = id; followPlace($('#it-room'), id); renderItPlace(); } });
    if (next == null) return;
    state.itPlace = next;
    followPlace($('#it-room'), next);
    renderItPlace();
  });
  $('#item-save').addEventListener('click', saveItem);
  $('#it-retry').addEventListener('click', retryItem);
  // Kein Rückfrage-Dialog mehr: der Toast bietet 5 s lang „Rückgängig“.
  $('#it-archive').addEventListener('click', () => {
    const id = state.currentId;
    navigate('back');
    archiveWithUndo(id);
  });
  $('#it-restore').addEventListener('click', async () => {
    try {
      await db.restoreItem(state.currentId);
      await reloadAll();
      navigate('list');
      toast('Wiederhergestellt.');
      queue.kick();   // war es noch nicht erkannt, geht es jetzt weiter
    } catch (e) {
      toast(e.message, true);
    }
  });
  $('#it-purge').addEventListener('click', async () => {
    if (!confirm('Endgültig löschen? Eintrag und Foto sind danach unwiderruflich weg.')) return;
    try {
      await db.purgeItem(state.currentId);
      await reloadAll();
      navigate('archive');
      toast('Endgültig gelöscht.');
      updateStorageInfo();
    } catch (e) {
      toast(e.message, true);
    }
  });

  // --- Einstellungen ---
  $('#set-key').addEventListener('change', async (e) => {
    const key = e.target.value.trim();
    e.target.value = key;
    if (key === (state.settings.apiKey || '')) return;
    const n = await applyKey(key);   // liegen gebliebene Fotos jetzt erkennen
    toast(key ? 'API-Key gespeichert.' + markedMsg(n) : 'API-Key entfernt.');
  });
  $('#set-key-show').addEventListener('change', (e) => {
    $('#set-key').type = e.target.checked ? 'text' : 'password';
  });
  $('#set-model').addEventListener('change', async (e) => {
    state.settings.model = e.target.value;
    await db.setSetting('model', e.target.value);
    queue.kick({ reset: true });
  });
  $('#set-imgmax').addEventListener('change', async (e) => {
    state.settings.imgMax = Number(e.target.value);
    await db.setSetting('imgMax', state.settings.imgMax);
  });
  // --- Sicherung ---
  $('#exp-build').addEventListener('click', buildBackup);
  $('#exp-save').addEventListener('click', saveBackup);
  $('#exp-photos').addEventListener('change', () => { $('#exp-save').hidden = true; $('#exp-out').textContent = ''; exportFile = null; });
  $('#imp-pick').addEventListener('click', () => $('#imp-input').click());
  $('#imp-input').addEventListener('change', (e) => readImportFile(e.target.files[0]));
  $('#imp-merge').addEventListener('click', () => runImport('merge'));
  $('#imp-replace').addEventListener('click', () => runImport('replace'));
  $('#imp-cancel').addEventListener('click', () => {
    importData = null;
    $('#imp-input').value = '';
    $('#imp-choice').hidden = true;
    $('#imp-out').textContent = '';
  });
  $('#diag-run').addEventListener('click', runDiagnostics);

  $('#set-models-load').addEventListener('click', loadModelList);
  $('#set-test').addEventListener('click', async () => {
    const out = $('#set-test-out');
    const key = $('#set-key').value.trim();
    if (key !== state.settings.apiKey) { const n = await applyKey(key); if (n) toast(markedMsg(n).trim()); }
    out.className = 'hint';
    out.innerHTML = '<span class="spin"></span>Teste …';
    try {
      await ai.testConnection(state.settings);
      out.className = 'hint ok';
      out.textContent = `Verbindung steht – ${state.settings.model} antwortet.`;
    } catch (e) {
      out.className = 'hint err';
      out.textContent = e.message;
    }
  });

  const mgrHandler = (root) => {
    root.addEventListener('change', (e) => {
      if (e.target.closest('select')) return;
      const inp = e.target.closest('[data-rename]');
      if (!inp) return;
      const m = inp.closest('.m');
      renameNamed(m.dataset.kind, m.dataset.id, inp.value);
    });
    root.addEventListener('click', (e) => {
      const st = e.target.closest('[data-style]');
      if (st) { placeStyleSheet(st.closest('.m').dataset.id); return; }
      const btn = e.target.closest('[data-drop]');
      if (!btn) return;
      const m = btn.closest('.m');
      dropNamed(m.dataset.kind, m.dataset.id);
    });
  };
  mgrHandler($('#cat-mgr'));
  mgrHandler($('#place-mgr'));
  mgrHandler($('#room-mgr'));

  $('#cat-add').addEventListener('click', () => addNamed('categories', $('#cat-new')));
  $('#place-add').addEventListener('click', () => addNamed('places', $('#place-new')));
  $('#room-add').addEventListener('click', () => addNamed('rooms', $('#room-new')));
}

async function addNamed(kind, input) {
  const name = input.value.trim();
  if (!name) return;
  try {
    if (kind === 'rooms') await db.ensureRoom($('#room-new-place').value, name);
    else if (kind === 'places') await db.ensurePlace(name);
    else await db.ensureNamed(kind, name);
    input.value = '';
    await reloadAll();
    renderManagers();
    toast('Angelegt.');
  } catch (e) {
    toast(e.message, true);
  }
}

/* =========================== Toast & Service Worker =========================== */

let toastTimer = null;
let toastAction = null;   // Aktion des gerade stehenden Toasts (oder null)
// action: { label, run } – z. B. „Rückgängig“; bleibt dann 5 s stehen.
function toast(msg, isError, action) {
  const t = $('#toast');
  toastAction = action || null;
  t.className = 'toast' + (isError ? ' err' : '') + (action ? ' has-act' : '');
  if (action) {
    t.innerHTML = `<span class="toast-msg">${esc(msg)}</span><button class="toast-act" type="button">${icon('undo')}${esc(action.label)}</button>`;
    t.querySelector('.toast-act').addEventListener('click', () => {
      clearTimeout(toastTimer);
      t.hidden = true;
      toastAction = null;
      action.run();
    }, { once: true });
  } else {
    t.textContent = msg;
  }
  t.hidden = false;
  // Neu einblenden, auch wenn schon ein Toast stand.
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(toastTimer);
  // Das Ausblenden (150 ms) zählt zur Standzeit – der Toast ist zur selben Zeit weg wie früher.
  toastTimer = setTimeout(() => hideToast(), (action ? 5000 : isError ? 5200 : 2600) - 150);
}

// Die Glas-Kapsel zieht sich zusammen und verblasst (bei „Bewegung reduzieren“ ohne Animation).
function hideToast() {
  const t = $('#toast');
  toastAction = null;
  if (t.hidden) return;
  if (!motion.reduced()) t.className += ' out';
  toastTimer = setTimeout(() => { t.hidden = true; t.classList.remove('out'); }, 150);
}

// Mischstand nach einem Update beheben: den neuen Service Worker übernehmen lassen und
// einmal neu laden. Die eigentliche Rettung steht inline in index.html (sie muss auch
// laufen, wenn app.js veraltet ist). Stammt index.html noch aus einer Fassung ohne sie,
// hier eine knappe Nachbildung. Liefert true, wenn gleich neu geladen wird.
async function rescueUpdate(why) {
  if (window.__inventarRescue) return window.__inventarRescue(why);
  if (!('serviceWorker' in navigator)) return false;
  const KEY = 'inventar-rettung';
  try {
    if (Date.now() - (Number(sessionStorage.getItem(KEY)) || 0) < 120000) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    await reg.update().catch(() => null);
    let w = reg.waiting;
    const nw = reg.installing;
    if (!w && nw) {
      await new Promise((res) => {
        const t = setTimeout(res, 30000);
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' || nw.state === 'redundant') { clearTimeout(t); res(); } });
      });
      w = reg.waiting;
    }
    if (!w) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
    let done = false;
    const reload = () => { if (!done) { done = true; location.reload(); } };
    navigator.serviceWorker.addEventListener('controllerchange', reload);
    w.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(reload, 6000);
    return true;
  } catch (e) {
    console.warn('Update-Rettung fehlgeschlagen:', e);
    return false;
  }
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    // Wartet schon eine neue Fassung (z. B. vom letzten Start), gleich anbieten.
    if (reg.waiting) $('#update-bar').hidden = false;

    let reloading = false;
    const reloadOnce = () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    };
    $('#update-go').addEventListener('click', () => {
      const w = reg.waiting;
      if (!w) { reloadOnce(); return; }
      $('#update-go').disabled = true;
      // Erst neu laden, wenn der neue Service Worker wirklich übernommen hat.
      navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
      w.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(reloadOnce, 4000);   // Rückfall, falls das Ereignis ausbleibt
    });
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) $('#update-bar').hidden = false;
      });
    });
  } catch (e) {
    console.warn('Service Worker nicht registriert:', e);
  }
}

boot();
