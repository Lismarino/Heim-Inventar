// Rein darstellende Helfer, die mehrere Module brauchen (Liste, Zuhause, Einführung).

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const dtf = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Symbol aus dem SVG-Sprite in index.html.
export const icon = (name, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// Nur echte Bild-Data-URLs – der Wert kann aus einer fremden Sicherungsdatei stammen.
export const isThumb = (v) => typeof v === 'string' && v.startsWith('data:image/');

// Gedeckte Farbe, die sich stabil aus einem Namen ergibt – derselbe Name sieht immer gleich aus.
const PH_TONES = 6;
export function toneOf(name) {
  let h = 0;
  for (const ch of String(name || '').trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % PH_TONES;
}

export const initialOf = (name) => {
  const first = Array.from(String(name || '').trim())[0] || '';
  return first.toLocaleUpperCase('de-DE');
};

// Platzhalter für Einträge ohne Foto: Initiale auf der Farbe des Namens.
export function placeholderHTML(it, cls) {
  const name = String(it.name || '').trim();
  if (!name) return `<div class="${cls} ph ph-none">${icon('box')}</div>`;
  return `<div class="${cls} ph ph-${toneOf(name)}" aria-hidden="true">${esc(initialOf(name))}</div>`;
}

// Kleine Illustration für leere Zustände: ein Regal, das auf Dinge wartet.
export const EMPTY_ART = `<svg class="empty-art" viewBox="0 0 200 150" aria-hidden="true">
  <ellipse class="ea-floor" cx="100" cy="136" rx="84" ry="7"/>
  <path class="ea-shelf" d="M22 58h156M22 104h156"/>
  <path class="ea-line" d="M30 58v76M170 58v76"/>
  <rect class="ea-jar" x="40" y="26" width="26" height="32" rx="6"/>
  <rect class="ea-lid" x="38" y="20" width="30" height="8" rx="3"/>
  <path class="ea-line" d="M45 40h16"/>
  <rect class="ea-box" x="80" y="30" width="38" height="28" rx="3"/>
  <path class="ea-line" d="M80 38h38M99 30v8"/>
  <path class="ea-pot" d="M134 44h24l-3 14h-18z"/>
  <path class="ea-leaf" d="M146 44c-6-8-4-16 0-20 4 4 6 12 0 20zM146 44c4-6 10-8 14-7-1 4-6 8-14 7z"/>
  <rect class="ea-slot" x="44" y="72" width="112" height="32" rx="8"/>
  <path class="ea-plus" d="M100 80v16M92 88h16"/>
</svg>`;

/* ---------------- Dialoge: Hintergrund sperren, Fokus halten und zurückgeben ---------------- */

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Sperrt `el` (inert) aus einem bestimmten Grund oder hebt diese eine Sperre auf. Das Element
 * bleibt inert, solange noch ein Grund besteht – so kommen sich Start-Szene und Dialoge nicht
 * in die Quere (die Szene gibt #app frei, während die Einführung es noch sperren will).
 */
const locks = new WeakMap();
export function lock(el, why, on = true) {
  if (!el) return;
  let set = locks.get(el);
  if (!set) { set = new Set(); locks.set(el, set); }
  if (on) set.add(why); else set.delete(why);
  el.inert = set.size > 0;
}

/**
 * Öffnet einen modalen Bereich: #app wird inert (weder antipp- noch fokussierbar, für
 * Screenreader weg) und der bisher fokussierte Auslöser gemerkt. Liefert release(),
 * das die Sperre aufhebt und den Fokus an den Auslöser zurückgibt – sofern es ihn noch gibt.
 */
export function modal() {
  const app = document.getElementById('app');
  const trigger = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  lock(app, 'modal');
  return ({ restore = true } = {}) => {
    lock(app, 'modal', false);
    if (restore && trigger?.isConnected && !trigger.closest('[hidden], [inert]')) {
      try { trigger.focus({ preventScroll: true }); } catch (_) { void _; }
    }
  };
}

/** Tab und Umschalt+Tab bleiben innerhalb von `box` (am Ende wieder vorn anfangen). */
export function trapTab(box, e) {
  if (e.key !== 'Tab') return;
  const els = [...box.querySelectorAll(FOCUSABLE)].filter(el => !el.closest('[hidden], [inert]') && el.getClientRects().length);
  if (!els.length) return;
  const first = els[0], last = els[els.length - 1];
  const inside = box.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
}
