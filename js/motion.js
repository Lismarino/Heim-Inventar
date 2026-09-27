// Übergänge zwischen den Ansichten – nur transform und opacity, damit nichts neu
// umbrochen werden muss. Bei „Bewegung reduzieren“ springt alles sofort.
//
// Arten: push (von rechts herein), pop (nach rechts hinaus), sheet-up (von unten),
// sheet-down (nach unten weg), fade-out (Tabwechsel), ripple (seit 1.10.3 ungenutzt), fade, none.
//
// ripple – „Wassertropfen“ (1.10.2): Ein Glas-Tröpfchen steigt vom Tab zur Wasseroberfläche
// (42 % der Höhe), taucht ein – die alte Ansicht gibt minimal nach, ein heller Glaspunkt
// ploppt auf –, dann öffnet sich von dort ein Kreis (clip-path: circle) mit der NEUEN Ansicht,
// die dabei von 1,03 auf 1 zurückfließt. Eine 2-px-Lichtkante läuft exakt auf dem Kreisrand,
// zwei Wellen folgen. Die alte Ansicht bleibt bis zum Schluss voll deckend darunter.
// Kein Layout wird abgefragt (Maße aus innerWidth/innerHeight und dem Tippunkt); solange der
// Tropfen läuft, ersetzt eine solide Tönung das Glas der Leisten (body.drop-run).
//
// Dazu die Federn für das Liquid-Glass-Gefühl (1.6.0): keine Bibliothek, sondern eine
// gedämpfte Feder, aus der entweder Keyframes für die Web Animations API berechnet
// werden (läuft überall) oder ein CSS-Easing linear(…) für Übergänge in CSS.

const EASE = 'cubic-bezier(.32,.72,0,1)';   // wie die Federkurve von UIKit
const DUR = { push: 440, pop: 380, 'sheet-up': 460, 'sheet-down': 340, fade: 200, ripple: 600 };
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

// Kubische Bézierkurve wie in CSS: liefert p(t) für 0…1 (Newton, dann Bisektion).
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s) => ((ax * s + bx) * s + cx) * s;
  const Y = (s) => ((ay * s + by) * s + cy) * s;
  const dX = (s) => (3 * ax * s + 2 * bx) * s + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 6; i++) {
      const e = X(s) - t;
      const d = dX(s);
      if (Math.abs(e) < 1e-5) return Y(s);
      if (Math.abs(d) < 1e-6) break;
      s -= e / d;
    }
    let lo = 0, hi = 1;
    s = t;
    for (let i = 0; i < 30; i++) { if (X(s) < t) lo = s; else hi = s; s = (lo + hi) / 2; }
    return Y(s);
  };
}

// Zeitplan des Tropfens (ms ab Tipp). Das Tröpfchen steigt vom Tab zur Wasseroberfläche,
// taucht ein (alte Ansicht gibt minimal nach, heller Glaspunkt), dann öffnet sich der Kreis.
const DROP = { rise: 90, dip: 110, open: 130, grow: 470, waves: [80, 160] };
const DROP_END = DROP.open + DROP.grow;                  // 600 ms: neue Ansicht ganz offen
const OPEN = bezier(0.3, 0, 0.15, 1);                    // Kreis: sanft an, lang auslaufend
const DROP_Y = 0.42;                                     // Aufschlagpunkt: 42 % der Höhe
const STEPS = 24;                                        // Keyframes für Kreis, Kante, Wellen
const fx = { box: null, edge: null, timer: 0, later: [], gen: 0 };   // Effekte des letzten Tropfens

function clearFx() {
  fx.gen++;   // noch ausstehende Effekte des vorigen Tropfens verfallen
  clearTimeout(fx.timer);
  fx.timer = 0;
  for (const t of fx.later) clearTimeout(t);
  fx.later = [];
  fx.box?.remove();
  for (const e of fx.edge || []) e.remove();
  fx.box = null;
  fx.edge = null;
  document.body.classList.remove('drop-run');
}

// Ende der Ansichten-Animation: Kante und Tönung weg, die Wellen dürfen noch auslaufen.
function endViewFx() {
  for (const e of fx.edge || []) e.remove();
  fx.edge = null;
  document.body.classList.remove('drop-run');
}

function layer(host, cls, css = '') {
  const el = document.createElement('div');
  el.className = cls;
  el.setAttribute('aria-hidden', 'true');
  if (css) el.style.cssText = css;
  host.appendChild(el);
  return el;
}

/**
 * Wassertropfen: die NEUE Ansicht liegt oben und wird von einem wachsenden Kreis
 * (clip-path: circle) freigegeben; die alte bleibt darunter voll deckend. Eine 2-px-Lichtkante
 * läuft exakt auf der Kreiskante mit (gleiche Keyframes), zwei Wellen folgen versetzt.
 * Keine Layout-Abfragen: Maße aus innerWidth/innerHeight und dem Tippunkt.
 */
function drop(from, to, origin, anims) {
  const host = to.parentElement || document.body;
  const W = window.innerWidth || 390;
  const H = window.innerHeight || 844;
  const X = Math.min(W, Math.max(0, origin ? origin.x : W / 2));
  const Y = Math.round(H * DROP_Y);
  const R = Math.hypot(Math.max(X, W - X), Math.max(Y, H - Y)) + 4;
  const at = `${num(X)}px ${num(Y)}px`;
  const a = (el, frames, o) => { const x = el.animate(frames, { fill: 'both', ...o }); anims.push(x); return x; };

  clearFx();
  const gen = fx.gen;
  from.style.zIndex = '1';
  to.style.zIndex = '3';

  // Kreis, Skalierung und Lichtkante aus denselben Stützstellen – so liegt die Kante exakt
  // auf dem Rand, auch während die neue Ansicht von 1,03 auf 1 zurückfließt.
  const pts = [];
  for (let i = 0; i <= STEPS; i++) {
    const p = OPEN(i / STEPS);
    pts.push({ offset: i / STEPS, r: R * p, s: 1.03 - 0.03 * p });
  }
  const view = pts.map(q => ({ offset: q.offset, clipPath: `circle(${num(q.r)}px at ${at})`, transform: `scale(${num(q.s)})`, transformOrigin: at }));
  const openOpt = { delay: DROP.open, duration: DROP.grow, easing: 'linear' };
  const main = a(to, view, openOpt);
  // Die alte Ansicht gibt beim Eintauchen kaum merklich nach.
  a(from, [
    { transform: 'none', transformOrigin: at },
    { transform: 'none', transformOrigin: at, offset: DROP.rise / DROP_END },
    { transform: 'scale(.992)', transformOrigin: at, offset: (DROP.rise + DROP.dip) / DROP_END, easing: 'cubic-bezier(.3,0,.2,1)' },
    { transform: 'scale(.996)', transformOrigin: at },
  ], { duration: DROP_END, easing: 'linear' });

  // Die Effekte entstehen erst NACH dem ersten Bild – der Tipp soll sofort etwas zeigen, ohne
  // dass neue Ebenen gezeichnet werden müssen. Sie laufen auf derselben Uhr wie der Kreis
  // (startTime), liegen also exakt auf ihm, egal wann sie angelegt werden.
  const f = (el, frames, o) => {
    const x = el.animate(frames, { fill: 'both', ...o });
    try { if (main.startTime != null) x.startTime = main.startTime; } catch (_) { void _; }
    return x;
  };
  const later = (fn, ms) => {
    const go = () => { if (fx.gen === gen) fn(); };
    if (ms) fx.later.push(setTimeout(go, ms));
    else requestAnimationFrame(() => requestAnimationFrame(go));
  };

  // Über allem (unter der Leiste): Tröpfchen und Glaspunkt – gleich ab dem zweiten Bild.
  later(() => {
    document.body.classList.add('drop-run');   // Glas → solide Tönung, solange es läuft (CSS)
    const box = layer(host, 'drop-fx');
    fx.box = box;
    const sy = origin && origin.y > Y + 40 ? origin.y : null;
    if (sy != null) {
      const bead = layer(box, 'drop-bead', `left:${num(X - 6)}px;top:${num(Y - 6)}px`);
      f(bead, [
        { transform: `translate(${num((origin.x - X))}px, ${num(sy - Y)}px) scale(.6)`, opacity: 0 },
        { transform: `translate(${num((origin.x - X) * 0.75)}px, ${num((sy - Y) * 0.72)}px) scale(.9, 1.25)`, opacity: 1, offset: 0.25 },
        { transform: 'translate(0px, 0px) scale(1.1, .8)', opacity: 1, offset: 0.9 },
        { transform: 'translate(0px, 0px) scale(1.6, .4)', opacity: 0 },
      ], { duration: DROP.rise + 16, easing: 'cubic-bezier(.4,0,.7,.6)' });
    }
    const dot = layer(box, 'drop-dot', `left:${num(X - 11)}px;top:${num(Y - 11)}px`);
    f(dot, [
      { transform: 'scale(0)', opacity: 1 },
      { transform: 'scale(1.18)', opacity: 1, offset: 0.3, easing: 'cubic-bezier(.3,0,.3,1)' },
      { transform: 'scale(.95)', opacity: 1, offset: 0.5 },
      { transform: 'scale(1)', opacity: 0.9, offset: 0.62 },
      { transform: 'scale(1.9)', opacity: 0 },
    ], { delay: DROP.rise - 10, duration: 320, easing: 'linear' });
  }, 0);

  // Kurz bevor sich der Kreis öffnet: Lichtkante und Wellen.
  later(() => {
    // Kante: eine helle und außen eine zarte dunkle Linie – je eine solide Fläche unter der
    // neuen Ansicht, deren Kreis 2 bzw. 4 px größer ist. Sichtbar bleibt nur der Ring.
    const edge = [layer(host, 'drop-edge dark', 'z-index:2'), layer(host, 'drop-edge', 'z-index:2')];
    fx.edge = edge;
    edge.forEach((el, k) => {
      const w = k ? 2 : 4;
      f(el, pts.map(q => ({ offset: q.offset, clipPath: `circle(${num(q.r + w)}px at ${at})`, transform: `scale(${num(q.s)})`, transformOrigin: at })), openOpt);
    });
    // Die Wellen: klein gezeichnet (Speicher auf dem iPhone), weich hochskaliert. Die erste liegt
    // genau auf der Kreiskante (ein heller Meniskus nach innen), zwei weitere folgen versetzt.
    const D = 480;
    const box = fx.box || (fx.box = layer(host, 'drop-fx'));
    for (const [lag, peak, cls] of [[0, 0.75, 'drop-wave rim'], [DROP.waves[0], 0.35, 'drop-wave'], [DROP.waves[1], 0.35, 'drop-wave']]) {
      const ring = layer(box, cls, `width:${D}px;height:${D}px;left:${num(X - D / 2)}px;top:${num(Y - D / 2)}px`);
      f(ring, pts.map(q => ({ offset: q.offset, transform: `scale(${num(Math.max(0.001, 2 * q.r * q.s / D))})`, opacity: num(peak * Math.min(1, q.offset * 6) * (1 - q.offset)) })),
        { delay: DROP.open + lag, duration: DROP.grow, easing: 'linear' });
    }
  }, DROP.open - 45);

  const end = DROP_END + DROP.waves[DROP.waves.length - 1] + 20;
  fx.timer = setTimeout(clearFx, end);
}

function reset(el) {
  el.style.zIndex = '';
  el.style.transform = '';
  el.style.pointerEvents = '';
  el.classList.remove('moving', 'as-sheet');
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
  else if (kind === 'ripple' && typeof CSS !== 'undefined' && !CSS.supports?.('clip-path', 'circle(1px at 0px 0px)')) kind = 'fade';
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
    to.classList.add('moving', 'as-sheet');
    const s = spring({ stiffness: 250, damping: 29 });
    a(to, springFrames(s, (p) => ({ transform: `translateY(${num((1 - p) * 100)}%)` })), { duration: s.duration, easing: 'linear', fill: 'both' });
    a(from, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.94)', opacity: 0.55 }]);
  } else if (kind === 'sheet-down') {
    from.style.zIndex = '2';
    from.classList.add('moving', 'as-sheet');
    a(from, [{ transform: 'none' }, { transform: 'translateY(100%)' }], { ...opt, easing: 'cubic-bezier(.4,0,.8,.6)' });
    a(to, [{ transform: 'scale(.94)', opacity: 0.55 }, { transform: 'none', opacity: 1 }]);
  } else if (kind === 'ripple') {
    drop(from, to, origin, anims);
  } else if (kind === 'fade-out') {
    // Tabwechsel: die alte Ansicht blendet oben liegend aus, die neue ist darunter sofort bedienbar.
    from.style.zIndex = '2';
    a(from, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 150 : 180, easing: 'ease-out', fill: 'both' });
  } else {
    to.style.zIndex = '2';
    a(to, [{ opacity: 0 }, { opacity: 1 }], { ...opt, easing: 'ease-out' });
  }

  const t0 = performance.now();
  return new Promise((resolve) => {
    let onDown = null;
    const me = {
      // revert: der Übergang wird abgebrochen, weil schon der nächste kommt. Hat sich der Kreis
      // noch kaum geöffnet, bleibt die alte Ansicht die Grundlage (sie überwiegt ja noch).
      cleanup: (revert = false, natural = false) => {
        const early = kind === 'ripple' ? DROP.open + DROP.grow * 0.15 : DUR.ripple * 0.35;
        const back = revert && (kind === 'ripple' || kind === 'fade-out') && performance.now() - t0 < early;
        if (back) to.hidden = true;
        else finish();
        for (const x of anims) { try { x.cancel(); } catch (_) { void _; } }
        if (onDown) document.removeEventListener('pointerdown', onDown, true);
        if (kind === 'ripple') { if (natural) endViewFx(); else clearFx(); }   // abgebrochen: keine Reste
        reset(from); reset(to);
        resolve();
        return back ? from : null;
      },
    };
    active = me;
    if (kind === 'ripple') {
      // Die neue Ansicht ist sofort bedienbar: Tipps im offenen Kreis treffen sie direkt; wer
      // daneben (auf die noch sichtbare alte Fläche) tippt, beendet den Tropfen auf der Stelle –
      // der Tipp landet dann in der neuen, voll aufgedeckten Ansicht. Die Leiste regelt sich selbst.
      onDown = (e) => {
        const t = e.target;
        if (active !== me || (t && t.closest && (t.closest('#nav') || to.contains(t)))) return;
        active = null;
        me.cleanup();
        // Der Klick zu diesem Tipp zielt womöglich noch auf die Fläche neben dem Kreis (Maus,
        // manche Touch-Pfade): dann an das Element der neuen Ansicht unter dem Finger weiterreichen.
        const pass = (c) => {
          document.removeEventListener('click', pass, true);
          if (!c.isTrusted || to.contains(c.target)) return;
          const el = document.elementFromPoint(c.clientX, c.clientY);
          if (!el || !to.contains(el)) return;
          c.stopPropagation();
          c.preventDefault();
          el.click();
        };
        document.addEventListener('click', pass, true);
        setTimeout(() => document.removeEventListener('click', pass, true), 1000);
      };
      document.addEventListener('pointerdown', onDown, true);
    }
    Promise.all(anims.map(x => x.finished)).then(() => {
      if (active === me) { active = null; me.cleanup(false, true); }
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
