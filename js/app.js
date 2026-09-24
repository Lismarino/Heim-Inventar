import * as db from './db.js';
import * as img from './img.js';
import * as ai from './gemini.js';
import { initCombos, hideCombo, norm } from './combo.js';
import * as backup from './backup.js';
import * as queue from './queue.js';

const APP_VERSION = '1.3.0';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dtf = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

const state = {
  settings: {},
  items: [],
  cats: [],
  rooms: [],
  view: 'list',
  origin: {},       // Ansicht -> woher man kam (für „Zurück“)
  capture: { ids: [], busy: '' },   // Schnellerfassung: in dieser Runde erfasste Einträge
  roomSel: new Set(),               // „Ohne Raum“: markierte Einträge
  scrollPos: {},                    // Ansicht -> Scroll-Position beim Verlassen
  currentId: null,
  detailURL: null,
  lightboxURL: null,
  aiSearch: null,   // { question, answer, matches:[{item, why}] }
};

const catName = (id) => state.cats.find(c => c.id === id)?.name || '';
const roomName = (id) => state.rooms.find(r => r.id === id)?.name || '';
const hasKey = () => !!(state.settings.apiKey || '').trim();
// Raum zählt nur, wenn es ihn auch gibt – eine Sicherung kann tote Verweise enthalten.
const hasRoom = (it) => !!(it.roomId && roomName(it.roomId));
const noRoomItems = () => state.items
  .filter(i => !i.archived && !hasRoom(i))
  .sort((a, b) => b.createdAt - a.createdAt);

/* =========================== Boot =========================== */

async function boot() {
  try {
    await db.openDB();
  } catch (e) {
    showBootError('Die lokale Datenbank konnte nicht geöffnet werden. Im privaten Modus von Safari steht IndexedDB nicht zur Verfügung.', e);
    return;
  }
  try {
    await reloadAll();
    wire();
    initCombos(kind => (kind === 'categories' ? state.cats : state.rooms).map(x => x.name));
    queue.initQueue({ settings: () => state.settings, onChange: onDataChanged });
    fillSettingsForm();
    navigate('list');
    $('#ver-info').textContent = `Heim-Inventar ${APP_VERSION}`;
  } catch (e) {
    showBootError('Die gespeicherten Daten konnten nicht geladen werden. Lade die Seite neu; hilft das nicht, schließe andere Tabs mit der App.', e);
    return;
  }
  // Hat der Wächter in index.html schon Alarm geschlagen, weil der Start länger dauerte: zurücknehmen.
  $('#boot-error').hidden = true;
  $('#app').hidden = false;
  window.__inventarReady = true;
  // Die App kann mitten in der Erkennung geschlossen worden sein – liegen Gebliebenes abarbeiten.
  queue.kick();
  registerSW();
  requestPersist();
  updateStorageInfo();
}

// Zeigt die Startfehler-Seite aus index.html mit einer passenden Meldung.
function showBootError(msg, err) {
  window.__inventarFailed = true;   // der Wächter in index.html überschreibt dann nichts mehr
  const box = $('#boot-error');
  box.querySelector('p').textContent = msg;
  $('#boot-error-detail').textContent = err?.message || String(err || '');
  box.hidden = false;
  $('#app').hidden = true;
  console.error('Start fehlgeschlagen:', err);
}

async function reloadAll() {
  const [settings, items, cats, rooms] = await Promise.all([
    db.loadSettings(), db.getAll('items'), db.getAll('categories'), db.getAll('rooms'),
  ]);
  state.settings = settings;
  state.items = items;
  state.cats = cats.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  state.rooms = rooms.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  refreshPickers();
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
  if (state.view === 'list') renderList();
  else if (state.view === 'add') renderCapture();
  else if (state.view === 'rooms') renderRooms();
  else if (state.view === 'archive') renderArchive();
  else if (state.view === 'item') syncItemAi();
}

function refreshPickers() {
  fillSelect($('#f-cat'), state.cats, 'Alle Kategorien');
  fillSelect($('#f-room'), state.rooms, 'Alle Räume');
}

function fillSelect(sel, rows, allLabel) {
  const keep = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` + rows.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  if (rows.some(r => r.id === keep)) sel.value = keep;
}

/* =========================== Navigation =========================== */

function navigate(view) {
  const from = state.view;
  if (view === 'back') view = state.origin[from] || 'list';
  else if (view !== from) state.origin[view] = from;

  closeLightbox();
  hideCombo();
  if (state.detailURL && view !== 'item') { URL.revokeObjectURL(state.detailURL); state.detailURL = null; }
  // Neue Erfassungsrunde – außer man kommt nur aus einem Eintrag oder „Ohne Raum“ zurück.
  if (view === 'add' && !['add', 'item', 'rooms'].includes(from)) resetCapture();
  if (view === 'rooms' && !['rooms', 'item'].includes(from)) resetRoomSel();

  const leaving = $('#view-' + from + ' .scroll');
  if (leaving) state.scrollPos[from] = leaving.scrollTop;

  state.view = view;
  document.body.dataset.view = view;
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.nav === view));

  if (view === 'list') renderList();
  if (view === 'add') renderCapture();
  if (view === 'rooms') renderRooms();
  if (view === 'archive') renderArchive();
  // Aus einem Eintrag zurück: dort weitermachen, wo man war.
  const sc = $('#view-' + view + ' .scroll');
  if (sc) sc.scrollTop = from === 'item' && view !== 'item' ? (state.scrollPos[view] || 0) : 0;
  if (view === 'settings') { renderManagers(); updateStorageInfo(); }
}

/* =========================== Liste =========================== */

function haystack(it) {
  return [it.name, catName(it.categoryId), roomName(it.roomId), it.locationDetail, it.quantity, it.note]
    .filter(Boolean).join(' ');
}

function visibleItems() {
  const q = norm($('#q').value);
  const cat = $('#f-cat').value;
  const room = $('#f-room').value;
  return state.items
    .filter(i => !i.archived)
    .filter(i => !cat || i.categoryId === cat)
    .filter(i => !room || i.roomId === room)
    .filter(i => !q || norm(haystack(i)).includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// Nur echte Bild-Data-URLs – der Wert kann aus einer fremden Sicherungsdatei stammen.
const isThumb = (v) => typeof v === 'string' && v.startsWith('data:image/');

function rowHTML(it, why) {
  const thumb = isThumb(it.thumb)
    ? `<img class="thumb" src="${esc(it.thumb)}" alt="">`
    : `<div class="thumb">📦</div>`;
  const cat = catName(it.categoryId);
  const place = [roomName(it.roomId), it.locationDetail].filter(Boolean).join(' · ');
  const meta = [it.quantity, place].filter(Boolean).join(' · ');
  const title = it.aiState === 'pending'
    ? `<div class="name pending"><span class="spin"></span>${esc(it.name || 'wird erkannt …')}</div>`
    : it.name
      ? `<div class="name">${esc(it.name)}</div>`
      : '<div class="name unnamed">Unbenannt – antippen zum Benennen</div>';
  return `<button class="row" data-id="${esc(it.id)}">
    ${thumb}
    <div class="body">
      ${title}
      <div class="meta">${cat ? `<span class="tag">${esc(cat)}</span>` : ''}${esc(meta)}</div>
      ${why ? `<div class="why">${esc(why)}</div>` : `<div class="when">${dtf.format(new Date(it.createdAt))}</div>`}
    </div>
  </button>`;
}

function renderList() {
  if (state.aiSearch) { renderAiResult(); return; }
  $('#ai-answer').hidden = true;
  $('#filters').hidden = false;
  const nr = noRoomItems().length;
  const hint = $('#noroom-hint');
  hint.hidden = !nr;
  if (nr) hint.innerHTML = `<b>${plural(nr, 'Eintrag', 'Einträge')} ohne Raum</b> – jetzt zuordnen <span class="go">›</span>`;
  const rows = visibleItems();
  const total = state.items.filter(i => !i.archived).length;
  $('#list').innerHTML = rows.map(it => rowHTML(it)).join('');
  $('#list-count').textContent = total ? (rows.length === total ? `${total}` : `${rows.length}/${total}`) : '';
  const empty = $('#list-empty');
  empty.hidden = rows.length > 0;
  empty.innerHTML = total === 0
    ? 'Noch nichts erfasst.<br>Tippe unten auf <b>＋ Hinzufügen</b>.'
    : 'Keine Treffer für diese Suche oder Filter.';
}

/* ---------------- KI-Suche ---------------- */

function renderAiResult() {
  const a = state.aiSearch;
  $('#filters').hidden = true;
  $('#noroom-hint').hidden = true;
  $('#ai-answer').hidden = false;
  $('#ai-answer-q').textContent = a.question;
  $('#ai-answer-text').textContent = a.answer || 'Keine Antwort erhalten.';
  $('#list').innerHTML = a.matches.map(m => rowHTML(m.item, m.why)).join('');
  $('#list-count').textContent = a.matches.length || '';
  const empty = $('#list-empty');
  empty.hidden = a.matches.length > 0;
  empty.textContent = 'Dazu passt nichts aus deinem Bestand.';
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

/* =========================== Hinzufügen: Schnellerfassung =========================== */

// Neue Erfassungsrunde: Zähler leeren, gemerkten Raum vorbelegen.
function resetCapture() {
  state.capture = { ids: [], busy: state.capture.busy };
  $('#cap-room').value = state.settings.lastRoom || '';
  $('#cap-loc').value = state.settings.lastLoc || '';
  $('#manual').open = false;
  resetManual();
}

function resetManual() {
  for (const id of ['#man-name', '#man-cat', '#man-qty', '#man-note']) $(id).value = '';
  $('#man-more').open = false;
}

// Raum und Ort-Details merken, bis die Nutzerin sie ändert. Leer ist erlaubt.
async function rememberWhere() {
  const room = $('#cap-room').value.trim();
  const loc = $('#cap-loc').value.trim();
  if (room !== (state.settings.lastRoom || '')) { state.settings.lastRoom = room; await db.setSetting('lastRoom', room); }
  if (loc !== (state.settings.lastLoc || '')) { state.settings.lastLoc = loc; await db.setSetting('lastLoc', loc); }
  return { room, loc };
}

function renderCapture() {
  const hint = $('#cap-hint');
  hint.hidden = hasKey();
  hint.textContent = 'Ohne API-Key in den Einstellungen werden Fotos nicht erkannt. Sie landen als „Unbenannt“ in der Liste, du benennst sie später.';

  const mine = state.capture.ids.map(id => state.items.find(i => i.id === id)).filter(Boolean);
  const busy = state.capture.busy;
  const pending = mine.filter(i => i.aiState === 'pending').length;
  $('#cap-status').hidden = !mine.length && !busy;

  const parts = [`${mine.length} erfasst`];
  if (pending) parts.push(`${pending} ${pending === 1 ? 'wird' : 'werden'} erkannt`);
  if (busy) parts.push(busy);
  $('#cap-summary').innerHTML = (busy || pending ? '<span class="spin"></span>' : '') + esc(parts.join(' · '));

  $('#cap-strip').innerHTML = mine.slice(-20).reverse().map(it => {
    const wait = it.aiState === 'pending';
    const pic = isThumb(it.thumb) ? `<img src="${esc(it.thumb)}" alt="">` : '<span class="ph">📦</span>';
    const label = wait ? 'wird erkannt' : (it.name || 'Unbenannt');
    return `<button class="cap-thumb${wait ? ' pending' : ''}" data-id="${esc(it.id)}" title="${esc(label)}" aria-label="${esc(label)}">
      ${pic}${wait ? '<span class="spin"></span>' : ''}</button>`;
  }).join('');

  const note = pending ? queue.status().note : '';
  $('#cap-note').hidden = !note;
  $('#cap-note').textContent = note;

  const nr = noRoomItems().length;
  const link = $('#cap-noroom');
  link.hidden = !nr;
  link.textContent = `${plural(nr, 'Eintrag', 'Einträge')} ohne Raum – zuordnen`;
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
  const { room, loc } = await rememberWhere();
  const roomId = await db.ensureNamed('rooms', room);
  if (roomId && !state.rooms.some(r => r.id === roomId)) await reloadAll();
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
    const { room, loc } = await rememberWhere();
    const roomId = await db.ensureNamed('rooms', room);
    const categoryId = await db.ensureNamed('categories', $('#man-cat').value);
    const it = db.newItem({
      name,
      categoryId,
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

/* =========================== Ohne Raum =========================== */

function resetRoomSel() {
  state.roomSel.clear();
  $('#rs-room').value = '';
  $('#rs-loc').value = '';
}

function pickHTML(it) {
  const on = state.roomSel.has(it.id);
  const wait = it.aiState === 'pending';
  const pic = isThumb(it.thumb) ? `<img src="${esc(it.thumb)}" alt="">` : '<span class="ph">📦</span>';
  const name = wait
    ? `<span class="spin"></span>${esc(it.name || 'wird erkannt …')}`
    : esc(it.name || 'Unbenannt');
  return `<div class="pick${on ? ' on' : ''}" data-id="${esc(it.id)}" role="checkbox" aria-checked="${on}" tabindex="0">
    <div class="pick-img">${pic}<span class="pick-check" aria-hidden="true">✓</span></div>
    <div class="pick-name${!it.name && !wait ? ' unnamed' : ''}">${name}</div>
    <button class="pick-edit" data-edit aria-label="Eintrag öffnen">✎</button>
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
  el.setAttribute('aria-checked', String(on));
  updateAssignButton();
}

async function assignRooms() {
  const ids = [...state.roomSel];
  if (!ids.length) return;
  const room = $('#rs-room').value.trim();
  if (!room) { toast('Bitte einen Raum eintragen.', true); $('#rs-room').focus(); return; }
  const btn = $('#rs-assign');
  btn.disabled = true;
  try {
    const roomId = await db.ensureNamed('rooms', room);
    const res = await db.assignRoom(ids, roomId, $('#rs-loc').value);
    state.roomSel.clear();
    hideCombo();
    await reloadAll();
    renderRooms();
    toast(`${plural(res.changed, 'Eintrag', 'Einträge')} → ${roomName(roomId)}`);
  } catch (e) {
    toast('Zuweisen fehlgeschlagen: ' + e.message, true);
  } finally {
    updateAssignButton();
  }
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

  $('#it-name').value = it.name || '';
  $('#it-cat').value = catName(it.categoryId);
  $('#it-room').value = roomName(it.roomId);
  $('#it-loc').value = it.locationDetail || '';
  $('#it-qty').value = it.quantity || '';
  $('#it-note').value = it.note || '';
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
  navigate('item');

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

// Status der Hintergrund-Erkennung im Eintrag.
function renderItemAi(it) {
  const pending = it.aiState === 'pending';
  const failed = it.aiState === 'failed';
  // Ohne Key erfasste Fotos lassen sich nachträglich erkennen.
  const fresh = !pending && !failed && !!it.photoId && !it.name;
  const box = $('#it-ai');
  box.hidden = it.archived || !(pending || failed || fresh);
  const txt = $('#it-ai-text');
  if (pending) {
    const note = queue.status().note;
    txt.className = 'hint';
    txt.innerHTML = '<span class="spin"></span>Wird gerade erkannt … Raum oder Name kannst du trotzdem schon eintragen.'
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
  $('#it-name').placeholder = pending ? 'wird erkannt …' : '';
}

// Nach einer Änderung im Hintergrund: Status neu zeichnen und frisch erkannte
// Werte in noch leere Felder übernehmen – nie Eingaben überschreiben.
function syncItemAi() {
  const it = state.items.find(x => x.id === state.currentId);
  if (!it) return;
  renderItemAi(it);
  const fill = (sel, val) => {
    const el = $(sel);
    if (val && !el.value && document.activeElement !== el) el.value = val;
  };
  fill('#it-name', it.name);
  fill('#it-cat', catName(it.categoryId));
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

async function saveItem() {
  const it = state.items.find(x => x.id === state.currentId);
  if (!it) return;
  const name = $('#it-name').value.trim();
  const pending = it.aiState === 'pending';
  // Solange die KI noch arbeitet, darf der Name leer bleiben – sie trägt ihn dann ein.
  if (!name && !pending) { toast('Der Name darf nicht leer sein.', true); return; }
  try {
    const catText = $('#it-cat').value.trim();
    const patch = {
      name,
      categoryId: await db.ensureNamed('categories', catText),
      roomId: await db.ensureNamed('rooms', $('#it-room').value),
      locationDetail: $('#it-loc').value.trim(),
      quantity: $('#it-qty').value.trim(),
      note: $('#it-note').value.trim(),
    };
    // Leer gelassen: nicht überschreiben, was die Erkennung inzwischen eingetragen hat.
    if (!name) delete patch.name;
    if (!catText && pending) delete patch.categoryId;
    await db.patchItem(it.id, patch);
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

async function loadModelList() {
  const out = $('#set-models-out');
  const key = $('#set-key').value.trim();
  if (key !== state.settings.apiKey) { state.settings.apiKey = key; await db.setSetting('apiKey', key); queue.kick({ reset: true }); }
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
  const usedCat = new Map(), usedRoom = new Map();
  for (const it of state.items) {
    if (it.categoryId) usedCat.set(it.categoryId, (usedCat.get(it.categoryId) || 0) + 1);
    if (it.roomId) usedRoom.set(it.roomId, (usedRoom.get(it.roomId) || 0) + 1);
  }
  const draw = (el, rows, used, kind) => {
    el.innerHTML = rows.length
      ? rows.map(r => `<div class="m" data-id="${esc(r.id)}" data-kind="${kind}">
          <input value="${esc(r.name)}" data-rename>
          <span class="cnt">${used.get(r.id) || 0}</span>
          <button data-drop aria-label="Löschen">🗑</button>
        </div>`).join('')
      : `<div class="none">Noch nichts angelegt – entsteht automatisch beim Hinzufügen.</div>`;
  };
  draw($('#cat-mgr'), state.cats, usedCat, 'categories');
  draw($('#room-mgr'), state.rooms, usedRoom, 'rooms');
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fieldOf = (kind) => (kind === 'categories' ? 'categoryId' : 'roomId');
const labelOf = (kind) => (kind === 'categories' ? 'Kategorie' : 'Raum');

// Der gemerkte Raum der Schnellerfassung ist ein Name – bei Umbenennen/Löschen mitziehen.
async function followLastRoom(oldName, newName) {
  if (!oldName || norm(state.settings.lastRoom) !== norm(oldName)) return;
  state.settings.lastRoom = newName;
  await db.setSetting('lastRoom', newName);
  if (norm($('#cap-room').value) === norm(oldName)) $('#cap-room').value = newName;
}

async function renameNamed(kind, id, name) {
  const clean = name.trim();
  if (!clean) { renderManagers(); return; }
  try {
    const rec = await db.get(kind, id);
    if (!rec || rec.name === clean) return;

    // Gibt es den Namen schon? Dann zusammenführen statt ein Duplikat anzulegen.
    const list = kind === 'categories' ? state.cats : state.rooms;
    const twin = list.find(x => x.id !== id && x.name.toLowerCase() === clean.toLowerCase());
    if (twin) {
      const field = fieldOf(kind);
      const affected = state.items.filter(i => i[field] === id);
      const msg = `„${clean}“ gibt es bereits. Zusammenführen?` +
        (affected.length ? ` ${plural(affected.length, 'Eintrag wird', 'Einträge werden')} umgehängt.` : '');
      if (!confirm(msg)) { renderManagers(); return; }
      await db.moveAndDropNamed(kind, id, twin.id);
      if (kind === 'rooms') await followLastRoom(rec.name, twin.name);
      await reloadAll();
      renderManagers();
      renderList();
      toast('Zusammengeführt.');
      return;
    }

    const oldName = rec.name;
    rec.name = clean;
    await db.put(kind, rec);
    if (kind === 'rooms') await followLastRoom(oldName, clean);
    await reloadAll();
    renderManagers();
    renderList();
    toast('Umbenannt.');
  } catch (e) {
    renderManagers();
    toast(e.message, true);
  }
}

async function dropNamed(kind, id) {
  const field = fieldOf(kind);
  const affected = state.items.filter(i => i[field] === id);
  const label = labelOf(kind);
  const msg = affected.length
    ? `${label} löschen? Bei ${plural(affected.length, 'Eintrag', 'Einträgen')} wird das Feld geleert. Die Einträge selbst bleiben erhalten.`
    : `${label} löschen?`;
  if (!confirm(msg)) return;
  try {
    const oldName = kind === 'rooms' ? roomName(id) : '';
    await db.moveAndDropNamed(kind, id, null);
    if (oldName) await followLastRoom(oldName, '');
    await reloadAll();
    renderManagers();
    renderList();
    toast(`${label} gelöscht.`);
  } catch (e) {
    toast(e.message, true);
  }
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
      + `${c.categories} Kategorien, ${c.rooms} Räume – ${mb(exportFile.blob.size)}.`;
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
    out.textContent = `Sicherung vom ${when}: ${c.items ?? importData.items.length} Einträge, `
      + `${(importData.photos || []).length} Fotos, ${(importData.categories || []).length} Kategorien, `
      + `${(importData.rooms || []).length} Räume. Wie soll eingelesen werden?`;
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
      `Datenbank: ${c.items} Einträge, ${c.photos} Fotos, ${c.categories} Kategorien, ${c.rooms} Räume`,
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

  // --- Vollbild-Ansicht ---
  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lb-scroll').addEventListener('click', (e) => {
    if (e.target.id === 'lb-img') $('#lightbox').classList.toggle('zoom');
    else closeLightbox();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
  $('#item-photo').addEventListener('click', () => openLightbox(state.detailURL, false));

  // --- Hinzufügen (Schnellerfassung) ---
  $('#cap-camera').addEventListener('click', () => $('#cap-camera-input').click());
  $('#cap-library').addEventListener('click', () => $('#cap-library-input').click());
  const onFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';   // dasselbe Foto soll sich noch einmal wählen lassen
    capturePhotos(files);
  };
  $('#cap-camera-input').addEventListener('change', onFiles);
  $('#cap-library-input').addEventListener('change', onFiles);
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

  // --- Ohne Raum ---
  $('#rs-grid').addEventListener('click', (e) => {
    const pick = e.target.closest('.pick');
    if (!pick) return;
    if (e.target.closest('[data-edit]')) { openItem(pick.dataset.id); return; }
    togglePick(pick);
  });
  $('#rs-grid').addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && e.target.matches('.pick')) { e.preventDefault(); togglePick(e.target); }
  });
  $('#rs-all').addEventListener('click', () => {
    for (const it of noRoomItems()) state.roomSel.add(it.id);
    renderRooms();
  });
  $('#rs-none').addEventListener('click', () => { state.roomSel.clear(); renderRooms(); });
  $('#rs-assign').addEventListener('click', assignRooms);

  // --- Detail ---
  $('#item-save').addEventListener('click', saveItem);
  $('#it-retry').addEventListener('click', retryItem);
  $('#it-archive').addEventListener('click', async () => {
    if (!confirm('Eintrag ins Archiv verschieben? Er bleibt dort wiederherstellbar.')) return;
    try {
      await db.archiveItem(state.currentId);
      await reloadAll();
      navigate('back');
      toast('Ins Archiv verschoben.');
    } catch (e) {
      toast(e.message, true);
    }
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
    state.settings.apiKey = e.target.value.trim();
    e.target.value = state.settings.apiKey;
    await db.setSetting('apiKey', state.settings.apiKey);
    toast(state.settings.apiKey ? 'API-Key gespeichert.' : 'API-Key entfernt.');
    queue.kick({ reset: true });   // liegen gebliebene Fotos jetzt erkennen
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
    if (key !== state.settings.apiKey) { state.settings.apiKey = key; await db.setSetting('apiKey', key); queue.kick({ reset: true }); }
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
      const inp = e.target.closest('[data-rename]');
      if (!inp) return;
      const m = inp.closest('.m');
      renameNamed(m.dataset.kind, m.dataset.id, inp.value);
    });
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-drop]');
      if (!btn) return;
      const m = btn.closest('.m');
      dropNamed(m.dataset.kind, m.dataset.id);
    });
  };
  mgrHandler($('#cat-mgr'));
  mgrHandler($('#room-mgr'));

  $('#cat-add').addEventListener('click', () => addNamed('categories', $('#cat-new')));
  $('#room-add').addEventListener('click', () => addNamed('rooms', $('#room-new')));
}

async function addNamed(kind, input) {
  const name = input.value.trim();
  if (!name) return;
  try {
    await db.ensureNamed(kind, name);
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
function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5200 : 2600);
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
