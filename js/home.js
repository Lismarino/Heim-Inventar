// Startseite und die Ansicht eines Raums (oder eines Orts). Die Daten kommen aus app.js (ctx) –
// hier wird nur gezeichnet. Start (2.0): Begrüßung, Umschalter „Alle · Zuhause · Auto …“ (ab zwei
// Orten, gemerkt in homePlace), Suche, eine Karte „Wichtig“, „Zuletzt hinzugefügt“. Der Tab
// „Orte“ steht in js/view-orte.js.
import * as db from './db.js';
import * as img from './img.js';
import { esc, icon, plural, isThumb, placeholderHTML, EMPTY_ART } from './ui.js';
import { placeIcon } from './places.js';
import { moveLens } from './glass.js';
import { cleanOut, warrantySoon, daysSince, daysUntil } from './match.js';

const $ = (s) => document.querySelector(s);
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

// { state, catName, roomName, roomById, placeById, placeOf, hasRoom, aiBusy, aiNeedsKey,
//   rowHTML, noRoomItems (= ohne Ort), whereShort, queueNote }
let ctx = null;

export function init(c) { ctx = c; }

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 11) return 'Guten Morgen';
  if (h >= 11 && h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

const live = () => ctx.state.items.filter(i => !i.archived);
const unnamed = (it) => !String(it.name || '').trim() && it.aiState !== 'pending';

export const isUnnamed = unnamed;

/* ---------------- Titelbilder ----------------
   Die gespeicherten Vorschaubilder haben nur 160 px – für große Kacheln zu unscharf.
   Deshalb aus dem Original einmal eine 480-px-Fassung machen und für die Sitzung
   merken. Bis sie da ist, steht das kleine Vorschaubild da. Dekodiert wird nur für
   Kacheln, die gerade (fast) im Bild sind und in einer sichtbaren Ansicht liegen –
   dafür beobachtet ein IntersectionObserver die Bilder. */

const covers = new Map();    // photoId -> Object-URL | Promise
const COVER_MAX = 60;
let coverChain = Promise.resolve();

function coverURL(photoId) {
  const c = covers.get(photoId);
  return typeof c === 'string' ? c : null;
}

// Liegt das Bild in einer Ansicht, die man gerade sieht? (Versteckte Ansichten bleiben
// im Layout und würden sonst als „im Bild“ gelten.)
const onScreen = (el) => el.isConnected && !el.closest('.view[hidden]');

let io = null;
function observer() {
  if (io || typeof IntersectionObserver !== 'function') return io;
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || !onScreen(e.target)) continue;
      io.unobserve(e.target);
      watched.delete(e.target);
      wantCover(e.target.dataset.cover);
    }
  }, { rootMargin: '240px 0px' });
  return io;
}

// Nach dem Zeichnen: Bilder ohne scharfe Fassung beobachten, verwaiste URLs freigeben.
const watched = new Set();
function watchCovers(root) {
  const obs = observer();
  for (const el of watched) if (!el.isConnected) { obs?.unobserve(el); watched.delete(el); }
  for (const el of root.querySelectorAll('img[data-cover]')) {
    if (coverURL(el.dataset.cover)) continue;
    if (obs) { obs.observe(el); watched.add(el); }
    else if (onScreen(el)) wantCover(el.dataset.cover);   // sehr alte Browser: gleich laden
  }
  pruneCovers();
}

// Scharfe Fassungen, die keine Kachel mehr zeigt (Raum gelöscht, Eintrag archiviert
// oder nicht mehr unter den neuesten), gleich freigeben statt sie bis COVER_MAX zu horten.
function pruneCovers() {
  const used = new Set([...document.querySelectorAll('img[data-cover]')].map(el => el.dataset.cover));
  for (const [id, v] of covers) {
    if (typeof v !== 'string' || used.has(id)) continue;
    URL.revokeObjectURL(v);
    covers.delete(id);
  }
}

function wantCover(photoId) {
  if (!photoId || covers.has(photoId)) return;
  const job = coverChain.then(async () => {
    let src = null;
    try {
      // Inzwischen weggescrollt, neu gezeichnet oder die Ansicht verlassen: nicht dekodieren.
      const want = [...document.querySelectorAll(`img[data-cover="${CSS.escape(photoId)}"]`)].some(onScreen);
      if (!want) { covers.delete(photoId); return; }
      const photo = await db.get('photos', photoId);
      if (!photo) { covers.delete(photoId); return; }
      src = await img.decode(new Blob([photo.buf], { type: photo.type || 'image/jpeg' }));
      const blob = await img.toBlob(src, 480, 0.8);
      const url = URL.createObjectURL(blob);
      covers.set(photoId, url);
      trimCovers();
      for (const el of document.querySelectorAll(`img[data-cover="${CSS.escape(photoId)}"]`)) {
        el.src = url;
        io?.unobserve(el);
        watched.delete(el);
      }
    } catch (e) {
      covers.delete(photoId);
      console.warn('Titelbild:', e);
    } finally {
      img.release(src);
    }
  });
  covers.set(photoId, job);
  coverChain = job.catch(() => null);
}

function trimCovers() {
  if (covers.size <= COVER_MAX) return;
  for (const [id, v] of covers) {
    if (covers.size <= COVER_MAX) break;
    if (typeof v !== 'string' || document.querySelector(`img[data-cover="${CSS.escape(id)}"]`)) continue;
    URL.revokeObjectURL(v);
    covers.delete(id);
  }
}

// Bild für eine Kachel: scharfe Fassung, falls schon da, sonst das Vorschaubild.
// Die scharfe Fassung bestellt erst watchCovers(), sobald die Kachel zu sehen ist.
function pictureHTML(it, cls) {
  if (!isThumb(it.thumb)) return '';
  const sharp = it.photoId ? coverURL(it.photoId) : null;
  return `<img class="${cls}" src="${esc(sharp || it.thumb)}" alt=""${it.photoId ? ` data-cover="${esc(it.photoId)}"` : ''} draggable="false">`;
}

/* ---------------- Start ---------------- */

const multi = () => ctx.state.places.length > 1;
const inPlace = (pid) => (it) => ctx.placeOf(it)?.id === pid;
/** Einträge, die direkt am Ort liegen – ohne (gültigen) Raum. */
export const directItems = (pid) => live().filter(it => !ctx.hasRoom(it) && it.placeId === pid && ctx.placeById(pid));

/** Gewählter Ort im Umschalter – '' für alle (auch wenn der gemerkte Ort nicht mehr existiert
 *  oder es nur noch einen Ort gibt – dann gibt es keinen Umschalter). */
export function homePlace() {
  const id = ctx.state.settings.homePlace || '';
  return id && multi() && ctx.placeById(id) ? id : '';
}

/* ---------------- Umschalter ---------------- */

// Erst ab zwei Orten gibt es etwas umzuschalten. Orte angelegt werden im Tab „Orte“ (2.0: kein „+“ mehr hier).
function renderSwitch(pid) {
  const box = $('#home-places');
  const places = ctx.state.places;
  box.hidden = places.length < 2;
  if (box.hidden) return;
  const track = box.querySelector('.pswitch-track');
  const sig = places.map(p => [p.id, p.name, p.icon, p.color].join('\u0001')).join('\u0002');
  const fresh = box.dataset.sig !== sig;
  if (fresh) {
    box.dataset.sig = sig;
    track.innerHTML = '<span class="lens" aria-hidden="true"></span>'
      + '<button type="button" class="pseg" data-home-place=""><span>Alle</span></button>'
      + places.map(p => `<button type="button" class="pseg" data-home-place="${esc(p.id)}">${placeIcon(p)}<span>${esc(p.name)}</span></button>`).join('');
  }
  let active = null;
  for (const b of track.querySelectorAll('[data-home-place]')) {
    const on = b.dataset.homePlace === pid;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    if (on) active = b;
  }
  moveLens(track.querySelector('.lens'), active, { instant: fresh });
  if (fresh) revealSwitch(false);   // gemerkten Ort gleich ins Bild holen (viele Orte)
}

/** Nach dem Wechsel: den gewählten Ort in den sichtbaren Bereich des Umschalters holen. */
export function revealSwitch(smooth) {
  const b = document.querySelector('#home-places .pseg.on');
  const box = $('#home-places');
  if (!b || !box) return;
  const l = b.offsetLeft - 16, r = b.offsetLeft + b.offsetWidth + 16 - box.clientWidth;
  const to = box.scrollLeft > l ? l : box.scrollLeft < r ? r : null;
  if (to != null) box.scrollTo({ left: Math.max(0, to), behavior: smooth ? 'smooth' : 'auto' });
}

export function renderHome() {
  const all = live();
  const pid = homePlace();
  const items = pid ? all.filter(inPlace(pid)) : all;

  $('#home-date').textContent = dayFmt.format(new Date());
  $('#home-hello').textContent = greeting();
  renderSwitch(pid);
  const used = new Set(items.map(it => (ctx.hasRoom(it) ? it.roomId : null)).filter(Boolean)).size;
  const usedPlaces = new Set(all.map(it => ctx.placeOf(it)?.id).filter(Boolean)).size;
  const n = `<span class="n">${plural(items.length, 'Ding', 'Dinge')}</span> `;
  $('#home-sum').innerHTML = !all.length
    ? '<span class="n">Willkommen</span> <span class="in">zu Hause</span>'
    : pid && !items.length
      ? `<span class="n">Noch leer</span> <span class="in">– hier liegt noch nichts</span>`
      : pid
        ? n + (used ? `<span class="in">in ${plural(used, 'Raum', 'Räumen')}</span>` : '<span class="in">direkt hier</span>')
        : multi()
          ? n + (usedPlaces ? `<span class="in">an ${plural(usedPlaces, 'Ort', 'Orten')}</span>` : '<span class="in">noch ohne Ort</span>')
          : n + (used ? `<span class="in">in ${plural(used, 'Raum', 'Räumen')}</span>` : '<span class="in">noch ohne Raum</span>');

  // Wichtig (2.0): eine Karte, höchstens drei Zeilen – die dringendsten zuerst; „Alle anzeigen“ für den Rest.
  const rows = importantRows(items, all.length);
  const todo = $('#home-todo');
  todo.hidden = !rows.length;
  todo.innerHTML = rows.length
    ? `<h2 class="todo-title" id="home-todo-title">Wichtig</h2>${rows.slice(0, HOME_TODO).map(r => r.html).join('')}`
      + (rows.length > HOME_TODO ? `<button type="button" class="todo-more" data-todo-all>Alle anzeigen<span>${rows.length}</span>${icon('chev-r', 'go')}</button>` : '')
    : '';
  renderSync();

  // Leer: freundlicher Einstieg statt leerer Streifen
  const empty = !all.length;
  $('#home-empty').hidden = !empty;
  if (empty && !$('#home-empty').innerHTML) {
    $('#home-empty').innerHTML = `${EMPTY_ART}
      <strong>Noch nichts erfasst</strong>
      <p>Fotografiere, was du aufbewahrst. Die App erkennt, was drauf ist, und merkt sich, wo es liegt.</p>
      <button class="cap-btn cam home-cta" data-nav="add">
        <span class="cap-ic">${icon('camera')}</span>
        <span class="cap-txt"><b>Erstes Foto aufnehmen</b><small>Stück für Stück, Raum für Raum</small></span>
      </button>`;
  }

  // Zuletzt hinzugefügt
  const recent = items.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 14);
  $('#home-recent-sec').hidden = !items.length;
  $('#home-recent').innerHTML = recent.map(recentTile).join('');
  watchCovers($('#view-home'));
}

/* ---------------- Wichtig ---------------- */

/** Höchstens so viele Zeilen stehen auf Start; „Alle anzeigen“ öffnet ein Blatt mit allen. */
const HOME_TODO = 3;

const dueDay = (n) => (n === 0 ? 'heute' : n === 1 ? 'morgen' : n < 0 ? 'vorbei' : `in ${n} Tagen`);
// Dringlichkeit einer Frist: bis 14 Tage ganz oben (je näher, desto höher), danach weit unten.
const dueScore = (days) => (days <= 14 ? 100 - Math.max(0, days) : 45 - days / 30);

/**
 * Alle Zeilen für „Wichtig“, nach Dringlichkeit sortiert: [{ key, score, html }].
 * pool: Einträge des gewählten Orts (ohne Ort zählt immer alle), n: Zahl aller Einträge (Sicherung).
 */
function importantRows(pool, n) {
  const rows = [];
  const add = (key, score, html) => rows.push({ key, score, html });
  const nr = ctx.noRoomItems().length;
  const un = pool.filter(unnamed).length;
  const busy = pool.filter(ctx.aiBusy).length;
  const needKey = pool.filter(ctx.aiNeedsKey).length;
  const out = pool.filter(it => !!cleanOut(it.out));
  if (nr) add('noroom', 60, todoRow('noroom', 'pin', 'clay', `${plural(nr, 'Ding', 'Dinge')} ohne Ort`, 'Gesammelt einem Ort zuordnen'));
  if (un) add('unnamed', 50, todoRow('unnamed', 'pencil', 'clay', `${un} unbenannt`, 'Antippen und selbst benennen'));
  if (out.length) {
    const names = out.map(it => String(it.name || '').trim() || 'Unbenannt');
    add('out', 40, todoRow('out', 'out', 'calm', `${out.length} unterwegs oder verliehen`, names.slice(0, 3).join(', ') + (names.length > 3 ? ' …' : '')));
  }
  if (needKey) add('needkey', 35, todoRow('needkey', 'sparkle', 'clay', `${needKey} ${needKey === 1 ? 'wartet' : 'warten'} auf API-Key`, 'Key in den Einstellungen eintragen'));
  if (busy) add('busy', 5, todoRow('busy', '', 'busy', `${busy} ${busy === 1 ? 'wird' : 'werden'} erkannt`, ctx.queueNote() || 'Die KI benennt sie im Hintergrund.'));
  // Garantien (Einträge) und Fristen (Dokumente) – jede eigene Zeile mit Namen.
  for (const it of pool.filter(warrantySoon)) {
    const d = daysUntil(it.warrantyUntil);
    add('warranty', dueScore(d), `<button class="todo-row" data-todo-item="${esc(it.id)}">
      <span class="todo-ic ${d <= 14 ? 'clay' : 'calm'}">${icon('doc')}</span>
      <span class="todo-txt"><b>Garantie: ${esc(String(it.name || '').trim() || 'Unbenannt')}</b><small>${esc(`Läuft ${dueDay(d)} ab`)}</small></span>
      ${icon('chev-r', 'go')}</button>`);
  }
  for (const d of (ctx.docsDue ? ctx.docsDue() : [])) {
    add('due', dueScore(d.days), `<button class="todo-row" data-due-doc="${esc(d.id)}">
      <span class="todo-ic ${d.days <= 14 ? 'clay' : 'calm'}">${icon('doc')}</span>
      <span class="todo-txt"><b>${esc(d.title)}</b><small>${esc(`${d.kind} ${dueDay(d.days)}`)}</small></span>
      ${icon('chev-r', 'go')}</button>`);
  }
  const bk = backupRow(n);
  if (bk) add('backup', bk.score, bk.html);
  return rows.sort((a, b) => b.score - a.score);
}

/** Alle Zeilen von „Wichtig“ als HTML (für das Blatt „Alle anzeigen“). */
export function importantAllHTML() {
  const all = live();
  const pid = homePlace();
  return importantRows(pid ? all.filter(inPlace(pid)) : all, all.length).map(r => r.html).join('');
}

/** Statuszeile der Google-Drive-Sicherung (nur wenn eingerichtet). */
export function renderSync() {
  const el = $('#home-sync');
  if (!el || !ctx.syncText) return;
  const text = ctx.syncText();
  const x = ctx.syncState();
  el.hidden = !text;
  if (!text) return;
  const warn = x.state === 'error' || x.state === 'needAuth' || x.state === 'needPassword';
  el.className = 'home-sync' + (warn ? ' warn' : x.state === 'syncing' ? ' busy' : '');
  el.innerHTML = `${x.state === 'syncing' ? '<span class="spin"></span>' : icon(warn ? 'alert' : 'cloud')}<span>${esc(text)}</span>`;
}

// Sicherung als Zeile in „Wichtig“: ab 7 Tagen seit der letzten Sicherung – oder nie gesichert,
// sobald 10 Einträge da sind. „Später“ (backupSnooze) blendet sie 3 Tage aus. Die Google-Drive-
// Sicherung (1.9.0) zählt mit. Während sie entsteht oder fertig zum Teilen ist, steht sie ganz oben.
function backupRow(n) {
  const s = ctx.state.settings;
  const st = ctx.backupState();
  const last = Math.max(Number(s.lastBackupAt) || 0, s.gdEnabled ? Number(s.gdLastSync) || 0 : 0);
  const days = last ? daysSince(last) : 0;
  const due = Date.now() >= (Number(s.backupSnooze) || 0) && (last ? days >= 7 : n >= 10);
  if (!due && !st) return null;
  const title = st === 'ready' ? 'Sicherung ist fertig' : last ? `Letzte Sicherung vor ${plural(days, 'Tag', 'Tagen')}` : 'Noch keine Sicherung';
  const sub = st === 'building' ? 'Wird erstellt …' : st === 'ready' ? 'Antippen zum Teilen – z. B. in „Dateien“' : 'Antippen: jetzt sichern';
  const ic = st === 'building' ? '<span class="spin"></span>' : icon(st === 'ready' ? 'share' : 'lock');
  return {
    score: st ? 99 : last ? 55 : 70,
    html: `<div class="todo-row todo-split">
      <button type="button" class="todo-hit" data-backup="go"${st === 'building' ? ' disabled' : ''}>
        <span class="todo-ic ${st ? 'busy' : 'clay'}">${ic}</span>
        <span class="todo-txt"><b>${esc(title)}</b><small>${esc(sub)}</small></span></button>
      ${st ? '' : '<button type="button" class="todo-later" data-backup="later">Später</button>'}</div>`,
  };
}

function todoRow(kind, ic, tone, title, sub) {
  const badge = tone === 'busy' ? '<span class="spin"></span>' : icon(ic);
  return `<button class="todo-row" data-todo="${kind}">
    <span class="todo-ic ${tone}">${badge}</span>
    <span class="todo-txt"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
    ${icon('chev-r', 'go')}
  </button>`;
}

function recentTile(it) {
  const wait = ctx.aiBusy(it);
  const pic = pictureHTML(it, 'rtile-pic') || placeholderHTML(it, 'rtile-pic');
  const name = it.name || (wait ? 'wird erkannt …' : ctx.aiNeedsKey(it) ? 'Wartet auf Key' : 'Unbenannt');
  const p = ctx.placeOf(it);
  const where = ctx.whereShort(it) || 'Ohne Ort';
  return `<button class="rtile${wait ? ' pending' : ''}${!it.name ? ' unnamed' : ''}" data-id="${esc(it.id)}" aria-label="${esc(name)}">
    <span class="rtile-img">${pic}${wait ? '<span class="spin"></span>' : ''}</span>
    <span class="rtile-name">${esc(name)}</span>
    <span class="rtile-room">${p && multi() ? placeIcon(p) : ''}<span>${esc(where)}</span></span>
  </button>`;
}

/* ---------------- Raum (oder Ort ohne Raum) ---------------- */

export function roomItems(roomId) {
  return live().filter(i => i.roomId === roomId);
}

/**
 * Einträge nach Kategorie gruppiert, innerhalb alphabetisch; Unbenanntes ans Ende.
 * roomId: ein Raum. Ohne roomId, aber mit placeId: was direkt am Ort liegt (ohne Raum).
 */
export function renderRoom(roomId, placeId) {
  const room = roomId ? ctx.roomById(roomId) : null;
  const place = room ? ctx.placeById(room.placeId) : (!roomId ? ctx.placeById(placeId) : null);
  if (!room && !place) return false;
  const items = room ? roomItems(room.id) : directItems(place.id);
  const title = room ? room.name : place.name;
  $('#room-title').textContent = title;
  $('#room-bar-title').textContent = title;
  // Über dem Titel: der Ort des Raums (nur bei mehreren Orten) bzw. „ohne Raum“ beim Ort selbst.
  const crumb = $('#room-crumb');
  crumb.hidden = !(place && (!room || multi()));
  crumb.innerHTML = place ? `${placeIcon(place)}<span>${esc(room ? place.name : 'Direkt hier, ohne Raum')}</span>` : '';
  $('#room-menu').setAttribute('aria-label', room ? 'Raum-Aktionen' : 'Ort-Aktionen');
  // Checkliste des Orts: am Ort selbst immer, im Raum nur, wenn es schon eine gibt.
  const ck = place ? ctx.checkCount(place.id) : 0;
  const cb = $('#room-check');
  cb.hidden = !place || (room && !ck);
  cb.dataset.place = place ? place.id : '';
  cb.querySelector('span').textContent = ck ? `Checkliste · ${ck}` : 'Checkliste';
  const groups = new Map();
  for (const it of items) {
    const cat = ctx.catName(it.categoryId);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  }
  const named = groups.size - (groups.has('') ? 1 : 0);
  $('#room-sub').textContent = items.length
    ? plural(items.length, 'Ding', 'Dinge') + (named ? ` · ${plural(named, 'Kategorie', 'Kategorien')}` : '')
    : room ? 'Hier liegt noch nichts.' : 'Hier liegt nichts direkt, ohne Raum.';
  const byName = (a, b) => {
    if (!a.name !== !b.name) return a.name ? -1 : 1;
    return collator.compare(a.name || '', b.name || '') || b.createdAt - a.createdAt;
  };
  const keys = [...groups.keys()].sort((a, b) => (!a) - (!b) || collator.compare(a, b));
  const grouped = keys.length > 1;
  $('#room-list').innerHTML = keys.map((k) => {
    const rows = groups.get(k).sort(byName).map(it => ctx.rowHTML(it, { inRoom: true, noCat: grouped })).join('');
    const head = grouped ? `<h3 class="sec grp">${esc(k || 'Ohne Kategorie')}<span>${groups.get(k).length}</span></h3>` : '';
    return `${head}<div class="list">${rows}</div>`;
  }).join('');
  const empty = $('#room-empty');
  empty.hidden = items.length > 0;
  empty.querySelector('p').textContent = room
    ? 'Noch nichts in diesem Raum. Fotografiere, was hier steht – es landet gleich richtig.'
    : 'Hier liegt nichts direkt am Ort. Fotografiere, was hier ohne Raum liegt – oder leg Räume an.';
  return true;
}
