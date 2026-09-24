// Übergänge zwischen den Ansichten – nur transform und opacity, damit nichts neu
// umbrochen werden muss. Bei „Bewegung reduzieren“ springt alles sofort.
//
// Arten: push (von rechts herein), pop (nach rechts hinaus), sheet-up (von unten),
// sheet-down (nach unten weg), fade (Tabwechsel), none.
//
// Dazu die Federn für das Liquid-Glass-Gefühl (1.6.0): keine Bibliothek, sondern eine
// gedämpfte Feder, aus der entweder Keyframes für die Web Animations API berechnet
// werden (läuft überall) oder ein CSS-Easing linear(…) für Übergänge in CSS.

const EASE = 'cubic-bezier(.32,.72,0,1)';   // wie die Federkurve von UIKit
const DUR = { push: 440, pop: 380, 'sheet-up': 460, 'sheet-down': 340, fade: 200 };
const PARALLAX = -0.28;                        // die Ansicht darunter wandert ein Stück mit

let active = null;   // { anims, cleanup }

export const reduced = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { void _; return false; }
};

/** Laufenden Übergang sofort abschließen (z. B. weil schon weiternavigiert wird). */
export function settle() {
  if (!active) return;
  const a = active;
  active = null;
  a.cleanup();
}

export const busy = () => !!active;

/* ---------------- Federn ---------------- */

/**
 * Gedämpfte Feder von 0 nach 1 – Parameter wie bei SwiftUI/UIKit (stiffness, damping, mass).
 * velocity: Anfangsgeschwindigkeit in „ganzen Strecken pro Sekunde“ (Schwung aus einer Geste).
 * precision: ab welcher Restauslenkung die Feder als ruhig gilt (Anteil der Strecke).
 * Liefert { duration (ms), at(ms) → Fortschritt (kann kurz über 1 schwingen) }.
 */
export function spring({ stiffness = 220, damping = 24, mass = 1, velocity = 0, precision = 0.002 } = {}) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const v0 = -velocity;   // gerechnet wird die Auslenkung x = 1 - Fortschritt
  let x;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const b = (v0 + zeta * w0) / wd;
    x = (t) => Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + b * Math.sin(wd * t));
  } else {
    const b = v0 + w0;
    x = (t) => (1 + b * t) * Math.exp(-w0 * t);
  }
  let last = 0;
  for (let t = 0; t < 3; t += 1 / 240) if (Math.abs(x(t)) >= precision) last = t;
  const duration = Math.max(1, Math.round((last + 1 / 240) * 1000));
  return { duration, at: (ms) => (ms >= duration ? 1 : 1 - x(ms / 1000)) };
}

// Zahlen kurz halten – und exakt „100“ statt „100.00000001“ (die Tests lesen Keyframes).
export const num = (v) => String(Math.round(v * 1000) / 1000);

/**
 * Keyframes aus einer Feder (etwa 60 je Sekunde, dazwischen linear): frame(p, v) liefert
 * die Eigenschaften für Fortschritt p und Geschwindigkeit v (Strecken pro Sekunde).
 */
export function springFrames(s, frame, fps = 60) {
  const n = Math.max(2, Math.round(s.duration / 1000 * fps));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = s.duration * i / n;
    const p = i === n ? 1 : s.at(t);
    const v = i === n ? 0 : (s.at(t + 4) - s.at(t)) * 250;
    out.push({ ...frame(p, v), offset: i / n });
  }
  return out;
}

/** Element mit einer Feder animieren; opts wie spring() plus delay und fill. */
export function springAnimate(el, frame, opts = {}) {
  const s = spring(opts);
  return el.animate(springFrames(s, frame), { duration: s.duration, delay: opts.delay || 0, easing: 'linear', fill: opts.fill || 'none' });
}

/** Dieselbe Feder als CSS-Easing linear(…) – null, wenn der Browser linear() nicht kennt. */
export function springEasing(opts, points = 40) {
  try {
    if (!window.CSS?.supports?.('transition-timing-function', 'linear(0, 1)')) return null;
  } catch (_) { void _; return null; }
  const s = spring(opts);
  const v = [];
  for (let i = 0; i <= points; i++) v.push(num(i === points ? 1 : s.at(s.duration * i / points)));
  return { easing: `linear(${v.join(', ')})`, duration: s.duration };
}

function reset(el) {
  el.style.zIndex = '';
  el.style.transform = '';
  el.style.pointerEvents = '';
  el.classList.remove('moving');
}

/**
 * Spielt einen Übergang von `from` nach `to` ab. `to` muss schon sichtbar sein;
 * `from` wird am Ende versteckt, sofern `keep(from)` nicht true liefert.
 */
export function run(kind, from, to, keep = () => false) {
  settle();
  const finish = () => {
    if (from && from !== to && !keep(from)) from.hidden = true;
  };
  if (!from || !to || from === to || kind === 'none' || reduced() || typeof to.animate !== 'function') {
    finish();
    return Promise.resolve();
  }
  const opt = { duration: DUR[kind] || 300, easing: EASE, fill: 'both' };
  const anims = [];
  const a = (el, frames, o = opt) => anims.push(el.animate(frames, o));
  from.style.pointerEvents = 'none';

  if (kind === 'push') {
    to.style.zIndex = '2';
    to.classList.add('moving');
    a(to, [{ transform: 'translateX(100%)' }, { transform: 'none' }]);
    a(from, [{ transform: 'none' }, { transform: `translateX(${PARALLAX * 100}%)` }]);
  } else if (kind === 'pop') {
    from.style.zIndex = '2';
    from.classList.add('moving');
    a(from, [{ transform: 'none' }, { transform: 'translateX(100%)' }]);
    a(to, [{ transform: `translateX(${PARALLAX * 100}%)` }, { transform: 'none' }]);
  } else if (kind === 'sheet-up') {
    // Hinzufügen quillt aus dem Kamera-Tropfen (glass.js) und steigt mit einer Feder auf.
    to.style.zIndex = '2';
    to.classList.add('moving', 'sheet');
    const s = spring({ stiffness: 250, damping: 29 });
    a(to, springFrames(s, (p) => ({ transform: `translateY(${num((1 - p) * 100)}%)` })), { duration: s.duration, easing: 'linear', fill: 'both' });
    a(from, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.94)', opacity: 0.55 }]);
  } else if (kind === 'sheet-down') {
    from.style.zIndex = '2';
    from.classList.add('moving', 'sheet');
    a(from, [{ transform: 'none' }, { transform: 'translateY(100%)' }], { ...opt, easing: 'cubic-bezier(.4,0,.8,.6)' });
    a(to, [{ transform: 'scale(.94)', opacity: 0.55 }, { transform: 'none', opacity: 1 }]);
  } else {
    to.style.zIndex = '2';
    a(to, [{ opacity: 0 }, { opacity: 1 }], { ...opt, easing: 'ease-out' });
  }

  return new Promise((resolve) => {
    const me = {
      cleanup: () => {
        finish();
        for (const x of anims) { try { x.cancel(); } catch (_) { void _; } }
        reset(from); reset(to);
        from.classList.remove('sheet'); to.classList.remove('sheet');
        resolve();
      },
    };
    active = me;
    Promise.all(anims.map(x => x.finished)).then(() => {
      if (active === me) { active = null; me.cleanup(); }
    }, () => { /* abgebrochen: settle() hat schon aufgeräumt */ });
  });
}

/**
 * Zurückwischen: die aktuelle Ansicht folgt dem Finger, die vorige liegt darunter.
 * Liefert { move(px), end(commit, onDone) → Promise }.
 */
export function dragPop(cur, prev) {
  settle();
  const w = cur.getBoundingClientRect().width || window.innerWidth;
  prev.hidden = false;
  cur.style.zIndex = '2';
  cur.classList.add('moving');
  prev.style.pointerEvents = 'none';
  cur.style.pointerEvents = 'none';
  let x = 0;
  const place = () => {
    cur.style.transform = `translateX(${x}px)`;
    prev.style.transform = `translateX(${PARALLAX * (w - x)}px)`;
  };
  place();
  return {
    width: w,
    move(px) { x = Math.max(0, Math.min(w, px)); place(); },
    // onDone läuft vor dem Zurücksetzen – dort den Zustand umschalten, sonst blitzt die Ansicht auf.
    end(commit, onDone = () => {}) {
      const target = commit ? w : 0;
      const left = Math.abs(target - x) / w;
      const done = () => {
        if (!commit) prev.hidden = true;
        onDone();
        reset(cur); reset(prev);
      };
      if (reduced() || typeof cur.animate !== 'function' || left < 0.01) { done(); return Promise.resolve(); }
      const o = { duration: Math.max(140, 360 * left), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' };
      const a1 = cur.animate([{ transform: `translateX(${x}px)` }, { transform: `translateX(${target}px)` }], o);
      const a2 = prev.animate([{ transform: `translateX(${PARALLAX * (w - x)}px)` }, { transform: `translateX(${PARALLAX * (w - target)}px)` }], o);
      return Promise.all([a1.finished, a2.finished]).catch(() => null).then(() => {
        done();
        a1.cancel(); a2.cancel();
      });
    },
  };
}
