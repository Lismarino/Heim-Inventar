// Übergänge zwischen den Ansichten – nur transform und opacity, damit nichts neu
// umbrochen werden muss. Bei „Bewegung reduzieren“ springt alles sofort.
//
// Arten: push (von rechts herein), pop (nach rechts hinaus), sheet-up (von unten),
// sheet-down (nach unten weg), ripple (Tabwechsel, 1.10.1), fade, none.
//
// ripple – „Wassertropfen auf stillem Wasser“: Vom Tippunkt aus öffnet sich ein wachsender
// Kreis, in dem die neue Ansicht erscheint; ein, zwei feine Lichtringe laufen aus. Technisch
// liegt dabei die ALTE Ansicht oben (ohne Zeigerereignisse) und bekommt ein wachsendes
// kreisrundes Loch (clip-path-Polygon mit Aussparung). So ist die neue Ansicht darunter vom
// ersten Moment an vollständig bedienbar – kein Tipp geht im Übergang verloren.
//
// Dazu die Federn für das Liquid-Glass-Gefühl (1.6.0): keine Bibliothek, sondern eine
// gedämpfte Feder, aus der entweder Keyframes für die Web Animations API berechnet
// werden (läuft überall) oder ein CSS-Easing linear(…) für Übergänge in CSS.

const EASE = 'cubic-bezier(.32,.72,0,1)';   // wie die Federkurve von UIKit
const DUR = { push: 440, pop: 380, 'sheet-up': 460, 'sheet-down': 340, fade: 200, ripple: 420 };
const RIPPLE_EASE = 'cubic-bezier(.25,.6,.3,1)';   // weich auslaufend, ohne Überschwingen
const PARALLAX = -0.28;                        // die Ansicht darunter wandert ein Stück mit

let active = null;   // { cleanup(revert) }

export const reduced = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { void _; return false; }
};

/**
 * Laufenden Übergang sofort abschließen (z. B. weil schon weiternavigiert wird).
 * Mit { revert: true } (nur navigate): Ein Tab-Übergang, der noch kaum begonnen hat, wird
 * zurückgenommen statt vollendet – sichtbar bleibt, was gerade überwiegt. Liefert dann die
 * Ansicht, die als Grundlage stehen bleibt, sonst null.
 */
export function settle({ revert = false } = {}) {
  if (!active) return null;
  const a = active;
  active = null;
  return a.cleanup(revert) || null;
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
function springFrames(s, frame, fps = 60) {
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

/* ---------------- Wassertropfen (Tabwechsel) ---------------- */

// Rechteck mit kreisrunder Aussparung als clip-path-Polygon (evenodd). Gleich viele Punkte
// für jeden Radius – so interpoliert der Browser Punkt für Punkt, der Kreis wächst sauber.
const SEG = 72;
function holePoly(w, h, x, y, r) {
  const p = (a, b) => `${num(a)}px ${num(b)}px`;
  const pts = [p(-40, -40), p(w + 40, -40), p(w + 40, h + 40), p(-40, h + 40), p(-40, -40), p(x, y - r)];
  for (let i = 1; i <= SEG; i++) {
    const t = -Math.PI / 2 - i * 2 * Math.PI / SEG;   // gegen den Uhrzeigersinn
    pts.push(p(x + r * Math.cos(t), y + r * Math.sin(t)));
  }
  pts.push(p(-40, -40));
  return `polygon(evenodd, ${pts.join(', ')})`;
}

// Die auslaufenden Ringe: klein gezeichnet und hochskaliert wäre unscharf, riesig gezeichnet
// kostet auf dem iPhone viel Speicher – daher höchstens 520 px, die dann verblassen.
// Die Ringe laufen unabhängig vom Übergang aus (der ist nach 420 ms fertig) und räumen sich
// selbst weg; bei sehr schnellem Tippen bleiben höchstens zwei Ringpaare gleichzeitig.
function rings(host, x, y, R) {
  if (!host) return;
  const old = host.querySelectorAll(':scope > .ripple-rings');
  for (let i = 0; i < old.length - 1; i++) old[i].remove();
  const list = [];
  const box = document.createElement('div');
  box.className = 'ripple-rings';
  box.setAttribute('aria-hidden', 'true');
  const d = Math.round(Math.min(520, R * 1.3));
  const parts = [[0, 560, 0.34], [110, 640, 0.2]];
  for (const [delay, dur, peak] of parts) {
    const r = document.createElement('i');
    r.style.cssText = `width:${d}px;height:${d}px;left:${num(x - d / 2)}px;top:${num(y - d / 2)}px`;
    box.appendChild(r);
    list.push(r.animate([
      { transform: 'scale(.06)', opacity: 0 },
      { transform: 'scale(.3)', opacity: peak, offset: 0.2 },
      { transform: 'scale(1)', opacity: 0 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.2,.6,.35,1)', fill: 'both' }));
  }
  host.appendChild(box);
  Promise.all(list.map(x => x.finished)).catch(() => null).then(() => box.remove());
}

function reset(el) {
  el.style.zIndex = '';
  el.style.transform = '';
  el.style.pointerEvents = '';
  el.classList.remove('moving', 'sheet');
}

/**
 * Spielt einen Übergang von `from` nach `to` ab. `to` muss schon sichtbar sein;
 * `from` wird am Ende versteckt, sofern `keep(from)` nicht true liefert.
 */
export function run(kind, from, to, keep = () => false, { origin = null } = {}) {
  settle();
  const finish = () => {
    if (from && from !== to && !keep(from)) from.hidden = true;
  };
  // Bewegung reduzieren: der Tabwechsel blendet kurz über, alles andere springt.
  if (kind === 'ripple' && reduced() && from && to && from !== to && typeof from.animate === 'function') kind = 'fade-out';
  else if (kind === 'ripple' && typeof CSS !== 'undefined' && !CSS.supports?.('clip-path', 'polygon(evenodd, 0 0, 1px 0, 0 1px)')) kind = 'fade';
  if (!from || !to || from === to || kind === 'none' || (reduced() && kind !== 'fade-out') || typeof to.animate !== 'function') {
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
  } else if (kind === 'ripple') {
    // Die alte Ansicht liegt oben, ihr Loch wächst vom Tippunkt aus; darunter setzt sich die
    // neue Ansicht wie eine beruhigte Wasseroberfläche (minimal von 0,985 auf 1).
    const rc = from.getBoundingClientRect();
    const w = rc.width || window.innerWidth;
    const h = rc.height || window.innerHeight;
    const x = Math.min(w, Math.max(0, origin ? origin.x - rc.left : w / 2));
    const y = Math.min(h, Math.max(0, origin ? origin.y - rc.top : h));
    const R = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) + 2;
    from.style.zIndex = '2';
    const o = { duration: DUR.ripple, easing: RIPPLE_EASE, fill: 'both' };
    a(from, [
      { clipPath: holePoly(w, h, x, y, 0), opacity: 1 },
      { clipPath: holePoly(w, h, x, y, R * 0.45), opacity: 0.6, offset: 0.3 },
      { clipPath: holePoly(w, h, x, y, R), opacity: 0 },
    ], o);
    a(to, [{ transform: 'scale(.985)', transformOrigin: `${num(x)}px ${num(y)}px` }, { transform: 'none', transformOrigin: `${num(x)}px ${num(y)}px` }], o);
    rings(from.parentElement, x + rc.left - (from.parentElement?.getBoundingClientRect().left || 0), y + rc.top - (from.parentElement?.getBoundingClientRect().top || 0), R);
  } else if (kind === 'fade-out') {
    // Bewegung reduzieren: die alte Ansicht blendet oben liegend aus – 150 ms, ohne Kreis.
    from.style.zIndex = '2';
    a(from, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-out', fill: 'both' });
  } else {
    to.style.zIndex = '2';
    a(to, [{ opacity: 0 }, { opacity: 1 }], { ...opt, easing: 'ease-out' });
  }

  const t0 = performance.now();
  return new Promise((resolve) => {
    const me = {
      // revert: der Übergang wird abgebrochen, weil schon der nächste kommt. Hat sich das Loch
      // erst wenig geöffnet, bleibt die alte Ansicht die Grundlage (sie überwiegt ja noch).
      cleanup: (revert = false) => {
        const back = revert && (kind === 'ripple' || kind === 'fade-out') && performance.now() - t0 < DUR.ripple * 0.35;
        if (back) to.hidden = true;
        else finish();
        for (const x of anims) { try { x.cancel(); } catch (_) { void _; } }
        reset(from); reset(to);
        resolve();
        return back ? from : null;
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
