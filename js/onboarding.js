// Begrüßung beim ersten Start: drei Seiten – Willkommen, Räume, KI-Schlüssel.
// Erscheint nur, solange die Einstellung „onboarded“ fehlt UND es keine Spur einer
// Einrichtung gibt (Einträge, Räume, API-Key oder gemerkter Raum).
// „Überspringen“ und Escape übernehmen nichts von dem, was in der Einführung gewählt wurde.
import * as db from './db.js';
import { esc, icon, modal, trapTab } from './ui.js';
import { reduced } from './motion.js';
import { haptic } from './gestures.js';

export const ROOM_SUGGESTIONS = ['Küche', 'Wohnzimmer', 'Schlafzimmer', 'Bad', 'Flur', 'Keller', 'Dachboden',
  'Garage', 'Arbeitszimmer', 'Kinderzimmer', 'Abstellraum', 'Balkon'];

const $ = (s) => document.querySelector(s);
const key = (s) => String(s || '').trim().toLocaleLowerCase('de-DE');

let ctx = null;          // { rooms(), apiKey(), done({ key, goAdd, skipped }) }
let picked = new Map();  // Kleinschreibung -> Anzeigename
let existing = new Set();
let extra = [];
let page = 0;
let busy = false;
let release = null;   // hebt die Sperre des Hintergrunds auf (aus ui.modal)

/**
 * Liefert true, wenn die Einführung gezeigt wird. Wer die App schon eingerichtet hat –
 * Einträge, Räume, einen API-Key oder einen gemerkten Raum –, bekommt sie nicht mehr;
 * das wird still als erledigt gemerkt.
 */
export async function maybeShow(settings, { items = 0, rooms = 0 } = {}) {
  if (settings.onboarded) return false;
  const settled = items > 0 || rooms > 0 || !!String(settings.apiKey || '').trim() || !!String(settings.lastRoom || '').trim();
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

export function show() {
  const rooms = ctx.rooms();
  existing = new Set(rooms.map(key));
  picked = new Map(rooms.map(n => [key(n), n]));
  extra = rooms.filter(n => !ROOM_SUGGESTIONS.some(s => key(s) === key(n)));
  $('#onb-key').value = ctx.apiKey() || '';
  $('#onb-room').value = '';
  renderChips();
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

function renderChips() {
  const names = [...ROOM_SUGGESTIONS, ...extra];
  $('#onb-chips').innerHTML = names.map((n) => {
    const on = picked.has(key(n));
    const have = existing.has(key(n));
    return `<button type="button" class="onb-chip${on ? ' on' : ''}" data-room="${esc(n)}" aria-pressed="${on}"${have ? ' aria-disabled="true" title="schon angelegt"' : ''}>${icon('check', 'onb-tick')}<span>${esc(n)}</span></button>`;
  }).join('');
  const n = picked.size;
  $('#onb-picked').textContent = n ? `${n} ${n === 1 ? 'Raum' : 'Räume'} ausgewählt` : 'Noch nichts ausgewählt – geht auch später.';
}

function addCustom() {
  const input = $('#onb-room');
  const name = input.value.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) return;
  if (!ROOM_SUGGESTIONS.some(s => key(s) === key(name)) && !extra.some(s => key(s) === key(name))) extra.push(name);
  const hit = [...ROOM_SUGGESTIONS, ...extra].find(s => key(s) === key(name));
  picked.set(key(hit), hit);
  input.value = '';
  renderChips();
  haptic();
}

function setPage(n) {
  page = n;
  $$('#onb-dots i').forEach((d, i) => d.classList.toggle('on', i === n));
  const last = n === 2;
  const next = $('#onb-next');
  next.innerHTML = last ? `${icon('camera')}<span>Los geht’s – erstes Foto</span>` : '<span>Weiter</span>';
  next.classList.toggle('go', last);
  $('#onb-later').hidden = !last;
  $('#onb-skip').hidden = last;
  // Unsichtbare Seiten sind inert: weder per Tab noch per Screenreader erreichbar.
  $$('#onb-pages .onb-page').forEach((p, i) => { p.setAttribute('aria-hidden', String(i !== n)); p.inert = i !== n; });
}
const $$ = (s) => Array.from(document.querySelectorAll(s));

function goTo(n) {
  const box = $('#onb-pages');
  box.scrollTo({ left: n * box.clientWidth, behavior: reduced() ? 'auto' : 'smooth' });
  setPage(n);
}

// goAdd: true = „Los geht’s“ (Räume und Key übernehmen, Kamera öffnen),
// 'later' = „Später“ (Räume übernehmen, Key nicht), false = Überspringen/Escape (nichts übernehmen).
async function finish(goAdd) {
  if (busy) return;
  busy = true;
  // Gleich ausblenden – das Speichern läuft währenddessen, die App darunter ist sofort bedienbar.
  const hiding = hide();
  try {
    if (goAdd !== false) {
      for (const name of picked.values()) {
        if (!existing.has(key(name))) await db.ensureNamed('rooms', name);
      }
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
  $('#onb-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-room]');
    if (!chip || chip.getAttribute('aria-disabled') === 'true') return;
    const name = chip.dataset.room;
    if (picked.has(key(name))) picked.delete(key(name)); else picked.set(key(name), name);
    const on = picked.has(key(name));
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-pressed', String(on));
    const n = picked.size;
    $('#onb-picked').textContent = n ? `${n} ${n === 1 ? 'Raum' : 'Räume'} ausgewählt` : 'Noch nichts ausgewählt – geht auch später.';
    haptic();
  });
  $('#onb-room-add').addEventListener('click', addCustom);
  $('#onb-room').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });
  $('#onb-next').addEventListener('click', () => { if (page < 2) goTo(page + 1); else finish(true); });
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
      if (n !== page) setPage(Math.max(0, Math.min(2, n)));
    });
  }, { passive: true });
  // Tab-Taste darf nicht auf eine unsichtbare Seite springen, ohne mitzuscrollen.
  box.addEventListener('focusin', (e) => {
    const p = e.target.closest('.onb-page');
    const i = $$('#onb-pages .onb-page').indexOf(p);
    if (i >= 0 && i !== page) goTo(i);
  });
}
