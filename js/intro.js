// Start-Szene „Glas-Regal“ (1.6.0).
// Das leere gläserne Regalbrett ist zugleich das iOS-Startbild (icons/splash/, erzeugt mit
// tools/splash.js aus genau diesem Markup) – der Übergang ist deshalb nahtlos. Hier fallen
// dann Bücher und ein Einmachglas federnd ins Regal, ein Glanz wischt darüber, und die
// Szene öffnet sich in die App, die dahinter schon fertig gezeichnet ist.
//
// - Blockiert den Start nicht: app.js startet parallel und ruft done(), sobald es bereit ist.
//   Ist die App schneller, läuft die Szene zu Ende (frühestens nach ~0,8 s öffnet sie);
//   ist sie langsamer, schimmert das Regal ruhig weiter, bis es so weit ist.
// - Nur beim echten Kaltstart. Wurde die Seite nach dem Wechsel in den Hintergrund neu
//   geladen (oder aus dem Verlauf wiederhergestellt), nur kurz überblenden.
// - „Bewegung reduzieren“: nur kurzes Überblenden.
// - Der Start-Wächter in index.html bleibt unberührt: window.__inventarReady setzt app.js
//   wie bisher, unabhängig von der Szene.
// Animiert werden nur transform und opacity.
import { reduced, num } from './motion.js';

const BG_KEY = 'inventar-hintergrund';   // gesetzt, sobald die App einmal im Hintergrund war
const OPEN_AFTER = 760;                  // ms: so lange darf die Szene mindestens dauern

let el = null;
let mode = 'none';       // 'full' | 'fade' | 'none'
let ready = false;       // app.js ist gestartet
let clockDone = false;   // Mindestdauer der Szene erreicht
let opening = false;
let finished = false;
let anims = [];
let idle = null;
let resolveDone = null;
const whenDone = new Promise((r) => { resolveDone = r; });

const bgSeen = () => {
  try { return !!sessionStorage.getItem(BG_KEY); } catch (_) { void _; return false; }
};

function decide() {
  if (document.visibilityState === 'hidden') return 'none';
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  if (bgSeen() || nav?.type === 'back_forward') return 'fade';
  // Hat schon das Laden der Skripte lange gedauert (langsames Netz, erster Start nach einem
  // Update), stand das Startbild lange genug – dann nicht noch eine Szene hinterher.
  if (performance.now() > 900) return 'fade';
  if (reduced() || typeof el.animate !== 'function') return 'fade';
  return 'full';
}

/* ---------------- Fallen, aufsetzen, aufrichten ---------------- */

const FALL = 230;     // ms bis zum Aufsetzen
const SETTLE = 330;   // ms Nachfedern

// Ein Gegenstand fällt aus `y0` px Höhe (leicht gekippt um r0 Grad), setzt auf, federt kurz
// zurück, staucht sich und richtet sich auf – bis auf `lean` Grad (ein Buch lehnt am Ende).
function dropFrames({ y0, r0, lean = 0 }) {
  const total = FALL + SETTLE;
  const n = Math.round(total / 1000 * 60);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = total * i / n;
    let y, r, sx = 1, sy = 1, o = 1;
    if (t <= FALL) {
      const p = t / FALL;
      y = y0 * (1 - p * p);                         // freier Fall
      r = r0 + (lean - r0) * 0.25 * p;
      o = Math.min(1, t / 70);
      const s = Math.max(0, p - 0.6) * 0.1;         // kurz vor dem Aufsetzen etwas gestreckt
      sy = 1 + s; sx = 1 - s * 0.6;
    } else {
      const s = (t - FALL) / 1000;
      y = -7 * Math.exp(-10 * s) * Math.abs(Math.sin(19 * s));     // kleiner Hüpfer
      const tilt = (r0 + (lean - r0) * 0.25 - lean) * 0.7;
      r = lean + tilt * Math.exp(-7.5 * s) * Math.cos(15 * s);      // kippt, richtet sich auf
      const q = 0.1 * Math.exp(-15 * s) * Math.cos(28 * s);         // Stauchen beim Aufprall
      sy = 1 - q; sx = 1 + q * 0.55;
    }
    if (i === n) { y = 0; r = lean; sx = 1; sy = 1; }
    out.push({ offset: i / n, opacity: num(o), transform: `translateY(${num(y)}px) rotate(${num(r)}deg) scale(${num(sx)}, ${num(sy)})` });
  }
  return out;
}

// Reihenfolge wie im Markup (links nach rechts); fallen in dieser Folge.
const ITEMS = [
  { y0: -150, r0: -9 },
  { y0: -170, r0: 7 },
  { y0: -160, r0: -6 },
  { y0: -175, r0: 4 },            // Einmachglas
  { y0: -165, r0: 8 },
  { y0: -180, r0: -14, lean: -7 }, // lehnt sich am Ende an den Nachbarn
];
const ORDER = [2, 0, 3, 4, 1, 5];   // nicht stur von links: erst das große, dann das Glas …

function play() {
  const q = (s) => el.querySelector(s);
  const items = [...el.querySelectorAll('.i-item')];
  items.forEach((it, i) => {
    const k = ORDER.indexOf(i);
    anims.push(it.animate(dropFrames(ITEMS[i] || ITEMS[0]), { duration: FALL + SETTLE, delay: 30 + k * 58, easing: 'linear', fill: 'both' }));
  });
  // Glanz wischt über Regal und Bücher.
  const sweep = [
    { transform: 'translateX(-70px) skewX(-20deg)', opacity: 0 },
    { transform: 'translateX(20px) skewX(-20deg)', opacity: 1, offset: 0.25 },
    { transform: 'translateX(260px) skewX(-20deg)', opacity: 1, offset: 0.8 },
    { transform: 'translateX(330px) skewX(-20deg)', opacity: 0 },
  ];
  const glint = q('.i-glint');
  const shine = q('.i-shine');
  if (glint) anims.push(glint.animate(sweep, { duration: 560, delay: 480, easing: 'cubic-bezier(.4,.1,.3,1)', fill: 'both' }));
  if (shine) anims.push(shine.animate(sweep, { duration: 600, delay: 420, easing: 'cubic-bezier(.4,.1,.3,1)', fill: 'both' }));
  // Uhr für die Mindestdauer – über die Animations-Zeitleiste, damit sie mit ihr läuft.
  const clock = q('.intro').animate([{ opacity: 1 }, { opacity: 1 }], { duration: OPEN_AFTER });
  anims.push(clock);
  clock.finished.then(() => {
    clockDone = true;
    if (ready) open();
    else if (!finished) waitShimmer(glint);
  }, () => {});
}

// Die App braucht länger: das Regal schimmert ruhig weiter, ohne Hänger.
function waitShimmer(glint) {
  if (!glint || idle) return;
  idle = glint.animate([
    { transform: 'translateX(-70px) skewX(-20deg)', opacity: 0 },
    { transform: 'translateX(20px) skewX(-20deg)', opacity: 0.7, offset: 0.18 },
    { transform: 'translateX(260px) skewX(-20deg)', opacity: 0.7, offset: 0.52 },
    { transform: 'translateX(330px) skewX(-20deg)', opacity: 0, offset: 0.62 },
    { transform: 'translateX(330px) skewX(-20deg)', opacity: 0 },
  ], { duration: 1500, iterations: Infinity, easing: 'ease-in-out' });
  anims.push(idle);
}

/* ---------------- Öffnen ---------------- */

// Das Glas zerfließt zur Seite, die Bücher schweben aus dem Bild, die App darunter
// rückt aus der Tiefe nach vorn.
function open() {
  if (opening || finished) return;
  opening = true;
  el.style.pointerEvents = 'none';
  const q = (s) => el.querySelector(s);
  const list = [];
  const a = (node, frames, o) => { if (node) list.push(node.animate(frames, { fill: 'forwards', ...o })); };
  const ease = 'cubic-bezier(.3,.7,.2,1)';
  a(q('.i-shelf'), [{ transform: 'none', opacity: 1 }, { transform: 'scale(2.6, .3)', opacity: 0 }], { duration: 340, easing: ease });
  a(q('.i-caustic'), [{ transform: 'none', opacity: 1 }, { transform: 'scale(2.2, .6)', opacity: 0 }], { duration: 300, easing: ease });
  a(q('.i-row'), [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-16px) scale(1.16)', opacity: 0 }], { duration: 300, easing: ease });
  a(q('.i-name'), [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out' });
  a(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 70, easing: 'ease-out' });
  const view = document.querySelector('#app > .view:not([hidden])');
  if (view?.animate) view.animate([{ transform: 'scale(.955)' }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' });
  anims.push(...list);
  Promise.all(list.map(x => x.finished)).catch(() => null).then(finish);
}

function fadeOut() {
  if (opening || finished) return;
  opening = true;
  el.style.pointerEvents = 'none';
  if (typeof el.animate !== 'function') { finish(); return; }
  const f = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
  anims.push(f);
  f.finished.catch(() => null).then(finish);
}

function finish() {
  if (finished) return;
  finished = true;
  if (el) {
    el.hidden = true;
    el.style.pointerEvents = '';
  }
  for (const x of anims) { try { x.cancel(); } catch (_) { void _; } }
  anims = [];
  idle = null;
  resolveDone();
}

/* ---------------- Schnittstelle ---------------- */

/** Szene starten – so früh wie möglich (app.js ruft das vor dem eigentlichen Start). */
export function start() {
  el = document.getElementById('splash');
  if (!el || el.hidden) { finished = true; resolveDone(); return; }
  mode = decide();
  el.dataset.intro = mode;
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', (e) => { if (e.persisted && ready) finish(); });
  // Neu laden oder Wegnavigieren ist kein Wechsel in den Hintergrund (Chromium meldet dabei
  // auch „hidden“ – je nach Browser vor oder nach pagehide).
  window.addEventListener('pagehide', () => {
    unloading = true;
    try { sessionStorage.removeItem(BG_KEY); } catch (_) { void _; }
  });
  // Blendet der Start-Wächter oder eine Fehlermeldung das Startbild aus: aufräumen.
  new MutationObserver(() => { if (el.hidden && !finished) finish(); }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  // Tippen, sobald die App bereit ist: nicht warten, gleich öffnen.
  el.addEventListener('pointerdown', () => { if (ready && mode === 'full') { clockDone = true; open(); } });
  if (mode === 'full') play();
}

// Wechsel in den Hintergrund merken (dann gibt es beim nächsten Laden keine Szene mehr)
// und eine laufende Szene nicht im Verborgenen weiterspielen.
let unloading = false;
function onVisibility() {
  if (document.visibilityState !== 'hidden' || unloading) return;
  try { sessionStorage.setItem(BG_KEY, String(Date.now())); } catch (_) { void _; }
  if (finished) return;
  if (ready) { finish(); return; }
  for (const x of anims) { try { if (x !== idle) x.finish(); } catch (_) { void _; } }
  mode = 'fade';
}

/** Die App ist bereit. Liefert ein Promise, das mit dem Ausblenden der Szene erfüllt ist. */
export function done() {
  ready = true;
  if (finished) return whenDone;
  if (mode === 'none') finish();
  else if (mode === 'fade') fadeOut();
  else if (clockDone) open();
  return whenDone;
}

/** Sofort beenden (Startfehler). */
export function stop() {
  ready = true;
  finish();
}

export const isFinished = () => finished;
