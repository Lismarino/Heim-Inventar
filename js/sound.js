// Klänge (1.10.0): warm, kurz, leise – per Web Audio erzeugt, ohne eine einzige Audiodatei
// (offline, winzig). Weiche Sinus-/Dreieck-Töne mit schneller Hüllkurve, dazu ein Hauch Raum
// über ein kurzes, gefiltertes Echo. Kein Piepsen, nichts länger als eine Viertelsekunde.
//
// iOS: navigator.audioSession.type = 'ambient' – dann respektieren die Töne den Stummschalter
// und mischen sich unter laufende Musik, statt sie anzuhalten. Der AudioContext entsteht erst
// bei der ersten Berührung (vorher dürfte er ohnehin nicht spielen). Fehler bleiben still:
// Töne sind Zugabe, nie Voraussetzung.

let ac = null;        // AudioContext – erst nach der ersten Nutzergeste
let out = null;       // Master-Lautstärke
let send = null;      // Eingang des kleinen Raums (Echo)
let enabled = true;
let volume = 0.25;
// Die Einstellungen liegen in IndexedDB und sind beim Start noch nicht geladen – die Start-Szene
// spielt aber schon. Deshalb merkt sich sound.js „Töne“ und Lautstärke zusätzlich hier (1.10.1).
const PREF_KEY = 'inventar-toene';
try {
  const p = JSON.parse(window.localStorage.getItem(PREF_KEY) || 'null');
  if (p && typeof p.enabled === 'boolean') enabled = p.enabled;
  if (p && Number.isFinite(p.volume)) volume = Math.min(1, Math.max(0, p.volume));
} catch (_) { void _; }
const last = new Map();   // Klang -> Zeitpunkt (ms) – gegen Dauerfeuer

// Mindestabstand je Klang in ms. Das Glitzern der KI kommt bei vielen Fotos sonst im Takt.
const GAP = { sparkle: 1500, tick: 40, check: 40 };

/** Einstellungen übernehmen: { enabled, volume (0–1) }. */
export function configure(o = {}) {
  if (typeof o.enabled === 'boolean') enabled = o.enabled;
  if (Number.isFinite(o.volume)) volume = Math.min(1, Math.max(0, o.volume));
  try { window.localStorage.setItem(PREF_KEY, JSON.stringify({ enabled, volume })); } catch (_) { void _; }
  try { if (out && ac) out.gain.setTargetAtTime(volume, ac.currentTime, 0.02); } catch (_) { void _; }
}

function setup() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (_) { void _; }
  ac = new AC();
  out = ac.createGain();
  out.gain.value = volume;
  // Raum: zwei kurze Echos (70 / 110 ms), gedämpft und tiefpassgefiltert – eher Holz als Halle.
  send = ac.createGain();
  send.gain.value = 0.16;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  const d1 = ac.createDelay(0.3);
  d1.delayTime.value = 0.07;
  const d2 = ac.createDelay(0.3);
  d2.delayTime.value = 0.11;
  const fb = ac.createGain();
  fb.gain.value = 0.22;
  send.connect(lp);
  lp.connect(d1);
  lp.connect(d2);
  d1.connect(fb);
  fb.connect(d1);
  d1.connect(out);
  d2.connect(out);
  out.connect(ac.destination);
  return true;
}

/** Bei jeder Berührung aufrufen: legt den AudioContext an bzw. weckt ihn (iOS pausiert ihn im Hintergrund). */
export function unlock() {
  if (!enabled) return;
  try {
    if (!ac && !setup()) return;
    if (ac.state !== 'running') ac.resume().catch(() => {});
  } catch (_) { void _; }
}

/** Einmal beim Start: die erste Geste weckt den Ton. */
export function init() {
  const wake = () => unlock();
  for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, wake, { capture: true, passive: true });
}

// Ein Ton: Frequenz (Hz, optional gleitend nach `to`), Start (s, relativ), Dauer (s), Pegel.
function tone(f, at, dur, { type = 'sine', gain = 0.3, to = 0, attack = 0.006, wet = true } = {}) {
  const t = ac.currentTime + at;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.8);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(out);
  if (wet) g.connect(send);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Weiches Rauschen durch einen wandernden Bandpass – fürs Wischen und das „Klack“.
let noiseBuf = null;
function noise(at, dur, { from = 1800, to = 500, gain = 0.2, q = 0.9 } = {}) {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.3), ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = q;
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// Die Klänge. Tonhöhen aus einer warmen Pentatonik (C-Dur ohne Leitton), eher tief als hell.
const SOUNDS = {
  // Tab-Wechsel: kaum hörbar, wie ein Fingernagel auf Holz
  tick: () => tone(1320, 0, 0.035, { type: 'triangle', gain: 0.07, wet: false }),
  // Foto aufgenommen/gespeichert: weiches „Klack“ – kurzes Rauschen plus tiefer Körper
  click: () => { noise(0, 0.05, { from: 3200, to: 900, gain: 0.22, q: 1.4 }); tone(196, 0, 0.07, { gain: 0.18, to: 150, wet: false }); },
  // Gespeichert: kleiner, aufsteigender Zweiklang
  save: () => { tone(659.3, 0, 0.13, { gain: 0.2 }); tone(987.8, 0.075, 0.18, { gain: 0.17 }); },
  // Rückgängig: derselbe Zweiklang abwärts
  undo: () => { tone(987.8, 0, 0.12, { gain: 0.16 }); tone(659.3, 0.07, 0.17, { gain: 0.18 }); },
  // Wisch-Archiv: sanftes Wischen
  swipe: () => noise(0, 0.17, { from: 2600, to: 600, gain: 0.16 }),
  // Checkliste: Häkchen …
  check: () => tone(1046.5, 0, 0.07, { type: 'triangle', gain: 0.13 }),
  // … und alles abgehakt: kleiner Akkord, leicht gebrochen
  chord: () => { tone(523.3, 0, 0.24, { gain: 0.14 }); tone(659.3, 0.035, 0.23, { gain: 0.12 }); tone(784, 0.07, 0.22, { gain: 0.11 }); tone(1046.5, 0.105, 0.2, { gain: 0.08 }); },
  // Blatt öffnet (Aktionen, langes Drücken): Pop
  pop: () => tone(420, 0, 0.07, { gain: 0.2, to: 720, attack: 0.004 }),
  // Fehler: tief und weich, nicht schrill
  error: () => { tone(220, 0, 0.2, { type: 'triangle', gain: 0.2, to: 174.6 }); tone(110, 0, 0.18, { gain: 0.1, wet: false }); },
  // Sicherung/Drive fertig: kleine Glocke (Grundton + unharmonische Obertöne)
  bell: () => { tone(1318.5, 0, 0.25, { gain: 0.14, attack: 0.003 }); tone(3296, 0, 0.12, { gain: 0.04, attack: 0.002 }); tone(1975.5, 0.06, 0.22, { gain: 0.08, attack: 0.003 }); },
  // KI-Erkennung fertig: dezentes Glitzern
  sparkle: () => { tone(2093, 0, 0.09, { gain: 0.05 }); tone(2637, 0.04, 0.09, { gain: 0.045 }); tone(3136, 0.08, 0.11, { gain: 0.04 }); },
};

/** Einen Klang spielen – still, wenn aus, nicht möglich oder zu kurz nach dem letzten gleichen. */
export function play(name) {
  if (!enabled || !ac || !SOUNDS[name]) return;
  try {
    const now = performance.now();
    if (now - (last.get(name) || -1e9) < (GAP[name] ?? 30)) return;
    last.set(name, now);
    if (ac.state !== 'running') ac.resume().catch(() => {});
    SOUNDS[name]();
  } catch (_) { void _; }
}

/* ---------------- Landetöne der Start-Szene (1.10.1) ---------------- */

// Buch: dumpfes Holz-„Tock“ – kurzes, tief gefiltertes Rauschen plus ein fallender Körper,
// je Buch leicht andere Tonhöhe. Einmachglas: heller Glas-„Tink“ mit unharmonischem Oberton.
const PITCH = [1, 0.9, 1.08, 0.95, 1.13, 0.86];
function landSound(kind, at, n) {
  if (kind === 'jar') {
    tone(2217, at, 0.16, { gain: 0.07, attack: 0.002 });
    tone(3520, at, 0.09, { gain: 0.025, attack: 0.002, wet: false });
    noise(at, 0.03, { from: 6000, to: 4000, gain: 0.05, q: 2 });
  } else {
    const k = PITCH[n % PITCH.length];
    noise(at, 0.045, { from: 1100 * k, to: 380 * k, gain: 0.16, q: 1.1 });
    tone(210 * k, at, 0.085, { type: 'triangle', gain: 0.14, to: 140 * k, attack: 0.003, wet: false });
  }
}

/**
 * Ein Gegenstand der Start-Szene setzt in `inMs` Millisekunden auf ('book' | 'jar', n = Nummer).
 * Vor der ersten Berührung lässt iOS keinen Ton zu – versucht wird es trotzdem: Kontext
 * anlegen und wecken; bleibt er 'suspended', wird still übersprungen. Nie ein Fehler, nie
 * ein Warten: der Aufruf kehrt sofort zurück.
 */
export function land(kind, inMs = 0, n = 0) {
  if (!enabled) return;
  try {
    if (!ac && !setup()) return;
    const due = performance.now() + inMs;
    const go = () => {
      const left = due - performance.now();
      if (ac.state !== 'running' || left < -25) return;   // zu spät – dann lieber keinen Ton
      landSound(kind, Math.max(0, left) / 1000, n);
    };
    if (ac.state === 'running') { go(); return; }
    const r = ac.resume();
    if (r && typeof r.then === 'function') r.then(() => { try { go(); } catch (_) { void _; } }, () => {});
  } catch (_) { void _; }
}
