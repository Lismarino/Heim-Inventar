// Ansicht „Alles“: Liste mit Suche und Filtern, Zeichnen in Schüben, KI-Suche, Papierkorb
// (gelöschte Dinge – intern „archive“, Feld `archived`).
import * as ai from './gemini.js';
import * as home from './home.js';
import { norm } from './combo.js';
import { aiDocs, folderPath } from './docs.js';
import { cleanOut, outText, qtyNumber, warrantySoon } from './match.js';
import { placeIcon } from './places.js';
import * as sheet from './sheet.js';
import { $, EMPTY_ART, esc, icon, isThumb, placeholderHTML } from './ui.js';
import { cabinet } from './lazy.js';
import { stepQty, toggleSel } from './select.js';
import { aiBusy, aiNeedsKey, catName, hasKey, multiPlaces, placeName, placeOf, roomName, roomsIn, state, whereOf } from './state.js';
import { toast } from './toast.js';
import { openItem, openPhotoOf } from './view-item.js';
import { keyHint } from './view-settings.js';

// 2.0: ein Filter-Knopf neben der Suche öffnet ein Blatt (Ort, Raum, Kategorie, Status);
// aktive Filter stehen als Chips mit × unter dem Suchfeld.
const flt = { place: '', room: '', cat: '' };
const STATUS = { out: 'Unterwegs/verliehen', unnamed: 'Unbenannt', warranty: 'Garantie läuft bald ab' };

/** Nach dem Laden: Filter auf gelöschte Orte/Räume/Kategorien verwerfen. */
export function refreshPickers() {
  if (flt.place && !state.places.some(p => p.id === flt.place)) flt.place = '';
  if (flt.room && !state.rooms.some(r => r.id === flt.room)) flt.room = '';
  if (flt.cat && !state.cats.some(c => c.id === flt.cat)) flt.cat = '';
}

/** Von „Start“ aus: nur einen Status zeigen, andere Filter zurücksetzen. */
export function showOnly(k) {
  flt.place = flt.room = flt.cat = '';
  state.listFilter = k;
}

const opts = (rows, keep, allLabel) => `<option value="">${allLabel}</option>` +
  rows.map(r => `<option value="${esc(r.id)}"${r.id === keep ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
const roomRows = (pid) => (pid ? roomsIn(pid) : state.rooms)
  .map(r => ({ id: r.id, name: !pid && multiPlaces() ? `${r.name} (${placeName(r.placeId)})` : r.name }));

function openFilterSheet() {
  const many = state.places.length > 1;
  sheet.panel({
    title: 'Filtern',
    submit: 'Fertig',
    html: `${many ? `<label class="field"><span>Ort</span><select id="ff-place">${opts(state.places, flt.place, 'Alle Orte')}</select></label>` : ''}
      <label class="field"><span>Raum</span><select id="ff-room">${opts(roomRows(flt.place), flt.room, 'Alle Räume')}</select></label>
      <label class="field"><span>Kategorie</span><select id="ff-cat">${opts(state.cats, flt.cat, 'Alle Kategorien')}</select></label>
      <label class="field"><span>Status</span><select id="ff-status">${opts(Object.entries(STATUS).map(([id, name]) => ({ id, name })), state.listFilter || '', 'Alle')}</select></label>`,
    onSubmit: () => {
      flt.place = $('#ff-place')?.value || '';
      flt.room = $('#ff-room').value;
      flt.cat = $('#ff-cat').value;
      state.listFilter = $('#ff-status').value || null;
      renderList();
    },
  });
  // Ort gewechselt: nur dessen Räume anbieten.
  $('#ff-place')?.addEventListener('change', (e) => {
    const room = $('#ff-room');
    room.innerHTML = opts(roomRows(e.target.value), room.value, 'Alle Räume');
  });
}

function activeChips() {
  return [
    flt.place && { k: 'place', label: placeName(flt.place) },
    flt.room && { k: 'room', label: roomName(flt.room) },
    flt.cat && { k: 'cat', label: catName(flt.cat) },
    state.listFilter && { k: 'status', label: STATUS[state.listFilter] },
  ].filter(c => c && c.label);
}

function renderChips() {
  const chips = activeChips();
  const box = $('#filters');
  box.hidden = !chips.length;
  box.innerHTML = chips.map(c => `<button type="button" class="flag" data-unfilter="${c.k}" aria-label="Filter ${esc(c.label)} entfernen"><span>${esc(c.label)}</span>${icon('close')}</button>`).join('');
  const n = $('#filter-n');
  n.hidden = !chips.length;
  n.textContent = chips.length || '';
  $('#filter-btn').classList.toggle('on', chips.length > 0);
}

function haystack(it) {
  return [it.name, catName(it.categoryId), placeOf(it)?.name, roomName(it.roomId), it.locationDetail, it.quantity, it.note, it.serial, outText(it)]
    .filter(Boolean).join(' ');
}

/** Wird gerade gesucht oder gefiltert? */
const filtering = () => !!(state.listFilter || $('#q').value.trim() || flt.cat || flt.place || flt.room);

function visibleItems() {
  const q = norm($('#q').value);
  const { cat, place, room } = flt;
  return state.items
    .filter(i => !i.archived)
    .filter(i => !place || placeOf(i)?.id === place)
    .filter(i => !cat || i.categoryId === cat)
    .filter(i => !room || i.roomId === room)
    .filter(i => state.listFilter !== 'unnamed' || home.isUnnamed(i))
    .filter(i => state.listFilter !== 'out' || !!cleanOut(i.out))
    .filter(i => state.listFilter !== 'warranty' || warrantySoon(i))
    .filter(i => !q || norm(haystack(i)).includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// opts.inRoom: in der Raum-Ansicht Ort und Raum weglassen; opts.noCat: Kategorie steht schon darüber.
// Wo: „Auto · Kofferraum · Regal 2“ mit dem Symbol des Orts.
let qtyOpen = null;   // Zeile, deren Bestand gerade + / − zeigt
export function rowHTML(it, why, opts = {}) {
  const thumb = isThumb(it.thumb)
    ? `<img class="thumb" src="${esc(it.thumb)}" alt="" loading="lazy" decoding="async">`
    : placeholderHTML(it, 'thumb');
  
  const p = opts.inRoom ? null : placeOf(it);
  const place = [opts.inRoom ? '' : whereOf(it, ' · '), it.locationDetail].filter(Boolean).join(' · ');
  // Kategorie-Etikett nur, wenn kein Ort dasteht (Zeile: Name / Ort / Bestand) und es nicht ohnehin
  // feststeht (Raum-Gruppe nach Kategorie, Kategorie-Filter).
  const cat = place || opts.noCat || flt.cat ? '' : catName(it.categoryId);
  const out = outText(it);
  const qn = !it.archived && !state.sel && !opts.noStep ? qtyNumber(it.quantity) : null;
  // + / − nur bei einer Zahl und erst nach einem Tipp auf die Zahl (2.0) – so bleibt der Ort lesbar.
  // Als <span role="button">, weil die Zeile selbst ein Knopf ist.
  const qty = qn != null
    ? `<span class="qty-step${qtyOpen === it.id ? ' open' : ''}"><span class="qs" role="button" data-step="-1" aria-label="Bestand verringern">−</span><span class="qty" role="button" data-qty aria-label="Bestand ${qn} – ändern">${qn}</span><span class="qs" role="button" data-step="1" aria-label="Bestand erhöhen">+</span></span>`
    : it.quantity ? `<span class="qty">${esc(it.quantity)}</span>` : '';
  const selOn = state.sel && !it.archived;
  const title = aiBusy(it)
    ? `<div class="name pending"><span class="spin"></span>${esc(it.name || 'wird erkannt …')}</div>`
    : it.name
      ? `<div class="name">${esc(it.name)}</div>`
      : aiNeedsKey(it)
        ? '<div class="name unnamed">Wartet auf API-Key</div>'
        : '<div class="name unnamed">Unbenannt</div>';
  return `<button type="button" class="row${aiBusy(it) ? ' is-pending' : ''}${selOn ? ' selecting' : ''}${selOn && state.sel.has(it.id) ? ' sel-on' : ''}" data-id="${esc(it.id)}"${selOn ? ` aria-pressed="${state.sel.has(it.id)}"` : ''}>
    ${selOn ? `<span class="row-check" aria-hidden="true">${icon('check')}</span>` : ''}${thumb}
    <div class="body">
      ${title}
      <div class="meta">${cat ? `<span class="tag">${esc(cat)}</span>` : ''}${place ? `<span class="place">${p ? placeIcon(p) : icon('pin')}<span>${esc(place)}</span></span>` : ''}${qn == null ? qty : ''}</div>
      ${out ? `<div class="out-tag">${icon('out')}<span>${esc(out)}</span></div>` : ''}${it.dupOf && !it.archived ? '<div class="dup-tag">Ähnlicher Eintrag schon vorhanden</div>' : ''}
      ${why ? `<div class="why">${esc(why)}</div>` : ''}
    </div>${qn != null ? qty : ''}
  </button>`;
}

/* ---------------- Zeichnen in Schüben (1.10.0) ----------------
 * Lange Listen: die ersten Zeilen sofort, weitere erst, wenn man in ihre Nähe scrollt – ein
 * unsichtbarer Wächter (IntersectionObserver) unter der Liste holt jeweils den nächsten Schub.
 * Die Gesten (Wischen, langes Drücken, Auswahl) hängen an der Liste, nicht an den Zeilen. */
const ROWS_FIRST = 50;
const ROWS_STEP = 60;
const ROW_EST = 64;   // eher knapp geschätzte Zeilenhöhe – lieber ein paar Zeilen zu viel sofort
const rowJobs = new WeakMap();   // Liste -> { rows, at, toHTML, more }
// Ein Wächter je Scroll-Bereich: ohne eigenen root schneidet der Scroll-Container den
// Vorlauf (rootMargin) ab – dann kam der nächste Schub erst, wenn das Listenende schon im Bild war.
const moreObservers = new Map();   // Scroll-Container (oder null = Fenster) -> IntersectionObserver
function observerFor(box) {
  const root = box.closest('.scroll') || null;
  let o = moreObservers.get(root);
  if (!o) {
    o = new IntersectionObserver(onMore, { root, rootMargin: '0px 0px 1600px 0px' });
    moreObservers.set(root, o);
  }
  return o;
}
function onMore(entries, moreObserver) {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const box = e.target.previousElementSibling;
    const job = box && rowJobs.get(box);
    if (!job || job.at >= job.rows.length) continue;
    box.insertAdjacentHTML('beforeend', job.rows.slice(job.at, job.at + ROWS_STEP).map(job.toHTML).join(''));
    job.at += ROWS_STEP;
    // Steht der Wächter danach immer noch im Blick, meldet der Observer das nicht erneut – neu beobachten.
    moreObserver.unobserve(e.target);
    if (job.at < job.rows.length) moreObserver.observe(e.target);
  }
}
/** rows in box zeichnen; mindestens so viele sofort, dass die Stelle `keepY` (Scroll-Position) gefüllt ist. */
function drawRows(box, rows, toHTML, keepY = 0) {
  const first = Math.max(ROWS_FIRST, Math.ceil((keepY + 1200) / ROW_EST));
  box.innerHTML = rows.slice(0, first).map(toHTML).join('');
  let more = box.nextElementSibling;
  if (!more || !more.classList.contains('rows-more')) {
    more = document.createElement('div');
    more.className = 'rows-more';
    more.setAttribute('aria-hidden', 'true');
    box.after(more);
  }
  rowJobs.set(box, { rows, at: first, toHTML });
  if (!('IntersectionObserver' in window)) {   // sehr alte Browser: dann eben alles auf einmal
    box.insertAdjacentHTML('beforeend', rows.slice(first).map(toHTML).join(''));
    return;
  }
  const o = observerFor(box);
  o.unobserve(more);
  if (first < rows.length) o.observe(more);
}

// „Alles“ nur neu aufbauen, wenn sich etwas geändert hat, das in den Zeilen steht –
// sonst ist ein Tab-Wechsel zurück zu „Alles“ fast kostenlos.
let listSig = '';
const itemSig = (it) => [it.id, it.updatedAt, it.createdAt, it.name, it.quantity, it.aiState, it.roomId, it.placeId, it.categoryId,
  it.locationDetail, it.dupOf, it.archived, it.thumb ? it.thumb.length : 0, outText(it)].join('\u0001');
const listContextSig = () => [
  state.cats.map(c => c.id + c.name).join(), state.rooms.map(r => r.id + r.name + r.placeId).join(),
  state.places.map(p => p.id + p.name + p.icon + p.color).join(), hasKey(), state.listFilter, flt.cat, state.sel ? [...state.sel].join() : '-',
].join('\u0002');

export function renderList() {
  if (state.aiSearch) { renderAiResult(); return; }
  $('#ai-answer').hidden = true;
  renderChips();
  const rows = visibleItems();
  const total = state.items.filter(i => !i.archived).length;
  const sig = listContextSig() + '\u0003' + rows.map(itemSig).join('\u0004');
  if (sig !== listSig) {
    listSig = sig;
    const sc = $('#view-list .scroll');
    drawRows($('#list'), rows, (it) => rowHTML(it), Math.max(sc?.scrollTop || 0, state.view === 'list' ? 0 : state.scrollPos.list || 0));
  }
  // Papierkorb am Ende – nicht, solange gefiltert oder gesucht wird.
  const trash = state.items.filter(i => i.archived).length;
  $('#list-archive').hidden = !trash || filtering();
  $('#list-archive-txt').textContent = `Papierkorb (${trash})`;
  // „11 von 61“ unter dem Suchfeld – nur, wenn gesucht oder gefiltert wird.
  const hits = $('#list-hits');
  hits.hidden = !total || !filtering();
  hits.textContent = `${rows.length} von ${total}`;
  const empty = $('#list-empty');
  empty.hidden = rows.length > 0;
  empty.classList.toggle('first', total === 0);
  empty.innerHTML = total === 0
    ? `${EMPTY_ART}<p><strong>Noch nichts erfasst</strong>Tippe unten auf die Kamera und fotografiere, was du aufbewahrst – Stück für Stück.</p>`
    : state.listFilter === 'unnamed' && !$('#q').value.trim()
      ? `<span class="empty-badge">${icon('check')}</span><p>Alles hat einen Namen.</p>`
      : state.listFilter === 'out' && !$('#q').value.trim()
        ? `<span class="empty-badge">${icon('check')}</span><p>Alles ist wieder da.</p>`
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
  $('#filter-n').hidden = true;
  $('#list-hits').hidden = true;
  $('#ai-answer').hidden = false;
  $('#ai-answer-q').textContent = a.question;
  $('#ai-answer-text').textContent = a.answer || 'Keine Antwort erhalten.';
  const docs = (a.docs || []).filter(m => m.doc);
  listSig = '';   // die Liste zeigt jetzt etwas anderes
  rowJobs.delete($('#list'));
  $('#list-archive').hidden = true;
  $('#list').innerHTML = matches.map(m => rowHTML(m.item, m.why)).join('')
    + docs.map(m => `<button type="button" class="row drow" data-doc-hit="${esc(m.doc.id)}"><span class="d-ic">${icon('doc')}</span>`
      + `<span class="body"><span class="name">${esc(m.doc.name)}</span><span class="meta">${esc(folderPath(m.doc.folderId) || 'Dokumente')}</span>`
      + `${m.why ? `<span class="why">${esc(m.why)}</span>` : ''}</span></button>`).join('');
  const empty = $('#list-empty');
  empty.hidden = matches.length + docs.length > 0;
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
    keyHint('Für die KI-Suche brauchst du einen API-Key in den Einstellungen.');
    return;
  }
  const pool = state.items.filter(i => !i.archived);
  // Dokumente: NUR Titel, Ordnerpfad, Stichworte, Datum (aiDocs → docsForAi) – nie Inhalte.
  const docs = aiDocs();
  if (!pool.length && !docs.list.length) { toast('Es ist noch nichts erfasst.', true); return; }

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
      status: outText(it),
      note: it.note,
    }));
    const docEntries = docs.entries.map(d => ({ ...d, n: pool.length + d.n }));
    const res = await ai.searchInventory(state.settings, question, entries, docEntries);
    // Nur Nummern übernehmen, die es wirklich gibt – gegen erfundene Treffer.
    const seen = new Set();
    const matches = [];
    const docHits = [];
    for (const m of res.matches) {
      if (m.n < 1 || m.n > pool.length + docs.list.length || seen.has(m.n)) continue;
      seen.add(m.n);
      if (m.n <= pool.length) matches.push({ item: pool[m.n - 1], why: m.why });
      else docHits.push({ doc: docs.list[m.n - pool.length - 1], why: m.why });
    }
    state.aiSearch = { question, answer: res.answer, matches, docs: docHits };
    renderList();
    updateAskButton();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Stattdessen die KI fragen';
  }
}

export function renderArchive() {
  const rows = state.items.filter(i => i.archived).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  drawRows($('#arch-list'), rows, (it) => rowHTML(it), state.scrollPos.archive || 0);
  $('#arch-empty').hidden = rows.length > 0;
}

// Suchfeld leeren (auch ein KI-Ergebnis verwerfen).
export function clearSearch() {
  state.aiSearch = null;
  $('#q').value = '';
  updateAskButton();
}

export function init() {
  // Tippen verwirft ein KI-Ergebnis – es passt dann nicht mehr zur Eingabe.
  $('#q').addEventListener('input', () => {
    if (state.aiSearch) state.aiSearch = null;
    renderList();
    updateAskButton();
  });
  $('#filter-btn').addEventListener('click', openFilterSheet);
  $('#ai-search').addEventListener('click', runAiSearch);
  $('#ai-clear').addEventListener('click', clearAiSearch);
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !state.aiSearch && $('#q').value.trim().length >= 3) runAiSearch();
  });

  // Tipp auf das Vorschaubild zeigt das Foto groß, Tipp auf den Rest öffnet den Eintrag.
  const rowClick = (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    if (row.dataset.docHit) { cabinet().then((c) => c.docSheet(row.dataset.docHit)).catch((e) => toast(e.message, true)); return; }
    if (state.sel && !row.closest('#arch-list')) { toggleSel(row.dataset.id); return; }
    const step = e.target.closest('[data-step]');
    if (step) { stepQty(row.dataset.id, Number(step.dataset.step)); return; }
    if (e.target.closest('[data-qty]')) {
      const box = e.target.closest('.qty-step');
      document.querySelectorAll('.qty-step.open').forEach((b) => { if (b !== box) b.classList.remove('open'); });
      box.classList.toggle('open');
      qtyOpen = box.classList.contains('open') ? row.dataset.id : null;
      return;
    }
    if (e.target.matches('img.thumb')) { openPhotoOf(row.dataset.id); return; }
    openItem(row.dataset.id);
  };
  $('#list').addEventListener('click', rowClick);
  $('#arch-list').addEventListener('click', rowClick);
  $('#room-list').addEventListener('click', rowClick);
  $('#filters').addEventListener('click', (e) => {
    const k = e.target.closest('[data-unfilter]')?.dataset.unfilter;
    if (!k) return;
    if (k === 'status') state.listFilter = null;
    else flt[k] = '';
    if (k === 'place') flt.room = '';
    renderList();
  });
}
