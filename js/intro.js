// Start-Szene (2.1): das App-Symbol, ein sanftes Federn, der Schriftzug „Keepsy“ – höchstens
// ~0,9 s. Das Symbol allein ist zugleich das iOS-Startbild (icons/splash/, erzeugt mit
// tools/splash.js aus genau diesem Markup) – der Übergang ist deshalb nahtlos. Kein Ton.
//
// - Blockiert den Start nicht: app.js startet parallel und ruft done(), sobald es bereit ist.
//   Ist die App schneller, läuft die Szene zu Ende (frühestens nach ~0,65 s öffnet sie);
//   ist sie langsamer, steht das Symbol ruhig da, bis es so weit ist.
// - Nur beim echten Kaltstart. Wurde die Seite nach dem Wechsel in den Hintergrund neu
//   geladen (oder aus dem Verlauf wiederhergestellt), nur kurz überblenden.
// - „Bewegung reduzieren“: nur kurzes Überblenden.
// - Solange die Szene steht, sind #app und #onboarding inert: Die Tab-Taste (Tastatur,
//   Schaltersteuerung) landet nicht unsichtbar hinter ihr. Die Fehlerseite des Start-Wächters
//   liegt außerhalb und darüber und bleibt bedienbar.
// - Der Start-Wächter in index.html bleibt unberührt: window.__inventarReady setzt app.js
//   wie bisher, unabhängig von der Szene.
// Animiert werden nur transform und opacity.
import { reduced } from './motion.js';
import { lock } from './ui.js';

const BG_KEY = 'inventar-hintergrund';   // gesetzt, sobald die App einmal im Hintergrund war
const OPEN_AFTER = 650;                  // ms: so lange dauert die Szene mindestens (+ 0,2 s Ausblenden)

let el = null;
let mode = 'none';       // 'full' | 'fade' | 'none'
let ready = false;       // app.js ist gestartet
let clockDone = false;   // Mindestdauer der Szene erreicht
let opening = false;
let finished = false;
let anims = [];
let resolveDone = null;
const whenDone = new Promise((r) => { resolveDone = r; });

// Die App hinter der Szene für Tastatur und Screenreader sperren bzw. wieder freigeben.
const BEHIND = ['app', 'onboarding'];
function holdBehind(on) {
  for (const id of BEHIND) lock(document.getElementById(id), 'intro', on);
}

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

/* ---------------- Szene ---------------- */

// Das Symbol steht schon da (erster Frame = Startbild): es federt einmal sanft nach, der
// Schriftzug „Keepsy“ blendet darunter ein. Nur transform und opacity.
function play() {
  const q = (s) => el.querySelector(s);
  const mark = q('.i-mark');
  if (mark) anims.push(mark.animate([
    { transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: 0.35 }, { transform: 'scale(.985)', offset: 0.7 }, { transform: 'scale(1)' },
  ], { duration: 520, easing: 'cubic-bezier(.3,.7,.3,1)' }));
  // Der Schriftzug steht nicht im Startbild (dort gäbe es nur eine Ersatzschrift).
  const name = q('.i-name');
  if (name) anims.push(name.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 140, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }));
  // Uhr für die Mindestdauer – über die Animations-Zeitleiste, damit sie mit ihr läuft.
  const clock = q('.intro').animate([{ opacity: 1 }, { opacity: 1 }], { duration: OPEN_AFTER });
  anims.push(clock);
  clock.finished.then(() => {
    clockDone = true;
    if (ready) open();
  }, () => {});
}

/* ---------------- Öffnen ---------------- */

// Die Szene blendet weich aus, das Symbol wächst dabei ein wenig, die App rückt nach vorn.
function open() {
  if (opening || finished) return;
  opening = true;
  el.style.pointerEvents = 'none';
  holdBehind(false);
  const q = (s) => el.querySelector(s);
  const list = [];
  const a = (node, frames, o) => { if (node) list.push(node.animate(frames, { fill: 'forwards', ...o })); };
  const ease = 'cubic-bezier(.3,.7,.2,1)';
  a(q('.intro'), [{ transform: 'none' }, { transform: 'scale(1.08)' }], { duration: 220, easing: ease });
  a(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out' });
  const view = document.querySelector('#app > .view:not([hidden])');
  if (view?.animate) view.animate([{ transform: 'scale(.97)' }, { transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
  anims.push(...list);
  Promise.all(list.map(x => x.finished)).catch(() => null).then(finish);
}

function fadeOut() {
  if (opening || finished) return;
  opening = true;
  el.style.pointerEvents = 'none';
  holdBehind(false);
  if (typeof el.animate !== 'function') { finish(); return; }
  const f = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
  anims.push(f);
  f.finished.catch(() => null).then(finish);
}

function finish() {
  if (finished) return;
  finished = true;
  holdBehind(false);
  if (el) {
    el.hidden = true;
    el.style.pointerEvents = '';
  }
  for (const x of anims) { try { x.cancel(); } catch (_) { void _; } }
  anims = [];
  resolveDone();
}

/* ---------------- Schnittstelle ---------------- */

/** Szene starten – so früh wie möglich (app.js ruft das vor dem eigentlichen Start). */
export function start() {
  el = document.getElementById('splash');
  if (!el || el.hidden) { finished = true; resolveDone(); return; }
  mode = decide();
  el.dataset.intro = mode;
  holdBehind(true);
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
  for (const x of anims) { try { x.finish(); } catch (_) { void _; } }
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

