// Begrüßung beim ersten Start: vier Seiten – Willkommen, Orte („Wo hast du Sachen?“),
// Räume je Ort, KI-Schlüssel. Erscheint nur, solange die Einstellung „onboarded“ fehlt UND
// es keine Spur einer Einrichtung gibt (Einträge, Räume, Orte, API-Key oder gemerkter Raum).
// „Überspringen“ und Escape übernehmen nichts von dem, was in der Einführung gewählt wurde.
import * as db from './db.js';
import { esc, icon, modal, trapTab } from './ui.js';
import { reduced } from './motion.js';
import { haptic } from './gestures.js';
import { PLACE_SUGGESTIONS, DEFAULT_PLACE, suggestIcon, safeIcon, roomSuggestions } from './places.js';

// Raumvorschläge für ein Zuhause (bleibt als Export für ältere Aufrufer).
export const ROOM_SUGGESTIONS = roomSuggestions('haus');

const LAST = 3;   // Index der letzten Seite (KI-Schlüssel)
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const key = (s) => String(s || '').trim().toLocaleLowerCase('de-DE');
const clip = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 40);

let ctx = null;              // { places(), rooms(), apiKey(), done({ key, goAdd, skipped }) }
let places = new Map();      // gewählte Orte: Schlüssel -> { name, icon } (Reihenfolge = Wahl)
let placeExtra = [];         // eigene Orte (zusätzlich zu den Vorschlägen)
let placeHave = new Set();   // schon angelegte Orte
let rooms = new Map();       // Ort-Schlüssel -> Map(Raum-Schlüssel -> Name)
let roomExtra = new Map();   // Ort-Schlüssel -> eigene Räume
let roomHave = new Map();    // Ort-Schlüssel -> Set schon angelegter Räume
let cur = '';                // Ort, dessen Räume gerade gezeigt werden
let page = 0;
let busy = false;
let release = null;   // hebt die Sperre des Hintergrunds auf (aus ui.modal)

/**
 * Liefert true, wenn die Einführung gezeigt wird. Wer die App schon eingerichtet hat –
 * Einträge, Räume, Orte, einen API-Key oder einen gemerkten Raum –, bekommt sie nicht mehr;
 * das wird still als erledigt gemerkt.
 */
export async function maybeShow(settings, { items = 0, rooms: nRooms = 0, places: nPlaces = 0 } = {}) {
  if (settings.onboarded) return false;
  const settled = items > 0 || nRooms > 0 || nPlaces > 0 || !!String(settings.apiKey || '').trim() || !!String(settings.lastRoom || '').trim();
  if (settled) {
    settings.onboarded = true;
    await db.setSetting('onboarded', true);
    return false;
  }
  show();
  return true;
}

export const isOpen = () => !$('#onboarding').hidden;

/**
 * Fokus auf die Überschrift der sichtbaren Seite (nach der Start-Szene): Screenreader und
 * Tastatur beginnen dort. Eine Überschrift ist kein Eingabefeld – auf dem iPhone geht dabei
 * keine Tastatur auf.
 */
export function focusStart() {
  if (!isOpen()) return;
  const h = $$('#onb-pages .onb-page')[page]?.querySelector('h2');
  if (!h) return;
  h.tabIndex = -1;
  try { h.focus({ preventScroll: true }); } catch (_) { void _; }
}

const suggested = () => [...PLACE_SUGGESTIONS, ...placeExtra];
const placeOfKey = (k) => places.get(k) || suggested().find(p => key(p.name) === k) || null;

export function show() {
  // Schon Angelegtes ist vorgewählt und gesperrt (beim erneuten Zeigen aus den Einstellungen).
  const havePlaces = ctx.places();
  const haveRooms = ctx.rooms();
  placeHave = new Set(havePlaces.map(p => key(p.name)));
  placeExtra = havePlaces.filter(p => !PLACE_SUGGESTIONS.some(s => key(s.name) === key(p.name)))
    .map(p => ({ name: p.name, icon: safeIcon(p.icon) }));
  places = new Map(havePlaces.map(p => [key(p.name), { name: p.name, icon: safeIcon(p.icon) }]));
  if (!places.size) places.set(key(DEFAULT_PLACE), { name: DEFAULT_PLACE, icon: 'haus' });
  rooms = new Map();
  roomHave = new Map();
  roomExtra = new Map();
  for (const r of haveRooms) {
    const pk = key(r.place || DEFAULT_PLACE);
    if (!rooms.has(pk)) rooms.set(pk, new Map());
    if (!roomHave.has(pk)) roomHave.set(pk, new Set());
    rooms.get(pk).set(key(r.name), r.name);
    roomHave.get(pk).add(key(r.name));
  }
  cur = [...places.keys()][0] || '';
  $('#onb-key').value = ctx.apiKey() || '';
  $('#onb-room').value = '';
  $('#onb-place').value = '';
  renderPlaces();
  renderRooms();
  const el = $('#onboarding');
  if (!release) release = modal();
  el.hidden = false;
  el.classList.remove('leaving');
  $('#onb-pages').scrollLeft = 0;
  setPage(0);
  if (!reduced() && el.animate) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    el.querySelector('.onb-page').animate([{ transform: 'translateY(24px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', delay: 60, fill: 'backwards' });
  }
}

function hide() {
  const el = $('#onboarding');
  const active = document.activeElement;
  if (active && el.contains(active)) active.blur();
  const rel = release;
  release = null;
  rel?.();
  if (reduced() || !el.animate) { el.hidden = true; return Promise.resolve(); }
  el.classList.add('leaving');
  const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.04)' }], { duration: 280, easing: 'ease-in', fill: 'forwards' });
  return a.finished.catch(() => null).then(() => { el.hidden = true; el.classList.remove('leaving'); a.cancel(); });
}

/* ---------------- Seite „Wo hast du Sachen?“ ---------------- */

function renderPlaces() {
  $('#onb-places').innerHTML = suggested().map((p) => {
    const k = key(p.name);
    const on = places.has(k);
    const have = placeHave.has(k);
    return `<button type="button" class="onb-chip" data-place-name="${esc(p.name)}" aria-pressed="${on}"${have ? ' aria-disabled="true" title="schon angelegt"' : ''}>`
      + `${icon('check', 'onb-tick')}${icon('pl-' + safeIcon(p.icon), 'onb-pic')}<span>${esc(p.name)}</span></button>`;
  }).join('');
  for (const b of $$('#onb-places .onb-chip')) b.classList.toggle('on', b.getAttribute('aria-pressed') === 'true');
  const n = places.size;
  $('#onb-places-picked').textContent = n ? `${n} ${n === 1 ? 'Ort' : 'Orte'} ausgewählt` : 'Kein Ort – Räume und Orte entstehen dann später von selbst.';
  if (!places.has(cur)) cur = [...places.keys()][0] || '';
}

function togglePlace(name) {
  const k = key(name);
  if (placeHave.has(k)) return;
  if (places.has(k)) places.delete(k);
  else places.set(k, { name, icon: placeOfKey(k)?.icon || suggestIcon(name) });
  renderPlaces();
  renderRooms();
  haptic();
}

function addCustomPlace() {
  const input = $('#onb-place');
  const name = clip(input.value);
  if (!name) return;
  const k = key(name);
  if (!suggested().some(p => key(p.name) === k)) placeExtra.push({ name, icon: suggestIcon(name) });
  const hit = suggested().find(p => key(p.name) === k);
  places.set(k, { name: hit.name, icon: hit.icon });
  input.value = '';
  renderPlaces();
  renderRooms();
  haptic();
}

/* ---------------- Seite „Welche Räume …?“ ---------------- */

function renderRooms() {
  const p = places.get(cur);
  const many = places.size > 1;
  // Mehrere Orte: oben umschalten, welcher Ort gerade dran ist.
  const tabs = $('#onb-rtabs');
  tabs.hidden = !many;
  tabs.innerHTML = many ? [...places].map(([k, v]) => `<button type="button" class="onb-rtab${k === cur ? ' on' : ''}" data-onb-place="${esc(k)}" aria-pressed="${k === cur}">`
    + `${icon('pl-' + safeIcon(v.icon))}<span>${esc(v.name)}</span></button>`).join('') : '';
  $('#onb-rooms-title').textContent = !p ? 'Räume kommen später' : many ? `Welche Räume hat „${p.name}“?` : 'Welche Räume hast du?';
  $('#onb-rooms-lead').textContent = !p
    ? 'Ohne Ort geht es auch: Räume und Orte entstehen später ganz von selbst, sobald du sie beim Fotografieren eintippst.'
    : 'Tippe an, was es bei dir gibt. Weitere Räume entstehen später ganz von selbst.';
  $('#onb-rooms-box').hidden = !p;
  if (!p) return;
  const picked = rooms.get(cur) || new Map();
  const have = roomHave.get(cur) || new Set();
  const extra = roomExtra.get(cur) || [];
  const sugg = roomSuggestions(p.icon);
  const names = [...sugg, ...extra, ...[...picked.values()].filter(n => ![...sugg, ...extra].some(s => key(s) === key(n)))];
  $('#onb-chips').innerHTML = names.map((n) => {
    const on = picked.has(key(n));
    return `<button type="button" class="onb-chip${on ? ' on' : ''}" data-room="${esc(n)}" aria-pressed="${on}"${have.has(key(n)) ? ' aria-disabled="true" title="schon angelegt"' : ''}>${icon('check', 'onb-tick')}<span>${esc(n)}</span></button>`;
  }).join('');
  $('#onb-room').placeholder = p.icon === 'auto' || p.icon === 'bus' ? 'Eigener Raum, z. B. Kiste' : 'Eigener Raum, z. B. Werkstatt';
  countRooms();
}

function countRooms() {
  const n = (rooms.get(cur) || new Map()).size;
  $('#onb-picked').textContent = n ? `${n} ${n === 1 ? 'Raum' : 'Räume'} ausgewählt` : 'Noch nichts ausgewählt – geht auch später.';
}

function addCustomRoom() {
  const input = $('#onb-room');
  const name = clip(input.value);
  if (!name || !places.has(cur)) return;
  const extra = roomExtra.get(cur) || [];
  const all = [...roomSuggestions(places.get(cur).icon), ...extra];
  if (!all.some(s => key(s) === key(name))) { extra.push(name); roomExtra.set(cur, extra); }
  const hit = [...all, name].find(s => key(s) === key(name));
  if (!rooms.has(cur)) rooms.set(cur, new Map());
  rooms.get(cur).set(key(hit), hit);
  input.value = '';
  renderRooms();
  haptic();
}

/* ---------------- Seiten ---------------- */

function setPage(n) {
  page = n;
  $$('#onb-dots i').forEach((d, i) => d.classList.toggle('on', i === n));
  const last = n === LAST;
  const next = $('#onb-next');
  next.innerHTML = last ? `${icon('camera')}<span>Los geht’s – erstes Foto</span>` : '<span>Weiter</span>';
  next.classList.toggle('go', last);
  $('#onb-later').hidden = !last;
  $('#onb-skip').hidden = last;
  // Unsichtbare Seiten sind inert: weder per Tab noch per Screenreader erreichbar.
  $$('#onb-pages .onb-page').forEach((p, i) => { p.setAttribute('aria-hidden', String(i !== n)); p.inert = i !== n; });
}

function goTo(n) {
  const box = $('#onb-pages');
  box.scrollTo({ left: n * box.clientWidth, behavior: reduced() ? 'auto' : 'smooth' });
  setPage(n);
}

// goAdd: true = „Los geht’s“ (Orte, Räume und Key übernehmen, Kamera öffnen),
// 'later' = „Später“ (Orte und Räume übernehmen, Key nicht), false = Überspringen/Escape (nichts übernehmen).
async function finish(goAdd) {
  if (busy) return;
  busy = true;
  // Gleich ausblenden – das Speichern läuft währenddessen, die App darunter ist sofort bedienbar.
  const hiding = hide();
  try {
    if (goAdd !== false) {
      let first = null;
      for (const [k, p] of places) {
        const pid = await db.ensurePlace(p.name, { icon: p.icon });
        first = first || pid;
        const have = roomHave.get(k) || new Set();
        for (const name of (rooms.get(k) || new Map()).values()) {
          if (!have.has(key(name))) await db.ensureRoom(pid, name);
        }
      }
      // „Du bist gerade in: Zuhause“ – sofern noch kein Ort gemerkt ist.
      if (first && !(await db.loadSettings()).lastPlace) await db.setSetting('lastPlace', first);
    }
    const apiKey = $('#onb-key').value.trim();
    await db.setSetting('onboarded', true);
    await ctx.done({ key: goAdd === true ? apiKey : null, goAdd: goAdd === true, skipped: goAdd === false });
  } catch (e) {
    console.warn('Einführung:', e);
  } finally {
    await hiding;
    busy = false;
  }
}

export function init(c) {
  ctx = c;
  $('#onb-places').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-place-name]');
    if (!chip || chip.getAttribute('aria-disabled') === 'true') return;
    togglePlace(chip.dataset.placeName);
  });
  $('#onb-place-add').addEventListener('click', addCustomPlace);
  $('#onb-place').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomPlace(); } });
  $('#onb-rtabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-onb-place]');
    if (!b) return;
    cur = b.dataset.onbPlace;
    renderRooms();
    haptic();
  });
  $('#onb-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-room]');
    if (!chip || chip.getAttribute('aria-disabled') === 'true' || !places.has(cur)) return;
    const name = chip.dataset.room;
    if (!rooms.has(cur)) rooms.set(cur, new Map());
    const picked = rooms.get(cur);
    if (picked.has(key(name))) picked.delete(key(name)); else picked.set(key(name), name);
    const on = picked.has(key(name));
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-pressed', String(on));
    countRooms();
    haptic();
  });
  $('#onb-room-add').addEventListener('click', addCustomRoom);
  $('#onb-room').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomRoom(); } });
  $('#onb-next').addEventListener('click', () => { if (page < LAST) goTo(page + 1); else finish(true); });
  $('#onb-later').addEventListener('click', () => finish('later'));
  $('#onb-skip').addEventListener('click', () => finish(false));
  // Escape wirkt wie „Überspringen“; Tab bleibt in der Einführung.
  document.addEventListener('keydown', (e) => {
    if (!isOpen() || $('#onboarding').classList.contains('leaving')) return;
    if (e.key === 'Escape') { e.preventDefault(); finish(false); return; }
    trapTab($('#onboarding'), e);
  });
  $('#onb-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

  // Wischen zwischen den Seiten: Seite aus der Scroll-Position ablesen.
  const box = $('#onb-pages');
  let raf = 0;
  box.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const n = Math.round(box.scrollLeft / Math.max(1, box.clientWidth));
      if (n !== page) setPage(Math.max(0, Math.min(LAST, n)));
    });
  }, { passive: true });
  // Tab-Taste darf nicht auf eine unsichtbare Seite springen, ohne mitzuscrollen.
  box.addEventListener('focusin', (e) => {
    const p = e.target.closest('.onb-page');
    const i = $$('#onb-pages .onb-page').indexOf(p);
    if (i >= 0 && i !== page) goTo(i);
  });
}
