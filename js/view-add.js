// Ansicht „Hinzufügen“: Schnellerfassung (jedes Foto wird sofort ein Eintrag, erkannt wird im
// Hintergrund) und „Ohne Foto eintragen“.
import * as db from './db.js';
import * as img from './img.js';
import * as ai from './gemini.js';
import * as queue from './queue.js';
import * as sound from './sound.js';
import { haptic } from './gestures.js';
import { placeIcon } from './places.js';
import { $, esc, icon, isThumb, placeholderHTML, plural } from './ui.js';
import { onDataChanged, renderCurrent } from './nav.js';
import { aiBusy, aiNeedsKey, hasKey, placeById, reloadAll, state } from './state.js';
import { toast } from './toast.js';
import { openItem } from './view-item.js';
import { updateStorageInfo } from './view-settings.js';
import { drawPlaceChips, followPlace, pickPlace, resolveWhere } from './where.js';

// Neue Erfassungsrunde: Zähler leeren, gemerkten Ort und Raum vorbelegen.
export function resetCapture() {
  state.capture = { ids: [], busy: state.capture.busy };
  $('#cap-room').value = state.settings.lastRoom || '';
  $('#cap-loc').value = state.settings.lastLoc || '';
  $('#manual').open = false;
  resetManual();
  renderCapWhere();
  capNowSaid = capNowText();   // Ausgangslage – angesagt wird erst eine Änderung
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

// announce: auch dem Screenreader sagen (nur nach einer Wahl – Ort-Chip, Feld verlassen –,
// nicht bei jedem Tastendruck im Raumfeld; dafür ist die Live-Region getrennt).
let capNowSaid = '';
const capNowText = () => $('#cap-now').textContent.replace(/\s+/g, ' ').trim();
function renderCapNow(announce = false) {
  const p = placeById(state.settings.lastPlace);
  const room = $('#cap-room').value.trim();
  const now = $('#cap-now');
  now.innerHTML = !p && !room
    ? '<span class="open">Ort wählen</span> <small>(optional)</small>'
    : (p ? `${placeIcon(p)}<b>${esc(p.name)}</b>` : '') + (room ? `${p ? ' <i>›</i> ' : ''}<b>${esc(room)}</b>` : '');
  const said = capNowText();
  if (announce && said !== capNowSaid) $('#cap-now-live').textContent = `Du bist gerade in: ${said}`;
  if (announce) capNowSaid = said;
}

async function setCapPlace(id) {
  state.settings.lastPlace = id;
  followPlace($('#cap-room'), id);
  renderCapWhere();
  renderCapNow(true);
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
  renderCapNow(true);
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

export function renderCapture() {
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
  if (failed < files.length) { haptic(); sound.play('click'); }   // Foto gespeichert
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
    sound.play('save');
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

export function init() {
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
  $('#cap-room').addEventListener('input', () => renderCapNow());
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
}
