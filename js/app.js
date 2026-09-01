import * as db from './db.js';
import * as img from './img.js';
import * as ai from './gemini.js';
import { initCombos, hideCombo } from './combo.js';
import * as backup from './backup.js';

const APP_VERSION = '1.1.0';

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
  prevView: 'list',
  draft: { source: null, previewURL: null, cards: [] },
  currentId: null,
  detailURL: null,
  lightboxURL: null,
};

const catName = (id) => state.cats.find(c => c.id === id)?.name || '';
const roomName = (id) => state.rooms.find(r => r.id === id)?.name || '';

/* =========================== Boot =========================== */

async function boot() {
  try {
    await db.openDB();
  } catch (e) {
    document.body.innerHTML = `<p style="padding:40px;text-align:center">Die lokale Datenbank konnte nicht geöffnet werden.<br><br>${esc(e.message)}<br><br>Im privaten Modus von Safari steht IndexedDB nicht zur Verfügung.</p>`;
    return;
  }
  await reloadAll();
  wire();
  initCombos(kind => (kind === 'categories' ? state.cats : state.rooms).map(x => x.name));
  fillSettingsForm();
  navigate('list');
  $('#ver-info').textContent = `Heim-Inventar ${APP_VERSION}`;
  window.__inventarReady = true;
  registerSW();
  requestPersist();
  updateStorageInfo();
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
  if (view === 'back') view = state.prevView === 'archive' ? 'archive' : 'list';
  if (view !== state.view) state.prevView = state.view;

  closeLightbox();
  hideCombo();
  if (state.detailURL && view !== 'item') { URL.revokeObjectURL(state.detailURL); state.detailURL = null; }
  if (view === 'add' && state.view !== 'add') resetDraft();

  state.view = view;
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
  const sc = $('#view-' + view + ' .scroll');
  if (sc) sc.scrollTop = 0;

  if (view === 'list') renderList();
  if (view === 'archive') renderArchive();
  if (view === 'settings') { renderManagers(); updateStorageInfo(); }
}

/* =========================== Liste =========================== */

function haystack(it) {
  return [it.name, catName(it.categoryId), roomName(it.roomId), it.locationDetail, it.quantity, it.note]
    .filter(Boolean).join(' ').toLowerCase();
}

function visibleItems() {
  const q = $('#q').value.trim().toLowerCase();
  const cat = $('#f-cat').value;
  const room = $('#f-room').value;
  return state.items
    .filter(i => !i.archived)
    .filter(i => !cat || i.categoryId === cat)
    .filter(i => !room || i.roomId === room)
    .filter(i => !q || haystack(i).includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function rowHTML(it) {
  const thumb = it.thumb
    ? `<img class="thumb" src="${it.thumb}" alt="">`
    : `<div class="thumb">📦</div>`;
  const cat = catName(it.categoryId);
  const place = [roomName(it.roomId), it.locationDetail].filter(Boolean).join(' · ');
  const meta = [it.quantity, place].filter(Boolean).join(' · ');
  return `<button class="row" data-id="${esc(it.id)}">
    ${thumb}
    <div class="body">
      <div class="name">${esc(it.name || '(ohne Namen)')}</div>
      <div class="meta">${cat ? `<span class="tag">${esc(cat)}</span>` : ''}${esc(meta)}</div>
      <div class="when">${dtf.format(new Date(it.createdAt))}</div>
    </div>
  </button>`;
}

function renderList() {
  const rows = visibleItems();
  const total = state.items.filter(i => !i.archived).length;
  $('#list').innerHTML = rows.map(rowHTML).join('');
  $('#list-count').textContent = total ? (rows.length === total ? `${total}` : `${rows.length}/${total}`) : '';
  const empty = $('#list-empty');
  empty.hidden = rows.length > 0;
  empty.innerHTML = total === 0
    ? 'Noch nichts erfasst.<br>Tippe unten auf <b>＋ Hinzufügen</b>.'
    : 'Keine Treffer für diese Suche oder Filter.';
}

function renderArchive() {
  const rows = state.items.filter(i => i.archived).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  $('#arch-list').innerHTML = rows.map(rowHTML).join('');
  $('#arch-count').textContent = rows.length || '';
  $('#arch-empty').hidden = rows.length > 0;
}

/* =========================== Hinzufügen =========================== */

// Dekodierte Bitmap freigeben – auf dem iPhone sonst schnell viel Speicher.
function releaseSource() {
  const s = state.draft.source;
  if (s && typeof s.close === 'function') { try { s.close(); } catch (_) { void _; } }
  state.draft.source = null;
}

function resetDraft() {
  releaseSource();
  if (state.draft.previewURL) URL.revokeObjectURL(state.draft.previewURL);
  state.draft = { source: null, previewURL: null, cards: [] };
  $('#photo-preview').hidden = true;
  $('#photo-preview').removeAttribute('src');
  $('#photo-placeholder').hidden = false;
  $('#photo-clear').hidden = true;
  $('#photo-expand').hidden = true;
  $('#photo-input').value = '';
  $('#ai-hint').value = '';
  $('#ai-status').textContent = '';
  $('#ai-status').className = 'hint';
  $('#in-room').value = '';
  $('#in-loc').value = '';
  $('#in-qty').value = '';
  $('#in-note').value = '';
  setCards([{ name: '', category: '', confidence: null }]);
  updateAiButton();
}

function setCards(cards) {
  state.draft.cards = cards;
  $('#cards').innerHTML = cards.map((c, i) => `
    <div class="icard" data-i="${i}">
      ${cards.length > 1 ? '<button class="del" data-del="' + i + '" aria-label="Entfernen">×</button>' : ''}
      <label class="field"><span>Name</span><input class="c-name" type="text" value="${esc(c.name)}" placeholder="z. B. Akkuschrauber" autocomplete="off"></label>
      <label class="field"><span>Kategorie</span><input class="c-cat" data-combo="categories" value="${esc(c.category)}" placeholder="z. B. Werkzeug" autocomplete="off"></label>
      ${c.confidence != null ? `<p class="conf">KI-Sicherheit: ${Math.round(c.confidence * 100)} %</p>` : ''}
    </div>`).join('');
}

function readCards() {
  return $$('#cards .icard').map(el => ({
    name: el.querySelector('.c-name').value.trim(),
    category: el.querySelector('.c-cat').value.trim(),
  })).filter(c => c.name);
}

function updateAiButton() {
  $('#ai-run').disabled = !state.draft.source;
}

async function onPhotoChosen(file) {
  if (!file) return;
  try {
    $('#ai-status').className = 'hint';
    $('#ai-status').textContent = 'Bild wird geladen …';
    const source = await img.decode(file);
    releaseSource();
    if (state.draft.previewURL) URL.revokeObjectURL(state.draft.previewURL);
    state.draft.source = source;
    state.draft.previewURL = URL.createObjectURL(file);
    const p = $('#photo-preview');
    p.src = state.draft.previewURL;
    p.hidden = false;
    $('#photo-placeholder').hidden = true;
    $('#photo-clear').hidden = false;
    $('#photo-expand').hidden = false;
    $('#ai-status').textContent = state.settings.apiKey
      ? 'Bereit. Optional einen Hinweis eintragen, dann „Mit KI erkennen“.'
      : 'Hinweis: Ohne API-Key in den Einstellungen ist keine Erkennung möglich – du kannst den Namen aber selbst eintragen.';
  } catch (e) {
    toast(e.message, true);
    $('#ai-status').textContent = '';
  }
  updateAiButton();
}

async function runAI() {
  if (!state.draft.source) return;
  const btn = $('#ai-run');
  const st = $('#ai-status');
  btn.disabled = true;
  st.className = 'hint';
  st.innerHTML = '<span class="spin"></span>Gemini analysiert das Foto …';
  try {
    const blob = await img.toBlob(state.draft.source, 1024, 0.82);
    const b64 = await img.blobToBase64(blob);
    const found = await ai.analyzePhoto(state.settings, b64, $('#ai-hint').value.trim(), state.cats.map(c => c.name));
    setCards(found);
    st.className = 'hint ok';
    st.textContent = found.length === 1
      ? 'Ein Gegenstand erkannt. Du kannst alles vor dem Speichern ändern.'
      : `${found.length} Gegenstände erkannt. Du kannst alles vor dem Speichern ändern.`;
  } catch (e) {
    st.className = 'hint err';
    st.textContent = e.message;
  } finally {
    btn.disabled = false;
    updateAiButton();
  }
}

async function saveDraft() {
  const cards = readCards();
  if (!cards.length) { toast('Bitte mindestens einen Namen eintragen.', true); return; }

  const btn = $('#add-save');
  btn.disabled = true;
  try {
    const roomId = await db.ensureNamed('rooms', $('#in-room').value);
    const catIds = [];
    for (const c of cards) catIds.push(await db.ensureNamed('categories', c.category));

    let photo = null, photoId = null, thumb = '';
    if (state.draft.source) {
      const max = Number(state.settings.imgMax) || 1600;
      const blob = await img.toBlob(state.draft.source, max, 0.82);
      thumb = img.toDataURL(state.draft.source, 160, 0.62);
      photoId = db.uid();
      photo = { id: photoId, buf: await blob.arrayBuffer(), type: 'image/jpeg', createdAt: Date.now() };
    }

    const now = Date.now();
    const items = cards.map((c, i) => db.newItem({
      name: c.name,
      categoryId: catIds[i],
      roomId,
      locationDetail: $('#in-loc').value.trim(),
      quantity: $('#in-qty').value.trim(),
      note: $('#in-note').value.trim(),
      photoId, thumb,
      confidence: null,
      createdAt: now, updatedAt: now,
    }));

    await db.saveItems(items, photo);
    await reloadAll();
    resetDraft();
    navigate('list');
    toast(`${plural(items.length, 'Eintrag', 'Einträge')} gespeichert.`);
    updateStorageInfo();
  } catch (e) {
    toast('Speichern fehlgeschlagen: ' + e.message, true);
  } finally {
    btn.disabled = false;
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

async function saveItem() {
  const it = state.items.find(x => x.id === state.currentId);
  if (!it) return;
  const name = $('#it-name').value.trim();
  if (!name) { toast('Der Name darf nicht leer sein.', true); return; }
  try {
    it.name = name;
    it.categoryId = await db.ensureNamed('categories', $('#it-cat').value);
    it.roomId = await db.ensureNamed('rooms', $('#it-room').value);
    it.locationDetail = $('#it-loc').value.trim();
    it.quantity = $('#it-qty').value.trim();
    it.note = $('#it-note').value.trim();
    it.updatedAt = Date.now();
    await db.put('items', it);
    await reloadAll();
    navigate(it.archived ? 'archive' : 'list');
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
  if (key !== state.settings.apiKey) { state.settings.apiKey = key; await db.setSetting('apiKey', key); }
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

async function renameNamed(kind, id, name) {
  const clean = name.trim();
  if (!clean) { renderManagers(); return; }
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
    for (const it of affected) { it[field] = twin.id; it.updatedAt = Date.now(); await db.put('items', it); }
    await db.del(kind, id);
    await reloadAll();
    renderManagers();
    renderList();
    toast('Zusammengeführt.');
    return;
  }

  rec.name = clean;
  await db.put(kind, rec);
  await reloadAll();
  renderManagers();
  renderList();
  toast('Umbenannt.');
}

async function dropNamed(kind, id) {
  const field = fieldOf(kind);
  const affected = state.items.filter(i => i[field] === id);
  const label = labelOf(kind);
  const msg = affected.length
    ? `${label} löschen? Bei ${plural(affected.length, 'Eintrag', 'Einträgen')} wird das Feld geleert. Die Einträge selbst bleiben erhalten.`
    : `${label} löschen?`;
  if (!confirm(msg)) return;
  for (const it of affected) { it[field] = null; it.updatedAt = Date.now(); await db.put('items', it); }
  await db.del(kind, id);
  await reloadAll();
  renderManagers();
  renderList();
  toast(`${label} gelöscht.`);
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
    importData = backup.parseBackup(await file.text());
    const c = importData.counts || {};
    const when = importData.exportedAt ? dtf.format(new Date(importData.exportedAt)) : 'unbekannt';
    out.className = 'hint';
    out.textContent = `Sicherung vom ${when}: ${c.items ?? importData.items.length} Einträge, `
      + `${(importData.photos || []).length} Fotos, ${(importData.categories || []).length} Kategorien, `
      + `${(importData.rooms || []).length} Räume. Wie soll eingelesen werden?`;
    $('#imp-choice').hidden = false;
  } catch (e) {
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
    out.textContent = 'Import fehlgeschlagen: ' + e.message;
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

  $('#q').addEventListener('input', renderList);
  $('#f-cat').addEventListener('change', renderList);
  $('#f-room').addEventListener('change', renderList);

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

  // --- Hinzufügen ---
  $('#photo-pick').addEventListener('click', () => $('#photo-input').click());
  $('#photo-slot').addEventListener('click', () => {
    if (state.draft.source) openLightbox(state.draft.previewURL, false);
    else $('#photo-input').click();
  });
  $('#photo-input').addEventListener('change', (e) => onPhotoChosen(e.target.files[0]));
  $('#photo-clear').addEventListener('click', () => {
    releaseSource();
    if (state.draft.previewURL) URL.revokeObjectURL(state.draft.previewURL);
    state.draft.previewURL = null;
    $('#photo-preview').hidden = true;
    $('#photo-preview').removeAttribute('src');
    $('#photo-placeholder').hidden = false;
    $('#photo-clear').hidden = true;
    $('#photo-expand').hidden = true;
    $('#photo-input').value = '';
    $('#ai-status').textContent = '';
    updateAiButton();
  });
  $('#ai-run').addEventListener('click', runAI);
  $('#add-save').addEventListener('click', saveDraft);
  $('#card-add').addEventListener('click', () => {
    setCards([...readCardsRaw(), { name: '', category: '', confidence: null }]);
  });
  $('#cards').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const i = Number(btn.dataset.del);
    setCards(readCardsRaw().filter((_, k) => k !== i));
  });
  $('#qty-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-qty]');
    if (chip) $('#in-qty').value = chip.dataset.qty;
  });

  // --- Detail ---
  $('#item-save').addEventListener('click', saveItem);
  $('#it-archive').addEventListener('click', async () => {
    if (!confirm('Eintrag ins Archiv verschieben? Er bleibt dort wiederherstellbar.')) return;
    await db.archiveItem(state.currentId);
    await reloadAll();
    navigate('list');
    toast('Ins Archiv verschoben.');
  });
  $('#it-restore').addEventListener('click', async () => {
    await db.restoreItem(state.currentId);
    await reloadAll();
    navigate('list');
    toast('Wiederhergestellt.');
  });
  $('#it-purge').addEventListener('click', async () => {
    if (!confirm('Endgültig löschen? Eintrag und Foto sind danach unwiderruflich weg.')) return;
    await db.purgeItem(state.currentId);
    await reloadAll();
    navigate('archive');
    toast('Endgültig gelöscht.');
    updateStorageInfo();
  });

  // --- Einstellungen ---
  $('#set-key').addEventListener('change', async (e) => {
    state.settings.apiKey = e.target.value.trim();
    e.target.value = state.settings.apiKey;
    await db.setSetting('apiKey', state.settings.apiKey);
    toast(state.settings.apiKey ? 'API-Key gespeichert.' : 'API-Key entfernt.');
  });
  $('#set-key-show').addEventListener('change', (e) => {
    $('#set-key').type = e.target.checked ? 'text' : 'password';
  });
  $('#set-model').addEventListener('change', async (e) => {
    state.settings.model = e.target.value;
    await db.setSetting('model', e.target.value);
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
    if (key !== state.settings.apiKey) { state.settings.apiKey = key; await db.setSetting('apiKey', key); }
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

// Wie readCards(), behält aber auch leere Karten und die KI-Sicherheit.
function readCardsRaw() {
  return $$('#cards .icard').map((el, i) => ({
    name: el.querySelector('.c-name').value,
    category: el.querySelector('.c-cat').value,
    confidence: state.draft.cards[i]?.confidence ?? null,
  }));
}

async function addNamed(kind, input) {
  const name = input.value.trim();
  if (!name) return;
  await db.ensureNamed(kind, name);
  input.value = '';
  await reloadAll();
  renderManagers();
  toast('Angelegt.');
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
    $('#update-go').addEventListener('click', () => {
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(() => location.reload(), 250);
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
