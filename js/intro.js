// Start-Szene „Regal“ (2.1.1) – das Regal aus 1.x, flach neu gemacht. Das leere Regalbrett ist
// zugleich das iOS-Startbild (icons/splash/, erzeugt mit tools/splash.js aus genau diesem Markup).
// Fünf Bücher und ein Einmachglas fallen nacheinander federnd ins Regal (kippen, richten sich
// auf, das letzte lehnt schräg) – in Tönen der gewählten Akzentfarbe (css/tokens.css, --i-*).
// Dann wird aus dem Regal das Keepsy-Symbol: die Dinge sinken in die Box, die aus dem Brett
// wächst, der Deckel klappt federnd zu, „Keepsy“ blendet ein – ≈ 1,3 s bis bedienbar.
// Landetöne über sound.js: „Tock“ je Buch, „Tink“ beim Glas, Klappen beim Deckel – nur wenn
// Töne an sind und es schon einen AudioContext gibt (vor der ersten Berührung still).
//
// - Blockiert den Start nicht: app.js startet parallel und ruft done(), sobald es bereit ist.
//   Ist die App schneller, läuft die Szene zu Ende; ist sie langsamer, steht das Symbol ruhig da.
// - Tippen öffnet sofort (sobald die App bereit ist).
// - Nur beim echten Kaltstart. Wurde die Seite nach dem Wechsel in den Hintergrund neu
//   geladen (oder aus dem Verlauf wiederhergestellt), nur kurz überblenden.
// - „Bewegung reduzieren“: nur kurzes Überblenden.
// - Solange die Szene steht, sind #app und #onboarding inert: Die Tab-Taste (Tastatur,
//   Schaltersteuerung) landet nicht unsichtbar hinter ihr. Die Fehlerseite des Start-Wächters
//   liegt außerhalb und darüber und bleibt bedienbar.
// - Der Start-Wächter in index.html bleibt unberührt: window.__inventarReady setzt app.js
//   wie bisher, unabhängig von der Szene.
// Animiert werden nur transform und opacity.
import { reduced, num } from './motion.js';
import { lock } from './ui.js';
import { land, init as soundInit } from './sound.js';

const BG_KEY = 'inventar-hintergrund';   // gesetzt, sobald die App einmal im Hintergrund war
const OPEN_AFTER = 1080;                 // ms: so lange dauert die Szene mindestens (+ 0,2 s Ausblenden)

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

const FALL = 230;     // ms bis zum Aufsetzen
const SETTLE = 320;   // ms Nachfedern
const STAGGER = 52;   // ms zwischen zwei Gegenständen
const MORPH = 600;    // ms: ab hier wird aus dem Regal die Box
const LID_FALL = 170; // ms: Deckel fällt
const LID_AT = MORPH + 130;

// Ein Gegenstand fällt aus `y0` px Höhe (leicht gekippt um r0 Grad), setzt auf, federt kurz
// zurück, staucht sich und richtet sich auf – bis auf `lean` Grad (ein Buch lehnt am Ende).
function dropFrames({ y0, r0, lean = 0 }, fall = FALL, settle = SETTLE, fade = true) {
  const total = fall + settle;
  const n = Math.round(total / 1000 * 60);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = total * i / n;
    let y, r, sx = 1, sy = 1, o = 1;
    if (t <= fall) {
      const p = t / fall;
      y = y0 * (1 - p * p);                         // freier Fall
      r = r0 + (lean - r0) * 0.25 * p;
      if (fade) o = Math.min(1, t / 70);
      const s = Math.max(0, p - 0.6) * 0.1;         // kurz vor dem Aufsetzen etwas gestreckt
      sy = 1 + s; sx = 1 - s * 0.6;
    } else {
      const s = (t - fall) / 1000;
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

// Reihenfolge wie im Markup (links nach rechts); fallen in der Folge ORDER.
const ITEMS = [
  { y0: -150, r0: -9 },
  { y0: -170, r0: 7 },
  { y0: -160, r0: -6 },
  { y0: -175, r0: 4 },             // Einmachglas
  { y0: -165, r0: 8 },
  { y0: -180, r0: -14, lean: -7 }, // lehnt sich am Ende an den Nachbarn
];
const ORDER = [2, 0, 3, 4, 1, 5];   // nicht stur von links: erst das breite, dann das Glas …

// Box wächst federnd aus dem Brett (scaleY mit leichtem Überschwingen).
function growFrames(dur) {
  const n = Math.round(dur / 1000 * 60);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const s = dur * i / n / 1000;
    let v = 1 - Math.exp(-13 * s) * Math.cos(16 * s);
    if (i === n) v = 1;
    out.push({ offset: i / n, opacity: i ? 1 : 0, transform: `scale(${num(1 + (1 - v) * 0.12)}, ${num(Math.max(0.02, v))})` });
  }
  return out;
}

let timers = [];
function play() {
  const q = (s) => el.querySelector(s);
  const items = [...el.querySelectorAll('.i-item')];
  const hits = [];
  const opt = (delay, duration, extra) => ({ duration, delay, easing: 'linear', fill: 'both', ...extra });
  items.forEach((it, i) => {
    const k = ORDER.indexOf(i);
    const delay = 20 + k * STAGGER;
    const an = it.animate(dropFrames(ITEMS[i] || ITEMS[0]), opt(delay, FALL + SETTLE));
    anims.push(an);
    hits.push({ an, at: delay + FALL, kind: it.classList.contains('i-jar') ? 'jar' : 'book', n: k });
  });
  // Aus dem Regal wird das Symbol: Bücher und Glas rücken zusammen und sinken in die Box,
  // die aus dem Brett wächst; das Brett schrumpft zu ihrem Boden; der Deckel klappt federnd zu.
  const m = (node, frames, o) => { if (node) anims.push(node.animate(frames, { fill: 'both', ...o })); };
  const smooth = 'cubic-bezier(.45,0,.2,1)';
  m(q('.i-row'), [{ transform: 'none', opacity: 1 }, { transform: 'scale(.56, .82)', opacity: 1, offset: 0.45 }, { transform: 'scale(.42, .5)', opacity: 0 }], { duration: 280, delay: MORPH, easing: smooth });
  m(q('.i-shelf'), [{ transform: 'none', opacity: 1 }, { transform: 'scaleX(.48)', opacity: 0 }], { duration: 260, delay: MORPH + 20, easing: smooth });
  m(q('.i-box'), growFrames(380), { duration: 380, delay: MORPH + 40, easing: 'linear' });
  m(q('.i-lid'), dropFrames({ y0: -46, r0: -10 }, LID_FALL, 300, true), { duration: LID_FALL + 300, delay: LID_AT, easing: 'linear' });
  hits.push({ an: null, at: LID_AT + LID_FALL, kind: 'lid', n: 0 });
  // Der Schriftzug steht nicht im Startbild (dort gäbe es nur eine Ersatzschrift).
  m(q('.i-name'), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: LID_AT + 60, easing: 'cubic-bezier(.2,.8,.2,1)' });
  // Landetöne im Takt der Animation: sobald sie läuft, weiß man, wie weit jeder Aufsetzpunkt
  // entfernt ist. Jeder Ton wird erst kurz vorher bestellt – wer mitten in der Szene tippt,
  // hört den Rest. Die Animation wartet nie auf den Ton.
  const first = hits[0]?.an;
  first?.ready.then(() => {
    if (finished || opening) return;
    const t0 = performance.now() - (Number(first.currentTime) || 0);   // alle begannen gleichzeitig
    for (const h of hits) {
      const due = t0 + h.at;
      timers.push(setTimeout(() => {
        if (finished || opening) return;
        land(h.kind, Math.max(0, due - performance.now()), h.n);
      }, Math.max(0, due - performance.now() - 50)));
    }
  }, () => {});
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
  for (const x of timers) clearTimeout(x);
  timers = [];
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
  if (mode === 'full') { soundInit(); play(); }
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

