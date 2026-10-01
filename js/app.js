// Heim-Inventar – Start und Verdrahtung. Die Ansichten und Abläufe stehen in eigenen Modulen
// (state, nav, view-*, select, where, toast, lazy); hier: Boot, Fehlerseiten, Zuhause-Aktionen
// und das Anschließen der Ereignisse.
import * as db from './db.js';
import * as queue from './queue.js';
import * as home from './home.js';
import * as motion from './motion.js';
import * as sheet from './sheet.js';
import * as glass from './glass.js';
import * as intro from './intro.js';
import * as sound from './sound.js';
import * as listView from './view-list.js';
import * as select from './select.js';
import * as itemView from './view-item.js';
import * as roomView from './view-room.js';
import * as addView from './view-add.js';
import * as noplaceView from './view-noplace.js';
import * as orteView from './view-orte.js';
import * as settingsView from './view-settings.js';
import * as backupView from './settings-backup.js';
import { initCombos } from './combo.js';
import { dueSoon as docsDueSoon } from './docs.js';
import { edgeSwipe, longPress, swipeRows } from './gestures.js';
import { $, icon } from './ui.js';
import { APP_VERSION } from './version.js';
import { cabinet, gdrive, gdStatus, gdStatusText, gdWanted, onbM, onboarding, preloadCabinet, wireDocs } from './lazy.js';
import { beginSwipeBack, commitSwipeBack, navigate, onDataChanged, swipers } from './nav.js';
import { archiveWithUndo, checkItems, itemMenu, toggleSel } from './select.js';
import { homeBackupGo, onSyncTap, snoozeBackup } from './settings-backup.js';
import { aiBusy, aiNeedsKey, catName, comboSource, hasRoom, noRoomItems, placeById, placeOf, reloadAll, roomById, roomName, state, whereShort } from './state.js';
import { registerSW, rescueUpdate, toast } from './toast.js';
import { openItem } from './view-item.js';
import { clearSearch, rowHTML, showOnly } from './view-list.js';

import { fillSettingsForm, goToKey, requestPersist, updateStorageInfo } from './view-settings.js';

// Für die Mischstand-Prüfung in index.html: gesetzt, sobald dieses Modul läuft.
window.__inventarVersion = APP_VERSION;
// Start-Szene gleich loslaufen lassen – der Start unten wartet nicht auf sie.
intro.start();

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
  await runPlacesMigration();
  try {
    await reloadAll();
    wire();
    glass.init();
    initCombos(comboSource);
    sheet.init();
    sound.init();
    home.init({
      state, roomName, catName, roomById, placeById, placeOf, hasRoom, aiBusy, aiNeedsKey, noRoomItems, whereShort,
      rowHTML: (it, opts) => rowHTML(it, '', opts),
      queueNote: () => queue.status().note,
      checkCount: (pid) => checkItems(pid).length,
      backupState: () => state.homeBackup,
      docsDue: () => docsDueSoon(),
      syncText: gdStatusText,
      syncState: gdStatus,
    });
    queue.initQueue({ settings: () => state.settings, onChange: onDataChanged });
    fillSettingsForm();
    navigate('home', { instant: true });
    $('#ver-info').textContent = `Heim-Inventar ${APP_VERSION}`;
    // Erster Start ohne jede Spur einer Einrichtung: Begrüßung. Scheitert sie, startet die App trotzdem.
    // Nur wer noch nie eingerichtet hat, lädt das Modul überhaupt.
    whatsNew();
    if (!state.settings.onboarded) {
      await onboarding().then((m) => m.maybeShow(state.settings, { items: state.items.length, rooms: state.rooms.length, places: state.places.length }))
        .catch((e) => console.warn('Einführung:', e));
    }
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
  // Google-Drive-Sicherung (nur wenn eingerichtet): lädt das Google-Skript erst jetzt nach.
  if (gdWanted()) gdrive().catch((e) => console.warn('Google-Sicherung:', e));
  preloadCabinet();
}

// Umstellung auf Orte beim ersten Start von 1.7.x. Bei großen Beständen dauert sie ein paar
// Sekunden: Dann den Start-Wächter in index.html anhalten (__inventarMigrating) und sagen, was
// passiert – sonst meldete er nach 6 s „konnte nicht starten“, und ein Neuladen bräche die
// Umstellung ab (schadet nicht, sie beginnt dann von vorn – aber es käme nie ans Ziel).
// Die Start-Szene schimmert darunter ruhig weiter; die Anzeige erscheint erst, wenn es
// länger als einen Augenblick dauert.
async function runPlacesMigration() {
  let pending = null;
  try {
    pending = await db.placesMigrationPending();
  } catch (e) {
    console.warn('Prüfung der Orte fehlgeschlagen:', e);
  }
  if (!pending) return;
  window.__inventarMigrating = true;
  const box = $('#migrate');
  const bar = $('#migrate-bar');
  const count = $('#migrate-n');
  let last = [0, pending.items];
  const draw = () => {
    const [n, total] = last;
    const pct = total ? Math.min(100, Math.round(n / total * 100)) : 0;
    bar.style.transform = `scaleX(${pct / 100})`;
    bar.parentElement.setAttribute('aria-valuenow', String(pct));
    count.textContent = total ? `${n.toLocaleString('de-DE')} von ${total.toLocaleString('de-DE')} Einträgen` : '';
  };
  const show = setTimeout(() => { draw(); box.hidden = false; }, pending.items > 400 ? 0 : 500);
  try {
    const m = await db.migratePlaces({ onProgress: (n, total) => { last = [n, total]; if (!box.hidden) draw(); } });
    if (m.rooms || m.items || m.merged) console.info('Orte eingerichtet:', m);
  } catch (e) {
    console.warn('Zuordnung zu Orten fehlgeschlagen – nächster Start versucht es erneut:', e);
  } finally {
    clearTimeout(show);
    box.hidden = true;
    window.__inventarMigrating = false;
  }
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
// Die Fehlerseite wird für „Einen Moment …“ ausgeliehen – ihr Originaltext bleibt hier, damit
// sie danach wieder vollständig die ist, die der Start-Wächter erwartet.
let bootBoxOriginal = null;
function onDbEvent(type) {
  const box = $('#boot-error');
  if (type === 'blocked') {
    if (bootBoxOriginal === null) bootBoxOriginal = box.innerHTML;
    window.__inventarFailed = true;   // der Start-Wächter soll hier nicht „Datei fehlt“ melden
    box.querySelector('h2').textContent = 'Einen Moment …';
    box.querySelector('p').textContent = 'Die App ist noch in einem anderen Tab oder Fenster mit einer älteren Version geöffnet. '
      + 'Schließe es dort (oder lade es neu) – dann geht es hier von selbst weiter.';
    $('#boot-error-detail').textContent = 'Deine Einträge werden dabei auf Orte umgestellt (Version 1.7). Es geht nichts verloren.';
    box.hidden = false;
  } else if (type === 'unblocked') {
    window.__inventarFailed = false;
    box.hidden = true;
    if (bootBoxOriginal !== null) { box.innerHTML = bootBoxOriginal; bootBoxOriginal = null; }
  } else if (type === 'quota') {
    // Speicher voll (db.js): immer sagen, auch wenn der Aufrufer den Fehler selbst schluckt.
    toast(db.QUOTA_MSG, true);
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
  intro.done().then(() => onbM?.focusStart());
}

/* =========================== Start: Tipps =========================== */

// Klicks auf Start – und im Blatt „Wichtig“ (dieselben Zeilen). Liefert true, wenn etwas passiert ist.
function onHomeClick(e) {
  if (e.target.closest('[data-todo-all]')) { importantSheet(); return true; }
  if (e.target.closest('#home-sync')) { onSyncTap(); return true; }
  const dd = e.target.closest('[data-due-doc]');
  if (dd) { cabinet().then((c) => c.docSheet(dd.dataset.dueDoc)).catch((e) => toast(e.message, true)); return true; }
  const ti = e.target.closest('[data-todo-item]');
  if (ti) { openItem(ti.dataset.todoItem); return true; }
  const todo = e.target.closest('[data-todo]');
  if (todo) {
    const k = todo.dataset.todo;
    if (k === 'noroom') navigate('noplace');
    else if (k === 'unnamed' || k === 'out' || k === 'warranty') { showOnly(k); clearSearch(); navigate('list'); }
    else if (k === 'busy') toast(queue.status().note || 'Die KI benennt die Fotos gerade im Hintergrund – du kannst einfach weitermachen.');
    else if (k === 'needkey') goToKey();
    return true;
  }
  const bk = e.target.closest('[data-backup]');
  if (bk) { if (bk.dataset.backup === 'later') snoozeBackup(); else homeBackupGo(); return true; }
  const hp = e.target.closest('[data-home-place]');
  if (hp) { setHomePlace(hp.dataset.homePlace); return true; }
  const tile = e.target.closest('.rtile');
  if (tile) { openItem(tile.dataset.id); return true; }
  return false;
}

// „Alle anzeigen“ in „Wichtig“: alle Zeilen in einem Blatt; ein Tipp schließt es und führt hin.
function importantSheet() {
  sheet.list({
    title: 'Wichtig',
    html: `<div class="todo-list">${home.importantAllHTML()}</div>`,
    onClick: (e) => {
      if (!e.target.closest('button')) return;
      sheet.close();
      onHomeClick(e);
    },
  });
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

/* =========================== Ereignisse =========================== */

// „Was ist neu“ (2.0): einmal nach dem Update von einer älteren Fassung – nicht bei einer Neuinstallation.
const NEW_IN = '2.0';
function whatsNew() {
  const s = state.settings;
  if (s.seenNew === NEW_IN) return;
  const updated = s.onboarded || state.items.length > 0;
  s.seenNew = NEW_IN;
  db.setSetting('seenNew', NEW_IN).catch((e) => console.warn('Was ist neu merken:', e));
  if (!updated) return;
  const pt = (ic, b, t) => `<div class="new-pt">${icon(ic)}<p><b>${b}</b>${t}</p></div>`;
  sheet.list({
    title: 'Neu in Heim-Inventar 2.0',
    html: `<div class="whats-new">
      ${pt('home', 'Neue Leiste.', ' Start · Alles · Kamera · Orte · Dokumente – die Einstellungen findest du über ⚙ oben auf Start.')}
      ${pt('alert', 'Wichtig auf einen Blick.', ' Start zeigt, was ansteht: Fristen, Verliehenes, Dinge ohne Ort, fällige Sicherung.')}
      ${pt('trash', 'Aufgeräumt.', ' Gelöschtes landet im Papierkorb, Einträge speichern von selbst, Filter sitzen hinter einem Knopf.')}
    </div>`,
  });
}

// Jedes Modul hängt seine eigenen Ereignisse an (init); hier nur, was mehrere verbindet.
// Die Reihenfolge entspricht der bisherigen – bei #list zählt sie (Tipp vor Wischgeste).
function wire() {
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.preventDefault(); navigate(nav.dataset.nav); }
  });
  listView.init();
  select.init();
  itemView.initExtras();

  // --- Start, Orte & Raum ---
  $('#view-home').addEventListener('click', onHomeClick);
  orteView.init();
  // Direkt im Tipp fokussieren, sonst öffnet iOS die Tastatur nicht.
  $('#home-search').addEventListener('click', () => { navigate('list'); $('#q').focus(); });
  roomView.init();
  $('#onb-again').addEventListener('click', () => onboarding().then((m) => m.show()).catch((e) => toast(e.message, true)));

  // --- Gesten ---
  // Wischen = Löschen (2.0): in den Papierkorb, mit „Rückgängig“.
  const archiveAct = `<span class="sa-in">${icon('trash')}<span>Löschen</span></span>`;
  for (const root of [$('#list'), $('#room-list')]) {
    swipers.push(swipeRows(root, '.row', archiveAct, (row) => { if (!state.sel) archiveWithUndo(row.dataset.id); }));
    longPress(root, '.row', (row) => (state.sel ? toggleSel(row.dataset.id) : itemMenu(row.dataset.id)));
  }
  longPress($('#home-recent'), '.rtile', (el) => itemMenu(el.dataset.id));
  edgeSwipe($('#edge'), beginSwipeBack, commitSwipeBack);

  itemView.initLightbox();
  addView.init();
  noplaceView.init();
  itemView.init();
  settingsView.init();
  backupView.init();
  wireDocs();
}

boot();
