// Ansicht „Eintrag“: Felder, Erkennungs-Status, Unterwegs, Duplikat, Belege, Vollbild.
// Gespeichert wird nur, was die Nutzerin geändert hat – per „Speichern“ oder beim Verlassen.
import * as db from './db.js';
import * as img from './img.js';
import * as queue from './queue.js';
import * as sound from './sound.js';
import { docSize, folderPath, isImageDoc, loadIndex, prepareDoc } from './docs.js';
import { haptic } from './gestures.js';
import { cleanDate, outText, qtyNumber } from './match.js';
import { $, dtf, esc, icon, modal, plural } from './ui.js';
import { cabinet, cabM } from './lazy.js';
import { navigate, renderCurrent } from './nav.js';
import { archiveWithUndo, itemHead, outSheet, setOut } from './select.js';
import { aiNeedsKey, catName, hasKey, placeOf, refreshItems, reloadAll, roomName, state, whereShort } from './state.js';
import { toast } from './toast.js';
import { keyHint, updateStorageInfo } from './view-settings.js';
import { centerChip, drawPlaceChips, followPlace, pickPlace, resolveWhere } from './where.js';

function renderItemExtras(it) {
  const out = outText(it);
  $('#it-out').hidden = !out || !!it.archived;
  $('#it-out-text').textContent = out;
  $('#it-out-set').hidden = !!out;
  const other = it.dupOf && !it.archived ? state.items.find(x => x.id === it.dupOf && !x.archived) : null;
  $('#it-dup').hidden = !other;
  if (other) {
    const w = whereShort(other);
    $('#it-dup-text').textContent = `Ähnlich: ${other.name}${w ? ` (${w})` : ''} – schon vorhanden. Zusammenführen erhöht dort den Bestand um 1 und löscht diesen Eintrag.`;
  }
}

async function mergeDup() {
  const it = state.items.find(x => x.id === state.currentId);
  const other = it && state.items.find(x => x.id === it.dupOf && !x.archived);
  if (!other) return;
  const q = qtyNumber(other.quantity);
  const next = q != null ? String(q + 1) : !String(other.quantity || '').trim() ? '2' : other.quantity;
  try {
    await db.patchItem(other.id, { quantity: next });
    await db.purgeItem(it.id);
    await reloadAll();
    navigate('back');
    haptic();
    toast(`Zusammengeführt: „${other.name}“ – Bestand ${next}.`);
  } catch (e) { toast(e.message, true); }
}

async function keepDup() {
  try {
    await db.patchItem(state.currentId, { dupOf: null, dupDismissed: true });
    await refreshItems();
    syncItemAi();
  } catch (e) { toast(e.message, true); }
}

export async function renderDocs(itemId) {
  let list = [];
  try { list = await db.docsOf(itemId); } catch (e) { console.warn('Belege laden:', e); }
  if (state.currentId !== itemId) return;
  state.docs = list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  $('#it-docs').innerHTML = state.docs.map(d => `<div class="doc-row">
      <button type="button" class="doc-open" data-doc="${esc(d.id)}">${icon(isImageDoc(d) ? 'photos' : 'doc')}<span class="doc-txt"><b>${esc(d.name)}</b><small>${isImageDoc(d) ? 'Bild' : 'PDF'} · ${esc(docSize(d))}</small></span></button>
      <button type="button" class="doc-del" data-doc-del="${esc(d.id)}" aria-label="Beleg „${esc(d.name)}“ löschen">${icon('trash')}</button>
    </div>`).join('');
  return state.docs;
}

async function addDocs(files) {
  const id = state.currentId;
  if (!id) return;
  let n = 0;
  for (const f of files) {
    try {
      await db.addDoc(await prepareDoc(f, id, state.settings.imgMax));
      n++;
    } catch (e) { toast(e.message, true); }
  }
  await renderDocs(id);
  await loadIndex().catch(() => {});
  if (n) { haptic(); toast(`${plural(n, 'Beleg', 'Belege')} gespeichert.`); updateStorageInfo(); }
}

function openDoc(docId) {
  const d = state.docs.find(x => x.id === docId);
  if (!d) return;
  // Schon geladen (vorgeladen nach dem Start): synchron – Safari lässt window.open nur direkt in der Geste zu.
  if (cabM) { try { cabM.show(d); } catch (e) { toast(e.message, true); } return; }
  cabinet().then((c) => c.show(d)).catch((e) => toast(e.message, true));
}

async function deleteDoc(docId) {
  const d = state.docs.find(x => x.id === docId);
  if (!d) return;
  // Liegt der Beleg auch in einem Ordner (Dokumente), nur die Verknüpfung lösen.
  if (d.folderId) {
    if (!confirm(`„${d.name}“ vom Eintrag lösen? Das Dokument bleibt im Ordner „${folderPath(d.folderId)}“.`)) return;
    try { await db.patchDoc(docId, { itemId: null }); await renderDocs(state.currentId); await loadIndex(); toast('Verknüpfung gelöst.'); } catch (e) { toast(e.message, true); }
    return;
  }
  if (!confirm(`Beleg „${d.name}“ löschen?`)) return;
  try {
    await db.delDoc(docId);
    await loadIndex();
    await renderDocs(state.currentId);
    toast('Beleg gelöscht.');
    updateStorageInfo();
  } catch (e) { toast(e.message, true); }
}

// ownURL: nur selbst erzeugte Object-URLs beim Schließen wieder freigeben.
export function openLightbox(url, ownURL) {
  if (!url) return;
  closeLightbox();
  state.lightboxURL = ownURL ? url : null;
  const lb = $('#lightbox');
  lb.classList.remove('zoom');
  $('#lb-img').src = url;
  $('#lb-scroll').scrollTop = 0;
  $('#lb-scroll').scrollLeft = 0;
  lb.hidden = false;
  // Modal: Hintergrund inert, Fokus auf „Schließen“, beim Schließen zurück zum Auslöser.
  lbRelease = modal();
  try { $('#lb-close').focus({ preventScroll: true }); } catch (_) { void _; }
}
let lbRelease = null;

export function closeLightbox() {
  const lb = $('#lightbox');
  if (lb.hidden) return;
  lb.hidden = true;
  const rel = lbRelease;
  lbRelease = null;
  rel?.();
  lb.classList.remove('zoom');
  $('#lb-img').removeAttribute('src');
  if (state.lightboxURL) { URL.revokeObjectURL(state.lightboxURL); state.lightboxURL = null; }
}

// Für die Liste: das Original aus der Datenbank holen, nicht das kleine Vorschaubild.
export async function openPhotoOf(itemId) {
  const it = state.items.find(x => x.id === itemId);
  if (!it?.photoId) return;
  const photo = await db.get('photos', it.photoId);
  if (!photo) { toast('Zu diesem Eintrag ist kein Foto gespeichert.', true); return; }
  openLightbox(img.photoURL(photo), true);
}

export async function openItem(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  if (state.view === 'item') leaveItem();   // ein anderer Eintrag ersetzt die Felder gleich
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
  showField('serial', it.serial || '');
  showField('bought', cleanDate(it.purchaseDate));
  showField('warranty', cleanDate(it.warrantyUntil));
  $('#it-essential').checked = state.shown.essential = !!it.essential;
  // Selten gebrauchte Felder einklappen – außer sie sind schon befüllt.
  $('#it-more').open = !!(it.locationDetail || it.quantity || it.note || it.serial || it.purchaseDate || it.warrantyUntil || it.essential);
  state.docs = [];
  $('#it-docs').innerHTML = '';
  renderDocs(id).then((list) => { if (list?.length && state.currentId === id) $('#it-more').open = true; });
  renderItemAi(it);
  renderItemExtras(it);
  $('#it-meta').textContent =
    `Hinzugefügt: ${dtf.format(new Date(it.createdAt))}` +
    (it.updatedAt && it.updatedAt !== it.createdAt ? ` · Geändert: ${dtf.format(new Date(it.updatedAt))}` : '') +
    (it.archived && it.archivedAt ? ` · Gelöscht: ${dtf.format(new Date(it.archivedAt))}` : '');

  $('#it-actions').hidden = !!it.archived;
  $('#it-actions-arch').hidden = !it.archived;

  const el = $('#item-photo');
  if (state.detailURL) { URL.revokeObjectURL(state.detailURL); state.detailURL = null; }
  el.hidden = true;
  el.removeAttribute('src');
  $('#item-nophoto').hidden = false;
  $('#item-expand').hidden = true;
  navigate('item', { fresh: true });
  // Gewählten Ort-Chip mittig ins Bild – erst jetzt ist die Ansicht sichtbar und messbar.
  requestAnimationFrame(() => centerChip($('#it-place')));

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
  drawPlaceChips($('#it-place'), state.itPlace, { add: false, label: 'Ort' });
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
export function syncItemAi() {
  const it = state.items.find(x => x.id === state.currentId);
  if (!it) return;
  renderItemAi(it);
  renderItemExtras(it);
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
  if (!hasKey()) { keyHint('Für die Erkennung brauchst du einen API-Key in den Einstellungen.'); return; }
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
const FIELDS = ['name', 'cat', 'room', 'loc', 'qty', 'note', 'serial', 'bought', 'warranty'];

/** Änderungen seit dem Anzeigen als Momentaufnahme (die Felder können danach schon einen anderen Eintrag zeigen). */
function takeEdits() {
  const it = state.currentId && state.items.find(x => x.id === state.currentId);
  if (!it || !state.shown) return null;
  const val = (k) => $('#it-' + k).value.trim();
  const e = { id: it.id, pending: it.aiState === 'pending', fallbackPlace: state.itPlace || placeOf(it)?.id || null, set: {} };
  for (const k of FIELDS) if (k !== 'room' && fieldChanged(k)) e.set[k] = val(k);
  // Ort und Raum gehören zusammen: ändert sich eins, beides neu auflösen (neue Räume im Ort).
  if (fieldChanged('room') || state.itPlace !== state.shown.place) e.set.where = { place: state.itPlace, room: $('#it-room').value };
  const ess = $('#it-essential').checked;
  if (ess !== state.shown.essential) e.set.essential = ess;
  return e;
}
const hasEdits = (e) => !!e && Object.keys(e.set).length > 0;

/** Die Momentaufnahme schreiben. Liefert true, wenn sich etwas geändert hat. */
async function writeEdits(e) {
  const s = e.set;
  const patch = {};
  if (s.name) patch.name = s.name;
  if ('cat' in s) patch.categoryId = await db.ensureNamed('categories', s.cat);
  if (s.where) {
    const where = await resolveWhere(s.where.place, s.where.room);
    patch.roomId = where.roomId;
    patch.placeId = where.placeId;
  }
  if ('loc' in s) patch.locationDetail = s.loc;
  if ('qty' in s) patch.quantity = s.qty;
  if ('note' in s) patch.note = s.note;
  if ('serial' in s) patch.serial = s.serial.slice(0, 120);
  if ('bought' in s) patch.purchaseDate = cleanDate(s.bought);
  if ('warranty' in s) patch.warrantyUntil = cleanDate(s.warranty);
  if ('essential' in s) {
    patch.essential = s.essential;
    patch.homePlaceId = s.essential ? (patch.placeId !== undefined ? patch.placeId : e.fallbackPlace) : null;
  }
  if (!Object.keys(patch).length) return false;
  await db.patchItem(e.id, patch);
  return true;
}

// Was jetzt in den Feldern steht, gilt ab hier als angezeigt (Grundlage für fieldChanged).
function rebaseShown() {
  for (const k of FIELDS) state.shown[k] = $('#it-' + k).value;
  state.shown.place = state.itPlace;
  state.shown.essential = $('#it-essential').checked;
}

async function saveItem() {
  const e = takeEdits();
  if (!e) return;
  // Solange die KI noch arbeitet, darf der Name leer bleiben – sie trägt ihn dann ein.
  if ('name' in e.set && !e.set.name && !e.pending) { toast('Der Name darf nicht leer sein.', true); return; }
  try {
    await writeEdits(e);
    rebaseShown();   // beim Verlassen nichts doppelt speichern
    await reloadAll();
    navigate('back');
    sound.play('save');
    toast('Gespeichert.');
  } catch (err) {
    toast('Speichern fehlgeschlagen: ' + err.message, true);
  }
}

/**
 * Den Eintrag verlassen (Zurück, Zurückwischen, Tab, anderer Eintrag, App in den Hintergrund):
 * Geändertes automatisch speichern – nie still verwerfen. Ein geleerter Name ist ungültig: Er
 * bleibt, wie er war, alles andere wird gespeichert. quiet: ohne Ton und Meldung.
 */
export function leaveItem({ quiet = false } = {}) {
  const e = takeEdits();
  if (!hasEdits(e)) return;
  let note = '';
  if ('name' in e.set && !e.set.name && !e.pending) {
    delete e.set.name;
    showField('name', state.shown.name);
    note = 'Der Name bleibt – er darf nicht leer sein.';
  }
  rebaseShown();
  if (!hasEdits(e)) { if (note && !quiet) toast(note); return; }
  // Gleich im Speicher übernehmen, was keine Auflösung braucht – öffnet man den Eintrag sofort
  // wieder, steht dort schon das Neue (Kategorie, Ort und Raum folgen mit dem Neuladen).
  const it = state.items.find(x => x.id === e.id);
  const s = e.set;
  if (it) {
    if (s.name) it.name = s.name;
    for (const [k, f] of [['loc', 'locationDetail'], ['qty', 'quantity'], ['note', 'note']]) if (k in s) it[f] = s[k];
  }
  writeEdits(e)
    .then(async (changed) => {
      if (!changed) return;
      await reloadAll();
      renderCurrent();
      if (!quiet) { sound.play('save'); toast(note ? `Gespeichert. ${note}` : 'Gespeichert.'); }
    })
    .catch((err) => toast('Speichern fehlgeschlagen: ' + err.message, true));
}

export function initExtras() {
  $('#it-out-set').addEventListener('click', () => {
    const it = state.items.find(x => x.id === state.currentId);
    if (it) outSheet([it.id], itemHead(it));
  });
  $('#it-back').addEventListener('click', () => setOut([state.currentId], null));
  $('#it-dup-merge').addEventListener('click', mergeDup);
  $('#it-dup-keep').addEventListener('click', keepDup);
  $('#it-doc-add').addEventListener('click', () => $('#it-doc-input').click());
  $('#it-doc-input').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    addDocs(files).finally(() => { e.target.value = ''; });
  });
  $('#it-docs').addEventListener('click', (e) => {
    const del = e.target.closest('[data-doc-del]');
    if (del) { deleteDoc(del.dataset.docDel); return; }
    const op = e.target.closest('[data-doc]');
    if (op) openDoc(op.dataset.doc);
  });
}

export function initLightbox() {
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
}

export function init() {
  $('#it-place').addEventListener('click', (e) => {
    const next = pickPlace(e, state.itPlace, (id) => { if (id) { state.itPlace = id; followPlace($('#it-room'), id); renderItPlace(); } });
    if (next == null) return;
    state.itPlace = next;
    followPlace($('#it-room'), next);
    renderItPlace();
  });
  $('#item-save').addEventListener('click', saveItem);
  // Die App wandert in den Hintergrund (iOS beendet sie dort womöglich): Geändertes sichern.
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.view === 'item') leaveItem({ quiet: true }); });
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
}
