// Liquid Glass (1.6.0): alles, was am Glas-Aussehen Skript braucht.
// - Tab-Leiste: die Markierung ist eine Glas-Linse, die federnd zum aktiven Tab gleitet
//   und sich unterwegs in die Länge zieht; beim Runterscrollen wird die Leiste kleiner,
//   beim Hochscrollen oder Anhalten wieder groß.
// - Kopfzeilen werden zu Glas, sobald Inhalt darunter durchscrollt (Klasse .lifted).
// - Glas-Knöpfe quellen beim Drücken leicht auf, ein Glanz folgt dem Finger.
// - Der Kamera-Tropfen quillt auf, wenn Hinzufügen aufsteigt; Aktionsblätter wachsen aus
//   dem Element, das sie geöffnet hat (originOf / lastPress).
// Animiert werden nur transform und opacity. Bei „Bewegung reduzieren“ springt alles.
import { reduced, springAnimate, springEasing, num } from './motion.js';

const $ = (s) => document.querySelector(s);

/* ---------------- Federn als CSS-Easing ---------------- */

// Für Übergänge in CSS (Leiste schrumpfen, Knöpfe aufquellen, Toast). Ohne linear()
// greift der cubic-bezier-Rückfall aus app.css.
function cssSprings() {
  const root = document.documentElement.style;
  const set = (name, opts) => {
    const e = springEasing(opts);
    if (!e) return;
    root.setProperty(`--${name}`, e.easing);
    root.setProperty(`--${name}-dur`, `${e.duration}ms`);
  };
  set('spring', { stiffness: 300, damping: 26 });         // sanft federnd
  set('spring-pop', { stiffness: 420, damping: 22 });     // Aufquellen, deutlich
  set('spring-soft', { stiffness: 190, damping: 22 });    // Toast fließt herein
}

/* ---------------- Echte Lichtbrechung (nur Chromium) ----------------
   Safari kennt backdrop-filter: url(#…) nicht – dort bleibt es bei blur() + saturate().
   Chromium bekommt zusätzlich eine Verschiebungskarte an den Rändern (feDisplacementMap). */
function refraction() {
  try {
    const chromium = 'userAgentData' in navigator && !CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
    if (chromium && CSS.supports('backdrop-filter', 'url(#lg-refract) blur(1px)')) document.documentElement.classList.add('refract');
  } catch (_) { void _; }
}

/* ---------------- Tab-Linse ---------------- */

let lens = null;
let lensX = null;       // aktuelle Ruhelage (px) oder null, solange unsichtbar
let lensTab = null;
let lensAnim = null;

const slot = (tab) => $(`#nav button[data-nav="${tab}"]`);

function lensGeom(btn) {
  return { x: btn.offsetLeft + 3, w: Math.max(0, btn.offsetWidth - 6) };
}

/** Linse zum Tab `tab` bewegen (bei „add“ taucht sie im Kamera-Tropfen unter). */
export function setTab(tab, { instant = false } = {}) {
  if (!lens) return;
  lensTab = tab;
  const btn = slot(tab);
  lensAnim?.cancel();
  lensAnim = null;
  if (!btn || tab === 'add' || !btn.offsetWidth) {
    const was = lensX;
    lensX = null;
    lens.style.opacity = '0';
    if (was != null && !instant && !reduced() && lens.animate) {
      const fab = slot('add');
      const to = fab ? lensGeom(fab).x : was;
      lensAnim = lens.animate([
        { transform: `translateX(${num(was)}px)`, opacity: 1 },
        { transform: `translateX(${num(to)}px) scale(.55, .7)`, opacity: 0 },
      ], { duration: 260, easing: 'cubic-bezier(.3,.7,.2,1)' });
    }
    return;
  }
  const g = lensGeom(btn);
  const from = lensX;
  lensX = g.x;
  lens.style.width = g.w + 'px';
  lens.style.transform = `translateX(${num(g.x)}px)`;
  lens.style.opacity = '1';
  if (instant || reduced() || !lens.animate || from === g.x) return;
  if (from == null) {
    // Aus dem Tropfen wieder auftauchen.
    lensAnim = springAnimate(lens, (p) => ({
      transform: `translateX(${num(g.x)}px) scale(${num(0.6 + 0.4 * p)}, ${num(0.75 + 0.25 * p)})`,
      opacity: num(Math.min(1, p * 1.6)),
    }), { stiffness: 380, damping: 26 });
    return;
  }
  const d = g.x - from;
  // Unterwegs zieht sich die Linse wie ein Tropfen in die Länge (je schneller, desto mehr).
  lensAnim = springAnimate(lens, (p, v) => {
    const stretch = Math.min(0.32, Math.abs(v * d) / 5200);
    return { transform: `translateX(${num(from + d * p)}px) scale(${num(1 + stretch)}, ${num(1 - stretch * 0.38)})` };
  }, { stiffness: 330, damping: 25 });
  lensAnim.finished.then(() => { lensAnim = null; }, () => {});
}

/* ---------------- Leiste schrumpft beim Scrollen ---------------- */

let compact = false;
let idleTimer = 0;
const lastTop = new WeakMap();

function setCompact(on) {
  if (on === compact) return;
  compact = on;
  $('#nav')?.classList.toggle('compact', on);
}

/** Beim Ansichtswechsel: Leiste wieder groß. */
export function resetBar() {
  clearTimeout(idleTimer);
  setCompact(false);
}

/* ---------------- Glas-Kopfzeilen ---------------- */

const pending = new Set();
let raf = 0;

function onScroll(e) {
  const sc = e.target;
  if (!sc?.classList?.contains('scroll')) return;
  pending.add(sc);
  if (!raf) raf = requestAnimationFrame(flushScroll);
}

function flushScroll() {
  raf = 0;
  for (const sc of pending) {
    const view = sc.closest('.view');
    if (!view) continue;
    const st = sc.scrollTop;
    view.classList.toggle('lifted', st > 2);
    const prev = lastTop.has(sc) ? lastTop.get(sc) : st;
    lastTop.set(sc, st);
    if (view.hidden || view.id !== 'view-' + document.body.dataset.view || reduced()) continue;
    const dy = st - prev;
    if (st < 40 || dy < -6) setCompact(false);
    else if (dy > 6 && st > 90) setCompact(true);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setCompact(false), 1100);   // Anhalten: wieder groß
  }
  pending.clear();
}

// Höhe der schwebenden Kopfzeile (und der Zuweisen-Leiste) als Variable an der Ansicht –
// der Scrollbereich beginnt darunter und läuft beim Scrollen unter dem Glas durch.
function measureBars() {
  const els = [...document.querySelectorAll('.view > .head, .view > .assign-bar')];
  const put = (el) => {
    const view = el.closest('.view');
    if (!view) return;
    const h = Math.round(el.offsetHeight) + 'px';
    if (el.classList.contains('head')) { view.style.setProperty('--head-h', h); return; }
    view.style.setProperty('--bar-h', h);
    document.documentElement.style.setProperty('--rooms-bar-h', h);   // für den Toast darüber
  };
  els.forEach(put);
  if (typeof ResizeObserver !== 'function') return;
  const ro = new ResizeObserver((entries) => { for (const en of entries) put(en.target); });
  els.forEach(el => ro.observe(el));
}

/* ---------------- Drücken: aufquellen, Glanz folgt dem Finger ---------------- */

const PRESS = '#nav button, .glass-btn, .topbar .link, .sheet-cancel, .toast-act, #update-go, .lb-close, .home-search, #onb-next, .onb-skip, .flag';
let pressed = null;
let glintRaf = 0;
let glintAt = null;
let lastPress = null;   // { t, x, y, el } – woher kam der letzte Tipp (für Aktionsblätter)

function glint(el, x, y) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  el.style.setProperty('--gx', num(Math.max(0, Math.min(100, (x - r.left) / r.width * 100))) + '%');
  el.style.setProperty('--gy', num(Math.max(0, Math.min(100, (y - r.top) / r.height * 100))) + '%');
}

function release() {
  if (!pressed) return;
  pressed.classList.remove('is-pressed');
  pressed = null;
  glintAt = null;
}

function wirePress() {
  document.addEventListener('pointerdown', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    lastPress = { t: performance.now(), x: e.clientX, y: e.clientY, el: t?.closest('.row, .rt, .rtile, .pick, button, [role="button"]') || null };
    release();
    const b = t?.closest(PRESS);
    if (!b || b.disabled) return;
    pressed = b;
    b.classList.add('is-pressed');
    glint(b, e.clientX, e.clientY);
  }, { capture: true, passive: true });
  document.addEventListener('pointermove', (e) => {
    if (!pressed) return;
    glintAt = [e.clientX, e.clientY];
    if (glintRaf) return;
    glintRaf = requestAnimationFrame(() => {
      glintRaf = 0;
      if (pressed && glintAt) glint(pressed, glintAt[0], glintAt[1]);
    });
  }, { passive: true });
  for (const type of ['pointerup', 'pointercancel', 'dragstart']) document.addEventListener(type, release, { capture: true, passive: true });
}

/**
 * Woher ein Aktionsblatt wachsen soll: das zuletzt angetippte Element (langes Drücken,
 * ⋯-Knopf), sonst das fokussierte (Tastatur). Liefert { el, rect } oder null.
 */
export function origin() {
  const fresh = lastPress && performance.now() - lastPress.t < 1500 ? lastPress : null;
  let el = fresh?.el;
  if (!el?.isConnected) el = null;
  if (!el) {
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected && !a.closest('#sheet')) el = a;
  }
  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.width && rect.height) return { el, rect };
  }
  if (fresh) return { el: null, rect: new DOMRect(fresh.x - 22, fresh.y - 22, 44, 44) };
  return null;
}

/* ---------------- Kamera-Tropfen quillt zum Blatt ---------------- */

/** Beim Öffnen von Hinzufügen: ein grüner Glastropfen löst sich vom Kamera-Knopf und zerfließt. */
export function dropFromFab() {
  if (reduced()) return;
  const fab = $('#nav .fab');
  if (!fab?.animate) return;
  const r = fab.getBoundingClientRect();
  if (!r.width) return;
  const d = document.createElement('div');
  d.className = 'drop';
  d.setAttribute('aria-hidden', 'true');
  Object.assign(d.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  document.body.appendChild(d);
  const up = -Math.min(window.innerHeight * 0.3, 260);
  const a = d.animate([
    { transform: 'translateY(0) scale(1, 1)', opacity: 1 },
    { transform: 'translateY(2px) scale(1.22, .84)', opacity: 1, offset: 0.16 },
    { transform: `translateY(${num(up * 0.35)}px) scale(1.5, 1.9)`, opacity: 0.9, offset: 0.45 },
    { transform: `translateY(${num(up)}px) scale(5.2, 4.2)`, opacity: 0 },
  ], { duration: 520, easing: 'cubic-bezier(.25,.7,.25,1)' });
  a.finished.catch(() => null).then(() => d.remove());
  // Der Knopf selbst gibt dabei kurz nach – als hätte er den Tropfen abgegeben.
  springAnimate(fab, (p) => ({ transform: `scale(${num(0.82 + 0.18 * p)})` }), { stiffness: 420, damping: 18 });
}

/* ---------------- Start ---------------- */

export function init() {
  cssSprings();
  refraction();
  lens = $('#nav .lens');
  if (lens && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { if (lensTab) setTab(lensTab, { instant: true }); }).observe($('#nav'));
  }
  // Glasfläche hinter jede Kopfzeile (sichtbar, sobald Inhalt darunter durchscrollt).
  for (const head of document.querySelectorAll('.view > .head')) {
    if (head.querySelector(':scope > .head-glass')) continue;
    const g = document.createElement('div');
    g.className = 'head-glass';
    g.setAttribute('aria-hidden', 'true');
    head.prepend(g);
  }
  measureBars();
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  wirePress();
}
